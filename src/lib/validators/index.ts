import { z } from "zod";

// ═══════════════════════════════════════════════
// Common Validators
// ═══════════════════════════════════════════════

const MAX_AMOUNT = 1_000_000;
export const amountString = z
  .string()
  .regex(
    /^\d+(\.\d{1,6})?$/,
    "Must be a decimal number with up to 6 decimal places"
  )
  .refine((v) => {
    const n = parseFloat(v);
    return n > 0 && n <= MAX_AMOUNT;
  }, `Amount must be between 0 and ${MAX_AMOUNT}`);

const bscAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid BSC wallet address");

const hexSignature = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, "Invalid hex signature");

const sha256Hash = z
  .string()
  .regex(
    /^(sha256:)?[a-fA-F0-9]{64}$/,
    "Must be a SHA-256 hash (64 hex chars)"
  )
  .max(255);

const txHash = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash");

/** URL validated via the URL constructor — only http/https accepted. */
const safeUrl = (maxLen = 512) =>
  z
    .string()
    .max(maxLen)
    .refine((u) => {
      try {
        const { protocol } = new URL(u);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Must be a valid http or https URL");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ═══════════════════════════════════════════════
// Agent Schemas
// ═══════════════════════════════════════════════

export const challengeSchema = z.object({
  wallet_address: bscAddress,
  action: z.enum(["register", "login"]).default("register"),
});

export const registerAgentSchema = z.object({
  wallet_address: bscAddress,
  signature: hexSignature,
  nonce: z.string().uuid("Invalid nonce format"),
  handle: z
    .string()
    .regex(/^[a-z0-9_]+$/, "Lowercase alphanumeric only")
    .min(3)
    .max(20)
    .optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  skill_tags: z.array(z.string().max(50)).max(20).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  actor_type: z.enum(["human", "agent"]).default("agent"),
  webhook_url: safeUrl().optional(),
  mcp_endpoint: safeUrl().optional(),
});

export const loginSchema = z.object({
  wallet_address: bscAddress,
  signature: hexSignature,
  nonce: z.string().uuid("Invalid nonce format"),
});

export const updateAgentSchema = z.object({
  handle: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .min(3)
    .max(20)
    .optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  skill_tags: z.array(z.string().max(50)).max(20).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  availability_status: z.enum(["online", "offline", "busy"]).optional(),
  webhook_url: safeUrl().nullable().optional(),
  webhook_events: z
    .array(
      z.enum([
        "agent.registered",
        "job.created",
        "job.awarded",
        "job.completed",
        "job.cancelled",
        "bid.received",
        "bid.accepted",
        "bid.rejected",
        "work.submitted",
        "work.accepted",
        "work.disputed",
        "task.quote_requested",
        "task.quote_received",
        "gig.order_placed",
        "bounty.claimed",
      ])
    )
    .max(15)
    .nullable()
    .optional(),
  mcp_endpoint: safeUrl().nullable().optional(),
});

export const createApiKeySchema = z.object({
  label: z.string().max(100).optional(),
  scopes: z
    .array(z.enum(["read", "write", "financial", "admin"]))
    .min(1)
    .max(4),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
});

// ═══════════════════════════════════════════════
// Job Schemas
// ═══════════════════════════════════════════════

export const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  tags: z.array(z.string().max(50)).max(20).optional(),
  budget_amount: amountString,
  job_type: z.enum(["standard", "competition"]).default("standard"),
  deadline_seconds: z.coerce
    .number()
    .int()
    .min(3600)
    .max(604800)
    .default(86400),
  dispute_agent_id: z.string().uuid().optional(),
  requires_verifiable: z.boolean().default(false),
  max_revisions: z.coerce.number().int().min(0).max(10).default(3),
  auto_release_days: z.coerce.number().int().min(1).max(30).default(7),
});

// ═══════════════════════════════════════════════
// Bid Schemas
// ═══════════════════════════════════════════════

export const placeBidSchema = z.object({
  amount: amountString,
  eta_seconds: z.coerce
    .number()
    .int()
    .min(60, "ETA must be at least 60 seconds"),
  proposal: z.string().max(10000).optional(),
});

export const awardJobSchema = z.object({
  bid_id: z.string().uuid("Valid bid_id required"),
});

// ═══════════════════════════════════════════════
// Task Schemas (Quote-Based)
// ═══════════════════════════════════════════════

export const createTaskSchema = z.object({
  worker_agent_id: z.string().uuid("Target agent ID required"),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const submitQuoteSchema = z.object({
  amount: amountString,
  eta_seconds: z.coerce
    .number()
    .int()
    .min(60, "ETA must be at least 60 seconds"),
  message: z.string().max(5000).optional(),
});

// ═══════════════════════════════════════════════
// Gig Schemas
// ═══════════════════════════════════════════════

export const createGigSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  price: amountString,
  delivery_days: z.coerce.number().int().min(1).max(90),
  category: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  max_active_orders: z.coerce.number().int().min(1).max(50).default(5),
});

export const updateGigSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(50000).optional(),
  price: amountString.optional(),
  delivery_days: z.coerce.number().int().min(1).max(90).optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  max_active_orders: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

export const orderGigSchema = z.object({
  requirements: z.string().max(10000).optional(),
});

// ═══════════════════════════════════════════════
// Bounty Schemas
// ═══════════════════════════════════════════════

export const createBountySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  reward: amountString,
  tags: z.array(z.string().max(50)).max(20).optional(),
  max_claims: z.coerce.number().int().min(1).max(100).default(1),
  deadline_days: z.coerce.number().int().min(1).max(90),
});

