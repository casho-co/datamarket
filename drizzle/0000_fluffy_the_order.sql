CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('in_progress', 'submitted', 'accepted', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('online', 'offline', 'busy');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('pending', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."bounty_claim_status" AS ENUM('active', 'submitted', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."bounty_status" AS ENUM('open', 'claimed', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deliverable_type" AS ENUM('url', 'file', 'inline');--> statement-breakpoint
CREATE TYPE "public"."dispute_ruling" AS ENUM('pending', 'requester_wins', 'worker_wins', 'split', 'redo');--> statement-breakpoint
CREATE TYPE "public"."escrow_ref_type" AS ENUM('job', 'task', 'gig_order', 'bounty_claim');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('funded', 'released', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('url', 'photo', 'tracking', 'hash');--> statement-breakpoint
CREATE TYPE "public"."gig_order_status" AS ENUM('pending', 'in_progress', 'delivered', 'completed', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."gig_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('open', 'in_progress', 'completed', 'closed', 'expired', 'judging');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('standard', 'competition');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('requested', 'quoted', 'accepted', 'in_progress', 'submitted', 'completed', 'disputed', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."token_launch_status" AS ENUM('pending', 'launched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "agent_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegator_agent_id" uuid NOT NULL,
	"delegate_agent_id" uuid NOT NULL,
	"source_job_id" uuid,
	"source_task_id" uuid,
	"delegated_task_id" uuid,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" varchar(20),
	"wallet_address" varchar(42) NOT NULL,
	"email" varchar(255),
	"erc8004_agent_id" bigint,
	"capabilities" jsonb,
	"tags" jsonb,
	"skill_tags" jsonb,
	"description" text,
	"actor_type" "actor_type" DEFAULT 'agent' NOT NULL,
	"availability_status" "availability_status" DEFAULT 'online' NOT NULL,
	"webhook_url" varchar(512),
	"webhook_events" jsonb,
	"mcp_endpoint" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_handle_unique" UNIQUE("handle"),
	CONSTRAINT "agents_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "agents_erc8004_agent_id_unique" UNIQUE("erc8004_agent_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"label" varchar(100),
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"api_key_id" uuid,
	"endpoint" varchar(200) NOT NULL,
	"method" varchar(10) NOT NULL,
	"status_code" integer NOT NULL,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"worker_agent_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"escrow_amount" varchar(50) NOT NULL,
	"status" "assignment_status" DEFAULT 'in_progress' NOT NULL,
	"deliverable_type" "deliverable_type",
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"deliverable_file_id" uuid,
	"inline_response" text,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"on_chain_synced" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp,
	"auto_release_at" timestamp,
	"deadline_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(30) NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"bidder_agent_id" uuid NOT NULL,
	"amount" varchar(50) NOT NULL,
	"eta_seconds" integer NOT NULL,
	"proposal" text,
	"status" "bid_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_bid_per_agent_job" UNIQUE("job_id","bidder_agent_id")
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_agent_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"reward" varchar(50) NOT NULL,
	"tags" jsonb,
	"max_claims" integer DEFAULT 1 NOT NULL,
	"active_claims" integer DEFAULT 0 NOT NULL,
	"status" "bounty_status" DEFAULT 'open' NOT NULL,
	"deadline" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"claimer_agent_id" uuid NOT NULL,
	"escrow_id" uuid,
	"status" "bounty_claim_status" DEFAULT 'active' NOT NULL,
	"deliverable_type" "deliverable_type",
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"deliverable_file_id" uuid,
	"inline_response" text,
	"submitted_at" timestamp,
	"auto_release_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_claim_per_agent_bounty" UNIQUE("bounty_id","claimer_agent_id")
);
--> statement-breakpoint
CREATE TABLE "competition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"deliverable_url" varchar(512) NOT NULL,
	"deliverable_hash" varchar(255),
	"prize_bps" integer,
	"escrow_id" uuid,
	"release_tx_hash" varchar(66),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_entry_per_agent" UNIQUE("job_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant1_id" uuid NOT NULL,
	"participant2_id" uuid NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conversation_participants" UNIQUE("participant1_id","participant2_id")
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"submitter_agent_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"url" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_panel_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"voter_agent_id" uuid NOT NULL,
	"ruling" "dispute_ruling" NOT NULL,
	"split_bps" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_panel_vote" UNIQUE("dispute_id","voter_agent_id")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid,
	"task_id" uuid,
	"gig_order_id" uuid,
	"opener_agent_id" uuid NOT NULL,
	"resolver_agent_id" uuid,
	"panel_resolvers" jsonb,
	"reason" text NOT NULL,
	"ruling" "dispute_ruling" DEFAULT 'pending' NOT NULL,
	"split_bps" integer,
	"deposit_amount" varchar(50) DEFAULT '0' NOT NULL,
	"resolution_deadline" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "escrow_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"amount" varchar(50) NOT NULL,
	"order_index" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_id" uuid NOT NULL,
	"ref_type" "escrow_ref_type" NOT NULL,
	"assignment_id" uuid,
	"funder_agent_id" uuid NOT NULL,
	"recipient_agent_id" uuid,
	"amount" varchar(50) NOT NULL,
	"status" "escrow_status" DEFAULT 'funded' NOT NULL,
	"on_chain_tx_hash" varchar(66),
	"release_tx_hash" varchar(66),
	"buyback_tx_hash" varchar(66),
	"buyback_burn_tx_hash" varchar(66),
	"buyback_amount" varchar(50),
	"buyback_tokens_burned" varchar(50),
	"buyback_token_address" varchar(42),
	"funded_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"released_at" timestamp,
	"refunded_at" timestamp,
	CONSTRAINT "escrows_assignment_id_unique" UNIQUE("assignment_id"),
	CONSTRAINT "uq_escrows_on_chain_tx" UNIQUE("on_chain_tx_hash")
);
--> statement-breakpoint
CREATE TABLE "favorite_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"favorite_agent_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_favorite_pair" UNIQUE("agent_id","favorite_agent_id")
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"job_id" uuid,
	"task_id" uuid,
	"gig_id" uuid,
	"bounty_id" uuid,
	"agent_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_id" uuid,
	"assignment_id" uuid,
	"task_id" uuid,
	"file_key" varchar(512) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer,
	"sha256_hash" varchar(64),
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gig_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" uuid NOT NULL,
	"buyer_agent_id" uuid NOT NULL,
	"seller_agent_id" uuid NOT NULL,
	"escrow_id" uuid,
	"status" "gig_order_status" DEFAULT 'pending' NOT NULL,
	"requirements" text,
	"deliverable_type" "deliverable_type",
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"deliverable_file_id" uuid,
	"inline_response" text,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"auto_release_at" timestamp,
	"deliver_by" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_agent_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"price" varchar(50) NOT NULL,
	"delivery_days" integer NOT NULL,
	"category" varchar(50),
	"tags" jsonb,
	"max_active_orders" integer DEFAULT 5 NOT NULL,
	"status" "gig_status" DEFAULT 'active' NOT NULL,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb,
	"budget_amount" varchar(50),
	"job_type" "job_type" DEFAULT 'standard' NOT NULL,
	"deadline_seconds" integer DEFAULT 86400 NOT NULL,
	"requires_verifiable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_agent_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb,
	"budget_amount" varchar(50),
	"budget_token" varchar(10) DEFAULT 'USDC' NOT NULL,
	"job_type" "job_type" DEFAULT 'standard' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" "job_status" DEFAULT 'open' NOT NULL,
	"deadline_seconds" integer DEFAULT 86400 NOT NULL,
	"dispute_agent_id" uuid,
	"requires_verifiable" boolean DEFAULT false NOT NULL,
	"max_revisions" integer DEFAULT 3 NOT NULL,
	"auto_release_days" integer DEFAULT 7 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"emoji" varchar(20) NOT NULL,
	CONSTRAINT "uq_reaction" UNIQUE("message_id","agent_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"assignment_id" uuid,
	"task_id" uuid,
	"conversation_id" uuid,
	"sender_agent_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"rolling_score" integer DEFAULT 0 NOT NULL,
	"stars" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"disputes_lost" integer DEFAULT 0 NOT NULL,
	"abandoned_jobs" integer DEFAULT 0 NOT NULL,
	"total_earned" varchar(50) DEFAULT '0' NOT NULL,
	"jobs_posted" integer DEFAULT 0 NOT NULL,
	"bids_placed" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"total_reviews" integer DEFAULT 0 NOT NULL,
	"decay_factor" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"skill_scores" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill" varchar(50) NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_skill" UNIQUE("agent_id","skill")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_agent_id" uuid NOT NULL,
	"reviewee_agent_id" uuid NOT NULL,
	"job_id" uuid,
	"task_id" uuid,
	"gig_order_id" uuid,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid,
	"task_id" uuid,
	"gig_order_id" uuid,
	"bounty_claim_id" uuid,
	"submitter_agent_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"deliverable_type" "deliverable_type" NOT NULL,
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"deliverable_file_id" uuid,
	"inline_response" text,
	"feedback" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_agent_id" uuid NOT NULL,
	"worker_agent_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb,
	"status" "task_status" DEFAULT 'requested' NOT NULL,
	"quoted_amount" varchar(50),
	"quoted_eta_seconds" integer,
	"quoted_message" text,
	"escrow_id" uuid,
	"deliverable_type" "deliverable_type",
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"deliverable_file_id" uuid,
	"inline_response" text,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"max_revisions" integer DEFAULT 3 NOT NULL,
	"submitted_at" timestamp,
	"auto_release_at" timestamp,
	"deadline_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"image_url" varchar(512),
	"token_address" varchar(42),
	"four_meme_token_id" varchar(100),
	"tx_hash" varchar(66),
	"total_supply" varchar(50) DEFAULT '1000000000' NOT NULL,
	"raised_amount" varchar(50) DEFAULT '24' NOT NULL,
	"initial_buy_bnb" varchar(50) DEFAULT '0' NOT NULL,
	"label" varchar(50) DEFAULT 'Meme',
	"web_url" varchar(512),
	"twitter_url" varchar(512),
	"telegram_url" varchar(512),
	"status" "token_launch_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"launched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"webhook_url" varchar(512) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_retry_at" timestamp,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_delegator_agent_id_agents_id_fk" FOREIGN KEY ("delegator_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_delegate_agent_id_agents_id_fk" FOREIGN KEY ("delegate_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_source_job_id_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_delegated_task_id_tasks_id_fk" FOREIGN KEY ("delegated_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_metrics" ADD CONSTRAINT "api_usage_metrics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_metrics" ADD CONSTRAINT "api_usage_metrics_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_worker_agent_id_agents_id_fk" FOREIGN KEY ("worker_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_agent_id_agents_id_fk" FOREIGN KEY ("bidder_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_claimer_agent_id_agents_id_fk" FOREIGN KEY ("claimer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant1_id_agents_id_fk" FOREIGN KEY ("participant1_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant2_id_agents_id_fk" FOREIGN KEY ("participant2_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitter_agent_id_agents_id_fk" FOREIGN KEY ("submitter_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_panel_votes" ADD CONSTRAINT "dispute_panel_votes_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_panel_votes" ADD CONSTRAINT "dispute_panel_votes_voter_agent_id_agents_id_fk" FOREIGN KEY ("voter_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_gig_order_id_gig_orders_id_fk" FOREIGN KEY ("gig_order_id") REFERENCES "public"."gig_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opener_agent_id_agents_id_fk" FOREIGN KEY ("opener_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolver_agent_id_agents_id_fk" FOREIGN KEY ("resolver_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_milestones" ADD CONSTRAINT "escrow_milestones_escrow_id_escrows_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_funder_agent_id_agents_id_fk" FOREIGN KEY ("funder_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_recipient_agent_id_agents_id_fk" FOREIGN KEY ("recipient_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_agents" ADD CONSTRAINT "favorite_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_agents" ADD CONSTRAINT "favorite_agents_favorite_agent_id_agents_id_fk" FOREIGN KEY ("favorite_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_gig_id_gigs_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_orders" ADD CONSTRAINT "gig_orders_gig_id_gigs_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_orders" ADD CONSTRAINT "gig_orders_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_orders" ADD CONSTRAINT "gig_orders_seller_agent_id_agents_id_fk" FOREIGN KEY ("seller_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_seller_agent_id_agents_id_fk" FOREIGN KEY ("seller_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_templates" ADD CONSTRAINT "job_templates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_dispute_agent_id_agents_id_fk" FOREIGN KEY ("dispute_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation" ADD CONSTRAINT "reputation_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_skills" ADD CONSTRAINT "reputation_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_agent_id_agents_id_fk" FOREIGN KEY ("reviewee_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_gig_order_id_gig_orders_id_fk" FOREIGN KEY ("gig_order_id") REFERENCES "public"."gig_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_history" ADD CONSTRAINT "submission_history_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_history" ADD CONSTRAINT "submission_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_history" ADD CONSTRAINT "submission_history_gig_order_id_gig_orders_id_fk" FOREIGN KEY ("gig_order_id") REFERENCES "public"."gig_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_history" ADD CONSTRAINT "submission_history_bounty_claim_id_bounty_claims_id_fk" FOREIGN KEY ("bounty_claim_id") REFERENCES "public"."bounty_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_history" ADD CONSTRAINT "submission_history_submitter_agent_id_agents_id_fk" FOREIGN KEY ("submitter_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_worker_agent_id_agents_id_fk" FOREIGN KEY ("worker_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_launches" ADD CONSTRAINT "token_launches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delegations_delegator" ON "agent_delegations" USING btree ("delegator_agent_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_delegate" ON "agent_delegations" USING btree ("delegate_agent_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_status" ON "agent_delegations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agents_handle" ON "agents" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "idx_agents_wallet" ON "agents" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_api_keys_agent" ON "api_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_prefix" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_api_keys_active" ON "api_keys" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_api_usage_agent" ON "api_usage_metrics" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_key" ON "api_usage_metrics" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "idx_api_usage_created" ON "api_usage_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_api_usage_endpoint" ON "api_usage_metrics" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "idx_assignments_job" ON "assignments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_worker" ON "assignments" USING btree ("worker_agent_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_status" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_assignments_auto_release" ON "assignments" USING btree ("auto_release_at");--> statement-breakpoint
CREATE INDEX "idx_assignments_on_chain_synced" ON "assignments" USING btree ("on_chain_synced");--> statement-breakpoint
CREATE INDEX "idx_audit_agent" ON "audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bids_job" ON "bids" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_bids_bidder" ON "bids" USING btree ("bidder_agent_id");--> statement-breakpoint
CREATE INDEX "idx_bids_status" ON "bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_bounties_creator" ON "bounties" USING btree ("creator_agent_id");--> statement-breakpoint
CREATE INDEX "idx_bounties_status" ON "bounties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_bounties_deadline" ON "bounties" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "idx_bounty_claims_bounty" ON "bounty_claims" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "idx_bounty_claims_claimer" ON "bounty_claims" USING btree ("claimer_agent_id");--> statement-breakpoint
CREATE INDEX "idx_entries_job" ON "competition_entries" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_p1" ON "conversations" USING btree ("participant1_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_p2" ON "conversations" USING btree ("participant2_id");--> statement-breakpoint
CREATE INDEX "idx_evidence_dispute" ON "dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "idx_panel_votes_dispute" ON "dispute_panel_votes" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_assignment" ON "disputes" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_task" ON "disputes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_gig_order" ON "disputes" USING btree ("gig_order_id");--> statement-breakpoint
CREATE INDEX "idx_milestones_escrow" ON "escrow_milestones" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "idx_escrows_ref" ON "escrows" USING btree ("ref_id","ref_type");--> statement-breakpoint
CREATE INDEX "idx_escrows_assignment" ON "escrows" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_escrows_status" ON "escrows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_escrows_expires" ON "escrows" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_favorites_agent" ON "favorite_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_favorites_favorite" ON "favorite_agents" USING btree ("favorite_agent_id");--> statement-breakpoint
CREATE INDEX "idx_feed_created" ON "feed_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_feed_type" ON "feed_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_files_agent" ON "file_uploads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_files_job" ON "file_uploads" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_gig_orders_gig" ON "gig_orders" USING btree ("gig_id");--> statement-breakpoint
CREATE INDEX "idx_gig_orders_buyer" ON "gig_orders" USING btree ("buyer_agent_id");--> statement-breakpoint
CREATE INDEX "idx_gig_orders_seller" ON "gig_orders" USING btree ("seller_agent_id");--> statement-breakpoint
CREATE INDEX "idx_gig_orders_status" ON "gig_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_gig_orders_auto_release" ON "gig_orders" USING btree ("auto_release_at");--> statement-breakpoint
CREATE INDEX "idx_gigs_seller" ON "gigs" USING btree ("seller_agent_id");--> statement-breakpoint
CREATE INDEX "idx_gigs_status" ON "gigs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_gigs_category" ON "gigs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_job_templates_agent" ON "job_templates" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_creator" ON "jobs" USING btree ("creator_agent_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_expires" ON "jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_type" ON "jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "idx_reactions_message" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_job" ON "messages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_messages_assignment" ON "messages" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_messages_task" ON "messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_rep_skills_agent" ON "reputation_skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewee" ON "reviews" USING btree ("reviewee_agent_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewer" ON "reviews" USING btree ("reviewer_agent_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_job" ON "reviews" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_submission_history_assignment" ON "submission_history" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_submission_history_task" ON "submission_history" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_submission_history_gig_order" ON "submission_history" USING btree ("gig_order_id");--> statement-breakpoint
CREATE INDEX "idx_submission_history_bounty_claim" ON "submission_history" USING btree ("bounty_claim_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_creator" ON "tasks" USING btree ("creator_agent_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_worker" ON "tasks" USING btree ("worker_agent_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_auto_release" ON "tasks" USING btree ("auto_release_at");--> statement-breakpoint
CREATE INDEX "idx_token_launches_agent" ON "token_launches" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_token_launches_status" ON "token_launches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_token_launches_token_address" ON "token_launches" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "idx_webhook_agent" ON "webhook_deliveries" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_status" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_retry" ON "webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_event_type" ON "webhook_deliveries" USING btree ("event_type");