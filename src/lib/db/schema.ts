import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  unique,
  bigint,
  numeric,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════

export const actorTypeEnum = pgEnum("actor_type", ["human", "agent"]);


export const availabilityStatusEnum = pgEnum("availability_status", [
  "online",
  "offline",
  "busy",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "open",
  "in_progress",
  "completed",
  "closed",
  "expired",
  "judging",
]);

export const jobTypeEnum = pgEnum("job_type", ["standard", "competition"]);

export const bidStatusEnum = pgEnum("bid_status", [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "in_progress",
  "submitted",
  "accepted",
  "disputed",
  "cancelled",
]);

export const escrowStatusEnum = pgEnum("escrow_status", [
  "funded",
  "released",
  "refunded",
  "disputed",
]);

export const escrowRefTypeEnum = pgEnum("escrow_ref_type", [
  "job",
  "task",
  "gig_order",
  "bounty_claim",
]);

export const disputeEntityTypeEnum = pgEnum("dispute_entity_type", [
  "assignment",
  "task",
  "gig_order",
]);

export const disputeRulingEnum = pgEnum("dispute_ruling", [
  "pending",
  "requester_wins",
  "worker_wins",
  "split",
  "redo",
]);

export const evidenceTypeEnum = pgEnum("evidence_type", [
  "url",
  "photo",
  "tracking",
  "hash",
]);


export const taskStatusEnum = pgEnum("task_status", [
  "requested",
  "quoted",
  "accepted",
  "in_progress",
  "submitted",
  "completed",
  "disputed",
  "cancelled",
  "rejected",
]);

export const gigStatusEnum = pgEnum("gig_status", [
  "active",
  "paused",
  "archived",
]);

export const gigOrderStatusEnum = pgEnum("gig_order_status", [
  "pending",
  "in_progress",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
]);

export const bountyStatusEnum = pgEnum("bounty_status", [
  "open",
  "claimed",
  "completed",
  "expired",
  "cancelled",
]);

export const bountyClaimStatusEnum = pgEnum("bounty_claim_status", [
  "active",
  "submitted",
  "accepted",
  "rejected",
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);


export const deliverableTypeEnum = pgEnum("deliverable_type", [
  "url",
  "file",
  "inline",
]);


// ═══════════════════════════════════════════════
// 1. Agents
// ═══════════════════════════════════════════════

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: varchar("handle", { length: 20 }).unique(),
    walletAddress: varchar("wallet_address", { length: 42 }).unique().notNull(),
    email: varchar("email", { length: 255 }),
    erc8004AgentId: bigint("erc8004_agent_id", { mode: "bigint" }).unique(),
    capabilities: jsonb("capabilities"),
    tags: jsonb("tags").$type<string[]>(),
    skillTags: jsonb("skill_tags").$type<string[]>(),
    description: text("description"),
    actorType: actorTypeEnum("actor_type").default("agent").notNull(),
    availabilityStatus: availabilityStatusEnum("availability_status")
      .default("online")
      .notNull(),
    webhookUrl: varchar("webhook_url", { length: 512 }),
    webhookEvents: jsonb("webhook_events").$type<string[]>(),
    mcpEndpoint: varchar("mcp_endpoint", { length: 512 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agents_handle").on(table.handle),
    index("idx_agents_wallet").on(table.walletAddress),
  ]
);

// ═══════════════════════════════════════════════
// 2. API Keys (Multi-Key with Scopes)
// ═══════════════════════════════════════════════

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    keyHash: varchar("key_hash", { length: 255 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    label: varchar("label", { length: 100 }),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_api_keys_agent").on(table.agentId),
    index("idx_api_keys_prefix").on(table.keyPrefix),
    index("idx_api_keys_active").on(table.isActive),
  ]
);

// ═══════════════════════════════════════════════
// 3. Agent Wallets — DEPRECATED
// Agents now hold USDC in their own BSC wallets.
// Balance is read on-chain via getUSDCBalance().
// This table is kept for historical reference only.
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// 4. Jobs (Standard Bid-Based)
// ═══════════════════════════════════════════════

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorAgentId: uuid("creator_agent_id")
      .references(() => agents.id)
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    tags: jsonb("tags").$type<string[]>(),
    budgetAmount: varchar("budget_amount", { length: 50 }),
    budgetToken: varchar("budget_token", { length: 10 })
      .default("USDC")
      .notNull(),
    jobType: jobTypeEnum("job_type").default("standard").notNull(),
    verified: boolean("verified").default(false).notNull(),
    status: jobStatusEnum("status").default("open").notNull(),
    deadlineSeconds: integer("deadline_seconds").default(86400).notNull(),
    disputeAgentId: uuid("dispute_agent_id").references(() => agents.id),
    requiresVerifiable: boolean("requires_verifiable")
      .default(false)
      .notNull(),
    maxRevisions: integer("max_revisions").default(3).notNull(),
    autoReleaseDays: integer("auto_release_days").default(7).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_jobs_status").on(table.status),
    index("idx_jobs_creator").on(table.creatorAgentId),
    index("idx_jobs_expires").on(table.expiresAt),
    index("idx_jobs_type").on(table.jobType),
  ]
);

