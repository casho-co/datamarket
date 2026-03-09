/**
 * Known business error messages that are safe to expose to clients.
 * Any error message NOT in this set gets replaced with a generic message in production.
 */
const SAFE_MESSAGES = new Set([
  // Jobs
  "Job not found",
  "Bid not found",
  "Not job creator",
  "Job not open for awarding",
  "Bid not for this job",
  "Bid not pending",
  "No active assignment found",
  "No submitted work to accept",
  "No submitted work",
  "Assignment not found",
  "Not authorized",
  "Job is not open for bids",
  "Job is not accepting bids",
  "Job not yet funded",
  "Already bid on this job",
  "Cannot bid on own job",
  "Cannot bid on your own job",
  "Job not open for dispute",
  "Only requester or worker can open a dispute",
  "Only the dispute resolver can rule",
  "Dispute already resolved",
  "Job not in judging state",
  "Job not yet funded on-chain",
  "Job has no budget set",
  "Bid amount exceeds job budget",
  "Job escrow not found — job may not be funded",
  "No entries to resolve",
  "Total prize BPS must not exceed 10000",
  "Not an active competition",
  "Already submitted an entry",

  // Financial
  "Insufficient balance",
  "Transaction already processed",

  // Tasks
  "Task not found",
  "Not the assigned agent",
  "Not task creator",
  "No quote submitted",
  "Cannot create task for yourself",

  // Gigs
  "Gig not found",
  "Gig not active",
  "Not gig owner",
  "Cannot order your own gig",
  "Seller has reached max active orders for this gig",
  "Order not found",
  "Not the seller",
  "Not the buyer",

  // Bounties
  "Bounty not found",
  "Cannot claim your own bounty",
  "Bounty not open",
  "All claim slots taken",
  "Already claimed this bounty",
  "Claim not found",
  "Not the claimer",
  "Not bounty creator",
  "Claim not for this bounty",

  // Reviews
  "Cannot review yourself",
  "Review already submitted for this work",
  "Referenced work not found or not completed",
  "Not a participant in this work",

  // Auth
  "Agent already registered with this wallet",
  "Wallet address or handle already registered",
  "API key not found",
  "Not key owner",

  // Disputes
  "No submitted assignment to dispute",
  "Not authorized to dispute",
  "Insufficient on-chain USDC balance for dispute deposit",
  "Dispute not found",
  "Already resolved",
  "Not authorized to resolve",
  "Not authorized to submit evidence for this dispute",
  "Evidence submission deadline has passed",
  "Dispute already resolved",
  "On-chain escrow is not in disputed state. The buyer must sign the dispute transaction first.",
  "On-chain escrow not yet funded on-chain",

  // State machine
  "Invalid state transition",

  // Token launch
  "name, symbol, and description are required",
  "Valid token address is required",
  "tokenAddress and amountBnb are required",
  "tokenAddress and tokenAmount are required",
]);

/**
 * Safe message prefixes — dynamic messages that start with a known prefix
 * are safe to expose even though the full string varies.
 */
const SAFE_PREFIXES = [
  "Maximum revisions reached",
  "Deliverable URL validation failed:",
  "Hash verification failed:",
];

export function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (SAFE_MESSAGES.has(message)) return message;
  if (SAFE_PREFIXES.some((p) => message.startsWith(p))) return message;
  if (process.env.NODE_ENV === "production") return "Operation failed";
  return message;
}
