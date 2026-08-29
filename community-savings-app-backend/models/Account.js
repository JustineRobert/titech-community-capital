'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE ACCOUNT MODEL
 * ============================================================================
 *
 * File:
 *   backend/models/Account.js
 *
 * Purpose:
 *   Enterprise financial account model for the TITech Community Capital
 *   multi-tenant SACCO / community-finance platform.
 *
 * Supported Accounts
 * ----------------------------------------------------------------------------
 *   SAVINGS
 *   SHARES
 *   FIXED_DEPOSIT
 *   LOAN
 *   WALLET
 *   SETTLEMENT
 *   GL
 *
 * Architectural Position
 * ----------------------------------------------------------------------------
 *
 *                  Transaction
 *                       |
 *                       v
 *                 Ledger Entry
 *                       |
 *                       v
 *                    Account
 *                       |
 *              +--------+--------+
 *              |                 |
 *              v                 v
 *          Current Balance   Reporting
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This model represents the operational account state.
 *
 * The authoritative accounting history should be maintained by the
 * double-entry ledger / ledger-entry subsystem.
 *
 * Account balances MUST NOT be changed casually from controllers.
 * Financial mutations should preferably occur through a transaction service
 * or ledger service using atomic database operations / MongoDB transactions.
 *
 * Production Features
 * ----------------------------------------------------------------------------
 * ✅ Multi-tenant isolation
 * ✅ Financial account classification
 * ✅ Double-entry ledger ready
 * ✅ Savings accounts
 * ✅ Shares accounts
 * ✅ Fixed deposits
 * ✅ Loan accounts
 * ✅ Wallet accounts
 * ✅ Settlement accounts
 * ✅ General ledger accounts
 * ✅ Monetary precision using Decimal128
 * ✅ Available / blocked balances
 * ✅ Loan exposure tracking
 * ✅ Account lifecycle controls
 * ✅ Compliance state
 * ✅ Reconciliation support
 * ✅ Accounting posting state
 * ✅ Audit metadata
 * ✅ Optimistic concurrency
 * ✅ Soft archival
 * ✅ Strict validation
 * ✅ Tenant-aware compound indexes
 * ✅ Safe JSON serialization
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const ACCOUNT_TYPES = [
    'SAVINGS',
    'SHARES',
    'FIXED_DEPOSIT',
    'LOAN',
    'WALLET',
    'SETTLEMENT',
    'GL'
];

const ACCOUNT_CATEGORIES = [
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'INCOME',
    'EXPENSE'
];

const ACCOUNT_STATUSES = [
    'PENDING',
    'ACTIVE',
    'DORMANT',
    'BLOCKED',
    'CLOSED'
];

const MOMO_PROVIDERS = [
    'MTN',
    'AIRTEL'
];

const DECIMAL_ZERO = '0.00';

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

/**
 * Convert a value safely into Decimal128.
 *
 * Decimal128 is used for persisted monetary values to avoid the rounding
 * problems associated with JavaScript Number.
 */
function toDecimal(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return mongoose.Types.Decimal128.fromString(DECIMAL_ZERO);
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {
        return value;
    }

    const numericValue = String(value).trim();

    if (!/^-?\d+(\.\d+)?$/.test(numericValue)) {
        throw new Error(
            `Invalid monetary value: ${numericValue}`
        );
    }

    return mongoose.Types.Decimal128.fromString(
        numericValue
    );
}

/**
 * Convert Decimal128 to a numeric value for compatibility with existing
 * application consumers.
 *
 * NOTE:
 * Financial calculations should preferably remain in Decimal128 form.
 */
function decimalToNumber(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return 0;
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {
        return Number(value.toString());
    }

    return Number(value);
}

/**
 * ============================================================================
 * ACCOUNT SCHEMA
 * ============================================================================
 */

