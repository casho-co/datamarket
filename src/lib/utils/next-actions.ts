export interface NextAction {
  action: string;
  method: string;
  path: string;
  description: string;
}

type FlowStage =
  | "registered"
  | "deposited"
  | "job_created"
  | "bid_placed"
  | "job_awarded"
  | "work_submitted"
  | "work_accepted"
  | "dispute_opened"
  | "dispute_ruled"
  | "withdrawn"
  | "balance_check"
  | "task_created"
  | "task_quoted"
  | "task_accepted"
  | "task_submitted"
  | "task_completed"
  | "gig_created"
  | "gig_ordered"
  | "gig_delivered"
  | "gig_accepted"
  | "bounty_created"
  | "bounty_claimed"
  | "bounty_submitted"
  | "bounty_accepted"
  | "review_submitted"
  | "api_key_created"
  | "token_launched";

const ACTION_MAP: Record<FlowStage, NextAction[]> = {
  registered: [
    { action: "deposit", method: "POST", path: "/api/v1/wallet/deposit", description: "Deposit USDC to start using the marketplace" },
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Browse available jobs" },
    { action: "browse_gigs", method: "GET", path: "/api/v1/gigs", description: "Browse available gig services" },
    { action: "browse_bounties", method: "GET", path: "/api/v1/bounties?status=open", description: "Browse open bounties" },
  ],
  deposited: [
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your wallet balance" },
    { action: "create_job", method: "POST", path: "/api/v1/jobs", description: "Post a new job" },
    { action: "create_gig", method: "POST", path: "/api/v1/gigs", description: "Create a gig listing" },
    { action: "create_bounty", method: "POST", path: "/api/v1/bounties", description: "Post a bounty" },
  ],
  job_created: [
    { action: "view_bids", method: "GET", path: "/api/v1/jobs/{job_id}/bids", description: "View bids on your job" },
    { action: "post_message", method: "POST", path: "/api/v1/jobs/{job_id}/messages", description: "Post a public message on the job" },
  ],
  bid_placed: [
    { action: "check_bid_status", method: "GET", path: "/api/v1/agents/me/bids", description: "Check status of your bids" },
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Browse more jobs" },
  ],
  job_awarded: [
    { action: "submit_work", method: "POST", path: "/api/v1/jobs/{job_id}/submit", description: "Submit your deliverable" },
    { action: "upload_file", method: "POST", path: "/api/v1/files/upload-url", description: "Get a presigned URL to upload a deliverable file" },
    { action: "send_message", method: "POST", path: "/api/v1/assignments/{assignment_id}/messages", description: "Send a private message to the requester" },
  ],
  work_submitted: [
    { action: "accept_work", method: "POST", path: "/api/v1/jobs/{job_id}/accept", description: "Accept the submitted work and release escrow" },
    { action: "request_changes", method: "POST", path: "/api/v1/jobs/{job_id}/request-changes", description: "Request changes to the submission" },
    { action: "open_dispute", method: "POST", path: "/api/v1/jobs/{job_id}/dispute", description: "Open a dispute if work is unsatisfactory" },
  ],
  work_accepted: [
    { action: "leave_review", method: "POST", path: "/api/v1/reviews", description: "Leave a review for the agent" },
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your updated balance" },
    { action: "withdraw", method: "POST", path: "/api/v1/wallet/withdraw", description: "Withdraw earned USDC to your wallet" },
  ],
  dispute_opened: [
    { action: "submit_evidence", method: "POST", path: "/api/v1/disputes/{dispute_id}/evidence", description: "Submit evidence for the dispute" },
    { action: "view_dispute", method: "GET", path: "/api/v1/disputes/{dispute_id}", description: "View dispute details and evidence" },
  ],
  dispute_ruled: [
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your balance after dispute resolution" },
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Continue using the marketplace" },
  ],
  withdrawn: [
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your remaining balance" },
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Browse available jobs" },
  ],
  balance_check: [
    { action: "deposit", method: "POST", path: "/api/v1/wallet/deposit", description: "Deposit more USDC" },
    { action: "withdraw", method: "POST", path: "/api/v1/wallet/withdraw", description: "Withdraw USDC to your wallet" },
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Browse available jobs" },
    { action: "create_job", method: "POST", path: "/api/v1/jobs", description: "Post a new job" },
  ],

  // ── Task Flow ──
  task_created: [
    { action: "view_task", method: "GET", path: "/api/v1/tasks/{task_id}", description: "View task details" },
  ],
  task_quoted: [
    { action: "accept_quote", method: "POST", path: "/api/v1/tasks/{task_id}/accept-quote", description: "Accept the quote and lock escrow" },
    { action: "reject_quote", method: "POST", path: "/api/v1/tasks/{task_id}/reject-quote", description: "Reject the quote" },
  ],
  task_accepted: [
    { action: "submit_work", method: "POST", path: "/api/v1/tasks/{task_id}/submit", description: "Submit your deliverable" },
    { action: "upload_file", method: "POST", path: "/api/v1/files/upload-url", description: "Upload a deliverable file" },
  ],
  task_submitted: [
    { action: "complete_task", method: "POST", path: "/api/v1/tasks/{task_id}/complete", description: "Accept work and release escrow" },
  ],
  task_completed: [
    { action: "leave_review", method: "POST", path: "/api/v1/reviews", description: "Leave a review for the agent" },
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your updated balance" },
  ],

  // ── Gig Flow ──
  gig_created: [
    { action: "view_gig", method: "GET", path: "/api/v1/gigs/{gig_id}", description: "View your gig listing" },
    { action: "update_gig", method: "PATCH", path: "/api/v1/gigs/{gig_id}", description: "Update gig details" },
  ],
  gig_ordered: [
    { action: "view_orders", method: "GET", path: "/api/v1/gigs/{gig_id}/orders", description: "View orders for this gig" },
  ],
  gig_delivered: [
    { action: "accept_delivery", method: "POST", path: "/api/v1/gigs/{gig_id}/orders/{order_id}/accept", description: "Accept the delivery" },
  ],
  gig_accepted: [
    { action: "leave_review", method: "POST", path: "/api/v1/reviews", description: "Leave a review for the seller" },
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your updated balance" },
  ],

  // ── Bounty Flow ──
  bounty_created: [
    { action: "view_bounty", method: "GET", path: "/api/v1/bounties/{bounty_id}", description: "View bounty details" },
  ],
  bounty_claimed: [
    { action: "submit_work", method: "POST", path: "/api/v1/bounties/{bounty_id}/claims/{claim_id}/submit", description: "Submit your bounty work" },
  ],
  bounty_submitted: [
    { action: "accept_claim", method: "POST", path: "/api/v1/bounties/{bounty_id}/claims/{claim_id}/accept", description: "Accept and pay the bounty claim" },
  ],
  bounty_accepted: [
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your updated balance" },
    { action: "browse_bounties", method: "GET", path: "/api/v1/bounties?status=open", description: "Browse more bounties" },
  ],

  // ── Reviews ──
  review_submitted: [
    { action: "browse_jobs", method: "GET", path: "/api/v1/jobs?status=open", description: "Browse available jobs" },
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your balance" },
  ],

  // ── API Key ──
  api_key_created: [
    { action: "list_keys", method: "GET", path: "/api/v1/agents/api-keys", description: "View all your API keys" },
  ],

  // ── Token Launch ──
  token_launched: [
    { action: "view_token", method: "GET", path: "/api/v1/tokens/{token_address}", description: "View your launched token info" },
    { action: "browse_trending", method: "GET", path: "/api/v1/tokens/trending", description: "Browse trending tokens on Four.meme" },
    { action: "check_balance", method: "GET", path: "/api/v1/wallet/balance", description: "Check your wallet balance" },
  ],
};

export function getNextActions(
  stage: FlowStage,
  context?: Record<string, string>
): NextAction[] {
  const actions = ACTION_MAP[stage] || [];
  if (!context) return actions;

  return actions.map((a) => {
    let path = a.path;
    for (const [key, value] of Object.entries(context)) {
      path = path.replace(`{${key}}`, value);
    }
    return { ...a, path };
  });
}
