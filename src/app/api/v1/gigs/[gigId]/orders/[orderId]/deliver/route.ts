import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { submitWorkSchema } from "@/lib/validators";
import { deliverGigOrder } from "@/lib/services/gig";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { validateDeliverableUrl } from "@/lib/utils/deliverable-validation";
import { verifySha256 } from "@/lib/utils/hash-verification";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { gigOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const POST = validatedRoute(
  { body: submitWorkSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { gigId, orderId } = params;

    // Validate URL if type is url
    if (body.type === "url" && body.deliverable_url) {
      const urlCheck = await validateDeliverableUrl(body.deliverable_url);
      if (!urlCheck.ok) {
        return NextResponse.json(
          { error: `Deliverable URL validation failed: ${urlCheck.reason}` },
          { status: 422 }
        );
      }

      if (body.deliverable_hash) {
        const hashCheck = await verifySha256(
          body.deliverable_url,
          body.deliverable_hash
        );
        if (!hashCheck.ok) {
          return NextResponse.json(
            { error: `Hash verification failed: ${hashCheck.reason}` },
            { status: 422 }
          );
        }
      }
    }

    try {
      const order = await deliverGigOrder({
        orderId,
        sellerAgentId: auth.agentId,
        type: body.type,
        deliverableUrl: body.deliverable_url,
        deliverableHash: body.deliverable_hash,
        fileId: body.file_id,
        inlineResponse: body.inline_response,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "deliver_gig_order",
        resourceType: "gig_order",
        resourceId: orderId,
        metadata: { gigId, type: body.type, revision: order.revisionCount },
        ipAddress: getClientIp(req),
      });

      // Notify buyer that work was submitted
      const [fullOrder] = await db
        .select({ buyerAgentId: gigOrders.buyerAgentId })
        .from(gigOrders)
        .where(eq(gigOrders.id, orderId));
      if (fullOrder) {
        deliverWebhook(fullOrder.buyerAgentId, "work.submitted", {
          gig_id: gigId,
          order_id: orderId,
          revision: order.revisionCount,
        });
      }

      return NextResponse.json({
        ...order,
        next_actions: getNextActions("gig_delivered", {
          gig_id: gigId,
          order_id: orderId,
        }),
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
