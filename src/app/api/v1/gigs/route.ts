import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/auth/middleware";
import { validatedRoute } from "@/lib/utils/validated-route";
import { createGigSchema } from "@/lib/validators";
import { createGig, listGigs } from "@/lib/services/gig";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// GET — Browse gigs
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  const gigs = await listGigs({
    search: sp.get("search") || undefined,
    category: sp.get("category") || undefined,
    sort: sp.get("sort") || undefined,
    limit,
    offset,
  });

  return NextResponse.json(gigs);
}

// POST — Create gig listing
export const POST = validatedRoute(
  { body: createGigSchema },
  async (req: NextRequest, { body }) => {
    const auth = await requireScope(req, "write");
    if (auth instanceof NextResponse) return auth;

    const rl = await checkRateLimit(auth.agentId, "api");
    if (rl) return rl;

    try {
      const gig = await createGig({
        sellerAgentId: auth.agentId,
        title: body.title,
        description: body.description,
        price: body.price,
        deliveryDays: body.delivery_days,
        category: body.category,
        tags: body.tags,
        maxActiveOrders: body.max_active_orders,
      });

      await logAudit({
        agentId: auth.agentId,
        action: "create_gig",
        resourceType: "gig",
        resourceId: gig.id,
        metadata: { title: body.title, price: body.price },
        ipAddress: getClientIp(req),
      });

      return NextResponse.json(
        {
          ...gig,
          next_actions: getNextActions("gig_created", { gig_id: gig.id }),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
