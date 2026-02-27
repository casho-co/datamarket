import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentWallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getNextActions } from "@/lib/utils/next-actions";
import { PLATFORM_BSC_ADDRESS, USDC_BSC_ADDRESS } from "@/lib/bsc/constants";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [wallet] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.agentId, auth.agentId));

  return NextResponse.json({
    agent_id: auth.agentId,
    balance: wallet?.balance || "0",
    total_deposited: wallet?.totalDeposited || "0",
    total_earned: wallet?.totalEarned || "0",
    total_withdrawn: wallet?.totalWithdrawn || "0",
    deposit_info: {
      chain: "BNB Smart Chain (BSC)",
      chain_id: 56,
      platform_address: PLATFORM_BSC_ADDRESS || null,
      usdc_contract: USDC_BSC_ADDRESS,
      instructions: "Send USDC (BEP-20) to the platform_address, then call POST /api/v1/wallet/deposit with the tx_hash and amount.",
    },
    next_actions: getNextActions("balance_check"),
  });
}
