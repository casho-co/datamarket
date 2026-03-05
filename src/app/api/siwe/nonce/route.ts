import { NextRequest, NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";

// Nonce TTL: 5 minutes
const NONCE_TTL = 300;

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(`siwe-nonce:${ip}`, "auth");
  if (rl) return rl;

  const nonce = generateSiweNonce();

  // Store nonce in Redis so we can validate it in /verify
  const redis = getRedis();
  await redis.set(`siwe:nonce:${nonce}`, "1", { ex: NONCE_TTL });

  return withRateLimitHeaders(
    new NextResponse(nonce, { headers: { "Content-Type": "text/plain" } }),
    rlHeaders,
  );
}
