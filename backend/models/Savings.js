'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Community Finance Operating System
 * ============================================================================
 *
 * File:
 *   backend/models/Savings.js
 *
 * Purpose:
 *   Enterprise-grade savings account / savings portfolio aggregate.
 *
 * Architectural Position:
 *   Member
 *      │
 *      ▼
 *   Savings
 *      │
 *      ├── Transaction
 *      │       │
 *      │       ▼
 *      │     Ledger
 *      │
 *      ├── Interest Engine
 *      ├── Dividend Engine
 *      ├── Mobile Money
 *      ├── Risk / Fraud
 *      ├── Compliance
 *      └── Reporting
 *
 * IMPORTANT FINANCIAL DESIGN
 * ----------------------------------------------------------------------------
 * This model is NOT the financial ledger.
 *
 * Monetary movements MUST be performed through the transaction/ledger layer.
 * The Savings document represents the current account aggregate and reporting
 * snapshot.
 *
 * Never use this model directly to perform an un-audited monetary transfer.
 *
 * Enterprise capabilities:
 *
 * ✅ Multi-tenant isolation
 * ✅ Savings account lifecycle
 * ✅ Transaction/ledger references
 * ✅ Idempotency support
 * ✅ Financial reconciliation support
 * ✅ Optimistic concurrency protection
 * ✅ Decimal128 monetary precision
 * ✅ Interest management
 * ✅ Dividend management
 * ✅ Goal savings
 * ✅ Fixed/maturity savings
 * ✅ Mobile money metadata
 * ✅ KYC / AML state
 * ✅ Risk / fraud state
 * ✅ Account blocking
 * ✅ Closure controls
 * ✅ Dormancy tracking
 * ✅ Audit metadata
 * ✅ Workflow versioning
 * ✅ Operational timestamps
 * ✅ High-value compound indexes
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema
} = mongoose;


/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

const SAVINGS_TYPES = Object.freeze([
    'REGULAR',
    'GOAL',
    'FIXED',
    'CHILD',
    'GROUP',
    'INVESTMENT'
]);

const SAVINGS_STATUSES = Object.freeze([
    'PENDING',
    'ACTIVE',
    'DORMANT',
    'BLOCKED',
    'CLOSED'
]);

const ACTIVITY_TYPES = Object.freeze([
    'DEPOSIT',
    'WITHDRAWAL',
    'INTEREST',
    'DIVIDEND',
    'ADJUSTMENT',
    'REVERSAL',
    'FEE',
    'REFUND',
    'TRANSFER_IN',
    'TRANSFER_OUT'
]);

const MOMO_PROVIDERS = Object.freeze([
    'MTN',
    'AIRTEL'
]);

const BLOCK_REASONS = Object.freeze([
    'COMPLIANCE',
    'FRAUD',
    'AML',
    'KYC',
    'COURT_ORDER',
    'OPERATIONAL',
    'MEMBER_REQUEST',
    'RISK',
    'OTHER'
]);


/**
 * ============================================================================
 * MONEY FIELD DEFINITION
 * ============================================================================
 *
 * Decimal128 is preferred for financial values over JavaScript Number.
 *
 * Existing applications may contain Number values. Mongoose will normally
 * cast compatible values to Decimal128 when reading/writing this model.
 *
 * Financial calculations should still be performed by the transaction/ledger
 * service using deterministic decimal arithmetic.
 * ============================================================================
 */

const moneyField = {
    type: Schema.Types.Decimal128,
    default: '0.00',
    min: 0
};


/**
 * ============================================================================
 * SAVINGS ACTIVITY SNAPSHOT
 * ============================================================================
 *
 * This is deliberately a lightweight activity snapshot.
 *
 * It is NOT a replacement for the immutable Transaction or Ledger records.
 * ============================================================================
 */

const SavingsActivitySchema = new Schema(
    {
        transactionId: {
            type: Schema.Types.ObjectId,
            ref: 'Transaction',
            index: true
        },

        ledgerEntryId: {
            type: Schema.Types.ObjectId,
            ref: 'LedgerEntry',
            index: true
        },

        type: {
            type: String,
            enum: ACTIVITY_TYPES,
            required: true,
            uppercase: true,
            trim: true
        },

        amount: {
            ...moneyField,
            required: true
        },

        transactionDate: {
            type: Date,
            required: true,
            default: Date.now
        },

        reference: {
            type: String,
            trim: true,
            maxlength: 150
        },

        externalReference: {
            type: String,
            trim: true,
            maxlength: 200
        },

        /**
         * Idempotency reference associated with the originating financial
         * operation.
         */
        idempotencyKey: {
            type: String,
            trim: true,
            maxlength: 200
        }
    },
    {
        _id: false
    }
);


