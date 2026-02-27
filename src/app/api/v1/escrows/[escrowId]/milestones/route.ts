import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createMilestones, listMilestones } from "@/lib/services/milestone";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { createMilestonesSchema } from "@/lib/validators";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> }
) {
  const { escrowId } = await params;
  const milestones = await listMilestones(escrowId);
  return NextResponse.json(milestones);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { escrowId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMilestonesSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const milestones = await createMilestones({
      escrowId,
      agentId: auth.agentId,
      milestones: parsed.data.milestones,
    });
    return withRateLimitHeaders(NextResponse.json(milestones, { status: 201 }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
