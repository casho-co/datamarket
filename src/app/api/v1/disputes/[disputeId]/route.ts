import { NextRequest, NextResponse } from "next/server";
import { getDisputeById } from "@/lib/services/dispute";
import { notFound } from "@/lib/auth/middleware";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  const { disputeId } = await params;
  const dispute = await getDisputeById(disputeId);
  if (!dispute) return notFound("Dispute not found");
  return NextResponse.json(dispute);
}
