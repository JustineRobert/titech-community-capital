'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Transaction State Machine
 * =============================================================================
 * File:
 *   backend/modules/payment/airtel/collections/transactionStateMachine.js
 *
 * Architectural role
 * ------------------
 * Canonical lifecycle/state-transition authority for Airtel inbound COLLECTION
 * transactions. This component owns workflow truth and concurrency control; it
 * does not own provider transport, accounting, balances, reconciliation
 * adjudication, approvals, or financial settlement finality.
 *
 * Responsibilities
 * ----------------
 * - Define the canonical collection lifecycle and legal transitions.
 * - Enforce Airtel/tenant/operation scope.
 * - Require optimistic concurrency, financial fingerprint and original
 *   idempotency identity for financial mutations.
 * - Preserve the original financial identity across retries.
 * - Block blind retries after pending/unknown/ambiguous outcomes.
 * - Expose execution-claim, provider-outcome, reconciliation, compensation,
 *   refund, reversal, cancellation, expiration and escalation helpers.
 * - Delegate persistence atomically through an injected repository.
 * - Emit sanitized audit/event evidence and operational diagnostics.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP/API calls or provider credentials.
 * - No direct MongoDB/Mongoose/Redis access.
 * - No ledger/journal/balance/wallet mutation.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No maker-checker authorization.
 * - No callback signature verification.
 * - No reconciliation decisioning or financial finality.
 * - No provider retry execution.
 *
 * Financial-safety principles
 * ---------------------------
 * 1. State-machine truth is workflow truth, not accounting truth.
 * 2. PENDING/UNKNOWN/TIMEOUT/AMBIGUOUS outcomes cannot become SUCCESS by
 *    inference.
 * 3. Only explicitly failed states are eligible for retry re-arming.
 * 4. Retry preserves transaction identity and the original idempotency key.
 * 5. SUCCESS -> REVERSED requires explicit REVERSE action and a distinct
 *    corrective/reversal idempotency identity.
 * 6. Repository atomic compare-and-set is the concurrency authority.
 * 7. Audit/event publication cannot silently roll back a committed state.
 * 8. Offline operational state is never settlement evidence.
 *
 * Preferred repository contract
 * ------------------------------
 * repository.transition({ collectionId, transactionId, tenantId, provider,
 * operation, fromState, toState, action, expectedVersion,
 * expectedFingerprint, expectedIdempotencyKey, actorId, patch, context })
 *
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

// =============================================================================
// Module identity
// =============================================================================
export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections.transaction-state-machine';
export const ENGINE_NAME = 'airtel-collection-transaction-state-machine';
export const ENGINE_VERSION = '4.1.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';

// =============================================================================
// Canonical lifecycle
// =============================================================================
export const COLLECTION_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  PROVIDER_PENDING: 'PROVIDER_PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  AMBIGUOUS: 'AMBIGUOUS',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILING: 'RECONCILING',
  RECONCILED: 'RECONCILED',
  COMPENSATION_REQUIRED: 'COMPENSATION_REQUIRED',
  COMPENSATING: 'COMPENSATING',
  COMPENSATED: 'COMPENSATED',
  REFUND_REQUIRED: 'REFUND_REQUIRED',
  REFUNDING: 'REFUNDING',
  REFUNDED: 'REFUNDED',
  REVERSED: 'REVERSED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  ESCALATED: 'ESCALATED',
});

export const TERMINAL_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.SUCCESS,
  COLLECTION_STATES.FAILED,
  COLLECTION_STATES.COMPENSATED,
  COLLECTION_STATES.REFUNDED,
  COLLECTION_STATES.REVERSED,
  COLLECTION_STATES.CANCELLED,
  COLLECTION_STATES.EXPIRED,
  COLLECTION_STATES.REJECTED,
]);

export const ACTIVE_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.DRAFT,
  COLLECTION_STATES.VALIDATING,
  COLLECTION_STATES.PENDING_APPROVAL,
  COLLECTION_STATES.APPROVED,
  COLLECTION_STATES.QUEUED,
  COLLECTION_STATES.EXECUTING,
  COLLECTION_STATES.PROVIDER_ACCEPTED,
  COLLECTION_STATES.PROVIDER_PENDING,
  COLLECTION_STATES.AMBIGUOUS,
  COLLECTION_STATES.RECONCILIATION_REQUIRED,
  COLLECTION_STATES.RECONCILING,
  COLLECTION_STATES.COMPENSATION_REQUIRED,
  COLLECTION_STATES.COMPENSATING,
  COLLECTION_STATES.REFUND_REQUIRED,
  COLLECTION_STATES.REFUNDING,
  COLLECTION_STATES.ESCALATED,
]);

export const UNCERTAIN_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.PROVIDER_PENDING,
  COLLECTION_STATES.AMBIGUOUS,
  COLLECTION_STATES.RECONCILIATION_REQUIRED,
  COLLECTION_STATES.RECONCILING,
]);

export const EXECUTABLE_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.APPROVED,
  COLLECTION_STATES.QUEUED,
]);

export const PROVIDER_FINAL_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.SUCCESS,
  COLLECTION_STATES.FAILED,
  COLLECTION_STATES.PROVIDER_PENDING,
  COLLECTION_STATES.AMBIGUOUS,
]);

const COLLECTION_TRANSITIONS = {
  [COLLECTION_STATES.DRAFT]: [
    COLLECTION_STATES.VALIDATING,
    COLLECTION_STATES.PENDING_APPROVAL,
    COLLECTION_STATES.APPROVED,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.EXPIRED,
    COLLECTION_STATES.REJECTED,
  ],

  [COLLECTION_STATES.VALIDATING]: [
    COLLECTION_STATES.PENDING_APPROVAL,
    COLLECTION_STATES.APPROVED,
    COLLECTION_STATES.VALIDATION_FAILED,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.VALIDATION_FAILED]: [
    COLLECTION_STATES.VALIDATING,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.EXPIRED,
  ],

  [COLLECTION_STATES.PENDING_APPROVAL]: [
    COLLECTION_STATES.APPROVED,
    COLLECTION_STATES.REJECTED,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.EXPIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.APPROVED]: [
    COLLECTION_STATES.QUEUED,
    COLLECTION_STATES.EXECUTING,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.EXPIRED,
  ],

  [COLLECTION_STATES.QUEUED]: [
    COLLECTION_STATES.EXECUTING,
    COLLECTION_STATES.CANCELLED,
    COLLECTION_STATES.EXPIRED,
  ],

  [COLLECTION_STATES.EXECUTING]: [
    COLLECTION_STATES.PROVIDER_ACCEPTED,
    COLLECTION_STATES.PROVIDER_PENDING,
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.AMBIGUOUS,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.CANCELLED,
  ],

  [COLLECTION_STATES.PROVIDER_ACCEPTED]: [
    COLLECTION_STATES.SUCCESS,
    COLLECTION_STATES.PROVIDER_PENDING,
    COLLECTION_STATES.AMBIGUOUS,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
  ],

  [COLLECTION_STATES.PROVIDER_PENDING]: [
    COLLECTION_STATES.SUCCESS,
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.AMBIGUOUS,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.RECONCILING,
  ],

  [COLLECTION_STATES.SUCCESS]: [
    COLLECTION_STATES.REVERSED,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
  ],

  [COLLECTION_STATES.FAILED]: [
    COLLECTION_STATES.APPROVED,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.AMBIGUOUS]: [
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.RECONCILING,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.RECONCILIATION_REQUIRED]: [
    COLLECTION_STATES.RECONCILING,
    COLLECTION_STATES.RECONCILED,
    COLLECTION_STATES.SUCCESS,
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.COMPENSATION_REQUIRED,
    COLLECTION_STATES.REFUND_REQUIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.RECONCILING]: [
    COLLECTION_STATES.RECONCILED,
    COLLECTION_STATES.SUCCESS,
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.COMPENSATION_REQUIRED,
    COLLECTION_STATES.REFUND_REQUIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.RECONCILED]: [
    COLLECTION_STATES.SUCCESS,
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.COMPENSATION_REQUIRED,
    COLLECTION_STATES.REFUND_REQUIRED,
  ],

  [COLLECTION_STATES.COMPENSATION_REQUIRED]: [
    COLLECTION_STATES.COMPENSATING,
    COLLECTION_STATES.ESCALATED,
    COLLECTION_STATES.CANCELLED,
  ],

  [COLLECTION_STATES.COMPENSATING]: [
    COLLECTION_STATES.COMPENSATED,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.COMPENSATED]: [],

  [COLLECTION_STATES.REFUND_REQUIRED]: [
    COLLECTION_STATES.REFUNDING,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.REFUNDING]: [
    COLLECTION_STATES.REFUNDED,
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.ESCALATED,
  ],

  [COLLECTION_STATES.REFUNDED]: [],
  [COLLECTION_STATES.REVERSED]: [],
  [COLLECTION_STATES.CANCELLED]: [],
  [COLLECTION_STATES.EXPIRED]: [],
  [COLLECTION_STATES.REJECTED]: [],

  [COLLECTION_STATES.ESCALATED]: [
    COLLECTION_STATES.RECONCILIATION_REQUIRED,
    COLLECTION_STATES.COMPENSATION_REQUIRED,
    COLLECTION_STATES.REFUND_REQUIRED,
    COLLECTION_STATES.CANCELLED,
  ],
};

export const ALLOWED_COLLECTION_TRANSITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(COLLECTION_TRANSITIONS).map(
      ([state, targets]) => [
        state,
        Object.freeze([
          ...targets,
        ]),
      ],
    ),
  ),
);

export const TRANSITIONS =
  ALLOWED_COLLECTION_TRANSITIONS;

export const COLLECTION_TRANSITIONS_MAP =
  ALLOWED_COLLECTION_TRANSITIONS;

export const TRANSACTION_STATES =
  COLLECTION_STATES;

