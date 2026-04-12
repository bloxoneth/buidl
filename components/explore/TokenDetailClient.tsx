"use client"

import React, { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { ethers } from "ethers"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  Box,
  FileText,
  Link2,
  AlertCircle,
  Database,
  Globe,
  Upload,
  Loader2,
  Layers,
} from "lucide-react"
import { CONTRACTS } from "@/lib/contracts/buidl-contracts"
import { useMetaMask } from "@/contexts/metamask-context"
import { registerBuildLicenseIfOwner, mintLicenseForBuild } from "@/lib/contracts/buidl-contracts"
import { BuildVoxelPreview } from "@/components/preview/BuildVoxelPreview"
import type { MarketplaceLifecycle } from "@/lib/types"

type ComponentRow = { id: string; count: number; name?: string }

function marketplaceTone(state?: MarketplaceLifecycle["state"]) {
  switch (state) {
    case "marketplace_live":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
    case "marketplace_pending":
      return "text-blue-300 bg-blue-500/10 border-blue-500/30"
    case "failed_retrying":
      return "text-amber-200 bg-amber-500/10 border-amber-500/30"
    case "ipfs_synced":
      return "text-cyan-200 bg-cyan-500/10 border-cyan-500/30"
    default:
      return "text-slate-200 bg-slate-500/15 border-slate-500/30"
  }
}

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Request failed: ${r.status}`)
  return r.json()
}

function shortenAddress(addr: string) {
  if (!addr) return ""
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function traitValue(meta: any, key: string): any {
  const attrs = Array.isArray(meta?.attributes) ? meta.attributes : []
  const hit = attrs.find((a: any) => String(a?.trait_type ?? "").toLowerCase() === key.toLowerCase())
  return hit?.value
}

function normalizeComponents(input: any): ComponentRow[] {
  const out = new Map<string, ComponentRow>()
  const put = (idRaw: unknown, countRaw: unknown, nameRaw?: unknown) => {
    const id = String(idRaw ?? "").trim()
    const count = Number(countRaw ?? 0)
    if (!/^\d+$/.test(id) || Number(id) <= 0 || count <= 0) return
    const prev = out.get(id)
    out.set(id, {
      id,
      count: (prev?.count ?? 0) + count,
      name: String(nameRaw ?? prev?.name ?? `Token #${id}`),
    })
  }

  const hasComposition = input?.composition && typeof input.composition === "object" && Object.keys(input.composition).length > 0
  const hasComponentArrays =
    Array.isArray(input?.componentBuildIds) &&
    Array.isArray(input?.componentCounts) &&
    input.componentBuildIds.length > 0 &&
    input.componentCounts.length > 0
  const traitComponentIds = traitValue(input, "componentBuildIds")
  const traitComponentCounts = traitValue(input, "componentCounts")
  const hasTraitComponents =
    typeof traitComponentIds === "string" &&
    traitComponentIds.trim().length > 0 &&
    typeof traitComponentCounts === "string" &&
    traitComponentCounts.trim().length > 0

  // Prefer a single source to avoid accidental double counting.
  if (hasComposition) {
    for (const [id, info] of Object.entries(input.composition as Record<string, any>)) {
      put(id, info?.count, info?.name)
    }
  } else if (hasComponentArrays) {
    const ids = input.componentBuildIds
    const counts = input.componentCounts
    for (let i = 0; i < Math.min(ids.length, counts.length); i++) {
      put(ids[i], counts[i])
    }
  } else if (Array.isArray(input?.components)) {
    for (const c of input.components) {
      put(c?.componentId ?? c?.id, c?.count, c?.name)
    }
  } else if (hasTraitComponents) {
    const ids = String(traitComponentIds)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
    const counts = String(traitComponentCounts)
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v))
    for (let i = 0; i < Math.min(ids.length, counts.length); i++) {
      put(ids[i], counts[i])
    }
  }

  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id))
}

function buildIpfsTraits(meta: any): Array<{ label: string; value: string | number }> {
  const out: Array<{ label: string; value: string | number }> = []
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return
    out.push({ label, value: typeof value === "number" || typeof value === "string" ? value : String(value) })
  }

  const attrs = Array.isArray(meta?.attributes) ? meta.attributes : []
  for (const attr of attrs) {
    push(String(attr?.trait_type ?? ""), attr?.value)
  }

  if (out.length === 0) {
    push("Kind", meta?.kind)
    push("Density", meta?.density)
    push("Mass", meta?.mass)
    push("Geometry Hash", meta?.geometryHash)
    if (Array.isArray(meta?.tags) && meta.tags.length > 0) {
      push("Tags", meta.tags.join(", "))
    }
  }

  return out
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="text-[hsl(var(--buidl-text-tertiary))] hover:text-[hsl(var(--buidl-text-primary))] transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-[hsl(var(--buidl-text-primary))]">
            {title}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-[hsl(var(--buidl-text-tertiary))] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 px-4 border-t border-[hsl(var(--buidl-border))]">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

/* ────────── Main component ────────── */

type ViewMode = "3d" | "svg" | "webgl"

export function TokenDetailClient({ tokenId }: { tokenId: string }) {
  const [loadTruth, setLoadTruth] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("3d")
  const [licenseActionLoading, setLicenseActionLoading] = useState<"register" | "buy" | null>(null)
  const [licenseActionError, setLicenseActionError] = useState<string | null>(null)
  const explorerBase = process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "https://sepolia.basescan.org"
  const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME ?? "Base Sepolia"
  const { account, isConnected, connect, switchChain } = useMetaMask()

  // Defer chain/IPFS fetch slightly so Redis-backed app data paints first.
  React.useEffect(() => {
    const t = setTimeout(() => setLoadTruth(true), 80)
    return () => clearTimeout(t)
  }, [])

  const { data: onchainData, isLoading: onchainLoading } = useSWR(
    loadTruth ? `/api/builds/onchain/${tokenId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { data: appData, isLoading: appLoading } = useSWR(
    `/api/builds/token/${tokenId}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { data: licenseData, mutate: mutateLicenseData } = useSWR(
    `/api/licenses/build/${tokenId}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const isLoading = appLoading && onchainLoading && !appData
  const basescanURL = `${explorerBase}/token/${CONTRACTS.BUILD_NFT}?a=${tokenId}`
  const previewBricks = appData?.bricks && appData.bricks.length > 0 ? appData.bricks : undefined
  const previewHash = appData?.geometryHash || appData?.buildHash || onchainData?.onchain?.geometryHash || ""

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 max-w-[1200px]">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="lg:w-[480px] flex-shrink-0">
            <div className="aspect-square rounded-xl bg-[hsl(var(--buidl-surface))] animate-pulse" />
          </div>
          <div className="flex-1 space-y-4">
            <div className="h-8 w-48 rounded bg-[hsl(var(--buidl-surface))] animate-pulse" />
            <div className="h-6 w-32 rounded bg-[hsl(var(--buidl-surface))] animate-pulse" />
            <div className="h-40 rounded-xl bg-[hsl(var(--buidl-surface))] animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  const onchain = onchainData?.onchain
  const ipfsMetadata = onchainData?.ipfsMetadata
  const ipfsURL = onchainData?.ipfsURL
  const errors = onchainData?.errors
  const appComponents = normalizeComponents(appData)
  const ipfsComponents = normalizeComponents(ipfsMetadata)
  const ipfsTraits = buildIpfsTraits(ipfsMetadata)
  const appKind = appData?.kind
  const ipfsKind = ipfsMetadata?.kind ?? traitValue(ipfsMetadata, "kind") ?? onchain?.kind
  const appDensity = appData?.density
  const ipfsDensity = ipfsMetadata?.density ?? traitValue(ipfsMetadata, "density")
  const appMass = appData?.mass
  const ipfsMass = ipfsMetadata?.mass ?? traitValue(ipfsMetadata, "mass")
  const appGeom = appData?.geometryHash || appData?.buildHash || ""
  const ipfsGeom = ipfsMetadata?.geometryHash ?? traitValue(ipfsMetadata, "geometryHash") ?? onchain?.geometryHash ?? ""
  const appCompSig = appComponents.map((c) => `${c.id}x${c.count}`).join(",")
  const ipfsCompSig = ipfsComponents.map((c) => `${c.id}x${c.count}`).join(",")
  const chainKind = typeof onchain?.kind === "number" ? onchain.kind : undefined
  const chainDensity = Number(onchain?.brickSpec?.density ?? NaN)
  const chainMass =
    typeof onchain?.lockedBlox === "string" && onchain.lockedBlox
      ? Number(ethers.formatUnits(BigInt(onchain.lockedBlox), 18))
      : undefined
  const chainGeom =
    typeof onchain?.geometryHash === "string" && onchain.geometryHash !== ethers.ZeroHash
      ? onchain.geometryHash
      : undefined
  const compareKind = chainKind ?? ipfsKind
  const compareDensity = Number.isFinite(chainDensity) ? chainDensity : ipfsDensity
  const compareMass = Number.isFinite(chainMass as number) ? chainMass : ipfsMass
  const compareGeom = chainGeom ?? ipfsGeom
  const canonicalCompSig = ipfsCompSig || "(none)"
  const compareTraits = ipfsTraits.filter((t) => {
    const k = String(t.label || "").trim().toLowerCase()
    return !["kind", "density", "mass", "geometry hash", "geometryhash", "width", "depth"].includes(k)
  })

  const name = appData?.name || ipfsMetadata?.name || onchain?.name || `Build #${tokenId}`
  const description = ipfsMetadata?.description || null
  const kindRaw = typeof onchain?.kind === "number" ? onchain.kind : appData?.kind
  const kindLabel = kindRaw === 0 ? "Brick" : kindRaw > 0 ? "Build" : "--"
  const marketplace = appData?.marketplace as MarketplaceLifecycle | undefined
  const tokenExistsOnchain = onchain?.exists !== false
  const tokenMissing = Boolean(onchainData && !onchainLoading && !tokenExistsOnchain)

  const handleRegisterLicense = async () => {
    try {
      setLicenseActionError(null)
      setLicenseActionLoading("register")
      if (!isConnected) await connect()
      await switchChain(CONTRACTS.BASE_SEPOLIA_CHAIN_ID)
      const ethereum = (window as any).ethereum
      const provider = new ethers.BrowserProvider(ethereum)
      await registerBuildLicenseIfOwner(provider, BigInt(tokenId))
      await mutateLicenseData()
    } catch (error: any) {
      setLicenseActionError(error?.message || "Failed to register license")
    } finally {
      setLicenseActionLoading(null)
    }
  }

  const handleBuyLicense = async () => {
    try {
      setLicenseActionError(null)
      setLicenseActionLoading("buy")
      if (!isConnected) await connect()
      await switchChain(CONTRACTS.BASE_SEPOLIA_CHAIN_ID)
      const ethereum = (window as any).ethereum
      const provider = new ethers.BrowserProvider(ethereum)
      const tx = await mintLicenseForBuild(provider, BigInt(tokenId), 1n)
      await tx.wait()
      await mutateLicenseData()
    } catch (error: any) {
      setLicenseActionError(error?.message || "Failed to buy license")
    } finally {
      setLicenseActionLoading(null)
    }
  }

  if (tokenMissing) {
    return (
      <div className="container mx-auto px-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <Link href="/explore">
            <Button variant="ghost" className="text-[hsl(var(--buidl-text-secondary))] bg-transparent hover:text-[hsl(var(--buidl-text-primary))]">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <Card className="bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))]">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 text-[hsl(var(--buidl-yellow))]" />
              <div>
                <h1 className="text-lg font-semibold text-[hsl(var(--buidl-text-primary))]">Token #{tokenId} is missing</h1>
                <p className="text-sm text-[hsl(var(--buidl-text-secondary))] mt-1">
                  This token ID does not exist on chain.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 max-w-[1200px]">
      {/* Back row */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/explore">
          <Button variant="ghost" className="text-[hsl(var(--buidl-text-secondary))] bg-transparent hover:text-[hsl(var(--buidl-text-primary))]">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: Image */}
        <div className="lg:w-[480px] flex-shrink-0">
          <div className="sticky top-24 space-y-4">
            <Card className="bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))] overflow-hidden">
              {/* View mode tabs */}
              <div className="flex border-b border-[hsl(var(--buidl-border))]">
                {(["3d", "svg", "webgl"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      viewMode === mode
                        ? "text-[hsl(var(--buidl-accent-cyan))] border-b-2 border-[hsl(var(--buidl-accent-cyan))]"
                        : "text-[hsl(var(--buidl-text-tertiary))] hover:text-[hsl(var(--buidl-text-secondary))]"
                    }`}
                  >
                    {mode === "3d" ? "Three.js" : mode === "svg" ? "SVG" : "On-chain WebGL"}
                  </button>
                ))}
              </div>
              <div className="aspect-square flex items-center justify-center bg-[hsl(var(--buidl-bg))] relative">
                {viewMode === "3d" && (
                  <BuildVoxelPreview
                    bricks={previewBricks}
                    geometryHash={previewHash}
                    tokenId={tokenId}
                    transparentBricks={kindRaw === 0}
                    showStuds={kindRaw === 0}
                    className="h-full w-full"
                  />
                )}
                {viewMode === "svg" && (
                  <img
                    src={`/api/builds/svg/${tokenId}`}
                    alt={`Token ${tokenId} rendered SVG`}
                    className="w-full h-full object-contain"
                  />
                )}
                {viewMode === "webgl" && (
                  ipfsMetadata?.animation_url ? (
                    <iframe
                      srcDoc={(() => {
                        try {
                          const b64 = (ipfsMetadata.animation_url as string).replace('data:text/html;base64,', '')
                          let html = atob(b64)
                          // Fix on-chain renderer: the BUIDL_GEO injection is placed after </html>,
                          // but the renderer script checks for it synchronously. Move the injection
                          // before the renderer <script> so BUIDL_GEO is defined when the renderer runs.
                          const geoMatch = html.match(/<script>(const BUIDL_TOKEN_ID=[\s\S]*?)<\/script>\s*$/)
                          if (geoMatch) {
                            const geoScript = geoMatch[1]
                            // Remove trailing injection
                            html = html.replace(geoMatch[0], '')
                            // Insert before the first <script> in <body>
                            html = html.replace('<script>', `<script>${geoScript}</script><script>`)
                          }
                          return html
                        } catch { return '' }
                      })()}
                      sandbox="allow-scripts"
                      className="w-full h-full border-0"
                      title={`Token ${tokenId} on-chain WebGL`}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      {(onchainLoading || !onchainData) && <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--buidl-text-tertiary))]" />}
                      <p className="text-xs text-[hsl(var(--buidl-text-tertiary))]">
                        {(onchainLoading || !onchainData) ? "Loading on-chain data from Base mainnet..." : "No on-chain WebGL available"}
                      </p>
                    </div>
                  )
                )}
              </div>
            </Card>

            {description && (
              <CollapsibleSection
                title="Description"
                icon={<FileText className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
                defaultOpen
              >
                <p className="text-sm text-[hsl(var(--buidl-text-secondary))] leading-relaxed mt-3">
                  {description}
                </p>
              </CollapsibleSection>
            )}
          </div>
        </div>

        {/* Right: Details */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header */}
          <div>
            <Link
              href={`${explorerBase}/address/${CONTRACTS.BUILD_NFT}`}
              target="_blank"
              className="text-sm text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
            >
              BUIDL BuildNFT
              <ExternalLink className="h-3 w-3" />
            </Link>
            <h1 className="text-2xl font-bold text-[hsl(var(--buidl-text-primary))] mt-1">
              {name}
            </h1>
            <p className="text-xs text-[hsl(var(--buidl-text-tertiary))] mt-1 font-mono">
              {onchainLoading ? "Showing app cache, syncing chain + IPFS..." : "Data from app + chain + IPFS"}
            </p>
          </div>

          {/* Owner */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[hsl(var(--buidl-text-tertiary))]">Owned by</span>
            {onchain?.owner ? (
              <Link
                href={`${explorerBase}/address/${onchain.owner}`}
                target="_blank"
                className="text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
              >
                {shortenAddress(onchain.owner)}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : appData?.creator ? (
              <Link
                href={`${explorerBase}/address/${appData.creator}`}
                target="_blank"
                className="text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
              >
                {shortenAddress(appData.creator)}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span className="text-[hsl(var(--buidl-text-secondary))]">Unknown</span>
            )}
          </div>

          {marketplace ? (
            <Card className="bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))]">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-[hsl(var(--buidl-text-tertiary))]">
                    Marketplace Status
                  </p>
                  <span className={`text-xs px-2 py-1 rounded border ${marketplaceTone(marketplace.state)}`}>
                    {marketplace.stateLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-[hsl(var(--buidl-text-secondary))]">
                  <span>Onchain minted: {marketplace.onchainMinted ? "Yes" : "No"}</span>
                  <span>IPFS synced: {marketplace.ipfsSynced ? "Yes" : "No"}</span>
                  <span>Retry count: {marketplace.retryCount}</span>
                  <span>Marketplace live: {marketplace.marketplaceLive ? "Yes" : "No"}</span>
                </div>
                {marketplace.nextRetryAt ? (
                  <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">
                    Next retry: {new Date(marketplace.nextRetryAt).toLocaleString()}
                  </p>
                ) : null}
                {marketplace.lastError ? (
                  <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    {marketplace.lastError}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* ─── ON-CHAIN VIEW ─── */}
          {(appData || ipfsMetadata) && (
            <CollapsibleSection
              title="App vs Canonical Compare"
              icon={<Database className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
              defaultOpen
            >
              <div className="space-y-2 mt-3 text-xs">
                <CompareRow label="Name" appValue={appData?.name} ipfsValue={ipfsMetadata?.name} />
                <CompareRow label="Kind" appValue={appKind} ipfsValue={compareKind} />
                <CompareRow label="Density" appValue={appDensity} ipfsValue={compareDensity} />
                <CompareRow label="Mass" appValue={appMass} ipfsValue={compareMass} />
                <CompareRow label="Geometry Hash" appValue={appGeom} ipfsValue={compareGeom} mono />
                <CompareRow label="Components" appValue={appCompSig || "(none)"} ipfsValue={canonicalCompSig} mono />
              </div>
            </CollapsibleSection>
          )}

          <>
              {/* Properties from chain + IPFS */}
              {(onchain?.brickSpec || ipfsTraits.length > 0) && (
                <CollapsibleSection
                  title="Properties"
                  icon={<Box className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
                  defaultOpen
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                    <TraitCard label="Kind" value={kindLabel} />
                    {onchain?.brickSpec && (
                      <>
                        <TraitCard label="Width" value={onchain.brickSpec.width} />
                        <TraitCard label="Depth" value={onchain.brickSpec.depth} />
                        <TraitCard label="Density" value={onchain.brickSpec.density} />
                      </>
                    )}
                    {onchain?.lockedBlox && onchain.lockedBlox !== "0" && (
                      <TraitCard label="Locked BLOX" value={Number(ethers.formatUnits(BigInt(onchain.lockedBlox), 18))} />
                    )}
                    {compareTraits.map((t) => (
                      <TraitCard key={`${t.label}:${String(t.value)}`} label={t.label} value={t.value} />
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Contract details */}
              {(kindRaw === 0 || appData?.kind === 0) && (
                <CollapsibleSection
                  title="License Market"
                  icon={<Layers className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
                  defaultOpen
                >
                  <div className="space-y-3 mt-3">
                    <DetailRow label="Registered">
                      <span className="text-xs text-[hsl(var(--buidl-text-primary))]">
                        {licenseData?.isRegistered ? "Yes" : "No"}
                      </span>
                    </DetailRow>
                    <DetailRow label="License ID">
                      <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))]">
                        {licenseData?.licenseId ?? "--"}
                      </span>
                    </DetailRow>
                    <DetailRow label="Current Price">
                      <span className="text-xs text-[hsl(var(--buidl-text-primary))]">
                        {licenseData?.nextUnitPriceBlox
                          ? `${Number(licenseData.nextUnitPriceBlox).toFixed(6)} BLOX`
                          : "--"}
                      </span>
                    </DetailRow>
                    <DetailRow label="Minted / Max">
                      <span className="text-xs text-[hsl(var(--buidl-text-primary))]">
                        {licenseData?.mintedSupply ?? "--"} / {licenseData?.maxSupply ?? "--"}
                      </span>
                    </DetailRow>
                    <DetailRow label="Used In Builds">
                      <span className="text-xs text-[hsl(var(--buidl-text-primary))]">
                        {licenseData?.usedInBuilds ?? 0}
                      </span>
                    </DetailRow>
                    <DetailRow label="24h Curve Move">
                      <span className="text-xs text-[hsl(var(--buidl-text-primary))]">
                        {typeof licenseData?.curve?.price24hChangePct === "number"
                          ? `${licenseData.curve.price24hChangePct >= 0 ? "+" : ""}${licenseData.curve.price24hChangePct.toFixed(2)}%`
                          : "--"}
                      </span>
                    </DetailRow>
                    <DetailRow label="OpenSea">
                      {licenseData?.os?.assetUrl ? (
                        <Link
                          href={licenseData.os.assetUrl}
                          target="_blank"
                          className="text-xs text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
                        >
                          View asset <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-xs text-[hsl(var(--buidl-text-secondary))]">Not configured</span>
                      )}
                    </DetailRow>
                    <DetailRow label="Latest Sale">
                      <span className="text-xs text-[hsl(var(--buidl-text-secondary))]">
                        {licenseData?.os?.latestSalePrice ?? "Coming soon"}
                      </span>
                    </DetailRow>
                    {licenseActionError && (
                      <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                        {licenseActionError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRegisterLicense}
                        disabled={licenseActionLoading !== null || Boolean(licenseData?.isRegistered)}
                      >
                        {licenseActionLoading === "register" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Register License
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleBuyLicense}
                        disabled={licenseActionLoading !== null || !licenseData?.isRegistered}
                        className="bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green)/0.9)]"
                      >
                        {licenseActionLoading === "buy" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Buy License
                      </Button>
                    </div>
                  </div>
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="Details"
                icon={<Database className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
                defaultOpen
              >
                <div className="space-y-3 mt-3">
                  <DetailRow label="Contract Address">
                    <Link href={`${explorerBase}/address/${CONTRACTS.BUILD_NFT}`} target="_blank"
                      className="text-[hsl(var(--buidl-accent-cyan))] hover:underline text-xs font-mono flex items-center gap-1">
                      {shortenAddress(CONTRACTS.BUILD_NFT)}<ExternalLink className="h-3 w-3" />
                    </Link>
                  </DetailRow>
                  <DetailRow label="Token ID">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))]">{tokenId}</span>
                      <CopyButton text={tokenId} />
                    </div>
                  </DetailRow>
                  <DetailRow label="Chain"><span className="text-xs text-[hsl(var(--buidl-text-primary))]">{networkName}</span></DetailRow>
                  <DetailRow label="Token Standard"><span className="text-xs text-[hsl(var(--buidl-text-primary))]">ERC-721</span></DetailRow>
                  {onchain?.geometryHash && (
                    <DetailRow label="Geometry Hash">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))] truncate max-w-[200px]">{onchain.geometryHash}</span>
                        <CopyButton text={onchain.geometryHash} />
                      </div>
                    </DetailRow>
                  )}
                  {onchain?.tokenURI && (
                    <DetailRow label="Token URI">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))] truncate max-w-[200px]">{onchain.tokenURI}</span>
                        <CopyButton text={onchain.tokenURI} />
                      </div>
                    </DetailRow>
                  )}
                </div>
              </CollapsibleSection>

              {/* Data Sources */}
              <CollapsibleSection title="Data Sources" icon={<Globe className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}>
                <div className="space-y-3 mt-3">
                  <DetailRow label="On-chain RPC"><span className="text-xs font-mono text-[hsl(var(--buidl-text-secondary))]">sepolia.base.org</span></DetailRow>
                  {ipfsURL && (
                    <DetailRow label="IPFS Metadata">
                      <Link href={ipfsURL} target="_blank" className="text-xs font-mono text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1">
                        View JSON<ExternalLink className="h-3 w-3" />
                      </Link>
                    </DetailRow>
                  )}
                  <DetailRow label="BaseScan">
                    <Link href={basescanURL} target="_blank" className="text-xs text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1">
                      View on BaseScan<ExternalLink className="h-3 w-3" />
                    </Link>
                  </DetailRow>
                </div>
              </CollapsibleSection>

              {/* Warnings */}
              {errors && errors.length > 0 && (
                <CollapsibleSection title={`Warnings (${errors.length})`} icon={<AlertCircle className="h-4 w-4 text-[hsl(var(--buidl-yellow))]" />}>
                  <ul className="space-y-1.5 mt-3">
                    {errors.map((err: string, i: number) => (
                      <li key={i} className="text-xs font-mono text-[hsl(var(--buidl-yellow))] bg-[hsl(var(--buidl-yellow)/0.1)] px-3 py-2 rounded">{err}</li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}

              {/* Raw JSON */}
              <CollapsibleSection title="Raw On-chain Data" icon={<Link2 className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}>
                <pre className="mt-3 text-xs font-mono text-[hsl(var(--buidl-text-secondary))] bg-[hsl(var(--buidl-bg))] p-4 rounded-lg overflow-x-auto max-h-[400px] overflow-y-auto">
                  {JSON.stringify(onchain, null, 2)}
                </pre>
              </CollapsibleSection>

              {ipfsMetadata && (
                <CollapsibleSection title="Raw IPFS Metadata" icon={<Link2 className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}>
                  <pre className="mt-3 text-xs font-mono text-[hsl(var(--buidl-text-secondary))] bg-[hsl(var(--buidl-bg))] p-4 rounded-lg overflow-x-auto max-h-[400px] overflow-y-auto">
                    {JSON.stringify(ipfsMetadata, null, 2)}
                  </pre>
                </CollapsibleSection>
              )}
          </>

          {/* ─── IPFS PUSH ─── */}
          <IPFSPushSection tokenId={tokenId} />
        </div>
      </div>
    </div>
  )
}

/* ────────── IPFS Push Section ────────── */

function IPFSPushSection({ tokenId }: { tokenId: string }) {
  const { account, isConnected, connect } = useMetaMask()
  const [pushing, setPushing] = useState(false)
  const [publishingMarketplace, setPublishingMarketplace] = useState(false)
  const [forcingRetryWorker, setForcingRetryWorker] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [marketplaceResult, setMarketplaceResult] = useState<any>(null)
  const [retryWorkerResult, setRetryWorkerResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [syncResult, setSyncResult] = useState<any>(null)

  const signedHeaders = async (
    prefix: "BUIDL_IPFS_PUSH" | "BUIDL_SYNC" | "BUIDL_MARKETPLACE_PUBLISH" | "BUIDL_MARKETPLACE_RETRY"
  ) => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      throw new Error("Wallet provider not available")
    }
    const provider = new ethers.BrowserProvider((window as any).ethereum)
    await provider.send("eth_requestAccounts", [])
    const signer = await provider.getSigner()
    const signerAddress = await signer.getAddress()
    if (account && signerAddress.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Wallet account mismatch. Reconnect wallet and retry.")
    }
    const message = `${prefix}:${tokenId}`
    const signature = await signer.signMessage(message)
    return {
      "x-owner-address": signerAddress,
      "x-owner-signature": signature,
    }
  }

  const handlePreview = async () => {
    setError(null)
    try {
      if (!isConnected) {
        await connect()
      }
      const headers = await signedHeaders("BUIDL_IPFS_PUSH")
      const res = await fetch(`/api/builds/ipfs-push/${tokenId}`, { headers })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setPreview(data)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handlePush = async () => {
    setPushing(true)
    setError(null)
    setResult(null)
    setMarketplaceResult(null)
    try {
      if (!isConnected) {
        await connect()
      }
      const headers = await signedHeaders("BUIDL_IPFS_PUSH")
      const res = await fetch(`/api/builds/ipfs-push/${tokenId}`, { method: "POST", headers })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPushing(false)
    }
  }

  const handlePublishMarketplace = async () => {
    setPublishingMarketplace(true)
    setError(null)
    setMarketplaceResult(null)
    try {
      if (!isConnected) {
        await connect()
      }
      const headers = await signedHeaders("BUIDL_MARKETPLACE_PUBLISH")
      const res = await fetch(`/api/builds/marketplace-publish/${tokenId}`, {
        method: "POST",
        headers,
      })
      const data = await res.json()
      if (data.success === false || data.error) {
        setError(data.error || "Marketplace publish failed")
      } else {
        setMarketplaceResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPublishingMarketplace(false)
    }
  }

  const handleForceRetryWorker = async () => {
    setForcingRetryWorker(true)
    setError(null)
    setRetryWorkerResult(null)
    try {
      if (!isConnected) {
        await connect()
      }
      const headers = await signedHeaders("BUIDL_MARKETPLACE_RETRY")
      const res = await fetch("/api/builds/marketplace-retry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ tokenId }),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false || data.error) {
        setError(data.error || "Retry worker failed")
      } else {
        setRetryWorkerResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setForcingRetryWorker(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      if (!isConnected) {
        await connect()
      }
      const headers = await signedHeaders("BUIDL_SYNC")
      const res = await fetch(`/api/builds/sync/${tokenId}`, { method: "POST", headers })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setSyncResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <CollapsibleSection
      title="IPFS Metadata"
      icon={<Upload className="h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />}
    >
      <div className="space-y-3 mt-3">
        <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">
          Generate and push ERC-721 metadata JSON to IPFS via Pinata for this token.
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            className="text-xs bg-transparent"
          >
            Preview Metadata
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="text-xs bg-transparent"
          >
            {syncing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Syncing...
              </>
            ) : (
              "Sync Redis"
            )}
          </Button>
          <Button
            size="sm"
            onClick={handlePush}
            disabled={pushing}
            className="text-xs bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green)/0.9)]"
          >
            {pushing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <Upload className="h-3 w-3 mr-1.5" />
                Push to IPFS
              </>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handlePublishMarketplace}
            disabled={publishingMarketplace}
            className="text-xs bg-[hsl(var(--buidl-blue))] text-white hover:opacity-90"
          >
            {publishingMarketplace ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Publishing...
              </>
            ) : (
              "Push to Marketplaces"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleForceRetryWorker}
            disabled={forcingRetryWorker}
            className="text-xs bg-transparent"
          >
            {forcingRetryWorker ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Running Retry...
              </>
            ) : (
              "Force Retry Worker"
            )}
          </Button>
        </div>

        {error && (
          <div className="text-xs font-mono text-red-400 bg-red-400/10 px-3 py-2 rounded">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div className="text-xs font-mono text-[hsl(var(--buidl-green))] bg-[hsl(var(--buidl-green)/0.1)] px-3 py-2 rounded">
              Pushed successfully!
            </div>
            <DetailRow label="CID">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))] truncate max-w-[200px]">{result.cid}</span>
                <CopyButton text={result.cid} />
              </div>
            </DetailRow>
            <DetailRow label="Gateway">
              <a
                href={result.gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
              >
                View on IPFS<ExternalLink className="h-3 w-3" />
              </a>
            </DetailRow>
          </div>
        )}

        {syncResult && (
          <div className="text-xs font-mono text-[hsl(var(--buidl-accent-cyan))] bg-[hsl(var(--buidl-accent-cyan)/0.1)] px-3 py-2 rounded">
            Redis synced for token #{tokenId}
          </div>
        )}

        {marketplaceResult?.success && marketplaceResult?.pending && (
          <div className="space-y-2">
            <div className="text-xs font-mono text-amber-200 bg-amber-500/10 px-3 py-2 rounded border border-amber-500/30">
              Marketplace sync queued for background retry.
            </div>
            {marketplaceResult?.message ? (
              <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">{marketplaceResult.message}</p>
            ) : null}
          </div>
        )}

        {marketplaceResult?.success && !marketplaceResult?.pending && (
          <div className="space-y-2">
            <div className="text-xs font-mono text-[hsl(var(--buidl-green))] bg-[hsl(var(--buidl-green)/0.1)] px-3 py-2 rounded">
              Marketplace publish completed.
            </div>
            {marketplaceResult?.result?.baseUri ? (
              <DetailRow label="Base URI">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-[hsl(var(--buidl-text-primary))] truncate max-w-[260px]">
                    {marketplaceResult.result.baseUri}
                  </span>
                  <CopyButton text={marketplaceResult.result.baseUri} />
                </div>
              </DetailRow>
            ) : null}
            {marketplaceResult?.result?.setBaseTxHash ? (
              <DetailRow label="Set Base Tx">
                <a
                  href={`https://sepolia.basescan.org/tx/${marketplaceResult.result.setBaseTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[hsl(var(--buidl-accent-cyan))] hover:underline flex items-center gap-1"
                >
                  {marketplaceResult.result.setBaseTxHash.slice(0, 12)}...
                  <ExternalLink className="h-3 w-3" />
                </a>
              </DetailRow>
            ) : null}
          </div>
        )}

        {retryWorkerResult?.ok && retryWorkerResult?.batch ? (
          <div className="space-y-2">
            <div className="text-xs font-mono text-[hsl(var(--buidl-accent-cyan))] bg-[hsl(var(--buidl-accent-cyan)/0.1)] px-3 py-2 rounded">
              Retry worker ran now.
            </div>
            <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">
              Processed {Number(retryWorkerResult.batch.processed || 0)} · Success {Number(retryWorkerResult.batch.successes || 0)} · Failed {Number(retryWorkerResult.batch.failures || 0)} · Skipped {Number(retryWorkerResult.batch.skipped || 0)}
            </p>
          </div>
        ) : null}

        {preview && (
          <pre className="text-xs font-mono text-[hsl(var(--buidl-text-secondary))] bg-[hsl(var(--buidl-bg))] p-4 rounded-lg overflow-x-auto max-h-[300px] overflow-y-auto">
            {JSON.stringify(preview.metadata, null, 2)}
          </pre>
        )}
      </div>
    </CollapsibleSection>
  )
}

function CompareRow({
  label,
  appValue,
  ipfsValue,
  mono = false,
}: {
  label: string
  appValue: unknown
  ipfsValue: unknown
  mono?: boolean
}) {
  const appMissing = appValue === undefined || appValue === null || appValue === ""
  const ipfsMissing = ipfsValue === undefined || ipfsValue === null || ipfsValue === ""
  const appText = appMissing ? "MISSING" : String(appValue)
  const ipfsText = ipfsMissing ? "MISSING" : String(ipfsValue)
  const match = appText === ipfsText
  return (
    <div className="grid grid-cols-[110px_1fr_1fr_auto] gap-2 items-start">
      <span className="text-[hsl(var(--buidl-text-tertiary))]">{label}</span>
      <span className={`${appMissing ? "text-yellow-300" : "text-[hsl(var(--buidl-text-primary))]"} ${mono ? "font-mono truncate" : ""}`}>{appText}</span>
      <span className={`${ipfsMissing ? "text-yellow-300" : "text-[hsl(var(--buidl-text-primary))]"} ${mono ? "font-mono truncate" : ""}`}>{ipfsText}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${match ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
        {match ? "match" : "diff"}
      </span>
    </div>
  )
}

function TraitCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 rounded-lg border border-[hsl(var(--buidl-accent-cyan)/0.3)] bg-[hsl(var(--buidl-accent-cyan)/0.05)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--buidl-accent-cyan))]">{label}</p>
      <p className="text-sm font-medium text-[hsl(var(--buidl-text-primary))] mt-0.5 truncate">{String(value)}</p>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[hsl(var(--buidl-text-tertiary))]">{label}</span>
      {children}
    </div>
  )
}
