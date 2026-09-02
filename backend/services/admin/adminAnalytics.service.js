'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Analytics Service
 * ============================================================================
 *
 * File:
 *   community-savings-app-backend/services/adminAnalytics.service.js
 *
 * Purpose:
 *   Canonical production analytics service for admin / executive dashboards.
 *
 * Design principles
 * ----------------------------------------------------------------------------
 * - Uses the project's real Mongoose model interfaces.
 * - Does not depend on guessed repository APIs.
 * - Enforces tenant isolation at every tenant-capable query.
 * - Handles the project's mixed tenantId storage types explicitly.
 * - Uses MongoDB aggregation for scalable analytics.
 * - Avoids loading large collections into application memory.
 * - Keeps financial metrics derived from authoritative transaction/portfolio
 *   records rather than client-supplied values.
 * - Avoids exposing sensitive authentication, KYC, AML or fraud payloads.
 * - Supports dashboard KPI, trend, breakdown, risk and operational views.
 * - Is dependency-injection friendly for unit/integration testing.
 *
 * IMPORTANT:
 * ---------------------------------------------------------------------------
 * The current Group model does not contain tenantId. This service therefore
 * does NOT treat Group.countDocuments() as a tenant-safe metric. Group counts
 * returned here are explicitly marked as derived/observed where applicable.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const logger = require('../utils/logger');

const User = require('../models/User');
const Member = require('../models/Member');
const Group = require('../models/Group');
const Savings = require('../models/Savings');
const Contribution = require('../models/Contribution');
const Transaction = require('../models/Transaction');
const Loan = require('../models/Loan');
const Audit = require('../models/Audit');
const FraudLog = require('../models/FraudLog');
const ComplianceLog = require('../models/ComplianceLog');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SERVICE_NAME = 'AdminAnalyticsService';
const SERVICE_VERSION = '1.0.0';

const DEFAULT_PERIOD = '30d';

const PERIODS = Object.freeze({
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '12m': 365,
});

const SUCCESS_TRANSACTION_STATUSES = Object.freeze([
    'SUCCESS',
    'SETTLED',
]);

const ACTIVE_MEMBER_STATUS = 'ACTIVE';

const ACTIVE_SAVINGS_STATUS = 'ACTIVE';

const ACTIVE_LOAN_STATUSES = Object.freeze([
    'approved',
    'disbursed',
    'active',
    'restructured',
]);

const DISBURSED_LOAN_STATUSES = Object.freeze([
    'disbursed',
    'active',
    'completed',
    'defaulted',
    'written_off',
    'recovered',
    'restructured',
]);

const RISKY_LOAN_STATUSES = Object.freeze([
    'defaulted',
    'written_off',
]);

const LOAN_PAR_BUCKETS = Object.freeze([
    {
        key: 'current',
        label: 'Current',
        minDaysPastDue: 0,
        maxDaysPastDue: 29,
    },
    {
        key: 'par30',
        label: 'PAR 30',
        minDaysPastDue: 30,
        maxDaysPastDue: 59,
    },
    {
        key: 'par60',
        label: 'PAR 60',
        minDaysPastDue: 60,
        maxDaysPastDue: 89,
    },
    {
        key: 'par90',
        label: 'PAR 90 / NPL',
        minDaysPastDue: 90,
        maxDaysPastDue: null,
    },
]);

const CURRENCY_FALLBACK = 'UGX';

/**
 * ============================================================================
 * ERRORS
 * ============================================================================
 */

class AdminAnalyticsError extends Error {
    constructor(message, options = {}) {
        super(message);

        this.name = 'AdminAnalyticsError';

        this.code =
            options.code ||
            'ADMIN_ANALYTICS_ERROR';

        this.statusCode =
            options.statusCode ||
            500;

        this.cause =
            options.cause ||
            null;

        this.details =
            options.details ||
            null;
    }
}

/**
 * ============================================================================
 * VALUE HELPERS
 * ============================================================================
 */

function normalizeTenantId(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized || null;
}

function isValidObjectId(value) {
    return (
        typeof value === 'string' &&
        mongoose.Types.ObjectId.isValid(value)
    );
}

function toObjectId(value) {
    const tenantId =
        normalizeTenantId(value);

    if (!tenantId) {
        throw new AdminAnalyticsError(
            'tenantId is required.',
            {
                code: 'TENANT_ID_REQUIRED',
                statusCode: 400,
            }
        );
    }

    if (!isValidObjectId(tenantId)) {
        throw new AdminAnalyticsError(
            'tenantId must be a valid MongoDB ObjectId for this metric.',
            {
                code: 'INVALID_OBJECT_TENANT_ID',
                statusCode: 400,
            }
        );
    }

    return new mongoose.Types.ObjectId(
        tenantId
    );
}

function toStringTenantId(value) {
    const tenantId =
        normalizeTenantId(value);

    if (!tenantId) {
        throw new AdminAnalyticsError(
            'tenantId is required.',
            {
                code: 'TENANT_ID_REQUIRED',
                statusCode: 400,
            }
        );
    }

    return tenantId;
}

function buildDateRange(
    period = DEFAULT_PERIOD,
    from = null,
    to = null
) {
    const now = new Date();

    if (from || to) {
        const start =
            from
                ? new Date(from)
                : new Date(
                    now.getTime() -
                    30 *
                    24 *
                    60 *
                    60 *
                    1000
                );

        const end =
            to
                ? new Date(to)
                : now;

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime())
        ) {
            throw new AdminAnalyticsError(
                'Invalid analytics date range.',
                {
                    code: 'INVALID_DATE_RANGE',
                    statusCode: 400,
                }
            );
        }

        if (start > end) {
            throw new AdminAnalyticsError(
                'Analytics start date cannot be after end date.',
                {
                    code: 'INVALID_DATE_RANGE',
                    statusCode: 400,
                }
            );
        }

        return {
            period: 'custom',
            from: start,
            to: end,
        };
    }

    const days =
        PERIODS[period] ||
        PERIODS[DEFAULT_PERIOD];

    return {
        period:
            PERIODS[period]
                ? period
                : DEFAULT_PERIOD,

        from: new Date(
            now.getTime() -
            days *
            24 *
            60 *
            60 *
            1000
        ),

        to: now,
    };
}

function safeNumber(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return 0;
    }

    const numeric =
        Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : 0;
}

function round(value, decimals = 2) {
    const factor =
        10 ** decimals;

    return Math.round(
        safeNumber(value) *
        factor
    ) / factor;
}

function percentage(
    numerator,
    denominator,
    decimals = 2
) {
    const numeratorValue =
        safeNumber(numerator);

    const denominatorValue =
        safeNumber(denominator);

    if (
        denominatorValue === 0
    ) {
        return 0;
    }

    return round(
        (
            numeratorValue /
            denominatorValue
        ) *
        100,
        decimals
    );
}

function firstResult(results) {
    if (
        !Array.isArray(results) ||
        !results.length
    ) {
        return null;
    }

    return results[0] || null;
}

function toPlainMetricRow(row = {}) {
    return {
        ...row,
    };
}

