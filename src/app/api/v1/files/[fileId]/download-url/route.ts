import { NextRequest, NextResponse } from "next/server";
import { requireAuth, forbidden } from "@/lib/auth/middleware";
import { notFound } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  fileUploads,
  jobs,
  assignments,
  tasks,
  gigOrders,
  bountyClaims,
  bounties,
} from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/r2/uploads";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { fileId } = await params;

  const [file] = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.id, fileId));

  if (!file) return notFound("File not found");

  // Authorization: uploader always has access
  let authorized = file.agentId === auth.agentId;

  // Check job-level access (job creator or assigned worker)
  if (!authorized && file.jobId) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, file.jobId));
    if (job?.creatorAgentId === auth.agentId) authorized = true;

    if (!authorized) {
      const workerAssignment = await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.jobId, file.jobId),
            eq(assignments.workerAgentId, auth.agentId)
          )
        );
      if (workerAssignment.length > 0) authorized = true;
    }
  }

  // Check task-level access (task creator or worker)
  if (!authorized && file.taskId) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, file.taskId));
    if (
      task?.creatorAgentId === auth.agentId ||
      task?.workerAgentId === auth.agentId
    ) {
      authorized = true;
    }
  }

  // Check assignment-level access (via linked file)
  if (!authorized && file.assignmentId) {
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, file.assignmentId));
    if (assignment) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, assignment.jobId));
      if (
        assignment.workerAgentId === auth.agentId ||
        job?.creatorAgentId === auth.agentId
      ) {
        authorized = true;
      }
    }
  }

  // Check if file is linked as a deliverable in gig orders
  if (!authorized) {
    const gigOrderWithFile = await db
      .select()
      .from(gigOrders)
      .where(
        and(
          eq(gigOrders.deliverableFileId, fileId),
          or(
            eq(gigOrders.buyerAgentId, auth.agentId),
            eq(gigOrders.sellerAgentId, auth.agentId)
          )
        )
      );
    if (gigOrderWithFile.length > 0) authorized = true;
  }

  // Check if file is linked as a deliverable in bounty claims
  if (!authorized) {
    const claimsWithFile = await db
      .select()
      .from(bountyClaims)
      .where(eq(bountyClaims.deliverableFileId, fileId));

    for (const claim of claimsWithFile) {
      if (claim.claimerAgentId === auth.agentId) {
        authorized = true;
        break;
      }
      // Also allow bounty creator
      const [bounty] = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, claim.bountyId));
      if (bounty?.creatorAgentId === auth.agentId) {
        authorized = true;
        break;
      }
    }
  }

  if (!authorized) return forbidden("Not authorized to download this file");

  const downloadUrl = await generateDownloadUrl(file.fileKey);

  return withRateLimitHeaders(NextResponse.json({
    file_id: file.id,
    filename: file.filename,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    download_url: downloadUrl,
    expires_in: 3600,
  }));
}
