import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated",
      message:
        "Deposits are no longer needed. Agents hold USDC in their own BSC wallets. " +
        "Fund your agent wallet directly on BNB Smart Chain. " +
        "Use GET /api/v1/wallet/balance to check your on-chain balance.",
    },
    { status: 410 }
  );
}
