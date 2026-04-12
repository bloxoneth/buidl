import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

const redis = new Redis({
  url: (process.env.KV_REST_API_URL || "").trim(),
  token: (process.env.KV_REST_API_TOKEN || "").trim(),
})

// One-time endpoint to clear old NFT data from previous contract
// This clears all cached gallery/minted NFT data
export async function GET() {
  try {
    const results: Record<string, number> = {}
    let totalDeleted = 0

    // Delete specific keys
    const specificKeys = ["minted_tokens", "builds:public"]
    for (const key of specificKeys) {
      const deleted = await redis.del(key)
      results[key] = deleted
      totalDeleted += deleted
    }

    // Delete pattern-based keys
    const patterns = ["token:*", "build:*", "hash:*", "minted:*", "builds:*"]
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern)
      if (keys.length > 0) {
        for (const key of keys) {
          await redis.del(key)
        }
        results[pattern] = keys.length
        totalDeleted += keys.length
      } else {
        results[pattern] = 0
      }
    }

    return NextResponse.json({
      success: true,
      message: "Old NFT data cleared successfully",
      totalDeleted,
      details: results,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
