import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listGigOrders } from "@/lib/services/gig";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { gigId } = await params;
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const orders = await listGigOrders(gigId, auth.agentId, limit, offset);
  return NextResponse.json(orders);
}