/**
 * ============================================================================
 * SAVINGS SCHEMA
 * ============================================================================
 */

const SavingsSchema = new Schema(
    {

        /**
         * ====================================================================
         * TENANCY
         * ====================================================================
         */

        tenantId: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 100,
            index: true
        },


        /**
         * ====================================================================
         * MEMBER OWNERSHIP
         * ====================================================================
         */

        member: {
            type: Schema.Types.ObjectId,
            ref: 'Member',
            required: true,
            index: true
        },

        account: {
            type: Schema.Types.ObjectId,
            ref: 'Account',
            index: true
        },


        /**
         * ====================================================================
         * IDENTIFICATION
         * ====================================================================
         */

        savingsNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            minlength: 3,
            maxlength: 100
        },

        savingsName: {
            type: String,
            default: 'Regular Savings',
            trim: true,
            maxlength: 150
        },

        savingsType: {
            type: String,
            enum: SAVINGS_TYPES,
            default: 'REGULAR',
            uppercase: true,
            trim: true,
            index: true
        },


        /**
         * ====================================================================
         * CURRENCY
         * ====================================================================
         *
         * Currency MUST be immutable after financial activity begins.
         * ====================================================================
         */

        currency: {
            type: String,
            default: 'UGX',
            required: true,
            uppercase: true,
            trim: true,
            minlength: 3,
            maxlength: 3
        },


        /**
         * ====================================================================
         * ACCOUNT BALANCES
         * ====================================================================
         *
         * balance:
         *   Total book balance.
         *
         * availableBalance:
         *   Amount available for withdrawal/transfer.
         *
         * blockedBalance:
         *   Amount legally/compliance/operationally restricted.
         * ====================================================================
         */

        balance: {
            ...moneyField
        },

        availableBalance: {
            ...moneyField
        },

        blockedBalance: {
            ...moneyField
        },


        /**
         * ====================================================================
         * FINANCIAL AGGREGATES
         * ====================================================================
         */

        totalDeposits: {
            ...moneyField
        },

        totalWithdrawals: {
            ...moneyField
        },

        totalInterestEarned: {
            ...moneyField
        },

        totalDividendsEarned: {
            ...moneyField
        },

        totalFeesCharged: {
            ...moneyField
        },

        totalReversals: {
            ...moneyField
        },

        netSavings: {
            type: Schema.Types.Decimal128,
            default: '0.00'
        },

        totalTransactions: {
            type: Number,
            default: 0,
            min: 0
        },


        /**
         * ====================================================================
         * INTEREST MANAGEMENT
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
                'ANNUAL',
                'MONTHLY',
                'DAILY',
                'TIERED'
            ],
            default: 'ANNUAL',
            uppercase: true
        },

        accruedInterest: {
            ...moneyField
        },

        interestLastCalculatedAt: {
            type: Date
        },

        interestLastPostedAt: {
            type: Date
        },

        interestCalculationVersion: {
            type: Number,
            default: 1,
            min: 1
        },


        /**
         * ====================================================================
         * DIVIDENDS
         * ====================================================================
         */

        dividendEligible: {
            type: Boolean,
            default: true
        },

        totalDividendsEarned: {
            ...moneyField
        },

        lastDividendPostedAt: {
            type: Date
        },


        /**
         * ====================================================================
         * GOAL / MATURITY
         * ====================================================================
         */

        targetAmount: {
            ...moneyField
        },

        targetDate: {
            type: Date
        },

        maturityDate: {
            type: Date
        },

        maturityInstruction: {
            type: String,
            enum: [
                'PAYOUT',
                'RENEW',
                'TRANSFER_TO_REGULAR',
                'HOLD'
            ],
            default: 'PAYOUT'
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
            enum: MOMO_PROVIDERS
        },

        momoPhoneNumber: {
            type: String,
            trim: true,
            maxlength: 30
        },

        momoLastTransactionAt: {
            type: Date
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

        kycVerifiedAt: {
            type: Date
        },

        amlChecked: {
            type: Boolean,
            default: false,
            index: true
        },

        amlCheckedAt: {
            type: Date
        },

        complianceReviewRequired: {
            type: Boolean,
            default: false,
            index: true
        },

        complianceReviewAt: {
            type: Date
        },


        /**
         * ====================================================================
         * STATUS / LIFECYCLE
         * ====================================================================
         */

        status: {
            type: String,
            enum: SAVINGS_STATUSES,
            default: 'ACTIVE',
            uppercase: true,
            trim: true,
            index: true
        },

        activatedAt: {
            type: Date
        },

        dormantAt: {
            type: Date
        },

        closedAt: {
            type: Date
        },

        closureReason: {
            type: String,
            trim: true,
            maxlength: 500
        },


        /**
         * ====================================================================
         * BLOCKING
         * ====================================================================
         */

        blocked: {
            type: Boolean,
            default: false,
            index: true
        },

        blockReason: {
            type: String,
            enum: BLOCK_REASONS
        },

        blockedAt: {
            type: Date
        },

        blockedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },

        blockReference: {
            type: String,
            trim: true,
            maxlength: 200
        },


        /**
         * ====================================================================
         * RISK / FRAUD
         * ====================================================================
         */

        fraudFlagged: {
            type: Boolean,
            default: false,
            index: true
        },

        fraudFlaggedAt: {
            type: Date
        },

        fraudFlagReason: {
            type: String,
            trim: true,
            maxlength: 500
        },

        riskScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1000
        },

        riskLevel: {
            type: String,
            enum: [
                'LOW',
                'MEDIUM',
                'HIGH',
                'CRITICAL'
            ],
            default: 'LOW',
            index: true
        },


        /**
         * ====================================================================
         * TRANSACTION STATISTICS
         * ====================================================================
         */

        lastTransactionAt: {
            type: Date
        },

        lastDepositAt: {
            type: Date
        },

        lastWithdrawalAt: {
            type: Date
        },

        lastInterestAt: {
            type: Date
        },


        /**
         * ====================================================================
         * RECENT ACTIVITY
         * ====================================================================
         *
         * This should remain bounded.
         *
         * Do NOT use this array as the historical transaction ledger.
         * ====================================================================
         */

        recentActivities: {
            type: [SavingsActivitySchema],
            default: []
        },


        /**
         * ====================================================================
         * IDEMPOTENCY / RECONCILIATION
         * ====================================================================
         */

        lastTransactionId: {
            type: Schema.Types.ObjectId,
            ref: 'Transaction'
        },

        lastLedgerEntryId: {
            type: Schema.Types.ObjectId,
            ref: 'LedgerEntry'
        },

        reconciliationStatus: {
            type: String,
            enum: [
                'PENDING',
                'MATCHED',
                'MISMATCH',
                'UNDER_REVIEW'
            ],
            default: 'MATCHED',
            index: true
        },

        lastReconciledAt: {
            type: Date
        },

        reconciliationReference: {
            type: String,
            trim: true,
            maxlength: 200
        },


        /**
         * ====================================================================
         * AUDIT
         * ====================================================================
         */

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },

        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },

        auditReference: {
            type: String,
            trim: true,
            maxlength: 200
        },

        lastAuditAt: {
            type: Date
        },


        /**
         * ====================================================================
         * WORKFLOW / CONCURRENCY
         * ====================================================================
         */

        workflowVersion: {
            type: Number,
            default: 1,
            min: 1
        },

        /**
         * Incremented whenever a financial aggregate is changed.
         *
         * Services may use this value for optimistic concurrency checks.
         */
        financialVersion: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * Schema/application version.
         */
        schemaVersion: {
            type: Number,
            default: 1,
            min: 1
        }
    },
    {
        timestamps: true,

        /**
         * Keep Mongoose's __v available for optimistic concurrency and
         * operational diagnostics.
         */
        versionKey: '__v',

        optimisticConcurrency: true,

        minimize: false,

        strict: true,

        toJSON: {
            virtuals: true,

            transform(doc, ret) {
                if (ret._id) {
                    ret.id = ret._id.toString();
                }

                delete ret._id;

                /**
                 * Decimal128 serializes safely as strings rather than floating
                 * point JavaScript numbers.
                 */
                return ret;
            }
        },

        toObject: {
            virtuals: true
        }
    }
);


