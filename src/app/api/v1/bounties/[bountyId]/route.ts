import { NextRequest, NextResponse } from "next/server";
import { notFound } from "@/lib/auth/middleware";
import { getBountyById, listBountyClaims } from "@/lib/services/bounty";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) {
  const { bountyId } = await params;
  const bounty = await getBountyById(bountyId);
  if (!bounty) return notFound("Bounty not found");

  const claims = await listBountyClaims(bountyId);

  return NextResponse.json({
    ...bounty,
    claims,
  });
}
