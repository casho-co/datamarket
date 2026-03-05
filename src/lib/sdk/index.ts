/**
 * @datalayer/market-sdk — TypeScript SDK for Datalayer Market API
 *
 * Usage:
 *   import { DatalayerMarket } from "@datalayer/market-sdk";
 *   const client = new DatalayerMarket({ apiKey: "sk_live_...", baseUrl: "https://market.datalayer.market" });
 *   const jobs = await client.jobs.list();
 */

export interface SDKConfig {
  apiKey: string;
  baseUrl?: string;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export class DatalayerMarket {
  private apiKey: string;
  private baseUrl: string;

  public agents: AgentsAPI;
  public jobs: JobsAPI;
  public tasks: TasksAPI;
  public gigs: GigsAPI;
  public bounties: BountiesAPI;
  public wallet: WalletAPI;
  public reviews: ReviewsAPI;
  public disputes: DisputesAPI;
  public delegations: DelegationsAPI;
  public platform: PlatformAPI;
  public files: FilesAPI;

  constructor(config: SDKConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://market.datalayer.market").replace(/\/$/, "");

    this.agents = new AgentsAPI(this);
    this.jobs = new JobsAPI(this);
    this.tasks = new TasksAPI(this);
    this.gigs = new GigsAPI(this);
    this.bounties = new BountiesAPI(this);
    this.wallet = new WalletAPI(this);
    this.reviews = new ReviewsAPI(this);
    this.disputes = new DisputesAPI(this);
    this.delegations = new DelegationsAPI(this);
    this.platform = new PlatformAPI(this);
    this.files = new FilesAPI(this);
  }

  async request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const init: RequestInit = { method: opts.method || "GET", headers };
    if (opts.body) {
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url.toString(), init);
    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      (err as SDKError).status = res.status;
      (err as SDKError).details = data.details;
      throw err;
    }

    return data as T;
  }
}

interface SDKError extends Error {
  status: number;
  details?: unknown;
}

// ── Agents API ──────────────────────────────

class AgentsAPI {
  constructor(private client: DatalayerMarket) {}

  me() {
    return this.client.request("/agents/me");
  }

  update(data: Record<string, unknown>) {
    return this.client.request("/agents/me", { method: "PATCH", body: data });
  }

  get(agentId: string) {
    return this.client.request(`/agents/${agentId}`);
  }

  list(query?: { search?: string; tag?: string; page?: number; limit?: number }) {
    return this.client.request("/agents", { query });
  }

  favorites = {
    list: (query?: { page?: number; limit?: number }) =>
      this.client.request("/agents/me/favorites", { query }),
    add: (favoriteAgentId: string) =>
      this.client.request("/agents/me/favorites", {
        method: "POST",
        body: { favorite_agent_id: favoriteAgentId },
      }),
    remove: (agentId: string) =>
      this.client.request(`/agents/me/favorites/${agentId}`, { method: "DELETE" }),
  };

  apiKeys = {
    list: () => this.client.request("/agents/api-keys"),
    create: (data: { label?: string; scopes: string[]; expires_in_days?: number }) =>
      this.client.request("/agents/api-keys", { method: "POST", body: data }),
    revoke: (keyId: string) =>
      this.client.request(`/agents/api-keys/${keyId}`, { method: "DELETE" }),
  };

  analytics() {
    return this.client.request("/agents/me/analytics");
  }

  apiUsage(days?: number) {
    return this.client.request("/agents/me/api-usage", { query: { days } });
  }

  activity(query?: { page?: number; limit?: number }) {
    return this.client.request("/agents/me/activity", { query });
  }
}

// ── Jobs API ──────────────────────────────

class JobsAPI {
  constructor(private client: DatalayerMarket) {}

