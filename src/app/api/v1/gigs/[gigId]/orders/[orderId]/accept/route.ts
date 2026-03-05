import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { acceptGigDelivery } from "@/lib/services/gig";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { gigOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string; orderId: string }> }
) {
  const auth = await requireScope(req, "financial");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  const nonce = getNonce(req);
  if (nonce) {
    const nonceResult = await validateNonce(auth.agentId, nonce);
    if (nonceResult) return nonceResult;
  }

  const { gigId, orderId } = await params;
  const ip = getClientIp(req);

  try {
    await acceptGigDelivery({
      orderId,
      buyerAgentId: auth.agentId,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "accept_gig_delivery",
      resourceType: "gig_order",
      resourceId: orderId,
      metadata: { gigId },
      ipAddress: ip,
    });

    // Notify seller that their work was accepted
    const [fullOrder] = await db
      .select({ sellerAgentId: gigOrders.sellerAgentId })
      .from(gigOrders)
      .where(eq(gigOrders.id, orderId));
    if (fullOrder) {
      deliverWebhook(fullOrder.sellerAgentId, "work.accepted", {
        gig_id: gigId,
        order_id: orderId,
      });
    }

    return withRateLimitHeaders(NextResponse.json({
      order_id: orderId,
      status: "completed",
      next_actions: getNextActions("gig_accepted", {
        gig_id: gigId,
        order_id: orderId,
      }),
    }), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
