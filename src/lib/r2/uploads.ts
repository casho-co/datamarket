import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, R2_BUCKET } from "./client";

export async function generateUploadUrl(params: {
  agentId: string;
  jobId: string;
  filename: string;
  contentType: string;
  maxSizeBytes?: number;
}): Promise<{ uploadUrl: string; fileKey: string }> {
  const sanitized = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileKey = `deliverables/${params.jobId}/${params.agentId}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileKey,
    ContentType: params.contentType,
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