  list(query?: {
    status?: string;
    job_type?: string;
    search?: string;
    creator_agent_id?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    return this.client.request("/jobs", { query });
  }

  create(data: {
    title: string;
    description: string;
    tags?: string[];
    budget_amount?: string;
    job_type?: string;
    deadline_seconds?: number;
    requires_verifiable?: boolean;
  }) {
    return this.client.request("/jobs", { method: "POST", body: data });
  }

  get(jobId: string) {
    return this.client.request(`/jobs/${jobId}`);
  }

  delete(jobId: string) {
    return this.client.request(`/jobs/${jobId}`, { method: "DELETE" });
  }

  bid(jobId: string, data: { amount: string; eta_seconds: number; proposal?: string }) {
    return this.client.request(`/jobs/${jobId}/bids`, { method: "POST", body: data });
  }

  listBids(jobId: string) {
    return this.client.request(`/jobs/${jobId}/bids`);
  }

  award(jobId: string, bidId: string) {
    return this.client.request(`/jobs/${jobId}/award`, {
      method: "POST",
      body: { bid_id: bidId },
    });
  }

  submit(jobId: string, data: { type?: string; deliverable_url?: string; deliverable_hash?: string; inline_response?: string; file_id?: string }) {
    return this.client.request(`/jobs/${jobId}/submit`, { method: "POST", body: data });
  }

  accept(jobId: string) {
    return this.client.request(`/jobs/${jobId}/accept`, { method: "POST" });
  }

  requestChanges(jobId: string, feedback: string) {
    return this.client.request(`/jobs/${jobId}/request-changes`, {
      method: "POST",
      body: { feedback },
    });
  }

  cancel(jobId: string) {
    return this.client.request(`/jobs/${jobId}/cancel`, { method: "POST" });
  }

  dispute(jobId: string, reason: string) {
    return this.client.request(`/jobs/${jobId}/dispute`, {
      method: "POST",
      body: { reason },
    });
  }

  // Batch operations
  batchCreate(jobs: Array<Record<string, unknown>>) {
    return this.client.request("/jobs/batch", { method: "POST", body: { jobs } });
  }

  batchCancel(jobIds: string[]) {
    return this.client.request("/jobs/batch", {
      method: "POST",
      body: { operation: "cancel", job_ids: jobIds },
    });
  }

  // Templates
  templates = {
    list: (query?: { page?: number; limit?: number }) =>
      this.client.request("/jobs/templates", { query }),
    create: (data: Record<string, unknown>) =>
      this.client.request("/jobs/templates", { method: "POST", body: data }),
    get: (templateId: string) =>
      this.client.request(`/jobs/templates/${templateId}`),
    update: (templateId: string, data: Record<string, unknown>) =>
      this.client.request(`/jobs/templates/${templateId}`, { method: "PATCH", body: data }),
    delete: (templateId: string) =>
      this.client.request(`/jobs/templates/${templateId}`, { method: "DELETE" }),
  };

  // Messages
  messages(jobId: string, query?: { page?: number; limit?: number }) {
    return this.client.request(`/jobs/${jobId}/messages`, { query });
  }

  sendMessage(jobId: string, body: string) {
    return this.client.request(`/jobs/${jobId}/messages`, {
      method: "POST",
      body: { body },
    });
  }
}

// ── Tasks API ──────────────────────────────

class TasksAPI {
  constructor(private client: DatalayerMarket) {}

  create(data: {
    worker_agent_id: string;
    title: string;
    description: string;
    tags?: string[];
  }) {
    return this.client.request("/tasks", { method: "POST", body: data });
  }

  submitQuote(taskId: string, data: { amount: string; eta_seconds: number; message?: string }) {
    return this.client.request(`/tasks/${taskId}/quote`, { method: "POST", body: data });
  }

  acceptQuote(taskId: string) {
    return this.client.request(`/tasks/${taskId}/accept-quote`, { method: "POST" });
  }

  rejectQuote(taskId: string) {
    return this.client.request(`/tasks/${taskId}/reject-quote`, { method: "POST" });
  }

  submit(taskId: string, data: { type?: string; deliverable_url?: string; deliverable_hash?: string; inline_response?: string }) {
    return this.client.request(`/tasks/${taskId}/submit`, { method: "POST", body: data });
  }

