import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/middleware/rate-limit";
import { buildCreateEscrowData } from "@/lib/bsc/escrow-contract";
import { db } from "@/lib/db";
import { agents, escrows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ESCROW_CONTRACT_ADDRESS, SUPPORTED_TOKENS } from "@/lib/bsc/constants";
import { safeErrorMessage } from "@/lib/utils/safe-error";

const createEscrowSchema = z.object({
  recipient_agent_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a valid number"),
  token: z.enum(SUPPORTED_TOKENS).default("USDC"),
  deadline_hours: z.number().int().min(1).max(720).default(168),
  dispute_window_hours: z.number().int().min(1).max(168).default(48),
  assignment_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  gig_order_id: z.string().uuid().optional(),
  bounty_claim_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { blocked: rl, headers: rlHeaders } = await checkRateLimit(auth.agentId, "sensitive");
  if (rl) return rl;

  if (!ESCROW_CONTRACT_ADDRESS) {
    return NextResponse.json(
      { error: "On-chain escrow not available" },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEscrowSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { recipient_agent_id, amount, token, deadline_hours, dispute_window_hours } = parsed.data;

  try {
    // All agents are non-custodial — return unsigned tx data for agent to sign locally
    const [recipient] = await db
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, recipient_agent_id));

    if (!recipient?.walletAddress) {
      return NextResponse.json(
        { error: "Recipient wallet not found" },
        { status: 400 }
      );
    }

    // Create a pending DB record so the escrow is trackable
    const [pendingEscrow] = await db
      .insert(escrows)
      .values({
        funderAgentId: auth.agentId,
        recipientAgentId: recipient_agent_id,
        amount,
        assignmentId: parsed.data.assignment_id || null,
        taskId: parsed.data.task_id || null,
        gigOrderId: parsed.data.gig_order_id || null,
        bountyClaimId: parsed.data.bounty_claim_id || null,
      })
      .returning();

    const txData = buildCreateEscrowData({
      escrowId: pendingEscrow.id,
      seller: recipient.walletAddress,
      token,
      amount,
      deadlineHours: deadline_hours,
      disputeWindowHours: dispute_window_hours,
    });

    return withRateLimitHeaders(
      NextResponse.json({
        escrow_id: pendingEscrow.id,
        transactions: [
          {
            step: 1,
            description: `Approve ${token} spending`,
            to: txData.approveData.to,
            data: txData.approveData.data,
          },
          {
            step: 2,
            description: "Create on-chain escrow",
            to: txData.to,
            data: txData.data,
          },
        ],
        instructions: "Sign and submit both transactions in order. Step 1 approves token spending, step 2 creates the escrow. After step 2 is confirmed on-chain, call POST /api/v1/wallet/on-chain-escrow/confirm with { escrow_id, tx_hash } to activate the escrow.",
      })
    , rlHeaders);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 400 }
    );
  }
}