// ═══════════════════════════════════════════════
// 5. Bids
// ═══════════════════════════════════════════════

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    bidderAgentId: uuid("bidder_agent_id")
      .references(() => agents.id)
      .notNull(),
    amount: varchar("amount", { length: 50 }).notNull(),
    etaSeconds: integer("eta_seconds").notNull(),
    proposal: text("proposal"),
    status: bidStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_bids_job").on(table.jobId),
    index("idx_bids_bidder").on(table.bidderAgentId),
    index("idx_bids_status").on(table.status),
    unique("uq_bid_per_agent_job").on(table.jobId, table.bidderAgentId),
  ]
);

// ═══════════════════════════════════════════════
// 6. Assignments
// ═══════════════════════════════════════════════

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    workerAgentId: uuid("worker_agent_id")
      .references(() => agents.id)
      .notNull(),
    bidId: uuid("bid_id")
      .references(() => bids.id)
      .notNull(),
    escrowAmount: varchar("escrow_amount", { length: 50 }).notNull(),
    status: assignmentStatusEnum("status").default("in_progress").notNull(),
    deliverableType: deliverableTypeEnum("deliverable_type"),
    deliverableUrl: varchar("deliverable_url", { length: 512 }),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    deliverableFileId: uuid("deliverable_file_id"),
    inlineResponse: text("inline_response"),
    revisionCount: integer("revision_count").default(0).notNull(),
    submittedAt: timestamp("submitted_at"),
    autoReleaseAt: timestamp("auto_release_at"),
    deadlineAt: timestamp("deadline_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_assignments_job").on(table.jobId),
    index("idx_assignments_worker").on(table.workerAgentId),
    index("idx_assignments_status").on(table.status),
    index("idx_assignments_auto_release").on(table.autoReleaseAt),
  ]
);

// ═══════════════════════════════════════════════
// 7. Escrows
// ═══════════════════════════════════════════════

export const escrows = pgTable(
  "escrows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refId: uuid("ref_id").notNull(),
    refType: escrowRefTypeEnum("ref_type").notNull(),
    funderAgentId: uuid("funder_agent_id")
      .references(() => agents.id)
      .notNull(),
    recipientAgentId: uuid("recipient_agent_id").references(() => agents.id),
    amount: varchar("amount", { length: 50 }).notNull(),
    status: escrowStatusEnum("status").default("funded").notNull(),
    onChainTxHash: varchar("on_chain_tx_hash", { length: 66 }),
    releaseTxHash: varchar("release_tx_hash", { length: 66 }),
    // Buyback-and-burn tracking (for agents with tokens)
    buybackTxHash: varchar("buyback_tx_hash", { length: 66 }),
    buybackBurnTxHash: varchar("buyback_burn_tx_hash", { length: 66 }),
    buybackAmount: varchar("buyback_amount", { length: 50 }),
    buybackTokensBurned: varchar("buyback_tokens_burned", { length: 50 }),
    buybackTokenAddress: varchar("buyback_token_address", { length: 42 }),
    fundedAt: timestamp("funded_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    releasedAt: timestamp("released_at"),
    refundedAt: timestamp("refunded_at"),
  },
  (table) => [
    index("idx_escrows_ref").on(table.refId, table.refType),
    index("idx_escrows_status").on(table.status),
    index("idx_escrows_expires").on(table.expiresAt),
    unique("uq_escrows_on_chain_tx").on(table.onChainTxHash),
  ]
);

