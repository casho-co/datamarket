import { NextRequest, NextResponse } from "next/server";
import { requireAuth, notFound } from "@/lib/auth/middleware";
import { withdrawBid } from "@/lib/services/bid";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bidId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { bidId } = await params;
  const bid = await withdrawBid(bidId, auth.agentId);
  if (!bid) return notFound("Bid not found or cannot be withdrawn");

  await logAudit({
    agentId: auth.agentId,
    action: "withdraw_bid",
    resourceType: "bid",
    resourceId: bidId,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json(bid);
}
