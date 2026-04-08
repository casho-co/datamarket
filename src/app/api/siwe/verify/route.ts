import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { parseSiweMessage, validateSiweMessage, type SiweMessage } from "viem/siwe";
import { getRedis } from "@/lib/redis";
import { createSessionToken } from "@/lib/auth/jwt";
import { DEFAULT_SCOPES } from "@/lib/auth/scopes";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { registerAgent } from "@/lib/services/agent";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(`siwe-verify:${ip}`, "auth");
  if (rl) return rl;

  try {
    const { message, signature } = await req.json();
    if (!message || !signature) {
      return withRateLimitHeaders(
        NextResponse.json({ error: "Missing message or signature" }, { status: 400 }),
        rlHeaders,
      );
    }

    // Step 1: Parse SIWE message
    const siweMessage = parseSiweMessage(message) as SiweMessage;
    if (!siweMessage.address || !siweMessage.nonce) {
      console.error("[siwe] Failed to parse message — missing address or nonce");
      return withRateLimitHeaders(
        NextResponse.json({ error: "Invalid SIWE message" }, { status: 400 }),
        rlHeaders,
      );
    }

    // Step 2: Validate nonce exists in Redis (one-time use)
    const redis = getRedis();
    const nonceKey = `siwe:nonce:${siweMessage.nonce}`;
    const nonceExists = await redis.get(nonceKey);
    if (!nonceExists) {
      console.error("[siwe] Invalid or expired nonce:", siweMessage.nonce);
      return withRateLimitHeaders(
        NextResponse.json({ error: "Invalid or expired nonce" }, { status: 422 }),
        rlHeaders,
      );
    }

    // Step 3: Validate SIWE message fields (domain, scheme, address, expiration)
    if (!process.env.NEXT_PUBLIC_BASE_URL) {
      throw new Error("NEXT_PUBLIC_BASE_URL environment variable is required");
    }
    const baseUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL);
    const isValid = validateSiweMessage({
      message: siweMessage,
      domain: baseUrl.host,
      // Only validate scheme if the message includes one (viem omits it when not passed)
      ...(siweMessage.scheme ? { scheme: baseUrl.protocol.replace(":", "") } : {}),
    });
    if (!isValid) {
      console.error("[siwe] SIWE message validation failed", {
        domain: siweMessage.domain,
        expectedDomain: baseUrl.host,
        scheme: siweMessage.scheme,
        expectedScheme: baseUrl.protocol.replace(":", ""),
      });
      return withRateLimitHeaders(
        NextResponse.json({ error: "Invalid SIWE message" }, { status: 422 }),
        rlHeaders,
      );
    }

    // Step 4: Verify signature via local ECDSA recovery (no RPC call needed)
    const recoveredAddress = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });

    if (recoveredAddress.toLowerCase() !== siweMessage.address.toLowerCase()) {
      console.error("[siwe] Signature mismatch", {
        recovered: recoveredAddress,
        expected: siweMessage.address,
      });
      return withRateLimitHeaders(
        NextResponse.json({ error: "Invalid signature" }, { status: 401 }),
        rlHeaders,
      );
    }

    const walletAddress = siweMessage.address.toLowerCase();

    // Look up agent by wallet address
    let [agent] = await db
      .select({ id: agents.id, walletAddress: agents.walletAddress, handle: agents.handle, erc8004AgentId: agents.erc8004AgentId })
      .from(agents)
      .where(sql`lower(${agents.walletAddress}) = ${walletAddress}`);

    // Auto-register if not found
    if (!agent) {
      const handle = `agent_${walletAddress.slice(2, 10).toLowerCase()}`;
      const result = await registerAgent({
        walletAddress,
        handle,
      });

      await logAudit({
        agentId: result.agentId,
        action: "register",
        resourceType: "agent",
        resourceId: result.agentId,
        metadata: { walletAddress, method: "siwe" },
        ipAddress: ip,
      });

      agent = { id: result.agentId, walletAddress: result.walletAddress, handle, erc8004AgentId: null };
    }

    // Step 5: Consume nonce AFTER all DB writes succeed (one-time use)
    // If registration fails above, user can retry with the same nonce
    await redis.del(nonceKey);

    // Create JWT session token
    const accessToken = await createSessionToken({
      agentId: agent.id,
      walletAddress: agent.walletAddress!,
      scopes: [...DEFAULT_SCOPES],
    });

    await logAudit({
      agentId: agent.id,
      action: "login",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: { walletAddress, method: "siwe" },
      ipAddress: ip,
    });

    return withRateLimitHeaders(
      NextResponse.json({
        ok: true,
        access_token: accessToken,
        agent_id: agent.id,
        wallet_address: agent.walletAddress,
        handle: agent.handle,
        erc8004_agent_id: agent.erc8004AgentId?.toString() || null,
      }),
      rlHeaders,
    );
  } catch (err) {
    console.error("[siwe] Verify error:", err);
    return withRateLimitHeaders(
      NextResponse.json({ error: "Verification failed" }, { status: 500 }),
      rlHeaders,
    );
  }
}
