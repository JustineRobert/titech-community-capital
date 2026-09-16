/**
 * backend/models/Reconciliation.js
 * TITech Community Capital — Reconciliation Aggregate
 *
 * Architectural role:
 * - Represents one reconciliation execution/control record comparing external
 *   provider transactions against TITech internal payment/transaction/ledger
 *   records.
 * - Stores execution identity, reconciliation period, provider scope,
 *   control totals, bounded result evidence, exception counts, approval state,
 *   reconciliation state, and worker ownership.
 *
 * IMPORTANT FINANCIAL BOUNDARY:
 * - Reconciliation is an operational control record.
 * - It is NOT the accounting ledger.
 * - It is NOT an account balance.
 * - It MUST NOT directly mutate balances, accounts, wallets, or ledger entries.
 * - Any corrective financial adjustment must be performed by the canonical
 *   financial transaction/ledger service and separately audited.
 *
 * Important boundaries:
 * - Large exception populations should be persisted in a dedicated
 *   ReconciliationException aggregate rather than embedded indefinitely here.
 * - Embedded transaction snapshots are evidence of the values observed during
 *   this reconciliation run, not authoritative transaction state.
 * - Provider authentication, webhook verification, and provider API access
 *   belong to provider adapters/services.
 * - Tenant authorization remains a service/repository responsibility.
 * - Approval is a control decision, not a financial posting operation.
 *
 * Security principles:
 * - Native ESM only.
 * - Tenant-aware persistence.
 * - Exact Decimal128-safe validation without JavaScript floating-point
 *   conversion for monetary comparisons.
 * - Bounded embedded evidence.
 * - Sensitive metadata is sanitized.
 * - Generic mutation and hard deletion are blocked.
 * - Worker ownership uses atomic lease claims.
 * - Terminal state transitions are controlled.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Canonical flow:
 *
 * Provider / Internal Source
 *          ↓
 * Reconciliation Runner
 *          ↓
 * Reconciliation
 *          ↓
 * Exception Investigation / Approval
 *          ↓
 * FinancialTransactionService
 *          ↓
 * Double-Entry Ledger
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const RECONCILIATION_PROVIDERS = Object.freeze([
  'MTN_MOMO',
  'AIRTEL_MONEY',
  'STRIPE',
  'PAYPAL',
  'LEDGER',
  'MANUAL',
  'ALL',
]);

export const RECONCILIATION_STATUSES = Object.freeze([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'PARTIAL',
  'CANCELLED',
]);

export const RECONCILIATION_TYPES = Object.freeze([
  'DAILY',
  'INTRADAY',
  'WEEKLY',
  'MONTHLY',
  'MANUAL',
  'BACKFILL',
  'ON_DEMAND',
]);

export const EXCEPTION_TYPES = Object.freeze([
  'MISSING_INTERNAL',
  'MISSING_PROVIDER',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'STATUS_MISMATCH',
  'REFERENCE_MISMATCH',
  'DUPLICATE_PROVIDER',
  'DUPLICATE_INTERNAL',
  'DATE_MISMATCH',
  'ACCOUNT_MISMATCH',
  'MEMBER_MISMATCH',
  'UNKNOWN',
]);

export const EXCEPTION_STATUSES = Object.freeze([
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'WAIVED',
]);

export const RECONCILIATION_MATCH_METHODS = Object.freeze([
  'EXACT_REFERENCE',
  'PROVIDER_REFERENCE',
  'TRANSACTION_ID',
  'PAYMENT_ID',
  'AMOUNT_CURRENCY_DATE',
  'MANUAL',
  'OTHER',
]);

const RUNNABLE_STATUSES = new Set([
  'PENDING',
  'FAILED',
]);

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);

const MAX_REFERENCE_LENGTH = 256;
const MAX_STATUS_LENGTH = 128;
const MAX_REASON_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 5_000;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 50;
const MAX_EMBEDDED_MATCHED = 500;
const MAX_EMBEDDED_EXCEPTIONS = 500;
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 64;
const MAX_WORKER_ID_LENGTH = 256;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MIN_LEASE_MS = 10 * 1000;
const MAX_LEASE_MS = 24 * 60 * 60 * 1000;

/* ==========================================================================
 * Decimal helpers
 * ========================================================================== */

/**
 * Normalize a Decimal128-like value into:
 *
 *   {
 *     coefficient: BigInt,
 *     scale: number
 *   }
 *
 * No JavaScript floating-point arithmetic is used.
 */
function parseDecimal(value, fieldName) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const raw =
    value instanceof mongoose.Types.Decimal128
      ? value.toString()
      : String(value).trim();

  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)
  ) {
    throw new TypeError(
      `${fieldName} must be a non-negative decimal value.`,
    );
  }

  const [integerPart, fractionPart = ''] =
    raw.split('.');

  const digits =
    `${integerPart}${fractionPart}`;

  const coefficient = BigInt(digits);

  return {
    coefficient,
    scale: fractionPart.length,
  };
}

function compareDecimals(left, right) {
  const leftDecimal =
    parseDecimal(left, 'left');

  const rightDecimal =
    parseDecimal(right, 'right');

  const scale =
    Math.max(
      leftDecimal.scale,
      rightDecimal.scale,
    );

  const leftCoefficient =
    leftDecimal.coefficient *
    10n ** BigInt(
      scale - leftDecimal.scale,
    );

  const rightCoefficient =
    rightDecimal.coefficient *
    10n ** BigInt(
      scale - rightDecimal.scale,
    );

  if (
    leftCoefficient <
    rightCoefficient
  ) {
    return -1;
  }

  if (
    leftCoefficient >
    rightCoefficient
  ) {
    return 1;
  }

  return 0;
}

function isNonNegativeDecimal(value) {
  try {
    parseDecimal(value, 'amount');
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
 * General helpers
 * ========================================================================== */

function normalizeTenantId(value) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      'tenantId is required.',
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      'tenantId is required.',
    );
  }

  return normalized;
}

