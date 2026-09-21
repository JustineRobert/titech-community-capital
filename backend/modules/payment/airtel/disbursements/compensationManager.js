'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Compensation Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/compensationManager.js
 *
 * Architectural role
 * ------------------
 * Controlled recovery/compensation orchestration boundary for Airtel outbound
 * disbursements. It creates deterministic recovery plans, enforces
 * reconciliation-first safety, manages an auditable compensation case lifecycle,
 * integrates maker-checker approval, and delegates any compensating financial
 * operation to the canonical Financial Core boundary.
 *
 * Responsibilities
 * ----------------
 * - Detect whether recovery requires reconciliation, compensation or review.
 * - Preserve original transaction and idempotency identity.
 * - Generate a distinct compensation-operation idempotency key for corrective
 *   financial operations (never a substitute for the original payment key).
 * - Prevent concurrent duplicate compensation with atomic repository claims.
 * - Revalidate the exact compensation plan immediately before execution.
 * - Enforce approval and reconciliation gates for consequential operations.
 * - Verify completion through Financial Core/reconciliation evidence.
 * - Emit sanitized audit evidence, domain events and metrics.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel API calls.
 * - No direct Mongo/Mongoose/Redis writes.
 * - No direct ledger/journal/balance mutation.
 * - No KYC/AML/sanctions/fraud source-of-truth decisions.
 * - No blind compensation for ambiguous provider outcomes.
 * - No deletion or rewriting of historical financial transactions.
 * - No assumption that local/offline state equals settlement.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Ambiguous provider result => status/reconciliation, not compensation.
 * 2. Provider success + internal discrepancy => reconciliation first.
 * 3. Original transaction identity stays immutable.
 * 4. A compensating financial operation has a different deterministic
 *    idempotency key and a direct link to the original transaction identity.
 * 5. Case execution is claim-based and optimistic-concurrency safe.
 * 6. Approval is bound to the exact compensation plan fingerprint.
 * 7. Completion requires authoritative financial verification.
 * 8. Audit/event envelopes never contain raw credentials/provider payloads.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-disbursement-compensation-manager';
export const ENGINE_VERSION = '2.1.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const OPERATION = 'DISBURSEMENT';
export const SCHEMA_VERSION = 1;

export const COMPENSATION_TYPES = Object.freeze({
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  REVERSAL: 'REVERSAL',
  REFUND: 'REFUND',
  CORRECTION: 'CORRECTION',
  RECONCILIATION_REPAIR: 'RECONCILIATION_REPAIR',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  NO_ACTION: 'NO_ACTION',
});

export const CASE_STATES = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  READY_FOR_COMPENSATION: 'READY_FOR_COMPENSATION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
});

export const CASE_OUTCOMES = Object.freeze({
  NO_ACTION: 'NO_ACTION',
  RECONCILE: 'RECONCILE',
  READY: 'READY',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ESCALATED: 'ESCALATED',
  REPLAY: 'REPLAY',
  STALE: 'STALE',
  PENDING: 'PENDING',
});

export const PROVIDER_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  AMBIGUOUS: 'AMBIGUOUS',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
});

export const RECONCILIATION_STATES = Object.freeze({
  CONFIRMED_SUCCESS: 'CONFIRMED_SUCCESS',
  CONFIRMED_FAILURE: 'CONFIRMED_FAILURE',
  PENDING: 'PENDING',
  AMBIGUOUS: 'AMBIGUOUS',
  NOT_RUN: 'NOT_RUN',
  CONFLICT: 'CONFLICT',
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',
});

export const FINANCIAL_EXECUTION_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  RESERVED: 'RESERVED',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  POSTED: 'POSTED',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
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

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

const TERMINAL = new Set([
  CASE_STATES.COMPLETED,
  CASE_STATES.FAILED,
  CASE_STATES.CANCELLED,
  CASE_STATES.SUPERSEDED,
]);

const TRANSITIONS = Object.freeze({
  DISCOVERED: new Set([
    'REQUIRES_RECONCILIATION',
    'READY_FOR_COMPENSATION',
    'PENDING_APPROVAL',
    'CANCELLED',
    'ESCALATED',
  ]),
  REQUIRES_RECONCILIATION: new Set([
    'READY_FOR_COMPENSATION',
    'PENDING_APPROVAL',
    'ESCALATED',
    'CANCELLED',
  ]),
  READY_FOR_COMPENSATION: new Set([
    'PENDING_APPROVAL',
    'APPROVED',
    'EXECUTING',
    'CANCELLED',
    'ESCALATED',
  ]),
  PENDING_APPROVAL: new Set([
    'APPROVED',
    'CANCELLED',
    'ESCALATED',
    'SUPERSEDED',
  ]),
  APPROVED: new Set([
    'EXECUTING',
    'CANCELLED',
    'SUPERSEDED',
  ]),
  EXECUTING: new Set([
    'VERIFYING',
    'FAILED',
    'ESCALATED',
  ]),
  VERIFYING: new Set([
    'COMPLETED',
    'FAILED',
    'ESCALATED',
  ]),
  COMPLETED: new Set(),
  FAILED: new Set([
    'ESCALATED',
  ]),
  ESCALATED: new Set([
    'READY_FOR_COMPENSATION',
    'PENDING_APPROVAL',
    'CANCELLED',
    'SUPERSEDED',
  ]),
  CANCELLED: new Set(),
  SUPERSEDED: new Set(),
});

const DEFAULTS = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requireReference: true,
  requireTransactionIdentity: true,
  requireOriginalIdempotencyKey: true,
  requireAmountMinor: false,
  requireCurrency: false,

  rejectUnresolvedOfflineStates: true,

  requireReconciliationForAmbiguous: true,
  requireReconciliationForProviderSuccess: true,
  requireFinancialCoreVerification: true,

  requireApprovalForReversal: true,
  requireApprovalForRefund: true,
  requireApprovalForCorrection: true,
  requireApprovalForReleaseReservation: false,

  defaultTtlMs: 30 * 60 * 1000,
  minTtlMs: 60 * 1000,
  maxTtlMs: 7 * 24 * 60 * 60 * 1000,

  maxCaseIdLength: 160,
  maxTenantIdLength: 160,
  maxReferenceLength: 240,
  maxTransactionIdLength: 240,
  maxIdempotencyKeyLength: 240,
  maxReasonLength: 2000,
  maxErrorCodeLength: 160,

  maxMetadataDepth: 5,
  maxMetadataKeys: 70,
  maxMetadataArray: 50,
  maxMetadataStringLength: 500,

  failClosedOnPersistenceError: true,
  failClosedOnApprovalError: true,
  failClosedOnFinancialCoreError: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,

  compensationProviderOperation: 'AIRTEL_COMPENSATION',

  eventTypePrefix:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION',
});

const SENSITIVE =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload)/i;

const PROTOTYPE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const RISK_RANK = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const isObject = (v) =>
  v !== null &&
  typeof v === 'object';

const isPlainObject = (v) =>
  isObject(v) &&
  !Array.isArray(v) &&
  !(v instanceof Date);

const isFn = (v) =>
  typeof v === 'function';

const upper = (v) => {
  if (v === undefined || v === null) {
    return undefined;
  }

  const s = String(v).trim();

  return s
    ? s.toUpperCase()
    : undefined;
};

const str = (v, n = 240) => {
  if (v === undefined || v === null) {
    return undefined;
  }

  const s = String(v).trim();

  return s
    ? s.slice(0, n)
    : undefined;
};

const clone = (v) =>
  v === undefined
    ? undefined
    : JSON.parse(JSON.stringify(v));

const nowMs = (clock) => {
  try {
    const v = clock?.now?.();

    return Number.isFinite(v)
      ? v
      : Date.now();
  } catch {
    return Date.now();
  }
};

const nowIso = (clock) =>
  new Date(
    nowMs(clock),
  ).toISOString();

const actorIdOf = (actor) =>
  str(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    160,
  );

const riskMax = (...values) =>
  values
    .map(upper)
    .filter(Boolean)
    .reduce(
      (max, v) =>
        (RISK_RANK[v] ?? 0) >
        (RISK_RANK[max] ?? 0)
          ? v
          : max,
      RISK_LEVELS.LOW,
    );

const intString = (v) => {
  if (v === undefined || v === null) {
    return undefined;
  }

  const s = String(v).trim();

  if (!/^\d+$/.test(s)) {
    return undefined;
  }

  return (
    s.replace(/^0+(?=\d)/, '') ||
    '0'
  );
};

const compareInts = (a, b) => {
  const x = intString(a);
  const y = intString(b);

  if (
    x === undefined ||
    y === undefined
  ) {
    return null;
  }

  if (x.length !== y.length) {
    return x.length > y.length
      ? 1
      : -1;
  }

  return x === y
    ? 0
    : x > y
      ? 1
      : -1;
};

const stable = (v) => {
  if (v === undefined) {
    return 'undefined';
  }

  if (v === null) {
    return 'null';
  }

  if (v instanceof Date) {
    return `date:${v.toISOString()}`;
  }

  if (typeof v === 'bigint') {
    return `bigint:${v}`;
  }

  if (Array.isArray(v)) {
    return `[${v
      .map(stable)
      .join(',')}]`;
  }

  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(
            k,
          )}:${stable(v[k])}`,
      )
      .join(',')}}`;
  }

  if (
    typeof v === 'number' &&
    Object.is(v, -0)
  ) {
    return '0';
  }

  return JSON.stringify(v);
};

const sha256 = (v) =>
  createHash('sha256')
    .update(
      typeof v === 'string'
        ? v
        : stable(v),
    )
    .digest('hex');

