"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Payment.js
 *
 * Purpose:
 *   Enterprise-grade payment aggregate for TITech Community Capital.
 *
 * Architectural Responsibilities:
 *   - Represent external payment attempts and provider interactions.
 *   - Maintain immutable financial identity.
 *   - Support MTN Mobile Money, Airtel Money and card/payment providers.
 *   - Support provider references and webhook reconciliation.
 *   - Provide idempotency protection.
 *   - Track retries and operational failures.
 *   - Support refunds.
 *   - Preserve payment lifecycle timestamps.
 *   - Support multi-tenant operation.
 *
 * IMPORTANT FINANCIAL DESIGN RULE:
 *
 *   This model represents a PAYMENT/EXTERNAL PAYMENT ATTEMPT.
 *
 *   It MUST NOT be treated as the authoritative accounting ledger.
 *
 *   Completed payments should ultimately be reflected in the TITech
 *   double-entry ledger through an atomic/idempotent financial service.
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

const SUPPORTED_CURRENCIES = [
  "UGX",
  "XAF",
  "EUR",
  "USD",
  "NGN",
  "GHS",
  "KES",
  "TZS",
  "RWF",
  "ZAR",
];

const PAYMENT_PROVIDERS = [
  "MTN_MOMO",
  "AIRTEL_MONEY",
  "STRIPE",
  "PAYPAL",
];

const PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
];

const PAYMENT_METHODS = [
  "MOBILE_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
  "OTHER",
];

const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_PROVIDER_REFERENCE_LENGTH = 256;
const MAX_PROVIDER_STATUS_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_PHONE_LENGTH = 32;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_IP_LENGTH = 64;

/**
 * =============================================================================
 * Reusable Sub-Schemas
 * =============================================================================
 */

/**
 * Payment error information.
 *
 * Never place secrets, access tokens, passwords, CVV values, PINs or complete
 * payment credentials inside this object.
 */
const PaymentErrorSchema = new Schema(
  {
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

    details: {
      type: Schema.Types.Mixed,
      default: undefined,
    },

    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
    id: false,
  }
);

/**
 * Operational metadata.
 *
 * Keep this intentionally non-financial and non-secret.
 */
const PaymentMetadataSchema = new Schema(
  {
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: null,
    },

    deviceId: {
      type: String,
      trim: true,
      maxlength: 256,
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
  },
  {
    _id: false,
    id: false,
  }
);

/**
 * =============================================================================
 * Payment Schema
 * =============================================================================
 */

const paymentSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * Tenant
     * -------------------------------------------------------------------------
     *
     * TITech is designed as a multi-tenant platform.
     *
     * This field should correspond to the tenant owning the financial
     * transaction.
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
     * TITech Internal Transaction Identity
     * -------------------------------------------------------------------------
     *
     * This is the canonical internal payment transaction identifier.
     *
     * It should NOT be replaced by a provider transaction/reference.
     */

    transactionId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
    },

    /**
     * -------------------------------------------------------------------------
     * User / Financial Context
     * -------------------------------------------------------------------------
     */

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

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
     * Financial Amount
     * -------------------------------------------------------------------------
     *
     * WARNING:
     *
     * JavaScript Number is NOT ideal for authoritative monetary accounting.
     *
     * The authoritative ledger should use integer minor units / Decimal128.
     *
     * This model uses Decimal128 to avoid binary floating-point precision
     * errors.
     */

    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          if (value == null) return false;

          return value.toString() !== "NaN" && Number(value.toString()) > 0;
        },
        message: "Payment amount must be greater than zero",
      },
    },

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
     * Provider
     * -------------------------------------------------------------------------
     */

    provider: {
      type: String,
      enum: PAYMENT_PROVIDERS,
      required: true,
      immutable: true,
      index: true,
    },

    providerReference: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_REFERENCE_LENGTH,
      default: null,
      index: true,
    },

    providerStatus: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_STATUS_LENGTH,
      default: null,
    },

    /**
     * Provider webhook/event identity.
     *
     * Used to prevent processing the same provider event multiple times.
     */
    providerEventId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Payment Channel
     * -------------------------------------------------------------------------
     */

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "MOBILE_MONEY",
      index: true,
    },

    phoneNumber: {
      type: String,
      trim: true,
      maxlength: MAX_PHONE_LENGTH,
      default: null,
      select: false,
    },

    /**
     * -------------------------------------------------------------------------
     * Payment Lifecycle
     * -------------------------------------------------------------------------
     */

    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "PENDING",
      required: true,
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

    refundedAt: {
      type: Date,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Refund
     * -------------------------------------------------------------------------
     */

    refundAmount: {
      type: Schema.Types.Decimal128,
      default: null,
      validate: {
        validator(value) {
          if (value == null) return true;

          return Number(value.toString()) >= 0;
        },
        message: "Refund amount cannot be negative",
      },
    },

    refundReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    providerRefundReference: {
      type: String,
      trim: true,
      maxlength: MAX_PROVIDER_REFERENCE_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Idempotency
     * -------------------------------------------------------------------------
     *
     * The combination of tenantId + idempotencyKey is the safe uniqueness
     * boundary for multi-tenant APIs.
     */

    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
      default: null,
      index: true,
      select: false,
    },

    /**
     * -------------------------------------------------------------------------
     * Retry Management
     * -------------------------------------------------------------------------
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

    /**
     * -------------------------------------------------------------------------
     * Security / Verification
     * -------------------------------------------------------------------------
     *
     * Never store a plaintext verification secret here.
     *
     * verificationTokenHash should be populated instead of verificationToken.
     */

    verificationTokenHash: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
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

    /**
     * -------------------------------------------------------------------------
     * Provider Reconciliation
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
     * Ledger Integration
     * -------------------------------------------------------------------------
     *
     * A payment should only be considered financially posted after the
     * corresponding ledger operation succeeds.
     */

    ledgerEntryId: {
      type: Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
      index: true,
    },

    ledgerPostedAt: {
      type: Date,
      default: null,
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
     * Metadata
     * -------------------------------------------------------------------------
     */

    metadata: {
      type: PaymentMetadataSchema,
      default: () => ({}),
    },

    /**
     * -------------------------------------------------------------------------
     * Error
     * -------------------------------------------------------------------------
     */

    error: {
      type: PaymentErrorSchema,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Encryption Marker
     * -------------------------------------------------------------------------
     *
     * Prefer field-level encryption for sensitive fields rather than using a
     * boolean marker as the security mechanism.
     */

    encrypted: {
      type: Boolean,
      default: false,
    },

    /**
     * -------------------------------------------------------------------------
     * Soft Delete
     * -------------------------------------------------------------------------
     *
     * Financial records should generally NOT be physically deleted.
     *
     * Soft deletion exists primarily for administrative/data-lifecycle
     * operations and must never erase accounting history.
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

    collection: "payments",

    minimize: true,

    strict: true,
  }
);

/**
 * =============================================================================
 * Indexes
 * =============================================================================
 */

/**
 * User payment history.
 */
paymentSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
});

/**
 * Group payment history.
 */
paymentSchema.index({
  tenantId: 1,
  groupId: 1,
  createdAt: -1,
});

/**
 * Status monitoring / operational dashboards.
 */
paymentSchema.index({
  tenantId: 1,
  status: 1,
  createdAt: -1,
});

/**
 * Provider reconciliation.
 */
paymentSchema.index({
  provider: 1,
  providerReference: 1,
});

/**
 * Provider event deduplication.
 *
 * Sparse uniqueness permits multiple payments without a providerEventId while
 * preventing the same provider event from being attached to multiple payments.
 */
paymentSchema.index(
  {
    provider: 1,
    providerEventId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_provider_event",
  }
);

/**
 * Tenant-scoped idempotency.
 *
 * IMPORTANT:
 * This replaces global uniqueness of idempotencyKey.
 */
paymentSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_tenant_idempotency_key",
  }
);

/**
 * Ledger posting operations.
 */
paymentSchema.index({
  tenantId: 1,
  ledgerPostingStatus: 1,
  createdAt: -1,
});

/**
 * Retry worker queue.
 */
paymentSchema.index({
  status: 1,
  nextRetryAt: 1,
});

/**
 * Reconciliation queue.
 */
paymentSchema.index({
  reconciliationStatus: 1,
  createdAt: -1,
});

/**
 * Initiation-time reporting.
 */
paymentSchema.index({
  tenantId: 1,
  initiatedAt: -1,
});

/**
 * =============================================================================
 * Virtuals
 * =============================================================================
 */