function normalizeRequiredString(
  value,
  fieldName,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`,
    );
  }

  return normalized;
}

function normalizeNullableString(
  value,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    maxLength,
  );
}

function normalizeObjectId(
  value,
  fieldName,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    !mongoose.isValidObjectId(
      value,
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(
    value,
  );
}

function normalizeDate(value, fieldName) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid date.`,
    );
  }

  return date;
}

function normalizeLeaseMs(value) {
  const leaseMs =
    Number(value ?? DEFAULT_LEASE_MS);

  if (
    !Number.isFinite(
      leaseMs,
    ) ||
    leaseMs < MIN_LEASE_MS ||
    leaseMs > MAX_LEASE_MS
  ) {
    throw new RangeError(
      `leaseMs must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds.`,
    );
  }

  return Math.floor(leaseMs);
}

/* ==========================================================================
 * Metadata sanitization
 * ========================================================================== */

const SENSITIVE_KEY_FRAGMENTS =
  Object.freeze([
    'password',
    'passwd',
    'passcode',
    'pin',
    'otp',
    'totp',
    'secret',
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'authorization',
    'cookie',
    'set-cookie',
    'private_key',
    'privatekey',
    'api_key',
    'apikey',
    'cvv',
    'pan',
  ]);

function isSensitiveKey(key) {
  const normalized =
    String(key)
      .trim()
      .toLowerCase()
      .replace(/[\s-]/g, '');

  return SENSITIVE_KEY_FRAGMENTS.some(
    (fragment) =>
      normalized.includes(
        fragment.replace(
          /[_-]/g,
          '',
        ),
      ),
  );
}

