'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Reconciliation Engine
 * ----------------------------------------------------------
 * File
 * ----
 * backend/modules/payment/mtn/reconciliation.js
 *
 * Architectural Role
 * ------------------
 * Provider-specific reconciliation adapter/orchestrator for
 * MTN MoMo financial transactions.
 *
 * Reconciliation purpose
 * ----------------------
 * Compare authoritative internal financial records with
 * provider-side transaction evidence and classify differences
 * without directly mutating ledger/balance state.
 *
 * Core flow
 * ---------
 *
 *   Internal Transactions
 *          +
 *   Provider Transactions
 *          ↓
 *      Normalize
 *          ↓
 *        Match
 *          ↓
 *   Variance Classification
 *          ↓
 *   Reconciliation Run
 *          ↓
 *   Exceptions / Cases
 *          ↓
 *   Optional Repair Workflow
 *          ↓
 *   Audit / Report / Outbox
 *
 * Responsibilities
 * ----------------
 * - Resolve tenant-scoped reconciliation context.
 * - Fetch MTN provider transaction evidence.
 * - Normalize provider responses.
 * - Load tenant-scoped internal transactions.
 * - Compare provider/internal references, amounts, currency and status.
 * - Detect duplicates and missing records.
 * - Classify reconciliation variances.
 * - Persist reconciliation-run results.
 * - Create exception/repair cases through the dedicated repair service.
 * - Generate reconciliation reports.
 * - Emit audit records and integration events.
 * - Expose operational health and diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - OAuth token lifecycle.
 * - Direct provider payment execution.
 * - Callback handling.
 * - Ledger mutation.
 * - Balance mutation.
 * - Silent transaction correction.
 * - Destructive financial data rewriting.
 * - Final financial settlement decision outside the canonical
 *   settlement/financial domain services.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Provider evidence is evidence, not financial truth by itself.
 * 2. Reconciliation must never silently "fix" ledger data.
 * 3. Monetary comparisons must not rely on unsafe floating-point
 *    arithmetic.
 * 4. Every reconciliation run is tenant-scoped and auditable.
 * 5. Variances require explicit classification and controlled resolution.
 * 6. A MATCHED reconciliation result does not itself perform ledger posting.
 * 7. Repair workflows must remain idempotent and approval-aware.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ==========================================================
 */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDER = 'MTN';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_PAGE_SIZE = 100;

const MAX_PAGE_SIZE = 500;

const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_MAX_RETRIES = 2;

const DEFAULT_RETRY_BASE_MS = 250;

const DEFAULT_RETRY_MAX_MS = 5_000;

const RECONCILIATION_TYPES = Object.freeze({
  COLLECTION: 'COLLECTION',
  DISBURSEMENT: 'DISBURSEMENT',
  ALL: 'ALL'
});

const RECONCILIATION_STATUSES = Object.freeze({
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  VARIANCE_FOUND: 'VARIANCE_FOUND',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  FAILED: 'FAILED'
});

const VARIANCE_TYPES = Object.freeze({
  MATCHED: 'MATCHED',
  MISSING_INTERNAL: 'MISSING_INTERNAL',
  MISSING_PROVIDER: 'MISSING_PROVIDER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  STATUS_MISMATCH: 'STATUS_MISMATCH',
  REFERENCE_MISMATCH: 'REFERENCE_MISMATCH',
  DUPLICATE_PROVIDER: 'DUPLICATE_PROVIDER',
  DUPLICATE_INTERNAL: 'DUPLICATE_INTERNAL',
  TIMESTAMP_MISMATCH: 'TIMESTAMP_MISMATCH',
  MULTIPLE_INTERNAL_MATCH: 'MULTIPLE_INTERNAL_MATCH',
  MULTIPLE_PROVIDER_MATCH: 'MULTIPLE_PROVIDER_MATCH',
  UNKNOWN_PROVIDER_STATUS: 'UNKNOWN_PROVIDER_STATUS',
  PROVIDER_DATA_INVALID: 'PROVIDER_DATA_INVALID',
  INTERNAL_DATA_INVALID: 'INTERNAL_DATA_INVALID',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW'
});

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'MTN_RECONCILIATION_INVALID_INPUT',
  TENANT_REQUIRED: 'MTN_RECONCILIATION_TENANT_REQUIRED',
  DATE_RANGE_INVALID: 'MTN_RECONCILIATION_DATE_RANGE_INVALID',
  DATE_RANGE_REQUIRED: 'MTN_RECONCILIATION_DATE_RANGE_REQUIRED',
  INVALID_TYPE: 'MTN_RECONCILIATION_INVALID_TYPE',
  AUTHENTICATION_FAILED: 'MTN_RECONCILIATION_AUTHENTICATION_FAILED',
  PROVIDER_REQUEST_FAILED: 'MTN_RECONCILIATION_PROVIDER_REQUEST_FAILED',
  PROVIDER_TIMEOUT: 'MTN_RECONCILIATION_PROVIDER_TIMEOUT',
  PROVIDER_RESPONSE_INVALID: 'MTN_RECONCILIATION_PROVIDER_RESPONSE_INVALID',
  INTERNAL_DATA_FAILED: 'MTN_RECONCILIATION_INTERNAL_DATA_FAILED',
  MATCHING_FAILED: 'MTN_RECONCILIATION_MATCHING_FAILED',
  PERSISTENCE_FAILED: 'MTN_RECONCILIATION_PERSISTENCE_FAILED',
  REPORT_FAILED: 'MTN_RECONCILIATION_REPORT_FAILED',
  REPAIR_FAILED: 'MTN_RECONCILIATION_REPAIR_FAILED',
  IDEMPOTENCY_CONFLICT: 'MTN_RECONCILIATION_IDEMPOTENCY_CONFLICT',
  DUPLICATE_RUN: 'MTN_RECONCILIATION_DUPLICATE_RUN',
  TENANT_SCOPE_VIOLATION: 'MTN_RECONCILIATION_TENANT_SCOPE_VIOLATION',
  CONFIGURATION_ERROR: 'MTN_RECONCILIATION_CONFIGURATION_ERROR',
  INTERNAL_ERROR: 'MTN_RECONCILIATION_INTERNAL_ERROR'
});

const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504
]);

const PROVIDER_SUCCESS_STATUSES = new Set([
  'SUCCESS',
  'SUCCESSFUL',
  'COMPLETED',
  'COMPLETE',
  'SETTLED'
]);

const PROVIDER_PENDING_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'IN_PROGRESS',
  'QUEUED',
  'ACCEPTED'
]);

const PROVIDER_FAILURE_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'REJECTED',
  'DECLINED',
  'CANCELLED',
  'CANCELED',
  'TIMEOUT'
]);

const DEFAULT_MAX_TIMESTAMP_DRIFT_MS = 15 * 60 * 1000;

const SECRET_KEY_PATTERN =
  /(authorization|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|cookie|credential)/i;

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

class MTNReconciliationError extends Error {
  constructor(
    message,
    code = ERROR_CODES.INTERNAL_ERROR,
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'MTNReconciliationError';

    this.code = code;

    this.retryable = Boolean(
      options.retryable
    );

    this.httpStatus =
      Number.isFinite(options.httpStatus)
        ? options.httpStatus
        : undefined;

    this.conflict =
      Boolean(options.conflict);

    this.rejected =
      Boolean(options.rejected);

    this.providerStatus =
      options.providerStatus;

    this.providerCode =
      options.providerCode;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        MTNReconciliationError
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeString(
  value,
  maxLength = 512
) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeId(value) {
  return normalizeString(
    value,
    256
  );
}

function normalizeDate(
  value
) {
  if (!value) {
    return undefined;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime()
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return undefined;
  }

  return date;
}

function createCorrelationId() {
  return `mtn-reconciliation-${crypto.randomUUID()}`;
}

function createRunId() {
  return `recon-${crypto.randomUUID()}`;
}

function createIdempotencyKey(
  input
) {
  if (
    input.idempotencyKey
  ) {
    return normalizeString(
      input.idempotencyKey,
      256
    );
  }

  return `mtn-reconciliation:${crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        tenantId:
          normalizeId(
            input.tenantId
          ),

        from:
          normalizeDate(
            input.from
          )?.toISOString(),

        to:
          normalizeDate(
            input.to
          )?.toISOString(),

        type:
          normalizeString(
            input.type,
            64
          )
      })
    )
    .digest('hex')}`;
}

function createRequestFingerprint(
  input
) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        tenantId:
          normalizeId(
            input.tenantId
          ),

        from:
          normalizeDate(
            input.from
          )?.toISOString(),

        to:
          normalizeDate(
            input.to
          )?.toISOString(),

        type:
          normalizeString(
            input.type,
            64
          )
      })
    )
    .digest('hex');
}

