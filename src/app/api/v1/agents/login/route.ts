import { NextRequest, NextResponse } from "next/server";
import { validatedRoute } from "@/lib/utils/validated-route";
import { loginSchema } from "@/lib/validators";
import { verifyChallenge } from "@/lib/services/challenge";
import { createSessionToken } from "@/lib/auth/jwt";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { DEFAULT_SCOPES } from "@/lib/auth/scopes";

export const POST = validatedRoute(
  { body: loginSchema },
  async (req: NextRequest, { body }) => {
    const ip = getClientIp(req);
    const { blocked: rl } = await checkRateLimit(ip, "auth");
    if (rl) return rl;

    try {
      // Verify EIP-712 signature against stored challenge
      const verification = await verifyChallenge(
        body.wallet_address,
        body.nonce,
        body.signature,
        "login"
      );

      if (!verification.valid) {
        return NextResponse.json(
          { error: verification.error || "Wallet verification failed" },
          { status: 401 }
        );
      }

      // Look up agent by wallet address
      const [agent] = await db
        .select({
          id: agents.id,
          walletAddress: agents.walletAddress,
          handle: agents.handle,
        })
        .from(agents)
        .where(sql`lower(${agents.walletAddress}) = ${body.wallet_address.toLowerCase()}`);

      if (!agent) {
        return NextResponse.json(
          { error: "Agent not found. Register first via POST /api/v1/agents/register" },
          { status: 404 }
        );
      }

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
        metadata: { walletAddress: body.wallet_address },
        ipAddress: ip,
      });

      return NextResponse.json({
        access_token: accessToken,
        token_type: "bearer",
        agent_id: agent.id,
        wallet_address: agent.walletAddress,
        handle: agent.handle,
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
