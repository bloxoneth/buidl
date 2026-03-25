import { NextResponse } from "next/server"
import { ethers } from "ethers"
import { redis } from "@/lib/redis"
import { rk } from "@/lib/redis-keys"
import { BUILD_NFT_ABI, CONTRACTS, RPC_URL } from "@/lib/contracts/ethblox-contracts"
import type { Build } from "@/lib/types"
import { buildAnimationUrl } from "@/lib/animation-url"
const env = (k: string) => (process.env[k] || "").trim()
const ENABLE_ANIMATION_URL = env("ENABLE_ANIMATION_URL") === "1"
const IMAGE_IPFS_GATEWAY_BASE = env("MARKETPLACE_IMAGE_GATEWAY_BASE") || "https://dweb.link/ipfs"
const MARKETPLACE_FORCE_GATEWAY = env("MARKETPLACE_FORCE_GATEWAY") === "1"

function isLikelyIpfsCid(v: string) {
  const s = String(v || "").trim()
  return /^(bafy[0-9a-z]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(s)
}

function readImagesCid() {
  const raw = env("NEXT_PUBLIC_IMAGES_CID") || env("IMAGES_CID")
  return isLikelyIpfsCid(raw) ? raw : ""
}

function toMarketplaceImageUrl(image: string) {
  const v = String(image || "").trim()
  if (!v) return v
  if (!v.startsWith("ipfs://")) return v
  if (!MARKETPLACE_FORCE_GATEWAY) return v
  const cidPath = v.slice("ipfs://".length).replace(/^\/+/, "")
  return `${IMAGE_IPFS_GATEWAY_BASE.replace(/\/+$/, "")}/${cidPath}`
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params
  const id = Number.parseInt(tokenId, 10)
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "invalid token id" }, { status: 400, headers: CORS_HEADERS })
  }

  const requestOrigin = (() => {
    try {
      return new URL(request.url).origin
    } catch {
      return ""
    }
  })()
  const appBaseUrl = (env("NEXT_PUBLIC_APP_URL") || requestOrigin || "https://baseblox-app.vercel.app").replace(
    /\/+$/,
    "",
  )

  // Fast path: serve directly from app/redis data so marketplaces don't time out.
  // This keeps metadata available even when RPCs are slow.
  try {
    const buildId = await redis.get<string>(rk(`token:${id}`))
    if (buildId) {
      const build = await redis.get<Build>(rk(`build:${buildId}`))
      if (build) {
        const kind = Number(build.kind ?? 0)
        const kindLabel = kind === 0 ? "Brick" : kind === 2 ? "Collectors Edition" : "Build"
        const width = Number(build.brickWidth ?? build.baseWidth ?? 1)
        const depth = Number(build.brickDepth ?? build.baseDepth ?? 1)
        const density = Number(build.density ?? 1)
        const mass = Number(build.mass ?? width * depth * density)
        const name =
          build.name && String(build.name).trim().length > 0
            ? String(build.name).trim()
            : kind === 0
              ? `${Math.min(width, depth)}x${Math.max(width, depth)}-D${density}`
              : `BASEBLOX ${kindLabel} #${id}`

        const attributes: Array<{ trait_type: string; value: string | number }> = [
          { trait_type: "kind", value: kindLabel },
          { trait_type: "kindId", value: kind },
          { trait_type: "mass", value: mass },
          { trait_type: "density", value: density },
        ]
        if (width > 0 && depth > 0) {
          attributes.push({ trait_type: "width", value: width })
          attributes.push({ trait_type: "depth", value: depth })
        }
        if (build.geometryHash) attributes.push({ trait_type: "geometryHash", value: String(build.geometryHash) })
        if (build.bw_score !== undefined && build.bw_score !== null) {
          attributes.push({ trait_type: "bw_score", value: Number(build.bw_score) })
        }
        if (build.composition && typeof build.composition === "object") {
          const componentIds: string[] = []
          const componentCounts: number[] = []
          for (const [tokenId, info] of Object.entries(build.composition)) {
            const count = Number((info as any)?.count ?? 0)
            if (!tokenId || !Number.isFinite(count) || count <= 0) continue
            componentIds.push(String(tokenId))
            componentCounts.push(count)
          }
          if (componentIds.length > 0) {
            attributes.push({ trait_type: "componentBuildIds", value: componentIds.join(",") })
            attributes.push({ trait_type: "componentCounts", value: componentCounts.join(",") })
          }
        }

        const imageFromBuild = String((build as any).ipfsImageUri || "").trim()
        const imagesCid = readImagesCid()
        const image = imageFromBuild || (imagesCid ? `ipfs://${imagesCid}/${id}.png` : `${appBaseUrl}/api/builds/image/${id}`)
        return NextResponse.json(
          {
            name,
            description: `BASEBLOX ${kindLabel} - ${width}x${depth} density ${density}`,
            image: toMarketplaceImageUrl(image),
            ...(ENABLE_ANIMATION_URL ? { animation_url: buildAnimationUrl(id, appBaseUrl) } : {}),
            external_url: `${appBaseUrl}/explore/${id}`,
            attributes,
          },
          { headers: CORS_HEADERS },
        )
      }
    }
  } catch {
    // Fall through to chain reads.
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const buildNft = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)

  try {
    const exists = Boolean(await buildNft.exists(id))
    if (!exists) {
      return NextResponse.json({ error: "token not found" }, { status: 404, headers: CORS_HEADERS })
    }

    // Prefer app-canonical metadata when present (captures composition, bw, custom name),
    // then fall back to chain-derived metadata.
    let build: Build | null = null
    try {
      const buildId = await redis.get<string>(rk(`token:${id}`))
      if (buildId) {
        build = await redis.get<Build>(rk(`build:${buildId}`))
      }
      // If mapped build is missing or synthetic, scan for a richer record with same tokenId.
      const mappedLooksSynthetic =
        !build ||
        (String(build.id || "").startsWith("build_backfilled_") &&
          !build.buildHash &&
          (!build.composition || Object.keys(build.composition).length === 0))
      if (mappedLooksSynthetic) {
        const keys = await redis.keys(rk("build:*"))
        for (const key of keys) {
          if (key.startsWith(rk("build:token:")) || key.startsWith(rk("build:hash:"))) continue
          const candidate = await redis.get<Build>(key)
          if (!candidate) continue
          if (String(candidate.tokenId) !== String(id)) continue
          const richer =
            !!candidate.buildHash ||
            (!!candidate.composition && Object.keys(candidate.composition).length > 0) ||
            (candidate.bricks?.length ?? 0) > 0
          if (!richer) continue
          build = candidate
          break
        }
      }
    } catch {
      build = null
    }

    const kind = Number(await buildNft.kindOf(id))
    const spec = await buildNft.brickSpecOf(id)
    const width = Number(spec.width ?? 0)
    const depth = Number(spec.depth ?? 0)
    const density = Number(spec.density ?? 0)
    const locked = (await buildNft.lockedBloxOf(id)) as bigint
    const mass = Number(locked / 10n ** 18n)
    const geometryHash = String(await buildNft.geometryOf(id))

    const kindLabel = kind === 0 ? "Brick" : kind === 2 ? "Collectors Edition" : "Build"
    const name =
      build?.name && String(build.name).trim().length > 0
        ? String(build.name).trim()
        : kind === 0
          ? `${Math.min(width, depth)}x${Math.max(width, depth)}-D${density}`
          : `BASEBLOX ${kindLabel} #${id}`

    const attributes: Array<{ trait_type: string; value: string | number }> = [
      { trait_type: "kind", value: kindLabel },
      { trait_type: "kindId", value: kind },
      { trait_type: "mass", value: mass },
      { trait_type: "density", value: density },
      { trait_type: "width", value: width },
      { trait_type: "depth", value: depth },
      { trait_type: "geometryHash", value: geometryHash },
    ]

    if (build?.bw_score !== undefined && build?.bw_score !== null) {
      attributes.push({ trait_type: "bw_score", value: Number(build.bw_score) })
    }

    if (build?.composition && typeof build.composition === "object") {
      const componentIds: string[] = []
      const componentCounts: number[] = []
      for (const [tokenId, info] of Object.entries(build.composition)) {
        const count = Number((info as any)?.count ?? 0)
        if (!tokenId || !Number.isFinite(count) || count <= 0) continue
        componentIds.push(String(tokenId))
        componentCounts.push(count)
      }
      if (componentIds.length > 0) {
        attributes.push({ trait_type: "componentBuildIds", value: componentIds.join(",") })
        attributes.push({ trait_type: "componentCounts", value: componentCounts.join(",") })
      }
    }

    const imageFromBuild = String((build as any)?.ipfsImageUri || "").trim()
    const imagesCid = readImagesCid()
    const image = imageFromBuild || (imagesCid ? `ipfs://${imagesCid}/${id}.png` : `${appBaseUrl}/api/builds/image/${id}`)

    return NextResponse.json(
      {
        name,
        description: `BASEBLOX ${kindLabel} - ${width}x${depth} density ${density}`,
        image: toMarketplaceImageUrl(image),
        ...(ENABLE_ANIMATION_URL ? { animation_url: buildAnimationUrl(id, appBaseUrl) } : {}),
        external_url: `${appBaseUrl}/explore/${id}`,
        attributes,
      },
      { headers: CORS_HEADERS },
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || "metadata error" },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}