/**
 * Display amount.
 *
 * Decimal128 is converted to string instead of using Number arithmetic.
 */
paymentSchema.virtual("displayAmount").get(function () {
  if (this.amount == null) {
    return null;
  }

  return `${this.currency} ${this.amount.toString()}`;
});

/**
 * Determine whether this payment is financially completed.
 */
paymentSchema.virtual("isCompleted").get(function () {
  return this.status === "COMPLETED";
});

/**
 * Determine whether a refund exists.
 */
paymentSchema.virtual("isRefunded").get(function () {
  return (
    this.status === "REFUNDED" ||
    this.refundAmount != null
  );
});

/**
 * Determine whether ledger posting is complete.
 */
paymentSchema.virtual("isLedgerPosted").get(function () {
  return this.ledgerPostingStatus === "POSTED";
});

/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

paymentSchema.query.active = function () {
  return this.where({
    isDeleted: false,
  });
};

paymentSchema.query.pending = function () {
  return this.where({
    status: {
      $in: ["PENDING", "PROCESSING"],
    },
    isDeleted: false,
  });
};

paymentSchema.query.completed = function () {
  return this.where({
    status: "COMPLETED",
    isDeleted: false,
  });
};

paymentSchema.query.needingReconciliation = function () {
  return this.where({
    reconciliationStatus: {
      $in: ["PENDING", "MISMATCHED"],
    },
    isDeleted: false,
  });
};

