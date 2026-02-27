import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated",
      message:
        "Withdrawals are no longer needed. USDC is held in your own BSC wallet, not on the platform. " +
        "On escrow release, funds go directly to the seller's wallet via the smart contract.",
    },
    { status: 410 }
  );
}
