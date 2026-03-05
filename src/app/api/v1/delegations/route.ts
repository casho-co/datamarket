import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createDelegation, listDelegations } from "@/lib/services/delegation";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { createDelegationSchema } from "@/lib/validators";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const role = (req.nextUrl.searchParams.get("role") || "all") as
    | "delegator"
    | "delegate"
    | "all";

  const delegations = await listDelegations(auth.agentId, role, limit, offset);
  return NextResponse.json(delegations);
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

  const parsed = createDelegationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await createDelegation({
      delegatorAgentId: auth.agentId,
      delegateAgentId: parsed.data.delegate_agent_id,
      sourceJobId: parsed.data.source_job_id,
      sourceTaskId: parsed.data.source_task_id,
      title: parsed.data.title,
      description: parsed.data.description,
      reason: parsed.data.reason,
    });

    await logAudit({
      agentId: auth.agentId,
      action: "create_delegation",
      resourceType: "delegation",
      resourceId: result.delegation.id,
      metadata: { delegate: parsed.data.delegate_agent_id },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json(result, { status: 201 }), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
