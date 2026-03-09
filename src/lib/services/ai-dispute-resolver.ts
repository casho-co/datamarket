import { db } from "@/lib/db";
import {
  disputes,
  assignments,
  jobs,
  agents,
  bids,
  escrows,
  submissionHistory,
  disputeEvidence,
  messages,
  reputation,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveDispute } from "./dispute";

let _openai: any = null;
async function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    const { default: OpenAI } = await import("openai");
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

interface DisputeContext {
  dispute: {
    id: string;
    reason: string;
    depositAmount: string;
    createdAt: Date;
    votingDeadline: Date | null;
  };
  job: {
    id: string;
    title: string;
    description: string;
    budgetAmount: string | null;
    maxRevisions: number;
    deadlineSeconds: number;
    tags: string[] | null;
  };
  creator: {
    id: string;
    handle: string | null;
    reputationScore: number | null;
    completedJobs: number;
    disputesLost: number;
  };
  worker: {
    id: string;
    handle: string | null;
    reputationScore: number | null;
    completedJobs: number;
    disputesLost: number;
  };
  assignment: {
    id: string;
    escrowAmount: string;
    deliverableType: string | null;
    deliverableUrl: string | null;
    deliverableHash: string | null;
    inlineResponse: string | null;
    revisionCount: number;
    submittedAt: Date | null;
    deadlineAt: Date;
    createdAt: Date;
  };
  bid: {
    amount: string;
    etaSeconds: number;
    proposal: string | null;
  } | null;
  submissionHistory: {
    revision: number;
    deliverableType: string;
    deliverableUrl: string | null;
    inlineResponse: string | null;
    feedback: string | null;
    submittedAt: Date;
  }[];
  evidence: {
    submitterAgentId: string;
    submitterRole: string;
    type: string;
    url: string | null;
    description: string | null;
    createdAt: Date;
  }[];
  messages: {
    senderAgentId: string;
    senderRole: string;
    body: string;
    createdAt: Date;
  }[];
}

async function gatherDisputeContext(disputeId: string): Promise<DisputeContext | null> {
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId));
  if (!dispute || !dispute.assignmentId) return null;

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, dispute.assignmentId));
  if (!assignment) return null;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, assignment.jobId));
  if (!job) return null;

  // Fetch creator and worker agents + reputation
  const [creatorAgent] = await db.select().from(agents).where(eq(agents.id, job.creatorAgentId));
  const [workerAgent] = await db.select().from(agents).where(eq(agents.id, assignment.workerAgentId));

  const [creatorRep] = await db
    .select()
    .from(reputation)
    .where(eq(reputation.agentId, job.creatorAgentId));
  const [workerRep] = await db
    .select()
    .from(reputation)
    .where(eq(reputation.agentId, assignment.workerAgentId));

  // Fetch the accepted bid
  const [bid] = await db
    .select()
    .from(bids)
    .where(eq(bids.id, assignment.bidId));

  // Fetch submission history with feedback
  const history = await db
    .select()
    .from(submissionHistory)
    .where(eq(submissionHistory.assignmentId, assignment.id))
    .orderBy(submissionHistory.revision);

  // Fetch evidence
  const evidenceRows = await db
    .select()
    .from(disputeEvidence)
    .where(eq(disputeEvidence.disputeId, disputeId))
    .orderBy(disputeEvidence.createdAt);

  // Fetch messages on the job
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.jobId, job.id))
    .orderBy(messages.createdAt);

  return {
    dispute: {
      id: dispute.id,
      reason: dispute.reason,
      depositAmount: dispute.depositAmount,
      createdAt: dispute.createdAt,
      votingDeadline: dispute.votingDeadline,
    },
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      budgetAmount: job.budgetAmount,
      maxRevisions: job.maxRevisions,
      deadlineSeconds: job.deadlineSeconds,
      tags: job.tags as string[] | null,
    },
    creator: {
      id: job.creatorAgentId,
      handle: creatorAgent?.handle || null,
      reputationScore: creatorRep?.score ?? null,
      completedJobs: creatorRep?.completedJobs ?? 0,
      disputesLost: creatorRep?.disputesLost ?? 0,
    },
    worker: {
      id: assignment.workerAgentId,
      handle: workerAgent?.handle || null,
      reputationScore: workerRep?.score ?? null,
      completedJobs: workerRep?.completedJobs ?? 0,
      disputesLost: workerRep?.disputesLost ?? 0,
    },
    assignment: {
      id: assignment.id,
      escrowAmount: assignment.escrowAmount,
      deliverableType: assignment.deliverableType,
      deliverableUrl: assignment.deliverableUrl,
      deliverableHash: assignment.deliverableHash,
      inlineResponse: assignment.inlineResponse,
      revisionCount: assignment.revisionCount,
      submittedAt: assignment.submittedAt,
      deadlineAt: assignment.deadlineAt,
      createdAt: assignment.createdAt,
    },
    bid: bid
      ? {
          amount: bid.amount,
          etaSeconds: bid.etaSeconds,
          proposal: bid.proposal,
        }
      : null,
    submissionHistory: history.map((h) => ({
      revision: h.revision,
      deliverableType: h.deliverableType,
      deliverableUrl: h.deliverableUrl,
      inlineResponse: h.inlineResponse
        ? h.inlineResponse.length > 2000
          ? h.inlineResponse.slice(0, 2000) + "... [truncated]"
          : h.inlineResponse
        : null,
      feedback: h.feedback,
      submittedAt: h.submittedAt,
    })),
    evidence: evidenceRows.map((e) => ({
      submitterAgentId: e.submitterAgentId,
      submitterRole:
        e.submitterAgentId === job.creatorAgentId
          ? "creator"
          : e.submitterAgentId === assignment.workerAgentId
            ? "worker"
            : "third_party",
      type: e.type,
      url: e.url,
      description: e.description,
      createdAt: e.createdAt,
    })),
    messages: messageRows.map((m) => ({
      senderAgentId: m.senderAgentId,
      senderRole:
        m.senderAgentId === job.creatorAgentId
          ? "creator"
          : m.senderAgentId === assignment.workerAgentId
            ? "worker"
            : "other",
      body:
        m.body.length > 1000 ? m.body.slice(0, 1000) + "... [truncated]" : m.body,
      createdAt: m.createdAt,
    })),
  };
}

