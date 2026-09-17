'use strict';

/**
 * TITech Community Capital
 * Enterprise Settlement Recovery Service
 *
 * File:
 *   backend/modules/payment/settlement/settlementRecovery.js
 *
 * Architectural Role
 * ------------------
 * Recovery/orchestration boundary for settlements that enter uncertain,
 * transient, failed, timeout, reconciliation, or review-required states.
 *
 * Recovery is designed to converge an operation toward an authoritative state
 * without duplicating financial effects.
 *
 * Responsibilities
 * ----------------
 * - Detect recoverable settlement states.
 * - Classify settlement failures and uncertainty.
 * - Re-check authoritative provider state where supported.
 * - Re-run reconciliation safely.
 * - Resume settlement processing through the canonical processor.
 * - Avoid duplicate financial mutations through idempotency.
 * - Coordinate retry/backoff behavior.
 * - Record recovery attempts and outcomes through settlement audit.
 * - Produce operational recovery metadata.
 * - Support worker-based recovery and manual operational recovery.
 *
 * Explicit Non-Responsibilities
 * -----------------------------
 * - Does NOT directly mutate balances.
 * - Does NOT directly post ledger entries.
 * - Does NOT fabricate successful provider responses.
 * - Does NOT mark a settlement SETTLED merely because recovery was attempted.
 * - Does NOT bypass reconciliation.
 * - Does NOT bypass authorization.
 * - Does NOT delete or rewrite historical settlement records.
 * - Does NOT turn an unknown provider state into FAILED without evidence.
 *
 * Financial Safety Principle
 * --------------------------
 * An uncertain payment state remains uncertain until authoritative evidence
 * establishes the next valid state.
 *
 * Example:
 *
 *   PROVIDER_TIMEOUT
 *         |
 *         v
 *   Query provider
 *         |
 *    +----+----+
 *    |         |
 *    v         v
 * SUCCESS    UNKNOWN
 *    |         |
 *    v         v
 * Validate   Retry/query
 *    |         |
 *    v         v
 * Reconcile  Review
 *    |
 *    v
 * SETTLED
 *
 * Module Format
 * -------------
 * CommonJS.
 */

const crypto = require('crypto');

const DEFAULT_MAX_RECOVERY_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_RECOVERY_BATCH_SIZE = 100;
const DEFAULT_LOCK_TTL_MS = 60 * 1000;

const RECOVERY_STATES = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  IN_PROGRESS: 'IN_PROGRESS',
  PROVIDER_QUERY_REQUIRED: 'PROVIDER_QUERY_REQUIRED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  RECOVERED: 'RECOVERED',
  FAILED: 'FAILED',
  EXHAUSTED: 'EXHAUSTED',
  NOT_RECOVERABLE: 'NOT_RECOVERABLE'
});

const RECOVERY_REASON_CODES = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  CALLBACK_MISSING: 'CALLBACK_MISSING',
  CALLBACK_INVALID: 'CALLBACK_INVALID',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH',
  DATABASE_TRANSIENT_FAILURE: 'DATABASE_TRANSIENT_FAILURE',
  WORKER_INTERRUPTION: 'WORKER_INTERRUPTION',
  APPLICATION_RESTART: 'APPLICATION_RESTART',
  UNKNOWN_PROVIDER_STATE: 'UNKNOWN_PROVIDER_STATE',
  STATE_CONFLICT: 'STATE_CONFLICT',
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
  MANUAL_REQUEST: 'MANUAL_REQUEST',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED'
});

const RECOVERABLE_SETTLEMENT_STATUSES = new Set([
  'INITIATED',
  'PENDING_PROVIDER',
  'PROVIDER_ACCEPTED',
  'CALLBACK_RECEIVED',
  'VALIDATED',
  'RECONCILING',
  'TIMEOUT',
  'REQUIRES_RECONCILIATION',
  'REQUIRES_REVIEW'
]);

const NON_RECOVERABLE_SETTLEMENT_STATUSES = new Set([
  'CANCELLED',
  'FAILED'
]);

const TERMINAL_SUCCESS_STATUS = 'SETTLED';

const PROVIDER_SUCCESS_STATUSES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'COMPLETE',
  'SETTLED',
  'SUCCESSFUL'
]);

const PROVIDER_FAILURE_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'REJECTED',
  'DECLINED',
  'CANCELLED',
  'CANCELED'
]);

const PROVIDER_PENDING_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'IN_PROGRESS',
  'UNKNOWN',
  'QUEUED',
  'ACCEPTED'
]);

class SettlementRecoveryError extends Error {
  constructor(
    message,
    code = 'SETTLEMENT_RECOVERY_ERROR',
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'SettlementRecoveryError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.conflict = Boolean(options.conflict);
    this.manualReview = Boolean(options.manualReview);

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        SettlementRecoveryError
      );
    }
  }
}

/**
 * Resolve a logger lazily.
 *
 * @param {object} injected
 * @returns {object}
 */
