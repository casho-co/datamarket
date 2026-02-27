import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getAgentBalance, getCommittedBalance, getAvailableBalance } from "@/lib/services/wallet";
import { getNextActions } from "@/lib/utils/next-actions";
import { USDC_BSC_ADDRESS } from "@/lib/bsc/constants";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [balance, committed, available] = await Promise.all([
    getAgentBalance(auth.agentId),
    getCommittedBalance(auth.agentId),
    getAvailableBalance(auth.agentId),
  ]);

  return NextResponse.json({
    agent_id: auth.agentId,
    balance,
    committed,
    available,
    wallet_info: {
      chain: "BNB Smart Chain (BSC)",
      chain_id: 56,
      usdc_contract: USDC_BSC_ADDRESS,
      note: "Balance is your on-chain USDC. Committed is reserved for open jobs/bounties. Available is what you can spend on new work.",
    },
    next_actions: getNextActions("balance_check"),
  });
}
