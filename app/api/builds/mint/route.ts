import { type NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { redis } from "@/lib/redis"
import { validateBrickParams, computeSpecKey } from "@/lib/brickSpec"
import { normalizeBrickKey } from "@/data/bricks"
import { rk } from "@/lib/redis-keys"
import type { Build } from "@/lib/types"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"
import { buildAnimationUrl } from "@/lib/animation-url"
import { attemptMarketplacePublish, markMarketplacePending } from "@/lib/marketplace-sync"

export const runtime = "nodejs"

const envRaw = (k: string) => (process.env[k] || "").trim()
const env = (k: string) => {
  const v = envRaw(k)
  // Allow "commenting out" secrets in .env via ##... without breaking provider selection.
  if (v.startsWith("#")) return ""
  return v
}

const PINATA_JWT = env("PINATA_JWT")
const LIGHTHOUSE_API_KEY = env("LIGHTHOUSE_API_KEY")
const IPFS_PROVIDER = (env("IPFS_PROVIDER") || (LIGHTHOUSE_API_KEY ? "lighthouse" : PINATA_JWT ? "pinata" : "")).toLowerCase()
const IPFS_API_TOKEN = env("IPFS_API_TOKEN") || (IPFS_PROVIDER === "pinata" ? PINATA_JWT : LIGHTHOUSE_API_KEY)
const IPFS_UPLOAD_URL =
  env("IPFS_UPLOAD_URL") ||
  env("LIGHTHOUSE_UPLOAD_URL") ||
  (IPFS_PROVIDER === "lighthouse"
    ? "https://node.lighthouse.storage/api/v0/add"
    : "https://api.pinata.cloud/pinning/pinFileToIPFS")
const LIGHTHOUSE_UPLOAD_URL_FALLBACKS = [
  "https://node.lighthouse.storage/api/v0/add",
  "https://api.lighthouse.storage/api/v0/add",
]
const IPFS_UPLOAD_URLS =
  IPFS_PROVIDER === "lighthouse"
    ? Array.from(new Set([IPFS_UPLOAD_URL, ...LIGHTHOUSE_UPLOAD_URL_FALLBACKS]))
    : [IPFS_UPLOAD_URL]
const IPFS_GATEWAY_BASE = env("PINATA_GATEWAY_BASE") || "https://gateway.pinata.cloud/ipfs"
const IPFS_UPLOAD_TIMEOUT_MS = Number(env("IPFS_UPLOAD_TIMEOUT_MS") || "25000")
const IPFS_UPLOAD_RETRIES = Number(env("IPFS_UPLOAD_RETRIES") || "4")
const IPFS_ENABLED = env("NEXT_PUBLIC_IPFS_ENABLED") === "1"
const AUTO_IPFS_PUSH_ON_MINT = IPFS_ENABLED && env("AUTO_IPFS_PUSH_ON_MINT") === "1"
const MINT_REQUIRES_IPFS_SYNC =
  IPFS_ENABLED && (env("MINT_REQUIRES_IPFS_SYNC") || "1") === "1" && AUTO_IPFS_PUSH_ON_MINT
const AUTO_SET_BASE_TOKEN_URI_ON_MINT = IPFS_ENABLED && env("AUTO_SET_BASE_TOKEN_URI_ON_MINT") === "1"
const BASE_TOKEN_URI_TARGET = env("BASE_TOKEN_URI_TARGET") || env("NEXT_PUBLIC_BASE_METADATA_URI") || ""
const BASE_TOKEN_URI_OWNER_KEY = env("BASE_TOKEN_URI_OWNER_KEY") || env("PRIVATE_KEY") || ""
const ENABLE_ANIMATION_URL = env("ENABLE_ANIMATION_URL") === "1"
const REQUIRE_CAPTURE_IMAGE_ON_MINT = (env("REQUIRE_CAPTURE_IMAGE_ON_MINT") || "1") === "1"
const AUTO_MARKETPLACE_PUBLISH_ON_MINT = (env("AUTO_MARKETPLACE_PUBLISH_ON_MINT") || "1") === "1"

function isLikelyIpfsCid(v: string) {
  const s = String(v || "").trim()
  return /^(bafy[0-9a-z]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(s)
}

function readImagesCid() {
  const raw = env("NEXT_PUBLIC_IMAGES_CID") || env("IMAGES_CID")
  return isLikelyIpfsCid(raw) ? raw : ""
}

const CHAIN_READ_ABI = [
  "function nextTokenId() view returns (uint256)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function kindOf(uint256 tokenId) view returns (uint8)",
  "function brickSpecOf(uint256 tokenId) view returns (uint8 width, uint8 depth, uint16 density)",
]
const CAPTURE_KEY = (tokenId: string) => rk(`ipfs:capture:${tokenId}`)
const PREFLIGHT_KEY = (buildHash: string) => rk(`ipfs:preflight:${buildHash.toLowerCase()}`)

async function safeRedisGet<T = any>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key)
  } catch {
    return null
  }
}

