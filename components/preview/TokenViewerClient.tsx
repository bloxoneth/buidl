"use client"

import useSWR from "swr"
import Link from "next/link"
import { BuildVoxelPreview } from "@/components/preview/BuildVoxelPreview"
import { resolveIPFS, tokenImageGatewayURL } from "@/lib/contracts/buidl-contracts"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) return null
  return r.json()
}

/** Parse a data:application/json;base64,... tokenURI into metadata */
function parseDataUri(uri: string): { name?: string; image?: string; animation_url?: string } | null {
  if (!uri.startsWith("data:application/json;base64,")) return null
  try {
    const json = atob(uri.slice("data:application/json;base64,".length))
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function TokenViewerClient({
  tokenId,
  mode = "server",
}: {
  tokenId: string
  mode?: "server" | "ipfs" | "onchain"
}) {
  const { data: appData } = useSWR(`/api/builds/token/${tokenId}`, fetcher, { revalidateOnFocus: false })
  const { data: onchainData } = useSWR(`/api/builds/onchain/${tokenId}`, fetcher, { revalidateOnFocus: false })

  // Try to parse on-chain data URI from tokenURI
  const rawTokenURI = onchainData?.onchain?.tokenURI || onchainData?.tokenURI || ""
  const onchainMeta = parseDataUri(rawTokenURI)

  const bricks = Array.isArray(appData?.bricks) && appData.bricks.length > 0 ? appData.bricks : undefined
  const geometryHash = appData?.geometryHash || appData?.buildHash || onchainData?.onchain?.geometryHash || ""
  const title = onchainMeta?.name || appData?.name || onchainData?.ipfsMetadata?.name || `BUIDL #${tokenId}`
  const kind = Number(onchainData?.onchain?.kind ?? appData?.kind ?? -1)
  const isBrick = kind === 0

  // On-chain image (data: SVG URI)
  const onchainImage = onchainMeta?.image || ""
  // On-chain animation_url (data: HTML URI)
  const onchainAnimation = onchainMeta?.animation_url || ""

  // IPFS-based metadata (legacy fallback)
  const imageFromMetadataRaw = typeof onchainData?.ipfsMetadata?.image === "string" ? onchainData.ipfsMetadata.image : ""
  const imageFromMetadata = imageFromMetadataRaw.startsWith("ipfs://")
    ? resolveIPFS(imageFromMetadataRaw)
    : imageFromMetadataRaw
  const fallbackImage = imageFromMetadata || tokenImageGatewayURL(tokenId)
  const animationRaw = typeof onchainData?.ipfsMetadata?.animation_url === "string" ? onchainData.ipfsMetadata.animation_url : ""
  const animationUrl = animationRaw.startsWith("ipfs://") ? resolveIPFS(animationRaw) : animationRaw

  const hasOnchainData = Boolean(onchainMeta)
  const hasOnchainAnimation = Boolean(onchainAnimation)
  const hasIpfsAnimation = Boolean(animationUrl)

  // Render mode tabs
  const modes: Array<{ key: string; label: string; available: boolean }> = [
    { key: "server", label: "server", available: true },
    { key: "onchain", label: "onchain", available: hasOnchainData },
    { key: "ipfs", label: "ipfs", available: true },
  ]

  return (
    <main className="w-screen h-screen bg-[#0b1220] flex items-center justify-center overflow-hidden">
      <div className="w-full h-full relative">
        {mode === "onchain" ? (
          hasOnchainAnimation ? (
            <iframe
              srcDoc={onchainAnimation.startsWith("data:") ? undefined : undefined}
              src={onchainAnimation}
              title={`On-chain viewer ${tokenId}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
            />
          ) : hasOnchainData && onchainImage ? (
            <div className="w-full h-full flex items-center justify-center">
              <img
                src={onchainImage}
                alt={title}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-slate-300">
              No on-chain renderer data for token #{tokenId}
            </div>
          )
        ) : mode === "ipfs" ? (
          hasIpfsAnimation ? (
            <iframe
              src={animationUrl}
              title={`IPFS viewer ${tokenId}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-pointer-lock"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-slate-300">
              Missing IPFS animation_url for token #{tokenId}
            </div>
          )
        ) : (
          <BuildVoxelPreview
            bricks={bricks}
            geometryHash={geometryHash}
            tokenId={tokenId}
            imageUrl={fallbackImage}
            transparentBricks={isBrick}
            showStuds={isBrick}
            sceneMode="marketplace"
            className="w-full h-full"
          />
        )}
        <div className="absolute left-3 bottom-3 px-2 py-1 rounded bg-black/40 text-white text-xs font-mono">
          {title}
        </div>
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2 text-xs font-mono">
          {modes.filter(m => m.available).map(m => (
            <Link
              key={m.key}
              href={`/viewer/${tokenId}?mode=${m.key}`}
              className={`px-2 py-1 rounded border ${mode === m.key ? "bg-emerald-700/80 text-white border-emerald-400/60" : "bg-black/45 text-slate-300 border-white/20"}`}
            >
              {m.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
