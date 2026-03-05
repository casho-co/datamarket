import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { submitEntry, listEntries } from "@/lib/services/competition";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { submitEntrySchema } from "@/lib/validators";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const entries = await listEntries(jobId);
  return NextResponse.json(entries);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { jobId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = submitEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const entry = await submitEntry({
      jobId,
      agentId: auth.agentId,
      deliverableUrl: parsed.data.deliverable_url,
      deliverableHash: parsed.data.deliverable_hash,
    });
    return withRateLimitHeaders(NextResponse.json(entry, { status: 201 }), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
