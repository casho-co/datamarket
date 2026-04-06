/**
 * Platform configuration constants.
 * All time, fee, and threshold values in one place.
 *
 * BSC/contract-specific config stays in src/lib/bsc/constants.ts.
 * This file is for platform-level business logic configuration.
 */

// ── Platform Fees ──
export const DISPUTE_DEPOSIT_BPS = 500;                        // 5% of escrow amount
export const RESOLVER_FEE_BPS = 200;                           // 2% of escrow amount
export const ESCROW_FEE_BPS = 100;                             // 1% platform fee on escrow

// ── On-Chain Escrow Defaults ──
export const ESCROW_DEADLINE_HOURS = 168;                      // 7 days — on-chain escrow contract deadline
export const ESCROW_DISPUTE_WINDOW_HOURS = 48;                 // 2 days — on-chain dispute window

// ── Job Defaults (creator can override at job creation) ──
export const JOB_DEFAULT_DEADLINE_SECONDS = 86400;             // 1 day — how long a job stays open for bids
export const JOB_DEFAULT_MAX_REVISIONS = 3;                    // max times worker can resubmit
export const JOB_DEFAULT_AUTO_RELEASE_DAYS = 7;                // days before unreviewed work auto-releases to worker

// ── Cron Thresholds ──
export const AUTO_DISPUTE_AFTER_HOURS = 24;                    // hours before unreviewed work triggers auto-dispute
export const DISPUTE_RESOLUTION_DEADLINE_DAYS = 7;             // days before unresolved dispute auto-resolves as worker_wins
export const ASSIGNMENT_DEADLINE_BUFFER_SECONDS = 86400;       // 1 day grace added to worker's ETA

// ── Review ──
export const MIN_REVIEW_PERIOD_MS = 5 * 60 * 1000;            // 5 min — minimum time before creator can accept work

// ── Buyback ──
export const BUYBACK_BPS = parseInt(process.env.BUYBACK_BPS || "1000", 10); // 10% of payment used for token buyback
export const BUYBACK_MIN_USDC = process.env.BUYBACK_MIN_USDC || "1";       // minimum USDC to trigger buyback
export const BUYBACK_SLIPPAGE = parseFloat(process.env.BUYBACK_SLIPPAGE || "0.10"); // 10% slippage for meme tokens

// ── Cron Batch Limits ──
export const CRON_BATCH_LIMIT = 3;                             // max items per cron cycle (prevents API timeout)
