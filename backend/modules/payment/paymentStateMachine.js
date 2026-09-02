'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment State Machine
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/paymentStateMachine.js
 *
 * Purpose:
 *   Centralized, production-grade lifecycle management for payment operations
 *   across MTN MoMo, Airtel Money, bank transfers, internal payment rails,
 *   refunds, withdrawals, contributions, loan repayments, loan disbursements,
 *   and other payment workflows.
 *
 * Architectural Principles
 * ----------------------------------------------------------------------------
 * 1. Payment state may only change through this state machine.
 * 2. Clients must never assign payment status directly.
 * 3. Provider status is external evidence, not internal truth.
 * 4. Payment state is distinct from financial ledger state.
 * 5. SUCCESSFUL means the payment operation has been authoritatively confirmed.
 * 6. Payment success does NOT by itself authorize direct ledger mutation.
 * 7. Ledger posting remains the responsibility of the Finance/Posting Engine.
 * 8. Duplicate payment operations must be prevented through idempotency.
 * 9. Provider callbacks must be safely repeatable.
 * 10. Out-of-order provider notifications must never downgrade authoritative
 *     internal state.
 * 11. Unknown provider outcomes must not be treated as failures.
 * 12. Reconciliation-required state exists for ambiguous or contradictory
 *     external/internal evidence.
 * 13. Payment transitions are tenant-scoped.
 * 14. Optimistic concurrency protects against stale workers.
 * 15. Sensitive provider credentials and secrets are never persisted here.
 * 16. Transition history is append-oriented.
 * 17. Audit/event publication is designed for transactional/outbox integration.
 * 18. This module never directly mutates account balances or ledger entries.
 *
 * Relationship to Transaction State Machine
 * ----------------------------------------------------------------------------
 * Payment state and FinancialTransaction state are related but separate.
 *
 * Example:
 *
 *   Payment:
 *     PROCESSING -> SUCCESSFUL
 *
 *   FinancialTransaction:
 *     PROCESSING -> POSTED
 *
 * The payment state machine controls payment workflow state.
 * The finance/transaction state machine controls financial workflow state.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Payment States
 * ========================================================================== */

const PAYMENT_STATES = Object.freeze({
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',

  SUCCESSFUL: 'SUCCESSFUL',

  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',

  /**
   * Operational/recovery states.
   */
  RETRYING: 'RETRYING',
  UNKNOWN: 'UNKNOWN',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  EXPIRED: 'EXPIRED',
  DEAD_LETTER: 'DEAD_LETTER',
});

const PAYMENT_TERMINAL_STATES = new Set([
  PAYMENT_STATES.SUCCESSFUL,
  PAYMENT_STATES.FAILED,
  PAYMENT_STATES.CANCELLED,
  PAYMENT_STATES.REVERSED,
  PAYMENT_STATES.EXPIRED,
  PAYMENT_STATES.DEAD_LETTER,
]);

const PAYMENT_FINAL_SUCCESS_STATES = new Set([
  PAYMENT_STATES.SUCCESSFUL,
]);

const PAYMENT_FINAL_FAILURE_STATES = new Set([
  PAYMENT_STATES.FAILED,
  PAYMENT_STATES.CANCELLED,
  PAYMENT_STATES.EXPIRED,
]);

/* ============================================================================
 * Valid State Transitions
 * ========================================================================== */

const PAYMENT_TRANSITIONS = Object.freeze({
  [PAYMENT_STATES.INITIATED]: Object.freeze([
    PAYMENT_STATES.PENDING,
    PAYMENT_STATES.PROCESSING,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.CANCELLED,
    PAYMENT_STATES.EXPIRED,
  ]),

  [PAYMENT_STATES.PENDING]: Object.freeze([
    PAYMENT_STATES.PROCESSING,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.CANCELLED,
    PAYMENT_STATES.EXPIRED,
    PAYMENT_STATES.UNKNOWN,
  ]),

  [PAYMENT_STATES.PROCESSING]: Object.freeze([
    PAYMENT_STATES.SUCCESSFUL,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.PENDING,
    PAYMENT_STATES.UNKNOWN,
  ]),

  [PAYMENT_STATES.SUCCESSFUL]: Object.freeze([
    PAYMENT_STATES.REVERSED,
  ]),

  [PAYMENT_STATES.FAILED]: Object.freeze([
    PAYMENT_STATES.RETRYING,
    PAYMENT_STATES.REQUIRES_RECONCILIATION,
  ]),

  [PAYMENT_STATES.CANCELLED]: Object.freeze([
    PAYMENT_STATES.REQUIRES_RECONCILIATION,
  ]),

  [PAYMENT_STATES.REVERSED]: Object.freeze([]),

  [PAYMENT_STATES.RETRYING]: Object.freeze([
    PAYMENT_STATES.PROCESSING,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.UNKNOWN,
  ]),

  [PAYMENT_STATES.UNKNOWN]: Object.freeze([
    PAYMENT_STATES.SUCCESSFUL,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.REQUIRES_RECONCILIATION,
  ]),

  [PAYMENT_STATES.REQUIRES_RECONCILIATION]: Object.freeze([
    PAYMENT_STATES.SUCCESSFUL,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.REVERSED,
  ]),

  [PAYMENT_STATES.EXPIRED]: Object.freeze([
    PAYMENT_STATES.REQUIRES_RECONCILIATION,
  ]),

  [PAYMENT_STATES.DEAD_LETTER]: Object.freeze([]),
});

/* ============================================================================
 * Transition Types
 * ========================================================================== */

const PAYMENT_TRANSITION_TYPES = Object.freeze({
  INITIATE: 'INITIATE_PAYMENT',
  PEND: 'PEND_PAYMENT',
  PROCESS: 'PROCESS_PAYMENT',
  COMPLETE: 'COMPLETE_PAYMENT',
  FAIL: 'FAIL_PAYMENT',
  CANCEL: 'CANCEL_PAYMENT',
  REVERSE: 'REVERSE_PAYMENT',
  RETRY: 'RETRY_PAYMENT',
  MARK_UNKNOWN: 'MARK_PAYMENT_UNKNOWN',
  RECONCILE: 'RECONCILE_PAYMENT',
  EXPIRE: 'EXPIRE_PAYMENT',
  DEAD_LETTER: 'DEAD_LETTER_PAYMENT',
});

/* ============================================================================
 * Error Codes
 * ========================================================================== */

const PAYMENT_STATE_ERROR_CODES = Object.freeze({
  INVALID_PAYMENT: 'INVALID_PAYMENT',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  INVALID_PAYMENT_ID: 'INVALID_PAYMENT_ID',

  INVALID_STATE: 'INVALID_PAYMENT_STATE',
  INVALID_STATE_TRANSITION: 'INVALID_PAYMENT_STATE_TRANSITION',

  TENANT_CONTEXT_REQUIRED: 'TENANT_CONTEXT_REQUIRED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',

  AUTHORIZATION_REQUIRED: 'AUTHORIZATION_REQUIRED',
  INVALID_ACTOR: 'INVALID_ACTOR',

  VERSION_REQUIRED: 'VERSION_REQUIRED',
  INVALID_VERSION: 'INVALID_VERSION',
  CONCURRENT_PAYMENT_UPDATE: 'CONCURRENT_PAYMENT_UPDATE',

  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  PROVIDER_REQUIRED: 'PAYMENT_PROVIDER_REQUIRED',
  PROVIDER_REFERENCE_REQUIRED: 'PROVIDER_REFERENCE_REQUIRED',
  PROVIDER_REFERENCE_MISMATCH: 'PROVIDER_REFERENCE_MISMATCH',

  AMOUNT_REQUIRED: 'PAYMENT_AMOUNT_REQUIRED',
  AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
  INVALID_AMOUNT: 'INVALID_PAYMENT_AMOUNT',

  CURRENCY_REQUIRED: 'PAYMENT_CURRENCY_REQUIRED',
  CURRENCY_MISMATCH: 'PAYMENT_CURRENCY_MISMATCH',

  UNKNOWN_OUTCOME: 'PAYMENT_OUTCOME_UNKNOWN',
  RECONCILIATION_REQUIRED: 'PAYMENT_RECONCILIATION_REQUIRED',

  REVERSAL_REFERENCE_REQUIRED: 'REVERSAL_PAYMENT_REFERENCE_REQUIRED',
  REVERSAL_NOT_ALLOWED: 'PAYMENT_REVERSAL_NOT_ALLOWED',
  ALREADY_REVERSED: 'PAYMENT_ALREADY_REVERSED',

  CANCELLATION_NOT_ALLOWED: 'PAYMENT_CANCELLATION_NOT_ALLOWED',
  EXPIRATION_NOT_ALLOWED: 'PAYMENT_EXPIRATION_NOT_ALLOWED',

  CALLBACK_STATUS_INVALID: 'INVALID_PROVIDER_PAYMENT_STATUS',
  FINANCIAL_POSTING_REQUIRED: 'FINANCIAL_POSTING_REQUIRED',

  REASON_REQUIRED: 'REASON_REQUIRED',

  PROVIDER_OPERATION_REQUIRED: 'PROVIDER_OPERATION_REQUIRED',
});

