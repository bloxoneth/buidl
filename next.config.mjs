import { fileURLToPath } from "url"
import { dirname } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/cron/marketplace-retry": [
      "./scripts/**/*",
      "./node_modules/@upstash/redis/**/*",
      "./node_modules/ethers/**/*",
      "./node_modules/@noble/**/*",
      "./node_modules/@adraffy/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/tslib/**/*",
    ],
    "/api/builds/marketplace-publish/[tokenId]": [
      "./scripts/**/*",
      "./node_modules/@upstash/redis/**/*",
      "./node_modules/ethers/**/*",
      "./node_modules/@noble/**/*",
      "./node_modules/@adraffy/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/tslib/**/*",
    ],
    "/api/builds/marketplace-retry": [
      "./scripts/**/*",
      "./node_modules/@upstash/redis/**/*",
      "./node_modules/ethers/**/*",
      "./node_modules/@noble/**/*",
      "./node_modules/@adraffy/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/tslib/**/*",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
              "worker-src 'self' blob:",
              "child-src 'self' blob: https://*.vercel.app https://dweb.link https://*.ipfs.dweb.link https://ipfs.io https://gateway.pinata.cloud",
              "frame-src 'self' blob: https://*.vercel.app https://dweb.link https://*.ipfs.dweb.link https://ipfs.io https://gateway.pinata.cloud",
              "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://gateway.pinata.cloud https://gateway.lighthouse.storage https://*.lighthouse.storage https://ipfs.io https://dweb.link",
              "media-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://gateway.pinata.cloud https://gateway.lighthouse.storage https://*.lighthouse.storage https://ipfs.io https://dweb.link",
              "connect-src 'self' blob: https://api.pinata.cloud https://gateway.pinata.cloud https://gateway.lighthouse.storage https://api.lighthouse.storage https://node.lighthouse.storage https://lighthouse.storage https://*.lighthouse.storage https://ipfs.io https://dweb.link https://sepolia.base.org http://127.0.0.1:8545 http://localhost:8545",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
