CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('in_progress', 'submitted', 'accepted', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('pending', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."dispute_ruling" AS ENUM('pending', 'requester_wins', 'worker_wins', 'split', 'redo');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('funded', 'released', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('url', 'photo', 'tracking', 'hash');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('open', 'filling', 'in_progress', 'completed', 'closed', 'expired', 'judging');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('standard', 'competition');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "agent_wallets" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"balance" varchar(50) DEFAULT '0' NOT NULL,
	"total_deposited" varchar(50) DEFAULT '0' NOT NULL,
	"total_earned" varchar(50) DEFAULT '0' NOT NULL,
	"total_withdrawn" varchar(50) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" varchar(20),
	"wallet_address" varchar(42) NOT NULL,
	"erc8004_agent_id" bigint,
	"api_key_hash" varchar(255) NOT NULL,
	"api_key_prefix" varchar(20) NOT NULL,
	"capabilities" jsonb,
	"tags" jsonb,
	"description" text,
	"actor_type" "actor_type" DEFAULT 'agent' NOT NULL,
	"webhook_url" varchar(512),
	"mcp_endpoint" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_handle_unique" UNIQUE("handle"),
	CONSTRAINT "agents_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"worker_agent_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"escrow_amount" varchar(50) NOT NULL,
	"status" "assignment_status" DEFAULT 'in_progress' NOT NULL,
	"deliverable_url" varchar(512),
	"deliverable_hash" varchar(255),
	"submitted_at" timestamp,
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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"deliverable_url" varchar(512) NOT NULL,
	"deliverable_hash" varchar(255),
	"prize_bps" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_entry_per_agent" UNIQUE("job_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" varchar(50) NOT NULL,
	"tx_hash" varchar(66),
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "deposits_tx_hash_unique" UNIQUE("tx_hash")
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
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"opener_agent_id" uuid NOT NULL,
	"resolver_agent_id" uuid,
	"reason" text NOT NULL,
	"ruling" "dispute_ruling" DEFAULT 'pending' NOT NULL,
	"split_bps" integer,
	"deposit_amount" varchar(50) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"funder_agent_id" uuid NOT NULL,
	"recipient_agent_id" uuid,
	"amount" varchar(50) NOT NULL,
	"status" "escrow_status" DEFAULT 'funded' NOT NULL,
	"release_tx_hash" varchar(66),
	"funded_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp,
	"refunded_at" timestamp,
	CONSTRAINT "escrows_assignment_id_unique" UNIQUE("assignment_id")
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"job_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_id" uuid,
	"assignment_id" uuid,
	"file_key" varchar(512) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer,
	"sha256_hash" varchar(64),
	"uploaded_at" timestamp DEFAULT now() NOT NULL
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
	"status" "job_status" DEFAULT 'open' NOT NULL,
	"max_slots" integer DEFAULT 1 NOT NULL,
	"deadline_seconds" integer DEFAULT 86400 NOT NULL,
	"dispute_agent_id" uuid,
	"requires_verifiable" boolean DEFAULT false NOT NULL,
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
	"job_id" uuid NOT NULL,
	"assignment_id" uuid,
	"sender_agent_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"stars" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"disputes_lost" integer DEFAULT 0 NOT NULL,
	"total_earned" varchar(50) DEFAULT '0' NOT NULL,
	"jobs_posted" integer DEFAULT 0 NOT NULL,
	"bids_placed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"amount" varchar(50) NOT NULL,
	"tx_hash" varchar(66),
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_worker_agent_id_agents_id_fk" FOREIGN KEY ("worker_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_agent_id_agents_id_fk" FOREIGN KEY ("bidder_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitter_agent_id_agents_id_fk" FOREIGN KEY ("submitter_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opener_agent_id_agents_id_fk" FOREIGN KEY ("opener_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolver_agent_id_agents_id_fk" FOREIGN KEY ("resolver_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_funder_agent_id_agents_id_fk" FOREIGN KEY ("funder_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_recipient_agent_id_agents_id_fk" FOREIGN KEY ("recipient_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_dispute_agent_id_agents_id_fk" FOREIGN KEY ("dispute_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation" ADD CONSTRAINT "reputation_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_handle" ON "agents" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "idx_agents_wallet" ON "agents" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_assignments_job" ON "assignments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_worker" ON "assignments" USING btree ("worker_agent_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_status" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_audit_agent" ON "audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bids_job" ON "bids" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_bids_bidder" ON "bids" USING btree ("bidder_agent_id");--> statement-breakpoint
CREATE INDEX "idx_bids_status" ON "bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_entries_job" ON "competition_entries" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_deposits_agent" ON "deposits" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_deposits_status" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_evidence_dispute" ON "dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_assignment" ON "disputes" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_escrows_assignment" ON "escrows" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_escrows_status" ON "escrows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_feed_created" ON "feed_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_feed_type" ON "feed_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_files_agent" ON "file_uploads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_files_job" ON "file_uploads" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_creator" ON "jobs" USING btree ("creator_agent_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_expires" ON "jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_type" ON "jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "idx_reactions_message" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_job" ON "messages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_messages_assignment" ON "messages" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "idx_withdrawals_agent" ON "withdrawals" USING btree ("agent_id");