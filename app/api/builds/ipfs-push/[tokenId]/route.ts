import { type NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { redis } from "@/lib/redis"
import { rk } from "@/lib/redis-keys"
import type { Build } from "@/lib/types"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/ethblox-contracts"
import { buildAnimationUrl } from "@/lib/animation-url"

const env = (k: string) => (process.env[k] || "").trim()

const IPFS_API_TOKEN = env("PINATA_JWT") || env("LIGHTHOUSE_API_KEY")
const IPFS_UPLOAD_URL =
  env("IPFS_UPLOAD_URL") ||
  env("LIGHTHOUSE_UPLOAD_URL") ||
  "https://api.pinata.cloud/pinning/pinFileToIPFS"
const IPFS_GATEWAY_BASE = env("PINATA_GATEWAY_BASE") || "https://gateway.pinata.cloud/ipfs"
const IPFS_UPLOAD_TIMEOUT_MS = Number(env("IPFS_UPLOAD_TIMEOUT_MS") || "25000")
const IPFS_UPLOAD_RETRIES = Number(env("IPFS_UPLOAD_RETRIES") || "4")
const ADMIN_TOKEN = env("ADMIN_RESET_TOKEN")
const OWNER_AUTH_PREFIX = "BASEBLOX_IPFS_PUSH"
const ENABLE_ANIMATION_URL = env("ENABLE_ANIMATION_URL") === "1"

function isLikelyIpfsCid(v: string) {
  const s = String(v || "").trim()
  return /^(bafy[0-9a-z]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(s)
}

function readImagesCid() {
  const raw = env("NEXT_PUBLIC_IMAGES_CID") || env("IMAGES_CID")
  return isLikelyIpfsCid(raw) ? raw : ""
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
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IPFS_UPLOAD_TIMEOUT_MS)
    try {
      const uploadRes = await fetch(IPFS_UPLOAD_URL, {
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
        lastError = new Error(`IPFS upload failed: ${uploadRes.status} ${errText}`)
      } else {
        return uploadRes
      }
    } catch (err: any) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err : new Error(String(err))
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
      { error: "PINATA_JWT not configured (or LIGHTHOUSE_API_KEY fallback)." },
      { status: 500 }
    )
  }

    const metadata = await buildMetadataForToken(tokenId, request)
    if (!metadata) {
      return NextResponse.json({ error: "No app data found for token" }, { status: 404 })
  }

  try {
    // Upload token image first so metadata always points to a valid IPFS image URI.
    let imageCid = ""
    let imagePath = `${tokenId}.png`
    try {
      const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://baseblox-app.vercel.app").replace(/\/+$/, "")
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
          const imageUploadRes = await uploadWithRetry(() => {
            const formData = new FormData()
            formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
            const blob = new Blob([bytes], { type: contentType || "image/png" })
            imagePath = `${tokenId}.${ext}`
            formData.append("file", blob, imagePath)
            return formData
          })
          const imageUploadData = await imageUploadRes.json()
          imageCid = imageUploadData.IpfsHash || imageUploadData.Hash || ""
        }
      }
    } catch {
      // Fallback path below.
    }

    if (!imageCid) {
      const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN") || "https://baseblox-app.vercel.app").replace(/\/+$/, "")
      const fallbackPng = `${appBaseUrl}/baseblox-pass.png`
      const fallbackRes = await fetch(fallbackPng, { redirect: "follow" })
      if (!fallbackRes.ok) {
        return NextResponse.json({ error: "Fallback PNG fetch failed" }, { status: 502 })
      }
      const bytes = await fallbackRes.arrayBuffer()
      if (bytes.byteLength === 0) {
        return NextResponse.json({ error: "Fallback PNG is empty" }, { status: 502 })
      }
      const imageName = `${tokenId}.png`
      const imageUploadRes = await uploadWithRetry(() => {
        const formData = new FormData()
        formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
        const blob = new Blob([bytes], { type: "image/png" })
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
    metadata.image = `ipfs://${imageCid}/${imagePath}`

    // Upload metadata JSON via Pinata (or fallback-compatible endpoint)
    const metadataJson = JSON.stringify(metadata)
    const fileName = `${tokenId}.json`

    const uploadRes = await uploadWithRetry(() => {
      const formData = new FormData()
      // Keep URI shape stable as ipfs://<cid>/<tokenId>.json
      formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
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
          ipfsUri: `ipfs://${cid}/${fileName}`,
          ipfsGatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}/${fileName}`,
          ipfsImageUri: `ipfs://${imageCid}/${imagePath}`,
          ipfsImageGatewayUrl: `${IPFS_GATEWAY_BASE}/${imageCid}/${imagePath}`,
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
      gatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}/${fileName}`,
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
  if (!buildId) return null

  const build = await redis.get<Build>(rk(`build:${buildId}`))
  if (!build) return null

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
    "https://baseblox-app.vercel.app"
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
        : `BASEBLOX ${kindLabel} #${tokenId}`

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
    description: `BASEBLOX ${kindLabel} - ${w}x${d} density ${density}`,
    image: imageFromBuild || (imagesCid ? `ipfs://${imagesCid}/${tokenId}.png` : `${appBaseUrl}/api/builds/image/${tokenId}`),
    ...(ENABLE_ANIMATION_URL ? { animation_url: buildAnimationUrl(tokenId, appBaseUrl) } : {}),
    external_url: `${appBaseUrl}/explore/${tokenId}`,
    attributes,
  }
}
