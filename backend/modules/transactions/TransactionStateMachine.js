'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction State Machine
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/transactionStateMachine.js
 *
 * Purpose:
 *   Centralized, production-grade state machine for transaction lifecycle
 *   management across payments, contributions, loan disbursements, loan
 *   repayments, refunds, transfers, settlements, reversals, and other
 *   financially material operations.
 *
 * Architectural Principles
 * ----------------------------------------------------------------------------
 * 1. Transaction state may only change through this state machine.
 * 2. Invalid state transitions are rejected.
 * 3. Tenant isolation is enforced by transition context.
 * 4. Financial state is never inferred from client-provided status.
 * 5. POSTED requires authoritative financial commit.
 * 6. REVERSED requires an approved compensating financial operation.
 * 7. UNKNOWN represents an unresolved external outcome, not failure.
 * 8. REQUIRES_RECONCILIATION represents an unsafe-to-finalize condition.
 * 9. Idempotent transitions must not create duplicate financial effects.
 * 10. Optimistic concurrency protects against stale workers.
 * 11. Transition history is append-oriented.
 * 12. Audit/event integration is performed through injectable adapters.
 * 13. This module does not directly mutate ledger balances.
 *
 * Persistence
 * ----------------------------------------------------------------------------
 * This module is persistence-agnostic by design. It can operate with the
 * repository/model layer already used by the application.
 *
 * Expected repository capabilities, where supplied:
 *
 *   getById(transactionId, options)
 *   findByIdempotencyKey(key, options)
 *   updateWithVersion(transactionId, expectedVersion, patch, options)
 *   createTransition(record, options)
 *   createIdempotencyRecord(record, options)
 *   findIdempotencyRecord(key, options)
 *
 * The implementation also supports plain in-memory/plain-object transaction
 * operation for unit tests and service-level integration.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const TRANSACTION_STATES = Object.freeze({
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',

  // Operational/recovery states.
  RETRYING: 'RETRYING',
  UNKNOWN: 'UNKNOWN',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  DEAD_LETTER: 'DEAD_LETTER',
});

const TERMINAL_STATES = new Set([
  TRANSACTION_STATES.POSTED,
  TRANSACTION_STATES.FAILED,
  TRANSACTION_STATES.CANCELLED,
  TRANSACTION_STATES.REVERSED,
  TRANSACTION_STATES.DEAD_LETTER,
]);

const FINANCIAL_FINAL_STATES = new Set([
  TRANSACTION_STATES.POSTED,
  TRANSACTION_STATES.REVERSED,
]);

const NON_POSTED_STATES = new Set([
  TRANSACTION_STATES.INITIATED,
  TRANSACTION_STATES.PENDING,
  TRANSACTION_STATES.PROCESSING,
  TRANSACTION_STATES.FAILED,
  TRANSACTION_STATES.CANCELLED,
  TRANSACTION_STATES.RETRYING,
  TRANSACTION_STATES.UNKNOWN,
  TRANSACTION_STATES.REQUIRES_RECONCILIATION,
  TRANSACTION_STATES.DEAD_LETTER,
]);

const TRANSITIONS = Object.freeze({
  [TRANSACTION_STATES.INITIATED]: Object.freeze([
    TRANSACTION_STATES.PENDING,
    TRANSACTION_STATES.PROCESSING,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.CANCELLED,
  ]),

  [TRANSACTION_STATES.PENDING]: Object.freeze([
    TRANSACTION_STATES.PROCESSING,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.CANCELLED,
    TRANSACTION_STATES.UNKNOWN,
  ]),

  [TRANSACTION_STATES.PROCESSING]: Object.freeze([
    TRANSACTION_STATES.POSTED,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.PENDING,
    TRANSACTION_STATES.UNKNOWN,
  ]),

  [TRANSACTION_STATES.POSTED]: Object.freeze([
    TRANSACTION_STATES.REVERSED,
  ]),

  [TRANSACTION_STATES.FAILED]: Object.freeze([
    TRANSACTION_STATES.RETRYING,
    TRANSACTION_STATES.REQUIRES_RECONCILIATION,
  ]),

  [TRANSACTION_STATES.CANCELLED]: Object.freeze([
    TRANSACTION_STATES.REQUIRES_RECONCILIATION,
  ]),

  [TRANSACTION_STATES.REVERSED]: Object.freeze([]),

  [TRANSACTION_STATES.RETRYING]: Object.freeze([
    TRANSACTION_STATES.PROCESSING,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.UNKNOWN,
  ]),

  [TRANSACTION_STATES.UNKNOWN]: Object.freeze([
    TRANSACTION_STATES.POSTED,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.REQUIRES_RECONCILIATION,
  ]),

  [TRANSACTION_STATES.REQUIRES_RECONCILIATION]: Object.freeze([
    TRANSACTION_STATES.POSTED,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.REVERSED,
  ]),

  [TRANSACTION_STATES.DEAD_LETTER]: Object.freeze([]),
});

const TRANSITION_TYPES = Object.freeze({
  START: 'START_TRANSACTION',
  PEND: 'PEND_TRANSACTION',
  PROCESS: 'PROCESS_TRANSACTION',
  POST: 'POST_TRANSACTION',
  FAIL: 'FAIL_TRANSACTION',
  CANCEL: 'CANCEL_TRANSACTION',
  REVERSE: 'REVERSE_TRANSACTION',
  RETRY: 'RETRY_TRANSACTION',
  MARK_UNKNOWN: 'MARK_TRANSACTION_UNKNOWN',
  RECONCILE: 'RECONCILE_TRANSACTION',
  DEAD_LETTER: 'DEAD_LETTER_TRANSACTION',
});

const ERROR_CODES = Object.freeze({
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  INVALID_STATE: 'INVALID_TRANSACTION_STATE',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  TENANT_CONTEXT_REQUIRED: 'TENANT_CONTEXT_REQUIRED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  AUTHORIZATION_REQUIRED: 'AUTHORIZATION_REQUIRED',
  INVALID_ACTOR: 'INVALID_ACTOR',
  CONCURRENT_TRANSACTION_UPDATE: 'CONCURRENT_TRANSACTION_UPDATE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  POST_NOT_FINANCIAL_COMMITTED: 'POST_NOT_FINANCIAL_COMMITTED',
  POSTING_REFERENCE_REQUIRED: 'POSTING_REFERENCE_REQUIRED',
  REVERSAL_REFERENCE_REQUIRED: 'REVERSAL_REFERENCE_REQUIRED',
  REVERSAL_NOT_ALLOWED: 'REVERSAL_NOT_ALLOWED',
  ALREADY_REVERSED: 'ALREADY_REVERSED',
  CANCELLATION_NOT_ALLOWED: 'CANCELLATION_NOT_ALLOWED',
  UNKNOWN_OUTCOME: 'UNKNOWN_OUTCOME',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  REASON_REQUIRED: 'REASON_REQUIRED',
  VERSION_REQUIRED: 'VERSION_REQUIRED',
  INVALID_VERSION: 'INVALID_VERSION',
  INVALID_TRANSACTION_ID: 'INVALID_TRANSACTION_ID',
});

const DEFAULT_OPTIONS = Object.freeze({
  requireTenant: true,
  requireActor: true,
  requireReasonForSensitiveTransitions: true,
  requireIdempotencyForMutations: true,
  strictMode: true,
  allowUnknownTransitions: false,
  allowNoopTransitions: true,
  freezeTransactionObject: false,
});

const SENSITIVE_TRANSITIONS = new Set([
  TRANSACTION_STATES.POSTED,
  TRANSACTION_STATES.REVERSED,
  TRANSACTION_STATES.FAILED,
  TRANSACTION_STATES.CANCELLED,
  TRANSACTION_STATES.UNKNOWN,
  TRANSACTION_STATES.REQUIRES_RECONCILIATION,
]);

const MONEY_TRANSITIONS = new Set([
  TRANSACTION_STATES.POSTED,
  TRANSACTION_STATES.REVERSED,
]);

/* ============================================================================
 * Error Classes
 * ========================================================================== */

