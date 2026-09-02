"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Reconciliation.js
 *
 * Purpose:
 *   Enterprise-grade financial reconciliation aggregate.
 *
 * Architectural Role:
 *
 *   External Provider
 *          │
 *          ▼
 *   Provider Transactions
 *          │
 *          ├──────────────┐
 *          ▼              │
 *   Reconciliation Engine │
 *          │              │
 *          ▼              ▼
 *   Internal Transactions / Ledger
 *          │
 *          ▼
 *   Reconciliation Result
 *          │
 *          ├── Matched
 *          ├── Missing Internal
 *          ├── Missing Provider
 *          ├── Mismatched
 *          └── Duplicate
 *
 * IMPORTANT:
 *
 *   Reconciliation is an operational control record.
 *
 *   It is NOT the financial ledger and MUST NOT directly mutate balances.
 *
 *   Financial balances remain authoritative in the double-entry ledger.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const PROVIDERS = [
    "MTN_MOMO",
    "AIRTEL_MONEY",
    "STRIPE",
    "PAYPAL",
    "LEDGER",
    "MANUAL",
    "ALL",
];

const RECONCILIATION_STATUSES = [
    "PENDING",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "PARTIAL",
    "CANCELLED",
];

const RECONCILIATION_TYPES = [
    "DAILY",
    "INTRADAY",
    "WEEKLY",
    "MONTHLY",
    "MANUAL",
    "BACKFILL",
    "ON_DEMAND",
];

const EXCEPTION_TYPES = [
    "MISSING_INTERNAL",
    "MISSING_PROVIDER",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "STATUS_MISMATCH",
    "REFERENCE_MISMATCH",
    "DUPLICATE_PROVIDER",
    "DUPLICATE_INTERNAL",
    "DATE_MISMATCH",
    "ACCOUNT_MISMATCH",
    "MEMBER_MISMATCH",
    "UNKNOWN",
];

const EXCEPTION_STATUSES = [
    "OPEN",
    "INVESTIGATING",
    "RESOLVED",
    "WAIVED",
];

const MAX_REFERENCE_LENGTH = 256;
const MAX_STATUS_LENGTH = 128;
const MAX_METADATA_SIZE = 10000;

/**
 * =============================================================================
 * MONEY SCHEMA
 * =============================================================================
 *
 * Financial reconciliation must not depend on JavaScript floating-point
 * arithmetic.
 */

const MoneySchema = new Schema(
    {
        amount: {
            type: Schema.Types.Decimal128,
            required: true,
            default: () =>
                mongoose.Types.Decimal128.fromString("0.00"),
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            maxlength: 10,
        },
    },
    {
        _id: false,
        id: false,
    }
);

/**
 * =============================================================================
 * TRANSACTION SNAPSHOT
 * =============================================================================
 *
 * A snapshot captures the transaction as it existed when reconciliation ran.
 *
 * Do not use this snapshot as a substitute for the authoritative transaction
 * or ledger record.
 */

const TransactionSnapshotSchema = new Schema(
    {
        transactionId: {
            type: Schema.Types.ObjectId,
            default: null,
        },

        referenceId: {
            type: String,
            trim: true,
            maxlength: MAX_REFERENCE_LENGTH,
            index: true,
        },

        providerTransactionId: {
            type: String,
            trim: true,
            maxlength: MAX_REFERENCE_LENGTH,
        },

        providerReference: {
            type: String,
            trim: true,
            maxlength: MAX_REFERENCE_LENGTH,
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
            ref: "User",
            default: null,
        },

        groupId: {
            type: Schema.Types.ObjectId,
            ref: "Group",
            default: null,
        },

        paymentId: {
            type: Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },

        paymentIntentId: {
            type: Schema.Types.ObjectId,
            ref: "PaymentIntent",
            default: null,
        },

        amount: {
            type: Schema.Types.Decimal128,
            default: () =>
                mongoose.Types.Decimal128.fromString("0.00"),
        },

        currency: {
            type: String,
            uppercase: true,
            trim: true,
            maxlength: 10,
        },

        status: {
            type: String,
            trim: true,
            maxlength: MAX_STATUS_LENGTH,
        },

        transactionDate: {
            type: Date,
        },

        settledAt: {
            type: Date,
        },

        metadata: {
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
 * MATCHED TRANSACTION
 * =============================================================================
 */

const MatchedTransactionSchema = new Schema(
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
            trim: true,
            maxlength: 128,
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
    }
);

/**
 * =============================================================================
 * MISMATCH RECORD
 * =============================================================================
 */

const MismatchSchema = new Schema(
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
            trim: true,
            maxlength: 2000,
            required: true,
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
            default: "OPEN",
        },

        resolvedAt: {
            type: Date,
            default: null,
        },

        resolvedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        resolutionNote: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
    },
    {
        _id: true,
        id: true,
    }
);

