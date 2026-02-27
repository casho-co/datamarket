import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    agent_id: auth.agentId,
    wallet_address: auth.walletAddress,
    wallet_mode: auth.walletMode,
  });
}
