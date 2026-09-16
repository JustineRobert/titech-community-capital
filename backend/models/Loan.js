// ============================================================================
// backend/models/Loan.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Loan Domain Model
//
// PURPOSE
// ----------------------------------------------------------------------------
// Authoritative business-domain record for a loan.
//
// IMPORTANT DOMAIN SEPARATION
// ----------------------------------------------------------------------------
// Loan != Transaction != LedgerEntry != Balance
//
// This model owns the loan lifecycle, credit decision, repayment schedule,
// risk/compliance state, portfolio metrics and operational references.
//
// Actual monetary movement MUST be represented by Transaction records and
// posted through the authoritative FinancialTransactionService / Ledger
// subsystem.
//
// GOLDEN MONEY PATH
// ----------------------------------------------------------------------------
// Loan Application
//   -> Credit Decision
//   -> Approval
//   -> Disbursement Transaction
//   -> Ledger
//   -> Balance
//   -> Repayment Transaction
//   -> Ledger
//   -> Balance
//   -> Reconciliation
//
// DESIGN GOALS
// ----------------------------------------------------------------------------
// - ESM / Node.js compatibility
// - Multi-tenant isolation
// - Explicit loan workflow state machine
// - Financial field protection
// - Installment integrity
// - Repayment consistency
// - Risk / fraud controls
// - KYC / AML readiness
// - Guarantor controls
// - Collection / recovery support
// - Restructuring / write-off support
// - Auditability
// - Optimistic concurrency
// - Controlled soft deletion/archive
//
// ============================================================================

"use strict";

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

export const LOAN_STATUS = Object.freeze([
  "draft",
  "pending",
  "credit_review",
  "manual_review",
  "approved",
  "disbursed",
  "active",
  "completed",
  "rejected",
  "cancelled",
  "defaulted",
  "written_off",
  "recovered",
  "restructured",
]);

export const LOAN_PURPOSE = Object.freeze([
  "PERSONAL",
  "BUSINESS",
  "AGRICULTURE",
  "EDUCATION",
  "MEDICAL",
  "EMERGENCY",
  "HOUSING",
  "OTHER",
]);

export const CREDIT_DECISION = Object.freeze([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MANUAL_REVIEW",
]);

export const GUARANTOR_STATUS = Object.freeze([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const DISBURSEMENT_METHOD = Object.freeze([
  "BANK_TRANSFER",
  "MTN_MOMO",
  "AIRTEL_MONEY",
  "CASH",
]);

export const PAR_BUCKET = Object.freeze([
  "current",
  "PAR30",
  "PAR60",
  "PAR90",
]);

export const PORTFOLIO_SEGMENT = Object.freeze([
  "LOW_RISK",
  "MEDIUM_RISK",
  "HIGH_RISK",
]);

/**
 * ============================================================================
 * LOAN STATE MACHINE
 * ============================================================================
 *
 * Valid lifecycle:
 *
 * draft
 *   -> pending
 *
 * pending
 *   -> credit_review
 *   -> manual_review
 *   -> rejected
 *   -> cancelled
 *
 * credit_review
 *   -> approved
 *   -> manual_review
 *   -> rejected
 *   -> cancelled
 *
 * manual_review
 *   -> approved
 *   -> rejected
 *   -> cancelled
 *
 * approved
 *   -> disbursed
 *   -> cancelled
 *
 * disbursed
 *   -> active
 *   -> completed
 *   -> defaulted
 *   -> restructured
 *   -> written_off
 *
 * active
 *   -> completed
 *   -> defaulted
 *   -> restructured
 *   -> written_off
 *
 * defaulted
 *   -> active
 *   -> recovered
 *   -> restructured
 *   -> written_off
 *
 * restructured
 *   -> active
 *   -> completed
 *   -> defaulted
 *   -> written_off
 *
 * written_off
 *   -> recovered
 *
 * completed
 *   -> terminal
 *
 * rejected
 *   -> terminal
 *
 * cancelled
 *   -> terminal
 *
 * recovered
 *   -> terminal
 *
 * ============================================================================

 * NOTE
 * ----------------------------------------------------------------------------
 * A disbursement transaction should NOT be inferred solely from status.
 * Status represents business workflow; Transaction/Ledger represents money.
 */

export const ALLOWED_LOAN_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze([
    "pending",
    "cancelled",
  ]),

  pending: Object.freeze([
    "credit_review",
    "manual_review",
    "approved",
    "rejected",
    "cancelled",
  ]),

  credit_review: Object.freeze([
    "approved",
    "manual_review",
    "rejected",
    "cancelled",
  ]),

  manual_review: Object.freeze([
    "approved",
    "rejected",
    "cancelled",
  ]),

  approved: Object.freeze([
    "disbursed",
    "cancelled",
  ]),

  disbursed: Object.freeze([
    "active",
    "completed",
    "defaulted",
    "restructured",
    "written_off",
  ]),

  active: Object.freeze([
    "completed",
    "defaulted",
    "restructured",
    "written_off",
  ]),

  completed: Object.freeze([]),

  rejected: Object.freeze([]),

  cancelled: Object.freeze([]),

  defaulted: Object.freeze([
    "active",
    "recovered",
    "restructured",
    "written_off",
  ]),

  written_off: Object.freeze([
    "recovered",
  ]),

  recovered: Object.freeze([]),

  restructured: Object.freeze([
    "active",
    "completed",
    "defaulted",
    "written_off",
  ]),
});

const TERMINAL_LOAN_STATUSES = Object.freeze([
  "completed",
  "rejected",
  "cancelled",
  "recovered",
]);

const FINANCIAL_LOCKED_STATUSES = Object.freeze([
  "approved",
  "disbursed",
  "active",
  "completed",
  "defaulted",
  "written_off",
  "recovered",
  "restructured",
]);

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function normalizeString(value, maxLength = 500) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeUpperString(value, maxLength = 100) {
  const normalized = normalizeString(value, maxLength);

  return normalized
    ? normalized.toUpperCase()
    : null;
}

function isValidNonNegativeNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

function isValidPositiveNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

function isValidScore(value) {
  if (value == null) {
    return true;
  }

  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function normalizeDate(value) {
  if (value == null) {
    return null;
  }

  const result =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(result.getTime())) {
    throw new TypeError(
      "Invalid date supplied.",
    );
  }

  return result;
}

function assertLoanStatusTransition(
  currentStatus,
  nextStatus,
) {
  if (currentStatus === nextStatus) {
    throw new Error(
      `Loan is already in ${currentStatus} status.`,
    );
  }

  const allowed =
    ALLOWED_LOAN_STATUS_TRANSITIONS[
      currentStatus
    ];

  if (
    !allowed ||
    !allowed.includes(nextStatus)
  ) {
    throw new Error(
      `Invalid loan status transition: ${currentStatus} -> ${nextStatus}.`,
    );
  }
}

function getSession(options = {}) {
  return options?.session || undefined;
}

/**
 * ============================================================================
 * INSTALLMENT SCHEMA
 * ============================================================================
 *
 * Installments are embedded schedule records.
 *
 * Monetary values are kept as safe integers for compatibility with the
 * existing system. The authoritative financial service should use the same
 * canonical money representation as Transaction/Ledger.
 */

const InstallmentSchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator(value) {
          return isValidPositiveNumber(value);
        },
        message:
          "Installment amount must be a positive safe integer.",
      },
    },

    dueDate: {
      type: Date,
      required: true,
    },

    paid: {
      type: Boolean,
      default: false,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Installment amountPaid must be a non-negative safe integer.",
      },
    },

    daysPastDue: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 0
          );
        },
        message:
          "Installment daysPastDue must be a non-negative integer.",
      },
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * NOTIFICATION SCHEMA
 * ============================================================================
 */

