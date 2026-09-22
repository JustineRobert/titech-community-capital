/**
 * ============================================================================
 * TITech Community Capital
 * Canonical Financial Workflow State Contracts
 * ============================================================================
 *
 * Architectural role
 *   Dependency-light domain contract shared by financial workflows, offline
 *   synchronization, payment orchestration, reconciliation and reporting.
 *
 * Responsibilities
 *   - Define canonical payment lifecycle states.
 *   - Define offline synchronization states.
 *   - Define terminal/intermediate state semantics.
 *   - Provide deterministic state-transition validation.
 *
 * Non-responsibilities
 *   - Provider API calls.
 *   - Ledger posting.
 *   - Settlement confirmation.
 *   - Database persistence.
 *   - Authorization.
 *
 * Security / financial principles
 *   - REQUESTED/ACCEPTED is never equivalent to SETTLED.
 *   - UNKNOWN financial states must resolve through verification/reconciliation.
 *   - State transitions are explicit; callers must not mutate state ad hoc.
 * ============================================================================
 */

export const PAYMENT_STATES = Object.freeze({
  REQUESTED: 'REQUESTED',
  VALIDATED: 'VALIDATED',
  AUTHORIZED: 'AUTHORIZED',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  PROCESSING: 'PROCESSING',
  PENDING: 'PENDING',
  SUCCESSFUL: 'SUCCESSFUL',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  REVERSED: 'REVERSED',
  PARTIALLY_SETTLED: 'PARTIALLY_SETTLED',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  CANCELLED: 'CANCELLED',
});

export const OFFLINE_STATES = Object.freeze({
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING_SYNC: 'PENDING_SYNC',
  SYNCING: 'SYNCING',
  SERVER_ACCEPTED: 'SERVER_ACCEPTED',
  SERVER_REJECTED: 'SERVER_REJECTED',
  CONFLICT: 'CONFLICT',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  CONFIRMED: 'CONFIRMED',
});

const PAYMENT_TRANSITIONS = Object.freeze({
  REQUESTED: ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['AUTHORIZED', 'CANCELLED'],
  AUTHORIZED: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['ACCEPTED', 'PROCESSING', 'PENDING', 'FAILED', 'TIMEOUT', 'REQUIRES_REVIEW'],
  ACCEPTED: ['PROCESSING', 'PENDING', 'SUCCESSFUL', 'FAILED', 'TIMEOUT', 'REQUIRES_REVIEW'],
  PROCESSING: ['PENDING', 'SUCCESSFUL', 'SETTLED', 'FAILED', 'TIMEOUT', 'REVERSED', 'PARTIALLY_SETTLED', 'REQUIRES_REVIEW'],
  PENDING: ['PROCESSING', 'SUCCESSFUL', 'SETTLED', 'FAILED', 'TIMEOUT', 'REVERSED', 'REQUIRES_REVIEW'],
  SUCCESSFUL: ['SETTLED', 'REVERSED', 'PARTIALLY_SETTLED', 'REQUIRES_REVIEW'],
  PARTIALLY_SETTLED: ['SETTLED', 'REVERSED', 'REQUIRES_REVIEW'],
  SETTLED: ['REVERSED', 'REQUIRES_REVIEW'],
  FAILED: ['REQUIRES_REVIEW'],
  TIMEOUT: ['PENDING', 'PROCESSING', 'FAILED', 'REQUIRES_REVIEW'],
  REQUIRES_REVIEW: ['PENDING', 'PROCESSING', 'SUCCESSFUL', 'SETTLED', 'FAILED', 'REVERSED', 'CANCELLED'],
  REVERSED: [],
  CANCELLED: [],
});

const TERMINAL_PAYMENT_STATES = new Set([
  PAYMENT_STATES.SETTLED,
  PAYMENT_STATES.REVERSED,
  PAYMENT_STATES.CANCELLED,
]);

export function canTransitionPayment(from, to) {
  if (from === to) return true;
  return PAYMENT_TRANSITIONS[from]?.includes(to) === true;
}

export function assertPaymentTransition(from, to) {
  if (!canTransitionPayment(from, to)) {
    const error = new Error(`Invalid payment state transition: ${from} -> ${to}`);
    error.code = 'INVALID_PAYMENT_STATE_TRANSITION';
    error.statusCode = 409;
    throw error;
  }
  return true;
}

export function isTerminalPaymentState(state) {
  return TERMINAL_PAYMENT_STATES.has(state);
}

export function isSettlementState(state) {
  return state === PAYMENT_STATES.SETTLED || state === PAYMENT_STATES.PARTIALLY_SETTLED;
}

export function isFinancialFinality(state) {
  return state === PAYMENT_STATES.SETTLED;
}

export const PAYMENT_TRANSITION_GRAPH = PAYMENT_TRANSITIONS;
