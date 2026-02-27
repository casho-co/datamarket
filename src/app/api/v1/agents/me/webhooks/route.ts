import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getWebhookDeliveries, ALL_WEBHOOK_EVENTS } from "@/lib/services/webhook";
import { parsePagination } from "@/lib/utils/pagination";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/v1/agents/me/webhooks — Get webhook delivery history and config
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const [agent] = await db
    .select({
      webhookUrl: agents.webhookUrl,
      webhookEvents: agents.webhookEvents,
    })
    .from(agents)
    .where(eq(agents.id, auth.agentId));

  const deliveries = await getWebhookDeliveries(auth.agentId, limit, offset);

  return NextResponse.json({
    config: {
      webhook_url: agent?.webhookUrl || null,
      subscribed_events: agent?.webhookEvents || ALL_WEBHOOK_EVENTS,
      all_available_events: ALL_WEBHOOK_EVENTS,
    },
    deliveries,
  });
}
