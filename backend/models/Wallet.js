'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Wallet Model
 * ============================================================================
 *
 * File:
 *   backend/models/Wallet.js
 *
 * Purpose:
 *   Canonical stored-value wallet for the TITech Community Capital platform.
 *
 * Design Goals:
 *   - Multi-tenant financial isolation
 *   - Decimal128 monetary precision
 *   - Atomic concurrent credit/debit operations
 *   - Optimistic concurrency protection
 *   - Idempotency support
 *   - Audit-ready wallet metadata
 *   - Soft deletion / archival
 *   - Wallet lifecycle controls
 *   - Safe financial invariants
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Wallet balances are financial state.
 *
 * Do NOT perform ordinary JavaScript floating-point arithmetic against
 * Decimal128 values.
 *
 * Financial mutations should preferably use the atomic static methods:
 *
 *   Wallet.atomicCredit(...)
 *   Wallet.atomicDebit(...)
 *
 * These methods perform the balance mutation directly in MongoDB and are
 * therefore safer under concurrent workers than:
 *
 *   find wallet -> modify in memory -> save
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const WALLET_STATUSES = Object.freeze([
    'active',
    'frozen',
    'suspended',
    'closed'
]);

const DEFAULT_CURRENCY = 'UGX';

const MONEY_PATTERN = /^\d+(\.\d{1,18})?$/;

const MAX_METADATA_KEYS = 100;

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

/**
 * Convert a monetary input into a canonical Decimal128-safe string.
 *
 * We intentionally do not use parseFloat() because JavaScript Number is not
 * safe for arbitrary financial precision.
 *
 * @param {number|string|mongoose.Types.Decimal128} value
 * @returns {string}
 */
function normalizeMoney(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return '0';
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {
        return value.toString();
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(
                'Monetary amount must be a finite number'
            );
        }

        if (!Number.isSafeInteger(value)) {
            /**
             * Decimal128 can represent more precision than JavaScript
             * Number can safely preserve.
             *
             * Accept numbers for normal application use, but reject values
             * that are clearly unsafe integer representations.
             */
            if (
                Math.abs(value) >=
                Number.MAX_SAFE_INTEGER
            ) {
                throw new TypeError(
                    'Monetary amount exceeds JavaScript safe integer range; use a string'
                );
            }
        }

        return String(value);
    }

    if (typeof value !== 'string') {
        throw new TypeError(
            'Monetary amount must be a string, number, or Decimal128'
        );
    }

    const normalized = value.trim();

    if (!MONEY_PATTERN.test(normalized)) {
        throw new TypeError(
            'Invalid monetary amount'
        );
    }

    return normalized;
}

/**
 * Convert money to Decimal128.
 *
 * @param {number|string|Decimal128} value
 * @returns {mongoose.Types.Decimal128}
 */
function toDecimal128(value) {
    return mongoose.Types.Decimal128.fromString(
        normalizeMoney(value)
    );
}

/**
 * Validate a positive monetary amount.
 *
 * @param {*} amount
 */
function assertPositiveAmount(amount) {
    const decimal = toDecimal128(amount);

    if (
        decimal.toString() === '0' ||
        decimal.toString().startsWith('-')
    ) {
        throw new RangeError(
            'Amount must be greater than zero'
        );
    }

    return decimal;
}

/**
 * Safely convert Decimal128 to a string.
 *
 * Financial APIs should generally return monetary values as strings rather
 * than JavaScript floating-point numbers.
 *
 * @param {mongoose.Types.Decimal128} value
 * @returns {string}
 */
function decimalToString(value) {
    if (value === null || value === undefined) {
        return '0';
    }

    return value.toString();
}

/**
 * ============================================================================
 * WALLET SCHEMA
 * ============================================================================
 */

