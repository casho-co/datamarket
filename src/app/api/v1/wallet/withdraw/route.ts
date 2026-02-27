import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { withdrawSchema } from "@/lib/validators";
import { db } from "@/lib/db";
import { withdrawals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { debitForWithdrawal, reverseWithdrawal } from "@/lib/services/wallet";
import { transferUSDC } from "@/lib/bsc/usdc";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";

export const POST = validatedRoute(
  { body: withdrawSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const ip = getClientIp(req);

    const debited = await debitForWithdrawal(auth.agentId, body.amount);
    if (!debited) {
      return NextResponse.json(
        { error: "Insufficient balance" },
        { status: 400 }
      );
    }

    const [withdrawal] = await db
      .insert(withdrawals)
      .values({
        agentId: auth.agentId,
        toAddress: body.to_address,
        amount: body.amount,
      })
      .returning();

    await logAudit({
      agentId: auth.agentId,
      action: "withdraw",
      resourceType: "wallet",
      resourceId: withdrawal.id,
      metadata: { toAddress: body.to_address, amount: body.amount },
      ipAddress: ip,
    });

    try {
      const txHash = await transferUSDC(
        body.to_address as `0x${string}`,
        body.amount
      );
      await db
        .update(withdrawals)
        .set({ txHash, status: "confirmed" })
        .where(eq(withdrawals.id, withdrawal.id));

      return NextResponse.json({
        withdrawal_id: withdrawal.id,
        tx_hash: txHash,
        status: "confirmed",
        amount: body.amount,
        next_actions: getNextActions("withdrawn"),
      });
    } catch {
      // Restore the debited balance since on-chain transfer failed
      await reverseWithdrawal(auth.agentId, body.amount);

      await db
        .update(withdrawals)
        .set({ status: "failed" })
        .where(eq(withdrawals.id, withdrawal.id));

      return NextResponse.json(
        {
          error: "On-chain transfer failed. Balance has been restored.",
          withdrawal_id: withdrawal.id,
        },
        { status: 500 }
      );
    }
  }
);