const DEFAULT_OPTIONS = Object.freeze({
  requireTenant: true,
  requireActor: true,

  requireIdempotencyForMutations: true,

  /**
   * High-integrity payment operations generally require an explicit reason
   * or deterministic reasonCode.
   */
  requireReasonForSensitiveTransitions: true,

  /**
   * In production, a repository with atomic versioned updates is expected.
   */
  strictMode: true,

  allowNoopTransitions: true,

  /**
   * A payment SUCCESSFUL transition requires authoritative provider/internal
   * confirmation. A verifier can be injected by PaymentService.
   */
  requireSuccessConfirmation: true,

  /**
   * A payment reversal should normally be linked to a distinct reversal
   * payment/financial operation.
   */
  requireReversalReference: true,

  /**
   * Prevent downgrade from terminal success by provider callbacks.
   */
  preventSuccessfulDowngrade: true,

  /**
   * A DEAD_LETTER state is infrastructure/recovery-only.
   */
  allowDeadLetter: false,

  freezePaymentObject: false,
});

/* ============================================================================
 * Sensitive Transitions
 * ========================================================================== */

const SENSITIVE_PAYMENT_TRANSITIONS = new Set([
  PAYMENT_STATES.SUCCESSFUL,
  PAYMENT_STATES.FAILED,
  PAYMENT_STATES.CANCELLED,
  PAYMENT_STATES.REVERSED,
  PAYMENT_STATES.UNKNOWN,
  PAYMENT_STATES.REQUIRES_RECONCILIATION,
  PAYMENT_STATES.EXPIRED,
]);

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function normalizeState(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const state = value.trim().toUpperCase();

  return Object.values(PAYMENT_STATES).includes(state)
    ? state
    : null;
}

