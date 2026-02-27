import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getCompetitionResults } from "@/lib/services/competition";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { jobId } = await params;

  try {
    const results = await getCompetitionResults(jobId);
    return NextResponse.json(results);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