// ═══════════════════════════════════════════════
// Deliverable Schemas (shared, multi-type)
// ═══════════════════════════════════════════════

export const submitWorkSchema = z
  .object({
    type: z
      .enum(["url", "file", "inline", "hash_only"])
      .default("url"),
    // URL submission
    deliverable_url: safeUrl().optional(),
    // SHA-256 hash for verification
    deliverable_hash: sha256Hash.optional(),
    // R2 file upload ID
    file_id: z.string().uuid().optional(),
    // Inline text response
    inline_response: z.string().max(100000).optional(),
  })
  .refine(
    (d) => {
      switch (d.type) {
        case "url":
          return !!d.deliverable_url;
        case "file":
          return !!d.file_id;
        case "inline":
          return !!d.inline_response && d.inline_response.trim().length > 0;
        case "hash_only":
          return !!d.deliverable_hash;
        default:
          return false;
      }
    },
    {
      message:
        "Missing required field for submission type: url requires deliverable_url, file requires file_id, inline requires inline_response, hash_only requires deliverable_hash",
    }
  );

// ═══════════════════════════════════════════════
// Review Schemas
// ═══════════════════════════════════════════════

export const createReviewSchema = z
  .object({
    reviewee_agent_id: z.string().uuid(),
    job_id: z.string().uuid().optional(),
    task_id: z.string().uuid().optional(),
    gig_order_id: z.string().uuid().optional(),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().max(5000).optional(),
  })
  .refine(
    (d) => d.job_id || d.task_id || d.gig_order_id,
    "Must reference a job_id, task_id, or gig_order_id"
  );

// ═══════════════════════════════════════════════
// Dispute Schemas
// ═══════════════════════════════════════════════

export const openDisputeSchema = z.object({
  reason: z.string().min(1).max(5000),
});

export const addEvidenceSchema = z.object({
  type: z.enum(["url", "photo", "tracking", "hash"]),
  url: safeUrl().optional(),
  description: z.string().max(5000).optional(),
});

export const resolveDisputeSchema = z
  .object({
    ruling: z.enum(["requester_wins", "worker_wins", "split", "redo"]),
    split_bps: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .refine(
    (d) =>
      d.ruling !== "split" ||
      (d.split_bps !== undefined && d.split_bps >= 0),
    { message: "split_bps required for split ruling" }
  );

export const assignPanelSchema = z.object({
  resolver_agent_ids: z.array(z.string().uuid()).min(3).max(7),
});

export const panelVoteSchema = z
  .object({
    ruling: z.enum(["requester_wins", "worker_wins", "split", "redo"]),
    split_bps: z.coerce.number().int().min(0).max(10000).optional(),
    reason: z.string().max(5000).optional(),
  })
  .refine(
    (d) =>
      d.ruling !== "split" ||
      (d.split_bps !== undefined && d.split_bps >= 0),
    { message: "split_bps required for split ruling" }
  );

// ═══════════════════════════════════════════════
// Message Schemas
// ═══════════════════════════════════════════════

export const createMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

export const sendDirectMessageSchema = z.object({
  recipient_agent_id: z.string().uuid(),
  body: z.string().min(1).max(10000),
});

export const reactionSchema = z.object({
  emoji: z.enum([
    "thumbs_up",
    "thumbs_down",
    "fire",
    "heart",
    "rocket",
    "eyes",
    "100",
    "check",
  ]),
});

// ═══════════════════════════════════════════════
// Competition Schemas
// ═══════════════════════════════════════════════

export const submitEntrySchema = z.object({
  deliverable_url: safeUrl(),
  deliverable_hash: sha256Hash,
});

export const resolveCompetitionSchema = z.object({
  prizes: z
    .array(
      z.object({
        entryId: z.string().uuid(),
        bps: z.number().int().min(0).max(10000),
      })
    )
    .min(1)
    .refine(
      (prizes) => prizes.reduce((sum, p) => sum + p.bps, 0) <= 10000,
      "Total prize BPS must not exceed 10000"
    ),
});

// ═══════════════════════════════════════════════
// Wallet Schemas
// ═══════════════════════════════════════════════

export const signMessageSchema = z.object({
  message: z.string().min(1).max(10000),
});

export const buildTxSchema = z.object({
  to: bscAddress,
  value: z.string().optional(),
  data: z.string().optional(),
});

export const verifyFundingSchema = z.object({
  tx_hash: txHash,
  job_id: z.string().uuid(),
});

// ═══════════════════════════════════════════════
// Request Changes Schema
// ═══════════════════════════════════════════════

export const requestChangesSchema = z.object({
  feedback: z.string().min(1).max(10000),
});

// ═══════════════════════════════════════════════
// File Upload Schema
// ═══════════════════════════════════════════════

export const uploadUrlSchema = z.object({
  job_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(100),
  size_bytes: z.coerce.number().int().min(1).max(100 * 1024 * 1024).optional(),
});

// ═══════════════════════════════════════════════
// Job Template Schemas (P2)
// ═══════════════════════════════════════════════

export const createJobTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  tags: z.array(z.string().max(50)).max(20).optional(),
  budget_amount: amountString.optional(),
  job_type: z.enum(["standard", "competition"]).default("standard"),
  deadline_seconds: z.coerce.number().int().min(3600).max(604800).default(86400),
  requires_verifiable: z.boolean().default(false),
});

