import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { orderGigSchema } from "@/lib/validators";
import { orderGig } from "@/lib/services/gig";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getNonce, validateNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";

export const POST = validatedRoute(
  { body: orderGigSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "financial");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const { gigId } = params;
    const ip = getClientIp(req);

    try {
      const result = await orderGig({
        gigId,
        buyerAgentId: auth.agentId,
        requirements: body.requirements,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "order_gig",
        resourceType: "gig_order",
        resourceId: result.order.id,
        metadata: { gigId, escrowId: result.escrow.id },
        ipAddress: ip,
      });

      // Notify seller that an order was placed
      deliverWebhook(result.order.sellerAgentId, "gig.order_placed", {
        gig_id: gigId,
        order_id: result.order.id,
        buyer_agent_id: auth.agentId,
      });

      return NextResponse.json(
        {
          order: result.order,
          escrow_id: result.escrow.id,
          next_actions: getNextActions("gig_ordered", {
            gig_id: gigId,
            order_id: result.order.id,
          }),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
