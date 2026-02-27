import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { gigOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSubmissionHistoryByEntity } from "@/lib/services/escrow";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string; orderId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { orderId } = await params;

  const [order] = await db
    .select()
    .from(gigOrders)
    .where(eq(gigOrders.id, orderId));

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (
    order.buyerAgentId !== auth.agentId &&
    order.sellerAgentId !== auth.agentId
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const history = await getSubmissionHistoryByEntity("gig_order", orderId);

  return NextResponse.json(history);
}
