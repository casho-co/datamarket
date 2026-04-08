import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { escrows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getOnChainEscrow,
  OnChainEscrowState,
} from "@/lib/bsc/escrow-contract";
import { ESCROW_CONTRACT_ADDRESS } from "@/lib/bsc/constants";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const STATE_LABELS: Record<OnChainEscrowState, string> = {
  [OnChainEscrowState.NONE]: "none",
  [OnChainEscrowState.FUNDED]: "funded",
  [OnChainEscrowState.SUBMITTED]: "submitted",
  [OnChainEscrowState.DISPUTED]: "disputed",
  [OnChainEscrowState.RELEASED]: "released",
  [OnChainEscrowState.REFUNDED]: "refunded",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { escrowId } = await params;

  // Get DB record
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrowId));

  if (!escrow) {
    return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
  }

  // Only parties involved can view
  if (
    escrow.funderAgentId !== auth.agentId &&
    escrow.recipientAgentId !== auth.agentId
  ) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const response: Record<string, unknown> = {
    escrow_id: escrow.id,
    status: escrow.status,
    amount: escrow.amount,
    funder_agent_id: escrow.funderAgentId,
    recipient_agent_id: escrow.recipientAgentId,
    on_chain_tx_hash: escrow.onChainTxHash,
    release_tx_hash: escrow.releaseTxHash,
    funded_at: escrow.fundedAt,
    released_at: escrow.releasedAt,
    refunded_at: escrow.refundedAt,
  };

  // Fetch on-chain contract state
  if (ESCROW_CONTRACT_ADDRESS) {
    try {
      const onChain = await getOnChainEscrow(escrowId);
      response.on_chain_state = {
        state: STATE_LABELS[onChain.state] || "unknown",
        buyer: onChain.buyer,
        seller: onChain.seller,
        token: onChain.token,
        amount_wei: onChain.amount.toString(),
        created_at: Number(onChain.createdAt),
        deadline: Number(onChain.deadline),
        submitted_at: Number(onChain.submittedAt),
        dispute_window_hours: Number(onChain.disputeWindowHours),
        deliverable_hash: onChain.deliverableHash,
      };
    } catch {
      response.on_chain_state = null;
      response.on_chain_error = "Could not read contract state";
    }
  }

  return NextResponse.json(response);
}
