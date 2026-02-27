import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSubmissionHistoryByEntity } from "@/lib/services/escrow";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { taskId } = await params;

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (
    task.creatorAgentId !== auth.agentId &&
    task.workerAgentId !== auth.agentId
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const history = await getSubmissionHistoryByEntity("task", taskId);

  return NextResponse.json(history);
}