/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * One savings number per tenant.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        savingsNumber: 1
    },
    {
        unique: true,
        name: 'uq_savings_tenant_number'
    }
);


/**
 * Member savings portfolio.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        member: 1,
        status: 1
    },
    {
        name: 'idx_savings_tenant_member_status'
    }
);


/**
 * Account lookup.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        account: 1
    },
    {
        sparse: true,
        name: 'idx_savings_tenant_account'
    }
);


/**
 * Savings type / portfolio reporting.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        savingsType: 1,
        status: 1
    },
    {
        name: 'idx_savings_type_status'
    }
);


/**
 * Operational status queues.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        status: 1,
        updatedAt: -1
    },
    {
        name: 'idx_savings_status_updated'
    }
);


/**
 * Balance reporting.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        balance: -1
    },
    {
        name: 'idx_savings_balance'
    }
);


/**
 * Fraud/risk operations.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        fraudFlagged: 1,
        riskLevel: 1
    },
    {
        name: 'idx_savings_risk_operations'
    }
);


/**
 * Compliance queue.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        complianceReviewRequired: 1,
        updatedAt: -1
    },
    {
        name: 'idx_savings_compliance_review'
    }
);


/**
 * Reconciliation queue.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        reconciliationStatus: 1,
        updatedAt: -1
    },
    {
        name: 'idx_savings_reconciliation'
    }
);


/**
 * Dormancy detection.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        status: 1,
        lastTransactionAt: 1
    },
    {
        name: 'idx_savings_dormancy'
    }
);


/**
 * Maturity processing.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        savingsType: 1,
        maturityDate: 1,
        status: 1
    },
    {
        sparse: true,
        name: 'idx_savings_maturity'
    }
);


/**
 * Goal savings reporting.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        savingsType: 1,
        targetDate: 1
    },
    {
        sparse: true,
        name: 'idx_savings_goals'
    }
);


/**
 * Recent creation/reporting.
 */
