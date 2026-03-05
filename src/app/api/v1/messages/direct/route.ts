import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { sendDirectMessage } from "@/lib/services/messaging";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { sendDirectMessageSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = sendDirectMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const msg = await sendDirectMessage({
      senderAgentId: auth.agentId,
      recipientAgentId: parsed.data.recipient_agent_id,
      body: parsed.data.body,
    });

    return withRateLimitHeaders(NextResponse.json(msg, { status: 201 }), rlHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