const WalletSchema = new Schema(
    {
        /**
         * ====================================================================
         * OWNERSHIP / MULTI-TENANCY
         * ====================================================================
         */

        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            immutable: true,
            index: true
        },

        tenantId: {
            type: Schema.Types.ObjectId,
            ref: 'Tenant',
            required: true,
            immutable: true,
            index: true
        },

        /**
         * ====================================================================
         * WALLET IDENTIFICATION
         * ====================================================================
         */

        walletNumber: {
            type: String,
            trim: true,
            uppercase: true,
            immutable: true,
            sparse: true,
            index: true
        },

        /**
         * ====================================================================
         * FINANCIAL BALANCE
         * ====================================================================
         *
         * Decimal128 is mandatory for stored monetary state.
         */

        balance: {
            type: Schema.Types.Decimal128,
            required: true,
            default: () =>
                mongoose.Types.Decimal128.fromString('0'),

            validate: {
                validator(value) {
                    if (!value) {
                        return true;
                    }

                    return !value
                        .toString()
                        .startsWith('-');
                },

                message:
                    'Wallet balance cannot be negative'
            }
        },

        currency: {
            type: String,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
            minlength: 3,
            maxlength: 3,

            validate: {
                validator(value) {
                    return /^[A-Z]{3}$/.test(value);
                },

                message:
                    'Currency must be a valid ISO 4217 code'
            }
        },

        /**
         * ====================================================================
         * LIFECYCLE
         * ====================================================================
         */

        status: {
            type: String,
            enum: WALLET_STATUSES,
            default: 'active',
            required: true,
            index: true
        },

        /**
         * ====================================================================
         * FINANCIAL ACTIVITY
         * ====================================================================
         */

        lastTransactionAt: {
            type: Date,
            default: null,
            index: true
        },

        lastCreditAt: {
            type: Date,
            default: null
        },

        lastDebitAt: {
            type: Date,
            default: null
        },

        totalCredits: {
            type: Schema.Types.Decimal128,
            default: () =>
                mongoose.Types.Decimal128.fromString('0')
        },

        totalDebits: {
            type: Schema.Types.Decimal128,
            default: () =>
                mongoose.Types.Decimal128.fromString('0')
        },

        transactionCount: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * ====================================================================
         * IDEMPOTENCY / PROCESSING
         * ====================================================================
         *
         * These fields are optional wallet-level coordination metadata.
         *
         * The authoritative transaction idempotency key should still normally
         * live on the transaction/payment record.
         */

        lastMutationReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * ====================================================================
         * OPERATIONAL METADATA
         * ====================================================================
         */

        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        },

        /**
         * ====================================================================
         * AUDIT
         * ====================================================================
         */

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * ====================================================================
         * SOFT DELETE / ARCHIVAL
         * ====================================================================
         */

        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        deletedAt: {
            type: Date,
            default: null,
            index: true
        },

        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        }
    },

    {
        timestamps: true,

        /**
         * Optimistic concurrency.
         *
         * This helps detect conflicting document saves. Atomic monetary
         * mutations below additionally use MongoDB conditional updates.
         */
        optimisticConcurrency: true,

        versionKey: '__v',

        toJSON: {
            virtuals: true,

            /**
             * Financial values are exposed as strings to prevent accidental
             * JavaScript floating-point conversion.
             */
            transform(doc, ret) {
                ret.id = ret._id.toString();

                if (ret.balance !== undefined) {
                    ret.balance =
                        decimalToString(ret.balance);
                }

                if (ret.totalCredits !== undefined) {
                    ret.totalCredits =
                        decimalToString(
                            ret.totalCredits
                        );
                }

                if (ret.totalDebits !== undefined) {
                    ret.totalDebits =
                        decimalToString(
                            ret.totalDebits
                        );
                }

                delete ret._id;

                return ret;
            }
        },

        toObject: {
            virtuals: true,

            transform(doc, ret) {
                ret.id = ret._id.toString();

                if (ret.balance !== undefined) {
                    ret.balance =
                        decimalToString(ret.balance);
                }

                if (ret.totalCredits !== undefined) {
                    ret.totalCredits =
                        decimalToString(
                            ret.totalCredits
                        );
                }

                if (ret.totalDebits !== undefined) {
                    ret.totalDebits =
                        decimalToString(
                            ret.totalDebits
                        );
                }

                delete ret._id;

                return ret;
            }
        }
    }
);

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * One wallet per user per tenant.
 *
 * This is a critical financial invariant.
 */
WalletSchema.index(
    {
        tenantId: 1,
        userId: 1
    },
    {
        unique: true,
        name: 'uniq_wallet_tenant_user'
    }
);

/**
 * Wallet lookup by tenant and status.
 */
WalletSchema.index({
    tenantId: 1,
    status: 1,
    isDeleted: 1
});

/**
 * Operational transaction activity.
 */
WalletSchema.index({
    tenantId: 1,
    lastTransactionAt: -1
});

/**
 * Wallet number lookup.
 */
WalletSchema.index({
    tenantId: 1,
    walletNumber: 1
});

/**
 * Currency-specific wallet queries.
 */
WalletSchema.index({
    tenantId: 1,
    currency: 1
});

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

WalletSchema.virtual('isActive').get(function () {
    return (
        this.status === 'active' &&
        !this.isDeleted
    );
});

WalletSchema.virtual('isFrozen').get(function () {
    return this.status === 'frozen';
});

WalletSchema.virtual('isSuspended').get(function () {
    return this.status === 'suspended';
});

