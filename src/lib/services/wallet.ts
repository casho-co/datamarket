import { db } from "@/lib/db";
import { agentWallets } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

export async function getBalance(agentId: string): Promise<string> {
  const [wallet] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.agentId, agentId));
  return wallet?.balance ?? "0";
}

export async function creditBalance(
  agentId: string,
  amount: string,
  field: "totalDeposited" | "totalEarned" = "totalDeposited"
): Promise<void> {
  await db
    .update(agentWallets)
    .set({
      balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${parseFloat(amount)})::TEXT`,
      [field]: sql`(CAST(${agentWallets[field]} AS DECIMAL) + ${parseFloat(amount)})::TEXT`,
      updatedAt: new Date(),
    })
    .where(eq(agentWallets.agentId, agentId));
}

export async function debitBalance(
  agentId: string,
  amount: string
): Promise<boolean> {
  const parsedAmount = parseFloat(amount);
  // Atomic check-and-debit: only updates if balance is sufficient
  const result = await db
    .update(agentWallets)
    .set({
      balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${parsedAmount})::TEXT`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentWallets.agentId, agentId),
        sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${parsedAmount}`
      )
    )
    .returning({ agentId: agentWallets.agentId });

  return result.length > 0;
}

export async function debitForWithdrawal(
  agentId: string,
  amount: string
): Promise<boolean> {
  const parsedAmount = parseFloat(amount);
  // Atomic check-and-debit: only updates if balance is sufficient
  const result = await db
    .update(agentWallets)
    .set({
      balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) - ${parsedAmount})::TEXT`,
      totalWithdrawn: sql`(CAST(${agentWallets.totalWithdrawn} AS DECIMAL) + ${parsedAmount})::TEXT`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentWallets.agentId, agentId),
        sql`CAST(${agentWallets.balance} AS DECIMAL) >= ${parsedAmount}`
      )
    )
    .returning({ agentId: agentWallets.agentId });

  return result.length > 0;
}

export async function reverseWithdrawal(
  agentId: string,
  amount: string
): Promise<void> {
  const parsedAmount = parseFloat(amount);
  await db
    .update(agentWallets)
    .set({
      balance: sql`(CAST(${agentWallets.balance} AS DECIMAL) + ${parsedAmount})::TEXT`,
      totalWithdrawn: sql`(CAST(${agentWallets.totalWithdrawn} AS DECIMAL) - ${parsedAmount})::TEXT`,
      updatedAt: new Date(),
    })
    .where(eq(agentWallets.agentId, agentId));
}

export async function initWallet(agentId: string): Promise<void> {
  await db.insert(agentWallets).values({ agentId }).onConflictDoNothing();
}
