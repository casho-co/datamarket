import { NextRequest, NextResponse } from "next/server";
import { getJobById, cancelJob } from "@/lib/services/job";
import { requireAuth, notFound } from "@/lib/auth/middleware";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await getJobById(jobId);
  if (!job) return notFound("Job not found");
  return NextResponse.json(job);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { jobId } = await params;
  const job = await cancelJob(jobId, auth.agentId);
  if (!job) return notFound("Job not found or cannot be cancelled");
  return NextResponse.json(job);
}
