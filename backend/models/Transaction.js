// ============================================================================
// backend/models/Transaction.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Financial Transaction Model
//
// PURPOSE
// ----------------------------------------------------------------------------
// Authoritative business/payment transaction state record for TITech
// Community Capital.
//
// IMPORTANT DOMAIN SEPARATION
// ----------------------------------------------------------------------------
// Transaction != LedgerEntry != Balance
//
// This model records the business/payment transaction lifecycle.
// It does NOT constitute proof that accounting has been posted.
//
// The authoritative monetary/accounting mutation must be performed by the
// ledger/financial subsystem and linked through ledgerReference / ledgerEntryId.
//
// GOLDEN MONEY PATH
// ----------------------------------------------------------------------------
// User
//   -> Institution
//   -> Group
//   -> Member
//   -> Contribution
//   -> Payment Request
//   -> Provider
//   -> Callback
//   -> Validation
//   -> Idempotency
//   -> Transaction
//   -> Ledger
//   -> Balance
//   -> Reconciliation
//   -> Receipt
//
// DESIGN GOALS
// ----------------------------------------------------------------------------
// - ESM / Node.js production compatibility
// - Multi-tenant isolation
// - Strong financial idempotency
// - Explicit state-machine enforcement
// - Concurrency-safe worker claiming
// - Retry / recovery controls
// - Provider reference integrity
// - Accounting / ledger separation
// - Reconciliation integrity
// - Reversal support
// - Session propagation
// - Auditability
// - Soft-delete identity preservation
// - Production observability correlation
//
// ============================================================================

"use strict";

import crypto from "node:crypto";
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

export const TRANSACTION_STATUS = Object.freeze([
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REVERSED",
  "SETTLED",
]);

export const TRANSACTION_TYPE = Object.freeze([
  "DEPOSIT",
  "WITHDRAWAL",
  "LOAN_DISBURSEMENT",
  "LOAN_REPAYMENT",
  "CONTRIBUTION",
  "SETTLEMENT",
  "TRANSFER",
  "REFUND",
]);

export const FLOW_TYPES = Object.freeze([
  "credit",
  "debit",
]);

export const PROVIDERS = Object.freeze([
  "mtn_momo",
  "airtel_money",
  "bank",
  "cash",
  "internal",
]);

export const SOURCE_TYPES = Object.freeze([
  "API",
  "WEB",
  "MOBILE",
  "MOBILE_MONEY",
  "BANK",
  "CASH",
  "QUEUE",
  "WORKER",
  "SYSTEM",
  "RECOVERY",
  "ADMIN",
]);

export const ACCOUNTING_STATUS = Object.freeze([
  "NOT_REQUIRED",
  "PENDING",
  "POSTING",
  "POSTED",
  "FAILED",
  "REVERSED",
]);

export const RECONCILIATION_STATUS = Object.freeze([
  "NOT_REQUIRED",
  "PENDING",
  "MATCHED",
  "MISMATCH",
  "EXCEPTION",
]);

export const SETTLEMENT_STATUS = Object.freeze([
  "PENDING",
  "SETTLED",
  "FAILED",
  "DISPUTED",
]);

/**
 * ============================================================================
 * STATE MACHINE
 * ============================================================================
 *
 * Financial transaction transitions are deliberately explicit.
 *
 * Valid:
 *
 * PENDING
 *   -> PROCESSING
 *   -> FAILED
 *   -> CANCELLED
 *   -> EXPIRED
 *
 * PROCESSING
 *   -> SUCCESS
 *   -> FAILED
 *   -> CANCELLED
 *   -> EXPIRED
 *
 * FAILED
 *   -> PROCESSING
 *   -> CANCELLED
 *   -> EXPIRED
 *
 * EXPIRED
 *   -> PROCESSING
 *   -> CANCELLED
 *
 * SUCCESS
 *   -> SETTLED
 *   -> REVERSED
 *
 * SETTLED
 *   -> REVERSED
 *
 * CANCELLED
 *   -> terminal
 *
 * REVERSED
 *   -> terminal
 *
 * There is deliberately no:
 *
 * SUCCESS  -> FAILED
 * SUCCESS  -> PROCESSING
 * SETTLED  -> SUCCESS
 * REVERSED -> SUCCESS
 * terminal -> PENDING
 *
 * Corrections occur through new reversal/refund/adjustment transactions.
 */

export const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze([
    "PROCESSING",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
  ]),

  PROCESSING: Object.freeze([
    "SUCCESS",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
  ]),

  FAILED: Object.freeze([
    "PROCESSING",
    "CANCELLED",
    "EXPIRED",
  ]),

  EXPIRED: Object.freeze([
    "PROCESSING",
    "CANCELLED",
  ]),

  SUCCESS: Object.freeze([
    "SETTLED",
    "REVERSED",
  ]),

  SETTLED: Object.freeze([
    "REVERSED",
  ]),

  CANCELLED: Object.freeze([]),

  REVERSED: Object.freeze([]),
});

const FINANCIAL_TERMINAL_STATUSES = Object.freeze([
  "SUCCESS",
  "SETTLED",
  "REVERSED",
]);

const BUSINESS_TERMINAL_STATUSES = Object.freeze([
  "SUCCESS",
  "SETTLED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REVERSED",
]);

const CLAIMABLE_STATUSES = Object.freeze([
  "PENDING",
  "FAILED",
  "EXPIRED",
]);

const SUCCESSFUL_STATUSES = Object.freeze([
  "SUCCESS",
  "SETTLED",
]);

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function normalizeString(value, maxLength = 200) {
  if (value == null) {
    return null;
  }

  const result = String(value).trim();

  if (!result) {
    return null;
  }

  return result.slice(0, maxLength);
}

function normalizeUpperString(value, maxLength = 200) {
  const result = normalizeString(value, maxLength);

  return result ? result.toUpperCase() : null;
}

function normalizeLowerString(value, maxLength = 200) {
  const result = normalizeString(value, maxLength);

  return result ? result.toLowerCase() : null;
}

function normalizeDate(value) {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid date supplied.");
  }

  return date;
}

function validateNonNegativeFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function validateNonNegativeInteger(value) {
  return (
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function assertStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    throw new Error(
      `Transaction is already in ${currentStatus} state.`
    );
  }

  const allowed =
    ALLOWED_STATUS_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.includes(nextStatus)) {
    throw new Error(
      `Invalid transaction state transition: ${currentStatus} -> ${nextStatus}.`
    );
  }
}

function isSuccessfulStatus(status) {
  return SUCCESSFUL_STATUSES.includes(status);
}

function isFinancialTerminalStatus(status) {
  return FINANCIAL_TERMINAL_STATUSES.includes(status);
}

function isBusinessTerminalStatus(status) {
  return BUSINESS_TERMINAL_STATUSES.includes(status);
}

