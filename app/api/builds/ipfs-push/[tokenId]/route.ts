import { type NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { redis } from "@/lib/redis"
import { rk } from "@/lib/redis-keys"
import type { Build } from "@/lib/types"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"
import { buildAnimationUrl } from "@/lib/animation-url"

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
    ? "https://upload.lighthouse.storage/api/v0/add"
    : "https://api.pinata.cloud/pinning/pinFileToIPFS")
const LIGHTHOUSE_UPLOAD_URL_FALLBACKS = [
  "https://upload.lighthouse.storage/api/v0/add",
  "https://node.lighthouse.storage/api/v0/add",
]
const IPFS_UPLOAD_URLS =
  IPFS_PROVIDER === "lighthouse"
    ? Array.from(new Set([IPFS_UPLOAD_URL, ...LIGHTHOUSE_UPLOAD_URL_FALLBACKS]))
    : [IPFS_UPLOAD_URL]
const IPFS_GATEWAY_BASE = env("IPFS_GATEWAY_BASE") || env("PINATA_GATEWAY_BASE") || (IPFS_PROVIDER === "lighthouse" ? "https://gateway.lighthouse.storage/ipfs" : "https://gateway.pinata.cloud/ipfs")
const IPFS_UPLOAD_TIMEOUT_MS = Number(env("IPFS_UPLOAD_TIMEOUT_MS") || "25000")
const IPFS_UPLOAD_RETRIES = Number(env("IPFS_UPLOAD_RETRIES") || "4")
const ADMIN_TOKEN = env("ADMIN_RESET_TOKEN")
const OWNER_AUTH_PREFIX = "BUIDL_IPFS_PUSH"
const ENABLE_ANIMATION_URL = env("ENABLE_ANIMATION_URL") === "1"

function isLikelyIpfsCid(v: string) {
  const s = String(v || "").trim()
  return /^(bafy[0-9a-z]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(s)
}

function readImagesCid() {
  const raw = env("NEXT_PUBLIC_IMAGES_CID") || env("IMAGES_CID")
  return isLikelyIpfsCid(raw) ? raw : ""
}

function appendProviderUploadOptions(formData: FormData) {
  // Pinata supports provider-specific pin options; Lighthouse ignores this field.
  if (IPFS_PROVIDER === "pinata") {
    formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
  }
}

async function authorize(request: NextRequest, tokenId: string): Promise<string | null> {
  // Admin override
  if (ADMIN_TOKEN) {
    const authHeader = request.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
    const token = bearer || request.headers.get("x-admin-token") || ""
    if (token && token === ADMIN_TOKEN) return null
  }

  // Owner signed-message auth
  const ownerAddress = (request.headers.get("x-owner-address") || "").trim()
  const ownerSignature = (request.headers.get("x-owner-signature") || "").trim()
  if (!ownerAddress || !ownerSignature) {
    return "Missing auth: provide admin token or owner signature headers"
  }

  try {
    const message = `${OWNER_AUTH_PREFIX}:${tokenId}`
    const recovered = ethers.verifyMessage(message, ownerSignature)
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return "Invalid owner signature"
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, ["function ownerOf(uint256) view returns (address)"], provider)
    const onchainOwner = String(await contract.ownerOf(BigInt(tokenId)))
    if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
      return "Signer is not current token owner"
    }
  } catch (err: any) {
    return err?.shortMessage || err?.message || "Owner authorization failed"
  }

  return null
}

