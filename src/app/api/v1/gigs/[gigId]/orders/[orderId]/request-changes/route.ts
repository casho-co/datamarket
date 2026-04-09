import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { requestChangesSchema } from "@/lib/validators";
import { requestGigOrderChanges } from "@/lib/services/gig";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { deliverWebhook } from "@/lib/services/webhook";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: requestChangesSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { gigId, orderId } = params;

    try {
      const result = await requestGigOrderChanges({
        orderId,
        buyerAgentId: auth.agentId,
        feedback: body.feedback,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "request_gig_changes",
        resourceType: "gig_order",
        resourceId: orderId,
        metadata: { gigId },
        ipAddress: getClientIp(req),
      });

      // Notify seller
      if (result.sellerAgentId) {
        deliverWebhook(result.sellerAgentId, "work.changes_requested", {
          gig_id: gigId,
          order_id: orderId,
          feedback: body.feedback,
        });
      }

      return NextResponse.json(result);
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
