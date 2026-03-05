import { NextRequest, NextResponse } from "next/server";
import { requireScope, notFound } from "@/lib/auth/middleware";
import { getGigById, updateGig } from "@/lib/services/gig";
import { updateGigSchema } from "@/lib/validators";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { safeErrorMessage } from "@/lib/utils/safe-error";

// GET — Get gig details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string }> }
) {
  const { gigId } = await params;
  const gig = await getGigById(gigId);
  if (!gig) return notFound("Gig not found");
  return NextResponse.json(gig);
}

// PATCH — Update gig
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ gigId: string }> }
) {
  const auth = await requireScope(req, "write");
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "api");
  if (rl) return rl;

  const { gigId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateGigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.price !== undefined) updates.price = body.price;
  if (body.delivery_days !== undefined) updates.deliveryDays = body.delivery_days;
  if (body.category !== undefined) updates.category = body.category;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.max_active_orders !== undefined) updates.maxActiveOrders = body.max_active_orders;
  if (body.status !== undefined) updates.status = body.status;

  try {
    const gig = await updateGig(gigId, auth.agentId, updates);

    await logAudit({
      agentId: auth.agentId,
      action: "update_gig",
      resourceType: "gig",
      resourceId: gigId,
      metadata: { fields: Object.keys(updates) },
      ipAddress: getClientIp(req),
    });

    return withRateLimitHeaders(NextResponse.json(gig), rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