const AccountSchema = new Schema(
    {
        /**
         * ====================================================================
         * MULTI-TENANCY
         * ====================================================================
         */

        tenantId: {
            type: String,
            required: [true, 'Tenant ID is required'],
            trim: true,
            minlength: 1,
            maxlength: 100,
            index: true
        },

        /**
         * ====================================================================
         * OWNERSHIP / RELATIONSHIPS
         * ====================================================================
         */

        member: {
            type: Schema.Types.ObjectId,
            ref: 'Member',
            default: null,
            index: true
        },

        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true
        },

        /**
         * ====================================================================
         * ACCOUNT IDENTIFICATION
         * ====================================================================
         */

        accountNumber: {
            type: String,
            required: [true, 'Account number is required'],
            trim: true,
            uppercase: true,
            minlength: 3,
            maxlength: 100
        },

        accountName: {
            type: String,
            required: [true, 'Account name is required'],
            trim: true,
            minlength: 2,
            maxlength: 200
        },

        /**
         * Optional external/core-banking reference.
         */
        externalReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * ====================================================================
         * ACCOUNT CLASSIFICATION
         * ====================================================================
         */

        accountType: {
            type: String,
            enum: ACCOUNT_TYPES,
            required: [true, 'Account type is required'],
            index: true
        },

        accountCategory: {
            type: String,
            enum: ACCOUNT_CATEGORIES,
            required: [true, 'Account category is required'],
            index: true
        },

        /**
         * ====================================================================
         * CURRENCY
         * ====================================================================
         */

        currency: {
            type: String,
            default: 'UGX',
            uppercase: true,
            trim: true,
            minlength: 3,
            maxlength: 3,
            match: [
                /^[A-Z]{3}$/,
                'Currency must be a valid ISO 4217 code'
            ]
        },

        /**
         * ====================================================================
         * BALANCES
         * ====================================================================
         *
         * Decimal128 is mandatory for persisted financial amounts.
         */

        balance: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        availableBalance: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        blockedBalance: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        accruedInterest: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        /**
         * Running total of credits posted to the account.
         */
        totalCredits: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        /**
         * Running total of debits posted to the account.
         */
        totalDebits: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        /**
         * Number of successfully posted financial transactions.
         */
        transactionCount: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * ====================================================================
         * LOAN ACCOUNT DATA
         * ====================================================================
         */

        outstandingPrincipal: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        outstandingInterest: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        penaltyBalance: {
            type: Schema.Types.Decimal128,
            default: DECIMAL_ZERO,
            min: 0
        },

        /**
         * ====================================================================
         * INTEREST
         * ====================================================================
         */

        interestRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },

        interestRateType: {
            type: String,
            enum: [
                'NONE',
                'FLAT',
                'REDUCING_BALANCE',
                'COMPOUND',
                'TIERED'
            ],
            default: 'NONE'
        },

        interestAccrualFrequency: {
            type: String,
            enum: [
                'NONE',
                'DAILY',
                'WEEKLY',
                'MONTHLY',
                'QUARTERLY',
                'ANNUALLY'
            ],
            default: 'NONE'
        },

        interestLastCalculatedAt: {
            type: Date,
            default: null
        },

        /**
         * ====================================================================
         * FIXED DEPOSIT
         * ====================================================================
         */

        maturityDate: {
            type: Date,
            default: null,
            index: true
        },

        openedAt: {
            type: Date,
            default: Date.now,
            immutable: true
        },

        /**
         * ====================================================================
         * MOBILE MONEY
         * ====================================================================
         */

        momoEnabled: {
            type: Boolean,
            default: false
        },

        momoProvider: {
            type: String,
            enum: MOMO_PROVIDERS,
            default: null
        },

        momoAccountNumber: {
            type: String,
            trim: true,
            maxlength: 30,
            default: null
        },

        momoVerified: {
            type: Boolean,
            default: false
        },

        /**
         * ====================================================================
         * RECONCILIATION
         * ====================================================================
         */

        reconciled: {
            type: Boolean,
            default: false,
            index: true
        },

        reconciledAt: {
            type: Date,
            default: null
        },

        reconciliationReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * ====================================================================
         * ACCOUNTING
         * ====================================================================
         */

        accountingPosted: {
            type: Boolean,
            default: false,
            index: true
        },

        accountingPostedAt: {
            type: Date,
            default: null
        },

        ledgerAccountCode: {
            type: String,
            trim: true,
            uppercase: true,
            maxlength: 100,
            default: null
        },

        ledgerReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * ====================================================================
         * COMPLIANCE
         * ====================================================================
         */

        kycVerified: {
            type: Boolean,
            default: false,
            index: true
        },

        amlChecked: {
            type: Boolean,
            default: false,
            index: true
        },

        sanctionsScreened: {
            type: Boolean,
            default: false,
            index: true
        },

        complianceReviewedAt: {
            type: Date,
            default: null
        },

        complianceReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * ====================================================================
         * RISK
         * ====================================================================
         */

        riskScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },

        riskFlagged: {
            type: Boolean,
            default: false,
            index: true
        },

        riskReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null
        },

        /**
         * ====================================================================
         * STATUS / LIFECYCLE
         * ====================================================================
         */

        status: {
            type: String,
            enum: ACCOUNT_STATUSES,
            default: 'ACTIVE',
            index: true
        },

        statusReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null
        },

        blockedAt: {
            type: Date,
            default: null
        },

        blockedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        closedAt: {
            type: Date,
            default: null
        },

        closedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * ====================================================================
         * TRANSACTION ACTIVITY
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

        auditReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * Application workflow version.
         *
         * Useful when financial workflows evolve without rewriting historical
         * account records.
         */
        workflowVersion: {
            type: Number,
            default: 1,
            min: 1
        },

        /**
         * Optimistic concurrency version.
         */
        revision: {
            type: Number,
            default: 0,
            min: 0
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
            default: null
        },

        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * ====================================================================
         * METADATA
         * ====================================================================
         *
         * Integration metadata should never be used for authoritative
         * accounting balances.
         */

        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true,

        /**
         * Disable Mongoose __v because revision is explicitly maintained.
         */
        versionKey: false,

        optimisticConcurrency: true,

        toJSON: {
            virtuals: true,
            getters: true,
            transform(doc, ret) {
                ret.id = ret._id
                    ? ret._id.toString()
                    : undefined;

                delete ret._id;

                return ret;
            }
        },

        toObject: {
            virtuals: true,
            getters: true
        }
    }
);