function resolveLogger(injected) {
  if (injected) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (const path of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(path);
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
 * Normalize IDs.
 *
 * @param {*} value
 * @returns {string|undefined}
 */
function normalizeId(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
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
 * Normalize strings.
 *
 * @param {*} value
 * @param {number} maxLength
 * @returns {string|undefined}
 */
function normalizeString(
  value,
  maxLength = 1000
) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const result = String(value).trim();

  if (!result) {
    return undefined;
  }

  return result.length > maxLength
    ? result.slice(0, maxLength)
    : result;
}

/**
 * Normalize date input safely.
 *
 * @param {*} value
 * @returns {Date|undefined}
 */
function normalizeDate(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return undefined;
  }

  return date;
}

/**
 * Generate a recovery operation ID.
 *
 * @returns {string}
 */
function createRecoveryOperationId() {
  return `recovery_${crypto.randomUUID()}`;
}

/**
 * Generate a deterministic recovery idempotency key.
 *
 * @param {object} input
 * @returns {string}
 */
function createRecoveryIdempotencyKey(
  input
) {
  const payload = JSON.stringify({
    tenantId:
      normalizeId(
        input.tenantId
      ),
    settlementId:
      normalizeId(
        input.settlementId
      ),
    reasonCode:
      normalizeString(
        input.reasonCode,
        128
      ),
    attempt:
      Number(
        input.attempt || 1
      ),
    providerEventId:
      normalizeString(
        input.providerEventId,
        256
      )
  });

  return `recovery:${crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex')}`;
}

/**
 * Classify an arbitrary error.
 *
 * @param {Error|object} error
 * @returns {object}
 */
function classifyError(error) {
  const code =
    normalizeString(
      error?.code,
      128
    ) ||
    'SETTLEMENT_RECOVERY_ERROR';

  const message =
    normalizeString(
      error?.message ||
        String(error),
      1000
    );

  const retryable =
    Boolean(
      error?.retryable
    ) ||
    /timeout|temporar|unavailable|connection|deadlock|lock/i.test(
      message
    );

  const manualReview =
    Boolean(
      error?.manualReview
    ) ||
    /mismatch|unknown|ambiguous|review|conflict/i.test(
      message
    );

  return {
    code,
    message,
    retryable,
    manualReview
  };
}

/**
 * Normalize a provider status.
 *
 * @param {*} value
 * @returns {string|undefined}
 */
function normalizeProviderStatus(
  value
) {
  const normalized =
    normalizeString(
      value,
      128
    );

  return normalized
    ? normalized.toUpperCase()
    : undefined;
}

/**
 * Classify provider result.
 *
 * @param {object} result
 * @returns {string}
 */
function classifyProviderResult(
  result
) {
  const status =
    normalizeProviderStatus(
      result?.status ||
        result?.providerStatus ||
        result?.state
    );

  if (
    !status
  ) {
    return 'UNKNOWN';
  }

  if (
    PROVIDER_SUCCESS_STATUSES.has(
      status
    )
  ) {
    return 'SUCCESS';
  }

  if (
    PROVIDER_FAILURE_STATUSES.has(
      status
    )
  ) {
    return 'FAILED';
  }

  if (
    PROVIDER_PENDING_STATUSES.has(
      status
    )
  ) {
    return 'PENDING';
  }

  return 'UNKNOWN';
}

/**
 * Determine whether settlement status may be recovered.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isRecoverableStatus(
  status
) {
  return RECOVERABLE_SETTLEMENT_STATUSES.has(
    String(status || '')
      .toUpperCase()
  );
}

/**
 * Determine whether settlement is terminal.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isTerminalStatus(
  status
) {
  const normalized =
    String(status || '')
      .toUpperCase();

  return (
    normalized ===
      TERMINAL_SUCCESS_STATUS ||
    NON_RECOVERABLE_SETTLEMENT_STATUSES.has(
      normalized
    )
  );
}

/**
 * Calculate exponential retry delay with bounded jitter.
 *
 * @param {number} attempt
 * @param {number} baseDelay
 * @param {number} maxDelay
 * @returns {number}
 */
function calculateBackoff(
  attempt,
  baseDelay,
  maxDelay
) {
  const normalizedAttempt =
    Math.max(
      1,
      Number(attempt) || 1
    );

  const exponential =
    baseDelay *
    2 **
      (normalizedAttempt - 1);

  const bounded =
    Math.min(
      exponential,
      maxDelay
    );

  const jitter = Math.floor(
    Math.random() *
      Math.max(
        1,
        bounded * 0.25
      )
  );

  return Math.min(
    maxDelay,
    bounded + jitter
  );
}

/**
 * Normalize recovery context.
 *
 * @param {object} context
 * @returns {object}
 */
function normalizeContext(
  context = {}
) {
  return {
    operationId:
      normalizeId(
        context.operationId ||
          context.recoveryOperationId
      ),

    requestId:
      normalizeString(
        context.requestId,
        256
      ),

    correlationId:
      normalizeString(
        context.correlationId,
        256
      ),

    traceId:
      normalizeString(
        context.traceId,
        256
      ),

    actorId:
      normalizeId(
        context.actorId
      ),

    actorType:
      normalizeString(
        context.actorType,
        128
      ),

    source:
      normalizeString(
        context.source,
        128
      ),

    serviceName:
      normalizeString(
        context.serviceName,
        256
      )
  };
}

/**
 * Normalize settlement data.
 *
 * @param {object} settlement
 * @returns {object}
 */
function normalizeSettlement(
  settlement
) {
  if (
    !settlement ||
    typeof settlement !==
      'object'
  ) {
    throw new SettlementRecoveryError(
      'Settlement is required.',
      'SETTLEMENT_REQUIRED'
    );
  }

  const result = {
    id:
      normalizeId(
        settlement._id ||
          settlement.id ||
          settlement.settlementId
      ),

    tenantId:
      normalizeId(
        settlement.tenantId
      ),

    paymentId:
      normalizeId(
        settlement.paymentId
      ),

    financialTransactionId:
      normalizeId(
        settlement.financialTransactionId
      ),

    reconciliationId:
      normalizeId(
        settlement.reconciliationId
      ),

    provider:
      normalizeString(
        settlement.provider,
        128
      ),

    providerTransactionId:
      normalizeString(
        settlement.providerTransactionId,
        256
      ),

    amount:
      settlement.amount !==
        undefined &&
      settlement.amount !== null
        ? String(
            settlement.amount
          )
        : undefined,

    currency:
      normalizeString(
        settlement.currency,
        16
      ),

    status:
      normalizeString(
        settlement.status,
        128
      )?.toUpperCase(),

    updatedAt:
      normalizeDate(
        settlement.updatedAt
      ),

    createdAt:
      normalizeDate(
        settlement.createdAt
      )
  };

  if (!result.id) {
    throw new SettlementRecoveryError(
      'Settlement identifier is required.',
      'SETTLEMENT_ID_REQUIRED'
    );
  }

  if (!result.tenantId) {
    throw new SettlementRecoveryError(
      'Settlement tenantId is required.',
      'TENANT_ID_REQUIRED'
    );
  }

  return result;
}

/**
 * Ensure tenant isolation.
 *
 * @param {string} requestedTenantId
 * @param {string} actualTenantId
 */
function assertTenantScope(
  requestedTenantId,
  actualTenantId
) {
  if (
    normalizeId(
      requestedTenantId
    ) !==
    normalizeId(
      actualTenantId
    )
  ) {
    throw new SettlementRecoveryError(
      'Settlement tenant scope mismatch.',
      'TENANT_SCOPE_VIOLATION'
    );
  }
}

/**
 * Dependency validation.
 *
 * @param {*} dependency
 * @param {string} name
 */
function requireDependency(
  dependency,
  name
) {
  if (!dependency) {
    throw new SettlementRecoveryError(
      `${name} dependency is not configured.`,
      'DEPENDENCY_NOT_CONFIGURED',
      {
        dependency:
          name
      }
    );
  }
}

/**
 * Factory for enterprise settlement recovery.
 *
 * @param {object} options
 * @returns {object}
 */
function createSettlementRecovery(
  options = {}
) {
  const {
    settlementRepository,
    settlementProcessor,
    providerOrchestrator,
    reconciliationService,
    settlementAudit,
    idempotencyService,
    lockService,
    authorizationService,
    recoveryRepository,
    clock,
    logger: injectedLogger,

    maxRecoveryAttempts =
      DEFAULT_MAX_RECOVERY_ATTEMPTS,

    baseDelayMs =
      DEFAULT_BASE_DELAY_MS,

    maxDelayMs =
      DEFAULT_MAX_DELAY_MS,

    lockTtlMs =
      DEFAULT_LOCK_TTL_MS,

    batchSize =
      DEFAULT_RECOVERY_BATCH_SIZE
  } = options;

  const logger =
    resolveLogger(
      injectedLogger
    );

  /**
   * Current time.
   *
   * @returns {Date}
   */
  function now() {
    if (
      typeof clock?.now ===
      'function'
    ) {
      return new Date(
        clock.now()
      );
    }

    return new Date();
  }

  /**
   * Obtain tenant-scoped settlement.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function getSettlement(
    params
  ) {
    requireDependency(
      settlementRepository,
      'settlementRepository'
    );

    const {
      tenantId,
      settlementId,
      session
    } = params;

    if (
      typeof settlementRepository.findByIdForTenant ===
      'function'
    ) {
      const result =
        await settlementRepository.findByIdForTenant(
          tenantId,
          settlementId,
          { session }
        );

      if (!result) {
        throw new SettlementRecoveryError(
          'Settlement not found.',
          'SETTLEMENT_NOT_FOUND'
        );
      }

      return result;
    }

    if (
      typeof settlementRepository.findById ===
      'function'
    ) {
      const result =
        await settlementRepository.findById(
          settlementId,
          {
            tenantId,
            session
          }
        );

      if (!result) {
        throw new SettlementRecoveryError(
          'Settlement not found.',
          'SETTLEMENT_NOT_FOUND'
        );
      }

      assertTenantScope(
        tenantId,
        result.tenantId
      );

      return result;
    }

    throw new SettlementRecoveryError(
      'Settlement repository does not expose a tenant-safe lookup method.',
      'REPOSITORY_CONTRACT_INVALID'
    );
  }

  /**
   * Determine whether the settlement has become terminal while the worker
   * was processing it.
   *
   * @param {object} settlement
   * @returns {boolean}
   */
  function isTerminal(
    settlement
  ) {
    return isTerminalStatus(
      settlement.status
    );
  }

  /**
   * Acquire a per-settlement recovery lock.
   *
   * @param {object} settlement
   * @returns {Promise<object|null>}
   */
  async function acquireLock(
    settlement
  ) {
    if (!lockService) {
      return null;
    }

    const key =
      `settlement-recovery:${settlement.tenantId}:${settlement.id}`;

    if (
      typeof lockService.acquire ===
      'function'
    ) {
      return lockService.acquire(
        key,
        {
          ttlMs: lockTtlMs
        }
      );
    }

    if (
      typeof lockService.lock ===
      'function'
    ) {
      return lockService.lock(
        key,
        {
          ttlMs: lockTtlMs
        }
      );
    }

    return null;
  }

  /**
   * Release a recovery lock.
   *
   * @param {object|null} lock
   */
  async function releaseLock(
    lock
  ) {
    if (!lock) {
      return;
    }

    if (
      typeof lock.release ===
      'function'
    ) {
      await lock.release();
      return;
    }

    if (
      typeof lockService?.release ===
      'function'
    ) {
      await lockService.release(
        lock
      );
    }
  }

  /**
   * Check and reserve recovery idempotency.
   *
   * @param {object} params
   * @returns {Promise<object|null>}
   */
  async function checkIdempotency(
    params
  ) {
    const {
      tenantId,
      idempotencyKey,
      fingerprint
    } = params;

    if (!idempotencyKey) {
      return null;
    }

    if (
      idempotencyService &&
      typeof idempotencyService.check ===
        'function'
    ) {
      return idempotencyService.check({
        tenantId,
        idempotencyKey,
        requestFingerprint:
          fingerprint
      });
    }

    if (
      recoveryRepository &&
      typeof recoveryRepository.findByIdempotencyKey ===
        'function'
    ) {
      return recoveryRepository.findByIdempotencyKey(
        {
          tenantId,
          idempotencyKey
        }
      );
    }

    return null;
  }

  /**
   * Persist recovery completion idempotently.
   *
   * @param {object} params
   */
  async function completeIdempotency(
    params
  ) {
    if (!idempotencyService) {
      return;
    }

    if (
      typeof idempotencyService.store ===
      'function'
    ) {
      await idempotencyService.store(
        params
      );
      return;
    }

    if (
      typeof idempotencyService.complete ===
      'function'
    ) {
      await idempotencyService.complete(
        params
      );
    }
  }

  /**
   * Record recovery audit.
   *
   * @param {string} eventType
   * @param {object} payload
   */
  async function audit(
    eventType,
    payload
  ) {
    if (!settlementAudit) {
      logger.warn?.(
        {
          eventType,
          settlementId:
            payload?.settlementId
        },
        'Settlement audit service unavailable during recovery'
      );

      return null;
    }

    if (
      typeof settlementAudit.recordEvent ===
      'function'
    ) {
      return settlementAudit.recordEvent(
        eventType,
        payload
      );
    }

    if (
      typeof settlementAudit.record ===
      'function'
    ) {
      return settlementAudit.record({
        ...payload,
        eventType
      });
    }

    return null;
  }

  /**
   * Authorize a recovery operation.
   *
   * @param {object} context
   * @param {object} settlement
   * @param {string} action
   */
  async function authorize(
    context,
    settlement,
    action
  ) {
    if (!authorizationService) {
      return;
    }

    const authorizationPayload = {
      tenantId:
        settlement.tenantId,
      actorId:
        context.actorId,
      actorType:
        context.actorType,
      action,
      resource:
        'settlement',
      resourceId:
        settlement.id
    };

    if (
      typeof authorizationService.assert ===
      'function'
    ) {
      await authorizationService.assert(
        authorizationPayload
      );
      return;
    }

    if (
      typeof authorizationService.can ===
      'function'
    ) {
      const permitted =
        await authorizationService.can(
          authorizationPayload
        );

      if (!permitted) {
        throw new SettlementRecoveryError(
          'Settlement recovery operation is not authorized.',
          'AUTHORIZATION_DENIED'
        );
      }
    }
  }

  /**
   * Query authoritative provider state.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function queryProvider(
    params
  ) {
    requireDependency(
      providerOrchestrator,
      'providerOrchestrator'
    );

    const {
      settlement,
      context
    } = params;

    if (
      !settlement.providerTransactionId
    ) {
      throw new SettlementRecoveryError(
        'Provider transaction identifier is unavailable.',
        'PROVIDER_TRANSACTION_ID_REQUIRED',
        undefined,
        {
          manualReview: true
        }
      );
    }

    if (
      typeof providerOrchestrator.queryTransaction ===
      'function'
    ) {
      return providerOrchestrator.queryTransaction(
        {
          tenantId:
            settlement.tenantId,
          provider:
            settlement.provider,
          providerTransactionId:
            settlement.providerTransactionId,
          settlement,
          context
        }
      );
    }

    if (
      typeof providerOrchestrator.getTransactionStatus ===
      'function'
    ) {
      return providerOrchestrator.getTransactionStatus(
        {
          tenantId:
            settlement.tenantId,
          provider:
            settlement.provider,
          providerTransactionId:
            settlement.providerTransactionId,
          settlement,
          context
        }
      );
    }

    throw new SettlementRecoveryError(
      'Provider orchestrator does not support authoritative transaction lookup.',
      'PROVIDER_QUERY_UNSUPPORTED'
    );
  }

  /**
   * Verify that provider evidence agrees with the settlement's economic facts.
   *
   * @param {object} settlement
   * @param {object} providerResult
   */
  function assertProviderConsistency(
    settlement,
    providerResult
  ) {
    if (
      providerResult?.amount !==
        undefined &&
      String(
        providerResult.amount
      ) !==
        String(
          settlement.amount
        )
    ) {
      throw new SettlementRecoveryError(
        'Provider amount does not match settlement amount.',
        'PROVIDER_AMOUNT_MISMATCH',
        {
          settlementAmount:
            settlement.amount,
          providerAmount:
            String(
              providerResult.amount
            )
        },
        {
          manualReview: true
        }
      );
    }

    if (
      providerResult?.currency &&
      String(
        providerResult.currency
      ).toUpperCase() !==
        String(
          settlement.currency
        ).toUpperCase()
    ) {
      throw new SettlementRecoveryError(
        'Provider currency does not match settlement currency.',
        'PROVIDER_CURRENCY_MISMATCH',
        {
          settlementCurrency:
            settlement.currency,
          providerCurrency:
            String(
              providerResult.currency
            ).toUpperCase()
        },
        {
          manualReview: true
        }
      );
    }

    if (
      providerResult?.providerTransactionId &&
      settlement.providerTransactionId &&
      String(
        providerResult.providerTransactionId
      ) !==
        String(
          settlement.providerTransactionId
        )
    ) {
      throw new SettlementRecoveryError(
        'Provider transaction identifier mismatch.',
        'PROVIDER_REFERENCE_MISMATCH',
        undefined,
        {
          manualReview: true
        }
      );
    }
  }

  /**
   * Run reconciliation using the canonical reconciliation service.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function reconcile(
    params
  ) {
    requireDependency(
      reconciliationService,
      'reconciliationService'
    );

    const {
      settlement,
      providerEvidence,
      context
    } = params;

    if (
      typeof reconciliationService.reconcileSettlement ===
      'function'
    ) {
      return reconciliationService.reconcileSettlement(
        {
          tenantId:
            settlement.tenantId,
          settlement,
          providerEvidence,
          context
        }
      );
    }

    if (
      typeof reconciliationService.reconcile ===
      'function'
    ) {
      return reconciliationService.reconcile(
        {
          tenantId:
            settlement.tenantId,
          settlementId:
            settlement.id,
          providerEvidence,
          context
        }
      );
    }

    throw new SettlementRecoveryError(
      'Reconciliation service contract is not supported.',
      'RECONCILIATION_CONTRACT_INVALID'
    );
  }

  /**
   * Validate reconciliation success.
   *
   * @param {object} result
   */
  function assertReconciliationSuccess(
    result
  ) {
    const status =
      normalizeProviderStatus(
        result?.status ||
          result?.reconciliationStatus
      );

    const matched =
      result?.matched === true ||
      [
        'MATCHED',
        'RESOLVED',
        'SETTLED'
      ].includes(
        status
      );

    if (
      result?.amountMismatch ||
      result?.currencyMismatch ||
      result?.statusMismatch ||
      !matched
    ) {
      throw new SettlementRecoveryError(
        'Reconciliation is not sufficiently confirmed for settlement.',
        'RECONCILIATION_NOT_CONFIRMED',
        {
          status,
          amountMismatch:
            Boolean(
              result?.amountMismatch
            ),
          currencyMismatch:
            Boolean(
              result?.currencyMismatch
            ),
          statusMismatch:
            Boolean(
              result?.statusMismatch
            )
        },
        {
          manualReview: true
        }
      );
    }
  }

  /**
   * Delegate the authoritative final convergence to settlementProcessor.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function resumeProcessor(
    params
  ) {
    requireDependency(
      settlementProcessor,
      'settlementProcessor'
    );

    const {
      settlement,
      providerEvidence,
      context,
      idempotencyKey
    } = params;

    if (
      typeof settlementProcessor.processWithRetry ===
      'function'
    ) {
      return settlementProcessor.processWithRetry(
        {
          tenantId:
            settlement.tenantId,
          settlementId:
            settlement.id,
          provider:
            settlement.provider,
          providerTransactionId:
            settlement.providerTransactionId,
          providerPayload:
            providerEvidence,
          idempotencyKey,
          context
        }
      );
    }

    if (
      typeof settlementProcessor.process ===
      'function'
    ) {
      return settlementProcessor.process(
        {
          tenantId:
            settlement.tenantId,
          settlementId:
            settlement.id,
          provider:
            settlement.provider,
          providerTransactionId:
            settlement.providerTransactionId,
          providerPayload:
            providerEvidence,
          idempotencyKey,
          context
        }
      );
    }

    throw new SettlementRecoveryError(
      'Settlement processor contract is not supported.',
      'SETTLEMENT_PROCESSOR_CONTRACT_INVALID'
    );
  }

  /**
   * Create recovery metadata.
   *
   * @param {object} params
   * @returns {object}
   */
  function buildRecoveryMetadata(
    params
  ) {
    return {
      recoveryOperationId:
        params.recoveryOperationId,

      reasonCode:
        params.reasonCode,

      reason:
        normalizeString(
          params.reason,
          1000
        ),

      attempt:
        Number(
          params.attempt || 1
        ),

      maxAttempts:
        maxRecoveryAttempts,

      startedAt:
        params.startedAt ||
        now(),

      source:
        normalizeString(
          params.source,
          128
        ),

      workerId:
        normalizeString(
          params.workerId,
          256
        ),

      manual:
        Boolean(
          params.manual
        )
    };
  }

  /**
   * Determine whether a recovery should be attempted.
   *
   * @param {object} settlement
   * @returns {object}
   */
  function assess(
    settlement
  ) {
    const normalized =
      normalizeSettlement(
        settlement
      );

    if (
      normalized.status ===
      TERMINAL_SUCCESS_STATUS
    ) {
      return {
        recoverable: false,
        terminal: true,
        state:
          RECOVERY_STATES.RECOVERED,
        reason:
          'Settlement is already settled.'
      };
    }

    if (
      NON_RECOVERABLE_SETTLEMENT_STATUSES.has(
        normalized.status
      )
    ) {
      return {
        recoverable: false,
        terminal: true,
        state:
          RECOVERY_STATES.NOT_RECOVERABLE,
        reason:
          `Settlement is in non-recoverable state ${normalized.status}.`
      };
    }

    if (
      !isRecoverableStatus(
        normalized.status
      )
    ) {
      return {
        recoverable: false,
        terminal: false,
        state:
          RECOVERY_STATES.NOT_RECOVERABLE,
        reason:
          `Settlement state ${normalized.status} is not configured for recovery.`
      };
    }

    if (
      normalized.status ===
      'TIMEOUT'
    ) {
      return {
        recoverable: true,
        terminal: false,
        state:
          RECOVERY_STATES.PROVIDER_QUERY_REQUIRED,
        reason:
          'Provider state must be queried authoritatively.'
      };
    }

    if (
      normalized.status ===
      'REQUIRES_RECONCILIATION'
    ) {
      return {
        recoverable: true,
        terminal: false,
        state:
          RECOVERY_STATES.RECONCILIATION_REQUIRED,
        reason:
          'Settlement requires reconciliation.'
      };
    }

    if (
      normalized.status ===
      'REQUIRES_REVIEW'
    ) {
      return {
        recoverable: true,
        terminal: false,
        state:
          RECOVERY_STATES.MANUAL_REVIEW,
        reason:
          'Settlement requires controlled review.'
      };
    }

    return {
      recoverable: true,
      terminal: false,
      state:
        RECOVERY_STATES.ELIGIBLE,
      reason:
        'Settlement is eligible for recovery.'
    };
  }

  /**
   * Perform one recovery attempt.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function recover(
    input = {}
  ) {
    const startedAt =
      now();

    const tenantId =
      normalizeId(
        input.tenantId
      );

    const settlementId =
      normalizeId(
        input.settlementId
      );

    const context =
      normalizeContext(
        {
          ...(input.context || {}),
          operationId:
            input.context?.operationId ||
            input.recoveryOperationId ||
            createRecoveryOperationId(),
          source:
            input.context?.source ||
            'SETTLEMENT_RECOVERY',
          serviceName:
            input.context?.serviceName ||
            'SettlementRecovery'
        }
      );

    const attempt =
      Math.max(
        1,
        Number(
          input.attempt || 1
        )
      );

    const reasonCode =
      normalizeString(
        input.reasonCode ||
          RECOVERY_REASON_CODES.TIMEOUT,
        128
      );

    if (!tenantId) {
      throw new SettlementRecoveryError(
        'tenantId is required.',
        'TENANT_ID_REQUIRED'
      );
    }

    if (!settlementId) {
      throw new SettlementRecoveryError(
        'settlementId is required.',
        'SETTLEMENT_ID_REQUIRED'
      );
    }

    if (
      attempt >
      maxRecoveryAttempts
    ) {
      throw new SettlementRecoveryError(
        'Maximum settlement recovery attempts exceeded.',
        'RECOVERY_ATTEMPTS_EXHAUSTED',
        {
          settlementId,
          attempt,
          maxRecoveryAttempts
        }
      );
    }

    const fingerprint =
      crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            tenantId,
            settlementId,
            reasonCode,
            providerEventId:
              input.providerEventId
          })
        )
        .digest('hex');

    const idempotencyKey =
      input.idempotencyKey ||
      createRecoveryIdempotencyKey(
        {
          tenantId,
          settlementId,
          reasonCode,
          attempt,
          providerEventId:
            input.providerEventId
        }
      );

    const existing =
      await checkIdempotency(
        {
          tenantId,
          idempotencyKey,
          fingerprint
        }
      );

    if (existing) {
      if (
        existing.requestFingerprint &&
        existing.requestFingerprint !==
          fingerprint
      ) {
        throw new SettlementRecoveryError(
          'Recovery idempotency key conflict.',
          'IDEMPOTENCY_KEY_CONFLICT',
          undefined,
          {
            conflict: true
          }
        );
      }

      return {
        success: true,
        idempotent: true,
        settlementId,
        result:
          existing.result ||
          existing
      };
    }

    const settlementRecord =
      await getSettlement(
        {
          tenantId,
          settlementId
        }
      );

    const settlement =
      normalizeSettlement(
        settlementRecord
      );

    assertTenantScope(
      tenantId,
      settlement.tenantId
    );

    const assessment =
      assess(
        settlement
      );

    if (
      !assessment.recoverable
    ) {
      const result = {
        success:
          assessment.state ===
          RECOVERY_STATES.RECOVERED,
        idempotent: false,
        recovered: false,
        settlementId,
        status:
          settlement.status,
        recoveryState:
          assessment.state,
        reason:
          assessment.reason
      };

      await completeIdempotency(
        {
          tenantId,
          idempotencyKey,
          requestFingerprint:
            fingerprint,
          result
        }
      );

      return result;
    }

    await authorize(
      context,
      settlement,
      input.manual
        ? 'payment.settlement.recovery.manual'
        : 'payment.settlement.recovery'
    );

    const lock =
      await acquireLock(
        settlement
      );

    try {
      /*
       * Re-read after lock acquisition. Another worker may have completed the
       * settlement between the first read and the lock.
       */
      const lockedRecord =
        await getSettlement(
          {
            tenantId,
            settlementId
          }
        );

      const current =
        normalizeSettlement(
          lockedRecord
        );

      assertTenantScope(
        tenantId,
        current.tenantId
      );

      if (
        isTerminal(
          current
        )
      ) {
        const result = {
          success:
            current.status ===
            TERMINAL_SUCCESS_STATUS,
          idempotent: true,
          alreadyTerminal: true,
          settlementId,
          status:
            current.status
        };

        await completeIdempotency(
          {
            tenantId,
            idempotencyKey,
            requestFingerprint:
              fingerprint,
            result
          }
        );

        return result;
      }

      await audit(
        'SETTLEMENT_RECOVERY_STARTED',
        {
          tenantId,
          settlementId,
          paymentId:
            current.paymentId,
          financialTransactionId:
            current.financialTransactionId,
          provider:
            current.provider,
          providerTransactionId:
            current.providerTransactionId,
          transactionAmount:
            current.amount,
          currency:
            current.currency,
          sourceStatus:
            current.status,
          targetStatus:
            current.status,
          reason:
            input.reason ||
            reasonCode,
          actor: {
            type:
              context.actorType ||
              (input.manual
                ? 'USER'
                : 'WORKER'),
            actorId:
              context.actorId,
            serviceName:
              context.serviceName
          },
          context,
          metadata:
            buildRecoveryMetadata(
              {
                recoveryOperationId:
                  context.operationId,
                reasonCode,
                reason:
                  input.reason,
                attempt,
                source:
                  input.source,
                workerId:
                  input.workerId,
                manual:
                  input.manual,
                startedAt
              }
            ),
          idempotencyKey:
            `${idempotencyKey}:started`
        }
      );

      let providerEvidence =
        input.providerEvidence;

      /*
       * Timeout and ambiguous states require authoritative provider lookup.
       * Never infer provider success locally.
       */
      if (
        !providerEvidence &&
        (
          current.status ===
            'TIMEOUT' ||
          current.status ===
            'PENDING_PROVIDER' ||
          current.status ===
            'PROVIDER_ACCEPTED' ||
          current.status ===
            'INITIATED'
        )
      ) {
        providerEvidence =
          await queryProvider(
            {
              settlement:
                current,
              context
            }
          );

        await audit(
          'SETTLEMENT_RECOVERY_PROVIDER_QUERY',
          {
            tenantId,
            settlementId,
            provider:
              current.provider,
            providerTransactionId:
              current.providerTransactionId,
            sourceStatus:
              current.status,
            reason:
              reasonCode,
            actor: {
              type: 'WORKER',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName
            },
            context,
            metadata: {
              providerClassification:
                classifyProviderResult(
                  providerEvidence
                ),
              providerStatus:
                normalizeProviderStatus(
                  providerEvidence?.status ||
                    providerEvidence?.providerStatus ||
                    providerEvidence?.state
                )
            },
            idempotencyKey:
              `${idempotencyKey}:provider-query`
          }
        );
      }

      if (
        providerEvidence
      ) {
        assertProviderConsistency(
          current,
          providerEvidence
        );

        const providerClassification =
          classifyProviderResult(
            providerEvidence
          );

        if (
          providerClassification ===
          'FAILED'
        ) {
          /*
           * Failed provider evidence cannot be silently converted into a
           * financial settlement. Delegate the terminal/failure path to the
           * canonical processor where appropriate.
           */
          const result =
            await resumeProcessor(
              {
                settlement:
                  current,
                providerEvidence,
                context,
                idempotencyKey:
                  `${idempotencyKey}:provider-failed`
              }
            );

          const finalResult = {
            success:
              result?.success !==
              false,
            recovered:
              false,
            providerFailed:
              true,
            settlementId,
            status:
              result?.status ||
              'FAILED',
            result
          };

          await audit(
            'SETTLEMENT_RECOVERY_COMPLETED',
            {
              tenantId,
              settlementId,
              provider:
                current.provider,
              providerTransactionId:
                current.providerTransactionId,
              sourceStatus:
                current.status,
              targetStatus:
                finalResult.status,
              outcome:
                'ACCEPTED',
              context,
              metadata: {
                recoveryState:
                  RECOVERY_STATES.RECOVERED,
                providerClassification
              },
              idempotencyKey:
                `${idempotencyKey}:completed`
            }
          );

          await completeIdempotency(
            {
              tenantId,
              idempotencyKey,
              requestFingerprint:
                fingerprint,
              result:
                finalResult
            }
          );

          return finalResult;
        }

        if (
          providerClassification ===
          'PENDING'
        ) {
          /*
           * Provider is still processing. No financial mutation should occur.
           */
          const delayMs =
            calculateBackoff(
              attempt,
              baseDelayMs,
              maxDelayMs
            );

          const retryAt =
            new Date(
              now().getTime() +
                delayMs
            );

          const result = {
            success: false,
            recovered: false,
            settlementId,
            status:
              current.status,
            recoveryState:
              RECOVERY_STATES.RETRY_SCHEDULED,
            retryable: true,
            retryAt,
            delayMs,
            attempt
          };

          await audit(
            'SETTLEMENT_RECOVERY_RETRY_SCHEDULED',
            {
              tenantId,
              settlementId,
              provider:
                current.provider,
              providerTransactionId:
                current.providerTransactionId,
              sourceStatus:
                current.status,
              targetStatus:
                current.status,
              outcome:
                'PENDING',
              context,
              metadata: {
                attempt,
                maxRecoveryAttempts,
                retryAt,
                delayMs,
                providerClassification
              },
              idempotencyKey:
                `${idempotencyKey}:retry-scheduled`
            }
          );

          await completeIdempotency(
            {
              tenantId,
              idempotencyKey,
              requestFingerprint:
                fingerprint,
              result
            }
          );

          return result;
        }
      }

      /*
       * At this stage we either have validated provider success evidence or
       * caller-supplied authoritative evidence. Reconcile before attempting
       * financial convergence.
       */
      if (
        !providerEvidence
      ) {
        throw new SettlementRecoveryError(
          'Authoritative provider evidence is unavailable.',
          'PROVIDER_EVIDENCE_UNAVAILABLE',
          undefined,
          {
            retryable: true
          }
        );
      }

      const reconciliation =
        input.reconciliation ||
        await reconcile(
          {
            settlement:
              current,
            providerEvidence,
            context
          }
        );

      assertReconciliationSuccess(
        reconciliation
      );

      await audit(
        'SETTLEMENT_RECOVERY_RECONCILED',
        {
          tenantId,
          settlementId,
          paymentId:
            current.paymentId,
          provider:
            current.provider,
          providerTransactionId:
            current.providerTransactionId,
          reconciliationId:
            reconciliation.id ||
            reconciliation._id,
          transactionAmount:
            current.amount,
          currency:
            current.currency,
          sourceStatus:
            current.status,
          targetStatus:
            current.status,
          outcome:
            'ACCEPTED',
          context,
          metadata: {
            reconciliationStatus:
              reconciliation.status ||
              reconciliation.reconciliationStatus
          },
          idempotencyKey:
            `${idempotencyKey}:reconciled`
        }
      );

      /*
       * Critical convergence boundary.
       *
       * This service DOES NOT post the ledger itself. It hands the validated
       * evidence back to the canonical settlement processor.
       */
      const processorResult =
        await resumeProcessor(
          {
            settlement:
              current,
            providerEvidence: {
              ...providerEvidence,
              reconciliation
            },
            context,
            idempotencyKey:
              `${idempotencyKey}:resume`
          }
        );

      const recovered =
        processorResult?.status ===
          TERMINAL_SUCCESS_STATUS ||
        processorResult?.settlement?.status ===
          TERMINAL_SUCCESS_STATUS ||
        processorResult?.success === true &&
          (
            processorResult?.status ===
              TERMINAL_SUCCESS_STATUS ||
            processorResult?.alreadySettled ===
              true
          );

      const result = {
        success:
          processorResult?.success !==
          false,
        recovered,
        settlementId,
        status:
          processorResult?.status ||
          processorResult?.settlement?.status ||
          current.status,
        recoveryState:
          recovered
            ? RECOVERY_STATES.RECOVERED
            : RECOVERY_STATES.IN_PROGRESS,
        attempt,
        processorResult
      };

      await audit(
        'SETTLEMENT_RECOVERY_COMPLETED',
        {
          tenantId,
          settlementId,
          paymentId:
            current.paymentId,
          financialTransactionId:
            current.financialTransactionId,
          provider:
            current.provider,
          providerTransactionId:
            current.providerTransactionId,
          reconciliationId:
            reconciliation.id ||
            reconciliation._id,
          transactionAmount:
            current.amount,
          currency:
            current.currency,
          sourceStatus:
            current.status,
          targetStatus:
            result.status,
          outcome:
            recovered
              ? 'ACCEPTED'
              : 'PENDING',
          context,
          metadata: {
            recoveryState:
              result.recoveryState,
            attempt,
            maxRecoveryAttempts,
            recovered
          },
          idempotencyKey:
            `${idempotencyKey}:completed`
        }
      );

      await completeIdempotency(
        {
          tenantId,
          idempotencyKey,
          requestFingerprint:
            fingerprint,
          result
        }
      );

      logger.info?.(
        {
          tenantId,
          settlementId,
          attempt,
          recovered,
          status:
            result.status,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId
        },
        'Settlement recovery completed'
      );

      return result;
    } catch (error) {
      const classified =
        classifyError(error);

      const recoveryState =
        classified.manualReview
          ? RECOVERY_STATES.MANUAL_REVIEW
          : classified.retryable &&
              attempt <
                maxRecoveryAttempts
            ? RECOVERY_STATES.RETRY_SCHEDULED
            : RECOVERY_STATES.EXHAUSTED;

      try {
        await audit(
          'SETTLEMENT_RECOVERY_FAILED',
          {
            tenantId,
            settlementId,
            provider:
              settlement.provider,
            providerTransactionId:
              settlement.providerTransactionId,
            sourceStatus:
              settlement.status,
            outcome:
              classified.manualReview
                ? 'REVIEW_REQUIRED'
                : 'FAILED',
            reason:
              input.reason ||
              reasonCode,
            error: {
              code:
                classified.code,
              message:
                classified.message,
              retryable:
                classified.retryable
            },
            actor: {
              type:
                context.actorType ||
                'WORKER',
              actorId:
                context.actorId,
              serviceName:
                context.serviceName
            },
            context,
            metadata: {
              recoveryState,
              attempt,
              maxRecoveryAttempts
            },
            idempotencyKey:
              `${idempotencyKey}:failed`
          }
        );
      } catch (auditError) {
        logger.error?.(
          {
            err:
              auditError,
            tenantId,
            settlementId
          },
          'Failed to write settlement recovery failure audit'
        );
      }

      logger.error?.(
        {
          err:
            error,
          code:
            classified.code,
          retryable:
            classified.retryable,
          manualReview:
            classified.manualReview,
          tenantId,
          settlementId,
          attempt,
          correlationId:
            context.correlationId
        },
        'Settlement recovery failed'
      );

      /*
       * Preserve the distinction between:
       * - retryable recovery failure;
       * - manual-review condition;
       * - exhausted recovery;
       * - hard failure.
       */
      if (
        error instanceof
        SettlementRecoveryError
      ) {
        throw error;
      }

      throw new SettlementRecoveryError(
        'Settlement recovery failed.',
        classified.code,
        {
          recoveryState,
          attempt,
          maxRecoveryAttempts
        },
        {
          retryable:
            classified.retryable,
          manualReview:
            classified.manualReview
        }
      );
    } finally {
      await releaseLock(
        lock
      );
    }
  }

  /**
   * Recover with bounded retry scheduling.
   *
   * This function never creates a new financial transaction merely because a
   * previous recovery attempt failed.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function recoverWithRetry(
    input = {}
  ) {
    const startAttempt =
      Math.max(
        1,
        Number(
          input.attempt || 1
        )
      );

    let attempt =
      startAttempt;

    let lastError;

    while (
      attempt <=
      maxRecoveryAttempts
    ) {
      try {
        return await recover(
          {
            ...input,
            attempt
          }
        );
      } catch (error) {
        lastError =
          error;

        const classified =
          classifyError(
            error
          );

        if (
          !classified.retryable ||
          classified.manualReview ||
          attempt >=
            maxRecoveryAttempts
        ) {
          throw error;
        }

        const delayMs =
          calculateBackoff(
            attempt,
            baseDelayMs,
            maxDelayMs
          );

        logger.warn?.(
          {
            tenantId:
              input.tenantId,
            settlementId:
              input.settlementId,
            attempt,
            nextAttempt:
              attempt + 1,
            delayMs,
            code:
              classified.code
          },
          'Scheduling settlement recovery retry'
        );

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              delayMs
            )
        );

        attempt += 1;
      }
    }

    throw (
      lastError ||
      new SettlementRecoveryError(
        'Settlement recovery attempts exhausted.',
        'RECOVERY_ATTEMPTS_EXHAUSTED'
      )
    );
  }

  /**
   * Find settlement records eligible for recovery.
   *
   * This requires a repository method that is explicitly tenant-aware.
   *
   * @param {object} filters
   * @returns {Promise<object[]>}
   */
  async function findRecoverable(
    filters = {}
  ) {
    requireDependency(
      settlementRepository,
      'settlementRepository'
    );

    const {
      tenantId,
      statuses = Array.from(
        RECOVERABLE_SETTLEMENT_STATUSES
      ),
      before,
      limit =
        batchSize
    } = filters;

    if (!tenantId) {
      throw new SettlementRecoveryError(
        'tenantId is required when querying recoverable settlements.',
        'TENANT_ID_REQUIRED'
      );
    }

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 1,
          1
        ),
        500
      );

    if (
      typeof settlementRepository.findRecoverable ===
      'function'
    ) {
      return settlementRepository.findRecoverable(
        {
          tenantId,
          statuses,
          before,
          limit:
            safeLimit
        }
      );
    }

    if (
      typeof settlementRepository.findByStatusesForTenant ===
      'function'
    ) {
      return settlementRepository.findByStatusesForTenant(
        {
          tenantId,
          statuses,
          before,
          limit:
            safeLimit
        }
      );
    }

    throw new SettlementRecoveryError(
      'Settlement repository does not expose a recoverable-settlement query.',
      'RECOVERY_QUERY_UNSUPPORTED'
    );
  }

  /**
   * Recover a bounded batch.
   *
   * @param {object} filters
   * @returns {Promise<object>}
   */
  async function recoverBatch(
    filters = {}
  ) {
    const settlements =
      await findRecoverable(
        filters
      );

    const results = [];
    const failures = [];

    for (
      const settlement of
        settlements
    ) {
      try {
        const result =
          await recoverWithRetry(
            {
              tenantId:
                filters.tenantId,
              settlementId:
                settlement._id ||
                settlement.id ||
                settlement.settlementId,
              reasonCode:
                filters.reasonCode ||
                RECOVERY_REASON_CODES.WORKER_INTERRUPTION,
              source:
                filters.source ||
                'SETTLEMENT_RECOVERY_WORKER',
              workerId:
                filters.workerId,
              context:
                filters.context
            }
          );

        results.push(
          result
        );
      } catch (error) {
        failures.push(
          {
            settlementId:
              normalizeId(
                settlement._id ||
                  settlement.id ||
                  settlement.settlementId
              ),
            code:
              error.code ||
              'RECOVERY_ERROR',
            message:
              error.message
          }
        );
      }
    }

    return {
      success:
        failures.length ===
        0,

      total:
        settlements.length,

      recovered:
        results.filter(
          (item) =>
            item.recovered === true
        ).length,

      idempotent:
        results.filter(
          (item) =>
            item.idempotent === true
        ).length,

      pending:
        results.filter(
          (item) =>
            item.recoveryState ===
            RECOVERY_STATES.RETRY_SCHEDULED
        ).length,

      failures:
        failures.length,

      results,
      errors:
        failures
    };
  }

  /**
   * Manually recover one settlement.
   *
   * Manual recovery still uses the same safety controls and canonical
   * settlement processor.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function manualRecover(
    input = {}
  ) {
    const context =
      normalizeContext(
        {
          ...(input.context || {}),
          actorId:
            input.actorId ||
            input.context?.actorId,
          actorType:
            input.actorType ||
            input.context?.actorType ||
            'USER',
          source:
            'MANUAL_SETTLEMENT_RECOVERY',
          serviceName:
            input.context?.serviceName ||
            'SettlementRecovery'
        }
      );

    return recoverWithRetry(
      {
        ...input,
        manual:
          true,
        reasonCode:
          input.reasonCode ||
          RECOVERY_REASON_CODES.MANUAL_REQUEST,
        context
      }
    );
  }

  /**
   * Produce recovery scheduling metadata.
   *
   * @param {number} attempt
   * @returns {object}
   */
  function getRetryMetadata(
    attempt = 1
  ) {
    const normalizedAttempt =
      Math.max(
        1,
        Number(attempt) || 1
      );

    const delayMs =
      calculateBackoff(
        normalizedAttempt,
        baseDelayMs,
        maxDelayMs
      );

    return {
      attempt:
        normalizedAttempt,
      maxAttempts:
        maxRecoveryAttempts,
      delayMs,
      retryable:
        normalizedAttempt <
        maxRecoveryAttempts
    };
  }

  /**
   * Determine whether a status is recoverable.
   *
   * @param {string} status
   * @returns {boolean}
   */
  function canRecover(
    status
  ) {
    return isRecoverableStatus(
      String(
        status || ''
      ).toUpperCase()
    );
  }

  /**
   * Determine whether recovery is exhausted.
   *
   * @param {number} attempt
   * @returns {boolean}
   */
  function isExhausted(
    attempt
  ) {
    return (
      Number(
        attempt
      ) >=
      maxRecoveryAttempts
    );
  }

  return Object.freeze({
    name:
      'SettlementRecovery',
    version:
      '1.0.0',

    states:
      RECOVERY_STATES,

    reasonCodes:
      RECOVERY_REASON_CODES,

    recoverableStatuses:
      Object.freeze(
        Array.from(
          RECOVERABLE_SETTLEMENT_STATUSES
        )
      ),

    createRecoveryOperationId,
    createRecoveryIdempotencyKey,

    assess,
    canRecover,
    isExhausted,

    recover,
    recoverWithRetry,
    manualRecover,
    recoverBatch,

    findRecoverable,

    getRetryMetadata,

    calculateBackoff,
    classifyError,
    classifyProviderResult,
    normalizeSettlement
  });
}

const defaultRecovery =
  createSettlementRecovery();

module.exports =
  defaultRecovery;

module.exports.create =
  createSettlementRecovery;

module.exports.createSettlementRecovery =
  createSettlementRecovery;

module.exports.SettlementRecoveryError =
  SettlementRecoveryError;

module.exports.RECOVERY_STATES =
  RECOVERY_STATES;

module.exports.RECOVERY_REASON_CODES =
  RECOVERY_REASON_CODES;

module.exports.RECOVERABLE_SETTLEMENT_STATUSES =
  RECOVERABLE_SETTLEMENT_STATUSES;