export const updateJobTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(50000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  budget_amount: amountString.optional(),
  job_type: z.enum(["standard", "competition"]).optional(),
  deadline_seconds: z.coerce.number().int().min(3600).max(604800).optional(),
  requires_verifiable: z.boolean().optional(),
});

// ═══════════════════════════════════════════════
// Token Launch Schemas (Four.meme)
// ═══════════════════════════════════════════════

export const launchTokenSchema = z.object({
  name: z.string().min(1).max(100),
  symbol: z.string().min(1).max(20),
  description: z.string().min(1).max(5000),
  image_url: safeUrl().optional(),
  total_supply: z.coerce.number().int().min(1).max(100_000_000_000).default(1_000_000_000),
  raised_amount: z.coerce.number().min(1).max(1000).default(24),
  initial_buy_bnb: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid BNB amount").default("0"),
  label: z.string().max(50).default("Meme"),
  web_url: safeUrl().optional(),
  twitter_url: safeUrl().optional(),
  telegram_url: safeUrl().optional(),
});

// ═══════════════════════════════════════════════
// Token Buy / Sell Schemas (Four.meme Bonding Curve)
// ═══════════════════════════════════════════════

export const buyTokenSchema = z.object({
  token_address: bscAddress,
  amount_bnb: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid BNB amount"),
  min_tokens: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid token amount").optional(),
});

export const sellTokenSchema = z.object({
  token_address: bscAddress,
  token_amount: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid token amount"),
});

// ═══════════════════════════════════════════════
// Swap Schemas (LiFi — PancakeSwap / DEX)
// ═══════════════════════════════════════════════

export const swapQuoteSchema = z.object({
  from_token: z.string().min(1).max(42),
  to_token: z.string().min(1).max(42),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid amount"),
  from_chain: z.string().max(20).default("bsc"),
  to_chain: z.string().max(20).default("bsc"),
  slippage: z.coerce.number().min(0.001).max(0.5).default(0.05),
});

export const swapExecuteSchema = z.object({
  from_token: z.string().min(1).max(42),
  to_token: z.string().min(1).max(42),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/, "Invalid amount"),
  from_chain: z.string().max(20).default("bsc"),
  to_chain: z.string().max(20).default("bsc"),
  slippage: z.coerce.number().min(0.001).max(0.5).default(0.05),
});

// ═══════════════════════════════════════════════
// Batch Operations Schemas (P2)
// ═══════════════════════════════════════════════

export const batchCreateJobsSchema = z.object({
  jobs: z.array(createJobSchema).min(1).max(10),
});

export const batchCancelJobsSchema = z.object({
  job_ids: z.array(z.string().uuid()).min(1).max(10),
});

// ═══════════════════════════════════════════════
// Escrow Milestone Schemas (P2)
// ═══════════════════════════════════════════════

export const createMilestonesSchema = z.object({
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        amount: amountString,
      })
    )
    .min(2)
    .max(10),
});

export const releaseMilestoneSchema = z.object({
  milestone_id: z.string().uuid(),
});

// ═══════════════════════════════════════════════
// Agent Delegation Schemas (P2)
// ═══════════════════════════════════════════════

export const createDelegationSchema = z.object({
  delegate_agent_id: z.string().uuid(),
  source_job_id: z.string().uuid().optional(),
  source_task_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  reason: z.string().max(5000).optional(),
});

