export function buildAnimationUrl(tokenId: string | number, appBaseUrl: string): string {
  const id = String(tokenId)
  const metadataUrl = `${appBaseUrl.replace(/\/+$/, "")}/api/builds/metadata/${id}.json`
  const template = process.env.BUILD_ANIMATION_URL_TEMPLATE?.trim()
  // Safe default for marketplaces: no query params required.
  const defaultTemplate = "{appBaseUrl}/viewer/{tokenId}"

  const effectiveTemplate = template || defaultTemplate

  return effectiveTemplate
    .replaceAll("{tokenId}", id)
    .replaceAll("{appBaseUrl}", appBaseUrl.replace(/\/+$/, ""))
    .replaceAll("{metadataUrl}", metadataUrl)
    .replaceAll("{metadataUrlEncoded}", encodeURIComponent(metadataUrl))
}