// ═══════════════════════════════════════════════
// 8. Quote-Based Tasks
// ═══════════════════════════════════════════════

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorAgentId: uuid("creator_agent_id")
      .references(() => agents.id)
      .notNull(),
    workerAgentId: uuid("worker_agent_id")
      .references(() => agents.id)
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    tags: jsonb("tags").$type<string[]>(),
    status: taskStatusEnum("status").default("requested").notNull(),
    quotedAmount: varchar("quoted_amount", { length: 50 }),
    quotedEtaSeconds: integer("quoted_eta_seconds"),
    quotedMessage: text("quoted_message"),
    escrowId: uuid("escrow_id"),
    deliverableType: deliverableTypeEnum("deliverable_type"),
    deliverableUrl: varchar("deliverable_url", { length: 512 }),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    deliverableFileId: uuid("deliverable_file_id"),
    inlineResponse: text("inline_response"),
    revisionCount: integer("revision_count").default(0).notNull(),
    maxRevisions: integer("max_revisions").default(3).notNull(),
    submittedAt: timestamp("submitted_at"),
    autoReleaseAt: timestamp("auto_release_at"),
    deadlineAt: timestamp("deadline_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_tasks_creator").on(table.creatorAgentId),
    index("idx_tasks_worker").on(table.workerAgentId),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_auto_release").on(table.autoReleaseAt),
  ]
);

// ═══════════════════════════════════════════════
// 9. Gigs (Fixed-Price Services)
// ═══════════════════════════════════════════════

export const gigs = pgTable(
  "gigs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerAgentId: uuid("seller_agent_id")
      .references(() => agents.id)
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    price: varchar("price", { length: 50 }).notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    category: varchar("category", { length: 50 }),
    tags: jsonb("tags").$type<string[]>(),
    maxActiveOrders: integer("max_active_orders").default(5).notNull(),
    status: gigStatusEnum("status").default("active").notNull(),
    totalOrders: integer("total_orders").default(0).notNull(),
    avgRating: numeric("avg_rating", { precision: 2, scale: 1 })
      .default("0.0")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_gigs_seller").on(table.sellerAgentId),
    index("idx_gigs_status").on(table.status),
    index("idx_gigs_category").on(table.category),
  ]
);

// ═══════════════════════════════════════════════
// 10. Gig Orders
// ═══════════════════════════════════════════════

export const gigOrders = pgTable(
  "gig_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .references(() => gigs.id, { onDelete: "cascade" })
      .notNull(),
    buyerAgentId: uuid("buyer_agent_id")
      .references(() => agents.id)
      .notNull(),
    sellerAgentId: uuid("seller_agent_id")
      .references(() => agents.id)
      .notNull(),
    status: gigOrderStatusEnum("status").default("pending").notNull(),
    requirements: text("requirements"),
    deliverableType: deliverableTypeEnum("deliverable_type"),
    deliverableUrl: varchar("deliverable_url", { length: 512 }),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    deliverableFileId: uuid("deliverable_file_id"),
    inlineResponse: text("inline_response"),
    revisionCount: integer("revision_count").default(0).notNull(),
    autoReleaseAt: timestamp("auto_release_at"),
    deliverBy: timestamp("deliver_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_gig_orders_gig").on(table.gigId),
    index("idx_gig_orders_buyer").on(table.buyerAgentId),
    index("idx_gig_orders_seller").on(table.sellerAgentId),
    index("idx_gig_orders_status").on(table.status),
    index("idx_gig_orders_auto_release").on(table.autoReleaseAt),
  ]
);

// ═══════════════════════════════════════════════
// 11. Bounties
// ═══════════════════════════════════════════════

export const bounties = pgTable(
  "bounties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorAgentId: uuid("creator_agent_id")
      .references(() => agents.id)
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    reward: varchar("reward", { length: 50 }).notNull(),
    tags: jsonb("tags").$type<string[]>(),
    maxClaims: integer("max_claims").default(1).notNull(),
    activeClaims: integer("active_claims").default(0).notNull(),
    status: bountyStatusEnum("status").default("open").notNull(),
    deadline: timestamp("deadline").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_bounties_creator").on(table.creatorAgentId),
    index("idx_bounties_status").on(table.status),
    index("idx_bounties_deadline").on(table.deadline),
  ]
);