WalletSchema.virtual('isClosed').get(function () {
    return this.status === 'closed';
});

/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Check whether wallet is operational.
 */
WalletSchema.methods.assertOperational =
    function () {
        if (this.isDeleted) {
            throw new Error(
                'Wallet is deleted'
            );
        }

        if (this.status !== 'active') {
            throw new Error(
                `Wallet is not active: ${this.status}`
            );
        }

        return true;
    };

/**
 * Freeze wallet.
 */
WalletSchema.methods.freeze =
    async function (updatedBy = null) {
        this.status = 'frozen';

        if (updatedBy) {
            this.updatedBy = updatedBy;
        }

        return this.save();
    };

/**
 * Activate wallet.
 */
WalletSchema.methods.activate =
    async function (updatedBy = null) {
        if (this.isDeleted) {
            throw new Error(
                'Deleted wallet cannot be activated'
            );
        }

        this.status = 'active';

        if (updatedBy) {
            this.updatedBy = updatedBy;
        }

        return this.save();
    };

/**
 * Suspend wallet.
 */
WalletSchema.methods.suspend =
    async function (updatedBy = null) {
        this.status = 'suspended';

        if (updatedBy) {
            this.updatedBy = updatedBy;
        }

        return this.save();
    };

/**
 * Close wallet.
 *
 * A wallet should normally only be closed when its balance is zero.
 */
WalletSchema.methods.close =
    async function (updatedBy = null) {
        const balance = toDecimal128(
            this.balance
        );

        if (balance.toString() !== '0') {
            throw new Error(
                'Wallet balance must be zero before closure'
            );
        }

        this.status = 'closed';

        if (updatedBy) {
            this.updatedBy = updatedBy;
        }

        return this.save();
    };

/**
 * Soft delete wallet.
 */
WalletSchema.methods.softDelete =
    async function (deletedBy = null) {
        this.isDeleted = true;
        this.deletedAt = new Date();
        this.status = 'closed';

        if (deletedBy) {
            this.deletedBy = deletedBy;
            this.updatedBy = deletedBy;
        }

        return this.save();
    };

/**
 * ============================================================================
 * ATOMIC FINANCIAL METHODS
 * ============================================================================
 *
 * These methods are intentionally static.
 *
 * NEVER use:
 *
 *   wallet.balance += amount
 *   wallet.save()
 *
 * for concurrent financial workers.
 *
 * Instead use atomicCredit / atomicDebit.
 */

/**
 * Atomic credit.
 *
 * MongoDB performs:
 *
 *   balance = balance + amount
 *
 * atomically.
 *
 * @param {Object} options
 * @param {ObjectId|string} options.walletId
 * @param {ObjectId|string} options.tenantId
 * @param {number|string} options.amount
 * @param {string} [options.reference]
 * @param {ObjectId|string} [options.updatedBy]
 * @param {Object} [options.session]
 */
WalletSchema.statics.atomicCredit =
    async function ({
        walletId,
        tenantId,
        amount,
        reference = null,
        updatedBy = null,
        session = null
    }) {
        const creditAmount =
            assertPositiveAmount(amount);

        const now = new Date();

        const filter = {
            _id: walletId,
            tenantId,
            status: 'active',
            isDeleted: false
        };

        const update = {
            $inc: {
                balance: creditAmount,
                totalCredits: creditAmount,
                transactionCount: 1
            },

            $set: {
                lastTransactionAt: now,
                lastCreditAt: now,
                ...(reference !== null
                    ? {
                          lastMutationReference:
                              reference
                      }
                    : {}),
                ...(updatedBy
                    ? { updatedBy }
                    : {})
            }
        };

        const options = {
            new: true,
            runValidators: true
        };

        if (session) {
            options.session = session;
        }

        const wallet =
            await this.findOneAndUpdate(
                filter,
                update,
                options
            );

        if (!wallet) {
            throw new Error(
                'Active wallet not found for atomic credit'
            );
        }

        return wallet;
    };

/**
 * Atomic debit.
 *
 * Critically, the query includes:
 *
 *   balance >= amount
 *
 * Therefore two concurrent workers cannot both successfully debit the same
 * funds when only one sufficient balance exists.
 */
