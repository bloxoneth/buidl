import { redis } from "@/lib/redis"
import { rk } from "@/lib/redis-keys"
import type { Build, MarketplaceLifecycle, MarketplaceLifecycleState } from "@/lib/types"
import { publishMetadataRangeAndSetBase, type MarketplacePublishResult } from "@/lib/marketplace-publish"

const env = (k: string) => (process.env[k] || "").trim()

const RETRY_ENABLED = (env("MARKETPLACE_RETRY_ENABLED") || "1") === "1"
const RETRY_MAX_ATTEMPTS = Number(env("MARKETPLACE_RETRY_MAX_ATTEMPTS") || "16")
const RETRY_BASE_DELAY_MS = Number(env("MARKETPLACE_RETRY_BASE_DELAY_MS") || "15000")
const RETRY_MAX_DELAY_MS = Number(env("MARKETPLACE_RETRY_MAX_DELAY_MS") || "1800000")
const RETRY_JITTER_MS = Number(env("MARKETPLACE_RETRY_JITTER_MS") || "1250")
const RETRY_BATCH_SIZE = Number(env("MARKETPLACE_RETRY_BATCH_SIZE") || "20")
const RETRY_IPFS_RECHECK_MS = Number(env("MARKETPLACE_IPFS_RECHECK_MS") || "30000")
const INLINE_VERIFY_ATTEMPTS = Number(env("MARKETPLACE_INLINE_VERIFY_ATTEMPTS") || "3")
const INLINE_VERIFY_DELAY_MS = Number(env("MARKETPLACE_INLINE_VERIFY_DELAY_MS") || "1200")

const PENDING_SET_KEY = rk("marketplace:pending_tokens")
const statusKey = (tokenId: string) => rk(`marketplace:status:${tokenId}`)

type AttemptOptions = {
  trigger?: "mint" | "manual" | "cron"
  immediateRetryOnFailure?: boolean
  verifyAttempts?: number
  verifyDelayMs?: number
}

type RetryBatchResult = {
  processed: number
  successes: number
  failures: number
  skipped: number
  candidates: string[]
}

function toIso(ts = Date.now()) {
  return new Date(ts).toISOString()
}

function parseIsoMs(iso?: string) {
  if (!iso) return 0
  const v = Date.parse(iso)
  return Number.isFinite(v) ? v : 0
}

function stateLabel(state: MarketplaceLifecycleState): MarketplaceLifecycle["stateLabel"] {
  switch (state) {
    case "minted_onchain":
      return "Minted onchain"
    case "ipfs_synced":
      return "IPFS synced"
    case "marketplace_pending":
      return "Marketplace pending"
    case "marketplace_live":
      return "Marketplace live"
    case "failed_retrying":
      return "Failed (retrying)"
  }
}

function withState(status: MarketplaceLifecycle, state: MarketplaceLifecycleState): MarketplaceLifecycle {
  return {
    ...status,
    state,
    stateLabel: stateLabel(state),
  }
}

function computeStateFromInputs(build: Build | null, existing?: MarketplaceLifecycle | null): MarketplaceLifecycleState {
  if (existing?.state === "marketplace_live" || existing?.marketplaceLive) return "marketplace_live"
  const ipfsSynced = Boolean(build?.ipfsUri && !build?.ipfsPending)
  if (!ipfsSynced) return "minted_onchain"
  if (existing?.state === "failed_retrying") return "failed_retrying"
  if (existing?.state === "marketplace_pending") return "marketplace_pending"
  return "ipfs_synced"
}

async function loadBuildByToken(tokenId: string): Promise<{ buildId: string; build: Build } | null> {
  const buildId = await redis.get<string>(rk(`token:${tokenId}`))
  if (!buildId) return null
  const build = await redis.get<Build>(rk(`build:${buildId}`))
  if (!build) return null
  return { buildId: String(buildId), build }
}

async function persistBuildMarketplace(buildId: string, build: Build, status: MarketplaceLifecycle) {
  await redis.set(rk(`build:${buildId}`), {
    ...build,
    marketplace: status,
  } satisfies Build)
}

function nextDelayMs(retryCount: number): number {
  const exp = Math.max(0, retryCount - 1)
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exp)
  const jitter = Math.max(0, Math.floor(Math.random() * RETRY_JITTER_MS))
  return base + jitter
}

