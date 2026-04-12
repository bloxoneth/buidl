import { NextResponse } from "next/server"
import { ethers } from "ethers"
import {
  CONTRACTS,
  BUILD_NFT_ABI,
  GEOMETRY_REGISTRY_ABI,
  RPC_URL,
} from "@/lib/contracts/buidl-contracts"
import { renderVoxelSVG, bricksToVoxels, decodeGeometryBytes } from "@/lib/svg-renderer"
import type { Voxel } from "@/lib/svg-renderer"

/**
 * GET /api/builds/svg/[tokenId]
 *
 * Returns a rendered SVG image for any BuildNFT token.
 * Reads geometry directly from on-chain, renders via the isometric SVG renderer.
 *
 * Query params:
 *   ?w=512&h=512  — output dimensions
 *   ?format=datauri — return data:image/svg+xml;base64,... instead of raw SVG
 *   ?test=2x4     — test mode: render a WxD brick without reading chain (dev only)
 *   ?color=6      — palette colour index for test mode (default 6 = Sand Yellow)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params
  const id = parseInt(tokenId)
  if (isNaN(id) || id < 1) {
    return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 })
  }

  const url = new URL(request.url)
  const w = parseInt(url.searchParams.get("w") ?? "512") || 512
  const h = parseInt(url.searchParams.get("h") ?? "512") || 512
  const format = url.searchParams.get("format")
  const test = url.searchParams.get("test")

  try {
    let voxels: Voxel[]

    if (test) {
      // Test mode: generate a brick from dimensions (e.g. "2x4", "1x1", "4x2x3")
      const parts = test.split("x").map(Number)
      const bw = parts[0] || 1
      const bd = parts[1] || 1
      const bh = parts[2] || 1
      const ci = parseInt(url.searchParams.get("color") ?? "6") || 6
      voxels = []
      for (let x = 0; x < bw; x++) {
        for (let z = 0; z < bd; z++) {
          for (let y = 0; y < bh; y++) {
            voxels.push({ x, y, z, colourIndex: ci })
          }
        }
      }
    } else {
      // Live mode: read geometry from chain
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const nft = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)

      const exists = await nft.exists(id)
      if (!exists) {
        return NextResponse.json({ error: "Token does not exist" }, { status: 404 })
      }

      const registry = new ethers.Contract(
        CONTRACTS.GEOMETRY_REGISTRY,
        GEOMETRY_REGISTRY_ABI,
        provider,
      )
      const geoBytes: string = await registry.geometryData(id)

      const decoded = decodeGeometryBytes(geoBytes)
      if (!decoded || decoded.voxels.length === 0) {
        return NextResponse.json({ error: "No geometry data" }, { status: 404 })
      }
      voxels = decoded.voxels
    }

    const svg = renderVoxelSVG(voxels, { width: w, height: h })

    if (format === "datauri") {
      const b64 = Buffer.from(svg).toString("base64")
      return NextResponse.json({
        svg: `data:image/svg+xml;base64,${b64}`,
        voxelCount: voxels.length,
      })
    }

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": test
          ? "no-cache"
          : "public, max-age=3600, s-maxage=86400",
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to render SVG" },
      { status: 500 },
    )
  }
}