paymentSchema.query.needingLedgerPosting = function () {
  return this.where({
    status: "COMPLETED",
    ledgerPostingStatus: {
      $in: ["NOT_POSTED", "FAILED"],
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
 * Determine whether payment is terminal.
 */
paymentSchema.methods.isTerminal = function () {
  return [
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "REFUNDED",
  ].includes(this.status);
};

/**
 * Determine whether payment can be retried.
 */
paymentSchema.methods.canRetry = function () {
  return [
    "PENDING",
    "PROCESSING",
    "FAILED",
  ].includes(this.status);
};

/**
 * Mark payment as processing.
 */
paymentSchema.methods.markProcessing = function () {
  this.status = "PROCESSING";

  if (!this.processingAt) {
    this.processingAt = new Date();
  }

  return this.save();
};

/**
 * Mark payment as completed.
 */
paymentSchema.methods.markCompleted = function () {
  this.status = "COMPLETED";

  if (!this.confirmedAt) {
    this.confirmedAt = new Date();
  }

  this.failedAt = null;

  return this.save();
};

/**
 * Mark payment as failed.
 */
paymentSchema.methods.markFailed = function (error = {}) {
  this.status = "FAILED";

  this.failedAt = new Date();

  this.error = {
    code: error.code || null,
    message: error.message || null,
    details: error.details,
    timestamp: new Date(),
  };

  return this.save();
};

/**
 * Mark payment as cancelled.
 */
paymentSchema.methods.markCancelled = function (reason = null) {
  this.status = "CANCELLED";

  this.cancelledAt = new Date();

  if (reason) {
    this.error = {
      code: "PAYMENT_CANCELLED",
      message: reason,
      timestamp: new Date(),
    };
  }

  return this.save();
};

/**
 * Mark payment as refunded.
 */
paymentSchema.methods.markRefunded = function ({
  refundAmount,
  reason = null,
  providerRefundReference = null,
} = {}) {
  if (refundAmount == null) {
    throw new Error("Refund amount is required");
  }

  this.status = "REFUNDED";
  this.refundedAt = new Date();
  this.refundAmount = mongoose.Types.Decimal128.fromString(
    String(refundAmount)
  );
  this.refundReason = reason;
  this.providerRefundReference = providerRefundReference;

  return this.save();
};

/**
 * Increment retry state.
 */
paymentSchema.methods.registerRetry = function ({
  nextRetryAt = null,
} = {}) {
  this.retryCount += 1;
  this.lastRetryAt = new Date();
  this.nextRetryAt = nextRetryAt;

  return this.save();
};

/**
 * Mark payment as ledger-posted.
 */
paymentSchema.methods.markLedgerPosted = function (ledgerEntryId) {
  if (!ledgerEntryId) {
    throw new Error("ledgerEntryId is required");
  }

  this.ledgerEntryId = ledgerEntryId;
  this.ledgerPostedAt = new Date();
  this.ledgerPostingStatus = "POSTED";

  return this.save();
};

/**
 * Mark reconciliation as successful.
 */
paymentSchema.methods.markReconciled = function () {
  this.reconciliationStatus = "MATCHED";
  this.lastReconciledAt = new Date();

  return this.save();
};

/**
 * Soft-delete a payment.
 *
 * Financial records should normally be retained rather than deleted.
 */
paymentSchema.methods.softDelete = function (reason = null) {
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
 * Find payment by internal transaction ID.
 */
paymentSchema.statics.findByTransactionId = function (transactionId) {
  return this.findOne({
    transactionId,
    isDeleted: false,
  });
};

/**
 * Find payment using tenant-scoped idempotency.
 */
paymentSchema.statics.findByIdempotencyKey = function (
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
paymentSchema.statics.findByProviderReference = function (
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
 * Find by provider webhook/event ID.
 */
paymentSchema.statics.findByProviderEventId = function (
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
 * Atomically transition payment to completed.
 *
 * The service layer should additionally perform the corresponding ledger
 * operation using the same transaction/outbox architecture where supported.
 */
paymentSchema.statics.completeAtomically = function (
  paymentId,
  {
    providerReference = null,
    providerStatus = null,
    providerEventId = null,
  } = {},
  options = {}
) {
  const now = new Date();

  const update = {
    $set: {
      status: "COMPLETED",
      confirmedAt: now,
      providerReference,
      providerStatus,
    },
    $unset: {
      failedAt: 1,
    },
  };

  if (providerEventId) {
    update.$set.providerEventId = providerEventId;
  }

  const query = {
    _id: paymentId,
    status: {
      $in: ["PENDING", "PROCESSING"],
    },
    isDeleted: false,
  };

  return this.findOneAndUpdate(
    query,
    update,
    {
      new: true,
      session: options.session,
    }
  );
};

/**
 * Atomically register a provider event.
 */
paymentSchema.statics.registerProviderEvent = function (
  paymentId,
  providerEventId,
  options = {}
) {
  if (!paymentId || !providerEventId) {
    throw new Error(
      "paymentId and providerEventId are required"
    );
  }

  return this.findOneAndUpdate(
    {
      _id: paymentId,
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
        providerEventId,
      },
    },
    {
      new: true,
      session: options.session,
    }
  );
};

/**
 * =============================================================================
 * Lifecycle Validation
 * =============================================================================
 */

paymentSchema.pre("validate", function (next) {
  /**
   * Completed payments require confirmation time.
   */
  if (this.status === "COMPLETED" && !this.confirmedAt) {
    this.confirmedAt = new Date();
  }

  /**
   * Failed payments require failedAt.
   */
  if (this.status === "FAILED" && !this.failedAt) {
    this.failedAt = new Date();
  }

  /**
   * Cancelled payments require cancelledAt.
   */
  if (this.status === "CANCELLED" && !this.cancelledAt) {
    this.cancelledAt = new Date();
  }

  /**
   * Refunded payments require refundedAt.
   */
  if (this.status === "REFUNDED" && !this.refundedAt) {
    this.refundedAt = new Date();
  }

  /**
   * A completed payment should not retain a failed timestamp.
   */
  if (this.status === "COMPLETED") {
    this.failedAt = null;
  }

  /**
   * Refund cannot exceed payment amount.
   */
  if (
    this.refundAmount != null &&
    this.amount != null
  ) {
    const refund = Number(this.refundAmount.toString());
    const amount = Number(this.amount.toString());

    if (refund > amount) {
      this.invalidate(
        "refundAmount",
        "Refund amount cannot exceed payment amount"
      );
    }
  }

  /**
   * Ledger-posted status requires ledger identity.
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
 * Soft Delete Query Protection
 * ============================================================================= */

paymentSchema.pre(/^find/, function (next) {
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
 * JSON Serialization Protection
 * =============================================================================
 *
 * Sensitive operational fields are deliberately removed.
 */

paymentSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.idempotencyKey;
  delete obj.verificationTokenHash;
  delete obj.phoneNumber;

  return obj;
};

/**
 * =============================================================================
 * Model Export
 * =============================================================================
 */

module.exports =
  mongoose.models.Payment ||
  mongoose.model("Payment", paymentSchema);