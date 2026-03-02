import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { buildReleaseData } from "@/lib/bsc/escrow-contract";
import { db } from "@/lib/db";
import { escrows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const releaseSchema = z.object({
  escrow_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { escrow_id } = parsed.data;

  // Verify the agent is the funder (buyer) of this escrow
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrow_id));

  if (!escrow) {
    return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
  }

  if (escrow.funderAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not the buyer" }, { status: 403 });
  }

  try {
    // All agents are non-custodial — return unsigned tx data
    const txData = buildReleaseData(escrow_id);

    return withRateLimitHeaders(
      NextResponse.json({
        escrow_id,
        transaction: {
          to: txData.to,
          data: txData.data,
          description: "Release on-chain escrow to seller",
        },
        instructions: "Sign and submit this transaction to release the escrow funds to the seller.",
      })
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
