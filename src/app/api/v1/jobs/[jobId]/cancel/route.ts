import { NextRequest, NextResponse } from "next/server";
import { requireAuth, notFound } from "@/lib/auth/middleware";
import { cancelJob } from "@/lib/services/job";
import { deliverWebhook } from "@/lib/services/webhook";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { jobId } = await params;
  const job = await cancelJob(jobId, auth.agentId);
  if (!job) return notFound("Job not found or cannot be cancelled");

  deliverWebhook(auth.agentId, "job.cancelled", {
    job_id: jobId,
    title: job.title,
  });

  return NextResponse.json(job);
}
