import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export type IdempotencyResult =
  | { status: "new" }
  | { status: "replayed"; response: NextResponse }
  | { status: "concurrent" };

/**
 * Check idempotency key for POST requests.
 * Returns cached response if key was seen before, or locks for 60s.
 */
export async function checkIdempotency(
  key: string
): Promise<IdempotencyResult> {
  if (!key || key.length < 8 || key.length > 128) {
    return { status: "new" }; // No valid key, treat as new
  }

  try {
    const redis = getRedis();

    // Check for cached response
    const cached = await redis.get<string>(`idem:${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        status: "replayed",
        response: NextResponse.json(parsed.body, {
          status: parsed.status,
          headers: { "X-Idempotent-Replayed": "true" },
        }),
      };
    }

    // Lock for 60s to prevent concurrent processing
    const locked = await redis.set(`idem:lock:${key}`, "1", {
      nx: true,
      ex: 60,
    });
    if (!locked) {
      return { status: "concurrent" };
    }

    return { status: "new" };
  } catch {
    // Fail closed — reject if Redis is down
    return { status: "concurrent" };
  }
}

/**
 * Store the response for an idempotency key (24h TTL)
 */
export async function storeIdempotency(
  key: string,
  body: unknown,
  status: number
): Promise<void> {
  if (!key || key.length < 8) return;

  try {
    const redis = getRedis();
    await redis.set(`idem:${key}`, JSON.stringify({ body, status }), {
      ex: 86400,
    });
    await redis.del(`idem:lock:${key}`);
  } catch {
    // Best-effort
  }
}

/**
 * Extract idempotency key from request header
 */
export function getIdempotencyKey(req: Request): string | null {
  return req.headers.get("Idempotency-Key");
}
