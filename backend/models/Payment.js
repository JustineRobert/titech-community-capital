/**
 * backend/models/Payment.js
 * TITech Community Capital — Payment Aggregate
 *
 * Architectural role:
 * - Represents an external payment attempt and its provider lifecycle.
 * - Supports MTN Mobile Money, Airtel Money, bank/card/payment providers,
 *   provider references, provider events/webhooks, retries, reconciliation,
 *   refunds, and ledger-posting state.
 * - Provides the persistence boundary for external payment identity and
 *   provider lifecycle state.
 *
 * IMPORTANT FINANCIAL BOUNDARY:
 * - Payment is NOT the authoritative accounting ledger.
 * - Payment balance is never authoritative accounting state.
 * - Payment completion does NOT by itself constitute ledger posting.
 * - Financial posting must be performed by the canonical financial service
 *   and ledger infrastructure.
 * - Ledger posting must be idempotent and reconciled with this aggregate.
 *
 * Important boundaries:
 * - This model does not mutate balances.
 * - This model does not create double-entry journal entries directly.
 * - This model does not calculate accounting balances.
 * - Provider authentication/signing verification belongs to the provider
 *   integration service.
 * - Webhook authorization and signature verification belong to the provider
 *   adapter/service before this model is called.
 * - Tenant authorization belongs to the service/repository layer.
 * - Idempotency enforcement is supported here but request-level ownership,
 *   replay policy, and response caching remain service responsibilities.
 *
 * Security principles:
 * - Native ESM only.
 * - Monetary values use Decimal128.
 * - No Number arithmetic is used for authoritative money comparisons.
 * - Sensitive payment identifiers are excluded from normal serialization.
 * - Raw IP/User-Agent/device identifiers are not persisted.
 * - Provider event identity supports duplicate-event protection.
 * - Tenant-scoped idempotency is enforced at the database level.
 * - Generic mutation operations are blocked.
 * - Lifecycle transitions are controlled.
 * - Soft deletion does not erase financial history.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Canonical financial flow:
 *
 * Provider
 *    ↓
 * Provider Adapter / Webhook Verification
 *    ↓
 * Payment Service
 *    ↓
 * Payment
 *    ↓
 * FinancialTransactionService
 *    ↓
 * Double-Entry Ledger
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const SUPPORTED_CURRENCIES = Object.freeze([
  'UGX',
  'XAF',
  'EUR',
  'USD',
  'NGN',
  'GHS',
  'KES',
  'TZS',
  'RWF',
  'ZAR',
]);

export const PAYMENT_PROVIDERS = Object.freeze([
  'MTN_MOMO',
  'AIRTEL_MONEY',
  'STRIPE',
  'PAYPAL',
]);

export const PAYMENT_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);

export const PAYMENT_METHODS = Object.freeze([
  'MOBILE_MONEY',
  'CARD',
  'BANK_TRANSFER',
  'WALLET',
  'OTHER',
]);

export const RECONCILIATION_STATUSES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING',
  'MATCHED',
  'MISMATCHED',
  'RESOLVED',
]);

export const LEDGER_POSTING_STATUSES = Object.freeze([
  'NOT_POSTED',
  'PENDING',
  'POSTED',
  'FAILED',
]);

const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_PROVIDER_REFERENCE_LENGTH = 256;
const MAX_PROVIDER_EVENT_ID_LENGTH = 256;
const MAX_PROVIDER_STATUS_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_PHONE_LENGTH = 32;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_REASON_LENGTH = 1_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_CHANNEL_LENGTH = 64;
const MAX_SOURCE_LENGTH = 128;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_APP_VERSION_LENGTH = 64;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 50;

const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
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

const PAYMENT_STATUS_TRANSITIONS = Object.freeze({
  PENDING: new Set([
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),

  PROCESSING: new Set([
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),

  COMPLETED: new Set([
    'PARTIALLY_REFUNDED',
    'REFUNDED',
  ]),

  PARTIALLY_REFUNDED: new Set([
    'PARTIALLY_REFUNDED',
    'REFUNDED',
  ]),

  FAILED: new Set([]),

  CANCELLED: new Set([]),

  REFUNDED: new Set([]),
});

/* ==========================================================================
 * Decimal helpers
 * ========================================================================== */

/**
 * Convert a Decimal128-like value into a canonical decimal string.
 *
 * No JavaScript Number conversion is used for financial values.
 */
function decimalToString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    value instanceof mongoose.Types.Decimal128
  ) {
    return value.toString();
  }

  return String(value).trim();
}

/**
 * Normalize a Decimal128 value using MongoDB Decimal128.
 */