SavingsSchema.index(
    {
        tenantId: 1,
        createdAt: -1
    },
    {
        name: 'idx_savings_created'
    }
);


/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

SavingsSchema.virtual('isActive')
    .get(function () {
        return this.status === 'ACTIVE' && !this.blocked;
    });


SavingsSchema.virtual('isDormant')
    .get(function () {
        return this.status === 'DORMANT';
    });


SavingsSchema.virtual('isBlocked')
    .get(function () {
        return this.status === 'BLOCKED' || this.blocked === true;
    });


SavingsSchema.virtual('isClosed')
    .get(function () {
        return this.status === 'CLOSED';
    });


SavingsSchema.virtual('goalAchievementPercentage')
    .get(function () {
        const target = decimalToNumber(
            this.targetAmount
        );

        const balance = decimalToNumber(
            this.balance
        );

        if (target <= 0) {
            return 0;
        }

        return Math.min(
            100,
            Number(
                ((balance / target) * 100).toFixed(2)
            )
        );
    });


SavingsSchema.virtual('utilizedBlockedPercentage')
    .get(function () {
        const balance = decimalToNumber(
            this.balance
        );

        const blocked = decimalToNumber(
            this.blockedBalance
        );

        if (balance <= 0) {
            return 0;
        }

        return Number(
            ((blocked / balance) * 100).toFixed(2)
        );
    });


/**
 * ============================================================================
 * DECIMAL HELPER
 * ============================================================================
 */

function decimalToNumber(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return 0;
    }

    if (
        typeof value === 'number'
    ) {
        return Number.isFinite(value)
            ? value
            : 0;
    }

    if (
        value &&
        typeof value.toString === 'function'
    ) {
        const parsed = Number(
            value.toString()
        );

        return Number.isFinite(parsed)
            ? parsed
            : 0;
    }

    return 0;
}


/**
 * ============================================================================
 * RISK CALCULATION
 * ============================================================================
 *
 * This is deliberately conservative.
 *
 * A sophisticated TITech risk engine should eventually calculate this outside
 * the model using transaction behaviour, AML signals, repayment behaviour,
 * velocity, fraud indicators and member-level risk.
 * ============================================================================
 */

