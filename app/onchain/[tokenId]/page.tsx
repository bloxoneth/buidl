import { OnchainViewerClient } from "@/components/preview/OnchainViewerClient"

export default async function OnchainPage({
  params,
}: {
  params: Promise<{ tokenId: string }>
}) {
  const { tokenId } = await params
  return <OnchainViewerClient tokenId={tokenId} />
}