function buildIdempotencyFingerprint({
  tenantId,
  idempotencyScope,
  idempotencyKey,
}) {
  if (
    !tenantId ||
    !idempotencyScope ||
    !idempotencyKey
  ) {
    return null;
  }

  const canonicalPayload = JSON.stringify([
    String(tenantId),
    String(idempotencyScope),
    String(idempotencyKey),
  ]);

  return crypto
    .createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

function getSession(options = {}) {
  return options?.session || undefined;
}

function getLeaseDate(
  now,
  leaseMinutes,
) {
  const normalizedLeaseMinutes = Math.min(
    24 * 60,
    Math.max(
      1,
      Number.isFinite(Number(leaseMinutes))
        ? Number(leaseMinutes)
        : 15,
    ),
  );

  return new Date(
    now.getTime() +
      normalizedLeaseMinutes * 60 * 1000,
  );
}

/**
 * Compare immutable business identity fields on an idempotent retry.
 *
 * A reused idempotency key with a materially different transaction is a
 * conflict, not a successful idempotent replay.
 */
function assertIdempotentPayloadMatches(
  existing,
  payload,
) {
  const comparisons = [
    ["tenantId", String(existing.tenantId), String(payload.tenantId)],
    [
      "amount",
      Number(existing.amount),
      Number(payload.amount),
    ],
    [
      "fees",
      Number(existing.fees || 0),
      Number(payload.fees || 0),
    ],
    [
      "currency",
      normalizeUpperString(existing.currency, 3),
      normalizeUpperString(payload.currency, 3),
    ],
    [
      "transactionType",
      existing.transactionType,
      payload.transactionType,
    ],
    [
      "flow",
      existing.flow,
      normalizeLowerString(payload.flow, 20),
    ],
    [
      "provider",
      existing.provider,
      normalizeLowerString(payload.provider, 50),
    ],
    [
      "idempotencyScope",
      existing.idempotencyScope || "default",
      payload.idempotencyScope || "default",
    ],
  ];

  for (const [
    field,
    existingValue,
    incomingValue,
  ] of comparisons) {
    if (existingValue !== incomingValue) {
      throw new Error(
        `IDEMPOTENCY_CONFLICT: idempotency key is already associated with a different ${field}.`,
      );
    }
  }

  return existing;
}

/**
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const transactionSchema = new Schema(
  {
    /**
     * ========================================================================
     * MULTI-TENANCY
     * ========================================================================
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * ========================================================================
     * BUSINESS REFERENCES
     * ========================================================================
     */

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      index: true,
    },

    loanId: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      index: true,
    },

    contributionId: {
      type: Schema.Types.ObjectId,
      ref: "Contribution",
      index: true,
    },

    savingsId: {
      type: Schema.Types.ObjectId,
      ref: "Savings",
      index: true,
    },

    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      index: true,
    },

    /**
     * ========================================================================
     * INTERNAL TRANSACTION REFERENCE
     * ========================================================================
     */

    transactionReference: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      immutable: true,
      index: true,
      set: (value) =>
        normalizeUpperString(value, 100),
    },

    /**
     * ========================================================================
     * IDEMPOTENCY
     * ========================================================================
     *
     * idempotencyScope MUST be derived by the trusted transaction service
     * from authenticated business context where possible.
     *
     * Example conceptual scope:
     *
     *   tenant + principal + device + operation
     *
     * This model retains the original idempotencyKey for compatibility while
     * also storing a deterministic SHA-256 identity fingerprint.
     */

    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    idempotencyScope: {
      type: String,
      trim: true,
      maxlength: 300,
      immutable: true,
      default: "default",
      index: true,
      set: (value) =>
        normalizeString(value, 300) || "default",
    },

    idempotencySource: {
      type: String,
      trim: true,
      maxlength: 100,
      immutable: true,
      set: (value) =>
        normalizeString(value, 100),
    },

    idempotencyFingerprint: {
      type: String,
      trim: true,
      minlength: 64,
      maxlength: 64,
      immutable: true,
      index: true,
      select: false,
    },

    /**
     * ========================================================================
     * PROVIDER REFERENCES
     * ========================================================================
     */

    externalId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    providerReferenceId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    providerTransactionId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    providerCorrelationId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    settlementId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    /**
     * ========================================================================
     * TRANSACTION CLASSIFICATION
     * ========================================================================
     */

    transactionType: {
      type: String,
      enum: TRANSACTION_TYPE,
      required: true,
      default: "DEPOSIT",
      immutable: true,
      index: true,
    },

    flow: {
      type: String,
      enum: FLOW_TYPES,
      required: true,
      immutable: true,
      index: true,
      set: (value) =>
        normalizeLowerString(value, 20),
    },

    provider: {
      type: String,
      enum: PROVIDERS,
      required: true,
      default: "internal",
      immutable: true,
      index: true,
      set: (value) =>
        normalizeLowerString(value, 50),
    },

    source: {
      type: String,
      enum: SOURCE_TYPES,
      default: "SYSTEM",
      index: true,
    },

    /**
     * ========================================================================
     * FINANCIAL DATA
     * ========================================================================
     *
     * Compatibility note:
     * Existing application consumers currently expect Number.
     *
     * The financial service / ledger layer MUST use a deterministic money
     * representation. For UGX-only minor-unit workflows, amounts should be
     * represented as safe integers. Decimal128 is appropriate when fractional
     * currency precision is required.
     *
     * This model therefore:
     * - rejects NaN/Infinity
     * - rejects unsafe JS integers
     * - derives netAmount server-side
     * - makes all core monetary fields immutable
     */

    amount: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
      index: true,
      validate: {
        validator(value) {
          return (
            validateNonNegativeFiniteNumber(value) &&
            Number.isSafeInteger(value)
          );
        },
        message:
          "Transaction amount must be a finite non-negative safe integer.",
      },
    },

    fees: {
      type: Number,
      default: 0,
      min: 0,
      immutable: true,
      validate: {
        validator(value) {
          return (
            validateNonNegativeFiniteNumber(value) &&
            Number.isSafeInteger(value)
          );
        },
        message:
          "Transaction fees must be a finite non-negative safe integer.",
      },
    },

    netAmount: {
      type: Number,
      default: 0,
      min: 0,
      immutable: true,
      validate: {
        validator(value) {
          return (
            validateNonNegativeFiniteNumber(value) &&
            Number.isSafeInteger(value)
          );
        },
        message:
          "Net transaction amount must be a finite non-negative safe integer.",
      },
    },

    currency: {
      type: String,
      required: true,
      default: "UGX",
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      immutable: true,
      match: [
        /^[A-Z]{3}$/,
        "Currency must be a valid three-letter ISO-style currency code.",
      ],
      set: (value) =>
        normalizeUpperString(value, 3),
    },

    /**
     * ========================================================================
     * PARTY INFORMATION
     * ========================================================================
     */

    phone: {
      type: String,
      trim: true,
      maxlength: 30,
      index: true,
      set: (value) =>
        normalizeString(value, 30),
    },

    accountNumber: {
      type: String,
      trim: true,
      maxlength: 100,
      index: true,
      set: (value) =>
        normalizeString(value, 100),
    },

    beneficiaryName: {
      type: String,
      trim: true,
      maxlength: 200,
      set: (value) =>
        normalizeString(value, 200),
    },

    beneficiaryAccount: {
      type: String,
      trim: true,
      maxlength: 100,
      set: (value) =>
        normalizeString(value, 100),
    },

    /**
     * ========================================================================
     * TRANSACTION STATUS
     * ========================================================================
     */

    status: {
      type: String,
      enum: TRANSACTION_STATUS,
      required: true,
      default: "PENDING",
      index: true,
    },

    statusReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    failureCode: {
      type: String,
      trim: true,
      maxlength: 100,
      set: (value) =>
        normalizeString(value, 100),
    },

    failureMessage: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    /**
     * ========================================================================
     * LIFECYCLE TIMESTAMPS
     * ========================================================================
     */

    processingStartedAt: {
      type: Date,
    },

    completedAt: {
      type: Date,
    },

    failedAt: {
      type: Date,
    },

    cancelledAt: {
      type: Date,
    },

    expiredAt: {
      type: Date,
    },

    reversedAt: {
      type: Date,
    },

    settledAt: {
      type: Date,
    },

    /**
     * ========================================================================
     * RETRY / RECOVERY
     * ========================================================================
     *
     * attempts:
     *   Total worker/provider processing claims.
     *
     * retryCount:
     *   Number of retries after the initial processing attempt.
     *
     * maxAttempts:
     *   Hard processing-attempt ceiling.
     */

    attempts: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: validateNonNegativeInteger,
        message:
          "Transaction attempts must be a non-negative safe integer.",
      },
    },

    retryCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: validateNonNegativeInteger,
        message:
          "Transaction retryCount must be a non-negative safe integer.",
      },
    },

    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 1
          );
        },
        message:
          "maxAttempts must be a positive safe integer.",
      },
    },

    nextAttemptAt: {
      type: Date,
      index: true,
    },

    lastAttemptAt: {
      type: Date,
    },

    lastErrorAt: {
      type: Date,
    },

    recoveryRequired: {
      type: Boolean,
      default: false,
      index: true,
    },

    recoveryCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: validateNonNegativeInteger,
        message:
          "recoveryCount must be a non-negative safe integer.",
      },
    },

    recoveryReason: {
      type: String,
      trim: true,
      maxlength: 500,
      set: (value) =>
        normalizeString(value, 500),
    },

    workerId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    processingLeaseExpiresAt: {
      type: Date,
      index: true,
    },

    /**
     * ========================================================================
     * RECONCILIATION
     * ========================================================================
     *
     * reconciliationStatus is canonical.
     *
     * DO NOT store a second boolean "reconciled" flag.
     * A virtual below provides backwards-compatible read semantics.
     */

    reconciliationStatus: {
      type: String,
      enum: RECONCILIATION_STATUS,
      default: "PENDING",
      index: true,
    },

    reconciledAt: {
      type: Date,
    },

    reconciledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    reconciliationReference: {
      type: String,
      trim: true,
      maxlength: 200,
      set: (value) =>
        normalizeString(value, 200),
    },

    reconciliationReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    /**
     * ========================================================================
     * ACCOUNTING / LEDGER
     * ========================================================================
     *
     * accountingStatus is canonical.
     *
     * DO NOT persist a second accountingPosted boolean.
     * A virtual below exposes accountingPosted for compatibility.
     */

    accountingStatus: {
      type: String,
      enum: ACCOUNTING_STATUS,
      default: "PENDING",
      index: true,
    },

    accountingPostedAt: {
      type: Date,
    },

    accountingFailureCode: {
      type: String,
      trim: true,
      maxlength: 100,
      set: (value) =>
        normalizeString(value, 100),
    },

    accountingFailureMessage: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    ledgerReference: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    ledgerEntryId: {
      type: Schema.Types.ObjectId,
      ref: "LedgerEntry",
      index: true,
    },

    /**
     * ========================================================================
     * SETTLEMENT
     * ========================================================================
     */

    settlementDate: {
      type: Date,
    },

    settlementReference: {
      type: String,
      trim: true,
      maxlength: 200,
      set: (value) =>
        normalizeString(value, 200),
    },

    settlementStatus: {
      type: String,
      enum: SETTLEMENT_STATUS,
      default: "PENDING",
      index: true,
    },

    /**
     * ========================================================================
     * REVERSAL
     * ========================================================================
     */

    reversalTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },

    reversedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },

    reversalReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    /**
     * ========================================================================
     * QUEUE / JOB / TRACE CORRELATION
     * ========================================================================
     */

    queueJobId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    queueName: {
      type: String,
      trim: true,
      maxlength: 200,
      set: (value) =>
        normalizeString(value, 200),
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    traceId: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
      set: (value) =>
        normalizeString(value, 200),
    },

    /**
     * ========================================================================
     * DESCRIPTION / METADATA
     * ========================================================================
     */

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },

    providerMetadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      immutable: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: {
      type: Date,
    },

    /**
     * ========================================================================
     * SOFT DELETE / ARCHIVAL
     * ========================================================================
     *
     * Financial records should normally never be physically deleted.
     *
     * Unique transaction identity is intentionally NOT tied to deletedAt.
     * This prevents an archived financial transaction from being recreated
     * under the same idempotency/provider identity.
     */

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      set: (value) =>
        normalizeString(value, 1000),
    },
  },
  {
    timestamps: true,

    versionKey: true,

    optimisticConcurrency: true,

    strict: true,

    minimize: false,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        if (ret._id) {
          ret.id = String(ret._id);
        }

        delete ret._id;
        delete ret.__v;
        delete ret.idempotencyFingerprint;

        return ret;
      },
    },

    toObject: {
      virtuals: true,
    },
  },
);

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

