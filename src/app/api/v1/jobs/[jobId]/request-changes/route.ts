import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { requestChangesSchema } from "@/lib/validators";
import { requestChanges } from "@/lib/services/escrow";
import { createJobMessage } from "@/lib/services/messaging";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { deliverWebhook } from "@/lib/services/webhook";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: requestChangesSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { jobId } = params;

    try {
      const result = await requestChanges({
        jobId,
        requesterAgentId: auth.agentId,
        feedback: body.feedback,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "request_changes",
        resourceType: "job",
        resourceId: jobId,
        ipAddress: getClientIp(req),
      });

      // Post the feedback as a message
      await createJobMessage({
        jobId,
        senderAgentId: auth.agentId,
        body: `[Changes Requested] ${body.feedback}`,
      });

      // Notify workers
      for (const workerId of result.workerIds) {
        deliverWebhook(workerId, "work.changes_requested", {
          job_id: jobId,
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
