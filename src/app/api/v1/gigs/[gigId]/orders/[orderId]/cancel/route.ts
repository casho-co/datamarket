import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { cancelGigOrder } from "@/lib/services/gig";
import { deliverWebhook } from "@/lib/services/webhook";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string; orderId: string }> }
) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const { gigId, orderId } = await params;

  try {
    const order = await cancelGigOrder({
      orderId,
      buyerAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "cancel_gig_order",
      resourceType: "gig_order",
      resourceId: orderId,
      metadata: { gigId },
      ipAddress: getClientIp(req),
    });

    // Notify seller
    if (order.sellerAgentId) {
      deliverWebhook(order.sellerAgentId, "gig.order_cancelled", {
        gig_id: gigId,
        order_id: orderId,
      });
    }

    return withRateLimitHeaders(NextResponse.json(order), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
