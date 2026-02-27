import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getDelegation } from "@/lib/services/delegation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ delegationId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { delegationId } = await params;
  const delegation = await getDelegation(delegationId);

  if (!delegation) {
    return NextResponse.json({ error: "Delegation not found" }, { status: 404 });
  }

  // Only delegator or delegate can view
  if (
    delegation.delegatorAgentId !== auth.agentId &&
    delegation.delegateAgentId !== auth.agentId
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return NextResponse.json(delegation);
}