transactionSchema.virtual("isPending").get(
  function isPending() {
    return this.status === "PENDING";
  },
);

transactionSchema.virtual("isProcessing").get(
  function isProcessing() {
    return this.status === "PROCESSING";
  },
);

transactionSchema.virtual("isSuccessful").get(
  function isSuccessful() {
    return isSuccessfulStatus(this.status);
  },
);

transactionSchema.virtual("isFinancialTerminal").get(
  function isFinancialTerminal() {
    return isFinancialTerminalStatus(this.status);
  },
);

transactionSchema.virtual("isTerminal").get(
  function isTerminal() {
    return isBusinessTerminalStatus(this.status);
  },
);

transactionSchema.virtual("canRetry").get(
  function canRetry() {
    return (
      ["FAILED", "EXPIRED"].includes(this.status) &&
      Number(this.attempts || 0) <
        Number(this.maxAttempts || 5) &&
      (
        !this.nextAttemptAt ||
        this.nextAttemptAt <= new Date()
      )
    );
  },
);

transactionSchema.virtual("accountingPosted").get(
  function accountingPosted() {
    return this.accountingStatus === "POSTED";
  },
);

transactionSchema.virtual("reconciled").get(
  function reconciled() {
    return this.reconciliationStatus === "MATCHED";
  },
);

transactionSchema.virtual("requiresAccountingPosting").get(
  function requiresAccountingPosting() {
    return (
      this.isSuccessful &&
      !this.accountingPosted
    );
  },
);

transactionSchema.virtual("requiresReconciliation").get(
  function requiresReconciliation() {
    return (
      this.isSuccessful &&
      !["MATCHED", "NOT_REQUIRED"].includes(
        this.reconciliationStatus,
      )
    );
  },
);

transactionSchema.virtual("remainingAttempts").get(
  function remainingAttempts() {
    return Math.max(
      0,
      Number(this.maxAttempts || 5) -
        Number(this.attempts || 0),
    );
  },
);

/**
 * ============================================================================
 * DOCUMENT INITIALIZATION / ORIGINAL STATE SNAPSHOT
 * ============================================================================
 *
 * Allows save()-based state-transition enforcement even after a document has
 * been loaded from MongoDB.
 */

transactionSchema.post(
  "init",
  function captureOriginalTransactionState(doc) {
    doc.$locals = doc.$locals || {};
    doc.$locals.originalStatus = doc.status;
  },
);

transactionSchema.post(
  "save",
  function captureSavedTransactionState(doc) {
    doc.$locals = doc.$locals || {};
    doc.$locals.originalStatus = doc.status;
  },
);

/**
 * ============================================================================
 * PRE-VALIDATE
 * ============================================================================
 */