function toDecimal128(value, fieldName) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const stringValue = decimalToString(value);

  if (!stringValue) {
    throw new TypeError(
      `${fieldName} cannot be empty.`,
    );
  }

  try {
    return mongoose.Types.Decimal128.fromString(
      stringValue,
    );
  } catch {
    throw new TypeError(
      `${fieldName} must be a valid decimal amount.`,
    );
  }
}

/**
 * Exact non-negative decimal comparison using Decimal128 values.
 *
 * MongoDB Decimal128 comparison is delegated to the BSON decimal
 * representation rather than JavaScript floating-point arithmetic.
 */
function compareDecimals(left, right) {
  const leftDecimal =
    toDecimal128(left, 'left');

  const rightDecimal =
    toDecimal128(right, 'right');

  if (!leftDecimal || !rightDecimal) {
    throw new TypeError(
      'Both decimal values are required.',
    );
  }

  return leftDecimal.compare(
    rightDecimal,
  );
}

function isPositiveDecimal(value) {
  try {
    const decimal =
      toDecimal128(value, 'amount');

    return compareDecimals(
      decimal,
      mongoose.Types.Decimal128.fromString(
        '0',
      ),
    ) > 0;
  } catch {
    return false;
  }
}

function isZeroOrPositiveDecimal(value) {
  try {
    const decimal =
      toDecimal128(value, 'amount');

    return compareDecimals(
      decimal,
      mongoose.Types.Decimal128.fromString(
        '0',
      ),
    ) >= 0;
  } catch {
    return false;
  }
}

/* ==========================================================================
 * General normalization helpers
 * ========================================================================== */

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
    normalized.length > maxLength
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
    !mongoose.isValidObjectId(value)
  ) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(
    value,
  );
}

function normalizeDate(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return new Date();
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    throw new TypeError(
      'Invalid date.',
    );
  }

  return date;
}

/* ==========================================================================
 * Metadata sanitization
 * ========================================================================== */

