// ============================================================================
// backend/modules/loans/models/LoanAudit.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Loan Audit Model
//
// PURPOSE
// ----------------------------------------------------------------------------
// Append-only audit trail for loan-domain activity.
//
// IMPORTANT DOMAIN SEPARATION
// ----------------------------------------------------------------------------
// LoanAudit != Loan
// LoanAudit != Transaction
// LoanAudit != LedgerEntry
//
// LoanAudit records:
//   - who performed an operation
//   - what happened
//   - when it happened
//   - which tenant / loan was affected
//   - workflow transition information
//   - selected before/after state
//   - reason / approval information
//   - request / correlation / trace information
//
// It MUST NOT be treated as:
//   - the accounting ledger
//   - a balance source of truth
//   - proof that money moved
//
// Financial truth remains:
//   Transaction + FinancialTransactionService + Ledger
//
// DESIGN GOALS
// ----------------------------------------------------------------------------
// - ESM / Node.js compatibility
// - Multi-tenant isolation
// - Append-only audit semantics
// - Tamper-resistant application behavior
// - Loan workflow traceability
// - Credit/risk decision traceability
// - KYC/AML traceability
// - Disbursement/repayment workflow traceability
// - Write-off/recovery/restructure traceability
// - Correlation with API/queue/provider operations
// - Safe before/after snapshots
// - Queryable operational history
// - Optimistic concurrency compatibility
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

export const LOAN_AUDIT_ACTIONS = Object.freeze([
  "CREATED",
  "UPDATED",

  // Workflow
  "SUBMITTED",
  "CREDIT_REVIEW_STARTED",
  "MANUAL_REVIEW_REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",

  // Disbursement
  "DISBURSEMENT_INITIATED",
  "DISBURSED",
  "ACTIVATED",

  // Repayment
  "REPAYMENT_APPLIED",
  "INSTALLMENT_UPDATED",
  "COMPLETED",

  // Risk / delinquency
  "DEFAULTED",
  "RESTRUCTURED",
  "WRITTEN_OFF",
  "RECOVERED",

  // Compliance
  "KYC_VERIFIED",
  "AML_CHECKED",

  // Fraud
  "FRAUD_FLAGGED",
  "FRAUD_FLAG_CLEARED",

  // Guarantors
  "GUARANTOR_ADDED",
  "GUARANTOR_APPROVED",
  "GUARANTOR_REJECTED",

  // Board / governance
  "BOARD_APPROVED",

  // Recovery / collections
  "COLLECTION_ATTEMPT_RECORDED",
  "RECOVERY_ASSIGNED",

  // Administration
  "ARCHIVED",
  "RESTORED",

  // System / recovery
  "SYSTEM_RECONCILIATION",
  "RECOVERY",
]);

export const LOAN_AUDIT_ACTORS = Object.freeze([
  "USER",
  "ADMIN",
  "LOAN_OFFICER",
  "SYSTEM",
  "WORKER",
  "QUEUE",
  "RECOVERY",
  "API",
]);

export const LOAN_AUDIT_SEVERITY = Object.freeze([
  "INFO",
  "NOTICE",
  "WARNING",
  "CRITICAL",
]);

export const LOAN_AUDIT_CATEGORIES = Object.freeze([
  "WORKFLOW",
  "CREDIT",
  "RISK",
  "FRAUD",
  "COMPLIANCE",
  "DISBURSEMENT",
  "REPAYMENT",
  "COLLECTION",
  "RECOVERY",
  "RESTRUCTURE",
  "WRITE_OFF",
  "GOVERNANCE",
  "ADMINISTRATION",
  "SYSTEM",
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

function normalizeLowerString(value, maxLength = 100) {
  const normalized = normalizeString(value, maxLength);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

function normalizeDate(value) {
  if (value == null) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(
      "Invalid date supplied.",
    );
  }

  return date;
}

/**
 * Deterministic canonical JSON serializer.
 *
 * Used only for creating an integrity digest.
 * It is intentionally not intended to replace a cryptographic ledger.
 */
function canonicalize(value) {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "object"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] =
        canonicalize(value[key]);

      return result;
    }, {});
}

