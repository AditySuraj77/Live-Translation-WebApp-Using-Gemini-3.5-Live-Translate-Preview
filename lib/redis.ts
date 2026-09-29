import { Redis } from "@upstash/redis";

let redisInstance: Redis | null = null;

export function getRedis(): Redis | null {
  if (redisInstance) return redisInstance;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      redisInstance = new Redis({ url, token });
      return redisInstance;
    } catch (err) {
      console.warn("[Redis] Failed to initialize Upstash Redis client:", err);
      return null;
    }
  } else {
    console.warn('[Redis] ⚠️ UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured. Running in degraded in-memory-only mode. Room state will NOT sync across serverless instances.');
  }

  return null;
}