function calculateRiskLevel(score) {
    const normalized = Math.max(
        0,
        Math.min(
            1000,
            Math.round(
                Number(score) || 0
            )
        )
    );

    if (normalized >= 800) {
        return 'CRITICAL';
    }

    if (normalized >= 600) {
        return 'HIGH';
    }

    if (normalized >= 350) {
        return 'MEDIUM';
    }

    return 'LOW';
}


/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

SavingsSchema.pre(
    'validate',
    function (next) {

        /**
         * ---------------------------------------------------------------
         * Balance invariants
         * ---------------------------------------------------------------
         */

        const balance =
            decimalToNumber(
                this.balance
            );

        const availableBalance =
            decimalToNumber(
                this.availableBalance
            );

        const blockedBalance =
            decimalToNumber(
                this.blockedBalance
            );

        if (
            availableBalance >
            balance
        ) {
            return next(
                new Error(
                    'Savings available balance cannot exceed total balance.'
                )
            );
        }

        if (
            blockedBalance >
            balance
        ) {
            return next(
                new Error(
                    'Savings blocked balance cannot exceed total balance.'
                )
            );
        }

        /**
         * Available + blocked cannot exceed book balance.
         */
        if (
            availableBalance +
            blockedBalance >
            balance + 0.000001
        ) {
            return next(
                new Error(
                    'Savings available balance plus blocked balance cannot exceed total balance.'
                )
            );
        }


        /**
         * ---------------------------------------------------------------
         * Goal validation
         * ---------------------------------------------------------------
         */

        if (
            this.savingsType === 'GOAL' &&
            decimalToNumber(
                this.targetAmount
            ) <= 0
        ) {
            return next(
                new Error(
                    'Goal savings accounts must have a positive target amount.'
                )
            );
        }


        /**
         * ---------------------------------------------------------------
         * Fixed savings validation
         * ---------------------------------------------------------------
         */

        if (
            this.savingsType === 'FIXED' &&
            !this.maturityDate
        ) {
            return next(
                new Error(
                    'Fixed savings accounts must have a maturity date.'
                )
            );
        }


        /**
         * ---------------------------------------------------------------
         * Mobile money validation
         * ---------------------------------------------------------------
         */

        if (
            this.momoEnabled &&
            !this.momoProvider
        ) {
            return next(
                new Error(
                    'A mobile money provider is required when mobile money is enabled.'
                )
            );
        }


        /**
         * ---------------------------------------------------------------
         * Closure validation
         * ---------------------------------------------------------------
         */

        if (
            this.status === 'CLOSED' &&
            !this.closedAt
        ) {
            this.closedAt = new Date();
        }


        /**
         * ---------------------------------------------------------------
         * Risk level
         * ---------------------------------------------------------------
         */

        this.riskLevel =
            calculateRiskLevel(
                this.riskScore
            );


        next();
    }
);


/**
 * ============================================================================
 * PRE-SAVE FINANCIAL AGGREGATE NORMALIZATION
 * ============================================================================
 *
 * IMPORTANT:
 * This computes reporting aggregates only.
 *
 * It does NOT perform a financial transaction.
 * ============================================================================
 */

SavingsSchema.pre(
    'save',
    function (next) {

        const deposits =
            decimalToNumber(
                this.totalDeposits
            );

        const withdrawals =
            decimalToNumber(
                this.totalWithdrawals
            );

        const interest =
            decimalToNumber(
                this.totalInterestEarned
            );

        const dividends =
            decimalToNumber(
                this.totalDividendsEarned
            );

        const fees =
            decimalToNumber(
                this.totalFeesCharged
            );

        const reversals =
            decimalToNumber(
                this.totalReversals
            );

        /**
         * Net savings is a reporting aggregate.
         *
         * The authoritative account balance remains `balance`.
         */
        const net =
            deposits +
            interest +
            dividends +
            reversals -
            withdrawals -
            fees;

        this.netSavings =
            mongoose.Types.Decimal128.fromString(
                Math.max(
                    0,
                    net
                ).toFixed(2)
            );


        /**
         * Account lifecycle timestamps.
         */

        if (
            this.isModified('status')
        ) {

            if (
                this.status === 'ACTIVE' &&
                !this.activatedAt
            ) {
                this.activatedAt =
                    new Date();
            }

            if (
                this.status === 'DORMANT' &&
                !this.dormantAt
            ) {
                this.dormantAt =
                    new Date();
            }

            if (
                this.status === 'CLOSED' &&
                !this.closedAt
            ) {
                this.closedAt =
                    new Date();
            }
        }


        /**
         * Keep blocked status synchronized.
         */
        if (
            this.status === 'BLOCKED'
        ) {
            this.blocked = true;
        }


        /**
         * Financial version changes whenever core financial aggregates are
         * modified.
         */
        const financialFields = [
            'balance',
            'availableBalance',
            'blockedBalance',
            'totalDeposits',
            'totalWithdrawals',
            'totalInterestEarned',
            'totalDividendsEarned',
            'totalFeesCharged',
            'totalReversals',
            'accruedInterest',
            'totalTransactions'
        ];

        if (
            financialFields.some(
                field =>
                    this.isModified(field)
            )
        ) {
            this.financialVersion =
                (this.financialVersion || 0) + 1;
        }


        next();
    }
);