function createIntegrityHash({
  previousHash,
  tenantId,
  loanId,
  action,
  actorType,
  actorId,
  occurredAt,
  sequence,
  payloadHash,
}) {
  const canonicalPayload = JSON.stringify(
    canonicalize({
      previousHash:
        previousHash || null,

      tenantId:
        tenantId
          ? String(tenantId)
          : null,

      loanId:
        loanId
          ? String(loanId)
          : null,

      action:
        action || null,

      actorType:
        actorType || null,

      actorId:
        actorId
          ? String(actorId)
          : null,

      occurredAt:
        occurredAt
          ? new Date(
              occurredAt,
            ).toISOString()
          : null,

      sequence:
        Number(sequence || 0),

      payloadHash:
        payloadHash || null,
    }),
  );

  return crypto
    .createHash("sha256")
    .update(
      canonicalPayload,
      "utf8",
    )
    .digest("hex");
}

function createPayloadHash({
  action,
  category,
  severity,
  before,
  after,
  changes,
  reason,
  metadata,
}) {
  const canonicalPayload =
    JSON.stringify(
      canonicalize({
        action,
        category,
        severity,
        before:
          before || null,
        after:
          after || null,
        changes:
          changes || null,
        reason:
          reason || null,
        metadata:
          metadata || null,
      }),
    );

  return crypto
    .createHash("sha256")
    .update(
      canonicalPayload,
      "utf8",
    )
    .digest("hex");
}

/**
 * ============================================================================
 * SNAPSHOT SCHEMA
 * ============================================================================
 *
 * Snapshots are intentionally Mixed.
 *
 * IMPORTANT:
 * Only explicitly selected safe business fields should normally be placed
 * into before/after. Do not persist credentials, secrets, tokens or raw
 * payment-provider secrets.
 */

const SnapshotSchema = new Schema(
  {
    status: {
      type: String,
      default: null,
    },

    creditDecision: {
      type: String,
      default: null,
    },

    amount: {
      type: Number,
      default: null,
    },

    interestRate: {
      type: Number,
      default: null,
    },

    repaymentPeriodMonths: {
      type: Number,
      default: null,
    },

    amountDue: {
      type: Number,
      default: null,
    },

    amountRepaid: {
      type: Number,
      default: null,
    },

    outstandingBalance: {
      type: Number,
      default: null,
    },

    disbursedAmount: {
      type: Number,
      default: null,
    },

    daysPastDue: {
      type: Number,
      default: null,
    },

    parBucket: {
      type: String,
      default: null,
    },

    riskScore: {
      type: Number,
      default: null,
    },

    creditScore: {
      type: Number,
      default: null,
    },

    fraudRiskScore: {
      type: Number,
      default: null,
    },

    fraudFlagged: {
      type: Boolean,
      default: null,
    },

    kycVerified: {
      type: Boolean,
      default: null,
    },

    amlChecked: {
      type: Boolean,
      default: null,
    },

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
  },
  {
    _id: false,
    strict: false,
  },
);

/**
 * ============================================================================
 * CHANGE SCHEMA
 * ============================================================================
 *
 * A compact field-level audit representation.
 */

const ChangeSchema = new Schema(
  {
    field: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    before: {
      type: Schema.Types.Mixed,
      default: null,
    },

    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
    strict: false,
  },
);

/**
 * ============================================================================
 * LOAN AUDIT SCHEMA
 * ============================================================================
 */

