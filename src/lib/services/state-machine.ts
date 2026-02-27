// ═══════════════════════════════════════════════
// State Machine — Enforces valid status transitions
// for Jobs, Tasks, Gig Orders, Bounties,
// Assignments, Escrows, and Bounty Claims
// ═══════════════════════════════════════════════

// ── Job (Standard Bid-Based) ──

const VALID_JOB_TRANSITIONS: Record<string, string[]> = {
  open: ["filling", "in_progress", "closed", "expired", "judging"],
  filling: ["in_progress", "closed", "expired"],
  in_progress: ["completed", "closed"],
  judging: ["completed", "closed"],
  completed: [],
  closed: [],
  expired: [],
};

// ── Task (Quote-Based) ──

const VALID_TASK_TRANSITIONS: Record<string, string[]> = {
  requested: ["quoted", "cancelled"],
  quoted: ["accepted", "rejected", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  rejected: [],
  in_progress: ["submitted", "cancelled"],
  submitted: ["completed", "disputed", "in_progress"],
  completed: [],
  disputed: ["completed", "cancelled"],
  cancelled: [],
};

// ── Gig Order ──

const VALID_GIG_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: ["completed", "in_progress", "disputed"],
  completed: [],
  cancelled: [],
  disputed: ["completed", "cancelled"],
};

// ── Bounty ──

const VALID_BOUNTY_TRANSITIONS: Record<string, string[]> = {
  open: ["claimed", "expired", "cancelled"],
  claimed: ["open", "completed", "expired"],
  completed: [],
  expired: [],
  cancelled: [],
};

// ── Bounty Claim ──

const VALID_BOUNTY_CLAIM_TRANSITIONS: Record<string, string[]> = {
  active: ["submitted", "rejected"],
  submitted: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

// ── Assignment ──

const VALID_ASSIGNMENT_TRANSITIONS: Record<string, string[]> = {
  in_progress: ["submitted", "cancelled"],
  submitted: ["accepted", "disputed", "in_progress"],
  disputed: ["accepted", "cancelled", "in_progress"],
  accepted: [],
  cancelled: [],
};

// ── Escrow ──

const VALID_ESCROW_TRANSITIONS: Record<string, string[]> = {
  funded: ["released", "refunded", "disputed"],
  disputed: ["released", "refunded", "funded"],
  released: [],
  refunded: [],
};

// ── Error ──

export class InvalidTransitionError extends Error {
  constructor(entity: string, id: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} → ${to} (id: ${id})`);
    this.name = "InvalidTransitionError";
  }
}

// ── Validators ──

function validate(
  transitions: Record<string, string[]>,
  entity: string,
  id: string,
  from: string,
  to: string
): void {
  const allowed = transitions[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidTransitionError(entity, id, from, to);
  }
}

export function validateJobTransition(
  currentStatus: string,
  newStatus: string,
  jobId: string
): void {
  validate(VALID_JOB_TRANSITIONS, "job", jobId, currentStatus, newStatus);
}

export function validateTaskTransition(
  currentStatus: string,
  newStatus: string,
  taskId: string
): void {
  validate(VALID_TASK_TRANSITIONS, "task", taskId, currentStatus, newStatus);
}

export function validateGigOrderTransition(
  currentStatus: string,
  newStatus: string,
  orderId: string
): void {
  validate(
    VALID_GIG_ORDER_TRANSITIONS,
    "gig_order",
    orderId,
    currentStatus,
    newStatus
  );
}

export function validateBountyTransition(
  currentStatus: string,
  newStatus: string,
  bountyId: string
): void {
  validate(
    VALID_BOUNTY_TRANSITIONS,
    "bounty",
    bountyId,
    currentStatus,
    newStatus
  );
}

export function validateBountyClaimTransition(
  currentStatus: string,
  newStatus: string,
  claimId: string
): void {
  validate(
    VALID_BOUNTY_CLAIM_TRANSITIONS,
    "bounty_claim",
    claimId,
    currentStatus,
    newStatus
  );
}

export function validateAssignmentTransition(
  currentStatus: string,
  newStatus: string,
  assignmentId: string
): void {
  validate(
    VALID_ASSIGNMENT_TRANSITIONS,
    "assignment",
    assignmentId,
    currentStatus,
    newStatus
  );
}

export function validateEscrowTransition(
  currentStatus: string,
  newStatus: string,
  escrowId: string
): void {
  validate(
    VALID_ESCROW_TRANSITIONS,
    "escrow",
    escrowId,
    currentStatus,
    newStatus
  );
}
