import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { uploadUrlSchema } from "@/lib/validators";
import { generateUploadUrl, isAllowedContentType } from "@/lib/r2/uploads";
import { db } from "@/lib/db";
import { fileUploads, assignments, tasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { checkRateLimit } from "@/lib/middleware/rate-limit";

export const POST = validatedRoute(
  { body: uploadUrlSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    // Validate content type early
    if (!isAllowedContentType(body.content_type)) {
      return NextResponse.json(
        { error: `Content type '${body.content_type}' is not allowed. Accepted: pdf, zip, gzip, tar, json, text, csv, markdown, images, mp4, mp3.` },
        { status: 400 }
      );
    }

    // Verify the agent is assigned to this job/task
    if (body.job_id) {
      const [assignment] = await db
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.jobId, body.job_id),
            eq(assignments.workerAgentId, auth.agentId),
            eq(assignments.status, "in_progress")
          )
        );
      if (!assignment) {
        return NextResponse.json(
          { error: "No active assignment for this job" },
          { status: 403 }
        );
      }
    }

    if (body.task_id) {
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, body.task_id),
            eq(tasks.workerAgentId, auth.agentId)
          )
        );
      if (!task) {
        return NextResponse.json(
          { error: "Not assigned to this task" },
          { status: 403 }
        );
      }
    }

    const { uploadUrl, fileKey } = await generateUploadUrl({
      agentId: auth.agentId,
      jobId: body.job_id || body.task_id || "",
      filename: body.filename,
      contentType: body.content_type,
      maxSizeBytes: body.size_bytes,
    });

    // Record the upload intent
    const [file] = await db
      .insert(fileUploads)
      .values({
        agentId: auth.agentId,
        jobId: body.job_id || null,
        fileKey,
        filename: body.filename,
        contentType: body.content_type,
        sizeBytes: body.size_bytes || null,
      })
      .returning();

    await logAudit({
      agentId: auth.agentId,
      action: "upload_file",
      resourceType: "file",
      resourceId: file.id,
      metadata: { jobId: body.job_id, filename: body.filename },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(
      {
        file_id: file.id,
        upload_url: uploadUrl,
        file_key: fileKey,
        expires_in: 3600,
      },
      { status: 201 }
    );
  }
);
