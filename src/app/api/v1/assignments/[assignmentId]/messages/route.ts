import { NextRequest, NextResponse } from "next/server";
import { requireAuth, badRequest } from "@/lib/auth/middleware";
import { createAssignmentMessage, listAssignmentMessages } from "@/lib/services/messaging";
import { parsePagination } from "@/lib/utils/pagination";
import { db } from "@/lib/db";
import { assignments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { assignmentId } = await params;
  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const result = await listAssignmentMessages(assignmentId, auth.agentId, limit, offset);
  return NextResponse.json(result);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { assignmentId } = await params;
  const body = await req.json();

  if (!body.body || typeof body.body !== "string") return badRequest("body is required");

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!assignment) return badRequest("Assignment not found");

  try {
    const msg = await createAssignmentMessage({
      jobId: assignment.jobId,
      assignmentId,
      senderAgentId: auth.agentId,
      body: body.body,
    });
    return NextResponse.json(msg, { status: 201 });
  } catch (err: unknown) {
    return badRequest(safeErrorMessage(err));
  }
}
