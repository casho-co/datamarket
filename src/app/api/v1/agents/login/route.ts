import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyPrivyToken } from "@/lib/auth/privy";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { getClientIp, logAudit } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, "auth");
  if (rl) return rl;

  let body: { privy_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.privy_token) {
    return NextResponse.json(
      { error: "privy_token is required" },
      { status: 400 }
    );
  }

  try {
    const { privyId } = await verifyPrivyToken(body.privy_token);

    const [agent] = await db
      .select({
        id: agents.id,
        handle: agents.handle,
        walletAddress: agents.walletAddress,
        walletMode: agents.walletMode,
      })
      .from(agents)
      .where(eq(agents.privyUserId, privyId));

    if (!agent) {
      return NextResponse.json(
        { error: "No agent registered with this Privy account" },
        { status: 404 }
      );
    }

    await logAudit({
      agentId: agent.id,
      action: "login",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: { mode: "privy" },
      ipAddress: ip,
    });

    return withRateLimitHeaders(NextResponse.json({
      agent_id: agent.id,
      handle: agent.handle,
      wallet_address: agent.walletAddress,
      wallet_mode: agent.walletMode,
      message: "Use your Privy token as Bearer token for API calls",
      next_actions: getNextActions("registered"),
    }));
  } catch {
    return NextResponse.json(
      { error: "Invalid Privy token" },
      { status: 401 }
    );
  }
}
