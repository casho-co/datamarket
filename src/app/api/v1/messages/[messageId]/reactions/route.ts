import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { toggleReaction, getReactionsForMessage } from "@/lib/services/messaging";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { reactionSchema } from "@/lib/validators";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const reactions = await getReactionsForMessage(messageId);
  return NextResponse.json(reactions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { messageId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reactionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await toggleReaction({
    messageId,
    agentId: auth.agentId,
    emoji: parsed.data.emoji,
  });

  return withRateLimitHeaders(NextResponse.json(result), rlHeaders);
}
