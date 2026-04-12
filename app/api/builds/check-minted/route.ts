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

    // Refresh mapping from on-chain truth so stale Redis records
    // cannot point a spec (e.g. 1x3-D1) to the wrong tokenId.
    // Use a minimal ABI to avoid ethers selector collisions with duplicate
    // function aliases in the full BUILD_NFT_ABI.
    const onChainVerified = new Set<string>()
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const scanABI = [
        "function nextTokenId() view returns (uint256)",
        "function kindOf(uint256 tokenId) view returns (uint8)",
        "function brickSpecOf(uint256 tokenId) view returns (uint8 width, uint8 depth, uint16 density)",
        "function ownerOf(uint256 tokenId) view returns (address)",
      ]
      const buildNFT = new ethers.Contract(CONTRACTS.BUILD_NFT, scanABI, provider)
      const nextTokenId = await buildNFT.nextTokenId()
      const chunkSize = 50n

      for (let start = 1n; start < nextTokenId; start += chunkSize) {
        const end = start + chunkSize < nextTokenId ? start + chunkSize : nextTokenId
        const ids: bigint[] = []
        for (let id = start; id < end; id++) ids.push(id)

        // Check existence via ownerOf (reverts for non-existent tokens)
        const existsResults = await Promise.allSettled(
          ids.map((id) => buildNFT.ownerOf(id))
        )
        const existingIds: bigint[] = []
        for (let i = 0; i < ids.length; i++) {
          if (existsResults[i].status === "fulfilled") existingIds.push(ids[i])
        }

        if (existingIds.length === 0) continue

        const kindResults = await Promise.allSettled(existingIds.map((id) => buildNFT.kindOf(id)))
        const brickIds: bigint[] = []
        const brickTokenIds: string[] = []

        for (let i = 0; i < existingIds.length; i++) {
          const result = kindResults[i]
          if (result.status !== "fulfilled") continue
          if (Number(result.value) !== 0) continue
          brickIds.push(existingIds[i])
          brickTokenIds.push(existingIds[i].toString())
        }

        if (brickIds.length === 0) continue

        const specResults = await Promise.allSettled(brickIds.map((id) => buildNFT.brickSpecOf(id)))
        for (let i = 0; i < specResults.length; i++) {
          const result = specResults[i]
          if (result.status !== "fulfilled") continue
          const [w, d, dens] = result.value
          const spec = normalizeBrickKey(Number(w), Number(d), Number(dens))
          mintedSet.add(spec)
          onChainVerified.add(spec)
          // On-chain truth should override any stale Redis-derived mapping.
          brickSpecToTokenId[spec] = brickTokenIds[i]
          if (Number(w) === 1 && Number(d) === 1) {
            baseBrickTokensByDensity[String(Number(dens))] = brickTokenIds[i]
          }
        }
      }

      // Prune only Redis-derived entries that were NOT verified on-chain.
      for (const [spec] of Object.entries(brickSpecToTokenId)) {
        if (!onChainVerified.has(spec)) {
          delete brickSpecToTokenId[spec]
          mintedSet.delete(spec)
        }
      }
    } catch (chainErr) {
      console.error("Failed on-chain brick scan refresh:", chainErr)
    }
    
    return NextResponse.json({ mintedBricks: [...mintedSet], baseBrickTokensByDensity, brickSpecToTokenId })
  } catch (error) {
    console.error("Failed to check minted bricks:", error)
    return NextResponse.json({ mintedBricks: [], baseBrickTokensByDensity: {}, brickSpecToTokenId: {} })
  }
}
