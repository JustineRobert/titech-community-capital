'use strict';

/**
 * TITech Community Capital
 * Enterprise Settlement Processor
 *
 * File:
 *   backend/modules/payment/settlement/settlementProcessor.js
 *
 * Architectural Role
 * ------------------
 * Coordinates the authoritative settlement workflow after payment initiation
 * and provider processing. This module is the orchestration boundary between:
 *
 *   Payment
 *      |
 *      v
 *   Provider
 *      |
 *      v
 *   Settlement
 *      |
 *      +--> Reconciliation
 *      |
 *      +--> Financial Transaction / Ledger
 *      |
 *      +--> Audit
 *      |
 *      +--> Outbox / Events
 *
 * Responsibilities
 * ----------------
 * - Enforce settlement state transitions.
 * - Resolve and validate tenant scope.
 * - Enforce idempotency.
 * - Validate provider outcomes before financial settlement.
 * - Coordinate reconciliation.
 * - Coordinate authoritative financial posting.
 * - Coordinate settlement audit records.
 * - Coordinate transactional outbox events.
 * - Handle retries and safe duplicate processing.
 * - Provide deterministic failure classification.
 * - Maintain correlation/request context.
 *
 * Explicit Non-Responsibilities
 * -----------------------------
 * - Does not directly mutate balances.
 * - Does not directly modify ledger records.
 * - Does not call provider APIs directly unless an explicitly injected
 *   provider orchestrator is supplied.
 * - Does not trust an HTTP 200 response as proof of settlement.
 * - Does not bypass reconciliation requirements.
 * - Does not overwrite historical settlement records.
 *
 * Financial Safety
 * ----------------
 * Final settlement requires authoritative evidence.
 *
 * Provider response:
 *   NOT AUTOMATICALLY == SETTLED
 *
 * A payment may only become SETTLED after the configured financial domain
 * service confirms that the settlement conditions are satisfied.
 *
 * Module Format
 * -------------
 * CommonJS.
 */

const crypto = require('crypto');

const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_RETRY_MAX_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

const SETTLEMENT_STATES = Object.freeze({
  CREATED: 'CREATED',
  INITIATED: 'INITIATED',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  CALLBACK_RECEIVED: 'CALLBACK_RECEIVED',
  VALIDATED: 'VALIDATED',
  RECONCILING: 'RECONCILING',
  SETTLED: 'SETTLED',

  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  DISPUTED: 'DISPUTED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW'
});

const SETTLEMENT_EVENTS = Object.freeze({
  CREATED: 'SETTLEMENT_CREATED',
  INITIATED: 'SETTLEMENT_INITIATED',
  PROVIDER_ACCEPTED: 'SETTLEMENT_PROVIDER_ACCEPTED',
  CALLBACK_RECEIVED: 'SETTLEMENT_CALLBACK_RECEIVED',
  VALIDATED: 'SETTLEMENT_VALIDATED',
  RECONCILIATION_STARTED: 'SETTLEMENT_RECONCILIATION_STARTED',
  RECONCILED: 'SETTLEMENT_RECONCILED',
  SETTLED: 'SETTLEMENT_SETTLED',
  FAILED: 'SETTLEMENT_FAILED',
  TIMEOUT: 'SETTLEMENT_TIMEOUT',
  REVERSED: 'SETTLEMENT_REVERSED',
  CANCELLED: 'SETTLEMENT_CANCELLED',
  DISPUTED: 'SETTLEMENT_DISPUTED',
  REVIEW_REQUIRED: 'SETTLEMENT_REVIEW_REQUIRED'
});

const TERMINAL_STATES = new Set([
  SETTLEMENT_STATES.SETTLED,
  SETTLEMENT_STATES.FAILED,
  SETTLEMENT_STATES.CANCELLED,
  SETTLEMENT_STATES.REVERSED,
  SETTLEMENT_STATES.DISPUTED
]);

const SUCCESSFUL_RECONCILIATION_STATUSES = new Set([
  'MATCHED',
  'RESOLVED',
  'SETTLED'
]);

const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'DATABASE_TEMPORARY_FAILURE',
  'LOCK_TIMEOUT',
  'TRANSIENT_TRANSACTION_ERROR'
]);

class SettlementProcessorError extends Error {
  constructor(
    message,
    code = 'SETTLEMENT_PROCESSOR_ERROR',
    details = undefined,
    options = {}
  ) {
    super(message);
    this.name = 'SettlementProcessorError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.conflict = Boolean(options.conflict);
    this.operational = options.operational !== false;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SettlementProcessorError);
    }
  }
}

/**
 * Resolve a logger without creating a hard bootstrap dependency.
 *
 * @param {object} injectedLogger
 * @returns {object}
 */
function resolveLogger(injectedLogger) {
  if (injectedLogger) {
    return injectedLogger;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(candidate);
      const logger = loaded?.default || loaded;

      if (logger) {
        return logger;
      }
    } catch (_error) {
      // Continue.
    }
  }

  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

/**
 * Generate a deterministic operation identifier when the caller did not
 * supply one.
 *
 * @returns {string}
 */
function createOperationId() {
  return `settle_${crypto.randomUUID()}`;
}

/**
 * Normalize identifiers.
 *
 * @param {*} value
 * @returns {string|undefined}
 */
