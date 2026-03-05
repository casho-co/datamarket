import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { db } from "@/lib/db";
import { escrows } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { getOnChainEscrow, OnChainEscrowState } from "@/lib/bsc/escrow-contract";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const confirmSchema = z.object({
  escrow_id: z.string().uuid(),
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash"),
});

/**
 * POST /api/v1/wallet/on-chain-escrow/confirm
 *
 * Non-custodial agents call this after signing and submitting the createEscrow tx.
 * The platform verifies the escrow exists on-chain (state = FUNDED) before
 * marking the DB record as confirmed (setting onChainTxHash).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { escrow_id, tx_hash } = parsed.data;

  // Get the pending escrow record (all escrows are on-chain now)
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.id, escrow_id),
        isNull(escrows.onChainTxHash)
      )
    );

  if (!escrow) {
    return NextResponse.json(
      { error: "Pending on-chain escrow not found" },
      { status: 404 }
    );
  }

  // Only the funder can confirm
  if (escrow.funderAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not the funder" }, { status: 403 });
  }

  try {
    // Verify on-chain: read the escrow from the smart contract
    const onChain = await getOnChainEscrow(escrow_id);

    if (onChain.state === OnChainEscrowState.NONE) {
      return NextResponse.json(
        { error: "Escrow not found on-chain. Ensure the transaction is confirmed." },
        { status: 400 }
      );
    }

    if (onChain.state !== OnChainEscrowState.FUNDED) {
      return NextResponse.json(
        { error: `Unexpected on-chain state: ${onChain.state}` },
        { status: 400 }
      );
    }

    // Update DB with confirmed tx hash
    const [updated] = await db
      .update(escrows)
      .set({ onChainTxHash: tx_hash })
      .where(
        and(
          eq(escrows.id, escrow_id),
          isNull(escrows.onChainTxHash) // Prevent double-confirm race
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Escrow already confirmed" },
        { status: 409 }
      );
    }

    await logAudit({
      agentId: auth.agentId,
      action: "on_chain_escrow_confirmed",
      resourceType: "escrow",
      resourceId: escrow_id,
      metadata: { txHash: tx_hash },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(
      NextResponse.json({
        escrow_id,
        status: "confirmed",
        tx_hash,
        message: "On-chain escrow verified and confirmed.",
      })
    , rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
