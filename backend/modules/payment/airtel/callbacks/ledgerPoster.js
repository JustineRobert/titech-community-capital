/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Ledger Poster
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/ledgerPoster.js
 *
 * Architectural role
 * ------------------
 * Canonical accounting adapter between the Airtel callback processing boundary
 * and TITech's authoritative financial ledger engine / Financial Core.
 *
 * Canonical flow
 * --------------
 * Airtel callback
 *   -> signature / validation
 *   -> normalization / correlation
 *   -> callback processor
 *   -> THIS ADAPTER
 *   -> Financial Core / Ledger Engine
 *   -> authoritative journal / entries
 *   -> outbox / audit / reconciliation
 *
 * Responsibilities
 * ----------------
 * - Validate the exact tenant-scoped financial posting request.
 * - Require an explicit balanced posting shape or an injected canonical
 *   posting builder/account resolver.
 * - Preserve transaction, provider, callback and idempotency identities.
 * - Generate deterministic posting identity when none is supplied.
 * - Prevent duplicate local in-flight postings.
 * - Delegate accounting mutation to the injected authoritative financial
 *   boundary only.
 * - Normalize the authoritative posting result and expose replay semantics.
 * - Provide reversal/lookup helpers without implementing accounting itself.
 * - Publish bounded audit/events and metrics.
 * - Provide health/readiness/diagnostics/capabilities.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Airtel HTTP/API calls or OAuth.
 * - Callback signature verification.
 * - Callback payload validation.
 * - Correlation lookup.
 * - Fraud/KYC/AML adjudication.
 * - Accounting rule ownership.
 * - Direct journal/ledger persistence.
 * - Direct balance or wallet mutation.
 * - Settlement finality independent of Financial Core evidence.
 * - Blind retry of ambiguous financial operations.
 * - Rewriting historical financial entries.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Financial Core / Ledger Engine remains the accounting source of truth.
 * 2. Provider success alone never authorizes a ledger post; the caller must
 *    supply an authoritative correlated payment/transaction context.
 * 3. Pending, ambiguous, unknown, failed or rejected provider outcomes are
 *    rejected for accounting mutation.
 * 4. Every financial post requires an explicit tenant and idempotency identity.
 * 5. Double-entry shape is explicit; this adapter never invents accounts.
 * 6. Duplicate posting is replay-safe and never silently creates another
 *    journal.
 * 7. Ledger posting success does not by itself redefine provider settlement.
 * 8. Observability failures never reverse or alter authoritative accounting.
 * 9. Recovery/reversal always uses a distinct corrective identity linked to the
 *    original journal/transaction identity.
 *
 * Module format
 * -------------
 * Native ESM. External dependencies are intentionally avoided.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const COMPONENT = 'titech.airtel.callbacks.ledger-poster';
export const ENGINE_NAME = 'airtel-callback-ledger-poster';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const POSTING_STATUS = Object.freeze({
  POSTED: 'POSTED',
  REPLAYED: 'REPLAYED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

export const PROVIDER_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILURE: 'FAILURE',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
  REJECTED: 'REJECTED',
});

export const DEFAULTS = Object.freeze({
  defaultCurrency: 'UGX',
  maxReferenceLength: 256,
  maxDescriptionLength: 1024,
  maxMetadataBytes: 64 * 1024,
  postTimeoutMs: 15_000,
  lookupTimeoutMs: 5_000,
  maxRetries: 0,
  retryBackoffMs: 150,
  maxConcurrentPostings: 100,
  localLockTtlMs: 30_000,
  requireTenantId: true,
  requireIdempotencyKey: true,
  requireTransactionId: true,
  requireExplicitEntries: true,
  requireFinancialCore: true,
  allowProviderPending: false,
  allowProviderAmbiguous: false,
  allowProviderUnknown: false,
  audit: true,
  publishEvents: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  failClosedOnLookupError: true,
  failClosedOnFinancialCoreError: true,
  minorUnitDefaults: Object.freeze({
    UGX: 0,
    KES: 2,
    TZS: 2,
    RWF: 0,
    GHS: 2,
    ZMW: 2,
    NGN: 2,
    USD: 2,
    EUR: 2,
    GBP: 2,
  }),
});

const SENSITIVE_KEYS = /authorization|cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan/i;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFunction(value) {
  return typeof value === 'function';
}