/**
 * ============================================================================
 * DECIMAL GETTERS
 * ============================================================================
 *
 * Getters make API responses convenient while MongoDB continues to persist
 * Decimal128 values.
 */

AccountSchema.path('balance').get(decimalToNumber);
AccountSchema.path('availableBalance').get(decimalToNumber);
AccountSchema.path('blockedBalance').get(decimalToNumber);
AccountSchema.path('accruedInterest').get(decimalToNumber);
AccountSchema.path('totalCredits').get(decimalToNumber);
AccountSchema.path('totalDebits').get(decimalToNumber);
AccountSchema.path('outstandingPrincipal').get(decimalToNumber);
AccountSchema.path('outstandingInterest').get(decimalToNumber);
AccountSchema.path('penaltyBalance').get(decimalToNumber);

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

/**
 * Account is operationally active.
 */
AccountSchema.virtual('isActive')
    .get(function () {
        return (
            this.status === 'ACTIVE' &&
            !this.isDeleted
        );
    });

/**
 * Account is dormant.
 */
AccountSchema.virtual('isDormant')
    .get(function () {
        return this.status === 'DORMANT';
    });

/**
 * Account is blocked.
 */
AccountSchema.virtual('isBlocked')
    .get(function () {
        return this.status === 'BLOCKED';
    });

/**
 * Account is closed.
 */
AccountSchema.virtual('isClosed')
    .get(function () {
        return this.status === 'CLOSED';
    });

/**
 * Total loan exposure.
 */
AccountSchema.virtual('totalExposure')
    .get(function () {
        return (
            decimalToNumber(this.outstandingPrincipal) +
            decimalToNumber(this.outstandingInterest) +
            decimalToNumber(this.penaltyBalance)
        );
    });

/**
 * Total funds that are not currently blocked.
 */
AccountSchema.virtual('calculatedAvailableBalance')
    .get(function () {
        const balance =
            decimalToNumber(this.balance);

        const blocked =
            decimalToNumber(this.blockedBalance);

        return Math.max(
            0,
            balance - blocked
        );
    });

/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

/**
 * Account ownership validation.
 *
 * Customer-owned accounts should normally have a member or user.
 * GL / settlement accounts may legitimately have neither.
 */
AccountSchema.pre('validate', function (next) {
    const customerAccountTypes = [
        'SAVINGS',
        'SHARES',
        'FIXED_DEPOSIT',
        'LOAN',
        'WALLET'
    ];

    if (
        customerAccountTypes.includes(this.accountType) &&
        !this.member &&
        !this.user
    ) {
        return next(
            new Error(
                'Customer financial accounts must belong to a member or user'
            )
        );
    }

    if (
        this.momoEnabled &&
        !this.momoProvider
    ) {
        return next(
            new Error(
                'MoMo provider is required when mobile money is enabled'
            )
        );
    }

    if (
        this.status === 'CLOSED' &&
        !this.closedAt
    ) {
        this.closedAt = new Date();
    }

    if (
        this.status !== 'CLOSED' &&
        this.closedAt
    ) {
        this.closedAt = null;
    }

    next();
});