function parseVersion(value) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed)
    || parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function clone(value) {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_error) {
      // Fall through.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function stableStringify(value) {
  if (
    value === null
    || value === undefined
  ) {
    return String(value);
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(',')}}`;
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
    )
    .digest('hex');
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function toPlainObject(value) {
  if (!value) {
    return value;
  }

  if (typeof value.toObject === 'function') {
    return value.toObject();
  }

  return value;
}

function normalizeProvider(value) {
  const provider = normalizeString(value);

  if (!provider) {
    return null;
  }

  return provider.toLowerCase();
}

function normalizeContext(rawContext = {}) {
  return {
    actorId: normalizeString(rawContext.actorId),
    actorType:
      normalizeString(rawContext.actorType)
      || 'USER',

    actorRole:
      normalizeString(rawContext.actorRole),

    tenantId:
      normalizeString(rawContext.tenantId),

    requestId:
      normalizeString(rawContext.requestId),

    correlationId:
      normalizeString(rawContext.correlationId),

    causationId:
      normalizeString(rawContext.causationId),

    idempotencyKey:
      normalizeString(rawContext.idempotencyKey),

    reason:
      normalizeString(rawContext.reason),

    reasonCode:
      normalizeString(rawContext.reasonCode),

    source:
      normalizeString(rawContext.source)
      || 'APPLICATION',

    provider:
      normalizeProvider(rawContext.provider),

    providerTransactionId:
      normalizeString(rawContext.providerTransactionId),

    providerEventId:
      normalizeString(rawContext.providerEventId),

    providerStatus:
      normalizeString(rawContext.providerStatus),

    providerTimestamp:
      rawContext.providerTimestamp || null,

    providerConfirmed:
      rawContext.providerConfirmed === true,

    providerFailed:
      rawContext.providerFailed === true,

    financialTransactionId:
      normalizeString(rawContext.financialTransactionId),

    financialPostingReference:
      normalizeString(
        rawContext.financialPostingReference,
      ),

    reversalPaymentId:
      normalizeString(rawContext.reversalPaymentId),

    expectedVersion:
      parseVersion(rawContext.expectedVersion),

    isRetry:
      rawContext.isRetry === true,

    fromCallback:
      rawContext.fromCallback === true,

    allowProviderEvidence:
      rawContext.allowProviderEvidence !== false,

    persistenceContext:
      rawContext.persistenceContext || null,

    metadata:
      rawContext.metadata
      && typeof rawContext.metadata === 'object'
        ? clone(rawContext.metadata)
        : {},
  };
}

function isTerminal(state) {
  return PAYMENT_TERMINAL_STATES.has(state);
}

function isFinalSuccess(state) {
  return PAYMENT_FINAL_SUCCESS_STATES.has(state);
}

function isFinalFailure(state) {
  return PAYMENT_FINAL_FAILURE_STATES.has(state);
}

function isValidTransition(fromState, toState) {
  if (
    !fromState
    || !toState
  ) {
    return false;
  }

  return (
    PAYMENT_TRANSITIONS[fromState]
    && PAYMENT_TRANSITIONS[fromState].includes(toState)
  );
}

function normalizePaymentId(value) {
  if (
    value
    && typeof value === 'object'
    && typeof value.toString === 'function'
  ) {
    value = value.toString();
  }

  const id = normalizeString(value);

  if (!id) {
    throw new PaymentStateMachineError(
      'A valid payment identifier is required.',
      {
        code: PAYMENT_STATE_ERROR_CODES.INVALID_PAYMENT_ID,
        statusCode: 400,
      },
    );
  }

  /**
   * Support common IDs while avoiding unrestricted/empty values.
   */
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/.test(id)
  ) {
    throw new PaymentStateMachineError(
      'Invalid payment identifier.',
      {
        code: PAYMENT_STATE_ERROR_CODES.INVALID_PAYMENT_ID,
        statusCode: 400,
        details: {
          paymentId: '[REDACTED]',
        },
      },
    );
  }

  return id;
}

function normalizeAmount(value) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  /**
   * Preserve decimal/string representations. Do not use float arithmetic.
   */
  if (
    typeof value === 'string'
    || typeof value === 'number'
  ) {
    return String(value);
  }

  if (
    value
    && typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return null;
}

function normalizeHashInput(payment, targetState, context) {
  return {
    paymentId: payment.id,
    tenantId: payment.tenantId,
    currentState: payment.status,
    targetState,

    paymentType:
      payment.type
      || payment.paymentType
      || null,

    direction:
      payment.direction
      || null,

    amount:
      normalizeAmount(payment.amount),

    currency:
      payment.currency || null,

    provider:
      payment.provider || context.provider || null,

    providerTransactionId:
      payment.providerTransactionId
      || context.providerTransactionId
      || null,

    idempotencyKey:
      context.idempotencyKey
      || null,

    sourceType:
      payment.sourceType || null,

    sourceId:
      payment.sourceId || null,
  };
}

function createRequestHash(payment, targetState, context) {
  return sha256(
    normalizeHashInput(
      payment,
      targetState,
      context,
    ),
  );
}

function createTransitionId(
  paymentId,
  fromState,
  toState,
  context,
) {
  const seed = [
    paymentId,
    fromState || 'NULL',
    toState,
    context.idempotencyKey || '',
    context.providerEventId || '',
    context.requestId || '',
    isoNow(),
    crypto.randomUUID(),
  ].join('|');

  return `payment_transition_${sha256(seed).slice(0, 32)}`;
}

function createTransitionFingerprint({
  payment,
  toState,
  transition,
  context,
}) {
  return sha256({
    paymentId: payment.id,
    tenantId: context.tenantId,
    fromState: payment.status,
    toState,
    transition,
    idempotencyKey:
      context.idempotencyKey || null,
    providerEventId:
      context.providerEventId || null,
    providerTransactionId:
      context.providerTransactionId
      || payment.providerTransactionId
      || null,
    requestId:
      context.requestId || null,
  });
}

/* ============================================================================
 * Error Class
 * ========================================================================== */

class PaymentStateMachineError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'PaymentStateMachineError';

    this.code =
      options.code
      || PAYMENT_STATE_ERROR_CODES.INVALID_STATE_TRANSITION;

    this.statusCode =
      Number.isInteger(options.statusCode)
        ? options.statusCode
        : 400;

    this.details = options.details || {};

    this.paymentId =
      options.paymentId || null;

    this.tenantId =
      options.tenantId || null;

    this.fromState =
      options.fromState || null;

    this.toState =
      options.toState || null;

    this.transition =
      options.transition || null;

    if (options.cause) {
      this.cause = options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentStateMachineError,
    );
  }
}

/* ============================================================================
 * In-Memory Idempotency Store
 * ========================================================================== */

class InMemoryPaymentIdempotencyStore {
  constructor() {
    this.records = new Map();
  }

  _key(tenantId, key) {
    return `${tenantId || 'global'}:${key}`;
  }

  async get(tenantId, key) {
    return (
      this.records.get(
        this._key(tenantId, key),
      )
      || null
    );
  }

  async create(record) {
    const key =
      this._key(
        record.tenantId,
        record.key,
      );

    if (this.records.has(key)) {
      return clone(
        this.records.get(key),
      );
    }

    this.records.set(
      key,
      clone(record),
    );

    return clone(record);
  }

  async set(record) {
    const key =
      this._key(
        record.tenantId,
        record.key,
      );

    this.records.set(
      key,
      clone(record),
    );

    return clone(record);
  }

  async clear() {
    this.records.clear();
  }
}

/* ============================================================================
 * Payment State Machine
 * ========================================================================== */

class PaymentStateMachine {
  /**
   * @param {Object} dependencies
   *
   * @param {Object} dependencies.paymentRepository
   * @param {Object} dependencies.idempotencyStore
   * @param {Object} dependencies.auditService
   * @param {Object} dependencies.eventPublisher
   * @param {Object} dependencies.logger
   *
   * @param {Function} dependencies.providerConfirmationVerifier
   *   Optional function that verifies authoritative provider/payment evidence.
   *
   * @param {Function} dependencies.financialPostingVerifier
   *   Optional function that verifies whether the financial effect associated
   *   with payment success has been authoritatively posted.
   *
   * @param {Function} dependencies.transitionGuard
   *   Optional application-specific guard.
   */
  constructor(dependencies = {}) {
    this.paymentRepository =
      dependencies.paymentRepository || null;

    this.idempotencyStore =
      dependencies.idempotencyStore
      || new InMemoryPaymentIdempotencyStore();

    this.auditService =
      dependencies.auditService || null;

    this.eventPublisher =
      dependencies.eventPublisher || null;

    this.logger =
      dependencies.logger || console;

    this.providerConfirmationVerifier =
      typeof dependencies.providerConfirmationVerifier === 'function'
        ? dependencies.providerConfirmationVerifier
        : null;

    this.financialPostingVerifier =
      typeof dependencies.financialPostingVerifier === 'function'
        ? dependencies.financialPostingVerifier
        : null;

    this.transitionGuard =
      typeof dependencies.transitionGuard === 'function'
        ? dependencies.transitionGuard
        : null;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });
  }

  /* ==========================================================================
   * Public Metadata API
   * ======================================================================== */

  getStates() {
    return Object.freeze({
      ...PAYMENT_STATES,
    });
  }

  getTransitionMap() {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(
          PAYMENT_TRANSITIONS,
        ).map(
          ([state, targets]) => [
            state,
            [...targets],
          ],
        ),
      ),
    );
  }

  getAllowedTransitions(paymentOrState) {
    const state =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    if (!state) {
      throw new PaymentStateMachineError(
        'Invalid payment state.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES.INVALID_STATE,
          statusCode: 400,
        },
      );
    }

    return [
      ...(PAYMENT_TRANSITIONS[state] || []),
    ];
  }

  canTransition(
    paymentOrState,
    targetState,
  ) {
    const currentState =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    const nextState =
      normalizeState(targetState);

    if (
      !currentState
      || !nextState
    ) {
      return false;
    }

    if (
      this.options.allowNoopTransitions
      && currentState === nextState
    ) {
      return true;
    }

    return isValidTransition(
      currentState,
      nextState,
    );
  }

  describe(paymentOrState) {
    const state =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    if (!state) {
      throw new PaymentStateMachineError(
        'Invalid payment state.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES.INVALID_STATE,
          statusCode: 400,
        },
      );
    }

    return {
      state,

      terminal:
        isTerminal(state),

      successful:
        isFinalSuccess(state),

      failed:
        isFinalFailure(state),

      mutable:
        !PAYMENT_FINAL_SUCCESS_STATES.has(state)
        && state !== PAYMENT_STATES.REVERSED,

      allowedTransitions:
        this.getAllowedTransitions(state),
    };
  }

  isTerminal(paymentOrState) {
    const state =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    return state
      ? isTerminal(state)
      : false;
  }

  isSuccessful(paymentOrState) {
    const state =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    return state
      ? isFinalSuccess(state)
      : false;
  }

  isFailed(paymentOrState) {
    const state =
      typeof paymentOrState === 'string'
        ? normalizeState(paymentOrState)
        : normalizeState(
            paymentOrState?.status
            || paymentOrState?.state,
          );

    return state
      ? isFinalFailure(state)
      : false;
  }

  /* ==========================================================================
   * Validation API
   * ======================================================================== */

  async validateTransition(
    payment,
    targetState,
    rawContext = {},
  ) {
    const context =
      normalizeContext(rawContext);

    const normalizedPayment =
      this._normalizePayment(payment);

    const nextState =
      this._assertTargetState(
        targetState,
      );

    await this._validatePaymentContext(
      normalizedPayment,
      nextState,
      context,
    );

    await this._validateStructuralTransition(
      normalizedPayment,
      nextState,
      context,
    );

    await this._runCustomGuard(
      normalizedPayment,
      nextState,
      context,
    );

    await this._runTransitionGuards(
      normalizedPayment,
      nextState,
      context,
    );

    return {
      valid: true,

      paymentId:
        normalizedPayment.id,

      fromState:
        normalizedPayment.status,

      toState:
        nextState,

      tenantId:
        context.tenantId,
    };
  }

  /* ==========================================================================
   * Primary Transition API
   * ======================================================================== */

  async transition(
    paymentOrId,
    targetState,
    rawContext = {},
  ) {
    const context =
      normalizeContext(rawContext);

    const payment =
      await this._resolvePayment(
        paymentOrId,
      );

    const normalizedPayment =
      this._normalizePayment(
        payment,
      );

    const nextState =
      this._assertTargetState(
        targetState,
      );

    await this._validatePaymentContext(
      normalizedPayment,
      nextState,
      context,
    );

    /**
     * Check idempotency before executing the transition.
     */
    const idempotency =
      await this._checkIdempotency(
        normalizedPayment,
        nextState,
        context,
      );

    if (idempotency.replay) {
      return idempotency.result;
    }

    /**
     * Safe no-op.
     */
    if (
      this.options.allowNoopTransitions
      && normalizedPayment.status === nextState
    ) {
      const result =
        this._buildNoopResult(
          normalizedPayment,
          context,
        );

      await this._persistIdempotencyResult(
        normalizedPayment,
        nextState,
        context,
        result,
        idempotency,
      );

      return result;
    }

    await this._validateStructuralTransition(
      normalizedPayment,
      nextState,
      context,
    );

    await this._runCustomGuard(
      normalizedPayment,
      nextState,
      context,
    );

    await this._runTransitionGuards(
      normalizedPayment,
      nextState,
      context,
    );

    const transition =
      this._resolveTransitionType(
        normalizedPayment.status,
        nextState,
        context,
      );

    const transitionId =
      createTransitionId(
        normalizedPayment.id,
        normalizedPayment.status,
        nextState,
        context,
      );

    const requestHash =
      createRequestHash(
        normalizedPayment,
        nextState,
        context,
      );

    const fingerprint =
      createTransitionFingerprint({
        payment:
          normalizedPayment,
        toState:
          nextState,
        transition,
        context,
      });

    const transitionRecord =
      this._buildTransitionRecord({
        payment:
          normalizedPayment,
        targetState:
          nextState,
        transition,
        transitionId,
        requestHash,
        fingerprint,
        context,
      });

    const persisted =
      await this._persistTransition(
        normalizedPayment,
        nextState,
        transitionRecord,
        context,
      );

    const result =
      this._buildResult(
        normalizedPayment,
        nextState,
        transitionRecord,
        persisted,
      );

    /**
     * Persist outbox/audit through the repository where supported.
     *
     * If the application relies on a database transaction, the repository
     * implementation should persist the state transition, history, audit,
     * and outbox atomically.
     */
    await this._recordAudit(
      transitionRecord,
      normalizedPayment,
      nextState,
      context,
    );

    await this._publishTransitionEvent(
      transitionRecord,
      normalizedPayment,
      nextState,
      context,
    );

    await this._persistIdempotencyResult(
      normalizedPayment,
      nextState,
      context,
      result,
      idempotency,
    );

    return result;
  }

  /* ==========================================================================
   * Convenience Transition Methods
   * ======================================================================== */

  async initiate(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.INITIATED,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_INITIATED',
      },
    );
  }

  async pend(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.PENDING,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_PENDING',
      },
    );
  }

  async process(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.PROCESSING,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_PROCESSING',
      },
    );
  }

  /**
   * Mark payment successful.
   *
   * Important:
   * - Provider/payment confirmation must be authoritative.
   * - This does NOT itself post the ledger.
   * - The Finance/Transaction layer must process the associated financial
   *   transaction separately.
   */
  async succeed(
    paymentOrId,
    rawContext = {},
  ) {
    const context =
      normalizeContext({
        ...rawContext,
        providerConfirmed:
          rawContext.providerConfirmed === true
            || rawContext.fromCallback === true,
      });

    return this.transition(
      paymentOrId,
      PAYMENT_STATES.SUCCESSFUL,
      context,
    );
  }

  async fail(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.FAILED,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_FAILED',
      },
    );
  }

  async cancel(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.CANCELLED,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_CANCELLED',
      },
    );
  }

  async retry(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.RETRYING,
      {
        ...rawContext,
        isRetry: true,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_RETRY',
      },
    );
  }

  async markUnknown(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.UNKNOWN,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_OUTCOME_UNKNOWN',
      },
    );
  }

  async requireReconciliation(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.REQUIRES_RECONCILIATION,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_RECONCILIATION_REQUIRED',
      },
    );
  }

  async expire(
    paymentOrId,
    rawContext = {},
  ) {
    return this.transition(
      paymentOrId,
      PAYMENT_STATES.EXPIRED,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_EXPIRED',
      },
    );
  }

  /**
   * Reverse a successful payment.
   *
   * The reversalPaymentId must refer to a distinct compensating payment
   * operation. The actual financial compensation belongs to the finance
   * layer.
   */
  async reverse(
    paymentOrId,
    rawContext = {},
  ) {
    const context =
      normalizeContext(rawContext);

    if (
      this.options.requireReversalReference
      && !context.reversalPaymentId
    ) {
      throw new PaymentStateMachineError(
        'A reversal payment reference is required.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .REVERSAL_REFERENCE_REQUIRED,
          statusCode: 400,
          paymentId:
            this._safePaymentId(
              paymentOrId,
            ),
          tenantId:
            context.tenantId,
        },
      );
    }

    return this.transition(
      paymentOrId,
      PAYMENT_STATES.REVERSED,
      {
        ...rawContext,
        reasonCode:
          rawContext.reasonCode
          || 'PAYMENT_REVERSED',
      },
    );
  }

  /**
   * DEAD_LETTER is recovery infrastructure state, not a normal payment
   * business state.
   */
  async deadLetter(
    paymentOrId,
    rawContext = {},
  ) {
    if (!this.options.allowDeadLetter) {
      throw new PaymentStateMachineError(
        'Payment DEAD_LETTER transitions are disabled by policy.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 403,
          paymentId:
            this._safePaymentId(
              paymentOrId,
            ),
        },
      );
    }

    const context =
      normalizeContext(rawContext);

    return this._transitionOperationalState(
      paymentOrId,
      PAYMENT_STATES.DEAD_LETTER,
      {
        ...context,
        reasonCode:
          context.reasonCode
          || 'PAYMENT_DEAD_LETTERED',
      },
    );
  }

  /* ==========================================================================
   * Provider Callback Helpers
   * ======================================================================== */

  /**
   * Apply a normalized provider callback result to payment state.
   *
   * This method intentionally does NOT perform:
   *   - provider signature validation
   *   - raw-body verification
   *   - ledger posting
   *
   * Those concerns belong to the callback security and financial layers.
   */
  async applyProviderResult(
    paymentOrId,
    providerResult = {},
    rawContext = {},
  ) {
    const providerStatus =
      normalizeString(
        providerResult.status
        || providerResult.providerStatus,
      );

    const normalizedStatus =
      this._normalizeProviderStatus(
        providerStatus,
      );

    const context =
      normalizeContext({
        ...rawContext,

        provider:
          providerResult.provider
          || rawContext.provider,

        providerTransactionId:
          providerResult.providerTransactionId
          || providerResult.transactionReference
          || rawContext.providerTransactionId,

        providerEventId:
          providerResult.providerEventId
          || providerResult.eventId
          || rawContext.providerEventId,

        providerStatus:
          providerStatus
          || rawContext.providerStatus,

        providerConfirmed:
          providerResult.confirmed === true
          || normalizedStatus === 'SUCCESS',

        providerFailed:
          providerResult.failed === true
          || normalizedStatus === 'FAILED',

        providerTimestamp:
          providerResult.timestamp
          || providerResult.occurredAt
          || rawContext.providerTimestamp,

        fromCallback:
          true,

        metadata: {
          ...(rawContext.metadata || {}),
          providerResult:
            this._sanitizeProviderMetadata(
              providerResult,
            ),
        },
      });

    await this._validateProviderCorrelation(
      paymentOrId,
      providerResult,
      context,
    );

    switch (normalizedStatus) {
      case 'SUCCESS':
        return this.succeed(
          paymentOrId,
          context,
        );

      case 'FAILED':
        return this.fail(
          paymentOrId,
          context,
        );

      case 'PENDING':
        return this.pend(
          paymentOrId,
          context,
        );

      case 'CANCELLED':
        return this.cancel(
          paymentOrId,
          context,
        );

      case 'REVERSED':
        return this.reverse(
          paymentOrId,
          {
            ...context,
            reversalPaymentId:
              providerResult.reversalPaymentId
              || context.reversalPaymentId,
          },
        );

      default:
        return this.markUnknown(
          paymentOrId,
          {
            ...context,
            reasonCode:
              'UNSUPPORTED_PROVIDER_STATUS',
          },
        );
    }
  }

  _normalizeProviderStatus(status) {
    if (!status) {
      return null;
    }

    const value = String(status)
      .trim()
      .toUpperCase();

    /**
     * Provider adapters should normally normalize this before calling the
     * state machine. These aliases provide a conservative final boundary.
     */
    if (
      [
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'COMPLETE',
        'PAID',
      ].includes(value)
    ) {
      return 'SUCCESS';
    }

    if (
      [
        'FAILED',
        'FAILURE',
        'DECLINED',
        'REJECTED',
        'ERROR',
      ].includes(value)
    ) {
      return 'FAILED';
    }

    if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'INITIATED',
      ].includes(value)
    ) {
      return 'PENDING';
    }

    if (
      [
        'CANCELLED',
        'CANCELED',
      ].includes(value)
    ) {
      return 'CANCELLED';
    }

    if (
      [
        'REVERSED',
        'REVERSAL',
      ].includes(value)
    ) {
      return 'REVERSED';
    }

    return null;
  }

  async _validateProviderCorrelation(
    paymentOrId,
    providerResult,
    context,
  ) {
    const payment =
      await this._resolvePayment(
        paymentOrId,
      );

    const normalizedPayment =
      this._normalizePayment(payment);

    if (
      context.provider
      && normalizedPayment.provider
      && normalizeProvider(
        normalizedPayment.provider,
      ) !== normalizeProvider(
        context.provider,
      )
    ) {
      throw new PaymentStateMachineError(
        'Provider does not match the payment provider.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .PROVIDER_REFERENCE_MISMATCH,
          statusCode: 409,
          paymentId:
            normalizedPayment.id,
          tenantId:
            context.tenantId,
          details: {
            expectedProvider:
              normalizedPayment.provider,
          },
        },
      );
    }

    if (
      context.providerTransactionId
      && normalizedPayment.providerTransactionId
      && context.providerTransactionId
        !== normalizedPayment.providerTransactionId
    ) {
      throw new PaymentStateMachineError(
        'Provider transaction reference does not match the payment.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .PROVIDER_REFERENCE_MISMATCH,
          statusCode: 409,
          paymentId:
            normalizedPayment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Amount/currency validation belongs here as a final domain boundary.
     */
    if (
      providerResult.amount !== undefined
      && providerResult.amount !== null
    ) {
      const internalAmount =
        normalizeAmount(
          normalizedPayment.amount,
        );

      const providerAmount =
        normalizeAmount(
          providerResult.amount,
        );

      if (
        internalAmount
        && providerAmount
        && internalAmount !== providerAmount
      ) {
        throw new PaymentStateMachineError(
          'Provider payment amount does not match the internal payment amount.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .AMOUNT_MISMATCH,
            statusCode: 409,
            paymentId:
              normalizedPayment.id,
            tenantId:
              context.tenantId,
            details: {
              expectedAmount:
                internalAmount,
              receivedAmount:
                providerAmount,
            },
          },
        );
      }
    }

    if (
      providerResult.currency
      && normalizedPayment.currency
      && String(providerResult.currency)
        .trim()
        .toUpperCase()
        !== String(normalizedPayment.currency)
          .trim()
          .toUpperCase()
    ) {
      throw new PaymentStateMachineError(
        'Provider payment currency does not match the internal payment currency.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .CURRENCY_MISMATCH,
          statusCode: 409,
          paymentId:
            normalizedPayment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Internal Validation
   * ======================================================================== */

  async _validatePaymentContext(
    payment,
    targetState,
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new PaymentStateMachineError(
        'Tenant context is required for payment state transitions.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .TENANT_CONTEXT_REQUIRED,
          statusCode: 403,
          paymentId:
            payment.id,
        },
      );
    }

    if (
      this.options.requireTenant
      && payment.tenantId
      && payment.tenantId !== context.tenantId
    ) {
      throw new PaymentStateMachineError(
        'Payment does not belong to the current tenant.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .TENANT_MISMATCH,
          statusCode: 403,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          details: {
            paymentTenantId:
              payment.tenantId,
          },
        },
      );
    }

    if (
      this.options.requireActor
      && !context.actorId
    ) {
      throw new PaymentStateMachineError(
        'An authenticated actor is required.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_ACTOR,
          statusCode: 403,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requireIdempotencyForMutations
      && this._requiresIdempotency(
        payment,
        targetState,
      )
      && !context.idempotencyKey
    ) {
      /**
       * Provider callbacks can use providerEventId as an idempotent identity
       * when the callback pipeline has already authenticated the event.
       */
      const callbackIdentity =
        context.fromCallback
        && (
          context.providerEventId
          || context.providerTransactionId
        );

      if (!callbackIdentity) {
        throw new PaymentStateMachineError(
          'An idempotency key or authenticated provider event identity is required.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .IDEMPOTENCY_KEY_REQUIRED,
            statusCode: 400,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }

    if (
      this.options.requireReasonForSensitiveTransitions
      && SENSITIVE_PAYMENT_TRANSITIONS.has(
        targetState,
      )
      && !context.reason
      && !context.reasonCode
    ) {
      const automatedActor =
        [
          'SYSTEM',
          'SERVICE',
          'WORKER',
          'PROVIDER',
        ].includes(
          String(context.actorType)
            .toUpperCase(),
        );

      if (!automatedActor) {
        throw new PaymentStateMachineError(
          'A reason or reason code is required.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .REASON_REQUIRED,
            statusCode: 400,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }
  }

  _requiresIdempotency(
    payment,
    targetState,
  ) {
    return [
      PAYMENT_STATES.PROCESSING,
      PAYMENT_STATES.SUCCESSFUL,
      PAYMENT_STATES.FAILED,
      PAYMENT_STATES.CANCELLED,
      PAYMENT_STATES.REVERSED,
      PAYMENT_STATES.RETRYING,
      PAYMENT_STATES.UNKNOWN,
      PAYMENT_STATES.REQUIRES_RECONCILIATION,
      PAYMENT_STATES.EXPIRED,
    ].includes(targetState);
  }

  async _validateStructuralTransition(
    payment,
    targetState,
    context,
  ) {
    const currentState =
      payment.status;

    if (!currentState) {
      throw new PaymentStateMachineError(
        'Payment current state is missing.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE,
          statusCode: 400,
          paymentId:
            payment.id,
        },
      );
    }

    if (
      this.options.allowNoopTransitions
      && currentState === targetState
    ) {
      return;
    }

    if (
      !isValidTransition(
        currentState,
        targetState,
      )
    ) {
      throw new PaymentStateMachineError(
        `Payment transition ${currentState} -> ${targetState} is not permitted.`,
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          fromState:
            currentState,
          toState:
            targetState,
          details: {
            allowedTransitions:
              this.getAllowedTransitions(
                currentState,
              ),
          },
        },
      );
    }

    /**
     * Successful payments may only be reversed, never downgraded.
     */
    if (
      this.options.preventSuccessfulDowngrade
      && currentState === PAYMENT_STATES.SUCCESSFUL
      && targetState !== PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A successful payment cannot be downgraded to an earlier state.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          fromState:
            currentState,
          toState:
            targetState,
        },
      );
    }
  }

  async _runCustomGuard(
    payment,
    targetState,
    context,
  ) {
    if (!this.transitionGuard) {
      return;
    }

    try {
      const result =
        await this.transitionGuard({
          payment:
            clone(payment),

          fromState:
            payment.status,

          toState:
            targetState,

          context:
            clone(context),
        });

      if (result === false) {
        throw new PaymentStateMachineError(
          'Custom payment transition guard rejected the operation.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .INVALID_STATE_TRANSITION,
            statusCode: 409,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    } catch (error) {
      if (
        error
        instanceof PaymentStateMachineError
      ) {
        throw error;
      }

      throw new PaymentStateMachineError(
        'Payment transition guard failed.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          cause:
            error,
        },
      );
    }
  }

  async _runTransitionGuards(
    payment,
    targetState,
    context,
  ) {
    switch (targetState) {
      case PAYMENT_STATES.SUCCESSFUL:
        await this._guardSuccessful(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.FAILED:
        await this._guardFailed(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.CANCELLED:
        await this._guardCancelled(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.REVERSED:
        await this._guardReversed(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.UNKNOWN:
        await this._guardUnknown(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.REQUIRES_RECONCILIATION:
        await this._guardReconciliation(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.RETRYING:
        await this._guardRetrying(
          payment,
          context,
        );
        break;

      case PAYMENT_STATES.EXPIRED:
        await this._guardExpired(
          payment,
          context,
        );
        break;

      default:
        break;
    }
  }

  async _guardSuccessful(
    payment,
    context,
  ) {
    if (
      payment.status === PAYMENT_STATES.SUCCESSFUL
    ) {
      return;
    }

    if (
      this.options.requireSuccessConfirmation
      && !context.providerConfirmed
      && !context.financialTransactionId
    ) {
      if (this.providerConfirmationVerifier) {
        const verified =
          await this.providerConfirmationVerifier({
            payment:
              clone(payment),
            context:
              clone(context),
          });

        if (!verified) {
          throw new PaymentStateMachineError(
            'Payment cannot become SUCCESSFUL without authoritative confirmation.',
            {
              code:
                PAYMENT_STATE_ERROR_CODES
                  .PROVIDER_OPERATION_REQUIRED,
              statusCode: 409,
              paymentId:
                payment.id,
              tenantId:
                context.tenantId,
            },
          );
        }
      } else {
        throw new PaymentStateMachineError(
          'Payment success requires authoritative provider or internal confirmation.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .PROVIDER_OPERATION_REQUIRED,
            statusCode: 409,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }

    this._validatePaymentFinancialIdentity(
      payment,
      context,
    );
  }

  async _guardFailed(
    payment,
    context,
  ) {
    if (
      payment.status === PAYMENT_STATES.SUCCESSFUL
      || payment.status === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A finalized payment cannot be changed to FAILED.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardCancelled(
    payment,
    context,
  ) {
    if (
      payment.status === PAYMENT_STATES.SUCCESSFUL
      || payment.status === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A finalized payment cannot be cancelled.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .CANCELLATION_NOT_ALLOWED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * If the operation has provider execution identity but no conclusive
     * provider result, cancellation may be unsafe.
     */
    if (
      payment.status === PAYMENT_STATES.PROCESSING
      && (
        payment.providerTransactionId
        || context.providerTransactionId
      )
      && !context.providerFailed
      && this.options.strictMode
    ) {
      throw new PaymentStateMachineError(
        'A processing payment with an external provider operation requires provider confirmation before cancellation.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .CANCELLATION_NOT_ALLOWED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardReversed(
    payment,
    context,
  ) {
    if (
      payment.status !== PAYMENT_STATES.SUCCESSFUL
    ) {
      throw new PaymentStateMachineError(
        'Only SUCCESSFUL payments can normally be reversed.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .REVERSAL_NOT_ALLOWED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          fromState:
            payment.status,
        },
      );
    }

    if (
      payment.reversedAt
      || payment.reversalPaymentId
    ) {
      throw new PaymentStateMachineError(
        'Payment has already been reversed.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .ALREADY_REVERSED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requireReversalReference
      && !context.reversalPaymentId
    ) {
      throw new PaymentStateMachineError(
        'A reversal payment reference is required.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .REVERSAL_REFERENCE_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardUnknown(
    payment,
    context,
  ) {
    if (
      isFinalSuccess(payment.status)
      || payment.status === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A finalized payment cannot become UNKNOWN.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    const hasExternalOperation =
      Boolean(
        payment.provider
        || payment.providerTransactionId
        || context.provider
        || context.providerTransactionId,
      );

    if (
      this.options.strictMode
      && !hasExternalOperation
    ) {
      throw new PaymentStateMachineError(
        'UNKNOWN state requires an unresolved external/payment execution context.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .UNKNOWN_OUTCOME,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardReconciliation(
    payment,
    context,
  ) {
    if (
      payment.status === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A reversed payment does not need a normal reconciliation-required transition.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .RECONCILIATION_REQUIRED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardRetrying(
    payment,
    context,
  ) {
    if (
      payment.status !== PAYMENT_STATES.FAILED
      && payment.status !== PAYMENT_STATES.UNKNOWN
    ) {
      throw new PaymentStateMachineError(
        'Payment may only enter RETRYING from FAILED or UNKNOWN.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          fromState:
            payment.status,
        },
      );
    }

    if (!context.isRetry) {
      throw new PaymentStateMachineError(
        'Retry context is required for RETRYING.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE_TRANSITION,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _guardExpired(
    payment,
    context,
  ) {
    if (
      payment.status === PAYMENT_STATES.SUCCESSFUL
      || payment.status === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentStateMachineError(
        'A finalized payment cannot be expired.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .EXPIRATION_NOT_ALLOWED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      payment.providerTransactionId
      && payment.status === PAYMENT_STATES.PROCESSING
      && this.options.strictMode
    ) {
      throw new PaymentStateMachineError(
        'A processing provider-backed payment requires outcome reconciliation before expiration.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .EXPIRATION_NOT_ALLOWED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  _validatePaymentFinancialIdentity(
    payment,
    context,
  ) {
    if (
      normalizeAmount(
        payment.amount,
      ) === null
    ) {
      throw new PaymentStateMachineError(
        'A payment amount is required.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .AMOUNT_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (!payment.currency) {
      throw new PaymentStateMachineError(
        'Payment currency is required.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .CURRENCY_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      payment.amount !== undefined
      && payment.amount !== null
      && payment.amount !== ''
    ) {
      const amount =
        normalizeAmount(
          payment.amount,
        );

      /**
       * Reject clearly malformed/negative values without floating-point
       * arithmetic.
       */
      if (
        amount === null
        || !/^\d+(\.\d+)?$/.test(
          amount,
        )
      ) {
        throw new PaymentStateMachineError(
          'Invalid payment amount.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .INVALID_AMOUNT,
            statusCode: 400,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }

      if (
        /^0+(\.0+)?$/.test(
          amount,
        )
      ) {
        throw new PaymentStateMachineError(
          'Payment amount must be greater than zero.',
          {
            code:
              PAYMENT_STATE_ERROR_CODES
                .INVALID_AMOUNT,
            statusCode: 400,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }
  }

  /* ==========================================================================
   * Payment Resolution / Normalization
   * ======================================================================== */

  async _resolvePayment(
    paymentOrId,
  ) {
    if (
      paymentOrId
      && typeof paymentOrId === 'object'
      && !Array.isArray(paymentOrId)
    ) {
      return paymentOrId;
    }

    const paymentId =
      normalizePaymentId(
        paymentOrId,
      );

    if (!this.paymentRepository) {
      throw new PaymentStateMachineError(
        'Payment repository is required when resolving a payment by ID.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 404,
          paymentId,
        },
      );
    }

    let payment = null;

    if (
      typeof this.paymentRepository
        .getById === 'function'
    ) {
      payment =
        await this.paymentRepository.getById(
          paymentId,
        );
    } else if (
      typeof this.paymentRepository
        .findById === 'function'
    ) {
      payment =
        await this.paymentRepository.findById(
          paymentId,
        );
    }

    if (!payment) {
      throw new PaymentStateMachineError(
        'Payment not found.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 404,
          paymentId,
        },
      );
    }

    return payment;
  }

  _normalizePayment(
    payment,
  ) {
    if (
      !payment
      || typeof payment !== 'object'
    ) {
      throw new PaymentStateMachineError(
        'Invalid payment object.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_PAYMENT,
          statusCode: 400,
        },
      );
    }

    const plain =
      toPlainObject(
        payment,
      );

    const rawId =
      plain.id
      ?? plain._id;

    const id =
      normalizePaymentId(
        rawId,
      );

    const status =
      normalizeState(
        plain.status
        ?? plain.state,
      );

    if (!status) {
      throw new PaymentStateMachineError(
        'Payment has an invalid state.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE,
          statusCode: 400,
          paymentId:
            id,
        },
      );
    }

    const version =
      parseVersion(
        plain.version,
      )
      ?? parseVersion(
        plain.__v,
      )
      ?? 0;

    return {
      ...plain,

      id,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      status,

      version,

      type:
        normalizeString(
          plain.type
          || plain.paymentType,
        ),

      paymentType:
        normalizeString(
          plain.paymentType
          || plain.type,
        ),

      direction:
        normalizeString(
          plain.direction,
        ),

      amount:
        plain.amount,

      currency:
        normalizeString(
          plain.currency,
        ),

      provider:
        normalizeProvider(
          plain.provider,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          plain.providerEventId,
        ),

      reference:
        normalizeString(
          plain.reference
          || plain.paymentReference,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference
          || plain.reference,
        ),

      sourceType:
        normalizeString(
          plain.sourceType,
        ),

      sourceId:
        normalizeString(
          plain.sourceId,
        ),

      financialTransactionId:
        normalizeString(
          plain.financialTransactionId,
        ),

      reversalPaymentId:
        normalizeString(
          plain.reversalPaymentId,
        ),

      reversedAt:
        plain.reversedAt
        || null,
    };
  }

  _safePaymentId(
    paymentOrId,
  ) {
    try {
      if (
        paymentOrId
        && typeof paymentOrId === 'object'
      ) {
        const raw =
          paymentOrId.id
          ?? paymentOrId._id;

        if (
          raw
          && typeof raw.toString === 'function'
        ) {
          return raw.toString();
        }

        return raw || null;
      }

      return paymentOrId || null;
    } catch (_error) {
      return null;
    }
  }

  _assertTargetState(
    targetState,
  ) {
    const normalized =
      normalizeState(
        targetState,
      );

    if (!normalized) {
      throw new PaymentStateMachineError(
        'Invalid payment target state.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_STATE,
          statusCode: 400,
          details: {
            targetState,
          },
        },
      );
    }

    return normalized;
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _checkIdempotency(
    payment,
    targetState,
    context,
  ) {
    const key =
      context.idempotencyKey
      || (
        context.fromCallback
          ? (
            context.providerEventId
            || context.providerTransactionId
          )
          : null
      );

    if (!key) {
      return {
        replay: false,
        record: null,
      };
    }

    const existing =
      await this._getIdempotencyRecord(
        context.tenantId,
        key,
      );

    if (!existing) {
      return {
        replay: false,
        record: null,
      };
    }

    const requestHash =
      createRequestHash(
        payment,
        targetState,
        context,
      );

    if (
      existing.requestHash
      && existing.requestHash !== requestHash
    ) {
      throw new PaymentStateMachineError(
        'The payment idempotency key has been reused for a different operation.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .IDEMPOTENCY_KEY_REUSED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (existing.result) {
      return {
        replay: true,
        record: existing,
        result: clone(
          existing.result,
        ),
      };
    }

    return {
      replay: false,
      record: existing,
    };
  }

  async _getIdempotencyRecord(
    tenantId,
    key,
  ) {
    if (!key) {
      return null;
    }

    if (
      this.paymentRepository
      && typeof this.paymentRepository
        .findIdempotencyRecord === 'function'
    ) {
      return this.paymentRepository
        .findIdempotencyRecord({
          tenantId,
          key,
        });
    }

    if (
      this.idempotencyStore
      && typeof this.idempotencyStore.get === 'function'
    ) {
      return this.idempotencyStore.get(
        tenantId,
        key,
      );
    }

    return null;
  }

  async _persistIdempotencyResult(
    payment,
    targetState,
    context,
    result,
    existingIdempotency,
  ) {
    const key =
      context.idempotencyKey
      || (
        context.fromCallback
          ? (
            context.providerEventId
            || context.providerTransactionId
          )
          : null
      );

    if (!key) {
      return null;
    }

    const record = {
      tenantId:
        context.tenantId,

      key,

      operation:
        this._resolveTransitionType(
          payment.status,
          targetState,
          context,
        ),

      requestHash:
        createRequestHash(
          payment,
          targetState,
          context,
        ),

      status:
        'COMPLETED',

      paymentId:
        payment.id,

      provider:
        payment.provider
        || context.provider
        || null,

      providerEventId:
        context.providerEventId
        || payment.providerEventId
        || null,

      providerTransactionId:
        context.providerTransactionId
        || payment.providerTransactionId
        || null,

      result:
        clone(result),

      createdAt:
        existingIdempotency?.createdAt
        || isoNow(),

      updatedAt:
        isoNow(),
    };

    if (
      this.paymentRepository
      && typeof this.paymentRepository
        .createOrUpdateIdempotencyRecord
        === 'function'
    ) {
      return this.paymentRepository
        .createOrUpdateIdempotencyRecord(
          record,
        );
    }

    if (
      this.idempotencyStore
      && typeof this.idempotencyStore.set === 'function'
    ) {
      return this.idempotencyStore.set(
        record,
      );
    }

    if (
      this.idempotencyStore
      && typeof this.idempotencyStore.create === 'function'
    ) {
      return this.idempotencyStore.create(
        record,
      );
    }

    return null;
  }

  /* ==========================================================================
   * Persistence
   * ======================================================================== */

  async _persistTransition(
    payment,
    nextState,
    transitionRecord,
    context,
  ) {
    const expectedVersion =
      context.expectedVersion !== null
        ? context.expectedVersion
        : payment.version;

    if (
      this.options.strictMode
      && expectedVersion === null
    ) {
      throw new PaymentStateMachineError(
        'Payment version is required for an atomic state transition.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .VERSION_REQUIRED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    const patch = {
      status:
        nextState,

      version:
        expectedVersion + 1,

      updatedAt:
        now(),

      updatedBy:
        context.actorId,

      lastTransitionId:
        transitionRecord.transitionId,

      lastTransitionType:
        transitionRecord.transition,

      lastTransitionAt:
        transitionRecord.createdAt,

      lastTransitionReason:
        context.reason || null,

      lastTransitionReasonCode:
        context.reasonCode || null,

      ...(context.provider
        ? {
            provider:
              context.provider,
          }
        : {}),

      ...(context.providerTransactionId
        ? {
            providerTransactionId:
              context.providerTransactionId,
          }
        : {}),

      ...(context.providerEventId
        ? {
            providerEventId:
              context.providerEventId,
          }
        : {}),

      ...(context.financialTransactionId
        ? {
            financialTransactionId:
              context.financialTransactionId,
          }
        : {}),

      ...(nextState === PAYMENT_STATES.SUCCESSFUL
        ? {
            completedAt:
              now(),
            failedAt:
              null,
            cancelledAt:
              null,
            expiredAt:
              null,
          }
        : {}),

      ...(nextState === PAYMENT_STATES.FAILED
        ? {
            failedAt:
              now(),
          }
        : {}),

      ...(nextState === PAYMENT_STATES.CANCELLED
        ? {
            cancelledAt:
              now(),
          }
        : {}),

      ...(nextState === PAYMENT_STATES.EXPIRED
        ? {
            expiredAt:
              now(),
          }
        : {}),

      ...(nextState === PAYMENT_STATES.REVERSED
        ? {
            reversedAt:
              now(),

            reversalPaymentId:
              context.reversalPaymentId
              || null,
          }
        : {}),
    };

    /**
     * Preferred atomic repository boundary.
     */
    if (
      this.paymentRepository
      && typeof this.paymentRepository
        .transitionWithVersion === 'function'
    ) {
      const result =
        await this.paymentRepository
          .transitionWithVersion(
            payment.id,
            expectedVersion,
            patch,
            {
              tenantId:
                context.tenantId,

              transitionRecord,

              persistenceContext:
                context.persistenceContext,
            },
          );

      if (!result) {
        throw this._concurrencyError(
          payment,
          context,
          expectedVersion,
        );
      }

      return result;
    }

    /**
     * Alternative repository API.
     */
    if (
      this.paymentRepository
      && typeof this.paymentRepository
        .updateWithVersion === 'function'
    ) {
      const result =
        await this.paymentRepository
          .updateWithVersion(
            payment.id,
            expectedVersion,
            patch,
            {
              tenantId:
                context.tenantId,

              persistenceContext:
                context.persistenceContext,
            },
          );

      if (!result) {
        throw this._concurrencyError(
          payment,
          context,
          expectedVersion,
        );
      }

      /**
       * Preserve a durable transition history when supported.
       */
      if (
        typeof this.paymentRepository
          .createTransitionRecord === 'function'
      ) {
        await this.paymentRepository
          .createTransitionRecord(
            transitionRecord,
            {
              tenantId:
                context.tenantId,

              persistenceContext:
                context.persistenceContext,
            },
          );
      }

      return result;
    }

    /**
     * Strict production mode intentionally refuses to silently fall back to
     * unsafe application-level mutation.
     */
    if (
      this.options.strictMode
      && !this.paymentRepository
    ) {
      throw new PaymentStateMachineError(
        'A payment repository with atomic state persistence is required in production mode.',
        {
          code:
            PAYMENT_STATE_ERROR_CODES
              .INVALID_PAYMENT,
          statusCode: 500,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Test/non-strict fallback.
     */
    const currentVersion =
      parseVersion(
        payment.version,
      )
      ?? 0;

    if (
      currentVersion !== expectedVersion
    ) {
      throw this._concurrencyError(
        payment,
        context,
        expectedVersion,
      );
    }

    Object.assign(
      payment,
      patch,
    );

    if (
      this.options.freezePaymentObject
    ) {
      try {
        Object.freeze(payment);
      } catch (_error) {
        // ORM objects may not be freezable.
      }
    }

    return payment;
  }

  async _transitionOperationalState(
    paymentOrId,
    targetState,
    context,
  ) {
    const payment =
      await this._resolvePayment(
        paymentOrId,
      );

    const normalizedPayment =
      this._normalizePayment(
        payment,
      );

    const transition =
      this._resolveTransitionType(
        normalizedPayment.status,
        targetState,
        context,
      );

    const transitionId =
      createTransitionId(
        normalizedPayment.id,
        normalizedPayment.status,
        targetState,
        context,
      );

    const transitionRecord =
      this._buildTransitionRecord({
        payment:
          normalizedPayment,

        targetState,

        transition,

        transitionId,

        requestHash:
          createRequestHash(
            normalizedPayment,
            targetState,
            context,
          ),

        fingerprint:
          createTransitionFingerprint({
            payment:
              normalizedPayment,

            toState:
              targetState,

            transition,

            context,
          }),

        context,
      });

    const persisted =
      await this._persistTransition(
        normalizedPayment,
        targetState,
        transitionRecord,
        context,
      );

    const result =
      this._buildResult(
        normalizedPayment,
        targetState,
        transitionRecord,
        persisted,
      );

    await this._recordAudit(
      transitionRecord,
      normalizedPayment,
      targetState,
      context,
    );

    await this._publishTransitionEvent(
      transitionRecord,
      normalizedPayment,
      targetState,
      context,
    );

    return result;
  }

  _concurrencyError(
    payment,
    context,
    expectedVersion,
  ) {
    return new PaymentStateMachineError(
      'Payment was modified by another worker or request.',
      {
        code:
          PAYMENT_STATE_ERROR_CODES
            .CONCURRENT_PAYMENT_UPDATE,

        statusCode:
          409,

        paymentId:
          payment.id,

        tenantId:
          context.tenantId,

        details: {
          expectedVersion,
          currentVersion:
            payment.version,
        },
      },
    );
  }

  /* ==========================================================================
   * Transition Records
   * ======================================================================== */

  _resolveTransitionType(
    fromState,
    toState,
    context,
  ) {
    if (context.transitionType) {
      return context.transitionType;
    }

    switch (toState) {
      case PAYMENT_STATES.INITIATED:
        return PAYMENT_TRANSITION_TYPES.INITIATE;

      case PAYMENT_STATES.PENDING:
        return PAYMENT_TRANSITION_TYPES.PEND;

      case PAYMENT_STATES.PROCESSING:
        return PAYMENT_TRANSITION_TYPES.PROCESS;

      case PAYMENT_STATES.SUCCESSFUL:
        return PAYMENT_TRANSITION_TYPES.COMPLETE;

      case PAYMENT_STATES.FAILED:
        return PAYMENT_TRANSITION_TYPES.FAIL;

      case PAYMENT_STATES.CANCELLED:
        return PAYMENT_TRANSITION_TYPES.CANCEL;

      case PAYMENT_STATES.REVERSED:
        return PAYMENT_TRANSITION_TYPES.REVERSE;

      case PAYMENT_STATES.RETRYING:
        return PAYMENT_TRANSITION_TYPES.RETRY;

      case PAYMENT_STATES.UNKNOWN:
        return PAYMENT_TRANSITION_TYPES.MARK_UNKNOWN;

      case PAYMENT_STATES.REQUIRES_RECONCILIATION:
        return PAYMENT_TRANSITION_TYPES.RECONCILE;

      case PAYMENT_STATES.EXPIRED:
        return PAYMENT_TRANSITION_TYPES.EXPIRE;

      case PAYMENT_STATES.DEAD_LETTER:
        return PAYMENT_TRANSITION_TYPES.DEAD_LETTER;

      default:
        return PAYMENT_TRANSITION_TYPES.PROCESS;
    }
  }

  _buildTransitionRecord({
    payment,
    targetState,
    transition,
    transitionId,
    requestHash,
    fingerprint,
    context,
  }) {
    return {
      transitionId,

      paymentId:
        payment.id,

      tenantId:
        context.tenantId,

      fromState:
        payment.status,

      toState:
        targetState,

      transition,

      paymentVersionBefore:
        payment.version,

      paymentVersionAfter:
        payment.version + 1,

      actorId:
        context.actorId,

      actorType:
        context.actorType,

      actorRole:
        context.actorRole,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      causationId:
        context.causationId,

      idempotencyKey:
        context.idempotencyKey
        || (
          context.fromCallback
            ? (
              context.providerEventId
              || context.providerTransactionId
            )
            : null
        ),

      requestHash,

      fingerprint,

      source:
        context.source,

      provider:
        context.provider
        || payment.provider
        || null,

      providerEventId:
        context.providerEventId
        || payment.providerEventId
        || null,

      providerTransactionId:
        context.providerTransactionId
        || payment.providerTransactionId
        || null,

      financialTransactionId:
        context.financialTransactionId
        || payment.financialTransactionId
        || null,

      reversalPaymentId:
        context.reversalPaymentId
        || null,

      reason:
        context.reason
        || null,

      reasonCode:
        context.reasonCode
        || null,

      metadata:
        this._redactMetadata(
          context.metadata,
        ),

      createdAt:
        isoNow(),
    };
  }

  _buildResult(
    payment,
    targetState,
    transitionRecord,
    persisted,
  ) {
    const persistedPlain =
      toPlainObject(
        persisted,
      );

    const version =
      parseVersion(
        persistedPlain?.version,
      )
      ?? transitionRecord
        .paymentVersionAfter;

    return {
      success: true,

      paymentId:
        payment.id,

      previousState:
        payment.status,

      currentState:
        targetState,

      transitionId:
        transitionRecord.transitionId,

      transition:
        transitionRecord.transition,

      version,

      terminal:
        isTerminal(targetState),

      successful:
        isFinalSuccess(targetState),

      failed:
        isFinalFailure(targetState),

      reversed:
        targetState === PAYMENT_STATES.REVERSED,

      requestId:
        transitionRecord.requestId
        || null,

      correlationId:
        transitionRecord.correlationId
        || null,

      timestamp:
        transitionRecord.createdAt,
    };
  }

  _buildNoopResult(
    payment,
    context,
  ) {
    return {
      success: true,

      noop: true,

      paymentId:
        payment.id,

      previousState:
        payment.status,

      currentState:
        payment.status,

      transitionId:
        null,

      transition:
        'NOOP',

      version:
        payment.version,

      terminal:
        isTerminal(
          payment.status,
        ),

      successful:
        isFinalSuccess(
          payment.status,
        ),

      failed:
        isFinalFailure(
          payment.status,
        ),

      reversed:
        payment.status
        === PAYMENT_STATES.REVERSED,

      requestId:
        context.requestId
        || null,

      correlationId:
        context.correlationId
        || null,

      timestamp:
        isoNow(),
    };
  }

  /* ==========================================================================
   * Audit / Events
   * ======================================================================== */

  async _recordAudit(
    transitionRecord,
    payment,
    nextState,
    context,
  ) {
    if (!this.auditService) {
      return;
    }

    const auditPayload = {
      tenantId:
        context.tenantId,

      actorId:
        context.actorId,

      actorType:
        context.actorType,

      actorRole:
        context.actorRole,

      action:
        `PAYMENT_${nextState}`,

      resourceType:
        'Payment',

      resourceId:
        payment.id,

      paymentId:
        payment.id,

      fromState:
        transitionRecord.fromState,

      toState:
        transitionRecord.toState,

      transition:
        transitionRecord.transition,

      provider:
        transitionRecord.provider,

      providerEventId:
        transitionRecord.providerEventId,

      providerTransactionId:
        transitionRecord.providerTransactionId,

      financialTransactionId:
        transitionRecord.financialTransactionId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      reason:
        context.reason
        || null,

      reasonCode:
        context.reasonCode
        || null,

      outcome:
        'success',

      metadata:
        this._redactMetadata(
          context.metadata,
        ),

      createdAt:
        transitionRecord.createdAt,
    };

    try {
      if (
        typeof this.auditService.record
        === 'function'
      ) {
        await this.auditService.record(
          auditPayload,
        );
        return;
      }

      if (
        typeof this.auditService.create
        === 'function'
      ) {
        await this.auditService.create(
          auditPayload,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to record payment transition audit event.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          transitionId:
            transitionRecord.transitionId,
        },
      );

      /**
       * In enterprise production deployments, the audit record should
       * preferably participate in the same transactional outbox/database
       * boundary. strictMode therefore fails closed when audit persistence
       * itself fails.
       */
      if (
        this.options.strictMode
      ) {
        throw error;
      }
    }
  }

  async _publishTransitionEvent(
    transitionRecord,
    payment,
    nextState,
    context,
  ) {
    if (!this.eventPublisher) {
      return;
    }

    const event =
      this._buildTransitionEvent(
        transitionRecord,
        payment,
        nextState,
        context,
      );

    try {
      if (
        typeof this.eventPublisher.publish
        === 'function'
      ) {
        await this.eventPublisher.publish(
          event,
        );
        return;
      }

      if (
        typeof this.eventPublisher.publishEvent
        === 'function'
      ) {
        await this.eventPublisher.publishEvent(
          event,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to publish payment state event.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          eventId:
            event.eventId,

          eventType:
            event.eventType,
        },
      );

      /**
       * Preferred production architecture:
       * the repository/outbox writes the event atomically with the payment
       * state transition, so publication failure does not roll back an
       * already committed payment state.
       */
      if (
        this.options.strictEventPublishing === true
      ) {
        throw error;
      }
    }
  }

  _buildTransitionEvent(
    transitionRecord,
    payment,
    nextState,
    context,
  ) {
    return {
      eventId:
        `evt_${crypto.randomUUID()}`,

      eventType:
        this._eventTypeForState(
          nextState,
        ),

      eventVersion:
        1,

      eventSchema:
        `titech.payment.${String(
          nextState,
        ).toLowerCase()}.v1`,

      occurredAt:
        transitionRecord.createdAt,

      publishedAt:
        null,

      tenantId:
        context.tenantId,

      aggregateType:
        'Payment',

      aggregateId:
        payment.id,

      aggregateVersion:
        transitionRecord
          .paymentVersionAfter,

      correlationId:
        context.correlationId
        || null,

      causationId:
        context.causationId
        || null,

      requestId:
        context.requestId
        || null,

      producer:
        'PaymentStateMachine',

      environment:
        process.env.NODE_ENV
        || 'development',

      data: {
        paymentId:
          payment.id,

        previousState:
          transitionRecord
            .fromState,

        currentState:
          nextState,

        paymentType:
          payment.paymentType
          || payment.type
          || null,

        direction:
          payment.direction
          || null,

        amount:
          this._safeMonetaryValue(
            payment.amount,
          ),

        currency:
          payment.currency
          || null,

        provider:
          payment.provider
          || context.provider
          || null,

        providerEventId:
          context.providerEventId
          || payment.providerEventId
          || null,

        providerTransactionId:
          context.providerTransactionId
          || payment.providerTransactionId
          || null,

        financialTransactionId:
          context.financialTransactionId
          || payment.financialTransactionId
          || null,

        transitionId:
          transitionRecord.transitionId,

        reasonCode:
          context.reasonCode
          || null,
      },
    };
  }

  _eventTypeForState(
    state,
  ) {
    switch (state) {
      case PAYMENT_STATES.INITIATED:
        return 'PaymentInitiated';

      case PAYMENT_STATES.PENDING:
        return 'PaymentPending';

      case PAYMENT_STATES.PROCESSING:
        return 'PaymentProcessing';

      case PAYMENT_STATES.SUCCESSFUL:
        return 'PaymentCompleted';

      case PAYMENT_STATES.FAILED:
        return 'PaymentFailed';

      case PAYMENT_STATES.CANCELLED:
        return 'PaymentCancelled';

      case PAYMENT_STATES.REVERSED:
        return 'PaymentReversed';

      case PAYMENT_STATES.RETRYING:
        return 'PaymentRetrying';

      case PAYMENT_STATES.UNKNOWN:
        return 'PaymentOutcomeUnknown';

      case PAYMENT_STATES.REQUIRES_RECONCILIATION:
        return 'PaymentReconciliationRequired';

      case PAYMENT_STATES.EXPIRED:
        return 'PaymentExpired';

      case PAYMENT_STATES.DEAD_LETTER:
        return 'PaymentDeadLettered';

      default:
        return 'PaymentStateChanged';
    }
  }

  /* ==========================================================================
   * Security / Logging Helpers
   * ======================================================================== */

  _redactMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata !== 'object'
    ) {
      return {};
    }

    const sensitiveKeys =
      new Set([
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'secret',
        'clientSecret',
        'apiKey',
        'privateKey',
        'authorization',
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawAuthorizationHeader',
      ]);

    const output = {};

    for (
      const [key, value]
      of Object.entries(metadata)
    ) {
      if (
        sensitiveKeys.has(
          key,
        )
      ) {
        output[key] =
          '[REDACTED]';
      } else {
        output[key] =
          clone(value);
      }
    }

    return output;
  }

  _sanitizeProviderMetadata(
    providerResult,
  ) {
    if (
      !providerResult
      || typeof providerResult !== 'object'
    ) {
      return {};
    }

    const allowedKeys = [
      'provider',
      'providerEventId',
      'providerTransactionId',
      'transactionReference',
      'status',
      'amount',
      'currency',
      'timestamp',
      'occurredAt',
    ];

    const sanitized = {};

    for (
      const key
      of allowedKeys
    ) {
      if (
        providerResult[key]
        !== undefined
      ) {
        sanitized[key] =
          clone(
            providerResult[key],
          );
      }
    }

    return sanitized;
  }

  _safeMonetaryValue(
    value,
  ) {
    if (
      value === undefined
      || value === null
    ) {
      return null;
    }

    if (
      typeof value === 'string'
      || typeof value === 'number'
    ) {
      return String(value);
    }

    if (
      value
      && typeof value.toString
      === 'function'
    ) {
      return value.toString();
    }

    return null;
  }

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        && typeof this.logger.error
        === 'function'
      ) {
        this.logger.error(
          message,
          {
            error: {
              name:
                error?.name,

              code:
                error?.code,

              message:
                error?.message,
            },

            ...metadata,
          },
        );
      }
    } catch (_loggingError) {
      /**
       * Never mask the primary operation error with a logging error.
       */
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentStateMachine.STATES =
  PAYMENT_STATES;

PaymentStateMachine.TERMINAL_STATES =
  Object.freeze([
    ...PAYMENT_TERMINAL_STATES,
  ]);

PaymentStateMachine.FINAL_SUCCESS_STATES =
  Object.freeze([
    ...PAYMENT_FINAL_SUCCESS_STATES,
  ]);

PaymentStateMachine.FINAL_FAILURE_STATES =
  Object.freeze([
    ...PAYMENT_FINAL_FAILURE_STATES,
  ]);

PaymentStateMachine.TRANSITIONS =
  PAYMENT_TRANSITIONS;

PaymentStateMachine.TRANSITION_TYPES =
  PAYMENT_TRANSITION_TYPES;

PaymentStateMachine.ERROR_CODES =
  PAYMENT_STATE_ERROR_CODES;

PaymentStateMachine.isValidState =
  function isValidState(value) {
    return (
      normalizeState(value)
      !== null
    );
  };

PaymentStateMachine.isTerminalState =
  function isTerminalState(value) {
    const state =
      normalizeState(value);

    return state
      ? isTerminal(state)
      : false;
  };

PaymentStateMachine.isSuccessfulState =
  function isSuccessfulState(value) {
    const state =
      normalizeState(value);

    return state
      ? isFinalSuccess(state)
      : false;
  };

PaymentStateMachine.isFailedState =
  function isFailedState(value) {
    const state =
      normalizeState(value);

    return state
      ? isFinalFailure(state)
      : false;
  };

PaymentStateMachine.getAllowedTransitions =
  function getAllowedTransitions(value) {
    const state =
      normalizeState(value);

    if (!state) {
      return [];
    }

    return [
      ...(PAYMENT_TRANSITIONS[state]
        || []),
    ];
  };

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentStateMachine(
  dependencies = {},
) {
  return new PaymentStateMachine(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentStateMachine;

module.exports.PaymentStateMachine =
  PaymentStateMachine;

module.exports.PaymentStateMachineError =
  PaymentStateMachineError;

module.exports.InMemoryPaymentIdempotencyStore =
  InMemoryPaymentIdempotencyStore;

module.exports.createPaymentStateMachine =
  createPaymentStateMachine;

module.exports.PAYMENT_STATES =
  PAYMENT_STATES;

module.exports.PAYMENT_TRANSITIONS =
  PAYMENT_TRANSITIONS;

module.exports.PAYMENT_TRANSITION_TYPES =
  PAYMENT_TRANSITION_TYPES;

module.exports.PAYMENT_STATE_ERROR_CODES =
  PAYMENT_STATE_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */