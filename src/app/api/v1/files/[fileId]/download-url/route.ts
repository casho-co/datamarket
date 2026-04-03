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
import { eq, and, or, sql } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/r2/uploads";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { fileId } = await params;

  const [file] = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.id, fileId));

  if (!file) return notFound("File not found");

  // Fast path: uploader always has access
  if (file.agentId === auth.agentId) {
    const downloadUrl = await generateDownloadUrl(file.fileKey);
    return withRateLimitHeaders(NextResponse.json({
      file_id: file.id,
      filename: file.filename,
      content_type: file.contentType,
      size_bytes: file.sizeBytes,
      download_url: downloadUrl,
      expires_in: 3600,
    }), rlHeaders);
  }

  // Run all auth checks in parallel
  const checks = await Promise.all([
    // Job-level: creator or assigned worker
    file.jobId
      ? db.select({ id: sql<string>`1` }).from(jobs).where(
          and(eq(jobs.id, file.jobId), eq(jobs.creatorAgentId, auth.agentId))
        ).then(r => r.length > 0)
      : false,
    file.jobId
      ? db.select({ id: sql<string>`1` }).from(assignments).where(
          and(eq(assignments.jobId, file.jobId), eq(assignments.workerAgentId, auth.agentId))
        ).then(r => r.length > 0)
      : false,
    // Task-level: creator or worker
    file.taskId
      ? db.select({ id: sql<string>`1` }).from(tasks).where(
          and(
            eq(tasks.id, file.taskId),
            or(eq(tasks.creatorAgentId, auth.agentId), eq(tasks.workerAgentId, auth.agentId))
          )
        ).then(r => r.length > 0)
      : false,
    // Assignment-level: worker or job creator
    file.assignmentId
      ? db.select({ workerAgentId: assignments.workerAgentId, jobId: assignments.jobId })
          .from(assignments)
          .where(eq(assignments.id, file.assignmentId))
          .then(async ([a]) => {
            if (!a) return false;
            if (a.workerAgentId === auth.agentId) return true;
            const [j] = await db.select({ id: sql<string>`1` }).from(jobs).where(
              and(eq(jobs.id, a.jobId), eq(jobs.creatorAgentId, auth.agentId))
            );
            return !!j;
          })
      : false,
    // Gig order: buyer or seller
    db.select({ id: sql<string>`1` }).from(gigOrders).where(
      and(
        eq(gigOrders.deliverableFileId, fileId),
        or(eq(gigOrders.buyerAgentId, auth.agentId), eq(gigOrders.sellerAgentId, auth.agentId))
      )
    ).then(r => r.length > 0),
    // Bounty claim: claimer or bounty creator
    db.select({ claimerAgentId: bountyClaims.claimerAgentId, bountyId: bountyClaims.bountyId })
      .from(bountyClaims)
      .where(eq(bountyClaims.deliverableFileId, fileId))
      .then(async (claims) => {
        for (const claim of claims) {
          if (claim.claimerAgentId === auth.agentId) return true;
          const [b] = await db.select({ id: sql<string>`1` }).from(bounties).where(
            and(eq(bounties.id, claim.bountyId), eq(bounties.creatorAgentId, auth.agentId))
          );
          if (b) return true;
        }
        return false;
      }),
  ]);

  if (!checks.some(Boolean)) {
    return forbidden("Not authorized to download this file");
  }

  const downloadUrl = await generateDownloadUrl(file.fileKey);

  return withRateLimitHeaders(NextResponse.json({
    file_id: file.id,
    filename: file.filename,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    download_url: downloadUrl,
    expires_in: 3600,
  }), rlHeaders);
}
