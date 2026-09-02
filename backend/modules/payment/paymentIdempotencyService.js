'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Idempotency Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/paymentIdempotencyService.js
 *
 * Purpose:
 *   Provides a centralized, production-grade idempotency boundary for payment
 *   operations across:
 *
 *     - Payment API requests
 *     - MTN MoMo operations
 *     - Airtel Money operations
 *     - Provider callbacks
 *     - Payment retries
 *     - Financial posting
 *     - Refunds
 *     - Withdrawals
 *     - Loan repayments
 *     - Loan disbursements
 *     - Contributions
 *     - Settlement processing
 *     - Reconciliation repair
 *
 * Core Principle
 * ----------------------------------------------------------------------------
 * A logically identical payment operation must produce at most one externally
 * observable financial side effect.
 *
 * Idempotency is NOT the same as:
 *
 *   - authentication
 *   - authorization
 *   - callback signature verification
 *   - transaction state validation
 *   - database transactions
 *   - ledger balancing
 *
 * All of those controls remain independently required.
 *
 * Enterprise Guarantees
 * ----------------------------------------------------------------------------
 * 1. Tenant-scoped idempotency.
 * 2. Deterministic request fingerprinting.
 * 3. Duplicate request detection.
 * 4. Same-key/different-request conflict detection.
 * 5. Concurrent request protection.
 * 6. Durable operation lifecycle support.
 * 7. Provider callback deduplication.
 * 8. In-flight operation recovery.
 * 9. Safe result replay.
 * 10. Bounded expiration/retention support.
 * 11. No secrets in fingerprints or logs.
 * 12. Provider-reference collision detection.
 * 13. Financial-posting idempotency support.
 * 14. Safe recovery after process crashes.
 * 15. Integration with existing repository/model layers without forcing a
 *     particular persistence implementation.
 *
 * Important
 * ----------------------------------------------------------------------------
 * This service does NOT:
 *
 *   - mutate account balances
 *   - create journal entries directly
 *   - bypass PaymentStateMachine
 *   - bypass FinancialTransaction/PostingEngine
 *   - authenticate provider signatures
 *   - decide whether a provider callback is genuine
 *
 * It only protects operation identity and duplicate execution.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const IDEMPOTENCY_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  EXPIRED: 'EXPIRED',
  RELEASED: 'RELEASED',
});

const IDEMPOTENCY_OPERATION_TYPES = Object.freeze({
  PAYMENT_CREATE: 'PAYMENT_CREATE',
  PAYMENT_PROCESS: 'PAYMENT_PROCESS',
  PAYMENT_CALLBACK: 'PAYMENT_CALLBACK',
  PAYMENT_STATUS_RECOVERY: 'PAYMENT_STATUS_RECOVERY',
  PAYMENT_REVERSAL: 'PAYMENT_REVERSAL',
  PAYMENT_REFUND: 'PAYMENT_REFUND',
  PAYMENT_WITHDRAWAL: 'PAYMENT_WITHDRAWAL',
  PAYMENT_TRANSFER: 'PAYMENT_TRANSFER',
  PAYMENT_CONTRIBUTION: 'PAYMENT_CONTRIBUTION',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  SETTLEMENT: 'SETTLEMENT',
  FINANCIAL_POSTING: 'FINANCIAL_POSTING',
  RECONCILIATION_REPAIR: 'RECONCILIATION_REPAIR',
  OTHER: 'OTHER',
});

