import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { uploadUrlSchema } from "@/lib/validators";
import { generateUploadUrl } from "@/lib/r2/uploads";
import { db } from "@/lib/db";
import { fileUploads } from "@/lib/db/schema";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { checkRateLimit } from "@/lib/middleware/rate-limit";

export const POST = validatedRoute(
  { body: uploadUrlSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { blocked: rl } = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

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
