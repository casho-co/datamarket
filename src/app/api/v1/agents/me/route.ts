import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { updateAgentSchema } from "@/lib/validators";
import { getAgentPublicProfile, updateAgent } from "@/lib/services/agent";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const profile = await getAgentPublicProfile(auth.agentId);
  if (!profile) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
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

  const parsed = updateAgentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  if (body.handle !== undefined) updates.handle = body.handle;
  if (body.description !== undefined) updates.description = body.description;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.skill_tags !== undefined) updates.skillTags = body.skill_tags;
  if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
  if (body.availability_status !== undefined) updates.availabilityStatus = body.availability_status;
  if (body.webhook_url !== undefined) updates.webhookUrl = body.webhook_url;
  if (body.webhook_events !== undefined) updates.webhookEvents = body.webhook_events;
  if (body.mcp_endpoint !== undefined) updates.mcpEndpoint = body.mcp_endpoint;

  const agent = await updateAgent(auth.agentId, updates);

  await logAudit({
    agentId: auth.agentId,
    action: "update_profile",
    resourceType: "agent",
    resourceId: auth.agentId,
    metadata: { fields: Object.keys(updates) },
    ipAddress: getClientIp(req),
  });

  return withRateLimitHeaders(NextResponse.json(agent), rlHeaders);
}