const NotificationSchema = new Schema(
  {
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * GUARANTOR SCHEMA
 * ============================================================================
 */

const GuarantorSchema = new Schema(
  {
    member: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },

    guaranteeAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Guarantee amount must be a non-negative safe integer.",
      },
    },

    status: {
      type: String,
      enum: GUARANTOR_STATUS,
      default: "PENDING",
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    guarantorApprovedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
);

/**
 * ============================================================================
 * LOAN SCHEMA
 * ============================================================================
 */

const LoanSchema = new Schema(
  {
    /**
     * ========================================================================
     * MULTI-TENANCY
     * ========================================================================
     *
     * Keep tenantId as String for compatibility with the existing deployment.
     *
     * IMPORTANT:
     * tenantId must always be supplied by trusted server-side tenant context.
     */

    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 100,
      index: true,
      set: (value) =>
        normalizeString(value, 100),
    },

    /**
     * ========================================================================
     * RELATIONSHIPS
     * ========================================================================
     */

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    member: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      default: null,
      index: true,
    },

    group: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * ========================================================================
     * LOAN PURPOSE
     * ========================================================================
     */

    purpose: {
      type: String,
      enum: LOAN_PURPOSE,
      default: "PERSONAL",
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 300,
    },

    /**
     * ========================================================================
     * LOAN OFFICER
     * ========================================================================
     */

    loanOfficer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    /**
     * ========================================================================
     * CREDIT DECISION
     * ========================================================================
     */

    creditDecision: {
      type: String,
      enum: CREDIT_DECISION,
      default: "PENDING",
      index: true,
    },

    creditDecisionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    creditDecisionDate: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * MANUAL REVIEW
     * ========================================================================
     */

    reviewRequestedAt: {
      type: Date,
      default: null,
    },

    reviewRequestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewCompletedAt: {
      type: Date,
      default: null,
    },

    reviewNotes: {
      type: String,
      trim: true,
      maxlength: 3000,
    },

    /**
     * ========================================================================
     * GUARANTORS
     * ========================================================================
     */

    guarantors: {
      type: [GuarantorSchema],
      default: [],
    },

    /**
     * ========================================================================
     * LOAN TERMS
     * ========================================================================
     */

    amount: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator(value) {
          return isValidPositiveNumber(value);
        },
        message:
          "Loan amount must be a positive safe integer.",
      },
    },

    interestRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      immutable: true,
      validate: {
        validator(value) {
          return (
            typeof value === "number" &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= 100
          );
        },
        message:
          "Interest rate must be between 0 and 100.",
      },
    },

    repaymentPeriodMonths: {
      type: Number,
      default: 6,
      min: 1,
      immutable: true,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 1 &&
            value <= 120
          );
        },
        message:
          "Repayment period must be between 1 and 120 months.",
      },
    },

    repaymentDate: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * LOAN WORKFLOW
     * ========================================================================
     */

    status: {
      type: String,
      enum: LOAN_STATUS,
      default: "pending",
      index: true,
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /**
     * ========================================================================
     * CREDIT / RISK
     * ========================================================================
     */

    eligibilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      validate: {
        validator: isValidScore,
        message:
          "Eligibility score must be between 0 and 100.",
      },
    },

    creditScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
      validate: {
        validator: isValidScore,
        message:
          "Credit score must be between 0 and 100.",
      },
    },

    riskScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
      validate: {
        validator: isValidScore,
        message:
          "Risk score must be between 0 and 100.",
      },
    },

    fraudRiskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      validate: {
        validator: isValidScore,
        message:
          "Fraud risk score must be between 0 and 100.",
      },
    },

    fraudFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },

    fraudReason: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    /**
     * ========================================================================
     * COMPLIANCE
     * ========================================================================
     */

    amlChecked: {
      type: Boolean,
      default: false,
      index: true,
    },

    amlCheckedAt: {
      type: Date,
      default: null,
    },

    kycVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    kycVerifiedAt: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * PORTFOLIO METRICS
     * ========================================================================
     *
     * These are derived operational read-model values.
     *
     * They should NOT be treated as the authoritative accounting balance.
     */

    outstandingBalance: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Outstanding balance must be a non-negative safe integer.",
      },
    },

    amountDue: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Amount due must be a non-negative safe integer.",
      },
    },

    amountRepaid: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Amount repaid must be a non-negative safe integer.",
      },
    },

    daysPastDue: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 0
          );
        },
        message:
          "Days past due must be a non-negative integer.",
      },
      index: true,
    },

    /**
     * ========================================================================
     * PAR TRACKING
     * ========================================================================
     */

    parBucket: {
      type: String,
      enum: PAR_BUCKET,
      default: "current",
      index: true,
    },

    /**
     * ========================================================================
     * COLLECTIONS
     * ========================================================================
     */

    collectionAttempts: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 0
          );
        },
      },
    },

    lastCollectionAttempt: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * WRITE-OFF / RECOVERY
     * ========================================================================
     */

    amountRecovered: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Amount recovered must be a non-negative safe integer.",
      },
    },

    writtenOffAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Written-off amount must be a non-negative safe integer.",
      },
    },

    writeOffReason: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    restructureReason: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    /**
     * ========================================================================
     * AUDIT / VERSIONING
     * ========================================================================
     */

    auditReference: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    workflowVersion: {
      type: Number,
      default: 1,
      min: 1,
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            Number.isSafeInteger(value) &&
            value >= 1
          );
        },
      },
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      immutable: true,
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /**
     * ========================================================================
     * LIFECYCLE DATES
     * ========================================================================
     */

    approvedAt: {
      type: Date,
      default: null,
    },

    disbursedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    defaultedAt: {
      type: Date,
      default: null,
    },

    writtenOffAt: {
      type: Date,
      default: null,
    },

    recoveredAt: {
      type: Date,
      default: null,
    },

    restructuredAt: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * DISBURSEMENT
     * ========================================================================
     *
     * These fields are operational references only.
     *
     * Actual money movement must be represented by Transaction + Ledger.
     */

    disbursementMethod: {
      type: String,
      enum: DISBURSEMENT_METHOD,
      default: null,
    },

    disbursementReference: {
      type: String,
      trim: true,
      maxlength: 200,
      set: (value) =>
        normalizeString(value, 200),
    },

    disbursedAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Disbursed amount must be a non-negative safe integer.",
      },
    },

    /**
     * ========================================================================
     * RECOVERY MANAGEMENT
     * ========================================================================
     */

    recoveryOfficer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    recoveryAssignedAt: {
      type: Date,
      default: null,
    },

    recoveryNotes: {
      type: String,
      trim: true,
      maxlength: 3000,
    },

    /**
     * ========================================================================
     * GUARANTOR COVERAGE
     * ========================================================================
     */

    guaranteedAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Guaranteed amount must be a non-negative safe integer.",
      },
    },

    /**
     * ========================================================================
     * PAYMENT TRACKING
     * ========================================================================
     */

    firstPaymentDate: {
      type: Date,
      default: null,
    },

    lastPaymentDate: {
      type: Date,
      default: null,
    },

    nextPaymentDate: {
      type: Date,
      default: null,
      index: true,
    },

    lastRepaymentAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return isValidNonNegativeNumber(value);
        },
        message:
          "Last repayment amount must be a non-negative safe integer.",
      },
    },

    /**
     * ========================================================================
     * BOARD REPORTING
     * ========================================================================
     */

    boardApproved: {
      type: Boolean,
      default: false,
    },

    boardApprovalDate: {
      type: Date,
      default: null,
    },

    boardApprovalReference: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    /**
     * ========================================================================
     * INVESTOR REPORTING
     * ========================================================================
     */

    portfolioSegment: {
      type: String,
      enum: PORTFOLIO_SEGMENT,
      default: "MEDIUM_RISK",
      index: true,
    },

    /**
     * ========================================================================
     * OPERATIONS
     * ========================================================================
     */

    installments: {
      type: [InstallmentSchema],
      default: [],
    },

    notifications: {
      type: [NotificationSchema],
      default: [],
    },

    /**
     * ========================================================================
     * SOFT DELETE / ARCHIVAL
     * ========================================================================
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

LoanSchema.virtual("isNPL").get(
  function isNPL() {
    return this.daysPastDue >= 90;
  },
);

LoanSchema.virtual("isPAR30").get(
  function isPAR30() {
    return this.daysPastDue >= 30;
  },
);

LoanSchema.virtual("isPAR60").get(
  function isPAR60() {
    return this.daysPastDue >= 60;
  },
);

LoanSchema.virtual("isPAR90").get(
  function isPAR90() {
    return this.daysPastDue >= 90;
  },
);

LoanSchema.virtual("recoveryRate").get(
  function recoveryRate() {
    if (
      !this.writtenOffAmount ||
      this.writtenOffAmount <= 0
    ) {
      return 0;
    }

    return Math.min(
      100,
      (
        this.amountRecovered /
        this.writtenOffAmount
      ) * 100,
    );
  },
);

LoanSchema.virtual("loanAgeDays").get(
  function loanAgeDays() {
    if (!this.createdAt) {
      return 0;
    }

    return Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          this.createdAt.getTime()
        ) /
          (1000 * 60 * 60 * 24),
      ),
    );
  },
);

LoanSchema.virtual("isFraudRisk").get(
  function isFraudRisk() {
    return this.fraudRiskScore >= 80;
  },
);

LoanSchema.virtual("isDefaulted").get(
  function isDefaulted() {
    return this.status === "defaulted";
  },
);

LoanSchema.virtual("isTerminal").get(
  function isTerminal() {
    return TERMINAL_LOAN_STATUSES.includes(
      this.status,
    );
  },
);

LoanSchema.virtual("totalInstallmentAmount").get(
  function totalInstallmentAmount() {
    return this.installments.reduce(
      (sum, installment) =>
        sum + Number(installment.amount || 0),
      0,
    );
  },
);

LoanSchema.virtual("totalInstallmentPaid").get(
  function totalInstallmentPaid() {
    return this.installments.reduce(
      (sum, installment) =>
        sum + Number(
          installment.amountPaid || 0,
        ),
      0,
    );
  },
);

LoanSchema.virtual("remainingPrincipal").get(
  function remainingPrincipal() {
    return Math.max(
      0,
      Number(this.amount || 0) -
        Number(this.amountRepaid || 0),
    );
  },
);

LoanSchema.virtual("guarantorCoverageRatio").get(
  function guarantorCoverageRatio() {
    if (!this.amount) {
      return 0;
    }

    return Math.min(
      100,
      (
        Number(this.guaranteedAmount || 0) /
        Number(this.amount)
      ) * 100,
    );
  },
);

/**
 * ============================================================================
 * PRE-VALIDATE
 * ============================================================================
 */

