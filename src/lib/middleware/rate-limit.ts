import { NextResponse } from "next/server";
import { rateLimit, type RateLimitTier } from "@/lib/redis";

// Store rate-limit metadata so route handlers can attach headers to their responses
let _lastRateLimitInfo: { remaining: number; reset: number } | null = null;

export function getRateLimitHeaders(): Record<string, string> {
  if (!_lastRateLimitInfo) return {};
  const retryAfter = Math.max(
    0,
    Math.ceil((_lastRateLimitInfo.reset - Date.now()) / 1000)
  );
  return {
    "X-RateLimit-Remaining": String(_lastRateLimitInfo.remaining),
    "X-RateLimit-Reset": new Date(_lastRateLimitInfo.reset).toISOString(),
    "Retry-After": String(retryAfter),
  };
}

/** Attach rate-limit headers to any NextResponse (mutates in place, returns same ref). */
export function withRateLimitHeaders<T extends NextResponse>(res: T): T {
  const hdrs = getRateLimitHeaders();
  for (const [k, v] of Object.entries(hdrs)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier
): Promise<NextResponse | null> {
  try {
    const { success, remaining, reset } = await rateLimit(identifier, tier);
    _lastRateLimitInfo = { remaining, reset };
    if (!success) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: getRateLimitHeaders(),
        }
      );
    }
    return null; // proceed
  } catch {
    // If Redis is down, allow the request (fail open)
    _lastRateLimitInfo = null;
    return null;
  }
}
