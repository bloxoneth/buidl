import { NextRequest, NextResponse } from "next/server"
import { processMarketplaceRetryBatch } from "@/lib/marketplace-sync"

export const runtime = "nodejs"

const env = (k: string) => (process.env[k] || "").trim()
const CRON_ENABLED = (env("MARKETPLACE_CRON_ENABLED") || "1") === "1"

function authorized(request: NextRequest): boolean {
  const cronSecret = env("MARKETPLACE_CRON_SECRET")
  const authHeader = request.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const explicit = (request.headers.get("x-marketplace-cron-secret") || "").trim()
  const fromVercel = (request.headers.get("x-vercel-cron") || "").trim() === "1"
  const allowVercelHeader = (env("MARKETPLACE_CRON_ALLOW_VERCEL_HEADER") || "1") === "1"

  if (cronSecret) return bearer === cronSecret || explicit === cronSecret
  if (process.env.NODE_ENV !== "production") return true
  return allowVercelHeader && fromVercel
}

export async function POST(request: NextRequest) {
  if (!CRON_ENABLED) {
    return NextResponse.json({ ok: true, skipped: true, reason: "cron disabled" })
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const result = await processMarketplaceRetryBatch()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
