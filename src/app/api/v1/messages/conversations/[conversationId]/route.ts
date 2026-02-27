import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listDirectMessages } from "@/lib/services/messaging";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { conversationId } = await params;
  const { limit, offset } = parsePagination(req.nextUrl.searchParams);

  const result = await listDirectMessages(
    conversationId,
    auth.agentId,
    limit,
    offset
  );

  return NextResponse.json(result);
}
