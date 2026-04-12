"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { ethers } from "ethers"
import Link from "next/link"
import {
  CONTRACTS,
  BUILD_NFT_ABI,
  GEOMETRY_REGISTRY_ABI,
  RPC_URL,
} from "@/lib/contracts/buidl-contracts"
import { BUIDL_PALETTE } from "@/lib/palette"
import { BuildVoxelPreview } from "./BuildVoxelPreview"

/** Decode a data:application/json;base64,... tokenURI into metadata */
function parseDataUri(uri: string): Record<string, any> | null {
  if (!uri.startsWith("data:application/json;base64,")) return null
  try {
    const json = atob(uri.slice("data:application/json;base64,".length))
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Decode 3-bit packed voxel bytes into an array of {x,y,z,colourIndex} */
function decodeGeometry(
  hex: string,
): { bboxX: number; bboxY: number; bboxZ: number; voxels: Array<{ x: number; y: number; z: number; colourIndex: number }> } | null {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex
  if (raw.length < 10) return null // minimum 5 bytes = 10 hex chars (4 header + 1 data)

  const bytes = new Uint8Array(raw.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16)
  }

  const version = bytes[0]
  if (version !== 1) return null

  const bboxX = bytes[1]
  const bboxY = bytes[2]
  const bboxZ = bytes[3]
  const totalVoxels = bboxX * bboxY * bboxZ

  const voxels: Array<{ x: number; y: number; z: number; colourIndex: number }> = []

  for (let i = 0; i < totalVoxels; i++) {
    const bitOffset = (i * 3) % 8
    const byteIndex = Math.floor((i * 3) / 8)
    let colourIndex = (bytes[4 + byteIndex] >> bitOffset) & 0x07
    // Handle bit straddle across byte boundary
    if (bitOffset > 5 && 4 + byteIndex + 1 < bytes.length) {
      colourIndex |= ((bytes[4 + byteIndex + 1] << (8 - bitOffset)) & 0x07)
    }

    if (colourIndex > 0) {
      const z = Math.floor(i / (bboxX * bboxY))
      const y = Math.floor((i % (bboxX * bboxY)) / bboxX)
      const x = i % bboxX
      voxels.push({ x, y, z, colourIndex })
    }
  }

  return { bboxX, bboxY, bboxZ, voxels }
}

/** Format bytes as hex with 0x prefix */
function formatBytes(hex: string, maxLen = 40): string {
  if (hex.length <= maxLen) return hex
  return hex.slice(0, maxLen) + "..."
}

/** Convert decoded voxels into Brick[] for BuildVoxelPreview.
 *  Falls back to synthesizing from brick spec when no geometry data exists. */
function voxelsToBricks(
  decoded: ReturnType<typeof decodeGeometry>,
  brickSpec?: { width: number; depth: number; density: number } | null,
  kind?: number,
): Array<{ color: string; position: [number, number, number]; width?: number; depth?: number }> {
  // If we have decoded voxel data, use it directly
  if (decoded && decoded.voxels.length > 0) {
    return decoded.voxels.map((v) => ({
      color: BUIDL_PALETTE[v.colourIndex]?.hex ?? "#F0F0F0",
      position: [v.x, v.y, v.z] as [number, number, number],
    }))
  }
  // Fallback: synthesize brick geometry from spec (for tokens minted without geometry data)
  if (kind === 0 && brickSpec && brickSpec.width > 0 && brickSpec.depth > 0) {
    const w = Math.min(brickSpec.width, brickSpec.depth)
    const d = Math.max(brickSpec.width, brickSpec.depth)
    return [{
      color: BUIDL_PALETTE[6]?.hex ?? "#D4B483", // Sand Yellow default for bricks
      position: [0, 0.5, 0] as [number, number, number],
      width: w,
      depth: d,
    }]
  }
  return []
}

interface OnchainData {
  tokenURI: string
  metadata: Record<string, any> | null
  geometryHex: string
  geometryDecoded: ReturnType<typeof decodeGeometry>
  kind: number
  mass: number
  geometryHash: string
  owner: string
  brickSpec: { width: number; depth: number; density: number } | null
}

export function OnchainViewerClient({ tokenId }: { tokenId: string }) {
  const [data, setData] = useState<OnchainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showData, setShowData] = useState(true)
  const [renderMode, setRenderMode] = useState<"webgl" | "html" | "svg">("webgl")

  // Convert on-chain voxels to brick format for WebGL preview (falls back to brick spec)
  const bricks = useMemo(
    () => voxelsToBricks(data?.geometryDecoded ?? null, data?.brickSpec, data?.kind),
    [data?.geometryDecoded, data?.brickSpec, data?.kind],
  )

  const fetchOnchainData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const buildNFT = new ethers.Contract(CONTRACTS.BUILD_NFT, BUILD_NFT_ABI, provider)
      const geoRegistry = new ethers.Contract(CONTRACTS.GEOMETRY_REGISTRY, GEOMETRY_REGISTRY_ABI, provider)

      const tid = BigInt(tokenId)

      const [tokenURI, kind, geometryHash, owner, geometryHex] = await Promise.all([
        buildNFT.tokenURI(tid) as Promise<string>,
        buildNFT.kindOf(tid).then(Number).catch(() => -1),
        buildNFT.geometryOf(tid).then(String).catch(() => ""),
        buildNFT.ownerOf(tid).then(String).catch(() => "unknown"),
        geoRegistry.geometryData(tid).then(String).catch(() => "0x"),
      ])

      // Parse metadata from data URI
      const metadata = parseDataUri(tokenURI)
      const mass = metadata?.mass ?? 0
      const geometryDecoded = geometryHex !== "0x" ? decodeGeometry(geometryHex) : null

      // Get brick spec if kind=0
      let brickSpec: OnchainData["brickSpec"] = null
      if (kind === 0) {
        try {
          const [w, d, density] = await buildNFT.brickSpecOf(tid)
          brickSpec = { width: Number(w), depth: Number(d), density: Number(density) }
        } catch { /* not a brick or no spec */ }
      }

      setData({
        tokenURI,
        metadata,
        geometryHex,
        geometryDecoded,
        kind,
        mass,
        geometryHash,
        owner,
        brickSpec,
      })
    } catch (err: any) {
      setError(err.message || "Failed to read on-chain data")
    } finally {
      setLoading(false)
    }
  }, [tokenId])

  useEffect(() => {
    fetchOnchainData()
  }, [fetchOnchainData])

  if (loading) {
    return (
      <main className="w-screen h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-zinc-400 text-sm animate-pulse">Reading chain data for token #{tokenId}...</div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="w-screen h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-red-400 text-sm">{error || "Token not found"}</div>
          <Link href="/explore" className="text-xs text-zinc-500 hover:text-zinc-300 underline">Back to explore</Link>
        </div>
      </main>
    )
  }

  const hasAnimation = Boolean(data.metadata?.animation_url)
  const hasSvg = Boolean(data.metadata?.image)
  const hasVoxels = bricks.length > 0
  const kindLabel = data.kind === 0 ? "BRICK" : data.kind === 1 ? "BUILD" : data.kind === 2 ? "COLLECTOR" : `KIND_${data.kind}`

  return (
    <main className="w-screen h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-[#0a0a0a] shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/explore" className="text-xs text-zinc-500 hover:text-zinc-300">&larr; explore</Link>
          <span className="text-white font-mono font-bold text-sm">{data.metadata?.name || `Token #${tokenId}`}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-900/50 text-emerald-400 border border-emerald-800">
            ON-CHAIN
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
            {kindLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Render mode tabs */}
          {hasVoxels && (
            <button
              onClick={() => setRenderMode("webgl")}
              className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${renderMode === "webgl" ? "bg-blue-700/80 text-white border-blue-500/60" : "bg-zinc-900 text-zinc-400 border-zinc-700"}`}
            >
              3D
            </button>
          )}
          {hasAnimation && (
            <button
              onClick={() => setRenderMode("html")}
              className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${renderMode === "html" ? "bg-blue-700/80 text-white border-blue-500/60" : "bg-zinc-900 text-zinc-400 border-zinc-700"}`}
            >
              html
            </button>
          )}
          {hasSvg && (
            <button
              onClick={() => setRenderMode("svg")}
              className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${renderMode === "svg" ? "bg-blue-700/80 text-white border-blue-500/60" : "bg-zinc-900 text-zinc-400 border-zinc-700"}`}
            >
              svg
            </button>
          )}
          <div className="w-px h-5 bg-zinc-700" />
          <button
            onClick={() => setShowData(!showData)}
            className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${showData ? "bg-emerald-700/80 text-white border-emerald-500/60" : "bg-zinc-900 text-zinc-400 border-zinc-700"}`}
          >
            data
          </button>
          <Link
            href={`/viewer/${tokenId}?mode=onchain`}
            className="px-2 py-1 rounded text-xs font-mono bg-zinc-900 text-zinc-400 border border-zinc-700 hover:text-white"
          >
            legacy viewer
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Renderer panel */}
        <div className={`flex-1 relative ${showData ? "" : "w-full"}`}>
          {renderMode === "webgl" && hasVoxels ? (
            <BuildVoxelPreview
              bricks={bricks}
              showStuds={data.kind === 0}
              sceneMode="marketplace"
              className="w-full h-full"
            />
          ) : renderMode === "html" && hasAnimation ? (
            <iframe
              srcDoc={(() => {
                try {
                  const b64 = (data.metadata!.animation_url as string).replace('data:text/html;base64,', '')
                  let html = atob(b64)
                  // Fix on-chain renderer: move BUIDL_GEO injection before the renderer script
                  const geoMatch = html.match(/<script>(const BUIDL_TOKEN_ID=[\s\S]*?)<\/script>\s*$/)
                  if (geoMatch) {
                    const geoScript = geoMatch[1]
                    html = html.replace(geoMatch[0], '')
                    html = html.replace('<script>', `<script>${geoScript}</script><script>`)
                  }
                  return html
                } catch { return '' }
              })()}
              title={`On-chain 3D viewer #${tokenId}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
            />
          ) : renderMode === "svg" && hasSvg ? (
            <div className="w-full h-full flex items-center justify-center p-8">
              <img
                src={data.metadata!.image}
                alt={data.metadata?.name || `Token #${tokenId}`}
                className="max-w-[400px] max-h-[400px] object-contain"
                style={{ imageRendering: "auto" }}
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500">
              No renderer data available
            </div>
          )}
        </div>

        {/* Data panel */}
        {showData && (
          <div className="w-[420px] border-l border-zinc-800 overflow-y-auto bg-[#0d0d0d] shrink-0">
            <div className="p-4 space-y-4">

              {/* Token identity */}
              <Section title="Token Identity">
                <Row label="Token ID" value={`#${tokenId}`} />
                <Row label="Owner" value={truncAddr(data.owner)} mono copyable={data.owner} />
                <Row label="Kind" value={kindLabel} />
                <Row label="Mass" value={`${data.mass} BLOX`} />
                {data.brickSpec && (
                  <Row label="Brick Spec" value={`${data.brickSpec.width}x${data.brickSpec.depth} D${data.brickSpec.density}`} />
                )}
              </Section>

              {/* Geometry */}
              <Section title="Geometry (on-chain)">
                <Row label="Geometry Hash" value={data.geometryHash.slice(0, 18) + "..."} mono copyable={data.geometryHash} />
                <Row label="Raw Bytes" value={`${(data.geometryHex.length - 2) / 2} bytes`} />
                <Row label="Hex" value={formatBytes(data.geometryHex)} mono copyable={data.geometryHex} />
                {data.geometryDecoded && (
                  <>
                    <Row label="Bounding Box" value={`${data.geometryDecoded.bboxX} x ${data.geometryDecoded.bboxY} x ${data.geometryDecoded.bboxZ}`} />
                    <Row label="Filled Voxels" value={`${data.geometryDecoded.voxels.length}`} />
                    <div className="mt-2">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Voxel Colour Distribution</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.from({ length: 7 }, (_, i) => i + 1).map(ci => {
                          const count = data.geometryDecoded!.voxels.filter(v => v.colourIndex === ci).length
                          if (count === 0) return null
                          const pal = BUIDL_PALETTE[ci]
                          return (
                            <div key={ci} className="flex items-center gap-1 text-xs text-zinc-300">
                              <div className="w-3 h-3 rounded-sm border border-zinc-700" style={{ backgroundColor: pal.hex }} />
                              <span>{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </Section>

              {/* On-chain SVG preview */}
              {hasSvg && (
                <Section title="Isometric SVG (on-chain)">
                  <div className="bg-zinc-900 rounded-lg p-4 flex items-center justify-center border border-zinc-800">
                    <img
                      src={data.metadata!.image}
                      alt="On-chain SVG"
                      className="w-48 h-48 object-contain"
                    />
                  </div>
                </Section>
              )}

              {/* Raw tokenURI metadata */}
              <Section title="tokenURI Metadata (on-chain)">
                <div className="text-[10px] text-zinc-500 mb-1">
                  Source: <code className="text-zinc-400">BuildNFT.tokenURI({tokenId})</code>
                </div>
                {data.metadata ? (
                  <pre className="text-[11px] font-mono text-zinc-400 bg-zinc-900 rounded p-3 overflow-x-auto max-h-64 border border-zinc-800 whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      {
                        ...data.metadata,
                        image: data.metadata.image ? `${data.metadata.image.slice(0, 60)}...` : undefined,
                        animation_url: data.metadata.animation_url ? `${data.metadata.animation_url.slice(0, 60)}...` : undefined,
                      },
                      null,
                      2,
                    )}
                  </pre>
                ) : (
                  <div className="text-xs text-zinc-500">Legacy token (no data URI)</div>
                )}
              </Section>

              {/* Contract addresses */}
              <Section title="Contracts">
                <Row label="BuildNFT" value={truncAddr(CONTRACTS.BUILD_NFT)} mono copyable={CONTRACTS.BUILD_NFT} />
                <Row label="GeometryRegistry" value={truncAddr(CONTRACTS.GEOMETRY_REGISTRY)} mono copyable={CONTRACTS.GEOMETRY_REGISTRY} />
                <Row label="Renderer" value={truncAddr(CONTRACTS.RENDERER)} mono copyable={CONTRACTS.RENDERER} />
                <Row label="RPC" value={RPC_URL} mono />
              </Section>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

// ── Helpers ──

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr
  return addr.slice(0, 6) + "..." + addr.slice(-4)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-2 pb-1 border-b border-zinc-800">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  copyable,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!copyable) return
    navigator.clipboard.writeText(copyable).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span
        className={`text-zinc-300 truncate text-right ${mono ? "font-mono" : ""} ${copyable ? "cursor-pointer hover:text-white" : ""}`}
        onClick={handleCopy}
        title={copyable || value}
      >
        {copied ? "Copied!" : value}
      </span>
    </div>
  )
}