function normalizeId(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (
    typeof value === 'object' &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return String(value);
}

/**
 * Normalize a string.
 *
 * @param {*} value
 * @param {number} maxLength
 * @returns {string|undefined}
 */
function normalizeString(value, maxLength = 1000) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

/**
 * Normalize processing context.
 *
 * @param {object} context
 * @returns {object}
 */
function normalizeContext(context = {}) {
  return {
    operationId: normalizeId(
      context.operationId || context.idempotencyKey
    ),
    requestId: normalizeString(context.requestId, 256),
    correlationId: normalizeString(context.correlationId, 256),
    traceId: normalizeString(context.traceId, 256),
    source: normalizeString(context.source, 128),
    actorId: normalizeId(context.actorId),
    actorType: normalizeString(context.actorType, 128),
    serviceName: normalizeString(context.serviceName, 256)
  };
}

/**
 * Safely classify errors without exposing secrets or provider credentials.
 *
 * @param {Error|object} error
 * @returns {object}
 */
function classifyError(error) {
  const code = normalizeString(error?.code, 128);
  const message = normalizeString(
    error?.message || String(error),
    1000
  );

  const retryable =
    Boolean(error?.retryable) ||
    RETRYABLE_ERROR_CODES.has(code) ||
    /timeout|temporar|unavailable|connection reset|deadlock/i.test(
      message
    );

  return {
    code: code || 'SETTLEMENT_PROCESSING_ERROR',
    message,
    retryable,
    providerCode: normalizeString(
      error?.providerCode,
      128
    ),
    providerStatus: normalizeString(
      error?.providerStatus,
      128
    )
  };
}

/**
 * Determine whether a state is terminal.
 *
 * @param {string} state
 * @returns {boolean}
 */
function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * Validate a settlement state transition.
 *
 * State transitions are deliberately explicit. Unknown transitions are denied.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  const transitions = {
    [SETTLEMENT_STATES.CREATED]: new Set([
      SETTLEMENT_STATES.INITIATED,
      SETTLEMENT_STATES.CANCELLED
    ]),

    [SETTLEMENT_STATES.INITIATED]: new Set([
      SETTLEMENT_STATES.PENDING_PROVIDER,
      SETTLEMENT_STATES.PROVIDER_ACCEPTED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.TIMEOUT,
      SETTLEMENT_STATES.CANCELLED,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ]),

    [SETTLEMENT_STATES.PENDING_PROVIDER]: new Set([
      SETTLEMENT_STATES.PROVIDER_ACCEPTED,
      SETTLEMENT_STATES.CALLBACK_RECEIVED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.TIMEOUT,
      SETTLEMENT_STATES.CANCELLED,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ]),

    [SETTLEMENT_STATES.PROVIDER_ACCEPTED]: new Set([
      SETTLEMENT_STATES.CALLBACK_RECEIVED,
      SETTLEMENT_STATES.VALIDATED,
      SETTLEMENT_STATES.RECONCILING,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ]),

    [SETTLEMENT_STATES.CALLBACK_RECEIVED]: new Set([
      SETTLEMENT_STATES.VALIDATED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.REQUIRES_REVIEW,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION
    ]),

    [SETTLEMENT_STATES.VALIDATED]: new Set([
      SETTLEMENT_STATES.RECONCILING,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ]),

    [SETTLEMENT_STATES.RECONCILING]: new Set([
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
      SETTLEMENT_STATES.REQUIRES_REVIEW,
      SETTLEMENT_STATES.FAILED
    ]),

    [SETTLEMENT_STATES.REQUIRES_RECONCILIATION]: new Set([
      SETTLEMENT_STATES.RECONCILING,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.REVERSED,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ]),

    [SETTLEMENT_STATES.REQUIRES_REVIEW]: new Set([
      SETTLEMENT_STATES.VALIDATED,
      SETTLEMENT_STATES.RECONCILING,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.CANCELLED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.REVERSED,
      SETTLEMENT_STATES.DISPUTED
    ]),

    [SETTLEMENT_STATES.SETTLED]: new Set([
      SETTLEMENT_STATES.REVERSED,
      SETTLEMENT_STATES.DISPUTED
    ]),

    [SETTLEMENT_STATES.FAILED]: new Set([]),

    [SETTLEMENT_STATES.TIMEOUT]: new Set([
      SETTLEMENT_STATES.PENDING_PROVIDER,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
      SETTLEMENT_STATES.REQUIRES_REVIEW,
      SETTLEMENT_STATES.FAILED
    ]),

    [SETTLEMENT_STATES.CANCELLED]: new Set([]),

    [SETTLEMENT_STATES.REVERSED]: new Set([]),

    [SETTLEMENT_STATES.DISPUTED]: new Set([
      SETTLEMENT_STATES.REVERSED,
      SETTLEMENT_STATES.REQUIRES_REVIEW
    ])
  };

  return Boolean(
    transitions[from] &&
      transitions[from].has(to)
  );
}

/**
 * Normalize a settlement snapshot.
 *
 * @param {object} settlement
 * @returns {object}
 */
function normalizeSettlement(settlement) {
  if (!settlement || typeof settlement !== 'object') {
    throw new SettlementProcessorError(
      'Settlement object is required.',
      'SETTLEMENT_REQUIRED'
    );
  }

  const normalized = {
    id: normalizeId(
      settlement._id ||
      settlement.id ||
      settlement.settlementId
    ),

    tenantId: normalizeId(
      settlement.tenantId
    ),

    paymentId: normalizeId(
      settlement.paymentId
    ),

    paymentReference: normalizeString(
      settlement.paymentReference,
      256
    ),

    financialTransactionId: normalizeId(
      settlement.financialTransactionId
    ),

    financialTransactionReference:
      normalizeString(
        settlement.financialTransactionReference,
        256
      ),

    reconciliationId:
      normalizeId(
        settlement.reconciliationId
      ),

    provider: normalizeString(
      settlement.provider,
      128
    ),

    providerTransactionId:
      normalizeString(
        settlement.providerTransactionId,
        256
      ),

    providerReference:
      normalizeString(
        settlement.providerReference,
        256
      ),

    status:
      normalizeString(
        settlement.status,
        128
      ) || SETTLEMENT_STATES.CREATED,

    amount:
      settlement.amount !== undefined &&
      settlement.amount !== null
        ? String(settlement.amount)
        : undefined,

    currency:
      normalizeString(
        settlement.currency,
        16
      )
  };

  if (!normalized.id) {
    throw new SettlementProcessorError(
      'Settlement identifier is required.',
      'SETTLEMENT_ID_REQUIRED'
    );
  }

  if (!normalized.tenantId) {
    throw new SettlementProcessorError(
      'Settlement tenantId is required.',
      'SETTLEMENT_TENANT_REQUIRED'
    );
  }

  if (!normalized.currency) {
    throw new SettlementProcessorError(
      'Settlement currency is required.',
      'SETTLEMENT_CURRENCY_REQUIRED'
    );
  }

  if (normalized.amount === undefined) {
    throw new SettlementProcessorError(
      'Settlement amount is required.',
      'SETTLEMENT_AMOUNT_REQUIRED'
    );
  }

  return normalized;
}

/**
 * Ensure caller tenant context and settlement tenant context agree.
 *
 * @param {string} requestedTenantId
 * @param {string} settlementTenantId
 */
function assertTenantScope(requestedTenantId, settlementTenantId) {
  const expected = normalizeId(requestedTenantId);
  const actual = normalizeId(settlementTenantId);

  if (!expected || !actual || expected !== actual) {
    throw new SettlementProcessorError(
      'Settlement tenant scope mismatch.',
      'TENANT_SCOPE_VIOLATION',
      {
        requestedTenantId: expected,
        settlementTenantId: actual
      }
    );
  }
}

