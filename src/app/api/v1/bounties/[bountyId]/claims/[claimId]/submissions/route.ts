import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { bountyClaims, bounties } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSubmissionHistoryByEntity } from "@/lib/services/escrow";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bountyId: string; claimId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { claimId } = await params;

  const [claim] = await db
    .select()
    .from(bountyClaims)
    .where(eq(bountyClaims.id, claimId));

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Allow claimer or bounty creator
  let authorized = claim.claimerAgentId === auth.agentId;
  if (!authorized) {
    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, claim.bountyId));
    if (bounty?.creatorAgentId === auth.agentId) authorized = true;
  }

  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const history = await getSubmissionHistoryByEntity("bounty_claim", claimId);

  return NextResponse.json(history);
}