async function safeRedisSet(key: string, value: any): Promise<boolean> {
  try {
    await redis.set(key, value)
    return true
  } catch {
    return false
  }
}

async function safeRedisSadd(key: string, value: string): Promise<boolean> {
  try {
    await redis.sadd(key, value)
    return true
  } catch {
    return false
  }
}

async function safeRedisDel(key: string): Promise<boolean> {
  try {
    await redis.del(key)
    return true
  } catch {
    return false
  }
}

async function readBrickKeyForToken(
  contract: ethers.Contract,
  tokenId: string | number | bigint,
): Promise<string | null> {
  try {
    const tid = BigInt(String(tokenId))
    const exists = Boolean(await contract.exists(tid))
    if (!exists) return null
    const kind = Number(await contract.kindOf(tid))
    if (kind !== 0) return null
    const [w, d, density] = await contract.brickSpecOf(tid)
    return normalizeBrickKey(Number(w), Number(d), Number(density))
  } catch {
    return null
  }
}

async function uploadToIpfsWithRetry(formDataFactory: () => FormData) {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= IPFS_UPLOAD_RETRIES; attempt++) {
    for (const uploadUrl of IPFS_UPLOAD_URLS) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IPFS_UPLOAD_TIMEOUT_MS)
      try {
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${IPFS_API_TOKEN}`,
          },
          body: formDataFactory(),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (res.ok) return res
        const errText = await res.text()
        lastError = new Error(`IPFS upload failed (${uploadUrl}): ${res.status} ${errText}`)
      } catch (err: any) {
        clearTimeout(timer)
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
    if (attempt < IPFS_UPLOAD_RETRIES) {
      await new Promise((r) => setTimeout(r, 700 * attempt))
    }
  }
  throw lastError || new Error("IPFS upload failed")
}

function appendProviderUploadOptions(formData: FormData) {
  // Pinata supports provider-specific pin options; Lighthouse ignores this field.
  if (IPFS_PROVIDER === "pinata") {
    formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
  }
}

// POST /api/builds/mint - Save full build data + mint info to Redis
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { tokenId, buildHash, txHash, walletAddress } = body
    const screenshotDataUrl = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl.trim() : ""
    if (!tokenId || !buildHash || !walletAddress) {
      return NextResponse.json(
        { error: "Missing required fields: tokenId, buildHash, walletAddress" },
        { status: 400 },
      )
    }

    if (screenshotDataUrl.startsWith("data:image/")) {
      // Persist capture separately so a later /api/builds/ipfs-push retry can reuse
      // the exact preview PNG shown in mint UI.
      await safeRedisSet(CAPTURE_KEY(String(tokenId)), screenshotDataUrl)
    }

    const rawBricks = body.bricks || []
    const kind = body.kind ?? 0
    const brickW = body.brickWidth ?? body.baseWidth ?? 1
    const brickD = body.brickDepth ?? body.baseDepth ?? 1
    let density = body.density
    const area = Number(brickW) * Number(brickD)
    let canonicalComponentBuildIds = Array.isArray(body.componentBuildIds) ? body.componentBuildIds : []
    let canonicalComponentCounts = Array.isArray(body.componentCounts) ? body.componentCounts : []
    let canonicalComposition = body.composition

    // ── Kind 0 (Brick) validation ──
    if (kind === 0) {
      // V3: density is always FIXED_DENSITY=1, no need to validate or read from chain
      density = 1

      const validationError = validateBrickParams(brickW, brickD)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }

      // Duplicate check: has this spec already been minted?
      // Validate Redis index against on-chain state so stale cache data cannot block
      // a mint that already succeeded on-chain.
      const specKey = computeSpecKey(brickW, brickD)
      const brickKey = normalizeBrickKey(brickW, brickD)
      const existingTokenId = await safeRedisGet<string>(rk(`brick:spec:${brickKey}`))
      if (existingTokenId && String(existingTokenId) !== String(tokenId)) {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, CHAIN_READ_ABI, provider)
        const [existingBrickKey, submittedBrickKey] = await Promise.all([
          readBrickKeyForToken(contract, existingTokenId),
          readBrickKeyForToken(contract, tokenId),
        ])

        const redisIndexIsValidConflict = existingBrickKey === brickKey
        const submittedTokenOwnsSpec = submittedBrickKey === brickKey

        // /api/builds/mint is called after tx confirmation. If the submitted token
        // already owns this spec on-chain, treat Redis as stale and self-heal.
        if (submittedTokenOwnsSpec) {
          await safeRedisSet(rk(`brick:spec:${brickKey}`), String(tokenId))
        } else if (redisIndexIsValidConflict) {
          return NextResponse.json(
            { error: `Brick ${brickKey} already minted as token #${existingTokenId}`, specKey },
            { status: 409 },
          )
        } else {
          // Redis mapping is stale/inconsistent for this spec; clear and continue.
          await safeRedisDel(rk(`brick:spec:${brickKey}`))
        }
      }

      // V3: All bricks are primitives — no component requirement.
      // Composition is only validated on-chain for builds (kind>0).
      // Accept whatever components were sent (may be empty for bricks).
      if (!canonicalComponentBuildIds.length) {
        canonicalComponentBuildIds = []
        canonicalComponentCounts = []
        canonicalComposition = {}
      }
    }

    let bricks: any[]
    let baseWidth: number
    let baseDepth: number

    if (kind === 0 && brickW && brickD) {
      // Kind 0: canonical single brick at origin
      const defaultColor = rawBricks[0]?.color ?? "#e8d44d"
      bricks = [{
        id: "1",
        position: [0, 0.5, 0],
        color: defaultColor,
        width: brickW,
        depth: brickD,
      }]
      baseWidth = brickW
      baseDepth = brickD
    } else {
      // Kind 1+: preserve full composite geometry as-is
      bricks = rawBricks
      baseWidth = body.baseWidth ?? 16
      baseDepth = body.baseDepth ?? 16
    }

    const mass = body.mass ?? (kind === 0 ? brickW * brickD * density : bricks.length)
    const uniqueColors = body.colors ?? new Set(bricks.map((b: any) => b.color)).size
    const bw_score = body.bw_score ?? parseFloat((Math.log(1 + mass) * Math.log(2 + uniqueColors)).toFixed(2))

    const uniqueBuildId = `${tokenId}_${Date.now()}_${buildHash.slice(0, 8)}`

    const resolvedName =
      body.buildName && String(body.buildName).trim().length > 0
        ? String(body.buildName).trim()
        : kind === 0
          ? `Brick ${Math.min(brickW, brickD)}x${Math.max(brickW, brickD)} D${density ?? 1}`
          : "Untitled Build"

    const mintedBuild: Build = {
      // Identity
      id: uniqueBuildId,
      name: resolvedName,
      creator: walletAddress.toLowerCase(),

      // Canonical geometry
      bricks,
      baseWidth,
      baseDepth,

      // Scores
      mass,
      colors: uniqueColors,
      bw_score,

      // Chain data
      tokenId,
      buildHash,
      txHash,
      mintedAt: new Date().toISOString(),

      // Build type info
      kind: body.kind,
      density: kind === 0 ? Number(density ?? 1) : body.density,
      brickWidth: kind === 0 ? Number(brickW) : body.brickWidth,
      brickDepth: kind === 0 ? Number(brickD) : body.brickDepth,

      // Composition (which NFTs are used inside this build)
      composition: canonicalComposition,

      // Contract params (useful for verification / IPFS)
      geometryHash: body.geometryHash,
      specKey: body.specKey,
      componentBuildIds: canonicalComponentBuildIds,
      componentCounts: canonicalComponentCounts,

      // Metadata
      metadata: body.metadata,

      // Timestamps
      created: new Date().toISOString(),
      timestamp: Date.now(),
      onchainMinted: true,
      ipfsPending: AUTO_IPFS_PUSH_ON_MINT,
    }

    // Save full build data
    await safeRedisSet(rk(`build:${mintedBuild.id}`), mintedBuild)

    // Reverse lookups
    await safeRedisSet(rk(`token:${tokenId}`), mintedBuild.id)
    await safeRedisSet(rk(`hash:${buildHash}`), mintedBuild.id)

    // Brick spec reverse index (for duplicate detection)
    if (kind === 0) {
      const brickKey = normalizeBrickKey(brickW, brickD, density ?? 1)
      await safeRedisSet(rk(`brick:spec:${brickKey}`), tokenId)
    }

    // Add to global minted set
    await safeRedisSadd(rk("minted_tokens"), tokenId)

    let ipfs: { cid: string; gatewayUrl: string } | null = null
    if (AUTO_IPFS_PUSH_ON_MINT && IPFS_API_TOKEN) {
      try {
        const fileName = `${tokenId}.json`

        // 1) Upload real rendered image first; fallback to deterministic SVG.
        let uploadedImageCid = ""
        let uploadedImagePath = `${tokenId}.png`
        try {
          const preflight = await safeRedisGet<{ imageCid?: string; imagePath?: string; imageUri?: string }>(PREFLIGHT_KEY(String(buildHash)))
          if (preflight?.imageCid) {
            uploadedImageCid = String(preflight.imageCid)
            if (preflight?.imagePath) uploadedImagePath = String(preflight.imagePath)
          }
        } catch {
          // continue with normal image upload flow
        }
        if (screenshotDataUrl.startsWith("data:image/")) {
          try {
            const m = screenshotDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
            if (m) {
              const mime = m[1].toLowerCase()
              const base64 = m[2]
              const bytes = Buffer.from(base64, "base64")
              if (bytes.length > 0) {
                const ext =
                  mime.includes("png")
                    ? "png"
                    : mime.includes("jpeg") || mime.includes("jpg")
                      ? "jpg"
                      : mime.includes("webp")
                        ? "webp"
                        : "png"
                const imageUploadRes = await uploadToIpfsWithRetry(() => {
                  const formData = new FormData()
                  formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
                  const blob = new Blob([bytes], { type: mime })
                  uploadedImagePath = `${tokenId}.${ext}`
                  formData.append("file", blob, uploadedImagePath)
                  return formData
                })
                const imageUploadData = await imageUploadRes.json()
                uploadedImageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
              }
            }
          } catch {
            // Continue to other image sources.
          }
        }
        try {
          if (!uploadedImageCid) {
            const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://buidl-app-delta.vercel.app").replace(/\/+$/, "")
            const imageEndpoint = `${appBaseUrl}/api/builds/image/${tokenId}`
            const imageRes = await fetch(imageEndpoint, { redirect: "follow" })
            if (imageRes.ok) {
              const bytes = await imageRes.arrayBuffer()
              if (bytes.byteLength > 0) {
                const contentType = (imageRes.headers.get("content-type") || "").toLowerCase()
                const ext = contentType.includes("png")
                  ? "png"
                  : contentType.includes("jpeg") || contentType.includes("jpg")
                    ? "jpg"
                    : contentType.includes("webp")
                      ? "webp"
                      : "png"
                const imageUploadRes = await uploadToIpfsWithRetry(() => {
                  const formData = new FormData()
                  appendProviderUploadOptions(formData)
                  const blob = new Blob([bytes], { type: contentType || "image/png" })
                  uploadedImagePath = `${tokenId}.${ext}`
                  formData.append("file", blob, uploadedImagePath)
                  return formData
                })
                const imageUploadData = await imageUploadRes.json()
                uploadedImageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
              }
            }
          }
        } catch {
          // Fallback to deterministic SVG below.
        }

        if (!uploadedImageCid && REQUIRE_CAPTURE_IMAGE_ON_MINT) {
          throw new Error("No captured PNG provided for mint IPFS image upload.")
        }

        if (!uploadedImageCid) {
          const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://buidl-app-delta.vercel.app").replace(/\/+$/, "")
          const fallbackPng = `${appBaseUrl}/buidl-pass.png`
          const fallbackRes = await fetch(fallbackPng, { redirect: "follow" })
          if (!fallbackRes.ok) {
            throw new Error("Fallback PNG fetch failed")
          }
          const bytes = await fallbackRes.arrayBuffer()
          if (bytes.byteLength === 0) {
            throw new Error("Fallback PNG is empty")
          }
          const imageName = `${tokenId}.png`
          const imageUploadRes = await uploadToIpfsWithRetry(() => {
            const formData = new FormData()
            appendProviderUploadOptions(formData)
            const blob = new Blob([bytes], { type: "image/png" })
            formData.append("file", blob, imageName)
            return formData
          })
          const imageUploadData = await imageUploadRes.json()
          uploadedImageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
          uploadedImagePath = imageName
        }

        if (!uploadedImageCid) {
          throw new Error("IPFS image upload response missing CID")
        }
        mintedBuild.ipfsImageUri = `ipfs://${uploadedImageCid}/${uploadedImagePath}`
        mintedBuild.ipfsImageGatewayUrl = `${IPFS_GATEWAY_BASE}/${uploadedImageCid}/${uploadedImagePath}`

        // 2) Upload metadata JSON that points at the image above.
        const metadata = buildMetadataFromBuild(mintedBuild)
        const metadataJson = JSON.stringify(metadata)

        const uploadRes = await uploadToIpfsWithRetry(() => {
          const formData = new FormData()
          // For Pinata keep token URI shape as ipfs://<cid>/<tokenId>.json.
          appendProviderUploadOptions(formData)
          const blob = new Blob([metadataJson], { type: "application/json" })
          formData.append("file", blob, fileName)
          return formData
        })

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json()
          const cid = uploadData.IpfsHash || uploadData.Hash
          if (cid) {
            ipfs = {
              cid,
              gatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}/${fileName}`,
            }
            mintedBuild.ipfsPending = false
            mintedBuild.ipfsCid = cid
            mintedBuild.ipfsUri = `ipfs://${cid}/${fileName}`
            mintedBuild.ipfsGatewayUrl = `${IPFS_GATEWAY_BASE}/${cid}/${fileName}`
            mintedBuild.ipfsSyncedAt = new Date().toISOString()
            mintedBuild.ipfsLastError = undefined
            mintedBuild.ipfsLastAttemptAt = mintedBuild.ipfsSyncedAt
          }
        } else {
          const errText = await uploadRes.text()
          console.warn(`AUTO_IPFS_PUSH_ON_MINT failed for token ${tokenId}: ${uploadRes.status} ${errText}`)
          mintedBuild.ipfsPending = true
          mintedBuild.ipfsLastError = `upload failed: ${uploadRes.status} ${errText}`
          mintedBuild.ipfsLastAttemptAt = new Date().toISOString()
        }
      } catch (ipfsErr) {
        console.warn(`AUTO_IPFS_PUSH_ON_MINT exception for token ${tokenId}:`, ipfsErr)
        mintedBuild.ipfsPending = true
        mintedBuild.ipfsLastError = ipfsErr instanceof Error ? ipfsErr.message : String(ipfsErr)
        mintedBuild.ipfsLastAttemptAt = new Date().toISOString()
      }
    } else if (AUTO_IPFS_PUSH_ON_MINT && !IPFS_API_TOKEN) {
      mintedBuild.ipfsPending = true
      mintedBuild.ipfsLastError = "No IPFS API token configured"
      mintedBuild.ipfsLastAttemptAt = new Date().toISOString()
    } else {
      mintedBuild.ipfsPending = false
    }

    // Persist final post-mint status including IPFS sync state.
    await safeRedisSet(rk(`build:${mintedBuild.id}`), mintedBuild)

    if (MINT_REQUIRES_IPFS_SYNC && (!ipfs || mintedBuild.ipfsPending)) {
      const detail = mintedBuild.ipfsLastError ? ` Details: ${mintedBuild.ipfsLastError}` : ""
      return NextResponse.json(
        {
          success: false,
          error: `Mint was confirmed, but IPFS metadata sync failed. Mint flow requires IPFS sync.${detail}`,
          build: mintedBuild,
          ipfs,
          requiresIpfsSync: true,
        },
        { status: 500 },
      )
    }

    const uriCheck = await verifyAndOptionallyAlignTokenURI(String(tokenId))
    let marketplacePublish: any = { ok: false, skipped: true }
    let marketplaceStatus: any = null
    if (AUTO_MARKETPLACE_PUBLISH_ON_MINT) {
      const attempt = await attemptMarketplacePublish(String(tokenId), {
        trigger: "mint",
        immediateRetryOnFailure: true,
      })
      marketplaceStatus = attempt.status
      marketplacePublish =
        attempt.publish ||
        {
          ok: false,
          queued: true,
          reason: attempt.status.lastError || "marketplace retry queued",
        }
    } else {
      marketplaceStatus = await markMarketplacePending(String(tokenId), "queued after mint", {
        nextRetryMs: 0,
      })
      marketplacePublish = {
        ok: false,
        queued: true,
        reason: "auto publish disabled; queued for cron",
      }
    }

    return NextResponse.json({
      success: true,
      build: mintedBuild,
      ipfs,
      uriCheck,
      marketplacePublish,
      marketplaceStatus,
      marketplacePublishRequired:
        AUTO_MARKETPLACE_PUBLISH_ON_MINT &&
        !(marketplaceStatus?.state === "marketplace_live" || marketplacePublish?.ok),
    })
  } catch (error: any) {
    console.error("Error saving mint data:", error)
    return NextResponse.json({ error: `Failed to save mint data: ${error?.message || "unknown error"}` }, { status: 500 })
  }
}