function buildPrompt(ctx: DisputeContext): string {
  const wasSubmittedOnTime = ctx.assignment.submittedAt
    ? new Date(ctx.assignment.submittedAt).getTime() <=
      new Date(ctx.assignment.deadlineAt).getTime()
    : false;

  const hasDeliverable =
    !!ctx.assignment.deliverableUrl || !!ctx.assignment.inlineResponse;

  return `You are an impartial dispute resolver for the Datalayer marketplace — a platform where AI agents and humans post jobs, bid on them, and deliver work with USDC escrow on BNB Smart Chain.

You must analyze the full context of this dispute and issue a fair, well-reasoned ruling.

═══════════════════════════════════════════
DISPUTE DETAILS
═══════════════════════════════════════════
Dispute ID: ${ctx.dispute.id}
Dispute Reason: ${ctx.dispute.reason}
Opened: ${ctx.dispute.createdAt.toISOString()}
Deposit at Stake: ${ctx.dispute.depositAmount} USDC

═══════════════════════════════════════════
JOB SPECIFICATION
═══════════════════════════════════════════
Title: ${ctx.job.title}
Description:
${ctx.job.description}
Budget: ${ctx.job.budgetAmount || "Not set"} USDC
Max Revisions Allowed: ${ctx.job.maxRevisions}
Deadline: ${Math.round(ctx.job.deadlineSeconds / 3600)} hours
Tags: ${ctx.job.tags?.join(", ") || "None"}

═══════════════════════════════════════════
PARTIES
═══════════════════════════════════════════
REQUESTER (Job Creator):
  - Handle: ${ctx.creator.handle || "anonymous"}
  - Reputation Score: ${ctx.creator.reputationScore ?? "N/A"}/100
  - Completed Jobs Created: ${ctx.creator.completedJobs}
  - Disputes Lost: ${ctx.creator.disputesLost}

WORKER (Deliverer):
  - Handle: ${ctx.worker.handle || "anonymous"}
  - Reputation Score: ${ctx.worker.reputationScore ?? "N/A"}/100
  - Completed Jobs: ${ctx.worker.completedJobs}
  - Disputes Lost: ${ctx.worker.disputesLost}

═══════════════════════════════════════════
WORKER'S BID & PROPOSAL
═══════════════════════════════════════════
${
  ctx.bid
    ? `Bid Amount: ${ctx.bid.amount} USDC
ETA: ${Math.round(ctx.bid.etaSeconds / 3600)} hours
Proposal: ${ctx.bid.proposal || "No proposal provided"}`
    : "No bid information available"
}

═══════════════════════════════════════════
ASSIGNMENT & DELIVERY STATUS
═══════════════════════════════════════════
Escrow Amount: ${ctx.assignment.escrowAmount} USDC
Assigned: ${ctx.assignment.createdAt.toISOString()}
Deadline: ${ctx.assignment.deadlineAt.toISOString()}
Submitted On Time: ${wasSubmittedOnTime ? "YES" : "NO"}
Submitted At: ${ctx.assignment.submittedAt?.toISOString() || "Not submitted"}
Revision Count: ${ctx.assignment.revisionCount}/${ctx.job.maxRevisions}
Has Deliverable: ${hasDeliverable ? "YES" : "NO"}
Deliverable Type: ${ctx.assignment.deliverableType || "N/A"}
${ctx.assignment.deliverableUrl ? `Deliverable URL: ${ctx.assignment.deliverableUrl}` : ""}
${ctx.assignment.deliverableHash ? `Deliverable Hash (SHA-256): ${ctx.assignment.deliverableHash}` : ""}
${ctx.assignment.inlineResponse ? `Inline Response:\n${ctx.assignment.inlineResponse.length > 3000 ? ctx.assignment.inlineResponse.slice(0, 3000) + "... [truncated]" : ctx.assignment.inlineResponse}` : ""}

═══════════════════════════════════════════
SUBMISSION HISTORY (All Revisions)
═══════════════════════════════════════════
${
  ctx.submissionHistory.length > 0
    ? ctx.submissionHistory
        .map(
          (s) =>
            `Revision ${s.revision} (${s.submittedAt.toISOString()}):
  Type: ${s.deliverableType}
  ${s.deliverableUrl ? `URL: ${s.deliverableUrl}` : ""}
  ${s.inlineResponse ? `Response: ${s.inlineResponse}` : ""}
  ${s.feedback ? `Creator Feedback: ${s.feedback}` : "No feedback given"}`
        )
        .join("\n\n")
    : "No submission history available"
}

═══════════════════════════════════════════
EVIDENCE SUBMITTED
═══════════════════════════════════════════
${
  ctx.evidence.length > 0
    ? ctx.evidence
        .map(
          (e) =>
            `[${e.submitterRole.toUpperCase()}] (${e.createdAt.toISOString()})
  Type: ${e.type}
  ${e.url ? `URL: ${e.url}` : ""}
  ${e.description ? `Description: ${e.description}` : ""}`
        )
        .join("\n\n")
    : "No evidence submitted by either party"
}

═══════════════════════════════════════════
JOB MESSAGES (Communication History)
═══════════════════════════════════════════
${
  ctx.messages.length > 0
    ? ctx.messages
        .map(
          (m) =>
            `[${m.senderRole.toUpperCase()}] (${m.createdAt.toISOString()}): ${m.body}`
        )
        .join("\n")
    : "No messages exchanged"
}

═══════════════════════════════════════════
RULING GUIDELINES
═══════════════════════════════════════════

You MUST analyze the above context and decide on ONE of these rulings:

1. **requester_wins** — Escrow refunded to the requester. Use when:
   - Worker failed to deliver any work
   - Work is completely unrelated to the job requirements
   - Worker clearly abandoned the job or delivered gibberish/placeholder content
   - Worker missed the deadline AND did not deliver anything meaningful
   - Deliverable is empty, broken, or clearly fraudulent

2. **worker_wins** — Escrow released to the worker. Use when:
   - Worker delivered work that substantially meets the job requirements
   - Requester's dispute reason is vague, unreasonable, or not substantiated
   - Work was delivered on time and matches the job description
   - Requester is attempting to get free work by disputing without valid cause
   - Minor imperfections that don't warrant withholding payment

3. **split** — Escrow split between both parties. Use when:
   - Work was partially completed — meaningful effort but doesn't fully meet requirements
   - Both parties share some responsibility for the outcome
   - Work quality is debatable but not zero-effort
   - If choosing split, you MUST specify split_bps (0-10000 basis points for the worker's share)
     - 5000 = 50/50 split
     - 7000 = 70% to worker, 30% to requester
     - 3000 = 30% to worker, 70% to requester

4. **redo** — Worker gets another chance to resubmit. Use when:
   - Work has clear issues but shows genuine effort and the worker can fix it
   - The requester's feedback is specific and actionable
   - Worker hasn't exhausted max revisions (${ctx.job.maxRevisions})
   - Current revision count: ${ctx.assignment.revisionCount}
   - The dispute seems premature and could be resolved with a revision
   - NOTE: Only use redo if revisionCount < maxRevisions

IMPORTANT PRINCIPLES:
- Be fair and objective. Do NOT favor either party by default.
- Weight evidence and communication heavily. Lack of communication from either side is a negative signal.
- A worker who delivers on time with a reasonable deliverable should generally win unless the deliverable clearly fails the requirements.
- A requester who disputes without specific reasoning or evidence should generally lose.
- Consider reputation history but don't let it be the sole deciding factor.
- If the deliverable URL is provided but you cannot verify its contents, consider the SHA-256 hash, inline response, and submission history as indicators of effort.

Respond with ONLY a valid JSON object (no markdown, no code fences):
{
  "ruling": "requester_wins" | "worker_wins" | "split" | "redo",
  "split_bps": <number 0-10000, ONLY if ruling is "split">,
  "reasoning": "<2-4 sentences explaining your ruling, referencing specific facts from the context>",
  "confidence": <number 0.0-1.0 indicating your confidence in this ruling>
}`;
}

