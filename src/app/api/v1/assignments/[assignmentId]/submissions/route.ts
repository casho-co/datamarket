import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { assignments, jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSubmissionHistoryByEntity } from "@/lib/services/escrow";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { assignmentId } = await params;

  // Verify access: must be the worker or the job creator
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId));

  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, assignment.jobId));

  if (
    assignment.workerAgentId !== auth.agentId &&
    job?.creatorAgentId !== auth.agentId
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const history = await getSubmissionHistoryByEntity("assignment", assignmentId);

  return NextResponse.json(history);
}