export const TRANSACTION_STATUS =
  COLLECTION_STATES;

export const PAYMENT_STATES =
  COLLECTION_STATES;

// =============================================================================
// Provider / action vocabulary
// =============================================================================

export const PROVIDER_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  ACCEPTED: 'ACCEPTED',
  PENDING: 'PENDING',
  FAILURE: 'FAILURE',
  REJECTED: 'REJECTED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
  TIMEOUT: 'TIMEOUT',
});

export const PROVIDER_OUTCOMES =
  PROVIDER_OUTCOME;

export const ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  VALIDATE: 'VALIDATE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SUBMIT_APPROVAL: 'SUBMIT_APPROVAL',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  QUEUE: 'QUEUE',
  EXECUTE: 'EXECUTE',
  MARK_PROVIDER_ACCEPTED:
    'MARK_PROVIDER_ACCEPTED',
  MARK_PROVIDER_PENDING:
    'MARK_PROVIDER_PENDING',
  MARK_SUCCESS: 'MARK_SUCCESS',
  MARK_FAILED: 'MARK_FAILED',
  MARK_AMBIGUOUS:
    'MARK_AMBIGUOUS',
  RECONCILE: 'RECONCILE',
  BEGIN_RECONCILIATION:
    'BEGIN_RECONCILIATION',
  COMPLETE_RECONCILIATION:
    'COMPLETE_RECONCILIATION',
  REQUIRE_COMPENSATION:
    'REQUIRE_COMPENSATION',
  START_COMPENSATION:
    'START_COMPENSATION',
  COMPLETE_COMPENSATION:
    'COMPLETE_COMPENSATION',
  REQUIRE_REFUND:
    'REQUIRE_REFUND',
  START_REFUND:
    'START_REFUND',
  COMPLETE_REFUND:
    'COMPLETE_REFUND',
  REVERSE: 'REVERSE',
  CANCEL: 'CANCEL',
  EXPIRE: 'EXPIRE',
  ESCALATE: 'ESCALATE',
  RETRY: 'RETRY',
  STATUS_CHECK: 'STATUS_CHECK',
  CLAIM_EXECUTION:
    'CLAIM_EXECUTION',
  REVIEW: 'REVIEW',
});

export const COMMANDS = Object.freeze({
  ...ACTIONS,
  STATUS_CHECK: 'STATUS_CHECK',
  RECONCILE: 'RECONCILE',
  COMPENSATE: 'COMPENSATE',
  REFUND: 'REFUND',
  REVERSE: 'REVERSE',
});

export const STATE_MACHINE_OUTCOMES = Object.freeze({
  TRANSITIONED:
    'TRANSITIONED',
  IDEMPOTENT:
    'IDEMPOTENT',
  REJECTED:
    'REJECTED',
  RETRY_READY:
    'RETRY_READY',
  CLAIMED:
    'CLAIMED',
  ALREADY_CLAIMED:
    'ALREADY_CLAIMED',
  REQUIRES_STATUS_CHECK:
    'REQUIRES_STATUS_CHECK',
  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',
  REQUIRES_REVIEW:
    'REQUIRES_REVIEW',
});

export const RETRY_DECISIONS = Object.freeze({
  RETRY: 'RETRY',
  NO_RETRY: 'NO_RETRY',
  STATUS_CHECK: 'STATUS_CHECK',
  RECONCILE: 'RECONCILE',
  REVIEW: 'REVIEW',
  STOP: 'STOP',
});

export const RETRYABLE_STATES =
  Object.freeze([
    COLLECTION_STATES.FAILED,
    COLLECTION_STATES.VALIDATION_FAILED,
  ]);

export const NON_RETRYABLE_UNCERTAIN_STATES =
  UNCERTAIN_COLLECTION_STATES;

export const RECONCILIATION_STATES =
  Object.freeze({
    REQUIRED: 'REQUIRED',
    RECONCILING: 'RECONCILING',
    RECONCILED: 'RECONCILED',
    CONFLICT: 'CONFLICT',
    ESCALATED: 'ESCALATED',
  });

export const RECONCILIATION_OUTCOMES =
  Object.freeze({
    CONFIRMED_SUCCESS:
      'CONFIRMED_SUCCESS',
    CONFIRMED_FAILURE:
      'CONFIRMED_FAILURE',
    PENDING: 'PENDING',
    AMBIGUOUS: 'AMBIGUOUS',
    CONFLICT: 'CONFLICT',
    REPAIR_REQUIRED:
      'REPAIR_REQUIRED',
  });

const SUCCESS_OUTCOMES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'SUCCESSFUL',
  'COMPLETED',
  'SETTLED',
  'POSTED',
  'PAID',
  'CONFIRMED',
  'CONFIRMED_SUCCESS',
]);

const FAILURE_OUTCOMES = new Set([
  'FAILURE',
  'FAILED',
  'REJECTED',
  'DECLINED',
  'DENIED',
  'CANCELLED',
  'CANCELED',
  'CONFIRMED_FAILURE',
]);

const PENDING_OUTCOMES = new Set([
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
]);

const AMBIGUOUS_OUTCOMES = new Set([
  'AMBIGUOUS',
  'UNKNOWN',
  'TIMEOUT',
  'NO_RESPONSE',
  'INDETERMINATE',
  'COMMIT_UNKNOWN',
]);

// =============================================================================
// Configuration / safety contract
// =============================================================================

export const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  requireAirtelProvider: true,
  requireCollectionOperation: true,

  requireExpectedVersionForMutation:
    true,

  requireExpectedFingerprintForMutation:
    true,

  requireOriginalIdempotencyKeyForFinancialMutation:
    true,

  requireExpectedIdempotencyKeyForMutation:
    true,

  requireAtomicTransition:
    true,

  requireAtomicExecutionClaim:
    true,

  requireAtomicRetryRearm:
    true,

  allowSameStateIdempotency:
    true,

  allowCompatibilityReversalTransition:
    true,

  allowCompatibilityRetryRearm:
    true,

  preserveTimeline:
    true,

  preserveIdentity:
    true,

  rejectCrossTenantReads:
    true,

  maxVersion:
    Number.MAX_SAFE_INTEGER,

  maxCollectionIdLength:
    240,

  maxTransactionIdLength:
    240,

  maxReferenceLength:
    240,

  maxTenantIdLength:
    160,

  maxFingerprintLength:
    128,

  maxIdempotencyKeyLength:
    320,

  maxActorIdLength:
    200,

  maxReasonLength:
    1000,

  maxTimelineEntries:
    500,

  maxMetadataDepth:
    5,

  maxMetadataKeys:
    64,

  maxMetadataArrayLength:
    100,

  maxMetadataStringLength:
    2048,

  failClosedOnAuditError:
    false,

  failClosedOnEventError:
    false,

  validateTransitionGraphOnStartup:
    true,
});

export const CAPABILITIES = Object.freeze({
  tenantScoped: true,
  providerScoped: true,
  operationScoped: true,
  atomicCompareAndSet: true,
  optimisticConcurrency: true,
  financialFingerprintGuard: true,
  idempotencyIdentityGuard: true,
  ambiguousOutcomeProtection: true,
  failedRetryRearm: true,
  executionClaim: true,
  reconciliationWorkflow: true,
  compensationWorkflow: true,
  refundWorkflow: true,
  reversalWorkflow: true,
  directProviderHttp: false,
  directDatabaseWrite: false,
  directLedgerWrite: false,
  directBalanceMutation: false,
  directWalletMutation: false,
  settlementFinality: false,
});

export const FINANCIAL_BOUNDARY =
  Object.freeze({
    providerCalls: false,
    providerAuthentication: false,
    databaseWrites: false,
    ledgerWrites: false,
    balanceMutation: false,
    walletMutation: false,
    financialFinality: false,
    reconciliationFinality: false,
    authorization: false,
    preserveOriginalTransactionIdentity:
      true,
    preserveOriginalIdempotencyIdentity:
      true,
    authoritativeFinancialBoundary:
      'TITECH_FINANCIAL_CORE',
  });

function graphWarnings() {
  const states =
    new Set(
      Object.values(
        COLLECTION_STATES,
      ),
    );

  const warnings = [];

  for (
    const [
      from,
      targets,
    ] of Object.entries(
      COLLECTION_TRANSITIONS,
    )
  ) {
    if (!states.has(from)) {
      warnings.push({
        type: 'UNKNOWN_SOURCE_STATE',
        state: from,
      });
    }

    for (
      const target of targets
    ) {
      if (!states.has(target)) {
        warnings.push({
          type: 'UNKNOWN_TARGET_STATE',
          state: from,
          target,
        });
      }
    }
  }

  for (
    const state of states
  ) {
    if (
      !(state in COLLECTION_TRANSITIONS)
    ) {
      warnings.push({
        type: 'MISSING_STATE_ENTRY',
        state,
      });
    }
  }

  return warnings;
}

export const CANONICAL_TRANSITION_WARNINGS =
  Object.freeze(
    graphWarnings(),
  );

export const TRANSITION_GRAPH_WARNINGS =
  CANONICAL_TRANSITION_WARNINGS;

// =============================================================================
// Utility helpers
// =============================================================================

const isPlainObject =
  (value) =>
    Boolean(
      value &&
        typeof value ===
          'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date),
    );

const isFunction =
  (value) =>
    typeof value === 'function';

const upper = (value) =>
  value == null
    ? undefined
    : (
        String(value)
          .trim()
          .toUpperCase() ||
        undefined
      );

const text = (
  value,
  max = 240,
) => {
  if (value == null) {
    return undefined;
  }

  const s = String(value).trim();

  return s
    ? s.slice(0, max)
    : undefined;
};

const clone = (value) => {
  if (value === undefined) {
    return undefined;
  }

  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(
        JSON.stringify(value),
      );
    } catch {
      return value;
    }
  }
};