/**
 * =============================================================================
 * RECONCILIATION SUMMARY
 * =============================================================================
 */

const SummarySchema = new Schema(
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
                mongoose.Types.Decimal128.fromString("0.00"),
        },
    },
    {
        _id: false,
        id: false,
    }
);

/**
 * =============================================================================
 * MAIN RECONCILIATION SCHEMA
 * =============================================================================
 */

const ReconciliationSchema = new Schema(
    {
        /**
         * ---------------------------------------------------------------------
         * Tenant
         * ---------------------------------------------------------------------
         */

        tenantId: {
            type: Schema.Types.ObjectId,
            ref: "Tenant",
            required: true,
            immutable: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Reconciliation Identity
         * ---------------------------------------------------------------------
         */

        reconciliationId: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            minlength: 8,
            maxlength: MAX_REFERENCE_LENGTH,
        },

        /**
         * ---------------------------------------------------------------------
         * Provider
         * ---------------------------------------------------------------------
         */

        provider: {
            type: String,
            required: true,
            enum: PROVIDERS,
            uppercase: true,
            trim: true,
            immutable: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Reconciliation Type
         * ---------------------------------------------------------------------
         */

        type: {
            type: String,
            enum: RECONCILIATION_TYPES,
            default: "ON_DEMAND",
            required: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Period
         * ---------------------------------------------------------------------
         *
         * Explicit periods prevent ambiguity when running daily/monthly
         * reconciliation jobs.
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
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Execution State
         * ---------------------------------------------------------------------
         */

        status: {
            type: String,
            enum: RECONCILIATION_STATUSES,
            default: "PENDING",
            required: true,
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
            min: 0,
            default: null,
        },

        /**
         * ---------------------------------------------------------------------
         * Transaction Counts
         * ---------------------------------------------------------------------
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

        /**
         * ---------------------------------------------------------------------
         * Transaction Amount Totals
         * ---------------------------------------------------------------------
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
                mongoose.Types.Decimal128.fromString("0.00"),
        },

        /**
         * ---------------------------------------------------------------------
         * Results
         * ---------------------------------------------------------------------
         */

        matched: {
            type: [MatchedTransactionSchema],
            default: undefined,
        },

        missingInternal: {
            type: [TransactionSnapshotSchema],
            default: undefined,
        },

        missingProvider: {
            type: [TransactionSnapshotSchema],
            default: undefined,
        },

        duplicates: {
            type: [TransactionSnapshotSchema],
            default: undefined,
        },

        mismatches: {
            type: [MismatchSchema],
            default: undefined,
        },

        summary: {
            type: SummarySchema,
            default: () => ({}),
        },

        /**
         * ---------------------------------------------------------------------
         * Balance / Control Result
         * ---------------------------------------------------------------------
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

        /**
         * ---------------------------------------------------------------------
         * Execution Identity
         * ---------------------------------------------------------------------
         */

        generatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        generatedByService: {
            type: String,
            trim: true,
            maxlength: 128,
            default: null,
        },

        executionId: {
            type: String,
            trim: true,
            maxlength: MAX_REFERENCE_LENGTH,
            default: null,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Approval
         * ---------------------------------------------------------------------
         *
         * Reconciliation approval is separate from reconciliation execution.
         */

        requiresApproval: {
            type: Boolean,
            default: false,
        },

        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        approvedAt: {
            type: Date,
            default: null,
        },

        approvalNote: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },

        /**
         * ---------------------------------------------------------------------
         * Failure
         * ---------------------------------------------------------------------
         */

        error: {
            code: {
                type: String,
                trim: true,
                maxlength: 128,
                default: null,
            },

            message: {
                type: String,
                trim: true,
                maxlength: 2000,
                default: null,
            },

            occurredAt: {
                type: Date,
                default: null,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Audit / Operational Notes
         * ---------------------------------------------------------------------
         */

        notes: {
            type: String,
            trim: true,
            maxlength: 5000,
            default: null,
        },

        metadata: {
            type: Schema.Types.Mixed,
            default: undefined,
        },

        /**
         * ---------------------------------------------------------------------
         * Soft Delete
         * ---------------------------------------------------------------------
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
            ref: "User",
            default: null,
        },

        deleteReason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
    },
    {
        timestamps: true,

        versionKey: false,

        collection: "reconciliations",

        strict: true,

        minimize: true,
    }
);

/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 */

/**
 * Tenant reconciliation history.
 */
ReconciliationSchema.index({
    tenantId: 1,
    reconciliationDate: -1,
});

/**
 * Provider reconciliation history.
 */
ReconciliationSchema.index({
    tenantId: 1,
    provider: 1,
    reconciliationDate: -1,
});

/**
 * Operational status.
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
 * Period lookup.
 */
ReconciliationSchema.index({
    tenantId: 1,
    provider: 1,
    periodStart: 1,
    periodEnd: 1,
});

/**
 * Execution tracking.
 */
ReconciliationSchema.index({
    executionId: 1,
});

/**
 * Prevent duplicate reconciliation runs for the same tenant/provider/period.
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
        },
        name: "uniq_active_reconciliation_period",
    }
);

/**
 * =============================================================================
 * VIRTUALS
 * =============================================================================
 */

ReconciliationSchema.virtual("hasExceptions").get(
    function () {
        return this.exceptionCount > 0;
    }
);

ReconciliationSchema.virtual("isComplete").get(
    function () {
        return [
            "COMPLETED",
            "PARTIAL",
        ].includes(this.status);
    }
);

ReconciliationSchema.virtual("isTerminal").get(
    function () {
        return [
            "COMPLETED",
            "PARTIAL",
            "FAILED",
            "CANCELLED",
        ].includes(this.status);
    }
);

/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

ReconciliationSchema.query.active = function () {
    return this.where({
        isDeleted: false,
    });
};

ReconciliationSchema.query.balanced = function () {
    return this.where({
        isBalanced: true,
        isDeleted: false,
    });
};

ReconciliationSchema.query.withExceptions = function () {
    return this.where({
        isBalanced: false,
        exceptionCount: {
            $gt: 0,
        },
        isDeleted: false,
    });
};

ReconciliationSchema.query.completed = function () {
    return this.where({
        status: "COMPLETED",
        isDeleted: false,
    });
};

ReconciliationSchema.query.forTenant = function (
    tenantId
) {
    return this.where({
        tenantId,
        isDeleted: false,
    });
};

/**
 * =============================================================================
 * INSTANCE METHODS
 * =============================================================================
 */

/**
 * Calculate exception count from the summary.
 */
ReconciliationSchema.methods.calculateExceptionCount =
    function () {
        this.exceptionCount =
            (this.summary?.missingInternal || 0) +
            (this.summary?.missingProvider || 0) +
            (this.summary?.mismatches || 0) +
            (this.summary?.duplicates || 0);

        return this.exceptionCount;
    };

/**
 * Mark reconciliation as running.
 */
ReconciliationSchema.methods.markRunning =
    function () {
        if (this.isTerminal) {
            throw new Error(
                `Cannot start reconciliation in ${this.status} state`
            );
        }

        this.status = "RUNNING";
        this.startedAt =
            this.startedAt || new Date();

        return this.save();
    };

/**
 * Mark reconciliation as completed.
 */
ReconciliationSchema.methods.markCompleted =
    function () {
        const now = new Date();

        this.calculateExceptionCount();

        this.status =
            this.exceptionCount > 0
                ? "PARTIAL"
                : "COMPLETED";

        this.completedAt = now;

        if (this.startedAt) {
            this.durationMs =
                Math.max(
                    0,
                    now.getTime() -
                        this.startedAt.getTime()
                );
        }

        this.isBalanced =
            this.exceptionCount === 0;

        return this.save();
    };

/**
 * Mark reconciliation as failed.
 */
ReconciliationSchema.methods.markFailed =
    function ({
        code = "RECONCILIATION_FAILED",
        message = "Reconciliation failed",
    } = {}) {
        const now = new Date();

        this.status = "FAILED";
        this.failedAt = now;

        this.error = {
            code,
            message,
            occurredAt: now,
        };

        if (this.startedAt) {
            this.durationMs =
                Math.max(
                    0,
                    now.getTime() -
                        this.startedAt.getTime()
                );
        }

        return this.save();
    };

/**
 * Cancel reconciliation.
 */
ReconciliationSchema.methods.cancel =
    function (reason = null) {
        if (this.isTerminal) {
            throw new Error(
                `Cannot cancel reconciliation in ${this.status} state`
            );
        }

        const now = new Date();

        this.status = "CANCELLED";
        this.cancelledAt = now;

        if (reason) {
            this.error = {
                code: "RECONCILIATION_CANCELLED",
                message: reason,
                occurredAt: now,
            };
        }

        return this.save();
    };

/**
 * Approve reconciliation.
 */
ReconciliationSchema.methods.approve =
    function ({
        approvedBy,
        note = null,
    } = {}) {
        if (!approvedBy) {
            throw new Error(
                "approvedBy is required"
            );
        }

        if (
            ![
                "COMPLETED",
                "PARTIAL",
            ].includes(this.status)
        ) {
            throw new Error(
                "Only completed reconciliations can be approved"
            );
        }

        this.approvedBy = approvedBy;
        this.approvedAt = new Date();
        this.approvalNote = note;

        return this.save();
    };

/**
 * Mark soft deleted.
 */
ReconciliationSchema.methods.softDelete =
    function ({
        deletedBy = null,
        reason = null,
    } = {}) {
        this.isDeleted = true;
        this.deletedAt = new Date();
        this.deletedBy = deletedBy;
        this.deleteReason = reason;

        return this.save();
    };

/**
 * =============================================================================
 * STATIC METHODS
 * =============================================================================
 */

/**
 * Find balanced reconciliations.
 */
ReconciliationSchema.statics.findBalanced =
    function (tenantId, options = {}) {
        const query = {
            tenantId,
            isBalanced: true,
            isDeleted: false,
        };

        if (options.provider) {
            query.provider =
                options.provider;
        }

        return this.find(query).sort({
            reconciliationDate: -1,
        });
    };

/**
 * Find reconciliations containing exceptions.
 */
ReconciliationSchema.statics.findExceptions =
    function (tenantId, options = {}) {
        const query = {
            tenantId,
            exceptionCount: {
                $gt: 0,
            },
            isDeleted: false,
        };

        if (options.provider) {
            query.provider =
                options.provider;
        }

        return this.find(query).sort({
            reconciliationDate: -1,
        });
    };

/**
 * Find a reconciliation for an exact period.
 */
ReconciliationSchema.statics.findForPeriod =
    function ({
        tenantId,
        provider,
        periodStart,
        periodEnd,
        type,
    }) {
        return this.findOne({
            tenantId,
            provider,
            periodStart,
            periodEnd,
            type,
            isDeleted: false,
        });
    };

/**
 * Atomically claim a pending reconciliation.
 *
 * This protects against two workers processing the same reconciliation.
 */
ReconciliationSchema.statics.claimForProcessing =
    function (reconciliationId) {
        const now = new Date();

        return this.findOneAndUpdate(
            {
                reconciliationId,
                status: "PENDING",
                isDeleted: false,
            },
            {
                $set: {
                    status: "RUNNING",
                    startedAt: now,
                },
            },
            {
                new: true,
            }
        );
    };

/**
 * =============================================================================
 * VALIDATION
 * =============================================================================
 */

ReconciliationSchema.pre(
    "validate",
    function (next) {
        /**
         * Normalize provider.
         */
        if (this.provider) {
            this.provider =
                this.provider
                    .trim()
                    .toUpperCase();
        }

        /**
         * Period validation.
         */
        if (
            this.periodStart &&
            this.periodEnd &&
            this.periodEnd <= this.periodStart
        ) {
            this.invalidate(
                "periodEnd",
                "periodEnd must be later than periodStart"
            );
        }

        /**
         * Completion validation.
         */
        if (
            this.status === "COMPLETED" &&
            !this.completedAt
        ) {
            this.completedAt =
                new Date();
        }

        /**
         * Failure validation.
         */
        if (
            this.status === "FAILED" &&
            !this.failedAt
        ) {
            this.failedAt =
                new Date();
        }

        /**
         * Running validation.
         */
        if (
            this.status === "RUNNING" &&
            !this.startedAt
        ) {
            this.startedAt =
                new Date();
        }

        /**
         * Exception count must reflect the summary.
         */
        this.calculateExceptionCount();

        /**
         * A reconciliation can only be balanced if there are no exceptions.
         */
        if (this.exceptionCount > 0) {
            this.isBalanced = false;
        }

        /**
         * Approval requires approval mode.
         */
        if (
            this.approvedBy &&
            !this.requiresApproval
        ) {
            this.requiresApproval = true;
        }

        /**
         * Prevent invalid approval state.
         */
        if (
            this.approvedBy &&
            !this.approvedAt
        ) {
            this.approvedAt =
                new Date();
        }

        next();
    }
);

/**
 * =============================================================================
 * SOFT DELETE QUERY PROTECTION
 * =============================================================================
 */

ReconciliationSchema.pre(
    /^find/,
    function (next) {
        const options =
            this.getOptions();

        if (!options.includeDeleted) {
            this.where({
                isDeleted: false,
            });
        }

        next();
    }
);

/**
 * =============================================================================
 * SERIALIZATION
 * =============================================================================
 */

ReconciliationSchema.set(
    "toJSON",
    {
        virtuals: true,
        transform: (_doc, ret) => {
            /**
             * Decimal128 values are converted to strings rather than Numbers.
             */
            if (
                ret.differenceTotal
            ) {
                ret.differenceTotal =
                    ret.differenceTotal.toString();
            }

            if (
                ret.summary?.differenceAmount
            ) {
                ret.summary.differenceAmount =
                    ret.summary
                        .differenceAmount
                        .toString();
            }

            if (
                ret.providerTotal?.amount
            ) {
                ret.providerTotal.amount =
                    ret.providerTotal.amount
                        .toString();
            }

            if (
                ret.internalTotal?.amount
            ) {
                ret.internalTotal.amount =
                    ret.internalTotal.amount
                        .toString();
            }

            /**
             * Convert nested transaction monetary values.
             */
            const collections = [
                "matched",
                "missingInternal",
                "missingProvider",
                "duplicates",
                "mismatches",
            ];

            for (
                const collection
                of collections
            ) {
                if (
                    !Array.isArray(
                        ret[collection]
                    )
                ) {
                    continue;
                }

                for (
                    const item
                    of ret[collection]
                ) {
                    const snapshots = [
                        item.provider,
                        item.internal,
                    ];

                    for (
                        const snapshot
                        of snapshots
                    ) {
                        if (
                            snapshot?.amount
                        ) {
                            snapshot.amount =
                                snapshot.amount
                                    .toString();
                        }
                    }

                    if (
                        item.expectedAmount
                    ) {
                        item.expectedAmount =
                            item.expectedAmount
                                .toString();
                    }

                    if (
                        item.actualAmount
                    ) {
                        item.actualAmount =
                            item.actualAmount
                                .toString();
                    }

                    if (
                        item.differenceAmount
                    ) {
                        item.differenceAmount =
                            item.differenceAmount
                                .toString();
                    }
                }
            }

            return ret;
        },
    }
);

/**
 * =============================================================================
 * MODEL EXPORT
 * =============================================================================
 */

module.exports =
    mongoose.models.Reconciliation ||
    mongoose.model(
        "Reconciliation",
        ReconciliationSchema
    );