function sanitizeMetadata(
  value,
  depth = 0,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return {};
  }

  if (
    depth > MAX_METADATA_DEPTH
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return '[BUFFER]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(
        0,
        MAX_METADATA_ARRAY_LENGTH,
      )
      .map((item) =>
        sanitizeMetadata(
          item,
          depth + 1,
        ),
      );
  }

  if (
    typeof value === 'object'
  ) {
    const output = {};

    const entries =
      Object.entries(value).slice(
        0,
        MAX_METADATA_KEYS,
      );

    for (
      const [key, childValue]
        of entries
    ) {
      output[key] =
        isSensitiveKey(key)
          ? '[REDACTED]'
          : sanitizeMetadata(
              childValue,
              depth + 1,
            );
    }

    if (
      Object.keys(value).length >
      MAX_METADATA_KEYS
    ) {
      output._truncatedKeys = true;
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

/* ==========================================================================
 * Money schema
 * ========================================================================== */

const MoneySchema =
  new Schema(
    {
      amount: {
        type: Schema.Types.Decimal128,
        required: true,
      },

      currency: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 10,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Transaction snapshot schema
 * ========================================================================== */

const TransactionSnapshotSchema =
  new Schema(
    {
      transactionId: {
        type: Schema.Types.ObjectId,
        default: null,
      },

      referenceId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REFERENCE_LENGTH,
      },

      providerTransactionId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REFERENCE_LENGTH,
      },

      providerReference: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REFERENCE_LENGTH,
      },

      accountId: {
        type: Schema.Types.ObjectId,
        default: null,
      },

      memberId: {
        type: Schema.Types.ObjectId,
        default: null,
      },

      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      groupId: {
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null,
      },

      paymentId: {
        type: Schema.Types.ObjectId,
        ref: 'Payment',
        default: null,
      },

      paymentIntentId: {
        type: Schema.Types.ObjectId,
        ref: 'PaymentIntent',
        default: null,
      },

      amount: {
        type: Schema.Types.Decimal128,
        default: () =>
          mongoose.Types.Decimal128.fromString(
            '0',
          ),
      },

      currency: {
        type: String,
        default: null,
        uppercase: true,
        trim: true,
        maxlength: 10,
      },

      status: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_STATUS_LENGTH,
      },

      transactionDate: {
        type: Date,
        default: null,
      },

      settledAt: {
        type: Date,
        default: null,
      },

      metadata: {
        type: Schema.Types.Mixed,
        default: undefined,
        select: false,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Match schema
 * ========================================================================== */

const MatchedTransactionSchema =
  new Schema(
    {
      provider: {
        type: TransactionSnapshotSchema,
        required: true,
      },

      internal: {
        type: TransactionSnapshotSchema,
        required: true,
      },

      matchMethod: {
        type: String,
        enum:
          RECONCILIATION_MATCH_METHODS,
        default: 'OTHER',
        trim: true,
      },

      confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 1,
      },

      matchedAt: {
        type: Date,
        default: Date.now,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Mismatch / exception schema
 * ========================================================================== */

const MismatchSchema =
  new Schema(
    {
      provider: {
        type: TransactionSnapshotSchema,
        default: null,
      },

      internal: {
        type: TransactionSnapshotSchema,
        default: null,
      },

      type: {
        type: String,
        enum: EXCEPTION_TYPES,
        required: true,
      },

      reason: {
        type: String,
        required: true,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
      },

      expectedAmount: {
        type: Schema.Types.Decimal128,
        default: null,
      },

      actualAmount: {
        type: Schema.Types.Decimal128,
        default: null,
      },

      differenceAmount: {
        type: Schema.Types.Decimal128,
        default: null,
      },

      status: {
        type: String,
        enum: EXCEPTION_STATUSES,
        default: 'OPEN',
      },

      resolvedAt: {
        type: Date,
        default: null,
      },

      resolvedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      resolutionNote: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
      },
    },
    {
      _id: true,
      id: true,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Summary schema
 * ========================================================================== */

const SummarySchema =
  new Schema(
    {
      matched: {
        type: Number,
        default: 0,
        min: 0,
      },

      missingInternal: {
        type: Number,
        default: 0,
        min: 0,
      },

      missingProvider: {
        type: Number,
        default: 0,
        min: 0,
      },

      mismatches: {
        type: Number,
        default: 0,
        min: 0,
      },

      duplicates: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalExceptions: {
        type: Number,
        default: 0,
        min: 0,
      },

      providerAmount: {
        type: MoneySchema,
        default: null,
      },

      internalAmount: {
        type: MoneySchema,
        default: null,
      },

      differenceAmount: {
        type: Schema.Types.Decimal128,
        default: () =>
          mongoose.Types.Decimal128.fromString(
            '0',
          ),
      },

      /**
       * Indicates that embedded evidence has been capped and the complete
       * exception set exists in a dedicated exception store.
       */
      embeddedResultsTruncated: {
        type: Boolean,
        default: false,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Main reconciliation schema
 * ========================================================================== */

const ReconciliationSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * Tenant
       * ----------------------------------------------------------------------
       */

      tenantId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength: 128,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Identity
       * ----------------------------------------------------------------------
       */

      reconciliationId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        minlength: 8,
        maxlength:
          MAX_REFERENCE_LENGTH,
      },

      executionId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REFERENCE_LENGTH,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Provider
       * ----------------------------------------------------------------------
       */

      provider: {
        type: String,
        required: true,
        enum: RECONCILIATION_PROVIDERS,
        immutable: true,
        uppercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Reconciliation type
       * ----------------------------------------------------------------------
       */

      type: {
        type: String,
        required: true,
        enum: RECONCILIATION_TYPES,
        immutable: true,
        uppercase: true,
        trim: true,
        default: 'ON_DEMAND',
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Period
       * ----------------------------------------------------------------------
       */

      periodStart: {
        type: Date,
        required: true,
        immutable: true,
        index: true,
      },

      periodEnd: {
        type: Date,
        required: true,
        immutable: true,
        index: true,
      },

      reconciliationDate: {
        type: Date,
        required: true,
        immutable: true,
        default: Date.now,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Execution lifecycle
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        required: true,
        enum: RECONCILIATION_STATUSES,
        default: 'PENDING',
        uppercase: true,
        trim: true,
        index: true,
      },

      startedAt: {
        type: Date,
        default: null,
      },

      completedAt: {
        type: Date,
        default: null,
      },

      failedAt: {
        type: Date,
        default: null,
      },

      cancelledAt: {
        type: Date,
        default: null,
      },

      durationMs: {
        type: Number,
        default: null,
        min: 0,
      },

      /*
       * ----------------------------------------------------------------------
       * Worker lease
       * ----------------------------------------------------------------------
       */

      runnerId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_WORKER_ID_LENGTH,
        index: true,
      },

      lockAcquiredAt: {
        type: Date,
        default: null,
      },

      lockExpiresAt: {
        type: Date,
        default: null,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Source counts
       * ----------------------------------------------------------------------
       */

      totalProviderTransactions: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalInternalTransactions: {
        type: Number,
        default: 0,
        min: 0,
      },

      /*
       * ----------------------------------------------------------------------
       * Control totals
       * ----------------------------------------------------------------------
       */

      providerTotal: {
        type: MoneySchema,
        default: null,
      },

      internalTotal: {
        type: MoneySchema,
        default: null,
      },

      differenceTotal: {
        type: Schema.Types.Decimal128,
        default: () =>
          mongoose.Types.Decimal128.fromString(
            '0',
          ),
      },

      /*
       * ----------------------------------------------------------------------
       * Bounded evidence
       * ----------------------------------------------------------------------
       *
       * These arrays are intentionally capped. Large reconciliation datasets
       * belong in a dedicated ReconciliationException/result collection.
       */

      matched: {
        type: [MatchedTransactionSchema],
        default: undefined,
        validate: {
          validator(value) {
            return (
              value.length <=
              MAX_EMBEDDED_MATCHED
            );
          },
          message:
            `Embedded matched results cannot exceed ${MAX_EMBEDDED_MATCHED}.`,
        },
      },

      missingInternal: {
        type: [TransactionSnapshotSchema],
        default: undefined,
        validate: {
          validator(value) {
            return (
              value.length <=
              MAX_EMBEDDED_EXCEPTIONS
            );
          },
          message:
            `Embedded missingInternal results cannot exceed ${MAX_EMBEDDED_EXCEPTIONS}.`,
        },
      },

      missingProvider: {
        type: [TransactionSnapshotSchema],
        default: undefined,
        validate: {
          validator(value) {
            return (
              value.length <=
              MAX_EMBEDDED_EXCEPTIONS
            );
          },
          message:
            `Embedded missingProvider results cannot exceed ${MAX_EMBEDDED_EXCEPTIONS}.`,
        },
      },

      duplicates: {
        type: [TransactionSnapshotSchema],
        default: undefined,
        validate: {
          validator(value) {
            return (
              value.length <=
              MAX_EMBEDDED_EXCEPTIONS
            );
          },
          message:
            `Embedded duplicates cannot exceed ${MAX_EMBEDDED_EXCEPTIONS}.`,
        },
      },

      mismatches: {
        type: [MismatchSchema],
        default: undefined,
        validate: {
          validator(value) {
            return (
              value.length <=
              MAX_EMBEDDED_EXCEPTIONS
            );
          },
          message:
            `Embedded mismatches cannot exceed ${MAX_EMBEDDED_EXCEPTIONS}.`,
        },
      },

      summary: {
        type: SummarySchema,
        default: () => ({}),
      },

      /*
       * ----------------------------------------------------------------------
       * Control result
       * ----------------------------------------------------------------------
       */

      isBalanced: {
        type: Boolean,
        default: false,
        index: true,
      },

      exceptionCount: {
        type: Number,
        default: 0,
        min: 0,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Execution provenance
       * ----------------------------------------------------------------------
       */

      generatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
      },

      generatedByService: {
        type: String,
        default: null,
        trim: true,
        maxlength: 128,
        immutable: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Approval
       * ----------------------------------------------------------------------
       */

      requiresApproval: {
        type: Boolean,
        default: false,
      },

      approvedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      approvedAt: {
        type: Date,
        default: null,
      },

      approvalNote: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Error
       * ----------------------------------------------------------------------
       */

      error: {
        code: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_ERROR_CODE_LENGTH,
        },

        message: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_ERROR_MESSAGE_LENGTH,
        },

        occurredAt: {
          type: Date,
          default: null,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Operational metadata
       * ----------------------------------------------------------------------
       */

      notes: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_NOTE_LENGTH,
      },

      metadata: {
        type: Schema.Types.Mixed,
        default: undefined,
        select: false,
      },

      tags: {
        type: [
          {
            type: String,
            trim: true,
            uppercase: true,
            maxlength: MAX_TAG_LENGTH,
          },
        ],
        default: [],
        validate: {
          validator(value) {
            return value.length <= MAX_TAGS;
          },
          message:
            `Reconciliation cannot contain more than ${MAX_TAGS} tags.`,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Administrative state
       * ----------------------------------------------------------------------
       */

      isDeleted: {
        type: Boolean,
        default: false,
        index: true,
      },

      deletedAt: {
        type: Date,
        default: null,
      },

      deletedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      deleteReason: {
        type: String,
        default: null,
        trim: true,
        maxlength: 1_000,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      collection: 'reconciliations',

      minimize: true,

      strict: 'throw',

      toJSON: {
        virtuals: true,
        versionKey: false,

        transform(doc, ret) {
          ret.id =
            ret._id.toString();

          delete ret._id;
          delete ret.__v;
          delete ret.metadata;

          return ret;
        },
      },

      toObject: {
        virtuals: true,
        versionKey: false,
      },
    },
  );

/* ==========================================================================
 * Indexes
 * ========================================================================== */

/**
 * Tenant + reconciliation identity.
 */
ReconciliationSchema.index(
  {
    tenantId: 1,
    reconciliationId: 1,
  },
  {
    unique: true,
    name:
      'uniq_tenant_reconciliation_id',
  },
);

/**
 * Tenant history.
 */
ReconciliationSchema.index({
  tenantId: 1,
  reconciliationDate: -1,
  _id: -1,
});

/**
 * Provider history.
 */
ReconciliationSchema.index({
  tenantId: 1,
  provider: 1,
  reconciliationDate: -1,
  _id: -1,
});

/**
 * Status operations.
 */
ReconciliationSchema.index({
  tenantId: 1,
  status: 1,
  reconciliationDate: -1,
});

/**
 * Exception monitoring.
 */
ReconciliationSchema.index({
  tenantId: 1,
  isBalanced: 1,
  exceptionCount: -1,
});

/**
 * Execution tracking.
 */
ReconciliationSchema.index({
  tenantId: 1,
  executionId: 1,
});

/**
 * Lease recovery.
 */
ReconciliationSchema.index({
  tenantId: 1,
  status: 1,
  lockExpiresAt: 1,
});

/**
 * Period queries.
 */
ReconciliationSchema.index({
  tenantId: 1,
  provider: 1,
  periodStart: 1,
  periodEnd: 1,
});

/**
 * Scheduled reconciliation uniqueness.
 *
 * MANUAL / BACKFILL / ON_DEMAND runs deliberately remain repeatable.
 */
ReconciliationSchema.index(
  {
    tenantId: 1,
    provider: 1,
    periodStart: 1,
    periodEnd: 1,
    type: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
      type: {
        $in: [
          'DAILY',
          'INTRADAY',
          'WEEKLY',
          'MONTHLY',
        ],
      },
    },
    name:
      'uniq_scheduled_reconciliation_period',
  },
);

/**
 * Approval queue.
 */
ReconciliationSchema.index({
  tenantId: 1,
  requiresApproval: 1,
  status: 1,
  reconciliationDate: -1,
});

/**
 * Unresolved-control queue.
 */
ReconciliationSchema.index({
  tenantId: 1,
  exceptionCount: 1,
  isBalanced: 1,
  status: 1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

ReconciliationSchema.virtual(
  'hasExceptions',
).get(function getHasExceptions() {
  return this.exceptionCount > 0;
});

ReconciliationSchema.virtual(
  'isComplete',
).get(function getIsComplete() {
  return [
    'COMPLETED',
    'PARTIAL',
  ].includes(
    this.status,
  );
});

ReconciliationSchema.virtual(
  'isTerminal',
).get(function getIsTerminal() {
  return TERMINAL_STATUSES.has(
    this.status,
  );
});

ReconciliationSchema.virtual(
  'hasActiveLease',
).get(function getHasActiveLease() {
  return Boolean(
    this.runnerId &&
      this.lockExpiresAt &&
      this.lockExpiresAt.getTime() >
        Date.now(),
  );
});

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

ReconciliationSchema.query.active =
  function active() {
    return this.where({
      isDeleted: false,
    });
  };

ReconciliationSchema.query.forTenant =
  function forTenant(
    tenantId,
  ) {
    return this.where({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),
      isDeleted: false,
    });
  };

ReconciliationSchema.query.balanced =
  function balanced() {
    return this.where({
      isBalanced: true,
      exceptionCount: 0,
      isDeleted: false,
    });
  };

ReconciliationSchema.query.withExceptions =
  function withExceptions() {
    return this.where({
      exceptionCount: {
        $gt: 0,
      },
      isDeleted: false,
    });
  };

ReconciliationSchema.query.completed =
  function completed() {
    return this.where({
      status: 'COMPLETED',
      isDeleted: false,
    });
  };

ReconciliationSchema.query.partial =
  function partial() {
    return this.where({
      status: 'PARTIAL',
      isDeleted: false,
    });
  };

ReconciliationSchema.query.pending =
  function pending() {
    return this.where({
      status: 'PENDING',
      isDeleted: false,
    });
  };

ReconciliationSchema.query.running =
  function running() {
    return this.where({
      status: 'RUNNING',
      isDeleted: false,
    });
  };

ReconciliationSchema.query.needingApproval =
  function needingApproval() {
    return this.where({
      requiresApproval: true,
      approvedAt: null,
      status: {
        $in: [
          'COMPLETED',
          'PARTIAL',
        ],
      },
      isDeleted: false,
    });
  };

/* ==========================================================================
 * Instance helpers
 * ========================================================================== */

ReconciliationSchema.methods.calculateExceptionCount =
  function calculateExceptionCount() {
    const summary =
      this.summary ?? {};

    const total =
      Number(summary.missingInternal ?? 0) +
      Number(summary.missingProvider ?? 0) +
      Number(summary.mismatches ?? 0) +
      Number(summary.duplicates ?? 0);

    this.exceptionCount =
      Number.isFinite(total)
        ? Math.max(0, Math.floor(total))
        : 0;

    if (
      this.summary
    ) {
      this.summary.totalExceptions =
        this.exceptionCount;
    }

    return this.exceptionCount;
  };

ReconciliationSchema.methods.isRunnable =
  function isRunnable() {
    return (
      !this.isDeleted &&
      RUNNABLE_STATUSES.has(
        this.status,
      )
    );
  };

ReconciliationSchema.methods.isLockExpired =
  function isLockExpired() {
    if (!this.lockExpiresAt) {
      return true;
    }

    return (
      this.lockExpiresAt.getTime() <=
      Date.now()
    );
  };

ReconciliationSchema.methods.calculateDuration =
  function calculateDuration(
    endTime = new Date(),
  ) {
    if (!this.startedAt) {
      return null;
    }

    return Math.max(
      0,
      endTime.getTime() -
        this.startedAt.getTime(),
    );
  };

/* ==========================================================================
 * Controlled state transitions
 * ========================================================================== */

ReconciliationSchema.methods.markRunning =
  async function markRunning({
    runnerId,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    if (
      !this.isRunnable()
    ) {
      throw new Error(
        `Reconciliation cannot enter RUNNING from ${this.status}.`,
      );
    }

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_WORKER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(
        leaseMs,
      );

    const now =
      new Date();

    this.status =
      'RUNNING';

    this.startedAt =
      this.startedAt ?? now;

    this.runnerId =
      normalizedRunnerId;

    this.lockAcquiredAt =
      now;

    this.lockExpiresAt =
      new Date(
        now.getTime() +
          normalizedLeaseMs,
      );

    this.failedAt =
      null;

    this.completedAt =
      null;

    this.cancelledAt =
      null;

    this.error =
      null;

    await this.save();

    return this;
  };

ReconciliationSchema.methods.renewLease =
  async function renewLease({
    runnerId,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_WORKER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(
        leaseMs,
      );

    if (
      this.status !==
        'RUNNING' ||
      this.runnerId !==
        normalizedRunnerId
    ) {
      throw new Error(
        'Runner does not own this reconciliation lease.',
      );
    }

    if (
      this.isLockExpired()
    ) {
      throw new Error(
        'Reconciliation lease has expired.',
      );
    }

    const now =
      new Date();

    this.lockExpiresAt =
      new Date(
        now.getTime() +
          normalizedLeaseMs,
      );

    await this.save();

    return this;
  };

ReconciliationSchema.methods.calculateAndApplyResults =
  function calculateAndApplyResults({
    matched,
    missingInternal,
    missingProvider,
    duplicates,
    mismatches,
    summary,
  } = {}) {
    const arrays = {
      matched:
        matched ?? [],
      missingInternal:
        missingInternal ?? [],
      missingProvider:
        missingProvider ?? [],
      duplicates:
        duplicates ?? [],
      mismatches:
        mismatches ?? [],
    };

    const totalExceptionResults =
      arrays.missingInternal.length +
      arrays.missingProvider.length +
      arrays.duplicates.length +
      arrays.mismatches.length;

    const truncated =
      arrays.matched.length >
        MAX_EMBEDDED_MATCHED ||
      arrays.missingInternal.length >
        MAX_EMBEDDED_EXCEPTIONS ||
      arrays.missingProvider.length >
        MAX_EMBEDDED_EXCEPTIONS ||
      arrays.duplicates.length >
        MAX_EMBEDDED_EXCEPTIONS ||
      arrays.mismatches.length >
        MAX_EMBEDDED_EXCEPTIONS;

    this.matched =
      arrays.matched.slice(
        0,
        MAX_EMBEDDED_MATCHED,
      );

    this.missingInternal =
      arrays.missingInternal.slice(
        0,
        MAX_EMBEDDED_EXCEPTIONS,
      );

    this.missingProvider =
      arrays.missingProvider.slice(
        0,
        MAX_EMBEDDED_EXCEPTIONS,
      );

    this.duplicates =
      arrays.duplicates.slice(
        0,
        MAX_EMBEDDED_EXCEPTIONS,
      );

    this.mismatches =
      arrays.mismatches.slice(
        0,
        MAX_EMBEDDED_EXCEPTIONS,
      );

    if (summary) {
      this.summary = {
        ...this.summary?.toObject?.() ??
          this.summary ??
          {},
        ...summary,
      };
    }

    this.summary.embeddedResultsTruncated =
      truncated;

    /**
     * The authoritative exception count should come from the reconciliation
     * result, not the size of the bounded embedded arrays.
     */
    this.calculateExceptionCount();

    if (
      !summary
    ) {
      this.summary.matched =
        arrays.matched.length;

      this.summary.missingInternal =
        arrays.missingInternal.length;

      this.summary.missingProvider =
        arrays.missingProvider.length;

      this.summary.mismatches =
        arrays.mismatches.length;

      this.summary.duplicates =
        arrays.duplicates.length;

      this.summary.totalExceptions =
        totalExceptionResults;

      this.exceptionCount =
        totalExceptionResults;
    }

    this.isBalanced =
      this.exceptionCount === 0;

    return this;
  };

ReconciliationSchema.methods.markCompleted =
  async function markCompleted({
    runnerId,
    summary,
    matched,
    missingInternal,
    missingProvider,
    duplicates,
    mismatches,
  } = {}) {
    if (
      this.status !==
      'RUNNING'
    ) {
      throw new Error(
        `Reconciliation cannot complete from ${this.status}.`,
      );
    }

    if (
      runnerId &&
      this.runnerId !==
        runnerId
    ) {
      throw new Error(
        'Only the owning runner can complete this reconciliation.',
      );
    }

    if (
      this.runnerId &&
      this.isLockExpired()
    ) {
      throw new Error(
        'Reconciliation lease has expired.',
      );
    }

    this.calculateAndApplyResults({
      summary,
      matched,
      missingInternal,
      missingProvider,
      duplicates,
      mismatches,
    });

    const now =
      new Date();

    this.status =
      this.exceptionCount === 0
        ? 'COMPLETED'
        : 'PARTIAL';

    this.completedAt =
      now;

    this.durationMs =
      this.calculateDuration(
        now,
      );

    this.failedAt =
      null;

    this.cancelledAt =
      null;

    this.error =
      null;

    this.runnerId =
      null;

    this.lockAcquiredAt =
      null;

    this.lockExpiresAt =
      null;

    await this.save();

    return this;
  };

ReconciliationSchema.methods.markFailed =
  async function markFailed({
    runnerId,
    code = 'RECONCILIATION_FAILED',
    message = 'Reconciliation failed.',
  } = {}) {
    if (
      this.status !==
      'RUNNING'
    ) {
      throw new Error(
        `Reconciliation cannot fail from ${this.status}.`,
      );
    }

    if (
      runnerId &&
      this.runnerId !==
        runnerId
    ) {
      throw new Error(
        'Only the owning runner can fail this reconciliation.',
      );
    }

    const now =
      new Date();

    this.status =
      'FAILED';

    this.failedAt =
      now;

    this.durationMs =
      this.calculateDuration(
        now,
      );

    this.error = {
      code:
        normalizeNullableString(
          code,
          MAX_ERROR_CODE_LENGTH,
        ),

      message:
        normalizeNullableString(
          message,
          MAX_ERROR_MESSAGE_LENGTH,
        ),

      occurredAt:
        now,
    };

    this.runnerId =
      null;

    this.lockAcquiredAt =
      null;

    this.lockExpiresAt =
      null;

    await this.save();

    return this;
  };

ReconciliationSchema.methods.cancel =
  async function cancel(
    reason = null,
  ) {
    if (
      TERMINAL_STATUSES.has(
        this.status,
      )
    ) {
      throw new Error(
        `Cannot cancel reconciliation in ${this.status}.`,
      );
    }

    const now =
      new Date();

    this.status =
      'CANCELLED';

    this.cancelledAt =
      now;

    this.durationMs =
      this.calculateDuration(
        now,
      );

    if (reason) {
      this.error = {
        code:
          'RECONCILIATION_CANCELLED',
        message:
          normalizeNullableString(
            reason,
            MAX_ERROR_MESSAGE_LENGTH,
          ),
        occurredAt:
          now,
      };
    }

    this.runnerId =
      null;

    this.lockAcquiredAt =
      null;

    this.lockExpiresAt =
      null;

    await this.save();

    return this;
  };

ReconciliationSchema.methods.approve =
  async function approve({
    approvedBy,
    note = null,
  } = {}) {
    const normalizedApprovedBy =
      normalizeObjectId(
        approvedBy,
        'approvedBy',
      );

    if (
      !normalizedApprovedBy
    ) {
      throw new TypeError(
        'approvedBy is required.',
      );
    }

    if (
      ![
        'COMPLETED',
        'PARTIAL',
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        'Only completed or partial reconciliations can be approved.',
      );
    }

    if (
      !this.requiresApproval
    ) {
      throw new Error(
        'This reconciliation does not require approval.',
      );
    }

    if (
      this.approvedAt
    ) {
      return this;
    }

    this.approvedBy =
      normalizedApprovedBy;

    this.approvedAt =
      new Date();

    this.approvalNote =
      normalizeNullableString(
        note,
        MAX_REASON_LENGTH,
      );

    await this.save();

    return this;
  };

ReconciliationSchema.methods.softDelete =
  async function softDelete({
    deletedBy = null,
    reason = null,
  } = {}) {
    if (
      !this.isTerminal
    ) {
      throw new Error(
        'Only terminal reconciliations can be administratively soft-deleted.',
      );
    }

    this.isDeleted =
      true;

    this.deletedAt =
      new Date();

    this.deletedBy =
      normalizeObjectId(
        deletedBy,
        'deletedBy',
      );

    this.deleteReason =
      normalizeNullableString(
        reason,
        1_000,
      );

    await this.save();

    return this;
  };

/* ==========================================================================
 * Static lookup methods
 * ========================================================================== */

ReconciliationSchema.statics.findByReconciliationId =
  function findByReconciliationId(
    tenantId,
    reconciliationId,
  ) {
    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      reconciliationId:
        normalizeRequiredString(
          reconciliationId,
          'reconciliationId',
          MAX_REFERENCE_LENGTH,
        ),

      isDeleted: false,
    });
  };

ReconciliationSchema.statics.findForPeriod =
  function findForPeriod({
    tenantId,
    provider,
    periodStart,
    periodEnd,
    type,
  }) {
    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      provider,
      periodStart:
        normalizeDate(
          periodStart,
          'periodStart',
        ),

      periodEnd:
        normalizeDate(
          periodEnd,
          'periodEnd',
        ),

      type,
      isDeleted: false,
    });
  };

ReconciliationSchema.statics.findBalanced =
  function findBalanced(
    tenantId,
    {
      provider,
      limit = 100,
    } = {},
  ) {
    const filter = {
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      isBalanced: true,
      exceptionCount: 0,
      isDeleted: false,
    };

    if (provider) {
      filter.provider =
        String(provider)
          .trim()
          .toUpperCase();
    }

    return this.find(filter)
      .sort({
        reconciliationDate: -1,
        _id: -1,
      })
      .limit(
        Math.min(
          Math.max(
            Number(limit) || 100,
            1,
          ),
          500,
        ),
      );
  };

ReconciliationSchema.statics.findExceptions =
  function findExceptions(
    tenantId,
    {
      provider,
      limit = 100,
    } = {},
  ) {
    const filter = {
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      exceptionCount: {
        $gt: 0,
      },

      isDeleted: false,
    };

    if (provider) {
      filter.provider =
        String(provider)
          .trim()
          .toUpperCase();
    }

    return this.find(filter)
      .sort({
        reconciliationDate: -1,
        _id: -1,
      })
      .limit(
        Math.min(
          Math.max(
            Number(limit) || 100,
            1,
          ),
          500,
        ),
      );
  };

/* ==========================================================================
 * Atomic worker operations
 * ========================================================================== */

/**
 * Atomically claim a reconciliation.
 *
 * A claim is allowed when:
 * - status is PENDING; or
 * - status is FAILED; or
 * - status is RUNNING but its lease has expired.
 */
ReconciliationSchema.statics.claimForProcessing =
  async function claimForProcessing({
    tenantId,
    reconciliationId,
    runnerId,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedId =
      normalizeRequiredString(
        reconciliationId,
        'reconciliationId',
        MAX_REFERENCE_LENGTH,
      );

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_WORKER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(
        leaseMs,
      );

    const now =
      new Date();

    const lockExpiresAt =
      new Date(
        now.getTime() +
          normalizedLeaseMs,
      );

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        reconciliationId:
          normalizedId,

        isDeleted: false,

        $or: [
          {
            status: 'PENDING',
          },
          {
            status: 'FAILED',
          },
          {
            status: 'RUNNING',
            lockExpiresAt: {
              $lte: now,
            },
          },
        ],
      },
      {
        $set: {
          status: 'RUNNING',
          startedAt: now,

          runnerId:
            normalizedRunnerId,

          lockAcquiredAt:
            now,

          lockExpiresAt,

          completedAt: null,
          failedAt: null,
          cancelledAt: null,

          error: null,
        },
      },
      {
        new: true,
        runValidators: true,
        allowReconciliationMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically renew a reconciliation worker lease.
 */
ReconciliationSchema.statics.renewLease =
  async function renewLease({
    tenantId,
    reconciliationId,
    runnerId,
    leaseMs = DEFAULT_LEASE_MS,
  } = {}) {
    const normalizedLeaseMs =
      normalizeLeaseMs(
        leaseMs,
      );

    const now =
      new Date();

    const lockExpiresAt =
      new Date(
        now.getTime() +
          normalizedLeaseMs,
      );

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        reconciliationId:
          normalizeRequiredString(
            reconciliationId,
            'reconciliationId',
            MAX_REFERENCE_LENGTH,
          ),

        status: 'RUNNING',

        runnerId:
          normalizeRequiredString(
            runnerId,
            'runnerId',
            MAX_WORKER_ID_LENGTH,
          ),

        lockExpiresAt: {
          $gt: now,
        },

        isDeleted: false,
      },
      {
        $set: {
          lockExpiresAt,
        },
      },
      {
        new: true,
        runValidators: true,
        allowReconciliationMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically finalize a reconciliation.
 *
 * This is the preferred worker completion operation because it prevents a
 * stale worker from overwriting a newer owner.
 */
ReconciliationSchema.statics.completeAtomically =
  async function completeAtomically({
    tenantId,
    reconciliationId,
    runnerId,
    summary,
    differenceTotal,
    isBalanced,
    requiresApproval,
  } = {}) {
    const now =
      new Date();

    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedReconciliationId =
      normalizeRequiredString(
        reconciliationId,
        'reconciliationId',
        MAX_REFERENCE_LENGTH,
      );

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_WORKER_ID_LENGTH,
      );

    const normalizedSummary =
      summary ?? {};

    const exceptionCount =
      Number(
        normalizedSummary
          .missingInternal ??
          0,
      ) +
      Number(
        normalizedSummary
          .missingProvider ??
          0,
      ) +
      Number(
        normalizedSummary
          .mismatches ??
          0,
      ) +
      Number(
        normalizedSummary
          .duplicates ??
          0,
      );

    const finalIsBalanced =
      isBalanced !== undefined
        ? Boolean(isBalanced)
        : exceptionCount === 0;

    const finalStatus =
      finalIsBalanced
        ? 'COMPLETED'
        : 'PARTIAL';

    const set = {
      status:
        finalStatus,

      completedAt:
        now,

      failedAt:
        null,

      cancelledAt:
        null,

      error:
        null,

      exceptionCount,

      isBalanced:
        finalIsBalanced,

      requiresApproval:
        Boolean(
          requiresApproval,
        ),

      'summary.totalExceptions':
        exceptionCount,

      runnerId:
        null,

      lockAcquiredAt:
        null,

      lockExpiresAt:
        null,
    };

    if (
      differenceTotal !== undefined
    ) {
      if (
        !isNonNegativeDecimal(
          differenceTotal,
        )
      ) {
        throw new TypeError(
          'differenceTotal must be a non-negative decimal.',
        );
      }

      set.differenceTotal =
        mongoose.Types.Decimal128.fromString(
          String(
            differenceTotal,
          ),
        );
    }

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        reconciliationId:
          normalizedReconciliationId,

        status: 'RUNNING',

        runnerId:
          normalizedRunnerId,

        lockExpiresAt: {
          $gt: now,
        },

        isDeleted: false,
      },
      {
        $set: set,
      },
      {
        new: true,
        runValidators: true,
        allowReconciliationMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically fail a reconciliation.
 */
ReconciliationSchema.statics.failAtomically =
  async function failAtomically({
    tenantId,
    reconciliationId,
    runnerId,
    code =
      'RECONCILIATION_FAILED',
    message =
      'Reconciliation failed.',
  } = {}) {
    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        reconciliationId:
          normalizeRequiredString(
            reconciliationId,
            'reconciliationId',
            MAX_REFERENCE_LENGTH,
          ),

        status: 'RUNNING',

        runnerId:
          normalizeRequiredString(
            runnerId,
            'runnerId',
            MAX_WORKER_ID_LENGTH,
          ),

        isDeleted: false,
      },
      {
        $set: {
          status: 'FAILED',

          failedAt:
            now,

          error: {
            code:
              normalizeNullableString(
                code,
                MAX_ERROR_CODE_LENGTH,
              ),

            message:
              normalizeNullableString(
                message,
                MAX_ERROR_MESSAGE_LENGTH,
              ),

            occurredAt:
              now,
          },

          runnerId:
            null,

          lockAcquiredAt:
            null,

          lockExpiresAt:
            null,
        },
      },
      {
        new: true,
        runValidators: true,
        allowReconciliationMutation:
          true,
      },
    ).exec();
  };

/* ==========================================================================
 * Validation middleware
 * ========================================================================== */

ReconciliationSchema.pre(
  'validate',
  function validateReconciliation(
    next,
  ) {
    try {
      if (
        this.provider
      ) {
        this.provider =
          String(
            this.provider,
          )
            .trim()
            .toUpperCase();
      }

      if (
        this.type
      ) {
        this.type =
          String(
            this.type,
          )
            .trim()
            .toUpperCase();
      }

      if (
        this.periodStart &&
        this.periodEnd &&
        this.periodEnd <=
          this.periodStart
      ) {
        this.invalidate(
          'periodEnd',
          'periodEnd must be later than periodStart.',
        );
      }

      if (
        this.startedAt &&
        this.reconciliationDate &&
        this.startedAt <
          this.reconciliationDate
      ) {
        /**
         * Reconciliation execution can begin after the logical reconciliation
         * date. Do not force reconciliationDate to equal execution start.
         */
      }

      if (
        this.status ===
          'RUNNING' &&
        !this.startedAt
      ) {
        this.startedAt =
          new Date();
      }

      if (
        this.status ===
          'COMPLETED' &&
        !this.completedAt
      ) {
        this.completedAt =
          new Date();
      }

      if (
        this.status ===
          'PARTIAL' &&
        !this.completedAt
      ) {
        this.completedAt =
          new Date();
      }

      if (
        this.status ===
          'FAILED' &&
        !this.failedAt
      ) {
        this.failedAt =
          new Date();
      }

      if (
        this.status ===
          'CANCELLED' &&
        !this.cancelledAt
      ) {
        this.cancelledAt =
          new Date();
      }

      if (
        this.startedAt &&
        this.completedAt &&
        this.completedAt <
          this.startedAt
      ) {
        this.invalidate(
          'completedAt',
          'completedAt cannot precede startedAt.',
        );
      }

      if (
        this.startedAt &&
        this.failedAt &&
        this.failedAt <
          this.startedAt
      ) {
        this.invalidate(
          'failedAt',
          'failedAt cannot precede startedAt.',
        );
      }

      if (
        this.startedAt &&
        this.cancelledAt &&
        this.cancelledAt <
          this.startedAt
      ) {
        this.invalidate(
          'cancelledAt',
          'cancelledAt cannot precede startedAt.',
        );
      }

      if (
        this.startedAt &&
        this.completedAt
      ) {
        this.durationMs =
          Math.max(
            0,
            this.completedAt.getTime() -
              this.startedAt.getTime(),
          );
      }

      if (
        this.startedAt &&
        this.failedAt
      ) {
        this.durationMs =
          Math.max(
            0,
            this.failedAt.getTime() -
              this.startedAt.getTime(),
          );
      }

      if (
        this.summary
      ) {
        this.calculateExceptionCount();
      }

      if (
        this.exceptionCount === 0
      ) {
        this.isBalanced =
          true;
      }

      if (
        this.exceptionCount > 0
      ) {
        this.isBalanced =
          false;
      }

      if (
        this.approvedBy &&
        !this.requiresApproval
      ) {
        this.invalidate(
          'approvedBy',
          'approvedBy requires requiresApproval=true.',
        );
      }

      if (
        this.approvedBy &&
        !this.approvedAt
      ) {
        this.approvedAt =
          new Date();
      }

      if (
        this.requiresApproval &&
        this.approvedAt &&
        ![
          'COMPLETED',
          'PARTIAL',
        ].includes(
          this.status,
        )
      ) {
        this.invalidate(
          'approvedAt',
          'Only completed or partial reconciliations can be approved.',
        );
      }

      if (
        this.lockAcquiredAt &&
        this.lockExpiresAt &&
        this.lockExpiresAt <
          this.lockAcquiredAt
      ) {
        this.invalidate(
          'lockExpiresAt',
          'lockExpiresAt cannot precede lockAcquiredAt.',
        );
      }

      if (
        [
          'COMPLETED',
          'PARTIAL',
          'FAILED',
          'CANCELLED',
        ].includes(
          this.status,
        )
      ) {
        this.runnerId =
          null;
        this.lockAcquiredAt =
          null;
        this.lockExpiresAt =
          null;
      }

      if (
        this.metadata
      ) {
        this.metadata =
          sanitizeMetadata(
            this.metadata,
          );
      }

      if (
        Array.isArray(
          this.tags,
        )
      ) {
        this.tags = [
          ...new Set(
            this.tags
              .map(
                (tag) =>
                  String(
                    tag,
                  )
                    .trim()
                    .toUpperCase()
                    .slice(
                      0,
                      MAX_TAG_LENGTH,
                    ),
              )
              .filter(Boolean),
          ),
        ];
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

/**
 * Reconciliation history is a financial-control record. Hard deletion is
 * deliberately unavailable through ordinary model operations.
 */
ReconciliationSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventHardDelete(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'Reconciliation hard deletion is disabled.',
      ),
    );
  },
);

/**
 * Generic updates are blocked. Controlled lifecycle methods explicitly opt in.
 */
ReconciliationSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      options.allowReconciliationMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic Reconciliation updates are disabled. Use controlled lifecycle methods.',
      ),
    );
  },
);

ReconciliationSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for Reconciliation.',
      ),
    );
  },
);

/* ==========================================================================
 * Soft-delete query protection
 * ========================================================================== */

ReconciliationSchema.pre(
  /^find/,
  function hideDeleted(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      !options.includeDeleted
    ) {
      this.where({
        isDeleted: false,
      });
    }

    next();
  },
);

/* ==========================================================================
 * Model export
 * ========================================================================== */

const Reconciliation =
  mongoose.models.Reconciliation ||
  mongoose.model(
    'Reconciliation',
    ReconciliationSchema,
  );

export default Reconciliation;

export {
  ReconciliationSchema,
  MoneySchema,
  TransactionSnapshotSchema,
  MatchedTransactionSchema,
  MismatchSchema,
  SummarySchema,
  compareDecimals,
  sanitizeMetadata,
  MAX_EMBEDDED_MATCHED,
  MAX_EMBEDDED_EXCEPTIONS,
};