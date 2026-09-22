/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Reconciliation Matcher
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/reconciliationMatcher.js
 *
 * Architectural role
 * ------------------
 * Canonical deterministic evidence-matching boundary for an already validated
 * Airtel callback and an internal TITech payment/collection/transaction record.
 *
 * Flow
 * ----
 * Airtel callback
 *   -> security validation
 *   -> normalization
 *   -> correlation / callback processing
 *   -> THIS MATCHER
 *   -> reconciliation service / state workflow
 *   -> Financial Core
 *
 * Responsibilities
 * ----------------
 * - Compare provider and internal financial evidence deterministically.
 * - Match exact provider, payment, transaction and external references.
 * - Compare monetary values without JavaScript floating-point arithmetic.
 * - Validate currency and optional timestamp tolerances.
 * - Detect hard financial contradictions.
 * - Detect ambiguous / duplicate candidates.
 * - Produce explainable evidence and bounded confidence scores.
 * - Support single-pair and batch matching.
 * - Provide candidate discovery helpers for reconciliation adapters.
 * - Provide audit-safe projections, metrics, tracing and diagnostics.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Airtel API calls or OAuth.
 * - Callback signature verification.
 * - Callback schema validation.
 * - Payment execution.
 * - Ledger/journal writes.
 * - Balance/wallet mutation.
 * - State mutation.
 * - Settlement finality.
 * - Reconciliation persistence.
 * - Compensation or repair execution.
 * - Fraud/KYC/AML source-of-truth decisions.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Matching is evidence analysis, never accounting.
 * 2. Amounts are compared using exact decimal/minor-unit arithmetic.
 * 3. Currency mismatch is a hard contradiction by default.
 * 4. Amount mismatch cannot be overridden by a strong reference.
 * 5. Conflicting strong candidates resolve to REVIEW, not MATCHED.
 * 6. Weak evidence cannot automatically establish financial identity.
 * 7. Provider acceptance is not settlement.
 * 8. Returned transaction projections are sanitized and bounded.
 * 9. Tenant mismatch is never treated as a match.
 * 10. No method in this module mutates financial truth.
 *
 * Module format
 * -------------
 * Native ESM; Node.js built-ins only.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const COMPONENT = 'titech.airtel.callbacks.reconciliation-matcher';
export const ENGINE_NAME = 'airtel-callback-reconciliation-matcher';
export const ENGINE_VERSION = '5.0.0';
export const VERSION = ENGINE_VERSION;
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const MATCH_RESULT = Object.freeze({
  MATCHED: 'MATCHED',
  PARTIAL_MATCH: 'PARTIAL_MATCH',
  FAILED: 'FAILED',
  DUPLICATE: 'DUPLICATE',
  MISSING: 'MISSING',
  REVIEW: 'REVIEW',
});

export const MATCH_RULES = Object.freeze({
  EXACT_REFERENCE: 100,
  PROVIDER_REFERENCE: 90,
  TRANSACTION_REFERENCE_ALIAS: 80,
  PAYMENT_REFERENCE: 85,
  EXTERNAL_REFERENCE: 80,
  CUSTOMER_REFERENCE: 55,
  PHONE_AMOUNT: 60,
  AMOUNT: 40,
  CURRENCY: 20,
  DATE: 10,
});

export const DEFAULT_TOLERANCE = Object.freeze({
  amount: '0',
  days: 1,
});

export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_AMOUNT_SCALE = 2;

const MAX_REASON_COUNT = 25;
const MAX_CANDIDATES = 100;
const MAX_BATCH_RESULTS = 100_000;
const MAX_STRING_LENGTH = 512;
const MAX_SAFE_AMOUNT_MINOR = 9_000_000_000_000_000n;

const DEFAULT_OPTIONS = Object.freeze({
  minMatchScore: 100,
  partialScore: 70,
  reviewScore: 40,
  amountScale: DEFAULT_AMOUNT_SCALE,
  currency: DEFAULT_CURRENCY,
  requireAmount: true,
  requireCurrency: true,
  requireTemporalAgreement: false,
  allowStatusConflict: false,
  requireTenantAgreement: true,
  requireTenantId: false,
  maxCandidates: MAX_CANDIDATES,
  tolerance: DEFAULT_TOLERANCE,
});

const SUCCESS_STATUSES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'COMPLETE',
  'SETTLED',
  'CONFIRMED',
  'SETTLEMENT_SUCCESS',
  'PAID',
]);

const FAILURE_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'ERROR',
  'DECLINED',
  'REJECTED',
  'REVERSED',
  'CANCELLED',
  'CANCELED',
]);

const PENDING_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'IN_PROGRESS',
  'QUEUED',
  'ACCEPTED',
  'INITIATED',
]);

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passcode',
  'pin',
  'otp',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'secret',
  'api_key',
  'apiKey',
  'signature',
  'x-signature',
  'raw',
  'rawBody',
  'rawPayload',
  'body',
  'requestBody',
  'responseBody',
  'providerRequest',
  'providerResponse',
  'credentials',
]);

const BLOCKED_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const PROVIDER_REFERENCE_FIELDS = [
  'providerReference',
  'providerTransactionId',
  'providerTransactionReference',
  'airtelTransactionId',
  'airtelMoneyId',
];

const PAYMENT_REFERENCE_FIELDS = [
  'paymentReference',
  'payment.reference',
];

const TRANSACTION_REFERENCE_FIELDS = [
  'transactionReference',
  'transaction.reference',
  'reference',
];

const EXTERNAL_REFERENCE_FIELDS = [
  'externalReference',
  'external.reference',
  'clientReference',
  'merchantReference',
  'externalId',
];

const CUSTOMER_REFERENCE_FIELDS = [
  'customerReference',
  'customer.reference',
  'customerId',
  'memberId',
  'subscriberId',
];

const PHONE_FIELDS = [
  'phoneNumber',
  'phone',
  'msisdn',
  'mobileNumber',
  'customer.phoneNumber',
  'customer.phone',
  'payer.phoneNumber',
  'payer.phone',
];

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFunction(value) {
  return typeof value === 'function';
}

function truncate(
  value,
  max = MAX_STRING_LENGTH,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(0, max)
    : null;
}

function upper(value) {
  const normalized =
    truncate(
      value,
      128,
    );

  return normalized
    ? normalized.toUpperCase()
    : null;
}

function firstValue(
  source,
  paths = [],
) {
  for (
    const path of paths
  ) {
    let cursor =
      source;

    for (
      const segment of
        path.split('.')
    ) {
      if (
        !isObject(cursor) &&
        !Array.isArray(cursor)
      ) {
        cursor =
          undefined;
        break;
      }

      cursor =
        cursor?.[
          segment
        ];
    }

    if (
      cursor !==
        undefined &&
      cursor !==
        null &&
      cursor !== ''
    ) {
      return cursor;
    }
  }

  return null;
}

function safeClone(
  value,
  key = '',
  depth = 0,
) {
  if (
    depth > 8
  ) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  const normalizedKey =
    String(
      key || '',
    ).toLowerCase();

  if (
    SENSITIVE_KEYS.has(
      key,
    ) ||
    SENSITIVE_KEYS.has(
      normalizedKey,
    )
  ) {
    return '[REDACTED]';
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return '[BUFFER_REDACTED]';
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value === 'string'
  ) {
    return truncate(
      value,
    );
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'bigint'
  ) {
    return value.toString();
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        100,
      )
      .map(
        (
          item,
        ) =>
          safeClone(
            item,
            '',
            depth + 1,
          ),
      );
  }

  if (
    typeof value ===
      'object'
  ) {
    const output =
      {};

    for (
      const [
        childKey,
        childValue,
      ] of Object.entries(
        value,
      ).slice(
        0,
        100,
      )
    ) {
      if (
        BLOCKED_KEYS.has(
          childKey,
        )
      ) {
        continue;
      }

      output[childKey] =
        safeClone(
          childValue,
          childKey,
          depth + 1,
        );
    }

    return output;
  }

  return truncate(
    value,
  );
}

