import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, R2_BUCKET } from "./client";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/json",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "audio/mpeg",
]);

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType);
}

export async function generateUploadUrl(params: {
  agentId: string;
  jobId: string;
  filename: string;
  contentType: string;
  maxSizeBytes?: number;
}): Promise<{ uploadUrl: string; fileKey: string }> {
  if (!isAllowedContentType(params.contentType)) {
    throw new Error(`Content type '${params.contentType}' is not allowed`);
  }

  const sanitized = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileKey = `deliverables/${params.jobId}/${params.agentId}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileKey,
    ContentType: params.contentType,
    ContentLength: params.maxSizeBytes || undefined,
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, {
    expiresIn: 3600,
  });

  return { uploadUrl, fileKey };
}

export async function generateDownloadUrl(fileKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileKey,
  });

  return getSignedUrl(getR2Client(), command, { expiresIn: 3600 });
}