interface AIRuling {
  ruling: "requester_wins" | "worker_wins" | "split" | "redo";
  split_bps?: number;
  reasoning: string;
  confidence: number;
}

async function getAIRuling(ctx: DisputeContext): Promise<AIRuling> {
  const prompt = buildPrompt(ctx);

  const openai = await getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert, impartial dispute resolver for a decentralized work marketplace. You analyze evidence and make fair rulings. Always respond with valid JSON only — no markdown fences, no extra text.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("AI returned empty response");

  const parsed = JSON.parse(raw) as AIRuling;

  // Validate
  const validRulings = ["requester_wins", "worker_wins", "split", "redo"];
  if (!validRulings.includes(parsed.ruling)) {
    throw new Error(`Invalid AI ruling: ${parsed.ruling}`);
  }
  if (parsed.ruling === "split") {
    if (
      typeof parsed.split_bps !== "number" ||
      parsed.split_bps < 0 ||
      parsed.split_bps > 10000
    ) {
      throw new Error(`Invalid split_bps: ${parsed.split_bps}`);
    }
  }
  if (typeof parsed.confidence !== "number") {
    parsed.confidence = 0.5;
  }

  return parsed;
}

/**
 * Resolve a single dispute using AI.
 * Returns the ruling details or null if the dispute is not eligible.
 */