function isTransientStatus(
  status
) {
  return TRANSIENT_HTTP_STATUSES.has(
    Number(status)
  );
}

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function calculateRetryDelay(
  attempt,
  baseMs,
  maxMs
) {
  const exponential =
    baseMs *
    2 **
      Math.max(
        attempt - 1,
        0
      );

  const bounded =
    Math.min(
      exponential,
      maxMs
    );

  const jitter =
    Math.floor(
      Math.random() *
        Math.max(
          1,
          bounded * 0.25
        )
    );

  return Math.min(
    maxMs,
    bounded + jitter
  );
}

function sanitize(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    depth > 7
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string' &&
      value.length > 1024
      ? `${value.slice(
          0,
          1024
        )}...[TRUNCATED]`
      : value;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      (item) =>
        sanitize(
          item,
          depth + 1
        )
    );
  }

  if (
    typeof value === 'object'
  ) {
    const output = {};

    for (
      const [
        key,
        child
      ] of Object.entries(
        value
      )
    ) {
      output[key] =
        SECRET_KEY_PATTERN.test(
          key
        )
          ? '[REDACTED]'
          : sanitize(
              child,
              depth + 1
            );
    }

    return output;
  }

  return '[REDACTED]';
}

function serializeError(
  error
) {
  return sanitize({
    name:
      error?.name,

    code:
      error?.code,

    message:
      error?.message,

    retryable:
      error?.retryable,

    providerStatus:
      error?.providerStatus,

    providerCode:
      error?.providerCode
  });
}

function resolveLogger(
  injected
) {
  if (
    injected
  ) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath
        );

      const logger =
        loaded?.default ||
        loaded;

      if (
        logger
      ) {
        return logger;
      }
    } catch (
      _error
    ) {
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

/* -------------------------------------------------------------------------- */
/* Monetary safety                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Convert a decimal monetary string into integer minor units without using
 * JavaScript floating-point arithmetic.
 *
 * This function intentionally supports up to four fractional digits.
 */
function toMinorUnits(
  value,
  precision = 2
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(
      normalized
    )
  ) {
    return undefined;
  }

  const [
    whole,
    fraction = ''
  ] =
    normalized.split('.');

  const safeFraction =
    `${fraction}${'0'.repeat(
      precision
    )}`.slice(
      0,
      precision
    );

  return (
    BigInt(whole) *
      BigInt(
        10 ** precision
      ) +
    BigInt(
      safeFraction ||
        '0'
    )
  );
}

/**
 * Compare monetary values exactly at the configured precision.
 */
function amountsEqual(
  left,
  right,
  precision = 2
) {
  const leftMinor =
    toMinorUnits(
      left,
      precision
    );

  const rightMinor =
    toMinorUnits(
      right,
      precision
    );

  if (
    leftMinor ===
      undefined ||
    rightMinor ===
      undefined
  ) {
    return false;
  }

  return (
    leftMinor ===
    rightMinor
  );
}

/* -------------------------------------------------------------------------- */
/* Input normalization                                                        */
/* -------------------------------------------------------------------------- */