export async function getMarketplaceStatus(tokenId: string, buildOverride?: Build | null): Promise<MarketplaceLifecycle> {
  const token = String(tokenId)
  const stored = await redis.get<MarketplaceLifecycle>(statusKey(token))
  const build = buildOverride === undefined ? (await loadBuildByToken(token))?.build ?? null : buildOverride

  const state = computeStateFromInputs(build, stored)
  const status: MarketplaceLifecycle = withState(
    {
      tokenId: token,
      onchainMinted: true,
      ipfsSynced: Boolean(build?.ipfsUri && !build?.ipfsPending),
      marketplaceLive: state === "marketplace_live",
      retryCount: stored?.retryCount ?? 0,
      retryHalted: stored?.retryHalted ?? false,
      nextRetryAt: stored?.nextRetryAt,
      lastAttemptAt: stored?.lastAttemptAt,
      lastSuccessAt: stored?.lastSuccessAt,
      lastError: stored?.lastError,
      baseUri: stored?.baseUri,
      cid: stored?.cid,
      tokenURI: stored?.tokenURI,
      imageURI: stored?.imageURI,
      setBaseTxHash: stored?.setBaseTxHash,
      checkedGateways: stored?.checkedGateways,
      imageCheckedGateways: stored?.imageCheckedGateways,
      state: "minted_onchain",
      stateLabel: "Minted onchain",
    },
    state
  )

  return status
}

async function saveStatus(tokenId: string, status: MarketplaceLifecycle, buildId?: string, build?: Build) {
  await redis.set(statusKey(tokenId), status)
  if (buildId && build) {
    await persistBuildMarketplace(buildId, build, status)
  }
}

export async function markMarketplacePending(
  tokenId: string,
  reason?: string,
  options: { nextRetryMs?: number; buildOverride?: Build | null; buildIdOverride?: string } = {}
) {
  const token = String(tokenId)
  const loaded = options.buildOverride === undefined ? await loadBuildByToken(token) : null
  const build = options.buildOverride === undefined ? loaded?.build ?? null : options.buildOverride
  const buildId = options.buildIdOverride || loaded?.buildId
  const current = await getMarketplaceStatus(token, build)
  const status = withState(
    {
      ...current,
      onchainMinted: true,
      ipfsSynced: Boolean(build?.ipfsUri && !build?.ipfsPending),
      marketplaceLive: false,
      lastError: reason || current.lastError,
      nextRetryAt: toIso(Date.now() + (options.nextRetryMs ?? 0)),
    },
    current.ipfsSynced ? "marketplace_pending" : "minted_onchain"
  )
  await redis.sadd(PENDING_SET_KEY, token)
  await saveStatus(token, status, buildId, build ?? undefined)
  return status
}

async function markFailureForRetry(
  tokenId: string,
  reason: string,
  publishResult: MarketplacePublishResult | null,
  options: { immediate?: boolean; buildOverride?: Build | null; buildIdOverride?: string } = {}
) {
  const token = String(tokenId)
  const loaded = options.buildOverride === undefined ? await loadBuildByToken(token) : null
  const build = options.buildOverride === undefined ? loaded?.build ?? null : options.buildOverride
  const buildId = options.buildIdOverride || loaded?.buildId
  const current = await getMarketplaceStatus(token, build)
  const retryCount = (current.retryCount ?? 0) + 1
  const shouldHalt = RETRY_MAX_ATTEMPTS > 0 && retryCount >= RETRY_MAX_ATTEMPTS
  const delayMs = options.immediate ? 0 : nextDelayMs(retryCount)
  const nextRetryAt = shouldHalt ? undefined : toIso(Date.now() + delayMs)
  const status = withState(
    {
      ...current,
      onchainMinted: true,
      ipfsSynced: Boolean(build?.ipfsUri && !build?.ipfsPending),
      marketplaceLive: false,
      retryCount,
      retryHalted: shouldHalt,
      lastError: reason,
      lastAttemptAt: toIso(),
      nextRetryAt,
      baseUri: publishResult?.baseUri || current.baseUri,
      cid: publishResult?.cid || current.cid,
      tokenURI: publishResult?.tokenURI || current.tokenURI,
      imageURI: publishResult?.imageURI || build?.ipfsImageUri || current.imageURI,
      setBaseTxHash: publishResult?.setBaseTxHash || current.setBaseTxHash,
      checkedGateways: publishResult?.metadataVerification?.checkedGateways || current.checkedGateways,
      imageCheckedGateways: publishResult?.imageVerification?.checkedGateways || current.imageCheckedGateways,
    },
    "failed_retrying"
  )

  if (RETRY_ENABLED && !shouldHalt) {
    await redis.sadd(PENDING_SET_KEY, token)
  } else {
    await redis.srem(PENDING_SET_KEY, token)
  }
  await saveStatus(token, status, buildId, build ?? undefined)
  return status
}

