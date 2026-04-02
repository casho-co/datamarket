import { NextRequest, NextResponse } from "next/server";
import { getJobById, cancelJob } from "@/lib/services/job";
import { requireAuth, notFound, authenticateAgent } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { getClientIp } from "@/lib/services/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const ip = getClientIp(req);
  const { blocked: rl } = await checkRateLimit(`ip:${ip}`, "api");
  if (rl) return rl;

  const { jobId } = await params;
  // Optional auth — if logged in, viewer sees full assignment details
  const auth = await authenticateAgent(req);
  const job = await getJobById(jobId, auth?.agentId || null);
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