function normalizeType(
  type
) {
  const normalized =
    normalizeString(
      type ||
        RECONCILIATION_TYPES.ALL,
      64
    )?.toUpperCase();

  if (
    !Object.values(
      RECONCILIATION_TYPES
    ).includes(
      normalized
    )
  ) {
    throw new MTNReconciliationError(
      `Unsupported reconciliation type: ${normalized}.`,
      ERROR_CODES.INVALID_TYPE,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return normalized;
}

function validateDateRange(
  from,
  to
) {
  const start =
    normalizeDate(
      from
    );

  const end =
    normalizeDate(
      to
    );

  if (
    !start ||
    !end
  ) {
    throw new MTNReconciliationError(
      'Valid from and to dates are required for reconciliation.',
      ERROR_CODES.DATE_RANGE_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  if (
    start.getTime() >
    end.getTime()
  ) {
    throw new MTNReconciliationError(
      'Reconciliation from date cannot be after to date.',
      ERROR_CODES.DATE_RANGE_INVALID,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return {
    from:
      start,
    to:
      end
  };
}

/* -------------------------------------------------------------------------- */
/* Internal transaction normalization                                         */
/* -------------------------------------------------------------------------- */

function normalizeInternalTransaction(
  item
) {
  if (
    !item ||
    typeof item !==
      'object'
  ) {
    return {
      valid:
        false,

      varianceType:
        VARIANCE_TYPES.INTERNAL_DATA_INVALID,

      reason:
        'Internal transaction is not an object.'
    };
  }

  return {
    valid:
      true,

    tenantId:
      normalizeId(
        item.tenantId
      ),

    id:
      normalizeId(
        item._id ||
          item.id ||
          item.transactionId
      ),

    externalId:
      normalizeId(
        item.externalId
      ),

    reference:
      normalizeId(
        item.reference ||
          item.transactionReference
      ),

    providerTransactionId:
      normalizeId(
        item.providerTransactionId
      ),

    amount:
      item.amount !==
        undefined &&
      item.amount !==
        null
        ? String(
            item.amount
          )
        : undefined,

    currency:
      normalizeString(
        item.currency ||
          DEFAULT_CURRENCY,
        16
      )?.toUpperCase(),

    status:
      normalizeString(
        item.status ||
          item.state,
        128
      )?.toUpperCase(),

    provider:
      normalizeString(
        item.provider,
        64
      )?.toUpperCase(),

    type:
      normalizeString(
        item.type,
        128
      )?.toUpperCase(),

    occurredAt:
      normalizeDate(
        item.createdAt ||
          item.occurredAt ||
          item.transactionDate ||
          item.updatedAt
      )
  };
}

/* -------------------------------------------------------------------------- */
/* Provider transaction normalization                                         */
/* -------------------------------------------------------------------------- */

function classifyProviderStatus(
  status
) {
  const normalized =
    normalizeString(
      status,
      128
    )?.toUpperCase();

  if (!normalized) {
    return {
      normalized,
      category:
        'UNKNOWN'
    };
  }

  if (
    PROVIDER_SUCCESS_STATUSES.has(
      normalized
    )
  ) {
    return {
      normalized,
      category:
        'SUCCESS'
    };
  }

  if (
    PROVIDER_PENDING_STATUSES.has(
      normalized
    )
  ) {
    return {
      normalized,
      category:
        'PENDING'
    };
  }

  if (
    PROVIDER_FAILURE_STATUSES.has(
      normalized
    )
  ) {
    return {
      normalized,
      category:
        'FAILED'
    };
  }

  return {
    normalized,
    category:
      'UNKNOWN'
  };
}

function normalizeProviderTransaction(
  item
) {
  if (
    !item ||
    typeof item !==
      'object'
  ) {
    return {
      valid:
        false,

      varianceType:
        VARIANCE_TYPES.PROVIDER_DATA_INVALID,

      reason:
        'Provider transaction is not an object.'
    };
  }

  const classification =
    classifyProviderStatus(
      item.status ||
        item.state
    );

  return {
    valid:
      true,

    provider:
      PROVIDER,

    externalId:
      normalizeId(
        item.financialTransactionId ||
          item.transactionId ||
          item.externalId
      ),

    reference:
      normalizeId(
        item.externalId ||
          item.reference ||
          item.referenceId
      ),

    providerTransactionId:
      normalizeId(
        item.financialTransactionId ||
          item.transactionId ||
          item.providerTransactionId
      ),

    amount:
      item.amount !==
        undefined &&
      item.amount !==
        null
        ? String(
            item.amount
          )
        : undefined,

    currency:
      normalizeString(
        item.currency ||
          DEFAULT_CURRENCY,
        16
      )?.toUpperCase(),

    status:
      classification.normalized,

    statusCategory:
      classification.category,

    occurredAt:
      normalizeDate(
        item.createdAt ||
          item.timestamp ||
          item.transactionDate ||
          item.date ||
          item.updatedAt
      ),

    rawMeta: {
      providerReference:
        normalizeId(
          item.financialTransactionId ||
            item.transactionId
        ),

      providerStatus:
        classification.normalized
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Generate candidate matching keys.
 *
 * The order reflects strongest available identity first.
 */
function matchingKeys(
  transaction
) {
  const keys = [];

  if (
    transaction.providerTransactionId
  ) {
    keys.push(
      `provider:${transaction.providerTransactionId}`
    );
  }

  if (
    transaction.externalId
  ) {
    keys.push(
      `external:${transaction.externalId}`
    );
  }

  if (
    transaction.reference
  ) {
    keys.push(
      `reference:${transaction.reference}`
    );
  }

  return keys;
}

function indexTransactions(
  transactions
) {
  const index =
    new Map();

  for (
    const transaction of
      transactions
  ) {
    for (
      const key of
        matchingKeys(
          transaction
        )
    ) {
      const existing =
        index.get(
          key
        ) || [];

      existing.push(
        transaction
      );

      index.set(
        key,
        existing
      );
    }
  }

  return index;
}

function findBestMatch(
  source,
  candidateIndex
) {
  const candidates =
    [];

  const seen =
    new Set();

  for (
    const key of
      matchingKeys(
        source
      )
  ) {
    const matches =
      candidateIndex.get(
        key
      ) || [];

    for (
      const match of
        matches
    ) {
      const id =
        normalizeId(
          match.id
        );

      if (
        id &&
        seen.has(id)
      ) {
        continue;
      }

      if (
        id
      ) {
        seen.add(id);
      }

      candidates.push(
        {
          key,
          match
        }
      );
    }
  }

  if (
    candidates.length ===
    1
  ) {
    return {
      type:
        'SINGLE',
      match:
        candidates[0].match
    };
  }

  if (
    candidates.length >
    1
  ) {
    /*
     * Multiple internal/provider candidates are not silently disambiguated.
     * They become a reconciliation exception.
     */
    return {
      type:
        'AMBIGUOUS',
      candidates:
        candidates.map(
          (item) =>
            item.match
        )
    };
  }

  return {
    type:
      'NONE'
  };
}

/**
 * Build a single comparison result.
 */
function comparePair(
  internal,
  provider,
  options = {}
) {
  const {
    maxTimestampDriftMs =
      DEFAULT_MAX_TIMESTAMP_DRIFT_MS,
    currencyPrecision = 2
  } = options;

  const variances =
    [];

  /*
   * Tenant integrity.
   */
  if (
    internal.tenantId !==
    provider.tenantId &&
    provider.tenantId
  ) {
    variances.push({
      type:
        VARIANCE_TYPES.REQUIRES_REVIEW,
      reason:
        'Provider/internal tenant identifiers do not agree.'
    });
  }

  /*
   * Provider identity.
   */
  if (
    internal.provider &&
    internal.provider !==
      PROVIDER
  ) {
    variances.push({
      type:
        VARIANCE_TYPES.PROVIDER_DATA_INVALID,
      reason:
        'Internal transaction provider is not MTN.'
    });
  }

  /*
   * Amount.
   */
  if (
    internal.amount !==
      undefined &&
    provider.amount !==
      undefined &&
    !amountsEqual(
      internal.amount,
      provider.amount,
      currencyPrecision
    )
  ) {
    variances.push({
      type:
        VARIANCE_TYPES.AMOUNT_MISMATCH,

      internalAmount:
        internal.amount,

      providerAmount:
        provider.amount
    });
  }

  /*
   * Currency.
   */
  if (
    internal.currency &&
    provider.currency &&
    internal.currency !==
      provider.currency
  ) {
    variances.push({
      type:
        VARIANCE_TYPES.CURRENCY_MISMATCH,

      internalCurrency:
        internal.currency,

      providerCurrency:
        provider.currency
    });
  }

  /*
   * Status.
   */
  const providerStatus =
    classifyProviderStatus(
      provider.status
    );

  if (
    providerStatus.category ===
    'UNKNOWN'
  ) {
    variances.push({
      type:
        VARIANCE_TYPES.UNKNOWN_PROVIDER_STATUS,

      providerStatus:
        provider.status
    });
  }

  /*
   * Compare broad financial semantics rather than blindly comparing provider
   * status strings with internal domain statuses.
   */
  if (
    internal.status
  ) {
    const internalStatus =
      internal.status;

    const internallySuccessful =
      [
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'SETTLED',
        'POSTED',
        'CONFIRMED'
      ].includes(
        internalStatus
      );

    const internallyFailed =
      [
        'FAILED',
        'CANCELLED',
        'CANCELED',
        'REVERSED'
      ].includes(
        internalStatus
      );

    if (
      providerStatus.category ===
        'SUCCESS' &&
      internallyFailed
    ) {
      variances.push({
        type:
          VARIANCE_TYPES.STATUS_MISMATCH,

        internalStatus,

        providerStatus:
          provider.status
      });
    }

    if (
      providerStatus.category ===
        'FAILED' &&
      internallySuccessful
    ) {
      variances.push({
        type:
          VARIANCE_TYPES.STATUS_MISMATCH,

        internalStatus,

        providerStatus:
          provider.status
      });
    }
  }

  /*
   * Timestamp comparison is informative, not absolute. Provider systems can
   * have clock/processing delays.
   */
  if (
    internal.occurredAt &&
    provider.occurredAt
  ) {
    const drift =
      Math.abs(
        internal.occurredAt.getTime() -
          provider.occurredAt.getTime()
      );

    if (
      drift >
      maxTimestampDriftMs
    ) {
      variances.push({
        type:
          VARIANCE_TYPES.TIMESTAMP_MISMATCH,

        driftMs:
          drift,

        internalTimestamp:
          internal.occurredAt,

        providerTimestamp:
          provider.occurredAt
      });
    }
  }

  const matched =
    variances.length ===
    0;

  return {
    matched,

    status:
      matched
        ? VARIANCE_TYPES.MATCHED
        : VARIANCE_TYPES.REQUIRES_REVIEW,

    variances
  };
}

/**
 * Perform deterministic provider/internal matching.
 */
function matchTransactions(
  providerTransactions,
  internalTransactions,
  options = {}
) {
  const providerIndex =
    indexTransactions(
      providerTransactions
    );

  const internalIndex =
    indexTransactions(
      internalTransactions
    );

  const matched = [];
  const unmatched = [];
  const variances = [];

  const matchedInternalIds =
    new Set();

  const matchedProviderIds =
    new Set();

  /*
   * Provider → Internal matching.
   */
  for (
    const provider of
      providerTransactions
  ) {
    const result =
      findBestMatch(
        provider,
        internalIndex
      );

    if (
      result.type ===
      'NONE'
    ) {
      unmatched.push({
        varianceType:
          VARIANCE_TYPES.MISSING_INTERNAL,

        provider
      });

      continue;
    }

    if (
      result.type ===
      'AMBIGUOUS'
    ) {
      const entry = {
        varianceType:
          VARIANCE_TYPES.MULTIPLE_INTERNAL_MATCH,

        provider,

        candidates:
          result.candidates
      };

      variances.push(
        entry
      );

      unmatched.push(
        entry
      );

      continue;
    }

    const internal =
      result.match;

    const comparison =
      comparePair(
        internal,
        provider,
        options
      );

    const providerId =
      normalizeId(
        provider.id ||
          provider.providerTransactionId ||
          provider.externalId
      );

    const internalId =
      normalizeId(
        internal.id ||
          internal.providerTransactionId ||
          internal.externalId
      );

    if (
      providerId
    ) {
      if (
        matchedProviderIds.has(
          providerId
        )
      ) {
        const duplicate = {
          varianceType:
            VARIANCE_TYPES.DUPLICATE_PROVIDER,

          provider
        };

        variances.push(
          duplicate
        );

        unmatched.push(
          duplicate
        );

        continue;
      }

      matchedProviderIds.add(
        providerId
      );
    }

    if (
      internalId
    ) {
      if (
        matchedInternalIds.has(
          internalId
        )
      ) {
        const duplicate = {
          varianceType:
            VARIANCE_TYPES.DUPLICATE_INTERNAL,

          internal,

          provider
        };

        variances.push(
          duplicate
        );

        unmatched.push(
          duplicate
        );

        continue;
      }

      matchedInternalIds.add(
        internalId
      );
    }

    if (
      comparison.matched
    ) {
      matched.push({
        internal,
        provider,
        matchKey:
          result.key,
        comparison
      });
    } else {
      const entry = {
        varianceType:
          comparison.variances[0]
            ?.type ||
          VARIANCE_TYPES.REQUIRES_REVIEW,

        internal,
        provider,

        variances:
          comparison.variances,

        matchKey:
          result.key
      };

      variances.push(
        entry
      );

      unmatched.push(
        entry
      );
    }
  }

  /*
   * Internal → Provider second pass catches internal records that have no
   * provider-side counterpart.
   */
  for (
    const internal of
      internalTransactions
  ) {
    const internalId =
      normalizeId(
        internal.id ||
          internal.providerTransactionId ||
          internal.externalId
      );

    if (
      internalId &&
      matchedInternalIds.has(
        internalId
      )
    ) {
      continue;
    }

    const result =
      findBestMatch(
        internal,
        providerIndex
      );

    if (
      result.type ===
      'NONE'
    ) {
      const entry = {
        varianceType:
          VARIANCE_TYPES.MISSING_PROVIDER,

        internal
      };

      variances.push(
        entry
      );

      unmatched.push(
        entry
      );
    } else if (
      result.type ===
      'AMBIGUOUS'
    ) {
      const entry = {
        varianceType:
          VARIANCE_TYPES.MULTIPLE_PROVIDER_MATCH,

        internal,

        candidates:
          result.candidates
      };

      variances.push(
        entry
      );

      unmatched.push(
        entry
      );
    }
  }

  return {
    matched,
    unmatched,
    variances,

    summary: {
      matched:
        matched.length,

      unmatched:
        unmatched.length,

      variances:
        variances.length,

      missingInternal:
        unmatched.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.MISSING_INTERNAL
        ).length,

      missingProvider:
        unmatched.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.MISSING_PROVIDER
        ).length,

      amountMismatch:
        variances.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.AMOUNT_MISMATCH
        ).length,

      currencyMismatch:
        variances.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.CURRENCY_MISMATCH
        ).length,

      statusMismatch:
        variances.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.STATUS_MISMATCH
        ).length,

      duplicateProvider:
        variances.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.DUPLICATE_PROVIDER
        ).length,

      duplicateInternal:
        variances.filter(
          (item) =>
            item.varianceType ===
            VARIANCE_TYPES.DUPLICATE_INTERNAL
        ).length
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Class                                                                      */
/* -------------------------------------------------------------------------- */

class MTNReconciliation {
  constructor({
    authService,

    httpClient,

    configuration,

    transactionRepository,

    ledgerService,

    settlementRepository,

    reconciliationRepository,

    matcher,

    repairService,

    reportGenerator,

    auditService,

    eventPublisher,

    outboxService,

    idempotencyManager,

    tenantResolver,

    authorizationService,

    logger,

    metrics,

    tracer,

    config = {}
  } = {}) {
    this.authService =
      authService;

    this.httpClient =
      httpClient;

    this.configuration =
      configuration;

    this.transactionRepository =
      transactionRepository;

    this.ledgerService =
      ledgerService;

    this.settlementRepository =
      settlementRepository;

    /*
     * Preferred:
     * dedicated reconciliation repository.
     *
     * The old implementation persisted reconciliation results through
     * settlementRepository.create(), which conflates two distinct concepts.
     */
    this.reconciliationRepository =
      reconciliationRepository;

    this.matcher =
      matcher;

    this.repairService =
      repairService;

    this.reportGenerator =
      reportGenerator;

    this.auditService =
      auditService;

    this.eventPublisher =
      eventPublisher;

    this.outboxService =
      outboxService;

    this.idempotencyManager =
      idempotencyManager;

    this.tenantResolver =
      tenantResolver;

    this.authorizationService =
      authorizationService;

    this.logger =
      resolveLogger(
        logger
      );

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.config = {
      timeoutMs:
        Number.isFinite(
          config.timeoutMs
        ) &&
        config.timeoutMs > 0
          ? config.timeoutMs
          : DEFAULT_TIMEOUT_MS,

      maxRetries:
        Number.isFinite(
          config.maxRetries
        ) &&
        config.maxRetries >= 0
          ? config.maxRetries
          : DEFAULT_MAX_RETRIES,

      retryBaseMs:
        Number.isFinite(
          config.retryBaseMs
        ) &&
        config.retryBaseMs > 0
          ? config.retryBaseMs
          : DEFAULT_RETRY_BASE_MS,

      retryMaxMs:
        Number.isFinite(
          config.retryMaxMs
        ) &&
        config.retryMaxMs > 0
          ? config.retryMaxMs
          : DEFAULT_RETRY_MAX_MS,

      defaultPageSize:
        Number.isFinite(
          config.defaultPageSize
        ) &&
        config.defaultPageSize > 0
          ? Math.min(
              config.defaultPageSize,
              MAX_PAGE_SIZE
            )
          : DEFAULT_PAGE_SIZE,

      maxPageSize:
        MAX_PAGE_SIZE,

      maxTimestampDriftMs:
        Number.isFinite(
          config.maxTimestampDriftMs
        ) &&
        config.maxTimestampDriftMs >= 0
          ? config.maxTimestampDriftMs
          : DEFAULT_MAX_TIMESTAMP_DRIFT_MS,

      currencyPrecision:
        Number.isFinite(
          config.currencyPrecision
        ) &&
        config.currencyPrecision >= 0 &&
        config.currencyPrecision <= 8
          ? config.currencyPrecision
          : 2,

      requireTenant:
        config.requireTenant !==
        undefined
          ? Boolean(
              config.requireTenant
            )
          : true,

      autoCreateRepairCases:
        config.autoCreateRepairCases !==
        undefined
          ? Boolean(
              config.autoCreateRepairCases
            )
          : true,

      useOutbox:
        config.useOutbox !==
        undefined
          ? Boolean(
              config.useOutbox
            )
          : true
    };

    this.statistics = {
      executions: 0,
      matched: 0,
      unmatched: 0,
      variances: 0,
      failed: 0,
      providerRequests: 0,
      providerFailures: 0,
      repairCasesCreated: 0
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Tenant                                                                   */
  /* ------------------------------------------------------------------------ */

  async resolveTenant(
    input
  ) {
    if (
      input.tenantId
    ) {
      return normalizeId(
        input.tenantId
      );
    }

    if (
      !this.config.requireTenant
    ) {
      return undefined;
    }

    if (
      !this.tenantResolver
    ) {
      throw new MTNReconciliationError(
        'Tenant could not be resolved.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400,
          rejected:
            true
        }
      );
    }

    if (
      typeof this
        .tenantResolver
        .resolveMTN ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolveMTN(
          {
            provider:
              PROVIDER,
            input
          }
        );

      const tenantId =
        normalizeId(
          result?.tenantId ||
            result?.id ||
            result
        );

      if (
        !tenantId
      ) {
        throw new MTNReconciliationError(
          'Tenant resolution returned no tenant.',
          ERROR_CODES.TENANT_REQUIRED
        );
      }

      return tenantId;
    }

    if (
      typeof this
        .tenantResolver
        .resolve ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolve(
          {
            provider:
              PROVIDER,
            input
          }
        );

      const tenantId =
        normalizeId(
          result?.tenantId ||
            result?.id ||
            result
        );

      if (
        !tenantId
      ) {
        throw new MTNReconciliationError(
          'Tenant resolution returned no tenant.',
          ERROR_CODES.TENANT_REQUIRED
        );
      }

      return tenantId;
    }

    throw new MTNReconciliationError(
      'Tenant resolver contract is unsupported.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Authorization                                                            */
  /* ------------------------------------------------------------------------ */

  async assertAuthorized(
    input
  ) {
    if (
      !this.authorizationService
    ) {
      return true;
    }

    const payload = {
      tenantId:
        input.tenantId,

      actorId:
        input.requestedBy,

      action:
        'payment.reconciliation.execute',

      resource:
        'mtn_reconciliation',

      resourceId:
        input.runId
    };

    if (
      typeof this
        .authorizationService
        .assert ===
      'function'
    ) {
      await this.authorizationService.assert(
        payload
      );

      return true;
    }

    if (
      typeof this
        .authorizationService
        .can ===
      'function'
    ) {
      const allowed =
        await this.authorizationService.can(
          payload
        );

      if (
        !allowed
      ) {
        throw new MTNReconciliationError(
          'MTN reconciliation operation is not authorized.',
          ERROR_CODES.CONFIGURATION_ERROR,
          undefined,
          {
            httpStatus:
              403,
            rejected:
              true
          }
        );
      }
    }

    return true;
  }

  /* ------------------------------------------------------------------------ */
  /* Idempotency                                                              */
  /* ------------------------------------------------------------------------ */

  async checkIdempotency(
    input
  ) {
    if (
      !this.idempotencyManager
    ) {
      return null;
    }

    const request = {
      tenantId:
        input.tenantId,

      provider:
        PROVIDER,

      idempotencyKey:
        input.idempotencyKey,

      requestFingerprint:
        input.requestFingerprint
    };

    let result;

    if (
      typeof this
        .idempotencyManager
        .check ===
      'function'
    ) {
      result =
        await this.idempotencyManager.check(
          request
        );
    } else if (
      typeof this
        .idempotencyManager
        .get ===
      'function'
    ) {
      result =
        await this.idempotencyManager.get(
          request
        );
    }

    if (
      !result
    ) {
      return null;
    }

    const storedFingerprint =
      result.requestFingerprint ||
      result.fingerprint;

    if (
      storedFingerprint &&
      storedFingerprint !==
        input.requestFingerprint
    ) {
      throw new MTNReconciliationError(
        'Reconciliation idempotency key was reused for a different request.',
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        undefined,
        {
          httpStatus:
            409,
          conflict:
            true
        }
      );
    }

    return result;
  }

  async registerIdempotency(
    input,
    result
  ) {
    if (
      !this.idempotencyManager
    ) {
      return;
    }

    const request = {
      tenantId:
        input.tenantId,

      provider:
        PROVIDER,

      idempotencyKey:
        input.idempotencyKey,

      requestFingerprint:
        input.requestFingerprint,

      result
    };

    if (
      typeof this
        .idempotencyManager
        .register ===
      'function'
    ) {
      await this.idempotencyManager.register(
        request
      );

      return;
    }

    if (
      typeof this
        .idempotencyManager
        .store ===
      'function'
    ) {
      await this.idempotencyManager.store(
        request
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Provider retrieval                                                       */
  /* ------------------------------------------------------------------------ */

  async fetchProviderTransactions({
    tenantId,
    from,
    to,
    type,
    correlationId,
    pageSize =
      this.config.defaultPageSize
  }) {
    if (
      !this.authService
    ) {
      throw new MTNReconciliationError(
        'MTN authentication service is not configured.',
        ERROR_CODES.AUTHENTICATION_FAILED
      );
    }

    if (
      !this.httpClient ||
      typeof this
        .httpClient
        .request !==
        'function'
    ) {
      throw new MTNReconciliationError(
        'HTTP client is not configured for MTN reconciliation.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    const token =
      await this.authService.getAccessToken(
        {
          tenantId,
          correlationId
        }
      );

    if (
      !token
    ) {
      throw new MTNReconciliationError(
        'MTN access token is unavailable.',
        ERROR_CODES.AUTHENTICATION_FAILED
      );
    }

    const endpoint =
      this.reconciliationEndpoint();

    const safePageSize =
      Math.min(
        Math.max(
          Number(pageSize) ||
            this.config.defaultPageSize,
          1
        ),
        this.config.maxPageSize
      );

    let page =
      0;

    let cursor;

    const allTransactions =
      [];

    const seenProviderIds =
      new Set();

    while (true) {
      page += 1;

      this.statistics.providerRequests +=
        1;

      let response;

      let attempt =
        0;

      let lastError;

      while (
        attempt <=
        this.config.maxRetries
      ) {
        attempt += 1;

        try {
          response =
            await this.httpClient.request(
              {
                method:
                  'GET',

                url:
                  endpoint,

                headers: {
                  Authorization:
                    `Bearer ${token}`,

                  Accept:
                    'application/json'
                },

                params: {
                  from:
                    from.toISOString(),

                  to:
                    to.toISOString(),

                  type,

                  limit:
                    safePageSize,

                  page,

                  ...(cursor
                    ? {
                        cursor
                      }
                    : {})
                },

                correlationId,

                timeoutMs:
                  this.config.timeoutMs
              }
            );

          break;
        } catch (
          error
        ) {
          lastError =
            normalizeReconciliationError(
              error
            );

          if (
            !lastError.retryable ||
            attempt >
              this.config.maxRetries
          ) {
            break;
          }

          const delay =
            calculateRetryDelay(
              attempt,
              this.config.retryBaseMs,
              this.config.retryMaxMs
            );

          await sleep(
            delay
          );
        }
      }

      if (
        !response
      ) {
        this.statistics.providerFailures +=
          1;

        throw (
          lastError ||
          new MTNReconciliationError(
            'MTN provider transaction request failed.',
            ERROR_CODES.PROVIDER_REQUEST_FAILED,
            undefined,
            {
              retryable:
                true
            }
          )
        );
      }

      const httpStatus =
        Number(
          response.status
        );

      if (
        response.ok ===
          false &&
        isTransientStatus(
          httpStatus
        )
      ) {
        this.statistics.providerFailures +=
          1;

        throw new MTNReconciliationError(
          'MTN provider reconciliation endpoint is temporarily unavailable.',
          ERROR_CODES.PROVIDER_REQUEST_FAILED,
          undefined,
          {
            retryable:
              true,
            providerStatus:
              String(
                httpStatus
              )
          }
        );
      }

      if (
        response.ok ===
          false
      ) {
        this.statistics.providerFailures +=
          1;

        throw new MTNReconciliationError(
          'MTN provider reconciliation request failed.',
          ERROR_CODES.PROVIDER_REQUEST_FAILED,
          undefined,
          {
            retryable:
              false,
            providerStatus:
              String(
                httpStatus
              )
        );
      }

      const data =
        response.body ||
        response.data ||
        {};

      const pageTransactions =
        Array.isArray(
          data
            .transactions
        )
          ? data.transactions
          : Array.isArray(
              data
                .content
            )
            ? data.content
            : Array.isArray(
                data
                  .items
              )
              ? data.items
              : [];

      const normalized =
        this.normalizeProviderTransactions(
          {
            transactions:
              pageTransactions
          }
        );

      /*
       * Preserve provider-side duplicates for reconciliation classification
       * instead of deduplicating them away.
       */
      for (
        const transaction of
          normalized
      ) {
        const identity =
          transaction.providerTransactionId ||
          transaction.externalId ||
          transaction.reference;

        if (
          identity
        ) {
          const duplicate =
            seenProviderIds.has(
              identity
            );

          if (
            duplicate
          ) {
            transaction._duplicateInFetch =
              true;
          }

          seenProviderIds.add(
            identity
          );
        }

        allTransactions.push(
          transaction
        );
      }

      const nextCursor =
        normalizeString(
          data.nextCursor ||
            data.next_cursor ||
            data.cursor,
          512
        );

      const hasMore =
        Boolean(
          data.hasMore ||
            data.has_more ||
            nextCursor
        );

      if (
        !hasMore
      ) {
        break;
      }

      if (
        nextCursor
      ) {
        cursor =
          nextCursor;
      } else if (
        pageTransactions.length ===
        0
      ) {
        break;
      }

      /*
       * Defensive upper bound. A malformed provider response should not
       * create an infinite reconciliation loop.
       */
      if (
        page >
        10_000
      ) {
        throw new MTNReconciliationError(
          'MTN provider pagination exceeded the safety limit.',
          ERROR_CODES.PROVIDER_RESPONSE_INVALID
        );
      }
    }

    return allTransactions;
  }

  /* ------------------------------------------------------------------------ */
  /* Provider normalization                                                   */
  /* ------------------------------------------------------------------------ */

  normalizeProviderTransactions(
    data = {}
  ) {
    const transactions =
      Array.isArray(
        data.transactions
      )
        ? data.transactions
        : [];

    return transactions.map(
      (item) =>
        normalizeProviderTransaction(
          item
        )
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Internal loading                                                         */
  /* ------------------------------------------------------------------------ */

  async loadInternalTransactions({
    tenantId,
    from,
    to,
    type
  }) {
    if (
      !this.transactionRepository
    ) {
      throw new MTNReconciliationError(
        'Transaction repository is not configured.',
        ERROR_CODES.INTERNAL_DATA_FAILED
      );
    }

    const filters = {
      tenantId,

      from,

      to,

      provider:
        PROVIDER
    };

    if (
      type &&
      type !==
        RECONCILIATION_TYPES.ALL
    ) {
      filters.operationType =
        type;
    }

    let result;

    if (
      typeof this
        .transactionRepository
        .findBetween ===
      'function'
    ) {
      result =
        await this.transactionRepository.findBetween(
          filters
        );
    } else if (
      typeof this
        .transactionRepository
        .findForReconciliation ===
      'function'
    ) {
      result =
        await this.transactionRepository.findForReconciliation(
          filters
        );
    } else if (
      typeof this
        .transactionRepository
        .findByDateRange ===
      'function'
    ) {
      result =
        await this.transactionRepository.findByDateRange(
          filters
        );
    } else {
      throw new MTNReconciliationError(
        'Transaction repository does not expose a reconciliation query method.',
        ERROR_CODES.INTERNAL_DATA_FAILED
      );
    }

    if (
      !Array.isArray(
        result
      )
    ) {
      throw new MTNReconciliationError(
        'Internal transaction repository returned invalid data.',
        ERROR_CODES.INTERNAL_DATA_FAILED
      );
    }

    return result
      .map(
        (item) =>
          normalizeInternalTransaction(
            item
          )
      )
      .filter(
        (item) =>
          item.valid !==
          false
      );
  }

  /* ------------------------------------------------------------------------ */
  /* Matching                                                                 */
  /* ------------------------------------------------------------------------ */

  async executeMatching({
    providerTransactions,
    internalTransactions
  }) {
    if (
      this.matcher &&
      typeof this
        .matcher
        .match ===
      'function'
    ) {
      const result =
        await this.matcher.match(
          {
            providerTransactions,
            internalTransactions
          }
        );

      if (
        result
      ) {
        return {
          ...matchTransactions(
            providerTransactions,
            internalTransactions,
            {
              maxTimestampDriftMs:
                this.config.maxTimestampDriftMs,

              currencyPrecision:
                this.config.currencyPrecision
            }
          ),

          ...result
        };
      }
    }

    return matchTransactions(
      providerTransactions,
      internalTransactions,
      {
        maxTimestampDriftMs:
          this.config.maxTimestampDriftMs,

        currencyPrecision:
          this.config.currencyPrecision
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Reconciliation persistence                                               */
  /* ------------------------------------------------------------------------ */

  async persistRun(
    input
  ) {
    const payload = {
      runId:
        input.runId,

      tenantId:
        input.tenantId,

      provider:
        PROVIDER,

      type:
        input.type,

      from:
        input.from,

      to:
        input.to,

      correlationId:
        input.correlationId,

      idempotencyKey:
        input.idempotencyKey,

      requestFingerprint:
        input.requestFingerprint,

      status:
        input.status,

      counts:
        input.counts,

      matched:
        input.counts?.matched || 0,

      unmatched:
        input.counts?.unmatched || 0,

      variances:
        input.counts?.variances || 0,

      metadata:
        sanitize(
          input.metadata ||
            {}
        )
    };

    /*
     * A dedicated reconciliation repository is preferred because a
     * reconciliation run is not itself a settlement.
     */
    if (
      this.reconciliationRepository
    ) {
      if (
        typeof this
          .reconciliationRepository
          .create ===
        'function'
      ) {
        return this.reconciliationRepository.create(
          payload
        );
      }

      if (
        typeof this
          .reconciliationRepository
          .save ===
        'function'
      ) {
        return this.reconciliationRepository.save(
          payload
        );
      }
    }

    /*
     * Backward compatibility for current deployments.
     *
     * Do not treat this repository as the preferred long-term architecture.
     */
    if (
      this.settlementRepository &&
      typeof this
        .settlementRepository
        .createReconciliationRun ===
      'function'
    ) {
      return this.settlementRepository.createReconciliationRun(
        payload
      );
    }

    throw new MTNReconciliationError(
      'No reconciliation persistence boundary is configured.',
      ERROR_CODES.PERSISTENCE_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Repair cases                                                             */
  /* ------------------------------------------------------------------------ */

  async createRepairCases(
    input
  ) {
    if (
      !input.unmatched?.length
    ) {
      return {
        created:
          0
      };
    }

    if (
      !this.repairService ||
      typeof this
        .repairService
        .createCases !==
        'function'
    ) {
      /*
       * Variances remain persisted in the reconciliation run even when case
       * management is not configured.
       */
      this.logger.warn?.(
        {
          provider:
            PROVIDER,

          tenantId:
            input.tenantId,

          runId:
            input.runId,

          unmatched:
            input.unmatched.length
        },
        'MTN repair service is not configured; reconciliation variances remain unresolved'
      );

      return {
        created:
          0,

        skipped:
          true
      };
    }

    const result =
      await this.repairService.createCases(
        {
          tenantId:
            input.tenantId,

          provider:
            PROVIDER,

          reconciliationRunId:
            input.runId,

          transactions:
            input.unmatched,

          correlationId:
            input.correlationId
        }
      );

    const created =
      Number(
        result?.created ||
          result?.count
      ) ||
      (
        Array.isArray(
          result?.cases
        )
          ? result.cases.length
          : 0
      );

    this.statistics.repairCasesCreated +=
      created;

    return {
      created,

      result
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Report                                                                   */
  /* ------------------------------------------------------------------------ */

  async generateReport(
    input
  ) {
    if (
      !this.reportGenerator
    ) {
      return undefined;
    }

    if (
      typeof this
        .reportGenerator
        .generate !==
      'function'
    ) {
      throw new MTNReconciliationError(
        'Report generator does not expose generate().',
        ERROR_CODES.REPORT_FAILED
      );
    }

    return this.reportGenerator.generate(
      {
        tenantId:
          input.tenantId,

        provider:
          PROVIDER,

        runId:
          input.runId,

        type:
          input.type,

        from:
          input.from,

        to:
          input.to,

        result:
          input.result,

        correlationId:
          input.correlationId
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Audit                                                                    */
  /* ------------------------------------------------------------------------ */

  async audit(
    eventType,
    input,
    metadata = {}
  ) {
    if (
      !this.auditService
    ) {
      return;
    }

    const payload = {
      eventType,

      action:
        eventType,

      provider:
        PROVIDER,

      tenantId:
        input.tenantId,

      runId:
        input.runId,

      correlationId:
        input.correlationId,

      metadata:
        sanitize(
          metadata
        )
    };

    try {
      if (
        typeof this
          .auditService
          .recordEvent ===
        'function'
      ) {
        await this.auditService.recordEvent(
          eventType,
          payload
        );

        return;
      }

      if (
        typeof this
          .auditService
          .record ===
        'function'
      ) {
        await this.auditService.record(
          payload
        );
      }
    } catch (
      error
    ) {
      /*
       * Audit failure must be observable. It must not fabricate a successful
       * reconciliation result.
       */
      this.logger.error?.(
        {
          provider:
            PROVIDER,

          tenantId:
            input.tenantId,

          runId:
            input.runId,

          correlationId:
            input.correlationId,

          error:
            serializeError(
              error
            )
        },
        'Failed to persist MTN reconciliation audit event'
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Events / outbox                                                          */
  /* ------------------------------------------------------------------------ */

  async publishEvent(
    input
  ) {
    const event = {
      type:
        'MTN_RECONCILIATION_COMPLETED',

      provider:
        PROVIDER,

      tenantId:
        input.tenantId,

      aggregateType:
        'ReconciliationRun',

      aggregateId:
        input.runId,

      correlationId:
        input.correlationId,

      occurredAt:
        new Date(),

      idempotencyKey:
        `${input.idempotencyKey}:event`,

      payload: {
        status:
          input.status,

        matched:
          input.counts?.matched ||
          0,

        unmatched:
          input.counts?.unmatched ||
          0,

        variances:
          input.counts?.variances ||
          0
      }
    };

    if (
      this.config.useOutbox &&
      this.outboxService
    ) {
      if (
        typeof this
          .outboxService
          .enqueue ===
        'function'
      ) {
        return this.outboxService.enqueue(
          event
        );
      }

      if (
        typeof this
          .outboxService
          .publishTransactional ===
        'function'
      ) {
        return this.outboxService.publishTransactional(
          event
        );
      }
    }

    if (
      this.eventPublisher &&
      typeof this
        .eventPublisher
        .publish ===
      'function'
    ) {
      return this.eventPublisher.publish(
        event
      );
    }

    return {
      published:
        false,

      skipped:
        true
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Execute reconciliation                                                   */
  /* ------------------------------------------------------------------------ */

  async reconcile(
    input = {}
  ) {
    const span =
      this.tracer?.startSpan?.(
        'payment.mtn.reconciliation'
      );

    const startedAt =
      new Date();

    this.statistics.executions +=
      1;

    let normalized;

    try {
      normalized = {
        tenantId:
          normalizeId(
            input.tenantId
          ),

        from:
          input.from,

        to:
          input.to,

        type:
          normalizeType(
            input.type
          ),

        requestedBy:
          normalizeId(
            input.requestedBy
          ),

        correlationId:
          normalizeId(
            input.correlationId
          ) ||
          createCorrelationId(),

        runId:
          normalizeId(
            input.runId
          ) ||
          createRunId()
      };

      if (
        !normalized.tenantId
      ) {
        normalized.tenantId =
          await this.resolveTenant(
            input
          );
      }

      if (
        !normalized.tenantId
      ) {
        throw new MTNReconciliationError(
          'tenantId is required.',
          ERROR_CODES.TENANT_REQUIRED,
          undefined,
          {
            httpStatus:
              400,
            rejected:
              true
          }
        );
      }

      const dateRange =
        validateDateRange(
          normalized.from,
          normalized.to
        );

      normalized.from =
        dateRange.from;

      normalized.to =
        dateRange.to;

      normalized.idempotencyKey =
        createIdempotencyKey(
          {
            ...normalized,
            idempotencyKey:
              input.idempotencyKey
          }
        );

      normalized.requestFingerprint =
        createRequestFingerprint(
          normalized
        );

      await this.assertAuthorized(
        normalized
      );

      /*
       * Idempotency protects the reconciliation run itself. It does not
       * replace transaction-level idempotency.
       */
      const existing =
        await this.checkIdempotency(
          normalized
        );

      if (
        existing
      ) {
        this.metrics?.counter?.(
          'payment_mtn_reconciliation_duplicate_total',
          {
            tenantId:
              normalized.tenantId
          }
        );

        return {
          success:
            true,

          idempotent:
            true,

          duplicate:
            true,

          tenantId:
            normalized.tenantId,

          runId:
            existing.runId ||
            existing.result?.runId,

          status:
            existing.status ||
            existing.result?.status,

          correlationId:
            normalized.correlationId
        };
      }

      this.logger.info?.(
        {
          provider:
            PROVIDER,

          tenantId:
            normalized.tenantId,

          runId:
            normalized.runId,

          correlationId:
            normalized.correlationId,

          from:
            normalized.from,

          to:
            normalized.to,

          type:
            normalized.type
        },
        'Starting MTN reconciliation'
      );

      await this.audit(
        'MTN_RECONCILIATION_STARTED',
        normalized,
        {
          from:
            normalized.from,

          to:
            normalized.to,

          type:
            normalized.type
        }
      );

      /*
       * 1. Provider-side evidence.
       */
      const providerTransactions =
        await this.fetchProviderTransactions(
          {
            tenantId:
              normalized.tenantId,

            from:
              normalized.from,

            to:
              normalized.to,

            type:
              normalized.type,

            correlationId:
              normalized.correlationId,

            pageSize:
              input.pageSize
          }
        );

      /*
       * 2. Internal transaction evidence.
       */
      const internalTransactions =
        await this.loadInternalTransactions(
          {
            tenantId:
              normalized.tenantId,

            from:
              normalized.from,

            to:
              normalized.to,

            type:
              normalized.type
          }
        );

      /*
       * 3. Matching.
       */
      const result =
        await this.executeMatching(
          {
            providerTransactions,
            internalTransactions
          }
        );

      const counts = {
        providerTransactions:
          providerTransactions.length,

        internalTransactions:
          internalTransactions.length,

        matched:
          result.matched.length,

        unmatched:
          result.unmatched.length,

        variances:
          result.variances.length,

        ...result.summary
      };

      this.statistics.matched +=
        counts.matched;

      this.statistics.unmatched +=
        counts.unmatched;

      this.statistics.variances +=
        counts.variances;

      const status =
        counts.unmatched > 0 ||
        counts.variances > 0
          ? RECONCILIATION_STATUSES.VARIANCE_FOUND
          : RECONCILIATION_STATUSES.COMPLETED;

      /*
       * 4. Persist reconciliation run.
       */
      await this.persistRun(
        {
          ...normalized,

          status,

          counts,

          metadata: {
            startedAt,

            completedAt:
              new Date(),

            provider:
              PROVIDER
          }
        }
      );

      /*
       * 5. Create operational repair cases.
       */
      let repairResult = {
        created:
          0
      };

      if (
        this.config
          .autoCreateRepairCases &&
        counts.unmatched > 0
      ) {
        try {
          repairResult =
            await this.createRepairCases(
              {
                tenantId:
                  normalized.tenantId,

                runId:
                  normalized.runId,

                unmatched:
                  result.unmatched,

                correlationId:
                  normalized.correlationId
              }
            );
        } catch (
          repairError
        ) {
          /*
           * A repair queue failure must not erase the reconciliation result.
           * The variance remains authoritative and visible for operations.
           */
          this.logger.error?.(
            {
              provider:
                PROVIDER,

              tenantId:
                normalized.tenantId,

              runId:
                normalized.runId,

              correlationId:
                normalized.correlationId,

              error:
                serializeError(
                  repairError
                )
            },
            'MTN reconciliation repair case creation failed'
          );

          await this.audit(
            'MTN_RECONCILIATION_REPAIR_FAILED',
            normalized,
            {
              error:
                serializeError(
                  repairError
                )
            }
          );
        }
      }

      /*
       * 6. Report.
       */
      let report;

      try {
        report =
          await this.generateReport(
            {
              tenantId:
                normalized.tenantId,

              runId:
                normalized.runId,

              type:
                normalized.type,

              from:
                normalized.from,

              to:
                normalized.to,

              result: {
                ...result,
                counts
              },

              correlationId:
                normalized.correlationId
            }
          );
      } catch (
        reportError
      ) {
        await this.audit(
          'MTN_RECONCILIATION_REPORT_FAILED',
          normalized,
          {
            error:
              serializeError(
                reportError
              )
          }
        );

        throw new MTNReconciliationError(
          'MTN reconciliation completed but report generation failed.',
          ERROR_CODES.REPORT_FAILED,
          undefined,
          {
            retryable:
              false
          }
        );
      }

      /*
       * 7. Audit final result.
       */
      await this.audit(
        'MTN_RECONCILIATION_COMPLETED',
        normalized,
        {
          status,

          counts,

          repairCasesCreated:
            repairResult.created || 0
        }
      );

      /*
       * 8. Publish/outbox event.
       */
      try {
        await this.publishEvent(
          {
            ...normalized,

            status,

            counts
          }
        );
      } catch (
        eventError
      ) {
        /*
         * Event failure remains an operational concern. Production deployments
         * should use transactional outbox semantics rather than direct
         * publication.
         */
        this.logger.error?.(
          {
            provider:
              PROVIDER,

            tenantId:
              normalized.tenantId,

            runId:
              normalized.runId,

            correlationId:
              normalized.correlationId,

            error:
              serializeError(
                eventError
              )
          },
          'MTN reconciliation event publication failed'
        );
      }

      const response = {
        success:
          true,

        provider:
          PROVIDER,

        tenantId:
          normalized.tenantId,

        runId:
          normalized.runId,

        correlationId:
          normalized.correlationId,

        status,

        matched:
          counts.matched,

        unmatched:
          counts.unmatched,

        variances:
          counts.variances,

        counts,

        repairCasesCreated:
          repairResult.created || 0,

        report
      };

      await this.registerIdempotency(
        normalized,
        response
      );

      this.metrics?.counter?.(
        'payment_mtn_reconciliation_success_total',
        {
          tenantId:
            normalized.tenantId,

          status
        }
      );

      this.logger.info?.(
        {
          provider:
            PROVIDER,

          tenantId:
            normalized.tenantId,

          runId:
            normalized.runId,

          correlationId:
            normalized.correlationId,

          status,

          matched:
            counts.matched,

          unmatched:
            counts.unmatched,

          variances:
            counts.variances
        },
        'MTN reconciliation completed'
      );

      return response;
    } catch (
      error
    ) {
      this.statistics.failed +=
        1;

      const normalizedError =
        normalizeReconciliationError(
          error
        );

      this.metrics?.counter?.(
        'payment_mtn_reconciliation_failure_total',
        {
          tenantId:
            normalized?.tenantId,

          code:
            normalizedError.code
        }
      );

      if (
        normalized
      ) {
        try {
          await this.persistRun(
            {
              ...normalized,

              status:
                RECONCILIATION_STATUSES.FAILED,

              counts: {
                matched:
                  0,

                unmatched:
                  0,

                variances:
                  0
              },

              metadata: {
                startedAt,

                failedAt:
                  new Date(),

                error:
                  serializeError(
                    normalizedError
                  )
              }
            }
          );
        } catch (
          persistenceError
        ) {
          this.logger.error?.(
            {
              provider:
                PROVIDER,

              tenantId:
                normalized.tenantId,

              runId:
                normalized.runId,

              error:
                serializeError(
                  persistenceError
                )
            },
            'Failed to persist MTN reconciliation failure state'
          );
        }

        await this.audit(
          'MTN_RECONCILIATION_FAILED',
          normalized,
          {
            error:
              serializeError(
                normalizedError
              )
          }
        );
      }

      this.logger.error?.(
        {
          provider:
            PROVIDER,

          tenantId:
            normalized?.tenantId,

          runId:
            normalized?.runId,

          correlationId:
            normalized?.correlationId,

          error:
            serializeError(
              normalizedError
            )
        },
        'MTN reconciliation failed'
      );

      throw normalizedError;
    } finally {
      span?.setAttribute?.(
        'payment.provider',
        PROVIDER
      );

      span?.setAttribute?.(
        'payment.operation',
        'reconciliation'
      );

      span?.end?.();
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Single-settlement reconciliation                                         */
  /* ------------------------------------------------------------------------ */

  async reconcileSettlement({
    tenantId,
    settlement,
    providerEvidence,
    context = {}
  }) {
    const resolvedTenantId =
      normalizeId(
        tenantId ||
          settlement?.tenantId
      );

    if (
      !resolvedTenantId
    ) {
      throw new MTNReconciliationError(
        'tenantId is required for settlement reconciliation.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const internal =
      normalizeInternalTransaction(
        {
          ...settlement,
          tenantId:
            resolvedTenantId
        }
      );

    const provider =
      normalizeProviderTransaction(
        providerEvidence
      );

    if (
      provider.valid ===
      false
    ) {
      throw new MTNReconciliationError(
        'Provider evidence is invalid.',
        ERROR_CODES.PROVIDER_RESPONSE_INVALID
      );
    }

    provider.tenantId =
      resolvedTenantId;

    const comparison =
      comparePair(
        internal,
        provider,
        {
          maxTimestampDriftMs:
            this.config.maxTimestampDriftMs,

          currencyPrecision:
            this.config.currencyPrecision
        }
      );

    const id =
      createRunId();

    if (
      comparison.matched
    ) {
      await this.audit(
        'MTN_SETTLEMENT_RECONCILED',
        {
          tenantId:
            resolvedTenantId,

          runId:
            id,

          correlationId:
            context.correlationId
        },
        {
          settlementId:
            internal.id,

          providerTransactionId:
            provider.providerTransactionId
        }
      );

      return {
        id,

        status:
          'MATCHED',

        matched:
          true,

        tenantId:
          resolvedTenantId,

        settlementId:
          internal.id,

        providerTransactionId:
          provider.providerTransactionId
      };
    }

    const variance =
      comparison.variances[0] ||
      {
        type:
          VARIANCE_TYPES.REQUIRES_REVIEW
      };

    await this.audit(
      'MTN_SETTLEMENT_RECONCILIATION_VARIANCE',
      {
        tenantId:
          resolvedTenantId,

        runId:
          id,

        correlationId:
          context.correlationId
      },
      {
        settlementId:
          internal.id,

        providerTransactionId:
          provider.providerTransactionId,

        variance:
          sanitize(
            variance
          )
      }
    );

    return {
      id,

      status:
        'REQUIRES_REVIEW',

      matched:
        false,

      tenantId:
        resolvedTenantId,

      settlementId:
        internal.id,

      providerTransactionId:
        provider.providerTransactionId,

      variance
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Endpoint                                                                  */
  /* ------------------------------------------------------------------------ */

  reconciliationEndpoint() {
    if (
      !this.configuration ||
      typeof this
        .configuration
        .getEndpoints !==
      'function'
    ) {
      throw new MTNReconciliationError(
        'MTN endpoint configuration is not available.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    const endpoints =
      this.configuration.getEndpoints() ||
      {};

    const configured =
      normalizeString(
        endpoints.reconciliation ||
          endpoints.collection,
        1024
      );

    if (
      !configured
    ) {
      throw new MTNReconciliationError(
        'MTN reconciliation endpoint is not configured.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    /*
     * Support deployments where configuration.collection points to the
     * collection base endpoint, while allowing a dedicated reconciliation
     * endpoint when provided.
     */
    if (
      /\/transactions\/?$/.test(
        configured
      )
    ) {
      return configured;
    }

    return `${configured.replace(
      /\/+$/,
      ''
    )}/transactions`;
  }

  /* ------------------------------------------------------------------------ */
  /* Health                                                                   */
  /* ------------------------------------------------------------------------ */

  health() {
    const dependencies = {
      authService:
        Boolean(
          this.authService
        ),

      httpClient:
        Boolean(
          this.httpClient
        ),

      configuration:
        Boolean(
          this.configuration
        ),

      transactionRepository:
        Boolean(
          this.transactionRepository
        ),

      reconciliationRepository:
        Boolean(
          this.reconciliationRepository
        ),

      matcher:
        Boolean(
          this.matcher
        ),

      repairService:
        Boolean(
          this.repairService
        ),

      reportGenerator:
        Boolean(
          this.reportGenerator
        ),

      auditService:
        Boolean(
          this.auditService
        ),

      outboxService:
        Boolean(
          this.outboxService
        ),

      idempotencyManager:
        Boolean(
          this.idempotencyManager
        )
    };

    const required =
      dependencies.authService &&
      dependencies.httpClient &&
      dependencies.configuration &&
      dependencies.transactionRepository &&
      (
        dependencies.reconciliationRepository ||
        (
          this
            .settlementRepository &&
          typeof this
            .settlementRepository
            .createReconciliationRun ===
          'function'
        )
      );

    return {
      provider:
        PROVIDER,

      module:
        'reconciliation',

      status:
        required
          ? 'UP'
          : 'DOWN',

      requiredDependenciesReady:
        required,

      dependencies,

      statistics: {
        ...this.statistics
      },

      configuration: {
        timeoutMs:
          this.config.timeoutMs,

        maxRetries:
          this.config.maxRetries,

        defaultPageSize:
          this.config.defaultPageSize,

        maxPageSize:
          this.config.maxPageSize,

        maxTimestampDriftMs:
          this.config.maxTimestampDriftMs,

        currencyPrecision:
          this.config.currencyPrecision,

        requireTenant:
          this.config.requireTenant,

        autoCreateRepairCases:
          this.config.autoCreateRepairCases,

        useOutbox:
          this.config.useOutbox
      }
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Diagnostics                                                              */
  /* ------------------------------------------------------------------------ */

  diagnostics() {
    return sanitize({
      provider:
        PROVIDER,

      module:
        'reconciliation',

      statistics:
        this.statistics,

      configuration:
        this.config
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Public matching helpers                                                  */
  /* ------------------------------------------------------------------------ */

  comparePair(
    internal,
    provider,
    options = {}
  ) {
    return comparePair(
      normalizeInternalTransaction(
        internal
      ),
      normalizeProviderTransaction(
        provider
      ),
      {
        maxTimestampDriftMs:
          options.maxTimestampDriftMs ||
          this.config.maxTimestampDriftMs,

        currencyPrecision:
          options.currencyPrecision ??
          this.config.currencyPrecision
      }
    );
  }

  match(
    providerTransactions,
    internalTransactions,
    options = {}
  ) {
    return matchTransactions(
      providerTransactions.map(
        normalizeProviderTransaction
      ),
      internalTransactions.map(
        normalizeInternalTransaction
      ),
      {
        maxTimestampDriftMs:
          options.maxTimestampDriftMs ||
          this.config.maxTimestampDriftMs,

        currencyPrecision:
          options.currencyPrecision ??
          this.config.currencyPrecision
      }
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Error normalization                                                        */
/* -------------------------------------------------------------------------- */

function normalizeReconciliationError(
  error
) {
  if (
    error instanceof
    MTNReconciliationError
  ) {
    return error;
  }

  const message =
    normalizeString(
      error?.message,
      1000
    ) ||
    'MTN reconciliation failed.';

  const providerStatus =
    error?.response?.status ||
    error?.providerStatus;

  const retryable =
    Boolean(
      error?.retryable
    ) ||
    isTransientStatus(
      providerStatus
    ) ||
    /timeout|temporar|unavailable|ECONNRESET|ECONNREFUSED|deadlock|lock/i.test(
      message
    );

  let code =
    normalizeString(
      error?.code,
      256
    ) ||
    ERROR_CODES.INTERNAL_ERROR;

  if (
    /timeout/i.test(
      message
    )
  ) {
    code =
      ERROR_CODES.PROVIDER_TIMEOUT;
  }

  return new MTNReconciliationError(
    message,
    code,
    undefined,
    {
      retryable,

      httpStatus:
        Number.isFinite(
          error?.httpStatus
        )
          ? error.httpStatus
          : undefined,

      providerStatus,

      providerCode:
        error?.providerCode,

      conflict:
        Boolean(
          error?.conflict
        ),

      rejected:
        Boolean(
          error?.rejected
        )
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports =
  MTNReconciliation;

module.exports.MTNReconciliation =
  MTNReconciliation;

module.exports.MTNReconciliationError =
  MTNReconciliationError;

module.exports.RECONCILIATION_TYPES =
  RECONCILIATION_TYPES;

module.exports.RECONCILIATION_STATUSES =
  RECONCILIATION_STATUSES;

module.exports.VARIANCE_TYPES =
  VARIANCE_TYPES;

module.exports.ERROR_CODES =
  ERROR_CODES;

module.exports.matchTransactions =
  matchTransactions;

module.exports.comparePair =
  comparePair;

module.exports.normalizeProviderTransaction =
  normalizeProviderTransaction;

module.exports.normalizeInternalTransaction =
  normalizeInternalTransaction;

module.exports.amountsEqual =
  amountsEqual;