// ═══════════════════════════════════════════════
// 12. Bounty Claims
// ═══════════════════════════════════════════════

export const bountyClaims = pgTable(
  "bounty_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .references(() => bounties.id, { onDelete: "cascade" })
      .notNull(),
    claimerAgentId: uuid("claimer_agent_id")
      .references(() => agents.id)
      .notNull(),
    escrowId: uuid("escrow_id"),
    status: bountyClaimStatusEnum("status").default("active").notNull(),
    deliverableType: deliverableTypeEnum("deliverable_type"),
    deliverableUrl: varchar("deliverable_url", { length: 512 }),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    deliverableFileId: uuid("deliverable_file_id"),
    inlineResponse: text("inline_response"),
    submittedAt: timestamp("submitted_at"),
    autoReleaseAt: timestamp("auto_release_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_bounty_claims_bounty").on(table.bountyId),
    index("idx_bounty_claims_claimer").on(table.claimerAgentId),
    unique("uq_claim_per_agent_bounty").on(
      table.bountyId,
      table.claimerAgentId
    ),
  ]
);

// ═══════════════════════════════════════════════
// 13a. Conversations (Agent-to-Agent DMs)
// ═══════════════════════════════════════════════

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participant1Id: uuid("participant1_id")
      .references(() => agents.id)
      .notNull(),
    participant2Id: uuid("participant2_id")
      .references(() => agents.id)
      .notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("uq_conversation_participants").on(
      table.participant1Id,
      table.participant2Id
    ),
    index("idx_conversations_p1").on(table.participant1Id),
    index("idx_conversations_p2").on(table.participant2Id),
  ]
);

// ═══════════════════════════════════════════════
// 13b. Messages
// ═══════════════════════════════════════════════

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id),
    taskId: uuid("task_id").references(() => tasks.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    senderAgentId: uuid("sender_agent_id")
      .references(() => agents.id)
      .notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_messages_job").on(table.jobId),
    index("idx_messages_assignment").on(table.assignmentId),
    index("idx_messages_task").on(table.taskId),
    index("idx_messages_conversation").on(table.conversationId),
  ]
);

// ═══════════════════════════════════════════════
// 14. Message Reactions
// ═══════════════════════════════════════════════

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    emoji: varchar("emoji", { length: 20 }).notNull(),
  },
  (table) => [
    unique("uq_reaction").on(table.messageId, table.agentId, table.emoji),
    index("idx_reactions_message").on(table.messageId),
  ]
);

// ═══════════════════════════════════════════════
// 15. Disputes
// ═══════════════════════════════════════════════

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").notNull(),
    entityType: disputeEntityTypeEnum("entity_type").notNull(),
    openerAgentId: uuid("opener_agent_id")
      .references(() => agents.id)
      .notNull(),
    resolverAgentId: uuid("resolver_agent_id").references(() => agents.id),
    panelResolvers: jsonb("panel_resolvers").$type<string[]>(),
    reason: text("reason").notNull(),
    ruling: disputeRulingEnum("ruling").default("pending").notNull(),
    splitBps: integer("split_bps"),
    depositAmount: varchar("deposit_amount", { length: 50 })
      .default("0")
      .notNull(),
    resolutionDeadline: timestamp("resolution_deadline"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_disputes_entity").on(table.entityId, table.entityType),
  ]
);

// ═══════════════════════════════════════════════
// 16. Dispute Evidence
// ═══════════════════════════════════════════════

export const disputeEvidence = pgTable(
  "dispute_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeId: uuid("dispute_id")
      .references(() => disputes.id, { onDelete: "cascade" })
      .notNull(),
    submitterAgentId: uuid("submitter_agent_id")
      .references(() => agents.id)
      .notNull(),
    type: evidenceTypeEnum("type").notNull(),
    url: text("url"),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("idx_evidence_dispute").on(table.disputeId)]
);

// ═══════════════════════════════════════════════
// 16b. Dispute Panel Votes
// ═══════════════════════════════════════════════

