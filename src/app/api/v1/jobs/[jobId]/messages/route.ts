import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createJobMessage, listJobMessages } from "@/lib/services/messaging";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { createMessageSchema } from "@/lib/validators";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const result = await listJobMessages(jobId, limit, offset);
  return NextResponse.json(result);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { jobId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const msg = await createJobMessage({
    jobId,
    senderAgentId: auth.agentId,
    body: parsed.data.body,
  });

  return withRateLimitHeaders(NextResponse.json(msg, { status: 201 }));
}