/**
 * ============================================================================
 * QUERY SAFETY HELPERS
 * ============================================================================
 *
 * These helpers are intentionally simple and can be used by repositories and
 * services without duplicating status logic.
 * ============================================================================
 */

SavingsSchema.statics.buildTenantQuery =
    function ({
        tenantId,
        ...criteria
    } = {}) {

        if (
            !tenantId
        ) {
            throw new Error(
                'tenantId is required for Savings tenant-scoped queries.'
            );
        }

        return {
            tenantId: String(
                tenantId
            ),
            ...criteria
        };
    };


/**
 * ============================================================================
 * ACTIVE ACCOUNT QUERY
 * ============================================================================
 */

SavingsSchema.statics.activeAccountQuery =
    function (tenantId, savingsId) {

        if (
            !tenantId ||
            !savingsId
        ) {
            throw new Error(
                'tenantId and savingsId are required.'
            );
        }

        return {
            _id: savingsId,
            tenantId: String(tenantId),
            status: 'ACTIVE',
            blocked: false
        };
    };


/**
 * ============================================================================
 * FINANCIAL MUTATION QUERY
 * ============================================================================
 *
 * Services can use the current financialVersion as an optimistic concurrency
 * condition.
 * ============================================================================
 */

SavingsSchema.statics.buildFinancialMutationQuery =
    function ({
        tenantId,
        savingsId,
        financialVersion
    } = {}) {

        if (
            !tenantId ||
            !savingsId
        ) {
            throw new Error(
                'tenantId and savingsId are required for financial mutation.'
            );
        }

        const query = {
            _id: savingsId,
            tenantId: String(tenantId),
            status: 'ACTIVE',
            blocked: false
        };

        if (
            Number.isInteger(
                financialVersion
            )
        ) {
            query.financialVersion =
                financialVersion;
        }

        return query;
    };


/**
 * ============================================================================
 * STATIC RISK HELPER
 * ============================================================================
 */

SavingsSchema.statics.calculateRiskLevel =
    calculateRiskLevel;


/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

SavingsSchema.methods.canTransact =
    function () {

        return (
            this.status === 'ACTIVE' &&
            this.blocked !== true &&
            this.reconciliationStatus !== 'MISMATCH' &&
            this.reconciliationStatus !== 'UNDER_REVIEW'
        );
    };


SavingsSchema.methods.isMature =
    function (referenceDate = new Date()) {

        if (
            !this.maturityDate
        ) {
            return false;
        }

        return (
            new Date(
                this.maturityDate
            ) <= referenceDate
        );
    };


SavingsSchema.methods.getFinancialSnapshot =
    function () {

        return {
            savingsId:
                this._id,

            tenantId:
                this.tenantId,

            member:
                this.member,

            savingsNumber:
                this.savingsNumber,

            currency:
                this.currency,

            balance:
                this.balance,

            availableBalance:
                this.availableBalance,

            blockedBalance:
                this.blockedBalance,

            accruedInterest:
                this.accruedInterest,

            financialVersion:
                this.financialVersion,

            reconciliationStatus:
                this.reconciliationStatus
        };
    };


/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

const Savings =
    mongoose.models.Savings ||
    mongoose.model(
        'Savings',
        SavingsSchema
    );


/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = Savings;

module.exports.SavingsSchema =
    SavingsSchema;

module.exports.SAVINGS_TYPES =
    SAVINGS_TYPES;

module.exports.SAVINGS_STATUSES =
    SAVINGS_STATUSES;

module.exports.ACTIVITY_TYPES =
    ACTIVITY_TYPES;