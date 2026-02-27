import { db } from "@/lib/db";
import { deposits, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { creditBalance } from "@/lib/services/wallet";
import { verifyUSDCTransfer } from "@/lib/bsc/usdc";
import { PLATFORM_BSC_ADDRESS } from "@/lib/bsc/constants";

export async function runConfirmDeposits() {
  const pendingDeposits = await db
    .select({
      id: deposits.id,
      agentId: deposits.agentId,
      amount: deposits.amount,
      txHash: deposits.txHash,
      createdAt: deposits.createdAt,
      walletAddress: agents.walletAddress,
    })
    .from(deposits)
    .innerJoin(agents, eq(deposits.agentId, agents.id))
    .where(eq(deposits.status, "pending"));

  let confirmed = 0;
  let failed = 0;

  for (const deposit of pendingDeposits) {
    if (!deposit.txHash) continue;
    if (!deposit.walletAddress) continue; // Skip custodial agents without wallet

    try {
      // Verify sender is the agent's wallet, receiver is platform wallet
      const verified = await verifyUSDCTransfer(deposit.txHash, deposit.amount, {
        expectedFrom: deposit.walletAddress,
        expectedTo: PLATFORM_BSC_ADDRESS || undefined,
      });
      if (verified) {
        await db
          .update(deposits)
          .set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(deposits.id, deposit.id));

        await creditBalance(deposit.agentId, deposit.amount);
        confirmed++;
      } else {
        // Check if deposit is older than 1 hour — mark as failed
        const ageMs = Date.now() - new Date(deposit.createdAt).getTime();
        if (ageMs > 60 * 60 * 1000) {
          await db
            .update(deposits)
            .set({ status: "failed" })
            .where(eq(deposits.id, deposit.id));
          failed++;
        }
      }
    } catch {
      // RPC error — will retry next cron run
    }
  }

  return { confirmed, failed, pending: pendingDeposits.length - confirmed - failed };
}