/**
 * ============================================================================
 * PRE-SAVE FINANCIAL SAFETY
 * ============================================================================
 */

AccountSchema.pre('save', function (next) {
    try {
        /**
         * Normalize monetary fields.
         */
        const monetaryFields = [
            'balance',
            'availableBalance',
            'blockedBalance',
            'accruedInterest',
            'totalCredits',
            'totalDebits',
            'outstandingPrincipal',
            'outstandingInterest',
            'penaltyBalance'
        ];

        for (const field of monetaryFields) {
            if (
                this[field] !== undefined &&
                this[field] !== null
            ) {
                this[field] = toDecimal(
                    this[field]
                );
            }
        }

        /**
         * Account invariants.
         */
        const balance =
            decimalToNumber(this.balance);

        const available =
            decimalToNumber(
                this.availableBalance
            );

        const blocked =
            decimalToNumber(
                this.blockedBalance
            );

        if (balance < 0) {
            return next(
                new Error(
                    'Account balance cannot be negative'
                )
            );
        }

        if (blocked < 0) {
            return next(
                new Error(
                    'Blocked balance cannot be negative'
                )
            );
        }

        if (blocked > balance) {
            return next(
                new Error(
                    'Blocked balance cannot exceed account balance'
                )
            );
        }

        if (available < 0) {
            return next(
                new Error(
                    'Available balance cannot be negative'
                )
            );
        }

        if (available > balance) {
            this.availableBalance =
                this.balance;
        }

        /**
         * A deleted account should not remain operational.
         */
        if (
            this.isDeleted &&
            this.status !== 'CLOSED'
        ) {
            this.status = 'CLOSED';
        }

        /**
         * Revision increments whenever the document is persisted.
         */
        if (!this.isNew) {
            this.revision =
                Number(this.revision || 0) + 1;
        }

        next();
    } catch (error) {
        next(error);
    }
});

/**
 * ============================================================================
 * INSTANCE METHODS — LIFECYCLE
 * ============================================================================
 */

AccountSchema.methods.activate =
    async function (updatedBy = null) {
        if (this.isDeleted) {
            throw new Error(
                'Deleted accounts cannot be activated'
            );
        }

        if (this.status === 'CLOSED') {
            throw new Error(
                'Closed accounts cannot be activated'
            );
        }

        this.status = 'ACTIVE';
        this.statusReason = null;
        this.updatedBy = updatedBy;

        return this.save();
    };

AccountSchema.methods.markDormant =
    async function (
        reason = 'Account marked dormant',
        updatedBy = null
    ) {
        if (this.status === 'CLOSED') {
            throw new Error(
                'Closed accounts cannot be marked dormant'
            );
        }

        this.status = 'DORMANT';
        this.statusReason = reason;
        this.updatedBy = updatedBy;

        return this.save();
    };

AccountSchema.methods.block =
    async function (
        reason = 'Account blocked',
        updatedBy = null
    ) {
        if (this.status === 'CLOSED') {
            throw new Error(
                'Closed accounts cannot be blocked'
            );
        }

        this.status = 'BLOCKED';
        this.statusReason = reason;
        this.blockedAt = new Date();
        this.blockedBy = updatedBy;
        this.updatedBy = updatedBy;

        return this.save();
    };