LoanSchema.pre(
  "validate",
  function validateLoan(next) {
    try {
      /**
       * ----------------------------------------------------------------------
       * Basic monetary consistency
       * ----------------------------------------------------------------------
       */

      if (
        !isValidPositiveNumber(
          this.amount,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Loan amount must be a positive safe integer.",
          ),
        );
      }

      const amountDue =
        Number(this.amountDue || 0);

      const amountRepaid =
        Number(this.amountRepaid || 0);

      const outstandingBalance =
        Number(
          this.outstandingBalance || 0,
        );

      const amountRecovered =
        Number(
          this.amountRecovered || 0,
        );

      const writtenOffAmount =
        Number(
          this.writtenOffAmount || 0,
        );

      const guaranteedAmount =
        Number(
          this.guaranteedAmount || 0,
        );

      const disbursedAmount =
        Number(
          this.disbursedAmount || 0,
        );

      if (
        !isValidNonNegativeNumber(
          amountDue,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "amountDue must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          amountRepaid,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "amountRepaid must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          outstandingBalance,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "outstandingBalance must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          amountRecovered,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "amountRecovered must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          writtenOffAmount,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "writtenOffAmount must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          guaranteedAmount,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "guaranteedAmount must be a non-negative safe integer.",
          ),
        );
      }

      if (
        !isValidNonNegativeNumber(
          disbursedAmount,
        )
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "disbursedAmount must be a non-negative safe integer.",
          ),
        );
      }

      /**
       * A loan cannot repay more than the contractual amount represented by
       * this compatibility model.
       *
       * Interest/fees should be modeled separately by the financial engine
       * when applicable, rather than allowing arbitrary over-repayment here.
       */
      if (
        amountRepaid > amountDue &&
        amountDue > 0
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "amountRepaid cannot exceed amountDue.",
          ),
        );
      }

      if (
        writtenOffAmount > amountDue &&
        amountDue > 0
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "writtenOffAmount cannot exceed amountDue.",
          ),
        );
      }

      if (
        guaranteedAmount > amount &&
        amount > 0
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "guaranteedAmount cannot exceed loan amount.",
          ),
        );
      }

      if (
        disbursedAmount > amount &&
        amount > 0
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "disbursedAmount cannot exceed loan amount.",
          ),
        );
      }

      /**
       * ----------------------------------------------------------------------
       * Installment integrity
       * ----------------------------------------------------------------------
       */

      let installmentTotal = 0;
      let installmentPaidTotal = 0;

      for (
        const installment
        of this.installments
      ) {
        const installmentAmount =
          Number(
            installment.amount || 0,
          );

        const installmentPaid =
          Number(
            installment.amountPaid || 0,
          );

        if (
          installmentPaid >
          installmentAmount
        ) {
          throw new mongoose.Error.ValidationError(
            new Error(
              "Installment amountPaid cannot exceed installment amount.",
            ),
          );
        }

        if (
          installment.paid &&
          installmentPaid !==
            installmentAmount
        ) {
          throw new mongoose.Error.ValidationError(
            new Error(
              "A paid installment must have amountPaid equal to amount.",
            ),
          );
        }

        if (
          !installment.paid &&
          installmentPaid ===
            installmentAmount &&
          installmentAmount > 0
        ) {
          installment.paid = true;
        }

        if (
          installment.paid &&
          !installment.paidAt
        ) {
          installment.paidAt =
            new Date();
        }

        if (
          !installment.paid
        ) {
          installment.paidAt =
            null;
        }

        installmentTotal +=
          installmentAmount;

        installmentPaidTotal +=
          installmentPaid;

        /**
         * Refresh installment delinquency.
         */
        if (
          !installment.paid &&
          installment.dueDate
        ) {
          const diff =
            Date.now() -
            installment.dueDate.getTime();

          installment.daysPastDue =
            Math.max(
              0,
              Math.floor(
                diff /
                  (1000 * 60 * 60 * 24),
              ),
            );
        } else {
          installment.daysPastDue = 0;
        }
      }

      if (
        installmentTotal > 0 &&
        installmentPaidTotal >
          installmentTotal
      ) {
        throw new mongoose.Error.ValidationError(
          new Error(
            "Total installment payments cannot exceed the scheduled installment total.",
          ),
        );
      }

      /**
       * ----------------------------------------------------------------------
       * Portfolio metrics
       * ----------------------------------------------------------------------
       */

      if (
        amountDue > 0
      ) {
        this.outstandingBalance =
          Math.max(
            0,
            amountDue -
              amountRepaid,
          );
      }

      /**
       * ----------------------------------------------------------------------
       * PAR classification
       * ----------------------------------------------------------------------
       */

      const maximumInstallmentDaysPastDue =
        this.installments.reduce(
          (max, installment) =>
            Math.max(
              max,
              Number(
                installment.daysPastDue || 0,
              ),
            ),
          0,
        );

      this.daysPastDue =
        Math.max(
          Number(this.daysPastDue || 0),
          maximumInstallmentDaysPastDue,
        );

      if (
        this.daysPastDue >= 90
      ) {
        this.parBucket = "PAR90";
      } else if (
        this.daysPastDue >= 60
      ) {
        this.parBucket = "PAR60";
      } else if (
        this.daysPastDue >= 30
      ) {
        this.parBucket = "PAR30";
      } else {
        this.parBucket = "current";
      }

      /**
       * ----------------------------------------------------------------------
       * Portfolio risk segmentation
       * ----------------------------------------------------------------------
       */

      if (
        typeof this.riskScore === "number"
      ) {
        if (
          this.riskScore >= 80
        ) {
          this.portfolioSegment =
            "HIGH_RISK";
        } else if (
          this.riskScore >= 40
        ) {
          this.portfolioSegment =
            "MEDIUM_RISK";
        } else {
          this.portfolioSegment =
            "LOW_RISK";
        }
      }

      /**
       * ----------------------------------------------------------------------
       * Fraud consistency
       * ----------------------------------------------------------------------
       */

      if (
        this.fraudRiskScore >= 80
      ) {
        this.fraudFlagged = true;
      }

      /**
       * ----------------------------------------------------------------------
       * Status-derived lifecycle checks
       * ----------------------------------------------------------------------
       */

      if (
        this.status === "approved"
      ) {
        if (!this.approvedAt) {
          this.approvedAt =
            new Date();
        }
      }

      if (
        this.status === "disbursed"
      ) {
        if (!this.disbursedAt) {
          this.disbursedAt =
            new Date();
        }
      }

      if (
        this.status === "completed"
      ) {
        if (!this.completedAt) {
          this.completedAt =
            new Date();
        }
      }

      if (
        this.status === "cancelled"
      ) {
        if (!this.cancelledAt) {
          this.cancelledAt =
            new Date();
        }
      }

      if (
        this.status === "rejected"
      ) {
        if (!this.rejectedAt) {
          this.rejectedAt =
            new Date();
        }
      }

      if (
        this.status === "defaulted"
      ) {
        if (!this.defaultedAt) {
          this.defaultedAt =
            new Date();
        }
      }

      if (
        this.status === "written_off"
      ) {
        if (!this.writtenOffAt) {
          this.writtenOffAt =
            new Date();
        }
      }

      if (
        this.status === "recovered"
      ) {
        if (!this.recoveredAt) {
          this.recoveredAt =
            new Date();
        }
      }

      if (
        this.status === "restructured"
      ) {
        if (!this.restructuredAt) {
          this.restructuredAt =
            new Date();
        }
      }

      /**
       * ----------------------------------------------------------------------
       * Compliance consistency
       * ----------------------------------------------------------------------
       */

      if (
        this.amlChecked &&
        !this.amlCheckedAt
      ) {
        this.amlCheckedAt =
          new Date();
      }

      if (
        this.kycVerified &&
        !this.kycVerifiedAt
      ) {
        this.kycVerifiedAt =
          new Date();
      }

      /**
       * ----------------------------------------------------------------------
       * Credit decision consistency
       * ----------------------------------------------------------------------
       */

      if (
        [
          "APPROVED",
          "REJECTED",
        ].includes(
          this.creditDecision,
        ) &&
        !this.creditDecisionDate
      ) {
        this.creditDecisionDate =
          new Date();
      }

      /**
       * ----------------------------------------------------------------------
       * Default operating values
       * ----------------------------------------------------------------------
       */

      if (
        this.amountDue === 0 &&
        this.status === "pending"
      ) {
        /**
         * For compatibility, initially consider contractual amount due to be
         * the loan amount. The financial service may subsequently set the
         * precise repayment obligation including approved fees/interest.
         */
        this.amountDue =
          this.amount;
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ============================================================================
 * PRE-SAVE WORKFLOW / FINANCIAL PROTECTION
 * ============================================================================
 */

LoanSchema.post(
  "init",
  function captureOriginalLoanState(doc) {
    doc.$locals =
      doc.$locals || {};

    doc.$locals.originalStatus =
      doc.status;
  },
);

LoanSchema.post(
  "save",
  function captureSavedLoanState(doc) {
    doc.$locals =
      doc.$locals || {};

    doc.$locals.originalStatus =
      doc.status;
  },
);

LoanSchema.pre(
  "save",
  function protectLoanState(next) {
    try {
      if (!this.isNew) {
        const originalStatus =
          this.$locals?.originalStatus;

        /**
         * --------------------------------------------------------------
         * Explicit workflow enforcement
         * --------------------------------------------------------------
         */

        if (
          originalStatus &&
          originalStatus !==
            this.status
        ) {
          assertLoanStatusTransition(
            originalStatus,
            this.status,
          );
        }

        /**
         * --------------------------------------------------------------
         * Financial identity protection
         * --------------------------------------------------------------
         *
         * Once approved, financial terms must not be silently changed.
         * Corrections should use a formal amendment/restructure workflow.
         */

        if (
          originalStatus &&
          FINANCIAL_LOCKED_STATUSES.includes(
            originalStatus,
          )
        ) {
          const protectedFields = [
            "tenantId",
            "user",
            "group",
            "amount",
            "interestRate",
            "repaymentPeriodMonths",
          ];

          for (
            const field
            of protectedFields
          ) {
            if (
              this.isModified(field)
            ) {
              throw new Error(
                `Loan field "${field}" cannot be modified after loan reaches ${originalStatus}. Use an approved amendment/restructure workflow.`,
              );
            }
          }
        }

        /**
         * --------------------------------------------------------------
         * Terminal-state protection
         * --------------------------------------------------------------
         */

        if (
          originalStatus &&
          TERMINAL_LOAN_STATUSES.includes(
            originalStatus,
          ) &&
          originalStatus !==
            this.status
        ) {
          throw new Error(
            `Terminal loan ${originalStatus} cannot be reopened through direct document mutation.`,
          );
        }
      }

      /**
       * Workflow notification.
       *
       * Only append for genuine status changes.
       */
      const originalStatus =
        this.$locals?.originalStatus;

      if (
        this.isModified("status") &&
        (
          this.isNew ||
          originalStatus !==
            this.status
        )
      ) {
        if (
          !Array.isArray(
            this.notifications,
          )
        ) {
          this.notifications =
            [];
        }

        this.notifications.push({
          message:
            `Loan status changed to "${this.status}".`,
          createdAt:
            new Date(),
          read: false,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ============================================================================
 * DIRECT UPDATE PROTECTION
 * ============================================================================
 *
 * Application services should use explicit methods below instead of changing
 * financial/workflow identity through arbitrary updateOne/updateMany calls.
 */

const PROTECTED_DIRECT_UPDATE_FIELDS =
  new Set([
    "tenantId",
    "user",
    "group",
    "amount",
    "interestRate",
    "repaymentPeriodMonths",
    "status",
  ]);

function getUpdateObject(query) {
  return query.getUpdate() || {};
}

function getChangedUpdateFields(update) {
  const fields = new Set();

  for (
    const operator
    of [
      "$set",
      "$setOnInsert",
      "$inc",
      "$unset",
      "$push",
      "$addToSet",
      "$pull",
      "$pullAll",
    ]
  ) {
    const block =
      update?.[operator];

    if (
      block &&
      typeof block ===
        "object"
    ) {
      for (
        const key
        of Object.keys(block)
      ) {
        fields.add(
          key.split(".")[0],
        );
      }
    }
  }

  for (
    const key
    of Object.keys(update || {})
  ) {
    if (
      !key.startsWith("$")
    ) {
      fields.add(
        key.split(".")[0],
      );
    }
  }

  return fields;
}

for (
  const hookName
  of [
    "findOneAndUpdate",
    "updateOne",
    "updateMany",
  ]
) {
  LoanSchema.pre(
    hookName,
    function protectDirectLoanUpdates(next) {
      try {
        const update =
          getUpdateObject(this);

        const changedFields =
          getChangedUpdateFields(
            update,
          );

        for (
          const field
          of changedFields
        ) {
          if (
            PROTECTED_DIRECT_UPDATE_FIELDS.has(
              field,
            )
          ) {
            throw new Error(
              `Direct update of protected loan field "${field}" is prohibited. Use Loan workflow/service methods.`,
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
 */

for (
  const hookName
  of [
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findOneAndRemove",
  ]
) {
  try {
    LoanSchema.pre(
      hookName,
      function preventHardDelete(next) {
        next(
          new Error(
            "Physical deletion of loans is prohibited. Use controlled soft-delete/archive workflow.",
          ),
        );
      },
    );
  } catch {
    /**
     * Compatibility with Mongoose versions which may not expose every
     * historical middleware hook.
     */
  }
}

/**
 * ============================================================================
 * STATIC: ELIGIBILITY CALCULATION
 * ============================================================================
 *
 * Tenant-scoped where possible.
 */

LoanSchema.statics.calculateEligibility =
  async function calculateEligibility(
    userId,
    groupId,
    options = {},
  ) {
    if (!userId || !groupId) {
      throw new Error(
        "userId and groupId are required.",
      );
    }

    const Contribution =
      mongoose.models.Contribution ||
      mongoose.model("Contribution");

    const query = {
      user: userId,
      group: groupId,
    };

    /**
     * If the Contribution model supports tenantId, tenant scoping should be
     * included. The condition is deliberately applied only when supplied.
     */
    if (
      options.tenantId
    ) {
      query.tenantId =
        options.tenantId;
    }

    const contributions =
      await Contribution.find(
        query,
        null,
        {
          session:
            getSession(options),
        },
      ).lean();

    const total =
      contributions.reduce(
        (sum, contribution) =>
          sum +
          Number(
            contribution.amount ||
              0,
          ),
        0,
      );

    let score = 0;

    /**
     * Existing product rule preserved.
     */
    if (total >= 1000) {
      score += 50;
    }

    if (
      contributions.length >= 6
    ) {
      score += 30;
    }

    return Math.min(
      score,
      100,
    );
  };

/**
 * ============================================================================
 * STATIC: FINDERS
 * ============================================================================
 */

LoanSchema.statics.findByTenant =
  function findByTenant(
    tenantId,
    options = {},
  ) {
    if (!tenantId) {
      throw new Error(
        "tenantId is required.",
      );
    }

    const query = {
      tenantId,
      ...(options.includeDeleted
        ? {}
        : { deletedAt: null }),
    };

    return this.find(query)
      .sort({
        createdAt: -1,
        _id: -1,
      });
  };

LoanSchema.statics.findActive =
  function findActive(
    tenantId,
  ) {
    const query = {
      tenantId,
      deletedAt: null,
      status: {
        $in: [
          "disbursed",
          "active",
          "restructured",
          "defaulted",
        ],
      },
    };

    return this.find(query)
      .sort({
        createdAt: -1,
        _id: -1,
      });
  };

LoanSchema.statics.findDefaulted =
  function findDefaulted(
    tenantId,
  ) {
    const query = {
      tenantId,
      deletedAt: null,
      status: "defaulted",
    };

    return this.find(query)
      .sort({
        defaultedAt: 1,
        createdAt: 1,
        _id: 1,
      });
  };

LoanSchema.statics.findOverdue =
  function findOverdue(
    tenantId,
  ) {
    const query = {
      tenantId,
      deletedAt: null,
      daysPastDue: {
        $gt: 0,
      },
      status: {
        $in: [
          "disbursed",
          "active",
          "restructured",
          "defaulted",
        ],
      },
    };

    return this.find(query)
      .sort({
        daysPastDue: -1,
        createdAt: 1,
        _id: 1,
      });
  };

LoanSchema.statics.findByMember =
  function findByMember(
    tenantId,
    memberId,
  ) {
    return this.find({
      tenantId,
      member: memberId,
      deletedAt: null,
    }).sort({
      createdAt: -1,
      _id: -1,
    });
  };

LoanSchema.statics.findByGroup =
  function findByGroup(
    tenantId,
    groupId,
  ) {
    return this.find({
      tenantId,
      group: groupId,
      deletedAt: null,
    }).sort({
      createdAt: -1,
      _id: -1,
    });
  };

/**
 * ============================================================================
 * INSTANCE WORKFLOW METHODS
 * ============================================================================
 */

/**
 * Submit / move to pending.
 */
LoanSchema.methods.submit =
  async function submit(options = {}) {
    assertLoanStatusTransition(
      this.status,
      "pending",
    );

    this.status = "pending";

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Start credit review.
 */
LoanSchema.methods.startCreditReview =
  async function startCreditReview(
    options = {},
  ) {
    assertLoanStatusTransition(
      this.status,
      "credit_review",
    );

    this.status = "credit_review";

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Request manual review.
 */
LoanSchema.methods.requestManualReview =
  async function requestManualReview(
    options = {},
  ) {
    assertLoanStatusTransition(
      this.status,
      "manual_review",
    );

    const now = new Date();

    this.status = "manual_review";

    this.creditDecision =
      "MANUAL_REVIEW";

    this.reviewRequestedAt =
      options.requestedAt
        ? normalizeDate(
            options.requestedAt,
          )
        : now;

    this.reviewRequestedBy =
      options.requestedBy || null;

    this.reviewNotes =
      normalizeString(
        options.notes,
        3000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Approve loan.
 */
LoanSchema.methods.approve =
  async function approve(options = {}) {
    assertLoanStatusTransition(
      this.status,
      "approved",
    );

    if (
      !this.kycVerified
    ) {
      throw new Error(
        "Loan cannot be approved before KYC verification.",
      );
    }

    if (
      !this.amlChecked
    ) {
      throw new Error(
        "Loan cannot be approved before AML screening.",
      );
    }

    if (
      this.fraudFlagged ||
      this.fraudRiskScore >= 80
    ) {
      throw new Error(
        "Fraud-flagged loans cannot be approved without an explicit risk-resolution workflow.",
      );
    }

    if (
      !options.approvedBy
    ) {
      throw new Error(
        "approvedBy is required.",
      );
    }

    const now = new Date();

    this.status =
      "approved";

    this.creditDecision =
      "APPROVED";

    this.creditDecisionReason =
      normalizeString(
        options.reason,
        1000,
      );

    this.creditDecisionDate =
      options.decisionDate
        ? normalizeDate(
            options.decisionDate,
          )
        : now;

    this.approvedBy =
      options.approvedBy;

    this.approvedAt =
      options.approvedAt
        ? normalizeDate(
            options.approvedAt,
          )
        : now;

    this.reviewCompletedAt =
      this.reviewCompletedAt ||
      now;

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Reject loan.
 */
LoanSchema.methods.reject =
  async function reject(
    reason,
    options = {},
  ) {
    if (
      ![
        "pending",
        "credit_review",
        "manual_review",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Loan cannot be rejected from ${this.status}.`,
      );
    }

    assertLoanStatusTransition(
      this.status,
      "rejected",
    );

    const now = new Date();

    this.status =
      "rejected";

    this.creditDecision =
      "REJECTED";

    this.creditDecisionReason =
      normalizeString(
        reason ||
          "Loan rejected.",
        1000,
      );

    this.creditDecisionDate =
      now;

    this.rejectedAt =
      now;

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Cancel loan.
 */
LoanSchema.methods.cancel =
  async function cancel(
    reason,
    options = {},
  ) {
    if (
      [
        "disbursed",
        "active",
        "completed",
        "defaulted",
        "written_off",
        "recovered",
        "restructured",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        "A disbursed or financially active loan cannot be cancelled directly.",
      );
    }

    assertLoanStatusTransition(
      this.status,
      "cancelled",
    );

    const now = new Date();

    this.status =
      "cancelled";

    this.cancelledAt =
      now;

    this.creditDecisionReason =
      normalizeString(
        reason ||
          "Loan cancelled.",
        1000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark loan disbursed.
 *
 * IMPORTANT:
 * The caller should invoke this only after the authoritative disbursement
 * Transaction/ledger workflow has been accepted according to platform policy.
 */
LoanSchema.methods.markDisbursed =
  async function markDisbursed(
    options = {},
  ) {
    assertLoanStatusTransition(
      this.status,
      "disbursed",
    );

    if (
      !this.approvedAt ||
      !this.approvedBy
    ) {
      throw new Error(
        "Loan must have an approval before disbursement.",
      );
    }

    if (
      !this.disbursementMethod
    ) {
      throw new Error(
        "Disbursement method is required.",
      );
    }

    if (
      !options.disbursementReference
    ) {
      throw new Error(
        "disbursementReference is required.",
      );
    }

    const disbursedAmount =
      Number(
        options.disbursedAmount ??
          this.amount,
      );

    if (
      !isValidPositiveNumber(
        disbursedAmount,
      )
    ) {
      throw new Error(
        "Disbursed amount must be a positive safe integer.",
      );
    }

    if (
      disbursedAmount >
      this.amount
    ) {
      throw new Error(
        "Disbursed amount cannot exceed loan amount.",
      );
    }

    const now = new Date();

    this.status =
      "disbursed";

    this.disbursedAt =
      options.disbursedAt
        ? normalizeDate(
            options.disbursedAt,
          )
        : now;

    this.disbursementReference =
      normalizeString(
        options.disbursementReference,
        200,
      );

    this.disbursedAmount =
      disbursedAmount;

    if (
      options.disbursementMethod
    ) {
      this.disbursementMethod =
        options.disbursementMethod;
    }

    if (
      options.repaymentDate
    ) {
      this.repaymentDate =
        normalizeDate(
          options.repaymentDate,
        );
    }

    if (
      !this.amountDue
    ) {
      this.amountDue =
        this.amount;
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Activate loan after disbursement.
 */
LoanSchema.methods.activate =
  async function activate(
    options = {},
  ) {
    assertLoanStatusTransition(
      this.status,
      "active",
    );

    if (
      !this.disbursedAt
    ) {
      throw new Error(
        "Loan cannot be activated before disbursement.",
      );
    }

    this.status =
      "active";

    if (
      options.nextPaymentDate
    ) {
      this.nextPaymentDate =
        normalizeDate(
          options.nextPaymentDate,
        );
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark completed.
 */
LoanSchema.methods.complete =
  async function complete(
    options = {},
  ) {
    if (
      ![
        "disbursed",
        "active",
        "restructured",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Loan cannot be completed from ${this.status}.`,
      );
    }

    const unpaid =
      this.installments.filter(
        (installment) =>
          !installment.paid,
      );

    if (
      unpaid.length > 0 &&
      Number(this.outstandingBalance || 0) >
        0
    ) {
      throw new Error(
        "Loan cannot be completed while an outstanding balance remains.",
      );
    }

    assertLoanStatusTransition(
      this.status,
      "completed",
    );

    this.status =
      "completed";

    this.completedAt =
      options.completedAt
        ? normalizeDate(
            options.completedAt,
          )
        : new Date();

    this.outstandingBalance =
      0;

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark defaulted.
 */
LoanSchema.methods.markDefaulted =
  async function markDefaulted(
    reason,
    options = {},
  ) {
    if (
      ![
        "disbursed",
        "active",
        "restructured",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Loan cannot be defaulted from ${this.status}.`,
      );
    }

    assertLoanStatusTransition(
      this.status,
      "defaulted",
    );

    const now = new Date();

    this.status =
      "defaulted";

    this.defaultedAt =
      options.defaultedAt
        ? normalizeDate(
            options.defaultedAt,
          )
        : now;

    this.recoveryNotes =
      normalizeString(
        reason ||
          "Loan entered default.",
        3000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark restructured.
 */
LoanSchema.methods.restructure =
  async function restructure(
    reason,
    options = {},
  ) {
    if (
      ![
        "active",
        "defaulted",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Loan cannot be restructured from ${this.status}.`,
      );
    }

    assertLoanStatusTransition(
      this.status,
      "restructured",
    );

    this.status =
      "restructured";

    this.restructuredAt =
      options.restructuredAt
        ? normalizeDate(
            options.restructuredAt,
          )
        : new Date();

    this.restructureReason =
      normalizeString(
        reason ||
          "Loan restructured.",
        1000,
      );

    if (
      options.repaymentPeriodMonths !=
      null
    ) {
      if (
        !Number.isInteger(
          options.repaymentPeriodMonths,
        ) ||
        options.repaymentPeriodMonths < 1 ||
        options.repaymentPeriodMonths > 120
      ) {
        throw new Error(
          "Invalid restructured repayment period.",
        );
      }

      /**
       * This is an explicit restructure operation, therefore the immutable
       * original contractual term can be replaced only by this controlled
       * workflow.
       */
      this.repaymentPeriodMonths =
        options.repaymentPeriodMonths;
    }

    if (
      options.repaymentDate
    ) {
      this.repaymentDate =
        normalizeDate(
          options.repaymentDate,
        );
    }

    if (
      options.installments
    ) {
      this.installments =
        options.installments;
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark written off.
 */
LoanSchema.methods.writeOff =
  async function writeOff(
    reason,
    options = {},
  ) {
    if (
      ![
        "defaulted",
        "restructured",
        "active",
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Loan cannot be written off from ${this.status}.`,
      );
    }

    assertLoanStatusTransition(
      this.status,
      "written_off",
    );

    if (
      !options.approvedBy
    ) {
      throw new Error(
        "approvedBy is required for loan write-off.",
      );
    }

    const amount =
      Number(
        options.writtenOffAmount ??
          this.outstandingBalance ??
          0,
      );

    if (
      !isValidNonNegativeNumber(
        amount,
      )
    ) {
      throw new Error(
        "Invalid written-off amount.",
      );
    }

    const now = new Date();

    this.status =
      "written_off";

    this.writtenOffAt =
      options.writtenOffAt
        ? normalizeDate(
            options.writtenOffAt,
          )
        : now;

    this.writtenOffAmount =
      amount;

    this.writeOffReason =
      normalizeString(
        reason ||
          "Loan written off.",
        1000,
      );

    this.approvedBy =
      options.approvedBy;

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Mark recovery complete.
 */
LoanSchema.methods.markRecovered =
  async function markRecovered(
    options = {},
  ) {
    if (
      this.status !==
      "written_off"
    ) {
      throw new Error(
        "Only written-off loans can be marked recovered through this workflow.",
      );
    }

    assertLoanStatusTransition(
      this.status,
      "recovered",
    );

    this.status =
      "recovered";

    this.recoveredAt =
      options.recoveredAt
        ? normalizeDate(
            options.recoveredAt,
          )
        : new Date();

    if (
      options.amountRecovered !=
      null
    ) {
      const amount =
        Number(
          options.amountRecovered,
        );

      if (
        !isValidNonNegativeNumber(
          amount,
        )
      ) {
        throw new Error(
          "Invalid recovered amount.",
        );
      }

      this.amountRecovered =
        amount;
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * REPAYMENT METHODS
 * ============================================================================
 *
 * These methods update operational loan read-model state.
 *
 * They do NOT replace the authoritative Transaction/Ledger repayment workflow.
 */

/**
 * Apply a repayment to installments.
 *
 * The caller should invoke this only after a valid repayment Transaction has
 * been validated by the financial service.
 */
LoanSchema.methods.applyRepayment =
  async function applyRepayment(
    repaymentAmount,
    options = {},
  ) {
    const amount =
      Number(repaymentAmount);

    if (
      !isValidPositiveNumber(
        amount,
      )
    ) {
      throw new Error(
        "Repayment amount must be a positive safe integer.",
      );
    }

    if (
      TERMINAL_LOAN_STATUSES.includes(
        this.status,
      ) &&
      this.status !== "recovered"
    ) {
      throw new Error(
        `Cannot apply repayment to terminal loan status ${this.status}.`,
      );
    }

    let remaining =
      amount;

    const now =
      options.paidAt
        ? normalizeDate(
            options.paidAt,
          )
        : new Date();

    /**
     * Apply payment oldest installment first.
     */
    for (
      const installment
      of this.installments
    ) {
      if (
        remaining <= 0
      ) {
        break;
      }

      const installmentBalance =
        Math.max(
          0,
          Number(
            installment.amount || 0,
          ) -
            Number(
              installment.amountPaid ||
                0,
            ),
        );

      if (
        installmentBalance <=
        0
      ) {
        installment.paid = true;

        if (
          !installment.paidAt
        ) {
          installment.paidAt =
            now;
        }

        continue;
      }

      const allocation =
        Math.min(
          remaining,
          installmentBalance,
        );

      installment.amountPaid =
        Number(
          installment.amountPaid ||
            0,
        ) + allocation;

      remaining -= allocation;

      if (
        installment.amountPaid >=
        installment.amount
      ) {
        installment.amountPaid =
          installment.amount;

        installment.paid =
          true;

        installment.paidAt =
          now;

        installment.daysPastDue =
          0;
      }
    }

    /**
     * Preserve the actual received payment as amountRepaid.
     *
     * Any excess is rejected instead of disappearing into the loan model.
     */
    if (
      remaining > 0
    ) {
      throw new Error(
        "Repayment exceeds the currently scheduled installment balance. Handle excess payment through the financial service/refund workflow.",
      );
    }

    this.amountRepaid =
      Number(
        this.amountRepaid || 0,
      ) + amount;

    this.lastRepaymentAmount =
      amount;

    this.lastPaymentDate =
      now;

    if (
      !this.firstPaymentDate
    ) {
      this.firstPaymentDate =
        now;
    }

    const nextUnpaid =
      this.installments
        .filter(
          (installment) =>
            !installment.paid,
        )
        .sort(
          (a, b) =>
            a.dueDate -
            b.dueDate,
        )[0];

    this.nextPaymentDate =
      nextUnpaid?.dueDate ||
      null;

    this.outstandingBalance =
      Math.max(
        0,
        Number(
          this.amountDue ||
            this.amount,
        ) -
          Number(
            this.amountRepaid ||
              0,
          ),
      );

    if (
      this.outstandingBalance === 0
    ) {
      if (
        ["active", "disbursed", "restructured"].includes(
          this.status,
        )
      ) {
        assertLoanStatusTransition(
          this.status,
          "completed",
        );

        this.status =
          "completed";

        this.completedAt =
          now;
      }
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * Recalculate repayment status without adding a repayment.
 */
LoanSchema.methods.updateRepaymentStatus =
  async function updateRepaymentStatus(
    options = {},
  ) {
    const allPaid =
      this.installments.length > 0 &&
      this.installments.every(
        (installment) =>
          installment.paid === true,
      );

    const calculatedPaid =
      this.installments.reduce(
        (sum, installment) =>
          sum +
          Number(
            installment.amountPaid ||
              0,
          ),
        0,
      );

    if (
      calculatedPaid >
      Number(
        this.amountDue ||
          this.amount ||
          0,
      )
    ) {
      throw new Error(
        "Calculated installment repayment exceeds loan amount due.",
      );
    }

    this.amountRepaid =
      Math.max(
        Number(
          this.amountRepaid || 0,
        ),
        calculatedPaid,
      );

    this.outstandingBalance =
      Math.max(
        0,
        Number(
          this.amountDue ||
            this.amount,
        ) -
          Number(
            this.amountRepaid ||
              0,
          ),
      );

    const nextUnpaid =
      this.installments
        .filter(
          (installment) =>
            !installment.paid,
        )
        .sort(
          (a, b) =>
            a.dueDate -
            b.dueDate,
        )[0];

    this.nextPaymentDate =
      nextUnpaid?.dueDate ||
      null;

    if (
      allPaid &&
      this.outstandingBalance === 0
    ) {
      if (
        [
          "disbursed",
          "active",
          "restructured",
        ].includes(
          this.status,
        )
      ) {
        assertLoanStatusTransition(
          this.status,
          "completed",
        );

        this.status =
          "completed";

        this.completedAt =
          new Date();
      }
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * COLLECTION METHODS
 * ============================================================================
 */

LoanSchema.methods.recordCollectionAttempt =
  async function recordCollectionAttempt(
    options = {},
  ) {
    this.collectionAttempts =
      Number(
        this.collectionAttempts || 0,
      ) + 1;

    this.lastCollectionAttempt =
      options.attemptedAt
        ? normalizeDate(
            options.attemptedAt,
          )
        : new Date();

    if (
      options.notes
    ) {
      this.recoveryNotes =
        normalizeString(
          options.notes,
          3000,
        );
    }

    return this.save({
      session:
        getSession(options),
    });
  };

LoanSchema.methods.assignRecoveryOfficer =
  async function assignRecoveryOfficer(
    recoveryOfficer,
    options = {},
  ) {
    if (
      !recoveryOfficer
    ) {
      throw new Error(
        "recoveryOfficer is required.",
      );
    }

    this.recoveryOfficer =
      recoveryOfficer;

    this.recoveryAssignedAt =
      options.assignedAt
        ? normalizeDate(
            options.assignedAt,
          )
        : new Date();

    if (
      options.notes
    ) {
      this.recoveryNotes =
        normalizeString(
          options.notes,
          3000,
        );
    }

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * COMPLIANCE METHODS
 * ============================================================================
 */

LoanSchema.methods.markKYCVerified =
  async function markKYCVerified(
    options = {},
  ) {
    this.kycVerified = true;

    this.kycVerifiedAt =
      options.verifiedAt
        ? normalizeDate(
            options.verifiedAt,
          )
        : new Date();

    return this.save({
      session:
        getSession(options),
    });
  };

LoanSchema.methods.markAMLChecked =
  async function markAMLChecked(
    options = {},
  ) {
    this.amlChecked = true;

    this.amlCheckedAt =
      options.checkedAt
        ? normalizeDate(
            options.checkedAt,
          )
        : new Date();

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * FRAUD METHODS
 * ============================================================================
 */

LoanSchema.methods.flagFraud =
  async function flagFraud(
    reason,
    options = {},
  ) {
    this.fraudFlagged = true;

    this.fraudRiskScore =
      Math.max(
        80,
        Number(
          options.fraudRiskScore ??
            this.fraudRiskScore ??
            80,
        ),
      );

    this.fraudReason =
      normalizeString(
        reason ||
          "Loan flagged for fraud review.",
        2000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

LoanSchema.methods.clearFraudFlag =
  async function clearFraudFlag(
    options = {},
  ) {
    if (
      !options.approvedBy
    ) {
      throw new Error(
        "approvedBy is required to clear a fraud flag.",
      );
    }

    this.fraudFlagged =
      false;

    this.fraudReason =
      normalizeString(
        options.reason,
        2000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * BOARD APPROVAL
 * ============================================================================
 */

LoanSchema.methods.markBoardApproved =
  async function markBoardApproved(
    options = {},
  ) {
    if (
      !options.approvedBy
    ) {
      throw new Error(
        "approvedBy is required for board approval.",
      );
    }

    this.boardApproved =
      true;

    this.boardApprovalDate =
      options.approvalDate
        ? normalizeDate(
            options.approvalDate,
          )
        : new Date();

    this.boardApprovalReference =
      normalizeString(
        options.reference,
        200,
      );

    this.approvedBy =
      options.approvedBy;

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * GUARANTOR METHODS
 * ============================================================================
 */

LoanSchema.methods.addGuarantor =
  async function addGuarantor(
    guarantor,
    options = {},
  ) {
    if (
      !guarantor?.member
    ) {
      throw new Error(
        "Guarantor member is required.",
      );
    }

    const duplicate =
      this.guarantors.some(
        (existing) =>
          String(
            existing.member,
          ) ===
          String(
            guarantor.member,
          ),
      );

    if (duplicate) {
      throw new Error(
        "This member is already a guarantor for the loan.",
      );
    }

    this.guarantors.push({
      member:
        guarantor.member,

      guaranteeAmount:
        guarantor.guaranteeAmount ||
        0,

      status:
        guarantor.status ||
        "PENDING",

      notes:
        guarantor.notes || null,
    });

    this.guaranteedAmount =
      this.guarantors.reduce(
        (sum, item) =>
          sum +
          Number(
            item.guaranteeAmount ||
              0,
          ),
        0,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * SOFT DELETE
 * ============================================================================
 */

LoanSchema.methods.softDelete =
  async function softDelete(
    deletedBy,
    reason,
    options = {},
  ) {
    if (
      this.deletedAt
    ) {
      return this;
    }

    if (
      !deletedBy ||
      !mongoose.isValidObjectId(
        deletedBy,
      )
    ) {
      throw new Error(
        "A valid deletedBy user ID is required.",
      );
    }

    if (
      FINANCIAL_LOCKED_STATUSES.includes(
        this.status,
      )
    ) {
      throw new Error(
        "Financially active/approved loans must not be deleted. Archive using an approved administrative workflow.",
      );
    }

    this.deletedAt =
      new Date();

    this.deletedBy =
      deletedBy;

    this.deletionReason =
      normalizeString(
        reason ||
          "Loan archived.",
        1000,
      );

    return this.save({
      session:
        getSession(options),
    });
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Tenant + workflow.
 */
LoanSchema.index({
  tenantId: 1,
  status: 1,
});

/**
 * Tenant + member history.
 */
LoanSchema.index({
  tenantId: 1,
  member: 1,
  createdAt: -1,
});

/**
 * Tenant + group history.
 */
LoanSchema.index({
  tenantId: 1,
  group: 1,
  createdAt: -1,
});

/**
 * Tenant + user history.
 */
LoanSchema.index({
  tenantId: 1,
  user: 1,
  createdAt: -1,
});

/**
 * Tenant + delinquency.
 */
LoanSchema.index({
  tenantId: 1,
  daysPastDue: 1,
});

/**
 * Tenant + PAR.
 */
LoanSchema.index({
  tenantId: 1,
  parBucket: 1,
});

/**
 * Tenant + disbursement history.
 */
LoanSchema.index({
  tenantId: 1,
  disbursedAt: -1,
});

/**
 * Tenant + approval.
 */
LoanSchema.index({
  tenantId: 1,
  approvedAt: -1,
});

/**
 * Tenant + credit decision.
 */
LoanSchema.index({
  tenantId: 1,
  creditDecision: 1,
});

/**
 * Tenant + credit score.
 */
LoanSchema.index({
  tenantId: 1,
  creditDecision: 1,
  creditScore: -1,
});

/**
 * Tenant + loan officer.
 */
LoanSchema.index({
  tenantId: 1,
  loanOfficer: 1,
  status: 1,
});

/**
 * Tenant + fraud risk.
 */
LoanSchema.index({
  tenantId: 1,
  fraudRiskScore: -1,
});

/**
 * Tenant + fraud queue.
 */
LoanSchema.index({
  tenantId: 1,
  fraudFlagged: 1,
  fraudRiskScore: -1,
});

/**
 * Tenant + AML.
 */
LoanSchema.index({
  tenantId: 1,
  amlChecked: 1,
});

/**
 * Tenant + KYC.
 */
LoanSchema.index({
  tenantId: 1,
  kycVerified: 1,
});

/**
 * Tenant + collection.
 */
LoanSchema.index({
  tenantId: 1,
  collectionAttempts: 1,
});

/**
 * Tenant + recovery officer.
 */
LoanSchema.index({
  tenantId: 1,
  recoveryOfficer: 1,
});

/**
 * Tenant + next payment.
 */
LoanSchema.index({
  tenantId: 1,
  nextPaymentDate: 1,
  status: 1,
});

/**
 * Tenant + purpose.
 */
LoanSchema.index({
  tenantId: 1,
  purpose: 1,
});

/**
 * Tenant + disbursement method.
 */
LoanSchema.index({
  tenantId: 1,
  disbursementMethod: 1,
});

/**
 * Tenant + default.
 */
LoanSchema.index({
  tenantId: 1,
  defaultedAt: 1,
});

/**
 * Tenant + write-off.
 */
LoanSchema.index({
  tenantId: 1,
  writtenOffAt: 1,
});

/**
 * Tenant + portfolio segment.
 */
LoanSchema.index({
  tenantId: 1,
  portfolioSegment: 1,
});

/**
 * Tenant + active loan read model.
 */
LoanSchema.index({
  tenantId: 1,
  status: 1,
  daysPastDue: 1,
  nextPaymentDate: 1,
});

/**
 * Tenant + created history.
 */
LoanSchema.index({
  tenantId: 1,
  createdAt: -1,
});

/**
 * Tenant + archival.
 */
LoanSchema.index({
  tenantId: 1,
  deletedAt: 1,
});

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

const Loan =
  mongoose.models.Loan ||
  mongoose.model(
    "Loan",
    LoanSchema,
  );

export {
  Loan,
  LoanSchema,
  InstallmentSchema,
  NotificationSchema,
  GuarantorSchema,
};

export default Loan;