const sanitize = (
  value,
  path = '',
  depth = 0,
  limits = {},
) => {
  const maxDepth =
    limits.maxDepth ?? 5;

  const maxKeys =
    limits.maxKeys ?? 70;

  const maxArray =
    limits.maxArray ?? 50;

  const maxStringLength =
    limits.maxStringLength ?? 500;

  if (depth > maxDepth) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? `${value.slice(
          0,
          maxStringLength,
        )}…`
      : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArray)
      .map((x, i) =>
        sanitize(
          x,
          `${path}[${i}]`,
          depth + 1,
          limits,
        ),
      );
  }

  const out = {};

  for (
    const key of Object.keys(
      value,
    ).slice(0, maxKeys)
  ) {
    if (
      PROTOTYPE_KEYS.has(key)
    ) {
      continue;
    }

    out[key] =
      SENSITIVE.test(key)
        ? '[REDACTED]'
        : sanitize(
            value[key],
            path
              ? `${path}.${key}`
              : key,
            depth + 1,
            limits,
          );
  }

  return out;
};

export class AirtelCompensationError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);

    this.name =
      'AirtelCompensationError';

    this.code = code;

    this.component = COMPONENT;

    this.provider = PROVIDER;

    this.operation = OPERATION;

    this.details =
      sanitize(details);

    this.retryable =
      Boolean(options.retryable);

    this.httpStatus =
      options.httpStatus ?? 400;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      component: this.component,
      provider: this.provider,
      operation: this.operation,
      details: this.details,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
    };
  }
}

export const canTransition = (
  from,
  to,
) =>
  Boolean(
    TRANSITIONS[
      upper(from)
    ]?.has(
      upper(to),
    ),
  );

export const isCompensationTerminal = (
  state,
) =>
  TERMINAL.has(
    upper(state),
  );

export const compensationFingerprint = (
  input = {},
) =>
  sha256({
    schemaVersion:
      SCHEMA_VERSION,

    tenantId:
      str(
        input.tenantId,
        160,
      ),

    provider:
      PROVIDER,

    operation:
      OPERATION,

    reference:
      str(
        input.reference,
      ),

    transactionId:
      str(
        input.transactionId,
      ),

    originalIdempotencyKeyHash:
      input.originalIdempotencyKey
        ? sha256(
            input.originalIdempotencyKey,
          )
        : undefined,

    compensationType:
      upper(
        input.compensationType,
      ),

    amountMinor:
      intString(
        input.amountMinor,
      ),

    currency:
      upper(
        input.currency,
      ),

    reasonCode:
      str(
        input.reasonCode,
        160,
      ),

    providerOutcome:
      upper(
        input.providerOutcome ??
          input.outcome,
      ),

    financialExecutionState:
      upper(
        input.financialExecutionState ??
          input.financialState,
      ),

    reconciliationState:
      upper(
        input.reconciliationState ??
          input.reconciliation?.state,
      ),

    originalScopeFingerprint:
      str(
        input.originalScopeFingerprint ??
          input.scopeFingerprint,
        128,
      ),

    reconciliationFingerprint:
      str(
        input.reconciliationFingerprint ??
          input.reconciliation?.fingerprint,
        128,
      ),

    policyVersion:
      str(
        input.policyVersion,
        120,
      ),
  });

export const compensationIdempotencyKey = (
  input = {},
) => {
  const tenant =
    str(
      input.tenantId,
      160,
    ) ??
    'unknown-tenant';

  const original =
    input.originalIdempotencyKey ??
    input.transactionId ??
    input.reference ??
    'unknown';

  const type =
    upper(
      input.compensationType,
    ) ??
    COMPENSATION_TYPES.CORRECTION;

  return `${tenant}:airtel:compensation:${type}:${sha256(
    original,
  ).slice(
    0,
    40,
  )}:${compensationFingerprint(
    input,
  )}`;
};

const providerOutcome = (
  ctx,
) =>
  upper(
    ctx.providerOutcome ??
      ctx.outcome,
  );

const financialState = (
  ctx,
) =>
  upper(
    ctx.financialExecutionState ??
      ctx.financialState,
  );

const reconcileState = (
  ctx,
) =>
  upper(
    ctx.reconciliationState ??
      ctx.reconciliation?.state,
  );

const offlineState = (
  ctx,
) =>
  upper(
    ctx.offlineState ??
      ctx.syncState,
  );

const ambiguous = (v) =>
  [
    'AMBIGUOUS',
    'PENDING',
    'UNKNOWN',
    'TIMEOUT',
    'NETWORK_UNKNOWN',
    'UNKNOWN_OUTCOME',
  ].includes(
    upper(v),
  );

const succeeded = (v) =>
  [
    'SUCCESS',
    'SUCCEEDED',
    'SUCCESSFUL',
    'COMPLETED',
    'SETTLED',
  ].includes(
    upper(v),
  );

const failed = (v) =>
  [
    'FAILURE',
    'FAILED',
    'REJECTED',
    'DECLINED',
    'DENIED',
  ].includes(
    upper(v),
  );

const requiresApproval = (
  type,
  config,
) =>
  ({
    [COMPENSATION_TYPES.REVERSAL]:
      config.requireApprovalForReversal,

    [COMPENSATION_TYPES.REFUND]:
      config.requireApprovalForRefund,

    [COMPENSATION_TYPES.CORRECTION]:
      config.requireApprovalForCorrection,

    [COMPENSATION_TYPES.RELEASE_RESERVATION]:
      config.requireApprovalForReleaseReservation,
  }[
    upper(type)
  ] ?? false);

const inferCompensationType = (
  ctx,
) => {
  const explicit =
    upper(
      ctx.compensationType ??
        ctx.requestedCompensationType,
    );

  if (explicit) {
    return explicit;
  }

  if (
    ctx.reservationId &&
    failed(
      providerOutcome(ctx),
    ) &&
    [
      undefined,
      'FAILED',
      'NOT_STARTED',
    ].includes(
      financialState(ctx),
    )
  ) {
    return COMPENSATION_TYPES.RELEASE_RESERVATION;
  }

  if (ctx.refundRequired) {
    return COMPENSATION_TYPES.REFUND;
  }

  return COMPENSATION_TYPES.RECONCILIATION_REPAIR;
};

const normalizeInput = (
  input,
  config,
) => {
  if (!isPlainObject(input)) {
    throw new AirtelCompensationError(
      'INVALID_INPUT',
      'Compensation input must be an object.',
    );
  }

  const ctx = sanitize(
    clone(input),
    'context',
    0,
    config,
  );

  const tenantId =
    str(
      ctx.tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.requireTenantId &&
    !tenantId
  ) {
    throw new AirtelCompensationError(
      'TENANT_REQUIRED',
      'tenantId is required for Airtel compensation governance.',
    );
  }

  const provider =
    upper(
      ctx.provider ??
        PROVIDER,
    );

  if (
    config.enforceAirtelProvider &&
    provider !== PROVIDER
  ) {
    throw new AirtelCompensationError(
      'PROVIDER_SCOPE_VIOLATION',
      'This compensation manager is scoped to Airtel disbursements.',
      { provider },
      { httpStatus: 409 },
    );
  }

  const reference =
    str(
      ctx.reference ??
        ctx.paymentReference,
      config.maxReferenceLength,
    );

  if (
    config.requireReference &&
    !reference
  ) {
    throw new AirtelCompensationError(
      'REFERENCE_REQUIRED',
      'A stable disbursement reference is required for compensation.',
    );
  }

  const transactionId =
    str(
      ctx.transactionId ??
        ctx.paymentId,
      config.maxTransactionIdLength,
    );

  if (
    config.requireTransactionIdentity &&
    !transactionId
  ) {
    throw new AirtelCompensationError(
      'TRANSACTION_ID_REQUIRED',
      'transactionId or paymentId is required for compensation.',
    );
  }

  const originalIdempotencyKey =
    str(
      ctx.originalIdempotencyKey ??
        ctx.idempotencyKey,
      config.maxIdempotencyKeyLength,
    );

  if (
    config.requireOriginalIdempotencyKey &&
    !originalIdempotencyKey
  ) {
    throw new AirtelCompensationError(
      'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
      'Original financial idempotency key is required.',
    );
  }

  const amountMinor =
    intString(
      ctx.amountMinor ??
        ctx.amountInMinorUnits,
    );

  if (
    config.requireAmountMinor &&
    !amountMinor
  ) {
    throw new AirtelCompensationError(
      'AMOUNT_MINOR_REQUIRED',
      'amountMinor is required.',
    );
  }

  const currency =
    upper(
      ctx.currency,
    );

  if (
    config.requireCurrency &&
    !currency
  ) {
    throw new AirtelCompensationError(
      'CURRENCY_REQUIRED',
      'currency is required.',
    );
  }

  const oState =
    offlineState(ctx);

  if (
    config.rejectUnresolvedOfflineStates &&
    [
      'LOCAL_ONLY',
      'PENDING_SYNC',
      'SYNCING',
      'SERVER_REJECTED',
      'CONFLICT',
      'REQUIRES_REVIEW',
    ].includes(oState)
  ) {
    throw new AirtelCompensationError(
      'OFFLINE_OPERATION_REQUIRES_REVIEW',
      'Compensation cannot execute while the underlying operation remains in an unresolved offline state.',
      {
        offlineState:
          oState,
      },
      {
        httpStatus: 409,
      },
    );
  }

  return {
    ...ctx,

    tenantId,

    provider,

    reference,

    transactionId,

    originalIdempotencyKey,

    amountMinor,

    currency,

    providerOutcome:
      providerOutcome(ctx),

    financialExecutionState:
      financialState(ctx),

    reconciliationState:
      reconcileState(ctx),

    offlineState:
      oState,

    compensationType:
      inferCompensationType(ctx),

    reasonCode:
      str(
        ctx.reasonCode ??
          ctx.reason,
        160,
      ),

    policyVersion:
      str(
        ctx.policyVersion,
        120,
      ),

    metadata:
      sanitize(
        ctx.metadata ?? {},
        'metadata',
        0,
        config,
      ),
  };
};