AccountSchema.methods.close =
    async function (
        reason = 'Account closed',
        updatedBy = null
    ) {
        const balance =
            decimalToNumber(this.balance);

        const blocked =
            decimalToNumber(
                this.blockedBalance
            );

        if (balance !== 0) {
            throw new Error(
                'Account cannot be closed while balance is not zero'
            );
        }

        if (blocked !== 0) {
            throw new Error(
                'Account cannot be closed while funds are blocked'
            );
        }

        this.status = 'CLOSED';
        this.statusReason = reason;
        this.closedAt = new Date();
        this.closedBy = updatedBy;
        this.updatedBy = updatedBy;

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE METHODS — RECONCILIATION
 * ============================================================================
 */

AccountSchema.methods.markReconciled =
    async function (
        reference = null,
        updatedBy = null
    ) {
        this.reconciled = true;
        this.reconciledAt = new Date();
        this.reconciliationReference =
            reference;
        this.updatedBy = updatedBy;

        return this.save();
    };

AccountSchema.methods.markAccountingPosted =
    async function (
        ledgerReference = null,
        updatedBy = null
    ) {
        this.accountingPosted = true;
        this.accountingPostedAt =
            new Date();
        this.ledgerReference =
            ledgerReference;
        this.updatedBy = updatedBy;

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE METHODS — SAFE OPERATIONAL BALANCE HELPERS
 * ============================================================================
 *
 * IMPORTANT:
 * These helpers are intended for controlled service-layer usage.
 *
 * For concurrent financial operations, prefer atomic MongoDB updates or a
 * MongoDB transaction in the financial service rather than loading a document,
 * modifying it in memory, and saving it.
 */

/**
 * Credit account operationally.
 */
AccountSchema.methods.credit =
    async function (
        amount,
        updatedBy = null
    ) {
        const value = Number(amount);

        if (
            !Number.isFinite(value) ||
            value <= 0
        ) {
            throw new Error(
                'Credit amount must be greater than zero'
            );
        }

        this.balance =
            toDecimal(
                decimalToNumber(this.balance) +
                value
            );

        this.availableBalance =
            toDecimal(
                Math.max(
                    0,
                    decimalToNumber(
                        this.balance
                    ) -
                    decimalToNumber(
                        this.blockedBalance
                    )
                )
            );

        this.totalCredits =
            toDecimal(
                decimalToNumber(
                    this.totalCredits
                ) + value
            );

        this.transactionCount =
            Number(this.transactionCount || 0) + 1;

        this.lastTransactionAt =
            new Date();

        this.lastCreditAt =
            new Date();

        this.updatedBy =
            updatedBy;

        return this.save();
    };

/**
 * Debit account operationally.
 */
AccountSchema.methods.debit =
    async function (
        amount,
        updatedBy = null
    ) {
        const value = Number(amount);

        if (
            !Number.isFinite(value) ||
            value <= 0
        ) {
            throw new Error(
                'Debit amount must be greater than zero'
            );
        }

        const available =
            this.calculatedAvailableBalance;

        if (available < value) {
            throw new Error(
                'Insufficient available funds'
            );
        }

        this.balance =
            toDecimal(
                decimalToNumber(this.balance) -
                value
            );

        this.availableBalance =
            toDecimal(
                Math.max(
                    0,
                    decimalToNumber(
                        this.balance
                    ) -
                    decimalToNumber(
                        this.blockedBalance
                    )
                )
            );

        this.totalDebits =
            toDecimal(
                decimalToNumber(
                    this.totalDebits
                ) + value
            );

        this.transactionCount =
            Number(this.transactionCount || 0) + 1;

        this.lastTransactionAt =
            new Date();

        this.lastDebitAt =
            new Date();

        this.updatedBy =
            updatedBy;

        return this.save();
    };

/**
 * ============================================================================
 * STATIC METHODS
 * ============================================================================
 */

/**
 * Find an account inside a specific tenant.
 */
AccountSchema.statics.findByAccountNumber =
    function (
        tenantId,
        accountNumber
    ) {
        return this.findOne({
            tenantId,
            accountNumber:
                String(accountNumber)
                    .trim()
                    .toUpperCase(),
            isDeleted: false
        });
    };

/**
 * Find customer accounts.
 */
AccountSchema.statics.findCustomerAccounts =
    function (
        tenantId,
        ownerId
    ) {
        return this.find({
            tenantId,
            $or: [
                { member: ownerId },
                { user: ownerId }
            ],
            isDeleted: false
        }).sort({
            createdAt: -1
        });
    };

/**
 * Find active accounts.
 */
AccountSchema.statics.findActive =
    function (tenantId) {
        return this.find({
            tenantId,
            status: 'ACTIVE',
            isDeleted: false
        });
    };

/**
 * Find accounts requiring reconciliation.
 */
AccountSchema.statics.findUnreconciled =
    function (tenantId) {
        return this.find({
            tenantId,
            reconciled: false,
            isDeleted: false
        }).sort({
            createdAt: 1
        });
    };

/**
 * Find accounts that have not been accounting-posted.
 */
AccountSchema.statics.findUnposted =
    function (tenantId) {
        return this.find({
            tenantId,
            accountingPosted: false,
            isDeleted: false
        }).sort({
            createdAt: 1
        });
    };

/**
 * ============================================================================
 * ATOMIC BALANCE OPERATIONS
 * ============================================================================
 *
 * These operations are safer than document.save() for concurrent workers.
 *
 * A production transaction service should still record the corresponding
 * ledger entry in the same MongoDB transaction where applicable.
 */

/**
 * Atomically credit an account.
 */
AccountSchema.statics.atomicCredit =
    async function (
        accountId,
        tenantId,
        amount,
        updatedBy = null,
        session = null
    ) {
        const value = Number(amount);

        if (
            !Number.isFinite(value) ||
            value <= 0
        ) {
            throw new Error(
                'Credit amount must be greater than zero'
            );
        }

        const result =
            await this.findOneAndUpdate(
                {
                    _id: accountId,
                    tenantId,
                    status: 'ACTIVE',
                    isDeleted: false
                },
                {
                    $inc: {
                        balance: value,
                        availableBalance: value,
                        totalCredits: value,
                        transactionCount: 1
                    },
                    $set: {
                        lastTransactionAt:
                            new Date(),
                        lastCreditAt:
                            new Date(),
                        updatedBy
                    }
                },
                {
                    new: true,
                    session
                }
            );

        if (!result) {
            throw new Error(
                'Active account not found'
            );
        }

        return result;
    };

/**
 * Atomically debit an account only when sufficient available funds exist.
 *
 * This conditional update prevents two concurrent workers from independently
 * observing the same balance and both successfully overdrawing the account.
 */
AccountSchema.statics.atomicDebit =
    async function (
        accountId,
        tenantId,
        amount,
        updatedBy = null,
        session = null
    ) {
        const value = Number(amount);

        if (
            !Number.isFinite(value) ||
            value <= 0
        ) {
            throw new Error(
                'Debit amount must be greater than zero'
            );
        }

        const result =
            await this.findOneAndUpdate(
                {
                    _id: accountId,
                    tenantId,
                    status: 'ACTIVE',
                    isDeleted: false,

                    $expr: {
                        $gte: [
                            {
                                $subtract: [
                                    {
                                        $toDouble:
                                            '$balance'
                                    },
                                    {
                                        $toDouble:
                                            '$blockedBalance'
                                    }
                                ]
                            },
                            value
                        ]
                    }
                },
                {
                    $inc: {
                        balance: -value,
                        availableBalance: -value,
                        totalDebits: value,
                        transactionCount: 1
                    },
                    $set: {
                        lastTransactionAt:
                            new Date(),
                        lastDebitAt:
                            new Date(),
                        updatedBy
                    }
                },
                {
                    new: true,
                    session
                }
            );

        if (!result) {
            throw new Error(
                'Insufficient funds or account unavailable'
            );
        }

        return result;
    };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * One account number per tenant.
 *
 * Tenant isolation is deliberately part of the unique key.
 */
AccountSchema.index(
    {
        tenantId: 1,
        accountNumber: 1
    },
    {
        unique: true,
        name: 'uq_account_tenant_account_number'
    }
);

/**
 * External references must also be tenant-scoped.
 */
AccountSchema.index(
    {
        tenantId: 1,
        externalReference: 1
    },
    {
        unique: true,
        sparse: true,
        name: 'uq_account_tenant_external_reference'
    }
);

AccountSchema.index({
    tenantId: 1,
    member: 1,
    status: 1
});

AccountSchema.index({
    tenantId: 1,
    user: 1,
    status: 1
});

AccountSchema.index({
    tenantId: 1,
    accountType: 1,
    status: 1
});

AccountSchema.index({
    tenantId: 1,
    accountCategory: 1,
    status: 1
});

AccountSchema.index({
    tenantId: 1,
    status: 1,
    createdAt: -1
});

AccountSchema.index({
    tenantId: 1,
    lastTransactionAt: -1
});

AccountSchema.index({
    tenantId: 1,
    reconciled: 1,
    updatedAt: -1
});

AccountSchema.index({
    tenantId: 1,
    accountingPosted: 1,
    updatedAt: -1
});

AccountSchema.index({
    tenantId: 1,
    riskFlagged: 1,
    riskScore: -1
});

AccountSchema.index({
    tenantId: 1,
    maturityDate: 1
});

AccountSchema.index({
    tenantId: 1,
    isDeleted: 1,
    status: 1
});

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

module.exports =
    mongoose.models.Account ||
    mongoose.model(
        'Account',
        AccountSchema
    );