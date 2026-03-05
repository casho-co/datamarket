import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createJobTemplate, listJobTemplates } from "@/lib/services/job-template";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { createJobTemplateSchema } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const templates = await listJobTemplates(auth.agentId, limit, offset);
  return NextResponse.json(templates);
}

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

  const parsed = createJobTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const template = await createJobTemplate({
    agentId: auth.agentId,
    name: parsed.data.name,
    title: parsed.data.title,
    description: parsed.data.description,
    tags: parsed.data.tags,
    budgetAmount: parsed.data.budget_amount,
    jobType: parsed.data.job_type,
    maxSlots: parsed.data.max_slots,
    deadlineSeconds: parsed.data.deadline_seconds,
    requiresVerifiable: parsed.data.requires_verifiable,
  });

  return withRateLimitHeaders(NextResponse.json(template, { status: 201 }), rlHeaders);
}