function canonicalize(
  value,
  depth = 0,
) {
  if (
    depth > 10
  ) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return `[BUFFER:${sha256(value)}]`;
  }

  if (
    typeof value !==
      'object'
  ) {
    return typeof value ===
      'bigint'
      ? value.toString()
      : value;
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        500,
      )
      .map(
        (
          item,
        ) =>
          canonicalize(
            item,
            depth + 1,
          ),
      );
  }

  return Object.keys(
    value,
  )
    .filter(
      (
        key,
      ) =>
        !BLOCKED_KEYS.has(
          key,
        ),
    )
    .sort()
    .reduce(
      (
        acc,
        key,
      ) => {
        acc[key] =
          canonicalize(
            value[key],
            depth + 1,
          );

        return acc;
      },
      {},
    );
}

function sha256(
  value,
) {
  const source =
    Buffer.isBuffer(value)
      ? value
      : typeof value ===
          'string'
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
    .update(source)
    .digest('hex');
}

function safeError(
  error,
) {
  return {
    name:
      truncate(
        error?.name ||
          'Error',
        128,
      ),

    message:
      truncate(
        error?.message ||
          String(
            error ||
              'Unknown error',
          ),
        1_000,
      ),

    code:
      truncate(
        error?.code,
        128,
      ),
  };
}

function normalizeReference(
  value,
) {
  return truncate(
    value,
    256,
  );
}

function normalizeCurrency(
  value,
  fallback =
    DEFAULT_CURRENCY,
) {
  return (
    upper(
      value ||
        fallback,
    )?.slice(
      0,
      8,
    ) ||
    null
  );
}

function normalizePhone(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  let digits =
    String(value).replace(
      /[^0-9]/g,
      '',
    );

  if (!digits) {
    return null;
  }

  if (
    digits.startsWith(
      '00',
    )
  ) {
    digits =
      digits.slice(
        2,
      );
  }

  if (
    digits.startsWith(
      '256',
    ) &&
    digits.length ===
      12
  ) {
    return `+${digits}`;
  }

  if (
    digits.startsWith(
      '0',
    ) &&
    digits.length ===
      10
  ) {
    return `+256${digits.slice(
      1,
    )}`;
  }

  return digits.length >=
      9 &&
    digits.length <=
      15
    ? `+${digits}`
    : null;
}

function normalizeAmountString(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    String(
      value,
    ).trim();

  return normalized ||
    null;
}

/**
 * Convert an unsigned positive decimal monetary value into exact minor units.
 * Never passes money through Number().
 */
function decimalToMinorUnits(
  value,
  scale,
) {
  const amount =
    normalizeAmountString(
      value,
    );

  if (!amount) {
    throw new TypeError(
      'Amount is required.',
    );
  }

  if (
    !/^\d+(?:\.\d+)?$/.test(
      amount,
    )
  ) {
    throw new TypeError(
      `Invalid monetary amount: ${amount}`,
    );
  }

  const [
    integerPart,
    fractionPart = '',
  ] =
    amount.split(
      '.',
    );

  if (
    fractionPart.length >
    scale
  ) {
    throw new TypeError(
      `Amount exceeds configured precision of ${scale} decimal places.`,
    );
  }

  const normalizedFraction =
    fractionPart.padEnd(
      scale,
      '0',
    );

  const minor =
    BigInt(
      `${integerPart}${normalizedFraction}` ||
        '0',
    );

  if (
    minor >
    MAX_SAFE_AMOUNT_MINOR
  ) {
    throw new RangeError(
      'Monetary amount exceeds supported exact range.',
    );
  }

  return minor;
}

function currencyMinorScale(
  currency,
) {
  switch (
    currency
  ) {
    case 'UGX':
    case 'RWF':
      return 0;

    default:
      return 2;
  }
}

function normalizeStatus(
  transaction,
) {
  return upper(
    firstValue(
      transaction,
      [
        'status',
        'state',
        'paymentStatus',
        'transactionStatus',
        'lifecycleStatus',
      ],
    ),
  );
}

function extractIdentifiers(
  transaction,
) {
  const identifiers =
    [];

  const seen =
    new Set();

  const candidates = [
    [
      'reference',
      firstValue(
        transaction,
        TRANSACTION_REFERENCE_FIELDS,
      ),
    ],

    [
      'providerReference',
      firstValue(
        transaction,
        PROVIDER_REFERENCE_FIELDS,
      ),
    ],

    [
      'transactionReference',
      firstValue(
        transaction,
        [
          'transactionReference',
          'transaction.reference',
        ],
      ),
    ],

    [
      'paymentReference',
      firstValue(
        transaction,
        PAYMENT_REFERENCE_FIELDS,
      ),
    ],

    [
      'externalReference',
      firstValue(
        transaction,
        EXTERNAL_REFERENCE_FIELDS,
      ),
    ],

    [
      'customerReference',
      firstValue(
        transaction,
        CUSTOMER_REFERENCE_FIELDS,
      ),
    ],

    [
      'externalId',
      firstValue(
        transaction,
        [
          'externalId',
        ],
      ),
    ],

    [
      'providerTransactionId',
      firstValue(
        transaction,
        [
          'providerTransactionId',
        ],
      ),
    ],

    [
      'receiptNumber',
      firstValue(
        transaction,
        [
          'receiptNumber',
        ],
      ),
    ],

    [
      'transactionId',
      firstValue(
        transaction,
        [
          'transactionId',
        ],
      ),
    ],

    [
      'paymentId',
      firstValue(
        transaction,
        [
          'paymentId',
        ],
      ),
    ],

    [
      'collectionId',
      firstValue(
        transaction,
        [
          'collectionId',
        ],
      ),
    ],
  ];

  for (
    const [
      field,
      value,
    ] of candidates
  ) {
    const normalized =
      normalizeReference(
        value,
      );

    if (!normalized) {
      continue;
    }

    const key =
      `${field}:${normalized}`;

    if (
      seen.has(
        key,
      )
    ) {
      continue;
    }

    seen.add(
      key,
    );

    identifiers.push({
      field,
      value:
        normalized,
    });
  }

  return identifiers;
}

function identifierMap(
  transaction,
) {
  return new Map(
    extractIdentifiers(
      transaction,
    ).map(
      (
        item,
      ) => [
        item.field,
        item.value,
      ],
    ),
  );
}

function safeTransaction(
  transaction,
) {
  if (
    !transaction ||
    typeof transaction !==
      'object'
  ) {
    return null;
  }

  const identifiers =
    identifierMap(
      transaction,
    );

  return {
    id:
      truncate(
        transaction.id ||
          transaction._id ||
          transaction.transactionId ||
          transaction.paymentId ||
          transaction.collectionId,
        256,
      ),

    tenantId:
      truncate(
        transaction.tenantId,
        256,
      ),

    provider:
      upper(
        transaction.provider ||
          transaction.paymentProvider,
      ),

    reference:
      identifiers.get(
        'reference',
      ) ||
      null,

    providerReference:
      identifiers.get(
        'providerReference',
      ) ||
      null,

    providerTransactionId:
      identifiers.get(
        'providerTransactionId',
      ) ||
      null,

    transactionReference:
      identifiers.get(
        'transactionReference',
      ) ||
      null,

    paymentReference:
      identifiers.get(
        'paymentReference',
      ) ||
      null,

    externalReference:
      identifiers.get(
        'externalReference',
      ) ||
      null,

    customerReference:
      identifiers.get(
        'customerReference',
      ) ||
      null,

    phoneNumber:
      normalizePhone(
        firstValue(
          transaction,
          PHONE_FIELDS,
        ),
      ),

    amount:
      normalizeAmountString(
        firstValue(
          transaction,
          [
            'amount',
            'transactionAmount',
            'requestAmount',
            'grossAmount',
          ],
        ),
      ),

    amountMinor:
      normalizeReference(
        firstValue(
          transaction,
          [
            'amountMinor',
            'amountInMinorUnits',
            'minorAmount',
          ],
        ),
      ),

    currency:
      normalizeCurrency(
        firstValue(
          transaction,
          [
            'currency',
            'currencyCode',
          ],
        ),
        DEFAULT_CURRENCY,
      ),

    status:
      normalizeStatus(
        transaction,
      ),

    occurredAt:
      transaction.occurredAt ||
      null,

    createdAt:
      transaction.createdAt ||
      null,

    updatedAt:
      transaction.updatedAt ||
      null,
  };
}

