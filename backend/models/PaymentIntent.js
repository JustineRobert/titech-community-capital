"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/PaymentIntent.js
 *
 * Purpose:
 *   Enterprise-grade payment intent aggregate.
 *
 * Architectural Role:
 *
 *   Client/API Request
 *          ↓
 *   PaymentIntent
 *          ↓
 *   Payment Provider Adapter
 *          ↓
 *   Provider Confirmation / Webhook
 *          ↓
 *   Payment
 *          ↓
 *   Double-Entry Ledger
 *
 * PaymentIntent represents the INTENTION to perform a payment.
 *
 * Payment represents the resulting external payment transaction.
 *
 * The PaymentIntent MUST NOT be treated as the authoritative accounting
 * ledger or account-balance source of truth.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PAYMENT_INTENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "canceled",
];

const PAYMENT_PROVIDERS = [
  "MTN_MOMO",
  "AIRTEL_MONEY",
  "STRIPE",
  "PAYPAL",
];

const PAYMENT_METHODS = [
  "MOBILE_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
  "OTHER",
];

const SUPPORTED_CURRENCIES = [
  "UGX",
  "KES",
  "TZS",
  "RWF",
  "NGN",
  "GHS",
  "XAF",
  "ZAR",
  "USD",
  "EUR",
];

const MAX_INTENT_ID_LENGTH = 128;
const MAX_PROVIDER_LENGTH = 64;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_PROVIDER_EVENT_ID_LENGTH = 256;
const MAX_PROVIDER_REFERENCE_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_ATTEMPTS = 100;

/**
 * =============================================================================
 * Sub-Schemas
 * =============================================================================
 */

/**
 * Provider response metadata.
 *
 * Do not use this field for secrets, credentials, PINs, CVVs, access tokens,
 * refresh tokens or other authentication material.
 */
const ProviderResponseSchema = new Schema(
  {
    code: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    status: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    reference: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_REFERENCE_LENGTH,
      default: null,
    },

    message: {
      type: String,
      trim: true,
      maxlength: MAX_ERROR_MESSAGE_LENGTH,
      default: null,
    },

    receivedAt: {
      type: Date,
      default: null,
    },

    data: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    _id: false,
    id: false,
  }
);

/**
 * Non-sensitive operational metadata.
 */
const IntentMetadataSchema = new Schema(
  {
    requestId: {
      type: String,
      trim: true,
      maxlength: MAX_REQUEST_ID_LENGTH,
      default: null,
      index: false,
    },

    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      default: null,
    },

    channel: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },

    source: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    deviceId: {
      type: String,
      trim: true,
      maxlength: MAX_DEVICE_ID_LENGTH,
      default: null,
    },

    ipAddress: {
      type: String,
      trim: true,
      maxlength: MAX_IP_LENGTH,
      default: null,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: MAX_USER_AGENT_LENGTH,
      default: null,
    },

    providerResponse: {
      type: ProviderResponseSchema,
      default: null,
    },

    extra: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    _id: false,
    id: false,
  }
);

/**
 * =============================================================================
 * PaymentIntent Schema
 * =============================================================================
 */

const PaymentIntentSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * Tenant
     * -------------------------------------------------------------------------
     *
     * Required for TITech's multi-tenant financial architecture.
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Intent Identity
     * -------------------------------------------------------------------------
     *
     * Internal TITech identifier.
     *
     * This is NOT the provider transaction ID.
     */

    intentId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      minlength: 8,
      maxlength: MAX_INTENT_ID_LENGTH,
    },

    /**
     * -------------------------------------------------------------------------
     * User
     * -------------------------------------------------------------------------
     */

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Financial Context
     * -------------------------------------------------------------------------
     */

    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
      immutable: true,
      index: true,
    },

    contributionId: {
      type: Schema.Types.ObjectId,
      ref: "Contribution",
      default: null,
      immutable: true,
      index: true,
    },

    loanId: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      default: null,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Amount
     * -------------------------------------------------------------------------
     *
     * Decimal128 is deliberately retained throughout the model.
     *
     * Do NOT use parseFloat() getters for authoritative financial values.
     */

    amount: {
      type: Schema.Types.Decimal128,
      required: true,

      validate: {
        validator(value) {
          if (value == null) {
            return false;
          }

          const numericValue = Number(value.toString());

          return (
            Number.isFinite(numericValue) &&
            numericValue > 0
          );
        },

        message: "Payment intent amount must be greater than zero",
      },
    },

    /**
     * -------------------------------------------------------------------------
     * Currency
     * -------------------------------------------------------------------------
     */

    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      required: true,
      default: "UGX",
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Lifecycle Status
     * -------------------------------------------------------------------------
     */

    status: {
      type: String,
      enum: PAYMENT_INTENT_STATUSES,
      required: true,
      default: "pending",
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Provider
     * -------------------------------------------------------------------------
     */

    provider: {
      type: String,
      enum: PAYMENT_PROVIDERS,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "MOBILE_MONEY",
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Provider Identity
     * -------------------------------------------------------------------------
     */

    providerReference: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_REFERENCE_LENGTH,
      default: null,
      index: true,
    },

    providerEventId: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_EVENT_ID_LENGTH,
      default: null,
      index: true,
    },

    providerStatus: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Idempotency
     * -------------------------------------------------------------------------
     *
     * Idempotency is scoped to tenant + key.
     */

    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
      default: null,
      select: false,
    },

    /**
     * -------------------------------------------------------------------------
     * Lifecycle Timestamps
     * -------------------------------------------------------------------------
     */

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
     * -------------------------------------------------------------------------
     * Failure Information
     * -------------------------------------------------------------------------
     */

    error: {
      code: {
        type: String,
        trim: true,
        maxlength: MAX_ERROR_CODE_LENGTH,
        default: null,
      },

      message: {
        type: String,
        trim: true,
        maxlength: MAX_ERROR_MESSAGE_LENGTH,
        default: null,
      },

      providerCode: {
        type: String,
        trim: true,
        maxlength: 256,
        default: null,
      },

      providerMessage: {
        type: String,
        trim: true,
        maxlength: MAX_ERROR_MESSAGE_LENGTH,
        default: null,
      },

      timestamp: {
        type: Date,
        default: null,
      },
    },

    /**
     * -------------------------------------------------------------------------
     * Attempt / Retry State
     * -------------------------------------------------------------------------
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

    /**
     * -------------------------------------------------------------------------
     * Provider Response
     * -------------------------------------------------------------------------
     *
     * Kept separately from general metadata so provider reconciliation code
     * has a predictable location.
     */

    providerResponse: {
      type: ProviderResponseSchema,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Client Data
     * -------------------------------------------------------------------------
     *
     * This field should contain only sanitized, non-secret client information.
     *
     * Do not persist arbitrary request bodies here.
     */

    clientData: {
      type: Schema.Types.Mixed,
      default: undefined,
    },

    /**
     * -------------------------------------------------------------------------
     * Verification
     * -------------------------------------------------------------------------
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

    /**
     * -------------------------------------------------------------------------
     * Payment Result
     * -------------------------------------------------------------------------
     *
     * Once succeeded, the resulting Payment record can be linked here.
     */

    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Ledger Result
     * -------------------------------------------------------------------------
     */

    ledgerEntryId: {
      type: Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
      index: true,
    },

    ledgerPostingStatus: {
      type: String,
      enum: [
        "NOT_POSTED",
        "PENDING",
        "POSTED",
        "FAILED",
      ],
      default: "NOT_POSTED",
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Reconciliation
     * -------------------------------------------------------------------------
     */

    reconciliationStatus: {
      type: String,
      enum: [
        "NOT_REQUIRED",
        "PENDING",
        "MATCHED",
        "MISMATCHED",
        "RESOLVED",
      ],
      default: "PENDING",
      index: true,
    },

    lastReconciledAt: {
      type: Date,
      default: null,
    },

    reconciliationNote: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Metadata
     * -------------------------------------------------------------------------
     */

    metadata: {
      type: IntentMetadataSchema,
      default: () => ({}),
    },

    /**
     * -------------------------------------------------------------------------
     * Soft Delete
     * -------------------------------------------------------------------------
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
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,

    versionKey: false,

    collection: "payment_intents",

    strict: true,

    minimize: true,

    /**
     * Do not convert Decimal128 to floating-point numbers automatically.
     */
    toJSON: {
      getters: false,
    },

    toObject: {
      getters: false,
    },
  }
);

