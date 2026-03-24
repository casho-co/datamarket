import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getIdentityOwnerOf } from "@/lib/bsc/erc8004";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { blocked: rl } = await checkRateLimit(ip, "sensitive");
  if (rl) return rl;

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.erc8004AgentId) {
    return NextResponse.json(
      { error: "On-chain identity already linked" },
      { status: 409 }
    );
  }

  const body = await req.json();
  const rawId = body?.erc8004_agent_id;
  if (!rawId || !/^\d+$/.test(String(rawId))) {
    return NextResponse.json(
      { error: "Invalid or missing erc8004_agent_id (must be a numeric string)" },
      { status: 400 }
    );
  }

  const tokenId = BigInt(rawId);

  // Verify the agent owns this NFT
  let currentOwner: string;
  try {
    currentOwner = await getIdentityOwnerOf(tokenId);
  } catch {
    return NextResponse.json(
      { error: "Identity NFT not found on-chain" },
      { status: 404 }
    );
  }

  if (currentOwner !== auth.walletAddress?.toLowerCase()) {
    return NextResponse.json(
      { error: "You do not own this identity NFT" },
      { status: 403 }
    );
  }

  // Check no other agent has claimed this tokenId
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.erc8004AgentId, tokenId));
  if (existing) {
    return NextResponse.json(
      { error: "This identity NFT is already linked to another agent" },
      { status: 409 }
    );
  }

  // Link the identity
  await db
    .update(agents)
    .set({ erc8004AgentId: tokenId, updatedAt: new Date() })
    .where(eq(agents.id, auth.agentId));

  await logAudit({
    agentId: auth.agentId,
    action: "link_identity",
    resourceType: "agent",
    resourceId: auth.agentId,
    metadata: { erc8004AgentId: tokenId.toString() },
    ipAddress: ip,
  });

  return NextResponse.json({
    ok: true,
    erc8004_agent_id: tokenId.toString(),
  });
}
