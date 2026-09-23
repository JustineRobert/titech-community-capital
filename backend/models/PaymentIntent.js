/**
 * backend/models/PaymentIntent.js
 * TITech Community Capital — Payment Intent Aggregate
 *
 * Architectural role:
 * - Represents the intention to initiate an external payment.
 * - Tracks client/API idempotency, provider selection, provider processing,
 *   retries, provider responses, verification, resulting Payment linkage,
 *   reconciliation, and ledger-posting state.
 *
 * Financial boundary:
 * - PaymentIntent is NOT an accounting ledger.
 * - PaymentIntent is NOT an account balance.
 * - PaymentIntent does NOT mutate balances or ledger accounts.
 * - A successful intent represents an approved/completed payment intent;
 *   financial posting remains the responsibility of the canonical financial
 *   transaction/ledger service.
 *
 * Relationship:
 *
 * Client/API
 *    ↓
 * PaymentIntent
 *    ↓
 * Provider Adapter
 *    ↓
 * Provider Confirmation / Webhook
 *    ↓
 * Payment
 *    ↓
 * FinancialTransactionService
 *    ↓
 * Double-Entry Ledger
 *
 * Important boundaries:
 * - Provider authentication and webhook signature verification belong to the
 *   provider adapter/service.
 * - Tenant authorization belongs to the service/repository layer.
 * - Password/PIN/OTP/card secrets must never be stored here.
 * - Provider payloads must be sanitized before persistence.
 * - PaymentIntent does not replace Payment.
 * - PaymentIntent does not replace PaymentRefund.
 *
 * Security principles:
 * - Native ESM only.
 * - Decimal128 is used for persisted money.
 * - No JavaScript floating-point arithmetic for monetary validation.
 * - Tenant-scoped idempotency is enforced by a unique database index.
 * - Provider event identity is unique within tenant + provider.
 * - Sensitive client/network identifiers are stored only as hashes/fingerprints.
 * - Generic update/delete operations are blocked.
 * - State transitions are controlled.
 * - Provider responses are bounded and sanitized.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Collection:
 * - payment_intents
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const PAYMENT_INTENT_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const PAYMENT_PROVIDERS = Object.freeze([
  'MTN_MOMO',
  'AIRTEL_MONEY',
  'STRIPE',
  'PAYPAL',
]);

export const PAYMENT_METHODS = Object.freeze([
  'MOBILE_MONEY',
  'CARD',
  'BANK_TRANSFER',
  'WALLET',
  'OTHER',
]);

export const SUPPORTED_CURRENCIES = Object.freeze([
  'UGX',
  'KES',
  'TZS',
  'RWF',
  'NGN',
  'GHS',
  'XAF',
  'ZAR',
  'USD',
  'EUR',
]);

export const LEDGER_POSTING_STATUSES = Object.freeze([
  'NOT_POSTED',
  'PENDING',
  'POSTED',
  'FAILED',
]);

export const RECONCILIATION_STATUSES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING',
  'MATCHED',
  'MISMATCHED',
  'RESOLVED',
]);

const MAX_INTENT_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_PROVIDER_EVENT_ID_LENGTH = 256;
const MAX_PROVIDER_REFERENCE_LENGTH = 256;
const MAX_PROVIDER_STATUS_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_PROVIDER_MESSAGE_LENGTH = 1_000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CHANNEL_LENGTH = 64;
const MAX_SOURCE_LENGTH = 128;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_APP_VERSION_LENGTH = 64;
const MAX_ATTEMPTS = 100;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 50;

const MIN_INTENT_EXPIRY_MS = 30 * 1000;
const DEFAULT_INTENT_EXPIRY_MS = 15 * 60 * 1000;

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
  'id_token',
  'idtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'private_key',
  'privatekey',
  'api_key',
  'apikey',
  'cvv',
  'pan',
  'cardnumber',
]);

const PAYMENT_INTENT_TRANSITIONS = Object.freeze({
  PENDING: new Set([
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]),

  PROCESSING: new Set([
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]),

  SUCCEEDED: new Set([]),

  FAILED: new Set([
    'PROCESSING',
  ]),

  CANCELLED: new Set([]),
});

/* ==========================================================================
 * Decimal validation helpers
 * ========================================================================== */

