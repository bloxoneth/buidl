import { TokenViewerClient } from "@/components/preview/TokenViewerClient"

export default async function ViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { tokenId } = await params
  const { mode } = await searchParams
  const viewerMode = mode === "ipfs" ? "ipfs" : "server"
  return <TokenViewerClient tokenId={tokenId} mode={viewerMode} />
}
