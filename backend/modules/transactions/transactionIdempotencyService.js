'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Idempotency Service
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/transactionIdempotencyService.js
 *
 * Purpose
 * -------
 * Provides the authoritative idempotency boundary for transaction operations.
 *
 * This service prevents duplicate execution of financially material operations
 * across:
 *
 *   - HTTP retries
 *   - browser/mobile retries
 *   - reverse proxies
 *   - webhook redelivery
 *   - queue redelivery
 *   - worker crashes
 *   - provider timeouts
 *   - process restarts
 *   - distributed workers
 *   - manual recovery
 *   - transaction recovery
 *   - settlement recovery
 *
 * Core Rule
 * ---------
 * Idempotency is an identity guarantee, not merely a duplicate-request check.
 *
 * For a given:
 *
 *   tenant + operationType + idempotencyKey
 *
 * the system must resolve to exactly one logical operation identity.
 *
 * Once that operation has an authoritative result, retries must return the
 * same logical result instead of executing another financial side effect.
 *
 * Unknown Outcome Rule
 * --------------------
 * If an external operation may have succeeded but the result is unknown,
 * NEVER release the idempotency identity and NEVER execute a second external
 * financial operation under a different identity.
 *
 * Instead:
 *
 *   UNKNOWN
 *      |
 *      v
 *   VERIFY / QUERY
 *      |
 *      +------> SUCCESS
 *      |
 *      +------> FAILED
 *      |
 *      +------> RECONCILIATION
 *
 * State Model
 * -----------
 *
 *   RESERVED
 *      |
 *      v
 *   PROCESSING
 *      |
 *      +------------------+
 *      |                  |
 *      v                  v
 *   COMPLETED          UNKNOWN
 *      |                  |
 *      |             +----+----+
 *      |             |         |
 *      |             v         v
 *      |          COMPLETED  RECONCILIATION
 *      |
 *      +----------------------+
 *
 * Additional terminal/operational states:
 *
 *   FAILED
 *   EXPIRED
 *   RELEASED
 *   CANCELLED
 *
 * Enterprise Rules
 * ---------------
 * 1. Tenant is part of the idempotency identity.
 * 2. Operation type is part of the idempotency identity.
 * 3. Request fingerprint detects semantic-key reuse with different payloads.
 * 4. Unknown operations keep their original identity.
 * 5. Completion is immutable except for controlled metadata/audit fields.
 * 6. A completed operation cannot be overwritten with another result.
 * 7. FAILED does not imply the external side effect did not happen.
 * 8. UNKNOWN is not FAILED.
 * 9. Idempotency keys are not payment references.
 * 10. Idempotency records do not replace provider transaction references.
 * 11. Idempotency does not replace database uniqueness constraints.
 * 12. All state transitions are version-aware where repository support exists.
 * 13. Recovery workers can safely claim stale operations.
 * 14. Concurrent reservations fail closed.
 * 15. Sensitive request values are never persisted in raw form.
 * 16. Request fingerprints use sanitized canonical input.
 * 17. Result payloads are sanitized before persistence.
 * 18. The service never posts ledger entries or mutates balances.
 * 19. The service never calls external payment providers directly.
 * 20. Consumers must treat returned results as replayable.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const IDEMPOTENCY_STATUS = Object.freeze({
  RESERVED:
    'RESERVED',

  PROCESSING:
    'PROCESSING',

  COMPLETED:
    'COMPLETED',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',

  EXPIRED:
    'EXPIRED',

  RELEASED:
    'RELEASED',

  CANCELLED:
    'CANCELLED',
});

const IDEMPOTENCY_OPERATION_TYPES = Object.freeze({
  TRANSACTION:
    'TRANSACTION',

  TRANSACTION_PROCESS:
    'TRANSACTION_PROCESS',

  TRANSACTION_RECOVERY:
    'TRANSACTION_RECOVERY',

  PAYMENT:
    'PAYMENT',

  PAYMENT_PROCESS:
    'PAYMENT_PROCESS',

  PAYMENT_CALLBACK:
    'PAYMENT_CALLBACK',

  FINANCIAL_POSTING:
    'FINANCIAL_POSTING',

  SETTLEMENT:
    'SETTLEMENT',

  SETTLEMENT_MATCH:
    'SETTLEMENT_MATCH',

  SETTLEMENT_RECOVERY:
    'SETTLEMENT_RECOVERY',

  REFUND:
    'REFUND',

  REVERSAL:
    'REVERSAL',

  ADJUSTMENT:
    'ADJUSTMENT',

  RECONCILIATION_REPAIR:
    'RECONCILIATION_REPAIR',

  LOAN_DISBURSEMENT:
    'LOAN_DISBURSEMENT',

  LOAN_REPAYMENT:
    'LOAN_REPAYMENT',

  CONTRIBUTION:
    'CONTRIBUTION',

  WITHDRAWAL:
    'WITHDRAWAL',

  TRANSFER:
    'TRANSFER',
});

const IDEMPOTENCY_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'TRANSACTION_IDEMPOTENCY_INVALID_REQUEST',

  TENANT_REQUIRED:
    'TRANSACTION_IDEMPOTENCY_TENANT_REQUIRED',

  OPERATION_TYPE_REQUIRED:
    'TRANSACTION_IDEMPOTENCY_OPERATION_TYPE_REQUIRED',

  INVALID_OPERATION_TYPE:
    'TRANSACTION_IDEMPOTENCY_INVALID_OPERATION_TYPE',

  KEY_REQUIRED:
    'TRANSACTION_IDEMPOTENCY_KEY_REQUIRED',

  KEY_TOO_LONG:
    'TRANSACTION_IDEMPOTENCY_KEY_TOO_LONG',

  INVALID_KEY:
    'TRANSACTION_IDEMPOTENCY_KEY_INVALID',

  FINGERPRINT_REQUIRED:
    'TRANSACTION_IDEMPOTENCY_FINGERPRINT_REQUIRED',

  CONFLICT:
    'TRANSACTION_IDEMPOTENCY_CONFLICT',

  IN_PROGRESS:
    'TRANSACTION_IDEMPOTENCY_IN_PROGRESS',

  UNKNOWN:
    'TRANSACTION_IDEMPOTENCY_UNKNOWN',

  COMPLETED:
    'TRANSACTION_IDEMPOTENCY_COMPLETED',

  FAILED:
    'TRANSACTION_IDEMPOTENCY_FAILED',

  NOT_FOUND:
    'TRANSACTION_IDEMPOTENCY_NOT_FOUND',

  CONCURRENT_UPDATE:
    'TRANSACTION_IDEMPOTENCY_CONCURRENT_UPDATE',

  LEASE_REQUIRED:
    'TRANSACTION_IDEMPOTENCY_LEASE_REQUIRED',

  LEASE_LOST:
    'TRANSACTION_IDEMPOTENCY_LEASE_LOST',

  LEASE_EXPIRED:
    'TRANSACTION_IDEMPOTENCY_LEASE_EXPIRED',

  INVALID_STATE_TRANSITION:
    'TRANSACTION_IDEMPOTENCY_INVALID_STATE_TRANSITION',

  UNKNOWN_OUTCOME:
    'TRANSACTION_IDEMPOTENCY_UNKNOWN_OUTCOME',

  STORAGE_UNAVAILABLE:
    'TRANSACTION_IDEMPOTENCY_STORAGE_UNAVAILABLE',

  SERIALIZATION_FAILED:
    'TRANSACTION_IDEMPOTENCY_SERIALIZATION_FAILED',

  CONFIGURATION_ERROR:
    'TRANSACTION_IDEMPOTENCY_CONFIGURATION_ERROR',

  KEY_REUSE:
    'TRANSACTION_IDEMPOTENCY_KEY_REUSED',

  IMMUTABLE_RESULT:
    'TRANSACTION_IDEMPOTENCY_RESULT_IMMUTABLE',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireOperationType:
    true,

  requireIdempotencyKey:
    true,

  minKeyLength:
    8,

  maxKeyLength:
    255,

  maxMetadataDepth:
    8,

  maxMetadataKeys:
    100,

  maxMetadataStringLength:
    5000,

  /**
   * Reserved -> PROCESSING lease.
   */
  reservationLeaseMs:
    5 * 60 * 1000,

  /**
   * A worker can renew ownership during long-running operations.
   */
  processingLeaseMs:
    10 * 60 * 1000,

  /**
   * An UNKNOWN result remains protected for a very long period.
   *
   * The operation must not be released automatically just because a provider
   * call timed out.
   */
  unknownLeaseMs:
    24 * 60 * 60 * 1000,

  /**
   * Used only for explicit stale-record administrative recovery.
   */
  staleRecordGraceMs:
    30 * 60 * 1000,

  /**
   * Keep terminal records indefinitely by default.
   *
   * Physical retention/archival is a repository/data-governance concern.
   */
  retainTerminalRecords:
    true,

  allowReuseAfterFailure:
    false,

  allowReuseAfterRelease:
    false,

  /**
   * A FAILED operation can be retried only with the same logical idempotency
   * identity, not by manufacturing a new key.
   */
  retryFailedOperation:
    true,

  /**
   * UNKNOWN operations can never be treated as ordinary failed operations.
   */
  protectUnknownOperations:
    true,

  /**
   * Request fingerprints must match on key reuse.
   */
  enforceRequestFingerprint:
    true,

  /**
   * When true, semantic key conflicts throw rather than silently replay.
   */
  failOnKeyReuse:
    true,

  /**
   * A result hash protects completion immutability.
   */
  enforceResultImmutability:
    true,

  /**
   * Whether the service may create an operation without transactionId.
   */
  transactionIdOptional:
    true,

  /**
   * Whether the service may create an operation without paymentId.
   */
  paymentIdOptional:
    true,

  /**
   * Keep safe operational metadata for diagnostics.
   */
  retainMetadata:
    true,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class TransactionIdempotencyError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'TransactionIdempotencyError';

    this.code =
      options.code ||
      IDEMPOTENCY_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.tenantId =
      options.tenantId ||
      null;

    this.operationType =
      options.operationType ||
      null;

    this.idempotencyKey =
      options.idempotencyKey ||
      null;

    this.operationId =
      options.operationId ||
      null;

    this.transactionId =
      options.transactionId ||
      null;

    this.paymentId =
      options.paymentId ||
      null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.details =
      options.details ||
      {};

    if (
      options.cause
    ) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      TransactionIdempotencyError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(
  value,
) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(
  value,
) {
  return isNonEmptyString(
    value,
  )
    ? value.trim()
    : null;
}

