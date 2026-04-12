import { NextRequest, NextResponse } from "next/server"
import { ethers } from "ethers"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"
import { attemptMarketplacePublish } from "@/lib/marketplace-sync"

export const runtime = "nodejs"

const OWNER_AUTH_PREFIX = "BUIDL_MARKETPLACE_PUBLISH"

async function authorizeOwner(request: NextRequest, tokenId: string): Promise<string | null> {
  const ownerAddress = (request.headers.get("x-owner-address") || "").trim()
  const ownerSignature = (request.headers.get("x-owner-signature") || "").trim()
  if (!ownerAddress || !ownerSignature) return "Missing owner authorization headers"

  try {
    const message = `${OWNER_AUTH_PREFIX}:${tokenId}`
    const recovered = ethers.verifyMessage(message, ownerSignature)
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) return "Invalid owner signature"

    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const contract = new ethers.Contract(CONTRACTS.BUILD_NFT, ["function ownerOf(uint256) view returns (address)"], provider)
    const onchainOwner = String(await contract.ownerOf(BigInt(tokenId)))
    if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
      return "Signer is not current token owner"
    }
    return null
  } catch (err: any) {
    return err?.shortMessage || err?.message || "Owner authorization failed"
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await context.params
  const authError = await authorizeOwner(request, tokenId)
  if (authError) return NextResponse.json({ success: false, error: authError }, { status: 401 })

  const parsed = Number(tokenId)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NextResponse.json({ success: false, error: "Invalid tokenId" }, { status: 400 })
  }

  const { status, publish } = await attemptMarketplacePublish(String(parsed), {
    trigger: "manual",
    immediateRetryOnFailure: true,
  })
  if (publish?.ok) {
    return NextResponse.json({ success: true, result: publish, status })
  }

  return NextResponse.json(
    {
      success: true,
      pending: true,
      message: publish?.reason || status.lastError || "Marketplace sync queued for retry",
      result: publish,
      status,
    },
    { status: 202 }
  )
}
