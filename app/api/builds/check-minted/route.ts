import { NextResponse } from "next/server"
import { redis } from "@/lib/redis"
import { rk, rpat } from "@/lib/redis-keys"
import { normalizeBrickKey } from "@/data/bricks"
import { ethers } from "ethers"
import { BUILD_NFT_ABI, CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"

// Returns a set of all minted brick specs (kind=0) from Redis
// Format: ["1x2-D1", "2x2-D1", ...] always normalized (min x max)
// This is called once on page load to cache all minted bricks client-side
export async function GET() {
  try {
    const tokenIds = await redis.smembers(rk("minted_tokens"))
    const mintedSet = new Set<string>()
    const baseBrickTokensByDensity: Record<string, string> = {}
    const brickSpecToTokenId: Record<string, string> = {}
    const importedBrickSpecs = await redis.smembers(rk("minted_brick_specs"))
    const importedBaseMap = await redis.get<Record<string, string>>(rk("minted_base_brick_tokens_by_density"))
    const brickSpecKeys = await redis.keys(rpat("brick:spec:*"))

    if (importedBrickSpecs?.length) {
      for (const key of importedBrickSpecs) mintedSet.add(key)
    }
    if (importedBaseMap) {
      for (const [dens, tokenId] of Object.entries(importedBaseMap)) {
        if (tokenId) baseBrickTokensByDensity[String(dens)] = String(tokenId)
      }
    }
    if (brickSpecKeys?.length) {
      await Promise.all(
        brickSpecKeys.map(async (key) => {
          const tokenId = await redis.get<string>(key)
          if (!tokenId) return
          const spec = key.replace(rk("brick:spec:"), "")
          brickSpecToTokenId[spec] = String(tokenId)
          mintedSet.add(spec)
        }),
      )
    }

    if (tokenIds?.length) {
      await Promise.all(
        tokenIds.map(async (tokenId) => {
          try {
            const buildId = await redis.get<string>(rk(`token:${tokenId}`))
            if (!buildId) return

            const build = await redis.get<Record<string, unknown>>(rk(`build:${buildId}`))
            if (!build) return

            // Only include kind=0 (brick NFTs)
            if (build.kind === 0 || build.kind === "0") {
              const w = Number(build.brickWidth || build.baseWidth || 1)
              const d = Number(build.brickDepth || build.baseDepth || 1)
              const dens = Number(build.density || 1)
              const spec = normalizeBrickKey(w, d, dens)
              mintedSet.add(spec)
              if (!brickSpecToTokenId[spec]) brickSpecToTokenId[spec] = String(tokenId)
              if (Math.min(w, d) === 1 && Math.max(w, d) === 1 && !baseBrickTokensByDensity[String(dens)]) {
                baseBrickTokensByDensity[String(dens)] = String(tokenId)
              }
            }
          } catch {
            // skip this token
          }
        }),
      )
    }

    // Fallback scan to cover stale/missing token->{buildId} mappings in Redis.
    // This keeps placement checks aligned with minted lists sourced elsewhere.
    const allBuildKeys = await redis.keys(rpat("build:*"))
    await Promise.all(
      allBuildKeys.map(async (key) => {
        if (key.startsWith(rk("build:token:")) || key.startsWith(rk("build:hash:"))) return
        try {
          const build = await redis.get<Record<string, unknown>>(key)
          if (!build) return
          if (!(build.kind === 0 || build.kind === "0")) return
          if (build.tokenId === undefined || build.tokenId === null || String(build.tokenId) === "") return

          const w = Number(build.brickWidth || build.baseWidth || 1)
          const d = Number(build.brickDepth || build.baseDepth || 1)
          const dens = Number(build.density || 1)
          const spec = normalizeBrickKey(w, d, dens)
          mintedSet.add(spec)
          if (!brickSpecToTokenId[spec]) brickSpecToTokenId[spec] = String(build.tokenId)
          if (Math.min(w, d) === 1 && Math.max(w, d) === 1 && !baseBrickTokensByDensity[String(dens)]) {
            baseBrickTokensByDensity[String(dens)] = String(build.tokenId)
          }
        } catch {
          // skip malformed records
        }
      }),
    )

    // Refresh mapping from on-chain truth.
    // Sequential calls to avoid public RPC rate limits.
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const scanABI = [
        "function nextTokenId() view returns (uint256)",
        "function kindOf(uint256 tokenId) view returns (uint8)",
        "function brickSpecOf(uint256 tokenId) view returns (uint8 width, uint8 depth, uint16 density)",
        "function ownerOf(uint256 tokenId) view returns (address)",
      ]
      const buildNFT = new ethers.Contract(CONTRACTS.BUILD_NFT, scanABI, provider)
      const nextTokenId = Number(await buildNFT.nextTokenId())

      for (let id = 1; id < nextTokenId; id++) {
        try {
          await buildNFT.ownerOf(id) // throws if burned/nonexistent
          const kind = Number(await buildNFT.kindOf(id))
          if (kind !== 0) continue
          const [w, d, dens] = await buildNFT.brickSpecOf(id)
          const spec = normalizeBrickKey(Number(w), Number(d), Number(dens))
          mintedSet.add(spec)
          brickSpecToTokenId[spec] = String(id)
          if (Number(w) === 1 && Number(d) === 1) {
            baseBrickTokensByDensity[String(Number(dens))] = String(id)
          }
        } catch {
          // token doesn't exist or was burned — skip
        }
      }
    } catch (chainErr) {
      console.error("Failed on-chain brick scan:", chainErr)
      // Don't prune — keep whatever Redis had
    }
    
    return NextResponse.json({ mintedBricks: [...mintedSet], baseBrickTokensByDensity, brickSpecToTokenId })
  } catch (error) {
    console.error("Failed to check minted bricks:", error)
    return NextResponse.json({ mintedBricks: [], baseBrickTokensByDensity: {}, brickSpecToTokenId: {} })
  }
}