function isSensitiveKey(key) {
  const normalized =
    String(key)
      .trim()
      .toLowerCase()
      .replace(/[\s-]/g, '');

  return SENSITIVE_KEY_FRAGMENTS.some(
    (fragment) =>
      normalized.includes(
        fragment.replace(/[_-]/g, ''),
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
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      output[key] =
        sanitizeMetadata(
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
 * Payment error schema
 * ========================================================================== */

const PaymentErrorSchema =
  new Schema(
    {
      code: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_ERROR_CODE_LENGTH,
      },

      message: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_ERROR_MESSAGE_LENGTH,
      },

      details: {
        type: Schema.Types.Mixed,
        default: undefined,
        select: false,
      },

      timestamp: {
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
 * Operational metadata schema
 * ========================================================================== */

const PaymentMetadataSchema =
  new Schema(
    {
      description: {
        type: String,
        default: null,
        trim: true,
        maxlength: 500,
      },

      paymentMethod: {
        type: String,
        enum: PAYMENT_METHODS,
        default: null,
      },

      deviceIdHash: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      ipAddressHash: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      userAgentHash: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      channel: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_CHANNEL_LENGTH,
      },

      source: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_SOURCE_LENGTH,
      },

      appVersion: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_APP_VERSION_LENGTH,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Payment schema
 * ========================================================================== */

const PaymentSchema =
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
       * Internal payment identity
       * ----------------------------------------------------------------------
       */

      transactionId: {
        type: String,
        required: true,
        unique: true,
        immutable: true,
        trim: true,
        minlength: 8,
        maxlength:
          MAX_TRANSACTION_ID_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Business context
       * ----------------------------------------------------------------------
       */

      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
        index: true,
      },

      groupId: {
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null,
        immutable: true,
        index: true,
      },

      contributionId: {
        type: Schema.Types.ObjectId,
        ref: 'Contribution',
        default: null,
        immutable: true,
        index: true,
      },

      loanId: {
        type: Schema.Types.ObjectId,
        ref: 'Loan',
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Financial amount
       * ----------------------------------------------------------------------
       */

      amount: {
        type: Schema.Types.Decimal128,
        required: true,
      },

      currency: {
        type: String,
        enum: SUPPORTED_CURRENCIES,
        required: true,
        default: 'UGX',
        uppercase: true,
        trim: true,
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
        enum: PAYMENT_PROVIDERS,
        required: true,
        immutable: true,
        uppercase: true,
        trim: true,
        index: true,
      },

      providerReference: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_REFERENCE_LENGTH,
        index: true,
      },

      providerStatus: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_STATUS_LENGTH,
      },

      providerEventId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_EVENT_ID_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Payment method
       * ----------------------------------------------------------------------
       */

      paymentMethod: {
        type: String,
        enum: PAYMENT_METHODS,
        default: 'MOBILE_MONEY',
        uppercase: true,
        trim: true,
        index: true,
      },

      phoneNumber: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_PHONE_LENGTH,
        select: false,
      },

      /*
       * ----------------------------------------------------------------------
       * Lifecycle
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        enum: PAYMENT_STATUSES,
        required: true,
        default: 'PENDING',
        uppercase: true,
        trim: true,
        index: true,
      },

      initiatedAt: {
        type: Date,
        default: Date.now,
        immutable: true,
        index: true,
      },

      processingAt: {
        type: Date,
        default: null,
      },

      confirmedAt: {
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

      /*
       * ----------------------------------------------------------------------
       * Refund state
       * ----------------------------------------------------------------------
       */

      refundAmount: {
        type: Schema.Types.Decimal128,
        default: null,
      },

      refundReason: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
      },

      providerRefundReference: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_REFERENCE_LENGTH,
      },

      refundedAt: {
        type: Date,
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Idempotency
       * ----------------------------------------------------------------------
       */

      idempotencyKey: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_IDEMPOTENCY_KEY_LENGTH,
        select: false,
      },

      /*
       * ----------------------------------------------------------------------
       * Retry state
       * ----------------------------------------------------------------------
       */

      retryCount: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },

      lastRetryAt: {
        type: Date,
        default: null,
      },

      nextRetryAt: {
        type: Date,
        default: null,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Verification
       * ----------------------------------------------------------------------
       */

      verificationTokenHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: 256,
        select: false,
      },

      verificationAttempts: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },

      verifiedAt: {
        type: Date,
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Reconciliation
       * ----------------------------------------------------------------------
       */

      reconciliationStatus: {
        type: String,
        enum: RECONCILIATION_STATUSES,
        default: 'PENDING',
        uppercase: true,
        trim: true,
        index: true,
      },

      lastReconciledAt: {
        type: Date,
        default: null,
      },

      reconciliationNote: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_NOTE_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Ledger integration
       * ----------------------------------------------------------------------
       */

      ledgerEntryId: {
        type: Schema.Types.ObjectId,
        ref: 'LedgerEntry',
        default: null,
        index: true,
      },

      ledgerPostedAt: {
        type: Date,
        default: null,
      },

      ledgerPostingStatus: {
        type: String,
        enum: LEDGER_POSTING_STATUSES,
        default: 'NOT_POSTED',
        uppercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Operational metadata
       * ----------------------------------------------------------------------
       */

      metadata: {
        type: PaymentMetadataSchema,
        default: () => ({}),
      },

      /*
       * ----------------------------------------------------------------------
       * Error
       * ----------------------------------------------------------------------
       */

      error: {
        type: PaymentErrorSchema,
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Soft-delete state
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

      deleteReason: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_NOTE_LENGTH,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      collection: 'payments',

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

          delete ret.phoneNumber;
          delete ret.idempotencyKey;
          delete ret.verificationTokenHash;

          if (ret.metadata) {
            delete ret.metadata.ipAddressHash;
            delete ret.metadata.userAgentHash;
            delete ret.metadata.deviceIdHash;
          }

          if (ret.error) {
            delete ret.error.details;
          }

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

PaymentSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
  _id: -1,
});

PaymentSchema.index({
  tenantId: 1,
  groupId: 1,
  createdAt: -1,
  _id: -1,
});

PaymentSchema.index({
  tenantId: 1,
  contributionId: 1,
  createdAt: -1,
  _id: -1,
});

PaymentSchema.index({
  tenantId: 1,
  loanId: 1,
  createdAt: -1,
  _id: -1,
});

PaymentSchema.index({
  tenantId: 1,
  status: 1,
  createdAt: -1,
});

PaymentSchema.index({
  tenantId: 1,
  provider: 1,
  providerReference: 1,
});

/**
 * Provider events are unique within a provider + tenant boundary.
 *
 * Sparse semantics allow records without provider event IDs.
 */
PaymentSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerEventId: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      'uniq_tenant_provider_event',
  },
);

/**
 * Tenant-scoped API idempotency.
 */
PaymentSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      'uniq_tenant_idempotency_key',
  },
);

PaymentSchema.index({
  tenantId: 1,
  reconciliationStatus: 1,
  createdAt: -1,
});

PaymentSchema.index({
  tenantId: 1,
  ledgerPostingStatus: 1,
  createdAt: -1,
});

PaymentSchema.index({
  tenantId: 1,
  status: 1,
  nextRetryAt: 1,
});

PaymentSchema.index({
  tenantId: 1,
  provider: 1,
  providerStatus: 1,
  createdAt: -1,
});