transactionSchema.pre(
  "validate",
  function validateTransaction(next) {
    try {
      const amount = Number(this.amount);
      const fees = Number(this.fees || 0);

      if (
        !validateNonNegativeFiniteNumber(amount) ||
        !Number.isSafeInteger(amount)
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Transaction amount must be a finite non-negative safe integer.",
          ),
        );
      }

      if (
        !validateNonNegativeFiniteNumber(fees) ||
        !Number.isSafeInteger(fees)
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Transaction fees must be a finite non-negative safe integer.",
          ),
        );
      }

      if (fees > amount) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Transaction fees cannot exceed transaction amount.",
          ),
        );
      }

      this.netAmount = amount - fees;

      if (!this.transactionReference) {
        this.transactionReference =
          `TXN-${new mongoose.Types.ObjectId()
            .toString()
            .toUpperCase()}`;
      }

      if (!this.currency) {
        this.currency = "UGX";
      }

      this.currency =
        normalizeUpperString(
          this.currency,
          3,
        );

      this.provider =
        normalizeLowerString(
          this.provider,
          50,
        ) || "internal";

      this.flow =
        normalizeLowerString(
          this.flow,
          20,
        );

      this.idempotencyKey =
        normalizeString(
          this.idempotencyKey,
          200,
        );

      this.idempotencyScope =
        normalizeString(
          this.idempotencyScope,
          300,
        ) || "default";

      /**
       * The transaction service remains responsible for generating a trusted
       * idempotency key. The model simply creates the final deterministic
       * identity fingerprint.
       */
      if (this.idempotencyKey) {
        this.idempotencyFingerprint =
          buildIdempotencyFingerprint({
            tenantId: this.tenantId,
            idempotencyScope:
              this.idempotencyScope,
            idempotencyKey:
              this.idempotencyKey,
          });
      } else {
        this.idempotencyFingerprint = undefined;
      }

      /**
       * Successful state must have a completion timestamp.
       */
      if (
        isSuccessfulStatus(this.status) &&
        !this.completedAt
      ) {
        this.completedAt = new Date();
      }

      /**
       * Reversed state must have reversal timestamp.
       */
      if (
        this.status === "REVERSED" &&
        !this.reversedAt
      ) {
        this.reversedAt = new Date();
      }

      /**
       * Settled state must have settlement metadata.
       */
      if (this.status === "SETTLED") {
        if (!this.settledAt) {
          this.settledAt = new Date();
        }

        this.settlementStatus = "SETTLED";
      }

      /**
       * Accounting state invariants.
       */
      if (this.accountingStatus === "POSTED") {
        if (!this.accountingPostedAt) {
          this.accountingPostedAt = new Date();
        }

        if (!this.ledgerReference) {
          throw new mongoose.Error.ValidationError(
            new Error(
              "POSTED accounting transactions require ledgerReference.",
            ),
          );
        }
      }

      if (
        this.accountingStatus === "NOT_REQUIRED" &&
        this.accountingPostedAt
      ) {
        this.accountingPostedAt = null;
      }

      /**
       * Reconciliation state invariants.
       */
      if (
        this.reconciliationStatus === "MATCHED" &&
        !this.reconciledAt
      ) {
        this.reconciledAt = new Date();
      }

      /**
       * A financial transaction reaching terminal success must not retain an
       * active processing lease.
       */
      if (
        isFinancialTerminalStatus(this.status)
      ) {
        this.processingLeaseExpiresAt = null;
      }

      /**
       * Attempts must never exceed maxAttempts.
       */
      if (
        Number(this.attempts || 0) >
        Number(this.maxAttempts || 5)
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Transaction attempts cannot exceed maxAttempts.",
          ),
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ============================================================================
 * PRE-SAVE FINANCIAL STATE PROTECTION
 * ============================================================================
 */