/**
 * =============================================================================
 * Indexes
 * =============================================================================
 */

/**
 * User intent history.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  user: 1,
  createdAt: -1,
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
 * Provider processing queue.
 */
PaymentIntentSchema.index({
  provider: 1,
  status: 1,
  createdAt: -1,
});

/**
 * Provider reference lookup.
 */
PaymentIntentSchema.index({
  provider: 1,
  providerReference: 1,
});

/**
 * Provider webhook deduplication.
 */
PaymentIntentSchema.index(
  {
    provider: 1,
    providerEventId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_payment_intent_provider_event",
  }
);

/**
 * Tenant-scoped idempotency.
 */
PaymentIntentSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_payment_intent_tenant_idempotency",
  }
);

/**
 * Request correlation.
 */
PaymentIntentSchema.index({
  "metadata.requestId": 1,
});

/**
 * Retry worker queue.
 */
PaymentIntentSchema.index({
  status: 1,
  nextAttemptAt: 1,
});

/**
 * Ledger posting queue.
 */
PaymentIntentSchema.index({
  ledgerPostingStatus: 1,
  createdAt: -1,
});

/**
 * Reconciliation queue.
 */
PaymentIntentSchema.index({
  reconciliationStatus: 1,
  createdAt: -1,
});

/**
 * Group payment intents.
 */
PaymentIntentSchema.index({
  tenantId: 1,
  groupId: 1,
  createdAt: -1,
});

/**
 * =============================================================================
 * Virtuals
 * =============================================================================
 */

/**
 * Exact display amount without floating-point conversion.
 */
PaymentIntentSchema.virtual("displayAmount").get(function () {
  if (this.amount == null) {
    return null;
  }

  return `${this.currency} ${this.amount.toString()}`;
});

/**
 * Whether the intent reached a terminal state.
 */
PaymentIntentSchema.virtual("isTerminal").get(function () {
  return [
    "succeeded",
    "failed",
    "canceled",
  ].includes(this.status);
});

/**
 * Whether this intent succeeded.
 */
PaymentIntentSchema.virtual("isSucceeded").get(function () {
  return this.status === "succeeded";
});

/**
 * Whether ledger posting is complete.
 */
PaymentIntentSchema.virtual("isLedgerPosted").get(function () {
  return this.ledgerPostingStatus === "POSTED";
});

/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

PaymentIntentSchema.query.active = function () {
  return this.where({
    isDeleted: false,
  });
};

PaymentIntentSchema.query.pending = function () {
  return this.where({
    status: "pending",
    isDeleted: false,
  });
};

PaymentIntentSchema.query.processing = function () {
  return this.where({
    status: "processing",
    isDeleted: false,
  });
};

PaymentIntentSchema.query.succeeded = function () {
  return this.where({
    status: "succeeded",
    isDeleted: false,
  });
};

PaymentIntentSchema.query.failed = function () {
  return this.where({
    status: "failed",
    isDeleted: false,
  });
};

PaymentIntentSchema.query.needingReconciliation = function () {
  return this.where({
    reconciliationStatus: {
      $in: [
        "PENDING",
        "MISMATCHED",
      ],
    },
    isDeleted: false,
  });
};

PaymentIntentSchema.query.needingLedgerPosting = function () {
  return this.where({
    status: "succeeded",
    ledgerPostingStatus: {
      $in: [
        "NOT_POSTED",
        "FAILED",
      ],
    },
    isDeleted: false,
  });
};

/**
 * =============================================================================
 * Instance Methods
 * =============================================================================
 */

/**
 * Mark intent as processing.
 */
PaymentIntentSchema.methods.markProcessing = function () {
  if (this.status === "succeeded" || this.status === "canceled") {
    throw new Error(
      `Cannot process payment intent in ${this.status} state`
    );
  }

  this.status = "processing";

  if (!this.processingAt) {
    this.processingAt = new Date();
  }

  this.lastAttemptAt = new Date();
  this.attempts += 1;

  return this.save();
};

/**
 * Mark intent as succeeded.
 */
