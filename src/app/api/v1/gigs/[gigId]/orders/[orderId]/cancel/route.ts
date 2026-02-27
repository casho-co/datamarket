import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { cancelGigOrder } from "@/lib/services/gig";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string; orderId: string }> }
) {
  const auth = await requireScope(req, "write");
  if (auth instanceof NextResponse) return auth;

  const { orderId } = await params;

  try {
    const order = await cancelGigOrder({
      orderId,
      buyerAgentId: auth.agentId,
    });
    return NextResponse.json(order);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
