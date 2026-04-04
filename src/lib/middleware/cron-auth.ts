import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";

let _receiver: Receiver | null = null;

function getReceiver(): Receiver | null {
  if (_receiver) return _receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  _receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return _receiver;
}

/**
 * Verify cron request is from QStash via signature verification.
 */
export async function verifyCronAuth(req: NextRequest): Promise<NextResponse | null> {
  const receiver = getReceiver();
  if (!receiver) {
    return NextResponse.json({ error: "QStash signing keys not configured" }, { status: 500 });
  }

  const signature = req.headers.get("upstash-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing QStash signature" }, { status: 401 });
  }

  try {
    const body = await req.text();
    await receiver.verify({ signature, body });
    return null;
  } catch {
    return NextResponse.json({ error: "Invalid QStash signature" }, { status: 401 });
  }
}

/**
 * Extract QStash metadata from request headers for logging/debugging.
 */
function getQStashMeta(req: NextRequest): Record<string, string | null> {
  return {
    messageId: req.headers.get("upstash-message-id"),
    scheduleId: req.headers.get("upstash-schedule-id"),
    retryCount: req.headers.get("upstash-retried"),
    callerIp: req.headers.get("upstash-caller-ip"),
  };
}

/**
 * Wraps a cron handler with auth, error handling, timing, and QStash metadata.
 */
export function cronRoute(
  name: string,
  handler: () => Promise<unknown>
) {
  return async function POST(req: NextRequest) {
    const denied = await verifyCronAuth(req);
    if (denied) return denied;

    const qstash = getQStashMeta(req);
    const start = Date.now();

    try {
      const result = await handler();
      const duration_ms = Date.now() - start;

      console.log(
        `[cron:${name}] completed in ${duration_ms}ms`,
        qstash.messageId ? `msgId=${qstash.messageId}` : "",
        qstash.retryCount ? `retry=${qstash.retryCount}` : ""
      );

      return NextResponse.json({
        ...((result && typeof result === "object") ? result : { result }),
        _meta: {
          cron: name,
          duration_ms,
          ...(qstash.messageId ? { qstash } : {}),
        },
      });
    } catch (err) {
      const duration_ms = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Cron job failed";

      console.error(
        `[cron:${name}] FAILED in ${duration_ms}ms:`,
        errorMsg,
        qstash.messageId ? `msgId=${qstash.messageId}` : "",
        qstash.retryCount ? `retry=${qstash.retryCount}` : ""
      );

      return NextResponse.json(
        {
          error: errorMsg,
          _meta: {
            cron: name,
            duration_ms,
            ...(qstash.messageId ? { qstash } : {}),
          },
        },
        { status: 500 }
      );
    }
  };
}