/**
 * Require a configured dependency.
 *
 * @param {object} dependency
 * @param {string} name
 */
function requireDependency(dependency, name) {
  if (!dependency) {
    throw new SettlementProcessorError(
      `${name} dependency is not configured.`,
      'DEPENDENCY_NOT_CONFIGURED',
      { dependency: name }
    );
  }
}

/**
 * Create an enterprise settlement processor.
 *
 * Dependencies are injected to avoid coupling this module to one repository
 * implementation and to permit deterministic unit/integration testing.
 *
 * Supported dependency concepts:
 *
 * settlementRepository
 * financialTransactionService
 * reconciliationService
 * settlementAudit
 * outboxService
 * idempotencyService
 * providerOrchestrator
 * authorizationService
 * lockService
 * transactionManager
 * clock
 * logger
 *
 * @param {object} options
 * @returns {object}
 */
function createSettlementProcessor(options = {}) {
  const {
    settlementRepository,
    financialTransactionService,
    reconciliationService,
    settlementAudit,
    outboxService,
    idempotencyService,
    providerOrchestrator,
    authorizationService,
    lockService,
    transactionManager,
    logger: injectedLogger,
    clock,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    retryMaxMs = DEFAULT_RETRY_MAX_MS
  } = options;

  const logger = resolveLogger(injectedLogger);

  /**
   * Current time provider.
   *
   * @returns {Date}
   */
  function now() {
    if (clock?.now instanceof Function) {
      return new Date(clock.now());
    }

    return new Date();
  }

  /**
   * Calculate exponential backoff with bounded jitter.
   *
   * @param {number} attempt
   * @returns {number}
   */
  function calculateRetryDelay(attempt) {
    const exponential =
      retryBaseMs * (2 ** Math.max(attempt - 1, 0));

    const bounded = Math.min(
      exponential,
      retryMaxMs
    );

    const jitter =
      Math.floor(Math.random() * Math.max(1, bounded * 0.25));

    return Math.min(
      retryMaxMs,
      bounded + jitter
    );
  }

  /**
   * Safely check whether authorization is required and valid.
   *
   * @param {object} context
   * @param {string} action
   * @param {object} settlement
   */
  async function authorize(context, action, settlement) {
    if (!authorizationService) {
      return true;
    }

    if (typeof authorizationService.assert === 'function') {
      await authorizationService.assert({
        tenantId: settlement.tenantId,
        actorId: context.actorId,
        actorType: context.actorType,
        action,
        resource: 'settlement',
        resourceId: settlement.id
      });

      return true;
    }

    if (typeof authorizationService.can === 'function') {
      const permitted = await authorizationService.can({
        tenantId: settlement.tenantId,
        actorId: context.actorId,
        actorType: context.actorType,
        action,
        resource: 'settlement',
        resourceId: settlement.id
      });

      if (!permitted) {
        throw new SettlementProcessorError(
          'Settlement operation is not authorized.',
          'AUTHORIZATION_DENIED'
        );
      }

      return true;
    }

    return true;
  }

  /**
   * Acquire a settlement-specific lock when supported.
   *
   * @param {object} settlement
   * @returns {Promise<object|null>}
   */
  async function acquireSettlementLock(settlement) {
    if (!lockService) {
      return null;
    }

    const key =
      `settlement:${settlement.tenantId}:${settlement.id}`;

    if (typeof lockService.acquire === 'function') {
      return lockService.acquire(key, {
        ttlMs: 60 * 1000
      });
    }

    if (typeof lockService.lock === 'function') {
      return lockService.lock(key, {
        ttlMs: 60 * 1000
      });
    }

    return null;
  }

  /**
   * Release a settlement lock.
   *
   * @param {object|null} lock
   */
  async function releaseSettlementLock(lock) {
    if (!lock) {
      return;
    }

    if (typeof lock.release === 'function') {
      await lock.release();
      return;
    }

    if (typeof lockService?.release === 'function') {
      await lockService.release(lock);
    }
  }

  /**
   * Read a settlement using tenant-scoped persistence.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function getSettlement({
    tenantId,
    settlementId,
    session
  }) {
    requireDependency(
      settlementRepository,
      'settlementRepository'
    );

    if (
      typeof settlementRepository.findByIdForTenant ===
      'function'
    ) {
      const settlement =
        await settlementRepository.findByIdForTenant(
          tenantId,
          settlementId,
          { session }
        );

      if (!settlement) {
        throw new SettlementProcessorError(
          'Settlement was not found.',
          'SETTLEMENT_NOT_FOUND'
        );
      }

      return settlement;
    }

    if (
      typeof settlementRepository.findById ===
      'function'
    ) {
      const settlement =
        await settlementRepository.findById(
          settlementId,
          {
            tenantId,
            session
          }
        );

      if (!settlement) {
        throw new SettlementProcessorError(
          'Settlement was not found.',
          'SETTLEMENT_NOT_FOUND'
        );
      }

      assertTenantScope(
        tenantId,
        settlement.tenantId
      );

      return settlement;
    }

    throw new SettlementProcessorError(
      'Settlement repository does not expose a tenant-safe lookup method.',
      'REPOSITORY_CONTRACT_INVALID'
    );
  }

  /**
   * Update settlement state atomically where the repository supports it.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function transitionSettlement({
    tenantId,
    settlementId,
    expectedState,
    targetState,
    metadata = {},
    session
  }) {
    requireDependency(
      settlementRepository,
      'settlementRepository'
    );

    if (
      !isValidTransition(
        expectedState,
        targetState
      )
    ) {
      throw new SettlementProcessorError(
        `Invalid settlement transition ${expectedState} -> ${targetState}.`,
        'INVALID_SETTLEMENT_TRANSITION',
        {
          settlementId,
          expectedState,
          targetState
        }
      );
    }

    if (
      typeof settlementRepository.transitionState ===
      'function'
    ) {
      const result =
        await settlementRepository.transitionState({
          tenantId,
          settlementId,
          fromStatus: expectedState,
          toStatus: targetState,
          metadata,
          session
        });

      if (!result) {
        throw new SettlementProcessorError(
          'Settlement state transition failed due to stale or conflicting state.',
          'SETTLEMENT_STATE_CONFLICT',
          {
            settlementId,
            expectedState,
            targetState
          },
          {
            conflict: true
          }
        );
      }

      return result;
    }

    if (
      typeof settlementRepository.updateStatusIfCurrent ===
      'function'
    ) {
      const result =
        await settlementRepository.updateStatusIfCurrent({
          tenantId,
          settlementId,
          expectedStatus: expectedState,
          status: targetState,
          metadata,
          session
        });

      if (!result) {
        throw new SettlementProcessorError(
          'Settlement state transition failed.',
          'SETTLEMENT_STATE_CONFLICT',
          undefined,
          {
            conflict: true
          }
        );
      }

      return result;
    }

    throw new SettlementProcessorError(
      'Settlement repository does not provide an atomic state-transition method.',
      'REPOSITORY_TRANSITION_CONTRACT_INVALID'
    );
  }

  /**
   * Record audit safely.
   *
   * Audit errors are NOT swallowed when the caller has explicitly requested
   * transactionally coupled financial/audit behavior.
   *
   * @param {string} eventType
   * @param {object} input
   * @param {object} optionsArg
   */
  async function audit(eventType, input, optionsArg = {}) {
    if (!settlementAudit) {
      throw new SettlementProcessorError(
        'Settlement audit service is not configured.',
        'AUDIT_SERVICE_NOT_CONFIGURED'
      );
    }

    if (typeof settlementAudit.recordEvent === 'function') {
      return settlementAudit.recordEvent(
        eventType,
        input,
        optionsArg
      );
    }

    if (typeof settlementAudit.record === 'function') {
      return settlementAudit.record(
        {
          ...input,
          eventType
        },
        optionsArg
      );
    }

    throw new SettlementProcessorError(
      'Settlement audit dependency does not expose a supported record method.',
      'AUDIT_CONTRACT_INVALID'
    );
  }

  /**
   * Create a durable outbox event.
   *
   * @param {object} event
   * @param {object} optionsArg
   */
  async function enqueueOutbox(event, optionsArg = {}) {
    if (!outboxService) {
      return {
        queued: false,
        skipped: true
      };
    }

    if (typeof outboxService.enqueue === 'function') {
      return outboxService.enqueue(
        event,
        optionsArg
      );
    }

    if (typeof outboxService.publishTransactional === 'function') {
      return outboxService.publishTransactional(
        event,
        optionsArg
      );
    }

    throw new SettlementProcessorError(
      'Outbox service does not expose a supported enqueue method.',
      'OUTBOX_CONTRACT_INVALID'
    );
  }

  /**
   * Check idempotency before processing.
   *
   * @param {object} params
   */
  async function checkIdempotency({
    tenantId,
    idempotencyKey,
    requestFingerprint,
    session
  }) {
    if (!idempotencyKey) {
      return null;
    }

    if (idempotencyService) {
      if (
        typeof idempotencyService.check ===
        'function'
      ) {
        return idempotencyService.check({
          tenantId,
          idempotencyKey,
          requestFingerprint,
          session
        });
      }

      if (
        typeof idempotencyService.get ===
        'function'
      ) {
        return idempotencyService.get({
          tenantId,
          idempotencyKey,
          session
        });
      }
    }

    if (
      typeof settlementRepository?.findByIdempotencyKey ===
      'function'
    ) {
      return settlementRepository.findByIdempotencyKey({
        tenantId,
        idempotencyKey,
        session
      });
    }

    return null;
  }

  /**
   * Build a normalized request fingerprint.
   *
   * The fingerprint intentionally excludes secrets and volatile transport
   * details.
   *
   * @param {object} input
   * @returns {string}
   */
  function createRequestFingerprint(input) {
    const canonical = JSON.stringify({
      tenantId: normalizeId(input.tenantId),
      settlementId: normalizeId(input.settlementId),
      paymentId: normalizeId(input.paymentId),
      provider: normalizeString(input.provider, 128),
      providerTransactionId:
        normalizeString(
          input.providerTransactionId,
          256
        ),
      amount:
        input.amount !== undefined
          ? String(input.amount)
          : undefined,
      currency:
        normalizeString(
          input.currency,
          16
        ),
      expectedStatus:
        normalizeString(
          input.expectedStatus,
          128
        ),
      action:
        normalizeString(
          input.action,
          128
        )
    });

    return crypto
      .createHash('sha256')
      .update(canonical)
      .digest('hex');
  }

  /**
   * Ensure duplicate idempotency requests refer to the same logical request.
   *
   * @param {object|null} existing
   * @param {string} fingerprint
   */
  function assertIdempotencyConsistency(
    existing,
    fingerprint
  ) {
    if (!existing) {
      return;
    }

    const existingFingerprint =
      existing.requestFingerprint ||
      existing.fingerprint;

    if (
      existingFingerprint &&
      existingFingerprint !== fingerprint
    ) {
      throw new SettlementProcessorError(
        'Idempotency key was reused for a different settlement request.',
        'IDEMPOTENCY_KEY_CONFLICT',
        undefined,
        {
          conflict: true
        }
      );
    }
  }

  /**
   * Safely register an idempotency result.
   *
   * @param {object} params
   */
  async function storeIdempotencyResult(params) {
    if (!idempotencyService) {
      return;
    }

    if (
      typeof idempotencyService.store ===
      'function'
    ) {
      await idempotencyService.store(params);
      return;
    }

    if (
      typeof idempotencyService.complete ===
      'function'
    ) {
      await idempotencyService.complete(params);
    }
  }

  /**
   * Execute the supplied function in a MongoDB transaction when the existing
   * transaction manager supports it.
   *
   * @param {Function} callback
   * @returns {Promise<*>}
   */
  async function withTransaction(callback) {
    if (
      typeof transactionManager?.withTransaction ===
      'function'
    ) {
      return transactionManager.withTransaction(
        callback
      );
    }

    return callback(undefined);
  }

  /**
   * Verify provider evidence.
   *
   * The provider orchestrator may perform:
   * - callback signature verification;
   * - provider response normalization;
   * - status verification;
   * - provider reference validation.
   *
   * @param {object} params
   */
  async function validateProviderEvidence({
    settlement,
    providerPayload,
    context,
    session
  }) {
    if (!providerOrchestrator) {
      /*
       * If no provider adapter is configured, the processor cannot infer that
       * provider evidence is trustworthy.
       */
      throw new SettlementProcessorError(
        'Provider orchestrator is not configured.',
        'PROVIDER_ORCHESTRATOR_NOT_CONFIGURED'
      );
    }

    if (
      typeof providerOrchestrator.validateSettlement ===
      'function'
    ) {
      return providerOrchestrator.validateSettlement({
        tenantId: settlement.tenantId,
        settlement,
        providerPayload,
        context,
        session
      });
    }

    if (
      typeof providerOrchestrator.validateCallback ===
      'function'
    ) {
      return providerOrchestrator.validateCallback({
        tenantId: settlement.tenantId,
        settlement,
        payload: providerPayload,
        context,
        session
      });
    }

    /*
     * Do not silently trust a raw provider payload.
     */
    throw new SettlementProcessorError(
      'Provider orchestrator does not expose evidence validation.',
      'PROVIDER_VALIDATION_CONTRACT_INVALID'
    );
  }

  /**
   * Run reconciliation.
   *
   * @param {object} params
   */
  async function reconcileSettlement({
    settlement,
    providerEvidence,
    context,
    session
  }) {
    requireDependency(
      reconciliationService,
      'reconciliationService'
    );

    if (
      typeof reconciliationService.reconcileSettlement ===
      'function'
    ) {
      return reconciliationService.reconcileSettlement({
        tenantId: settlement.tenantId,
        settlement,
        providerEvidence,
        context,
        session
      });
    }

    if (
      typeof reconciliationService.reconcile ===
      'function'
    ) {
      return reconciliationService.reconcile({
        tenantId: settlement.tenantId,
        settlementId: settlement.id,
        providerEvidence,
        context,
        session
      });
    }

    throw new SettlementProcessorError(
      'Reconciliation service does not expose a supported reconciliation method.',
      'RECONCILIATION_CONTRACT_INVALID'
    );
  }

  /**
   * Verify reconciliation outcome.
   *
   * @param {object} result
   */
  function assertReconciled(result) {
    if (!result) {
      throw new SettlementProcessorError(
        'Reconciliation returned no result.',
        'RECONCILIATION_RESULT_MISSING'
      );
    }

    const status =
      result.status ||
      result.reconciliationStatus;

    if (
      !SUCCESSFUL_RECONCILIATION_STATUSES.has(
        String(status).toUpperCase()
      )
    ) {
      throw new SettlementProcessorError(
        'Settlement cannot proceed because reconciliation is not successful.',
        'RECONCILIATION_NOT_CONFIRMED',
        {
          status
        }
      );
    }

    if (
      result.amountMismatch === true ||
      result.currencyMismatch === true ||
      result.statusMismatch === true
    ) {
      throw new SettlementProcessorError(
        'Settlement cannot proceed because reconciliation detected a mismatch.',
        'RECONCILIATION_MISMATCH',
        {
          amountMismatch:
            Boolean(result.amountMismatch),
          currencyMismatch:
            Boolean(result.currencyMismatch),
          statusMismatch:
            Boolean(result.statusMismatch)
        }
      );
    }

    return true;
  }

  /**
   * Commit the authoritative financial settlement.
   *
   * The financial transaction service is intentionally responsible for all
   * ledger/balance mutation.
   *
   * @param {object} params
   */
  async function commitFinancialSettlement({
    settlement,
    reconciliation,
    providerEvidence,
    context,
    session
  }) {
    requireDependency(
      financialTransactionService,
      'financialTransactionService'
    );

    if (
      typeof financialTransactionService.settle ===
      'function'
    ) {
      return financialTransactionService.settle({
        tenantId: settlement.tenantId,
        settlementId: settlement.id,
        paymentId: settlement.paymentId,
        financialTransactionId:
          settlement.financialTransactionId,
        amount: settlement.amount,
        currency: settlement.currency,
        provider: settlement.provider,
        providerTransactionId:
          settlement.providerTransactionId,
        reconciliationId:
          reconciliation?.id ||
          reconciliation?._id ||
          settlement.reconciliationId,
        providerEvidence,
        context,
        session
      });
    }

    if (
      typeof financialTransactionService.confirmSettlement ===
      'function'
    ) {
      return financialTransactionService.confirmSettlement({
        tenantId: settlement.tenantId,
        settlementId: settlement.id,
        reconciliation,
        providerEvidence,
        context,
        session
      });
    }

    throw new SettlementProcessorError(
      'Financial transaction service does not expose a settlement confirmation method.',
      'FINANCIAL_SERVICE_CONTRACT_INVALID'
    );
  }

  /**
   * Process a provider callback / authoritative settlement confirmation.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function process(input = {}) {
    const context = normalizeContext(
      input.context || input
    );

    const tenantId = normalizeId(
      input.tenantId
    );

    const settlementId = normalizeId(
      input.settlementId ||
      input.id
    );

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey ||
        context.operationId,
        256
      );

    if (!tenantId) {
      throw new SettlementProcessorError(
        'tenantId is required.',
        'TENANT_ID_REQUIRED'
      );
    }

    if (!settlementId) {
      throw new SettlementProcessorError(
        'settlementId is required.',
        'SETTLEMENT_ID_REQUIRED'
      );
    }

    const requestFingerprint =
      createRequestFingerprint({
        ...input,
        tenantId,
        settlementId,
        action: 'process-settlement'
      });

    /*
     * Fast idempotency path before acquiring locks or creating financial side
     * effects.
     */
    const priorResult =
      await checkIdempotency({
        tenantId,
        idempotencyKey,
        requestFingerprint
      });

    if (priorResult) {
      assertIdempotencyConsistency(
        priorResult,
        requestFingerprint
      );

      return {
        success: true,
        idempotent: true,
        duplicate: true,
        settlement:
          priorResult.settlement ||
          priorResult.result ||
          priorResult
      };
    }

    const lock =
      await acquireSettlementLock({
        tenantId,
        id: settlementId
      });

    try {
      const settlementRecord =
        await getSettlement({
          tenantId,
          settlementId
        });

      const settlement =
        normalizeSettlement(
          settlementRecord
        );

      assertTenantScope(
        tenantId,
        settlement.tenantId
      );

      await authorize(
        context,
        'payment.settlement.process',
        settlement
      );

      /*
       * A terminal settlement is normally idempotent. Reversal/dispute
       * workflows are separate domain operations and must not be smuggled
       * into this processor.
       */
      if (
        settlement.status ===
        SETTLEMENT_STATES.SETTLED
      ) {
        const result = {
          success: true,
          idempotent: true,
          alreadySettled: true,
          settlementId: settlement.id,
          status: settlement.status
        };

        await storeIdempotencyResult({
          tenantId,
          idempotencyKey,
          requestFingerprint,
          result
        });

        return result;
      }

      if (
        settlement.status ===
          SETTLEMENT_STATES.REVERSED ||
        settlement.status ===
          SETTLEMENT_STATES.CANCELLED ||
        settlement.status ===
          SETTLEMENT_STATES.FAILED
      ) {
        throw new SettlementProcessorError(
          `Settlement is in terminal state ${settlement.status}.`,
          'SETTLEMENT_TERMINAL_STATE'
        );
      }

      const providerEvidence =
        await validateProviderEvidence({
          settlement,
          providerPayload:
            input.providerPayload ||
            input.callbackPayload ||
            input.providerResponse,
          context,
          session: undefined
        });

      /*
       * Provider evidence must agree with the settlement's fundamental
       * financial identity before reconciliation.
       */
      if (
        providerEvidence?.currency &&
        String(
          providerEvidence.currency
        ).toUpperCase() !==
          String(
            settlement.currency
          ).toUpperCase()
      ) {
        throw new SettlementProcessorError(
          'Provider currency does not match settlement currency.',
          'PROVIDER_CURRENCY_MISMATCH'
        );
      }

      if (
        providerEvidence?.amount !== undefined &&
        String(providerEvidence.amount) !==
          String(settlement.amount)
      ) {
        throw new SettlementProcessorError(
          'Provider amount does not match settlement amount.',
          'PROVIDER_AMOUNT_MISMATCH'
        );
      }

      let finalResult;

      await withTransaction(async (session) => {
        const current =
          await getSettlement({
            tenantId,
            settlementId,
            session
          });

        const currentNormalized =
          normalizeSettlement(current);

        /*
         * Re-check inside the transaction so concurrent workers cannot rely
         * on stale state.
         */
        if (
          currentNormalized.status ===
          SETTLEMENT_STATES.SETTLED
        ) {
          finalResult = {
            success: true,
            idempotent: true,
            alreadySettled: true,
            settlementId:
              currentNormalized.id,
            status:
              currentNormalized.status
          };

          return;
        }

        if (
          !isValidTransition(
            currentNormalized.status,
            SETTLEMENT_STATES.VALIDATED
          )
        ) {
          throw new SettlementProcessorError(
            `Settlement cannot be validated from state ${currentNormalized.status}.`,
            'INVALID_VALIDATION_TRANSITION'
          );
        }

        await transitionSettlement({
          tenantId,
          settlementId,
          expectedState:
            currentNormalized.status,
          targetState:
            SETTLEMENT_STATES.VALIDATED,
          metadata: {
            operationId:
              context.operationId,
            requestId:
              context.requestId,
            correlationId:
              context.correlationId
          },
          session
        });

        await audit(
          SETTLEMENT_EVENTS.VALIDATED,
          {
            tenantId,
            settlementId,
            paymentId:
              currentNormalized.paymentId,
            paymentReference:
              currentNormalized.paymentReference,
            financialTransactionId:
              currentNormalized.financialTransactionId,
            provider:
              currentNormalized.provider,
            providerTransactionId:
              currentNormalized.providerTransactionId ||
              providerEvidence?.providerTransactionId,
            transactionAmount:
              currentNormalized.amount,
            currency:
              currentNormalized.currency,
            sourceStatus:
              currentNormalized.status,
            targetStatus:
              SETTLEMENT_STATES.VALIDATED,
            actor: {
              type:
                context.actorType ||
                'SERVICE',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName ||
                'SettlementProcessor'
            },
            context,
            metadata: {
              providerEvidenceValidated:
                true
            },
            idempotencyKey:
              `${idempotencyKey}:validated`
          },
          { session }
        );

        await transitionSettlement({
          tenantId,
          settlementId,
          expectedState:
            SETTLEMENT_STATES.VALIDATED,
          targetState:
            SETTLEMENT_STATES.RECONCILING,
          metadata: {
            operationId:
              context.operationId
          },
          session
        });

        await audit(
          SETTLEMENT_EVENTS.RECONCILIATION_STARTED,
          {
            tenantId,
            settlementId,
            paymentId:
              currentNormalized.paymentId,
            provider:
              currentNormalized.provider,
            providerTransactionId:
              currentNormalized.providerTransactionId ||
              providerEvidence?.providerTransactionId,
            transactionAmount:
              currentNormalized.amount,
            currency:
              currentNormalized.currency,
            sourceStatus:
              SETTLEMENT_STATES.VALIDATED,
            targetStatus:
              SETTLEMENT_STATES.RECONCILING,
            actor: {
              type: 'SERVICE',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName ||
                'SettlementProcessor'
            },
            context,
            idempotencyKey:
              `${idempotencyKey}:reconciliation-started`
          },
          { session }
        );

        const reconciliation =
          await reconcileSettlement({
            settlement:
              currentNormalized,
            providerEvidence,
            context,
            session
          });

        assertReconciled(
          reconciliation
        );

        await audit(
          SETTLEMENT_EVENTS.RECONCILED,
          {
            tenantId,
            settlementId,
            paymentId:
              currentNormalized.paymentId,
            provider:
              currentNormalized.provider,
            providerTransactionId:
              currentNormalized.providerTransactionId ||
              providerEvidence?.providerTransactionId,
            reconciliationId:
              reconciliation.id ||
              reconciliation._id,
            transactionAmount:
              currentNormalized.amount,
            currency:
              currentNormalized.currency,
            sourceStatus:
              SETTLEMENT_STATES.RECONCILING,
            targetStatus:
              SETTLEMENT_STATES.RECONCILING,
            actor: {
              type: 'SERVICE',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName ||
                'SettlementProcessor'
            },
            context,
            metadata: {
              reconciliationStatus:
                reconciliation.status ||
                reconciliation.reconciliationStatus
            },
            idempotencyKey:
              `${idempotencyKey}:reconciled`
          },
          { session }
        );

        /*
         * Critical boundary:
         *
         * Only the financial transaction service is allowed to perform the
         * authoritative financial state mutation.
         */
        const financialResult =
          await commitFinancialSettlement({
            settlement:
              currentNormalized,
            reconciliation,
            providerEvidence,
            context,
            session
          });

        if (!financialResult) {
          throw new SettlementProcessorError(
            'Financial settlement confirmation returned no result.',
            'FINANCIAL_SETTLEMENT_RESULT_MISSING'
          );
        }

        await transitionSettlement({
          tenantId,
          settlementId,
          expectedState:
            SETTLEMENT_STATES.RECONCILING,
          targetState:
            SETTLEMENT_STATES.SETTLED,
          metadata: {
            operationId:
              context.operationId,
            reconciliationId:
              reconciliation.id ||
              reconciliation._id,
            financialTransactionId:
              financialResult.id ||
              financialResult._id ||
              currentNormalized.financialTransactionId
          },
          session
        });

        await audit(
          SETTLEMENT_EVENTS.SETTLED,
          {
            tenantId,
            settlementId,
            paymentId:
              currentNormalized.paymentId,
            paymentReference:
              currentNormalized.paymentReference,
            financialTransactionId:
              financialResult.id ||
              financialResult._id ||
              currentNormalized.financialTransactionId,
            financialTransactionReference:
              financialResult.reference ||
              currentNormalized.financialTransactionReference,
            provider:
              currentNormalized.provider,
            providerTransactionId:
              currentNormalized.providerTransactionId ||
              providerEvidence?.providerTransactionId,
            reconciliationId:
              reconciliation.id ||
              reconciliation._id,
            transactionAmount:
              currentNormalized.amount,
            currency:
              currentNormalized.currency,
            sourceStatus:
              SETTLEMENT_STATES.RECONCILING,
            targetStatus:
              SETTLEMENT_STATES.SETTLED,
            actor: {
              type: 'SERVICE',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName ||
                'SettlementProcessor'
            },
            context,
            metadata: {
              financialSettlementConfirmed:
                true,
              reconciliationConfirmed:
                true
            },
            idempotencyKey:
              `${idempotencyKey}:settled`
          },
          { session }
        );

        /*
         * External side effects occur only through the outbox. Publishing
         * directly from the financial transaction path would create an
         * atomicity gap.
         */
        await enqueueOutbox(
          {
            type:
              SETTLEMENT_EVENTS.SETTLED,
            aggregateType:
              'Settlement',
            aggregateId:
              settlementId,
            tenantId,
            occurredAt:
              now(),
            idempotencyKey:
              `${idempotencyKey}:outbox`,
            payload: {
              settlementId,
              paymentId:
                currentNormalized.paymentId,
              financialTransactionId:
                financialResult.id ||
                financialResult._id ||
                currentNormalized.financialTransactionId,
              reconciliationId:
                reconciliation.id ||
                reconciliation._id,
              amount:
                currentNormalized.amount,
              currency:
                currentNormalized.currency,
              status:
                SETTLEMENT_STATES.SETTLED
            },
            context
          },
          { session }
        );

        finalResult = {
          success: true,
          idempotent: false,
          settlementId,
          paymentId:
            currentNormalized.paymentId,
          status:
            SETTLEMENT_STATES.SETTLED,
          financialTransactionId:
            financialResult.id ||
            financialResult._id ||
            currentNormalized.financialTransactionId,
          reconciliationId:
            reconciliation.id ||
            reconciliation._id,
          amount:
            currentNormalized.amount,
          currency:
            currentNormalized.currency
        };
      });

      await storeIdempotencyResult({
        tenantId,
        idempotencyKey,
        requestFingerprint,
        result: finalResult
      });

      logger.info?.(
        {
          tenantId,
          settlementId,
          status:
            finalResult?.status,
          correlationId:
            context.correlationId,
          requestId:
            context.requestId,
          operationId:
            context.operationId
        },
        'Settlement processing completed'
      );

      return finalResult;
    } catch (error) {
      const classified =
        classifyError(error);

      /*
       * Best-effort failure audit. The original financial transaction must
       * still determine whether the operation commits or rolls back.
       *
       * We do not silently turn a financial failure into success merely
       * because audit persistence failed.
       */
      try {
        await audit(
          classified.code ===
            'PROVIDER_TIMEOUT'
            ? SETTLEMENT_EVENTS.TIMEOUT
            : SETTLEMENT_EVENTS.FAILED,
          {
            tenantId,
            settlementId,
            provider:
              input.provider,
            providerTransactionId:
              input.providerTransactionId,
            outcome: 'FAILED',
            reason:
              classified.message,
            error: {
              code:
                classified.code,
              message:
                classified.message,
              providerCode:
                classified.providerCode,
              providerStatus:
                classified.providerStatus,
              retryable:
                classified.retryable
            },
            actor: {
              type:
                context.actorType ||
                'SERVICE',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName ||
                'SettlementProcessor'
            },
            context,
            metadata: {
              failureClassification:
                classified
            },
            idempotencyKey:
              `${idempotencyKey}:failure`
          }
        );
      } catch (auditError) {
        logger.error?.(
          {
            err: auditError,
            tenantId,
            settlementId,
            correlationId:
              context.correlationId
          },
          'Failed to record settlement failure audit'
        );
      }

      logger.error?.(
        {
          err: error,
          code: classified.code,
          retryable:
            classified.retryable,
          tenantId,
          settlementId,
          correlationId:
            context.correlationId,
          requestId:
            context.requestId
        },
        'Settlement processing failed'
      );

      if (
        error instanceof SettlementProcessorError
      ) {
        throw error;
      }

      throw new SettlementProcessorError(
        'Settlement processing failed.',
        classified.code,
        {
          retryable:
            classified.retryable
        },
        {
          retryable:
            classified.retryable
        }
      );
    } finally {
      await releaseSettlementLock(
        lock
      );
    }
  }

  /**
   * Process with bounded retry policy.
   *
   * Important:
   * Retry must only repeat the orchestration safely because every financial
   * mutation is itself idempotent and transactionally protected.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function processWithRetry(input = {}) {
    let attempt = 0;
    let lastError;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        return await process(input);
      } catch (error) {
        lastError = error;

        const classified =
          classifyError(error);

        if (
          !classified.retryable ||
          attempt >= maxAttempts
        ) {
          throw error;
        }

        const delay =
          calculateRetryDelay(attempt);

        logger.warn?.(
          {
            attempt,
            maxAttempts,
            delay,
            code:
              classified.code,
            tenantId:
              input.tenantId,
            settlementId:
              input.settlementId
          },
          'Retrying settlement processing'
        );

        if (delay > 0) {
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                delay
              )
          );
        }
      }
    }

    throw lastError ||
      new SettlementProcessorError(
        'Settlement retry loop exited unexpectedly.',
        'SETTLEMENT_RETRY_EXHAUSTED'
      );
  }

  /**
   * Process provider callback.
   *
   * Callback handling is intentionally routed through the same authoritative
   * settlement processor rather than creating a second financial path.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function processCallback(
    input = {}
  ) {
    const context = normalizeContext({
      ...(input.context || {}),
      source:
        input.context?.source ||
        'PROVIDER_CALLBACK',
      serviceName:
        input.context?.serviceName ||
        'SettlementProcessor'
    });

    return processWithRetry({
      ...input,
      context,
      providerPayload:
        input.providerPayload ||
        input.callbackPayload ||
        input.body,
      idempotencyKey:
        input.idempotencyKey ||
        input.callbackId ||
        input.providerEventId ||
        context.operationId
    });
  }

  /**
   * Process an explicit reconciliation result.
   *
   * This is useful for a reconciliation worker that already owns the
   * provider evidence and wants to converge the settlement to authoritative
   * financial state.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function settleFromReconciliation(
    input = {}
  ) {
    requireDependency(
      reconciliationService,
      'reconciliationService'
    );

    const context = normalizeContext(
      input.context || input
    );

    const settlement =
      normalizeSettlement(
        await getSettlement({
          tenantId:
            input.tenantId,
          settlementId:
            input.settlementId
        })
      );

    assertTenantScope(
      input.tenantId,
      settlement.tenantId
    );

    const reconciliation =
      input.reconciliation ||
      (typeof reconciliationService.getById ===
      'function'
        ? await reconciliationService.getById({
            tenantId:
              settlement.tenantId,
            reconciliationId:
              input.reconciliationId
          })
        : null);

    assertReconciled(
      reconciliation
    );

    return processWithRetry({
      tenantId:
        settlement.tenantId,
      settlementId:
        settlement.id,
      provider:
        settlement.provider,
      providerTransactionId:
        settlement.providerTransactionId,
      providerPayload:
        input.providerEvidence,
      idempotencyKey:
        input.idempotencyKey ||
        `reconciliation:${settlement.id}:${reconciliation.id || reconciliation._id}`,
      context
    });
  }

  /**
   * Explicitly mark a settlement as requiring reconciliation.
   *
   * This does not settle money and does not modify ledger/balance state.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function flagForReconciliation(
    input = {}
  ) {
    const context = normalizeContext(
      input.context || input
    );

    const settlement =
      normalizeSettlement(
        await getSettlement({
          tenantId:
            input.tenantId,
          settlementId:
            input.settlementId
        })
      );

    assertTenantScope(
      input.tenantId,
      settlement.tenantId
    );

    const currentStatus =
      settlement.status;

    if (
      currentStatus ===
      SETTLEMENT_STATES.SETTLED
    ) {
      return {
        success: true,
        noOp: true,
        settlementId:
          settlement.id,
        status:
          currentStatus
      };
    }

    if (
      !isValidTransition(
        currentStatus,
        SETTLEMENT_STATES.REQUIRES_RECONCILIATION
      )
    ) {
      throw new SettlementProcessorError(
        `Settlement cannot be flagged for reconciliation from state ${currentStatus}.`,
        'INVALID_RECONCILIATION_TRANSITION'
      );
    }

    const result =
      await withTransaction(
        async (session) => {
          const transitioned =
            await transitionSettlement({
              tenantId:
                settlement.tenantId,
              settlementId:
                settlement.id,
              expectedState:
                currentStatus,
              targetState:
                SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
              metadata: {
                reason:
                  normalizeString(
                    input.reason,
                    1000
                  ),
                operationId:
                  context.operationId
              },
              session
            });

          await audit(
            SETTLEMENT_EVENTS.REQUIRES_RECONCILIATION,
            {
              tenantId:
                settlement.tenantId,
              settlementId:
                settlement.id,
              paymentId:
                settlement.paymentId,
              provider:
                settlement.provider,
              providerTransactionId:
                settlement.providerTransactionId,
              transactionAmount:
                settlement.amount,
              currency:
                settlement.currency,
              sourceStatus:
                currentStatus,
              targetStatus:
                SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
              reason:
                input.reason,
              actor: {
                type:
                  context.actorType ||
                  'SERVICE',
                actorId:
                  context.actorId,
                serviceName:
                  context.serviceName ||
                  'SettlementProcessor'
              },
              context,
              idempotencyKey:
                input.idempotencyKey ||
                `${context.operationId}:requires-reconciliation`
            },
            { session }
          );

          await enqueueOutbox(
            {
              type:
                SETTLEMENT_EVENTS.REQUIRES_RECONCILIATION,
              aggregateType:
                'Settlement',
              aggregateId:
                settlement.id,
              tenantId:
                settlement.tenantId,
              occurredAt:
                now(),
              idempotencyKey:
                `${context.operationId}:reconciliation-event`,
              payload: {
                settlementId:
                  settlement.id,
                reason:
                  normalizeString(
                    input.reason,
                    1000
                  ),
                status:
                  SETTLEMENT_STATES.REQUIRES_RECONCILIATION
              },
              context
            },
            { session }
          );

          return transitioned;
        }
      );

    return {
      success: true,
      settlement:
        result
    };
  }

  /**
   * Calculate retry metadata for worker scheduling.
   *
   * @param {number} attempt
   * @returns {object}
   */
  function getRetryMetadata(
    attempt
  ) {
    const normalizedAttempt =
      Math.max(
        1,
        Number(attempt) || 1
      );

    return {
      attempt:
        normalizedAttempt,
      maxAttempts,
      delayMs:
        calculateRetryDelay(
          normalizedAttempt
        ),
      retryable:
        normalizedAttempt < maxAttempts
    };
  }

  /**
   * Validate settlement transition independently.
   * Useful for unit tests and workflow guards.
   *
   * @param {string} from
   * @param {string} to
   */
  function validateTransition(
    from,
    to
  ) {
    return {
      valid:
        isValidTransition(
          from,
          to
        ),
      terminal:
        isTerminalState(to)
    };
  }

  return Object.freeze({
    name:
      'SettlementProcessor',
    version:
      '1.0.0',

    states:
      SETTLEMENT_STATES,

    events:
      SETTLEMENT_EVENTS,

    terminalStates:
      Object.freeze(
        Array.from(
          TERMINAL_STATES
        )
      ),

    process,
    processWithRetry,
    processCallback,
    settleFromReconciliation,
    flagForReconciliation,

    validateTransition,
    getRetryMetadata,

    isTerminalState,
    isValidTransition,

    classifyError,
    normalizeSettlement
  });
}

const defaultProcessor =
  createSettlementProcessor();

module.exports =
  defaultProcessor;

module.exports.create =
  createSettlementProcessor;

module.exports.createSettlementProcessor =
  createSettlementProcessor;

module.exports.SettlementProcessorError =
  SettlementProcessorError;

module.exports.SETTLEMENT_STATES =
  SETTLEMENT_STATES;

module.exports.SETTLEMENT_EVENTS =
  SETTLEMENT_EVENTS;