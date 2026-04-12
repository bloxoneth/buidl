import { Redis } from "@upstash/redis"

const redisUrl = (process.env.KV_REST_API_URL || "").trim()
const redisToken = (process.env.KV_REST_API_TOKEN || "").trim()

export const redis = new Redis({
  url: redisUrl,
  token: redisToken,
})

export function getRedis() {
  return redis
}