class TransactionStateMachineError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'TransactionStateMachineError';
    this.code = options.code || ERROR_CODES.INVALID_STATE_TRANSITION;
    this.statusCode = Number.isInteger(options.statusCode)
      ? options.statusCode
      : 400;

    this.details = options.details || {};
    this.transactionId = options.transactionId || null;
    this.tenantId = options.tenantId || null;
    this.fromState = options.fromState || null;
    this.toState = options.toState || null;
    this.transition = options.transition || null;

    if (options.cause) {
      this.cause = options.cause;
    }

    Error.captureStackTrace?.(this, TransactionStateMachineError);
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function toPlainObject(value) {
  if (!value) return value;

  if (typeof value.toObject === 'function') {
    return value.toObject();
  }

  return value;
}

function getValue(object, key, fallback = undefined) {
  if (!object || typeof object !== 'object') {
    return fallback;
  }

  if (hasOwn(object, key)) {
    return object[key];
  }

  return fallback;
}

function clone(value) {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_error) {
      // Fall through to JSON-compatible clone.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(value).sort();

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : stableStringify(value))
    .digest('hex');
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function parseVersion(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 0) {
    return null;
  }

  return number;
}

function assertSafeVersion(value, options = {}) {
  const parsed = parseVersion(value);

  if (parsed === null) {
    throw new TransactionStateMachineError(
      options.message || 'A valid transaction version is required.',
      {
        code: ERROR_CODES.INVALID_VERSION,
        statusCode: 409,
        transactionId: options.transactionId,
        details: {
          expectedVersion: value,
        },
      },
    );
  }

  return parsed;
}

function normalizeState(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (!Object.values(TRANSACTION_STATES).includes(normalized)) {
    return null;
  }

  return normalized;
}

function transitionExists(fromState, toState) {
  if (!hasOwn(TRANSITIONS, fromState)) {
    return false;
  }

  return TRANSITIONS[fromState].includes(toState);
}

function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

function isFinancialFinalState(state) {
  return FINANCIAL_FINAL_STATES.has(state);
}

function isMoneyTransition(toState) {
  return MONEY_TRANSITIONS.has(toState);
}

function isObjectIdLike(value) {
  if (!isNonEmptyString(String(value || ''))) {
    return false;
  }

  const text = String(value).trim();

  return /^[a-fA-F0-9]{24}$/.test(text)
    || /^[A-Za-z0-9][A-Za-z0-9_-]{2,255}$/.test(text);
}

/**
 * Avoid depending on a particular ID library while still rejecting clearly
 * unsafe transaction identifiers.
 */
function normalizeTransactionId(value) {
  const id = normalizeString(value);

  if (!id || !isObjectIdLike(id)) {
    throw new TransactionStateMachineError(
      'A valid transaction identifier is required.',
      {
        code: ERROR_CODES.INVALID_TRANSACTION_ID,
        statusCode: 400,
        details: {
          transactionId: value,
        },
      },
    );
  }

  return id;
}

function normalizeContext(context = {}) {
  return {
    actorId: normalizeString(context.actorId),
    actorType: normalizeString(context.actorType) || 'USER',
    actorRole: normalizeString(context.actorRole),
    tenantId: normalizeString(context.tenantId),
    requestId: normalizeString(context.requestId),
    correlationId: normalizeString(context.correlationId),
    causationId: normalizeString(context.causationId),
    idempotencyKey: normalizeString(context.idempotencyKey),
    reason: normalizeString(context.reason),
    reasonCode: normalizeString(context.reasonCode),
    source: normalizeString(context.source) || 'APPLICATION',
    provider: normalizeString(context.provider),
    providerTransactionId: normalizeString(context.providerTransactionId),
    postingReference: normalizeString(context.postingReference),
    reversalTransactionId: normalizeString(context.reversalTransactionId),
    expectedVersion: parseVersion(context.expectedVersion),
    isRetry: context.isRetry === true,
    metadata: context.metadata && typeof context.metadata === 'object'
      ? clone(context.metadata)
      : {},
  };
}

function createTransitionId(transactionId, fromState, toState, context) {
  const seed = [
    transactionId,
    fromState || 'NULL',
    toState,
    context.idempotencyKey || '',
    context.requestId || '',
    isoNow(),
    crypto.randomUUID(),
  ].join('|');

  return `transition_${sha256(seed).slice(0, 32)}`;
}

function createTransitionFingerprint({
  transactionId,
  fromState,
  toState,
  transition,
  context,
}) {
  return sha256({
    transactionId,
    fromState,
    toState,
    transition,
    tenantId: context.tenantId,
    actorId: context.actorId,
    idempotencyKey: context.idempotencyKey,
    requestId: context.requestId,
    reasonCode: context.reasonCode,
  });
}

function createRequestHash(transaction, targetState, context) {
  return sha256({
    transactionId: transaction.id || transaction._id,
    currentState: transaction.status,
    targetState,
    tenantId: transaction.tenantId,
    transactionType: transaction.transactionType,
    amount: transaction.amount,
    currency: transaction.currency,
    sourceType: transaction.sourceType,
    sourceId: transaction.sourceId,
    idempotencyKey: context.idempotencyKey,
    provider: context.provider,
    providerTransactionId: context.providerTransactionId,
  });
}

/* ============================================================================
 * In-Memory Idempotency Adapter
 *
 * Useful for unit tests or environments where the service supplies its own
 * durable idempotency repository.
 * ========================================================================== */

class InMemoryIdempotencyStore {
  constructor() {
    this.records = new Map();
  }

  _key(tenantId, operationKey) {
    return `${tenantId || 'global'}:${operationKey}`;
  }

  async get(tenantId, operationKey) {
    return this.records.get(this._key(tenantId, operationKey)) || null;
  }

  async create(record) {
    const key = this._key(record.tenantId, record.key);

    if (this.records.has(key)) {
      return this.records.get(key);
    }

    this.records.set(key, clone(record));

    return clone(record);
  }

  async set(record) {
    const key = this._key(record.tenantId, record.key);

    this.records.set(key, clone(record));

    return clone(record);
  }

  async clear() {
    this.records.clear();
  }
}

/* ============================================================================
 * Transaction State Machine
 * ========================================================================== */