function normalizeOperationType(
  value,
) {
  const normalized =
    normalizeString(
      value,
    )?.toUpperCase();

  return normalized
    ? normalized
    : null;
}

function normalizeStatus(
  value,
) {
  const normalized =
    normalizeString(
      value,
    )?.toUpperCase();

  return normalized
    ? normalized
    : null;
}

function safeId(
  value,
) {
  if (
    value &&
    typeof value.toString ===
      'function'
  ) {
    return value.toString();
  }

  return normalizeString(
    value,
  );
}

function clone(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
      'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch (_error) {
      // Continue below.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(
        value,
      ),
    );
  } catch (_error) {
    return value;
  }
}

function stableStringify(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  if (
    typeof value !==
      'object'
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(
          key,
        )}:${stableStringify(
          value[key],
        )}`,
    )
    .join(',')}}`;
}

function sha256(
  value,
) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value ===
        'string'
        ? value
        : stableStringify(
            value,
          ),
    )
    .digest('hex');
}

function createOperationId(
  prefix = 'txn_op',
) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function parseDate(
  value,
) {
  if (
    !value
  ) {
    return null;
  }

  const parsed =
    value instanceof Date
      ? value
      : new Date(
          value,
        );

  return Number.isNaN(
    parsed.getTime(),
  )
    ? null
    : parsed;
}

function parseVersion(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const parsed =
    Number(
      value,
    );

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function normalizeKey(
  value,
) {
  const key =
    normalizeString(
      value,
    );

  return key
    ? key
    : null;
}

/* ============================================================================
 * State Transition Rules
 * ========================================================================== */

const STATUS_TRANSITIONS = Object.freeze({
  [IDEMPOTENCY_STATUS
    .RESERVED]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .PROCESSING,

      IDEMPOTENCY_STATUS
        .EXPIRED,

      IDEMPOTENCY_STATUS
        .RELEASED,

      IDEMPOTENCY_STATUS
        .CANCELLED,
    ]),

  [IDEMPOTENCY_STATUS
    .PROCESSING]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .COMPLETED,

      IDEMPOTENCY_STATUS
        .FAILED,

      IDEMPOTENCY_STATUS
        .UNKNOWN,

      IDEMPOTENCY_STATUS
        .EXPIRED,

      IDEMPOTENCY_STATUS
        .CANCELLED,
    ]),

  [IDEMPOTENCY_STATUS
    .UNKNOWN]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .PROCESSING,

      IDEMPOTENCY_STATUS
        .COMPLETED,

      IDEMPOTENCY_STATUS
        .FAILED,

      IDEMPOTENCY_STATUS
        .CANCELLED,
    ]),

  [IDEMPOTENCY_STATUS
    .FAILED]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .PROCESSING,

      IDEMPOTENCY_STATUS
        .UNKNOWN,

      IDEMPOTENCY_STATUS
        .EXPIRED,
    ]),

  [IDEMPOTENCY_STATUS
    .EXPIRED]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .PROCESSING,

      IDEMPOTENCY_STATUS
        .RELEASED,

      IDEMPOTENCY_STATUS
        .CANCELLED,
    ]),

  [IDEMPOTENCY_STATUS
    .RELEASED]:
    Object.freeze([
      IDEMPOTENCY_STATUS
        .PROCESSING,
    ]),

  [IDEMPOTENCY_STATUS
    .COMPLETED]:
    Object.freeze([]),

  [IDEMPOTENCY_STATUS
    .CANCELLED]:
    Object.freeze([]),
});

/* ============================================================================
 * Transaction Idempotency Service
 * ========================================================================== */

class TransactionIdempotencyService {
  /**
   * @param {Object} dependencies
   *
   * Required production dependency:
   *
   *   repository
   *
   * Optional:
   *
   *   auditService
   *   metrics
   *   logger
   *   clock
   */
  constructor(
    dependencies = {},
  ) {
    this.repository =
      dependencies.repository ||
      dependencies.idempotencyRepository ||
      null;

    this.auditService =
      dependencies.auditService ||
      null;

    this.metrics =
      dependencies.metrics ||
      null;

    this.logger =
      dependencies.logger ||
      console;

    this.clock =
      dependencies.clock ||
      Date;

    this.options =
      Object.freeze({
        ...DEFAULT_OPTIONS,
        ...(dependencies.options || {}),
      });
  }

  /* ==========================================================================
   * Primary Reservation API
   * ======================================================================== */

  /**
   * Reserve or retrieve an idempotent operation.
   *
   * This method is intentionally compatible with:
   *
   *   paymentIdempotencyService.reserve(...)
   *   transactionRecoveryService.reserve(...)
   *   paymentSettlementWorkflow.reserve(...)
   *
   * Request:
   *
   * {
   *   tenantId,
   *   operationType,
   *   key,
   *   request,
   *   transactionId,
   *   paymentId,
   *   provider,
   *   providerTransactionId,
   *   metadata,
   * }
   *
   * Result:
   *
   * {
   *   operationId,
   *   status,
   *   replay,
   *   created,
   *   completed,
   *   result,
   *   requestFingerprint,
   * }
   */
  async reserve(
    input = {},
  ) {
    const request =
      this._normalizeReservationInput(
        input,
      );

    this._validateReservationInput(
      request,
    );

    const requestFingerprint =
      this._buildRequestFingerprint(
        request,
      );

    const identityKey =
      this.buildIdentityKey(
        request.tenantId,
        request.operationType,
        request.key,
      );

    if (
      !this.repository
    ) {
      throw new TransactionIdempotencyError(
        'Transaction idempotency repository is unavailable.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,

          statusCode:
            503,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.key,
        },
      );
    }

    /**
     * Fast-path lookup.
     */
    const existing =
      await this._findByIdentity(
        request,
        identityKey,
      );

    if (
      existing
    ) {
      return this._handleExistingReservation(
        existing,
        request,
        requestFingerprint,
      );
    }

    const operationId =
      request.operationId ||
      createOperationId(
        'txn_op',
      );

    const record =
      this._buildInitialRecord(
        request,
        requestFingerprint,
        identityKey,
        operationId,
      );

