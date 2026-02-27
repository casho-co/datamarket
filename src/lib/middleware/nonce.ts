import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

/**
 * Replay protection for sensitive endpoints (award, deposit, withdraw, dispute).
 * Nonce format: any unique string (recommend uuid:timestamp_ms)
 * Window: 5 minutes. Same nonce rejected within window.
 */
export async function validateNonce(
  agentId: string,
  nonce: string
): Promise<NextResponse | null> {
  if (!nonce || nonce.length < 8 || nonce.length > 128) {
    return NextResponse.json(
      { error: "Invalid nonce format" },
      { status: 400 }
    );
  }

  // Optional: check timestamp if nonce contains one
  const parts = nonce.split(":");
  if (parts.length === 2) {
    const ts = parseInt(parts[1], 10);
    if (!isNaN(ts) && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: "Nonce expired (>5 min)" },
        { status: 400 }
      );
    }
  }

  try {
    const redis = getRedis();
    const key = `nonce:${agentId}:${nonce}`;
    const set = await redis.set(key, "1", { nx: true, ex: 300 });
    if (set !== "OK") {
      return NextResponse.json(
        { error: "Duplicate nonce — possible replay" },
        { status: 409 }
      );
    }
    return null; // proceed
  } catch {
    // If Redis is down, allow (fail open) but log
    return null;
  }
}

/**
 * Extract nonce from request header
 */
export function getNonce(req: Request): string | null {
  return req.headers.get("X-Request-Nonce");
}
