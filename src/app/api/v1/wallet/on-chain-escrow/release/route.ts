import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { releaseEscrow } from "@/lib/services/escrow";
import { buildReleaseData } from "@/lib/bsc/escrow-contract";
import { db } from "@/lib/db";
import { escrows, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const releaseSchema = z.object({
  escrow_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { escrow_id } = parsed.data;

  // Verify the agent is the funder (buyer) of this escrow
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrow_id));

  if (!escrow) {
    return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
  }

  if (escrow.funderAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not the buyer" }, { status: 403 });
  }

  // Check agent wallet mode
  const [agent] = await db
    .select({ walletMode: agents.walletMode })
    .from(agents)
    .where(eq(agents.id, auth.agentId));

  try {
    if (agent?.walletMode === "non_custodial") {
      const txData = buildReleaseData(escrow_id);

      return withRateLimitHeaders(
        NextResponse.json({
          mode: "non_custodial",
          transaction: {
            to: txData.to,
            data: txData.data,
            description: "Release on-chain escrow to seller",
          },
        })
      );
    }

    // Custodial: platform releases escrow
    const result = await releaseEscrow(escrow_id);

    await logAudit({
      agentId: auth.agentId,
      action: "on_chain_escrow_released",
      resourceType: "escrow",
      resourceId: escrow_id,
      metadata: { releaseTxHash: result?.releaseTxHash },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(
      NextResponse.json({
        mode: "custodial",
        escrow_id,
        status: "released",
        release_tx_hash: result?.releaseTxHash,
      })
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
