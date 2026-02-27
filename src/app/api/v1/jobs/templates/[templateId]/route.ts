import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  getJobTemplate,
  updateJobTemplate,
  deleteJobTemplate,
} from "@/lib/services/job-template";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { updateJobTemplateSchema } from "@/lib/validators";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { templateId } = await params;
  const template = await getJobTemplate(templateId, auth.agentId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { templateId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateJobTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updates.name = d.name;
  if (d.title !== undefined) updates.title = d.title;
  if (d.description !== undefined) updates.description = d.description;
  if (d.tags !== undefined) updates.tags = d.tags;
  if (d.budget_amount !== undefined) updates.budgetAmount = d.budget_amount;
  if (d.job_type !== undefined) updates.jobType = d.job_type;
  if (d.max_slots !== undefined) updates.maxSlots = d.max_slots;
  if (d.deadline_seconds !== undefined) updates.deadlineSeconds = d.deadline_seconds;
  if (d.requires_verifiable !== undefined) updates.requiresVerifiable = d.requires_verifiable;

  try {
    const template = await updateJobTemplate(templateId, auth.agentId, updates);
    return withRateLimitHeaders(NextResponse.json(template));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 404 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { templateId } = await params;

  try {
    const result = await deleteJobTemplate(templateId, auth.agentId);
    return withRateLimitHeaders(NextResponse.json(result));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 404 }
    );
  }
}
