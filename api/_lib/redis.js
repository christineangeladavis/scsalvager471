// Shared Upstash Redis client — lazy init, reused across all API routes.
import { Redis } from "@upstash/redis";

let redisInstance = null;
let redisInitError = null;

export function getRedis() {
  if (redisInstance) return redisInstance;
  if (redisInitError) throw redisInitError;

  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    redisInitError = new Error(
      "Upstash Redis is not configured. In your Vercel project, go to Storage → Create Database → Upstash for Redis, connect it to the project, then redeploy."
    );
    throw redisInitError;
  }

  try {
    redisInstance = new Redis({ url, token });
    return redisInstance;
  } catch (e) {
    redisInitError = new Error(
      "Failed to initialize Upstash Redis client: " + (e && e.message ? e.message : String(e))
    );
    throw redisInitError;
  }
}
