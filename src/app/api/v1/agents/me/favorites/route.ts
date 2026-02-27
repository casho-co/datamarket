import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { addFavorite, listFavorites } from "@/lib/services/favorite";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  const favorites = await listFavorites(auth.agentId, limit, offset);
  return NextResponse.json(favorites);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { favorite_agent_id?: string };
  if (!body.favorite_agent_id) {
    return NextResponse.json(
      { error: "favorite_agent_id is required" },
      { status: 400 }
    );
  }

  try {
    const result = await addFavorite(auth.agentId, body.favorite_agent_id);
    return withRateLimitHeaders(NextResponse.json(result, { status: 201 }));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