PaymentSchema.index({
  tenantId: 1,
  initiatedAt: -1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

PaymentSchema.virtual(
  'displayAmount',
).get(function getDisplayAmount() {
  if (this.amount == null) {
    return null;
  }

  return `${this.currency} ${this.amount.toString()}`;
});

PaymentSchema.virtual(
  'isTerminal',
).get(function getIsTerminal() {
  return [
    'FAILED',
    'CANCELLED',
    'REFUNDED',
  ].includes(this.status);
});

PaymentSchema.virtual(
  'isFullyRefunded',
).get(function getIsFullyRefunded() {
  return this.status === 'REFUNDED';
});

PaymentSchema.virtual(
  'isLedgerPosted',
).get(function getIsLedgerPosted() {
  return (
    this.ledgerPostingStatus ===
    'POSTED'
  );
});

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

PaymentSchema.query.active =
  function active() {
    return this.where({
      isDeleted: false,
    });
  };

PaymentSchema.query.pending =
  function pending() {
    return this.where({
      status: {
        $in: [
          'PENDING',
          'PROCESSING',
        ],
      },
      isDeleted: false,
    });
  };

PaymentSchema.query.completed =
  function completed() {
    return this.where({
      status: 'COMPLETED',
      isDeleted: false,
    });
  };

PaymentSchema.query.awaitingLedgerPosting =
  function awaitingLedgerPosting() {
    return this.where({
      status: {
        $in: [
          'COMPLETED',
          'PARTIALLY_REFUNDED',
        ],
      },
      ledgerPostingStatus: {
        $in: [
          'NOT_POSTED',
          'PENDING',
          'FAILED',
        ],
      },
      isDeleted: false,
    });
  };

PaymentSchema.query.needingReconciliation =
  function needingReconciliation() {
    return this.where({
      reconciliationStatus: {
        $in: [
          'PENDING',
          'MISMATCHED',
        ],
      },
      isDeleted: false,
    });
  };

PaymentSchema.query.retryable =
  function retryable() {
    return this.where({
      status: {
        $in: [
          'PENDING',
          'PROCESSING',
          'FAILED',
        ],
      },
      isDeleted: false,
      $or: [
        {
          nextRetryAt: null,
        },
        {
          nextRetryAt: {
            $lte: new Date(),
          },
        },
      ],
    });
  };

/* ==========================================================================
 * Instance lifecycle methods
 * ========================================================================== */

PaymentSchema.methods.canTransitionTo =
  function canTransitionTo(
    targetStatus,
  ) {
    const target =
      String(targetStatus)
        .trim()
        .toUpperCase();

    return (
      PAYMENT_STATUS_TRANSITIONS[
        this.status
      ]?.has(target) ?? false
    );
  };

PaymentSchema.methods.isTerminal =
  function isTerminal() {
    return [
      'FAILED',
      'CANCELLED',
      'REFUNDED',
    ].includes(this.status);
  };

PaymentSchema.methods.canRetry =
  function canRetry() {
    return [
      'PENDING',
      'PROCESSING',
      'FAILED',
    ].includes(this.status);
  };

PaymentSchema.methods.markProcessing =
  async function markProcessing() {
    if (
      !this.canTransitionTo(
        'PROCESSING',
      )
    ) {
      throw new Error(
        `Payment cannot transition from ${this.status} to PROCESSING.`,
      );
    }

    this.status = 'PROCESSING';

    this.processingAt ??=
      new Date();

    await this.save();

    return this;
  };

PaymentSchema.methods.markCompleted =
  async function markCompleted({
    providerReference = null,
    providerStatus = null,
    providerEventId = null,
  } = {}) {
    if (
      !this.canTransitionTo(
        'COMPLETED',
      )
    ) {
      if (
        this.status ===
          'COMPLETED' ||
        this.status ===
          'PARTIALLY_REFUNDED' ||
        this.status ===
          'REFUNDED'
      ) {
        return this;
      }

      throw new Error(
        `Payment cannot transition from ${this.status} to COMPLETED.`,
      );
    }

    const now = new Date();

    this.status = 'COMPLETED';
    this.confirmedAt ??= now;

    this.providerReference =
      normalizeNullableString(
        providerReference,
        MAX_PROVIDER_REFERENCE_LENGTH,
      );

    this.providerStatus =
      normalizeNullableString(
        providerStatus,
        MAX_PROVIDER_STATUS_LENGTH,
      );

    this.providerEventId =
      normalizeNullableString(
        providerEventId,
        MAX_PROVIDER_EVENT_ID_LENGTH,
      );

    this.failedAt = null;
    this.cancelledAt = null;

    await this.save();

    return this;
  };

PaymentSchema.methods.markFailed =
  async function markFailed({
    code = null,
    message = null,
    details = undefined,
  } = {}) {
    if (
      !this.canTransitionTo(
        'FAILED',
      )
    ) {
      throw new Error(
        `Payment cannot transition from ${this.status} to FAILED.`,
      );
    }

    const now = new Date();

    this.status = 'FAILED';
    this.failedAt = now;

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

      details:
        details === undefined
          ? undefined
          : sanitizeMetadata(
              details,
            ),

      timestamp: now,
    };

    await this.save();

    return this;
  };

PaymentSchema.methods.markCancelled =
  async function markCancelled(
    reason = null,
  ) {
    if (
      !this.canTransitionTo(
        'CANCELLED',
      )
    ) {
      throw new Error(
        `Payment cannot transition from ${this.status} to CANCELLED.`,
      );
    }

    this.status = 'CANCELLED';
    this.cancelledAt =
      new Date();

    if (reason) {
      this.error = {
        code: 'PAYMENT_CANCELLED',
        message:
          normalizeNullableString(
            reason,
            MAX_REASON_LENGTH,
          ),
        timestamp:
          new Date(),
      };
    }

    await this.save();

    return this;
  };

/**
 * Apply a refund.
 *
 * Partial refund:
 *   COMPLETED -> PARTIALLY_REFUNDED
 *
 * Full refund:
 *   COMPLETED/PARTIALLY_REFUNDED -> REFUNDED
 *
 * Multiple partial refunds are expected to be orchestrated by the payment
 * service/refund aggregate. This method protects the single Payment document
 * from exceeding the original payment amount.
 */
PaymentSchema.methods.applyRefund =
  async function applyRefund({
    refundAmount,
    reason = null,
    providerRefundReference = null,
  } = {}) {
    const refund =
      toDecimal128(
        refundAmount,
        'refundAmount',
      );

    if (
      !isPositiveDecimal(refund)
    ) {
      throw new Error(
        'Refund amount must be greater than zero.',
      );
    }

    if (
      ![
        'COMPLETED',
        'PARTIALLY_REFUNDED',
      ].includes(this.status)
    ) {
      throw new Error(
        `Payment cannot be refunded from ${this.status}.`,
      );
    }

    const previousRefund =
      this.refundAmount ??
      mongoose.Types.Decimal128.fromString(
        '0',
      );

    const cumulativeRefund =
      mongoose.Types.Decimal128.fromString(
        previousRefund.toString(),
      );

    /**
     * Decimal128 itself does not expose a portable add method in all
     * environments, so cumulative arithmetic should be handled by the
     * financial service/Decimal library at higher level. For a single
     * Payment record, this method therefore accepts only the total cumulative
     * refund amount.
     */
    if (
      compareDecimals(
        refund,
        this.amount,
      ) > 0
    ) {
      throw new Error(
        'Refund amount cannot exceed payment amount.',
      );
    }

    this.refundAmount = refund;
    this.refundReason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    this.providerRefundReference =
      normalizeNullableString(
        providerRefundReference,
        MAX_PROVIDER_REFERENCE_LENGTH,
      );

    this.refundedAt =
      new Date();

    this.status =
      compareDecimals(
        refund,
        this.amount,
      ) === 0
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    await this.save();

    return this;
  };

PaymentSchema.methods.registerRetry =
  async function registerRetry({
    nextRetryAt = null,
  } = {}) {
    if (!this.canRetry()) {
      throw new Error(
        `Payment ${this.transactionId} cannot be retried from ${this.status}.`,
      );
    }

    this.retryCount += 1;
    this.lastRetryAt =
      new Date();

    this.nextRetryAt =
      nextRetryAt
        ? normalizeDate(
            nextRetryAt,
          )
        : null;

    await this.save();

    return this;
  };

PaymentSchema.methods.markLedgerPending =
  async function markLedgerPending() {
    if (
      ![
        'COMPLETED',
        'PARTIALLY_REFUNDED',
        'REFUNDED',
      ].includes(this.status)
    ) {
      throw new Error(
        'Only completed/refunded payments can enter ledger posting.',
      );
    }

    this.ledgerPostingStatus =
      'PENDING';

    await this.save();

    return this;
  };

PaymentSchema.methods.markLedgerPosted =
  async function markLedgerPosted(
    ledgerEntryId,
  ) {
    const normalizedLedgerEntryId =
      normalizeObjectId(
        ledgerEntryId,
        'ledgerEntryId',
      );

    if (
      ![
        'COMPLETED',
        'PARTIALLY_REFUNDED',
        'REFUNDED',
      ].includes(this.status)
    ) {
      throw new Error(
        'Only financially completed payments can be posted to the ledger.',
      );
    }

    this.ledgerEntryId =
      normalizedLedgerEntryId;

    this.ledgerPostedAt =
      new Date();

    this.ledgerPostingStatus =
      'POSTED';

    await this.save();

    return this;
  };

PaymentSchema.methods.markLedgerPostingFailed =
  async function markLedgerPostingFailed(
    reason = null,
  ) {
    this.ledgerPostingStatus =
      'FAILED';

    this.error = {
      code: 'LEDGER_POSTING_FAILED',
      message:
        normalizeNullableString(
          reason,
          MAX_ERROR_MESSAGE_LENGTH,
        ),
      timestamp: new Date(),
    };

    await this.save();

    return this;
  };

PaymentSchema.methods.markReconciled =
  async function markReconciled({
    status = 'MATCHED',
    note = null,
  } = {}) {
    const normalizedStatus =
      String(status)
        .trim()
        .toUpperCase();

    if (
      !RECONCILIATION_STATUSES.includes(
        normalizedStatus,
      )
    ) {
      throw new TypeError(
        `Unsupported reconciliation status: ${normalizedStatus}.`,
      );
    }

    this.reconciliationStatus =
      normalizedStatus;

    this.lastReconciledAt =
      new Date();

    this.reconciliationNote =
      normalizeNullableString(
        note,
        MAX_NOTE_LENGTH,
      );

    await this.save();

    return this;
  };

PaymentSchema.methods.softDelete =
  async function softDelete(
    reason = null,
  ) {
    if (
      this.isDeleted
    ) {
      return this;
    }

    /**
     * Financial payment records must not be hidden while unresolved financial
     * lifecycle work remains.
     */
    if (
      this.ledgerPostingStatus ===
        'PENDING' ||
      this.reconciliationStatus ===
        'PENDING'
    ) {
      throw new Error(
        'A payment with pending ledger or reconciliation work cannot be soft-deleted.',
      );
    }

    this.isDeleted = true;
    this.deletedAt =
      new Date();

    this.deleteReason =
      normalizeNullableString(
        reason,
        MAX_NOTE_LENGTH,
      );

    await this.save();

    return this;
  };

/* ==========================================================================
 * Static lookup methods
 * ========================================================================== */

PaymentSchema.statics.findByTransactionId =
  function findByTransactionId(
    transactionId,
    {
      tenantId = undefined,
    } = {},
  ) {
    const filter = {
      transactionId:
        normalizeRequiredString(
          transactionId,
          'transactionId',
          MAX_TRANSACTION_ID_LENGTH,
        ),
      isDeleted: false,
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeRequiredString(
          tenantId,
          'tenantId',
          128,
        );
    }

    return this.findOne(
      filter,
    );
  };

PaymentSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey(
    tenantId,
    idempotencyKey,
  ) {
    if (
      !tenantId ||
      !idempotencyKey
    ) {
      return null;
    }

    return this.findOne({
      tenantId: String(
        tenantId,
      ).trim(),

      idempotencyKey:
        String(
          idempotencyKey,
        ).trim(),

      isDeleted: false,
    }).select(
      '+idempotencyKey',
    );
  };

PaymentSchema.statics.findByProviderReference =
  function findByProviderReference(
    tenantId,
    provider,
    providerReference,
  ) {
    if (
      !tenantId ||
      !provider ||
      !providerReference
    ) {
      return null;
    }

    return this.findOne({
      tenantId,
      provider,
      providerReference,
      isDeleted: false,
    });
  };

PaymentSchema.statics.findByProviderEventId =
  function findByProviderEventId(
    tenantId,
    provider,
    providerEventId,
  ) {
    if (
      !tenantId ||
      !provider ||
      !providerEventId
    ) {
      return null;
    }

    return this.findOne({
      tenantId,
      provider,
      providerEventId,
      isDeleted: false,
    });
  };

/* ==========================================================================
 * Atomic payment transitions
 * ========================================================================== */

/**
 * Atomically complete a payment.
 *
 * Existing completed/refunded states are not downgraded.
 */
PaymentSchema.statics.completeAtomically =
  async function completeAtomically(
    {
      paymentId,
      tenantId,
      providerReference = null,
      providerStatus = null,
      providerEventId = null,
    } = {},
    {
      session = undefined,
    } = {},
  ) {
    const normalizedPaymentId =
      normalizeObjectId(
        paymentId,
        'paymentId',
      );

    const normalizedTenantId =
      normalizeRequiredString(
        tenantId,
        'tenantId',
        128,
      );

    const now = new Date();

    const filter = {
      _id: normalizedPaymentId,
      tenantId:
        normalizedTenantId,
      status: {
        $in: [
          'PENDING',
          'PROCESSING',
        ],
      },
      isDeleted: false,
    };

    const update = {
      $set: {
        status: 'COMPLETED',
        confirmedAt: now,
        failedAt: null,
        cancelledAt: null,

        providerReference:
          normalizeNullableString(
            providerReference,
            MAX_PROVIDER_REFERENCE_LENGTH,
          ),

        providerStatus:
          normalizeNullableString(
            providerStatus,
            MAX_PROVIDER_STATUS_LENGTH,
          ),
      },
    };

    if (providerEventId) {
      update.$set.providerEventId =
        normalizeNullableString(
          providerEventId,
          MAX_PROVIDER_EVENT_ID_LENGTH,
        );
    }

    const options = {
      new: true,
      runValidators: true,
      allowPaymentMutation: true,
    };

    if (session) {
      options.session = session;
    }

    return this.findOneAndUpdate(
      filter,
      update,
      options,
    ).exec();
  };

/**
 * Atomically claim/register a provider event.
 *
 * Returns the payment document only when the event association succeeds.
 */
PaymentSchema.statics.registerProviderEvent =
  async function registerProviderEvent(
    {
      paymentId,
      tenantId,
      provider,
      providerEventId,
    } = {},
    {
      session = undefined,
    } = {},
  ) {
    const normalizedPaymentId =
      normalizeObjectId(
        paymentId,
        'paymentId',
      );

    const normalizedTenantId =
      normalizeRequiredString(
        tenantId,
        'tenantId',
        128,
      );

    const normalizedProvider =
      String(
        provider ?? '',
      )
        .trim()
        .toUpperCase();

    if (
      !PAYMENT_PROVIDERS.includes(
        normalizedProvider,
      )
    ) {
      throw new TypeError(
        `Unsupported payment provider: ${normalizedProvider}.`,
      );
    }

    const normalizedEventId =
      normalizeRequiredString(
        providerEventId,
        'providerEventId',
        MAX_PROVIDER_EVENT_ID_LENGTH,
      );

    const options = {
      new: true,
      runValidators: true,
      allowPaymentMutation: true,
    };

    if (session) {
      options.session = session;
    }

    return this.findOneAndUpdate(
      {
        _id: normalizedPaymentId,
        tenantId:
          normalizedTenantId,
        provider:
          normalizedProvider,
        isDeleted: false,
        $or: [
          {
            providerEventId: null,
          },
          {
            providerEventId: {
              $exists: false,
            },
          },
        ],
      },
      {
        $set: {
          providerEventId:
            normalizedEventId,
        },
      },
      options,
    ).exec();
  };

/**
 * Atomically mark ledger posting as pending.
 */
PaymentSchema.statics.markLedgerPendingAtomically =
  function markLedgerPendingAtomically(
    {
      paymentId,
      tenantId,
    } = {},
    {
      session = undefined,
    } = {},
  ) {
    const filter = {
      _id: normalizeObjectId(
        paymentId,
        'paymentId',
      ),

      tenantId:
        normalizeRequiredString(
          tenantId,
          'tenantId',
          128,
        ),

      status: {
        $in: [
          'COMPLETED',
          'PARTIALLY_REFUNDED',
          'REFUNDED',
        ],
      },

      ledgerPostingStatus: {
        $in: [
          'NOT_POSTED',
          'FAILED',
        ],
      },

      isDeleted: false,
    };

    const options = {
      new: true,
      runValidators: true,
      allowPaymentMutation: true,
    };

    if (session) {
      options.session = session;
    }

    return this.findOneAndUpdate(
      filter,
      {
        $set: {
          ledgerPostingStatus:
            'PENDING',
        },
      },
      options,
    ).exec();
  };

/**
 * Atomically mark reconciliation state.
 */
PaymentSchema.statics.markReconciliationStatusAtomically =
  function markReconciliationStatusAtomically(
    {
      paymentId,
      tenantId,
      status,
      note = null,
    } = {},
    {
      session = undefined,
    } = {},
  ) {
    const normalizedStatus =
      String(
        status ?? '',
      )
        .trim()
        .toUpperCase();

    if (
      !RECONCILIATION_STATUSES.includes(
        normalizedStatus,
      )
    ) {
      throw new TypeError(
        `Unsupported reconciliation status: ${normalizedStatus}.`,
      );
    }

    const options = {
      new: true,
      runValidators: true,
      allowPaymentMutation: true,
    };

    if (session) {
      options.session = session;
    }

    return this.findOneAndUpdate(
      {
        _id: normalizeObjectId(
          paymentId,
          'paymentId',
        ),

        tenantId:
          normalizeRequiredString(
            tenantId,
            'tenantId',
            128,
          ),

        isDeleted: false,
      },
      {
        $set: {
          reconciliationStatus:
            normalizedStatus,

          lastReconciledAt:
            new Date(),

          reconciliationNote:
            normalizeNullableString(
              note,
              MAX_NOTE_LENGTH,
            ),
        },
      },
      options,
    ).exec();
  };

/* ==========================================================================
 * Validation
 * ========================================================================== */

PaymentSchema.pre(
  'validate',
  function validatePayment(next) {
    try {
      /*
       * Monetary amount.
       */
      if (
        !isPositiveDecimal(
          this.amount,
        )
      ) {
        this.invalidate(
          'amount',
          'Payment amount must be greater than zero.',
        );
      }

      /*
       * Refund amount, when present, must be non-negative and cannot exceed
       * the original payment amount.
       */
      if (
        this.refundAmount !== null &&
        this.refundAmount !== undefined
      ) {
        if (
          !isZeroOrPositiveDecimal(
            this.refundAmount,
          )
        ) {
          this.invalidate(
            'refundAmount',
            'Refund amount cannot be negative.',
          );
        } else if (
          compareDecimals(
            this.refundAmount,
            this.amount,
          ) > 0
        ) {
          this.invalidate(
            'refundAmount',
            'Refund amount cannot exceed payment amount.',
          );
        }
      }

      /*
       * Lifecycle timestamps.
       */
      if (
        this.status ===
          'PROCESSING' &&
        !this.processingAt
      ) {
        this.processingAt =
          new Date();
      }

      if (
        [
          'COMPLETED',
          'PARTIALLY_REFUNDED',
          'REFUNDED',
        ].includes(
          this.status,
        ) &&
        !this.confirmedAt
      ) {
        this.confirmedAt =
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
        [
          'PARTIALLY_REFUNDED',
          'REFUNDED',
        ].includes(
          this.status,
        ) &&
        !this.refundedAt
      ) {
        this.refundedAt =
          new Date();
      }

      /*
       * Refund status consistency.
       */
      if (
        this.status ===
        'PARTIALLY_REFUNDED'
      ) {
        if (
          !this.refundAmount ||
          compareDecimals(
            this.refundAmount,
            this.amount,
          ) >= 0
        ) {
          this.invalidate(
            'status',
            'PARTIALLY_REFUNDED requires a positive refund less than the payment amount.',
          );
        }
      }

      if (
        this.status ===
        'REFUNDED'
      ) {
        if (
          !this.refundAmount ||
          compareDecimals(
            this.refundAmount,
            this.amount,
          ) !== 0
        ) {
          this.invalidate(
            'status',
            'REFUNDED requires refundAmount to equal the payment amount.',
          );
        }
      }

      /*
       * Ledger-posting consistency.
       */
      if (
        this.ledgerPostingStatus ===
          'POSTED' &&
        !this.ledgerEntryId
      ) {
        this.invalidate(
          'ledgerEntryId',
          'ledgerEntryId is required when ledgerPostingStatus is POSTED.',
        );
      }

      if (
        this.ledgerPostingStatus ===
          'POSTED' &&
        !this.ledgerPostedAt
      ) {
        this.ledgerPostedAt =
          new Date();
      }

      if (
        this.ledgerPostingStatus ===
          'NOT_POSTED' &&
        this.ledgerPostedAt
      ) {
        this.invalidate(
          'ledgerPostedAt',
          'ledgerPostedAt requires ledgerPostingStatus=POSTED.',
        );
      }

      /*
       * Retry consistency.
       */
      if (
        this.retryCount < 0
      ) {
        this.invalidate(
          'retryCount',
          'retryCount cannot be negative.',
        );
      }

      /*
       * Tenant normalization.
       */
      if (
        !this.tenantId ||
        !String(this.tenantId).trim()
      ) {
        this.invalidate(
          'tenantId',
          'tenantId is required.',
        );
      }

      /*
       * Operational metadata sanitization.
       */
      if (
        this.metadata
      ) {
        const metadataObject =
          this.metadata.toObject
            ? this.metadata.toObject()
            : this.metadata;

        const sanitized =
          sanitizeMetadata(
            metadataObject,
          );

        for (
          const [key, value]
            of Object.entries(
              sanitized,
            )
        ) {
          this.metadata.set(
            key,
            value,
          );
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  });

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

/**
 * Financial payment records must not be physically deleted through normal
 * model operations.
 */
PaymentSchema.pre(
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
        'Payment hard deletion is disabled. Use approved retention controls.',
      ),
    );
  },
);

/**
 * Generic updates are blocked because they can bypass:
 * - lifecycle transition rules;
 * - tenant constraints;
 * - idempotency rules;
 * - reconciliation rules;
 * - ledger-posting rules;
 * - refund invariants.
 */
PaymentSchema.pre(
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
      options.allowPaymentMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic Payment updates are disabled. Use controlled payment lifecycle operations.',
      ),
    );
  },
);

PaymentSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for Payment.',
      ),
    );
  },
);

/* ==========================================================================
 * Query safety
 * ========================================================================== */

PaymentSchema.pre(
  /^find/,
  function hideDeletedPayments(
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

const Payment =
  mongoose.models.Payment ||
  mongoose.model(
    'Payment',
    PaymentSchema,
  );

export default Payment;

export {
  PaymentSchema,
  PaymentErrorSchema,
  PaymentMetadataSchema,
  PAYMENT_STATUS_TRANSITIONS,
};