function normalizeBaseUri(base: string) {
  const trimmed = String(base || "").trim()
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
}

async function verifyAndOptionallyAlignTokenURI(tokenId: string) {
  const targetBase = normalizeBaseUri(BASE_TOKEN_URI_TARGET)
  if (!targetBase) {
    return {
      ok: false,
      reason: "BASE_TOKEN_URI_TARGET not configured",
    }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const readAbi = [
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function owner() view returns (address)",
  ]
  const writeAbi = ["function setBaseTokenURI(string calldata newBase)"]

  try {
    const readContract = new ethers.Contract(CONTRACTS.BUILD_NFT, readAbi, provider)
    const expectedTokenURI = `${targetBase}/${tokenId}.json`
    const currentTokenURI = await readContract.tokenURI(BigInt(tokenId))
    const isAligned = String(currentTokenURI) === expectedTokenURI

    let ownerAddress = ""
    try {
      ownerAddress = String(await readContract.owner())
    } catch {
      // ignore owner check failures in diagnostics
    }

    const out: Record<string, unknown> = {
      ok: true,
      tokenId,
      expectedTokenURI,
      currentTokenURI,
      aligned: isAligned,
      buildNFT: CONTRACTS.BUILD_NFT,
      rpc: RPC_URL,
      autoSetEnabled: AUTO_SET_BASE_TOKEN_URI_ON_MINT,
    }

    if (!isAligned && AUTO_SET_BASE_TOKEN_URI_ON_MINT && BASE_TOKEN_URI_OWNER_KEY) {
      try {
        const signer = new ethers.Wallet(BASE_TOKEN_URI_OWNER_KEY, provider)
        if (!ownerAddress || signer.address.toLowerCase() !== ownerAddress.toLowerCase()) {
          out["autoSetAttempted"] = false
          out["autoSetReason"] = "owner key is not contract owner"
          out["contractOwner"] = ownerAddress || null
          out["ownerKeyAddress"] = signer.address
          return out
        }

        const writeContract = new ethers.Contract(CONTRACTS.BUILD_NFT, writeAbi, signer)
        const tx = await writeContract.setBaseTokenURI(targetBase)
        const rc = await tx.wait()
        const updatedTokenURI = await readContract.tokenURI(BigInt(tokenId))
        out["autoSetAttempted"] = true
        out["autoSetTxHash"] = tx.hash
        out["autoSetBlock"] = rc?.blockNumber ?? null
        out["updatedTokenURI"] = updatedTokenURI
        out["alignedAfterAutoSet"] = String(updatedTokenURI) === expectedTokenURI
      } catch (setErr: any) {
        out["autoSetAttempted"] = true
        out["autoSetError"] = setErr?.shortMessage || setErr?.message || "setBaseTokenURI failed"
      }
    }

    return out
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.shortMessage || err?.message || "tokenURI check failed",
      buildNFT: CONTRACTS.BUILD_NFT,
      rpc: RPC_URL,
    }
  }
}

