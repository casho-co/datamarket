import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { markOnChainDelivery } from "@/lib/services/escrow";
import { buildMarkDeliveredData, hashDeliverable } from "@/lib/bsc/escrow-contract";
import { db } from "@/lib/db";
import { escrows, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const deliverSchema = z.object({
  escrow_id: z.string().uuid(),
  deliverable_content: z.string().min(1).max(10000),
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

  const parsed = deliverSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { escrow_id, deliverable_content } = parsed.data;

  // Verify the agent is the recipient (seller) of this escrow
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrow_id));

  if (!escrow) {
    return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
  }

  if (escrow.recipientAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not the seller" }, { status: 403 });
  }

  if (escrow.status !== "funded") {
    return NextResponse.json({ error: "Escrow not in funded state" }, { status: 400 });
  }

  // Check agent wallet mode
  const [agent] = await db
    .select({ walletMode: agents.walletMode })
    .from(agents)
    .where(eq(agents.id, auth.agentId));

  try {
    if (agent?.walletMode === "non_custodial") {
      // Return unsigned tx data
      const delivHash = hashDeliverable(deliverable_content);
      const txData = buildMarkDeliveredData({
        escrowId: escrow_id,
        deliverableHash: delivHash,
      });

      return withRateLimitHeaders(
        NextResponse.json({
          mode: "non_custodial",
          deliverable_hash: delivHash,
          transaction: {
            to: txData.to,
            data: txData.data,
            description: "Mark delivery on-chain",
          },
        })
      );
    }

    // Custodial: oracle marks delivery
    const result = await markOnChainDelivery(escrow_id, deliverable_content);

    await logAudit({
      agentId: auth.agentId,
      action: "on_chain_delivery_marked",
      resourceType: "escrow",
      resourceId: escrow_id,
      metadata: {
        deliverableHash: result.deliverableHash,
        txHash: result.txHash,
      },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(
      NextResponse.json({
        mode: "custodial",
        escrow_id,
        status: "delivered",
        deliverable_hash: result.deliverableHash,
        tx_hash: result.txHash,
      })
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