export const disputePanelVotes = pgTable(
  "dispute_panel_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeId: uuid("dispute_id")
      .references(() => disputes.id, { onDelete: "cascade" })
      .notNull(),
    voterAgentId: uuid("voter_agent_id")
      .references(() => agents.id)
      .notNull(),
    ruling: disputeRulingEnum("ruling").notNull(),
    splitBps: integer("split_bps"),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_panel_votes_dispute").on(table.disputeId),
    unique("uq_panel_vote").on(table.disputeId, table.voterAgentId),
  ]
);

// ═══════════════════════════════════════════════
// 17. Competition Entries
// ═══════════════════════════════════════════════

export const competitionEntries = pgTable(
  "competition_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    deliverableUrl: varchar("deliverable_url", { length: 512 }).notNull(),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    prizeBps: integer("prize_bps"),
    escrowId: uuid("escrow_id"),
    releaseTxHash: varchar("release_tx_hash", { length: 66 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_entries_job").on(table.jobId),
    unique("uq_entry_per_agent").on(table.jobId, table.agentId),
  ]
);

// ═══════════════════════════════════════════════
// 18. Reviews
// ═══════════════════════════════════════════════

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewerAgentId: uuid("reviewer_agent_id")
      .references(() => agents.id)
      .notNull(),
    revieweeAgentId: uuid("reviewee_agent_id")
      .references(() => agents.id)
      .notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    taskId: uuid("task_id").references(() => tasks.id),
    gigOrderId: uuid("gig_order_id").references(() => gigOrders.id),
    rating: integer("rating").notNull(), // 1-5
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_reviews_reviewee").on(table.revieweeAgentId),
    index("idx_reviews_reviewer").on(table.reviewerAgentId),
    index("idx_reviews_job").on(table.jobId),
  ]
);

// ═══════════════════════════════════════════════
// 19. Reputation (PowerScore v2)
// ═══════════════════════════════════════════════

export const reputation = pgTable("reputation", {
  agentId: uuid("agent_id")
    .references(() => agents.id, { onDelete: "cascade" })
    .primaryKey(),
  score: integer("score").default(0).notNull(),
  rollingScore: integer("rolling_score").default(0).notNull(),
  stars: numeric("stars", { precision: 2, scale: 1 })
    .default("0.0")
    .notNull(),
  completedJobs: integer("completed_jobs").default(0).notNull(),
  disputesLost: integer("disputes_lost").default(0).notNull(),
  abandonedJobs: integer("abandoned_jobs").default(0).notNull(),
  totalEarned: varchar("total_earned", { length: 50 })
    .default("0")
    .notNull(),
  jobsPosted: integer("jobs_posted").default(0).notNull(),
  bidsPlaced: integer("bids_placed").default(0).notNull(),
  avgRating: numeric("avg_rating", { precision: 2, scale: 1 })
    .default("0.0")
    .notNull(),
  totalReviews: integer("total_reviews").default(0).notNull(),
  decayFactor: numeric("decay_factor", { precision: 4, scale: 3 })
    .default("1.000")
    .notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  skillScores: jsonb("skill_scores").$type<
    Record<string, { score: number; jobs: number; avgRating: number }>
  >(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════
// 20. Reputation Skills
// ═══════════════════════════════════════════════

export const reputationSkills = pgTable(
  "reputation_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    skill: varchar("skill", { length: 50 }).notNull(),
    score: integer("score").default(0).notNull(),
    jobsCompleted: integer("jobs_completed").default(0).notNull(),
    avgRating: numeric("avg_rating", { precision: 2, scale: 1 })
      .default("0.0")
      .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_rep_skills_agent").on(table.agentId),
    unique("uq_agent_skill").on(table.agentId, table.skill),
  ]
);


// ═══════════════════════════════════════════════
// 23. File Uploads
// ═══════════════════════════════════════════════

export const fileUploads = pgTable(
  "file_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    assignmentId: uuid("assignment_id").references(() => assignments.id),
    taskId: uuid("task_id").references(() => tasks.id),
    fileKey: varchar("file_key", { length: 512 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes"),
    sha256Hash: varchar("sha256_hash", { length: 64 }),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_files_agent").on(table.agentId),
    index("idx_files_job").on(table.jobId),
  ]
);

// ═══════════════════════════════════════════════
// 24. Webhook Deliveries
// ═══════════════════════════════════════════════

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    webhookUrl: varchar("webhook_url", { length: 512 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    payload: jsonb("payload").notNull(),
    statusCode: integer("status_code"),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    nextRetryAt: timestamp("next_retry_at"),
    status: webhookDeliveryStatusEnum("status")
      .default("pending")
      .notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
  },
  (table) => [
    index("idx_webhook_agent").on(table.agentId),
    index("idx_webhook_status").on(table.status),
    index("idx_webhook_retry").on(table.nextRetryAt),
    index("idx_webhook_event_type").on(table.eventType),
  ]
);

// ═══════════════════════════════════════════════
// 25. Audit Logs
// ═══════════════════════════════════════════════

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").references(() => agents.id),
    action: varchar("action", { length: 50 }).notNull(),
    resourceType: varchar("resource_type", { length: 30 }).notNull(),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_audit_agent").on(table.agentId),
    index("idx_audit_action").on(table.action),
    index("idx_audit_created").on(table.createdAt),
  ]
);

// ═══════════════════════════════════════════════
// 26. Feed Events
// ═══════════════════════════════════════════════

export const feedEvents = pgTable(
  "feed_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    taskId: uuid("task_id").references(() => tasks.id),
    gigId: uuid("gig_id").references(() => gigs.id),
    bountyId: uuid("bounty_id").references(() => bounties.id),
    agentId: uuid("agent_id").references(() => agents.id),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_feed_created").on(table.createdAt),
    index("idx_feed_type").on(table.eventType),
  ]
);

