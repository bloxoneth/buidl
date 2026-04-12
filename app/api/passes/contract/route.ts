import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const appUrl = new URL(req.url).origin
  const passImageIpfs = "ipfs://QmZArqmy869rKXmvBq8ZsJ8YfomHDF4tMA7ZbqqFnSkQpn"
  return NextResponse.json(
    {
      name: "BUIDL Access Pass",
      description:
        "MVP access pass for BUIDL. Holders can participate in builder access phases and claim 10,000 BLOX per pass after claims open.",
      image: passImageIpfs,
      external_link: `${appUrl}/passes`,
      seller_fee_basis_points: 0,
      fee_recipient: "0x0000000000000000000000000000000000000000",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  )
}
