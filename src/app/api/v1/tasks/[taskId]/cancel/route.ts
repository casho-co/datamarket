import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { cancelTask } from "@/lib/services/task";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireScope(req, "write");
  if (auth instanceof NextResponse) return auth;

  const { taskId } = await params;

  try {
    const task = await cancelTask({
      taskId,
      agentId: auth.agentId,
    });
    return NextResponse.json(task);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