WalletSchema.statics.atomicDebit =
    async function ({
        walletId,
        tenantId,
        amount,
        reference = null,
        updatedBy = null,
        session = null
    }) {
        const debitAmount =
            assertPositiveAmount(amount);

        const now = new Date();

        const filter = {
            _id: walletId,
            tenantId,
            status: 'active',
            isDeleted: false,

            /**
             * MongoDB Decimal128 comparison.
             */
            balance: {
                $gte: debitAmount
            }
        };

        const update = {
            $inc: {
                balance:
                    mongoose.Types.Decimal128.fromString(
                        `-${debitAmount.toString()}`
                    ),

                totalDebits: debitAmount,

                transactionCount: 1
            },

            $set: {
                lastTransactionAt: now,
                lastDebitAt: now,

                ...(reference !== null
                    ? {
                          lastMutationReference:
                              reference
                      }
                    : {}),

                ...(updatedBy
                    ? { updatedBy }
                    : {})
            }
        };

        const options = {
            new: true,
            runValidators: true
        };

        if (session) {
            options.session = session;
        }

        const wallet =
            await this.findOneAndUpdate(
                filter,
                update,
                options
            );

        if (!wallet) {
            throw new Error(
                'Insufficient funds, inactive wallet, deleted wallet, or wallet not found'
            );
        }

        return wallet;
    };

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Find wallet by tenant and user.
 */
WalletSchema.statics.findByUser =
    function (tenantId, userId) {
        return this.findOne({
            tenantId,
            userId,
            isDeleted: false
        });
    };

/**
 * Find wallet by wallet number.
 */
WalletSchema.statics.findByWalletNumber =
    function (
        tenantId,
        walletNumber
    ) {
        return this.findOne({
            tenantId,
            walletNumber:
                String(walletNumber)
                    .trim()
                    .toUpperCase(),
            isDeleted: false
        });
    };

/**
 * Find active wallet.
 */
WalletSchema.statics.findActive =
    function (
        tenantId,
        userId
    ) {
        return this.findOne({
            tenantId,
            userId,
            status: 'active',
            isDeleted: false
        });
    };

/**
 * ============================================================================
 * MIDDLEWARE
 * ============================================================================
 */

/**
 * Normalize currency and enforce balance invariants before save.
 */
WalletSchema.pre(
    'save',
    function (next) {
        try {
            if (this.currency) {
                this.currency =
                    this.currency
                        .trim()
                        .toUpperCase();
            }

            /**
             * Normalize Decimal128 fields.
             */
            if (this.balance !== undefined) {
                this.balance =
                    toDecimal128(
                        this.balance
                    );
            }

            if (
                this.totalCredits !==
                undefined
            ) {
                this.totalCredits =
                    toDecimal128(
                        this.totalCredits
                    );
            }

            if (
                this.totalDebits !==
                undefined
            ) {
                this.totalDebits =
                    toDecimal128(
                        this.totalDebits
                    );
            }

            /**
             * Enforce financial invariants.
             */
            const balance =
                toDecimal128(
                    this.balance
                );

            if (
                balance.toString()
                    .startsWith('-')
            ) {
                return next(
                    new Error(
                        'Wallet balance cannot be negative'
                    )
                );
            }

            const credits =
                toDecimal128(
                    this.totalCredits
                );

            const debits =
                toDecimal128(
                    this.totalDebits
                );

            if (
                credits
                    .toString()
                    .startsWith('-') ||
                debits
                    .toString()
                    .startsWith('-')
            ) {
                return next(
                    new Error(
                        'Wallet aggregate totals cannot be negative'
                    )
                );
            }

            /**
             * Metadata guard.
             */
            if (
                this.metadata &&
                typeof this.metadata ===
                    'object' &&
                !Array.isArray(
                    this.metadata
                )
            ) {
                const keys =
                    Object.keys(
                        this.metadata
                    );

                if (
                    keys.length >
                    MAX_METADATA_KEYS
                ) {
                    return next(
                        new Error(
                            `Wallet metadata cannot contain more than ${MAX_METADATA_KEYS} keys`
                        )
                    );
                }
            }

            next();
        } catch (error) {
            next(error);
        }
    }
);

/**
 * ============================================================================
 * QUERY HELPERS
 * ============================================================================
 */

WalletSchema.query.active =
    function () {
        return this.where({
            status: 'active',
            isDeleted: false
        });
    };

WalletSchema.query.forTenant =
    function (tenantId) {
        return this.where({
            tenantId
        });
    };

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

const Wallet =
    mongoose.models.Wallet ||
    mongoose.model(
        'Wallet',
        WalletSchema
    );

module.exports = Wallet;

/**
 * Export constants for service/test reuse without changing the default model
 * export contract.
 */
module.exports.WALLET_STATUSES =
    WALLET_STATUSES;

module.exports.DEFAULT_CURRENCY =
    DEFAULT_CURRENCY;

module.exports.normalizeMoney =
    normalizeMoney;

module.exports.toDecimal128 =
    toDecimal128;