function extractPrimaryReference(
  transaction,
) {
  const identifiers =
    identifierMap(
      transaction,
    );

  return (
    identifiers.get(
      'reference',
    ) ||
    identifiers.get(
      'providerReference',
    ) ||
    identifiers.get(
      'transactionReference',
    ) ||
    identifiers.get(
      'paymentReference',
    ) ||
    identifiers.get(
      'externalReference',
    ) ||
    identifiers.get(
      'transactionId',
    ) ||
    identifiers.get(
      'paymentId',
    ) ||
    identifiers.get(
      'collectionId',
    ) ||
    null
  );
}

function candidateIdentity(
  transaction,
) {
  return (
    truncate(
      transaction?.id ||
        transaction?._id ||
        transaction?.transactionId ||
        transaction?.paymentId ||
        transaction?.collectionId,
      256,
    ) ||
    extractPrimaryReference(
      transaction,
    ) ||
    sha256(
      safeTransaction(
        transaction,
      ),
    )
  );
}

function transactionsBelongToSameTenant(
  providerTransaction,
  ledgerTransaction,
) {
  const providerTenant =
    truncate(
      providerTransaction?.tenantId,
      256,
    );

  const ledgerTenant =
    truncate(
      ledgerTransaction?.tenantId,
      256,
    );

  if (
    !providerTenant ||
    !ledgerTenant
  ) {
    return {
      comparable: false,
      matches:
        !providerTenant &&
        !ledgerTenant,
      providerTenant,
      ledgerTenant,
    };
  }

  return {
    comparable: true,
    matches:
      providerTenant ===
      ledgerTenant,
    providerTenant,
    ledgerTenant,
  };
}

export class AirtelReconciliationMatcherError
  extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      options.cause
        ? {
            cause:
              options.cause,
          }
        : undefined,
    );

    this.name =
      'AirtelReconciliationMatcherError';

    this.code =
      options.code ||
      'AIRTEL_RECONCILIATION_MATCH_FAILED';

    this.statusCode =
      Number(
        options.statusCode ||
          500,
      );

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.correlationId =
      options.correlationId ||
      null;
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      correlationId:
        this.correlationId,
    };
  }
}

function normalizeMatcherError(
  error,
  context = {},
) {
  if (
    error?.name ===
    'AirtelReconciliationMatcherError'
  ) {
    return error;
  }

  return new AirtelReconciliationMatcherError(
    error?.message ||
      'Airtel reconciliation matching failed.',
    {
      code:
        error?.code ||
        'AIRTEL_RECONCILIATION_MATCH_FAILED',

      statusCode:
        Number(
          error?.statusCode ||
            500,
        ),

      retryable:
        Boolean(
          error?.retryable,
        ),

      correlationId:
        context.correlationId,

      cause:
        error,
    },
  );
}

export class AirtelReconciliationMatcher {
  constructor({
    logger = null,
    metrics = null,
    tracer = null,
    tolerance =
      DEFAULT_TOLERANCE,
    clock = Date,
    amountScale =
      DEFAULT_AMOUNT_SCALE,
    currency =
      DEFAULT_CURRENCY,
    minMatchScore =
      DEFAULT_OPTIONS.minMatchScore,
    partialScore =
      DEFAULT_OPTIONS.partialScore,
    reviewScore =
      DEFAULT_OPTIONS.reviewScore,
    requireCurrency =
      DEFAULT_OPTIONS.requireCurrency,
    requireAmount =
      DEFAULT_OPTIONS.requireAmount,
    requireTemporalAgreement =
      DEFAULT_OPTIONS.requireTemporalAgreement,
    allowStatusConflict =
      DEFAULT_OPTIONS.allowStatusConflict,
    requireTenantAgreement =
      DEFAULT_OPTIONS.requireTenantAgreement,
    requireTenantId =
      DEFAULT_OPTIONS.requireTenantId,
    maxCandidates =
      MAX_CANDIDATES,
    amountTolerance = null,
    dateToleranceDays = null,
  } = {}) {
    this.logger =
      logger;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.clock =
      clock ||
      Date;

    this.amountScale =
      this.normalizeScale(
        amountScale,
      );

    this.currency =
      normalizeCurrency(
        currency,
      );

    this.tolerance = {
      amount:
        this.normalizeAmountTolerance(
          amountTolerance ??
            tolerance?.amount ??
            DEFAULT_TOLERANCE.amount,
        ),

      days:
        this.normalizeDaysTolerance(
          dateToleranceDays ??
            tolerance?.days ??
            DEFAULT_TOLERANCE.days,
        ),
    };

    this.minMatchScore =
      Math.max(
        1,
        Number(
          minMatchScore,
        ) ||
          DEFAULT_OPTIONS.minMatchScore,
      );

    this.partialScore =
      Math.max(
        0,
        Number(
          partialScore,
        ) ||
          DEFAULT_OPTIONS.partialScore,
      );

    this.reviewScore =
      Math.max(
        0,
        Number(
          reviewScore,
        ) ||
          DEFAULT_OPTIONS.reviewScore,
      );

    this.requireCurrency =
      Boolean(
        requireCurrency,
      );

    this.requireAmount =
      Boolean(
        requireAmount,
      );

    this.requireTemporalAgreement =
      Boolean(
        requireTemporalAgreement,
      );

    this.allowStatusConflict =
      Boolean(
        allowStatusConflict,
      );

    this.requireTenantAgreement =
      Boolean(
        requireTenantAgreement,
      );

    this.requireTenantId =
      Boolean(
        requireTenantId,
      );

    this.maxCandidates =
      Math.max(
        1,
        Math.min(
          MAX_CANDIDATES,
          Math.floor(
            Number(
              maxCandidates,
            ) ||
              MAX_CANDIDATES,
          ),
        ),
      );

    this.statistics = {
      comparisons:
        0,

      matched:
        0,

      partialMatches:
        0,

      failed:
        0,

      duplicates:
        0,

      missing:
        0,

      reviews:
        0,

      amountMismatches:
        0,

      currencyMismatches:
        0,

      dateMismatches:
        0,

      statusConflicts:
        0,

      tenantMismatches:
        0,

      invalidAmounts:
        0,

      candidateLookups:
        0,

      batchComparisons:
        0,
    };
  }

