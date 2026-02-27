import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

function createRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = createRedis();
  }
  return _redis;
}

// Lazy-initialized rate limiters
let _rateLimiters: Record<string, Ratelimit> | null = null;

function getRateLimiters() {
  if (!_rateLimiters) {
    const redis = getRedis();
    _rateLimiters = {
      api: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, "60 s"),
        prefix: "rl:api",
      }),
      sensitive: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "60 s"),
        prefix: "rl:sensitive",
      }),
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(10, "60 s"),
        prefix: "rl:auth",
      }),
    };
  }
  return _rateLimiters;
}

export type RateLimitTier = "api" | "sensitive" | "auth";

export async function rateLimit(identifier: string, tier: RateLimitTier) {
  const limiters = getRateLimiters();
  return limiters[tier].limit(identifier);
}
