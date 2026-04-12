import { NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { attemptMarketplacePublish, processMarketplaceRetryBatch } from "@/lib/marketplace-sync"

export const runtime = "nodejs"

const OWNER_AUTH_PREFIX = "BUIDL_MARKETPLACE_RETRY"

const env = (k: string) => (process.env[k] || "").trim()

function parseTokenId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null
  const token = String(raw).trim()
  if (!/^\d+$/.test(token)) return null
  if (Number(token) <= 0) return null
  return token
}

function operatorAddressFromKey(): string | null {
  const key = env("BASE_TOKEN_URI_OWNER_KEY") || env("PRIVATE_KEY")
  if (!key) return null
  try {
    return new ethers.Wallet(key).address.toLowerCase()
  } catch {
    return null
  }
}

async function authorizeOperator(request: NextRequest, tokenId: string | null): Promise<string | null> {
  const ownerAddress = (request.headers.get("x-owner-address") || "").trim()
  const ownerSignature = (request.headers.get("x-owner-signature") || "").trim()
  if (!ownerAddress || !ownerSignature) return "Missing owner authorization headers"

  const expectedOperator = operatorAddressFromKey()
  if (!expectedOperator) {
    return "Missing BASE_TOKEN_URI_OWNER_KEY/PRIVATE_KEY for operator auth"
  }

  try {
    const message = `${OWNER_AUTH_PREFIX}:${tokenId || "RUN"}`
    const recovered = ethers.verifyMessage(message, ownerSignature).toLowerCase()
    if (recovered !== ownerAddress.toLowerCase()) return "Invalid owner signature"
    if (recovered !== expectedOperator) return "Signer is not configured marketplace operator"
    return null
  } catch (err: any) {
    return err?.shortMessage || err?.message || "Owner authorization failed"
  }
}

export async function POST(request: NextRequest) {
  let body: any = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const tokenId = parseTokenId(body?.tokenId)
  const authError = await authorizeOperator(request, tokenId)
  if (authError) return NextResponse.json({ ok: false, error: authError }, { status: 401 })

  let tokenAttempt: Awaited<ReturnType<typeof attemptMarketplacePublish>> | null = null
  if (tokenId) {
    tokenAttempt = await attemptMarketplacePublish(tokenId, {
      trigger: "manual",
      immediateRetryOnFailure: true,
    })
  }

  const batch = await processMarketplaceRetryBatch()

  return NextResponse.json({
    ok: true,
    tokenId,
    tokenAttempt,
    batch,
  })
}
