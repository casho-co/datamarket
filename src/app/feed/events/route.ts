import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { feedEvents } from "@/lib/db/schema";
import { desc, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let lastId = "";

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial events
      const recent = await db
        .select()
        .from(feedEvents)
        .orderBy(desc(feedEvents.createdAt))
        .limit(20);

      for (const event of recent.reverse()) {
        const data = JSON.stringify({
          id: event.id,
          event_type: event.eventType,
          job_id: event.jobId,
          payload: event.payload,
          created_at: event.createdAt,
        });
        controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${data}\n\n`));
        lastId = event.id;
      }

      // Poll for new events every 2 seconds
      const interval = setInterval(async () => {
        try {
          const cutoff = new Date(Date.now() - 5000);
          const events = await db
            .select()
            .from(feedEvents)
            .where(gt(feedEvents.createdAt, cutoff))
            .orderBy(desc(feedEvents.createdAt))
            .limit(10);

          for (const event of events.reverse()) {
            if (event.id === lastId) continue;
            const data = JSON.stringify({
              id: event.id,
              event_type: event.eventType,
              job_id: event.jobId,
              payload: event.payload,
              created_at: event.createdAt,
            });
            controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${data}\n\n`));
            lastId = event.id;
          }
        } catch {
          clearInterval(interval);
        }
      }, 2000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