const disposition = (
  ctx,
  config,
) => {
  const recon =
    ctx.reconciliation &&
    isPlainObject(
      ctx.reconciliation,
    )
      ? ctx.reconciliation
      : null;

  const reconKnownSuccess =
    Boolean(
      recon?.knownSuccess ??
        recon?.confirmedSuccess ??
        recon?.financialPosted,
    );

  const reconKnownFailure =
    Boolean(
      recon?.knownFailure ??
        recon?.confirmedFailure,
    );

  const reconConflict =
    Boolean(
      recon?.conflict ??
        recon?.mismatch ??
        recon?.repairRequired,
    );

  const rs =
    reconcileState(ctx);

  if (
    reconConflict ||
    [
      'CONFLICT',
      'REPAIR_REQUIRED',
    ].includes(rs)
  ) {
    return {
      outcome:
        CASE_OUTCOMES.RECONCILE,

      state:
        CASE_STATES.REQUIRES_RECONCILIATION,

      code:
        'RECONCILIATION_REPAIR_REQUIRED',

      reason:
        'Authoritative reconciliation requires financial repair before compensation.',

      type:
        COMPENSATION_TYPES.RECONCILIATION_REPAIR,

      riskLevel:
        RISK_LEVELS.HIGH,
    };
  }

  if (
    ambiguous(
      providerOutcome(ctx),
    )
  ) {
    return {
      outcome:
        CASE_OUTCOMES.RECONCILE,

      state:
        CASE_STATES.REQUIRES_RECONCILIATION,

      code:
        'AMBIGUOUS_PROVIDER_OUTCOME',

      reason:
        'Underlying Airtel outcome is ambiguous; status/reconciliation is required before compensation.',

      type:
        COMPENSATION_TYPES.RECONCILIATION_REPAIR,

      riskLevel:
        RISK_LEVELS.CRITICAL,
    };
  }

  if (
    succeeded(
      providerOutcome(ctx),
    ) &&
    config.requireReconciliationForProviderSuccess &&
    !reconKnownSuccess &&
    rs !==
      RECONCILIATION_STATES.CONFIRMED_SUCCESS
  ) {
    return {
      outcome:
        CASE_OUTCOMES.RECONCILE,

      state:
        CASE_STATES.REQUIRES_RECONCILIATION,

      code:
        'SUCCESS_REQUIRES_RECONCILIATION',

      reason:
        'Provider success must be reconciled with Financial Core before corrective action.',

      type:
        COMPENSATION_TYPES.RECONCILIATION_REPAIR,

      riskLevel:
        RISK_LEVELS.HIGH,
    };
  }

  if (
    failed(
      providerOutcome(ctx),
    ) &&
    !financialState(ctx) &&
    !recon
  ) {
    return {
      outcome:
        CASE_OUTCOMES.RECONCILE,

      state:
        CASE_STATES.REQUIRES_RECONCILIATION,

      code:
        'FINANCIAL_STATE_REQUIRED',

      reason:
        'Provider failure alone is insufficient to establish a safe compensation operation.',

      type:
        COMPENSATION_TYPES.RECONCILIATION_REPAIR,

      riskLevel:
        RISK_LEVELS.HIGH,
    };
  }

  const type =
    ctx.compensationType;

  const approval =
    requiresApproval(
      type,
      config,
    );

  if (
    type ===
      COMPENSATION_TYPES.REVERSAL &&
    reconKnownSuccess
  ) {
    return {
      outcome:
        CASE_OUTCOMES.READY,

      state:
        approval
          ? CASE_STATES.PENDING_APPROVAL
          : CASE_STATES.READY_FOR_COMPENSATION,

      code:
        'REVERSAL_READY',

      reason:
        'Authoritative financial evidence supports a governed reversal.',

      type,

      riskLevel:
        RISK_LEVELS.HIGH,

      requiresApproval:
        approval,
    };
  }

  if (
    type ===
      COMPENSATION_TYPES.RELEASE_RESERVATION &&
    failed(
      providerOutcome(ctx),
    ) &&
    [
      'NOT_STARTED',
      'FAILED',
    ].includes(
      financialState(ctx),
    )
  ) {
    return {
      outcome:
        CASE_OUTCOMES.READY,

      state:
        approval
          ? CASE_STATES.PENDING_APPROVAL
          : CASE_STATES.READY_FOR_COMPENSATION,

      code:
        'RESERVATION_RELEASE_READY',

      reason:
        'Confirmed provider failure and non-settled financial state permit reservation release.',

      type,

      riskLevel:
        RISK_LEVELS.MEDIUM,

      requiresApproval:
        approval,
    };
  }

  if (
    [
      COMPENSATION_TYPES.REFUND,
      COMPENSATION_TYPES.CORRECTION,
    ].includes(type)
  ) {
    return {
      outcome:
        CASE_OUTCOMES.READY,

      state:
        approval
          ? CASE_STATES.PENDING_APPROVAL
          : CASE_STATES.READY_FOR_COMPENSATION,

      code:
        `${type}_READY`,

      reason:
        `A governed ${type.toLowerCase()} operation is ready for execution.`,

      type,

      riskLevel:
        RISK_LEVELS.HIGH,

      requiresApproval:
        approval,
    };
  }

  return {
    outcome:
      CASE_OUTCOMES.RECONCILE,

    state:
      CASE_STATES.REQUIRES_RECONCILIATION,

    code:
      'COMPENSATION_NOT_YET_SAFE',

    reason:
      'Current evidence is insufficient to establish a safe compensating financial operation.',

    type:
      COMPENSATION_TYPES.RECONCILIATION_REPAIR,

    riskLevel:
      RISK_LEVELS.HIGH,

    requiresApproval:
      false,
  };
};

export class AirtelDisbursementCompensationManager {
  constructor(
    options = {},
  ) {
    this.config =
      Object.freeze({
        ...DEFAULTS,
        ...(
          options.config ??
          options.configuration ??
          {}
        ),
      });

    this.repository =
      options.repository ??
      options.compensationRepository ??
      options.store ??
      null;

    this.stateMachine =
      options.stateMachine ??
      options.transactionStateMachine ??
      null;

    this.financialCore =
      options.financialCore ??
      options.financialService ??
      null;

    this.ledgerBridge =
      options.ledgerBridge ??
      null;

    this.reconciliation =
      options.reconciliation ??
      options.reconciliationService ??
      null;

    this.approvalWorkflow =
      options.approvalWorkflow ??
      null;

    this.policyEngine =
      options.policyEngine ??
      options.policy ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
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
      options.idFactory ??
      (() => randomUUID());
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelCompensationError(
      code,
      message,
      details,
      options,
    );
  }