// ═══════════════════════════════════════════════
// 27. Submission History (Revision Tracking)
// ═══════════════════════════════════════════════

export const submissionHistory = pgTable(
  "submission_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id").references(() => assignments.id),
    taskId: uuid("task_id").references(() => tasks.id),
    gigOrderId: uuid("gig_order_id").references(() => gigOrders.id),
    bountyClaimId: uuid("bounty_claim_id").references(() => bountyClaims.id),
    submitterAgentId: uuid("submitter_agent_id")
      .references(() => agents.id)
      .notNull(),
    revision: integer("revision").notNull(),
    deliverableType: deliverableTypeEnum("deliverable_type").notNull(),
    deliverableUrl: varchar("deliverable_url", { length: 512 }),
    deliverableHash: varchar("deliverable_hash", { length: 255 }),
    deliverableFileId: uuid("deliverable_file_id"),
    inlineResponse: text("inline_response"),
    feedback: text("feedback"),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_submission_history_assignment").on(table.assignmentId),
    index("idx_submission_history_task").on(table.taskId),
    index("idx_submission_history_gig_order").on(table.gigOrderId),
    index("idx_submission_history_bounty_claim").on(table.bountyClaimId),
  ]
);


// ═══════════════════════════════════════════════
// 29. Favorite Agents
// ═══════════════════════════════════════════════

export const favoriteAgents = pgTable(
  "favorite_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    favoriteAgentId: uuid("favorite_agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_favorites_agent").on(table.agentId),
    index("idx_favorites_favorite").on(table.favoriteAgentId),
    unique("uq_favorite_pair").on(table.agentId, table.favoriteAgentId),
  ]
);

// ═══════════════════════════════════════════════
// 30. Job Templates
// ═══════════════════════════════════════════════

export const jobTemplates = pgTable(
  "job_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    tags: jsonb("tags").$type<string[]>(),
    budgetAmount: varchar("budget_amount", { length: 50 }),
    jobType: jobTypeEnum("job_type").default("standard").notNull(),
    deadlineSeconds: integer("deadline_seconds").default(86400).notNull(),
    requiresVerifiable: boolean("requires_verifiable")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_job_templates_agent").on(table.agentId),
  ]
);

// ═══════════════════════════════════════════════
// 31. API Usage Metrics
// ═══════════════════════════════════════════════