PaymentIntentSchema.methods.markSucceeded = function ({
  providerReference = null,
  providerStatus = null,
  providerEventId = null,
  paymentId = null,
} = {}) {
  if (this.status === "canceled") {
    throw new Error(
      "Cannot succeed a canceled payment intent"
    );
  }

  const now = new Date();

  this.status = "succeeded";
  this.succeededAt = now;

  this.providerReference = providerReference;
  this.providerStatus = providerStatus;

  if (providerEventId) {
    this.providerEventId = providerEventId;
  }

  if (paymentId) {
    this.paymentId = paymentId;
  }

  this.error = null;

  return this.save();
};

/**
 * Mark intent as failed.
 */
PaymentIntentSchema.methods.markFailed = function ({
  code = null,
  message = null,
  providerCode = null,
  providerMessage = null,
  nextAttemptAt = null,
} = {}) {
  const now = new Date();

  this.status = "failed";
  this.failedAt = now;

  this.error = {
    code,
    message,
    providerCode,
    providerMessage,
    timestamp: now,
  };

  this.nextAttemptAt = nextAttemptAt;

  return this.save();
};

/**
 * Mark intent as canceled.
 */
PaymentIntentSchema.methods.markCanceled = function (
  reason = null
) {
  const now = new Date();

  this.status = "canceled";
  this.canceledAt = now;

  if (reason) {
    this.error = {
      code: "PAYMENT_INTENT_CANCELED",
      message: reason,
      timestamp: now,
    };
  }

  return this.save();
};

/**
 * Register a retry attempt.
 */
PaymentIntentSchema.methods.registerAttempt = function ({
  nextAttemptAt = null,
} = {}) {
  if (this.attempts >= MAX_ATTEMPTS) {
    throw new Error(
      "Maximum payment intent attempts exceeded"
    );
  }

  this.attempts += 1;
  this.lastAttemptAt = new Date();
  this.nextAttemptAt = nextAttemptAt;

  return this.save();
};

/**
 * Mark verification complete.
 */
PaymentIntentSchema.methods.markVerified = function () {
  this.verifiedAt = new Date();

  return this.save();
};

/**
 * Mark ledger posting successful.
 */
PaymentIntentSchema.methods.markLedgerPosted = function (
  ledgerEntryId
) {
  if (!ledgerEntryId) {
    throw new Error("ledgerEntryId is required");
  }

  this.ledgerEntryId = ledgerEntryId;
  this.ledgerPostingStatus = "POSTED";

  return this.save();
};

/**
 * Mark reconciliation successful.
 */
PaymentIntentSchema.methods.markReconciled = function () {
  this.reconciliationStatus = "MATCHED";
  this.lastReconciledAt = new Date();

  return this.save();
};

/**
 * Soft delete.
 */
PaymentIntentSchema.methods.softDelete = function (
  reason = null
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deleteReason = reason;

  return this.save();
};

/**
 * =============================================================================
 * Static Methods
 * =============================================================================
 */

/**
 * Find by internal intent ID.
 */
PaymentIntentSchema.statics.findByIntentId = function (
  intentId
) {
  return this.findOne({
    intentId,
    isDeleted: false,
  });
};

/**
 * Find using tenant-scoped idempotency key.
 */
PaymentIntentSchema.statics.findByIdempotencyKey = function (
  tenantId,
  idempotencyKey
) {
  if (!tenantId || !idempotencyKey) {
    return null;
  }

  return this.findOne({
    tenantId,
    idempotencyKey,
    isDeleted: false,
  }).select("+idempotencyKey");
};

/**
 * Find by provider reference.
 */
PaymentIntentSchema.statics.findByProviderReference = function (
  provider,
  providerReference
) {
  if (!provider || !providerReference) {
    return null;
  }

  return this.findOne({
    provider,
    providerReference,
    isDeleted: false,
  });
};

/**
 * Find by provider event.
 */
PaymentIntentSchema.statics.findByProviderEventId = function (
  provider,
  providerEventId
) {
  if (!provider || !providerEventId) {
    return null;
  }

  return this.findOne({
    provider,
    providerEventId,
    isDeleted: false,
  });
};