const LoanAuditSchema = new Schema(
  {
    /**
     * ========================================================================
     * TENANCY
     * ========================================================================
     */

    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 100,
      index: true,
      set: (value) =>
        normalizeString(
          value,
          100,
        ),
    },

    /**
     * ========================================================================
     * LOAN REFERENCE
     * ========================================================================
     */

    loanId: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * Optional business references.
     *
     * These improve operational queries without making the audit record
     * dependent on mutable loan relationships.
     */

    memberId: {
      type: Schema.Types.ObjectId,
      ref: "Member",
      immutable: true,
      index: true,
      default: null,
    },

    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      immutable: true,
      index: true,
      default: null,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      immutable: true,
      index: true,
      default: null,
    },

    /**
     * ========================================================================
     * AUDIT ACTION
     * ========================================================================
     */

    action: {
      type: String,
      enum: LOAN_AUDIT_ACTIONS,
      required: true,
      immutable: true,
      index: true,
    },

    category: {
      type: String,
      enum: LOAN_AUDIT_CATEGORIES,
      required: true,
      immutable: true,
      index: true,
    },

    severity: {
      type: String,
      enum: LOAN_AUDIT_SEVERITY,
      default: "INFO",
      immutable: true,
      index: true,
    },

    /**
     * ========================================================================
     * ACTOR
     * ========================================================================
     */

    actorType: {
      type: String,
      enum: LOAN_AUDIT_ACTORS,
      required: true,
      immutable: true,
      index: true,
    },

    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      immutable: true,
      default: null,
      index: true,
    },

    actorName: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * WORKFLOW TRANSITION
     * ========================================================================
     */

    previousStatus: {
      type: String,
      trim: true,
      maxlength: 50,
      immutable: true,
      default: null,
    },

    nextStatus: {
      type: String,
      trim: true,
      maxlength: 50,
      immutable: true,
      default: null,
    },

    previousCreditDecision: {
      type: String,
      trim: true,
      maxlength: 50,
      immutable: true,
      default: null,
    },

    nextCreditDecision: {
      type: String,
      trim: true,
      maxlength: 50,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * HUMAN-READABLE AUDIT MESSAGE
     * ========================================================================
     */

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
      immutable: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 2000,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * APPROVAL / GOVERNANCE
     * ========================================================================
     */

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      immutable: true,
      default: null,
    },

    approvalReference: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * FINANCIAL IMPACT METADATA
     * ========================================================================
     *
     * This is descriptive audit metadata.
     *
     * It is NOT the accounting record.
     */

    financialImpact: {
      type: Boolean,
      default: false,
      immutable: true,
      index: true,
    },

    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      immutable: true,
      default: null,
      index: true,
    },

    transactionReference: {
      type: String,
      trim: true,
      maxlength: 100,
      immutable: true,
      default: null,
      index: true,
    },

    ledgerReference: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    /**
     * ========================================================================
     * BEFORE / AFTER SNAPSHOTS
     * ========================================================================
     */

    before: {
      type: SnapshotSchema,
      default: null,
    },

    after: {
      type: SnapshotSchema,
      default: null,
    },

    changes: {
      type: [ChangeSchema],
      default: [],
    },

    /**
     * ========================================================================
     * OPERATION CONTEXT
     * ========================================================================
     */

    source: {
      type: String,
      trim: true,
      maxlength: 100,
      immutable: true,
      default: "SYSTEM",
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    traceId: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    queueName: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
    },

    queueJobId: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    workerId: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
      index: true,
    },

    /**
     * ========================================================================
     * IDEMPOTENCY / DEDUPLICATION
     * ========================================================================
     */

    eventId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      immutable: true,
      index: true,
      set: (value) =>
        normalizeString(
          value,
          200,
        ),
    },

    eventType: {
      type: String,
      trim: true,
      maxlength: 200,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * VERSION INFORMATION
     * ========================================================================
     */

    loanVersion: {
      type: Number,
      min: 0,
      immutable: true,
      default: null,
    },

    workflowVersion: {
      type: Number,
      min: 1,
      immutable: true,
      default: null,
    },

    /**
     * ========================================================================
     * INTEGRITY CHAIN
     * ========================================================================
     *
     * This creates an application-level hash chain for audit records.
     *
     * It is an integrity mechanism, not a replacement for immutable archival,
     * database controls, external WORM storage or cryptographic signing.
     */

    sequence: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      index: true,
    },

    previousHash: {
      type: String,
      minlength: 64,
      maxlength: 64,
      immutable: true,
      default: null,
      index: true,
    },

    payloadHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      immutable: true,
    },

    integrityHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      immutable: true,
      index: true,
    },

    /**
     * ========================================================================
     * METADATA
     * ========================================================================
     */

    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * TIMING
     * ========================================================================
     */

    occurredAt: {
      type: Date,
      required: true,
      immutable: true,
      index: true,
      default: Date.now,
    },

    recordedAt: {
      type: Date,
      immutable: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,

    /**
     * Audit records must not be casually mutated after creation.
     */
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

LoanAuditSchema.virtual("isFinancialEvent")
  .get(function isFinancialEvent() {
    return Boolean(
      this.financialImpact ||
      this.transactionId ||
      this.ledgerReference,
    );
  });

LoanAuditSchema.virtual("isWorkflowTransition")
  .get(function isWorkflowTransition() {
    return Boolean(
      this.previousStatus &&
      this.nextStatus &&
      this.previousStatus !==
        this.nextStatus,
    );
  });

LoanAuditSchema.virtual("hasIntegrityChain")
  .get(function hasIntegrityChain() {
    return Boolean(
      this.integrityHash,
    );
  });

/**
 * ============================================================================
 * PRE-VALIDATE
 * ============================================================================
 */

LoanAuditSchema.pre(
  "validate",
  function validateLoanAudit(next) {
    try {
      this.tenantId =
        normalizeString(
          this.tenantId,
          100,
        );

      this.message =
        normalizeString(
          this.message,
          2000,
        );

      this.reason =
        normalizeString(
          this.reason,
          2000,
        );

      this.source =
        normalizeUpperString(
          this.source,
          100,
        ) || "SYSTEM";

      this.eventId =
        normalizeString(
          this.eventId,
          200,
        );

      this.requestId =
        normalizeString(
          this.requestId,
          200,
        );

      this.correlationId =
        normalizeString(
          this.correlationId,
          200,
        );

      this.traceId =
        normalizeString(
          this.traceId,
          200,
        );

      this.queueName =
        normalizeString(
          this.queueName,
          200,
        );

      this.queueJobId =
        normalizeString(
          this.queueJobId,
          200,
        );

      this.workerId =
        normalizeString(
          this.workerId,
          200,
        );

      this.transactionReference =
        normalizeUpperString(
          this.transactionReference,
          100,
        );

      this.approvalReference =
        normalizeString(
          this.approvalReference,
          200,
        );

      /**
       * occurredAt must be a real date.
       */
      this.occurredAt =
        normalizeDate(
          this.occurredAt ||
            new Date(),
        );

      this.recordedAt =
        normalizeDate(
          this.recordedAt ||
            new Date(),
        );

      /**
       * Workflow transition consistency.
       */
      if (
        this.action === "CREATED"
      ) {
        if (
          this.previousStatus !=
          null
        ) {
          throw new Error(
            "CREATED audit event cannot contain previousStatus.",
          );
        }
      }

      if (
        this.isWorkflowTransition &&
        this.previousStatus ===
          this.nextStatus
      ) {
        throw new Error(
          "Audit workflow transition must change status.",
        );
      }

      /**
       * Financial impact requires a financial reference or explicit metadata.
       *
       * The model allows financialImpact=true without transactionId only for
       * planning/read-model events, but such events should normally be created
       * by system workflows rather than ordinary user actions.
       */
      if (
        this.action === "REPAYMENT_APPLIED" &&
        !this.transactionId &&
        !this.metadata?.transactionReference
      ) {
        throw new Error(
          "REPAYMENT_APPLIED audit records require a transaction reference.",
        );
      }

      if (
        this.action === "DISBURSED" &&
        !this.transactionId &&
        !this.metadata?.transactionReference
      ) {
        throw new Error(
          "DISBURSED audit records require a transaction reference.",
        );
      }

      /**
       * Compute content hashes before final validation.
       */
      this.payloadHash =
        createPayloadHash({
          action: this.action,
          category: this.category,
          severity: this.severity,
          before: this.before,
          after: this.after,
          changes: this.changes,
          reason: this.reason,
          metadata: this.metadata,
        });

      if (
        this.sequence == null
      ) {
        throw new Error(
          "Audit sequence is required.",
        );
      }

      if (
        !Number.isInteger(
          this.sequence,
        ) ||
        this.sequence < 1
      ) {
        throw new Error(
          "Audit sequence must be a positive integer.",
        );
      }

      this.integrityHash =
        createIntegrityHash({
          previousHash:
            this.previousHash,

          tenantId:
            this.tenantId,

          loanId:
            this.loanId,

          action:
            this.action,

          actorType:
            this.actorType,

          actorId:
            this.actorId,

          occurredAt:
            this.occurredAt,

          sequence:
            this.sequence,

          payloadHash:
            this.payloadHash,
        });

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ============================================================================
 * IMMUTABILITY / APPEND-ONLY PROTECTION
 * ============================================================================
 *
 * Existing records MUST NOT be updated or deleted through normal application
 * operations.
 *
 * The only supported operation is INSERT.
 */

for (
  const hookName of [
    "save",
  ]
) {
  LoanAuditSchema.pre(
    hookName,
    function preventAuditMutation(next) {
      if (!this.isNew) {
        next(
          new Error(
            "Loan audit records are append-only and cannot be modified.",
          ),
        );

        return;
      }

      next();
    },
  );
}

for (
  const hookName of [
    "findOneAndUpdate",
    "updateOne",
    "updateMany",
    "replaceOne",
  ]
) {
  LoanAuditSchema.pre(
    hookName,
    function preventAuditUpdate(next) {
      next(
        new Error(
          "Loan audit records are append-only. Updates are prohibited.",
        ),
      );
    },
  );
}

for (
  const hookName of [
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findOneAndRemove",
  ]
) {
  try {
    LoanAuditSchema.pre(
      hookName,
      function preventAuditDelete(next) {
        next(
          new Error(
            "Loan audit records cannot be deleted.",
          ),
        );
      },
    );
  } catch {
    /**
     * Compatibility with Mongoose versions that do not expose every legacy
     * middleware hook.
     */
  }
}

/**
 * ============================================================================
 * STATIC FACTORY
 * ============================================================================
 */

LoanAuditSchema.statics.createEvent =
  async function createEvent(
    payload,
    options = {},
  ) {
    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      throw new TypeError(
        "Loan audit payload is required.",
      );
    }

    if (
      !payload.tenantId
    ) {
      throw new Error(
        "tenantId is required for a loan audit event.",
      );
    }

    if (
      !payload.loanId
    ) {
      throw new Error(
        "loanId is required for a loan audit event.",
      );
    }

    if (
      !payload.eventId
    ) {
      /**
       * Server-generated event identity.
       */
      payload = {
        ...payload,
        eventId:
          crypto.randomUUID(),
      };
    }

    /**
     * Determine next sequence number.
     *
     * This lookup is intentionally not sufficient by itself for distributed
     * concurrency. The compound unique index below remains the database-level
     * concurrency guard.
     */
    const latest =
      await this.findOne({
        tenantId:
          payload.tenantId,

        loanId:
          payload.loanId,
      })
        .sort({
          sequence: -1,
        })
        .select({
          sequence: 1,
          integrityHash: 1,
        })
        .lean();

    const sequence =
      payload.sequence ??
      (
        latest
          ? Number(
              latest.sequence,
            ) + 1
          : 1
      );

    const previousHash =
      payload.previousHash ??
      (
        latest
          ? latest.integrityHash
          : null
      );

    const document =
      new this({
        ...payload,
        sequence,
        previousHash,
      });

    try {
      return await document.save({
        session:
          options.session,
      });
    } catch (error) {
      /**
       * Duplicate event IDs are idempotent.
       */
      if (
        error?.code === 11000
      ) {
        const existing =
          await this.findOne({
            tenantId:
              payload.tenantId,

            eventId:
              payload.eventId,
          });

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  };

/**
 * ============================================================================
 * STATIC FINDERS
 * ============================================================================
 */

LoanAuditSchema.statics.findByLoan =
  function findByLoan(
    tenantId,
    loanId,
    options = {},
  ) {
    if (
      !tenantId ||
      !loanId
    ) {
      throw new Error(
        "tenantId and loanId are required.",
      );
    }

    const query = {
      tenantId,
      loanId,
    };

    if (
      options.action
    ) {
      query.action =
        options.action;
    }

    if (
      options.category
    ) {
      query.category =
        options.category;
    }

    if (
      options.actorId
    ) {
      query.actorId =
        options.actorId;
    }

    if (
      options.from ||
      options.to
    ) {
      query.occurredAt = {};

      if (
        options.from
      ) {
        query.occurredAt.$gte =
          normalizeDate(
            options.from,
          );
      }

      if (
        options.to
      ) {
        query.occurredAt.$lte =
          normalizeDate(
            options.to,
          );
      }
    }

    return this.find(query)
      .sort({
        sequence: 1,
        occurredAt: 1,
        _id: 1,
      });
  };

LoanAuditSchema.statics.findByEventId =
  function findByEventId(
    tenantId,
    eventId,
  ) {
    if (
      !tenantId ||
      !eventId
    ) {
      return null;
    }

    return this.findOne({
      tenantId,
      eventId,
    });
  };

LoanAuditSchema.statics.findFinancialEvents =
  function findFinancialEvents(
    tenantId,
    loanId,
  ) {
    const query = {
      tenantId,
      loanId,

      $or: [
        {
          financialImpact: true,
        },
        {
          transactionId: {
            $ne: null,
          },
        },
        {
          ledgerReference: {
            $ne: null,
          },
        },
      ],
    };

    return this.find(query)
      .sort({
        occurredAt: 1,
        sequence: 1,
        _id: 1,
      });
  };

LoanAuditSchema.statics.findWorkflowHistory =
  function findWorkflowHistory(
    tenantId,
    loanId,
  ) {
    return this.find({
      tenantId,
      loanId,
      category: "WORKFLOW",
    }).sort({
      sequence: 1,
      occurredAt: 1,
      _id: 1,
    });
  };

LoanAuditSchema.statics.findCritical =
  function findCritical(
    tenantId,
    options = {},
  ) {
    const query = {
      tenantId,
      severity: "CRITICAL",
    };

    if (
      options.action
    ) {
      query.action =
        options.action;
    }

    if (
      options.from ||
      options.to
    ) {
      query.occurredAt = {};

      if (
        options.from
      ) {
        query.occurredAt.$gte =
          normalizeDate(
            options.from,
          );
      }

      if (
        options.to
      ) {
        query.occurredAt.$lte =
          normalizeDate(
            options.to,
          );
      }
    }

    return this.find(query)
      .sort({
        occurredAt: -1,
        sequence: -1,
        _id: -1,
      });
  };

/**
 * ============================================================================
 * STATIC INTEGRITY VERIFICATION
 * ============================================================================
 *
 * Verifies the hash chain for a specific loan.
 *
 * This detects application-level tampering or accidental mutation, but should
 * not be mistaken for an independently trusted external audit repository.
 */

LoanAuditSchema.statics.verifyIntegrity =
  async function verifyIntegrity(
    tenantId,
    loanId,
  ) {
    const records =
      await this.find({
        tenantId,
        loanId,
      })
        .sort({
          sequence: 1,
          _id: 1,
        })
        .lean();

    let expectedPreviousHash =
      null;

    for (
      const record of records
    ) {
      if (
        record.previousHash !==
        expectedPreviousHash
      ) {
        return {
          valid: false,
          reason:
            "previousHash mismatch",
          sequence:
            record.sequence,
          eventId:
            record.eventId,
        };
      }

      const expectedPayloadHash =
        createPayloadHash({
          action:
            record.action,

          category:
            record.category,

          severity:
            record.severity,

          before:
            record.before,

          after:
            record.after,

          changes:
            record.changes,

          reason:
            record.reason,

          metadata:
            record.metadata,
        });

      if (
        expectedPayloadHash !==
        record.payloadHash
      ) {
        return {
          valid: false,
          reason:
            "payloadHash mismatch",
          sequence:
            record.sequence,
          eventId:
            record.eventId,
        };
      }

      const expectedIntegrityHash =
        createIntegrityHash({
          previousHash:
            record.previousHash,

          tenantId:
            record.tenantId,

          loanId:
            record.loanId,

          action:
            record.action,

          actorType:
            record.actorType,

          actorId:
            record.actorId,

          occurredAt:
            record.occurredAt,

          sequence:
            record.sequence,

          payloadHash:
            record.payloadHash,
        });

      if (
        expectedIntegrityHash !==
        record.integrityHash
      ) {
        return {
          valid: false,
          reason:
            "integrityHash mismatch",
          sequence:
            record.sequence,
          eventId:
            record.eventId,
        };
      }

      expectedPreviousHash =
        record.integrityHash;
    }

    return {
      valid: true,
      recordsChecked:
        records.length,
    };
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Loan audit chronology.
 */
LoanAuditSchema.index(
  {
    tenantId: 1,
    loanId: 1,
    sequence: 1,
  },
  {
    unique: true,
    name: "uq_loan_audit_tenant_loan_sequence",
  },
);

/**
 * Idempotent event identity.
 */
LoanAuditSchema.index(
  {
    tenantId: 1,
    eventId: 1,
  },
  {
    unique: true,
    name: "uq_loan_audit_tenant_event",
  },
);

/**
 * Loan chronological history.
 */
LoanAuditSchema.index({
  tenantId: 1,
  loanId: 1,
  occurredAt: -1,
});

/**
 * Workflow reporting.
 */
LoanAuditSchema.index({
  tenantId: 1,
  category: 1,
  action: 1,
  occurredAt: -1,
});

/**
 * Actor activity.
 */
LoanAuditSchema.index({
  tenantId: 1,
  actorId: 1,
  occurredAt: -1,
});

/**
 * Transaction linkage.
 */
LoanAuditSchema.index({
  tenantId: 1,
  transactionId: 1,
  occurredAt: -1,
});

/**
 * Ledger linkage.
 */
LoanAuditSchema.index({
  tenantId: 1,
  ledgerReference: 1,
  occurredAt: -1,
});

/**
 * Correlation tracing.
 */
LoanAuditSchema.index({
  tenantId: 1,
  correlationId: 1,
  occurredAt: -1,
});

/**
 * Request tracing.
 */
LoanAuditSchema.index({
  tenantId: 1,
  requestId: 1,
  occurredAt: -1,
});

/**
 * Severity monitoring.
 */
LoanAuditSchema.index({
  tenantId: 1,
  severity: 1,
  occurredAt: -1,
});

/**
 * Financial audit queue/reporting.
 */
LoanAuditSchema.index({
  tenantId: 1,
  financialImpact: 1,
  occurredAt: -1,
});

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

const LoanAudit =
  mongoose.models.LoanAudit ||
  mongoose.model(
    "LoanAudit",
    LoanAuditSchema,
  );

export {
  LoanAudit,
  LoanAuditSchema,
  SnapshotSchema,
  ChangeSchema,
};

export default LoanAudit;