function now(clock) {
  const value = isFunction(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function id() {
  return crypto.randomUUID();
}

function normalizeString(value, max = 1024) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}

function normalizeUpper(value, max = 128) {
  const result = normalizeString(value, max);
  return result ? result.toUpperCase() : null;
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decimalString(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;

    return value
      .toFixed(12)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
  }

  const result = String(value).trim();

  if (!/^\d+(?:\.\d+)?$/.test(result)) return null;
  if (Number(result) <= 0) return null;

  return result;
}

function canonicalize(value, depth = 0) {
  if (depth > 10) return '[DEPTH_LIMIT]';

  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${sha256(value)}]`;
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item) =>
        canonicalize(
          item,
          depth + 1,
        ),
      );
  }

  return Object.keys(value)
    .sort()
    .reduce(
      (result, key) => {
        if (
          BLOCKED_KEYS.has(
            key,
          )
        ) {
          return result;
        }

        result[key] =
          canonicalize(
            value[key],
            depth + 1,
          );

        return result;
      },
      {},
    );
}

function sha256(value) {
  const input =
    Buffer.isBuffer(value)
      ? value
      : typeof value === 'string'
        ? value
        : JSON.stringify(
            canonicalize(
              value,
            ),
          );

  return crypto
    .createHash(
      HASH_ALGORITHM,
    )
    .update(input)
    .digest('hex');
}

function safeClone(
  value,
  depth = 0,
) {
  if (depth > 8) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER_REDACTED]';
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) =>
        safeClone(
          item,
          depth + 1,
        ),
      );
  }

  return Object.entries(
    value,
  ).reduce(
    (
      result,
      [key, child],
    ) => {
      if (
        BLOCKED_KEYS.has(
          key,
        )
      ) {
        return result;
      }

      if (
        SENSITIVE_KEYS.test(
          key,
        )
      ) {
        result[key] =
          '[REDACTED]';

        return result;
      }

      result[key] =
        safeClone(
          child,
          depth + 1,
        );

      return result;
    },
    {},
  );
}

function byteLength(
  value,
) {
  try {
    return Buffer.byteLength(
      JSON.stringify(
        canonicalize(
          value,
        ),
      ),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function firstFunction(
  target,
  names = [],
) {
  return names.find(
    (name) =>
      isFunction(
        target?.[name],
      ),
  ) || null;
}

function firstValue(
  source,
  paths = [],
) {
  for (
    const path of paths
  ) {
    let current =
      source;

    for (
      const segment of
        path.split('.')
    ) {
      if (
        !isObject(
          current,
        ) &&
        !Array.isArray(
          current,
        )
      ) {
        current =
          undefined;

        break;
      }

      current =
        current?.[
          segment
        ];
    }

    if (
      current !== undefined &&
      current !== null &&
      current !== ''
    ) {
      return current;
    }
  }

  return null;
}

function extractTransactionId(
  transaction = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'transactionId',
        'financialTransactionId',
        'id',
        '_id',
        'uuid',
      ],
    ),
    256,
  );
}

function extractPaymentId(
  transaction = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'paymentId',
        'payment.id',
        'id',
        '_id',
      ],
    ),
    256,
  );
}

function extractCollectionId(
  transaction = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'collectionId',
        'collection.id',
      ],
    ),
    256,
  );
}

function extractProviderReference(
  transaction = {},
  callback = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'providerReference',
        'providerTransactionId',
        'airtelTransactionId',
        'externalTransactionId',
      ],
    ) ||
      firstValue(
        callback,
        [
          'providerReference',
          'providerTransactionId',
          'airtelTransactionId',
          'transactionId',
        ],
      ),
    256,
  );
}

function extractPaymentReference(
  transaction = {},
  callback = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'paymentReference',
        'externalReference',
        'clientReference',
        'reference',
      ],
    ) ||
      firstValue(
        callback,
        [
          'paymentReference',
          'externalReference',
        ],
      ),
    256,
  );
}

function extractTransactionReference(
  transaction = {},
  callback = {},
) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'transactionReference',
        'reference',
      ],
    ) ||
      firstValue(
        callback,
        [
          'transactionReference',
        ],
      ),
    256,
  );
}

function extractCurrency(
  transaction = {},
  callback = {},
) {
  return normalizeUpper(
    firstValue(
      transaction,
      [
        'currency',
        'currencyCode',
        'money.currency',
      ],
    ) ||
      firstValue(
        callback,
        [
          'currency',
        ],
      ),
    8,
  );
}

function extractAmount(
  transaction = {},
  callback = {},
) {
  const explicitMinor =
    firstValue(
      transaction,
      [
        'amountMinor',
        'amountInMinorUnits',
        'minorAmount',
      ],
    ) ??
    firstValue(
      callback,
      [
        'amountMinor',
        'amountInMinorUnits',
      ],
    );

  const amount =
    firstValue(
      transaction,
      [
        'amount',
        'transactionAmount',
        'grossAmount',
      ],
    ) ??
    firstValue(
      callback,
      [
        'amount',
      ],
    );

  return {
    amount:
      decimalString(
        amount,
      ),

    amountMinor:
      explicitMinor !== null &&
      explicitMinor !== undefined
        ? normalizeMinorString(
            explicitMinor,
          )
        : null,
  };
}

function normalizeMinorString(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const result =
    String(
      value,
    ).trim();

  if (
    !/^\d+$/.test(
      result,
    )
  ) {
    return null;
  }

  const number =
    Number(
      result,
    );

  return Number.isSafeInteger(
    number,
  )
    ? String(
        number,
      )
    : null;
}

function minorToDecimal(
  minorValue,
  currency,
  defaults,
) {
  const minor =
    normalizeMinorString(
      minorValue,
    );

  if (!minor) {
    return null;
  }

  const exponent =
    Number(
      defaults?.[
        currency
      ] ?? 2,
    );

  if (
    !Number.isInteger(
      exponent,
    ) ||
    exponent < 0
  ) {
    return null;
  }

  if (exponent === 0) {
    return minor;
  }

  const padded =
    minor.padStart(
      exponent + 1,
      '0',
    );

  const integerPart =
    padded.slice(
      0,
      -exponent,
    ) || '0';

  const fractionPart =
    padded.slice(
      -exponent,
    );

  return `${integerPart}.${fractionPart}`
    .replace(
      /\.0+$/,
      '',
    )
    .replace(
      /(\.\d*?)0+$/,
      '$1',
    );
}

function normalizeProviderOutcome(
  callback = {},
) {
  const explicit =
    normalizeUpper(
      firstValue(
        callback,
        [
          'providerOutcome',
          'outcome',
        ],
      ),
      64,
    );

  if (
    Object.values(
      PROVIDER_OUTCOME,
    ).includes(
      explicit,
    )
  ) {
    return explicit;
  }

  const status =
    normalizeUpper(
      firstValue(
        callback,
        [
          'status',
          'transactionStatus',
          'resultCode',
          'responseCode',
        ],
      ),
      128,
    );

  if (
    callback.success ===
    true
  ) {
    return PROVIDER_OUTCOME
      .SUCCESS;
  }

  if (
    callback.success ===
    false
  ) {
    return PROVIDER_OUTCOME
      .FAILURE;
  }

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'COMPLETED',
      'COMPLETE',
      'PAID',
      'CONFIRMED',
      'SETTLED',
      '0',
    ].includes(
      status,
    )
  ) {
    return PROVIDER_OUTCOME
      .SUCCESS;
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'IN_PROGRESS',
      'QUEUED',
      'ACCEPTED',
      'INITIATED',
      'SUBMITTED',
    ].includes(
      status,
    )
  ) {
    return PROVIDER_OUTCOME
      .PENDING;
  }

  if (
    [
      'AMBIGUOUS',
      'UNKNOWN',
      'INDETERMINATE',
    ].includes(
      status,
    )
  ) {
    return status ===
      'AMBIGUOUS'
      ? PROVIDER_OUTCOME
          .AMBIGUOUS
      : PROVIDER_OUTCOME
          .UNKNOWN;
  }

  if (
    [
      'REJECTED',
      'DECLINED',
      'DENIED',
    ].includes(
      status,
    )
  ) {
    return PROVIDER_OUTCOME
      .REJECTED;
  }

  if (
    [
      'FAILED',
      'FAILURE',
      'ERROR',
      'CANCELLED',
      'CANCELED',
    ].includes(
      status,
    )
  ) {
    return PROVIDER_OUTCOME
      .FAILURE;
  }

  return PROVIDER_OUTCOME
    .UNKNOWN;
}

function createError(
  code,
  message,
  options = {},
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'AirtelLedgerPosterError';

  error.code =
    code;

  error.statusCode =
    Number(
      options.statusCode ||
        500,
    );

  error.retryable =
    Boolean(
      options.retryable,
    );

  error.uncertain =
    Boolean(
      options.uncertain,
    );

  Object.assign(
    error,
    options,
  );

  return error;
}

function isRetryableError(
  error,
) {
  if (!error) {
    return false;
  }

  if (
    error.retryable ===
    true
  ) {
    return true;
  }

  if (
    error.statusCode ===
      408 ||
    error.statusCode ===
      429 ||
    error.statusCode >=
      500
  ) {
    return true;
  }

  return [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ].includes(
    String(
      error.code || '',
    ).toUpperCase(),
  );
}

function isReplayResult(
  result,
) {
  return Boolean(
    result?.replay ===
      true ||
    result?.duplicate ===
      true ||
    result?.skipped ===
      true ||
    result?.status ===
      'REPLAYED',
  );
}

function normalizePostingStatus(
  result,
  replay = false,
) {
  if (
    replay ||
    isReplayResult(
      result,
    )
  ) {
    return POSTING_STATUS
      .REPLAYED;
  }

  if (
    result?.success ===
      true ||
    [
      'POSTED',
      'COMPLETED',
      'COMMITTED',
      'SETTLED',
    ].includes(
      normalizeUpper(
        result?.status,
      ),
    )
  ) {
    return POSTING_STATUS
      .POSTED;
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'QUEUED',
    ].includes(
      normalizeUpper(
        result?.status,
      ),
    )
  ) {
    return POSTING_STATUS
      .PENDING;
  }

  if (
    [
      'REJECTED',
      'DECLINED',
      'INVALID',
    ].includes(
      normalizeUpper(
        result?.status,
      ),
    )
  ) {
    return POSTING_STATUS
      .REJECTED;
  }

  if (
    result?.success ===
      false ||
    [
      'FAILED',
      'ERROR',
    ].includes(
      normalizeUpper(
        result?.status,
      ),
    )
  ) {
    return POSTING_STATUS
      .FAILED;
  }

  return POSTING_STATUS
    .UNKNOWN;
}

function extractJournalId(
  result,
) {
  return normalizeString(
    firstValue(
      result,
      [
        'journalId',
        'journal.id',
        'id',
      ],
    ),
    256,
  );
}

function extractPostingReference(
  result,
) {
  return normalizeString(
    firstValue(
      result,
      [
        'postingReference',
        'reference',
        'posting.reference',
      ],
    ),
    256,
  );
}

function assertPositiveAmount({
  amount,
  amountMinor,
}) {
  if (
    amount === null &&
    amountMinor === null
  ) {
    throw createError(
      'AIRTEL_LEDGER_AMOUNT_REQUIRED',
      'Ledger posting requires amount or amountMinor.',
      {
        statusCode:
          400,
      },
    );
  }

  if (
    amount !== null &&
    Number(amount) <= 0
  ) {
    throw createError(
      'AIRTEL_LEDGER_AMOUNT_INVALID',
      'Ledger posting amount must be greater than zero.',
      {
        statusCode:
          400,
      },
    );
  }

  if (
    amountMinor !== null &&
    Number(amountMinor) <= 0
  ) {
    throw createError(
      'AIRTEL_LEDGER_AMOUNT_MINOR_INVALID',
      'Ledger posting amountMinor must be greater than zero.',
      {
        statusCode:
          400,
      },
    );
  }
}

function normalizeEntry(
  entry,
  currency,
) {
  if (
    !isObject(
      entry,
    )
  ) {
    throw createError(
      'AIRTEL_LEDGER_ENTRY_INVALID',
      'Ledger entry must be an object.',
      {
        statusCode:
          400,
      },
    );
  }

  const accountId =
    normalizeString(
      entry.accountId ||
        entry.account,
      256,
    );

  const entryType =
    normalizeUpper(
      entry.entryType ||
        entry.type,
      32,
    );

  const amount =
    decimalString(
      entry.amount,
    );

  if (!accountId) {
    throw createError(
      'AIRTEL_LEDGER_ACCOUNT_REQUIRED',
      'Every ledger entry requires an explicit accountId.',
      {
        statusCode:
          400,
      },
    );
  }

  if (
    ![
      'DEBIT',
      'CREDIT',
    ].includes(
      entryType,
    )
  ) {
    throw createError(
      'AIRTEL_LEDGER_ENTRY_TYPE_INVALID',
      'Ledger entry type must be DEBIT or CREDIT.',
      {
        statusCode:
          400,
      },
    );
  }

  if (!amount) {
    throw createError(
      'AIRTEL_LEDGER_ENTRY_AMOUNT_REQUIRED',
      'Every ledger entry requires a positive amount.',
      {
        statusCode:
          400,
      },
    );
  }

  return {
    accountId,
    entryType,
    amount,
    currency:
      normalizeUpper(
        entry.currency,
        8,
      ) ||
      currency,
    description:
      normalizeString(
        entry.description,
        1024,
      ),
    metadata:
      safeClone(
        entry.metadata ||
          {},
      ),
  };
}

function decimalToScaledInteger(
  value,
  exponent,
) {
  const decimal =
    decimalString(
      value,
    );

  if (!decimal) {
    return null;
  }

  const [
    integer,
    fraction = '',
  ] =
    decimal.split(
      '.',
    );

  const normalizedFraction =
    fraction
      .padEnd(
        exponent,
        '0',
      )
      .slice(
        0,
        exponent,
      );

  if (
    fraction.length >
      exponent &&
    /[1-9]/.test(
      fraction.slice(
        exponent,
      ),
    )
  ) {
    return null;
  }

  return BigInt(
    `${integer}${
      normalizedFraction ||
      ''
    }`,
  );
}

function assertBalancedEntries(
  entries,
  currency,
  minorUnitDefaults,
) {
  if (
    !Array.isArray(
      entries,
    ) ||
    entries.length < 2
  ) {
    throw createError(
      'AIRTEL_LEDGER_DOUBLE_ENTRY_REQUIRED',
      'At least two ledger entries are required.',
      {
        statusCode:
          400,
      },
    );
  }

  const exponent =
    Number(
      minorUnitDefaults?.[
        currency
      ] ?? 2,
    );

  let debits =
    0n;

  let credits =
    0n;

  for (
    const entry of
      entries
  ) {
    if (
      normalizeUpper(
        entry.currency,
        8,
      ) !== currency
    ) {
      throw createError(
        'AIRTEL_LEDGER_ENTRY_CURRENCY_MISMATCH',
        'All ledger entries must use the posting currency.',
        {
          statusCode:
            400,
        },
      );
    }

    const scaled =
      decimalToScaledInteger(
        entry.amount,
        exponent,
      );

    if (
      scaled ===
        null ||
      scaled <= 0n
    ) {
      throw createError(
        'AIRTEL_LEDGER_ENTRY_AMOUNT_INVALID',
        'Ledger entry amount cannot be represented exactly in the currency precision.',
        {
          statusCode:
            400,
        },
      );
    }

    if (
      entry.entryType ===
      'DEBIT'
    ) {
      debits +=
        scaled;
    }

    if (
      entry.entryType ===
      'CREDIT'
    ) {
      credits +=
        scaled;
    }
  }

  if (
    debits !==
    credits
  ) {
    throw createError(
      'AIRTEL_LEDGER_NOT_BALANCED',
      'Ledger entries must be exactly balanced.',
      {
        statusCode:
          409,

        details: {
          debitScaled:
            debits.toString(),

          creditScaled:
            credits.toString(),

          exponent,
        },
      },
    );
  }

  return {
    debitScaled:
      debits.toString(),

    creditScaled:
      credits.toString(),

    exponent,
  };
}

export class AirtelLedgerPoster {
  constructor({
    ledgerEngine = null,
    financialCore = null,
    financialTransactionService = null,
    ledgerPostingService = null,
    postingBuilder = null,
    accountResolver = null,
    repository = null,
    auditService = null,
    eventBus = null,
    outboxService = null,
    metrics = null,
    tracer = null,
    logger = null,
    configuration = {},
    clock = Date,
  } = {}) {
    this.ledgerEngine =
      ledgerEngine;

    this.financialCore =
      financialCore;

    this.financialTransactionService =
      financialTransactionService;

    this.ledgerPostingService =
      ledgerPostingService;

    this.postingBuilder =
      postingBuilder;

    this.accountResolver =
      accountResolver;

    this.repository =
      repository;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.outboxService =
      outboxService;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.logger =
      logger ||
      console;

    this.clock =
      clock ||
      Date;

    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),
      minorUnitDefaults: {
        ...DEFAULTS.minorUnitDefaults,
        ...(configuration?.minorUnitDefaults ||
          {}),
      },
    };

    this.runtime = {
      initialized:
        true,

      stopping:
        false,

      startedAt:
        now(
          this.clock,
        ),

      activePostings:
        new Map(),

      lastPost:
        null,

      lastFailure:
        null,
    };

    this.statistics = {
      attempts:
        0,

      posted:
        0,

      replayed:
        0,

      rejected:
        0,

      pending:
        0,

      failed:
        0,

      duplicates:
        0,

      ambiguousBlocked:
        0,

      providerPendingBlocked:
        0,

      unknownOutcomeBlocked:
        0,

      invalidRequests:
        0,

      financialCoreCalls:
        0,

      financialCoreFailures:
        0,

      lookupCalls:
        0,

      lookupFailures:
        0,

      auditFailures:
        0,

      eventFailures:
        0,

      retries:
        0,
    };
  }

  // ---------------------------------------------------------------------------
  // Primary public API
  // ---------------------------------------------------------------------------

  async post(
    transaction = {},
    options = {},
  ) {
    return this.postSettlement(
      transaction,
      options,
    );
  }

  async postTransaction(
    transaction = {},
    options = {},
  ) {
    return this.postSettlement(
      transaction,
      options,
    );
  }

  async postLedger(
    transaction = {},
    options = {},
  ) {
    return this.postSettlement(
      transaction,
      options,
    );
  }

  async postSettlement(
    transaction = {},
    options = {},
  ) {
    const startedAt =
      Date.now();

    const context =
      this.buildPostingContext(
        transaction,
        options,
      );

    const lockKey =
      `${context.tenantId}:${context.idempotencyKey}`;

    this.statistics.attempts +=
      1;

    this.assertRuntimeReady();

    this.acquireLocalLock(
      lockKey,
      context,
    );

    const span =
      this.startSpan(
        'airtel.callback.ledger.post',
        context,
      );

    try {
      const request =
        await this.buildPostingRequest({
          transaction,
          context,
          options,
        });

      this.assertProviderOutcome(
        request.providerOutcome,
      );

      this.assertAuthoritativeContext(
        request,
      );

      const duplicate =
        await this.findExistingPosting({
          tenantId:
            request.tenantId,

          idempotencyKey:
            request.idempotencyKey,

          transactionId:
            request.transactionId,

          postingReference:
            request.postingReference,

          session:
            request.session,
        });

      if (duplicate) {
        this.statistics.duplicates +=
          1;

        this.statistics.replayed +=
          1;

        const replay =
          this.normalizePostingResult(
            duplicate,
            request,
            true,
          );

        await this.safeAudit(
          'AIRTEL_CALLBACK_LEDGER_REPLAY',
          request,
          replay,
        );

        return replay;
      }

      const authority =
        this.resolveFinancialAuthority();

      const method =
        this.resolvePostMethod(
          authority,
        );

      if (
        !authority ||
        !method
      ) {
        throw createError(
          'AIRTEL_FINANCIAL_CORE_UNAVAILABLE',
          'No authoritative Airtel ledger posting boundary is configured.',
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      this.statistics.financialCoreCalls +=
        1;

      const result =
        await this.executeWithRetry(
          () =>
            authority[
              method
            ](
              request,
            ),
          {
            timeoutMs:
              this.options
                .postTimeoutMs,

            maxRetries:
              Number(
                options.maxRetries ??
                  this.options
                    .maxRetries,
              ),

            context:
              request,
          },
        );

      const normalizedResult =
        this.normalizePostingResult(
          result,
          request,
          false,
        );

      this.recordResult(
        normalizedResult,
      );

      await this.safeAudit(
        normalizedResult.replayed
          ? 'AIRTEL_CALLBACK_LEDGER_REPLAY'
          : 'AIRTEL_CALLBACK_LEDGER_POSTED',
        request,
        normalizedResult,
      );

      await this.publishEvent(
        normalizedResult.replayed
          ? 'AIRTEL_CALLBACK_LEDGER_REPLAYED'
          : 'AIRTEL_CALLBACK_LEDGER_POSTED',
        request,
        normalizedResult,
      );

      this.runtime.lastPost = {
        at:
          now(
            this.clock,
          ),

        tenantId:
          request.tenantId,

        transactionId:
          request.transactionId,

        idempotencyKey:
          request.idempotencyKey,

        journalId:
          normalizedResult
            .journalId,

        status:
          normalizedResult.status,
      };

      this.metric(
        'titech_airtel_callback_ledger_post_duration_ms',
        Date.now() -
          startedAt,
      );

      return normalizedResult;
    } catch (error) {
      this.statistics.failed +=
        1;

      this.statistics.financialCoreFailures +=
        Number(
          error?.code ===
              'AIRTEL_FINANCIAL_CORE_UNAVAILABLE' ||
            error?.financialCoreFailure
            ? 1
            : 0,
        );

      this.runtime.lastFailure = {
        at:
          now(
            this.clock,
          ),

        tenantId:
          context.tenantId,

        transactionId:
          context.transactionId,

        code:
          error?.code ||
          'AIRTEL_LEDGER_POST_FAILED',
      };

      const normalizedError =
        this.normalizeError(
          error,
          context,
        );

      await this.safeAudit(
        'AIRTEL_CALLBACK_LEDGER_POST_FAILED',
        context,
        {
          code:
            normalizedError.code,

          statusCode:
            normalizedError
              .statusCode,

          retryable:
            normalizedError
              .retryable,

          uncertain:
            normalizedError
              .uncertain,
        },
      );

      throw normalizedError;
    } finally {
      this.releaseLocalLock(
        lockKey,
      );

      span?.end?.();
    }
  }

  async postCollection(
    transaction = {},
    options = {},
  ) {
    return this.postSettlement(
      {
        ...transaction,
        operationType:
          'COLLECTION',
      },
      options,
    );
  }

  async applyProviderSettlement(
    transaction = {},
    options = {},
  ) {
    return this.postCollection(
      transaction,
      options,
    );
  }

  async executeCollectionSettlement(
    transaction = {},
    options = {},
  ) {
    return this.postCollection(
      transaction,
      options,
    );
  }

  // ---------------------------------------------------------------------------
  // Reversal / lookup
  // ---------------------------------------------------------------------------

  async getPosting({
    tenantId,
    idempotencyKey = null,
    transactionId = null,
    journalId = null,
    postingReference = null,
    session = null,
  } = {}) {
    const resolvedTenantId =
      this.requireTenant(
        tenantId,
      );

    const authority =
      this.resolveFinancialAuthority();

    if (!authority) {
      throw createError(
        'AIRTEL_FINANCIAL_CORE_UNAVAILABLE',
        'No authoritative financial lookup boundary is configured.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const query = {
      tenantId:
        resolvedTenantId,

      provider:
        PROVIDER,

      operationType:
        OPERATION,

      idempotencyKey:
        normalizeString(
          idempotencyKey,
          256,
        ),

      transactionId:
        normalizeString(
          transactionId,
          256,
        ),

      journalId:
        normalizeString(
          journalId,
          256,
        ),

      postingReference:
        normalizeString(
          postingReference,
          256,
        ),

      session,
    };

    const method =
      firstFunction(
        authority,
        [
          'getPosting',
          'getJournalByIdempotencyKey',
          'findByIdempotencyKey',
          'getJournal',
        ],
      );

    if (!method) {
      throw createError(
        'AIRTEL_LEDGER_LOOKUP_UNAVAILABLE',
        'Financial authority does not expose a supported posting lookup method.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    this.statistics.lookupCalls +=
      1;

    try {
      return await this.executeWithTimeout(
        () =>
          authority[
            method
          ](
            query,
          ),
        {
          timeoutMs:
            this.options
              .lookupTimeoutMs,

          context:
            query,
        },
      );
    } catch (error) {
      this.statistics.lookupFailures +=
        1;

      if (
        this.options
          .failClosedOnLookupError
      ) {
        throw this.normalizeError(
          error,
          query,
        );
      }

      return null;
    }
  }

  async reverse({
    tenantId,
    originalJournalId,
    originalTransactionId,
    reasonCode,
    reason,
    idempotencyKey,
    actorId =
      'SYSTEM:AIRTEL_CALLBACK',
    session = null,
  } = {}) {
    const resolvedTenantId =
      this.requireTenant(
        tenantId,
      );

    if (
      !originalJournalId &&
      !originalTransactionId
    ) {
      throw createError(
        'AIRTEL_LEDGER_REVERSAL_ORIGINAL_REQUIRED',
        'A reversal requires the original journal or transaction identity.',
        {
          statusCode:
            400,
        },
      );
    }

    const reversalKey =
      idempotencyKey ||
      sha256({
        provider:
          PROVIDER,

        operation:
          'REVERSAL',

        tenantId:
          resolvedTenantId,

        originalJournalId:
          originalJournalId ||
          null,

        originalTransactionId:
          originalTransactionId ||
          null,

        reasonCode:
          reasonCode ||
          null,
      });

    const authority =
      this.resolveFinancialAuthority();

    const method =
      firstFunction(
        authority,
        [
          'reverseJournal',
          'reverseTransaction',
          'reverse',
        ],
      );

    if (
      !authority ||
      !method
    ) {
      throw createError(
        'AIRTEL_LEDGER_REVERSAL_UNAVAILABLE',
        'Financial authority does not expose a supported reversal method.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const command = {
      tenantId:
        resolvedTenantId,

      provider:
        PROVIDER,

      operationType:
        'COLLECTION_REVERSAL',

      idempotencyKey:
        reversalKey,

      originalJournalId:
        normalizeString(
          originalJournalId,
          256,
        ),

      originalTransactionId:
        normalizeString(
          originalTransactionId,
          256,
        ),

      reasonCode:
        normalizeString(
          reasonCode,
          256,
        ),

      reason:
        normalizeString(
          reason,
          1024,
        ),

      actorId:
        normalizeString(
          actorId,
          256,
        ) ||
        'SYSTEM:AIRTEL_CALLBACK',

      session,
    };

    const result =
      await this.executeWithTimeout(
        () =>
          authority[
            method
          ](
            command,
          ),
        {
          timeoutMs:
            this.options
              .postTimeoutMs,

          context:
            command,
        },
      );

    const normalized =
      this.normalizePostingResult(
        result,
        {
          ...command,

          transactionId:
            command
              .originalTransactionId,

          postingReference:
            command
              .originalJournalId,

          providerOutcome:
            PROVIDER_OUTCOME
              .SUCCESS,
        },
        false,
      );

    await this.safeAudit(
      'AIRTEL_CALLBACK_LEDGER_REVERSED',
      command,
      normalized,
    );

    await this.publishEvent(
      'AIRTEL_CALLBACK_LEDGER_REVERSED',
      command,
      normalized,
    );

    return normalized;
  }

  // ---------------------------------------------------------------------------
  // Request construction
  // ---------------------------------------------------------------------------

  buildPostingContext(
    transaction = {},
    options = {},
  ) {
    const tenantId =
      this.requireTenant(
        transaction.tenantId ||
          options.tenantId,
      );

    const transactionId =
      extractTransactionId(
        transaction,
      ) ||
      normalizeString(
        options.transactionId,
        256,
      );

    if (
      !transactionId &&
      this.options
        .requireTransactionId
    ) {
      throw createError(
        'AIRTEL_LEDGER_TRANSACTION_ID_REQUIRED',
        'Ledger posting requires a canonical transaction identity.',
        {
          statusCode:
            400,
        },
      );
    }

    const operationId =
      normalizeString(
        transaction.operationId ||
          options.operationId,
        256,
      ) ||
      id();

    const correlationId =
      normalizeString(
        transaction.correlationId ||
          options.correlationId,
        256,
      ) ||
      id();

    return {
      tenantId,

      transactionId,

      operationId,

      correlationId,

      callbackId:
        normalizeString(
          transaction.callbackId ||
            options.callbackId,
          256,
        ),

      providerReference:
        extractProviderReference(
          transaction,
          options.callback ||
            {},
        ),

      paymentReference:
        extractPaymentReference(
          transaction,
          options.callback ||
            {},
        ),

      transactionReference:
        extractTransactionReference(
          transaction,
          options.callback ||
            {},
        ),
    };
  }

  async buildPostingRequest({
    transaction,
    context,
    options,
  }) {
    const callback =
      options.callback ||
      transaction.callback ||
      {};

    const providerOutcome =
      normalizeProviderOutcome(
        callback,
      );

    const currency =
      extractCurrency(
        transaction,
        callback,
      ) ||
      normalizeUpper(
        options.currency,
        8,
      ) ||
      this.options
        .defaultCurrency;

    const amounts =
      extractAmount(
        transaction,
        callback,
      );

    const amount =
      amounts.amount ||
      minorToDecimal(
        amounts.amountMinor,
        currency,
        this.options
          .minorUnitDefaults,
      );

    const amountMinor =
      amounts.amountMinor ||
      this.calculateMinorFromAmount(
        amount,
        currency,
      );

    assertPositiveAmount({
      amount,
      amountMinor,
    });

    const idempotencyKey =
      normalizeString(
        transaction.idempotencyKey ||
          transaction
            .idempotency_key ||
          options.idempotencyKey,
        256,
      ) ||
      this.buildIdempotencyKey({
        ...context,

        amount,

        amountMinor,

        currency,
      });

    if (
      !idempotencyKey &&
      this.options
        .requireIdempotencyKey
    ) {
      throw createError(
        'AIRTEL_LEDGER_IDEMPOTENCY_KEY_REQUIRED',
        'Ledger posting requires an idempotency key.',
        {
          statusCode:
            400,
        },
      );
    }

    const entries =
      await this.buildEntries({
        transaction,
        callback,
        context,
        amount,
        currency,
        options,
      });

    assertBalancedEntries(
      entries,
      currency,
      this.options
        .minorUnitDefaults,
    );

    const operationType =
      normalizeUpper(
        transaction.operationType ||
          transaction.type ||
          options.operationType ||
          OPERATION,
        128,
      ) ||
      OPERATION;

    const sourceId =
      normalizeString(
        transaction.sourceId ||
          transaction.paymentId ||
          extractCollectionId(
            transaction,
          ) ||
          context.transactionId,
        256,
      );

    const reference =
      context.transactionReference ||
      context.paymentReference ||
      context.providerReference ||
      context.transactionId;

    const request = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      operationType,

      schemaVersion:
        SCHEMA_VERSION,

      engineVersion:
        ENGINE_VERSION,

      tenantId:
        context.tenantId,

      transactionId:
        context.transactionId,

      paymentId:
        extractPaymentId(
          transaction,
        ),

      collectionId:
        extractCollectionId(
          transaction,
        ),

      providerReference:
        context.providerReference,

      paymentReference:
        context.paymentReference,

      transactionReference:
        context.transactionReference,

      callbackId:
        context.callbackId,

      callbackFingerprint:
        normalizeString(
          transaction.callbackFingerprint ||
            callback.callbackFingerprint,
          256,
        ),

      idempotencyKey,

      postingReference:
        normalizeString(
          transaction.postingReference ||
            options.postingReference,
          256,
        ) ||
        `AIRTEL-COLLECTION-${context.transactionId}`,

      amount,

      amountMinor,

      currency,

      providerOutcome,

      status:
        normalizeUpper(
          transaction.status ||
            callback.status,
          128,
        ) ||
        'UNKNOWN',

      description:
        normalizeString(
          transaction.description ||
            `Airtel collection ${context.transactionId}`,
          this.options
            .maxDescriptionLength,
        ),

      reference,

      externalReference:
        normalizeString(
          transaction.externalReference ||
            transaction.clientReference ||
            callback.externalReference,
          256,
        ),

      source:
        normalizeString(
          transaction.source ||
            'AIRTEL_CALLBACK',
          256,
        ),

      sourceId,

      effectiveAt:
        transaction.completedAt ||
        transaction.occurredAt ||
        callback.occurredAt ||
        now(
          this.clock,
        ),

      accountingDate:
        transaction.accountingDate ||
        undefined,

      actorId:
        normalizeString(
          transaction.actorId ||
            options.actorId ||
            'SYSTEM:AIRTEL_CALLBACK',
          256,
        ),

      entries,

      metadata:
        this.buildMetadata({
          transaction,
          callback,
          context,
          options,
        }),

      session:
        transaction.session ||
        options.session ||
        null,
    };

    return request;
  }

  async buildEntries({
    transaction,
    callback,
    context,
    amount,
    currency,
    options,
  }) {
    if (
      Array.isArray(
        transaction.entries,
      )
    ) {
      return transaction.entries.map(
        (entry) =>
          normalizeEntry(
            entry,
            currency,
          ),
      );
    }

    if (
      Array.isArray(
        options.entries,
      )
    ) {
      return options.entries.map(
        (entry) =>
          normalizeEntry(
            entry,
            currency,
          ),
      );
    }

    if (
      this.postingBuilder
    ) {
      const method =
        firstFunction(
          this.postingBuilder,
          [
            'buildCollection',
            'build',
            'createPosting',
          ],
        );

      if (method) {
        const built =
          await this.postingBuilder[
            method
          ]({
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId:
              context.tenantId,

            transaction,

            callback:
              safeClone(
                callback,
              ),

            context,

            amount,

            currency,
          });

        if (
          Array.isArray(
            built,
          )
        ) {
          return built.map(
            (entry) =>
              normalizeEntry(
                entry,
                currency,
              ),
          );
        }

        if (
          Array.isArray(
            built?.entries,
          )
        ) {
          return built.entries.map(
            (entry) =>
              normalizeEntry(
                entry,
                currency,
              ),
          );
        }
      }
    }

    const accountSet =
      await this.resolveAccounts({
        transaction,
        callback,
        context,
        options,
      });

    if (
      !accountSet?.debitAccountId ||
      !accountSet?.creditAccountId
    ) {
      throw createError(
        'AIRTEL_LEDGER_EXPLICIT_ACCOUNTS_REQUIRED',
        'Airtel ledger posting requires explicit debit/credit account identities or a canonical account resolver.',
        {
          statusCode:
            409,
        },
      );
    }

    return [
      normalizeEntry(
        {
          accountId:
            accountSet
              .debitAccountId,

          entryType:
            'DEBIT',

          amount,

          currency,

          metadata: {
            role:
              'AIRTEL_COLLECTION_SOURCE',
          },
        },
        currency,
      ),

      normalizeEntry(
        {
          accountId:
            accountSet
              .creditAccountId,

          entryType:
            'CREDIT',

          amount,

          currency,

          metadata: {
            role:
              'AIRTEL_COLLECTION_DESTINATION',
          },
        },
        currency,
      ),
    ];
  }

  async resolveAccounts({
    transaction,
    callback,
    context,
    options,
  }) {
    const explicitDebit =
      normalizeString(
        transaction.debitAccountId ||
          transaction.sourceAccountId ||
          options.debitAccountId,
        256,
      );

    const explicitCredit =
      normalizeString(
        transaction.creditAccountId ||
          transaction.destinationAccountId ||
          options.creditAccountId,
        256,
      );

    if (
      explicitDebit &&
      explicitCredit
    ) {
      return {
        debitAccountId:
          explicitDebit,

        creditAccountId:
          explicitCredit,
      };
    }

    if (
      !this.accountResolver
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.accountResolver,
        [
          'resolveCollectionAccounts',
          'resolveAccounts',
          'resolve',
        ],
      );

    if (!method) {
      return null;
    }

    const result =
      await this.accountResolver[
        method
      ]({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        transaction,

        callback:
          safeClone(
            callback,
          ),

        context,
      });

    return {
      debitAccountId:
        normalizeString(
          result?.debitAccountId ||
            result?.sourceAccountId,
          256,
        ),

      creditAccountId:
        normalizeString(
          result?.creditAccountId ||
            result?.destinationAccountId,
          256,
        ),
    };
  }

  buildMetadata({
    transaction,
    callback,
    context,
    options,
  }) {
    const metadata = {
      tenantId:
        context.tenantId,

      callbackId:
        context.callbackId,

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      providerReference:
        context.providerReference,

      paymentReference:
        context.paymentReference,

      transactionReference:
        context.transactionReference,

      callbackFingerprint:
        transaction.callbackFingerprint ||
        callback.callbackFingerprint ||
        null,

      source:
        'AIRTEL_CALLBACK',

      ...safeClone(
        transaction.metadata ||
          options.metadata ||
          {},
      ),
    };

    if (
      byteLength(
        metadata,
      ) >
      Number(
        this.options
          .maxMetadataBytes,
      )
    ) {
      return {
        omitted:
          true,

        reason:
          'METADATA_TOO_LARGE',

        sha256:
          sha256(
            metadata,
          ),
      };
    }

    return metadata;
  }

  buildIdempotencyKey({
    tenantId,
    transactionId,
    providerReference,
    paymentReference,
    callbackId,
    amount,
    amountMinor,
    currency,
  }) {
    return `AIRTEL_CALLBACK_LEDGER:${sha256({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      transactionId,

      providerReference,

      paymentReference,

      callbackId,

      amount,

      amountMinor,

      currency,
    })}`;
  }

  calculateMinorFromAmount(
    amount,
    currency,
  ) {
    if (!amount) {
      return null;
    }

    const exponent =
      Number(
        this.options
          .minorUnitDefaults?.[
          currency
        ] ?? 2,
      );

    return (
      decimalToScaledInteger(
        amount,
        exponent,
      )?.toString() ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Financial authority resolution
  // ---------------------------------------------------------------------------

  resolveFinancialAuthority() {
    if (
      this.financialCore
    ) {
      return this.financialCore;
    }

    if (
      this.financialTransactionService
    ) {
      return this.financialTransactionService;
    }

    if (
      this.ledgerPostingService
    ) {
      return this.ledgerPostingService;
    }

    if (
      this.ledgerEngine
    ) {
      return this.ledgerEngine;
    }

    return null;
  }

  resolvePostMethod(
    authority,
  ) {
    return firstFunction(
      authority,
      [
        'processCollectionCallback',
        'applyProviderSettlement',
        'settleCollection',
        'postCollection',
        'commitCollection',
        'executeCollectionSettlement',
        'executeCollectionCallback',
        'postSettlement',
        'post',
      ],
    );
  }

  assertAuthoritativeContext(
    request,
  ) {
    if (
      this.options
        .requireTenantId &&
      !request.tenantId
    ) {
      throw createError(
        'AIRTEL_LEDGER_TENANT_REQUIRED',
        'Tenant ID is required for ledger posting.',
        {
          statusCode:
            403,
        },
      );
    }

    if (
      this.options
        .requireTransactionId &&
      !request.transactionId
    ) {
      throw createError(
        'AIRTEL_LEDGER_TRANSACTION_ID_REQUIRED',
        'Transaction ID is required for ledger posting.',
        {
          statusCode:
            400,
        },
      );
    }

    if (
      this.options
        .requireIdempotencyKey &&
      !request.idempotencyKey
    ) {
      throw createError(
        'AIRTEL_LEDGER_IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency key is required for ledger posting.',
        {
          statusCode:
            400,
        },
      );
    }

    if (
      !Array.isArray(
        request.entries,
      ) ||
      request.entries
        .length <
        2
    ) {
      throw createError(
        'AIRTEL_LEDGER_DOUBLE_ENTRY_REQUIRED',
        'A balanced double-entry posting is required.',
        {
          statusCode:
            400,
        },
      );
    }
  }

  assertProviderOutcome(
    outcome,
  ) {
    switch (
      outcome
    ) {
      case PROVIDER_OUTCOME
        .SUCCESS:
        return true;

      case PROVIDER_OUTCOME
        .PENDING:
        this.statistics
          .providerPendingBlocked +=
          1;

        if (
          !this.options
            .allowProviderPending
        ) {
          throw createError(
            'AIRTEL_LEDGER_PROVIDER_PENDING',
            'Pending Airtel provider evidence cannot be posted as settled accounting.',
            {
              statusCode:
                409,

              retryable:
                false,

              uncertain:
                true,
            },
          );
        }

        return true;

      case PROVIDER_OUTCOME
        .AMBIGUOUS:
        this.statistics
          .ambiguousBlocked +=
          1;

        if (
          !this.options
            .allowProviderAmbiguous
        ) {
          throw createError(
            'AIRTEL_LEDGER_PROVIDER_AMBIGUOUS',
            'Ambiguous Airtel provider evidence cannot be posted to the ledger.',
            {
              statusCode:
                409,

              retryable:
                true,

              uncertain:
                true,
            },
          );
        }

        return true;

      case PROVIDER_OUTCOME
        .UNKNOWN:
        this.statistics
          .unknownOutcomeBlocked +=
          1;

        if (
          !this.options
            .allowProviderUnknown
        ) {
          throw createError(
            'AIRTEL_LEDGER_PROVIDER_OUTCOME_UNKNOWN',
            'Unknown Airtel provider outcome cannot authorize ledger posting.',
            {
              statusCode:
                409,

              retryable:
                false,

              uncertain:
                true,
            },
          );
        }

        return true;

      case PROVIDER_OUTCOME
        .FAILURE:

      case PROVIDER_OUTCOME
        .REJECTED:

      default:
        throw createError(
          'AIRTEL_LEDGER_PROVIDER_NOT_SUCCESS',
          'Only an authoritative successful provider outcome may reach financial posting.',
          {
            statusCode:
              409,

            retryable:
              false,
          },
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Duplicate lookup
  // ---------------------------------------------------------------------------

  async findExistingPosting({
    tenantId,
    idempotencyKey,
    transactionId,
    postingReference,
    session,
  }) {
    const authority =
      this.resolveFinancialAuthority();

    if (!authority) {
      if (
        this.options
          .failClosedOnLookupError
      ) {
        throw createError(
          'AIRTEL_FINANCIAL_CORE_UNAVAILABLE',
          'Financial Core is unavailable for duplicate posting protection.',
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }

    const method =
      firstFunction(
        authority,
        [
          'getJournalByIdempotencyKey',
          'getPostingByIdempotencyKey',
          'findByIdempotencyKey',
          'getPosting',
          'getJournal',
        ],
      );

    if (!method) {
      const repositoryMethod =
        firstFunction(
          this.repository,
          [
            'findByIdempotencyKey',
            'findExistingPosting',
            'findByTransactionId',
          ],
        );

      if (!repositoryMethod) {
        if (
          this.options
            .failClosedOnLookupError
        ) {
          throw createError(
            'AIRTEL_LEDGER_DUPLICATE_LOOKUP_UNAVAILABLE',
            'No authoritative ledger duplicate lookup method is configured.',
            {
              statusCode:
                503,

              retryable:
                true,
            },
          );
        }

        return null;
      }

      this.statistics.lookupCalls +=
        1;

      try {
        return await this.repository[
          repositoryMethod
        ]({
          tenantId,

          provider:
            PROVIDER,

          operationType:
            OPERATION,

          idempotencyKey,

          transactionId,

          postingReference,

          session,
        });
      } catch (error) {
        this.statistics.lookupFailures +=
          1;

        if (
          this.options
            .failClosedOnLookupError
        ) {
          throw createError(
            'AIRTEL_LEDGER_DUPLICATE_LOOKUP_FAILED',
            'Authoritative ledger duplicate lookup failed.',
            {
              statusCode:
                503,

              retryable:
                true,

              cause:
                error,
            },
          );
        }

        return null;
      }
    }

    this.statistics.lookupCalls +=
      1;

    try {
      return await this.executeWithTimeout(
        () =>
          authority[
            method
          ]({
            tenantId,

            provider:
              PROVIDER,

            operationType:
              OPERATION,

            idempotencyKey,

            transactionId,

            postingReference,

            session,
          }),
        {
          timeoutMs:
            this.options
              .lookupTimeoutMs,

          context: {
            tenantId,

            transactionId,

            idempotencyKey,
          },
        },
      );
    } catch (error) {
      this.statistics.lookupFailures +=
        1;

      if (
        this.options
          .failClosedOnLookupError
      ) {
        throw createError(
          'AIRTEL_LEDGER_DUPLICATE_LOOKUP_FAILED',
          'Authoritative ledger duplicate lookup failed.',
          {
            statusCode:
              503,

            retryable:
              true,

            cause:
              error,
          },
        );
      }

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Result shaping / health
  // ---------------------------------------------------------------------------

  normalizePostingResult(
    result,
    request,
    replay,
  ) {
    const status =
      normalizePostingStatus(
        result,
        replay,
      );

    return {
      success:
        status ===
          POSTING_STATUS.POSTED ||
        status ===
          POSTING_STATUS.REPLAYED,

      posted:
        status ===
        POSTING_STATUS.POSTED,

      replayed:
        replay ||
        status ===
          POSTING_STATUS.REPLAYED,

      status,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      operationType:
        request.operationType,

      tenantId:
        request.tenantId,

      transactionId:
        request.transactionId,

      paymentId:
        request.paymentId ||
        null,

      collectionId:
        request.collectionId ||
        null,

      journalId:
        extractJournalId(
          result,
        ),

      postingReference:
        extractPostingReference(
          result,
        ) ||
        request.postingReference,

      idempotencyKey:
        request.idempotencyKey,

      callbackFingerprint:
        request.callbackFingerprint ||
        null,

      providerReference:
        request.providerReference ||
        null,

      paymentReference:
        request.paymentReference ||
        null,

      transactionReference:
        request.transactionReference ||
        null,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      providerOutcome:
        request.providerOutcome,

      financialTransactionCommitted:
        Boolean(
          result?.financialTransactionCommitted ===
            true ||
          result?.committed ===
            true ||
          status ===
            POSTING_STATUS.POSTED ||
          status ===
            POSTING_STATUS.REPLAYED,
        ),

      settlementConfirmed:
        Boolean(
          result?.settlementConfirmed ===
            true ||
          result?.financialSettlement
            ?.confirmed ===
            true,
        ),

      authoritative:
        true,

      financialBoundary:
        FINANCIAL_BOUNDARY,

      source:
        request.source,

      sourceId:
        request.sourceId,

      result:
        safeClone(
          result ||
            {},
        ),

      generatedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  recordResult(
    result,
  ) {
    switch (
      result.status
    ) {
      case POSTING_STATUS.POSTED:
        this.statistics.posted +=
          1;
        break;

      case POSTING_STATUS.REPLAYED:
        this.statistics.replayed +=
          1;
        break;

      case POSTING_STATUS.PENDING:
        this.statistics.pending +=
          1;
        break;

      case POSTING_STATUS.REJECTED:
        this.statistics.rejected +=
          1;
        break;

      case POSTING_STATUS.FAILED:
        this.statistics.failed +=
          1;
        break;

      default:
        break;
    }
  }

  requireTenant(value) {
    const tenantId =
      normalizeString(
        value,
        256,
      );

    if (
      !tenantId &&
      this.options
        .requireTenantId
    ) {
      this.statistics.invalidRequests +=
        1;

      throw createError(
        'AIRTEL_LEDGER_TENANT_REQUIRED',
        'Tenant ID is required.',
        {
          statusCode:
            403,
        },
      );
    }

    return tenantId;
  }

  assertRuntimeReady() {
    if (
      this.runtime.stopping
    ) {
      throw createError(
        'AIRTEL_LEDGER_POSTER_STOPPING',
        'Airtel ledger poster is stopping.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      this.options
        .requireFinancialCore &&
      !this.resolveFinancialAuthority()
    ) {
      throw createError(
        'AIRTEL_FINANCIAL_CORE_UNAVAILABLE',
        'Airtel ledger poster requires an authoritative financial boundary.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }
  }

  acquireLocalLock(
    key,
    context,
  ) {
    this.pruneLocks();

    if (
      this.runtime
        .activePostings
        .size >=
      Number(
        this.options
          .maxConcurrentPostings,
      )
    ) {
      throw createError(
        'AIRTEL_LEDGER_POST_CAPACITY_EXCEEDED',
        'Airtel ledger posting concurrency capacity is exhausted.',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      this.runtime
        .activePostings
        .has(
          key,
        )
    ) {
      this.statistics.duplicates +=
        1;

      throw createError(
        'AIRTEL_LEDGER_POST_IN_FLIGHT',
        'Equivalent Airtel ledger posting is already in progress.',
        {
          statusCode:
            409,

          retryable:
            true,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,
        },
      );
    }

    this.runtime
      .activePostings
      .set(
        key,
        {
          startedAt:
            Date.now(),

          tenantId:
            context.tenantId,

          transactionId:
            context.transactionId,
        },
      );
  }

  releaseLocalLock(
    key,
  ) {
    this.runtime
      .activePostings
      .delete(
        key,
      );
  }

  pruneLocks() {
    const cutoff =
      Date.now() -
      Number(
        this.options
          .localLockTtlMs,
      );

    for (
      const [key, entry] of
        this.runtime
          .activePostings
          .entries()
    ) {
      if (
        entry.startedAt <
        cutoff
      ) {
        this.runtime
          .activePostings
          .delete(
            key,
          );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Timeout/retry infrastructure
  // ---------------------------------------------------------------------------

  async executeWithRetry(
    operation,
    {
      timeoutMs,
      maxRetries = 0,
      context = {},
    } = {},
  ) {
    let lastError =
      null;

    for (
      let attempt = 0;
      attempt <=
        maxRetries;
      attempt += 1
    ) {
      try {
        return await this.executeWithTimeout(
          operation,
          {
            timeoutMs,
            context,
          },
        );
      } catch (error) {
        lastError =
          error;

        if (
          attempt >=
            maxRetries ||
          !isRetryableError(
            error,
          )
        ) {
          throw error;
        }

        this.statistics.retries +=
          1;

        await this.sleep(
          Number(
            this.options
              .retryBackoffMs,
          ) *
            (attempt + 1),
        );
      }
    }

    throw lastError;
  }

  async executeWithTimeout(
    operation,
    {
      timeoutMs,
      context = {},
    } = {},
  ) {
    const timeout =
      Math.max(
        1,
        Number(
          timeoutMs,
        ) ||
          DEFAULTS
            .postTimeoutMs,
      );

    let timer;

    try {
      return await Promise.race(
        [
          Promise.resolve().then(
            operation,
          ),

          new Promise(
            (
              _,
              reject,
            ) => {
              timer =
                setTimeout(
                  () => {
                    reject(
                      createError(
                        'AIRTEL_LEDGER_POST_TIMEOUT',
                        'Authoritative Airtel ledger operation timed out.',
                        {
                          statusCode:
                            504,

                          retryable:
                            true,

                          uncertain:
                            true,

                          tenantId:
                            context?.tenantId,

                          transactionId:
                            context?.transactionId,

                          idempotencyKey:
                            context?.idempotencyKey,
                        },
                      ),
                    );
                  },
                  timeout,
                );
            },
          ),
        ],
      );
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  async sleep(
    milliseconds,
  ) {
    const value =
      Math.max(
        0,
        Number(
          milliseconds,
        ) ||
          0,
      );

    if (!value) {
      return;
    }

    await new Promise(
      (
        resolve,
      ) => {
        setTimeout(
          resolve,
          value,
        );
      },
    );
  }

  normalizeError(
    error,
    context = {},
  ) {
    if (
      error?.name ===
      'AirtelLedgerPosterError'
    ) {
      return error;
    }

    return createError(
      error?.code ||
        'AIRTEL_LEDGER_POST_FAILED',

      error?.message ||
        'Airtel ledger posting failed.',

      {
        statusCode:
          Number(
            error?.statusCode ||
              error?.status,
          ) ||
          500,

        retryable:
          Boolean(
            error?.retryable,
          ),

        uncertain:
          Boolean(
            error?.uncertain,
          ),

        tenantId:
          context.tenantId,

        transactionId:
          context.transactionId,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        cause:
          error,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Audit/events/observability
  // ---------------------------------------------------------------------------

  async safeAudit(
    action,
    context,
    result,
  ) {
    if (
      !this.options.audit ||
      !this.auditService
    ) {
      return;
    }

    const method =
      firstFunction(
        this.auditService,
        [
          'record',
          'audit',
          'write',
        ],
      );

    if (!method) {
      return;
    }

    try {
      await this.auditService[
        method
      ]({
        action,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          context?.tenantId ||
          null,

        transactionId:
          context?.transactionId ||
          null,

        correlationId:
          context?.correlationId ||
          null,

        operationId:
          context?.operationId ||
          null,

        journalId:
          result?.journalId ||
          null,

        postingReference:
          result?.postingReference ||
          null,

        idempotencyKey:
          context?.idempotencyKey ||
          null,

        status:
          result?.status ||
          null,

        providerOutcome:
          context?.providerOutcome ||
          null,

        metadata:
          safeClone({
            callbackId:
              context?.callbackId ||
              null,

            providerReference:
              context?.providerReference ||
              null,

            paymentReference:
              context?.paymentReference ||
              null,

            transactionReference:
              context?.transactionReference ||
              null,

            amount:
              context?.amount ||
              null,

            amountMinor:
              context?.amountMinor ||
              null,

            currency:
              context?.currency ||
              null,
          }),

        timestamp:
          now(
            this.clock,
          ).toISOString(),
      });
    } catch (error) {
      this.statistics.auditFailures +=
        1;

      this.log(
        'error',
        'Airtel callback ledger audit failed',
        {
          action,

          tenantId:
            context?.tenantId,

          transactionId:
            context?.transactionId,

          code:
            error?.code,
        },
      );

      if (
        this.options
          .failClosedOnAuditError
      ) {
        throw error;
      }
    }
  }

  async publishEvent(
    type,
    context,
    result,
  ) {
    if (
      !this.options
        .publishEvents
    ) {
      return;
    }

    const payload = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        context?.tenantId ||
        null,

      transactionId:
        context?.transactionId ||
        null,

      correlationId:
        context?.correlationId ||
        null,

      operationId:
        context?.operationId ||
        null,

      journalId:
        result?.journalId ||
        null,

      postingReference:
        result?.postingReference ||
        null,

      idempotencyKey:
        context?.idempotencyKey ||
        null,

      status:
        result?.status ||
        null,

      providerOutcome:
        context?.providerOutcome ||
        null,

      at:
        now(
          this.clock,
        ).toISOString(),
    };

    try {
      if (
        this.outboxService
      ) {
        const method =
          firstFunction(
            this.outboxService,
            [
              'publish',
              'enqueue',
              'append',
            ],
          );

        if (method) {
          await this.outboxService[
            method
          ](
            payload,
          );

          return;
        }
      }

      if (
        this.eventBus
      ) {
        const method =
          firstFunction(
            this.eventBus,
            [
              'publish',
              'emit',
              'send',
            ],
          );

        if (method) {
          await this.eventBus[
            method
          ](
            payload,
          );
        }
      }
    } catch (error) {
      this.statistics.eventFailures +=
        1;

      this.log(
        'error',
        'Airtel callback ledger event publication failed',
        {
          type,

          tenantId:
            context?.tenantId,

          transactionId:
            context?.transactionId,

          code:
            error?.code,
        },
      );

      if (
        this.options
          .failClosedOnEventError
      ) {
        throw error;
      }
    }
  }

  metric(
    name,
    value = 1,
    labels = undefined,
  ) {
    try {
      const method =
        firstFunction(
          this.metrics,
          [
            'increment',
            'inc',
            'counter',
            'observe',
            'histogram',
          ],
        );

      if (!method) {
        return;
      }

      if (
        labels !==
        undefined
      ) {
        this.metrics[
          method
        ](
          name,
          value,
          labels,
        );
      } else {
        this.metrics[
          method
        ](
          name,
          value,
        );
      }
    } catch {
      // Observability must never affect accounting correctness.
    }
  }

  startSpan(
    name,
    context = {},
  ) {
    try {
      if (
        !isFunction(
          this.tracer
            ?.startSpan,
        )
      ) {
        return null;
      }

      return this.tracer.startSpan(
        name,
        {
          attributes: {
            'titech.provider':
              PROVIDER,

            'titech.operation':
              OPERATION,

            'titech.tenant_id':
              context
                ?.tenantId ||
              'unknown',

            'titech.transaction_id':
              context
                ?.transactionId ||
              'unknown',

            'titech.correlation_id':
              context
                ?.correlationId ||
              'unknown',
          },
        },
      );
    } catch {
      return null;
    }
  }

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      const method =
        isFunction(
          this.logger?.[
            level
          ],
        )
          ? level
          : 'info';

      this.logger?.[
        method
      ]?.({
        message,

        provider:
          PROVIDER,

        component:
          COMPONENT,

        ...safeClone(
          metadata,
        ),
      });
    } catch {
      // Logging must never affect accounting correctness.
    }
  }

  // ---------------------------------------------------------------------------
  // Health/readiness/diagnostics
  // ---------------------------------------------------------------------------

  async health() {
    const authority =
      this.resolveFinancialAuthority();

    const postMethod =
      this.resolvePostMethod(
        authority,
      );

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status:
        this.runtime.stopping
          ? 'STOPPING'
          : authority &&
              postMethod
            ? 'UP'
            : 'DOWN',

      initialized:
        this.runtime
          .initialized,

      financialAuthority:
        Boolean(
          authority,
        ),

      postMethod:
        postMethod ||
        null,

      activePostings:
        this.runtime
          .activePostings
          .size,

      uptimeMs:
        Date.now() -
        this.runtime
          .startedAt
          .getTime(),

      checkedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async readiness() {
    const health =
      await this.health();

    return {
      ready:
        health.status ===
        'UP',

      ...health,
    };
  }

  async liveness() {
    return {
      alive:
        !this.runtime.stopping,

      provider:
        PROVIDER,

      component:
        COMPONENT,

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  isReady() {
    return (
      this.runtime
        .initialized &&
      !this.runtime
        .stopping &&
      Boolean(
        this.resolveFinancialAuthority(),
      )
    );
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      posting:
        true,

      duplicateProtection:
        true,

      tenantIsolation:
        true,

      explicitDoubleEntry:
        true,

      exactMoneyValidation:
        true,

      providerOutcomeGate:
        true,

      lookup:
        Boolean(
          this.resolveFinancialAuthority(),
        ),

      reversal:
        Boolean(
          firstFunction(
            this.resolveFinancialAuthority(),
            [
              'reverseJournal',
              'reverseTransaction',
              'reverse',
            ],
          ),
        ),

      audit:
        Boolean(
          this.auditService,
        ),

      events:
        Boolean(
          this.eventBus ||
            this.outboxService,
        ),

      directProviderHttp:
        false,

      directDatabaseMutation:
        false,

      directLedgerMutation:
        false,

      directJournalMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      settlementFinality:
        false,

      accountingRuleOwnership:
        false,

      authoritativeBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  diagnostics() {
    const authority =
      this.resolveFinancialAuthority();

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      dependencies: {
        ledgerEngine:
          Boolean(
            this.ledgerEngine,
          ),

        financialCore:
          Boolean(
            this.financialCore,
          ),

        financialTransactionService:
          Boolean(
            this.financialTransactionService,
          ),

        ledgerPostingService:
          Boolean(
            this.ledgerPostingService,
          ),

        postingBuilder:
          Boolean(
            this.postingBuilder,
          ),

        accountResolver:
          Boolean(
            this.accountResolver,
          ),

        repository:
          Boolean(
            this.repository,
          ),

        auditService:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),

        outboxService:
          Boolean(
            this.outboxService,
          ),
      },

      financialBoundary: {
        authorityConfigured:
          Boolean(
            authority,
          ),

        authoritativeBoundary:
          FINANCIAL_BOUNDARY,

        directProviderHttp:
          false,

        directLedgerMutation:
          false,

        directJournalMutation:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,

        settlementFinality:
          false,
      },

      configuration: {
        requireTenantId:
          this.options
            .requireTenantId,

        requireIdempotencyKey:
          this.options
            .requireIdempotencyKey,

        requireTransactionId:
          this.options
            .requireTransactionId,

        requireExplicitEntries:
          this.options
            .requireExplicitEntries,

        postTimeoutMs:
          this.options
            .postTimeoutMs,

        lookupTimeoutMs:
          this.options
            .lookupTimeoutMs,

        maxRetries:
          this.options
            .maxRetries,
      },

      runtime: {
        initialized:
          this.runtime
            .initialized,

        stopping:
          this.runtime
            .stopping,

        activePostings:
          this.runtime
            .activePostings
            .size,

        lastPost:
          safeClone(
            this.runtime
              .lastPost,
          ),

        lastFailure:
          safeClone(
            this.runtime
              .lastFailure,
          ),
      },

      statistics:
        safeClone(
          this.statistics,
        ),
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  statisticsSnapshot() {
    return safeClone(
      this.statistics,
    );
  }

  async shutdown() {
    this.runtime.stopping =
      true;

    this.runtime
      .activePostings
      .clear();

    this.runtime.initialized =
      false;

    return true;
  }
}

export function createAirtelLedgerPoster(
  options = {},
) {
  return new AirtelLedgerPoster(
    options,
  );
}

export function createLedgerPoster(
  options = {},
) {
  return new AirtelLedgerPoster(
    options,
  );
}

export const CONSTANTS =
  Object.freeze({
    PROVIDER,

    OPERATION,

    COMPONENT,

    ENGINE_NAME,

    ENGINE_VERSION,

    SCHEMA_VERSION,

    HASH_ALGORITHM,

    FINANCIAL_BOUNDARY,

    POSTING_STATUS,

    PROVIDER_OUTCOME,

    DEFAULTS,
  });

export default AirtelLedgerPoster;