function buildMetadataFromBuild(build: Build) {
  const tokenId = String(build.tokenId)
  const kind = build.kind ?? 0
  const kindLabel = kind === 0 ? "Brick" : kind === 2 ? "Collectors Edition" : "Build"
  const w = build.brickWidth ?? build.baseWidth ?? 1
  const d = build.brickDepth ?? build.baseDepth ?? 1
  const density = build.density ?? 1
  const mass = build.mass ?? (w * d * density)
  const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://buidl-app-delta.vercel.app").replace(/\/+$/, "")
  const imageFromBuild = String((build as any).ipfsImageUri || "").trim()
  const imagesCid = readImagesCid()
  const normalizedName =
    build.name && String(build.name).trim().length > 0
      ? String(build.name).trim()
      : kind === 0
        ? `Brick ${Math.min(w, d)}x${Math.max(w, d)} D${density}`
        : `BUIDL ${kindLabel} #${tokenId}`

  const attributes: { trait_type: string; value: string | number }[] = [
    { trait_type: "kind", value: kindLabel },
    { trait_type: "kindId", value: kind },
    { trait_type: "mass", value: mass },
    { trait_type: "density", value: density },
  ]

  if (build.geometryHash) attributes.push({ trait_type: "geometryHash", value: build.geometryHash })
  if (build.specKey) attributes.push({ trait_type: "specKey", value: build.specKey })
  if (build.bw_score) attributes.push({ trait_type: "bw_score", value: build.bw_score })
  if (w && d) {
    attributes.push({ trait_type: "width", value: w })
    attributes.push({ trait_type: "depth", value: d })
  }

  const componentIds: number[] = []
  const componentCounts: number[] = []
  if (build.composition && typeof build.composition === "object") {
    for (const [tid, info] of Object.entries(build.composition)) {
      componentIds.push(Number(tid))
      componentCounts.push((info as any).count ?? 1)
    }
  }
  if (componentIds.length > 0) {
    attributes.push({ trait_type: "componentBuildIds", value: componentIds.join(",") })
    attributes.push({ trait_type: "componentCounts", value: componentCounts.join(",") })
  }

  return {
    name: normalizedName,
    description: `BUIDL ${kindLabel} - ${w}x${d} density ${density}`,
    image: imageFromBuild || (imagesCid ? `ipfs://${imagesCid}/${tokenId}.png` : `${appBaseUrl}/api/builds/image/${tokenId}`),
    ...(ENABLE_ANIMATION_URL ? { animation_url: buildAnimationUrl(tokenId, appBaseUrl) } : {}),
    external_url: `${appBaseUrl}/explore/${tokenId}`,
    attributes,
  }
}
