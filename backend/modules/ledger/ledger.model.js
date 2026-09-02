
/**
 * ============================================================================
 * TITech Community Capital LTD
 * Ledger Model
 * ============================================================================
 *
 * File:
 * models/Ledger.js
 *
 * Enterprise Double-Entry Ledger Record
 *
 * Responsibilities:
 *   - Store immutable financial ledger transactions.
 *   - Enforce tenant isolation.
 *   - Preserve monetary precision using Decimal128.
 *   - Support idempotent financial references.
 *   - Support optimistic concurrency.
 *   - Support controlled soft deletion.
 *   - Provide operational query indexes.
 *
 * IMPORTANT:
 *   Financial amounts remain Decimal128 internally and are serialized as
 *   strings to prevent IEEE-754 floating-point precision loss.
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const {
    Schema
} = mongoose;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const LEDGER_STATUS = Object.freeze({

    POSTED:
        'posted',

    PENDING:
        'pending',

    CANCELED:
        'canceled'

});

const CURRENCY_PATTERN =
    /^[A-Z]{3}$/;

const ACCOUNT_PATTERN =
    /^[A-Za-z0-9_.:/-]{1,128}$/;

/**
 * ============================================================================
 * Ledger Schema
 * ============================================================================
 */

const LedgerSchema = new Schema(

    {

        /**
         * --------------------------------------------------------------------
         * Tenant Ownership
         * --------------------------------------------------------------------
         *
         * Every financial record must belong to exactly one tenant.
         */

        tenantId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            index:
                true,

            immutable:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Source Transaction
         * --------------------------------------------------------------------
         *
         * Links this ledger record to the originating transaction.
         */

        transactionId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            index:
                true,

            immutable:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Debit Account
         * --------------------------------------------------------------------
         */

        debitAccount: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            match: [

                ACCOUNT_PATTERN,

                'Invalid debit account identifier'

            ],

            index:
                true,

            immutable:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Credit Account
         * --------------------------------------------------------------------
         */

        creditAccount: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            match: [

                ACCOUNT_PATTERN,

                'Invalid credit account identifier'

            ],

            index:
                true,

            immutable:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Monetary Amount
         * --------------------------------------------------------------------
         *
         * Decimal128 is mandatory for financial precision.
         */

        amount: {

            type:
                Schema.Types.Decimal128,

            required:
                true,

            validate: {

                validator:
                    function validateAmount(value) {

                        if (
                            value === null ||
                            value === undefined
                        ) {

                            return false;

                        }

                        try {

                            return (
                                value.toString() !== 'NaN' &&
                                Number(
                                    value.toString()
                                ) > 0
                            );

                        } catch {

                            return false;

                        }

                    },

                message:
                    'Amount must be a positive financial amount'

            }

        },

        /**
         * --------------------------------------------------------------------
         * Currency
         * --------------------------------------------------------------------
         */

        currency: {

            type:
                String,

            required:
                true,

            default:
                'UGX',

            uppercase:
                true,

            trim:
                true,

            minlength:
                3,

            maxlength:
                3,

            match: [

                CURRENCY_PATTERN,

                'Currency must be a 3-letter ISO currency code'

            ],

            immutable:
                true,

            index:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Ledger Status
         * --------------------------------------------------------------------
         */

        status: {

            type:
                String,

            enum:
                Object.values(
                    LEDGER_STATUS
                ),

            default:
                LEDGER_STATUS.POSTED,

            required:
                true,

            index:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Financial Reference / Idempotency Identity
         * --------------------------------------------------------------------
         *
         * Reference is tenant-scoped rather than globally unique.
         *
         * This permits two separate tenants to legitimately use the same
         * external reference.
         */

        reference: {

            type:
                String,

            trim:
                true,

            maxlength:
                128,

            index:
                true,

            immutable:
                true

        },

        /**
         * --------------------------------------------------------------------
         * Description
         * --------------------------------------------------------------------
         */

        description: {

            type:
                String,

            trim:
                true,

            maxlength:
                1024

        },

        /**
         * --------------------------------------------------------------------
         * Operational Metadata
         * --------------------------------------------------------------------
         *
         * Provider-specific or workflow metadata.
         */

        metadata: {

            type:
                Schema.Types.Mixed,

            default:
                {}

        },

        /**
         * --------------------------------------------------------------------
         * Soft Deletion
         * --------------------------------------------------------------------
         *
         * Financial records should normally never be physically deleted.
         */

        deletedAt: {

            type:
                Date,

            default:
                null,

            index:
                true

        }

    },

    {

        timestamps:
            true,

        /**
         * Optimistic concurrency.
         */

        versionKey:
            'version',

        optimisticConcurrency:
            true,

        strict:
            true,

        minimize:
            false,

        toJSON: {

            getters:
                true,

            virtuals:
                true,

            transform:
                ledgerJSONTransform

        },

        toObject: {

            getters:
                true,

            virtuals:
                true,

            transform:
                ledgerObjectTransform

        }

    }

);

/**
 * ============================================================================
 * Compound Indexes
 * ============================================================================
 */

/**
 * Tenant financial lookup.
 */

LedgerSchema.index({

    tenantId:
        1,

    status:
        1,

    deletedAt:
        1,

    createdAt:
        -1

});

/**
 * Tenant account activity.
 */

LedgerSchema.index({

    tenantId:
        1,

    debitAccount:
        1,

    createdAt:
        -1

});

LedgerSchema.index({

    tenantId:
        1,

    creditAccount:
        1,

    createdAt:
        -1

});

/**
 * Tenant transaction lookup.
 */

LedgerSchema.index({

    tenantId:
        1,

    transactionId:
        1

});

/**
 * Tenant-scoped idempotency reference.
 *
 * Sparse means records without a reference are allowed.
 */

LedgerSchema.index(

    {

        tenantId:
            1,

        reference:
            1

    },

    {

        unique:
            true,

        sparse:
            true,

        name:
            'ledger_tenant_reference_unique'

    }

);

/**
 * Tenant + currency operational reporting.
 */

LedgerSchema.index({

    tenantId:
        1,

    currency:
        1,

    status:
        1,

    deletedAt:
        1

});

/**
 * ============================================================================
 * Validation Hooks
 * ============================================================================
 */

/**
 * Prevent an account from being both debit and credit.
 *
 * This model represents a simple two-sided ledger transaction. Complex
 * multi-line journals should be represented through Journal / JournalEntry
 * records rather than abusing this model.
 */

LedgerSchema.pre(
    'validate',
    function ledgerValidation(next) {

        if (
            this.debitAccount &&
            this.creditAccount &&
            this.debitAccount === this.creditAccount
        ) {

            return next(
                new Error(
                    'Debit and credit accounts must be different'
                )
            );

        }

        next();

    }
);

/**
 * ============================================================================
 * Financial Immutability Protection
 * ============================================================================
 *
 * Posted financial records should not have their accounting identity changed.
 *
 * These fields are protected through schema-level immutability:
 *
 *   tenantId
 *   transactionId
 *   debitAccount
 *   creditAccount
 *   amount
 *   currency
 *   reference
 *
 * Status changes remain possible for controlled lifecycle operations.
 */

/**
 * ============================================================================
 * Decimal Serialization
 * ============================================================================
 *
 * NEVER convert financial Decimal128 values to Number automatically.
 *
 * JavaScript Number uses IEEE-754 floating-point representation and can
 * introduce precision loss for financial amounts.
 *
 * Example:
 *
 *     Decimal128("100.10") -> "100.10"
 *
 * rather than:
 *
 *     Decimal128("100.10") -> 100.1
 */

function decimal128ToString(value) {

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

    return String(value);

}

/**
 * ============================================================================
 * JSON Transform
 * ============================================================================
 */

function ledgerJSONTransform(doc, ret) {

    if (
        ret.amount !== undefined &&
        ret.amount !== null
    ) {

        ret.amount =
            decimal128ToString(
                ret.amount
            );

    }

    /**
     * Mongoose internal version key is represented by our `version` field.
     *
     * Do not expose legacy __v if present.
     */

    delete ret.__v;

    return ret;

}

/**
 * ============================================================================
 * Object Transform
 * ============================================================================
 */

function ledgerObjectTransform(doc, ret) {

    if (
        ret.amount !== undefined &&
        ret.amount !== null
    ) {

        ret.amount =
            decimal128ToString(
                ret.amount
            );

    }

    delete ret.__v;

    return ret;

}

/**
 * ============================================================================
 * Instance Methods
 * ============================================================================
 */

/**
 * Determine whether the ledger record has been soft deleted.
 */

LedgerSchema.methods.isDeleted =
    function isDeleted() {

        return Boolean(
            this.deletedAt
        );

    };

/**
 * Soft-delete a ledger record.
 *
 * NOTE:
 * Financial applications should generally prefer reversal entries over
 * deleting posted accounting records. This method is retained for controlled
 * administrative/data-retention workflows.
 */

LedgerSchema.methods.softDelete =
    async function softDelete() {

        if (
            !this.deletedAt
        ) {

            this.deletedAt =
                new Date();

            await this.save();

        }

        return this;

    };

/**
 * Determine whether this ledger record is posted.
 */

LedgerSchema.methods.isPosted =
    function isPosted() {

        return (
            this.status ===
            LEDGER_STATUS.POSTED
        );

    };

/**
 * Determine whether this ledger record is pending.
 */

LedgerSchema.methods.isPending =
    function isPending() {

        return (
            this.status ===
            LEDGER_STATUS.PENDING
        );

    };

/**
 * Determine whether this ledger record is canceled.
 */

LedgerSchema.methods.isCanceled =
    function isCanceled() {

        return (
            this.status ===
            LEDGER_STATUS.CANCELED
        );

    };

/**
 * ============================================================================
 * Static Methods
 * ============================================================================
 */

/**
 * Find a tenant-scoped financial reference.
 */

LedgerSchema.statics.findByTenantReference =
    function findByTenantReference(

        tenantId,

        reference

    ) {

        return this.findOne({

            tenantId,

            reference,

            deletedAt:
                null

        });

    };

/**
 * Find a tenant-scoped source transaction.
 */

LedgerSchema.statics.findByTenantTransaction =
    function findByTenantTransaction(

        tenantId,

        transactionId

    ) {

        return this.findOne({

            tenantId,

            transactionId,

            deletedAt:
                null

        });

    };

/**
 * ============================================================================
 * Model Export
 * ============================================================================
 *
 * Defensive model registration prevents OverwriteModelError during application
 * reloads, tests and development hot reloads.
 */

const Ledger =
    mongoose.models.Ledger ||
    mongoose.model(
        'Ledger',
        LedgerSchema
    );

/**
 * Export constants for service-layer usage without changing the model API.
 */

Ledger.STATUS =
    LEDGER_STATUS;

module.exports =
    Ledger;