export async function resolveDisputeWithAI(
  disputeId: string,
  resolverAgentId: string
): Promise<{
  disputeId: string;
  ruling: string;
  reasoning: string;
  confidence: number;
} | null> {
  const ctx = await gatherDisputeContext(disputeId);
  if (!ctx) {
    console.log(`[AI-Resolver] No context found for dispute ${disputeId}, skipping`);
    return null;
  }

  console.log(
    `[AI-Resolver] Analyzing dispute ${disputeId} for job "${ctx.job.title}" (${ctx.assignment.escrowAmount} USDC)`
  );

  const aiRuling = await getAIRuling(ctx);

  console.log(
    `[AI-Resolver] Ruling: ${aiRuling.ruling} (confidence: ${aiRuling.confidence}) — ${aiRuling.reasoning}`
  );

  // If confidence is very low, default to redo if possible
  if (
    aiRuling.confidence < 0.3 &&
    ctx.assignment.revisionCount < ctx.job.maxRevisions
  ) {
    console.log(
      `[AI-Resolver] Low confidence (${aiRuling.confidence}), overriding to redo`
    );
    aiRuling.ruling = "redo";
    aiRuling.reasoning += " [Low confidence — defaulting to redo to give worker another chance.]";
  }

  // Execute the ruling
  await resolveDispute({
    disputeId,
    resolverAgentId,
    ruling: aiRuling.ruling,
    splitBps: aiRuling.split_bps,
  });

  // Store the reasoning as evidence for transparency
  try {
    const { addEvidence } = await import("./dispute");
    await addEvidence({
      disputeId,
      submitterAgentId: resolverAgentId,
      type: "url",
      description: `[AI Resolver Ruling]\nRuling: ${aiRuling.ruling}${aiRuling.split_bps ? ` (${aiRuling.split_bps / 100}% to worker)` : ""}\nConfidence: ${(aiRuling.confidence * 100).toFixed(0)}%\nReasoning: ${aiRuling.reasoning}`,
    });
  } catch {
    // Evidence submission may fail if dispute is already resolved — that's OK
    console.log(`[AI-Resolver] Could not store reasoning as evidence (dispute already resolved)`);
  }

  return {
    disputeId,
    ruling: aiRuling.ruling,
    reasoning: aiRuling.reasoning,
    confidence: aiRuling.confidence,
  };
}

/**
 * Process all pending disputes assigned to the AI resolver agent.
 */
export async function processAllPendingDisputes(resolverAgentId: string) {
  const pendingDisputes = await db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.ruling, "pending"),
        eq(disputes.resolverAgentId, resolverAgentId)
      )
    )
    .orderBy(disputes.createdAt);

  console.log(
    `[AI-Resolver] Found ${pendingDisputes.length} pending disputes to resolve`
  );

  const results: {
    disputeId: string;
    status: "resolved" | "error";
    ruling?: string;
    error?: string;
  }[] = [];

  for (const dispute of pendingDisputes) {
    try {
      const result = await resolveDisputeWithAI(dispute.id, resolverAgentId);
      if (result) {
        results.push({
          disputeId: dispute.id,
          status: "resolved",
          ruling: result.ruling,
        });
      } else {
        results.push({
          disputeId: dispute.id,
          status: "error",
          error: "No context available",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AI-Resolver] Error resolving dispute ${dispute.id}:`, msg);
      results.push({ disputeId: dispute.id, status: "error", error: msg });
    }
  }

  return results;
}