    /**
     * Atomic create is the primary concurrency boundary.
     */
    try {
      const created =
        await this._createRecord(
          record,
        );

      this._metric(
        'transaction_idempotency_reserved_total',
        1,
        {
          operationType:
            request.operationType,
        },
      );

      await this._recordAudit(
        'TRANSACTION_IDEMPOTENCY_RESERVED',
        created || record,
      );

      return this._buildReservationResult(
        created || record,
        {
          created:
            true,

          replay:
            false,
        },
      );
    } catch (error) {
      /**
       * Another worker may have created the same logical identity between
       * lookup and create. Re-read and resolve it deterministically.
       */
      if (
        this._isDuplicateError(
          error,
        )
      ) {
        const concurrent =
          await this._findByIdentity(
            request,
            identityKey,
          );

        if (
          concurrent
        ) {
          return this._handleExistingReservation(
            concurrent,
            request,
            requestFingerprint,
          );
        }
      }

      throw this._wrapStorageError(
        error,
        request,
      );
    }
  }

  /* ==========================================================================
   * Start / Claim Processing
   * ======================================================================== */

  /**
   * Transition RESERVED/FAILED/UNKNOWN/EXPIRED into PROCESSING.
   *
   * This is the worker ownership boundary.
   *
   * The returned lease token should be passed to renewLease(), complete(),
   * fail(), markUnknown(), etc.
   */
  async begin(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertOwnershipContext(
      current,
      options,
    );

    const currentStatus =
      normalizeStatus(
        current.status,
      );

    if (
      currentStatus ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      currentStatus ===
      IDEMPOTENCY_STATUS
        .PROCESSING
    ) {
      if (
        this._isLeaseExpired(
          current,
        )
      ) {
        return this._claimExpiredProcessing(
          current,
          options,
        );
      }

      if (
        options.force !== true
        &&
        current.leaseOwner
        &&
        current.leaseOwner !==
          (
            options.owner ||
            options.operationId ||
            operationId
          )
      ) {
        throw new TransactionIdempotencyError(
          'Idempotency operation is already being processed by another worker.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .IN_PROGRESS,

            statusCode:
              409,

            tenantId:
              current.tenantId,

            operationType:
              current.operationType,

            idempotencyKey:
              current.idempotencyKey,

            operationId:
              current.operationId,
          },
        );
      }

      return this._buildReservationResult(
        current,
        {
          replay:
            false,

          created:
            false,
        },
      );
    }

    if (
      !this._canTransition(
        currentStatus,
        IDEMPOTENCY_STATUS
          .PROCESSING,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot begin idempotency operation from ${currentStatus}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const owner =
      normalizeString(
        options.owner ||
        options.operationId,
      ) ||
      operationId;

    const leaseMs =
      Number(
        options.leaseMs ||
        this.options.processingLeaseMs,
      );

    const nowDate =
      this._now();

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .PROCESSING,

      leaseOwner:
        owner,

      leaseExpiresAt:
        new Date(
          nowDate.getTime() +
            leaseMs,
        ),

      processingStartedAt:
        current.processingStartedAt ||
        nowDate,

      updatedAt:
        nowDate,

      stateVersion:
        current.stateVersion + 1,

      attemptCount:
        current.attemptCount + 1,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_PROCESSING',
      updated,
    );

    this._metric(
      'transaction_idempotency_processing_total',
      1,
      {
        operationType:
          current.operationType,
      },
    );

    return this._buildReservationResult(
      updated,
      {
        created:
          false,

        replay:
          false,
      },
    );
  }

  /**
   * Alias used by callers that use "claim" semantics.
   */
  async claim(
    operationId,
    options = {},
  ) {
    return this.begin(
      operationId,
      options,
    );
  }

  /* ==========================================================================
   * Complete
   * ======================================================================== */

  /**
   * Mark operation COMPLETED.
   *
   * Completion is immutable. A completed record cannot be assigned a
   * different result.
   */
  async complete(
    operationId,
    result,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    const sanitizedResult =
      this._sanitizeResult(
        result,
      );

    const resultHash =
      this._buildResultHash(
        sanitizedResult,
      );

    const status =
      normalizeStatus(
        current.status,
      );

    if (
      status ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      if (
        this.options
          .enforceResultImmutability
        &&
        current.resultHash
        &&
        current.resultHash !==
          resultHash
      ) {
        throw new TransactionIdempotencyError(
          'Completed idempotency result is immutable and cannot be replaced.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .IMMUTABLE_RESULT,

            statusCode:
              409,

            tenantId:
              current.tenantId,

            operationType:
              current.operationType,

            idempotencyKey:
              current.idempotencyKey,

            operationId:
              current.operationId,

            details: {
              existingResultHash:
                current.resultHash,

              attemptedResultHash:
                resultHash,
            },
          },
        );
      }

      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      !this._canTransition(
        status,
        IDEMPOTENCY_STATUS
          .COMPLETED,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot complete idempotency operation from ${status}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const completedAt =
      this._now();

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .COMPLETED,

      result:
        sanitizedResult,

      resultHash,

      completedAt,

      leaseOwner:
        null,

      leaseExpiresAt:
        null,

      updatedAt:
        completedAt,

      stateVersion:
        current.stateVersion + 1,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_COMPLETED',
      updated,
    );

    this._metric(
      'transaction_idempotency_completed_total',
      1,
      {
        operationType:
          current.operationType,
      },
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /* ==========================================================================
   * Fail
   * ======================================================================== */

  /**
   * Record a deterministic failure.
   *
   * IMPORTANT:
   *
   * FAILED means the logical operation produced a failure result. It does NOT
   * prove that an external financial side effect did not happen.
   *
   * For ambiguous external outcomes use markUnknown().
   */
  async fail(
    operationId,
    error,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    const status =
      normalizeStatus(
        current.status,
      );

    if (
      status ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.UNKNOWN
      &&
      this.options
        .protectUnknownOperations
      &&
      options.resolveUnknown !== true
    ) {
      throw new TransactionIdempotencyError(
        'An UNKNOWN idempotency operation cannot be converted directly to FAILED.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .UNKNOWN_OUTCOME,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,

          unknownOutcome:
            true,
        },
      );
    }

    if (
      !this._canTransition(
        status,
        IDEMPOTENCY_STATUS.FAILED,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot fail idempotency operation from ${status}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const failedAt =
      this._now();

    const sanitizedError =
      this._sanitizeError(
        error,
      );

    const errorFingerprint =
      sha256(
        sanitizedError,
      );

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .FAILED,

      error:
        sanitizedError,

      errorFingerprint,

      failedAt,

      leaseOwner:
        null,

      leaseExpiresAt:
        null,

      updatedAt:
        failedAt,

      stateVersion:
        current.stateVersion + 1,

      lastFailureCode:
        sanitizedError.code,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_FAILED',
      updated,
    );

    this._metric(
      'transaction_idempotency_failed_total',
      1,
      {
        operationType:
          current.operationType,
      },
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /* ==========================================================================
   * Unknown Outcome
   * ======================================================================== */

  /**
   * Mark an operation UNKNOWN.
   *
   * This method intentionally retains ownership of the idempotency identity.
   * It exists specifically to stop a caller from issuing a second external
   * financial operation after an ambiguous timeout/network failure.
   */
  async markUnknown(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    const status =
      normalizeStatus(
        current.status,
      );

    if (
      status ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      !this._canTransition(
        status,
        IDEMPOTENCY_STATUS.UNKNOWN,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot mark idempotency operation UNKNOWN from ${status}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const unknownAt =
      this._now();

    const reasonCode =
      normalizeString(
        options.reasonCode,
      ) ||
      IDEMPOTENCY_ERROR_CODES
        .UNKNOWN_OUTCOME;

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .UNKNOWN,

      unknownAt,

      unknownReasonCode:
        reasonCode,

      unknownReason:
        normalizeString(
          options.reason,
        ),

      unknownMetadata:
        this._sanitizeMetadata(
          options.metadata,
        ),

      leaseOwner:
        null,

      leaseExpiresAt:
        new Date(
          unknownAt.getTime() +
            this.options
              .unknownLeaseMs,
        ),

      updatedAt:
        unknownAt,

      stateVersion:
        current.stateVersion + 1,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_UNKNOWN',
      updated,
    );

    this._metric(
      'transaction_idempotency_unknown_total',
      1,
      {
        operationType:
          current.operationType,
      },
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /**
   * Alias used by recovery services.
   */
  async markAsUnknown(
    operationId,
    options = {},
  ) {
    return this.markUnknown(
      operationId,
      options,
    );
  }

  /* ==========================================================================
   * Resolve Unknown
   * ======================================================================== */

  /**
   * Resolve UNKNOWN to COMPLETED using authoritative evidence.
   *
   * This is deliberately separate from complete() so callers explicitly
   * acknowledge that they are resolving an ambiguous external outcome.
   */
  async resolveUnknownAsCompleted(
    operationId,
    result,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    if (
      normalizeStatus(
        current.status,
      ) !==
      IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      return this.complete(
        operationId,
        result,
        options,
      );
    }

    if (
      options.evidenceVerified !==
      true
    ) {
      throw new TransactionIdempotencyError(
        'UNKNOWN idempotency operation requires verified evidence before completion.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .UNKNOWN_OUTCOME,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,

          unknownOutcome:
            true,
        },
      );
    }

    return this._updateUnknownToCompleted(
      current,
      result,
      options,
    );
  }

  async _updateUnknownToCompleted(
    current,
    result,
    options,
  ) {
    const sanitizedResult =
      this._sanitizeResult(
        result,
      );

    const resultHash =
      this._buildResultHash(
        sanitizedResult,
      );

    const completedAt =
      this._now();

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .COMPLETED,

      result:
        sanitizedResult,

      resultHash,

      completedAt,

      resolvedUnknownAt:
        completedAt,

      resolutionCode:
        normalizeString(
          options.resolutionCode,
        ) ||
        'AUTHORITATIVE_EVIDENCE',

      resolutionEvidenceHash:
        normalizeString(
          options.evidenceHash,
        ) ||
        sha256(
          {
            resultHash,
            evidence:
              this._sanitizeMetadata(
                options.evidence,
              ),
          },
        ),

      leaseOwner:
        null,

      leaseExpiresAt:
        null,

      updatedAt:
        completedAt,

      stateVersion:
        current.stateVersion + 1,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_UNKNOWN_RESOLVED_COMPLETED',
      updated,
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /**
   * Resolve UNKNOWN to FAILED only after explicit verified evidence.
   */
  async resolveUnknownAsFailed(
    operationId,
    error,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    if (
      normalizeStatus(
        current.status,
      ) !==
      IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      return this.fail(
        operationId,
        error,
        options,
      );
    }

    if (
      options.evidenceVerified !==
      true
    ) {
      throw new TransactionIdempotencyError(
        'UNKNOWN idempotency operation requires verified evidence before failure resolution.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .UNKNOWN_OUTCOME,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,

          unknownOutcome:
            true,
        },
      );
    }

    const failedAt =
      this._now();

    const sanitizedError =
      this._sanitizeError(
        error,
      );

    const patch = {
      status:
        IDEMPOTENCY_STATUS
          .FAILED,

      error:
        sanitizedError,

      errorFingerprint:
        sha256(
          sanitizedError,
        ),

      failedAt,

      resolvedUnknownAt:
        failedAt,

      resolutionCode:
        normalizeString(
          options.resolutionCode,
        ) ||
        'AUTHORITATIVE_EVIDENCE',

      resolutionEvidenceHash:
        normalizeString(
          options.evidenceHash,
        ) ||
        sha256(
          {
            error:
              sanitizedError,

            evidence:
              this._sanitizeMetadata(
                options.evidence,
              ),
          },
        ),

      leaseOwner:
        null,

      leaseExpiresAt:
        null,

      updatedAt:
        failedAt,

      stateVersion:
        current.stateVersion + 1,
    };

    const updated =
      await this._updateWithVersion(
        current,
        patch,
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_UNKNOWN_RESOLVED_FAILED',
      updated,
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /* ==========================================================================
   * Lease Management
   * ======================================================================== */

  async renewLease(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    if (
      ![
        IDEMPOTENCY_STATUS
          .PROCESSING,
        IDEMPOTENCY_STATUS
          .UNKNOWN,
      ].includes(
        normalizeStatus(
          current.status,
        ),
      )
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency lease can only be renewed for PROCESSING or UNKNOWN operations.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .LEASE_EXPIRED,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const leaseMs =
      normalizeStatus(
        current.status,
      ) ===
      IDEMPOTENCY_STATUS.UNKNOWN
        ? this.options
            .unknownLeaseMs
        : Number(
            options.leaseMs ||
              this.options
                .processingLeaseMs,
          );

    const updated =
      await this._updateWithVersion(
        current,
        {
          leaseExpiresAt:
            new Date(
              this._now().getTime() +
                leaseMs,
            ),

          updatedAt:
            this._now(),

          stateVersion:
            current.stateVersion + 1,
        },
        options,
      );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  async release(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    const status =
      normalizeStatus(
        current.status,
      );

    if (
      ![
        IDEMPOTENCY_STATUS.RESERVED,
        IDEMPOTENCY_STATUS.EXPIRED,
        IDEMPOTENCY_STATUS.RELEASED,
      ].includes(
        status,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot release idempotency operation from ${status}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.RELEASED
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      !this.options.allowReuseAfterRelease
    ) {
      /**
       * RELEASED itself does not destroy the logical operation identity.
       * Reuse requires a new application-level operation decision, and the
       * repository should retain the original identity.
       */
    }

    const updated =
      await this._updateWithVersion(
        current,
        {
          status:
            IDEMPOTENCY_STATUS
              .RELEASED,

          releasedAt:
            this._now(),

          releaseReason:
            normalizeString(
              options.reason,
            ),

          leaseOwner:
            null,

          leaseExpiresAt:
            null,

          updatedAt:
            this._now(),

          stateVersion:
            current.stateVersion + 1,
        },
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_RELEASED',
      updated,
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  async cancel(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    this._assertLeaseOwner(
      current,
      options,
    );

    const status =
      normalizeStatus(
        current.status,
      );

    if (
      status ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return this._buildReservationResult(
        current,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      !this._canTransition(
        status,
        IDEMPOTENCY_STATUS
          .CANCELLED,
      )
    ) {
      throw new TransactionIdempotencyError(
        `Cannot cancel idempotency operation from ${status}.`,
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_STATE_TRANSITION,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const updated =
      await this._updateWithVersion(
        current,
        {
          status:
            IDEMPOTENCY_STATUS
              .CANCELLED,

          cancelledAt:
            this._now(),

          cancellationReason:
            normalizeString(
              options.reason,
            ),

          leaseOwner:
            null,

          leaseExpiresAt:
            null,

          updatedAt:
            this._now(),

          stateVersion:
            current.stateVersion + 1,
        },
        options,
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_CANCELLED',
      updated,
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /* ==========================================================================
   * Lookup APIs
   * ======================================================================== */

  async get(
    operationId,
    options = {},
  ) {
    return this._getByOperationId(
      operationId,
      options,
    );
  }

  async getByKey(
    input = {},
  ) {
    const request =
      this._normalizeReservationInput(
        input,
      );

    this._validateReservationInput(
      request,
      {
        allowMissingRequest:
          true,
      },
    );

    const identityKey =
      this.buildIdentityKey(
        request.tenantId,
        request.operationType,
        request.key,
      );

    const record =
      await this._findByIdentity(
        request,
        identityKey,
      );

    if (
      !record
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency record was not found.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .NOT_FOUND,

          statusCode:
            404,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          idempotencyKey:
            request.key,
        },
      );
    }

    return this._buildReservationResult(
      record,
      {
        replay:
          true,

        created:
          false,
      },
    );
  }

  async getExisting(
    input = {},
  ) {
    const request =
      this._normalizeReservationInput(
        input,
      );

    const identityKey =
      this.buildIdentityKey(
        request.tenantId,
        request.operationType,
        request.key,
      );

    const record =
      await this._findByIdentity(
        request,
        identityKey,
      );

    if (
      !record
    ) {
      return null;
    }

    return this._buildReservationResult(
      record,
      {
        replay:
          true,

        created:
          false,
      },
    );
  }

  /**
   * Convenience lookup for recovery services.
   */
  async findByOperationId(
    operationId,
    options = {},
  ) {
    return this._getByOperationId(
      operationId,
      options,
    );
  }

  /* ==========================================================================
   * Reuse / Retry
   * ======================================================================== */

  /**
   * Determine whether an existing operation may safely be retried.
   *
   * This method only answers policy. It does not execute anything.
   */
  canRetry(
    record,
    options = {},
  ) {
    if (
      !record
    ) {
      return {
        allowed:
          true,

        reason:
          'NO_EXISTING_OPERATION',
      };
    }

    const status =
      normalizeStatus(
        record.status,
      );

    switch (
      status
    ) {
      case IDEMPOTENCY_STATUS
        .COMPLETED:
        return {
          allowed:
            false,

          reason:
            'ALREADY_COMPLETED',

          replay:
            true,
        };

      case IDEMPOTENCY_STATUS
        .UNKNOWN:
        return {
          allowed:
            false,

          reason:
            'UNKNOWN_OUTCOME_REQUIRES_VERIFICATION',

          replay:
            false,
        };

      case IDEMPOTENCY_STATUS
        .PROCESSING:
        return {
          allowed:
            this._isLeaseExpired(
              record,
            ),

          reason:
            this._isLeaseExpired(
              record,
            )
              ? 'STALE_PROCESSING_LEASE'
              : 'PROCESSING',

          replay:
            false,
        };

      case IDEMPOTENCY_STATUS
        .FAILED:
        return {
          allowed:
            this.options
              .retryFailedOperation,

          reason:
            this.options
              .retryFailedOperation
              ? 'FAILED_RETRY_ALLOWED'
              : 'FAILED_RETRY_DISABLED',

          replay:
            false,
        };

      case IDEMPOTENCY_STATUS
        .EXPIRED:
      case IDEMPOTENCY_STATUS
        .RELEASED:
        return {
          allowed:
            this.options
              .allowReuseAfterRelease,

          reason:
            this.options
              .allowReuseAfterRelease
              ? 'REUSE_ALLOWED_BY_POLICY'
              : 'REUSE_DISABLED_BY_POLICY',

          replay:
            false,
        };

      case IDEMPOTENCY_STATUS
        .CANCELLED:
        return {
          allowed:
            false,

          reason:
            'CANCELLED',

          replay:
            false,
        };

      default:
        return {
          allowed:
            false,

          reason:
            'UNKNOWN_STATUS',

          replay:
            false,
        };
    }
  }

  /**
   * Return the canonical identity for a transaction operation.
   *
   * This is useful for recovery/financial posting callers that need a
   * deterministic secondary idempotency key.
   */
  buildIdentityKey(
    tenantId,
    operationType,
    idempotencyKey,
  ) {
    const tenant =
      normalizeString(
        tenantId,
      );

    const operation =
      normalizeOperationType(
        operationType,
      );

    const key =
      normalizeKey(
        idempotencyKey,
      );

    if (
      !tenant
    ) {
      throw new TransactionIdempotencyError(
        'Tenant ID is required to build an idempotency identity.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (
      !operation
    ) {
      throw new TransactionIdempotencyError(
        'Operation type is required to build an idempotency identity.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_TYPE_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (
      !key
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency key is required to build an idempotency identity.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    /**
     * Hash the public identity to avoid leaking customer-controlled keys into
     * logs, indexes, or URLs.
     */
    return sha256(
      [
        tenant,
        operation,
        key,
      ].join(':'),
    );
  }

  buildFinancialPostingKey(
    input = {},
  ) {
    const tenantId =
      normalizeString(
        input.tenantId,
      );

    const paymentId =
      safeId(
        input.paymentId,
      );

    const paymentReference =
      normalizeString(
        input.paymentReference,
      );

    if (
      !tenantId
    ) {
      throw new TransactionIdempotencyError(
        'Tenant ID is required to build a financial posting key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (
      !paymentId
      &&
      !paymentReference
    ) {
      throw new TransactionIdempotencyError(
        'Payment identity is required to build a financial posting key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    return [
      'financial-posting',
      tenantId,
      paymentId ||
        paymentReference,
    ].join(':');
  }

  buildRecoveryKey(
    input = {},
  ) {
    const tenantId =
      normalizeString(
        input.tenantId,
      );

    const transactionId =
      safeId(
        input.transactionId,
      );

    if (
      !tenantId
    ) {
      throw new TransactionIdempotencyError(
        'Tenant ID is required to build a recovery key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (
      !transactionId
    ) {
      throw new TransactionIdempotencyError(
        'Transaction ID is required to build a recovery key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    return [
      'transaction-recovery',
      tenantId,
      transactionId,
    ].join(':');
  }

  buildSettlementKey(
    input = {},
  ) {
    const tenantId =
      normalizeString(
        input.tenantId,
      );

    const transactionId =
      safeId(
        input.transactionId,
      );

    const paymentId =
      safeId(
        input.paymentId,
      );

    const identity =
      transactionId ||
      paymentId;

    if (
      !tenantId
    ) {
      throw new TransactionIdempotencyError(
        'Tenant ID is required to build a settlement key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            400,
        },
      );
    }

    if (
      !identity
    ) {
      throw new TransactionIdempotencyError(
        'Transaction or payment identity is required to build a settlement key.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    return [
      'settlement',
      tenantId,
      identity,
    ].join(':');
  }

  /* ==========================================================================
   * Administrative / Recovery APIs
   * ======================================================================== */

  /**
   * Expire stale operations.
   *
   * This method does not delete records.
   */
  async expireStale(
    input = {},
  ) {
    if (
      !this.repository
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency repository is unavailable.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,

          statusCode:
            503,
        },
      );
    }

    const nowDate =
      this._now();

    const threshold =
      new Date(
        nowDate.getTime() -
          Number(
            input.staleAfterMs ||
              this.options
                .staleRecordGraceMs,
          ),
      );

    if (
      typeof this.repository
        .expireStale !==
        'function'
    ) {
      return {
        matched:
          0,

        modified:
          0,
      };
    }

    const result =
      await this.repository
        .expireStale(
          {
            before:
              threshold,

            statuses: [
              IDEMPOTENCY_STATUS
                .PROCESSING,

              IDEMPOTENCY_STATUS
                .RESERVED,

              IDEMPOTENCY_STATUS
                .FAILED,
            ],

            tenantId:
              input.tenantId ||
              null,
          },
          {
            state:
              IDEMPOTENCY_STATUS
                .EXPIRED,

            updatedAt:
              nowDate,
          },
        );

    this._metric(
      'transaction_idempotency_expired_total',
      Number(
        result?.modified ||
          result?.count ||
          0,
      ),
    );

    return result;
  }

  /**
   * Safely claim an expired PROCESSING operation.
   *
   * This is a recovery-worker primitive.
   */
  async reclaimExpired(
    operationId,
    options = {},
  ) {
    const current =
      await this._getByOperationId(
        operationId,
        options,
      );

    if (
      !this._isLeaseExpired(
        current,
      )
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency operation lease has not expired.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .IN_PROGRESS,

          statusCode:
            409,

          tenantId:
            current.tenantId,

          operationType:
            current.operationType,

          idempotencyKey:
            current.idempotencyKey,

          operationId:
            current.operationId,
        },
      );
    }

    const owner =
      normalizeString(
        options.owner ||
        options.operationId,
      ) ||
      createOperationId(
        'recovery_worker',
      );

    const leaseMs =
      Number(
        options.leaseMs ||
        this.options.processingLeaseMs,
      );

    const updated =
      await this._updateWithVersion(
        current,
        {
          status:
            IDEMPOTENCY_STATUS
              .PROCESSING,

          leaseOwner:
            owner,

          leaseExpiresAt:
            new Date(
              this._now().getTime() +
                leaseMs,
            ),

          stateVersion:
            current.stateVersion + 1,

          attemptCount:
            current.attemptCount + 1,

          recoveredFromStaleLease:
            true,

          recoveredAt:
            this._now(),

          updatedAt:
            this._now(),
        },
        {
          ...options,
          owner,
          operationId:
            owner,
          allowStaleLeaseReclaim:
            true,
        },
      );

    await this._recordAudit(
      'TRANSACTION_IDEMPOTENCY_STALE_LEASE_RECLAIMED',
      updated,
    );

    this._metric(
      'transaction_idempotency_stale_lease_reclaimed_total',
      1,
      {
        operationType:
          current.operationType,
      },
    );

    return this._buildReservationResult(
      updated,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  /* ==========================================================================
   * Repository Layer
   * ======================================================================== */

  async _findByIdentity(
    request,
    identityKey,
  ) {
    if (
      typeof this.repository
        .findByIdentityKey ===
        'function'
    ) {
      const record =
        await this.repository
          .findByIdentityKey(
            {
              identityKey,
              tenantId:
                request.tenantId,
              operationType:
                request.operationType,
            },
          );

      return record
        ? this._normalizeRecord(
            record,
          )
        : null;
    }

    if (
      typeof this.repository
        .findByKey ===
        'function'
    ) {
      const record =
        await this.repository
          .findByKey(
            {
              tenantId:
                request.tenantId,

              operationType:
                request.operationType,

              idempotencyKey:
                request.key,
            },
          );

      return record
        ? this._normalizeRecord(
            record,
          )
        : null;
    }

    if (
      typeof this.repository
        .findOne ===
        'function'
    ) {
      const record =
        await this.repository
          .findOne(
            {
              identityKey,
              tenantId:
                request.tenantId,
              operationType:
                request.operationType,
              idempotencyKey:
                request.key,
            },
          );

      return record
        ? this._normalizeRecord(
            record,
          )
        : null;
    }

    throw new TransactionIdempotencyError(
      'Idempotency repository does not implement a supported lookup API.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .STORAGE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          request.tenantId,

        operationType:
          request.operationType,

        idempotencyKey:
          request.key,
      },
    );
  }

  async _getByOperationId(
    operationId,
    options = {},
  ) {
    const id =
      safeId(
        operationId,
      );

    if (
      !id
    ) {
      throw new TransactionIdempotencyError(
        'Operation ID is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    if (
      !this.repository
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency repository is unavailable.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,

          statusCode:
            503,
        },
      );
    }

    let record =
      null;

    if (
      typeof this.repository
        .findByOperationId ===
        'function'
    ) {
      record =
        await this.repository
          .findByOperationId(
            id,
            {
              tenantId:
                options.tenantId ||
                null,
            },
          );
    } else if (
      typeof this.repository
        .getByOperationId ===
        'function'
    ) {
      record =
        await this.repository
          .getByOperationId(
            id,
            {
              tenantId:
                options.tenantId ||
                null,
            },
          );
    } else if (
      typeof this.repository
        .findOne ===
        'function'
    ) {
      record =
        await this.repository
          .findOne(
            {
              operationId:
                id,

              tenantId:
                options.tenantId ||
                undefined,
            },
          );
    } else {
      throw new TransactionIdempotencyError(
        'Idempotency repository does not implement operation lookup.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,

          statusCode:
            500,

          operationId:
            id,
        },
      );
    }

    if (
      !record
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency operation was not found.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .NOT_FOUND,

          statusCode:
            404,

          operationId:
            id,

          tenantId:
            options.tenantId ||
            null,
        },
      );
    }

    return this._normalizeRecord(
      record,
    );
  }

  async _createRecord(
    record,
  ) {
    if (
      typeof this.repository
        .createIfAbsent ===
        'function'
    ) {
      return this.repository
        .createIfAbsent(
          record,
        );
    }

    if (
      typeof this.repository
        .insertIfAbsent ===
        'function'
    ) {
      return this.repository
        .insertIfAbsent(
          record,
        );
    }

    if (
      typeof this.repository
        .create ===
        'function'
    ) {
      return this.repository
        .create(
          record,
        );
    }

    if (
      typeof this.repository
        .insert ===
        'function'
    ) {
      return this.repository
        .insert(
          record,
        );
    }

    throw new TransactionIdempotencyError(
      'Idempotency repository does not implement a supported create API.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .STORAGE_UNAVAILABLE,

        statusCode:
          500,
      },
    );
  }

  async _updateWithVersion(
    current,
    patch,
    options = {},
  ) {
    const expectedVersion =
      parseVersion(
        current.stateVersion,
      ) ??
      0;

    const mergedPatch = {
      ...patch,

      stateVersion:
        patch.stateVersion ??
        expectedVersion + 1,
    };

    if (
      typeof this.repository
        .updateWithVersion ===
        'function'
    ) {
      const updated =
        await this.repository
          .updateWithVersion(
            current.operationId ||
              current.id,
            expectedVersion,
            mergedPatch,
            {
              tenantId:
                current.tenantId,

              expectedStatus:
                current.status,

              owner:
                options.owner ||
                options.operationId ||
                null,

              allowStaleLeaseReclaim:
                options
                  .allowStaleLeaseReclaim ===
                true,
            },
          );

      if (
        !updated
      ) {
        throw new TransactionIdempotencyError(
          'Idempotency operation was modified concurrently.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            tenantId:
              current.tenantId,

            operationType:
              current.operationType,

            idempotencyKey:
              current.idempotencyKey,

            operationId:
              current.operationId,
          },
        );
      }

      return this._normalizeRecord(
        updated,
      );
    }

    if (
      typeof this.repository
        .compareAndSet ===
        'function'
    ) {
      const updated =
        await this.repository
          .compareAndSet(
            {
              operationId:
                current.operationId ||
                current.id,

              expectedVersion,

              expectedStatus:
                current.status,
            },
            mergedPatch,
            {
              tenantId:
                current.tenantId,

              owner:
                options.owner ||
                options.operationId ||
                null,

              allowStaleLeaseReclaim:
                options
                  .allowStaleLeaseReclaim ===
                true,
            },
          );

      if (
        !updated
      ) {
        throw new TransactionIdempotencyError(
          'Idempotency operation was modified concurrently.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            tenantId:
              current.tenantId,

            operationType:
              current.operationType,

            idempotencyKey:
              current.idempotencyKey,

            operationId:
              current.operationId,
          },
        );
      }

      return this._normalizeRecord(
        updated,
      );
    }

    if (
      typeof this.repository
        .update ===
        'function'
    ) {
      if (
        this.options.strictMode
      ) {
        throw new TransactionIdempotencyError(
          'Atomic versioned idempotency updates are required in strict mode.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .STORAGE_UNAVAILABLE,

            statusCode:
              500,

            tenantId:
              current.tenantId,

            operationType:
              current.operationType,

            idempotencyKey:
              current.idempotencyKey,

            operationId:
              current.operationId,
          },
        );
      }

      const updated =
        await this.repository
          .update(
            current.operationId ||
              current.id,
            mergedPatch,
            {
              tenantId:
                current.tenantId,
            },
          );

      return this._normalizeRecord(
        updated ||
          {
            ...current,
            ...mergedPatch,
          },
      );
    }

    throw new TransactionIdempotencyError(
      'Idempotency repository does not implement an atomic update API.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .STORAGE_UNAVAILABLE,

        statusCode:
          500,

        tenantId:
          current.tenantId,

        operationType:
          current.operationType,

        idempotencyKey:
          current.idempotencyKey,

        operationId:
          current.operationId,
      },
    );
  }

  /* ==========================================================================
   * Reservation Logic
   * ======================================================================== */

  async _handleExistingReservation(
    existing,
    request,
    requestFingerprint,
  ) {
    const record =
      this._normalizeRecord(
        existing,
      );

    if (
      this.options
        .enforceRequestFingerprint
      &&
      record.requestFingerprint
      &&
      record.requestFingerprint !==
        requestFingerprint
    ) {
      if (
        this.options
          .failOnKeyReuse
      ) {
        throw new TransactionIdempotencyError(
          'The idempotency key has already been used with a different request payload.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .KEY_REUSE,

            statusCode:
              409,

            tenantId:
              request.tenantId,

            operationType:
              request.operationType,

            idempotencyKey:
              request.key,

            operationId:
              record.operationId,

            transactionId:
              record.transactionId,

            paymentId:
              record.paymentId,

            details: {
              existingFingerprint:
                record.requestFingerprint,

              attemptedFingerprint:
                requestFingerprint,
            },
          },
        );
      }
    }

    const status =
      normalizeStatus(
        record.status,
      );

    if (
      status ===
      IDEMPOTENCY_STATUS.COMPLETED
    ) {
      this._metric(
        'transaction_idempotency_replay_total',
        1,
        {
          operationType:
            record.operationType,
        },
      );

      return this._buildReservationResult(
        record,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      this._metric(
        'transaction_idempotency_unknown_replay_total',
        1,
        {
          operationType:
            record.operationType,
        },
      );

      return this._buildReservationResult(
        record,
        {
          replay:
            true,

          created:
            false,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.PROCESSING
      &&
      !this._isLeaseExpired(
        record,
      )
    ) {
      return this._buildReservationResult(
        record,
        {
          replay:
            false,

          created:
            false,

          inProgress:
            true,
        },
      );
    }

    if (
      status ===
        IDEMPOTENCY_STATUS.FAILED
      &&
      this.options
        .retryFailedOperation
    ) {
      return this._buildReservationResult(
        record,
        {
          replay:
            false,

          created:
            false,

          retryable:
            true,
        },
      );
    }

    if (
      status ===
      IDEMPOTENCY_STATUS.EXPIRED
    ) {
      return this._buildReservationResult(
        record,
        {
          replay:
            false,

          created:
            false,

          expired:
            true,
        },
      );
    }

    return this._buildReservationResult(
      record,
      {
        replay:
          false,

        created:
          false,
      },
    );
  }

  _buildInitialRecord(
    request,
    requestFingerprint,
    identityKey,
    operationId,
  ) {
    const createdAt =
      this._now();

    return {
      operationId,

      id:
        operationId,

      tenantId:
        request.tenantId,

      operationType:
        request.operationType,

      idempotencyKey:
        request.key,

      identityKey,

      requestFingerprint,

      status:
        IDEMPOTENCY_STATUS.RESERVED,

      result:
        null,

      resultHash:
        null,

      error:
        null,

      errorFingerprint:
        null,

      request:
        this._sanitizeRequestSnapshot(
          request.request,
        ),

      metadata:
        this.options.retainMetadata
          ? this._sanitizeMetadata(
              request.metadata,
            )
          : {},

      transactionId:
        request.transactionId ||
        null,

      paymentId:
        request.paymentId ||
        null,

      paymentReference:
        request.paymentReference ||
        null,

      provider:
        request.provider ||
        null,

      providerTransactionId:
        request.providerTransactionId ||
        null,

      leaseOwner:
        null,

      leaseExpiresAt:
        new Date(
          createdAt.getTime() +
            this.options
              .reservationLeaseMs,
        ),

      attemptCount:
        0,

      stateVersion:
        0,

      recoveryCount:
        0,

      createdAt,

      updatedAt:
        createdAt,

      completedAt:
        null,

      failedAt:
        null,

      unknownAt:
        null,

      releasedAt:
        null,

      cancelledAt:
        null,
    };
  }

  _buildReservationResult(
    record,
    options = {},
  ) {
    const normalized =
      this._normalizeRecord(
        record,
      );

    return {
      success:
        true,

      operationId:
        normalized.operationId,

      status:
        normalized.status,

      tenantId:
        normalized.tenantId,

      operationType:
        normalized.operationType,

      idempotencyKey:
        normalized.idempotencyKey,

      identityKey:
        normalized.identityKey,

      requestFingerprint:
        normalized.requestFingerprint,

      replay:
        options.replay === true,

      created:
        options.created === true,

      inProgress:
        options.inProgress === true,

      retryable:
        options.retryable === true,

      expired:
        options.expired === true,

      completed:
        normalized.status ===
        IDEMPOTENCY_STATUS.COMPLETED,

      unknown:
        normalized.status ===
        IDEMPOTENCY_STATUS.UNKNOWN,

      result:
        normalized.result,

      error:
        normalized.error,

      transactionId:
        normalized.transactionId,

      paymentId:
        normalized.paymentId,

      paymentReference:
        normalized.paymentReference,

      provider:
        normalized.provider,

      providerTransactionId:
        normalized.providerTransactionId,

      stateVersion:
        normalized.stateVersion,

      attemptCount:
        normalized.attemptCount,

      leaseOwner:
        normalized.leaseOwner,

      leaseExpiresAt:
        normalized.leaseExpiresAt,

      createdAt:
        normalized.createdAt,

      updatedAt:
        normalized.updatedAt,

      completedAt:
        normalized.completedAt,

      failedAt:
        normalized.failedAt,

      unknownAt:
        normalized.unknownAt,
    };
  }

  /* ==========================================================================
   * Validation
   * ======================================================================== */

  _normalizeReservationInput(
    input,
  ) {
    const request =
      input &&
      typeof input ===
        'object'
        ? input
        : {};

    return {
      tenantId:
        normalizeString(
          request.tenantId,
        ),

      operationType:
        normalizeOperationType(
          request.operationType ||
            request.type,
        ),

      key:
        normalizeKey(
          request.key ||
            request.idempotencyKey,
        ),

      operationId:
        safeId(
          request.operationId,
        ),

      transactionId:
        safeId(
          request.transactionId,
        ),

      paymentId:
        safeId(
          request.paymentId,
        ),

      paymentReference:
        normalizeString(
          request.paymentReference,
        ),

      provider:
        normalizeString(
          request.provider,
        )?.toLowerCase(),

      providerTransactionId:
        normalizeString(
          request.providerTransactionId,
        ),

      request:
        request.request ??
        request.payload ??
        request.body ??
        {},

      metadata:
        request.metadata ??
        {},

      idempotencyKey:
        normalizeKey(
          request.idempotencyKey ||
            request.key,
        ),
    };
  }

  _validateReservationInput(
    request,
    options = {},
  ) {
    if (
      this.options.requireTenant
      && !request.tenantId
    ) {
      throw new TransactionIdempotencyError(
        'Tenant ID is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options
        .requireOperationType
      && !request.operationType
    ) {
      throw new TransactionIdempotencyError(
        'Operation type is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_TYPE_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,
        },
      );
    }

    if (
      request.operationType
      && !this._isKnownOperationType(
        request.operationType,
      )
    ) {
      /**
       * Forward compatibility is allowed when the repository/domain introduces
       * a new operation type. Strict mode still requires it to be a safe,
       * syntactically valid operation name.
       */
      if (
        !/^[A-Z][A-Z0-9_]{1,99}$/.test(
          request.operationType,
        )
      ) {
        throw new TransactionIdempotencyError(
          'Invalid operation type.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .INVALID_OPERATION_TYPE,

            statusCode:
              400,

            operationType:
              request.operationType,

            tenantId:
              request.tenantId,
          },
        );
      }
    }

    if (
      this.options
        .requireIdempotencyKey
      && !request.key
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency key is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_REQUIRED,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,
        },
      );
    }

    if (
      request.key
      &&
      request.key.length >
        this.options.maxKeyLength
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency key is too long.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_TOO_LONG,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,
        },
      );
    }

    if (
      request.key
      &&
      request.key.length <
        this.options.minKeyLength
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency key is too short.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_KEY,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,
        },
      );
    }

    if (
      request.key
      &&
      !/^[A-Za-z0-9._~:/-]+$/.test(
        request.key,
      )
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency key contains unsupported characters.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_KEY,

          statusCode:
            400,

          tenantId:
            request.tenantId,

          operationType:
            request.operationType,
        },
      );
    }

    return true;
  }

  _isKnownOperationType(
    operationType,
  ) {
    return Object.values(
      IDEMPOTENCY_OPERATION_TYPES,
    ).includes(
      operationType,
    );
  }

  /* ==========================================================================
   * Fingerprints
   * ======================================================================== */

  _buildRequestFingerprint(
    request,
  ) {
    const canonicalRequest =
      this._sanitizeRequestSnapshot(
        request.request,
      );

    if (
      !canonicalRequest
    ) {
      return sha256(
        {
          tenantId:
            request.tenantId,

          operationType:
            request.operationType,

          emptyRequest:
            true,
        },
      );
    }

    return sha256(
      {
        tenantId:
          request.tenantId,

        operationType:
          request.operationType,

        request:
          canonicalRequest,
      },
    );
  }

  _buildResultHash(
    result,
  ) {
    return sha256(
      this._sanitizeResult(
        result,
      ),
    );
  }

  _sanitizeRequestSnapshot(
    request,
  ) {
    return this._sanitizeMetadata(
      request,
    );
  }

  _sanitizeResult(
    result,
  ) {
    if (
      result === undefined ||
      result === null
    ) {
      return null;
    }

    return this._sanitizeMetadata(
      result,
    );
  }

  _sanitizeError(
    error,
  ) {
    if (
      !error
    ) {
      return {
        code:
          'UNKNOWN_ERROR',

        message:
          'Unknown idempotency failure.',

        retryable:
          false,

        unknownOutcome:
          false,
      };
    }

    return {
      name:
        normalizeString(
          error.name,
        ),

      code:
        normalizeString(
          error.code,
        ) ||
        'TRANSACTION_OPERATION_FAILED',

      message:
        String(
          error.message ||
            'Transaction operation failed.',
        ).slice(
          0,
          1000,
        ),

      statusCode:
        Number.isInteger(
          error.statusCode,
        )
          ? error.statusCode
          : null,

      retryable:
        error.retryable ===
        true,

      unknownOutcome:
        error.unknownOutcome ===
        true,

      reconciliationRequired:
        error.reconciliationRequired ===
        true,

      details:
        this._sanitizeMetadata(
          error.details,
        ),
    };
  }

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata !==
        'object'
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
        'rawAuthorizationHeader',
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawBody',
        'encryptedSecret',
        'pin',
        'otp',
        'passcode',
      ]);

    const sanitize =
      (value, depth = 0) => {
        if (
          depth >
          this.options
            .maxMetadataDepth
        ) {
          return '[MAX_DEPTH]';
        }

        if (
          value === null ||
          value === undefined
        ) {
          return value;
        }

        if (
          typeof value ===
            'string'
        ) {
          return value.length >
            this.options
              .maxMetadataStringLength
            ? `${value.slice(
                0,
                this.options
                  .maxMetadataStringLength,
              )}...`
            : value;
        }

        if (
          typeof value ===
            'number'
          ||
          typeof value ===
            'boolean'
        ) {
          return value;
        }

        if (
          value instanceof Date
        ) {
          return value.toISOString();
        }

        if (
          Array.isArray(value)
        ) {
          return value
            .slice(
              0,
              this.options
                .maxMetadataKeys,
            )
            .map(
              (item) =>
                sanitize(
                  item,
                  depth + 1,
                ),
            );
        }

        if (
          typeof value !==
            'object'
        ) {
          return String(
            value,
          );
        }

        const output = {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          ).slice(
            0,
            this.options
              .maxMetadataKeys,
          )
        ) {
          if (
            sensitiveKeys.has(
              key,
            )
          ) {
            output[key] =
              '[REDACTED]';

            continue;
          }

          output[key] =
            sanitize(
              child,
              depth + 1,
            );
        }

        return output;
      };

    return sanitize(
      metadata,
    );
  }

  /* ==========================================================================
   * Record Normalization
   * ======================================================================== */

  _normalizeRecord(
    record,
  ) {
    const plain =
      record &&
      typeof record ===
        'object'
        ? (
            typeof record.toObject ===
              'function'
              ? record.toObject()
              : record
          )
        : {};

    const operationId =
      safeId(
        plain.operationId ||
        plain.id ||
        plain._id,
      );

    return {
      ...clone(
        plain,
      ),

      operationId:
        operationId ||
        createOperationId(
          'txn_op',
        ),

      id:
        safeId(
          plain.id ||
          plain._id ||
          operationId,
        ) ||
        operationId,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      operationType:
        normalizeOperationType(
          plain.operationType ||
          plain.type,
        ),

      idempotencyKey:
        normalizeKey(
          plain.idempotencyKey ||
          plain.key,
        ),

      identityKey:
        normalizeString(
          plain.identityKey,
        ),

      requestFingerprint:
        normalizeString(
          plain.requestFingerprint,
        ),

      status:
        normalizeStatus(
          plain.status,
        ) ||
        IDEMPOTENCY_STATUS
          .RESERVED,

      result:
        clone(
          plain.result,
        ),

      resultHash:
        normalizeString(
          plain.resultHash,
        ),

      error:
        clone(
          plain.error,
        ),

      errorFingerprint:
        normalizeString(
          plain.errorFingerprint,
        ),

      request:
        clone(
          plain.request,
        ),

      metadata:
        this._sanitizeMetadata(
          plain.metadata,
        ),

      transactionId:
        safeId(
          plain.transactionId,
        ),

      paymentId:
        safeId(
          plain.paymentId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference,
        ),

      provider:
        normalizeString(
          plain.provider,
        )?.toLowerCase(),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      leaseOwner:
        normalizeString(
          plain.leaseOwner,
        ),

      leaseExpiresAt:
        parseDate(
          plain.leaseExpiresAt,
        ),

      stateVersion:
        parseVersion(
          plain.stateVersion,
        ) ??
        0,

      attemptCount:
        Number(
          plain.attemptCount ||
            0,
        ),

      recoveryCount:
        Number(
          plain.recoveryCount ||
            0,
        ),

      createdAt:
        parseDate(
          plain.createdAt,
        ),

      updatedAt:
        parseDate(
          plain.updatedAt,
        ),

      processingStartedAt:
        parseDate(
          plain.processingStartedAt,
        ),

      completedAt:
        parseDate(
          plain.completedAt,
        ),

      failedAt:
        parseDate(
          plain.failedAt,
        ),

      unknownAt:
        parseDate(
          plain.unknownAt,
        ),

      releasedAt:
        parseDate(
          plain.releasedAt,
        ),

      cancelledAt:
        parseDate(
          plain.cancelledAt,
        ),
    };
  }

  /* ==========================================================================
   * State / Lease Validation
   * ======================================================================== */

  _canTransition(
    currentStatus,
    targetStatus,
  ) {
    const allowed =
      STATUS_TRANSITIONS[
        currentStatus
      ] || [];

    return allowed.includes(
      targetStatus,
    );
  }

  _isLeaseExpired(
    record,
  ) {
    if (
      !record?.leaseExpiresAt
    ) {
      return true;
    }

    const expiresAt =
      parseDate(
        record.leaseExpiresAt,
      );

    if (
      !expiresAt
    ) {
      return true;
    }

    return (
      expiresAt.getTime() <=
      this._now().getTime()
    );
  }

  _assertOwnershipContext(
    record,
    options,
  ) {
    if (
      options.tenantId
      && record.tenantId
      && options.tenantId !==
        record.tenantId
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency operation does not belong to the current tenant.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .CONFLICT,

          statusCode:
            403,

          tenantId:
            options.tenantId,

          operationType:
            record.operationType,

          idempotencyKey:
            record.idempotencyKey,

          operationId:
            record.operationId,
        },
      );
    }
  }

  _assertLeaseOwner(
    record,
    options,
  ) {
    this._assertOwnershipContext(
      record,
      options,
    );

    const owner =
      normalizeString(
        options.owner ||
        options.operationId,
      );

    if (
      !owner
    ) {
      /**
       * For backward compatibility some internal callers only provide the
       * operationId itself. It is used as the implicit owner.
       */
      return;
    }

    if (
      record.leaseOwner
      &&
      record.leaseOwner !==
        owner
      &&
      !this._isLeaseExpired(
        record,
      )
    ) {
      throw new TransactionIdempotencyError(
        'Idempotency lease is owned by another worker.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .LEASE_LOST,

          statusCode:
            409,

          tenantId:
            record.tenantId,

          operationType:
            record.operationType,

          idempotencyKey:
            record.idempotencyKey,

          operationId:
            record.operationId,
        },
      );
    }

    if (
      record.leaseExpiresAt
      &&
      !this._isLeaseExpired(
        record,
      )
      &&
      record.leaseOwner ===
        owner
    ) {
      return;
    }

    /**
     * COMPLETED does not need an active lease for replay-safe reads. The
     * mutation methods handle terminal-state immutability separately.
     */
  }

  _claimExpiredProcessing(
    current,
    options,
  ) {
    return this.reclaimExpired(
      current.operationId,
      {
        ...options,

        allowStaleLeaseReclaim:
          true,
      },
    );
  }

  /* ==========================================================================
   * Time / Metrics / Audit
   * ======================================================================== */

  _now() {
    try {
      const value =
        typeof this.clock.now ===
          'function'
          ? this.clock.now()
          : new this.clock();

      return value instanceof Date
        ? value
        : new Date(
            value,
          );
    } catch (_error) {
      return new Date();
    }
  }

  async _recordAudit(
    action,
    record,
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload = {
      action,

      tenantId:
        record.tenantId,

      resourceType:
        'TransactionIdempotency',

      resourceId:
        record.operationId,

      operationId:
        record.operationId,

      operationType:
        record.operationType,

      idempotencyKeyHash:
        record.identityKey,

      transactionId:
        record.transactionId,

      paymentId:
        record.paymentId,

      status:
        record.status,

      stateVersion:
        record.stateVersion,

      attemptCount:
        record.attemptCount,

      createdAt:
        isoNow(),
    };

    try {
      if (
        typeof this.auditService
          .record ===
          'function'
      ) {
        return this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create ===
          'function'
      ) {
        return this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to record transaction idempotency audit event.',
        error,
        {
          operationId:
            record.operationId,

          tenantId:
            record.tenantId,

          action,
        },
      );
    }

    return null;
  }

  _metric(
    name,
    value,
    labels = {},
  ) {
    try {
      if (
        !this.metrics
      ) {
        return;
      }

      if (
        typeof this.metrics
          .increment ===
          'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc ===
          'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      /**
       * Metrics must never affect transaction correctness.
       */
    }
  }

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        &&
        typeof this.logger.error ===
          'function'
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

            ...this._sanitizeMetadata(
              metadata,
            ),
          },
        );
      }
    } catch (_loggingError) {
      // Never mask idempotency errors with logging failures.
    }
  }

  /* ==========================================================================
   * Error Handling
   * ======================================================================== */

  _wrapStorageError(
    error,
    request,
  ) {
    return new TransactionIdempotencyError(
      error?.message ||
        'Transaction idempotency storage operation failed.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .STORAGE_UNAVAILABLE,

        statusCode:
          Number(
            error?.statusCode,
          ) || 503,

        tenantId:
          request.tenantId,

        operationType:
          request.operationType,

        idempotencyKey:
          request.key,

        retryable:
          true,

        cause:
          error,
      },
    );
  }

  _isDuplicateError(
    error,
  ) {
    if (
      !error
    ) {
      return false;
    }

    const code =
      String(
        error.code ||
          '',
      ).toUpperCase();

    const message =
      String(
        error.message ||
          '',
      ).toLowerCase();

    return (
      [
        'E11000',
        'DUPLICATE_KEY',
        'DUPLICATE_ENTRY',
        'UNIQUE_CONSTRAINT',
      ].includes(
        code,
      )
      ||
      message.includes(
        'duplicate key',
      )
      ||
      message.includes(
        'already exists',
      )
    );
  }

  /* ==========================================================================
   * Diagnostics / Configuration
   * ======================================================================== */

  getStatuses() {
    return Object.freeze({
      ...IDEMPOTENCY_STATUS,
    });
  }

  getOperationTypes() {
    return Object.freeze({
      ...IDEMPOTENCY_OPERATION_TYPES,
    });
  }

  getTransitions() {
    return Object.freeze({
      ...STATUS_TRANSITIONS,
    });
  }

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireTenant:
        this.options.requireTenant,

      requireOperationType:
        this.options
          .requireOperationType,

      requireIdempotencyKey:
        this.options
          .requireIdempotencyKey,

      reservationLeaseMs:
        this.options
          .reservationLeaseMs,

      processingLeaseMs:
        this.options
          .processingLeaseMs,

      unknownLeaseMs:
        this.options
          .unknownLeaseMs,

      retainTerminalRecords:
        this.options
          .retainTerminalRecords,

      allowReuseAfterFailure:
        this.options
          .allowReuseAfterFailure,

      allowReuseAfterRelease:
        this.options
          .allowReuseAfterRelease,

      retryFailedOperation:
        this.options
          .retryFailedOperation,

      protectUnknownOperations:
        this.options
          .protectUnknownOperations,

      enforceRequestFingerprint:
        this.options
          .enforceRequestFingerprint,

      failOnKeyReuse:
        this.options
          .failOnKeyReuse,

      enforceResultImmutability:
        this.options
          .enforceResultImmutability,

      hasRepository:
        Boolean(
          this.repository,
        ),

      hasAuditService:
        Boolean(
          this.auditService,
        ),

      hasMetrics:
        Boolean(
          this.metrics,
        ),
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      this.options.strictMode
      && !this.repository
    ) {
      errors.push(
        'Idempotency repository is required in strict mode.',
      );
    }

    if (
      this.options
        .reservationLeaseMs <= 0
    ) {
      errors.push(
        'reservationLeaseMs must be greater than zero.',
      );
    }

    if (
      this.options
        .processingLeaseMs <= 0
    ) {
      errors.push(
        'processingLeaseMs must be greater than zero.',
      );
    }

    if (
      this.options
        .unknownLeaseMs <= 0
    ) {
      errors.push(
        'unknownLeaseMs must be greater than zero.',
      );
    }

    if (
      this.options.minKeyLength <= 0
    ) {
      errors.push(
        'minKeyLength must be greater than zero.',
      );
    }

    if (
      this.options.maxKeyLength <
        this.options.minKeyLength
    ) {
      errors.push(
        'maxKeyLength must be greater than or equal to minKeyLength.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

TransactionIdempotencyService.STATUS =
  IDEMPOTENCY_STATUS;

TransactionIdempotencyService.STATUSES =
  IDEMPOTENCY_STATUS;

TransactionIdempotencyService.OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

TransactionIdempotencyService.ERROR_CODES =
  IDEMPOTENCY_ERROR_CODES;

TransactionIdempotencyService.TRANSITIONS =
  STATUS_TRANSITIONS;

TransactionIdempotencyService.TransactionIdempotencyError =
  TransactionIdempotencyError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createTransactionIdempotencyService(
  dependencies = {},
) {
  return new TransactionIdempotencyService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  TransactionIdempotencyService;

module.exports.TransactionIdempotencyService =
  TransactionIdempotencyService;

module.exports.TransactionIdempotencyError =
  TransactionIdempotencyError;

module.exports.createTransactionIdempotencyService =
  createTransactionIdempotencyService;

module.exports.IDEMPOTENCY_STATUS =
  IDEMPOTENCY_STATUS;

module.exports.IDEMPOTENCY_STATUSES =
  IDEMPOTENCY_STATUS;

module.exports.IDEMPOTENCY_OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

module.exports.IDEMPOTENCY_ERROR_CODES =
  IDEMPOTENCY_ERROR_CODES;

module.exports.IDEMPOTENCY_TRANSITIONS =
  STATUS_TRANSITIONS;

/* ============================================================================
 * End of File
 * ============================================================================
 */