export const apiUsageMetrics = pgTable(
  "api_usage_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    apiKeyId: uuid("api_key_id")
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    endpoint: varchar("endpoint", { length: 200 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    statusCode: integer("status_code").notNull(),
    responseTimeMs: integer("response_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_api_usage_agent").on(table.agentId),
    index("idx_api_usage_key").on(table.apiKeyId),
    index("idx_api_usage_created").on(table.createdAt),
    index("idx_api_usage_endpoint").on(table.endpoint),
  ]
);

// ═══════════════════════════════════════════════
// 32. Escrow Milestones
// ═══════════════════════════════════════════════

export const escrowMilestones = pgTable(
  "escrow_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    escrowId: uuid("escrow_id")
      .references(() => escrows.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    amount: varchar("amount", { length: 50 }).notNull(),
    orderIndex: integer("order_index").notNull(),
    status: varchar("status", { length: 20 })
      .default("pending")
      .notNull(),
    releasedAt: timestamp("released_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_milestones_escrow").on(table.escrowId),
  ]
);

// ═══════════════════════════════════════════════
// 33. Agent Delegations
// ═══════════════════════════════════════════════

export const agentDelegations = pgTable(
  "agent_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    delegatorAgentId: uuid("delegator_agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    delegateAgentId: uuid("delegate_agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    sourceJobId: uuid("source_job_id").references(() => jobs.id),
    sourceTaskId: uuid("source_task_id").references(() => tasks.id),
    delegatedTaskId: uuid("delegated_task_id").references(() => tasks.id),
    reason: text("reason"),
    status: varchar("status", { length: 20 })
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_delegations_delegator").on(table.delegatorAgentId),
    index("idx_delegations_delegate").on(table.delegateAgentId),
    index("idx_delegations_status").on(table.status),
  ]
);


// ═══════════════════════════════════════════════
// 35. Token Launches (Four.meme)
// ═══════════════════════════════════════════════

export const tokenLaunchStatusEnum = pgEnum("token_launch_status", [
  "pending",
  "launched",
  "failed",
]);

export const tokenLaunches = pgTable(
  "token_launches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    description: text("description").notNull(),
    imageUrl: varchar("image_url", { length: 512 }),
    tokenAddress: varchar("token_address", { length: 42 }),
    fourMemeTokenId: varchar("four_meme_token_id", { length: 100 }),
    txHash: varchar("tx_hash", { length: 66 }),
    totalSupply: varchar("total_supply", { length: 50 })
      .default("1000000000")
      .notNull(),
    raisedAmount: varchar("raised_amount", { length: 50 })
      .default("24")
      .notNull(),
    initialBuyBnb: varchar("initial_buy_bnb", { length: 50 })
      .default("0")
      .notNull(),
    label: varchar("label", { length: 50 }).default("Meme"),
    webUrl: varchar("web_url", { length: 512 }),
    twitterUrl: varchar("twitter_url", { length: 512 }),
    telegramUrl: varchar("telegram_url", { length: 512 }),
    status: tokenLaunchStatusEnum("status").default("pending").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    launchedAt: timestamp("launched_at"),
  },
  (table) => [
    index("idx_token_launches_agent").on(table.agentId),
    index("idx_token_launches_status").on(table.status),
    index("idx_token_launches_token_address").on(table.tokenAddress),
  ]
);

// ═══════════════════════════════════════════════
// Type Exports
// ═══════════════════════════════════════════════

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Escrow = typeof escrows.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Gig = typeof gigs.$inferSelect;
export type NewGig = typeof gigs.$inferInsert;
export type GigOrder = typeof gigOrders.$inferSelect;
export type Bounty = typeof bounties.$inferSelect;
export type NewBounty = typeof bounties.$inferInsert;
export type BountyClaim = typeof bountyClaims.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type Dispute = typeof disputes.$inferSelect;
export type DisputePanelVote = typeof disputePanelVotes.$inferSelect;
export type CompetitionEntry = typeof competitionEntries.$inferSelect;
export type Reputation = typeof reputation.$inferSelect;
export type ReputationSkill = typeof reputationSkills.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
export type FileUpload = typeof fileUploads.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type SubmissionHistory = typeof submissionHistory.$inferSelect;
export type FavoriteAgent = typeof favoriteAgents.$inferSelect;
export type JobTemplate = typeof jobTemplates.$inferSelect;
export type NewJobTemplate = typeof jobTemplates.$inferInsert;
export type ApiUsageMetric = typeof apiUsageMetrics.$inferSelect;
export type EscrowMilestone = typeof escrowMilestones.$inferSelect;
export type AgentDelegation = typeof agentDelegations.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type TokenLaunch = typeof tokenLaunches.$inferSelect;
export type NewTokenLaunch = typeof tokenLaunches.$inferInsert;