transactionSchema.pre(
  "save",
  function protectFinancialTransaction(next) {
    try {
      if (!this.isNew) {
        const originalStatus =
          this.$locals?.originalStatus;

        if (
          originalStatus &&
          originalStatus !== this.status
        ) {
          assertStatusTransition(
            originalStatus,
            this.status,
          );
        }

        const protectedFields = [
          "tenantId",
          "amount",
          "fees",
          "netAmount",
          "currency",
          "transactionType",
          "flow",
          "provider",
          "transactionReference",
          "idempotencyKey",
          "idempotencyScope",
          "idempotencyFingerprint",
        ];

        /**
         * Core financial identity becomes immutable after financial success.
         */
        if (
          originalStatus &&
          isFinancialTerminalStatus(
            originalStatus,
          )
        ) {
          for (const field of protectedFields) {
            if (this.isModified(field)) {
              throw new Error(
                `Financial field "${field}" cannot be modified after transaction reaches ${originalStatus}. Create a correction/reversal transaction instead.`,
              );
            }
          }
        }

        /**
         * A transaction cannot go backwards from a financial terminal status.
         */
        if (
          originalStatus &&
          isFinancialTerminalStatus(
            originalStatus,
          ) &&
          !isFinancialTerminalStatus(
            this.status,
          )
        ) {
          throw new Error(
            `Financial transaction cannot leave terminal state ${originalStatus}.`,
          );
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ============================================================================
 * PRE-UPDATE HARDENING
 * ============================================================================
 *
 * Financial fields should be changed through model/service methods rather than
 * arbitrary updateMany/updateOne operations.
 *
 * Mongoose's immutable option remains active, but this middleware explicitly
 * rejects attempts to alter the core financial identity.
 */

const BLOCKED_DIRECT_UPDATE_FIELDS = new Set([
  "tenantId",
  "amount",
  "fees",
  "netAmount",
  "currency",
  "transactionType",
  "flow",
  "provider",
  "transactionReference",
  "idempotencyKey",
  "idempotencyScope",
  "idempotencyFingerprint",
]);

function getUpdateObject(query) {
  return query.getUpdate() || {};
}

function inspectUpdatedFields(update) {
  const changed = new Set();

  for (const operator of [
    "$set",
    "$setOnInsert",
    "$inc",
    "$unset",
    "$push",
    "$addToSet",
    "$pull",
    "$pullAll",
  ]) {
    const block = update?.[operator];

    if (block && typeof block === "object") {
      for (const field of Object.keys(block)) {
        changed.add(field.split(".")[0]);
      }
    }
  }

  for (const field of Object.keys(update || {})) {
    if (!field.startsWith("$")) {
      changed.add(field.split(".")[0]);
    }
  }

  return changed;
}

for (const hookName of [
  "findOneAndUpdate",
  "updateOne",
  "updateMany",
]) {
  transactionSchema.pre(
    hookName,
    function protectDirectFinancialUpdates(next) {
      try {
        const update = getUpdateObject(this);
        const changedFields =
          inspectUpdatedFields(update);

        for (const field of changedFields) {
          if (
            BLOCKED_DIRECT_UPDATE_FIELDS.has(field)
          ) {
            throw new Error(
              `Direct update of financial field "${field}" is prohibited. Use the Transaction service/state-transition methods.`,
            );
          }
        }

        next();
      } catch (error) {
        next(error);
      }
    },
  );
}

/**
 * ============================================================================
 * HARD DELETE PROTECTION
 * ============================================================================
 *
 * Financial transactions must not be physically deleted through ordinary
 * application operations.
 */

for (const hookName of [
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findOneAndRemove",
  "remove",
]) {
  try {
    transactionSchema.pre(
      hookName,
      function preventHardDelete(next) {
        next(
          new Error(
            "Physical deletion of financial transactions is prohibited. Use the controlled soft-delete/archive workflow.",
          ),
        );
      },
    );
  } catch {
    /**
     * Mongoose versions may expose a different subset of legacy middleware
     * hooks. Unsupported hooks are intentionally ignored.
     */
  }
}

/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Claim this document for processing.
 *
 * Prefer the atomic static claimForProcessing() for worker concurrency.
 */
transactionSchema.methods.markProcessing =
  async function markProcessing(options = {}) {
    const {
      workerId,
      leaseExpiresAt,
      leaseMinutes = 15,
      session,
    } = options;

    if (
      !CLAIMABLE_STATUSES.includes(this.status)
    ) {
      throw new Error(
        `Transaction cannot move to PROCESSING from ${this.status}.`,
      );
    }

    const now = new Date();

    if (
      this.nextAttemptAt &&
      this.nextAttemptAt > now
    ) {
      throw new Error(
        "Transaction is not yet eligible for another processing attempt.",
      );
    }

    if (
      Number(this.attempts || 0) >=
      Number(this.maxAttempts || 5)
    ) {
      throw new Error(
        "Transaction has exhausted its maximum processing attempts.",
      );
    }

    assertStatusTransition(
      this.status,
      "PROCESSING",
    );

    const wasRetry =
      ["FAILED", "EXPIRED"].includes(
        this.status,
      );

    this.status = "PROCESSING";
    this.processingStartedAt = now;
    this.lastAttemptAt = now;

    this.attempts =
      Number(this.attempts || 0) + 1;

    if (wasRetry) {
      this.retryCount =
        Number(this.retryCount || 0) + 1;
    }

    this.nextAttemptAt = null;

    this.recoveryRequired = false;

    this.workerId =
      normalizeString(workerId, 200);

    this.processingLeaseExpiresAt =
      leaseExpiresAt
        ? normalizeDate(leaseExpiresAt)
        : getLeaseDate(
            now,
            leaseMinutes,
          );

    return this.save({
      session: getSession({ session }),
    });
  };

/**
 * Mark successful.
 *
 * This must only be reached from PROCESSING.
 */
transactionSchema.methods.markSuccessful =
  async function markSuccessful(options = {}) {
    assertStatusTransition(
      this.status,
      "SUCCESS",
    );

    const now = new Date();

    this.status = "SUCCESS";

    this.completedAt =
      options.completedAt
        ? normalizeDate(
            options.completedAt,
          )
        : now;

    this.processingLeaseExpiresAt = null;
    this.nextAttemptAt = null;
    this.recoveryRequired = false;
    this.workerId = null;

    this.reconciliationStatus = "PENDING";

    if (
      options.providerReferenceId != null
    ) {
      this.providerReferenceId =
        normalizeString(
          options.providerReferenceId,
          200,
        );
    }

    if (
      options.providerTransactionId != null
    ) {
      this.providerTransactionId =
        normalizeString(
          options.providerTransactionId,
          200,
        );
    }

    if (
      options.providerCorrelationId != null
    ) {
      this.providerCorrelationId =
        normalizeString(
          options.providerCorrelationId,
          200,
        );
    }

    if (options.statusReason != null) {
      this.statusReason =
        normalizeString(
          options.statusReason,
          1000,
        );
    }

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark failed.
 */
transactionSchema.methods.markFailed =
  async function markFailed(
    reason,
    options = {},
  ) {
    if (
      !["PENDING", "PROCESSING"].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Transaction cannot be marked FAILED from ${this.status}.`,
      );
    }

    assertStatusTransition(
      this.status,
      "FAILED",
    );

    const now = new Date();

    this.status = "FAILED";

    this.statusReason =
      normalizeString(
        reason ||
          "Transaction failed.",
        1000,
      );

    this.failureCode =
      normalizeString(
        options.failureCode,
        100,
      );

    this.failureMessage =
      normalizeString(
        options.failureMessage,
        1000,
      );

    this.failedAt = now;
    this.lastErrorAt = now;

    this.processingLeaseExpiresAt = null;
    this.workerId = null;

    /**
     * Caller/service controls the actual backoff schedule.
     */
    if (options.nextAttemptAt) {
      this.nextAttemptAt =
        normalizeDate(
          options.nextAttemptAt,
        );
    }

    /**
     * Explicitly request recovery when indicated by the provider/worker.
     */
    if (
      options.recoveryRequired === true
    ) {
      this.recoveryRequired = true;

      if (options.recoveryReason) {
        this.recoveryReason =
          normalizeString(
            options.recoveryReason,
            500,
          );
      }
    }

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Cancel.
 */
transactionSchema.methods.markCancelled =
  async function markCancelled(
    reason,
    options = {},
  ) {
    if (
      isSuccessfulStatus(this.status) ||
      this.status === "REVERSED"
    ) {
      throw new Error(
        "Successful/reversed transaction cannot be cancelled. Use a reversal/refund workflow.",
      );
    }

    assertStatusTransition(
      this.status,
      "CANCELLED",
    );

    const now = new Date();

    this.status = "CANCELLED";

    this.cancelledAt = now;

    this.statusReason =
      normalizeString(
        reason ||
          "Transaction cancelled.",
        1000,
      );

    this.processingLeaseExpiresAt = null;
    this.nextAttemptAt = null;
    this.workerId = null;

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Expire.
 */
transactionSchema.methods.markExpired =
  async function markExpired(
    reason,
    options = {},
  ) {
    if (
      isSuccessfulStatus(this.status) ||
      this.status === "REVERSED"
    ) {
      throw new Error(
        "Successful/reversed transaction cannot be expired.",
      );
    }

    assertStatusTransition(
      this.status,
      "EXPIRED",
    );

    const now = new Date();

    this.status = "EXPIRED";

    this.expiredAt = now;

    this.statusReason =
      normalizeString(
        reason ||
          "Transaction expired.",
        1000,
      );

    this.processingLeaseExpiresAt = null;
    this.workerId = null;

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark the original transaction reversed.
 *
 * The actual reversal transaction should already have been created and the
 * financial/ledger reversal must be coordinated by the financial service.
 */
transactionSchema.methods.markReversed =
  async function markReversed(
    reversalTransactionId,
    options = {},
  ) {
    if (
      !["SUCCESS", "SETTLED"].includes(
        this.status,
      )
    ) {
      throw new Error(
        "Only successful or settled transactions can be reversed.",
      );
    }

    if (!reversalTransactionId) {
      throw new Error(
        "reversalTransactionId is required.",
      );
    }

    assertStatusTransition(
      this.status,
      "REVERSED",
    );

    this.status = "REVERSED";

    this.reversedAt =
      options.reversedAt
        ? normalizeDate(
            options.reversedAt,
          )
        : new Date();

    this.reversalTransactionId =
      reversalTransactionId;

    this.reversalReason =
      normalizeString(
        options.reason ||
          "Transaction reversed.",
        1000,
      );

    this.processingLeaseExpiresAt = null;

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark reconciliation as matched.
 */
transactionSchema.methods.markReconciled =
  async function markReconciled(
    options = {},
  ) {
    if (
      !isSuccessfulStatus(this.status)
    ) {
      throw new Error(
        "Only successful or settled transactions can be reconciled.",
      );
    }

    if (
      this.reconciliationStatus === "MATCHED"
    ) {
      return this;
    }

    this.reconciliationStatus = "MATCHED";

    this.reconciledAt =
      options.reconciledAt
        ? normalizeDate(
            options.reconciledAt,
          )
        : new Date();

    this.reconciledBy =
      options.reconciledBy || null;

    this.reconciliationReference =
      normalizeString(
        options.reference,
        200,
      );

    this.reconciliationReason =
      normalizeString(
        options.reason,
        1000,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark reconciliation mismatch.
 */
transactionSchema.methods.markReconciliationMismatch =
  async function markReconciliationMismatch(
    reason,
    options = {},
  ) {
    if (
      !isSuccessfulStatus(this.status)
    ) {
      throw new Error(
        "Only successful or settled transactions can enter reconciliation mismatch.",
      );
    }

    this.reconciliationStatus = "MISMATCH";

    this.reconciliationReason =
      normalizeString(
        reason ||
          "Transaction reconciliation mismatch.",
        1000,
      );

    this.reconciliationReference =
      normalizeString(
        options.reference,
        200,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark reconciliation exception.
 */
transactionSchema.methods.markReconciliationException =
  async function markReconciliationException(
    reason,
    options = {},
  ) {
    this.reconciliationStatus = "EXCEPTION";

    this.reconciliationReason =
      normalizeString(
        reason ||
          "Reconciliation exception.",
        1000,
      );

    this.reconciliationReference =
      normalizeString(
        options.reference,
        200,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Start accounting posting.
 */
transactionSchema.methods.startAccountingPosting =
  async function startAccountingPosting(
    options = {},
  ) {
    if (
      !isSuccessfulStatus(this.status)
    ) {
      throw new Error(
        "Only successful or settled transactions can enter accounting posting.",
      );
    }

    if (
      this.accountingStatus === "POSTED"
    ) {
      return this;
    }

    if (
      this.accountingStatus ===
      "REVERSED"
    ) {
      throw new Error(
        "A reversed accounting record cannot enter normal posting.",
      );
    }

    this.accountingStatus = "POSTING";

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark accounting as posted.
 */
transactionSchema.methods.markAccountingPosted =
  async function markAccountingPosted(
    ledgerReference,
    options = {},
  ) {
    if (
      !isSuccessfulStatus(this.status)
    ) {
      throw new Error(
        "Only successful or settled transactions can be posted to accounting.",
      );
    }

    const reference =
      normalizeString(
        ledgerReference,
        200,
      );

    if (!reference) {
      throw new Error(
        "ledgerReference is required when posting accounting.",
      );
    }

    if (
      this.accountingStatus === "POSTED"
    ) {
      if (
        this.ledgerReference !==
        reference
      ) {
        throw new Error(
          "Transaction is already posted to a different ledger reference.",
        );
      }

      return this;
    }

    if (
      this.accountingStatus ===
      "REVERSED"
    ) {
      throw new Error(
        "A reversed accounting record cannot be posted again.",
      );
    }

    this.accountingStatus = "POSTED";

    this.accountingPostedAt =
      options.accountingPostedAt
        ? normalizeDate(
            options.accountingPostedAt,
          )
        : new Date();

    this.ledgerReference = reference;

    if (options.ledgerEntryId) {
      this.ledgerEntryId =
        options.ledgerEntryId;
    }

    this.accountingFailureCode = null;
    this.accountingFailureMessage = null;

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark accounting posting failure.
 */
transactionSchema.methods.markAccountingFailed =
  async function markAccountingFailed(
    code,
    message,
    options = {},
  ) {
    this.accountingStatus = "FAILED";

    this.accountingFailureCode =
      normalizeString(code, 100);

    this.accountingFailureMessage =
      normalizeString(
        message,
        1000,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark accounting reversal.
 */
transactionSchema.methods.markAccountingReversed =
  async function markAccountingReversed(
    options = {},
  ) {
    if (
      this.accountingStatus !== "POSTED"
    ) {
      throw new Error(
        "Only posted accounting records can be marked reversed.",
      );
    }

    this.accountingStatus = "REVERSED";

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark settlement.
 */
transactionSchema.methods.markSettled =
  async function markSettled(options = {}) {
    assertStatusTransition(
      this.status,
      "SETTLED",
    );

    if (
      this.accountingStatus === "FAILED"
    ) {
      throw new Error(
        "A transaction with failed accounting posting should not be settled until accounting is resolved.",
      );
    }

    this.status = "SETTLED";

    this.settledAt =
      options.settlementDate
        ? normalizeDate(
            options.settlementDate,
          )
        : new Date();

    this.settlementStatus = "SETTLED";

    this.settlementDate =
      options.settlementDate
        ? normalizeDate(
            options.settlementDate,
          )
        : this.settlementDate;

    this.settlementReference =
      normalizeString(
        options.settlementReference,
        200,
      );

    this.settlementId =
      normalizeString(
        options.settlementId,
        200,
      ) || this.settlementId;

    this.processingLeaseExpiresAt = null;

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark settlement failed.
 */
transactionSchema.methods.markSettlementFailed =
  async function markSettlementFailed(
    reason,
    options = {},
  ) {
    if (
      !isSuccessfulStatus(this.status)
    ) {
      throw new Error(
        "Only successful or settled transactions can have settlement failure recorded.",
      );
    }

    this.settlementStatus = "FAILED";

    this.statusReason =
      normalizeString(
        reason ||
          "Settlement failed.",
        1000,
      );

    this.settlementReference =
      normalizeString(
        options.settlementReference,
        200,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Mark settlement disputed.
 */
transactionSchema.methods.markSettlementDisputed =
  async function markSettlementDisputed(
    reason,
    options = {},
  ) {
    this.settlementStatus = "DISPUTED";

    this.statusReason =
      normalizeString(
        reason ||
          "Settlement disputed.",
        1000,
      );

    this.settlementReference =
      normalizeString(
        options.settlementReference,
        200,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Request recovery.
 */
transactionSchema.methods.requestRecovery =
  async function requestRecovery(
    reason,
    options = {},
  ) {
    this.recoveryRequired = true;

    this.recoveryCount =
      Number(this.recoveryCount || 0) + 1;

    this.recoveryReason =
      normalizeString(
        reason ||
          "Transaction requires recovery.",
        500,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Extend an active processing lease.
 */
transactionSchema.methods.extendProcessingLease =
  async function extendProcessingLease(
    leaseMinutes = 15,
    options = {},
  ) {
    if (
      this.status !== "PROCESSING"
    ) {
      throw new Error(
        "Only PROCESSING transactions can have a processing lease extended.",
      );
    }

    this.processingLeaseExpiresAt =
      getLeaseDate(
        new Date(),
        leaseMinutes,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * Controlled soft deletion / archival.
 */
transactionSchema.methods.softDelete =
  async function softDelete(
    deletedBy,
    reason,
    options = {},
  ) {
    if (this.deletedAt) {
      return this;
    }

    if (
      !deletedBy ||
      !mongoose.isValidObjectId(deletedBy)
    ) {
      throw new Error(
        "A valid deletedBy user ID is required for financial transaction archival.",
      );
    }

    this.deletedAt = new Date();
    this.deletedBy = deletedBy;

    this.deletionReason =
      normalizeString(
        reason ||
          "Financial transaction archived.",
        1000,
      );

    return this.save({
      session: getSession(options),
    });
  };

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

transactionSchema.statics.buildIdempotencyFingerprint =
  function buildFingerprint(
    tenantId,
    idempotencyScope,
    idempotencyKey,
  ) {
    return buildIdempotencyFingerprint({
      tenantId,
      idempotencyScope:
        idempotencyScope || "default",
      idempotencyKey,
    });
  };

/**
 * ============================================================================
 * STATIC FINDERS
 * ============================================================================
 */

transactionSchema.statics.findByExternalId =
  function findByExternalId(
    externalId,
    tenantId,
    options = {},
  ) {
    const normalized =
      normalizeString(
        externalId,
        200,
      );

    if (!normalized) {
      return null;
    }

    const query = {
      externalId: normalized,
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.findOne(query);
  };

transactionSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey(
    idempotencyKey,
    tenantId,
    idempotencyScope = "default",
    options = {},
  ) {
    const normalizedKey =
      normalizeString(
        idempotencyKey,
        200,
      );

    if (!normalizedKey) {
      return null;
    }

    const query = {
      idempotencyKey: normalizedKey,
      idempotencyScope:
        normalizeString(
          idempotencyScope,
          300,
        ) || "default",
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.findOne(query).select(
      "+idempotencyFingerprint",
    );
  };

transactionSchema.statics.findByTransactionReference =
  function findByTransactionReference(
    transactionReference,
    tenantId,
    options = {},
  ) {
    const normalized =
      normalizeUpperString(
        transactionReference,
        100,
      );

    if (!normalized) {
      return null;
    }

    const query = {
      transactionReference: normalized,
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.findOne(query);
  };

transactionSchema.statics.findByProviderReference =
  function findByProviderReference(
    providerReferenceId,
    provider,
    tenantId,
    options = {},
  ) {
    const reference =
      normalizeString(
        providerReferenceId,
        200,
      );

    if (!reference) {
      return null;
    }

    const query = {
      providerReferenceId: reference,
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    if (provider) {
      query.provider =
        normalizeLowerString(
          provider,
          50,
        );
    }

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.findOne(query);
  };

transactionSchema.statics.findByProviderTransactionId =
  function findByProviderTransactionId(
    providerTransactionId,
    provider,
    tenantId,
    options = {},
  ) {
    const normalized =
      normalizeString(
        providerTransactionId,
        200,
      );

    if (!normalized) {
      return null;
    }

    const query = {
      providerTransactionId: normalized,
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    if (provider) {
      query.provider =
        normalizeLowerString(
          provider,
          50,
        );
    }

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.findOne(query);
  };

transactionSchema.statics.findPending =
  function findPending(
    tenantId,
  ) {
    const query = {
      status: "PENDING",
      deletedAt: null,
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      createdAt: 1,
      _id: 1,
    });
  };

transactionSchema.statics.findProcessing =
  function findProcessing(
    tenantId,
  ) {
    const query = {
      status: "PROCESSING",
      deletedAt: null,
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      processingStartedAt: 1,
      _id: 1,
    });
  };

transactionSchema.statics.findUnreconciled =
  function findUnreconciled(
    tenantId,
  ) {
    const query = {
      reconciliationStatus: {
        $in: [
          "PENDING",
          "MISMATCH",
          "EXCEPTION",
        ],
      },
      deletedAt: null,
      status: {
        $in: [
          "SUCCESS",
          "SETTLED",
        ],
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      completedAt: 1,
      createdAt: 1,
      _id: 1,
    });
  };

transactionSchema.statics.findUnpostedAccounting =
  function findUnpostedAccounting(
    tenantId,
  ) {
    const query = {
      accountingStatus: {
        $in: [
          "PENDING",
          "POSTING",
          "FAILED",
        ],
      },
      deletedAt: null,
      status: {
        $in: [
          "SUCCESS",
          "SETTLED",
        ],
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      completedAt: 1,
      createdAt: 1,
      _id: 1,
    });
  };

transactionSchema.statics.findRecoverable =
  function findRecoverable(
    tenantId,
  ) {
    const now = new Date();

    const query = {
      deletedAt: null,

      status: {
        $in: CLAIMABLE_STATUSES,
      },

      $or: [
        {
          nextAttemptAt: {
            $exists: false,
          },
        },
        {
          nextAttemptAt: {
            $lte: now,
          },
        },
        {
          nextAttemptAt: null,
        },
      ],

      $expr: {
        $lt: [
          {
            $ifNull: [
              "$attempts",
              0,
            ],
          },
          {
            $ifNull: [
              "$maxAttempts",
              5,
            ],
          },
        ],
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      nextAttemptAt: 1,
      createdAt: 1,
      _id: 1,
    });
  };

/**
 * Find stale PROCESSING transactions whose lease expired.
 */
transactionSchema.statics.findStaleProcessing =
  function findStaleProcessing(
    tenantId,
  ) {
    const now = new Date();

    const query = {
      status: "PROCESSING",
      deletedAt: null,
      processingLeaseExpiresAt: {
        $lte: now,
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    return this.find(query).sort({
      processingLeaseExpiresAt: 1,
      processingStartedAt: 1,
      _id: 1,
    });
  };

/**
 * ============================================================================
 * ATOMIC PROCESSING CLAIM
 * ============================================================================
 *
 * Multiple workers may attempt the same transaction.
 *
 * MongoDB performs the find-and-update atomically, meaning only one matching
 * worker receives the claimed record.
 */

transactionSchema.statics.claimForProcessing =
  async function claimForProcessing(
    transactionId,
    tenantId,
    options = {},
  ) {
    const now = new Date();

    if (!transactionId) {
      throw new Error(
        "transactionId is required.",
      );
    }

    const query = {
      _id: transactionId,

      status: {
        $in: CLAIMABLE_STATUSES,
      },

      deletedAt: null,

      $or: [
        {
          nextAttemptAt: {
            $exists: false,
          },
        },
        {
          nextAttemptAt: {
            $lte: now,
          },
        },
        {
          nextAttemptAt: null,
        },
      ],

      $expr: {
        $lt: [
          {
            $ifNull: [
              "$attempts",
              0,
            ],
          },
          {
            $ifNull: [
              "$maxAttempts",
              5,
            ],
          },
        ],
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    const leaseExpiresAt =
      options.leaseExpiresAt
        ? normalizeDate(
            options.leaseExpiresAt,
          )
        : getLeaseDate(
            now,
            options.leaseMinutes || 15,
          );

    const result =
      await this.findOneAndUpdate(
        query,
        {
          $set: {
            status: "PROCESSING",

            processingStartedAt: now,

            processingLeaseExpiresAt:
              leaseExpiresAt,

            lastAttemptAt: now,

            nextAttemptAt: null,

            workerId:
              normalizeString(
                options.workerId,
                200,
              ),

            updatedBy:
              options.updatedBy || null,

            recoveryRequired: false,
          },

          $inc: {
            attempts: 1,
          },
        },
        {
          returnDocument: "after",
          runValidators: true,
          session: options.session,
        },
      );

    /**
     * Important:
     * retryCount cannot reliably be incremented in this same update with the
     * old status unless we explicitly branch. That is why retryCount is
     * normalized below using the original classification when necessary.
     *
     * For atomic claims, attempts is authoritative. RetryCount remains an
     * informational counter and can be synchronized by the service when the
     * previous state was FAILED/EXPIRED.
     */
    if (
      result &&
      ["FAILED", "EXPIRED"].includes(
        result.$locals?.claimedFromStatus,
      )
    ) {
      /**
       * Normally unavailable because atomic update does not expose prior state.
       * The service can maintain retryCount explicitly when it owns the claim.
       */
    }

    return result;
  };

/**
 * ============================================================================
 * ATOMIC STALE PROCESSING CLAIM
 * ============================================================================
 *
 * A stale PROCESSING transaction is dangerous.
 *
 * The worker MUST reconcile provider state before blindly resubmitting a
 * financial request because the original provider operation may have succeeded
 * while the local process/response was lost.
 */

transactionSchema.statics.claimStaleProcessing =
  async function claimStaleProcessing(
    transactionId,
    tenantId,
    options = {},
  ) {
    const now = new Date();

    if (!transactionId) {
      throw new Error(
        "transactionId is required.",
      );
    }

    const query = {
      _id: transactionId,

      status: "PROCESSING",

      deletedAt: null,

      processingLeaseExpiresAt: {
        $lte: now,
      },
    };

    if (tenantId) {
      query.tenantId = tenantId;
    }

    const leaseExpiresAt =
      options.leaseExpiresAt
        ? normalizeDate(
            options.leaseExpiresAt,
          )
        : getLeaseDate(
            now,
            options.leaseMinutes || 15,
          );

    return this.findOneAndUpdate(
      query,
      {
        $set: {
          processingLeaseExpiresAt:
            leaseExpiresAt,

          processingStartedAt: now,

          workerId:
            normalizeString(
              options.workerId,
              200,
            ),

          recoveryRequired: true,

          recoveryReason:
            normalizeString(
              options.recoveryReason ||
                "Processing lease expired; provider state requires recovery verification.",
              500,
            ),

          updatedBy:
            options.updatedBy || null,
        },

        $inc: {
          recoveryCount: 1,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
        session: options.session,
      },
    );
  };

/**
 * ============================================================================
 * ATOMIC IDEMPOTENT CREATE
 * ============================================================================
 *
 * Database uniqueness remains the final concurrency guard.
 *
 * The model additionally validates that the replay has the same immutable
 * financial/business meaning.
 */

transactionSchema.statics.createIdempotent =
  async function createIdempotent(
    payload,
    options = {},
  ) {
    if (!payload || typeof payload !== "object") {
      throw new TypeError(
        "Transaction payload is required.",
      );
    }

    const tenantId =
      payload.tenantId;

    if (!tenantId) {
      throw new Error(
        "tenantId is required for idempotent transaction creation.",
      );
    }

    const normalizedPayload = {
      ...payload,

      idempotencyScope:
        normalizeString(
          payload.idempotencyScope,
          300,
        ) || "default",
    };

    if (
      normalizedPayload.idempotencyKey
    ) {
      normalizedPayload.idempotencyFingerprint =
        buildIdempotencyFingerprint({
          tenantId,
          idempotencyScope:
            normalizedPayload.idempotencyScope,
          idempotencyKey:
            normalizedPayload.idempotencyKey,
        });
    }

    /**
     * Fast path before creation.
     *
     * includeDeleted intentionally remains true so an archived financial
     * identity cannot accidentally become a second transaction.
     */
    if (
      normalizedPayload.idempotencyKey
    ) {
      const existing =
        await this.findOne({
          tenantId,
          idempotencyKey:
            normalizedPayload.idempotencyKey,
          idempotencyScope:
            normalizedPayload.idempotencyScope,
        }).select(
          "+idempotencyFingerprint",
        );

      if (existing) {
        return assertIdempotentPayloadMatches(
          existing,
          normalizedPayload,
        );
      }
    }

    try {
      return await this.create(
        [normalizedPayload],
        {
          session: options.session,
        },
      ).then(([transaction]) =>
        transaction,
      );
    } catch (error) {
      if (
        error?.code !== 11000
      ) {
        throw error;
      }

      /**
       * Re-read by every supported unique identity.
       *
       * This is intentionally not limited to deletedAt:null.
       */
      const candidates = [];

      if (
        normalizedPayload.tenantId &&
        normalizedPayload.idempotencyKey
      ) {
        candidates.push({
          tenantId:
            normalizedPayload.tenantId,
          idempotencyKey:
            normalizedPayload.idempotencyKey,
          idempotencyScope:
            normalizedPayload.idempotencyScope,
        });
      }

      if (
        normalizedPayload.tenantId &&
        normalizedPayload.externalId
      ) {
        candidates.push({
          tenantId:
            normalizedPayload.tenantId,
          externalId:
            normalizeString(
              normalizedPayload.externalId,
              200,
            ),
        });
      }

      if (
        normalizedPayload.tenantId &&
        normalizedPayload.provider &&
        normalizedPayload.providerTransactionId
      ) {
        candidates.push({
          tenantId:
            normalizedPayload.tenantId,
          provider:
            normalizeLowerString(
              normalizedPayload.provider,
              50,
            ),
          providerTransactionId:
            normalizeString(
              normalizedPayload.providerTransactionId,
              200,
            ),
        });
      }

      if (
        normalizedPayload.tenantId &&
        normalizedPayload.provider &&
        normalizedPayload.providerReferenceId
      ) {
        candidates.push({
          tenantId:
            normalizedPayload.tenantId,
          provider:
            normalizeLowerString(
              normalizedPayload.provider,
              50,
            ),
          providerReferenceId:
            normalizeString(
              normalizedPayload.providerReferenceId,
              200,
            ),
        });
      }

      if (
        normalizedPayload.tenantId &&
        normalizedPayload.transactionReference
      ) {
        candidates.push({
          tenantId:
            normalizedPayload.tenantId,
          transactionReference:
            normalizeUpperString(
              normalizedPayload.transactionReference,
              100,
            ),
        });
      }

      for (const candidate of candidates) {
        const existing =
          await this.findOne(candidate).select(
            "+idempotencyFingerprint",
          );

        if (existing) {
          /**
           * Only idempotency replays should be considered automatically
           * idempotent. A provider identity collision with materially different
           * business data must be surfaced to the service.
           */
          if (
            candidate.idempotencyKey
          ) {
            return assertIdempotentPayloadMatches(
              existing,
              normalizedPayload,
            );
          }

          return existing;
        }
      }

      throw error;
    }
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 *
 * NOTE:
 * The database may already contain legacy indexes from the previous version.
 * Run the repository's controlled index migration/sync procedure during
 * deployment. Do not casually drop production financial indexes.
 */

/**
 * Tenant + immutable transaction reference.
 */
transactionSchema.index(
  {
    tenantId: 1,
    transactionReference: 1,
  },
  {
    unique: true,
    name: "uq_transaction_tenant_reference",
  },
);

/**
 * Strong scoped idempotency identity.
 *
 * This replaces the old:
 *   tenantId + idempotencyKey
 *
 * uniqueness model.
 */
transactionSchema.index(
  {
    tenantId: 1,
    idempotencyScope: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_transaction_tenant_idempotency_scope",
  },
);

/**
 * Deterministic fingerprint.
 *
 * Retained as an additional collision-resistant lookup/diagnostic identity.
 */
transactionSchema.index(
  {
    tenantId: 1,
    idempotencyFingerprint: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_transaction_idempotency_fingerprint",
  },
);

/**
 * Tenant-scoped provider external identity.
 */
transactionSchema.index(
  {
    tenantId: 1,
    externalId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_transaction_tenant_external_id",
  },
);

/**
 * Provider transaction identity.
 */
transactionSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerTransactionId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_transaction_provider_transaction",
  },
);

/**
 * Provider reference identity.
 */
transactionSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerReferenceId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_transaction_provider_reference",
  },
);

/**
 * Main operational queue index.
 */
transactionSchema.index({
  tenantId: 1,
  status: 1,
  nextAttemptAt: 1,
  createdAt: 1,
});

/**
 * Processing lease recovery.
 */
transactionSchema.index({
  tenantId: 1,
  status: 1,
  processingLeaseExpiresAt: 1,
});

/**
 * Accounting operations.
 */
transactionSchema.index({
  tenantId: 1,
  accountingStatus: 1,
  status: 1,
  completedAt: 1,
});

/**
 * Reconciliation operations.
 */
transactionSchema.index({
  tenantId: 1,
  reconciliationStatus: 1,
  status: 1,
  completedAt: 1,
});

/**
 * User transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
});

/**
 * Group transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  groupId: 1,
  createdAt: -1,
});

/**
 * Loan transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  loanId: 1,
  createdAt: -1,
});

/**
 * Contribution transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  contributionId: 1,
  createdAt: -1,
});

/**
 * Savings transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  savingsId: 1,
  createdAt: -1,
});

/**
 * Account transaction history.
 */
transactionSchema.index({
  tenantId: 1,
  accountId: 1,
  createdAt: -1,
});

/**
 * Provider operational monitoring.
 */
transactionSchema.index({
  tenantId: 1,
  provider: 1,
  status: 1,
  createdAt: -1,
});

/**
 * Correlation / tracing.
 */
transactionSchema.index({
  tenantId: 1,
  correlationId: 1,
  createdAt: -1,
});

/**
 * Queue worker monitoring.
 */
transactionSchema.index({
  tenantId: 1,
  queueName: 1,
  queueJobId: 1,
});

/**
 * Recovery queue.
 */
transactionSchema.index({
  tenantId: 1,
  recoveryRequired: 1,
  status: 1,
  nextAttemptAt: 1,
});

/**
 * Global chronological reporting.
 */
transactionSchema.index({
  createdAt: -1,
});

/**
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Transaction =
  mongoose.models.Transaction ||
  mongoose.model(
    "Transaction",
    transactionSchema,
  );

/**
 * ============================================================================
 * NAMED EXPORTS
 * ============================================================================
 */

export {
  Transaction,
  transactionSchema,
};

export default Transaction;