async function markSuccess(
  tokenId: string,
  publishResult: MarketplacePublishResult,
  options: { buildOverride?: Build | null; buildIdOverride?: string } = {}
) {
  const token = String(tokenId)
  const loaded = options.buildOverride === undefined ? await loadBuildByToken(token) : null
  const build = options.buildOverride === undefined ? loaded?.build ?? null : options.buildOverride
  const buildId = options.buildIdOverride || loaded?.buildId
  const now = toIso()
  const status = withState(
    {
      ...(await getMarketplaceStatus(token, build)),
      onchainMinted: true,
      ipfsSynced: true,
      marketplaceLive: true,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: undefined,
      retryCount: 0,
      retryHalted: false,
      nextRetryAt: undefined,
      baseUri: publishResult.baseUri,
      cid: publishResult.cid,
      tokenURI: publishResult.tokenURI,
      imageURI: publishResult.imageURI || build?.ipfsImageUri,
      setBaseTxHash: publishResult.setBaseTxHash,
      checkedGateways: publishResult.metadataVerification?.checkedGateways,
      imageCheckedGateways: publishResult.imageVerification?.checkedGateways,
    },
    "marketplace_live"
  )
  await redis.srem(PENDING_SET_KEY, token)
  await saveStatus(token, status, buildId, build ?? undefined)
  return status
}

export async function attemptMarketplacePublish(
  tokenId: string,
  options: AttemptOptions = {}
): Promise<{
  status: MarketplaceLifecycle
  publish: MarketplacePublishResult | null
}> {
  const token = String(tokenId)
  const loaded = await loadBuildByToken(token)
  const build = loaded?.build ?? null
  const buildId = loaded?.buildId
  const current = await getMarketplaceStatus(token, build)

  if (!build) {
    const pending = await markMarketplacePending(token, "build missing in redis", { nextRetryMs: RETRY_BASE_DELAY_MS })
    return { status: pending, publish: null }
  }

  const ipfsSynced = Boolean(build.ipfsUri && !build.ipfsPending)

  const pendingBeforeAttempt = withState(
    {
      ...current,
      onchainMinted: true,
      ipfsSynced,
      marketplaceLive: false,
      lastAttemptAt: toIso(),
      nextRetryAt: undefined,
      imageURI: build.ipfsImageUri || current.imageURI,
    },
    "marketplace_pending"
  )
  await redis.sadd(PENDING_SET_KEY, token)
  await saveStatus(token, pendingBeforeAttempt, buildId, build)

  const verifyAttempts =
    options.verifyAttempts ??
    (options.trigger === "mint" ? INLINE_VERIFY_ATTEMPTS : Number(env("MARKETPLACE_VERIFY_ATTEMPTS") || "10"))
  const verifyDelayMs =
    options.verifyDelayMs ??
    (options.trigger === "mint" ? INLINE_VERIFY_DELAY_MS : Number(env("MARKETPLACE_VERIFY_DELAY_MS") || "2500"))

  const publish = await publishMetadataRangeAndSetBase(Number(token), 1, {
    imageUri: build.ipfsImageUri,
    verifyAttempts,
    verifyDelayMs,
  })

  if (publish.ok) {
    const success = await markSuccess(token, publish, { buildOverride: build, buildIdOverride: buildId })
    return { status: success, publish }
  }

  const failed = await markFailureForRetry(token, publish.reason || "marketplace publish failed", publish, {
    immediate: options.immediateRetryOnFailure,
    buildOverride: build,
    buildIdOverride: buildId,
  })
  return { status: failed, publish }
}

export async function processMarketplaceRetryBatch(batchSize = RETRY_BATCH_SIZE): Promise<RetryBatchResult> {
  const now = Date.now()
  const [pendingTokens, mintedTokens] = await Promise.all([
    redis.smembers(PENDING_SET_KEY),
    redis.smembers(rk("minted_tokens")),
  ])

  const candidates = Array.from(new Set([...(pendingTokens || []), ...(mintedTokens || [])]))
    .map((v) => String(v))
    .filter((v) => /^\d+$/.test(v))
    .sort((a, b) => Number(b) - Number(a))

  const due: string[] = []
  for (const tokenId of candidates) {
    const status = await getMarketplaceStatus(tokenId)
    if (status.state === "marketplace_live") {
      await redis.srem(PENDING_SET_KEY, tokenId)
      continue
    }
    if (status.retryHalted) continue
    const dueAt = parseIsoMs(status.nextRetryAt)
    if (!dueAt || dueAt <= now) {
      due.push(tokenId)
    }
    if (due.length >= batchSize) break
  }

  let successes = 0
  let failures = 0
  let skipped = 0

  for (const tokenId of due) {
    const result = await attemptMarketplacePublish(tokenId, { trigger: "cron" })
    if (!result.publish) {
      skipped += 1
      continue
    }
    if (result.publish.ok) successes += 1
    else failures += 1
  }

  return {
    processed: due.length,
    successes,
    failures,
    skipped,
    candidates: due,
  }
}