const IDEMPOTENCY_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'INVALID_IDEMPOTENCY_REQUEST',

  TENANT_REQUIRED:
    'IDEMPOTENCY_TENANT_REQUIRED',

  KEY_REQUIRED:
    'IDEMPOTENCY_KEY_REQUIRED',

  KEY_INVALID:
    'IDEMPOTENCY_KEY_INVALID',

  OPERATION_TYPE_REQUIRED:
    'IDEMPOTENCY_OPERATION_TYPE_REQUIRED',

  KEY_REUSED:
    'IDEMPOTENCY_KEY_REUSED',

  REQUEST_CONFLICT:
    'IDEMPOTENCY_REQUEST_CONFLICT',

  OPERATION_IN_PROGRESS:
    'IDEMPOTENCY_OPERATION_IN_PROGRESS',

  OPERATION_NOT_FOUND:
    'IDEMPOTENCY_OPERATION_NOT_FOUND',

  OPERATION_COMPLETED:
    'IDEMPOTENCY_OPERATION_COMPLETED',

  OPERATION_FAILED:
    'IDEMPOTENCY_OPERATION_FAILED',

  UNKNOWN_OUTCOME:
    'IDEMPOTENCY_UNKNOWN_OUTCOME',

  CONCURRENT_RESERVATION:
    'IDEMPOTENCY_CONCURRENT_RESERVATION',

  PROVIDER_REFERENCE_CONFLICT:
    'IDEMPOTENCY_PROVIDER_REFERENCE_CONFLICT',

  PAYMENT_CONFLICT:
    'IDEMPOTENCY_PAYMENT_CONFLICT',

  INVALID_TRANSITION:
    'IDEMPOTENCY_INVALID_TRANSITION',

  STORAGE_UNAVAILABLE:
    'IDEMPOTENCY_STORAGE_UNAVAILABLE',

  FINGERPRINT_ERROR:
    'IDEMPOTENCY_FINGERPRINT_ERROR',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode: true,

  requireTenant: true,

  requireKey: true,

  minKeyLength: 8,

  maxKeyLength: 255,

  defaultTtlMs:
    24 * 60 * 60 * 1000,

  processingLeaseMs:
    10 * 60 * 1000,

  completedRetentionMs:
    7 * 24 * 60 * 60 * 1000,

  failedRetentionMs:
    24 * 60 * 60 * 1000,

  unknownRetentionMs:
    7 * 24 * 60 * 60 * 1000,

  /**
   * A stale PROCESSING/RESERVED record can be reclaimed only after its lease
   * has elapsed.
   */
  allowLeaseRecovery:
    true,

  /**
   * A completed result may be returned to a duplicate request.
   */
  replayCompletedResult:
    true,

  /**
   * A failed operation is normally not treated as equivalent to a fresh
   * request. Callers should explicitly retry according to their workflow.
   */
  replayFailedResult:
    false,

  /**
   * Unknown outcomes are deliberately not replayed as failed or successful.
   * They require reconciliation/recovery.
   */
  replayUnknownResult:
    false,

  /**
   * Same idempotency key + different operation payload is always a conflict.
   */
  rejectFingerprintMismatch:
    true,

  /**
   * Provider callback identity may be used as a logical idempotency identity
   * when the callback has already passed provider authentication.
   */
  allowProviderEventKey:
    true,

  /**
   * Provider transaction reference can be separately checked for collision.
   */
  enforceProviderReferenceUniqueness:
    true,

  /**
   * Never include obviously sensitive fields in generated fingerprints.
   */
  redactSensitiveFields:
    true,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class PaymentIdempotencyError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'PaymentIdempotencyError';

    this.code =
      options.code
      || IDEMPOTENCY_ERROR_CODES.INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.tenantId =
      options.tenantId || null;

    this.idempotencyKey =
      options.idempotencyKey || null;

    this.operationType =
      options.operationType || null;

    this.operationId =
      options.operationId || null;

    this.paymentId =
      options.paymentId || null;

    this.provider =
      options.provider || null;

    this.providerTransactionId =
      options.providerTransactionId || null;

    this.existingStatus =
      options.existingStatus || null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.details =
      options.details || {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentIdempotencyError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(value) {
  return (
    typeof value === 'string'
    && value.trim().length > 0
  );
}

function normalizeString(value) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function normalizeOperationType(value) {
  const normalized =
    normalizeString(value);

  return normalized
    ? normalized.toUpperCase()
    : null;
}

function clone(value) {
  if (
    value === undefined
    || value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone
    === 'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch (_error) {
      // Continue with JSON clone.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
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

  if (
    typeof value !== 'object'
  ) {
    return JSON.stringify(
      value,
    );
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
        `${JSON.stringify(key)}:${stableStringify(
          value[key],
        )}`,
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

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function isDateExpired(value) {
  const date =
    parseDate(value);

  return Boolean(
    date
    && date.getTime()
      <= Date.now(),
  );
}

function safeId(value) {
  if (
    value
    && typeof value.toString
      === 'function'
  ) {
    return value.toString();
  }

  return normalizeString(
    value,
  );
}

function normalizeAmount(value) {
  if (
    value === undefined
    || value === null
    || value === ''
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

function canonicalAmount(value) {
  const amount =
    normalizeAmount(
      value,
    );

  if (!amount) {
    return null;
  }

  const trimmed =
    amount.trim();

  /**
   * We intentionally avoid Number conversion because authoritative monetary
   * values must not pass through IEEE-754 binary floating point.
   */
  if (
    !/^\d+(\.\d+)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }

  const parts =
    trimmed.split('.');

  const integerPart =
    parts[0].replace(
      /^0+(?=\d)/,
      '',
    );

  const decimalPart =
    parts[1]
      ? parts[1].replace(
        /0+$/,
        '',
      )
      : '';

  return decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function canonicalCurrency(
  value,
) {
  const currency =
    normalizeString(
      value,
    );

  return currency
    ? currency.toUpperCase()
    : null;
}

function normalizeProvider(
  value,
) {
  const provider =
    normalizeString(
      value,
    );

  return provider
    ? provider.toLowerCase()
    : null;
}

function createOperationId(
  prefix = 'idem',
) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeHashSafeValue(
  value,
  sensitiveFields,
) {
  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        normalizeHashSafeValue(
          item,
          sensitiveFields,
        ),
    );
  }

  const output = {};

  for (
    const [key, child]
    of Object.entries(
      value,
    )
  ) {
    if (
      sensitiveFields.has(
        key,
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    output[key] =
      normalizeHashSafeValue(
        child,
        sensitiveFields,
      );
  }

  return output;
}

/* ============================================================================
 * In-Memory Repository
 *
 * Intended for unit tests/local development only. Production should provide
 * a durable repository with atomic uniqueness/version constraints.
 * ========================================================================== */

class InMemoryPaymentIdempotencyRepository {
  constructor() {
    this.recordsByIdentity =
      new Map();

    this.recordsByOperationId =
      new Map();

    this.providerReferences =
      new Map();

    this.paymentReferences =
      new Map();
  }

  _identityKey(
    tenantId,
    operationType,
    key,
  ) {
    return [
      tenantId || 'global',
      operationType || 'OTHER',
      key,
    ].join(':');
  }

  _providerKey(
    provider,
    providerTransactionId,
  ) {
    return [
      provider || 'unknown',
      providerTransactionId,
    ].join(':');
  }

  async findByIdentity(
    {
      tenantId,
      operationType,
      key,
    },
  ) {
    return clone(
      this.recordsByIdentity.get(
        this._identityKey(
          tenantId,
          operationType,
          key,
        ),
      ) || null,
    );
  }

  async findByOperationId(
    operationId,
  ) {
    return clone(
      this.recordsByOperationId.get(
        operationId,
      ) || null,
    );
  }

  async findByProviderReference(
    {
      provider,
      providerTransactionId,
    },
  ) {
    if (
      !provider
      || !providerTransactionId
    ) {
      return null;
    }

    return clone(
      this.providerReferences.get(
        this._providerKey(
          provider,
          providerTransactionId,
        ),
      ) || null,
    );
  }

  async reserve(
    record,
  ) {
    const key =
      this._identityKey(
        record.tenantId,
        record.operationType,
        record.key,
      );

    if (
      this.recordsByIdentity.has(
        key,
      )
    ) {
      return {
        created: false,
        record: clone(
          this.recordsByIdentity.get(
            key,
          ),
        ),
      };
    }

    const stored =
      clone(
        record,
      );

    this.recordsByIdentity.set(
      key,
      stored,
    );

    if (
      stored.operationId
    ) {
      this.recordsByOperationId.set(
        stored.operationId,
        stored,
      );
    }

    return {
      created: true,
      record: clone(
        stored,
      ),
    };
  }

  async update(
    {
      operationId,
      expectedVersion,
      patch,
    },
  ) {
    const current =
      this.recordsByOperationId.get(
        operationId,
      );

    if (!current) {
      return null;
    }

    const currentVersion =
      Number(
        current.version || 0,
      );

    if (
      currentVersion
      !== expectedVersion
    ) {
      return null;
    }

    const next = {
      ...current,
      ...clone(
        patch,
      ),
      version:
        currentVersion + 1,
      updatedAt:
        isoNow(),
    };

    const identityKey =
      this._identityKey(
        next.tenantId,
        next.operationType,
        next.key,
      );

    this.recordsByIdentity.set(
      identityKey,
      next,
    );

    this.recordsByOperationId.set(
      operationId,
      next,
    );

    if (
      next.provider
      && next.providerTransactionId
    ) {
      this.providerReferences.set(
        this._providerKey(
          next.provider,
          next.providerTransactionId,
        ),
        next,
      );
    }

    return clone(
      next,
    );
  }

  async delete(
    {
      tenantId,
      operationType,
      key,
    },
  ) {
    return this.recordsByIdentity.delete(
      this._identityKey(
        tenantId,
        operationType,
        key,
      ),
    );
  }

  async clear() {
    this.recordsByIdentity.clear();
    this.recordsByOperationId.clear();
    this.providerReferences.clear();
    this.paymentReferences.clear();
  }
}

/* ============================================================================
 * Payment Idempotency Service
 * ========================================================================== */

class PaymentIdempotencyService {
  /**
   * @param {Object} dependencies
   *
   * @param {Object} dependencies.repository
   * @param {Object} dependencies.logger
   * @param {Object} dependencies.metrics
   * @param {Object} dependencies.auditService
   * @param {Function} dependencies.clock
   */
  constructor(
    dependencies = {},
  ) {
    this.repository =
      dependencies.repository
      || dependencies.idempotencyRepository
      || new InMemoryPaymentIdempotencyRepository();

    this.logger =
      dependencies.logger
      || console;

    this.metrics =
      dependencies.metrics
      || null;

    this.auditService =
      dependencies.auditService
      || null;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });

    this.clock =
      typeof dependencies.clock === 'function'
        ? dependencies.clock
        : () => Date.now();
  }

  /* ==========================================================================
   * Identity
   * ======================================================================== */

  /**
   * Build the canonical idempotency identity.
   *
   * Tenant is always part of the identity. This is mandatory for a
   * multi-tenant financial platform.
   */
  buildIdentity(
    {
      tenantId,
      operationType,
      key,
    },
  ) {
    const normalizedTenant =
      normalizeString(
        tenantId,
      );

    const normalizedOperation =
      normalizeOperationType(
        operationType,
      );

    const normalizedKey =
      this.normalizeKey(
        key,
      );

    this._assertTenant(
      normalizedTenant,
    );

    this._assertOperationType(
      normalizedOperation,
    );

    return Object.freeze({
      tenantId:
        normalizedTenant,

      operationType:
        normalizedOperation,

      key:
        normalizedKey,
    });
  }

  /**
   * Normalize and validate an idempotency key.
   */
  normalizeKey(
    key,
  ) {
    const normalized =
      normalizeString(
        key,
      );

    if (!normalized) {
      if (
        this.options.requireKey
      ) {
        throw new PaymentIdempotencyError(
          'An idempotency key is required.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .KEY_REQUIRED,
            statusCode: 400,
          },
        );
      }

      return null;
    }

    if (
      normalized.length
      < this.options.minKeyLength
      || normalized.length
      > this.options.maxKeyLength
    ) {
      throw new PaymentIdempotencyError(
        'Idempotency key length is invalid.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_INVALID,
          statusCode: 400,
          details: {
            minLength:
              this.options.minKeyLength,

            maxLength:
              this.options.maxKeyLength,
          },
        },
      );
    }

    /**
     * Restrict control characters while allowing common UUID/request key
     * formats.
     */
    if (
      /[\u0000-\u001F\u007F]/.test(
        normalized,
      )
    ) {
      throw new PaymentIdempotencyError(
        'Idempotency key contains invalid control characters.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_INVALID,
          statusCode: 400,
        },
      );
    }

    return normalized;
  }

  /* ==========================================================================
   * Fingerprinting
   * ======================================================================== */

  /**
   * Create a deterministic request fingerprint.
   *
   * The fingerprint deliberately excludes fields that legitimately differ
   * across retries, such as generated timestamps or transient request IDs.
   */
  createFingerprint(
    request,
    options = {},
  ) {
    try {
      const sensitiveFields =
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
          'rawBody',
          'rawAuthorizationHeader',
        ]);

      const normalized =
        this._normalizeFingerprintInput(
          request,
          {
            ...options,
            sensitiveFields,
          },
        );

      return sha256(
        normalized,
      );
    } catch (error) {
      throw new PaymentIdempotencyError(
        'Unable to create a deterministic payment request fingerprint.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .FINGERPRINT_ERROR,
          statusCode: 500,
          cause:
            error,
        },
      );
    }
  }

  _normalizeFingerprintInput(
    request,
    options = {},
  ) {
    const input =
      clone(
        request || {},
      )
      || {};

    /**
     * Fields that should not make a retry look like a different request.
     */
    const excludedFields =
      new Set([
        'requestId',
        'correlationId',
        'causationId',
        'traceId',
        'spanId',
        'timestamp',
        'receivedAt',
        'createdAt',
        'updatedAt',
        'attempt',
      ]);

    if (
      options.excludeFields
      && Array.isArray(
        options.excludeFields,
      )
    ) {
      for (
        const field
        of options.excludeFields
      ) {
        excludedFields.add(
          field,
        );
      }
    }

    const filtered =
      this._removeFingerprintFields(
        input,
        excludedFields,
      );

    const normalized =
      this._normalizeFinancialFields(
        filtered,
      );

    return options.redactSensitiveFields
      === false
      || this.options.redactSensitiveFields
      === false
      ? normalized
      : normalizeHashSafeValue(
        normalized,
        options.sensitiveFields
        || new Set(),
      );
  }

  _removeFingerprintFields(
    value,
    excludedFields,
  ) {
    if (
      value === null
      || value === undefined
    ) {
      return value;
    }

    if (
      Array.isArray(value)
    ) {
      return value.map(
        (item) =>
          this._removeFingerprintFields(
            item,
            excludedFields,
          ),
      );
    }

    if (
      typeof value !== 'object'
    ) {
      return value;
    }

    const output = {};

    for (
      const [key, child]
      of Object.entries(
        value,
      )
    ) {
      if (
        excludedFields.has(
          key,
        )
      ) {
        continue;
      }

      output[key] =
        this._removeFingerprintFields(
          child,
          excludedFields,
        );
    }

    return output;
  }

  _normalizeFinancialFields(
    value,
  ) {
    if (
      value === null
      || value === undefined
    ) {
      return value;
    }

    if (
      Array.isArray(value)
    ) {
      return value.map(
        (item) =>
          this._normalizeFinancialFields(
            item,
          ),
      );
    }

    if (
      typeof value !== 'object'
    ) {
      return value;
    }

    const output = {};

    for (
      const [key, child]
      of Object.entries(
        value,
      )
    ) {
      if (
        [
          'amount',
          'requestedAmount',
          'approvedAmount',
          'feeAmount',
          'principal',
          'interest',
          'penalty',
        ].includes(key)
      ) {
        const normalized =
          canonicalAmount(
            child,
          );

        output[key] =
          normalized
          || normalizeAmount(
            child,
          );

        continue;
      }

      if (
        [
          'currency',
          'sourceCurrency',
          'targetCurrency',
        ].includes(key)
      ) {
        output[key] =
          canonicalCurrency(
            child,
          );

        continue;
      }

      if (
        [
          'provider',
          'paymentProvider',
        ].includes(key)
      ) {
        output[key] =
          normalizeProvider(
            child,
          );

        continue;
      }

      output[key] =
        this._normalizeFinancialFields(
          child,
        );
    }

    return output;
  }

  /* ==========================================================================
   * Reserve
   * ======================================================================== */

  /**
   * Reserve an idempotency operation before executing an external payment
   * side effect.
   *
   * If the key already exists:
   *   - COMPLETED -> safe replay
   *   - PROCESSING/RESERVED -> in-progress result
   *   - UNKNOWN -> reconciliation required
   *   - FAILED -> caller decides whether a new retry identity is permitted
   *   - fingerprint mismatch -> conflict
   */
  async reserve(
    request,
  ) {
    const normalized =
      this._normalizeReserveRequest(
        request,
      );

    const identity =
      this.buildIdentity(
        {
          tenantId:
            normalized.tenantId,

          operationType:
            normalized.operationType,

          key:
            normalized.key,
        },
      );

    const fingerprint =
      normalized.fingerprint
      || this.createFingerprint(
        normalized.request,
      );

    await this._checkProviderReferenceCollision(
      normalized,
      identity,
    );

    const existing =
      await this.repository.findByIdentity(
        identity,
      );

    if (existing) {
      const existingNormalized =
        this._normalizeRecord(
          existing,
        );

      this._assertFingerprintCompatibility(
        existingNormalized,
        fingerprint,
        identity,
      );

      return this._resolveExistingReservation(
        existingNormalized,
        identity,
      );
    }

    const operationId =
      normalized.operationId
      || createOperationId(
        'payment_op',
      );

    const timestamp =
      this._nowDate();

    const record = {
      id:
        createOperationId(
          'idem',
        ),

      operationId,

      tenantId:
        identity.tenantId,

      operationType:
        identity.operationType,

      key:
        identity.key,

      fingerprint,

      status:
        IDEMPOTENCY_STATUS.RESERVED,

      paymentId:
        normalized.paymentId
        || null,

      paymentReference:
        normalized.paymentReference
        || null,

      provider:
        normalized.provider
        || null,

      providerTransactionId:
        normalized.providerTransactionId
        || null,

      providerEventId:
        normalized.providerEventId
        || null,

      requestMetadata:
        this._sanitizeMetadata(
          normalized.metadata,
        ),

      result:
        null,

      error:
        null,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      expiresAt:
        new Date(
          timestamp.getTime()
          + (
            normalized.ttlMs
            || this.options
              .defaultTtlMs
          ),
        ),

      leaseExpiresAt:
        new Date(
          timestamp.getTime()
          + this.options
            .processingLeaseMs,
        ),

      completedAt:
        null,

      failedAt:
        null,

      unknownAt:
        null,

      version:
        0,
    };

    let reservation;

    try {
      reservation =
        await this.repository.reserve(
          record,
        );
    } catch (error) {
      this._logError(
        'Failed to reserve payment idempotency key.',
        error,
        identity,
      );

      throw new PaymentIdempotencyError(
        'Unable to reserve payment idempotency operation.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,
          statusCode: 503,
          tenantId:
            identity.tenantId,
          idempotencyKey:
            identity.key,
          operationType:
            identity.operationType,
          cause:
            error,
        },
      );
    }

    if (
      !reservation
    ) {
      throw new PaymentIdempotencyError(
        'Payment idempotency reservation could not be created.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,
          statusCode: 503,
          tenantId:
            identity.tenantId,
          idempotencyKey:
            identity.key,
          operationType:
            identity.operationType,
        },
      );
    }

    /**
     * The repository may report that another concurrent process won the
     * uniqueness race.
     */
    if (
      reservation.created === false
      && reservation.record
    ) {
      const winner =
        this._normalizeRecord(
          reservation.record,
        );

      this._assertFingerprintCompatibility(
        winner,
        fingerprint,
        identity,
      );

      return this._resolveExistingReservation(
        winner,
        identity,
      );
    }

    const stored =
      this._normalizeRecord(
        reservation.record
        || record,
      );

    await this._recordAudit(
      'IDEMPOTENCY_RESERVED',
      stored,
    );

    return this._buildReservationResult(
      stored,
      false,
    );
  }

  /* ==========================================================================
   * Begin Processing
   * ======================================================================== */

  async begin(
    operationOrRequest,
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    if (
      record.status
      === IDEMPOTENCY_STATUS.COMPLETED
    ) {
      if (
        this.options.replayCompletedResult
      ) {
        return this._buildProcessingResult(
          record,
          {
            replay:
              true,
            completed:
              true,
          },
        );
      }

      throw new PaymentIdempotencyError(
        'The payment operation has already completed.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_COMPLETED,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }

    if (
      record.status
      === IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      if (
        this.options.replayUnknownResult
      ) {
        return this._buildProcessingResult(
          record,
          {
            replay:
              true,
            unknown:
              true,
          },
        );
      }

      throw new PaymentIdempotencyError(
        'The payment operation has an unknown outcome and requires reconciliation.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .UNKNOWN_OUTCOME,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
          unknownOutcome:
            true,
        },
      );
    }

    if (
      record.status
      === IDEMPOTENCY_STATUS.PROCESSING
      || record.status
      === IDEMPOTENCY_STATUS.RESERVED
    ) {
      const recoverable =
        this._isLeaseExpired(
          record,
        );

      if (
        recoverable
        && this.options
          .allowLeaseRecovery
      ) {
        const recovered =
          await this._recoverLease(
            record,
          );

        if (recovered) {
          record.status =
            IDEMPOTENCY_STATUS.PROCESSING;

          return this._buildProcessingResult(
            recovered,
            {
              replay:
                false,
              recovered:
                true,
            },
          );
        }
      }

      throw new PaymentIdempotencyError(
        'The payment idempotency operation is already in progress.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_IN_PROGRESS,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
          retryable:
            true,
        },
      );
    }

    if (
      record.status
      === IDEMPOTENCY_STATUS.FAILED
    ) {
      if (
        this.options.replayFailedResult
      ) {
        return this._buildProcessingResult(
          record,
          {
            replay:
              true,
            failed:
              true,
          },
        );
      }

      /**
       * The caller must decide whether to retry with the SAME idempotency
       * identity through a controlled retry mechanism or create a new logical
       * operation key.
       */
      throw new PaymentIdempotencyError(
        'The previous payment operation failed.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_FAILED,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
          retryable:
            true,
        },
      );
    }

    if (
      record.status
      === IDEMPOTENCY_STATUS.EXPIRED
    ) {
      throw new PaymentIdempotencyError(
        'The idempotency operation has expired.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_FAILED,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }

    return this._transitionStatus(
      record,
      IDEMPOTENCY_STATUS.PROCESSING,
      {
        reasonCode:
          'PAYMENT_OPERATION_STARTED',
        extendLease:
          true,
      },
    );
  }

  /* ==========================================================================
   * Complete
   * ======================================================================== */

  async complete(
    operationOrRequest,
    result,
    options = {},
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    if (
      record.status
      === IDEMPOTENCY_STATUS.COMPLETED
    ) {
      /**
       * Completion is idempotent. Return the original result rather than
       * replacing it.
       */
      return this._buildProcessingResult(
        record,
        {
          replay:
            true,
          completed:
            true,
        },
      );
    }

    if (
      record.status
      === IDEMPOTENCY_STATUS.UNKNOWN
    ) {
      throw new PaymentIdempotencyError(
        'An UNKNOWN operation cannot be completed without explicit recovery.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .UNKNOWN_OUTCOME,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          unknownOutcome:
            true,
        },
      );
    }

    this._assertCompletableStatus(
      record,
    );

    const sanitizedResult =
      this._sanitizeResult(
        result,
      );

    const patch = {
      status:
        IDEMPOTENCY_STATUS.COMPLETED,

      result:
        sanitizedResult,

      error:
        null,

      completedAt:
        this._nowDate(),

      failedAt:
        null,

      unknownAt:
        null,

      leaseExpiresAt:
        null,

      paymentId:
        options.paymentId
        || record.paymentId
        || null,

      paymentReference:
        options.paymentReference
        || record.paymentReference
        || null,

      provider:
        options.provider
        || record.provider
        || null,

      providerTransactionId:
        options.providerTransactionId
        || record.providerTransactionId
        || null,

      providerEventId:
        options.providerEventId
        || record.providerEventId
        || null,
    };

    const updated =
      await this._updateRecord(
        record,
        patch,
      );

    await this._recordAudit(
      'IDEMPOTENCY_COMPLETED',
      updated,
    );

    this._metric(
      'payment_idempotency_completed_total',
      1,
      {
        operationType:
          updated.operationType,
      },
    );

    return this._buildProcessingResult(
      updated,
      {
        replay:
          false,
        completed:
          true,
      },
    );
  }

  /* ==========================================================================
   * Fail
   * ======================================================================== */

  async fail(
    operationOrRequest,
    error,
    options = {},
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    if (
      record.status
      === IDEMPOTENCY_STATUS.COMPLETED
    ) {
      /**
       * Never overwrite an authoritative completed result with an error.
       */
      return this._buildProcessingResult(
        record,
        {
          replay:
            true,
          completed:
            true,
        },
      );
    }

    const sanitizedError =
      this._sanitizeError(
        error,
      );

    const patch = {
      status:
        IDEMPOTENCY_STATUS.FAILED,

      result:
        null,

      error:
        sanitizedError,

      failedAt:
        this._nowDate(),

      leaseExpiresAt:
        null,

      failureReasonCode:
        options.reasonCode
        || sanitizedError.code
        || null,

      retryable:
        options.retryable
        ?? this._inferRetryability(
          error,
        ),

      paymentId:
        options.paymentId
        || record.paymentId
        || null,
    };

    const updated =
      await this._updateRecord(
        record,
        patch,
      );

    await this._recordAudit(
      'IDEMPOTENCY_FAILED',
      updated,
    );

    this._metric(
      'payment_idempotency_failed_total',
      1,
      {
        operationType:
          updated.operationType,
      },
    );

    return this._buildProcessingResult(
      updated,
      {
        replay:
          false,
        failed:
          true,
      },
    );
  }

  /* ==========================================================================
   * Mark Unknown
   * ======================================================================== */

  async markUnknown(
    operationOrRequest,
    errorOrMetadata = null,
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    if (
      record.status
      === IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return this._buildProcessingResult(
        record,
        {
          replay:
            true,
          completed:
            true,
        },
      );
    }

    const error =
      errorOrMetadata
      instanceof Error
        ? errorOrMetadata
        : null;

    const metadata =
      error
        ? {}
        : (
          errorOrMetadata
          && typeof errorOrMetadata
            === 'object'
            ? errorOrMetadata
            : {}
        );

    const patch = {
      status:
        IDEMPOTENCY_STATUS.UNKNOWN,

      result:
        null,

      error:
        error
          ? this._sanitizeError(
            error,
          )
          : null,

      unknownAt:
        this._nowDate(),

      leaseExpiresAt:
        null,

      recoveryRequired:
        true,

      recoveryReasonCode:
        metadata.reasonCode
        || 'UNKNOWN_OUTCOME',
    };

    const updated =
      await this._updateRecord(
        record,
        patch,
      );

    await this._recordAudit(
      'IDEMPOTENCY_UNKNOWN',
      updated,
    );

    this._metric(
      'payment_idempotency_unknown_total',
      1,
      {
        operationType:
          updated.operationType,
      },
    );

    return this._buildProcessingResult(
      updated,
      {
        replay:
          false,
        unknown:
          true,
      },
    );
  }

  /* ==========================================================================
   * Recover
   * ======================================================================== */

  /**
   * Reconcile an UNKNOWN operation with an authoritative final result.
   *
   * This method intentionally requires an explicit recovery direction.
   */
  async recover(
    operationOrRequest,
    recovery = {},
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    const target =
      normalizeString(
        recovery.outcome
        || recovery.status,
      )?.toUpperCase();

    if (
      record.status
      !== IDEMPOTENCY_STATUS.UNKNOWN
      && record.status
      !== IDEMPOTENCY_STATUS.REQUIRES_RECONCILIATION
    ) {
      if (
        record.status
        === IDEMPOTENCY_STATUS.COMPLETED
      ) {
        return this._buildProcessingResult(
          record,
          {
            replay:
              true,
            completed:
              true,
          },
        );
      }

      throw new PaymentIdempotencyError(
        'Only UNKNOWN or reconciliation-required idempotency records may be recovered.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_TRANSITION,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }

    if (
      target === 'SUCCESS'
      || target === 'SUCCESSFUL'
      || target === 'COMPLETED'
    ) {
      return this.complete(
        record,
        recovery.result,
        {
          paymentId:
            recovery.paymentId
            || record.paymentId,

          provider:
            recovery.provider
            || record.provider,

          providerTransactionId:
            recovery.providerTransactionId
            || record.providerTransactionId,

          providerEventId:
            recovery.providerEventId
            || record.providerEventId,

          paymentReference:
            recovery.paymentReference
            || record.paymentReference,
        },
      );
    }

    if (
      target === 'FAILED'
      || target === 'FAILURE'
    ) {
      return this.fail(
        record,
        recovery.error,
        {
          paymentId:
            recovery.paymentId
            || record.paymentId,

          reasonCode:
            recovery.reasonCode
            || 'RECOVERED_PROVIDER_FAILURE',

          retryable:
            false,
        },
      );
    }

    if (
      target === 'RECONCILIATION'
      || target === 'REQUIRES_RECONCILIATION'
    ) {
      return this._transitionStatus(
        record,
        IDEMPOTENCY_STATUS.UNKNOWN,
        {
          reasonCode:
            recovery.reasonCode
            || 'RECONCILIATION_CONTINUES',
        },
      );
    }

    throw new PaymentIdempotencyError(
      'Invalid idempotency recovery outcome.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .INVALID_TRANSITION,
        statusCode: 400,
        tenantId:
          record.tenantId,
        idempotencyKey:
          record.key,
        operationType:
          record.operationType,
        operationId:
          record.operationId,
        details: {
          outcome:
            target,
        },
      },
    );
  }

  /* ==========================================================================
   * Release
   * ======================================================================== */

  /**
   * Release is intentionally limited to a reservation that has NOT caused an
   * external financial side effect.
   *
   * Never release a key simply because a provider request timed out.
   * Unknown external outcomes must become UNKNOWN/reconciliation-required.
   */
  async release(
    operationOrRequest,
    options = {},
  ) {
    const record =
      await this._resolveRecord(
        operationOrRequest,
      );

    if (
      ![
        IDEMPOTENCY_STATUS.RESERVED,
        IDEMPOTENCY_STATUS.PROCESSING,
      ].includes(
        record.status,
      )
    ) {
      if (
        record.status
        === IDEMPOTENCY_STATUS.RELEASED
      ) {
        return this._buildProcessingResult(
          record,
          {
            replay:
              true,
            released:
              true,
          },
        );
      }

      throw new PaymentIdempotencyError(
        'Only RESERVED or PROCESSING idempotency records may be released.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_TRANSITION,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }

    if (
      options.externalSideEffectStarted
      === true
    ) {
      return this.markUnknown(
        record,
        {
          reasonCode:
            'EXTERNAL_SIDE_EFFECT_STARTED',
        },
      );
    }

    return this._transitionStatus(
      record,
      IDEMPOTENCY_STATUS.RELEASED,
      {
        reasonCode:
          options.reasonCode
          || 'IDEMPOTENCY_RESERVATION_RELEASED',
      },
    );
  }

  /* ==========================================================================
   * Query
   * ======================================================================== */

  async get(
    request,
  ) {
    const identity =
      this.buildIdentity(
        request,
      );

    const record =
      await this.repository.findByIdentity(
        identity,
      );

    if (!record) {
      return null;
    }

    return this._sanitizePublicRecord(
      this._normalizeRecord(
        record,
      ),
    );
  }

  async getByOperationId(
    operationId,
  ) {
    const id =
      normalizeString(
        operationId,
      );

    if (!id) {
      throw new PaymentIdempotencyError(
        'Operation ID is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_NOT_FOUND,
          statusCode: 400,
        },
      );
    }

    const record =
      await this.repository.findByOperationId(
        id,
      );

    return record
      ? this._sanitizePublicRecord(
        this._normalizeRecord(
          record,
        ),
      )
      : null;
  }

  /* ==========================================================================
   * Provider Callback Identity
   * ======================================================================== */

  /**
   * Builds a deterministic callback idempotency key.
   *
   * This method must only be used AFTER provider callback authentication.
   */
  buildProviderCallbackKey(
    {
      provider,
      providerEventId,
      providerTransactionId,
      eventType,
    },
  ) {
    const normalizedProvider =
      normalizeProvider(
        provider,
      );

    const eventId =
      normalizeString(
        providerEventId,
      );

    const transactionId =
      normalizeString(
        providerTransactionId,
      );

    const normalizedEventType =
      normalizeString(
        eventType,
      )?.toUpperCase()
      || 'PAYMENT_CALLBACK';

    if (!normalizedProvider) {
      throw new PaymentIdempotencyError(
        'Provider is required for callback idempotency.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,
          statusCode: 400,
        },
      );
    }

    if (
      this.options.allowProviderEventKey
      && eventId
    ) {
      return [
        'provider-event',
        normalizedProvider,
        normalizedEventType,
        eventId,
      ].join(':');
    }

    if (transactionId) {
      return [
        'provider-transaction',
        normalizedProvider,
        normalizedEventType,
        transactionId,
      ].join(':');
    }

    throw new PaymentIdempotencyError(
      'Provider event ID or provider transaction ID is required for callback idempotency.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .KEY_REQUIRED,
        statusCode: 400,
      },
    );
  }

  async reserveProviderCallback(
    request,
  ) {
    const key =
      this.buildProviderCallbackKey(
        request,
      );

    const fingerprint =
      request.fingerprint
      || this.createFingerprint(
        {
          provider:
            request.provider,

          providerEventId:
            request.providerEventId,

          providerTransactionId:
            request.providerTransactionId,

          eventType:
            request.eventType,

          status:
            request.status,

          amount:
            request.amount,

          currency:
            request.currency,

          paymentReference:
            request.paymentReference,
        },
      );

    return this.reserve({
      tenantId:
        request.tenantId,

      operationType:
        IDEMPOTENCY_OPERATION_TYPES
          .PAYMENT_CALLBACK,

      key,

      fingerprint,

      paymentId:
        request.paymentId
        || null,

      paymentReference:
        request.paymentReference
        || null,

      provider:
        request.provider,

      providerTransactionId:
        request.providerTransactionId
        || null,

      providerEventId:
        request.providerEventId
        || null,

      request: {
        provider:
          request.provider,

        providerEventId:
          request.providerEventId,

        providerTransactionId:
          request.providerTransactionId,

        eventType:
          request.eventType,

        status:
          request.status,

        amount:
          request.amount,

        currency:
          request.currency,

        paymentReference:
          request.paymentReference,
      },

      metadata:
        request.metadata,

      operationId:
        request.operationId,
    });
  }

  /* ==========================================================================
   * Financial Posting Identity
   * ======================================================================== */

  /**
   * Builds a deterministic idempotency key for a payment's financial posting.
   *
   * This prevents:
   *
   *   Payment success
   *       ->
   *   worker retry
   *       ->
   *   second ledger transaction
   */
  buildFinancialPostingKey(
    {
      paymentId,
      paymentReference,
      tenantId,
    },
  ) {
    const paymentIdentity =
      normalizeString(
        paymentId,
      )
      || normalizeString(
        paymentReference,
      );

    if (!paymentIdentity) {
      throw new PaymentIdempotencyError(
        'A payment identity is required for financial posting idempotency.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_REQUIRED,
          statusCode: 400,
          tenantId:
            tenantId || null,
        },
      );
    }

    return [
      'financial-posting',
      tenantId || 'global',
      paymentIdentity,
    ].join(':');
  }

  /* ==========================================================================
   * Provider Reference Collision Protection
   * ======================================================================== */

  async _checkProviderReferenceCollision(
    request,
    identity,
  ) {
    if (
      !this.options
        .enforceProviderReferenceUniqueness
    ) {
      return null;
    }

    const provider =
      normalizeProvider(
        request.provider,
      );

    const providerTransactionId =
      normalizeString(
        request.providerTransactionId,
      );

    if (
      !provider
      || !providerTransactionId
    ) {
      return null;
    }

    if (
      typeof this.repository
        .findByProviderReference
        !== 'function'
    ) {
      return null;
    }

    const existing =
      await this.repository
        .findByProviderReference({
          provider,
          providerTransactionId,
        });

    if (!existing) {
      return null;
    }

    const normalized =
      this._normalizeRecord(
        existing,
      );

    if (
      normalized.tenantId
      !== identity.tenantId
    ) {
      throw new PaymentIdempotencyError(
        'Provider transaction reference is already associated with another tenant.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .PROVIDER_REFERENCE_CONFLICT,
          statusCode: 409,
          tenantId:
            identity.tenantId,
          provider,
          providerTransactionId,
        },
      );
    }

    return normalized;
  }

  /* ==========================================================================
   * Internal Record Handling
   * ======================================================================== */

  async _resolveRecord(
    operationOrRequest,
  ) {
    if (
      operationOrRequest
      && typeof operationOrRequest
        === 'object'
      && (
        operationOrRequest.operationId
        || operationOrRequest.id
          && operationOrRequest.status
      )
    ) {
      return this._normalizeRecord(
        operationOrRequest,
      );
    }

    if (
      isNonEmptyString(
        operationOrRequest,
      )
    ) {
      const byId =
        await this.repository
          .findByOperationId(
            operationOrRequest,
          );

      if (!byId) {
        throw new PaymentIdempotencyError(
          'Idempotency operation was not found.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_NOT_FOUND,
            statusCode: 404,
            operationId:
              operationOrRequest,
          },
        );
      }

      return this._normalizeRecord(
        byId,
      );
    }

    if (
      operationOrRequest
      && typeof operationOrRequest
        === 'object'
    ) {
      const identity =
        this.buildIdentity(
          {
            tenantId:
              operationOrRequest.tenantId,

            operationType:
              operationOrRequest.operationType,

            key:
              operationOrRequest.key
              || operationOrRequest.idempotencyKey,
          },
        );

      const record =
        await this.repository
          .findByIdentity(
            identity,
          );

      if (!record) {
        throw new PaymentIdempotencyError(
          'Idempotency operation was not found.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_NOT_FOUND,
            statusCode: 404,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
          },
        );
      }

      return this._normalizeRecord(
        record,
      );
    }

    throw new PaymentIdempotencyError(
      'A valid idempotency operation reference is required.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .INVALID_REQUEST,
        statusCode: 400,
      },
    );
  }

  _normalizeReserveRequest(
    request,
  ) {
    if (
      !request
      || typeof request !== 'object'
    ) {
      throw new PaymentIdempotencyError(
        'An idempotency reservation request is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_REQUEST,
          statusCode: 400,
        },
      );
    }

    const tenantId =
      normalizeString(
        request.tenantId,
      );

    const operationType =
      normalizeOperationType(
        request.operationType,
      );

    const key =
      this.normalizeKey(
        request.key
        || request.idempotencyKey,
      );

    this._assertTenant(
      tenantId,
    );

    this._assertOperationType(
      operationType,
    );

    if (!key) {
      throw new PaymentIdempotencyError(
        'An idempotency key is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .KEY_REQUIRED,
          statusCode: 400,
          tenantId,
          operationType,
        },
      );
    }

    return {
      tenantId,

      operationType,

      key,

      fingerprint:
        normalizeString(
          request.fingerprint,
        ),

      request:
        request.request
        || request.payload
        || {},

      operationId:
        normalizeString(
          request.operationId,
        ),

      paymentId:
        normalizeString(
          request.paymentId,
        ),

      paymentReference:
        normalizeString(
          request.paymentReference,
        ),

      provider:
        normalizeProvider(
          request.provider,
        ),

      providerTransactionId:
        normalizeString(
          request.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          request.providerEventId,
        ),

      metadata:
        this._sanitizeMetadata(
          request.metadata,
        ),

      ttlMs:
        Number.isFinite(
          Number(
            request.ttlMs,
          ),
        )
          ? Number(
            request.ttlMs,
          )
          : null,
    };
  }

  _normalizeRecord(
    record,
  ) {
    const plain =
      clone(
        record,
      )
      || {};

    return {
      ...plain,

      id:
        normalizeString(
          plain.id
          || plain._id,
        ),

      operationId:
        normalizeString(
          plain.operationId,
        ),

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      operationType:
        normalizeOperationType(
          plain.operationType,
        ),

      key:
        normalizeString(
          plain.key,
        ),

      fingerprint:
        normalizeString(
          plain.fingerprint,
        ),

      status:
        normalizeString(
          plain.status,
        )?.toUpperCase(),

      paymentId:
        normalizeString(
          plain.paymentId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference,
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

      version:
        Number(
          plain.version || 0,
        ),

      createdAt:
        parseDate(
          plain.createdAt,
        ),

      updatedAt:
        parseDate(
          plain.updatedAt,
        ),

      expiresAt:
        parseDate(
          plain.expiresAt,
        ),

      leaseExpiresAt:
        parseDate(
          plain.leaseExpiresAt,
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

      result:
        clone(
          plain.result,
        ),

      error:
        clone(
          plain.error,
        ),
    };
  }

  _assertTenant(
    tenantId,
  ) {
    if (
      this.options.requireTenant
      && !tenantId
    ) {
      throw new PaymentIdempotencyError(
        'Tenant context is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .TENANT_REQUIRED,
          statusCode: 403,
        },
      );
    }
  }

  _assertOperationType(
    operationType,
  ) {
    if (
      !operationType
    ) {
      throw new PaymentIdempotencyError(
        'Idempotency operation type is required.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .OPERATION_TYPE_REQUIRED,
          statusCode: 400,
        },
      );
    }
  }

  _assertFingerprintCompatibility(
    record,
    incomingFingerprint,
    identity,
  ) {
    if (
      !this.options
        .rejectFingerprintMismatch
    ) {
      return;
    }

    if (
      !record.fingerprint
      || !incomingFingerprint
    ) {
      return;
    }

    if (
      record.fingerprint
      === incomingFingerprint
    ) {
      return;
    }

    throw new PaymentIdempotencyError(
      'The idempotency key was already used with a different request.',
      {
        code:
          IDEMPOTENCY_ERROR_CODES
            .REQUEST_CONFLICT,
        statusCode: 409,
        tenantId:
          identity.tenantId,
        idempotencyKey:
          identity.key,
        operationType:
          identity.operationType,
        operationId:
          record.operationId,
        existingStatus:
          record.status,
      },
    );
  }

  _resolveExistingReservation(
    record,
    identity,
  ) {
    switch (
      record.status
    ) {
      case IDEMPOTENCY_STATUS.COMPLETED:
        if (
          this.options
            .replayCompletedResult
        ) {
          this._metric(
            'payment_idempotency_replay_total',
            1,
            {
              operationType:
                identity.operationType,
            },
          );

          return this._buildReservationResult(
            record,
            true,
          );
        }

        throw new PaymentIdempotencyError(
          'The payment operation has already completed.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_COMPLETED,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
          },
        );

      case IDEMPOTENCY_STATUS.UNKNOWN:
        throw new PaymentIdempotencyError(
          'The payment operation has an unknown outcome and requires reconciliation.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .UNKNOWN_OUTCOME,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
            unknownOutcome:
              true,
          },
        );

      case IDEMPOTENCY_STATUS.RESERVED:
      case IDEMPOTENCY_STATUS.PROCESSING:
        if (
          this._isLeaseExpired(
            record,
          )
          && this.options
            .allowLeaseRecovery
        ) {
          return this._buildReservationResult(
            record,
            true,
          );
        }

        throw new PaymentIdempotencyError(
          'The same payment operation is already in progress.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_IN_PROGRESS,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
            retryable:
              true,
          },
        );

      case IDEMPOTENCY_STATUS.FAILED:
        throw new PaymentIdempotencyError(
          'The previous payment operation failed.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_FAILED,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
            retryable:
              true,
          },
        );

      case IDEMPOTENCY_STATUS.EXPIRED:
        throw new PaymentIdempotencyError(
          'The idempotency record has expired.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .OPERATION_FAILED,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
          },
        );

      case IDEMPOTENCY_STATUS.RELEASED:
        /**
         * A released reservation is intentionally not considered reusable
         * automatically. The caller should generate a new logical key unless
         * an explicit repository-level reuse policy exists.
         */
        throw new PaymentIdempotencyError(
          'The idempotency reservation was released and must not be implicitly reused.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .KEY_REUSED,
            statusCode: 409,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
          },
        );

      default:
        throw new PaymentIdempotencyError(
          'Unknown idempotency status.',
          {
            code:
              IDEMPOTENCY_ERROR_CODES
                .INVALID_TRANSITION,
            statusCode: 500,
            tenantId:
              identity.tenantId,
            idempotencyKey:
              identity.key,
            operationType:
              identity.operationType,
            operationId:
              record.operationId,
            existingStatus:
              record.status,
          },
        );
    }
  }

  async _transitionStatus(
    record,
    targetStatus,
    options = {},
  ) {
    const current =
      this._normalizeRecord(
        record,
      );

    const expectedVersion =
      Number(
        current.version || 0,
      );

    const patch = {
      status:
        targetStatus,

      updatedAt:
        this._nowDate(),

      lastTransition:
        options.reasonCode
        || null,

      ...(options.extendLease
        ? {
            leaseExpiresAt:
              new Date(
                this._nowDate().getTime()
                + this.options
                  .processingLeaseMs,
              ),
          }
        : {}),

      ...(targetStatus
        === IDEMPOTENCY_STATUS.RELEASED
        ? {
            leaseExpiresAt:
              null,
          }
        : {}),

      ...(targetStatus
        === IDEMPOTENCY_STATUS.EXPIRED
        ? {
            expiresAt:
              this._nowDate(),
          }
        : {}),
    };

    const updated =
      await this._updateRecord(
        current,
        patch,
      );

    return this._buildProcessingResult(
      updated,
      {
        replay:
          false,
      },
    );
  }

  async _updateRecord(
    record,
    patch,
  ) {
    const expectedVersion =
      Number(
        record.version || 0,
      );

    let updated;

    try {
      updated =
        await this.repository.update({
          operationId:
            record.operationId,

          expectedVersion,

          patch: {
            ...patch,
            version:
              expectedVersion + 1,
          },
        });
    } catch (error) {
      this._logError(
        'Failed to update payment idempotency record.',
        error,
        {
          operationId:
            record.operationId,

          tenantId:
            record.tenantId,

          operationType:
            record.operationType,
        },
      );

      throw new PaymentIdempotencyError(
        'Payment idempotency storage is unavailable.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .STORAGE_UNAVAILABLE,
          statusCode: 503,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          cause:
            error,
        },
      );
    }

    if (!updated) {
      throw new PaymentIdempotencyError(
        'Another worker or request changed this idempotency operation concurrently.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .CONCURRENT_RESERVATION,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }

    return this._normalizeRecord(
      updated,
    );
  }

  async _recoverLease(
    record,
  ) {
    const current =
      this._normalizeRecord(
        record,
      );

    if (
      !this._isLeaseExpired(
        current,
      )
    ) {
      return null;
    }

    try {
      const recovered =
        await this._updateRecord(
          current,
          {
            status:
              IDEMPOTENCY_STATUS.PROCESSING,

            recoveryCount:
              Number(
                current.recoveryCount
                || 0,
              ) + 1,

            leaseExpiresAt:
              new Date(
                this._nowDate().getTime()
                + this.options
                  .processingLeaseMs,
              ),

            recoveryReason:
              'STALE_OPERATION_LEASE',
          },
        );

      await this._recordAudit(
        'IDEMPOTENCY_LEASE_RECOVERED',
        recovered,
      );

      this._metric(
        'payment_idempotency_lease_recovered_total',
        1,
        {
          operationType:
            recovered.operationType,
        },
      );

      return recovered;
    } catch (error) {
      this._logError(
        'Failed to recover stale payment idempotency lease.',
        error,
        {
          operationId:
            current.operationId,
          tenantId:
            current.tenantId,
        },
      );

      return null;
    }
  }

  _isLeaseExpired(
    record,
  ) {
    const expiry =
      parseDate(
        record.leaseExpiresAt,
      );

    return Boolean(
      expiry
      && expiry.getTime()
        <= this._nowDate()
          .getTime(),
    );
  }

  _assertCompletableStatus(
    record,
  ) {
    if (
      [
        IDEMPOTENCY_STATUS.COMPLETED,
        IDEMPOTENCY_STATUS.UNKNOWN,
        IDEMPOTENCY_STATUS.EXPIRED,
        IDEMPOTENCY_STATUS.RELEASED,
      ].includes(
        record.status,
      )
    ) {
      throw new PaymentIdempotencyError(
        'Idempotency operation cannot be completed from its current state.',
        {
          code:
            IDEMPOTENCY_ERROR_CODES
              .INVALID_TRANSITION,
          statusCode: 409,
          tenantId:
            record.tenantId,
          idempotencyKey:
            record.key,
          operationType:
            record.operationType,
          operationId:
            record.operationId,
          existingStatus:
            record.status,
        },
      );
    }
  }

  /* ==========================================================================
   * Public Result Shape
   * ======================================================================== */

  _buildReservationResult(
    record,
    replay,
  ) {
    return {
      success:
        true,

      reserved:
        true,

      replay:
        replay === true,

      operationId:
        record.operationId,

      idempotencyId:
        record.id,

      status:
        record.status,

      tenantId:
        record.tenantId,

      operationType:
        record.operationType,

      key:
        record.key,

      paymentId:
        record.paymentId
        || null,

      paymentReference:
        record.paymentReference
        || null,

      provider:
        record.provider
        || null,

      providerTransactionId:
        record.providerTransactionId
        || null,

      providerEventId:
        record.providerEventId
        || null,

      version:
        record.version,

      expiresAt:
        record.expiresAt,

      leaseExpiresAt:
        record.leaseExpiresAt,

      result:
        record.result
        || null,
    };
  }

  _buildProcessingResult(
    record,
    flags = {},
  ) {
    return {
      success:
        true,

      operationId:
        record.operationId,

      idempotencyId:
        record.id,

      status:
        record.status,

      tenantId:
        record.tenantId,

      operationType:
        record.operationType,

      key:
        record.key,

      paymentId:
        record.paymentId
        || null,

      paymentReference:
        record.paymentReference
        || null,

      provider:
        record.provider
        || null,

      providerTransactionId:
        record.providerTransactionId
        || null,

      providerEventId:
        record.providerEventId
        || null,

      version:
        record.version,

      replay:
        flags.replay === true,

      completed:
        flags.completed === true,

      failed:
        flags.failed === true,

      unknown:
        flags.unknown === true,

      recovered:
        flags.recovered === true,

      released:
        flags.released === true,

      retryable:
        Boolean(
          record.retryable,
        ),

      result:
        clone(
          record.result,
        ),
    };
  }

  _sanitizePublicRecord(
    record,
  ) {
    return {
      id:
        record.id,

      operationId:
        record.operationId,

      tenantId:
        record.tenantId,

      operationType:
        record.operationType,

      status:
        record.status,

      paymentId:
        record.paymentId,

      paymentReference:
        record.paymentReference,

      provider:
        record.provider,

      providerTransactionId:
        record.providerTransactionId,

      providerEventId:
        record.providerEventId,

      version:
        record.version,

      createdAt:
        record.createdAt,

      updatedAt:
        record.updatedAt,

      expiresAt:
        record.expiresAt,

      leaseExpiresAt:
        record.leaseExpiresAt,

      completedAt:
        record.completedAt,

      failedAt:
        record.failedAt,

      unknownAt:
        record.unknownAt,

      result:
        clone(
          record.result,
        ),

      /**
       * Never expose:
       *
       *   fingerprint
       *   raw request
       *   internal error stack
       *   secret-bearing metadata
       */
    };
  }

  /* ==========================================================================
   * Sanitization
   * ======================================================================== */

  _sanitizeResult(
    result,
  ) {
    const source =
      clone(
        result,
      );

    if (
      !source
      || typeof source
        !== 'object'
    ) {
      return source;
    }

    return this._sanitizeMetadata(
      source,
    );
  }

  _sanitizeError(
    error,
  ) {
    if (
      !error
    ) {
      return null;
    }

    if (
      typeof error === 'string'
    ) {
      return {
        code:
          IDEMPOTENCY_ERROR_CODES
            .OPERATION_FAILED,

        message:
          this._safeErrorMessage(
            error,
          ),
      };
    }

    return {
      code:
        error.code
        || IDEMPOTENCY_ERROR_CODES
          .OPERATION_FAILED,

      message:
        this._safeErrorMessage(
          error.message,
        ),

      statusCode:
        Number(
          error.statusCode
          || error.status
          || 0,
        )
        || null,

      retryable:
        error.retryable === true,

      unknownOutcome:
        error.unknownOutcome === true,
    };
  }

  _safeErrorMessage(
    message,
  ) {
    if (!message) {
      return 'Payment operation failed.';
    }

    const text =
      String(
        message,
      );

    /**
     * Avoid exposing full upstream exception details to persistence and later
     * replay responses.
     */
    return text.length > 500
      ? `${text.slice(0, 500)}...`
      : text;
  }

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata
        !== 'object'
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
      ]);

    const output = {};

    for (
      const [key, value]
      of Object.entries(
        metadata,
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
        clone(value);
    }

    return output;
  }

  _inferRetryability(
    error,
  ) {
    if (
      error
      && typeof error.retryable
        === 'boolean'
    ) {
      return error.retryable;
    }

    const code =
      String(
        error?.code
        || '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'UPSTREAM_TIMEOUT',
      'PROVIDER_UNAVAILABLE',
    ].includes(
      code,
    );
  }

  /* ==========================================================================
   * Audit / Metrics
   * ======================================================================== */

  async _recordAudit(
    action,
    record,
  ) {
    const payload = {
      action,

      tenantId:
        record.tenantId,

      operationId:
        record.operationId,

      idempotencyId:
        record.id,

      operationType:
        record.operationType,

      paymentId:
        record.paymentId
        || null,

      provider:
        record.provider
        || null,

      providerTransactionId:
        record.providerTransactionId
        || null,

      providerEventId:
        record.providerEventId
        || null,

      status:
        record.status,

      createdAt:
        isoNow(),
    };

    if (
      !this.auditService
    ) {
      return null;
    }

    try {
      if (
        typeof this.auditService
          .record === 'function'
      ) {
        return this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create === 'function'
      ) {
        return this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to record payment idempotency audit event.',
        error,
        {
          action,
          operationId:
            record.operationId,
        },
      );

      /**
       * Idempotency itself remains the primary safety control. Audit should
       * preferably be outbox-backed so its failure does not create an
       * inconsistent reservation state.
       */
      if (
        this.options.strictMode
      ) {
        throw error;
      }
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
        typeof this.metrics.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      /**
       * Metrics failures must never break payment processing.
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

            ...this._sanitizeMetadata(
              metadata,
            ),
          },
        );
      }
    } catch (_loggingError) {
      // Never mask the primary error.
    }
  }

  _nowDate() {
    const current =
      this.clock();

    if (
      current instanceof Date
    ) {
      return new Date(
        current.getTime(),
      );
    }

    if (
      typeof current === 'number'
    ) {
      return new Date(
        current,
      );
    }

    const parsed =
      new Date(
        current,
      );

    return Number.isNaN(
      parsed.getTime(),
    )
      ? new Date()
      : parsed;
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentIdempotencyService.STATUS =
  IDEMPOTENCY_STATUS;

PaymentIdempotencyService.STATUSES =
  IDEMPOTENCY_STATUS;

PaymentIdempotencyService.OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

PaymentIdempotencyService.ERROR_CODES =
  IDEMPOTENCY_ERROR_CODES;

PaymentIdempotencyService.PaymentIdempotencyError =
  PaymentIdempotencyError;

PaymentIdempotencyService.InMemoryRepository =
  InMemoryPaymentIdempotencyRepository;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentIdempotencyService(
  dependencies = {},
) {
  return new PaymentIdempotencyService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentIdempotencyService;

module.exports.PaymentIdempotencyService =
  PaymentIdempotencyService;

module.exports.PaymentIdempotencyError =
  PaymentIdempotencyError;

module.exports.InMemoryPaymentIdempotencyRepository =
  InMemoryPaymentIdempotencyRepository;

module.exports.createPaymentIdempotencyService =
  createPaymentIdempotencyService;

module.exports.PAYMENT_IDEMPOTENCY_STATUS =
  IDEMPOTENCY_STATUS;

module.exports.PAYMENT_IDEMPOTENCY_OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

module.exports.PAYMENT_IDEMPOTENCY_ERROR_CODES =
  IDEMPOTENCY_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */