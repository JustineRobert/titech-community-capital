'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Loan Audit Model
 * =============================================================================
 *
 * File:
 *   backend/models/LoanAudit.js
 *
 * Purpose:
 *   Immutable, tenant-aware audit trail for all loan-related activities.
 *
 * Design principles:
 *   - Append-only audit records.
 *   - Tenant isolation.
 *   - Explicit actor identity.
 *   - Explicit affected user identity.
 *   - Financial amounts represented safely.
 *   - Idempotent audit-event support.
 *   - Structured before/after change snapshots.
 *   - Bounded query operations.
 *   - Transaction/session aware persistence.
 *   - No silent persistence failures.
 *
 * =============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema,
} = mongoose;

// =============================================================================
// Constants
// =============================================================================

const AUDIT_ACTIONS = Object.freeze([
    'eligibility_assessed',
    'eligibility_overridden',

    'loan_applied',
    'loan_approved',
    'loan_rejected',

    'loan_disbursed',

    'payment_recorded',

    'penalty_applied',

    'loan_defaulted',

    'loan_restructured',

    'loan_completed',

    'loan_status_changed',
]);

const ACTOR_ROLES = Object.freeze([
    'user',
    'admin',
    'group_admin',
    'system',
]);

const AUDIT_STATUSES = Object.freeze([
    'success',
    'failed',
    'pending',
]);

const RISK_LEVELS = Object.freeze([
    'low',
    'medium',
    'high',
]);

const MAX_DESCRIPTION_LENGTH = 1000;

const MAX_REASON_LENGTH = 1000;

const MAX_IP_ADDRESS_LENGTH = 128;

const MAX_USER_AGENT_LENGTH = 1000;

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

const MAX_CORRELATION_ID_LENGTH = 128;

const MAX_REQUEST_ID_LENGTH = 128;

const MAX_LIMIT = 200;

const DEFAULT_LIMIT = 50;

// =============================================================================
// Utility
// =============================================================================

function normalizeLimit(
    limit,
    defaultValue = DEFAULT_LIMIT
) {
    const numericLimit = Number(limit);

    if (
        !Number.isFinite(numericLimit) ||
        numericLimit <= 0
    ) {
        return defaultValue;
    }

    return Math.min(
        Math.floor(numericLimit),
        MAX_LIMIT
    );
}

// =============================================================================
// Schema
// =============================================================================

const loanAuditSchema = new Schema(
    {
        // ---------------------------------------------------------------------
        // Tenant
        // ---------------------------------------------------------------------

        tenantId: {
            type: String,
            required: true,
            index: true,
            trim: true,
            maxlength: 128,
        },

        // ---------------------------------------------------------------------
        // Audit Event Identity
        // ---------------------------------------------------------------------

        eventId: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            index: true,
            trim: true,
            maxlength: 128,
        },

        idempotencyKey: {
            type: String,
            required: false,
            immutable: true,
            index: true,
            trim: true,
            maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
        },

        correlationId: {
            type: String,
            required: false,
            immutable: true,
            index: true,
            trim: true,
            maxlength: MAX_CORRELATION_ID_LENGTH,
        },

        requestId: {
            type: String,
            required: false,
            immutable: true,
            index: true,
            trim: true,
            maxlength: MAX_REQUEST_ID_LENGTH,
        },

        // ---------------------------------------------------------------------
        // Action Identifier
        // ---------------------------------------------------------------------

        action: {
            type: String,
            enum: AUDIT_ACTIONS,
            required: true,
            immutable: true,
            index: true,
        },

        // ---------------------------------------------------------------------
        // Loan Reference
        // ---------------------------------------------------------------------

        loan: {
            type: Schema.Types.ObjectId,
            ref: 'Loan',
            required: false,
            immutable: true,
            index: true,
        },

        // ---------------------------------------------------------------------
        // User Affected By Action
        // ---------------------------------------------------------------------

        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            immutable: true,
            index: true,
        },

        // ---------------------------------------------------------------------
        // Group Context
        // ---------------------------------------------------------------------

        group: {
            type: Schema.Types.ObjectId,
            ref: 'Group',
            required: false,
            immutable: true,
            index: true,
        },

        // ---------------------------------------------------------------------
        // Actor
        // ---------------------------------------------------------------------

        actor: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            immutable: true,
            index: true,
        },

        actorRole: {
            type: String,
            enum: ACTOR_ROLES,
            required: true,
            immutable: true,
        },

        // ---------------------------------------------------------------------
        // Change Snapshot
        // ---------------------------------------------------------------------

        changes: {
            before: {
                type: Schema.Types.Mixed,
                immutable: true,
            },

            after: {
                type: Schema.Types.Mixed,
                immutable: true,
            },
        },

        // ---------------------------------------------------------------------
        // Human-Readable Description
        // ---------------------------------------------------------------------

        description: {
            type: String,
            trim: true,
            maxlength: MAX_DESCRIPTION_LENGTH,
            immutable: true,
        },

        // ---------------------------------------------------------------------
        // Financial Amount
        // ---------------------------------------------------------------------

        /**
         * Decimal128 is used instead of Number for monetary audit values.
         *
         * The model intentionally does not impose a currency conversion or
         * accounting policy here. It records the exact monetary value supplied
         * by the financial workflow.
         */
        amount: {
            type: Schema.Types.Decimal128,
            default: null,
            immutable: true,
        },

        currency: {
            type: String,
            trim: true,
            uppercase: true,
            match: /^[A-Z]{3}$/,
            default: 'UGX',
            immutable: true,
        },

        // ---------------------------------------------------------------------
        // Metadata
        // ---------------------------------------------------------------------

        metadata: {
            ipAddress: {
                type: String,
                trim: true,
                maxlength: MAX_IP_ADDRESS_LENGTH,
                immutable: true,
            },

            userAgent: {
                type: String,
                trim: true,
                maxlength: MAX_USER_AGENT_LENGTH,
                immutable: true,
            },

            reason: {
                type: String,
                trim: true,
                maxlength: MAX_REASON_LENGTH,
                immutable: true,
            },

            score: {
                type: Number,
                immutable: true,
            },

            riskLevel: {
                type: String,
                enum: RISK_LEVELS,
                immutable: true,
            },
        },

        // ---------------------------------------------------------------------
        // Operation Status
        // ---------------------------------------------------------------------

        status: {
            type: String,
            enum: AUDIT_STATUSES,
            default: 'success',
            required: true,
            immutable: true,
            index: true,
        },

        // ---------------------------------------------------------------------
        // Error Details
        // ---------------------------------------------------------------------

        error: {
            message: {
                type: String,
                trim: true,
                maxlength: MAX_DESCRIPTION_LENGTH,
                immutable: true,
            },

            code: {
                type: String,
                trim: true,
                maxlength: 128,
                immutable: true,
            },
        },
    },
    {
        timestamps: true,
        versionKey: false,
        strict: true,
        minimize: false,
    }
);

// =============================================================================
// Compound Indexes
// =============================================================================

loanAuditSchema.index({
    tenantId: 1,
    user: 1,
    createdAt: -1,
});

loanAuditSchema.index({
    tenantId: 1,
    loan: 1,
    createdAt: -1,
});

loanAuditSchema.index({
    tenantId: 1,
    action: 1,
    createdAt: -1,
});

loanAuditSchema.index({
    tenantId: 1,
    actor: 1,
    createdAt: -1,
});

loanAuditSchema.index({
    tenantId: 1,
    status: 1,
    createdAt: -1,
});

// Useful for recovering/replaying an idempotent workflow.
loanAuditSchema.index({
    tenantId: 1,
    idempotencyKey: 1,
});

// =============================================================================
// Immutability Protection
// =============================================================================

/**
 * Mongoose's `immutable` paths protect normal document updates, but an
 * enterprise audit trail should also reject update/delete operations.
 *
 * Audit records are append-only.
 */

const immutableOperationError = () => {
    const error = new Error(
        'Loan audit records are immutable and cannot be modified or deleted.'
    );

    error.code = 'LOAN_AUDIT_IMMUTABLE';
    error.statusCode = 409;

    return error;
};

loanAuditSchema.pre(
    'updateOne',
    function rejectUpdate() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'updateMany',
    function rejectUpdate() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'findOneAndUpdate',
    function rejectUpdate() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'replaceOne',
    function rejectUpdate() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'deleteOne',
    function rejectDelete() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'deleteMany',
    function rejectDelete() {
        throw immutableOperationError();
    }
);

loanAuditSchema.pre(
    'findOneAndDelete',
    function rejectDelete() {
        throw immutableOperationError();
    }
);

// =============================================================================
// Validation Hooks
// =============================================================================

loanAuditSchema.pre(
    'validate',
    function validateAuditDocument(next) {
        if (
            !this.tenantId ||
            typeof this.tenantId !== 'string'
        ) {
            return next(
                new Error(
                    'tenantId is required for loan audit records.'
                )
            );
        }

        if (
            !this.eventId ||
            typeof this.eventId !== 'string'
        ) {
            return next(
                new Error(
                    'eventId is required for loan audit records.'
                )
            );
        }

        return next();
    }
);

// =============================================================================
// Static Methods
// =============================================================================

/**
 * Create an audit entry.
 *
 * Important:
 *   Errors are deliberately propagated.
 *
 * A financial workflow must be able to decide whether an audit failure should
 * abort its transaction. Silently swallowing the failure makes compliance
 * events disappear without the caller knowing.
 */
loanAuditSchema.statics.logAction = async function ({
    tenantId,
    eventId,
    idempotencyKey,
    correlationId,
    requestId,

    action,

    loan,
    user,
    group,

    actor,
    actorRole,

    changes,
    description,

    amount,
    currency = 'UGX',

    metadata = {},

    status = 'success',
    error = null,

    session = null,
} = {}) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required to create a loan audit entry.'
        );
    }

    if (!eventId) {
        throw new Error(
            'eventId is required to create a loan audit entry.'
        );
    }

    const payload = {
        tenantId,
        eventId,
        idempotencyKey,
        correlationId,
        requestId,

        action,

        loan,
        user,
        group,

        actor,
        actorRole,

        changes,
        description,

        amount,
        currency,

        metadata,

        status,
        error,
    };

    const audit = new this(payload);

    await audit.save(
        session
            ? { session }
            : undefined
    );

    return audit;
};

/**
 * Find an existing audit event by idempotency key.
 */
loanAuditSchema.statics.findByIdempotencyKey =
    async function (
        tenantId,
        idempotencyKey
    ) {
        if (
            !tenantId ||
            !idempotencyKey
        ) {
            return null;
        }

        return this.findOne({
            tenantId,
            idempotencyKey,
        }).sort({
            createdAt: -1,
        });
    };

/**
 * Get the audit trail for a specific loan.
 *
 * Tenant ID is mandatory to prevent cross-tenant access.
 */
loanAuditSchema.statics.getLoanTrail =
    async function (
        tenantId,
        loanId,
        {
            limit = DEFAULT_LIMIT,
            session = null,
        } = {}
    ) {
        if (!tenantId) {
            throw new Error(
                'tenantId is required.'
            );
        }

        if (!loanId) {
            throw new Error(
                'loanId is required.'
            );
        }

        const query = this.find({
            tenantId,
            loan: loanId,
        })
            .populate(
                'actor',
                'name email role'
            )
            .populate(
                'user',
                'name email'
            )
            .sort({
                createdAt: 1,
            })
            .limit(
                normalizeLimit(limit)
            );

        if (session) {
            query.session(session);
        }

        return query.exec();
    };

/**
 * Get a user's loan activity.
 *
 * Tenant ID is mandatory.
 */
loanAuditSchema.statics.getUserActivity =
    async function (
        tenantId,
        userId,
        limit = DEFAULT_LIMIT
    ) {
        if (!tenantId) {
            throw new Error(
                'tenantId is required.'
            );
        }

        if (!userId) {
            throw new Error(
                'userId is required.'
            );
        }

        return this.find({
            tenantId,
            user: userId,
        })
            .populate(
                'actor',
                'name email role'
            )
            .populate(
                'loan',
                'amount status'
            )
            .sort({
                createdAt: -1,
            })
            .limit(
                normalizeLimit(limit)
            )
            .exec();
    };

// =============================================================================
// Model
// =============================================================================

const LoanAudit =
    mongoose.models.LoanAudit ||
    mongoose.model(
        'LoanAudit',
        loanAuditSchema
    );

module.exports = LoanAudit;