import { NextResponse } from "next/server"

const PASS_PRICE_ETH = "0.05"
const CLAIM_BLOX = "10000"

function asPositiveInt(value: string): number | null {
  const normalized = value.endsWith(".json") ? value.slice(0, -5) : value
  const n = Number(normalized)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

export async function GET(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const appUrl = new URL(req.url).origin
  const passImageIpfs = "ipfs://QmZArqmy869rKXmvBq8ZsJ8YfomHDF4tMA7ZbqqFnSkQpn"
  const { tokenId } = await params
  const id = asPositiveInt(tokenId)
  if (!id) {
    return NextResponse.json({ error: "invalid tokenId" }, { status: 400 })
  }

  return NextResponse.json(
    {
      name: `BUIDL Access Pass #${id}`,
      description:
        "BUIDL MVP access pass. Minted on Base Sepolia for testnet onboarding. Claims unlock 10,000 BLOX per pass after claim start.",
      image: passImageIpfs,
      external_url: `${appUrl}/passes`,
      attributes: [
        { trait_type: "collection", value: "BUIDL Access Pass" },
        { trait_type: "edition", value: id },
        { trait_type: "mint_price_eth", value: PASS_PRICE_ETH },
        { trait_type: "claim_blox", value: CLAIM_BLOX },
      ],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  )
}
