import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { db } from "@/lib/db";
import { disputes, escrows, assignments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOnChainEscrow, OnChainEscrowState } from "@/lib/bsc/escrow-contract";
import { getPublicClient } from "@/lib/bsc/client";
import { ESCROW_CONTRACT_ADDRESS } from "@/lib/bsc/constants";
import { type Hex } from "viem";
import { z } from "zod";

const confirmDisputeTxSchema = z.object({
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const { disputeId } = await params;

  let body: z.infer<typeof confirmDisputeTxSchema>;
  try {
    const raw = await req.json();
    const parsed = confirmDisputeTxSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // 1. Find the dispute
    const [dispute] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId));
    if (!dispute) {
      return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    }

    // 2. Verify caller is the dispute opener
    if (dispute.openerAgentId !== auth.agentId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // 3. Get the escrow to check on-chain state
    if (!dispute.assignmentId) {
      return NextResponse.json({ error: "No assignment linked" }, { status: 400 });
    }
    const [escrow] = await db
      .select()
      .from(escrows)
      .where(eq(escrows.assignmentId, dispute.assignmentId));
    if (!escrow) {
      return NextResponse.json({ error: "Escrow not found" }, { status: 400 });
    }

    // 4. Verify tx on-chain
    const publicClient = getPublicClient();
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: body.tx_hash as Hex });
    } catch {
      return NextResponse.json({ error: "Transaction not found on-chain" }, { status: 400 });
    }
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction failed on-chain" }, { status: 400 });
    }
    if (receipt.to?.toLowerCase() !== ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "Transaction does not target escrow contract" }, { status: 400 });
    }

    // 5. Verify on-chain escrow is now in disputed state
    const onChainEscrow = await getOnChainEscrow(escrow.refId);
    if (onChainEscrow.state !== OnChainEscrowState.DISPUTED) {
      return NextResponse.json(
        { error: "On-chain escrow not in disputed state. Transaction may not have called dispute()." },
        { status: 400 }
      );
    }

    await logAudit({
      agentId: auth.agentId,
      action: "confirm_dispute_tx",
      resourceType: "dispute",
      resourceId: disputeId,
      metadata: { txHash: body.tx_hash, escrowRefId: escrow.refId },
      ipAddress: getClientIp(req),
    });

    // 6. On-chain dispute confirmed — no additional DB update needed
    // The escrow is already marked "disputed" in the DB from openDispute()

    return NextResponse.json({
      dispute_id: disputeId,
      status: "confirmed",
      message: "Dispute confirmed on-chain. AI resolver will process it shortly.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Confirmation failed" },
      { status: 500 }
    );
  }
}
