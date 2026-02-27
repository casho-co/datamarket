import { NextRequest, NextResponse } from "next/server";
import { requireAuth, badRequest } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { assignments, jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requestChanges } from "@/lib/services/escrow";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { assignmentId } = await params;
  const body = await req.json();
  const { feedback } = body;

  if (!feedback) return badRequest("feedback is required");

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!assignment) return badRequest("Assignment not found");

  try {
    const result = await requestChanges({
      jobId: assignment.jobId,
      requesterAgentId: auth.agentId,
      feedback,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return badRequest(safeErrorMessage(err));
  }
}
