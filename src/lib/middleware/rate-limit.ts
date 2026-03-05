import { NextResponse } from "next/server";
import { rateLimit, type RateLimitTier } from "@/lib/redis";

function buildHeaders(remaining: number, reset: number): Record<string, string> {
  const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return {
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": new Date(reset).toISOString(),
    "Retry-After": String(retryAfter),
  };
}

/** Attach rate-limit headers to any NextResponse (mutates in place, returns same ref). */
export function withRateLimitHeaders<T extends NextResponse>(
  res: T,
  headers: Record<string, string> = {}
): T {
  for (const [k, v] of Object.entries(headers)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier
): Promise<{ blocked: NextResponse | null; headers: Record<string, string> }> {
  try {
    const { success, remaining, reset } = await rateLimit(identifier, tier);
    const headers = buildHeaders(remaining, reset);
    if (!success) {
      return {
        blocked: NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429, headers }
        ),
        headers,
      };
    }
    return { blocked: null, headers };
  } catch {
    // If Redis is down, reject the request (fail closed)
    return {
      blocked: NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      ),
      headers: {},
    };
  }
}
