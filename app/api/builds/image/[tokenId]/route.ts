import { NextResponse } from "next/server"
import { tokenImageURI } from "@/lib/contracts/buidl-contracts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function toGatewayUrls(ipfsUri: string): string[] {
  const cidPath = ipfsUri.replace(/^ipfs:\/\//, "")
  return [
    `https://gateway.pinata.cloud/ipfs/${cidPath}`,
    `https://dweb.link/ipfs/${cidPath}`,
    `https://ipfs.io/ipfs/${cidPath}`,
  ]
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), cache: "no-store" })
    return res.ok
  } catch {
    return false
  }
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

  const ipfsUri = tokenImageURI(id)
  const urls = toGatewayUrls(ipfsUri)
  for (const url of urls) {
    if (await probe(url)) {
      return NextResponse.redirect(url, { status: 302, headers: CORS_HEADERS })
    }
  }

  const requestOrigin = (() => {
    try {
      return new URL(request.url).origin
    } catch {
      return ""
    }
  })()
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_ORIGIN || requestOrigin || "https://buidl-app-delta.vercel.app").replace(
    /\/+$/,
    "",
  )
  return NextResponse.redirect(`${appBase}/buidl-pass.png`, { status: 302, headers: CORS_HEADERS })
}
