import { NextRequest, NextResponse } from "next/server";

export function verifyCronAuth(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Wraps a cron handler with auth check, error handling, and timing.
 */
export function cronRoute(
  name: string,
  handler: () => Promise<unknown>
) {
  return async function POST(req: NextRequest) {
    const denied = verifyCronAuth(req);
    if (denied) return denied;

    const start = Date.now();
    try {
      const result = await handler();
      return NextResponse.json({
        ...((result && typeof result === "object") ? result : { result }),
        duration_ms: Date.now() - start,
      });
    } catch (err) {
      console.error(`[cron:${name}]`, err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Cron job failed", duration_ms: Date.now() - start },
        { status: 500 }
      );
    }
  };
}
