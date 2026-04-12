import { type NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { redis } from "@/lib/redis"
import { chainNamespace, rk, rpat } from "@/lib/redis-keys"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"
import type { Build } from "@/lib/types"
import { getMarketplaceStatus } from "@/lib/marketplace-sync"
import { verifyIpfsReachability } from "@/lib/marketplace-publish"

const env = (k: string) => (process.env[k] || "").trim()
const TOKEN_API_RECONCILE_HEALTH = (env("TOKEN_API_RECONCILE_HEALTH") || "0") === "1"
const TOKEN_API_SCAN_FALLBACK = (env("TOKEN_API_SCAN_FALLBACK") || "0") === "1"

const RESPONSE_HEADERS = {
  "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
} as const

async function reconcileMarketplaceHealth(tokenId: string, marketplace: any) {
  if (!TOKEN_API_RECONCILE_HEALTH) return marketplace
  if (!marketplace || marketplace.state !== "marketplace_live") return marketplace
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, ["function tokenURI(uint256) view returns (string)"], provider)
    const onchainTokenURI = String(await contract.tokenURI(BigInt(tokenId)))
    const verification = await verifyIpfsReachability(onchainTokenURI, 1, 0)
    if (!verification.ok) {
      return {
        ...marketplace,
        state: "failed_retrying",
        stateLabel: "Failed (retrying)",
        marketplaceLive: false,
        lastError: "On-chain tokenURI is not reachable on public gateways yet",
        tokenURI: onchainTokenURI,
        checkedGateways: verification.checkedGateways,
      }
    }
    if (marketplace.tokenURI !== onchainTokenURI) {
      return {
        ...marketplace,
        tokenURI: onchainTokenURI,
      }
    }
    return marketplace
  } catch {
    return marketplace
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ tokenId: string }> }) {
  try {
    const { tokenId } = await context.params
    const legacyPrefix = `buidl:${process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532"}:`
    const currentNs = chainNamespace()
    const useLegacyFallback = currentNs !== legacyPrefix
    const legacyKey = (key: string) => `${legacyPrefix}${key}`

    const getWithFallback = async <T,>(key: string): Promise<T | null> => {
      const primary = await redis.get<T>(rk(key))
      if (primary !== null && primary !== undefined) return primary
      if (!useLegacyFallback) return null
      const legacy = await redis.get<T>(legacyKey(key))
      return legacy ?? null
    }

    // First, try the new lookup: token:{tokenId} -> buildId
    let buildId = await getWithFallback<string>(`token:${tokenId}`)

    if (!buildId) {
      buildId = await getWithFallback<string>(`build:token:${tokenId}`)
    }

    if (buildId) {
      const buildData = await getWithFallback<Build>(`build:${buildId}`)

      if (buildData) {
        let bricks = buildData.bricks
        if (typeof bricks === "string") {
          try {
            bricks = JSON.parse(bricks)
          } catch (e) {
            bricks = []
          }
        } else if (!Array.isArray(bricks)) {
          bricks = []
        }

        const marketplaceRaw = await getMarketplaceStatus(String(tokenId), buildData)
        const marketplace = await reconcileMarketplaceHealth(String(tokenId), marketplaceRaw)
        return NextResponse.json(
          { ...buildData, bricks, tokenId: Number.parseInt(tokenId), buildId, marketplace },
          { headers: RESPONSE_HEADERS }
        )
      }
    }

    const forceScan = request.nextUrl.searchParams.get("scan") === "1"
    if (!TOKEN_API_SCAN_FALLBACK && !forceScan) {
      return NextResponse.json({ error: "Build not found for this token ID" }, { status: 404, headers: RESPONSE_HEADERS })
    }
    const allKeysPrimary = await redis.keys(rpat("build:*"))
    const allKeysLegacy = useLegacyFallback ? await redis.keys(`${legacyPrefix}build:*`) : []
    const allKeys = Array.from(new Set([...(allKeysPrimary ?? []), ...(allKeysLegacy ?? [])]))

    for (const key of allKeys) {
      // Skip lookup keys
      if (
        key.includes("build:token:") ||
        key.includes("build:hash:")
      ) continue

      const data = await redis.get<Build>(key)
      if (data && typeof data === "object") {
        // Check if this build has the matching tokenId
        if (String(data.tokenId) === String(tokenId)) {
          let bricks = data.bricks
          if (typeof bricks === "string") {
            try {
              bricks = JSON.parse(bricks)
            } catch (e) {
              bricks = []
            }
          } else if (!Array.isArray(bricks)) {
            bricks = []
          }

          const marketplaceRaw = await getMarketplaceStatus(String(tokenId), data)
          const marketplace = await reconcileMarketplaceHealth(String(tokenId), marketplaceRaw)
          return NextResponse.json({
            ...data,
            bricks,
            tokenId: Number.parseInt(tokenId),
            buildId: key.replace(rk("build:"), ""),
            marketplace,
          }, { headers: RESPONSE_HEADERS })
        }
      }
    }

    return NextResponse.json({ error: "Build not found for this token ID" }, { status: 404, headers: RESPONSE_HEADERS })
  } catch (error) {
    console.error("[v0] [TOKEN API] Error fetching build by token ID:", error)
    return NextResponse.json({ error: "Failed to fetch build" }, { status: 500, headers: RESPONSE_HEADERS })
  }
}