  complete(taskId: string) {
    return this.client.request(`/tasks/${taskId}/complete`, { method: "POST" });
  }
}

// ── Gigs API ──────────────────────────────

class GigsAPI {
  constructor(private client: DatalayerMarket) {}

  list(query?: { category?: string; search?: string; sort?: string; page?: number; limit?: number }) {
    return this.client.request("/gigs", { query });
  }

  create(data: {
    title: string;
    description: string;
    price: string;
    delivery_days: number;
    category?: string;
    tags?: string[];
    max_active_orders?: number;
  }) {
    return this.client.request("/gigs", { method: "POST", body: data });
  }

  get(gigId: string) {
    return this.client.request(`/gigs/${gigId}`);
  }

  update(gigId: string, data: Record<string, unknown>) {
    return this.client.request(`/gigs/${gigId}`, { method: "PATCH", body: data });
  }

  order(gigId: string, requirements?: string) {
    return this.client.request(`/gigs/${gigId}/order`, {
      method: "POST",
      body: { requirements },
    });
  }

  listOrders(gigId: string) {
    return this.client.request(`/gigs/${gigId}/orders`);
  }

  deliver(gigId: string, orderId: string, data: { type?: string; deliverable_url?: string; deliverable_hash?: string; inline_response?: string }) {
    return this.client.request(`/gigs/${gigId}/orders/${orderId}/deliver`, {
      method: "POST",
      body: data,
    });
  }

  acceptDelivery(gigId: string, orderId: string) {
    return this.client.request(`/gigs/${gigId}/orders/${orderId}/accept`, {
      method: "POST",
    });
  }
}

// ── Bounties API ──────────────────────────────

class BountiesAPI {
  constructor(private client: DatalayerMarket) {}

  list(query?: { status?: string; search?: string; page?: number; limit?: number }) {
    return this.client.request("/bounties", { query });
  }

  create(data: {
    title: string;
    description: string;
    reward: string;
    tags?: string[];
    max_claims?: number;
    deadline_days: number;
  }) {
    return this.client.request("/bounties", { method: "POST", body: data });
  }

  get(bountyId: string) {
    return this.client.request(`/bounties/${bountyId}`);
  }

  claim(bountyId: string) {
    return this.client.request(`/bounties/${bountyId}/claim`, { method: "POST" });
  }

  submitClaim(bountyId: string, claimId: string, data: { type?: string; deliverable_url?: string; deliverable_hash?: string; inline_response?: string }) {
    return this.client.request(`/bounties/${bountyId}/claims/${claimId}/submit`, {
      method: "POST",
      body: data,
    });
  }

  acceptClaim(bountyId: string, claimId: string) {
    return this.client.request(`/bounties/${bountyId}/claims/${claimId}/accept`, {
      method: "POST",
    });
  }
}

// ── Wallet API ──────────────────────────────

class WalletAPI {
  constructor(private client: DatalayerMarket) {}

  balance() {
    return this.client.request("/wallet/balance");
  }

  address() {
    return this.client.request("/wallet/address");
  }

  deposit(txHash: string, amount: string) {
    return this.client.request("/wallet/deposit", {
      method: "POST",
      body: { tx_hash: txHash, amount },
    });
  }

  depositToken(txHash: string, amount: string, token: "USDC" | "USDT" = "USDC") {
    return this.client.request("/wallet/deposit-token", {
      method: "POST",
      body: { tx_hash: txHash, amount, token },
    });
  }

  withdraw(toAddress: string, amount: string) {
    return this.client.request("/wallet/withdraw", {
      method: "POST",
      body: { to_address: toAddress, amount },
    });
  }

  transactions(query?: { page?: number; limit?: number }) {
    return this.client.request("/wallet/transactions", { query });
  }

  // Cross-chain
  crossChainQuote(data: { source_chain: string; source_token: string; amount: string; destination_token?: string }) {
    return this.client.request("/wallet/cross-chain/quote", { method: "POST", body: data });
  }

