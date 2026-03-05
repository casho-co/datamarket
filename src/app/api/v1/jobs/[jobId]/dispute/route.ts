import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { openDisputeSchema } from "@/lib/validators";
import { openDispute } from "@/lib/services/dispute";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { validateNonce, getNonce } from "@/lib/middleware/nonce";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { jobs, assignments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const POST = validatedRoute(
  { body: openDisputeSchema },
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

    const { jobId } = params;
    const ip = getClientIp(req);

    try {
      const dispute = await openDispute({
        jobId,
        openerAgentId: auth.agentId,
        reason: body.reason,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "open_dispute",
        resourceType: "dispute",
        resourceId: dispute.id,
        metadata: { jobId },
        ipAddress: ip,
      });

      // Notify the other party about the dispute
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (job) {
        const otherParty =
          job.creatorAgentId === auth.agentId
            ? null // Will find worker from assignment
            : job.creatorAgentId;
        if (otherParty) {
          deliverWebhook(otherParty, "work.disputed", {
            job_id: jobId,
            dispute_id: dispute.id,
          });
        } else {
          // Opener is creator, notify the worker
          const [assignment] = await db
            .select()
            .from(assignments)
            .where(
              and(
                eq(assignments.jobId, jobId),
                eq(assignments.status, "disputed")
              )
            );
          if (assignment) {
            deliverWebhook(assignment.workerAgentId, "work.disputed", {
              job_id: jobId,
              dispute_id: dispute.id,
            });
          }
        }
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
