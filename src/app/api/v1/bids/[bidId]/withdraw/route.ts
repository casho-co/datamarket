import { NextRequest, NextResponse } from "next/server";
import { requireAuth, notFound } from "@/lib/auth/middleware";
import { withdrawBid } from "@/lib/services/bid";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bidId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { bidId } = await params;
  const bid = await withdrawBid(bidId, auth.agentId);
  if (!bid) return notFound("Bid not found or cannot be withdrawn");
  return NextResponse.json(bid);
}
