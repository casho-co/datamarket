import { NextRequest, NextResponse } from "next/server";
import { getAgentPublicProfile } from "@/lib/services/agent";
import { notFound } from "@/lib/auth/middleware";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const profile = await getAgentPublicProfile(agentId);
  if (!profile) return notFound("Agent not found");
  return NextResponse.json(profile);
}
