import { NextRequest, NextResponse } from "next/server"
import { redis } from "@/lib/redis"
import { rk } from "@/lib/redis-keys"

const envRaw = (k: string) => (process.env[k] || "").trim()
const env = (k: string) => {
  const v = envRaw(k)
  // Allow "commenting out" secrets in .env via ##... without breaking provider selection.
  if (v.startsWith("#")) return ""
  return v
}

const PINATA_JWT = env("PINATA_JWT")
const LIGHTHOUSE_API_KEY = env("LIGHTHOUSE_API_KEY")
const IPFS_PROVIDER = (env("IPFS_PROVIDER") || (LIGHTHOUSE_API_KEY ? "lighthouse" : PINATA_JWT ? "pinata" : "")).toLowerCase()
const IPFS_API_TOKEN = env("IPFS_API_TOKEN") || (IPFS_PROVIDER === "pinata" ? PINATA_JWT : LIGHTHOUSE_API_KEY)
const IPFS_UPLOAD_URL =
  env("IPFS_UPLOAD_URL") ||
  env("LIGHTHOUSE_UPLOAD_URL") ||
  (IPFS_PROVIDER === "lighthouse"
    ? "https://node.lighthouse.storage/api/v0/add"
    : "https://api.pinata.cloud/pinning/pinFileToIPFS")
const LIGHTHOUSE_UPLOAD_URL_FALLBACKS = [
  "https://node.lighthouse.storage/api/v0/add",
  "https://api.lighthouse.storage/api/v0/add",
]
const IPFS_UPLOAD_URLS =
  IPFS_PROVIDER === "lighthouse"
    ? Array.from(new Set([IPFS_UPLOAD_URL, ...LIGHTHOUSE_UPLOAD_URL_FALLBACKS]))
    : [IPFS_UPLOAD_URL]
const IPFS_GATEWAY_BASE = env("PINATA_GATEWAY_BASE") || "https://gateway.pinata.cloud/ipfs"
const IPFS_UPLOAD_TIMEOUT_MS = Number(env("IPFS_UPLOAD_TIMEOUT_MS") || "25000")
const IPFS_UPLOAD_RETRIES = Number(env("IPFS_UPLOAD_RETRIES") || "4")

const PREFLIGHT_KEY = (buildHash: string) => rk(`ipfs:preflight:${buildHash.toLowerCase()}`)

async function uploadToIpfsWithRetry(formDataFactory: () => FormData) {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= IPFS_UPLOAD_RETRIES; attempt++) {
    for (const uploadUrl of IPFS_UPLOAD_URLS) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IPFS_UPLOAD_TIMEOUT_MS)
      try {
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${IPFS_API_TOKEN}` },
          body: formDataFactory(),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (res.ok) return res
        lastError = new Error(`IPFS upload failed (${uploadUrl}): ${res.status} ${await res.text()}`)
      } catch (err: any) {
        clearTimeout(timer)
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
    if (attempt < IPFS_UPLOAD_RETRIES) {
      await new Promise((r) => setTimeout(r, attempt * 700))
    }
  }
  throw lastError || new Error("IPFS upload failed")
}

function appendProviderUploadOptions(formData: FormData) {
  // Pinata supports provider-specific pin options; Lighthouse ignores this field.
  if (IPFS_PROVIDER === "pinata") {
    formData.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!IPFS_API_TOKEN) {
      return NextResponse.json(
        {
          error: "No IPFS API token configured (PINATA_JWT or LIGHTHOUSE_API_KEY).",
          provider: IPFS_PROVIDER || null,
          uploadUrls: IPFS_UPLOAD_URLS,
        },
        { status: 500 }
      )
    }

    const body = await request.json()
    const buildHash = String(body?.buildHash || "").trim().toLowerCase()
    const screenshotDataUrl = String(body?.screenshotDataUrl || "").trim()
    const tokenHint = String(body?.tokenHint || "").trim()

    if (!/^0x[0-9a-f]{64}$/.test(buildHash)) {
      return NextResponse.json({ error: "Invalid buildHash" }, { status: 400 })
    }
    const m = screenshotDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (!m) {
      return NextResponse.json({ error: "Invalid screenshotDataUrl" }, { status: 400 })
    }

    const mime = m[1].toLowerCase()
    const base64 = m[2]
    const bytes = Buffer.from(base64, "base64")
    if (!bytes.length) {
      return NextResponse.json({ error: "Empty screenshot bytes" }, { status: 400 })
    }

    const ext =
      mime.includes("png")
        ? "png"
        : mime.includes("jpeg") || mime.includes("jpg")
          ? "jpg"
          : mime.includes("webp")
            ? "webp"
            : "png"
    const imageFileName = `${tokenHint || "preview"}.${ext}`

    const uploadRes = await uploadToIpfsWithRetry(() => {
      const formData = new FormData()
      appendProviderUploadOptions(formData)
      const blob = new Blob([bytes], { type: mime })
      formData.append("file", blob, imageFileName)
      return formData
    })
    const uploadData = await uploadRes.json()
    const cid = uploadData.IpfsHash || uploadData.Hash
    if (!cid) {
      return NextResponse.json({ error: "IPFS image upload response missing CID" }, { status: 502 })
    }

    const now = new Date().toISOString()
    await redis.set(PREFLIGHT_KEY(buildHash), {
      imageCid: String(cid),
      imagePath: imageFileName,
      imageUri: `ipfs://${cid}/${imageFileName}`,
      tokenHint: tokenHint || null,
      createdAt: now,
      gatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}/${imageFileName}`,
    })

    return NextResponse.json({
      success: true,
      buildHash,
      imageCid: String(cid),
      imagePath: imageFileName,
      imageUri: `ipfs://${cid}/${imageFileName}`,
      gatewayUrl: `${IPFS_GATEWAY_BASE}/${cid}/${imageFileName}`,
      createdAt: now,
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err?.message || "preflight failed",
        provider: IPFS_PROVIDER || null,
        uploadUrls: IPFS_UPLOAD_URLS,
      },
      { status: 500 }
    )
  }
}