  match({
    providerTransaction,
    ledgerTransaction,
    internalTransaction =
      ledgerTransaction,
    tenantId = null,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    const span =
      this.startSpan(
        'airtel.reconciliation.matcher.match',
        {
          correlationId,
          tenantId,
        },
      );

    try {
      this.statistics.comparisons +=
        1;

      if (
        !providerTransaction ||
        !internalTransaction
      ) {
        this.statistics.missing +=
          1;

        return this.createResult({
          status:
            MATCH_RESULT.MISSING,

          score:
            0,

          reasons: [
            !providerTransaction
              ? 'PROVIDER_TRANSACTION_MISSING'
              : null,

            !internalTransaction
              ? 'INTERNAL_TRANSACTION_MISSING'
              : null,
          ].filter(
            Boolean,
          ),

          providerTransaction,

          ledgerTransaction:
            internalTransaction,

          tenantId,

          correlationId,
        });
      }

      const resolvedTenant =
        truncate(
          tenantId ||
            providerTransaction.tenantId ||
            internalTransaction.tenantId,
          256,
        );

      if (
        this.requireTenantId &&
        !resolvedTenant
      ) {
        throw new AirtelReconciliationMatcherError(
          'Tenant context is required for callback reconciliation matching.',
          {
            code:
              'AIRTEL_RECONCILIATION_TENANT_REQUIRED',

            statusCode:
              403,

            correlationId,
          },
        );
      }

      if (
        resolvedTenant &&
        (
          (
            providerTransaction.tenantId &&
            providerTransaction.tenantId !==
              resolvedTenant
          ) ||
          (
            internalTransaction.tenantId &&
            internalTransaction.tenantId !==
              resolvedTenant
          )
        )
      ) {
        this.statistics.tenantMismatches +=
          1;

        return this.createResult({
          status:
            MATCH_RESULT.REVIEW,

          score:
            0,

          reasons: [
            'TENANT_SCOPE_MISMATCH',
          ],

          contradictions: [
            'TENANT_SCOPE_MISMATCH',
          ],

          providerTransaction,

          ledgerTransaction:
            internalTransaction,

          tenantId:
            resolvedTenant,

          correlationId,
        });
      }

      const tenantComparison =
        transactionsBelongToSameTenant(
          providerTransaction,
          internalTransaction,
        );

      if (
        this.requireTenantAgreement &&
        tenantComparison.comparable &&
        !tenantComparison.matches
      ) {
        this.statistics
          .tenantMismatches +=
          1;

        return this.createResult({
          status:
            MATCH_RESULT.REVIEW,

          score:
            0,

          reasons: [
            'TENANT_SCOPE_MISMATCH',
          ],

          contradictions: [
            'TENANT_SCOPE_MISMATCH',
          ],

          providerTransaction,

          ledgerTransaction:
            internalTransaction,

          tenantId:
            resolvedTenant,

          correlationId,
        });
      }

      const analysis =
        this.evaluatePair({
          providerTransaction,

          ledgerTransaction:
            internalTransaction,
        });

      this.recordStatistics(
        analysis.status,
      );

      return this.createResult({
        status:
          analysis.status,

        score:
          analysis.score,

        reasons:
          analysis.reasons,

        ruleMatches:
          analysis.ruleMatches,

        contradictions:
          analysis.contradictions,

        evidence: {
          ...analysis.evidence,

          tenant:
            tenantComparison,
        },

        providerTransaction,

        ledgerTransaction:
          internalTransaction,

        tenantId:
          resolvedTenant,

        correlationId,
      });
    } catch (
      error
    ) {
      this.statistics.failed +=
        1;

      this.log(
        'error',
        'Airtel reconciliation pair matching failed',
        {
          provider:
            PROVIDER,

          component:
            COMPONENT,

          correlationId,

          tenantId,

          error:
            safeError(
              error,
            ),
        },
      );

      throw normalizeMatcherError(
        error,
        {
          correlationId,
        },
      );
    } finally {
      span?.end?.();
    }
  }

  matchCallback({
    callback,
    internalTransaction,
    ledgerTransaction =
      internalTransaction,
    tenantId = null,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    if (
      !callback ||
      !internalTransaction
    ) {
      return this.match({
        providerTransaction:
          callback,

        ledgerTransaction:
          internalTransaction,

        tenantId,

        correlationId,
      });
    }

    const providerProjection = {
      ...callback,

      provider:
        PROVIDER,

      providerReference:
        callback.providerTransactionId ||
        callback.providerReference ||
        callback.airtelTransactionId ||
        callback.transactionId,

      reference:
        callback.transactionReference ||
        callback.paymentReference ||
        callback.reference,

      providerTransactionId:
        callback.providerTransactionId ||
        callback.providerReference ||
        callback.transactionId,

      transactionReference:
        callback.transactionReference ||
        null,

      paymentReference:
        callback.paymentReference ||
        null,

      externalReference:
        callback.externalReference ||
        null,

      amount:
        callback.amount,

      amountMinor:
        callback.amountMinor,

      currency:
        callback.currency,

      status:
        callback.status,

      tenantId:
        tenantId ||
        callback.tenantId,

      occurredAt:
        callback.occurredAt ||
        callback.timestamp,

      phoneNumber:
        callback.phoneNumber,

      customerReference:
        callback.customerReference,
    };

    return this.match({
      providerTransaction:
        providerProjection,

      ledgerTransaction,

      tenantId:
        tenantId ||
        callback.tenantId,

      correlationId,
    });
  }

  matchBatch({
    providerTransactions =
      [],
    ledgerTransactions =
      [],
    tenantId = null,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    if (
      !Array.isArray(
        providerTransactions,
      ) ||
      !Array.isArray(
        ledgerTransactions,
      )
    ) {
      throw new AirtelReconciliationMatcherError(
        'Batch reconciliation inputs must be arrays.',
        {
          code:
            'AIRTEL_RECONCILIATION_BATCH_INVALID',

          statusCode:
            400,

          correlationId,
        },
      );
    }

    if (
      providerTransactions.length >
        MAX_BATCH_RESULTS ||
      ledgerTransactions.length >
        MAX_BATCH_RESULTS
    ) {
      throw new AirtelReconciliationMatcherError(
        'Reconciliation batch exceeds configured safety limit.',
        {
          code:
            'AIRTEL_RECONCILIATION_BATCH_TOO_LARGE',

          statusCode:
            413,

          correlationId,
        },
      );
    }

    const span =
      this.startSpan(
        'airtel.reconciliation.matcher.batch',
        {
          correlationId,
          tenantId,
        },
      );

    try {
      const results =
        [];

      const matchedInternalIds =
        new Set();

      const ledgerIndex =
        this.buildLedgerIndex(
          ledgerTransactions,
        );

      this.statistics
        .batchComparisons +=
        providerTransactions.length;

      for (
        const providerTransaction of
          providerTransactions
      ) {
        const candidates =
          this.findCandidates(
            providerTransaction,
            ledgerIndex,
          );

        if (
          !candidates.length
        ) {
          results.push(
            this.match({
              providerTransaction,

              ledgerTransaction:
                null,

              tenantId,

              correlationId,
            }),
          );

          continue;
        }

        const ranked =
          this.rankCandidates(
            candidates.map(
              (
                ledgerTransaction,
              ) =>
                this.match({
                  providerTransaction,

                  ledgerTransaction,

                  tenantId,

                  correlationId,
                }),
            ),
          );

        let selected =
          null;

        for (
          const candidateResult of
            ranked
        ) {
          const identity =
            this.transactionIdentity(
              candidateResult.ledgerTransaction,
            );

          if (
            candidateResult.status ===
              MATCH_RESULT.MATCHED &&
            !matchedInternalIds.has(
              identity,
            )
          ) {
            selected =
              candidateResult;

            matchedInternalIds.add(
              identity,
            );

            break;
          }
        }

        if (!selected) {
          const strongest =
            ranked[0];

          const duplicate =
            ranked.filter(
              (item) =>
                item.status ===
                MATCH_RESULT.MATCHED,
            );

          if (
            duplicate.length >
            1
          ) {
            this.statistics
              .duplicates +=
              1;

            selected =
              this.createResult({
                status:
                  MATCH_RESULT.DUPLICATE,

                score:
                  strongest?.score ||
                  0,

                reasons: [
                  'MULTIPLE_MATCHABLE_INTERNAL_CANDIDATES',
                ],

                contradictions:
                  [],

                evidence: {
                  candidateCount:
                    duplicate.length,

                  candidates:
                    duplicate
                      .slice(
                        0,
                        this.maxCandidates,
                      )
                      .map(
                        (
                          item,
                        ) => ({
                          transactionId:
                            this.transactionIdentity(
                              item.ledgerTransaction,
                            ),

                          score:
                            item.score,

                          status:
                            item.status,
                        }),
                      ),
                },

                providerTransaction,

                ledgerTransaction:
                  strongest?.ledgerTransaction ||
                  null,

                tenantId,

                correlationId,
              });
          } else if (
            strongest
          ) {
            selected =
              strongest;
          } else {
            selected =
              this.match({
                providerTransaction,

                ledgerTransaction:
                  null,

                tenantId,

                correlationId,
              });
          }
        }

        results.push(
          selected,
        );
      }

      return results;
    } finally {
      span?.end?.();
    }
  }

  findCandidates(
    transaction,
    index,
  ) {
    if (
      !transaction ||
      !(index instanceof Map)
    ) {
      return [];
    }

    const candidateKeys =
      this.extractCandidateKeys(
        transaction,
      );

    const candidateMap =
      new Map();

    for (
      const key of
        candidateKeys
    ) {
      const records =
        index.get(
          key,
        ) || [];

      for (
        const record of
          records
      ) {
        const identity =
          this.transactionIdentity(
            record,
          );

        if (
          !candidateMap.has(
            identity,
          )
        ) {
          candidateMap.set(
            identity,
            record,
          );
        }

        if (
          candidateMap.size >=
          this.maxCandidates
        ) {
          break;
        }
      }

      if (
        candidateMap.size >=
        this.maxCandidates
      ) {
        break;
      }
    }

    this.statistics
      .candidateLookups +=
      1;

    return [
      ...candidateMap.values(),
    ];
  }

  extractCandidateKeys(
    transaction,
  ) {
    return [
      ...new Set(
        extractIdentifiers(
          transaction,
        )
          .map(
            (
              item,
            ) => item.value,
          )
          .filter(
            Boolean,
          ),
      ),
    ];
  }

  buildLedgerIndex(
    ledgerTransactions = [],
  ) {
    const index =
      new Map();

    for (
      const transaction of
        ledgerTransactions.slice(
          0,
          MAX_BATCH_RESULTS,
        )
    ) {
      for (
        const key of
          this.extractCandidateKeys(
            transaction,
          )
      ) {
        const bucket =
          index.get(
            key,
          ) || [];

        bucket.push(
          transaction,
        );

        index.set(
          key,
          bucket,
        );
      }
    }

    return index;
  }

  detectDuplicates({
    providerTransaction,
    candidates = [],
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    const ranked =
      this.rankCandidates(
        candidates.map(
          (
            ledgerTransaction,
          ) =>
            this.match({
              providerTransaction,

              ledgerTransaction,

              correlationId,
            }),
        ),
      );

    const matched =
      ranked.filter(
        (item) =>
          item.status ===
          MATCH_RESULT.MATCHED,
      );

    return {
      duplicate:
        matched.length >
        1,

      count:
        matched.length,

      candidates:
        matched.slice(
          0,
          this.maxCandidates,
        ),
    };
  }

  generateFingerprint(
    transaction,
  ) {
    return sha256(
      safeTransaction(
        transaction,
      ),
    );
  }

  evaluatePair({
    providerTransaction,
    ledgerTransaction,
  }) {
    let score =
      0;

    const reasons =
      [];

    const ruleMatches =
      [];

    const contradictions =
      [];

    const providerIdentifiers =
      identifierMap(
        providerTransaction,
      );

    const ledgerIdentifiers =
      identifierMap(
        ledgerTransaction,
      );

    const providerReference =
      providerIdentifiers.get(
        'providerReference',
      );

    const ledgerProviderReference =
      ledgerIdentifiers.get(
        'providerReference',
      );

    const exactReference =
      Boolean(
        providerIdentifiers.get(
          'reference',
        ),
      ) &&
      providerIdentifiers.get(
        'reference',
      ) ===
        ledgerIdentifiers.get(
          'reference',
        );

    const providerReferenceMatch =
      Boolean(
        providerReference,
      ) &&
      providerReference ===
        ledgerProviderReference;

    const transactionReferenceMatch =
      Boolean(
        providerIdentifiers.get(
          'transactionReference',
        ),
      ) &&
      providerIdentifiers.get(
        'transactionReference',
      ) ===
        ledgerIdentifiers.get(
          'transactionReference',
        );

    const paymentReferenceMatch =
      Boolean(
        providerIdentifiers.get(
          'paymentReference',
        ),
      ) &&
      providerIdentifiers.get(
        'paymentReference',
      ) ===
        ledgerIdentifiers.get(
          'paymentReference',
        );

    const externalReferenceMatch =
      Boolean(
        providerIdentifiers.get(
          'externalReference',
        ),
      ) &&
      providerIdentifiers.get(
        'externalReference',
      ) ===
        ledgerIdentifiers.get(
          'externalReference',
        );

    const customerReferenceMatch =
      Boolean(
        providerIdentifiers.get(
          'customerReference',
        ),
      ) &&
      providerIdentifiers.get(
        'customerReference',
      ) ===
        ledgerIdentifiers.get(
          'customerReference',
        );

    const aliasReference =
      this.referencesIntersect(
        extractIdentifiers(
          providerTransaction,
        ),
        extractIdentifiers(
          ledgerTransaction,
        ),
      );

    if (
      exactReference
    ) {
      score +=
        MATCH_RULES.EXACT_REFERENCE;

      reasons.push(
        'REFERENCE_MATCH',
      );

      ruleMatches.push(
        'EXACT_REFERENCE',
      );
    } else if (
      providerReferenceMatch
    ) {
      score +=
        MATCH_RULES.PROVIDER_REFERENCE;

      reasons.push(
        'PROVIDER_REFERENCE_MATCH',
      );

      ruleMatches.push(
        'PROVIDER_REFERENCE',
      );
    } else if (
      paymentReferenceMatch
    ) {
      score +=
        MATCH_RULES.PAYMENT_REFERENCE;

      reasons.push(
        'PAYMENT_REFERENCE_MATCH',
      );

      ruleMatches.push(
        'PAYMENT_REFERENCE',
      );
    } else if (
      transactionReferenceMatch
    ) {
      score +=
        MATCH_RULES.TRANSACTION_REFERENCE_ALIAS;

      reasons.push(
        'TRANSACTION_REFERENCE_MATCH',
      );

      ruleMatches.push(
        'TRANSACTION_REFERENCE',
      );
    } else if (
      externalReferenceMatch
    ) {
      score +=
        MATCH_RULES.EXTERNAL_REFERENCE;

      reasons.push(
        'EXTERNAL_REFERENCE_MATCH',
      );

      ruleMatches.push(
        'EXTERNAL_REFERENCE',
      );
    } else if (
      aliasReference
    ) {
      score +=
        MATCH_RULES.TRANSACTION_REFERENCE_ALIAS;

      reasons.push(
        'REFERENCE_ALIAS_MATCH',
      );

      ruleMatches.push(
        'REFERENCE_ALIAS',
      );
    } else if (
      customerReferenceMatch
    ) {
      score +=
        MATCH_RULES.CUSTOMER_REFERENCE;

      reasons.push(
        'CUSTOMER_REFERENCE_MATCH',
      );

      ruleMatches.push(
        'CUSTOMER_REFERENCE',
      );
    }

    const providerAmount =
      firstValue(
        providerTransaction,
        [
          'amountMinor',
        ],
      );

    const ledgerAmount =
      firstValue(
        ledgerTransaction,
        [
          'amountMinor',
        ],
      );

    const amountComparison =
      providerAmount !==
        null &&
      providerAmount !==
        undefined &&
      ledgerAmount !==
        null &&
      ledgerAmount !==
        undefined
        ? this.compareAmountValues(
            providerAmount,
            ledgerAmount,
            providerTransaction.currency ||
              this.currency,
            ledgerTransaction.currency ||
              this.currency,
            true,
            true,
          )
        : this.compareAmountValues(
            providerTransaction.amount,
            ledgerTransaction.amount,
            providerTransaction.currency ||
              this.currency,
            ledgerTransaction.currency ||
              this.currency,
            false,
            false,
          );

    if (
      amountComparison.valid
    ) {
      if (
        amountComparison.matches
      ) {
        score +=
          MATCH_RULES.AMOUNT;

        reasons.push(
          'AMOUNT_MATCH',
        );

        ruleMatches.push(
          'AMOUNT',
        );
      } else {
        contradictions.push(
          'AMOUNT_MISMATCH',
        );

        this.statistics
          .amountMismatches +=
          1;
      }
    } else if (
      this.requireAmount
    ) {
      contradictions.push(
        'AMOUNT_INVALID_OR_MISSING',
      );

      this.statistics
        .invalidAmounts +=
        1;
    }

    const providerCurrencyRaw =
      firstValue(
        providerTransaction,
        [
          'currency',
          'currencyCode',
        ],
      );

    const ledgerCurrencyRaw =
      firstValue(
        ledgerTransaction,
        [
          'currency',
          'currencyCode',
        ],
      );

    const providerCurrency =
      normalizeCurrency(
        providerCurrencyRaw,
        this.currency,
      );

    const ledgerCurrency =
      normalizeCurrency(
        ledgerCurrencyRaw,
        this.currency,
      );

    const currencyMissing =
      (
        !providerCurrencyRaw ||
        !ledgerCurrencyRaw
      );

    const currenciesMatch =
      Boolean(
        providerCurrency &&
        ledgerCurrency &&
        providerCurrency ===
          ledgerCurrency,
      );

    if (
      currencyMissing &&
      this.requireCurrency
    ) {
      contradictions.push(
        'CURRENCY_MISSING',
      );

      this.statistics
        .currencyMismatches +=
        1;
    } else if (
      currenciesMatch
    ) {
      score +=
        MATCH_RULES.CURRENCY;

      reasons.push(
        'CURRENCY_MATCH',
      );

      ruleMatches.push(
        'CURRENCY',
      );
    } else {
      contradictions.push(
        'CURRENCY_MISMATCH',
      );

      this.statistics
        .currencyMismatches +=
        1;
    }

    const dateComparison =
      this.compareDates(
        this.extractDate(
          providerTransaction,
        ),
        this.extractDate(
          ledgerTransaction,
        ),
      );

    if (
      dateComparison.valid
    ) {
      if (
        dateComparison.matches
      ) {
        score +=
          MATCH_RULES.DATE;

        reasons.push(
          'DATE_MATCH',
        );

        ruleMatches.push(
          'DATE',
        );
      } else {
        contradictions.push(
          'DATE_OUTSIDE_TOLERANCE',
        );

        this.statistics
          .dateMismatches +=
          1;
      }
    }

    const statusComparison =
      this.compareLifecycleStatuses(
        providerTransaction,
        ledgerTransaction,
      );

    if (
      statusComparison.conflict
    ) {
      contradictions.push(
        'LIFECYCLE_STATUS_CONFLICT',
      );

      this.statistics
        .statusConflicts +=
        1;
    }

    const hardContradiction =
      this.hasHardContradiction({
        amountComparison,

        currencyMatches:
          currenciesMatch &&
          !currencyMissing,

        currencyMissing,

        statusComparison,

        providerTransaction,

        ledgerTransaction,
      });

    const identifierMatch =
      Boolean(
        exactReference ||
        providerReferenceMatch ||
        paymentReferenceMatch ||
        transactionReferenceMatch ||
        externalReferenceMatch ||
        aliasReference ||
        customerReferenceMatch,
      );

    const phoneMatch =
      Boolean(
        normalizePhone(
          firstValue(
            providerTransaction,
            PHONE_FIELDS,
          ),
        ) &&
        normalizePhone(
          firstValue(
            providerTransaction,
            PHONE_FIELDS,
          ),
        ) ===
          normalizePhone(
            firstValue(
              ledgerTransaction,
              PHONE_FIELDS,
            ),
          ),
      );

    const status =
      this.resolveStatus({
        score,

        hardContradiction,

        amountComparison,

        currencyMatches:
          currenciesMatch &&
          !currencyMissing,

        dateComparison,

        statusComparison,

        exactReference,

        providerReference:
          providerReferenceMatch,

        aliasReference:
          aliasReference ||
          transactionReferenceMatch ||
          paymentReferenceMatch ||
          externalReferenceMatch,

        identifierMatch,

        phoneMatch,
      });

    return {
      status,

      score,

      reasons:
        [
          ...new Set(
            reasons,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      ruleMatches:
        [
          ...new Set(
            ruleMatches,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      contradictions:
        [
          ...new Set(
            contradictions,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      evidence: {
        reference: {
          exact:
            exactReference,

          provider:
            providerReferenceMatch,

          payment:
            paymentReferenceMatch,

          transaction:
            transactionReferenceMatch,

          external:
            externalReferenceMatch,

          alias:
            aliasReference,

          customer:
            customerReferenceMatch,
        },

        amount:
          amountComparison,

        currency: {
          provider:
            providerCurrency,

          ledger:
            ledgerCurrency,

          providerPresent:
            Boolean(
              providerCurrencyRaw,
            ),

          ledgerPresent:
            Boolean(
              ledgerCurrencyRaw,
            ),

          missing:
            currencyMissing,

          matches:
            currenciesMatch &&
            !currencyMissing,
        },

        date:
          dateComparison,

        status:
          statusComparison,

        phone: {
          matches:
            phoneMatch,
        },

        tenant:
          transactionsBelongToSameTenant(
            providerTransaction,
            ledgerTransaction,
          ),
      },
    };
  }

  amountMatches(
    providerAmount,
    ledgerAmount,
    providerCurrency =
      this.currency,
    ledgerCurrency =
      this.currency,
    providerIsMinor = false,
    ledgerIsMinor = false,
  ) {
    return this.compareAmountValues(
      providerAmount,
      ledgerAmount,
      providerCurrency,
      ledgerCurrency,
      providerIsMinor,
      ledgerIsMinor,
    ).matches;
  }

  compareAmountValues(
    providerAmount,
    ledgerAmount,
    providerCurrency =
      this.currency,
    ledgerCurrency =
      this.currency,
    providerIsMinor = false,
    ledgerIsMinor = false,
  ) {
    if (
      providerAmount ===
        null ||
      providerAmount ===
        undefined ||
      ledgerAmount ===
        null ||
      ledgerAmount ===
        undefined
    ) {
      return {
        valid:
          false,

        matches:
          false,

        providerMinor:
          null,

        ledgerMinor:
          null,

        differenceMinor:
          null,

        toleranceMinor:
          this.tolerance.amount.toString(),
      };
    }

    try {
      const providerScale =
        currencyMinorScale(
          normalizeCurrency(
            providerCurrency,
            this.currency,
          ),
        );

      const ledgerScale =
        currencyMinorScale(
          normalizeCurrency(
            ledgerCurrency,
            this.currency,
          ),
        );

      if (
        normalizeCurrency(
          providerCurrency,
          this.currency,
        ) !==
        normalizeCurrency(
          ledgerCurrency,
          this.currency,
        )
      ) {
        return {
          valid:
            true,

          matches:
            false,

          providerMinor:
            null,

          ledgerMinor:
            null,

          differenceMinor:
            null,

          toleranceMinor:
            this.tolerance.amount.toString(),

          currencyMismatch:
            true,
        };
      }

      const providerMinor =
        providerIsMinor
          ? this.toMinorUnitsValue(
              providerAmount,
            )
          : decimalToMinorUnits(
              providerAmount,
              providerScale,
            );

      const ledgerMinor =
        ledgerIsMinor
          ? this.toMinorUnitsValue(
              ledgerAmount,
            )
          : decimalToMinorUnits(
              ledgerAmount,
              ledgerScale,
            );

      const difference =
        providerMinor >=
        ledgerMinor
          ? providerMinor -
            ledgerMinor
          : ledgerMinor -
            providerMinor;

      return {
        valid:
          true,

        matches:
          difference <=
          this.tolerance.amount,

        providerMinor:
          providerMinor.toString(),

        ledgerMinor:
          ledgerMinor.toString(),

        differenceMinor:
          difference.toString(),

        toleranceMinor:
          this.tolerance.amount.toString(),
      };
    } catch {
      return {
        valid:
          false,

        matches:
          false,

        providerMinor:
          null,

        ledgerMinor:
          null,

        differenceMinor:
          null,

        toleranceMinor:
          this.tolerance.amount.toString(),
      };
    }
  }

  toMinor(
    value,
    scale,
  ) {
    return decimalToMinorUnits(
      value,
      scale,
    );
  }

  toMinorUnitsValue(
    value,
  ) {
    const raw =
      normalizeAmountString(
        value,
      );

    if (
      !/^\d+$/.test(
        raw || '',
      )
    ) {
      throw new TypeError(
        'Minor-unit monetary value must be a non-negative integer.',
      );
    }

    const minor =
      BigInt(
        raw,
      );

    if (
      minor >
      MAX_SAFE_AMOUNT_MINOR
    ) {
      throw new RangeError(
        'Minor-unit monetary value exceeds supported exact range.',
      );
    }

    return minor;
  }

  dateMatches(
    providerDate,
    ledgerDate,
  ) {
    return this.compareDates(
      providerDate,
      ledgerDate,
    ).matches;
  }

  compareDates(
    providerDate,
    ledgerDate,
  ) {
    if (
      !providerDate ||
      !ledgerDate
    ) {
      return {
        valid:
          false,

        matches:
          false,

        differenceMs:
          null,

        differenceDays:
          null,

        toleranceDays:
          this.tolerance.days,
      };
    }

    const providerTimestamp =
      new Date(
        providerDate,
      ).getTime();

    const ledgerTimestamp =
      new Date(
        ledgerDate,
      ).getTime();

    if (
      !Number.isFinite(
        providerTimestamp,
      ) ||
      !Number.isFinite(
        ledgerTimestamp,
      )
    ) {
      return {
        valid:
          false,

        matches:
          false,

        differenceMs:
          null,

        differenceDays:
          null,

        toleranceDays:
          this.tolerance.days,
      };
    }

    const differenceMs =
      Math.abs(
        providerTimestamp -
          ledgerTimestamp,
      );

    const toleranceMs =
      this.tolerance.days *
      86_400_000;

    return {
      valid:
        true,

      matches:
        differenceMs <=
        toleranceMs,

      differenceMs,

      differenceDays:
        differenceMs /
        86_400_000,

      toleranceDays:
        this.tolerance.days,
    };
  }

  compareLifecycleStatuses(
    providerTransaction,
    ledgerTransaction,
  ) {
    const providerStatus =
      normalizeStatus(
        providerTransaction,
      );

    const ledgerStatus =
      normalizeStatus(
        ledgerTransaction,
      );

    if (
      !providerStatus ||
      !ledgerStatus
    ) {
      return {
        comparable:
          false,

        conflict:
          false,

        providerStatus,

        ledgerStatus,
      };
    }

    const providerSuccess =
      SUCCESS_STATUSES.has(
        providerStatus,
      );

    const ledgerSuccess =
      SUCCESS_STATUSES.has(
        ledgerStatus,
      );

    const providerFailure =
      FAILURE_STATUSES.has(
        providerStatus,
      );

    const ledgerFailure =
      FAILURE_STATUSES.has(
        ledgerStatus,
      );

    const providerPending =
      PENDING_STATUSES.has(
        providerStatus,
      );

    const ledgerPending =
      PENDING_STATUSES.has(
        ledgerStatus,
      );

    const conflict =
      (
        providerSuccess &&
        ledgerFailure
      ) ||
      (
        providerFailure &&
        ledgerSuccess
      );

    return {
      comparable:
        true,

      conflict:
        !this.allowStatusConflict &&
        conflict,

      providerStatus,

      ledgerStatus,

      providerSuccess,

      ledgerSuccess,

      providerFailure,

      ledgerFailure,

      providerPending,

      ledgerPending,
    };
  }

  resolveStatus({
    score,
    hardContradiction,
    amountComparison,
    currencyMatches,
    dateComparison,
    statusComparison,
    exactReference,
    providerReference,
    aliasReference,
    identifierMatch,
    phoneMatch,
  }) {
    if (
      hardContradiction
    ) {
      if (
        exactReference ||
        providerReference ||
        aliasReference
      ) {
        return MATCH_RESULT.REVIEW;
      }

      return MATCH_RESULT.FAILED;
    }

    const strongIdentifier =
      Boolean(
        exactReference ||
        providerReference ||
        aliasReference,
      );

    const usableAmount =
      amountComparison?.valid &&
      amountComparison?.matches;

    const usableCurrency =
      Boolean(
        currencyMatches,
      );

    const temporalMatch =
      Boolean(
        dateComparison?.matches,
      );

    if (
      exactReference &&
      usableAmount &&
      usableCurrency &&
      (
        temporalMatch ||
        !this.requireTemporalAgreement ||
        !dateComparison.valid
      )
    ) {
      return MATCH_RESULT.MATCHED;
    }

    if (
      strongIdentifier &&
      usableAmount &&
      usableCurrency &&
      score >=
        this.minMatchScore
    ) {
      if (
        this.requireTemporalAgreement &&
        dateComparison.valid &&
        !temporalMatch
      ) {
        return MATCH_RESULT.PARTIAL_MATCH;
      }

      return MATCH_RESULT.MATCHED;
    }

    if (
      identifierMatch &&
      usableAmount &&
      usableCurrency &&
      score >=
        this.partialScore
    ) {
      return MATCH_RESULT.PARTIAL_MATCH;
    }

    if (
      phoneMatch &&
      usableAmount &&
      usableCurrency &&
      score >=
        this.reviewScore
    ) {
      return MATCH_RESULT.REVIEW;
    }

    if (
      score >=
      this.reviewScore
    ) {
      return MATCH_RESULT.REVIEW;
    }

    return MATCH_RESULT.FAILED;
  }

  hasHardContradiction({
    amountComparison,
    currencyMatches,
    currencyMissing = false,
    statusComparison,
  }) {
    if (
      this.requireAmount &&
      (
        !amountComparison?.valid ||
        !amountComparison?.matches
      )
    ) {
      return true;
    }

    if (
      this.requireCurrency &&
      (
        currencyMissing ||
        !currencyMatches
      )
    ) {
      return true;
    }

    if (
      statusComparison?.conflict
    ) {
      return true;
    }

    return false;
  }

  referencesIntersect(
    providerIdentifiers,
    ledgerIdentifiers,
  ) {
    const providerValues =
      new Set(
        providerIdentifiers.map(
          (
            item,
          ) =>
            item.value,
        ),
      );

    return ledgerIdentifiers.some(
      (
        item,
      ) =>
        providerValues.has(
          item.value,
        ),
    );
  }

  rankCandidates(
    results = [],
  ) {
    return [
      ...results,
    ].sort(
      (
        left,
        right,
      ) => {
        const leftPriority =
          this.statusPriority(
            left?.status,
          );

        const rightPriority =
          this.statusPriority(
            right?.status,
          );

        if (
          leftPriority !==
          rightPriority
        ) {
          return (
            rightPriority -
            leftPriority
          );
        }

        return (
          Number(
            right?.score ||
              0,
          ) -
          Number(
            left?.score ||
              0,
          )
        );
      },
    );
  }

  statusPriority(
    status,
  ) {
    switch (
      status
    ) {
      case MATCH_RESULT.MATCHED:
        return 5;

      case MATCH_RESULT.PARTIAL_MATCH:
        return 4;

      case MATCH_RESULT.REVIEW:
        return 3;

      case MATCH_RESULT.DUPLICATE:
        return 2;

      case MATCH_RESULT.MISSING:
        return 1;

      default:
        return 0;
    }
  }

  createResult({
    status,
    score = 0,
    reasons = [],
    ruleMatches = [],
    contradictions = [],
    evidence = null,
    providerTransaction =
      null,
    ledgerTransaction =
      null,
    tenantId =
      null,
    correlationId =
      null,
  } = {}) {
    const normalizedScore =
      Math.max(
        0,
        Math.min(
          100,
          Number(score) ||
            0,
        ),
      );

    const providerProjection =
      safeTransaction(
        providerTransaction,
      );

    const ledgerProjection =
      safeTransaction(
        ledgerTransaction,
      );

    return {
      matchId:
        crypto.randomUUID(),

      provider:
        PROVIDER,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status,

      score:
        normalizedScore,

      confidence:
        this.confidenceFromScore(
          normalizedScore,
        ),

      reasons:
        [
          ...new Set(
            reasons,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      ruleMatches:
        [
          ...new Set(
            ruleMatches,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      contradictions:
        [
          ...new Set(
            contradictions,
          ),
        ].slice(
          0,
          MAX_REASON_COUNT,
        ),

      evidence:
        evidence
          ? safeClone(
              evidence,
            )
          : null,

      providerTransaction:
        providerProjection,

      ledgerTransaction:
        ledgerProjection,

      providerTransactionId:
        providerProjection
          ?.providerTransactionId ||
        providerProjection
          ?.id ||
        null,

      internalTransactionId:
        ledgerProjection
          ?.id ||
        null,

      tenantId:
        truncate(
          tenantId,
          256,
        ),

      correlationId:
        truncate(
          correlationId,
          256,
        ),

      financialSettlementConfirmed:
        false,

      authoritativeFinancialEvidence:
        false,

      nextAction:
        this.nextActionForStatus(
          status,
        ),

      financialBoundary:
        FINANCIAL_BOUNDARY,

      timestamp:
        new Date(
          this.clock.now?.() ??
            Date.now(),
        ).toISOString(),
    };
  }

  nextActionForStatus(
    status,
  ) {
    switch (
      status
    ) {
      case MATCH_RESULT.MATCHED:
        return 'RECONCILIATION_CONFIRMATION_REQUIRED';

      case MATCH_RESULT.PARTIAL_MATCH:
        return 'REVIEW_OR_ADDITIONAL_EVIDENCE';

      case MATCH_RESULT.REVIEW:
        return 'MANUAL_REVIEW';

      case MATCH_RESULT.DUPLICATE:
        return 'DUPLICATE_REVIEW';

      case MATCH_RESULT.MISSING:
        return 'LOCATE_MISSING_RECORD';

      case MATCH_RESULT.FAILED:
      default:
        return 'RECONCILIATION_EXCEPTION';
    }
  }

  confidenceFromScore(
    score,
  ) {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Number(
            score,
          ) || 0,
        ),
      ),
    );
  }

  transactionIdentity(
    transaction,
  ) {
    return candidateIdentity(
      transaction,
    );
  }

  extractDate(
    transaction,
  ) {
    return firstValue(
      transaction,
      [
        'occurredAt',
        'transactionDate',
        'completedAt',
        'processedAt',
        'createdAt',
        'updatedAt',
      ],
    );
  }

  normalizeScale(
    value,
  ) {
    const numeric =
      Number(value);

    if (
      !Number.isInteger(
        numeric,
      ) ||
      numeric < 0 ||
      numeric > 9
    ) {
      return DEFAULT_AMOUNT_SCALE;
    }

    return numeric;
  }

  normalizeAmountTolerance(
    value,
  ) {
    try {
      return decimalToMinorUnits(
        value ??
          '0',

        this.amountScale,
      );
    } catch {
      return 0n;
    }
  }

  normalizeDaysTolerance(
    value,
  ) {
    const numeric =
      Number(value);

    if (
      !Number.isFinite(
        numeric,
      ) ||
      numeric < 0
    ) {
      return 1;
    }

    return Math.min(
      numeric,
      365,
    );
  }

  recordStatistics(
    status,
  ) {
    switch (
      status
    ) {
      case MATCH_RESULT.MATCHED:
        this.statistics
          .matched +=
          1;
        break;

      case MATCH_RESULT.PARTIAL_MATCH:
        this.statistics
          .partialMatches +=
          1;
        break;

      case MATCH_RESULT.DUPLICATE:
        this.statistics
          .duplicates +=
          1;
        break;

      case MATCH_RESULT.MISSING:
        this.statistics
          .missing +=
          1;
        break;

      case MATCH_RESULT.REVIEW:
        this.statistics
          .reviews +=
          1;
        break;

      default:
        this.statistics
          .failed +=
          1;
    }
  }

  stats() {
    return {
      ...this.statistics,

      amountScale:
        this.amountScale,

      defaultCurrency:
        this.currency,

      amountToleranceMinor:
        this.tolerance.amount.toString(),

      dateToleranceDays:
        this.tolerance.days,

      minMatchScore:
        this.minMatchScore,

      partialScore:
        this.partialScore,

      reviewScore:
        this.reviewScore,

      requireAmount:
        this.requireAmount,

      requireCurrency:
        this.requireCurrency,

      requireTemporalAgreement:
        this.requireTemporalAgreement,

      allowStatusConflict:
        this.allowStatusConflict,

      requireTenantAgreement:
        this.requireTenantAgreement,

      requireTenantId:
        this.requireTenantId,
    };
  }

  health() {
    const configurationValid =
      this.amountScale >=
        0 &&
      this.amountScale <=
        9 &&
      this.tolerance.days >=
        0 &&
      this.tolerance.amount >=
        0n;

    return {
      provider:
        PROVIDER,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status:
        configurationValid
          ? 'UP'
          : 'DOWN',

      directProviderHttp:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      settlementFinality:
        false,

      authoritativeFinancialBoundary:
        FINANCIAL_BOUNDARY,

      configuration: {
        amountScale:
          this.amountScale,

        currency:
          this.currency,

        amountToleranceMinor:
          this.tolerance.amount.toString(),

        dateToleranceDays:
          this.tolerance.days,

        requireTenantAgreement:
          this.requireTenantAgreement,

        requireTenantId:
          this.requireTenantId,
      },

      statistics:
        this.stats(),
    };
  }

  diagnostics() {
    return {
      provider:
        PROVIDER,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      matchingModel: {
        exactReference:
          MATCH_RULES.EXACT_REFERENCE,

        providerReference:
          MATCH_RULES.PROVIDER_REFERENCE,

        paymentReference:
          MATCH_RULES.PAYMENT_REFERENCE,

        transactionReferenceAlias:
          MATCH_RULES.TRANSACTION_REFERENCE_ALIAS,

        externalReference:
          MATCH_RULES.EXTERNAL_REFERENCE,

        customerReference:
          MATCH_RULES.CUSTOMER_REFERENCE,

        amount:
          MATCH_RULES.AMOUNT,

        currency:
          MATCH_RULES.CURRENCY,

        date:
          MATCH_RULES.DATE,
      },

      controls: {
        requireAmount:
          this.requireAmount,

        requireCurrency:
          this.requireCurrency,

        requireTemporalAgreement:
          this.requireTemporalAgreement,

        allowStatusConflict:
          this.allowStatusConflict,

        requireTenantAgreement:
          this.requireTenantAgreement,

        requireTenantId:
          this.requireTenantId,

        maxCandidates:
          this.maxCandidates,
      },

      safety: {
        directProviderHttp:
          false,

        directDatabaseWrites:
          false,

        directLedgerWrites:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,

        directSettlementFinality:
          false,

        authoritativeFinancialBoundary:
          FINANCIAL_BOUNDARY,
      },

      statistics:
        this.stats(),
    };
  }

  startSpan(
    name,
    attributes = {},
  ) {
    if (
      !isFunction(
        this.tracer?.startSpan,
      )
    ) {
      return null;
    }

    try {
      const span =
        this.tracer.startSpan(
          name,
        );

      span?.setAttribute?.(
        'provider',
        PROVIDER,
      );

      span?.setAttribute?.(
        'component',
        COMPONENT,
      );

      for (
        const [
          key,
          value,
        ] of Object.entries(
          attributes,
        )
      ) {
        if (
          value !== null &&
          value !== undefined
        ) {
          span?.setAttribute?.(
            key,
            String(value),
          );
        }
      }

      return span;
    } catch (
      error
    ) {
      this.logger?.debug?.({
        provider:
          PROVIDER,

        component:
          COMPONENT,

        message:
          'Unable to start Airtel reconciliation matcher span.',

        error:
          safeError(
            error,
          ),
      });

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
        provider:
          PROVIDER,

        component:
          COMPONENT,

        message,

        ...safeClone(
          metadata,
        ),
      });
    } catch {
      // Logging must never alter reconciliation correctness.
    }
  }
}

export function createAirtelReconciliationMatcher(
  options = {},
) {
  return new AirtelReconciliationMatcher(
    options,
  );
}

export function createReconciliationMatcher(
  options = {},
) {
  return new AirtelReconciliationMatcher(
    options,
  );
}

export const DEFAULTS =
  Object.freeze({
    ...DEFAULT_OPTIONS,
    tolerance:
      DEFAULT_TOLERANCE,
  });

export const CONSTANTS =
  Object.freeze({
    PROVIDER,

    COMPONENT,

    ENGINE_NAME,

    ENGINE_VERSION,

    SCHEMA_VERSION,

    HASH_ALGORITHM,

    FINANCIAL_BOUNDARY,

    MATCH_RESULT,

    MATCH_RULES,

    DEFAULT_TOLERANCE,

    DEFAULT_CURRENCY,

    DEFAULT_AMOUNT_SCALE,
  });

export {
  decimalToMinorUnits,
  normalizeCurrency,
  normalizePhone,
  normalizeStatus,
  extractIdentifiers,
  safeTransaction,
};

export default AirtelReconciliationMatcher;