class TransactionStateMachine {
  /**
   * @param {Object} dependencies
   * @param {Object} [dependencies.transactionRepository]
   * @param {Object} [dependencies.idempotencyStore]
   * @param {Object} [dependencies.auditService]
   * @param {Object} [dependencies.eventPublisher]
   * @param {Object} [dependencies.logger]
   * @param {Function} [dependencies.transitionGuard]
   * @param {Function} [dependencies.financialCommitVerifier]
   * @param {Object} [dependencies.options]
   */
  constructor(dependencies = {}) {
    this.transactionRepository =
      dependencies.transactionRepository || null;

    this.idempotencyStore =
      dependencies.idempotencyStore || new InMemoryIdempotencyStore();

    this.auditService =
      dependencies.auditService || null;

    this.eventPublisher =
      dependencies.eventPublisher || null;

    this.logger =
      dependencies.logger || console;

    this.transitionGuard =
      typeof dependencies.transitionGuard === 'function'
        ? dependencies.transitionGuard
        : null;

    this.financialCommitVerifier =
      typeof dependencies.financialCommitVerifier === 'function'
        ? dependencies.financialCommitVerifier
        : null;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });
  }

  /* ==========================================================================
   * Public API
   * ======================================================================== */

  /**
   * Returns the immutable state definitions.
   */
  getStates() {
    return Object.freeze({ ...TRANSACTION_STATES });
  }

  /**
   * Returns a safe copy of the transition map.
   */
  getTransitionMap() {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(TRANSITIONS).map(([state, targets]) => [
          state,
          [...targets],
        ]),
      ),
    );
  }

  /**
   * Returns allowed target states from the current state.
   */
  getAllowedTransitions(transactionOrState) {
    const state = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    if (!state) {
      throw new TransactionStateMachineError(
        'Invalid or missing transaction state.',
        {
          code: ERROR_CODES.INVALID_STATE,
          statusCode: 400,
        },
      );
    }

    return [...(TRANSITIONS[state] || [])];
  }

  /**
   * Determine whether a transition is structurally permitted.
   *
   * This does not execute a transition and does not persist anything.
   */
  canTransition(transactionOrState, targetState) {
    const currentState = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    const nextState = normalizeState(targetState);

    if (!currentState || !nextState) {
      return false;
    }

    if (this.options.allowNoopTransitions && currentState === nextState) {
      return true;
    }

    return transitionExists(currentState, nextState);
  }

  /**
   * Validate a transition without persisting it.
   */
  async validateTransition(transaction, targetState, rawContext = {}) {
    const context = normalizeContext(rawContext);
    const normalizedTransaction = this._normalizeTransaction(transaction);
    const nextState = this._assertTargetState(targetState);

    await this._validateTransactionContext(
      normalizedTransaction,
      nextState,
      context,
    );

    await this._validateStructuralTransition(
      normalizedTransaction,
      nextState,
      context,
    );

    await this._runCustomGuard(
      normalizedTransaction,
      nextState,
      context,
    );

    return {
      valid: true,
      transactionId: normalizedTransaction.id,
      fromState: normalizedTransaction.status,
      toState: nextState,
      allowed: true,
      context: {
        actorId: context.actorId,
        actorType: context.actorType,
        actorRole: context.actorRole,
        tenantId: context.tenantId,
        requestId: context.requestId,
        correlationId: context.correlationId,
      },
    };
  }

  /**
   * Perform a state transition.
   *
   * This is the primary service method. All mutation-capable callers should
   * use this method rather than assigning transaction.status directly.
   */
  async transition(transactionOrId, targetState, rawContext = {}) {
    const context = normalizeContext(rawContext);
    const transaction = await this._resolveTransaction(transactionOrId);
    const normalizedTransaction = this._normalizeTransaction(transaction);
    const nextState = this._assertTargetState(targetState);

    await this._validateTransactionContext(
      normalizedTransaction,
      nextState,
      context,
    );

    /**
     * Idempotency is checked before transition execution.
     */
    const idempotencyResult =
      await this._checkIdempotency(
        normalizedTransaction,
        nextState,
        context,
      );

    if (idempotencyResult.replay) {
      return idempotencyResult.result;
    }

    /**
     * No-op transition:
     * Returning the current state is safe only when explicitly allowed.
     */
    if (
      this.options.allowNoopTransitions
      && normalizedTransaction.status === nextState
    ) {
      const result = this._buildNoopResult(
        normalizedTransaction,
        nextState,
        context,
      );

      await this._persistIdempotencyResult(
        normalizedTransaction,
        nextState,
        context,
        result,
        idempotencyResult,
      );

      return result;
    }

    await this._validateStructuralTransition(
      normalizedTransaction,
      nextState,
      context,
    );

    await this._runCustomGuard(
      normalizedTransaction,
      nextState,
      context,
    );

    /**
     * Transition-specific guards.
     */
    await this._runTransitionGuards(
      normalizedTransaction,
      nextState,
      context,
    );

    const transition = this._resolveTransitionType(
      normalizedTransaction.status,
      nextState,
      context,
    );

    const transitionId = createTransitionId(
      normalizedTransaction.id,
      normalizedTransaction.status,
      nextState,
      context,
    );

    const requestHash = createRequestHash(
      normalizedTransaction,
      nextState,
      context,
    );

    const fingerprint = createTransitionFingerprint({
      transactionId: normalizedTransaction.id,
      fromState: normalizedTransaction.status,
      toState: nextState,
      transition,
      context,
    });

    const transitionRecord = this._buildTransitionRecord({
      transaction: normalizedTransaction,
      targetState: nextState,
      transition,
      transitionId,
      requestHash,
      fingerprint,
      context,
    });

    /**
     * Perform persistence as one logical operation.
     *
     * Where the repository supports a transaction/session, callers should
     * supply it through context.persistenceContext.
     */
    const persisted = await this._persistTransition(
      normalizedTransaction,
      nextState,
      transitionRecord,
      context,
    );

    const result = this._buildResult(
      normalizedTransaction,
      nextState,
      transitionRecord,
      persisted,
    );

    /**
     * Audit/event side effects are intentionally after the authoritative state
     * persistence. If the application uses a transactional outbox, the event
     * should already have been written atomically by the repository layer.
     */
    await this._recordAudit(
      transitionRecord,
      normalizedTransaction,
      nextState,
      context,
    );

    await this._publishTransitionEvent(
      transitionRecord,
      normalizedTransaction,
      nextState,
      context,
    );

    await this._persistIdempotencyResult(
      normalizedTransaction,
      nextState,
      context,
      result,
      idempotencyResult,
    );

    return result;
  }

  /**
   * Transition a transaction to POSTED.
   *
   * Requires authoritative financial commit evidence.
   */
  async post(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    await this._assertFinancialCommit(
      transactionOrId,
      context,
    );

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.POSTED,
      context,
    );
  }

  /**
   * Transition to FAILED.
   *
   * A failed transaction must not have an unauthorized posted financial effect.
   */
  async fail(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    await this._assertFailureSafety(
      transactionOrId,
      context,
    );

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.FAILED,
      context,
    );
  }

  /**
   * Cancel a transaction.
   */
  async cancel(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.CANCELLED,
      context,
    );
  }

  /**
   * Mark a transaction as pending.
   */
  async pend(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.PENDING,
      context,
    );
  }

  /**
   * Begin active processing.
   */
  async process(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.PROCESSING,
      context,
    );
  }

  /**
   * Begin a controlled retry.
   */
  async retry(transactionOrId, rawContext = {}) {
    const context = normalizeContext({
      ...rawContext,
      isRetry: true,
    });

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.RETRYING,
      context,
    );
  }

  /**
   * Mark an externally ambiguous operation UNKNOWN.
   */
  async markUnknown(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.UNKNOWN,
      context,
    );
  }

  /**
   * Move a transaction into controlled reconciliation.
   */
  async requireReconciliation(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.REQUIRES_RECONCILIATION,
      context,
    );
  }

  /**
   * Mark a transaction dead-lettered.
   *
   * This method is intentionally restrictive. DEAD_LETTER is an operational
   * terminal state and should normally be used only by recovery/workflow
   * infrastructure, not business-facing API consumers.
   */
  async deadLetter(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    return this._transitionToDeadLetter(
      transactionOrId,
      context,
    );
  }

  /**
   * Reverse a posted transaction.
   *
   * The actual compensating financial transaction must be created and posted
   * by the approved financial/reversal service. This method only changes the
   * original transaction's workflow state after the reversal evidence exists.
   */
  async reverse(transactionOrId, rawContext = {}) {
    const context = normalizeContext(rawContext);

    if (!context.reversalTransactionId) {
      throw new TransactionStateMachineError(
        'A reversal transaction reference is required.',
        {
          code: ERROR_CODES.REVERSAL_REFERENCE_REQUIRED,
          statusCode: 400,
          transactionId: this._safeId(transactionOrId),
          tenantId: context.tenantId,
        },
      );
    }

    return this.transition(
      transactionOrId,
      TRANSACTION_STATES.REVERSED,
      context,
    );
  }

  /**
   * Check if transaction is in a terminal state.
   */
  isTerminal(transactionOrState) {
    const state = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    return state ? isTerminal(state) : false;
  }

  /**
   * Check if transaction has an authoritative financial final state.
   */
  isFinancialFinal(transactionOrState) {
    const state = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    return state ? isFinancialFinalState(state) : false;
  }

  /**
   * Check if a transaction is mutable from a financial workflow perspective.
   */
  isMutable(transactionOrState) {
    const state = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    return state
      ? !FINANCIAL_FINAL_STATES.has(state)
      : false;
  }

  /**
   * Get a state machine summary.
   */
  describe(transactionOrState) {
    const state = typeof transactionOrState === 'string'
      ? normalizeState(transactionOrState)
      : normalizeState(
          transactionOrState?.status
          || transactionOrState?.state,
        );

    if (!state) {
      throw new TransactionStateMachineError(
        'Invalid transaction state.',
        {
          code: ERROR_CODES.INVALID_STATE,
          statusCode: 400,
        },
      );
    }

    return {
      state,
      terminal: isTerminal(state),
      financialFinal: isFinancialFinalState(state),
      mutable: !FINANCIAL_FINAL_STATES.has(state),
      allowedTransitions: this.getAllowedTransitions(state),
    };
  }

  /* ==========================================================================
   * Private Resolution / Validation
   * ======================================================================== */

  async _resolveTransaction(transactionOrId) {
    if (
      transactionOrId
      && typeof transactionOrId === 'object'
      && !Array.isArray(transactionOrId)
    ) {
      return transactionOrId;
    }

    const transactionId = normalizeTransactionId(transactionOrId);

    if (!this.transactionRepository) {
      throw new TransactionStateMachineError(
        'Transaction repository is required when resolving a transaction by ID.',
        {
          code: ERROR_CODES.TRANSACTION_NOT_FOUND,
          statusCode: 404,
          transactionId,
        },
      );
    }

    const transaction =
      await this.transactionRepository.getById(
        transactionId,
      );

    if (!transaction) {
      throw new TransactionStateMachineError(
        'Transaction not found.',
        {
          code: ERROR_CODES.TRANSACTION_NOT_FOUND,
          statusCode: 404,
          transactionId,
        },
      );
    }

    return transaction;
  }

  _normalizeTransaction(transaction) {
    if (!transaction || typeof transaction !== 'object') {
      throw new TransactionStateMachineError(
        'Invalid transaction object.',
        {
          code: ERROR_CODES.INVALID_TRANSACTION,
          statusCode: 400,
        },
      );
    }

    const plain = toPlainObject(transaction);

    const rawId = plain.id ?? plain._id;
    const id = normalizeTransactionId(
      typeof rawId === 'object' && rawId?.toString
        ? rawId.toString()
        : rawId,
    );

    const status = normalizeState(
      plain.status ?? plain.state,
    );

    if (!status) {
      throw new TransactionStateMachineError(
        'Transaction has an invalid state.',
        {
          code: ERROR_CODES.INVALID_STATE,
          statusCode: 400,
          transactionId: id,
          details: {
            state: plain.status ?? plain.state,
          },
        },
      );
    }

    const tenantId = normalizeString(plain.tenantId);

    const version =
      parseVersion(plain.version)
      ?? parseVersion(plain.__v)
      ?? 0;

    return {
      ...plain,
      id,
      status,
      tenantId,
      version,

      transactionType:
        normalizeString(
          plain.transactionType
          || plain.type,
        ),

      amount: plain.amount,
      currency: normalizeString(plain.currency),

      sourceType:
        normalizeString(
          plain.sourceType
          || plain.source,
        ),

      sourceId:
        normalizeString(
          plain.sourceId,
        ),

      idempotencyKey:
        normalizeString(
          plain.idempotencyKey,
        ),

      provider:
        normalizeString(
          plain.provider,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      journalId:
        normalizeString(
          plain.journalId,
        ),

      reversedAt: plain.reversedAt || null,
    };
  }

  _safeId(transactionOrId) {
    try {
      if (transactionOrId && typeof transactionOrId === 'object') {
        const raw = transactionOrId.id ?? transactionOrId._id;

        if (raw && typeof raw.toString === 'function') {
          return raw.toString();
        }

        return raw || null;
      }

      return transactionOrId || null;
    } catch (_error) {
      return null;
    }
  }

  _assertTargetState(targetState) {
    const nextState = normalizeState(targetState);

    if (!nextState) {
      throw new TransactionStateMachineError(
        'Invalid target transaction state.',
        {
          code: ERROR_CODES.INVALID_STATE,
          statusCode: 400,
          details: {
            targetState,
          },
        },
      );
    }

    return nextState;
  }

  async _validateTransactionContext(
    transaction,
    targetState,
    context,
  ) {
    if (
      this.options.requireTenant
      && !isNonEmptyString(context.tenantId)
    ) {
      throw new TransactionStateMachineError(
        'Tenant context is required for transaction state transitions.',
        {
          code: ERROR_CODES.TENANT_CONTEXT_REQUIRED,
          statusCode: 403,
          transactionId: transaction.id,
        },
      );
    }

    if (
      this.options.requireTenant
      && transaction.tenantId
      && transaction.tenantId !== context.tenantId
    ) {
      throw new TransactionStateMachineError(
        'Transaction does not belong to the current tenant.',
        {
          code: ERROR_CODES.TENANT_MISMATCH,
          statusCode: 403,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          details: {
            transactionTenantId: transaction.tenantId,
          },
        },
      );
    }

    if (
      this.options.requireActor
      && !isNonEmptyString(context.actorId)
    ) {
      throw new TransactionStateMachineError(
        'An authenticated actor is required for the transition.',
        {
          code: ERROR_CODES.INVALID_ACTOR,
          statusCode: 403,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (
      this.options.requireIdempotencyForMutations
      && this._requiresIdempotency(transaction, targetState)
      && !isNonEmptyString(context.idempotencyKey)
    ) {
      throw new TransactionStateMachineError(
        'An idempotency key is required for this transaction transition.',
        {
          code: ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
          statusCode: 400,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          toState: targetState,
        },
      );
    }

    if (
      this.options.requireReasonForSensitiveTransitions
      && SENSITIVE_TRANSITIONS.has(targetState)
      && !isNonEmptyString(context.reason)
      && !isNonEmptyString(context.reasonCode)
    ) {
      /**
       * Service-to-service automated transitions should be able to supply a
       * deterministic reason code instead of a human-readable reason.
       */
      const automatedActor =
        context.actorType === 'SYSTEM'
        || context.actorType === 'SERVICE'
        || context.actorType === 'WORKER';

      if (!automatedActor) {
        throw new TransactionStateMachineError(
          'A reason or reason code is required for this transition.',
          {
            code: ERROR_CODES.REASON_REQUIRED,
            statusCode: 400,
            transactionId: transaction.id,
            tenantId: context.tenantId,
            toState: targetState,
          },
        );
      }
    }
  }

  _requiresIdempotency(transaction, targetState) {
    if (
      isFinancialFinalState(targetState)
      || targetState === TRANSACTION_STATES.PROCESSING
      || targetState === TRANSACTION_STATES.RETRYING
      || targetState === TRANSACTION_STATES.REVERSED
      || targetState === TRANSACTION_STATES.CANCELLED
      || targetState === TRANSACTION_STATES.FAILED
    ) {
      return true;
    }

    return false;
  }

  async _validateStructuralTransition(
    transaction,
    nextState,
    context,
  ) {
    const currentState = transaction.status;

    if (!currentState) {
      throw new TransactionStateMachineError(
        'Current transaction state is missing.',
        {
          code: ERROR_CODES.INVALID_STATE,
          statusCode: 400,
          transactionId: transaction.id,
        },
      );
    }

    if (
      this.options.allowNoopTransitions
      && currentState === nextState
    ) {
      return;
    }

    if (!transitionExists(currentState, nextState)) {
      throw new TransactionStateMachineError(
        `Transition ${currentState} -> ${nextState} is not permitted.`,
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          fromState: currentState,
          toState: nextState,
          details: {
            allowedTransitions:
              this.getAllowedTransitions(currentState),
          },
        },
      );
    }

    if (
      currentState === TRANSACTION_STATES.REVERSED
      && nextState !== TRANSACTION_STATES.REVERSED
    ) {
      throw new TransactionStateMachineError(
        'A reversed transaction cannot move back into an active state.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          fromState: currentState,
          toState: nextState,
        },
      );
    }
  }

  async _runCustomGuard(
    transaction,
    nextState,
    context,
  ) {
    if (!this.transitionGuard) {
      return;
    }

    try {
      const result = await this.transitionGuard({
        transaction: clone(transaction),
        fromState: transaction.status,
        toState: nextState,
        context: clone(context),
      });

      if (result === false) {
        throw new TransactionStateMachineError(
          'Custom transition guard rejected the transaction transition.',
          {
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            statusCode: 409,
            transactionId: transaction.id,
            tenantId: context.tenantId,
            fromState: transaction.status,
            toState: nextState,
          },
        );
      }
    } catch (error) {
      if (error instanceof TransactionStateMachineError) {
        throw error;
      }

      throw new TransactionStateMachineError(
        'Transaction transition guard failed.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          fromState: transaction.status,
          toState: nextState,
          cause: error,
        },
      );
    }
  }

  async _runTransitionGuards(
    transaction,
    nextState,
    context,
  ) {
    switch (nextState) {
      case TRANSACTION_STATES.POSTED:
        await this._guardPosting(transaction, context);
        break;

      case TRANSACTION_STATES.REVERSED:
        await this._guardReversal(transaction, context);
        break;

      case TRANSACTION_STATES.CANCELLED:
        await this._guardCancellation(transaction, context);
        break;

      case TRANSACTION_STATES.UNKNOWN:
        await this._guardUnknown(transaction, context);
        break;

      case TRANSACTION_STATES.REQUIRES_RECONCILIATION:
        await this._guardReconciliation(transaction, context);
        break;

      case TRANSACTION_STATES.RETRYING:
        await this._guardRetry(transaction, context);
        break;

      case TRANSACTION_STATES.FAILED:
        await this._guardFailure(transaction, context);
        break;

      default:
        break;
    }
  }

  async _guardPosting(transaction, context) {
    if (this.financialCommitVerifier) {
      const committed =
        await this.financialCommitVerifier({
          transaction: clone(transaction),
          context: clone(context),
        });

      if (!committed) {
        throw new TransactionStateMachineError(
          'Transaction cannot become POSTED before authoritative financial commit.',
          {
            code: ERROR_CODES.POST_NOT_FINANCIAL_COMMITTED,
            statusCode: 409,
            transactionId: transaction.id,
            tenantId: context.tenantId,
          },
        );
      }
    }

    if (!isNonEmptyString(context.postingReference)) {
      /**
       * Service actors may rely on a persisted journal reference, but an
       * explicit posting reference is still preferred.
       */
      if (!isNonEmptyString(transaction.journalId)) {
        throw new TransactionStateMachineError(
          'A financial posting reference or journal reference is required before POSTED.',
          {
            code: ERROR_CODES.POSTING_REFERENCE_REQUIRED,
            statusCode: 409,
            transactionId: transaction.id,
            tenantId: context.tenantId,
          },
        );
      }
    }

    /**
     * Never allow a successful transaction with an obviously invalid
     * financial identity.
     */
    this._validateFinancialIdentity(transaction, context);
  }

  async _guardFailure(transaction, context) {
    /**
     * If an authoritative journal already exists, a failure state can be
     * unsafe. The financial subsystem should reconcile/reverse instead.
     */
    if (
      isNonEmptyString(transaction.journalId)
      && transaction.status !== TRANSACTION_STATES.FAILED
      && !context.allowFinancialFailureAfterPosting
    ) {
      throw new TransactionStateMachineError(
        'A transaction with an existing journal reference cannot be failed without financial reconciliation.',
        {
          code: ERROR_CODES.RECONCILIATION_REQUIRED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _guardCancellation(transaction, context) {
    if (transaction.status === TRANSACTION_STATES.POSTED) {
      throw new TransactionStateMachineError(
        'A posted transaction cannot be cancelled; use the reversal workflow.',
        {
          code: ERROR_CODES.CANCELLATION_NOT_ALLOWED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (isFinancialFinalState(transaction.status)) {
      throw new TransactionStateMachineError(
        'A financially final transaction cannot be cancelled.',
        {
          code: ERROR_CODES.CANCELLATION_NOT_ALLOWED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _guardReversal(transaction, context) {
    if (transaction.status !== TRANSACTION_STATES.POSTED) {
      throw new TransactionStateMachineError(
        'Only POSTED transactions can be reversed.',
        {
          code: ERROR_CODES.REVERSAL_NOT_ALLOWED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          fromState: transaction.status,
          toState: TRANSACTION_STATES.REVERSED,
        },
      );
    }

    if (!isNonEmptyString(context.reversalTransactionId)) {
      throw new TransactionStateMachineError(
        'A reversal transaction reference is required.',
        {
          code: ERROR_CODES.REVERSAL_REFERENCE_REQUIRED,
          statusCode: 400,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (transaction.reversedAt) {
      throw new TransactionStateMachineError(
        'The transaction has already been reversed.',
        {
          code: ERROR_CODES.ALREADY_REVERSED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _guardUnknown(transaction, context) {
    /**
     * UNKNOWN is intended for ambiguous external workflows.
     *
     * Do not allow a transaction to become UNKNOWN when it is already
     * financially final.
     */
    if (isFinancialFinalState(transaction.status)) {
      throw new TransactionStateMachineError(
        'A financially final transaction cannot be moved to UNKNOWN.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    const hasExternalDependency =
      isNonEmptyString(transaction.provider)
      || isNonEmptyString(transaction.providerTransactionId)
      || isNonEmptyString(context.providerTransactionId);

    if (!hasExternalDependency && this.options.strictMode) {
      throw new TransactionStateMachineError(
        'UNKNOWN state is intended for transactions with an unresolved external outcome.',
        {
          code: ERROR_CODES.UNKNOWN_OUTCOME,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _guardReconciliation(transaction, context) {
    if (isFinancialFinalState(transaction.status)) {
      throw new TransactionStateMachineError(
        'A financially final transaction does not require a normal reconciliation state transition.',
        {
          code: ERROR_CODES.RECONCILIATION_REQUIRED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _guardRetry(transaction, context) {
    if (
      transaction.status !== TRANSACTION_STATES.FAILED
      && transaction.status !== TRANSACTION_STATES.UNKNOWN
    ) {
      throw new TransactionStateMachineError(
        'A transaction may only enter RETRYING from a retryable failure/unknown state.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          fromState: transaction.status,
          toState: TRANSACTION_STATES.RETRYING,
        },
      );
    }

    if (!context.isRetry) {
      throw new TransactionStateMachineError(
        'Retry context is required for RETRYING transitions.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  _validateFinancialIdentity(transaction, context) {
    if (
      transaction.amount === undefined
      || transaction.amount === null
      || transaction.amount === ''
    ) {
      throw new TransactionStateMachineError(
        'A financial transaction must have an amount before posting.',
        {
          code: ERROR_CODES.INVALID_TRANSACTION,
          statusCode: 400,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (!isNonEmptyString(transaction.currency)) {
      throw new TransactionStateMachineError(
        'A financial transaction must have a currency before posting.',
        {
          code: ERROR_CODES.INVALID_TRANSACTION,
          statusCode: 400,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }
  }

  async _assertFinancialCommit(
    transactionOrId,
    context,
  ) {
    const transaction =
      await this._resolveTransaction(transactionOrId);

    const normalized =
      this._normalizeTransaction(transaction);

    if (!this.financialCommitVerifier) {
      /**
       * If no verifier is configured, require explicit evidence.
       * This keeps the state machine safe by default.
       */
      if (
        !isNonEmptyString(context.postingReference)
        && !isNonEmptyString(normalized.journalId)
      ) {
        throw new TransactionStateMachineError(
          'POSTED requires authoritative financial commit evidence.',
          {
            code: ERROR_CODES.POST_NOT_FINANCIAL_COMMITTED,
            statusCode: 409,
            transactionId: normalized.id,
            tenantId: context.tenantId,
          },
        );
      }

      return true;
    }

    const committed =
      await this.financialCommitVerifier({
        transaction: clone(normalized),
        context: clone(context),
      });

    if (!committed) {
      throw new TransactionStateMachineError(
        'Authoritative financial commit has not been verified.',
        {
          code: ERROR_CODES.POST_NOT_FINANCIAL_COMMITTED,
          statusCode: 409,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    return true;
  }

  async _assertFailureSafety(
    transactionOrId,
    context,
  ) {
    const transaction =
      await this._resolveTransaction(transactionOrId);

    const normalized =
      this._normalizeTransaction(transaction);

    if (
      normalized.status === TRANSACTION_STATES.POSTED
      || normalized.status === TRANSACTION_STATES.REVERSED
    ) {
      throw new TransactionStateMachineError(
        'A financially final transaction cannot be marked FAILED.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    return true;
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _checkIdempotency(
    transaction,
    targetState,
    context,
  ) {
    if (!isNonEmptyString(context.idempotencyKey)) {
      return {
        replay: false,
        record: null,
      };
    }

    const existing =
      await this._getIdempotencyRecord(
        context.tenantId,
        context.idempotencyKey,
      );

    if (!existing) {
      return {
        replay: false,
        record: null,
      };
    }

    const requestHash =
      createRequestHash(
        transaction,
        targetState,
        context,
      );

    if (
      existing.requestHash
      && existing.requestHash !== requestHash
    ) {
      throw new TransactionStateMachineError(
        'The idempotency key has already been used for a different operation.',
        {
          code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
          details: {
            idempotencyKey: context.idempotencyKey,
          },
        },
      );
    }

    if (existing.result) {
      return {
        replay: true,
        record: existing,
        result: clone(existing.result),
      };
    }

    return {
      replay: false,
      record: existing,
    };
  }

  async _getIdempotencyRecord(tenantId, key) {
    if (!key) {
      return null;
    }

    if (
      this.transactionRepository
      && typeof this.transactionRepository.findIdempotencyRecord === 'function'
    ) {
      return this.transactionRepository.findIdempotencyRecord({
        tenantId,
        key,
      });
    }

    if (this.idempotencyStore?.get) {
      return this.idempotencyStore.get(
        tenantId,
        key,
      );
    }

    return null;
  }

  async _persistIdempotencyResult(
    transaction,
    targetState,
    context,
    result,
    existingIdempotency,
  ) {
    if (!isNonEmptyString(context.idempotencyKey)) {
      return null;
    }

    const record = {
      tenantId: context.tenantId,
      key: context.idempotencyKey,
      operation: this._resolveTransitionType(
        transaction.status,
        targetState,
        context,
      ),
      requestHash: createRequestHash(
        transaction,
        targetState,
        context,
      ),
      status: 'COMPLETED',
      transactionId: transaction.id,
      result: clone(result),
      createdAt:
        existingIdempotency?.createdAt || isoNow(),
      updatedAt: isoNow(),
    };

    if (
      this.transactionRepository
      && typeof this.transactionRepository.createOrUpdateIdempotencyRecord === 'function'
    ) {
      return this.transactionRepository
        .createOrUpdateIdempotencyRecord(record);
    }

    if (this.idempotencyStore?.set) {
      return this.idempotencyStore.set(record);
    }

    if (this.idempotencyStore?.create) {
      return this.idempotencyStore.create(record);
    }

    return null;
  }

  /* ==========================================================================
   * Persistence
   * ======================================================================== */

  async _persistTransition(
    transaction,
    nextState,
    transitionRecord,
    context,
  ) {
    const expectedVersion =
      context.expectedVersion !== null
        ? context.expectedVersion
        : transaction.version;

    if (
      this.options.strictMode
      && expectedVersion === null
    ) {
      throw new TransactionStateMachineError(
        'Transaction version is required for an atomic state transition.',
        {
          code: ERROR_CODES.VERSION_REQUIRED,
          statusCode: 409,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    const patch = {
      status: nextState,
      version: expectedVersion + 1,
      updatedAt: now(),
      updatedBy: context.actorId,

      lastTransitionId:
        transitionRecord.transitionId,

      lastTransitionType:
        transitionRecord.transition,

      lastTransitionAt:
        transitionRecord.createdAt,

      lastTransitionReason:
        transitionRecord.reason || null,

      lastTransitionReasonCode:
        transitionRecord.reasonCode || null,

      ...(nextState === TRANSACTION_STATES.POSTED
        ? {
            processedAt: now(),
            postedAt: now(),
            failedAt: null,
            cancelledAt: null,
          }
        : {}),

      ...(nextState === TRANSACTION_STATES.FAILED
        ? {
            failedAt: now(),
          }
        : {}),

      ...(nextState === TRANSACTION_STATES.CANCELLED
        ? {
            cancelledAt: now(),
          }
        : {}),

      ...(nextState === TRANSACTION_STATES.REVERSED
        ? {
            reversedAt: now(),
            reversalTransactionId:
              context.reversalTransactionId || null,
          }
        : {}),
    };

    /**
     * Repository-aware atomic persistence.
     */
    if (
      this.transactionRepository
      && typeof this.transactionRepository.transitionWithVersion === 'function'
    ) {
      const persistenceContext =
        context.persistenceContext || null;

      const result =
        await this.transactionRepository.transitionWithVersion(
          transaction.id,
          expectedVersion,
          patch,
          {
            tenantId: context.tenantId,
            transitionRecord,
            persistenceContext,
          },
        );

      if (!result) {
        throw this._concurrencyError(
          transaction,
          context,
          expectedVersion,
        );
      }

      if (
        this.transactionRepository
        && typeof this.transactionRepository.createTransitionRecord === 'function'
      ) {
        await this.transactionRepository.createTransitionRecord(
          transitionRecord,
          {
            tenantId: context.tenantId,
            persistenceContext,
          },
        );
      }

      return result;
    }

    /**
     * Mongoose-style atomic update support.
     *
     * If the supplied repository exposes updateWithVersion, prefer that.
     */
    if (
      this.transactionRepository
      && typeof this.transactionRepository.updateWithVersion === 'function'
    ) {
      const result =
        await this.transactionRepository.updateWithVersion(
          transaction.id,
          expectedVersion,
          patch,
          {
            tenantId: context.tenantId,
            persistenceContext:
              context.persistenceContext || null,
          },
        );

      if (!result) {
        throw this._concurrencyError(
          transaction,
          context,
          expectedVersion,
        );
      }

      if (
        this.transactionRepository
        && typeof this.transactionRepository.createTransitionRecord === 'function'
      ) {
        await this.transactionRepository.createTransitionRecord(
          transitionRecord,
          {
            tenantId: context.tenantId,
            persistenceContext:
              context.persistenceContext || null,
          },
        );
      }

      return result;
    }

    /**
     * Safe in-memory/plain-object fallback for tests only.
     *
     * Production persistence should provide an atomic repository method.
     */
    if (
      this.options.strictMode
      && !this.transactionRepository
    ) {
      throw new TransactionStateMachineError(
        'A transaction repository is required for production state transitions.',
        {
          code: ERROR_CODES.INVALID_TRANSACTION,
          statusCode: 500,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    const currentVersion =
      parseVersion(transaction.version) ?? 0;

    if (currentVersion !== expectedVersion) {
      throw this._concurrencyError(
        transaction,
        context,
        expectedVersion,
      );
    }

    Object.assign(transaction, patch);

    if (this.options.freezeTransactionObject) {
      try {
        Object.freeze(transaction);
      } catch (_error) {
        // Ignore freezing failures for ORM documents.
      }
    }

    return transaction;
  }

  _concurrencyError(
    transaction,
    context,
    expectedVersion,
  ) {
    return new TransactionStateMachineError(
      'Transaction was modified by another worker or request.',
      {
        code: ERROR_CODES.CONCURRENT_TRANSACTION_UPDATE,
        statusCode: 409,
        transactionId: transaction.id,
        tenantId: context.tenantId,
        details: {
          expectedVersion,
          currentVersion: transaction.version,
        },
      },
    );
  }

  /* ==========================================================================
   * Transition Records / Events / Audit
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
      case TRANSACTION_STATES.PENDING:
        return TRANSITION_TYPES.PEND;

      case TRANSACTION_STATES.PROCESSING:
        return TRANSITION_TYPES.PROCESS;

      case TRANSACTION_STATES.POSTED:
        return TRANSITION_TYPES.POST;

      case TRANSACTION_STATES.FAILED:
        return TRANSITION_TYPES.FAIL;

      case TRANSACTION_STATES.CANCELLED:
        return TRANSITION_TYPES.CANCEL;

      case TRANSACTION_STATES.REVERSED:
        return TRANSITION_TYPES.REVERSE;

      case TRANSACTION_STATES.RETRYING:
        return TRANSITION_TYPES.RETRY;

      case TRANSACTION_STATES.UNKNOWN:
        return TRANSITION_TYPES.MARK_UNKNOWN;

      case TRANSACTION_STATES.REQUIRES_RECONCILIATION:
        return TRANSITION_TYPES.RECONCILE;

      case TRANSACTION_STATES.DEAD_LETTER:
        return TRANSITION_TYPES.DEAD_LETTER;

      case TRANSACTION_STATES.INITIATED:
      default:
        return TRANSITION_TYPES.START;
    }
  }

  _buildTransitionRecord({
    transaction,
    targetState,
    transition,
    transitionId,
    requestHash,
    fingerprint,
    context,
  }) {
    return {
      transitionId,
      transactionId: transaction.id,
      tenantId: context.tenantId,
      fromState: transaction.status,
      toState: targetState,
      transition,
      transactionVersionBefore: transaction.version,
      transactionVersionAfter: transaction.version + 1,

      actorId: context.actorId,
      actorType: context.actorType,
      actorRole: context.actorRole,

      requestId: context.requestId,
      correlationId: context.correlationId,
      causationId: context.causationId,

      idempotencyKey: context.idempotencyKey,
      requestHash,
      fingerprint,

      source: context.source,
      provider: context.provider,
      providerTransactionId:
        context.providerTransactionId
        || transaction.providerTransactionId
        || null,

      postingReference:
        context.postingReference
        || null,

      reversalTransactionId:
        context.reversalTransactionId
        || null,

      reason: context.reason,
      reasonCode: context.reasonCode,

      metadata: clone(context.metadata),

      createdAt: isoNow(),
    };
  }

  _buildResult(
    transaction,
    targetState,
    transitionRecord,
    persisted,
  ) {
    const persistedPlain =
      toPlainObject(persisted);

    return {
      success: true,

      transactionId:
        transaction.id,

      previousState:
        transaction.status,

      currentState:
        targetState,

      transitionId:
        transitionRecord.transitionId,

      transition:
        transitionRecord.transition,

      version:
        parseVersion(
          persistedPlain?.version,
        )
        ?? transitionRecord.transactionVersionAfter,

      terminal:
        isTerminal(targetState),

      financialFinal:
        isFinancialFinalState(targetState),

      posted:
        targetState === TRANSACTION_STATES.POSTED,

      reversed:
        targetState === TRANSACTION_STATES.REVERSED,

      requestId:
        transitionRecord.requestId || null,

      correlationId:
        transitionRecord.correlationId || null,

      timestamp:
        transitionRecord.createdAt,
    };
  }

  _buildNoopResult(
    transaction,
    targetState,
    context,
  ) {
    return {
      success: true,
      noop: true,
      transactionId: transaction.id,
      previousState: transaction.status,
      currentState: targetState,
      transitionId: null,
      transition: 'NOOP',
      version: transaction.version,
      terminal: isTerminal(targetState),
      financialFinal: isFinancialFinalState(targetState),
      posted: targetState === TRANSACTION_STATES.POSTED,
      reversed: targetState === TRANSACTION_STATES.REVERSED,
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      timestamp: isoNow(),
    };
  }

  async _recordAudit(
    transitionRecord,
    transaction,
    nextState,
    context,
  ) {
    if (!this.auditService) {
      return;
    }

    const auditPayload = {
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorType: context.actorType,
      actorRole: context.actorRole,

      action:
        `TRANSACTION_${nextState}`,

      resourceType:
        'FinancialTransaction',

      resourceId:
        transaction.id,

      transactionId:
        transaction.id,

      fromState:
        transitionRecord.fromState,

      toState:
        transitionRecord.toState,

      transition:
        transitionRecord.transition,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      reason:
        context.reason || null,

      reasonCode:
        context.reasonCode || null,

      outcome:
        'success',

      metadata:
        this._redactMetadata(context.metadata),

      createdAt:
        transitionRecord.createdAt,
    };

    try {
      if (typeof this.auditService.record === 'function') {
        await this.auditService.record(
          auditPayload,
        );
        return;
      }

      if (typeof this.auditService.create === 'function') {
        await this.auditService.create(
          auditPayload,
        );
      }
    } catch (error) {
      /**
       * Audit persistence failure must not be silently ignored in high-integrity
       * financial systems. Logging is retained here, while deployments may
       * configure the audit implementation to participate in the same
       * transaction/outbox boundary.
       */
      this._logError(
        'Failed to record transaction transition audit event',
        error,
        {
          transactionId: transaction.id,
          tenantId: context.tenantId,
          transitionId:
            transitionRecord.transitionId,
        },
      );

      if (this.options.strictMode) {
        throw error;
      }
    }
  }

  async _publishTransitionEvent(
    transitionRecord,
    transaction,
    nextState,
    context,
  ) {
    if (!this.eventPublisher) {
      return;
    }

    const event = this._buildTransitionEvent(
      transitionRecord,
      transaction,
      nextState,
      context,
    );

    try {
      if (typeof this.eventPublisher.publish === 'function') {
        await this.eventPublisher.publish(event);
        return;
      }

      if (typeof this.eventPublisher.publishEvent === 'function') {
        await this.eventPublisher.publishEvent(event);
      }
    } catch (error) {
      this._logError(
        'Failed to publish transaction state event',
        error,
        {
          transactionId: transaction.id,
          tenantId: context.tenantId,
          eventId: event.eventId,
          eventType: event.eventType,
        },
      );

      /**
       * Production deployments should normally use an outbox transaction,
       * where event publication is retried asynchronously rather than causing
       * an already-committed financial transaction to be rolled back.
       */
      if (this.options.strictEventPublishing === true) {
        throw error;
      }
    }
  }

  _buildTransitionEvent(
    transitionRecord,
    transaction,
    nextState,
    context,
  ) {
    const eventId =
      `evt_${crypto.randomUUID()}`;

    return {
      eventId,

      eventType:
        this._eventTypeForState(nextState),

      eventVersion:
        1,

      eventSchema:
        `titech.transaction.${String(nextState).toLowerCase()}.v1`,

      occurredAt:
        transitionRecord.createdAt,

      publishedAt:
        null,

      tenantId:
        context.tenantId,

      aggregateType:
        'Transaction',

      aggregateId:
        transaction.id,

      aggregateVersion:
        transitionRecord.transactionVersionAfter,

      correlationId:
        context.correlationId || null,

      causationId:
        context.causationId || null,

      requestId:
        context.requestId || null,

      producer:
        'TransactionStateMachine',

      environment:
        process.env.NODE_ENV || 'development',

      data: {
        transactionId:
          transaction.id,

        transactionType:
          transaction.transactionType || null,

        previousState:
          transitionRecord.fromState,

        currentState:
          nextState,

        amount:
          this._safeMonetaryValue(transaction.amount),

        currency:
          transaction.currency || null,

        sourceType:
          transaction.sourceType || null,

        sourceId:
          transaction.sourceId || null,

        provider:
          transaction.provider
          || context.provider
          || null,

        providerTransactionId:
          transaction.providerTransactionId
          || context.providerTransactionId
          || null,

        transitionId:
          transitionRecord.transitionId,

        reasonCode:
          context.reasonCode || null,
      },
    };
  }

  _eventTypeForState(state) {
    switch (state) {
      case TRANSACTION_STATES.INITIATED:
        return 'TransactionInitiated';

      case TRANSACTION_STATES.PENDING:
        return 'TransactionPending';

      case TRANSACTION_STATES.PROCESSING:
        return 'TransactionProcessing';

      case TRANSACTION_STATES.POSTED:
        return 'FinancialTransactionPosted';

      case TRANSACTION_STATES.FAILED:
        return 'TransactionFailed';

      case TRANSACTION_STATES.CANCELLED:
        return 'TransactionCancelled';

      case TRANSACTION_STATES.REVERSED:
        return 'TransactionReversed';

      case TRANSACTION_STATES.RETRYING:
        return 'TransactionRetrying';

      case TRANSACTION_STATES.UNKNOWN:
        return 'TransactionOutcomeUnknown';

      case TRANSACTION_STATES.REQUIRES_RECONCILIATION:
        return 'TransactionReconciliationRequired';

      case TRANSACTION_STATES.DEAD_LETTER:
        return 'TransactionDeadLettered';

      default:
        return 'TransactionStateChanged';
    }
  }

  _redactMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const sensitiveKeys = new Set([
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'secret',
      'clientSecret',
      'apiKey',
      'privateKey',
      'authorization',
      'signatureSecret',
      'webhookSecret',
    ]);

    const output = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (sensitiveKeys.has(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = clone(value);
      }
    }

    return output;
  }

  _safeMonetaryValue(value) {
    if (value === undefined || value === null) {
      return null;
    }

    /**
     * Never convert authoritative monetary values through binary floating-point
     * arithmetic. Preserve string/Decimal-like representations.
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

  /* ==========================================================================
   * Dead Letter Handling
   * ======================================================================== */

  async _transitionToDeadLetter(
    transactionOrId,
    context,
  ) {
    const transaction =
      await this._resolveTransaction(transactionOrId);

    const normalized =
      this._normalizeTransaction(transaction);

    if (isFinancialFinalState(normalized.status)) {
      throw new TransactionStateMachineError(
        'A financially final transaction cannot be moved to DEAD_LETTER.',
        {
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          statusCode: 409,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    /**
     * DEAD_LETTER is operational and intentionally does not form part of the
     * normal business state graph. It is managed here through an explicit,
     * privileged recovery operation.
     */
    if (
      this.options.requireActor
      && !isNonEmptyString(context.actorId)
    ) {
      throw new TransactionStateMachineError(
        'An actor is required to dead-letter a transaction.',
        {
          code: ERROR_CODES.INVALID_ACTOR,
          statusCode: 403,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (
      this.options.requireTenant
      && (
        !context.tenantId
        || (
          normalized.tenantId
          && normalized.tenantId !== context.tenantId
        )
      )
    ) {
      throw new TransactionStateMachineError(
        'Valid tenant context is required to dead-letter a transaction.',
        {
          code: ERROR_CODES.TENANT_MISMATCH,
          statusCode: 403,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    if (
      this.options.requireReasonForSensitiveTransitions
      && !context.reason
      && !context.reasonCode
    ) {
      throw new TransactionStateMachineError(
        'A reason or reason code is required to dead-letter a transaction.',
        {
          code: ERROR_CODES.REASON_REQUIRED,
          statusCode: 400,
          transactionId: normalized.id,
          tenantId: context.tenantId,
        },
      );
    }

    const transitionId = createTransitionId(
      normalized.id,
      normalized.status,
      TRANSACTION_STATES.DEAD_LETTER,
      context,
    );

    const record = this._buildTransitionRecord({
      transaction: normalized,
      targetState: TRANSACTION_STATES.DEAD_LETTER,
      transition:
        TRANSITION_TYPES.DEAD_LETTER,
      transitionId,
      requestHash:
        createRequestHash(
          normalized,
          TRANSACTION_STATES.DEAD_LETTER,
          context,
        ),
      fingerprint:
        createTransitionFingerprint({
          transactionId: normalized.id,
          fromState: normalized.status,
          toState: TRANSACTION_STATES.DEAD_LETTER,
          transition: TRANSITION_TYPES.DEAD_LETTER,
          context,
        }),
      context,
    });

    const persisted =
      await this._persistOperationalState(
        normalized,
        TRANSACTION_STATES.DEAD_LETTER,
        record,
        context,
      );

    const result = this._buildResult(
      normalized,
      TRANSACTION_STATES.DEAD_LETTER,
      record,
      persisted,
    );

    await this._recordAudit(
      record,
      normalized,
      TRANSACTION_STATES.DEAD_LETTER,
      context,
    );

    await this._publishTransitionEvent(
      record,
      normalized,
      TRANSACTION_STATES.DEAD_LETTER,
      context,
    );

    return result;
  }

  async _persistOperationalState(
    transaction,
    nextState,
    transitionRecord,
    context,
  ) {
    const expectedVersion =
      context.expectedVersion !== null
        ? context.expectedVersion
        : transaction.version;

    const patch = {
      status: nextState,
      version: expectedVersion + 1,
      updatedAt: now(),
      updatedBy: context.actorId,
      lastTransitionId: transitionRecord.transitionId,
      lastTransitionType: transitionRecord.transition,
      lastTransitionAt: transitionRecord.createdAt,
      lastTransitionReason: context.reason || null,
      lastTransitionReasonCode: context.reasonCode || null,
    };

    if (
      this.transactionRepository
      && typeof this.transactionRepository.transitionWithVersion === 'function'
    ) {
      const result =
        await this.transactionRepository.transitionWithVersion(
          transaction.id,
          expectedVersion,
          patch,
          {
            tenantId: context.tenantId,
            transitionRecord,
            persistenceContext:
              context.persistenceContext || null,
          },
        );

      if (!result) {
        throw this._concurrencyError(
          transaction,
          context,
          expectedVersion,
        );
      }

      return result;
    }

    if (
      this.transactionRepository
      && typeof this.transactionRepository.updateWithVersion === 'function'
    ) {
      const result =
        await this.transactionRepository.updateWithVersion(
          transaction.id,
          expectedVersion,
          patch,
          {
            tenantId: context.tenantId,
            persistenceContext:
              context.persistenceContext || null,
          },
        );

      if (!result) {
        throw this._concurrencyError(
          transaction,
          context,
          expectedVersion,
        );
      }

      return result;
    }

    if (this.options.strictMode) {
      throw new TransactionStateMachineError(
        'A transaction repository is required for operational state persistence.',
        {
          code: ERROR_CODES.INVALID_TRANSACTION,
          statusCode: 500,
          transactionId: transaction.id,
          tenantId: context.tenantId,
        },
      );
    }

    Object.assign(transaction, patch);

    return transaction;
  }

  /* ==========================================================================
   * Logging
   * ======================================================================== */

  _logError(message, error, metadata = {}) {
    try {
      if (
        this.logger
        && typeof this.logger.error === 'function'
      ) {
        this.logger.error(
          message,
          {
            error: {
              name: error?.name,
              code: error?.code,
              message: error?.message,
            },
            ...metadata,
          },
        );
      }
    } catch (_loggingError) {
      // Logging must never mask the original application error.
    }
  }
}

/* ============================================================================
 * Static Helpers
 * ========================================================================== */

TransactionStateMachine.STATES = TRANSACTION_STATES;
TransactionStateMachine.TERMINAL_STATES = Object.freeze([
  ...TERMINAL_STATES,
]);

TransactionStateMachine.FINANCIAL_FINAL_STATES = Object.freeze([
  ...FINANCIAL_FINAL_STATES,
]);

TransactionStateMachine.TRANSITIONS = TRANSITIONS;
TransactionStateMachine.TRANSITION_TYPES = TRANSITION_TYPES;
TransactionStateMachine.ERROR_CODES = ERROR_CODES;
TransactionStateMachine.SENSITIVE_TRANSITIONS =
  Object.freeze([...SENSITIVE_TRANSITIONS]);

TransactionStateMachine.isValidState = function isValidState(value) {
  return normalizeState(value) !== null;
};

TransactionStateMachine.isTerminalState =
  function isTerminalState(value) {
    const normalized = normalizeState(value);

    return normalized
      ? isTerminal(normalized)
      : false;
  };

TransactionStateMachine.isFinancialFinalState =
  function isFinancialFinalState(value) {
    const normalized = normalizeState(value);

    return normalized
      ? isFinancialFinalState(normalized)
      : false;
  };

TransactionStateMachine.getAllowedTransitions =
  function getAllowedTransitions(value) {
    const normalized = normalizeState(value);

    if (!normalized) {
      return [];
    }

    return [...(TRANSITIONS[normalized] || [])];
  };

/* ============================================================================
 * Factory
 * ========================================================================== */

function createTransactionStateMachine(dependencies = {}) {
  return new TransactionStateMachine(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports = TransactionStateMachine;
module.exports.TransactionStateMachine = TransactionStateMachine;
module.exports.TransactionStateMachineError =
  TransactionStateMachineError;
module.exports.InMemoryIdempotencyStore =
  InMemoryIdempotencyStore;
module.exports.createTransactionStateMachine =
  createTransactionStateMachine;

module.exports.TRANSACTION_STATES =
  TRANSACTION_STATES;

module.exports.TRANSACTION_STATE_TRANSITIONS =
  TRANSITIONS;

module.exports.TRANSACTION_TRANSITION_TYPES =
  TRANSITION_TYPES;

module.exports.TRANSACTION_STATE_ERROR_CODES =
  ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */