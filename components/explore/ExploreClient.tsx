"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Box, Layers, Hash, Search, SlidersHorizontal, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import type { Build } from "@/lib/types"
import { BuildVoxelPreview } from "@/components/preview/BuildVoxelPreview"
import { useMetaMask } from "@/contexts/metamask-context"
 

const fetcher = (url: string) => fetch(url).then(r => r.json())

type UiMarketplaceState = "minted_onchain" | "ipfs_synced" | "marketplace_pending" | "marketplace_live" | "failed_retrying"

function resolveMarketplaceState(build: Build): UiMarketplaceState {
  const explicit = build.marketplace?.state as UiMarketplaceState | undefined
  if (explicit) return explicit
  if (build.ipfsUri && !build.ipfsPending) return "ipfs_synced"
  return "minted_onchain"
}

function marketplaceUi(state: UiMarketplaceState): { label: string; className: string } {
  switch (state) {
    case "marketplace_live":
      return { label: "Marketplace live", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35" }
    case "marketplace_pending":
      return { label: "Marketplace pending", className: "bg-blue-500/15 text-blue-300 border-blue-500/35" }
    case "failed_retrying":
      return { label: "Failed (retrying)", className: "bg-amber-500/15 text-amber-200 border-amber-500/35" }
    case "ipfs_synced":
      return { label: "IPFS synced", className: "bg-cyan-500/15 text-cyan-200 border-cyan-500/35" }
    default:
      return { label: "Minted onchain", className: "bg-slate-500/20 text-slate-200 border-slate-500/35" }
  }
}

export function ExploreClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { account, isConnected } = useMetaMask()
  const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME ?? "Base Sepolia"
  const { data: cacheData, isLoading: cacheLoading } = useSWR<{ builds: Build[]; source?: string; missing?: string[] }>(
    "/api/builds/minted",
    fetcher,
    {
    revalidateOnFocus: false,
    },
  )
  const cacheCount = cacheData?.builds?.length ?? 0
  const shouldLoadTruth =
    !cacheLoading &&
    ((cacheCount === 0 && (cacheData?.missing ?? []).includes("cache_index_missing")) ||
      // Cache can be partial; load truth when the local index is unexpectedly thin.
      cacheCount < 5)

  const { data: truthData, isLoading: truthLoading } = useSWR<{ builds: Build[]; source?: string; missing?: string[] }>(
    shouldLoadTruth ? "/api/builds/minted?source=truth" : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  )

  const data = shouldLoadTruth ? truthData ?? cacheData : cacheData
  const isLoading = cacheLoading || (shouldLoadTruth && truthLoading)
  const builds = data?.builds ?? []
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<"all" | "brick" | "build">("all")
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishDone, setPublishDone] = useState(false)
  const [forceRetryBusy, setForceRetryBusy] = useState(false)
  const [forceRetryInfo, setForceRetryInfo] = useState<string | null>(null)

  const mintSuccess = searchParams.get("mintSuccess") === "1"
  const publishRequired = searchParams.get("publishRequired") === "1"
  const mintedTokenId = searchParams.get("tokenId") || ""

  // Only show minted builds (those with a tokenId)
  const mintedBuilds = (builds ?? []).filter(b => b.tokenId)

  // Apply filters
  const filteredBuilds = mintedBuilds.filter(b => {
    const matchesSearch = !search ||
      (b.name || "").toLowerCase().includes(search.toLowerCase()) ||
      String(b.tokenId).includes(search)
    const matchesKind = kindFilter === "all" ||
      (kindFilter === "brick" && (b.kind === 0 || b.kind === undefined)) ||
      (kindFilter === "build" && b.kind !== undefined && b.kind > 0)
    return matchesSearch && matchesKind
  })

  const clearMintBanner = () => {
    setPublishError(null)
    const next = new URLSearchParams(searchParams.toString())
    next.delete("mintSuccess")
    next.delete("publishRequired")
    next.delete("tokenId")
    router.replace(next.toString() ? `/explore?${next.toString()}` : "/explore")
  }

  const forceRetryWorker = async () => {
    if (!isConnected || !account) {
      setPublishError("Connect wallet to force retry worker.")
      return
    }
    try {
      setForceRetryBusy(true)
      setPublishError(null)
      setForceRetryInfo(null)
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error("Wallet not available")
      const { ethers } = await import("ethers")
      const provider = new ethers.BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const signedToken = mintedTokenId && /^\d+$/.test(mintedTokenId) ? mintedTokenId : "RUN"
      const msg = `BUIDL_MARKETPLACE_RETRY:${signedToken}`
      const sig = await signer.signMessage(msg)
      const res = await fetch("/api/builds/marketplace-retry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-address": account,
          "x-owner-signature": sig,
        },
        body: JSON.stringify({
          tokenId: mintedTokenId && /^\d+$/.test(mintedTokenId) ? mintedTokenId : undefined,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Retry worker failed (${res.status})`)
      }
      const batch = json?.batch || {}
      setForceRetryInfo(
        `Retry worker ran. Processed ${Number(batch.processed || 0)} · Success ${Number(batch.successes || 0)} · Failed ${Number(batch.failures || 0)} · Skipped ${Number(batch.skipped || 0)}`
      )
      if (json?.tokenAttempt?.publish?.ok) {
        setPublishDone(true)
        const next = new URLSearchParams(searchParams.toString())
        next.set("publishRequired", "0")
        router.replace(`/explore?${next.toString()}`)
      }
    } catch (err: any) {
      setPublishError(err?.message || "Failed to force retry worker")
    } finally {
      setForceRetryBusy(false)
    }
  }

  return (
    <div className="container mx-auto px-6 max-w-[1400px]">
      {mintSuccess ? (
        <div className="mb-4 rounded-lg border border-[hsl(var(--buidl-border))] bg-[hsl(var(--buidl-surface))] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[hsl(var(--buidl-text-primary))] flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                Build Claimed{mintedTokenId ? ` · Token #${mintedTokenId}` : ""}
              </p>
              <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">
                {publishRequired && !publishDone
                  ? "You now own this shape. Within 1-2 minutes the build should appear in NFT marketplaces, or click Force Send below."
                  : "You now own this shape. Marketplace indexing usually completes within 1-2 minutes."}
              </p>
              {publishError ? (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {publishError}
                </p>
              ) : null}
              {forceRetryInfo ? (
                <p className="text-xs text-[hsl(var(--buidl-text-secondary))]">{forceRetryInfo}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={forceRetryWorker}
                disabled={forceRetryBusy}
                className="bg-[hsl(var(--buidl-blue))] text-white hover:opacity-90"
              >
                {forceRetryBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Force Send
              </Button>
              <Button variant="outline" onClick={clearMintBanner}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-heading font-bold text-[hsl(var(--buidl-text-primary))] mb-2">
          Explore Builds
        </h1>
        <p className="text-[hsl(var(--buidl-text-secondary))]">
          {mintedBuilds.length} minted NFTs on {networkName}
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--buidl-text-tertiary))]" />
          <Input
            placeholder="Search by name or token ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))] text-[hsl(var(--buidl-text-primary))]"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[hsl(var(--buidl-border))] bg-[hsl(var(--buidl-surface))] p-0.5">
          {(["all", "brick", "build"] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setKindFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                kindFilter === f
                  ? "bg-[hsl(var(--buidl-green))] text-black"
                  : "text-[hsl(var(--buidl-text-secondary))] hover:text-[hsl(var(--buidl-text-primary))]"
              }`}
            >
              {f === "all" ? "All" : f === "brick" ? "Bricks" : "Builds"}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-[hsl(var(--buidl-surface))] overflow-hidden">
              <div className="aspect-square bg-[hsl(var(--buidl-bg))] animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded bg-[hsl(var(--buidl-bg))] animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-[hsl(var(--buidl-bg))] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {!isLoading && filteredBuilds.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredBuilds.map(build => (
            <BuildCard key={build.id || build.tokenId} build={build} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filteredBuilds.length === 0 && mintedBuilds.length > 0 && (
        <div className="text-center py-16">
          <SlidersHorizontal className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--buidl-text-tertiary))]" />
          <h3 className="text-lg font-semibold text-[hsl(var(--buidl-text-primary))] mb-2">
            No matches
          </h3>
          <p className="text-sm text-[hsl(var(--buidl-text-secondary))]">
            Try adjusting your search or filter.
          </p>
        </div>
      )}

      {!isLoading && mintedBuilds.length === 0 && (
        <div className="text-center py-16">
          <Box className="h-16 w-16 mx-auto mb-6 text-[hsl(var(--buidl-text-tertiary))]" />
          <h3 className="text-xl font-semibold text-[hsl(var(--buidl-text-primary))] mb-2">
            No Builds Yet
          </h3>
          <p className="text-[hsl(var(--buidl-text-secondary))] mb-6 max-w-md mx-auto">
            Start by minting bricks in the builder, then create and mint your first build.
          </p>
          <Link href="/buildv2">
            <Button className="bg-[hsl(var(--buidl-green))] text-black hover:bg-[hsl(var(--buidl-green)/0.9)] font-semibold">
              Start Building
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}

function BuildCard({ build }: { build: Build }) {
  const kindLabel = (build.kind === 0 || build.kind === undefined) ? "Brick" : "Build"
  const market = marketplaceUi(resolveMarketplaceState(build))
  const sizeLabel = build.brickWidth && build.brickDepth
    ? `${build.brickWidth}x${build.brickDepth}`
    : build.baseWidth && build.baseDepth
      ? `${build.baseWidth}x${build.baseDepth}`
      : null
  const massLabel = build.mass ? `${build.mass} BLOX` : null

  return (
    <Link href={`/explore/${build.tokenId}`}>
      <Card className="bg-[hsl(var(--buidl-surface))] border-[hsl(var(--buidl-border))] hover:border-[hsl(var(--buidl-green)/0.5)] transition-all cursor-pointer group overflow-hidden">
        {/* Image */}
        <div className="aspect-square bg-[hsl(var(--buidl-bg))] relative overflow-hidden">
          <BuildVoxelPreview
            bricks={build.bricks}
            geometryHash={build.geometryHash || build.buildHash}
            tokenId={build.tokenId}
            transparentBricks={build.kind === 0}
            showStuds={build.kind === 0}
            className="h-full w-full"
          />
          {/* Token ID badge */}
          <span className="absolute top-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm">
            #{build.tokenId}
          </span>
        </div>

        {/* Info */}
        <CardContent className="p-3 space-y-1.5">
          <p className="text-sm font-medium text-[hsl(var(--buidl-text-primary))] truncate">
            {build.name || `Build #${build.tokenId}`}
          </p>

          <div className="flex items-center gap-2 flex-wrap text-xs text-[hsl(var(--buidl-text-tertiary))]">
            <span className="px-1.5 py-0.5 rounded bg-[hsl(var(--buidl-bg))] text-[hsl(var(--buidl-text-secondary))]">
              {kindLabel}
            </span>
            {sizeLabel && (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {sizeLabel}
              </span>
            )}
            {massLabel && (
              <span className="text-[hsl(var(--buidl-text-tertiary))]">
                {massLabel}
              </span>
            )}
          </div>

          {build.buildHash && (
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--buidl-text-tertiary))] font-mono truncate">
              <Hash className="h-3 w-3 flex-shrink-0" />
              {build.buildHash.slice(0, 10)}...
            </div>
          )}
          <div className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] ${market.className}`}>
            {market.label}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