/**
 * Accept ordinary finite decimal strings without using Number().
 *
 * Examples:
 *   100
 *   100.00
 *   0.50
 *   123456789.123456
 *
 * Scientific notation is intentionally rejected at this persistence boundary
 * so monetary representations remain predictable.
 */
const DECIMAL_PATTERN =
  /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function normalizeDecimalString(
  value,
  fieldName,
) {
  if (
    value === null ||
    value === undefined
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const stringValue =
    value instanceof mongoose.Types.Decimal128
      ? value.toString()
      : String(value).trim();

  if (
    !DECIMAL_PATTERN.test(
      stringValue,
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid non-negative decimal amount.`,
    );
  }

  return stringValue;
}

function isPositiveDecimal(
  value,
) {
  try {
    const normalized =
      normalizeDecimalString(
        value,
        'amount',
      );

    const [integerPart, fractionPart = ''] =
      normalized.split('.');

    const integer =
      integerPart.replace(
        /^0+/,
        '',
      ) || '0';

    const fraction =
      fractionPart.replace(
        /0+$/,
        '',
      );

    return (
      integer !== '0' ||
      fraction.length > 0
    );
  } catch {
    return false;
  }
}

/* ==========================================================================
 * General helpers
 * ========================================================================== */

function normalizeTenantId(
  value,
) {
  if (
    value === null ||
    value === undefined
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
    value === null ||
    value === undefined
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
    value === null ||
    value === undefined
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
    value === null ||
    value === undefined ||
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

function normalizeDate(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return new Date();
  }

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
      'Invalid date.',
    );
  }

  return date;
}

function normalizeErrorMessage(
  value,
) {
  return normalizeNullableString(
    value,
    MAX_ERROR_MESSAGE_LENGTH,
  );
}

function normalizeProviderStatus(
  value,
) {
  return normalizeNullableString(
    value,
    MAX_PROVIDER_STATUS_LENGTH,
  );
}

function normalizeProviderReference(
  value,
) {
  return normalizeNullableString(
    value,
    MAX_PROVIDER_REFERENCE_LENGTH,
  );
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
      if (
        isSensitiveKey(key)
      ) {
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
 * Provider response schema
 * ========================================================================== */

const ProviderResponseSchema =
  new Schema(
    {
      code: {
        type: String,
        default: null,
        trim: true,
        maxlength: 256,
      },

      status: {
        type: String,
        default: null,
        trim: true,
        maxlength: 256,
      },

      reference: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_REFERENCE_LENGTH,
      },

      message: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_MESSAGE_LENGTH,
      },

      receivedAt: {
        type: Date,
        default: null,
      },

      /**
       * Provider data is selected out of normal API responses.
       */
      data: {
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
 * Intent metadata schema
 * ========================================================================== */

const IntentMetadataSchema =
  new Schema(
    {
      description: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DESCRIPTION_LENGTH,
      },

      channel: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_CHANNEL_LENGTH,
      },

      source: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_SOURCE_LENGTH,
      },

      requestId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
      },

      appVersion: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_APP_VERSION_LENGTH,
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
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Error schema
 * ========================================================================== */

const PaymentIntentErrorSchema =
  new Schema(
    {
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

      providerCode: {
        type: String,
        default: null,
        trim: true,
        maxlength: 256,
      },

      providerMessage: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_MESSAGE_LENGTH,
      },

      timestamp: {
        type: Date,
        default: null,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * PaymentIntent schema
 * ========================================================================== */

const PaymentIntentSchema =
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
       * Intent identity
       * ----------------------------------------------------------------------
       */

      intentId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        minlength: 8,
        maxlength:
          MAX_INTENT_ID_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * User / business context
       * ----------------------------------------------------------------------
       */

      user: {
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
       * Lifecycle
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        enum: PAYMENT_INTENT_STATUSES,
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

      succeededAt: {
        type: Date,
        default: null,
      },

      failedAt: {
        type: Date,
        default: null,
      },

      canceledAt: {
        type: Date,
        default: null,
      },

      /**
       * Intent expiration is an application lifecycle concept.
       *
       * It does not automatically delete the record.
       */
      expiresAt: {
        type: Date,
        required: true,
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

      paymentMethod: {
        type: String,
        enum: PAYMENT_METHODS,
        required: true,
        default: 'MOBILE_MONEY',
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

      providerEventId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_EVENT_ID_LENGTH,
      },

      providerStatus: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_PROVIDER_STATUS_LENGTH,
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
       * Failure
       * ----------------------------------------------------------------------
       */

      error: {
        type: PaymentIntentErrorSchema,
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Retry / provider attempts
       * ----------------------------------------------------------------------
       */

      attempts: {
        type: Number,
        default: 0,
        min: 0,
        max: MAX_ATTEMPTS,
      },

      lastAttemptAt: {
        type: Date,
        default: null,
      },

      nextAttemptAt: {
        type: Date,
        default: null,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Provider response
       * ----------------------------------------------------------------------
       */

      providerResponse: {
        type: ProviderResponseSchema,
        default: null,
        select: false,
      },

      /*
       * ----------------------------------------------------------------------
       * Verification
       * ----------------------------------------------------------------------
       */

      verificationRequired: {
        type: Boolean,
        default: false,
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
       * Resulting Payment
       * ----------------------------------------------------------------------
       */

      paymentId: {
        type: Schema.Types.ObjectId,
        ref: 'Payment',
        default: null,
        immutable: true,
        index: true,
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

      ledgerPostingStatus: {
        type: String,
        enum: LEDGER_POSTING_STATUSES,
        default: 'NOT_POSTED',
        uppercase: true,
        trim: true,
        index: true,
      },

      ledgerPostedAt: {
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
        maxlength: 1_000,
      },

      /*
       * ----------------------------------------------------------------------
       * Client / operational metadata
       * ----------------------------------------------------------------------
       *
       * No arbitrary raw request payloads belong here.
       */

      metadata: {
        type: IntentMetadataSchema,
        default: () => ({}),
      },

      /*
       * ----------------------------------------------------------------------
       * Soft delete
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
        maxlength: 500,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      collection: 'payment_intents',

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

          delete ret.idempotencyKey;

          delete ret.providerResponse;

          if (ret.metadata) {
            delete ret.metadata.deviceIdHash;
            delete ret.metadata.ipAddressHash;
            delete ret.metadata.userAgentHash;
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

/**
 * One intent ID per tenant.
 */
PaymentIntentSchema.index(
  {
    tenantId: 1,
    intentId: 1,
  },
  {
    unique: true,
    name:
      'uniq_payment_intent_tenant_intent_id',
  },
);

/**
 * User intent history.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  user: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Group intent history.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  groupId: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Contribution intent history.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  contributionId: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Loan intent history.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  loanId: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Status monitoring.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  status: 1,
  createdAt: -1,
});

/**
 * Provider reference.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  provider: 1,
  providerReference: 1,
});

/**
 * Provider webhook/event deduplication.
 */
PaymentIntentSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerEventId: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      'uniq_payment_intent_provider_event',
  },
);

/**
 * Tenant-scoped API idempotency.
 */
PaymentIntentSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      'uniq_payment_intent_idempotency',
  },
);

/**
 * Retry worker queue.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  status: 1,
  nextAttemptAt: 1,
});

/**
 * Reconciliation queue.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  reconciliationStatus: 1,
  createdAt: -1,
});

/**
 * Ledger posting queue.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  ledgerPostingStatus: 1,
  createdAt: -1,
});

/**
 * Expiring pending intents.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  status: 1,
  expiresAt: 1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

PaymentIntentSchema.virtual(
  'displayAmount',
).get(function getDisplayAmount() {
  if (this.amount == null) {
    return null;
  }

  return `${this.currency} ${this.amount.toString()}`;
});

PaymentIntentSchema.virtual(
  'isTerminal',
).get(function getIsTerminal() {
  return [
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ].includes(this.status);
});

PaymentIntentSchema.virtual(
  'isSucceeded',
).get(function getIsSucceeded() {
  return this.status === 'SUCCEEDED';
});

PaymentIntentSchema.virtual(
  'isExpired',
).get(function getIsExpired() {
  return (
    this.expiresAt instanceof Date &&
    this.expiresAt.getTime() <=
      Date.now()
  );
});

PaymentIntentSchema.virtual(
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

PaymentIntentSchema.query.active =
  function active() {
    return this.where({
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.pending =
  function pending() {
    return this.where({
      status: 'PENDING',
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.processing =
  function processing() {
    return this.where({
      status: 'PROCESSING',
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.failed =
  function failed() {
    return this.where({
      status: 'FAILED',
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.succeeded =
  function succeeded() {
    return this.where({
      status: 'SUCCEEDED',
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.retryable =
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
      nextAttemptAt: {
        $lte: new Date(),
      },
    });
  };

PaymentIntentSchema.query.needingLedgerPosting =
  function needingLedgerPosting() {
    return this.where({
      status: 'SUCCEEDED',
      ledgerPostingStatus: {
        $in: [
          'NOT_POSTED',
          'FAILED',
        ],
      },
      isDeleted: false,
    });
  };

PaymentIntentSchema.query.needingReconciliation =
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

/* ==========================================================================
 * Instance lifecycle methods
 * ========================================================================== */

PaymentIntentSchema.methods.canTransitionTo =
  function canTransitionTo(
    targetStatus,
  ) {
    const normalized =
      String(targetStatus)
        .trim()
        .toUpperCase();

    return (
      PAYMENT_INTENT_TRANSITIONS[
        this.status
      ]?.has(normalized) ?? false
    );
  };

PaymentIntentSchema.methods.isTerminal =
  function isTerminal() {
    return [
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ].includes(this.status);
  };

PaymentIntentSchema.methods.markProcessing =
  async function markProcessing() {
    if (
      !this.canTransitionTo(
        'PROCESSING',
      )
    ) {
      throw new Error(
        `PaymentIntent cannot transition from ${this.status} to PROCESSING.`,
      );
    }

    if (this.isExpired) {
      throw new Error(
        'PaymentIntent has expired.',
      );
    }

    this.status = 'PROCESSING';
    this.processingAt ??=
      new Date();

    this.attempts += 1;
    this.lastAttemptAt =
      new Date();
    this.nextAttemptAt = null;

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markSucceeded =
  async function markSucceeded({
    providerReference = null,
    providerStatus = null,
    providerEventId = null,
    paymentId = null,
  } = {}) {
    if (
      this.status ===
      'SUCCEEDED'
    ) {
      return this;
    }

    if (
      !this.canTransitionTo(
        'SUCCEEDED',
      )
    ) {
      throw new Error(
        `PaymentIntent cannot transition from ${this.status} to SUCCEEDED.`,
      );
    }

    const now = new Date();

    this.status = 'SUCCEEDED';
    this.succeededAt =
      this.succeededAt ?? now;

    this.providerReference =
      normalizeProviderReference(
        providerReference,
      );

    this.providerStatus =
      normalizeProviderStatus(
        providerStatus,
      );

    if (
      providerEventId !== null
    ) {
      this.providerEventId =
        normalizeNullableString(
          providerEventId,
          MAX_PROVIDER_EVENT_ID_LENGTH,
        );
    }

    if (paymentId !== null) {
      this.paymentId =
        normalizeObjectId(
          paymentId,
          'paymentId',
        );
    }

    this.failedAt = null;
    this.nextAttemptAt = null;
    this.error = null;

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markFailed =
  async function markFailed({
    code = null,
    message = null,
    providerCode = null,
    providerMessage = null,
    nextAttemptAt = null,
  } = {}) {
    if (
      !this.canTransitionTo(
        'FAILED',
      )
    ) {
      throw new Error(
        `PaymentIntent cannot transition from ${this.status} to FAILED.`,
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
        normalizeErrorMessage(
          message,
        ),

      providerCode:
        normalizeNullableString(
          providerCode,
          256,
        ),

      providerMessage:
        normalizeNullableString(
          providerMessage,
          MAX_PROVIDER_MESSAGE_LENGTH,
        ),

      timestamp: now,
    };

    this.nextAttemptAt =
      nextAttemptAt
        ? normalizeDate(
            nextAttemptAt,
          )
        : null;

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markCancelled =
  async function markCancelled(
    reason = null,
  ) {
    if (
      !this.canTransitionTo(
        'CANCELLED',
      )
    ) {
      throw new Error(
        `PaymentIntent cannot transition from ${this.status} to CANCELLED.`,
      );
    }

    const now = new Date();

    this.status = 'CANCELLED';
    this.canceledAt = now;

    this.nextAttemptAt = null;

    if (reason) {
      this.error = {
        code:
          'PAYMENT_INTENT_CANCELLED',

        message:
          normalizeErrorMessage(
            reason,
          ),

        providerCode: null,
        providerMessage: null,
        timestamp: now,
      };
    }

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.registerAttempt =
  async function registerAttempt({
    nextAttemptAt = null,
  } = {}) {
    if (this.attempts >= MAX_ATTEMPTS) {
      throw new Error(
        'Maximum PaymentIntent attempts exceeded.',
      );
    }

    if (this.isTerminal()) {
      throw new Error(
        `Cannot retry PaymentIntent in ${this.status} state.`,
      );
    }

    this.attempts += 1;
    this.lastAttemptAt =
      new Date();

    this.nextAttemptAt =
      nextAttemptAt
        ? normalizeDate(
            nextAttemptAt,
          )
        : null;

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markVerified =
  async function markVerified() {
    if (
      !this.verificationRequired
    ) {
      this.verifiedAt ??=
        new Date();

      await this.save();

      return this;
    }

    if (this.isExpired) {
      throw new Error(
        'Expired PaymentIntent cannot be verified.',
      );
    }

    this.verifiedAt =
      new Date();

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markLedgerPending =
  async function markLedgerPending() {
    if (
      this.status !==
      'SUCCEEDED'
    ) {
      throw new Error(
        'Only succeeded PaymentIntents can enter ledger posting.',
      );
    }

    this.ledgerPostingStatus =
      'PENDING';

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markLedgerPosted =
  async function markLedgerPosted(
    ledgerEntryId,
  ) {
    const normalized =
      normalizeObjectId(
        ledgerEntryId,
        'ledgerEntryId',
      );

    if (
      !normalized
    ) {
      throw new TypeError(
        'ledgerEntryId is required.',
      );
    }

    if (
      this.status !==
      'SUCCEEDED'
    ) {
      throw new Error(
        'Only succeeded PaymentIntents can be ledger-posted.',
      );
    }

    this.ledgerEntryId =
      normalized;

    this.ledgerPostingStatus =
      'POSTED';

    this.ledgerPostedAt =
      new Date();

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markLedgerPostingFailed =
  async function markLedgerPostingFailed(
    reason = null,
  ) {
    this.ledgerPostingStatus =
      'FAILED';

    this.reconciliationNote =
      normalizeNullableString(
        reason,
        1_000,
      );

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.markReconciled =
  async function markReconciled({
    status = 'MATCHED',
    note = null,
  } = {}) {
    const normalized =
      String(status)
        .trim()
        .toUpperCase();

    if (
      !RECONCILIATION_STATUSES.includes(
        normalized,
      )
    ) {
      throw new TypeError(
        `Unsupported reconciliation status: ${normalized}.`,
      );
    }

    this.reconciliationStatus =
      normalized;

    this.lastReconciledAt =
      new Date();

    this.reconciliationNote =
      normalizeNullableString(
        note,
        1_000,
      );

    await this.save();

    return this;
  };

PaymentIntentSchema.methods.softDelete =
  async function softDelete(
    reason = null,
  ) {
    if (
      [
        'PENDING',
        'PROCESSING',
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        'An active PaymentIntent cannot be soft-deleted.',
      );
    }

    this.isDeleted = true;
    this.deletedAt =
      new Date();

    this.deleteReason =
      normalizeNullableString(
        reason,
        500,
      );

    await this.save();

    return this;
  };

/* ==========================================================================
 * Static lookup methods
 * ========================================================================== */

PaymentIntentSchema.statics.findByIntentId =
  function findByIntentId(
    tenantId,
    intentId,
  ) {
    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      intentId:
        normalizeRequiredString(
          intentId,
          'intentId',
          MAX_INTENT_ID_LENGTH,
        ),

      isDeleted: false,
    });
  };

PaymentIntentSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey(
    tenantId,
    idempotencyKey,
  ) {
    if (
      tenantId === null ||
      tenantId === undefined ||
      !idempotencyKey
    ) {
      return null;
    }

    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      idempotencyKey:
        normalizeRequiredString(
          idempotencyKey,
          'idempotencyKey',
          MAX_IDEMPOTENCY_KEY_LENGTH,
        ),

      isDeleted: false,
    }).select(
      '+idempotencyKey',
    );
  };

PaymentIntentSchema.statics.findByProviderReference =
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

PaymentIntentSchema.statics.findByProviderEventId =
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
 * Atomic processing operations
 * ========================================================================== */

/**
 * Atomically claim a pending/retryable intent.
 */
PaymentIntentSchema.statics.claimForProcessing =
  async function claimForProcessing({
    tenantId,
    intentId,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedIntentId =
      normalizeRequiredString(
        intentId,
        'intentId',
        MAX_INTENT_ID_LENGTH,
      );

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        intentId:
          normalizedIntentId,

        status: {
          $in: [
            'PENDING',
            'FAILED',
          ],
        },

        isDeleted: false,

        expiresAt: {
          $gt: now,
        },

        $or: [
          {
            nextAttemptAt: null,
          },
          {
            nextAttemptAt: {
              $lte: now,
            },
          },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          processingAt: now,
          lastAttemptAt: now,
          nextAttemptAt: null,
        },

        $inc: {
          attempts: 1,
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically succeed an intent.
 */
PaymentIntentSchema.statics.succeedAtomically =
  async function succeedAtomically({
    tenantId,
    intentId,
    providerReference = null,
    providerStatus = null,
    providerEventId = null,
    paymentId = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedIntentId =
      normalizeRequiredString(
        intentId,
        'intentId',
        MAX_INTENT_ID_LENGTH,
      );

    const now =
      new Date();

    const update = {
      $set: {
        status: 'SUCCEEDED',
        succeededAt: now,

        providerReference:
          normalizeProviderReference(
            providerReference,
          ),

        providerStatus:
          normalizeProviderStatus(
            providerStatus,
          ),

        failedAt: null,
        nextAttemptAt: null,
        error: null,
      },
    };

    if (
      providerEventId !== null &&
      providerEventId !== undefined
    ) {
      update.$set.providerEventId =
        normalizeNullableString(
          providerEventId,
          MAX_PROVIDER_EVENT_ID_LENGTH,
        );
    }

    if (
      paymentId !== null &&
      paymentId !== undefined
    ) {
      update.$set.paymentId =
        normalizeObjectId(
          paymentId,
          'paymentId',
        );
    }

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        intentId:
          normalizedIntentId,

        status: {
          $in: [
            'PENDING',
            'PROCESSING',
          ],
        },

        isDeleted: false,
      },
      update,
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically fail an intent.
 */
PaymentIntentSchema.statics.failAtomically =
  async function failAtomically({
    tenantId,
    intentId,
    code = null,
    message = null,
    providerCode = null,
    providerMessage = null,
    nextAttemptAt = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedIntentId =
      normalizeRequiredString(
        intentId,
        'intentId',
        MAX_INTENT_ID_LENGTH,
      );

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        intentId:
          normalizedIntentId,

        status: {
          $in: [
            'PENDING',
            'PROCESSING',
          ],
        },

        isDeleted: false,
      },
      {
        $set: {
          status: 'FAILED',
          failedAt: now,

          error: {
            code:
              normalizeNullableString(
                code,
                MAX_ERROR_CODE_LENGTH,
              ),

            message:
              normalizeErrorMessage(
                message,
              ),

            providerCode:
              normalizeNullableString(
                providerCode,
                256,
              ),

            providerMessage:
              normalizeNullableString(
                providerMessage,
                MAX_PROVIDER_MESSAGE_LENGTH,
              ),

            timestamp: now,
          },

          nextAttemptAt:
            nextAttemptAt
              ? normalizeDate(
                  nextAttemptAt,
                )
              : null,
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically cancel an intent.
 */
PaymentIntentSchema.statics.cancelAtomically =
  async function cancelAtomically({
    tenantId,
    intentId,
    reason = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedIntentId =
      normalizeRequiredString(
        intentId,
        'intentId',
        MAX_INTENT_ID_LENGTH,
      );

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizedTenantId,

        intentId:
          normalizedIntentId,

        status: {
          $in: [
            'PENDING',
            'PROCESSING',
          ],
        },

        isDeleted: false,
      },
      {
        $set: {
          status: 'CANCELLED',
          canceledAt: now,
          nextAttemptAt: null,

          error: reason
            ? {
                code:
                  'PAYMENT_INTENT_CANCELLED',

                message:
                  normalizeErrorMessage(
                    reason,
                  ),

                providerCode: null,
                providerMessage: null,
                timestamp: now,
              }
            : null,
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically attach the resulting Payment.
 */
PaymentIntentSchema.statics.attachPaymentAtomically =
  async function attachPaymentAtomically({
    tenantId,
    intentId,
    paymentId,
  } = {}) {
    const normalizedPaymentId =
      normalizeObjectId(
        paymentId,
        'paymentId',
      );

    if (!normalizedPaymentId) {
      throw new TypeError(
        'paymentId is required.',
      );
    }

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        intentId:
          normalizeRequiredString(
            intentId,
            'intentId',
            MAX_INTENT_ID_LENGTH,
          ),

        status: 'SUCCEEDED',

        isDeleted: false,

        paymentId: null,
      },
      {
        $set: {
          paymentId:
            normalizedPaymentId,
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically register a provider event.
 *
 * The database unique index also protects against the same provider event
 * being attached to multiple records.
 */
PaymentIntentSchema.statics.registerProviderEvent =
  async function registerProviderEvent({
    tenantId,
    intentId,
    providerEventId,
  } = {}) {
    const normalizedEventId =
      normalizeRequiredString(
        providerEventId,
        'providerEventId',
        MAX_PROVIDER_EVENT_ID_LENGTH,
      );

    return this.findOneAndUpdate(
      {
        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        intentId:
          normalizeRequiredString(
            intentId,
            'intentId',
            MAX_INTENT_ID_LENGTH,
          ),

        isDeleted: false,

        providerEventId: null,
      },
      {
        $set: {
          providerEventId:
            normalizedEventId,
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/**
 * Atomically mark ledger posting pending.
 */
PaymentIntentSchema.statics.markLedgerPendingAtomically =
  async function markLedgerPendingAtomically({
    tenantId,
    intentId,
  } = {}) {
    return this.findOneAndUpdate(
      {
        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        intentId:
          normalizeRequiredString(
            intentId,
            'intentId',
            MAX_INTENT_ID_LENGTH,
          ),

        status: 'SUCCEEDED',

        ledgerPostingStatus: {
          $in: [
            'NOT_POSTED',
            'FAILED',
          ],
        },

        isDeleted: false,
      },
      {
        $set: {
          ledgerPostingStatus:
            'PENDING',
        },
      },
      {
        new: true,
        runValidators: true,
        allowPaymentIntentMutation:
          true,
      },
    ).exec();
  };

/* ==========================================================================
 * Validation
 * ========================================================================== */

PaymentIntentSchema.pre(
  'validate',
  function validatePaymentIntent(
    next,
  ) {
    try {
      /*
       * Monetary validation.
       */
      if (
        !isPositiveDecimal(
          this.amount,
        )
      ) {
        this.invalidate(
          'amount',
          'PaymentIntent amount must be greater than zero.',
        );
      }

      /*
       * Timestamp consistency.
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
        this.status ===
          'SUCCEEDED' &&
        !this.succeededAt
      ) {
        this.succeededAt =
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
        !this.canceledAt
      ) {
        this.canceledAt =
          new Date();
      }

      /*
       * Successful intents cannot retain failed lifecycle state.
       */
      if (
        this.status ===
        'SUCCEEDED'
      ) {
        this.failedAt = null;
        this.nextAttemptAt =
          null;
        this.error = null;
      }

      /*
       * Ledger state consistency.
       */
      if (
        this.ledgerPostingStatus ===
          'POSTED' &&
        !this.ledgerEntryId
      ) {
        this.invalidate(
          'ledgerEntryId',
          'ledgerEntryId is required when ledgerPostingStatus=POSTED.',
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
       * Resulting Payment should only exist for a successful intent.
       */
      if (
        this.paymentId &&
        this.status !==
          'SUCCEEDED'
      ) {
        this.invalidate(
          'paymentId',
          'paymentId can only be attached to a succeeded PaymentIntent.',
        );
      }

      /*
       * Expiry must occur after initiation.
       */
      if (
        this.expiresAt &&
        this.initiatedAt &&
        this.expiresAt.getTime() <=
          this.initiatedAt.getTime()
      ) {
        this.invalidate(
          'expiresAt',
          'expiresAt must be after initiatedAt.',
        );
      }

      /*
       * Attempt bounds.
       */
      if (
        this.attempts < 0 ||
        this.attempts > MAX_ATTEMPTS
      ) {
        this.invalidate(
          'attempts',
          `attempts must be between 0 and ${MAX_ATTEMPTS}.`,
        );
      }

      /*
       * Verification consistency.
       */
      if (
        this.verifiedAt &&
        !this.verificationRequired
      ) {
        /**
         * A provider may perform implicit verification. Do not reject it.
         */
      }

      /*
       * Metadata sanitization.
       */
      if (
        this.metadata
      ) {
        this.metadata =
          new IntentMetadataSchema(
            this.metadata,
          );
      }

      if (
        this.providerResponse
      ) {
        this.providerResponse =
          new ProviderResponseSchema(
            this.providerResponse,
          );
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
 * PaymentIntent records must not be physically hard-deleted by application
 * code.
 */
PaymentIntentSchema.pre(
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
        'PaymentIntent hard deletion is disabled.',
      ),
    );
  },
);

/**
 * Generic query mutations are disabled.
 *
 * Controlled atomic methods above explicitly opt in.
 */
PaymentIntentSchema.pre(
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
      options.allowPaymentIntentMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic PaymentIntent updates are disabled. Use controlled lifecycle methods.',
      ),
    );
  },
);

PaymentIntentSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for PaymentIntent.',
      ),
    );
  },
);

/* ==========================================================================
 * Soft-delete query protection
 * ========================================================================== */

PaymentIntentSchema.pre(
  /^find/,
  function hideDeletedIntents(
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

const PaymentIntent =
  mongoose.models.PaymentIntent ||
  mongoose.model(
    'PaymentIntent',
    PaymentIntentSchema,
  );

export default PaymentIntent;

export {
  PaymentIntentSchema,
  ProviderResponseSchema,
  IntentMetadataSchema,
  PaymentIntentErrorSchema,
  PAYMENT_INTENT_TRANSITIONS,
};