/**
 * Atomically claim a pending intent for processing.
 *
 * This is important when multiple workers/processes are operating concurrently.
 */
PaymentIntentSchema.statics.claimForProcessing = function (
  intentId
) {
  const now = new Date();

  return this.findOneAndUpdate(
    {
      intentId,
      status: "pending",
      isDeleted: false,
    },
    {
      $set: {
        status: "processing",
        processingAt: now,
        lastAttemptAt: now,
      },

      $inc: {
        attempts: 1,
      },
    },
    {
      new: true,
    }
  );
};

/**
 * Atomically succeed an intent.
 */
PaymentIntentSchema.statics.succeedAtomically = function (
  intentId,
  {
    providerReference = null,
    providerStatus = null,
    providerEventId = null,
    paymentId = null,
  } = {}
) {
  const now = new Date();

  const set = {
    status: "succeeded",
    succeededAt: now,
    providerReference,
    providerStatus,
    error: null,
  };

  if (providerEventId) {
    set.providerEventId = providerEventId;
  }

  if (paymentId) {
    set.paymentId = paymentId;
  }

  return this.findOneAndUpdate(
    {
      intentId,
      status: {
        $in: [
          "pending",
          "processing",
        ],
      },
      isDeleted: false,
    },
    {
      $set: set,
    },
    {
      new: true,
    }
  );
};

/**
 * Atomically cancel an intent.
 */
PaymentIntentSchema.statics.cancelAtomically = function (
  intentId,
  reason = null
) {
  const now = new Date();

  return this.findOneAndUpdate(
    {
      intentId,
      status: {
        $in: [
          "pending",
          "processing",
        ],
      },
      isDeleted: false,
    },
    {
      $set: {
        status: "canceled",
        canceledAt: now,
        error: reason
          ? {
              code: "PAYMENT_INTENT_CANCELED",
              message: reason,
              timestamp: now,
            }
          : null,
      },
    },
    {
      new: true,
    }
  );
};

/**
 * =============================================================================
 * Lifecycle Validation
 * =============================================================================
 */

PaymentIntentSchema.pre("validate", function (next) {
  /**
   * Successful intents require succeededAt.
   */
  if (
    this.status === "succeeded" &&
    !this.succeededAt
  ) {
    this.succeededAt = new Date();
  }

  /**
   * Failed intents require failedAt.
   */
  if (
    this.status === "failed" &&
    !this.failedAt
  ) {
    this.failedAt = new Date();
  }

  /**
   * Canceled intents require canceledAt.
   */
  if (
    this.status === "canceled" &&
    !this.canceledAt
  ) {
    this.canceledAt = new Date();
  }

  /**
   * Processing intents require processingAt.
   */
  if (
    this.status === "processing" &&
    !this.processingAt
  ) {
    this.processingAt = new Date();
  }

  /**
   * Successful intents should not retain a failure timestamp.
   */
  if (this.status === "succeeded") {
    this.failedAt = null;
  }

  /**
   * Ledger-posted state requires ledger identity.
   */
  if (
    this.ledgerPostingStatus === "POSTED" &&
    !this.ledgerEntryId
  ) {
    this.invalidate(
      "ledgerEntryId",
      "ledgerEntryId is required when ledgerPostingStatus is POSTED"
    );
  }

  next();
});

/**
 * =============================================================================
 * Soft Delete Protection
 * =============================================================================
 */

PaymentIntentSchema.pre(/^find/, function (next) {
  const options = this.getOptions();

  if (!options.includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

/**
 * =============================================================================
 * Serialization Protection
 * =============================================================================
 */

PaymentIntentSchema.methods.toJSON = function () {
  const obj = this.toObject();

  /**
   * Never expose idempotency keys through generic API serialization.
   */
  delete obj.idempotencyKey;

  /**
   * Avoid accidentally returning raw provider payloads through generic APIs.
   */
  if (obj.metadata) {
    delete obj.metadata.providerResponse;
  }

  delete obj.providerResponse;

  return obj;
};

/**
 * =============================================================================
 * Model Export
 * =============================================================================
 */

module.exports =
  mongoose.models.PaymentIntent ||
  mongoose.model(
    "PaymentIntent",
    PaymentIntentSchema
  );