  #limits() {
    return {
      maxDepth:
        this.config
          .maxMetadataDepth,

      maxKeys:
        this.config
          .maxMetadataKeys,

      maxArray:
        this.config
          .maxMetadataArray,

      maxStringLength:
        this.config
          .maxMetadataStringLength,
    };
  }

  #repo(...names) {
    for (
      const name of names
    ) {
      const fn =
        this.repository?.[name];

      if (isFn(fn)) {
        return fn.bind(
          this.repository,
        );
      }
    }

    return null;
  }

  #requireRepo(
    names,
    message,
  ) {
    const fn =
      this.#repo(...names);

    if (fn) {
      return fn;
    }

    if (
      this.config
        .failClosedOnPersistenceError
    ) {
      this.#throw(
        'COMPENSATION_REPOSITORY_UNAVAILABLE',
        message,
        { names },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    return null;
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
        isFn(fn)
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
              'log',
              0,
              this.#limits(),
            ),
          },
          message,
        );
      }
    } catch {
      // Logging must never modify financial recovery decisions.
    }
  }

  #metric(
    name,
    labels = {},
  ) {
    try {
      const fn =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (
        isFn(fn)
      ) {
        fn.call(
          this.metrics,
          name,
          sanitize(
            labels,
          ),
        );
      }
    } catch {
      // Observability is non-authoritative.
    }
  }

  #auditPayload(
    action,
    record,
    extra = {},
  ) {
    const payload = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      action,

      caseId:
        record?.caseId,

      tenantId:
        record?.tenantId,

      state:
        record?.state,

      outcome:
        record?.outcome,

      compensationType:
        record?.compensationType,

      reference:
        record?.reference,

      transactionId:
        record?.transactionId,

      amountMinor:
        record?.amountMinor,

      currency:
        record?.currency,

      originalIdempotencyKeyHash:
        record?.originalIdempotencyKey
          ? sha256(
              record.originalIdempotencyKey,
            )
          : undefined,

      compensationIdempotencyKey:
        record?.compensationIdempotencyKey,

      planFingerprint:
        record?.planFingerprint,

      riskLevel:
        record?.riskLevel,

      extra:
        sanitize(
          extra,
          'extra',
          0,
          this.#limits(),
        ),

      occurredAt:
        nowIso(this.clock),
    };

    return {
      ...payload,
      auditFingerprint:
        sha256(payload),
    };
  }

  async #audit(
    action,
    record,
    extra = {},
  ) {
    const fn =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write;

    if (!isFn(fn)) {
      return null;
    }

    try {
      return await fn.call(
        this.auditService,
        this.#auditPayload(
          action,
          record,
          extra,
        ),
      );
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation audit write failed.',
        {
          action,
          caseId:
            record?.caseId,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          'COMPENSATION_AUDIT_UNAVAILABLE',
          'Compensation audit boundary is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }
  }

  async #event(
    type,
    record,
    payload = {},
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (!isFn(fn)) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),

      type:
        `${this.config.eventTypePrefix}.${type}`,

      occurredAt:
        nowIso(this.clock),

      tenantId:
        record?.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      caseId:
        record?.caseId,

      state:
        record?.state,

      outcome:
        record?.outcome,

      compensationType:
        record?.compensationType,

      reference:
        record?.reference,

      planFingerprint:
        record?.planFingerprint,

      payload:
        sanitize(
          payload,
          'payload',
          0,
          this.#limits(),
        ),
    };

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
        'Airtel compensation event publication failed.',
        {
          type,
          caseId:
            record?.caseId,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          'COMPENSATION_EVENT_UNAVAILABLE',
          'Compensation event boundary is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }
  }

  async #policy(
    context,
    plan,
    action,
  ) {
    if (
      !this.policyEngine
    ) {
      return {
        decision:
          'NO_POLICY',

        requiresApproval:
          plan.requiresApproval ??
          false,

        riskLevel:
          plan.riskLevel,

        source:
          'CONFIGURATION',
      };
    }

    const fn =
      this.policyEngine
        .evaluateCompensation ??
      this.policyEngine.evaluate ??
      this.policyEngine.assess;

    if (!isFn(fn)) {
      if (
        this.config
          .failClosedOnFinancialCoreError
      ) {
        this.#throw(
          'COMPENSATION_POLICY_CONTRACT_INVALID',
          'Configured compensation policy engine is invalid.',
          {},
          {
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'REQUIRE_REVIEW',

        requiresApproval:
          true,

        riskLevel:
          riskMax(
            plan.riskLevel,
            RISK_LEVELS.HIGH,
          ),

        source:
          'POLICY_CONTRACT_MISSING',
      };
    }

    try {
      return sanitize(
        await fn.call(
          this.policyEngine,
          {
            action,
            component:
              COMPONENT,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            tenantId:
              context.tenantId,
            reference:
              context.reference,
            transactionId:
              context.transactionId,
            amountMinor:
              context.amountMinor,
            currency:
              context.currency,
            providerOutcome:
              context.providerOutcome,
            financialExecutionState:
              context.financialExecutionState,
            reconciliationState:
              context.reconciliationState,
            compensationType:
              plan.compensationType,
            planFingerprint:
              plan.planFingerprint,
            riskLevel:
              plan.riskLevel,
            metadata:
              context.metadata,
          },
        ),
        'policy',
        0,
        this.#limits(),
      );
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation policy evaluation failed.',
        {
          message:
            error?.message,
          tenantId:
            context.tenantId,
        },
      );

      if (
        this.config
          .failClosedOnFinancialCoreError
      ) {
        this.#throw(
          'COMPENSATION_POLICY_UNAVAILABLE',
          'Compensation policy evaluation failed; execution is blocked.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'REQUIRE_REVIEW',

        requiresApproval:
          true,

        riskLevel:
          riskMax(
            plan.riskLevel,
            RISK_LEVELS.HIGH,
          ),

        source:
          'POLICY_ERROR_FAILSAFE',
      };
    }
  }

  #buildPlan(
    ctx,
    d,
  ) {
    const fingerprintInput =
      {
        ...ctx,
        compensationType:
          d.type,
      };

    return {
      planId:
        `plan_${this.idFactory()}`,

      compensationType:
        d.type,

      outcome:
        d.outcome,

      code:
        d.code,

      reason:
        d.reason,

      riskLevel:
        d.riskLevel,

      requiresApproval:
        Boolean(
          d.requiresApproval,
        ),

      tenantId:
        ctx.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      reference:
        ctx.reference,

      transactionId:
        ctx.transactionId,

      amountMinor:
        ctx.amountMinor,

      currency:
        ctx.currency,

      originalIdempotencyKey:
        ctx.originalIdempotencyKey,

      compensationIdempotencyKey:
        compensationIdempotencyKey(
          fingerprintInput,
        ),

      originalScopeFingerprint:
        str(
          ctx.originalScopeFingerprint ??
            ctx.scopeFingerprint,
          128,
        ),

      reconciliationFingerprint:
        str(
          ctx.reconciliationFingerprint ??
            ctx.reconciliation?.fingerprint,
          128,
        ),

      planFingerprint:
        compensationFingerprint(
          fingerprintInput,
        ),

      executionBoundary:
        'TITECH_FINANCIAL_CORE / AIRTEL_DISBURSEMENT_SERVICE',

      directProviderCall:
        false,

      directLedgerMutation:
        false,

      originalTransactionIdentityPreserved:
        true,

      compensationOperationIsDistinct:
        true,

      generatedFinancialIdentity:
        true,

      directFinancialMutation:
        false,

      metadata:
        ctx.metadata,
    };
  }

  async plan(
    input = {},
  ) {
    const ctx =
      normalizeInput(
        input,
        this.config,
      );

    const d =
      disposition(
        ctx,
        this.config,
      );

    let plan =
      this.#buildPlan(
        ctx,
        d,
      );

    const policy =
      await this.#policy(
        ctx,
        plan,
        'PLAN',
      );

    const pDecision =
      upper(
        policy?.decision ??
          policy?.outcome,
      );

    if (
      [
        'BLOCK',
        'DENY',
        'REJECT',
        'REJECTED',
      ].includes(
        pDecision,
      )
    ) {
      this.#throw(
        'COMPENSATION_POLICY_BLOCKED',
        policy?.reason ??
          'Compensation policy blocks this recovery.',
        {
          policyDecision:
            pDecision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const gatedApproval =
      Boolean(
        plan.requiresApproval ||
        policy?.requiresApproval ||
        [
          'REVIEW',
          'REQUIRE_REVIEW',
        ].includes(
          pDecision,
        ),
      );

    plan = {
      ...plan,

      requiresApproval:
        gatedApproval,

      riskLevel:
        riskMax(
          plan.riskLevel,
          policy?.riskLevel,
        ),

      policyDecision:
        pDecision,

      policySource:
        str(
          policy?.source,
          160,
        ),

      policyVersion:
        str(
          policy?.policyVersion,
          120,
        ),
    };

    if (
      policy?.compensationType &&
      upper(
        policy.compensationType,
      ) !==
        plan.compensationType
    ) {
      plan =
        this.#buildPlan(
          ctx,
          {
            ...d,
            type:
              upper(
                policy.compensationType,
              ),
            requiresApproval:
              gatedApproval,
            riskLevel:
              riskMax(
                plan.riskLevel,
                policy?.riskLevel,
              ),
          },
        );

      plan = {
        ...plan,

        policyDecision:
          pDecision,

        policySource:
          str(
            policy?.source,
            160,
          ),

        policyVersion:
          str(
            policy?.policyVersion,
            120,
          ),

        requiresApproval:
          gatedApproval,
      };
    }

    return deepFreezeResult({
      outcome:
        plan.outcome,

      state:
        gatedApproval
          ? CASE_STATES.PENDING_APPROVAL
          : d.state,

      code:
        plan.code,

      reason:
        plan.reason,

      riskLevel:
        plan.riskLevel,

      requiresApproval:
        gatedApproval,

      plan,
    });
  }

  async createCase(
    input = {},
  ) {
    const ctx =
      normalizeInput(
        input,
        this.config,
      );

    const existing =
      await this.#findExisting(
        ctx,
      );

    if (existing) {
      const candidate =
        compensationFingerprint({
          ...ctx,
          compensationType:
            ctx.compensationType,
        });

      if (
        existing.planFingerprint &&
        existing.planFingerprint !==
          candidate &&
        !TERMINAL.has(
          upper(
            existing.state,
          ),
        )
      ) {
        this.#throw(
          'COMPENSATION_SCOPE_CONFLICT',
          'An active compensation case exists with a different recovery scope.',
          {
            caseId:
              existing.caseId,
          },
          {
            httpStatus: 409,
          },
        );
      }

      return deepFreezeResult(
        existing,
      );
    }

    const planned =
      await this.plan(
        ctx,
      );

    const ttl =
      Math.min(
        this.config.maxTtlMs,
        Math.max(
          this.config.minTtlMs,
          Number.isFinite(
            Number(
              ctx.ttlMs,
            ),
          )
            ? Math.trunc(
                Number(
                  ctx.ttlMs,
                ),
              )
            : this.config
                .defaultTtlMs,
        ),
      );

    const record = {
      caseId:
        str(
          ctx.caseId,
          this.config
            .maxCaseIdLength,
        ) ??
        `comp_${this.idFactory()}`,

      schemaVersion:
        SCHEMA_VERSION,

      engineName:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      component:
        COMPONENT,

      tenantId:
        ctx.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      state:
        planned.state,

      outcome:
        planned.outcome,

      code:
        planned.code,

      reason:
        str(
          planned.reason,
          this.config
            .maxReasonLength,
        ),

      compensationType:
        planned.plan
          .compensationType,

      planId:
        planned.plan.planId,

      planFingerprint:
        planned.plan
          .planFingerprint,

      reference:
        ctx.reference,

      transactionId:
        ctx.transactionId,

      amountMinor:
        ctx.amountMinor,

      currency:
        ctx.currency,

      originalIdempotencyKey:
        ctx.originalIdempotencyKey,

      compensationIdempotencyKey:
        planned.plan
          .compensationIdempotencyKey,

      originalScopeFingerprint:
        ctx.originalScopeFingerprint ??
        ctx.scopeFingerprint,

      reconciliationFingerprint:
        planned.plan
          .reconciliationFingerprint,

      providerOutcome:
        ctx.providerOutcome,

      financialExecutionState:
        ctx.financialExecutionState,

      reconciliationState:
        ctx.reconciliationState,

      riskLevel:
        planned.riskLevel,

      requiresApproval:
        planned.requiresApproval,

      approvalId:
        undefined,

      approvalScopeFingerprint:
        undefined,

      approval:
        undefined,

      executionReference:
        undefined,

      attempts:
        0,

      retryCount:
        0,

      version:
        1,

      createdAt:
        nowIso(this.clock),

      updatedAt:
        nowIso(this.clock),

      expiresAt:
        new Date(
          nowMs(this.clock) +
            ttl,
        ).toISOString(),

      claimedAt:
        undefined,

      claimedBy:
        undefined,

      executedAt:
        undefined,

      verifiedAt:
        undefined,

      completedAt:
        undefined,

      failedAt:
        undefined,

      escalatedAt:
        undefined,

      execution:
        undefined,

      verification:
        undefined,

      failure:
        undefined,

      metadata:
        ctx.metadata,
    };

    record.auditFingerprint =
      sha256({
        caseId:
          record.caseId,

        tenantId:
          record.tenantId,

        type:
          record.compensationType,

        planFingerprint:
          record.planFingerprint,
      });

    const create =
      this.#requireRepo(
        [
          'createCase',
          'create',
        ],
        'A compensation case repository is required for durable recovery governance.',
      );

    let persisted;

    try {
      persisted =
        await create(
          record,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            idempotencyKey:
              record.compensationIdempotencyKey,

            planFingerprint:
              record.planFingerprint,
          },
        );
    } catch (
      error
    ) {
      const code =
        upper(
          error?.code,
        );

      if (
        code?.includes(
          'DUPLICATE',
        ) ||
        code?.includes(
          'CONFLICT',
        )
      ) {
        const retryExisting =
          await this.#findExisting(
            ctx,
          );

        if (retryExisting) {
          return deepFreezeResult(
            retryExisting,
          );
        }
      }

      this.#log(
        'error',
        'Airtel compensation case creation failed.',
        {
          tenantId:
            record.tenantId,

          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      this.#throw(
        'COMPENSATION_CASE_CREATE_FAILED',
        'Compensation case could not be persisted.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    if (!persisted) {
      this.#throw(
        'COMPENSATION_CASE_CREATE_FAILED',
        'Compensation repository did not return the persisted case.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    await this.#audit(
      'COMPENSATION_CASE_CREATED',
      persisted,
    );

    await this.#event(
      'CASE_CREATED',
      persisted,
    );

    this.#metric(
      'airtel.disbursement.compensation.case.created',
      {
        state:
          persisted.state,

        compensationType:
          persisted
            .compensationType,
      },
    );

    return deepFreezeResult(
      persisted,
    );
  }

  async #findExisting(
    ctx,
  ) {
    const key =
      compensationIdempotencyKey(
        ctx,
      );

    const byKey =
      this.#repo(
        'findByCompensationIdempotencyKey',
        'findByIdempotencyKey',
      );

    if (byKey) {
      const found =
        await byKey({
          tenantId:
            ctx.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          compensationIdempotencyKey:
            key,

          idempotencyKey:
            key,
        });

      if (found) {
        return clone(found);
      }
    }

    const byRef =
      this.#repo(
        'findByReference',
        'getByReference',
      );

    if (
      byRef &&
      ctx.reference
    ) {
      const found =
        await byRef({
          tenantId:
            ctx.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          reference:
            ctx.reference,

          compensationType:
            ctx.compensationType,
        });

      if (found) {
        return clone(found);
      }
    }

    return null;
  }

  async #getCase(
    caseId,
    tenantId,
  ) {
    const id =
      str(
        caseId,
        this.config
          .maxCaseIdLength,
      );

    if (!id) {
      return null;
    }

    const get =
      this.#requireRepo(
        [
          'getById',
          'findById',
          'getCase',
          'findCase',
        ],
        'A compensation case lookup adapter is required.',
      );

    const record =
      await get(
        id,
        { tenantId },
      );

    if (!record) {
      return null;
    }

    if (
      record.tenantId !==
      tenantId
    ) {
      this.#throw(
        'TENANT_SCOPE_MISMATCH',
        'Compensation case belongs to a different tenant.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      upper(
        record.provider,
      ) !==
        PROVIDER ||
      upper(
        record.operation,
      ) !==
        OPERATION
    ) {
      this.#throw(
        'COMPENSATION_SCOPE_VIOLATION',
        'Compensation case is outside Airtel disbursement scope.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    return clone(record);
  }

  async #patch(
    record,
    patch,
  ) {
    const fn =
      this.#repo(
        'patchCase',
        'updateCase',
        'patch',
      );

    if (!fn) {
      return null;
    }

    try {
      return clone(
        await fn({
          caseId:
            record.caseId,

          tenantId:
            record.tenantId,

          expectedVersion:
            Number(
              record.version ??
                1,
            ),

          expectedPlanFingerprint:
            record.planFingerprint,

          patch:
            sanitize(
              patch,
              'patch',
              0,
              this.#limits(),
            ),
        }),
      );
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation case patch failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnPersistenceError
      ) {
        this.#throw(
          'COMPENSATION_CASE_PATCH_FAILED',
          'Compensation case evidence could not be persisted.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }
  }

  async #transition(
    record,
    nextState,
    options = {},
  ) {
    if (
      !canTransition(
        record.state,
        nextState,
      )
    ) {
      this.#throw(
        'INVALID_COMPENSATION_STATE_TRANSITION',
        `Cannot transition compensation case from ${record.state} to ${nextState}.`,
        {
          fromState:
            record.state,

          toState:
            nextState,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const transition =
      this.#requireRepo(
        [
          'transitionCase',
          'atomicTransition',
          'transition',
          'updateState',
        ],
        'An atomic compensation case transition adapter is required.',
      );

    try {
      const result =
        await transition({
          caseId:
            record.caseId,

          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          fromState:
            record.state,

          toState:
            nextState,

          action:
            options.action ??
            nextState,

          actorId:
            options.actorId,

          expectedVersion:
            Number(
              record.version ??
                1,
            ),

          expectedPlanFingerprint:
            record.planFingerprint,

          patch:
            sanitize(
              {
                ...(options.patch ??
                  {}),

                state:
                  nextState,

                updatedAt:
                  nowIso(
                    this.clock,
                  ),

                version:
                  Number(
                    record.version ??
                      1,
                  ) + 1,
              },
              'patch',
              0,
              this.#limits(),
            ),
        });

      if (!result) {
        this.#throw(
          'COMPENSATION_TRANSITION_REJECTED',
          'Compensation state transition was not committed.',
          {
            caseId:
              record.caseId,

            nextState,
          },
          {
            httpStatus: 409,
          },
        );
      }

      return clone(result);
    } catch (
      error
    ) {
      if (
        error instanceof
        AirtelCompensationError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Airtel compensation case transition failed.',
        {
          caseId:
            record.caseId,

          fromState:
            record.state,

          nextState,

          message:
            error?.message,
        },
      );

      this.#throw(
        'COMPENSATION_TRANSITION_FAILED',
        'Compensation case state transition failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  async #reconcileBeforeExecution(
    ctx,
    record,
  ) {
    const fn =
      this.reconciliation
        ?.reconcile ??
      this.reconciliation?.check ??
      this.reconciliation?.assess;

    if (!isFn(fn)) {
      return {
        ready: false,

        code:
          'RECONCILIATION_REQUIRED',

        reason:
          'A reconciliation adapter is required before compensation execution.',
      };
    }

    try {
      const result =
        await fn.call(
          this.reconciliation,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            compensationType:
              record.compensationType,

            planFingerprint:
              record.planFingerprint,

            context:
              sanitize(
                ctx,
                'context',
                0,
                this.#limits(),
              ),
          },
        ) ?? {};

      const state =
        upper(
          result.state ??
            result.reconciliationState,
        );

      const knownSuccess =
        Boolean(
          result.knownSuccess ??
            result.confirmedSuccess ??
            result.financialPosted,
        );

      const knownFailure =
        Boolean(
          result.knownFailure ??
            result.confirmedFailure,
        );

      const conflict =
        Boolean(
          result.conflict ??
            result.mismatch ??
            result.repairRequired,
        );

      if (
        conflict ||
        [
          'CONFLICT',
          'REPAIR_REQUIRED',
        ].includes(state)
      ) {
        return {
          ready: false,

          code:
            'RECONCILIATION_CONFLICT',

          reason:
            result.reason ??
            'Reconciliation requires manual financial repair.',
        };
      }

      if (
        ambiguous(
          result.providerOutcome,
        ) ||
        [
          'AMBIGUOUS',
          'PENDING',
        ].includes(state)
      ) {
        return {
          ready: false,

          code:
            'RECONCILIATION_PENDING',

          reason:
            result.reason ??
            'Financial outcome remains ambiguous or pending.',
        };
      }

      if (
        record.compensationType ===
          COMPENSATION_TYPES.REVERSAL &&
        !knownSuccess
      ) {
        return {
          ready: false,

          code:
            'REVERSAL_SOURCE_EFFECT_NOT_CONFIRMED',

          reason:
            'A reversal requires authoritative evidence that the original financial effect exists.',
        };
      }

      if (
        record.compensationType ===
          COMPENSATION_TYPES.RELEASE_RESERVATION &&
        !knownFailure &&
        !result.reservationOutstanding
      ) {
        return {
          ready: false,

          code:
            'RESERVATION_STATE_NOT_CONFIRMED',

          reason:
            'Reservation release requires evidence that a reservation remains outstanding.',
        };
      }

      const updated =
        await this.#patch(
          record,
          {
            reconciliationState:
              state ||
              (
                knownSuccess
                  ? RECONCILIATION_STATES.CONFIRMED_SUCCESS
                  : knownFailure
                    ? RECONCILIATION_STATES.CONFIRMED_FAILURE
                    : RECONCILIATION_STATES.NOT_RUN
              ),

            reconciliationFingerprint:
              str(
                result.fingerprint,
                128,
              ),

            providerOutcome:
              upper(
                result.providerOutcome ??
                  record.providerOutcome,
              ),
          },
        );

      return {
        ready: true,

        code:
          'RECONCILIATION_CONFIRMED',

        reason:
          result.reason,

        record:
          updated,
      };
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation reconciliation failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      return {
        ready: false,

        code:
          'RECONCILIATION_UNAVAILABLE',

        reason:
          'Reconciliation is unavailable; compensation execution is blocked.',
      };
    }
  }

  async #requestApproval(
    record,
  ) {
    if (
      !this.approvalWorkflow
    ) {
      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_UNAVAILABLE',

        reason:
          'Approval workflow is unavailable.',
      };
    }

    const fn =
      this.approvalWorkflow.create ??
      this.approvalWorkflow.requestApproval ??
      this.approvalWorkflow.authorize;

    if (!isFn(fn)) {
      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_CONTRACT_INVALID',

        reason:
          'Approval workflow cannot create a compensation approval request.',
      };
    }

    try {
      const result =
        await fn.call(
          this.approvalWorkflow,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              'AIRTEL_COMPENSATION',

            approvalId:
              record.approvalId,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            amountMinor:
              record.amountMinor,

            currency:
              record.currency,

            compensationType:
              record.compensationType,

            action:
              record.compensationType,

            impactLevel:
              record.compensationType,

            riskLevel:
              record.riskLevel,

            scopeFingerprint:
              record.planFingerprint,

            originalScopeFingerprint:
              record.originalScopeFingerprint,

            reason:
              record.reason,

            ttlMs:
              Math.max(
                60_000,
                new Date(
                  record.expiresAt,
                ).getTime() -
                  nowMs(
                    this.clock,
                  ),
              ),
          },
        ) ?? {};

      const approved =
        result.approved === true ||
        upper(
          result.state,
        ) ===
          'APPROVED' ||
        result.executable ===
          true;

      const approvalId =
        str(
          result.approvalId,
          160,
        );

      const approvalScopeFingerprint =
        str(
          result.scopeFingerprint ??
            result.approval
              ?.scopeFingerprint,
          128,
        );

      const updated =
        await this.#transition(
          record,
          approved
            ? CASE_STATES.APPROVED
            : CASE_STATES.PENDING_APPROVAL,
          {
            action:
              approved
                ? 'APPROVAL_ACCEPTED'
                : 'APPROVAL_REQUESTED',

            patch: {
              approvalId,

              approvalScopeFingerprint,

              approval:
                sanitize(
                  result,
                  'approval',
                  0,
                  this.#limits(),
                ),
            },
          },
        );

      return {
        approved,

        code:
          approved
            ? 'COMPENSATION_APPROVED'
            : 'COMPENSATION_APPROVAL_REQUIRED',

        reason:
          approved
            ? undefined
            : result.reason ??
              'Compensation approval is pending.',

        record:
          updated,
      };
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation approval request failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnApprovalError
      ) {
        return {
          approved: false,

          code:
            'COMPENSATION_APPROVAL_UNAVAILABLE',

          reason:
            'Compensation approval could not be established.',
        };
      }

      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_REQUIRED',

        reason:
          'Compensation approval is required before execution.',
      };
    }
  }

  async #verifyApproval(
    record,
    context,
  ) {
    if (
      !this.approvalWorkflow
    ) {
      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_UNAVAILABLE',

        reason:
          'Approval workflow is unavailable.',
      };
    }

    const fn =
      this.approvalWorkflow
        .verifyForExecution ??
      this.approvalWorkflow
        .verifyApproval;

    if (!isFn(fn)) {
      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_CONTRACT_INVALID',

        reason:
          'Approval workflow cannot verify execution authorization.',
      };
    }

    try {
      const result =
        await fn.call(
          this.approvalWorkflow,
          {
            approvalId:
              record.approvalId,

            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            amountMinor:
              record.amountMinor,

            currency:
              record.currency,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            scopeFingerprint:
              record.approvalScopeFingerprint ??
              record.approval
                ?.scopeFingerprint ??
              record.planFingerprint,

            compensationType:
              record.compensationType,

            operation:
              'AIRTEL_COMPENSATION',

            actor:
              context.executor ??
              context.actor,
          },
        ) ?? {};

      const approved =
        result.executable === true ||
        result.authorized === true ||
        result.approved === true ||
        upper(
          result.outcome,
        ) ===
          'APPROVED';

      return {
        approved,

        code:
          approved
            ? 'COMPENSATION_APPROVED'
            : result.code ??
              'COMPENSATION_APPROVAL_REQUIRED',

        reason:
          approved
            ? undefined
            : result.reason ??
              'Approval has not established execution authorization.',
      };
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel compensation approval verification failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      return {
        approved: false,

        code:
          'COMPENSATION_APPROVAL_VERIFY_UNAVAILABLE',

        reason:
          'Approval execution verification failed.',
      };
    }
  }

  async #claim(
    record,
    context,
  ) {
    const fn =
      this.#repo(
        'claimForExecution',
        'claim',
        'atomicClaim',
      );

    if (!fn) {
      this.#throw(
        'COMPENSATION_CLAIM_UNAVAILABLE',
        'An atomic compensation execution claim adapter is required.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const actorId =
      actorIdOf(
        context.executor ??
          context.actor,
      ) ??
      'system:airtel-compensation';

    try {
      const claimed =
        await fn({
          caseId:
            record.caseId,

          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          expectedStates: [
            CASE_STATES.READY_FOR_COMPENSATION,
            CASE_STATES.APPROVED,
          ],

          expectedVersion:
            Number(
              record.version ??
                1,
            ),

          expectedPlanFingerprint:
            record.planFingerprint,

          claimant:
            actorId,

          patch: {
            state:
              CASE_STATES.EXECUTING,

            claimedAt:
              nowIso(this.clock),

            claimedBy:
              actorId,

            attempts:
              Number(
                record.attempts ??
                  0,
              ) + 1,

            updatedAt:
              nowIso(this.clock),

            version:
              Number(
                record.version ??
                  1,
              ) + 1,
          },
        });

      if (!claimed) {
        return {
          claimed: false,

          code:
            'COMPENSATION_ALREADY_CLAIMED',
        };
      }

      return {
        claimed: true,

        record:
          clone(claimed),
      };
    } catch (
      error
    ) {
      if (
        upper(
          error?.code,
        ) ===
          'ALREADY_CLAIMED'
      ) {
        return {
          claimed: false,

          code:
            'COMPENSATION_ALREADY_CLAIMED',
        };
      }

      this.#log(
        'error',
        'Airtel compensation claim failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      this.#throw(
        'COMPENSATION_CLAIM_FAILED',
        'Unable to atomically claim the compensation case.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  async #executeFinancial(
    record,
    context,
  ) {
    const fn =
      this.financialCore
        ?.executeCompensation ??
      this.financialCore
        ?.compensate ??
      this.financialCore
        ?.executeCorrectiveOperation ??
      this.ledgerBridge?.compensate;

    if (!isFn(fn)) {
      this.#throw(
        'FINANCIAL_CORE_COMPENSATION_UNAVAILABLE',
        'No Financial Core compensation adapter is configured.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const payload = {
      tenantId:
        record.tenantId,

      provider:
        PROVIDER,

      operation:
        this.config
          .compensationProviderOperation,

      compensationType:
        record.compensationType,

      caseId:
        record.caseId,

      reference:
        record.reference,

      transactionId:
        record.transactionId,

      originalIdempotencyKey:
        record.originalIdempotencyKey,

      compensationIdempotencyKey:
        record.compensationIdempotencyKey,

      amountMinor:
        record.amountMinor,

      currency:
        record.currency,

      reasonCode:
        record.code,

      reason:
        record.reason,

      planFingerprint:
        record.planFingerprint,

      approvalId:
        record.approvalId,

      metadata:
        sanitize(
          context.metadata ??
            record.metadata ??
            {},
          'metadata',
          0,
          this.#limits(),
        ),
    };

    try {
      const result =
        await fn.call(
          this.financialCore ??
            this.ledgerBridge,
          payload,
        );

      if (!result) {
        this.#throw(
          'FINANCIAL_COMPENSATION_RESULT_MISSING',
          'Financial Core did not return a compensation result.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return result;
    } catch (
      error
    ) {
      if (
        error instanceof
        AirtelCompensationError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Airtel financial compensation execution failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      this.#throw(
        'FINANCIAL_COMPENSATION_EXECUTION_FAILED',
        'Financial Core compensation execution failed.',
        {
          caseId:
            record.caseId,
        },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  async #verifyFinancial(
    record,
    result,
    context,
  ) {
    const fn =
      this.financialCore
        ?.verifyCompensation ??
      this.financialCore
        ?.verifyCorrectiveOperation ??
      this.reconciliation
        ?.verifyCompensation ??
      this.reconciliation
        ?.verify;

    if (!isFn(fn)) {
      if (
        this.config
          .requireFinancialCoreVerification
      ) {
        return {
          verified: false,

          code:
            'FINANCIAL_CORE_VERIFICATION_REQUIRED',

          reason:
            'Compensation must be verified by Financial Core/reconciliation.',
        };
      }

      const outcome =
        upper(
          result?.outcome ??
            result?.status,
        );

      return {
        verified:
          [
            'SUCCESS',
            'SUCCEEDED',
            'COMPLETED',
            'SETTLED',
            'POSTED',
          ].includes(
            outcome,
          ),

        outcome,
      };
    }

    try {
      const verification =
        await fn.call(
          this.financialCore ??
            this.reconciliation,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            caseId:
              record.caseId,

            compensationType:
              record.compensationType,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            compensationIdempotencyKey:
              record.compensationIdempotencyKey,

            planFingerprint:
              record.planFingerprint,

            execution:
              sanitize(
                result,
                'execution',
                0,
                this.#limits(),
              ),

            context:
              sanitize(
                context,
                'context',
                0,
                this.#limits(),
              ),
          },
        ) ?? {};

      const verified =
        verification.verified ===
          true ||
        verification.confirmed ===
          true ||
        [
          'SUCCESS',
          'SUCCEEDED',
          'COMPLETED',
          'SETTLED',
          'POSTED',
        ].includes(
          upper(
            verification.outcome ??
              verification.status,
          ),
        );

      return {
        verified,

        code:
          verified
            ? 'FINANCIAL_COMPENSATION_VERIFIED'
            : str(
                verification.code,
                160,
              ) ??
              'FINANCIAL_COMPENSATION_UNVERIFIED',

        reason:
          verified
            ? undefined
            : verification.reason ??
              'Financial compensation is not authoritatively verified.',

        confirmationReference:
          str(
            verification.confirmationReference ??
              verification.operationReference,
            240,
          ),

        verificationFingerprint:
          str(
            verification.fingerprint,
            128,
          ),
      };
    } catch (
      error
    ) {
      this.#log(
        'error',
        'Airtel financial compensation verification failed.',
        {
          caseId:
            record.caseId,

          message:
            error?.message,
        },
      );

      return {
        verified: false,

        code:
          'FINANCIAL_CORE_VERIFICATION_UNAVAILABLE',

        reason:
          'Financial Core verification is unavailable.',
      };
    }
  }

  async #ensureCase(
    context,
  ) {
    if (
      context.caseId
    ) {
      const found =
        await this.#getCase(
          context.caseId,
          context.tenantId,
        );

      if (!found) {
        this.#throw(
          'COMPENSATION_CASE_NOT_FOUND',
          'Requested compensation case was not found.',
          {},
          {
            httpStatus: 404,
          },
        );
      }

      return found;
    }

    return this.createCase(
      context,
    );
  }

  #expired(
    record,
  ) {
    const t =
      new Date(
        record?.expiresAt,
      ).getTime();

    return (
      Number.isFinite(t) &&
      t <=
        nowMs(this.clock)
    );
  }

  async execute(
    input = {},
  ) {
    const context =
      normalizeInput(
        input,
        this.config,
      );

    let record =
      await this.#ensureCase(
        context,
      );

    if (
      record.state ===
      CASE_STATES.COMPLETED
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.REPLAY,
        'COMPENSATION_ALREADY_COMPLETED',
        true,
      );
    }

    if (
      [
        CASE_STATES.CANCELLED,
        CASE_STATES.SUPERSEDED,
      ].includes(
        record.state,
      )
    ) {
      this.#throw(
        'COMPENSATION_CASE_NOT_EXECUTABLE',
        `Compensation case is terminal in state ${record.state}.`,
        {
          caseId:
            record.caseId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this.#expired(record)
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.FAILED,
        'COMPENSATION_CASE_EXPIRED',
        false,
      );
    }

    if (
      [
        CASE_STATES.REQUIRES_RECONCILIATION,
        CASE_STATES.ESCALATED,
      ].includes(
        record.state,
      )
    ) {
      const r =
        await this.#reconcileBeforeExecution(
          context,
          record,
        );

      if (!r.ready) {
        return this.#result(
          record,
          CASE_OUTCOMES.RECONCILE,
          r.code,
          false,
          {
            reason:
              r.reason,
          },
        );
      }

      record =
        await this.#getCase(
          record.caseId,
          record.tenantId,
        ) ??
        r.record ??
        record;
    }

    if (
      record.requiresApproval &&
      record.state ===
        CASE_STATES.READY_FOR_COMPENSATION
    ) {
      const requested =
        await this.#requestApproval(
          record,
        );

      if (!requested.approved) {
        return this.#result(
          record,
          CASE_OUTCOMES.PENDING_APPROVAL,
          requested.code,
          false,
          {
            reason:
              requested.reason,
          },
        );
      }

      record =
        requested.record ??
        await this.#getCase(
          record.caseId,
          record.tenantId,
        ) ??
        record;
    }

    if (
      record.state ===
      CASE_STATES.PENDING_APPROVAL
    ) {
      const verified =
        await this.#verifyApproval(
          record,
          context,
        );

      if (
        !verified.approved
      ) {
        return this.#result(
          record,
          CASE_OUTCOMES.PENDING_APPROVAL,
          verified.code,
          false,
          {
            reason:
              verified.reason,
          },
        );
      }

      record =
        await this.#transition(
          record,
          CASE_STATES.APPROVED,
          {
            action:
              'APPROVAL_ACCEPTED',
          },
        );
    }

    if (
      ![
        CASE_STATES.READY_FOR_COMPENSATION,
        CASE_STATES.APPROVED,
      ].includes(
        record.state,
      )
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.PENDING,
        'COMPENSATION_CASE_NOT_READY',
        false,
      );
    }

    const claimed =
      await this.#claim(
        record,
        context,
      );

    if (
      !claimed.claimed
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.REPLAY,
        claimed.code,
        false,
      );
    }

    record =
      claimed.record;

    await this.#audit(
      'COMPENSATION_EXECUTION_CLAIMED',
      record,
      {
        actorId:
          actorIdOf(
            context.executor ??
              context.actor,
          ),
      },
    );

    let financialResult;

    try {
      financialResult =
        await this.#executeFinancial(
          record,
          context,
        );
    } catch (
      error
    ) {
      await this.#markFailed(
        record,
        context,
        error,
      );

      throw error;
    }

    record =
      await this.#transition(
        record,
        CASE_STATES.VERIFYING,
        {
          action:
            'VERIFY_EXECUTION',

          patch: {
            execution:
              sanitize(
                financialResult,
                'execution',
                0,
                this.#limits(),
              ),
          },
        },
      );

    const verification =
      await this.#verifyFinancial(
        record,
        financialResult,
        context,
      );

    if (
      !verification.verified
    ) {
      const escalated =
        await this.#transition(
          record,
          CASE_STATES.ESCALATED,
          {
            action:
              'EXECUTION_VERIFICATION_FAILED',

            patch: {
              verification,

              escalatedAt:
                nowIso(
                  this.clock,
                ),

              failure: {
                code:
                  verification.code,

                reason:
                  verification.reason,

                at:
                  nowIso(
                    this.clock,
                  ),
              },
            },
          },
        );

      await this.#audit(
        'COMPENSATION_ESCALATED',
        escalated,
        {
          verification,
        },
      );

      await this.#event(
        'ESCALATED',
        escalated,
        {
          code:
            verification.code,
        },
      );

      this.#metric(
        'airtel.disbursement.compensation.escalated',
      );

      return this.#result(
        escalated,
        CASE_OUTCOMES.ESCALATED,
        verification.code,
        false,
        {
          reason:
            verification.reason,
        },
      );
    }

    const completed =
      await this.#transition(
        record,
        CASE_STATES.COMPLETED,
        {
          action:
            'COMPLETE',

          patch: {
            execution:
              sanitize(
                financialResult,
                'execution',
                0,
                this.#limits(),
              ),

            verification,

            executionReference:
              str(
                financialResult?.operationReference ??
                  financialResult?.reference,
                240,
              ),

            executedAt:
              nowIso(
                this.clock,
              ),

            verifiedAt:
              nowIso(
                this.clock,
              ),

            completedAt:
              nowIso(
                this.clock,
              ),
          },
        },
      );

    await this.#audit(
      'COMPENSATION_COMPLETED',
      completed,
      {
        verification,
      },
    );

    await this.#event(
      'COMPLETED',
      completed,
    );

    this.#metric(
      'airtel.disbursement.compensation.completed',
      {
        compensationType:
          completed
            .compensationType,
      },
    );

    return this.#result(
      completed,
      CASE_OUTCOMES.COMPLETED,
      'COMPENSATION_COMPLETED',
      true,
      {
        financialResult:
          sanitize(
            financialResult,
            'financialResult',
            0,
            this.#limits(),
          ),
      },
    );
  }

  async #markFailed(
    record,
    context,
    error,
  ) {
    try {
      const failedRecord =
        await this.#transition(
          record,
          CASE_STATES.FAILED,
          {
            action:
              'EXECUTION_FAILED',

            actorId:
              actorIdOf(
                context.executor ??
                  context.actor,
              ),

            patch: {
              failedAt:
                nowIso(
                  this.clock,
                ),

              failure: {
                code:
                  str(
                    error?.code ??
                      'FINANCIAL_COMPENSATION_EXECUTION_FAILED',
                    this.config
                      .maxErrorCodeLength,
                  ),

                reason:
                  str(
                    error?.message,
                    this.config
                      .maxReasonLength,
                  ),

                retryable:
                  Boolean(
                    error?.retryable,
                  ),

                at:
                  nowIso(
                    this.clock,
                  ),
              },
            },
          },
        );

      await this.#audit(
        'COMPENSATION_FAILED',
        failedRecord,
      );

      await this.#event(
        'FAILED',
        failedRecord,
      );

      this.#metric(
        'airtel.disbursement.compensation.failed',
        {
          compensationType:
            failedRecord
              .compensationType,
        },
      );
    } catch (
      stateError
    ) {
      this.#log(
        'error',
        'Failed to persist Airtel compensation failure state.',
        {
          caseId:
            record.caseId,

          message:
            stateError?.message,
        },
      );
    }
  }

  async retry(
    input = {},
  ) {
    const ctx =
      normalizeInput(
        input,
        this.config,
      );

    const record =
      await this.#getCase(
        ctx.caseId,
        ctx.tenantId,
      );

    if (!record) {
      this.#throw(
        'COMPENSATION_CASE_NOT_FOUND',
        'Compensation case was not found for retry.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      record.state ===
      CASE_STATES.COMPLETED
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.REPLAY,
        'COMPENSATION_ALREADY_COMPLETED',
        true,
      );
    }

    if (
      record.state ===
      CASE_STATES.EXECUTING
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.PENDING,
        'COMPENSATION_EXECUTION_IN_PROGRESS',
        false,
      );
    }

    if (
      ![
        CASE_STATES.FAILED,
        CASE_STATES.ESCALATED,
      ].includes(
        record.state,
      )
    ) {
      return this.execute({
        ...ctx,

        caseId:
          record.caseId,
      });
    }

    const plan =
      await this.plan({
        ...ctx,

        compensationType:
          record.compensationType,

        providerOutcome:
          record.providerOutcome,

        financialExecutionState:
          record.financialExecutionState,

        reconciliationState:
          record.reconciliationState,

        originalScopeFingerprint:
          record.originalScopeFingerprint,
      });

    if (
      plan.plan.planFingerprint !==
      record.planFingerprint
    ) {
      this.#throw(
        'COMPENSATION_PLAN_CHANGED',
        'Compensation facts changed since the prior failure/escalation; a new governed case is required.',
        {
          caseId:
            record.caseId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const nextState =
      plan.requiresApproval
        ? CASE_STATES.PENDING_APPROVAL
        : CASE_STATES.READY_FOR_COMPENSATION;

    const reset =
      await this.#transition(
        record,
        nextState,
        {
          action:
            'RETRY_COMPENSATION',

          patch: {
            retryCount:
              Number(
                record.retryCount ??
                  0,
              ) + 1,

            failure:
              undefined,
          },
        },
      );

    return this.execute({
      ...ctx,

      caseId:
        reset.caseId,

      compensationType:
        reset.compensationType,

      providerOutcome:
        reset.providerOutcome,

      financialExecutionState:
        reset.financialExecutionState,

      reconciliationState:
        reset.reconciliationState,
    });
  }

  async cancel(
    input = {},
  ) {
    const ctx =
      normalizeInput(
        input,
        this.config,
      );

    const record =
      await this.#getCase(
        ctx.caseId,
        ctx.tenantId,
      );

    if (!record) {
      this.#throw(
        'COMPENSATION_CASE_NOT_FOUND',
        'Compensation case was not found.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      TERMINAL.has(
        upper(
          record.state,
        ),
      )
    ) {
      return this.#result(
        record,
        CASE_OUTCOMES.REPLAY,
        'COMPENSATION_CASE_TERMINAL',
        record.state ===
          CASE_STATES.COMPLETED,
      );
    }

    const reason =
      str(
        ctx.reason,
        this.config
          .maxReasonLength,
      );

    if (!reason) {
      this.#throw(
        'CANCELLATION_REASON_REQUIRED',
        'Cancellation reason is required.',
      );
    }

    const updated =
      await this.#transition(
        record,
        CASE_STATES.CANCELLED,
        {
          action:
            'CANCEL',

          actorId:
            actorIdOf(
              ctx.actor ??
                ctx.executor,
            ),

          patch: {
            cancellationReason:
              reason,
          },
        },
      );

    await this.#audit(
      'COMPENSATION_CANCELLED',
      updated,
      { reason },
    );

    await this.#event(
      'CANCELLED',
      updated,
    );

    return this.#result(
      updated,
      CASE_OUTCOMES.NO_ACTION,
      'COMPENSATION_CANCELLED',
      false,
    );
  }

  #result(
    record,
    outcome,
    code,
    success,
    extra = {},
  ) {
    return deepFreezeResult({
      success:
        Boolean(success),

      compensated:
        record?.state ===
        CASE_STATES.COMPLETED,

      duplicate:
        outcome ===
        CASE_OUTCOMES.REPLAY,

      outcome,

      code,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      caseId:
        record?.caseId,

      tenantId:
        record?.tenantId,

      reference:
        record?.reference,

      transactionId:
        record?.transactionId,

      state:
        record?.state,

      compensationType:
        record?.compensationType,

      planFingerprint:
        record?.planFingerprint,

      originalIdempotencyKey:
        record?.originalIdempotencyKey,

      compensationIdempotencyKey:
        record?.compensationIdempotencyKey,

      executionReference:
        record?.executionReference,

      riskLevel:
        record?.riskLevel,

      ...extra,
    });
  }

  health() {
    const repository =
      Boolean(
        this.repository,
      );

    const atomicTransition =
      Boolean(
        this.#repo(
          'transitionCase',
          'atomicTransition',
          'transition',
          'updateState',
        ),
      );

    const atomicClaim =
      Boolean(
        this.#repo(
          'claimForExecution',
          'claim',
          'atomicClaim',
        ),
      );

    const financialCore =
      Boolean(
        this.financialCore ??
          this.ledgerBridge,
      );

    const reconciliation =
      Boolean(
        this.reconciliation,
      );

    const approval =
      Boolean(
        this.approvalWorkflow,
      );

    const healthy =
      repository &&
      atomicTransition &&
      atomicClaim &&
      financialCore;

    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      healthy,

      dependencies: {
        repository,

        atomicTransition,

        atomicClaim,

        financialCore,

        reconciliation,

        approval,

        audit:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),
      },

      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,

        ambiguityRequiresReconciliation:
          this.config
            .requireReconciliationForAmbiguous,

        providerSuccessRequiresReconciliation:
          this.config
            .requireReconciliationForProviderSuccess,

        financialCoreVerification:
          this.config
            .requireFinancialCoreVerification,

        unresolvedOfflineBlocked:
          this.config
            .rejectUnresolvedOfflineStates,
      },
    };
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      supportsPlanning:
        true,

      supportsCaseCreation:
        true,

      supportsControlledExecution:
        true,

      supportsRetry:
        true,

      supportsCancellation:
        true,

      supportsReconciliationGate:
        true,

      supportsApprovalIntegration:
        Boolean(
          this.approvalWorkflow,
        ),

      supportsFinancialCoreIntegration:
        Boolean(
          this.financialCore ??
            this.ledgerBridge,
        ),

      deterministicCompensationIdempotency:
        true,

      deterministicPlanFingerprint:
        true,

      directProviderExecution:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      ambiguousOutcomeBlindCompensation:
        false,

      originalTransactionIdentityPreserved:
        true,

      compensatingOperationUsesDistinctIdentity:
        true,
    });
  }

  diagnostics() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      health:
        this.health(),

      configuration: {
        defaultTtlMs:
          this.config
            .defaultTtlMs,

        minTtlMs:
          this.config
            .minTtlMs,

        maxTtlMs:
          this.config
            .maxTtlMs,

        requireReconciliationForAmbiguous:
          this.config
            .requireReconciliationForAmbiguous,

        requireFinancialCoreVerification:
          this.config
            .requireFinancialCoreVerification,
      },
    };
  }

  requestCompensation(
    input = {},
  ) {
    return this.createCase(
      input,
    );
  }

  compensate(
    input = {},
  ) {
    return this.execute(
      input,
    );
  }

  executeCompensation(
    input = {},
  ) {
    return this.execute(
      input,
    );
  }

  retryCompensation(
    input = {},
  ) {
    return this.retry(
      input,
    );
  }
}

const deepFreezeResult = (
  value,
) => {
  const freeze = (
    v,
    seen = new WeakSet(),
  ) => {
    if (
      !v ||
      typeof v !== 'object' ||
      seen.has(v)
    ) {
      return v;
    }

    seen.add(v);

    for (
      const child of Object.values(
        v,
      )
    ) {
      freeze(
        child,
        seen,
      );
    }

    return Object.freeze(
      v,
    );
  };

  return freeze(
    clone(value),
  );
};

export const createCompensationManager =
  (
    options = {},
  ) =>
    new AirtelDisbursementCompensationManager(
      options,
    );

export const CompensationManager =
  AirtelDisbursementCompensationManager;

export const defaultCompensationManager =
  createCompensationManager();

export const compensationManager =
  defaultCompensationManager;

export const AirtelPaymentCompensationManager =
  AirtelDisbursementCompensationManager;

export default
  AirtelDisbursementCompensationManager;