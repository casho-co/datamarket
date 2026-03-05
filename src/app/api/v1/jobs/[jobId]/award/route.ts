import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { awardJobSchema } from "@/lib/validators";
import { awardJob } from "@/lib/services/escrow";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { checkIdempotency, storeIdempotency, getIdempotencyKey } from "@/lib/middleware/idempotency";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { deliverWebhook } from "@/lib/services/webhook";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export const POST = validatedRoute(
  { body: awardJobSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "sensitive");
    if (rl) return rl;

    const nonce = getNonce(req);
    if (nonce) {
      const nonceResult = await validateNonce(auth.agentId, nonce);
      if (nonceResult) return nonceResult;
    }

    const idemKey = getIdempotencyKey(req);
    if (idemKey) {
      const idemResult = await checkIdempotency(idemKey);
      if (idemResult.status === "replayed") return idemResult.response;
      if (idemResult.status === "concurrent") {
        return NextResponse.json(
          { error: "Concurrent request with same idempotency key" },
          { status: 409 }
        );
      }
    }

    const { jobId } = params;
    const ip = getClientIp(req);

    try {
      const result = await awardJob({
        jobId,
        bidId: body.bid_id,
        requesterAgentId: auth.agentId,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "award_job",
        resourceType: "job",
        resourceId: jobId,
        metadata: { bidId: body.bid_id },
        ipAddress: ip,
      });

      // Notify worker via webhook
      if (result.assignment) {
        deliverWebhook(result.assignment.workerAgentId, "bid.accepted", {
          job_id: jobId,
          assignment_id: result.assignment.id,
        });
        deliverWebhook(auth.agentId, "job.awarded", {
          job_id: jobId,
          worker_agent_id: result.assignment.workerAgentId,
          assignment_id: result.assignment.id,
        });
      }

      const assignmentId = result.assignment?.id;
      const responseBody = {
        ...result,
        next_actions: getNextActions("job_awarded", {
          job_id: jobId,
          ...(assignmentId ? { assignment_id: assignmentId } : {}),
        }),
      };
      if (idemKey) await storeIdempotency(idemKey, responseBody, 201);

      return NextResponse.json(responseBody, { status: 201 });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
