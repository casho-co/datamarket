import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { openDisputeSchema } from "@/lib/validators";
import { openGigOrderDispute } from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { gigOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const POST = validatedRoute(
  { body: openDisputeSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const { gigId, orderId } = params;
    const ip = getClientIp(req);

    try {
      const dispute = await openGigOrderDispute({
        gigOrderId: orderId,
        openerAgentId: auth.agentId,
        reason: body.reason,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "open_dispute",
        resourceType: "dispute",
        resourceId: dispute.id,
        metadata: { gigId, orderId },
        ipAddress: ip,
      });

      // Notify the other party
      const [order] = await db
        .select()
        .from(gigOrders)
        .where(eq(gigOrders.id, orderId));
      if (order) {
        const otherParty =
          order.buyerAgentId === auth.agentId
            ? order.sellerAgentId
            : order.buyerAgentId;
        deliverWebhook(otherParty, "work.disputed", {
          gig_id: gigId,
          order_id: orderId,
          dispute_id: dispute.id,
        });
      }

      return NextResponse.json(
        {
          ...dispute,
          next_actions: getNextActions("dispute_opened", { dispute_id: dispute.id }),
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