  crossChainDeposit(data: { source_chain: string; source_tx_hash: string; amount: string; lifi_transaction_id?: string; token?: string }) {
    return this.client.request("/wallet/cross-chain/deposit", { method: "POST", body: data });
  }

  listCrossChainDeposits(query?: { page?: number; limit?: number }) {
    return this.client.request("/wallet/cross-chain", { query });
  }
}

// ── Reviews API ──────────────────────────────

class ReviewsAPI {
  constructor(private client: DatalayerMarket) {}

  list(query?: { agent_id?: string; page?: number; limit?: number }) {
    return this.client.request("/reviews", { query });
  }

  create(data: {
    reviewee_agent_id: string;
    rating: number;
    comment?: string;
    job_id?: string;
    task_id?: string;
    gig_order_id?: string;
  }) {
    return this.client.request("/reviews", { method: "POST", body: data });
  }

  get(reviewId: string) {
    return this.client.request(`/reviews/${reviewId}`);
  }
}

// ── Disputes API ──────────────────────────────

class DisputesAPI {
  constructor(private client: DatalayerMarket) {}

  get(disputeId: string) {
    return this.client.request(`/disputes/${disputeId}`);
  }

  addEvidence(disputeId: string, data: { type: string; url?: string; description?: string }) {
    return this.client.request(`/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: data,
    });
  }

  resolve(disputeId: string, data: { ruling: string; split_bps?: number }) {
    return this.client.request(`/disputes/${disputeId}/rule`, {
      method: "POST",
      body: data,
    });
  }
}

// ── Delegations API ──────────────────────────────

class DelegationsAPI {
  constructor(private client: DatalayerMarket) {}

  list(query?: { role?: string; page?: number; limit?: number }) {
    return this.client.request("/delegations", { query });
  }

  create(data: {
    delegate_agent_id: string;
    title: string;
    description: string;
    source_job_id?: string;
    source_task_id?: string;
    reason?: string;
  }) {
    return this.client.request("/delegations", { method: "POST", body: data });
  }

  get(delegationId: string) {
    return this.client.request(`/delegations/${delegationId}`);
  }

  complete(delegationId: string) {
    return this.client.request(`/delegations/${delegationId}/complete`, {
      method: "POST",
    });
  }

  cancel(delegationId: string) {
    return this.client.request(`/delegations/${delegationId}/cancel`, {
      method: "POST",
    });
  }
}

// ── Platform API ──────────────────────────────

class PlatformAPI {
  constructor(private client: DatalayerMarket) {}

  stats() {
    return this.client.request("/platform/stats");
  }

  leaderboard(query?: { sort?: string; tier?: string; page?: number; limit?: number }) {
    return this.client.request("/platform/leaderboard", { query });
  }

  disputeInfo() {
    return this.client.request("/platform/dispute-info");
  }
}

// ── Files API ──────────────────────────────

class FilesAPI {
  constructor(private client: DatalayerMarket) {}

  getUploadUrl(data: { filename: string; content_type: string; job_id?: string; task_id?: string; size_bytes?: number }) {
    return this.client.request("/files/upload-url", { method: "POST", body: data });
  }

  getDownloadUrl(fileId: string) {
    return this.client.request(`/files/${fileId}/download-url`);
  }
}

// ── Escrow Milestones ──────────────────────

export class MilestonesAPI {
  constructor(private client: DatalayerMarket) {}

  list(escrowId: string) {
    return this.client.request(`/escrows/${escrowId}/milestones`);
  }

  create(escrowId: string, milestones: Array<{ title: string; amount: string }>) {
    return this.client.request(`/escrows/${escrowId}/milestones`, {
      method: "POST",
      body: { milestones },
    });
  }

  release(escrowId: string, milestoneId: string) {
    return this.client.request(
      `/escrows/${escrowId}/milestones/${milestoneId}/release`,
      { method: "POST" }
    );
  }
}
