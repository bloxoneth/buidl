import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { ethers } from "ethers"
import { CONTRACTS, RPC_URL } from "@/lib/contracts/buidl-contracts"

const execFileAsync = promisify(execFile)

const env = (k: string) => (process.env[k] || "").trim()

export type MarketplacePublishResult = {
  ok: boolean
  baseUri?: string
  cid?: string
  publishStdout?: string
  setBaseTxHash?: string
  tokenURI?: string
  imageURI?: string
  setBaseSkipped?: boolean
  warnings?: string[]
  metadataVerification?: {
    ok: boolean
    checkedGateways: string[]
    attempts: number
  }
  imageVerification?: {
    ok: boolean
    checkedGateways: string[]
    attempts: number
  }
  verification?: {
    metadataReachable: boolean
    checkedGateways: string[]
    attempts: number
  }
  reason?: string
}

type PublishOptions = {
  imageUri?: string
  verifyAttempts?: number
  verifyDelayMs?: number
  skipSetBaseWhenAligned?: boolean
}

function parsePublishOutput(stdout: string): { cid?: string; baseUri?: string } {
  const cidMatch = stdout.match(/Uploaded metadata folder CID:\s*([a-zA-Z0-9]+)/)
  const baseMatch = stdout.match(/Base URI candidate:\s*(ipfs:\/\/[^\s]+)/)
  return {
    cid: cidMatch?.[1],
    baseUri: baseMatch?.[1],
  }
}

function resolveAppUrlForChildProcess() {
  const explicit = env("APP_URL") || env("NEXT_PUBLIC_APP_URL") || env("NEXT_PUBLIC_APP_ORIGIN")
  if (explicit) return explicit.replace(/\/+$/, "")
  const vercelProd = env("VERCEL_PROJECT_PRODUCTION_URL")
  if (vercelProd) return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  const vercelUrl = env("VERCEL_URL")
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  return ""
}

function ipfsToGatewayCandidates(ipfsUri: string): string[] {
  const v = String(ipfsUri || "").trim()
  if (!v.startsWith("ipfs://")) return []
  const cidPath = v.slice("ipfs://".length).replace(/^\/+/, "")
  const fromEnv = (env("MARKETPLACE_GATEWAYS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((base) => `${base.replace(/\/+$/, "")}/${cidPath}`)
  const defaults = [
    `https://gateway.pinata.cloud/ipfs/${cidPath}`,
    `https://gateway.lighthouse.storage/ipfs/${cidPath}`,
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://dweb.link/ipfs/${cidPath}`,
  ]
  return Array.from(new Set([...fromEnv, ...defaults]))
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function verifyIpfsReachability(
  ipfsUri: string,
  maxAttempts = Number(process.env.MARKETPLACE_VERIFY_ATTEMPTS || "10"),
  delayMs = Number(process.env.MARKETPLACE_VERIFY_DELAY_MS || "2500")
): Promise<{ ok: boolean; checkedGateways: string[]; attempts: number }> {
  const urls = ipfsToGatewayCandidates(ipfsUri)
  if (urls.length === 0) return { ok: false, checkedGateways: [], attempts: 0 }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const u of urls) {
      try {
        const res = await fetch(u, { method: "HEAD", redirect: "follow" })
        if (res.ok) {
          return { ok: true, checkedGateways: urls, attempts: attempt }
        }
      } catch {
        // try next gateway/attempt
      }
    }
    if (attempt < maxAttempts) await sleep(delayMs)
  }
  return { ok: false, checkedGateways: urls, attempts: maxAttempts }
}

async function warmGatewayUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal })
    if (head.ok) return true
    const get = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal })
    return get.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function warmIpfsUris(ipfsUris: string[], warnings: string[]) {
  if ((env("MARKETPLACE_WARM_GATEWAYS") || "1") !== "1") return
  const timeoutMs = Number(env("MARKETPLACE_WARM_TIMEOUT_MS") || "9000")
  const urls = Array.from(new Set(ipfsUris.flatMap((uri) => ipfsToGatewayCandidates(uri))))
  await Promise.all(
    urls.map(async (url) => {
      const ok = await warmGatewayUrl(url, timeoutMs)
      if (!ok) warnings.push(`gateway warm failed: ${url}`)
    })
  )
}