async function uploadWithRetry(formDataFactory: () => FormData) {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= IPFS_UPLOAD_RETRIES; attempt++) {
    for (const uploadUrl of IPFS_UPLOAD_URLS) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IPFS_UPLOAD_TIMEOUT_MS)
      try {
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${IPFS_API_TOKEN}`,
          },
          body: formDataFactory(),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!uploadRes.ok) {
          const errText = await uploadRes.text()
          lastError = new Error(`IPFS upload failed (${uploadUrl}): ${uploadRes.status} ${errText}`)
        } else {
          return uploadRes
        }
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

// GET - Preview the metadata that would be pushed
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await context.params
  const authError = await authorize(request, tokenId)
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 })
  }

  const metadata = await buildMetadataForToken(tokenId, request)
  if (!metadata) {
    return NextResponse.json({ error: "No app data found for token" }, { status: 404 })
  }
  return NextResponse.json({ metadata, hasApiKey: !!IPFS_API_TOKEN })
}

// POST - Push metadata JSON to IPFS via Lighthouse
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await context.params
  const authError = await authorize(request, tokenId)
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 })
  }

  if (!IPFS_API_TOKEN) {
    return NextResponse.json(
      { error: "No IPFS API token configured (PINATA_JWT or LIGHTHOUSE_API_KEY)." },
      { status: 500 }
    )
  }

    const metadata = await buildMetadataForToken(tokenId, request)
    if (!metadata) {
      return NextResponse.json({ error: "No app data found for token" }, { status: 404 })
  }

  try {
    // Upload token image (server-rendered SVG from on-chain geometry) to IPFS.
    // Render SVG directly in-process (avoids HTTP self-fetch issues in dev).
    let imageCid = ""
    let imagePath = `${tokenId}.svg`
    try {
      const { renderVoxelSVG, decodeGeometryBytes } = await import("@/lib/svg-renderer")
      const { ethers } = await import("ethers")
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const registry = new ethers.Contract(
        CONTRACTS.GEOMETRY_REGISTRY,
        ["function geometryData(uint256) view returns (bytes)"],
        provider,
      )
      const geoBytes: string = await registry.geometryData(BigInt(tokenId))
      const decoded = decodeGeometryBytes(geoBytes)
      if (decoded && decoded.voxels.length > 0) {
        const svg = renderVoxelSVG(decoded.voxels, { width: 512, height: 512 })
        const svgBytes = new TextEncoder().encode(svg)
        const imageUploadRes = await uploadWithRetry(() => {
          const formData = new FormData()
          appendProviderUploadOptions(formData)
          const blob = new Blob([svgBytes], { type: "image/svg+xml" })
          formData.append("file", blob, imagePath)
          return formData
        })
        const imageUploadData = await imageUploadRes.json()
        imageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
      }
    } catch {
      // Fallback path below.
    }

    if (!imageCid) {
      // Fallback: try the old image endpoint, then placeholder PNG
      const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://buidl-app-delta.vercel.app").replace(/\/+$/, "")
      const fallbackUrl = `${appBaseUrl}/api/builds/image/${tokenId}`
      let fallbackRes = await fetch(fallbackUrl, { redirect: "follow" })
      let fallbackType = "image/png"
      if (!fallbackRes.ok) {
        fallbackRes = await fetch(`${appBaseUrl}/buidl-pass.png`, { redirect: "follow" })
      }
      if (!fallbackRes.ok) {
        return NextResponse.json({ error: "Fallback image fetch failed" }, { status: 502 })
      }
      const bytes = await fallbackRes.arrayBuffer()
      if (bytes.byteLength === 0) {
        return NextResponse.json({ error: "Fallback image is empty" }, { status: 502 })
      }
      fallbackType = fallbackRes.headers.get("content-type") || "image/png"
      const ext = fallbackType.includes("svg") ? "svg" : "png"
      const imageName = `${tokenId}.${ext}`
      const imageUploadRes = await uploadWithRetry(() => {
        const formData = new FormData()
        appendProviderUploadOptions(formData)
        const blob = new Blob([bytes], { type: fallbackType })
        formData.append("file", blob, imageName)
        return formData
      })
      const imageUploadData = await imageUploadRes.json()
      imageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
      imagePath = imageName
    }

    if (!imageCid) {
      return NextResponse.json(
        { error: "IPFS image upload response missing CID" },
        { status: 502 }
      )
    }
    metadata.image = `ipfs://${imageCid}`

    // Upload metadata JSON via Pinata (or fallback-compatible endpoint)
    const metadataJson = JSON.stringify(metadata)
    const fileName = `${tokenId}.json`

    const uploadRes = await uploadWithRetry(() => {
      const formData = new FormData()
      // For Pinata keep URI shape stable as ipfs://<cid>/<tokenId>.json.
      appendProviderUploadOptions(formData)
      const blob = new Blob([metadataJson], { type: "application/json" })
      formData.append("file", blob, fileName)
      return formData
    })

    const uploadData = await uploadRes.json()
    const cid = uploadData.IpfsHash || uploadData.Hash
    if (!cid) {
      return NextResponse.json(
        { error: `IPFS upload response missing CID: ${JSON.stringify(uploadData)}` },
        { status: 502 }
      )
    }

    const buildIdAfter = await redis.get<string>(rk(`token:${tokenId}`))
    if (buildIdAfter) {
      const build = await redis.get<Build>(rk(`build:${buildIdAfter}`))
      if (build) {
        const now = new Date().toISOString()
        const updatedBuild: Build = {
          ...build,
          ipfsPending: false,
          ipfsCid: String(cid),
          ipfsUri: `ipfs://${cid}`,
          ipfsGatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}`,
          ipfsImageUri: `ipfs://${imageCid}`,
          ipfsImageGatewayUrl: `${IPFS_GATEWAY_BASE}/${imageCid}`,
          ipfsSyncedAt: now,
          ipfsLastAttemptAt: now,
          ipfsLastError: undefined,
        }
        await redis.set(rk(`build:${buildIdAfter}`), updatedBuild)
      }
    }

    return NextResponse.json({
      success: true,
      tokenId,
      cid,
      gatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}`,
      metadata,
    })
  } catch (err: any) {
    try {
      const buildId = await redis.get<string>(rk(`token:${tokenId}`))
      if (buildId) {
        const build = await redis.get<Build>(rk(`build:${buildId}`))
        if (build) {
          await redis.set(rk(`build:${buildId}`), {
            ...build,
            ipfsPending: true,
            ipfsLastAttemptAt: new Date().toISOString(),
            ipfsLastError: err?.message || "IPFS push failed",
          } satisfies Build)
        }
      }
    } catch {
      // Do not mask root error if status update fails.
    }
    return NextResponse.json(
      { error: `IPFS push failed: ${err.message}` },
      { status: 500 }
    )
  }
}

// Build ERC-721 compliant metadata from Redis app data
async function buildMetadataForToken(tokenId: string, request?: NextRequest) {
  // Fetch build data from Redis
  const buildId = await redis.get<string>(rk(`token:${tokenId}`))
  const build = buildId ? await redis.get<Build>(rk(`build:${buildId}`)) : null

  // Fallback to on-chain data if Redis has nothing
  if (!build) {
    try {
      const { ethers } = await import("ethers")
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const nft = new ethers.Contract(CONTRACTS.BUILD_NFT, [
        "function exists(uint256) view returns (bool)",
        "function kindOf(uint256) view returns (uint8)",
        "function massOf(uint256) view returns (uint256)",
        "function geometryOf(uint256) view returns (bytes32)",
      ], provider)
      const exists = await nft.exists(BigInt(tokenId))
      if (!exists) return null
      const [kind, mass, geoHash] = await Promise.all([
        nft.kindOf(BigInt(tokenId)),
        nft.massOf(BigInt(tokenId)),
        nft.geometryOf(BigInt(tokenId)),
      ])
      const kindLabel = Number(kind) === 0 ? "Brick" : Number(kind) === 2 ? "Collectors Edition" : "Build"
      const requestOrigin = (() => { try { return request ? new URL(request.url).origin : "" } catch { return "" } })()
      const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || requestOrigin || "https://buidl-app-delta.vercel.app").replace(/\s+/g, "").replace(/\/+$/, "")
      return {
        name: `${kindLabel} #${tokenId}`,
        description: `BUIDL on-chain voxel ${kindLabel}. Geometry stored fully on-chain via SSTORE2.`,
        image: `${appBaseUrl}/api/builds/svg/${tokenId}`,
        external_url: `${appBaseUrl}/explore/${tokenId}`,
        attributes: [
          { trait_type: "kind", value: kindLabel },
          { trait_type: "mass", value: Number(mass) },
          { trait_type: "geometryHash", value: String(geoHash) },
        ],
      }
    } catch {
      return null
    }
  }

  const kind = build.kind ?? 0
  const kindLabel = kind === 0 ? "Brick" : kind === 2 ? "Collectors Edition" : "Build"
  const w = build.brickWidth ?? build.baseWidth ?? 1
  const d = build.brickDepth ?? build.baseDepth ?? 1
  const density = build.density ?? 1
  const mass = build.mass ?? (w * d * density)
  const requestOrigin = (() => {
    try {
      return request ? new URL(request.url).origin : ""
    } catch {
      return ""
    }
  })()
  const appBaseUrl = (
    env("NEXT_PUBLIC_APP_URL") ||
    env("NEXT_PUBLIC_APP_ORIGIN") ||
    requestOrigin ||
    "https://buidl-app-delta.vercel.app"
  )
    .replace(/\s+/g, "")
    .replace(/\/+$/, "")
  const imageFromBuild = String((build as any).ipfsImageUri || "").trim()
  const imagesCid = readImagesCid()
  const normalizedName =
    build.name && String(build.name).trim().length > 0
      ? String(build.name).trim()
      : kind === 0
        ? `Brick ${Math.min(w, d)}x${Math.max(w, d)} D${density}`
        : `BUIDL ${kindLabel} #${tokenId}`

  // Build attributes array
  const attributes: { trait_type: string; value: string | number }[] = [
    { trait_type: "kind", value: kindLabel },
    { trait_type: "kindId", value: kind },
    { trait_type: "mass", value: mass },
    { trait_type: "density", value: density },
  ]

  if (build.geometryHash) {
    attributes.push({ trait_type: "geometryHash", value: build.geometryHash })
  }
  if (build.specKey) {
    attributes.push({ trait_type: "specKey", value: build.specKey })
  }
  if (build.bw_score) {
    attributes.push({ trait_type: "bw_score", value: build.bw_score })
  }
  if (w && d) {
    attributes.push({ trait_type: "width", value: w })
    attributes.push({ trait_type: "depth", value: d })
  }

  // Component provenance
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