const stable = (value) => {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }

  if (typeof value === 'bigint') {
    return `bigint:${value}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(
            k,
          )}:${stable(value[k])}`,
      )
      .join(',')}}`;
  }

  if (
    typeof value === 'number' &&
    Object.is(value, -0)
  ) {
    return '0';
  }

  return JSON.stringify(value);
};

const sha256 = (value) =>
  createHash(
    HASH_ALGORITHM,
  )
    .update(
      typeof value === 'string'
        ? value
        : stable(value),
      'utf8',
    )
    .digest('hex');

const nowMs = (clock) => {
  try {
    const v =
      typeof clock === 'function'
        ? clock()
        : clock?.now?.();

    if (v instanceof Date) {
      return v.getTime();
    }

    if (
      Number.isFinite(
        Number(v),
      )
    ) {
      return Number(v);
    }
  } catch {
    // System clock fallback.
  }

  return Date.now();
};

const nowIso = (clock) =>
  new Date(
    nowMs(clock),
  ).toISOString();

const safeError = (error) => ({
  name: text(
    error?.name,
    120,
  ),
  code: text(
    error?.code,
    160,
  ),
  message: text(
    error?.message,
    500,
  ),
  statusCode:
    Number.isInteger(
      Number(
        error?.statusCode ??
          error?.status,
      ),
    )
      ? Number(
          error?.statusCode ??
            error?.status,
        )
      : null,
  retryable:
    Boolean(
      error?.retryable,
    ),
  uncertain:
    Boolean(
      error?.uncertain,
    ),
});

const sanitize = (
  value,
  depth = 0,
  config = DEFAULT_CONFIG,
) => {
  if (
    depth >
    config.maxMetadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length >
      config.maxMetadataStringLength
      ? `${value.slice(
          0,
          config.maxMetadataStringLength,
        )}…`
      : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(
        0,
        config.maxMetadataArrayLength,
      )
      .map((item) =>
        sanitize(
          item,
          depth + 1,
          config,
        ),
      );
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const blockedKeys =
    new Set([
      '__proto__',
      'prototype',
      'constructor',
    ]);

  const unsafeKeyPattern =
    /(^\$)|\./;

  const secretKeyPattern =
    /(password|secret|token|authorization|cookie|set-cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|credential|signature|raw(request|response)|provider.?payload|access.?token|refresh.?token)/i;

  const output = {};

  for (
    const key of Object.keys(
      value,
    ).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      blockedKeys.has(key) ||
      unsafeKeyPattern.test(key)
    ) {
      continue;
    }

    output[key] =
      secretKeyPattern.test(key)
        ? '[REDACTED]'
        : sanitize(
            value[key],
            depth + 1,
            config,
          );
  }

  return output;
};

const normalizeState = (state) =>
  upper(state);

const normalizeProviderOutcome = (
  value,
) => {
  const v = upper(value);

  if (
    SUCCESS_OUTCOMES.has(v)
  ) {
    return PROVIDER_OUTCOME.SUCCESS;
  }

  if (
    FAILURE_OUTCOMES.has(v)
  ) {
    return v ===
        'REJECTED' ||
      v === 'DECLINED' ||
      v === 'DENIED'
      ? PROVIDER_OUTCOME.REJECTED
      : PROVIDER_OUTCOME.FAILURE;
  }

  if (
    PENDING_OUTCOMES.has(v)
  ) {
    return v ===
        PROVIDER_OUTCOME.ACCEPTED
      ? PROVIDER_OUTCOME.ACCEPTED
      : PROVIDER_OUTCOME.PENDING;
  }

  if (
    AMBIGUOUS_OUTCOMES.has(v)
  ) {
    return v ===
        PROVIDER_OUTCOME.TIMEOUT
      ? PROVIDER_OUTCOME.TIMEOUT
      : v ===
          PROVIDER_OUTCOME.AMBIGUOUS
        ? PROVIDER_OUTCOME.AMBIGUOUS
        : PROVIDER_OUTCOME.UNKNOWN;
  }

  return (
    v ||
    PROVIDER_OUTCOME.UNKNOWN
  );
};

export const isTerminalState =
  (state) =>
    TERMINAL_COLLECTION_STATES.includes(
      normalizeState(state),
    );

const isUncertainState =
  (state) =>
    UNCERTAIN_COLLECTION_STATES.includes(
      normalizeState(state),
    );

const isRetryableState =
  (state) =>
    RETRYABLE_STATES.includes(
      normalizeState(state),
    );

const isValidState =
  (state) =>
    Object.values(
      COLLECTION_STATES,
    ).includes(
      normalizeState(state),
    );

export function buildCollectionStateScopeFingerprint(
  input = {},
) {
  return sha256({
    schemaVersion:
      SCHEMA_VERSION,

    tenantId: text(
      input.tenantId,
      DEFAULT_CONFIG.maxTenantIdLength,
    ),

    provider:
      upper(input.provider) ??
      PROVIDER,

    operation:
      upper(input.operation) ??
      OPERATION,

    collectionId: text(
      input.collectionId,
      DEFAULT_CONFIG.maxCollectionIdLength,
    ),

    transactionId: text(
      input.transactionId,
      DEFAULT_CONFIG.maxTransactionIdLength,
    ),

    reference: text(
      input.reference,
      DEFAULT_CONFIG.maxReferenceLength,
    ),

    financialFingerprint:
      text(
        input.financialFingerprint ??
          input.fingerprint,
        DEFAULT_CONFIG.maxFingerprintLength,
      ),

    originalIdempotencyKeyHash:
      input.originalIdempotencyKey
        ? sha256(
            String(
              input.originalIdempotencyKey,
            ),
          )
        : null,
  });
}

export function canTransitionCollection(
  fromState,
  toState,
  { action } = {},
) {
  const from =
    normalizeState(
      fromState,
    );

  const to =
    normalizeState(
      toState,
    );

  const act =
    upper(action);

  if (
    !from ||
    !to ||
    !isValidState(from) ||
    !isValidState(to)
  ) {
    return false;
  }

  if (from === to) {
    return true;
  }

  if (
    from === COLLECTION_STATES.FAILED &&
    to === COLLECTION_STATES.APPROVED
  ) {
    return act === ACTIONS.RETRY;
  }

  if (
    from === COLLECTION_STATES.SUCCESS &&
    to === COLLECTION_STATES.REVERSED
  ) {
    return act === ACTIONS.REVERSE;
  }

  if (
    from === COLLECTION_STATES.SUCCESS &&
    to ===
      COLLECTION_STATES.RECONCILIATION_REQUIRED
  ) {
    return (
      act === ACTIONS.RECONCILE ||
      act === ACTIONS.REVIEW
    );
  }

  return Boolean(
    ALLOWED_COLLECTION_TRANSITIONS[
      from
    ]?.includes(to),
  );
}

export const canTransition =
  canTransitionCollection;

export const isCollectionTerminal =
  isTerminalState;

export const isUncertainCollectionState =
  isUncertainState;

// =============================================================================
// Error
// =============================================================================

export class AirtelCollectionTransactionStateMachineError
  extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      String(
        message ||
          'Airtel collection state-machine error.',
      ),
      options.cause
        ? {
            cause:
              options.cause,
          }
        : undefined,
    );

    this.name =
      'AirtelCollectionTransactionStateMachineError';

    this.code =
      options.code ??
      'STATE_MACHINE_ERROR';

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.uncertain =
      Boolean(
        options.uncertain,
      );

    this.tenantId =
      options.tenantId ??
      null;

    this.correlationId =
      options.correlationId ??
      null;

    this.operationId =
      options.operationId ??
      null;

    this.provider =
      PROVIDER;

    this.operation =
      OPERATION;

    this.component =
      COMPONENT;

    this.details =
      options.details ??
      {};
  }

  toJSON() {
    return {
      name:
        this.name,

      message:
        this.message,

      code:
        this.code,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      uncertain:
        this.uncertain,

      tenantId:
        this.tenantId,

      correlationId:
        this.correlationId,

      operationId:
        this.operationId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      details:
        this.details,
    };
  }
}

export const AirtelCollectionStateMachineError =
  AirtelCollectionTransactionStateMachineError;

// =============================================================================
// Main implementation
// =============================================================================

export class AirtelCollectionTransactionStateMachine {
  constructor(
    options = {},
  ) {
    if (
      !isPlainObject(options)
    ) {
      throw new AirtelCollectionTransactionStateMachineError(
        'State-machine options must be a plain object.',
        {
          code:
            'STATE_MACHINE_INVALID_OPTIONS',
          statusCode: 500,
        },
      );
    }

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,
        ...(options.config ??
          options.configuration ??
          {}),
      });

    this.repository =
      options.repository ??
      options.stateRepository ??
      options.transactionRepository ??
      options.collectionRepository ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      null;

    this.clock =
      options.clock ??
      {
        now: () => Date.now(),
      };

    this.idFactory =
      isFunction(
        options.idFactory,
      )
        ? options.idFactory
        : () => randomUUID();

    this.transitions =
      Object.fromEntries(
        Object.entries(
          options.transitions ??
            ALLOWED_COLLECTION_TRANSITIONS,
        ).map(
          (
            [
              state,
              targets,
            ],
          ) => [
            normalizeState(state),
            Object.freeze(
              [
                ...targets,
              ].map(
                normalizeState,
              ),
            ),
          ],
        ),
      );

    if (
      this.config
        .validateTransitionGraphOnStartup &&
      TRANSITION_GRAPH_WARNINGS.length
    ) {
      this.#log(
        'warn',
        'Collection transition graph validation warnings detected.',
        {
          warnings:
            TRANSITION_GRAPH_WARNINGS,
        },
      );
    }
  }

  #throw(
    message,
    code,
    options = {},
  ) {
    throw new AirtelCollectionTransactionStateMachineError(
      message,
      {
        ...options,
        code,
        tenantId:
          options.tenantId ??
          null,
        correlationId:
          options.correlationId ??
          null,
        operationId:
          options.operationId ??
          null,
        details:
          sanitize(
            options.details ??
              {},
            0,
            this.config,
          ),
      },
    );
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const fn =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      if (
        isFunction(fn)
      ) {
        fn.call(
          this.logger,
          {
            component:
              COMPONENT,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            ...sanitize(
              context,
              0,
              this.config,
            ),
          },
          message,
        );
      }
    } catch {
      // Logging is non-authoritative.
    }
  }

  #metric(
    name,
    labels = {},
  ) {
    try {
      const fn =
        this.metrics
          ?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (
        isFunction(fn)
      ) {
        fn.call(
          this.metrics,
          name,
          sanitize(
            labels,
            0,
            this.config,
          ),
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async #audit(
    action,
    context,
    result = null,
  ) {
    const fn =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write ??
      this.auditService?.createAuditLog;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const payload =
      sanitize(
        {
          schemaVersion:
            SCHEMA_VERSION,

          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          action,

          tenantId:
            context.tenantId,

          collectionId:
            context.collectionId,

          transactionId:
            context.transactionId,

          fromState:
            context.fromState,

          toState:
            context.toState,

          state:
            context.toState ??
            context.state,

          version:
            result?.version ??
            context.expectedVersion,

          financialFingerprint:
            context.expectedFingerprint ??
            context.financialFingerprint,

          originalIdempotencyKeyHash:
            context.originalIdempotencyKey
              ? sha256(
                  context.originalIdempotencyKey,
                )
              : null,

          actorId:
            context.actorId ??
            null,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          reason:
            context.reason,

          providerOutcome:
            context.providerOutcome,

          occurredAt:
            nowIso(
              this.clock,
            ),
        },
        0,
        this.config,
      );

    try {
      return await fn.call(
        this.auditService,
        {
          ...payload,
          auditFingerprint:
            sha256(payload),
        },
      );
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Collection state-machine audit publication failed.',
        {
          action,
          errorCode:
            error?.code,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          'Collection audit boundary is unavailable.',
          'STATE_MACHINE_AUDIT_UNAVAILABLE',
          {
            statusCode:
              503,
            retryable:
              true,
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
          },
        );
      }

      return null;
    }
  }

  async #publishEvent(
    type,
    context,
    result = null,
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const event =
      sanitize(
        {
          eventId:
            this.idFactory(),

          type,

          occurredAt:
            nowIso(
              this.clock,
            ),

          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId:
            context.tenantId,

          collectionId:
            context.collectionId,

          transactionId:
            context.transactionId,

          fromState:
            context.fromState,

          toState:
            context.toState,

          action:
            context.action,

          version:
            result?.version,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          transitionFingerprint:
            context.transitionFingerprint,

          financialFingerprint:
            context.expectedFingerprint ??
            context.financialFingerprint,
        },
        0,
        this.config,
      );

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Collection state-machine event publication failed.',
        {
          type,
          errorCode:
            error?.code,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          'Collection state-machine event publication failed.',
          'STATE_MACHINE_EVENT_PUBLICATION_FAILED',
          {
            statusCode:
              503,
            retryable:
              true,
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
          },
        );
      }

      return null;
    }
  }

  #normalize(
    input = {},
  ) {
    if (
      !isPlainObject(input)
    ) {
      this.#throw(
        'State-machine transition input must be a plain object.',
        'STATE_MACHINE_INVALID_INPUT',
        {
          statusCode:
            422,
        },
      );
    }

    const tenantId =
      text(
        input.tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        'tenantId is required for collection state mutation.',
        'STATE_MACHINE_TENANT_REQUIRED',
        {
          statusCode:
            422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      ) ??
      PROVIDER;

    if (
      this.config
        .requireAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        'Collection state machine accepts only AIRTEL.',
        'STATE_MACHINE_PROVIDER_SCOPE_VIOLATION',
        {
          statusCode:
            409,
          tenantId,
          details: {
            provider,
          },
        },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      ) ??
      OPERATION;

    if (
      this.config
        .requireCollectionOperation &&
      operation !== OPERATION
    ) {
      this.#throw(
        'Collection state machine accepts only COLLECTION operations.',
        'STATE_MACHINE_OPERATION_SCOPE_VIOLATION',
        {
          statusCode:
            409,
          tenantId,
          details: {
            operation,
          },
        },
      );
    }

    const collectionId =
      text(
        input.collectionId ??
          input.id ??
          input.transactionId,
        this.config
          .maxCollectionIdLength,
      );

    const transactionId =
      text(
        input.transactionId ??
          input.financialTransactionId ??
          collectionId,
        this.config
          .maxTransactionIdLength,
      );

    const reference =
      text(
        input.reference ??
          input.externalReference,
        this.config
          .maxReferenceLength,
      );

    const originalIdempotencyKey =
      text(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    const expectedIdempotencyKey =
      text(
        input.expectedIdempotencyKey ??
          originalIdempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    const expectedFingerprint =
      text(
        input.expectedFingerprint ??
          input.financialFingerprint ??
          input.fingerprint,
        this.config
          .maxFingerprintLength,
      );

    const fromState =
      normalizeState(
        input.fromState ??
          input.currentState ??
          input.state,
      );

    const toState =
      normalizeState(
        input.toState ??
          input.nextState ??
          input.nextStatus,
      );

    const action =
      upper(input.action);

    const actorId =
      text(
        input.actorId ??
          input.actor?.actorId ??
          input.actor?.userId ??
          input.requestedBy,
        this.config
          .maxActorIdLength,
      );

    const expectedVersion =
      input.expectedVersion ==
      null
        ? undefined
        : Number(
            input.expectedVersion,
          );

    if (
      expectedVersion !==
        undefined &&
      (
        !Number.isSafeInteger(
          expectedVersion,
        ) ||
        expectedVersion < 0 ||
        expectedVersion >
          this.config.maxVersion
      )
    ) {
      this.#throw(
        'expectedVersion must be a non-negative safe integer.',
        'STATE_MACHINE_INVALID_VERSION',
        {
          statusCode:
            422,
          tenantId,
        },
      );
    }

    return {
      ...input,

      tenantId,

      provider,

      operation,

      collectionId,

      transactionId,

      reference,

      originalIdempotencyKey,

      expectedIdempotencyKey,

      expectedFingerprint,

      financialFingerprint:
        expectedFingerprint,

      fromState,

      toState,

      action,

      actorId,

      expectedVersion,

      correlationId:
        text(
          input.correlationId,
          240,
        ),

      operationId:
        text(
          input.operationId,
          200,
        ),

      reason:
        text(
          input.reason,
          this.config
            .maxReasonLength,
        ),
    };
  }

  #assertMutationIdentity(
    context,
  ) {
    if (
      this.config
        .requireExpectedVersionForMutation &&
      context.expectedVersion ===
        undefined
    ) {
      this.#throw(
        'expectedVersion is required for state mutation.',
        'STATE_MACHINE_EXPECTED_VERSION_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (
      this.config
        .requireExpectedFingerprintForMutation &&
      !context.expectedFingerprint
    ) {
      this.#throw(
        'expectedFingerprint is required for state mutation.',
        'STATE_MACHINE_EXPECTED_FINGERPRINT_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (
      this.config
        .requireOriginalIdempotencyKeyForFinancialMutation &&
      !context.originalIdempotencyKey
    ) {
      this.#throw(
        'originalIdempotencyKey is required for collection financial state mutation.',
        'STATE_MACHINE_IDEMPOTENCY_KEY_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (
      this.config
        .requireExpectedIdempotencyKeyForMutation &&
      !context.expectedIdempotencyKey
    ) {
      this.#throw(
        'expectedIdempotencyKey is required for collection state mutation.',
        'STATE_MACHINE_EXPECTED_IDEMPOTENCY_KEY_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }
  }

  #assertTransition(
    context,
  ) {
    if (
      !isValidState(
        context.fromState,
      )
    ) {
      this.#throw(
        'fromState is invalid.',
        'STATE_MACHINE_INVALID_FROM_STATE',
        {
          statusCode:
            422,
          tenantId:
            context.tenantId,
          details: {
            fromState:
              context.fromState,
          },
        },
      );
    }

    if (
      !isValidState(
        context.toState,
      )
    ) {
      this.#throw(
        'toState is invalid.',
        'STATE_MACHINE_INVALID_TO_STATE',
        {
          statusCode:
            422,
          tenantId:
            context.tenantId,
          details: {
            toState:
              context.toState,
          },
        },
      );
    }

    if (
      context.fromState ===
      context.toState
    ) {
      if (
        !this.config
          .allowSameStateIdempotency
      ) {
        this.#throw(
          'Same-state transition is disabled.',
          'STATE_MACHINE_SAME_STATE_NOT_ALLOWED',
          {
            statusCode:
              409,
            tenantId:
              context.tenantId,
          },
        );
      }

      return;
    }

    if (
      !this.canTransition(
        context.fromState,
        context.toState,
        {
          action:
            context.action,
        },
      )
    ) {
      this.#throw(
        `Invalid collection transition ${context.fromState} -> ${context.toState}.`,
        'STATE_MACHINE_INVALID_TRANSITION',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          details: {
            fromState:
              context.fromState,
            toState:
              context.toState,
            action:
              context.action,
          },
        },
      );
    }
  }

  #assertSafety(
    context,
  ) {
    const evidenceOutcome =
      normalizeProviderOutcome(
        context.providerOutcome ??
          context.patch
            ?.providerOutcome,
      );

    const financialConfirmed =
      context.financialCoreConfirmed ===
        true ||
      context.settlementConfirmed ===
        true ||
      context.confirmed === true ||
      context.patch
        ?.financialCoreConfirmed ===
        true ||
      context.patch
        ?.settlementConfirmed ===
        true ||
      context.patch
        ?.settledAt !==
        undefined ||
      Boolean(
        context.patch
          ?.financialCoreReference,
      );

    if (
      isUncertainState(
        context.fromState,
      ) &&
      context.toState ===
        COLLECTION_STATES.APPROVED &&
      context.action ===
        ACTIONS.RETRY
    ) {
      this.#throw(
        'Ambiguous or pending collection cannot be retried before status/reconciliation.',
        'STATE_MACHINE_UNSAFE_RETRY',
        {
          statusCode:
            409,
          uncertain:
            true,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (
      context.fromState ===
        COLLECTION_STATES.FAILED &&
      context.toState ===
        COLLECTION_STATES.APPROVED &&
      context.action !==
        ACTIONS.RETRY
    ) {
      this.#throw(
        'FAILED -> APPROVED requires RETRY action.',
        'STATE_MACHINE_RETRY_ACTION_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.fromState ===
        COLLECTION_STATES.SUCCESS &&
      context.toState ===
        COLLECTION_STATES.REVERSED
    ) {
      if (
        context.action !==
        ACTIONS.REVERSE
      ) {
        this.#throw(
          'SUCCESS -> REVERSED requires explicit REVERSE action.',
          'STATE_MACHINE_REVERSAL_ACTION_REQUIRED',
          {
            statusCode:
              409,
            tenantId:
              context.tenantId,
          },
        );
      }

      const correctionKey =
        text(
          context.reversalIdempotencyKey ??
            context.compensationIdempotencyKey ??
            context.patch
              ?.reversalIdempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        );

      if (!correctionKey) {
        this.#throw(
          'SUCCESS -> REVERSED requires a distinct corrective/reversal idempotency identity.',
          'STATE_MACHINE_REVERSAL_IDEMPOTENCY_REQUIRED',
          {
            statusCode:
              422,
            tenantId:
              context.tenantId,
          },
        );
      }

      if (
        context.originalIdempotencyKey &&
        correctionKey ===
          context.originalIdempotencyKey
      ) {
        this.#throw(
          'Reversal idempotency identity must differ from the original collection identity.',
          'STATE_MACHINE_REVERSAL_IDEMPOTENCY_COLLISION',
          {
            statusCode:
              409,
            tenantId:
              context.tenantId,
          },
        );
      }
    }

    if (
      context.toState ===
      COLLECTION_STATES.SUCCESS
    ) {
      if (
        evidenceOutcome !==
          PROVIDER_OUTCOME.SUCCESS &&
        !financialConfirmed
      ) {
        this.#throw(
          'Airtel collection success requires confirmed provider or Financial Core evidence.',
          'STATE_MACHINE_SUCCESS_EVIDENCE_REQUIRED',
          {
            statusCode:
              409,
            retryable:
              true,
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
            details: {
              providerOutcome:
                evidenceOutcome,
            },
          },
        );
      }

      if (
        evidenceOutcome ===
          PROVIDER_OUTCOME.FAILURE ||
        evidenceOutcome ===
          PROVIDER_OUTCOME.REJECTED
      ) {
        this.#throw(
          'A failed/rejected provider outcome cannot transition to SUCCESS.',
          'STATE_MACHINE_CONTRADICTORY_OUTCOME',
          {
            statusCode:
              409,
            tenantId:
              context.tenantId,
          },
        );
      }
    }

    if (
      context.toState ===
        COLLECTION_STATES.PROVIDER_ACCEPTED &&
      evidenceOutcome !==
        PROVIDER_OUTCOME.SUCCESS &&
      !financialConfirmed
    ) {
      this.#throw(
        'PROVIDER_ACCEPTED requires successful provider evidence.',
        'STATE_MACHINE_PROVIDER_ACCEPTED_EVIDENCE_REQUIRED',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  #findMethod() {
    if (
      !this.repository
    ) {
      return null;
    }

    for (
      const name of [
        'findById',
        'findByCollectionId',
        'findByTransactionId',
        'findOne',
        'getById',
        'get',
      ]
    ) {
      if (
        isFunction(
          this.repository?.[
            name
          ],
        )
      ) {
        return {
          name,
          fn:
            this.repository[
              name
            ].bind(
              this.repository,
            ),
        };
      }
    }

    return null;
  }

  #transitionMethod() {
    if (
      !this.repository
    ) {
      return null;
    }

    for (
      const name of [
        'transitionCollection',
        'transition',
        'move',
        'transitionState',
        'updateStateAtomically',
      ]
    ) {
      if (
        isFunction(
          this.repository?.[
            name
          ],
        )
      ) {
        return {
          name,
          fn:
            this.repository[
              name
            ].bind(
              this.repository,
            ),
        };
      }
    }

    return null;
  }

  async #loadCurrent(
    context,
  ) {
    const method =
      this.#findMethod();

    if (!method) {
      return null;
    }

    let value;

    try {
      if (
        method.name ===
          'findById' ||
        method.name ===
          'getById'
      ) {
        value =
          await method.fn(
            context.collectionId,
            {
              tenantId:
                context.tenantId,
              provider:
                PROVIDER,
              operation:
                OPERATION,
            },
          );
      } else if (
        method.name ===
        'findByCollectionId'
      ) {
        value =
          await method.fn({
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            collectionId:
              context.collectionId,
          });
      } else if (
        method.name ===
        'findByTransactionId'
      ) {
        value =
          await method.fn({
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            transactionId:
              context.transactionId,
          });
      } else {
        value =
          await method.fn({
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            collectionId:
              context.collectionId,
            transactionId:
              context.transactionId,
          });
      }
    } catch (
      error
    ) {
      this.#throw(
        'Unable to read the current collection state.',
        'STATE_MACHINE_READ_FAILED',
        {
          statusCode:
            503,
          retryable:
            true,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
          cause:
            error,
        },
      );
    }

    return (
      value?.record ??
      value?.collection ??
      value?.transaction ??
      value ??
      null
    );
  }

  #normalizeRecord(
    record,
    context,
  ) {
    if (!record) {
      return null;
    }

    return {
      ...record,

      tenantId:
        record.tenantId ??
        context.tenantId,

      provider:
        upper(
          record.provider ??
            PROVIDER,
        ),

      operation:
        upper(
          record.operation ??
            OPERATION,
        ),

      collectionId:
        text(
          record.collectionId ??
            record.id ??
            context.collectionId,
          this.config
            .maxCollectionIdLength,
        ),

      transactionId:
        text(
          record.transactionId ??
            record.financialTransactionId ??
            context.transactionId,
          this.config
            .maxTransactionIdLength,
        ),

      reference:
        text(
          record.reference ??
            record.externalReference ??
            context.reference,
          this.config
            .maxReferenceLength,
        ),

      originalIdempotencyKey:
        text(
          record.originalIdempotencyKey ??
            record.idempotencyKey ??
            context.originalIdempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        ),

      financialFingerprint:
        text(
          record.financialFingerprint ??
            record.fingerprint ??
            context.expectedFingerprint,
          this.config
            .maxFingerprintLength,
        ),

      state:
        normalizeState(
          record.state ??
            record.status ??
            COLLECTION_STATES.DRAFT,
        ),

      status:
        normalizeState(
          record.status ??
            record.state ??
            COLLECTION_STATES.DRAFT,
        ),

      version:
        Number.isSafeInteger(
          Number(
            record.version ??
              record.__v ??
              0,
          ),
        )
          ? Number(
              record.version ??
                record.__v ??
                0,
            )
          : 0,
    };
  }

  #assertScope(
    record,
    context,
  ) {
    if (!record) {
      return;
    }

    if (
      context.tenantId &&
      record.tenantId &&
      String(
        context.tenantId,
      ) !==
        String(
          record.tenantId,
        )
    ) {
      this.#throw(
        'Collection belongs to another tenant.',
        'STATE_MACHINE_TENANT_SCOPE_MISMATCH',
        {
          statusCode:
            404,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (
      record.provider &&
      upper(
        record.provider,
      ) !== PROVIDER
    ) {
      this.#throw(
        'Collection provider scope mismatch.',
        'STATE_MACHINE_PROVIDER_SCOPE_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      record.operation &&
      upper(
        record.operation,
      ) !== OPERATION
    ) {
      this.#throw(
        'Collection operation scope mismatch.',
        'STATE_MACHINE_OPERATION_SCOPE_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.collectionId &&
      record.collectionId &&
      String(
        context.collectionId,
      ) !==
        String(
          record.collectionId,
        )
    ) {
      this.#throw(
        'Collection identity mismatch.',
        'STATE_MACHINE_COLLECTION_ID_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.transactionId &&
      record.transactionId &&
      String(
        context.transactionId,
      ) !==
        String(
          record.transactionId,
        )
    ) {
      this.#throw(
        'Transaction identity mismatch.',
        'STATE_MACHINE_TRANSACTION_ID_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.expectedFingerprint &&
      record.financialFingerprint &&
      context.expectedFingerprint !==
        record.financialFingerprint
    ) {
      this.#throw(
        'Collection financial fingerprint mismatch.',
        'STATE_MACHINE_FINANCIAL_FINGERPRINT_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.expectedIdempotencyKey &&
      record.originalIdempotencyKey &&
      context.expectedIdempotencyKey !==
        record.originalIdempotencyKey
    ) {
      this.#throw(
        'Collection original idempotency identity mismatch.',
        'STATE_MACHINE_IDEMPOTENCY_MISMATCH',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  #buildPatch(
    context,
    current,
  ) {
    const transitionFingerprint =
      sha256({
        schemaVersion:
          SCHEMA_VERSION,

        tenantId:
          context.tenantId,

        collectionId:
          context.collectionId,

        transactionId:
          context.transactionId,

        fromState:
          context.fromState,

        toState:
          context.toState,

        action:
          context.action,

        expectedVersion:
          context.expectedVersion,

        expectedFingerprint:
          context.expectedFingerprint,

        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,
      });

    const patch = {
      ...(
        isPlainObject(
          context.patch,
        )
          ? clone(
              context.patch,
            )
          : {}
      ),

      state:
        context.toState,

      status:
        context.toState,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      updatedAt:
        new Date(
          nowMs(
            this.clock,
          ),
        ),

      lastStateTransitionAt:
        new Date(
          nowMs(
            this.clock,
          ),
        ),

      lastTransitionAction:
        context.action,

      lastCorrelationId:
        context.correlationId,

      lastOperationId:
        context.operationId,

      financialFingerprint:
        context.expectedFingerprint ??
        current?.financialFingerprint,

      originalIdempotencyKey:
        context.originalIdempotencyKey ??
        current?.originalIdempotencyKey,
    };

    patch[
      `${context.toState.toLowerCase()}At`
    ] =
      new Date(
        nowMs(
          this.clock,
        ),
      );

    if (
      this.config
        .preserveTimeline
    ) {
      const timeline =
        Array.isArray(
          current?.transitionHistory,
        )
          ? [
              ...current.transitionHistory,
            ]
          : Array.isArray(
                current?.statusHistory,
              )
            ? [
                ...current.statusHistory,
              ]
            : [];

      timeline.push({
        eventId:
          this.idFactory(),

        timestamp:
          nowIso(
            this.clock,
          ),

        from:
          context.fromState,

        to:
          context.toState,

        state:
          context.toState,

        action:
          context.action,

        actorId:
          context.actorId,

        reason:
          context.reason,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        transitionFingerprint,
      });

      patch.transitionHistory =
        timeline.slice(
          -this.config
            .maxTimelineEntries,
        );
    }

    return {
      ...context,
      patch,
      transitionFingerprint,
    };
  }

  async #persist(
    context,
  ) {
    const method =
      this.#transitionMethod();

    if (
      !method &&
      this.config
        .requireAtomicTransition
    ) {
      this.#throw(
        'No atomic collection state-transition repository contract is available.',
        'STATE_MACHINE_ATOMIC_TRANSITION_UNAVAILABLE',
        {
          statusCode:
            503,
          retryable:
            true,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (!method) {
      return {
        ...context.patch,
        state:
          context.toState,
        status:
          context.toState,
        version:
          (
            context.expectedVersion ??
            0
          ) + 1,
      };
    }

    try {
      const result =
        await method.fn({
          collectionId:
            context.collectionId,

          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          fromState:
            context.fromState,

          toState:
            context.toState,

          action:
            context.action,

          expectedVersion:
            context.expectedVersion,

          expectedFingerprint:
            context.expectedFingerprint,

          financialFingerprint:
            context.expectedFingerprint,

          expectedIdempotencyKey:
            context.expectedIdempotencyKey,

          originalIdempotencyKey:
            context.originalIdempotencyKey,

          actorId:
            context.actorId,

          patch:
            context.patch,

          reason:
            context.reason,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          context,
        });

      const updated =
        result?.record ??
        result?.collection ??
        result?.transaction ??
        result;

      if (!updated) {
        this.#throw(
          'Atomic collection state transition was rejected by the repository.',
          'STATE_MACHINE_CONCURRENT_MODIFICATION',
          {
            statusCode:
              409,
            retryable:
              true,
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
          },
        );
      }

      return updated;
    } catch (
      error
    ) {
      if (
        error instanceof
        AirtelCollectionTransactionStateMachineError
      ) {
        throw error;
      }

      this.#throw(
        'Atomic collection state transition failed.',
        error?.code ??
          'STATE_MACHINE_TRANSITION_REPOSITORY_FAILED',
        {
          statusCode:
            Number(
              error?.statusCode ??
                error?.status,
            ) || 409,
          retryable:
            Boolean(
              error?.retryable,
            ),
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
          cause:
            error,
        },
      );
    }
  }

  async transition(
    input = {},
  ) {
    const context =
      this.#normalize(
        input,
      );

    let current =
      await this.#loadCurrent(
        context,
      );

    if (
      !current &&
      context.fromState
    ) {
      current = null;
    }

    if (
      !current &&
      !context.fromState
    ) {
      this.#throw(
        'Collection could not be located for state transition.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    if (current) {
      current =
        this.#normalizeRecord(
          current,
          context,
        );

      this.#assertScope(
        current,
        context,
      );

      if (
        !context.fromState
      ) {
        context.fromState =
          current.state;
      }

      if (
        context.expectedVersion ===
        undefined
      ) {
        context.expectedVersion =
          current.version;
      }

      if (
        !context.expectedFingerprint
      ) {
        context.expectedFingerprint =
          current.financialFingerprint;
      }

      if (
        !context.originalIdempotencyKey
      ) {
        context.originalIdempotencyKey =
          current.originalIdempotencyKey;
      }

      if (
        !context.expectedIdempotencyKey
      ) {
        context.expectedIdempotencyKey =
          current.originalIdempotencyKey;
      }
    }

    this.#assertMutationIdentity(
      context,
    );

    this.#assertTransition(
      context,
    );

    this.#assertSafety(
      context,
    );

    if (
      context.fromState ===
      context.toState
    ) {
      return {
        ...(current ?? {}),
        outcome:
          STATE_MACHINE_OUTCOMES.IDEMPOTENT,
        state:
          context.toState,
        status:
          context.toState,
        provider:
          PROVIDER,
        operation:
          OPERATION,
        tenantId:
          context.tenantId,
        collectionId:
          context.collectionId,
        transactionId:
          context.transactionId,
      };
    }

    const prepared =
      this.#buildPatch(
        context,
        current,
      );

    const updated =
      await this.#persist(
        prepared,
      );

    const result = {
      ...(
        isPlainObject(
          updated,
        )
          ? updated
          : {}
      ),

      outcome:
        STATE_MACHINE_OUTCOMES.TRANSITIONED,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        context.tenantId,

      collectionId:
        context.collectionId,

      transactionId:
        context.transactionId,

      state:
        normalizeState(
          updated?.state ??
            updated?.status ??
            context.toState,
        ),

      status:
        normalizeState(
          updated?.status ??
            updated?.state ??
            context.toState,
        ),

      version:
        Number.isSafeInteger(
          Number(
            updated?.version,
          ),
        )
          ? Number(
              updated.version,
            )
          : (
              context.expectedVersion ??
              0
            ) + 1,

      transitionFingerprint:
        prepared.transitionFingerprint,

      financialFingerprint:
        context.expectedFingerprint ??
        updated?.financialFingerprint,

      originalIdempotencyKey:
        context.originalIdempotencyKey ??
        updated?.originalIdempotencyKey,
    };

    await this.#audit(
      `COLLECTION_STATE_${context.toState}`,
      prepared,
      result,
    );

    await this.#publishEvent(
      `PAYMENT.AIRTEL.COLLECTION.${context.toState}`,
      prepared,
      result,
    );

    this.#metric(
      'titech.airtel.collection.state_machine.transition_total',
      {
        from:
          context.fromState,

        to:
          context.toState,

        action:
          context.action ??
          'UNSPECIFIED',
      },
    );

    return result;
  }

  async transitionCollection(
    input = {},
  ) {
    return this.transition(
      input,
    );
  }

  async move(
    input = {},
  ) {
    return this.transition(
      input,
    );
  }

  async transitionState(
    input = {},
  ) {
    return this.transition(
      input,
    );
  }

  supportsOperation(
    operation = OPERATION,
  ) {
    return (
      upper(operation) ===
      OPERATION
    );
  }

  getAllowedTransitions(
    state,
  ) {
    return [
      ...(
        this.transitions[
          normalizeState(
            state,
          )
        ] ?? []
      ),
    ];
  }

  canTransition(
    fromState,
    toState,
    options = {},
  ) {
    return canTransitionCollection(
      fromState,
      toState,
      options,
    );
  }

  isTerminal(state) {
    return isTerminalState(
      state,
    );
  }

  isUncertain(state) {
    return isUncertainState(
      state,
    );
  }

  isRetryable(state) {
    return isRetryableState(
      state,
    );
  }

  isExecutable(state) {
    return EXECUTABLE_COLLECTION_STATES.includes(
      normalizeState(
        state,
      ),
    );
  }

  async get(
    input = {},
  ) {
    const context =
      this.#normalize({
        ...input,
        provider:
          input.provider ??
          PROVIDER,
        operation:
          input.operation ??
          OPERATION,
      });

    const record =
      await this.#loadCurrent(
        context,
      );

    if (!record) {
      return null;
    }

    const normalized =
      this.#normalizeRecord(
        record,
        context,
      );

    this.#assertScope(
      normalized,
      context,
    );

    return normalized;
  }

  async find(
    input = {},
  ) {
    return this.get(
      input,
    );
  }

  async claimForExecution(
    input = {},
  ) {
    const context =
      this.#normalize({
        ...input,
        action:
          ACTIONS.EXECUTE,
        toState:
          COLLECTION_STATES.EXECUTING,
      });

    let current =
      await this.#loadCurrent(
        context,
      );

    if (!current) {
      this.#throw(
        'Collection could not be located for execution claim.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    current =
      this.#normalizeRecord(
        current,
        context,
      );

    this.#assertScope(
      current,
      context,
    );

    context.fromState =
      current.state;

    context.expectedVersion ??=
      current.version;

    context.expectedFingerprint ??=
      current.financialFingerprint;

    context.originalIdempotencyKey ??=
      current.originalIdempotencyKey;

    context.expectedIdempotencyKey ??=
      current.originalIdempotencyKey;

    if (
      context.fromState ===
      COLLECTION_STATES.EXECUTING
    ) {
      return {
        ...current,
        claimed:
          true,
        alreadyClaimed:
          true,
        outcome:
          STATE_MACHINE_OUTCOMES.ALREADY_CLAIMED,
      };
    }

    if (
      !this.isExecutable(
        context.fromState,
      )
    ) {
      this.#throw(
        'Collection is not executable from its current state.',
        'STATE_MACHINE_NOT_EXECUTABLE',
        {
          statusCode:
            409,
          tenantId:
            context.tenantId,
          details: {
            state:
              context.fromState,
          },
        },
      );
    }

    const result =
      await this.transition(
        context,
      );

    return {
      ...result,
      claimed:
        true,
      alreadyClaimed:
        false,
      outcome:
        STATE_MACHINE_OUTCOMES.CLAIMED,
    };
  }

  async claim(
    input = {},
  ) {
    return this.claimForExecution(
      input,
    );
  }

  async prepareRetry(
    input = {},
  ) {
    const context =
      this.#normalize({
        ...input,
        action:
          input.action ??
          ACTIONS.RETRY,
        toState:
          input.toState ??
          COLLECTION_STATES.APPROVED,
      });

    const current =
      await this.#loadCurrent(
        context,
      );

    if (!current) {
      this.#throw(
        'Collection could not be located for retry.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
        },
      );
    }

    const record =
      this.#normalizeRecord(
        current,
        context,
      );

    this.#assertScope(
      record,
      context,
    );

    const state =
      record.state;

    if (
      isUncertainState(
        state,
      )
    ) {
      this.#metric(
        'titech.airtel.collection.state_machine.unsafe_retry_prevented_total',
        {
          state,
        },
      );

      return {
        ...record,

        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_STATUS_CHECK,

        retryable:
          false,

        nextAction:
          RETRY_DECISIONS.RECONCILE,

        state,

        status:
          state,
      };
    }

    if (
      isTerminalState(
        state,
      ) &&
      state !==
        COLLECTION_STATES.FAILED
    ) {
      return {
        ...record,

        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_REVIEW,

        retryable:
          false,

        nextAction:
          RETRY_DECISIONS.STOP,

        state,

        status:
          state,
      };
    }

    if (
      !isRetryableState(
        state,
      )
    ) {
      return {
        ...record,

        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_REVIEW,

        retryable:
          false,

        nextAction:
          RETRY_DECISIONS.REVIEW,

        state,

        status:
          state,
      };
    }

    const result =
      await this.transition({
        ...context,

        collectionId:
          context.collectionId ??
          record.collectionId,

        transactionId:
          context.transactionId ??
          record.transactionId,

        reference:
          context.reference ??
          record.reference,

        originalIdempotencyKey:
          context.originalIdempotencyKey ??
          record.originalIdempotencyKey,

        expectedIdempotencyKey:
          context.expectedIdempotencyKey ??
          record.originalIdempotencyKey,

        expectedFingerprint:
          context.expectedFingerprint ??
          record.financialFingerprint,

        expectedVersion:
          context.expectedVersion ??
          record.version,

        fromState:
          state,

        toState:
          COLLECTION_STATES.APPROVED,

        action:
          ACTIONS.RETRY,

        patch: {
          retryAt:
            new Date(
              nowMs(
                this.clock,
              ),
            ),

          retryAttempts:
            Number(
              record.retryAttempts ??
                0,
            ) + 1,

          retryOf:
            record.collectionId ??
            record.transactionId,

          preserveFinancialIdentity:
            true,
        },
      });

    return {
      ...result,

      outcome:
        STATE_MACHINE_OUTCOMES.RETRY_READY,

      retryable:
        true,

      preserveFinancialIdentity:
        true,
    };
  }

  async retry(
    input = {},
  ) {
    return this.prepareRetry(
      input,
    );
  }

  async markProviderAccepted(
    input = {},
  ) {
    return this.#providerTransition(
      input,
      COLLECTION_STATES.PROVIDER_ACCEPTED,
      ACTIONS.MARK_PROVIDER_ACCEPTED,
      PROVIDER_OUTCOME.SUCCESS,
    );
  }

  async markProviderPending(
    input = {},
  ) {
    return this.#providerTransition(
      input,
      COLLECTION_STATES.PROVIDER_PENDING,
      ACTIONS.MARK_PROVIDER_PENDING,
      PROVIDER_OUTCOME.PENDING,
    );
  }

  async markProviderFailure(
    input = {},
  ) {
    return this.#providerTransition(
      input,
      COLLECTION_STATES.FAILED,
      ACTIONS.MARK_FAILED,
      PROVIDER_OUTCOME.FAILURE,
    );
  }

  async markProviderRejected(
    input = {},
  ) {
    return this.markProviderFailure({
      ...input,
      providerOutcome:
        PROVIDER_OUTCOME.REJECTED,
    });
  }

  async markProviderAmbiguous(
    input = {},
  ) {
    return this.#providerTransition(
      input,
      COLLECTION_STATES.AMBIGUOUS,
      ACTIONS.MARK_AMBIGUOUS,
      PROVIDER_OUTCOME.AMBIGUOUS,
      {
        uncertain:
          true,
        reconciliationRequired:
          true,
      },
    );
  }

  async markProviderSuccess(
    input = {},
  ) {
    const normalizedInput =
      this.#normalize({
        ...input,
        toState:
          COLLECTION_STATES.SUCCESS,
        action:
          ACTIONS.MARK_SUCCESS,
      });

    const current =
      await this.#loadCurrent(
        normalizedInput,
      );

    const base =
      current
        ? this.#normalizeRecord(
            current,
            normalizedInput,
          )
        : null;

    const confirmation =
      input.financialCoreConfirmed ===
        true ||
      input.settlementConfirmed ===
        true ||
      input.confirmed === true ||
      input.reconciled ===
        true;

    const providerOutcome =
      normalizeProviderOutcome(
        input.providerOutcome ??
          input.providerStatus ??
          input.outcome,
      );

    if (!base) {
      this.#throw(
        'Collection could not be located for provider-success transition.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            input.tenantId,
        },
      );
    }

    this.#assertScope(
      base,
      normalizedInput,
    );

    return this.transition({
      ...input,

      fromState:
        base.state,

      toState:
        COLLECTION_STATES.SUCCESS,

      action:
        ACTIONS.MARK_SUCCESS,

      expectedVersion:
        input.expectedVersion ??
        base.version,

      expectedFingerprint:
        input.expectedFingerprint ??
        base.financialFingerprint,

      originalIdempotencyKey:
        input.originalIdempotencyKey ??
        base.originalIdempotencyKey,

      expectedIdempotencyKey:
        input.expectedIdempotencyKey ??
        base.originalIdempotencyKey,

      providerOutcome,

      financialCoreConfirmed:
        confirmation,

      settlementConfirmed:
        confirmation,

      patch: {
        ...(input.patch ?? {}),

        providerOutcome,

        providerStatus:
          text(
            input.providerStatus,
            160,
          ),

        providerReference:
          text(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        financialCoreConfirmed:
          confirmation,

        settledAt:
          confirmation
            ? new Date(
                nowMs(
                  this.clock,
                ),
              )
            : undefined,
      },
    });
  }

  async #providerTransition(
    input,
    toState,
    action,
    defaultOutcome,
    patch = {},
  ) {
    const baseInput =
      this.#normalize({
        ...input,
        toState,
        action,
      });

    const current =
      await this.#loadCurrent(
        baseInput,
      );

    if (!current) {
      this.#throw(
        'Collection could not be located for provider outcome transition.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            baseInput.tenantId,
          correlationId:
            baseInput.correlationId,
          operationId:
            baseInput.operationId,
        },
      );
    }

    const record =
      this.#normalizeRecord(
        current,
        baseInput,
      );

    this.#assertScope(
      record,
      baseInput,
    );

    const providerOutcome =
      normalizeProviderOutcome(
        input.providerStatus ??
          input.providerOutcome ??
          input.outcome ??
          defaultOutcome,
      );

    return this.transition({
      ...input,

      fromState:
        record.state,

      toState,

      action,

      expectedVersion:
        input.expectedVersion ??
        record.version,

      expectedFingerprint:
        input.expectedFingerprint ??
        record.financialFingerprint,

      originalIdempotencyKey:
        input.originalIdempotencyKey ??
        record.originalIdempotencyKey,

      expectedIdempotencyKey:
        input.expectedIdempotencyKey ??
        record.originalIdempotencyKey,

      providerOutcome,

      patch: {
        ...(input.patch ?? {}),

        ...patch,

        providerOutcome,

        providerStatus:
          text(
            input.providerStatus,
            160,
          ),

        providerReference:
          text(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),
      },
    });
  }

  async requireReconciliation(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.RECONCILIATION_REQUIRED,
      ACTIONS.RECONCILE,
      {
        reconciliationRequired:
          true,

        reconciliationReason:
          text(
            input.reason,
            this.config
              .maxReasonLength,
          ),
      },
    );
  }

  async beginReconciliation(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.RECONCILING,
      ACTIONS.BEGIN_RECONCILIATION,
      {
        reconciliationStartedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async completeReconciliation(
    input = {},
  ) {
    const outcome =
      upper(
        input.reconciliationOutcome ??
          input.outcome ??
          input.status,
      );

    if (
      [
        'CONFIRMED_SUCCESS',
        'SUCCESS',
        'SETTLED',
      ].includes(
        outcome,
      )
    ) {
      return this.markProviderSuccess({
        ...input,
        providerOutcome:
          PROVIDER_OUTCOME.SUCCESS,
        financialCoreConfirmed:
          true,
        settlementConfirmed:
          true,
      });
    }

    if (
      [
        'CONFIRMED_FAILURE',
        'FAILURE',
        'FAILED',
        'REJECTED',
      ].includes(
        outcome,
      )
    ) {
      return this.markProviderFailure({
        ...input,
        providerOutcome:
          outcome === 'REJECTED'
            ? PROVIDER_OUTCOME.REJECTED
            : PROVIDER_OUTCOME.FAILURE,
      });
    }

    if (
      [
        'CONFLICT',
        'REPAIR_REQUIRED',
      ].includes(
        outcome,
      )
    ) {
      return this.requireReconciliation({
        ...input,

        reason:
          input.reason ??
          'Reconciliation conflict requires further review.',
      });
    }

    this.#throw(
      'Unsupported reconciliation outcome.',
      'STATE_MACHINE_RECONCILIATION_OUTCOME_INVALID',
      {
        statusCode:
          422,
        tenantId:
          input.tenantId,
        details: {
          reconciliationOutcome:
            outcome,
        },
      },
    );
  }

  async prepareCompensation(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.COMPENSATION_REQUIRED,
      ACTIONS.REQUIRE_COMPENSATION,
      {
        compensationRequired:
          true,

        compensationReason:
          text(
            input.reason,
            this.config
              .maxReasonLength,
          ),

        compensationIdempotencyKey:
          text(
            input.compensationIdempotencyKey ??
              input.compensationKey,
            this.config
              .maxIdempotencyKeyLength,
          ),
      },
    );
  }

  async startCompensation(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.COMPENSATING,
      ACTIONS.START_COMPENSATION,
      {
        compensationStartedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async completeCompensation(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.COMPENSATED,
      ACTIONS.COMPLETE_COMPENSATION,
      {
        compensationCompletedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async requireRefund(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.REFUND_REQUIRED,
      ACTIONS.REQUIRE_REFUND,
      {
        refundRequired:
          true,
      },
    );
  }

  async startRefund(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.REFUNDING,
      ACTIONS.START_REFUND,
      {
        refundStartedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async completeRefund(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.REFUNDED,
      ACTIONS.COMPLETE_REFUND,
      {
        refundCompletedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async reverse(
    input = {},
  ) {
    const correctionKey =
      text(
        input.reversalIdempotencyKey ??
          input.compensationIdempotencyKey ??
          input.compensationKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    if (!correctionKey) {
      this.#throw(
        'A distinct reversal idempotency key is required.',
        'STATE_MACHINE_REVERSAL_IDEMPOTENCY_REQUIRED',
        {
          statusCode:
            422,
          tenantId:
            input.tenantId,
        },
      );
    }

    if (
      input.originalIdempotencyKey &&
      correctionKey ===
        input.originalIdempotencyKey
    ) {
      this.#throw(
        'Reversal idempotency identity must differ from the original collection identity.',
        'STATE_MACHINE_REVERSAL_IDEMPOTENCY_COLLISION',
        {
          statusCode:
            409,
          tenantId:
            input.tenantId,
        },
      );
    }

    return this.#lifecycle(
      {
        ...input,

        reversalIdempotencyKey:
          correctionKey,

        patch: {
          ...(input.patch ?? {}),

          reversalIdempotencyKey:
            correctionKey,

          correctionIdentityHash:
            sha256(
              correctionKey,
            ),
        },
      },

      COLLECTION_STATES.REVERSED,

      ACTIONS.REVERSE,

      {
        reversedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async reverseCollection(
    input = {},
  ) {
    return this.reverse(
      input,
    );
  }

  async cancel(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.CANCELLED,
      ACTIONS.CANCEL,
      {
        cancelledAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async expire(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.EXPIRED,
      ACTIONS.EXPIRE,
      {
        expiredAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async reject(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.REJECTED,
      ACTIONS.REJECT,
      {
        rejectedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),
      },
    );
  }

  async escalate(
    input = {},
  ) {
    return this.#lifecycle(
      input,
      COLLECTION_STATES.ESCALATED,
      ACTIONS.ESCALATE,
      {
        escalatedAt:
          new Date(
            nowMs(
              this.clock,
            ),
          ),

        escalationReason:
          text(
            input.reason,
            this.config
              .maxReasonLength,
          ),
      },
    );
  }

  async #lifecycle(
    input,
    toState,
    action,
    patch = {},
  ) {
    const base =
      this.#normalize({
        ...input,
        toState,
        action,
      });

    const current =
      await this.#loadCurrent(
        base,
      );

    if (!current) {
      this.#throw(
        'Collection could not be located for lifecycle transition.',
        'STATE_MACHINE_COLLECTION_NOT_FOUND',
        {
          statusCode:
            404,
          tenantId:
            base.tenantId,
          correlationId:
            base.correlationId,
          operationId:
            base.operationId,
        },
      );
    }

    const record =
      this.#normalizeRecord(
        current,
        base,
      );

    this.#assertScope(
      record,
      base,
    );

    return this.transition({
      ...input,

      fromState:
        record.state,

      toState,

      action,

      expectedVersion:
        input.expectedVersion ??
        record.version,

      expectedFingerprint:
        input.expectedFingerprint ??
        record.financialFingerprint,

      originalIdempotencyKey:
        input.originalIdempotencyKey ??
        record.originalIdempotencyKey,

      expectedIdempotencyKey:
        input.expectedIdempotencyKey ??
        record.originalIdempotencyKey,

      patch: {
        ...(input.patch ?? {}),
        ...patch,
      },
    });
  }

  retryDecision(
    state,
  ) {
    const normalized =
      normalizeState(
        state,
      );

    if (
      isUncertainState(
        normalized,
      )
    ) {
      return RETRY_DECISIONS.RECONCILE;
    }

    if (
      isRetryableState(
        normalized,
      )
    ) {
      return RETRY_DECISIONS.RETRY;
    }

    if (
      isTerminalState(
        normalized,
      )
    ) {
      return RETRY_DECISIONS.STOP;
    }

    return RETRY_DECISIONS.REVIEW;
  }

  transitionContract() {
    return {
      module:
        MODULE_NAME,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      terminalStates:
        [
          ...TERMINAL_COLLECTION_STATES,
        ],

      uncertainStates:
        [
          ...UNCERTAIN_COLLECTION_STATES,
        ],

      retryableStates:
        [
          ...RETRYABLE_STATES,
        ],

      executableStates:
        [
          ...EXECUTABLE_COLLECTION_STATES,
        ],

      transitions:
        clone(
          ALLOWED_COLLECTION_TRANSITIONS,
        ),

      capabilities:
        this.capabilities(),

      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  capabilities() {
    return {
      ...CAPABILITIES,

      repositoryConfigured:
        Boolean(
          this.repository,
        ),

      atomicTransitionMethod:
        this.#transitionMethod()
          ?.name ??
        null,
    };
  }

  health() {
    const method =
      this.#transitionMethod();

    const healthy =
      Boolean(
        this.repository &&
        method,
      );

    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      healthy,

      ready:
        healthy,

      repository: {
        configured:
          Boolean(
            this.repository,
          ),

        atomicTransitionMethod:
          method?.name ??
          null,

        atomicRequired:
          this.config
            .requireAtomicTransition,
      },

      graph: {
        warnings:
          [
            ...TRANSITION_GRAPH_WARNINGS,
          ],

        canonicalWarnings:
          [
            ...CANONICAL_TRANSITION_WARNINGS,
          ],
      },

      capabilities:
        this.capabilities(),

      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  async readiness() {
    const h =
      this.health();

    return {
      ready:
        h.ready,

      status:
        h.status,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      missing:
        h.ready
          ? []
          : [
              ...(
                this.repository
                  ? []
                  : [
                      'repository',
                    ]
              ),

              ...(
                this.#transitionMethod()
                  ? []
                  : [
                      'atomicTransition',
                    ]
              ),
            ],

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  liveness() {
    return {
      alive:
        true,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      service:
        ENGINE_NAME,

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  diagnostics() {
    return {
      module:
        MODULE_NAME,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      configuration:
        sanitize(
          this.config,
          0,
          this.config,
        ),

      health:
        this.health(),

      capabilities:
        this.capabilities(),

      financialBoundary:
        FINANCIAL_BOUNDARY,

      transitionContract:
        this.transitionContract(),

      security: {
        tenantIsolation:
          true,

        optimisticConcurrency:
          true,

        expectedVersionGuard:
          this.config
            .requireExpectedVersionForMutation,

        expectedFingerprintGuard:
          this.config
            .requireExpectedFingerprintForMutation,

        expectedIdempotencyGuard:
          this.config
            .requireExpectedIdempotencyKeyForMutation,

        originalIdentityPreserved:
          true,

        ambiguousOutcomeBlindRetry:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,
      },
    };
  }

  snapshot() {
    return {
      timestamp:
        nowIso(
          this.clock,
        ),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      activeStates:
        [
          ...ACTIVE_COLLECTION_STATES,
        ],

      terminalStates:
        [
          ...TERMINAL_COLLECTION_STATES,
        ],

      uncertainStates:
        [
          ...UNCERTAIN_COLLECTION_STATES,
        ],

      capabilities:
        this.capabilities(),
    };
  }
}

// =============================================================================
// Factories / compatibility aliases
// =============================================================================

export function createCollectionTransactionStateMachine(
  options = {},
) {
  return new AirtelCollectionTransactionStateMachine(
    options,
  );
}

export function createAirtelCollectionTransactionStateMachine(
  options = {},
) {
  return createCollectionTransactionStateMachine(
    options,
  );
}

export function createTransactionStateMachine(
  options = {},
) {
  return createCollectionTransactionStateMachine(
    options,
  );
}

export const CollectionTransactionStateMachine =
  AirtelCollectionTransactionStateMachine;

export const TransactionStateMachine =
  AirtelCollectionTransactionStateMachine;

export const AirtelTransactionStateMachine =
  AirtelCollectionTransactionStateMachine;

export const DEFAULT_CONFIGURATION =
  DEFAULT_CONFIG;

export const constants =
  Object.freeze({
    PROVIDER,
    OPERATION,
    MODULE_NAME,
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    SCHEMA_VERSION,
    COLLECTION_STATES,
    TERMINAL_COLLECTION_STATES,
    ACTIVE_COLLECTION_STATES,
    UNCERTAIN_COLLECTION_STATES,
    EXECUTABLE_COLLECTION_STATES,
    PROVIDER_OUTCOME,
    ACTIONS,
    STATE_MACHINE_OUTCOMES,
    DEFAULT_CONFIG,
    FINANCIAL_BOUNDARY,
  });

export default AirtelCollectionTransactionStateMachine;