/**
 * ============================================================================
 * MODEL-SPECIFIC TENANT FILTERS
 * ============================================================================
 *
 * IMPORTANT:
 *
 * The current project does not use one tenantId Mongo type consistently.
 *
 * ObjectId:
 *   User
 *   Transaction
 *   Contribution
 *
 * String:
 *   Member
 *   Loan
 *   Savings
 *   Audit
 *   FraudLog
 *   ComplianceLog
 *
 * This is intentionally explicit instead of relying on Mongoose to coerce
 * values inside aggregate pipelines.
 * ============================================================================
 */

function userTenantMatch(tenantId) {
    return {
        tenantId: toObjectId(tenantId),
    };
}

function contributionTenantMatch(tenantId) {
    return {
        tenantId: toObjectId(tenantId),
    };
}

function transactionTenantMatch(tenantId) {
    return {
        tenantId: toObjectId(tenantId),
    };
}

function memberTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

function loanTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

function savingsTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

function auditTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

function fraudTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

function complianceTenantMatch(tenantId) {
    return {
        tenantId: toStringTenantId(tenantId),
    };
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class AdminAnalyticsService {
    constructor(options = {}) {
        this.models = {
            User:
                options.User ||
                User,

            Member:
                options.Member ||
                Member,

            Group:
                options.Group ||
                Group,

            Savings:
                options.Savings ||
                Savings,

            Contribution:
                options.Contribution ||
                Contribution,

            Transaction:
                options.Transaction ||
                Transaction,

            Loan:
                options.Loan ||
                Loan,

            Audit:
                options.Audit ||
                Audit,

            FraudLog:
                options.FraudLog ||
                FraudLog,

            ComplianceLog:
                options.ComplianceLog ||
                ComplianceLog,
        };

        this.logger =
            options.logger ||
            logger;

        this.serviceName =
            SERVICE_NAME;

        this.version =
            SERVICE_VERSION;
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    validateTenantId(tenantId) {
        const normalized =
            normalizeTenantId(
                tenantId
            );

        if (!normalized) {
            throw new AdminAnalyticsError(
                'tenantId is required.',
                {
                    code: 'TENANT_ID_REQUIRED',
                    statusCode: 400,
                }
            );
        }

        return normalized;
    }

    normalizeOptions(options = {}) {
        const period =
            options.period ||
            DEFAULT_PERIOD;

        const range =
            buildDateRange(
                period,
                options.from,
                options.to
            );

        return {
            ...range,

            limit:
                Math.min(
                    Math.max(
                        Number(
                            options.limit ||
                            20
                        ),
                        1
                    ),
                    100
                ),
        };
    }

    /**
     * =========================================================================
     * EXECUTIVE OVERVIEW
     * =========================================================================
     */

    async getOverview(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        try {
            const [
                members,
                savings,
                loans,
                transactions,
                contributions,
                risk,
                compliance,
                groups,
            ] = await Promise.all([
                this.getMemberMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getSavingsMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getLoanMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getTransactionMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getContributionMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getRiskMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getComplianceMetrics(
                    normalizedTenantId,
                    range
                ),

                this.getObservedGroupMetrics(
                    normalizedTenantId,
                    range
                ),
            ]);

            return {
                service: {
                    name:
                        this.serviceName,

                    version:
                        this.version,

                    generatedAt:
                        new Date(),
                },

                tenantId:
                    normalizedTenantId,

                period: {
                    key:
                        range.period,

                    from:
                        range.from,

                    to:
                        range.to,
                },

                members,
                savings,
                loans,
                transactions,
                contributions,
                risk,
                compliance,
                groups,

                integrity: {
                    groupMetricScope:
                        groups.scope,

                    tenantIsolation:
                        true,

                    tenantIdTypes:
                        {
                            user:
                                'ObjectId',

                            transaction:
                                'ObjectId',

                            contribution:
                                'ObjectId',

                            member:
                                'String',

                            savings:
                                'String',

                            loan:
                                'String',

                            audit:
                                'String',

                            fraudLog:
                                'String',

                            complianceLog:
                                'String',
                        },
                },
            };
        } catch (error) {
            this.logError(
                'Failed to build admin analytics overview.',
                error,
                {
                    tenantId:
                        normalizedTenantId,

                    period:
                        range.period,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_OVERVIEW_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * MEMBER ANALYTICS
     * =========================================================================
     */

    async getMemberMetrics(
        tenantId,
        range
    ) {
        const match = {
            ...memberTenantMatch(
                tenantId
            ),
        };

        const createdMatch = {
            ...match,
            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            overall,
            statusBreakdown,
            kycBreakdown,
            riskBreakdown,
            growth,
        ] = await Promise.all([
            this.models.Member.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        active:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$memberStatus',
                                                ACTIVE_MEMBER_STATUS,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        dormant:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$memberStatus',
                                                'DORMANT',
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        suspended:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$memberStatus',
                                                'SUSPENDED',
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        kycVerified:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$kycVerified',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        amlChecked:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$amlChecked',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        fraudFlagged:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$fraudFlagged',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        blacklisted:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$blacklisted',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        savingsBalance:
                            {
                                $sum:
                                    '$savingsBalance',
                            },

                        outstandingLoanBalance:
                            {
                                $sum:
                                    '$outstandingLoanBalance',
                            },
                    },
                },
            ]),

            this.models.Member.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            '$memberStatus',

                        count:
                            {
                                $sum: 1,
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Member.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            '$kycStatus',

                        count:
                            {
                                $sum: 1,
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Member.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            {
                                $switch: {
                                    branches: [
                                        {
                                            case: {
                                                $gte: [
                                                    '$riskScore',
                                                    80,
                                                ],
                                            },

                                            then:
                                                'HIGH',
                                        },

                                        {
                                            case: {
                                                $gte: [
                                                    '$riskScore',
                                                    60,
                                                ],
                                            },

                                            then:
                                                'MEDIUM',
                                        },
                                    ],

                                    default:
                                        'LOW',
                                },
                            },

                        count:
                            {
                                $sum: 1,
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Member.aggregate([
                {
                    $match:
                        createdMatch,
                },

                {
                    $group: {
                        _id:
                            {
                                $dateToString: {
                                    format:
                                        range.period ===
                                        '24h'
                                            ? '%Y-%m-%dT%H:00:00Z'
                                            : '%Y-%m-%d',

                                    date:
                                        '$createdAt',
                                },
                            },

                        newMembers:
                            {
                                $sum: 1,
                            },
                    },
                },

                {
                    $sort: {
                        _id: 1,
                    },
                },
            ]),
        ]);

        const totals =
            firstResult(
                overall
            ) || {};

        return {
            total:
                safeNumber(
                    totals.total
                ),

            active:
                safeNumber(
                    totals.active
                ),

            dormant:
                safeNumber(
                    totals.dormant
                ),

            suspended:
                safeNumber(
                    totals.suspended
                ),

            kycVerified:
                safeNumber(
                    totals.kycVerified
                ),

            amlChecked:
                safeNumber(
                    totals.amlChecked
                ),

            fraudFlagged:
                safeNumber(
                    totals.fraudFlagged
                ),

            blacklisted:
                safeNumber(
                    totals.blacklisted
                ),

            kycCompletionRate:
                percentage(
                    totals.kycVerified,
                    totals.total
                ),

            amlCompletionRate:
                percentage(
                    totals.amlChecked,
                    totals.total
                ),

            activeRate:
                percentage(
                    totals.active,
                    totals.total
                ),

            savingsBalance:
                round(
                    totals.savingsBalance
                ),

            outstandingLoanBalance:
                round(
                    totals.outstandingLoanBalance
                ),

            statusBreakdown:
                statusBreakdown.map(
                    toPlainMetricRow
                ),

            kycBreakdown:
                kycBreakdown.map(
                    toPlainMetricRow
                ),

            riskBreakdown:
                riskBreakdown.map(
                    toPlainMetricRow
                ),

            growth:
                growth.map(
                    (row) => ({
                        date:
                            row._id,

                        newMembers:
                            safeNumber(
                                row.newMembers
                            ),
                    })
                ),
        };
    }

    /**
     * =========================================================================
     * SAVINGS ANALYTICS
     * =========================================================================
     */

    async getSavingsMetrics(
        tenantId,
        range
    ) {
        const match = {
            ...savingsTenantMatch(
                tenantId
            ),
        };

        const periodMatch = {
            ...match,
            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            portfolio,
            byType,
            byStatus,
            trend,
        ] = await Promise.all([
            this.models.Savings.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id: null,

                        accounts:
                            {
                                $sum: 1,
                            },

                        activeAccounts:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$status',
                                                ACTIVE_SAVINGS_STATUS,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        totalBalance:
                            {
                                $sum:
                                    '$balance',
                            },

                        availableBalance:
                            {
                                $sum:
                                    '$availableBalance',
                            },

                        blockedBalance:
                            {
                                $sum:
                                    '$blockedBalance',
                            },

                        totalDeposits:
                            {
                                $sum:
                                    '$totalDeposits',
                            },

                        totalWithdrawals:
                            {
                                $sum:
                                    '$totalWithdrawals',
                            },

                        netSavings:
                            {
                                $sum:
                                    '$netSavings',
                            },

                        accruedInterest:
                            {
                                $sum:
                                    '$accruedInterest',
                            },

                        totalDividends:
                            {
                                $sum:
                                    '$totalDividendsEarned',
                            },

                        fraudFlagged:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$fraudFlagged',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.Savings.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            '$savingsType',

                        count:
                            {
                                $sum: 1,
                            },

                        balance:
                            {
                                $sum:
                                    '$balance',
                            },

                        netSavings:
                            {
                                $sum:
                                    '$netSavings',
                            },
                    },
                },

                {
                    $sort: {
                        balance: -1,
                    },
                },
            ]),

            this.models.Savings.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            '$status',

                        count:
                            {
                                $sum: 1,
                            },

                        balance:
                            {
                                $sum:
                                    '$balance',
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Savings.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            {
                                $dateToString: {
                                    format:
                                        range.period ===
                                        '24h'
                                            ? '%Y-%m-%dT%H:00:00Z'
                                            : '%Y-%m-%d',

                                    date:
                                        '$createdAt',
                                },
                            },

                        accounts:
                            {
                                $sum: 1,
                            },

                        deposits:
                            {
                                $sum:
                                    '$totalDeposits',
                            },

                        withdrawals:
                            {
                                $sum:
                                    '$totalWithdrawals',
                            },

                        netSavings:
                            {
                                $sum:
                                    '$netSavings',
                            },
                    },
                },

                {
                    $sort: {
                        _id: 1,
                    },
                },
            ]),
        ]);

        const totals =
            firstResult(
                portfolio
            ) || {};

        return {
            accounts:
                safeNumber(
                    totals.accounts
                ),

            activeAccounts:
                safeNumber(
                    totals.activeAccounts
                ),

            activeRate:
                percentage(
                    totals.activeAccounts,
                    totals.accounts
                ),

            totalBalance:
                round(
                    totals.totalBalance
                ),

            availableBalance:
                round(
                    totals.availableBalance
                ),

            blockedBalance:
                round(
                    totals.blockedBalance
                ),

            totalDeposits:
                round(
                    totals.totalDeposits
                ),

            totalWithdrawals:
                round(
                    totals.totalWithdrawals
                ),

            netSavings:
                round(
                    totals.netSavings
                ),

            accruedInterest:
                round(
                    totals.accruedInterest
                ),

            totalDividends:
                round(
                    totals.totalDividends
                ),

            fraudFlagged:
                safeNumber(
                    totals.fraudFlagged
                ),

            byType:
                byType.map(
                    (row) => ({
                        type:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        balance:
                            round(
                                row.balance
                            ),

                        netSavings:
                            round(
                                row.netSavings
                            ),
                    })
                ),

            byStatus:
                byStatus.map(
                    (row) => ({
                        status:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        balance:
                            round(
                                row.balance
                            ),
                    })
                ),

            trend:
                trend.map(
                    (row) => ({
                        date:
                            row._id,

                        accounts:
                            safeNumber(
                                row.accounts
                            ),

                        deposits:
                            round(
                                row.deposits
                            ),

                        withdrawals:
                            round(
                                row.withdrawals
                            ),

                        netSavings:
                            round(
                                row.netSavings
                            ),
                    })
                ),
        };
    }

    /**
     * =========================================================================
     * TRANSACTION ANALYTICS
     * =========================================================================
     */

    async getTransactionMetrics(
        tenantId,
        range
    ) {
        const tenantMatch =
            transactionTenantMatch(
                tenantId
            );

        const periodMatch = {
            ...tenantMatch,

            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            overall,
            statusBreakdown,
            typeBreakdown,
            providerBreakdown,
            currencyBreakdown,
            trend,
            reconciliation,
        ] = await Promise.all([
            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id: null,

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },

                        fees:
                            {
                                $sum:
                                    '$fees',
                            },

                        netAmount:
                            {
                                $sum:
                                    '$netAmount',
                            },

                        successful:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                SUCCESS_TRANSACTION_STATUSES,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        failed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$status',
                                                'FAILED',
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            '$status',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            '$transactionType',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },

                        fees:
                            {
                                $sum:
                                    '$fees',
                            },
                    },
                },

                {
                    $sort: {
                        amount: -1,
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            '$provider',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },

                {
                    $sort: {
                        amount: -1,
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            '$currency',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },

                {
                    $sort: {
                        amount: -1,
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            {
                                $dateToString: {
                                    format:
                                        range.period ===
                                        '24h'
                                            ? '%Y-%m-%dT%H:00:00Z'
                                            : '%Y-%m-%d',

                                    date:
                                        '$createdAt',
                                },
                            },

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },

                        fees:
                            {
                                $sum:
                                    '$fees',
                            },

                        successful:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                SUCCESS_TRANSACTION_STATUSES,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        failed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$status',
                                                'FAILED',
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                    },
                },

                {
                    $sort: {
                        _id: 1,
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        reconciled:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$reconciled',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        unreconciled:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$reconciled',
                                                false,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },

                        accountingPosted:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$accountingPosted',
                                                true,
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),
        ]);

        const totals =
            firstResult(
                overall
            ) || {};

        const reconciliationTotals =
            firstResult(
                reconciliation
            ) || {};

        return {
            periodCount:
                safeNumber(
                    totals.count
                ),

            periodAmount:
                round(
                    totals.amount
                ),

            periodFees:
                round(
                    totals.fees
                ),

            periodNetAmount:
                round(
                    totals.netAmount
                ),

            successful:
                safeNumber(
                    totals.successful
                ),

            failed:
                safeNumber(
                    totals.failed
                ),

            successRate:
                percentage(
                    totals.successful,
                    totals.count
                ),

            failureRate:
                percentage(
                    totals.failed,
                    totals.count
                ),

            statusBreakdown:
                statusBreakdown.map(
                    (row) => ({
                        status:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),
                    })
                ),

            typeBreakdown:
                typeBreakdown.map(
                    (row) => ({
                        type:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),

                        fees:
                            round(
                                row.fees
                            ),
                    })
                ),

            providerBreakdown:
                providerBreakdown.map(
                    (row) => ({
                        provider:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),
                    })
                ),

            currencyBreakdown:
                currencyBreakdown.map(
                    (row) => ({
                        currency:
                            row._id ||
                            CURRENCY_FALLBACK,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),
                    })
                ),

            trend:
                trend.map(
                    (row) => ({
                        date:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),

                        fees:
                            round(
                                row.fees
                            ),

                        successful:
                            safeNumber(
                                row.successful
                            ),

                        failed:
                            safeNumber(
                                row.failed
                            ),
                    })
                ),

            reconciliation: {
                total:
                    safeNumber(
                        reconciliationTotals.total
                    ),

                reconciled:
                    safeNumber(
                        reconciliationTotals.reconciled
                    ),

                unreconciled:
                    safeNumber(
                        reconciliationTotals.unreconciled
                    ),

                accountingPosted:
                    safeNumber(
                        reconciliationTotals.accountingPosted
                    ),

                reconciliationRate:
                    percentage(
                        reconciliationTotals.reconciled,
                        reconciliationTotals.total
                    ),
            },
        };
    }

    /**
     * =========================================================================
     * CONTRIBUTION ANALYTICS
     * =========================================================================
     */

    async getContributionMetrics(
        tenantId,
        range
    ) {
        const match = {
            ...contributionTenantMatch(
                tenantId
            ),

            isDeleted: false,

            date: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            summary,
            currencyBreakdown,
            trend,
        ] = await Promise.all([
            this.models.Contribution.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id: null,

                        count:
                            {
                                $sum: 1,
                            },

                        total:
                            {
                                $sum:
                                    '$amount',
                            },

                        average:
                            {
                                $avg:
                                    '$amount',
                            },
                    },
                },
            ]),

            this.models.Contribution.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            '$currency',

                        count:
                            {
                                $sum: 1,
                            },

                        total:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },

                {
                    $sort: {
                        total: -1,
                    },
                },
            ]),

            this.models.Contribution.aggregate([
                {
                    $match:
                        match,
                },

                {
                    $group: {
                        _id:
                            {
                                $dateToString: {
                                    format:
                                        range.period ===
                                        '24h'
                                            ? '%Y-%m-%dT%H:00:00Z'
                                            : '%Y-%m-%d',

                                    date:
                                        '$date',
                                },
                            },

                        count:
                            {
                                $sum: 1,
                            },

                        total:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },

                {
                    $sort: {
                        _id: 1,
                    },
                },
            ]),
        ]);

        const totals =
            firstResult(
                summary
            ) || {};

        return {
            count:
                safeNumber(
                    totals.count
                ),

            total:
                round(
                    totals.total
                ),

            average:
                round(
                    totals.average
                ),

            currencies:
                currencyBreakdown.map(
                    (row) => ({
                        currency:
                            row._id ||
                            CURRENCY_FALLBACK,

                        count:
                            safeNumber(
                                row.count
                            ),

                        total:
                            round(
                                row.total
                            ),
                    })
                ),

            trend:
                trend.map(
                    (row) => ({
                        date:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        total:
                            round(
                                row.total
                            ),
                    })
                ),
        };
    }

    /**
     * =========================================================================
     * LOAN ANALYTICS
     * =========================================================================
     */

    async getLoanMetrics(
        tenantId,
        range
    ) {
        const tenantMatch =
            loanTenantMatch(
                tenantId
            );

        const periodMatch = {
            ...tenantMatch,

            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            portfolio,
            byStatus,
            byPurpose,
            riskDistribution,
            parDistribution,
            trend,
        ] = await Promise.all([
            this.models.Loan.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id: null,

                        totalLoans:
                            {
                                $sum: 1,
                            },

                        totalDisbursed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                DISBURSED_LOAN_STATUSES,
                                            ],
                                        },

                                        '$amount',

                                        0,
                                    ],
                                },
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },

                        amountDue:
                            {
                                $sum:
                                    '$amountDue',
                            },

                        amountRepaid:
                            {
                                $sum:
                                    '$amountRepaid',
                            },

                        activeLoans:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                ACTIVE_LOAN_STATUSES,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        defaultedLoans:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                RISKY_LOAN_STATUSES,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        fraudFlagged:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$fraudFlagged',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        amountRecovered:
                            {
                                $sum:
                                    '$amountRecovered',
                            },

                        writtenOffAmount:
                            {
                                $sum:
                                    '$writtenOffAmount',
                            },
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id:
                            '$status',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },
                    },
                },

                {
                    $sort: {
                        count: -1,
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id:
                            '$purpose',

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },
                    },
                },

                {
                    $sort: {
                        amount: -1,
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $gte: [
                                                '$riskScore',
                                                80,
                                            ],
                                        },

                                        then:
                                            'HIGH',
                                    },

                                    {
                                        case: {
                                            $gte: [
                                                '$riskScore',
                                                60,
                                            ],
                                        },

                                        then:
                                            'MEDIUM',
                                    },
                                ],

                                default:
                                    'LOW',
                            },
                        },

                        count:
                            {
                                $sum: 1,
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },
                    },
                },

                {
                    $sort: {
                        outstanding: -1,
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        tenantMatch,
                },

                {
                    $group: {
                        _id: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $gte: [
                                                '$daysPastDue',
                                                90,
                                            ],
                                        },

                                        then:
                                            'PAR90',
                                    },

                                    {
                                        case: {
                                            $gte: [
                                                '$daysPastDue',
                                                60,
                                            ],
                                        },

                                        then:
                                            'PAR60',
                                    },

                                    {
                                        case: {
                                            $gte: [
                                                '$daysPastDue',
                                                30,
                                            ],
                                        },

                                        then:
                                            'PAR30',
                                    },
                                ],

                                default:
                                    'CURRENT',
                            },
                        },

                        count:
                            {
                                $sum: 1,
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },
                    },
                },

                {
                    $sort: {
                        outstanding: -1,
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        periodMatch,
                },

                {
                    $group: {
                        _id:
                            {
                                $dateToString: {
                                    format:
                                        range.period ===
                                        '24h'
                                            ? '%Y-%m-%dT%H:00:00Z'
                                            : '%Y-%m-%d',

                                    date:
                                        '$createdAt',
                                },
                            },

                        applications:
                            {
                                $sum: 1,
                            },

                        requestedAmount:
                            {
                                $sum:
                                    '$amount',
                            },

                        disbursedAmount:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $in: [
                                                '$status',
                                                DISBURSED_LOAN_STATUSES,
                                            ],
                                        },

                                        '$amount',

                                        0,
                                    ],
                                },
                            },

                        outstanding:
                            {
                                $sum:
                                    '$outstandingBalance',
                            },
                    },
                },

                {
                    $sort: {
                        _id: 1,
                    },
                },
            ]),
        ]);

        const totals =
            firstResult(
                portfolio
            ) || {};

        const disbursed =
            safeNumber(
                totals.totalDisbursed
            );

        const amountRepaid =
            safeNumber(
                totals.amountRepaid
            );

        const outstanding =
            safeNumber(
                totals.outstanding
            );

        const amountDue =
            safeNumber(
                totals.amountDue
            );

        const par30 =
            this.findBreakdownValue(
                parDistribution,
                'PAR30'
            );

        const par60 =
            this.findBreakdownValue(
                parDistribution,
                'PAR60'
            );

        const par90 =
            this.findBreakdownValue(
                parDistribution,
                'PAR90'
            );

        return {
            totalLoans:
                safeNumber(
                    totals.totalLoans
                ),

            activeLoans:
                safeNumber(
                    totals.activeLoans
                ),

            defaultedLoans:
                safeNumber(
                    totals.defaultedLoans
                ),

            totalDisbursed:
                round(
                    disbursed
                ),

            outstanding:
                round(
                    outstanding
                ),

            amountDue:
                round(
                    amountDue
                ),

            amountRepaid:
                round(
                    amountRepaid
                ),

            repaymentRate:
                percentage(
                    amountRepaid,
                    disbursed
                ),

            collectionRate:
                percentage(
                    amountRepaid,
                    amountDue
                ),

            defaultRate:
                percentage(
                    totals.defaultedLoans,
                    totals.totalLoans
                ),

            fraudFlagged:
                safeNumber(
                    totals.fraudFlagged
                ),

            amountRecovered:
                round(
                    totals.amountRecovered
                ),

            writtenOffAmount:
                round(
                    totals.writtenOffAmount
                ),

            recoveryRate:
                percentage(
                    totals.amountRecovered,
                    totals.writtenOffAmount
                ),

            par: {
                par30:
                    round(
                        par30.outstanding
                    ),

                par60:
                    round(
                        par60.outstanding
                    ),

                par90:
                    round(
                        par90.outstanding
                    ),

                par30Ratio:
                    percentage(
                        par30.outstanding,
                        outstanding
                    ),

                par60Ratio:
                    percentage(
                        par60.outstanding,
                        outstanding
                    ),

                par90Ratio:
                    percentage(
                        par90.outstanding,
                        outstanding
                    ),

                nplRatio:
                    percentage(
                        par90.outstanding,
                        outstanding
                    ),
            },

            byStatus:
                byStatus.map(
                    (row) => ({
                        status:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),

                        outstanding:
                            round(
                                row.outstanding
                            ),
                    })
                ),

            byPurpose:
                byPurpose.map(
                    (row) => ({
                        purpose:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        amount:
                            round(
                                row.amount
                            ),

                        outstanding:
                            round(
                                row.outstanding
                            ),
                    })
                ),

            riskDistribution:
                riskDistribution.map(
                    (row) => ({
                        risk:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        outstanding:
                            round(
                                row.outstanding
                            ),
                    })
                ),

            parDistribution:
                parDistribution.map(
                    (row) => ({
                        bucket:
                            row._id,

                        count:
                            safeNumber(
                                row.count
                            ),

                        outstanding:
                            round(
                                row.outstanding
                            ),
                    })
                ),

            trend:
                trend.map(
                    (row) => ({
                        date:
                            row._id,

                        applications:
                            safeNumber(
                                row.applications
                            ),

                        requestedAmount:
                            round(
                                row.requestedAmount
                            ),

                        disbursedAmount:
                            round(
                                row.disbursedAmount
                            ),

                        outstanding:
                            round(
                                row.outstanding
                            ),
                    })
                ),
        };
    }

    /**
     * =========================================================================
     * RISK ANALYTICS
     * =========================================================================
     */

    async getRiskMetrics(
        tenantId,
        range
    ) {
        const loanTenant =
            loanTenantMatch(
                tenantId
            );

        const memberTenant =
            memberTenantMatch(
                tenantId
            );

        const transactionTenant =
            transactionTenantMatch(
                tenantId
            );

        const periodTransactionMatch = {
            ...transactionTenant,

            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            memberRisk,
            loanRisk,
            fraud,
            highValueTransactions,
        ] = await Promise.all([
            this.models.Member.aggregate([
                {
                    $match:
                        memberTenant,
                },

                {
                    $group: {
                        _id: null,

                        highRisk:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $gte: [
                                                '$riskScore',
                                                80,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        fraudRisk:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $gte: [
                                                '$fraudRiskScore',
                                                80,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        blacklisted:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$blacklisted',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        sanctionsUnscreened:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$sanctionsScreened',
                                                false,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.Loan.aggregate([
                {
                    $match:
                        loanTenant,
                },

                {
                    $group: {
                        _id: null,

                        highRisk:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $gte: [
                                                '$riskScore',
                                                80,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        fraudFlagged:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$fraudFlagged',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        fraudRisk:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $gte: [
                                                '$fraudRiskScore',
                                                80,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.FraudLog.aggregate([
                {
                    $match:
                        fraudTenant,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        blocked:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$decision',
                                                'BLOCK',
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        stepUp:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$decision',
                                                'STEP_UP',
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        unreviewed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$reviewed',
                                                false,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        averageScore:
                            {
                                $avg:
                                    '$fraudScore',
                            },
                    },
                },
            ]),

            this.models.Transaction.aggregate([
                {
                    $match:
                        periodTransactionMatch,
                },

                {
                    $group: {
                        _id: null,

                        count:
                            {
                                $sum: 1,
                            },

                        amount:
                            {
                                $sum:
                                    '$amount',
                            },
                    },
                },
            ]),
        ]);

        const members =
            firstResult(
                memberRisk
            ) || {};

        const loans =
            firstResult(
                loanRisk
            ) || {};

        const fraudRows =
            firstResult(
                fraud
            ) || {};

        const tx =
            firstResult(
                highValueTransactions
            ) || {};

        return {
            members: {
                highRisk:
                    safeNumber(
                        members.highRisk
                    ),

                fraudRisk:
                    safeNumber(
                        members.fraudRisk
                    ),

                blacklisted:
                    safeNumber(
                        members.blacklisted
                    ),

                sanctionsUnscreened:
                    safeNumber(
                        members.sanctionsUnscreened
                    ),
            },

            loans: {
                highRisk:
                    safeNumber(
                        loans.highRisk
                    ),

                fraudFlagged:
                    safeNumber(
                        loans.fraudFlagged
                    ),

                fraudRisk:
                    safeNumber(
                        loans.fraudRisk
                    ),
            },

            fraud: {
                total:
                    safeNumber(
                        fraudRows.total
                    ),

                blocked:
                    safeNumber(
                        fraudRows.blocked
                    ),

                stepUp:
                    safeNumber(
                        fraudRows.stepUp
                    ),

                unreviewed:
                    safeNumber(
                        fraudRows.unreviewed
                    ),

                averageScore:
                    round(
                        safeNumber(
                            fraudRows.averageScore
                        ),
                        4
                    ),

                blockRate:
                    percentage(
                        fraudRows.blocked,
                        fraudRows.total
                    ),

                reviewCompletionRate:
                    percentage(
                        safeNumber(
                            fraudRows.total
                        ) -
                        safeNumber(
                            fraudRows.unreviewed
                        ),
                        fraudRows.total
                    ),
            },

            monitoredTransactionVolume:
                {
                    count:
                        safeNumber(
                            tx.count
                        ),

                    amount:
                        round(
                            tx.amount
                        ),
                },
        };
    }

    /**
     * =========================================================================
     * COMPLIANCE ANALYTICS
     * =========================================================================
     */

    async getComplianceMetrics(
        tenantId,
        range
    ) {
        const memberTenant =
            memberTenantMatch(
                tenantId
            );

        const auditTenant =
            auditTenantMatch(
                tenantId
            );

        const fraudTenant =
            fraudTenantMatch(
                tenantId
            );

        const complianceTenant =
            complianceTenantMatch(
                tenantId
            );

        const auditPeriod = {
            ...auditTenant,

            timestamp: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const compliancePeriod = {
            ...complianceTenant,

            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const fraudPeriod = {
            ...fraudTenant,

            createdAt: {
                $gte: range.from,
                $lte: range.to,
            },
        };

        const [
            members,
            audit,
            compliance,
            fraud,
        ] = await Promise.all([
            this.models.Member.aggregate([
                {
                    $match:
                        memberTenant,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        kycVerified:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$kycVerified',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        amlChecked:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$amlChecked',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        sanctionsScreened:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$sanctionsScreened',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        blacklisted:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$blacklisted',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.Audit.aggregate([
                {
                    $match:
                        auditPeriod,
                },

                {
                    $group: {
                        _id: null,

                        events:
                            {
                                $sum: 1,
                            },
                    },
                },
            ]),

            this.models.ComplianceLog.aggregate([
                {
                    $match:
                        compliancePeriod,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        flagged:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$flagged',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        unresolved:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $and: [
                                                {
                                                    $eq: [
                                                        '$flagged',
                                                        true,
                                                    ],
                                                },

                                                {
                                                    $eq: [
                                                        '$resolved',
                                                        false,
                                                    ],
                                                },
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        archived:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$archived',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),

            this.models.FraudLog.aggregate([
                {
                    $match:
                        fraudPeriod,
                },

                {
                    $group: {
                        _id: null,

                        total:
                            {
                                $sum: 1,
                            },

                        reviewed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$reviewed',
                                                true,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        unreviewed:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$reviewed',
                                                false,
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },

                        blocked:
                            {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                '$decision',
                                                'BLOCK',
                                            ],
                                        },

                                        1,

                                        0,
                                    ],
                                },
                            },
                    },
                },
            ]),
        ]);

        const memberTotals =
            firstResult(
                members
            ) || {};

        const auditTotals =
            firstResult(
                audit
            ) || {};

        const complianceTotals =
            firstResult(
                compliance
            ) || {};

        const fraudTotals =
            firstResult(
                fraud
            ) || {};

        return {
            members: {
                total:
                    safeNumber(
                        memberTotals.total
                    ),

                kycVerified:
                    safeNumber(
                        memberTotals.kycVerified
                    ),

                amlChecked:
                    safeNumber(
                        memberTotals.amlChecked
                    ),

                sanctionsScreened:
                    safeNumber(
                        memberTotals.sanctionsScreened
                    ),

                blacklisted:
                    safeNumber(
                        memberTotals.blacklisted
                    ),

                kycRate:
                    percentage(
                        memberTotals.kycVerified,
                        memberTotals.total
                    ),

                amlRate:
                    percentage(
                        memberTotals.amlChecked,
                        memberTotals.total
                    ),

                sanctionsScreeningRate:
                    percentage(
                        memberTotals.sanctionsScreened,
                        memberTotals.total
                    ),
            },

            audit: {
                events:
                    safeNumber(
                        auditTotals.events
                    ),
            },

            complianceLog: {
                total:
                    safeNumber(
                        complianceTotals.total
                    ),

                flagged:
                    safeNumber(
                        complianceTotals.flagged
                    ),

                unresolved:
                    safeNumber(
                        complianceTotals.unresolved
                    ),

                archived:
                    safeNumber(
                        complianceTotals.archived
                    ),

                flagRate:
                    percentage(
                        complianceTotals.flagged,
                        complianceTotals.total
                    ),

                resolutionRate:
                    percentage(
                        safeNumber(
                            complianceTotals.flagged
                        ) -
                        safeNumber(
                            complianceTotals.unresolved
                        ),
                        complianceTotals.flagged
                    ),
            },

            fraudLog: {
                total:
                    safeNumber(
                        fraudTotals.total
                    ),

                reviewed:
                    safeNumber(
                        fraudTotals.reviewed
                    ),

                unreviewed:
                    safeNumber(
                        fraudTotals.unreviewed
                    ),

                blocked:
                    safeNumber(
                        fraudTotals.blocked
                    ),

                reviewRate:
                    percentage(
                        fraudTotals.reviewed,
                        fraudTotals.total
                    ),
            },
        };
    }

    /**
     * =========================================================================
     * GROUP ANALYTICS
     * =========================================================================
     *
     * The current Group schema has no tenantId.
     *
     * Therefore:
     *   - Do not count all Group records for a tenant.
     *   - Derive only groups observed through tenant-scoped contribution /
     *     loan records.
     *   - Explicitly label the metric as observed/derived.
     *
     * This avoids a cross-tenant information leak.
     * =========================================================================
     */

    async getObservedGroupMetrics(
        tenantId,
        range
    ) {
        const contributionMatch = {
            ...contributionTenantMatch(
                tenantId
            ),

            isDeleted: false,
        };

        const loanMatch =
            loanTenantMatch(
                tenantId
            );

        const [
            contributionGroups,
            loanGroups,
        ] = await Promise.all([
            this.models.Contribution.distinct(
                'groupId',
                contributionMatch
            ),

            this.models.Loan.distinct(
                'group',
                loanMatch
            ),
        ]);

        const groupIds =
            new Set();

        for (
            const groupId of
            contributionGroups
        ) {
            if (groupId) {
                groupIds.add(
                    String(groupId)
                );
            }
        }

        for (
            const groupId of
            loanGroups
        ) {
            if (groupId) {
                groupIds.add(
                    String(groupId)
                );
            }
        }

        return {
            count:
                groupIds.size,

            scope:
                'derived_from_tenant_scoped_contributions_and_loans',

            tenantSafe:
                true,

            complete:
                false,

            limitation:
                'The current Group model has no tenantId field, so a complete tenant-wide group count cannot be safely derived without an explicit tenant relationship.',
        };
    }

    /**
     * =========================================================================
     * TREND API
     * =========================================================================
     *
     * Returns the dashboard-ready trends without forcing the controller to
     * understand the individual model schemas.
     * =========================================================================
     */

    async getTrends(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        try {
            const [
                transactions,
                savings,
                contributions,
                loans,
                members,
            ] = await Promise.all([
                this.models.Transaction.aggregate([
                    {
                        $match: {
                            ...transactionTenantMatch(
                                normalizedTenantId
                            ),

                            createdAt: {
                                $gte:
                                    range.from,

                                $lte:
                                    range.to,
                            },
                        },
                    },

                    {
                        $group: {
                            _id:
                                {
                                    $dateToString: {
                                        format:
                                            range.period ===
                                            '24h'
                                                ? '%Y-%m-%dT%H:00:00Z'
                                                : '%Y-%m-%d',

                                        date:
                                            '$createdAt',
                                    },
                                },

                            amount:
                                {
                                    $sum:
                                        '$amount',
                                },

                            count:
                                {
                                    $sum: 1,
                                },
                        },
                    },

                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]),

                this.models.Savings.aggregate([
                    {
                        $match: {
                            ...savingsTenantMatch(
                                normalizedTenantId
                            ),

                            updatedAt: {
                                $gte:
                                    range.from,

                                $lte:
                                    range.to,
                            },
                        },
                    },

                    {
                        $group: {
                            _id:
                                {
                                    $dateToString: {
                                        format:
                                            range.period ===
                                            '24h'
                                                ? '%Y-%m-%dT%H:00:00Z'
                                                : '%Y-%m-%d',

                                        date:
                                            '$updatedAt',
                                    },
                                },

                            balance:
                                {
                                    $sum:
                                        '$balance',
                                },

                            deposits:
                                {
                                    $sum:
                                        '$totalDeposits',
                                },

                            withdrawals:
                                {
                                    $sum:
                                        '$totalWithdrawals',
                                },
                        },
                    },

                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]),

                this.models.Contribution.aggregate([
                    {
                        $match: {
                            ...contributionTenantMatch(
                                normalizedTenantId
                            ),

                            isDeleted:
                                false,

                            date: {
                                $gte:
                                    range.from,

                                $lte:
                                    range.to,
                            },
                        },
                    },

                    {
                        $group: {
                            _id:
                                {
                                    $dateToString: {
                                        format:
                                            range.period ===
                                            '24h'
                                                ? '%Y-%m-%dT%H:00:00Z'
                                                : '%Y-%m-%d',

                                        date:
                                            '$date',
                                    },
                                },

                            total:
                                {
                                    $sum:
                                        '$amount',
                                },

                            count:
                                {
                                    $sum: 1,
                                },
                        },
                    },

                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]),

                this.models.Loan.aggregate([
                    {
                        $match: {
                            ...loanTenantMatch(
                                normalizedTenantId
                            ),

                            createdAt: {
                                $gte:
                                    range.from,

                                $lte:
                                    range.to,
                            },
                        },
                    },

                    {
                        $group: {
                            _id:
                                {
                                    $dateToString: {
                                        format:
                                            range.period ===
                                            '24h'
                                                ? '%Y-%m-%dT%H:00:00Z'
                                                : '%Y-%m-%d',

                                        date:
                                            '$createdAt',
                                    },
                                },

                            requested:
                                {
                                    $sum:
                                        '$amount',
                                },

                            outstanding:
                                {
                                    $sum:
                                        '$outstandingBalance',
                                },

                            count:
                                {
                                    $sum: 1,
                                },
                        },
                    },

                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]),

                this.models.Member.aggregate([
                    {
                        $match: {
                            ...memberTenantMatch(
                                normalizedTenantId
                            ),

                            createdAt: {
                                $gte:
                                    range.from,

                                $lte:
                                    range.to,
                            },
                        },
                    },

                    {
                        $group: {
                            _id:
                                {
                                    $dateToString: {
                                        format:
                                            range.period ===
                                            '24h'
                                                ? '%Y-%m-%dT%H:00:00Z'
                                                : '%Y-%m-%d',

                                        date:
                                            '$createdAt',
                                    },
                                },

                            count:
                                {
                                    $sum: 1,
                                },
                        },
                    },

                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]),
            ]);

            return {
                period: range.period,

                from: range.from,

                to: range.to,

                transactions:
                    transactions.map(
                        (row) => ({
                            date:
                                row._id,

                            count:
                                safeNumber(
                                    row.count
                                ),

                            amount:
                                round(
                                    row.amount
                                ),
                        })
                    ),

                savings:
                    savings.map(
                        (row) => ({
                            date:
                                row._id,

                            balance:
                                round(
                                    row.balance
                                ),

                            deposits:
                                round(
                                    row.deposits
                                ),

                            withdrawals:
                                round(
                                    row.withdrawals
                                ),
                        })
                    ),

                contributions:
                    contributions.map(
                        (row) => ({
                            date:
                                row._id,

                            count:
                                safeNumber(
                                    row.count
                                ),

                            total:
                                round(
                                    row.total
                                ),
                        })
                    ),

                loans:
                    loans.map(
                        (row) => ({
                            date:
                                row._id,

                            count:
                                safeNumber(
                                    row.count
                                ),

                            requested:
                                round(
                                    row.requested
                                ),

                            outstanding:
                                round(
                                    row.outstanding
                                ),
                        })
                    ),

                members:
                    members.map(
                        (row) => ({
                            date:
                                row._id,

                            count:
                                safeNumber(
                                    row.count
                                ),
                        })
                    ),
            };
        } catch (error) {
            this.logError(
                'Failed to build analytics trends.',
                error,
                {
                    tenantId:
                        normalizedTenantId,

                    period:
                        range.period,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_TRENDS_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * RECENT ADMIN ACTIVITY
     * =========================================================================
     *
     * Audit records intentionally expose only safe operational metadata.
     *
     * The raw "data" object is NOT returned because it can contain arbitrary
     * application data.
     * =========================================================================
     */

    async getRecentAuditActivity(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        const limit =
            range.limit;

        try {
            const rows =
                await this.models.Audit
                    .find({
                        ...auditTenantMatch(
                            normalizedTenantId
                        ),

                        timestamp: {
                            $gte:
                                range.from,

                            $lte:
                                range.to,
                        },
                    })
                    .select(
                        'userId role action timestamp'
                    )
                    .sort({
                        timestamp: -1,
                    })
                    .limit(
                        limit
                    )
                    .lean();

            return rows.map(
                (row) => ({
                    id:
                        row._id
                            ? String(
                                row._id
                            )
                            : null,

                    userId:
                        row.userId
                            ? String(
                                row.userId
                            )
                            : null,

                    role:
                        row.role ||
                        null,

                    action:
                        row.action,

                    timestamp:
                        row.timestamp,
                })
            );
        } catch (error) {
            this.logError(
                'Failed to load recent audit activity.',
                error,
                {
                    tenantId:
                        normalizedTenantId,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_AUDIT_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * FRAUD ALERT FEED
     * =========================================================================
     */

    async getFraudAlerts(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        try {
            const rows =
                await this.models.FraudLog
                    .find({
                        ...fraudTenantMatch(
                            normalizedTenantId
                        ),

                        createdAt: {
                            $gte:
                                range.from,

                            $lte:
                                range.to,
                        },
                    })
                    .select(
                        [
                            'userId',
                            'transactionId',
                            'fraudScore',
                            'decision',
                            'engine',
                            'modelVersion',
                            'reviewed',
                            'createdAt',
                        ].join(' ')
                    )
                    .sort({
                        createdAt: -1,
                    })
                    .limit(
                        range.limit
                    )
                    .lean();

            return rows.map(
                (row) => ({
                    id:
                        row._id
                            ? String(
                                row._id
                            )
                            : null,

                    userId:
                        row.userId
                            ? String(
                                row.userId
                            )
                            : null,

                    transactionId:
                        row.transactionId
                            ? String(
                                row.transactionId
                            )
                            : null,

                    fraudScore:
                        round(
                            row.fraudScore,
                            4
                        ),

                    decision:
                        row.decision,

                    engine:
                        row.engine,

                    modelVersion:
                        row.modelVersion,

                    reviewed:
                        Boolean(
                            row.reviewed
                        ),

                    createdAt:
                        row.createdAt,
                })
            );
        } catch (error) {
            this.logError(
                'Failed to load fraud alerts.',
                error,
                {
                    tenantId:
                        normalizedTenantId,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_FRAUD_ALERTS_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * COMPLIANCE ALERT FEED
     * =========================================================================
     */

    async getComplianceAlerts(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        try {
            const rows =
                await this.models.ComplianceLog
                    .find({
                        ...complianceTenantMatch(
                            normalizedTenantId
                        ),

                        flagged:
                            true,

                        resolved:
                            false,

                        createdAt: {
                            $gte:
                                range.from,

                            $lte:
                                range.to,
                        },
                    })
                    .select(
                        [
                            'userId',
                            'activity',
                            'flagged',
                            'reportId',
                            'reason',
                            'reporter',
                            'resolved',
                            'createdAt',
                        ].join(' ')
                    )
                    .sort({
                        createdAt: -1,
                    })
                    .limit(
                        range.limit
                    )
                    .lean();

            return rows.map(
                (row) => ({
                    id:
                        row._id
                            ? String(
                                row._id
                            )
                            : null,

                    userId:
                        row.userId
                            ? String(
                                row.userId
                            )
                            : null,

                    activity:
                        row.activity,

                    flagged:
                        Boolean(
                            row.flagged
                        ),

                    reportId:
                        row.reportId,

                    reason:
                        row.reason,

                    reporter:
                        row.reporter,

                    resolved:
                        Boolean(
                            row.resolved
                        ),

                    createdAt:
                        row.createdAt,
                })
            );
        } catch (error) {
            this.logError(
                'Failed to load compliance alerts.',
                error,
                {
                    tenantId:
                        normalizedTenantId,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_COMPLIANCE_ALERTS_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * SYSTEM HEALTH
     * =========================================================================
     */

    async health() {
        const checks = {};

        const models =
            this.models;

        for (
            const [
                modelName,
                model,
            ] of Object.entries(
                models
            )
        ) {
            if (
                !model ||
                !model.db ||
                !model.db.readyState
            ) {
                checks[modelName] =
                    'unavailable';

                continue;
            }

            checks[modelName] =
                model.db.readyState === 1
                    ? 'connected'
                    : 'disconnected';
        }

        const healthy =
            Object.values(
                checks
            ).every(
                (status) =>
                    status === 'connected'
            );

        return {
            service:
                this.serviceName,

            version:
                this.version,

            healthy,

            database:
                healthy
                    ? 'connected'
                    : 'degraded',

            modelChecks:
                checks,

            timestamp:
                new Date(),
        };
    }

    /**
     * =========================================================================
     * FULL ADMIN DASHBOARD SNAPSHOT
     * =========================================================================
     */

    async getDashboardSnapshot(
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            this.validateTenantId(
                tenantId
            );

        const range =
            this.normalizeOptions(
                options
            );

        try {
            const [
                overview,
                trends,
                recentAudit,
                fraudAlerts,
                complianceAlerts,
            ] = await Promise.all([
                this.getOverview(
                    normalizedTenantId,
                    options
                ),

                this.getTrends(
                    normalizedTenantId,
                    options
                ),

                this.getRecentAuditActivity(
                    normalizedTenantId,
                    options
                ),

                this.getFraudAlerts(
                    normalizedTenantId,
                    options
                ),

                this.getComplianceAlerts(
                    normalizedTenantId,
                    options
                ),
            ]);

            return {
                ...overview,

                trends,

                alerts: {
                    fraud:
                        fraudAlerts,

                    compliance:
                        complianceAlerts,
                },

                recentAudit,

                generatedAt:
                    new Date(),

                metadata: {
                    period:
                        range.period,

                    from:
                        range.from,

                    to:
                        range.to,
                },
            };
        } catch (error) {
            this.logError(
                'Failed to build admin dashboard snapshot.',
                error,
                {
                    tenantId:
                        normalizedTenantId,

                    period:
                        range.period,
                }
            );

            throw this.wrapError(
                error,
                'ADMIN_ANALYTICS_SNAPSHOT_FAILED'
            );
        }
    }

    /**
     * =========================================================================
     * INTERNAL HELPERS
     * =========================================================================
     */

    findBreakdownValue(
        rows,
        key
    ) {
        return (
            rows.find(
                (row) =>
                    row &&
                    row._id === key
            ) || {
                count: 0,
                outstanding: 0,
            }
        );
    }

    wrapError(
        error,
        code
    ) {
        if (
            error instanceof
            AdminAnalyticsError
        ) {
            return error;
        }

        return new AdminAnalyticsError(
            error?.message ||
            'Admin analytics operation failed.',
            {
                code,
                cause: error,
            }
        );
    }

    logError(
        message,
        error,
        context = {}
    ) {
        try {
            if (
                this.logger &&
                typeof this.logger.error ===
                    'function'
            ) {
                this.logger.error(
                    message,
                    {
                        service:
                            this.serviceName,

                        version:
                            this.version,

                        ...context,

                        error:
                            error?.message,

                        errorName:
                            error?.name,

                        stack:
                            error?.stack,
                    }
                );
            }
        } catch {
            // Logging failure must never replace the original operation error.
        }
    }
}

/**
 * ============================================================================
 * DEFAULT SINGLETON
 * ============================================================================
 */

const adminAnalyticsService =
    new AdminAnalyticsService();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
    adminAnalyticsService;

module.exports.AdminAnalyticsService =
    AdminAnalyticsService;

module.exports.AdminAnalyticsError =
    AdminAnalyticsError;

module.exports.SERVICE_NAME =
    SERVICE_NAME;

module.exports.SERVICE_VERSION =
    SERVICE_VERSION;

module.exports.PERIODS =
    PERIODS;

module.exports.DEFAULT_PERIOD =
    DEFAULT_PERIOD;