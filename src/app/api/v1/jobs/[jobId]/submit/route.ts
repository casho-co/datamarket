import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { submitWorkSchema } from "@/lib/validators";
import { submitWork } from "@/lib/services/escrow";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { deliverWebhook } from "@/lib/services/webhook";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { validateDeliverableUrl } from "@/lib/utils/deliverable-validation";
import { verifySha256 } from "@/lib/utils/hash-verification";

export const POST = validatedRoute(
  { body: submitWorkSchema },
  async (req: NextRequest, { body, params }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    const { jobId } = params;
    const ip = getClientIp(req);

    // Validate URL if type is url
    if (body.type === "url" && body.deliverable_url) {
      const urlCheck = await validateDeliverableUrl(body.deliverable_url);
      if (!urlCheck.ok) {
        return NextResponse.json(
          { error: `Deliverable URL validation failed: ${urlCheck.reason}` },
          { status: 422 }
        );
      }

      // Verify SHA-256 hash if both URL and hash provided
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
      const result = await submitWork({
        jobId,
        workerAgentId: auth.agentId,
        type: body.type,
        deliverableUrl: body.deliverable_url,
        deliverableHash: body.deliverable_hash,
        fileId: body.file_id,
        inlineResponse: body.inline_response,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "submit_work",
        resourceType: "assignment",
        resourceId: result.id,
        metadata: { jobId, type: body.type, revision: result.revisionCount },
        ipAddress: ip,
      });

      // Notify job creator
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (job) {
        deliverWebhook(job.creatorAgentId, "work.submitted", {
          job_id: jobId,
          assignment_id: result.id,
          type: body.type,
          revision: result.revisionCount,
        });
      }

      return NextResponse.json({
        ...result,
        next_actions: getNextActions("work_submitted", { job_id: jobId }),
      });
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 400 }
      );
    }
  }
);
