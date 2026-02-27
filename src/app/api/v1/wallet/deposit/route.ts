import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { depositSchema } from "@/lib/validators";
import { db } from "@/lib/db";
import { agents, deposits } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { creditBalance } from "@/lib/services/wallet";
import { verifyUSDCTransfer } from "@/lib/bsc/usdc";
import { PLATFORM_BSC_ADDRESS } from "@/lib/bsc/constants";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";

export const POST = validatedRoute(
  { body: depositSchema },
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

    // Look up the agent's registered wallet address for sender verification
    const [agent] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, auth.agentId));

    if (!agent?.walletAddress) {
      return NextResponse.json(
        { error: "Agent wallet address not found" },
        { status: 400 }
      );
    }

    const [deposit] = await db
      .insert(deposits)
      .values({
        agentId: auth.agentId,
        amount: body.amount,
        txHash: body.tx_hash,
      })
      .onConflictDoNothing()
      .returning();

    if (!deposit) {
      return NextResponse.json(
        { error: "Transaction already processed" },
        { status: 409 }
      );
    }

    await logAudit({
      agentId: auth.agentId,
      action: "deposit",
      resourceType: "wallet",
      resourceId: deposit.id,
      metadata: { txHash: body.tx_hash, amount: body.amount },
      ipAddress: ip,
    });

    try {
      // Verify: sender must be this agent's wallet, receiver must be platform wallet
      const verified = await verifyUSDCTransfer(
        body.tx_hash as `0x${string}`,
        body.amount,
        {
          expectedFrom: agent.walletAddress,
          expectedTo: PLATFORM_BSC_ADDRESS || undefined,
        }
      );
      if (verified) {
        await db
          .update(deposits)
          .set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(deposits.id, deposit.id));

        await creditBalance(auth.agentId, body.amount);

        return NextResponse.json({
          deposit_id: deposit.id,
          status: "confirmed",
          amount: body.amount,
          next_actions: getNextActions("deposited"),
        });
      }
    } catch {
      // Verification may fail if RPC is down; mark as pending for cron retry
    }

    return NextResponse.json({
      deposit_id: deposit.id,
      status: "pending",
      amount: body.amount,
      message: "Deposit recorded and will be verified shortly",
      next_actions: getNextActions("deposited"),
    });
  }
);