async function replicateCidToSecondaryPinning(cid: string, tokenId: number, warnings: string[]) {
  if ((env("MARKETPLACE_MULTIPIN_ENABLED") || "0") !== "1") return
  const endpoint = env("IPFS_SECONDARY_PIN_URL")
  if (!endpoint) return

  const token = env("IPFS_SECONDARY_PIN_TOKEN")
  const timeoutMs = Number(env("IPFS_SECONDARY_PIN_TIMEOUT_MS") || "15000")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        hashToPin: cid,
        pinataMetadata: {
          name: `buidl-${tokenId}`,
          keyvalues: { tokenId: String(tokenId), source: "marketplace-publish" },
        },
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      warnings.push(`secondary pin failed: ${res.status} ${text}`)
    }
  } catch (err: any) {
    warnings.push(`secondary pin exception: ${err?.message || String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

async function triggerRefreshHooks(payload: Record<string, unknown>, warnings: string[]) {
  const hooks = (env("MARKETPLACE_REFRESH_HOOKS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  if (hooks.length === 0) return

  const timeoutMs = Number(env("MARKETPLACE_REFRESH_HOOK_TIMEOUT_MS") || "8000")
  const auth = env("MARKETPLACE_REFRESH_HOOK_AUTH")
  await Promise.all(
    hooks.map(async (url) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!res.ok) warnings.push(`refresh hook failed (${res.status}): ${url}`)
      } catch (err: any) {
        warnings.push(`refresh hook exception (${url}): ${err?.message || String(err)}`)
      } finally {
        clearTimeout(timer)
      }
    })
  )
}

export async function publishMetadataRangeAndSetBase(
  toTokenId: number,
  fromTokenId = 1,
  options: PublishOptions = {}
): Promise<MarketplacePublishResult> {
  if (!Number.isFinite(toTokenId) || toTokenId <= 0) {
    return { ok: false, reason: "invalid token id" }
  }

  const appRoot = process.cwd()
  let publishStdout = ""
  let baseUri = ""
  let cid = ""
  const warnings: string[] = []

  try {
    const appUrlForScript = resolveAppUrlForChildProcess()
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["scripts/publish-metadata-batch.mjs", "--from", String(fromTokenId), "--to", String(toTokenId)],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          ...(appUrlForScript ? { APP_URL: appUrlForScript } : {}),
        },
        maxBuffer: 20 * 1024 * 1024,
      }
    )
    publishStdout = `${stdout || ""}${stderr || ""}`
    const parsed = parsePublishOutput(publishStdout)
    baseUri = parsed.baseUri || ""
    cid = parsed.cid || ""
    if (!baseUri) {
      return {
        ok: false,
        reason: "publish succeeded but base URI not found in output",
        publishStdout,
        cid,
      }
    }
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.message || "publish script failed",
      publishStdout,
    }
  }

  const ownerKey = env("BASE_TOKEN_URI_OWNER_KEY") || env("PRIVATE_KEY")
  if (!ownerKey) {
    return {
      ok: false,
      reason: "missing BASE_TOKEN_URI_OWNER_KEY/PRIVATE_KEY for setBaseTokenURI",
      baseUri,
      cid,
      publishStdout,
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const signer = new ethers.Wallet(ownerKey, provider)
    const contract = new ethers.Contract(
      CONTRACTS.BUILD_NFT,
      ["function owner() view returns (address)", "function setBaseTokenURI(string)", "function tokenURI(uint256) view returns (string)"],
      signer
    )
    const owner = String(await contract.owner())
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      return {
        ok: false,
        reason: "owner key is not BuildNFT owner",
        baseUri,
        cid,
        publishStdout,
      }
    }
    const expectedTokenUri = `${baseUri.replace(/\/+$/, "")}/${toTokenId}.json`
    const currentTokenUri = String(await contract.tokenURI(BigInt(toTokenId)))
    let txHash: string | undefined
    let setBaseSkipped = false

    if (
      (options.skipSetBaseWhenAligned ?? (env("MARKETPLACE_SKIP_SET_BASE_WHEN_ALIGNED") || "1") === "1") &&
      currentTokenUri === expectedTokenUri
    ) {
      setBaseSkipped = true
    } else {
      const tx = await contract.setBaseTokenURI(baseUri)
      await tx.wait()
      txHash = tx.hash
    }

    const tokenURI = String(await contract.tokenURI(BigInt(toTokenId)))
    const metadataVerification = await verifyIpfsReachability(
      tokenURI,
      Number(options.verifyAttempts ?? Number(env("MARKETPLACE_VERIFY_ATTEMPTS") || "10")),
      Number(options.verifyDelayMs ?? Number(env("MARKETPLACE_VERIFY_DELAY_MS") || "2500"))
    )
    const imageUri = String(options.imageUri || "").trim()
    const imageVerification = imageUri
      ? await verifyIpfsReachability(
          imageUri,
          Number(options.verifyAttempts ?? Number(env("MARKETPLACE_VERIFY_ATTEMPTS") || "10")),
          Number(options.verifyDelayMs ?? Number(env("MARKETPLACE_VERIFY_DELAY_MS") || "2500"))
        )
      : { ok: true, checkedGateways: [] as string[], attempts: 0 }

    await warmIpfsUris([tokenURI, imageUri].filter(Boolean), warnings)
    if (cid) await replicateCidToSecondaryPinning(cid, toTokenId, warnings)

    const refreshPayload: Record<string, unknown> = {
      tokenId: String(toTokenId),
      baseUri,
      tokenURI,
      metadataUri: tokenURI,
      imageUri: imageUri || undefined,
      cid: cid || undefined,
      metadataReachable: metadataVerification.ok,
      imageReachable: imageVerification.ok,
    }
    await triggerRefreshHooks(refreshPayload, warnings)

    if (!metadataVerification.ok || !imageVerification.ok) {
      return {
        ok: false,
        reason: !metadataVerification.ok
          ? "metadata not reachable on public IPFS gateways yet"
          : "image not reachable on public IPFS gateways yet",
        baseUri,
        cid,
        publishStdout,
        setBaseTxHash: txHash,
        imageURI: imageUri || undefined,
        setBaseSkipped,
        tokenURI,
        warnings,
        metadataVerification,
        imageVerification,
        verification: {
          metadataReachable: metadataVerification.ok,
          checkedGateways: metadataVerification.checkedGateways,
          attempts: metadataVerification.attempts,
        },
      }
    }
    return {
      ok: true,
      baseUri,
      cid,
      publishStdout,
      setBaseTxHash: txHash,
      imageURI: imageUri || undefined,
      setBaseSkipped,
      tokenURI,
      warnings,
      metadataVerification,
      imageVerification,
      verification: {
        metadataReachable: true,
        checkedGateways: metadataVerification.checkedGateways,
        attempts: metadataVerification.attempts,
      },
    }
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.shortMessage || err?.message || "setBaseTokenURI failed",
      baseUri,
      cid,
      publishStdout,
      warnings,
    }
  }
}
