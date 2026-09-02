'use strict';

/**
 * ============================================================================
 * ENTERPRISE LOAN REPOSITORY
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * File:
 *   backend/repositories/LoanRepository.js
 *
 * Responsibilities:
 *
 *   - Database access
 *   - Tenant-scoped CRUD
 *   - Portfolio aggregations
 *   - Risk metrics
 *   - Delinquency reporting
 *   - Dashboard queries
 *   - Export queries
 *
 * Explicitly NOT responsible for:
 *
 *   - Loan business rules
 *   - Approval decisions
 *   - Eligibility decisions
 *   - Loan state transitions
 *   - Financial posting
 *   - Ledger mutation
 *   - Authorization
 *
 * Architectural principle:
 *
 *   Service
 *      |
 *      v
 *   LoanRepository
 *      |
 *      v
 *   Loan Model
 *      |
 *      v
 *   MongoDB
 *
 * ============================================================================
 */

const Loan = require('../../../models/Loan');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_SKIP = 0;

const ACTIVE_STATUSES = Object.freeze([
    'active',
    'disbursed'
]);

const DEFAULTED_STATUSES = Object.freeze([
    'defaulted'
]);

const WRITTEN_OFF_STATUSES = Object.freeze([
    'written_off'
]);

const MEMBER_PROJECTION =
    'memberNumber firstName lastName phone';

/**
 * ============================================================================
 * LoanRepository
 * ============================================================================
 */

class LoanRepository {

    /**
     * ========================================================================
     * Validation Helpers
     * ========================================================================
     */

    static assertTenantId(tenantId) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {
            throw new Error('tenantId is required');
        }

    }

    static assertLoanId(loanId) {

        if (
            loanId === undefined ||
            loanId === null ||
            String(loanId).trim() === ''
        ) {
            throw new Error('loanId is required');
        }

    }

    static normalizePagination(options = {}) {

        const requestedSkip =
            Number(options.skip);

        const requestedLimit =
            Number(options.limit);

        const skip =
            Number.isFinite(requestedSkip) &&
            requestedSkip >= 0
                ? Math.floor(requestedSkip)
                : DEFAULT_SKIP;

        const limit =
            Number.isFinite(requestedLimit) &&
            requestedLimit > 0
                ? Math.min(
                    Math.floor(requestedLimit),
                    MAX_LIMIT
                )
                : DEFAULT_LIMIT;

        return {
            skip,
            limit
        };

    }

    /**
     * ========================================================================
     * Tenant Filter Protection
     * ========================================================================
     *
     * Tenant isolation must never be overridden by caller-supplied filters.
     *
     * Therefore:
     *
     *   { ...filter, tenantId }
     *
     * is intentionally NOT used.
     *
     * tenantId is applied last.
     */

    static tenantFilter(
        tenantId,
        filter = {}
    ) {

        this.assertTenantId(tenantId);

        if (
            !filter ||
            typeof filter !== 'object' ||
            Array.isArray(filter)
        ) {
            throw new Error(
                'Loan repository filter must be an object'
            );
        }

        const safeFilter = {
            ...filter
        };

        delete safeFilter.tenantId;

        return {
            ...safeFilter,
            tenantId
        };

    }

    /**
     * ========================================================================
     * BASIC CRUD
     * ========================================================================
     */

    static async create(data) {

        if (
            !data ||
            typeof data !== 'object'
        ) {
            throw new Error(
                'Loan creation data is required'
            );
        }

        this.assertTenantId(
            data.tenantId
        );

        return Loan.create(data);

    }

    static async findById(
        loanId,
        tenantId
    ) {

        this.assertLoanId(loanId);
        this.assertTenantId(tenantId);

        return Loan.findOne({
            _id: loanId,
            tenantId
        });

    }

    /**
     * ========================================================================
     * Update
     * ========================================================================
     *
     * Repository performs persistence only.
     *
     * Business-level validation belongs to the service layer.
     *
     * tenantId is always enforced by the repository.
     */

    static async update(
        loanId,
        tenantId,
        updates
    ) {

        this.assertLoanId(loanId);
        this.assertTenantId(tenantId);

        if (
            !updates ||
            typeof updates !== 'object' ||
            Array.isArray(updates)
        ) {
            throw new Error(
                'Loan updates must be an object'
            );
        }

        const safeUpdates = {
            ...updates
        };

        /**
         * Prevent accidental tenant reassignment.
         */
        delete safeUpdates.tenantId;

        return Loan.findOneAndUpdate(
            {
                _id: loanId,
                tenantId
            },
            safeUpdates,
            {
                new: true,
                runValidators: true
            }
        );

    }

    /**
     * ========================================================================
     * FIND
     * ========================================================================
     */

    static async find(
        filter = {},
        options = {}
    ) {

        const {
            skip,
            limit
        } =
            this.normalizePagination(
                options
            );

        /**
         * If the caller supplied tenantId, preserve existing generic
         * repository behavior.
         *
         * Tenant-specific service methods should prefer tenantFilter().
         */
        return Loan.find(filter)
            .sort(
                options.sort || {}
            )
            .skip(skip)
            .limit(limit);

    }

    /**
     * ========================================================================
     * TENANT-SCOPED FIND
     * ========================================================================
     */

    static async findByTenant(
        tenantId,
        filter = {},
        options = {}
    ) {

        this.assertTenantId(tenantId);

        const {
            skip,
            limit
        } =
            this.normalizePagination(
                options
            );

        return Loan.find(
            this.tenantFilter(
                tenantId,
                filter
            )
        )
            .sort(
                options.sort || {
                    createdAt: -1
                }
            )
            .skip(skip)
            .limit(limit);

    }

    /**
     * ========================================================================
     * PORTFOLIO AT RISK
     * ========================================================================
     *
     * PAR = outstanding balance of loans past threshold
     *       ----------------------------------------------
     *       outstanding balance of qualifying portfolio
     *
     * Returned as percentage.
     */

    static async calculatePAR(
        tenantId,
        threshold
    ) {

        this.assertTenantId(tenantId);

        const numericThreshold =
            Number(threshold);

        if (
            !Number.isFinite(numericThreshold) ||
            numericThreshold < 0
        ) {
            throw new Error(
                'PAR threshold must be a non-negative number'
            );
        }

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        portfolioBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            ACTIVE_STATUSES
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        overdueBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gte: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    numericThreshold
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const portfolioBalance =
            Number(
                result[0]?.portfolioBalance || 0
            );

        const overdueBalance =
            Number(
                result[0]?.overdueBalance || 0
            );

        if (
            portfolioBalance <= 0
        ) {
            return 0;
        }

        return (
            overdueBalance /
            portfolioBalance
        ) * 100;

    }

    static async calculatePAR30(
        tenantId
    ) {

        return this.calculatePAR(
            tenantId,
            30
        );

    }

    static async calculatePAR60(
        tenantId
    ) {

        return this.calculatePAR(
            tenantId,
            60
        );

    }

    static async calculatePAR90(
        tenantId
    ) {

        return this.calculatePAR(
            tenantId,
            90
        );

    }

    static async calculatePortfolioAtRisk(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const [
            par30,
            par60,
            par90
        ] =
            await Promise.all([
                this.calculatePAR30(
                    tenantId
                ),
                this.calculatePAR60(
                    tenantId
                ),
                this.calculatePAR90(
                    tenantId
                )
            ]);

        return {
            par30,
            par60,
            par90,
            generatedAt:
                new Date()
        };

    }

    /**
     * ========================================================================
     * NPL RATIO
     * ========================================================================
     *
     * NPL:
     *   Days past due > 90
     *
     * Numerator:
     *   Outstanding balance of NPL loans.
     *
     * Denominator:
     *   Outstanding balance of active/disbursed portfolio.
     */

    static async calculateNPLRatio(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        portfolioBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            ACTIVE_STATUSES
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        nplBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gt: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    90
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const portfolioBalance =
            Number(
                result[0]?.portfolioBalance || 0
            );

        const nplBalance =
            Number(
                result[0]?.nplBalance || 0
            );

        if (
            portfolioBalance <= 0
        ) {
            return 0;
        }

        return (
            nplBalance /
            portfolioBalance
        ) * 100;

    }

    /**
     * ========================================================================
     * COLLECTION RATIO
     * ========================================================================
     *
     * Collection ratio:
     *
     * amountRepaid
     * ------------
     * amountDue
     *
     * This assumes amountDue and amountRepaid have compatible business
     * semantics in the Loan model.
     */

    static async calculateCollectionRatio(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        collected: {
                            $sum: {
                                $ifNull: [
                                    '$amountRepaid',
                                    0
                                ]
                            }
                        },

                        due: {
                            $sum: {
                                $ifNull: [
                                    '$amountDue',
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const collected =
            Number(
                result[0]?.collected || 0
            );

        const due =
            Number(
                result[0]?.due || 0
            );

        if (due <= 0) {
            return 0;
        }

        return (
            collected /
            due
        ) * 100;

    }

    /**
     * ========================================================================
     * RECOVERY RATE
     * ========================================================================
     *
     * recovered amount / written-off amount.
     */

    static async calculateRecoveryRate(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        recovered: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            [
                                                ...DEFAULTED_STATUSES,
                                                'recovered'
                                            ]
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$amountRecovered',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        writtenOff: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            WRITTEN_OFF_STATUSES
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$writtenOffAmount',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const recovered =
            Number(
                result[0]?.recovered || 0
            );

        const writtenOff =
            Number(
                result[0]?.writtenOff || 0
            );

        if (
            writtenOff <= 0
        ) {
            return 0;
        }

        return (
            recovered /
            writtenOff
        ) * 100;

    }

    /**
     * ========================================================================
     * WRITE-OFF RATE
     * ========================================================================
     *
     * Count-based write-off ratio.
     */

    static async calculateWriteOffRate(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        totalLoans: {
                            $sum: 1
                        },

                        writtenOffLoans: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            WRITTEN_OFF_STATUSES
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const totalLoans =
            Number(
                result[0]?.totalLoans || 0
            );

        const writtenOffLoans =
            Number(
                result[0]?.writtenOffLoans || 0
            );

        if (
            totalLoans <= 0
        ) {
            return 0;
        }

        return (
            writtenOffLoans /
            totalLoans
        ) * 100;

    }

    /**
     * ========================================================================
     * AVERAGE DAYS PAST DUE
     * ========================================================================
     */

    static async calculateAverageDaysPastDue(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId,
                        daysPastDue: {
                            $gt: 0
                        }
                    }
                },
                {
                    $group: {
                        _id: null,

                        average: {
                            $avg: '$daysPastDue'
                        }
                    }
                }
            ]);

        return Number(
            result[0]?.average || 0
        );

    }

    /**
     * ========================================================================
     * AVERAGE LOAN SIZE
     * ========================================================================
     */

    static async getAverageLoanSize(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        average: {
                            $avg: '$amount'
                        }
                    }
                }
            ]);

        return Number(
            result[0]?.average || 0
        );

    }

    /**
     * ========================================================================
     * DELINQUENCY REPORTING
     * ========================================================================
     */

    static async getOverdueLoans(
        tenantId,
        options = {}
    ) {

        this.assertTenantId(tenantId);

        const {
            skip,
            limit
        } =
            this.normalizePagination(
                options
            );

        return Loan.find({
            tenantId,
            status: 'active',
            daysPastDue: {
                $gt: 0
            }
        })
            .populate(
                'member',
                MEMBER_PROJECTION
            )
            .sort(
                options.sort || {
                    daysPastDue: -1,
                    createdAt: -1
                }
            )
            .skip(skip)
            .limit(limit)
            .lean();

    }

    /**
     * ========================================================================
     * DEFAULTED LOANS
     * ========================================================================
     */

    static async getDefaultedLoans(
        tenantId,
        options = {}
    ) {

        this.assertTenantId(tenantId);

        const {
            skip,
            limit
        } =
            this.normalizePagination(
                options
            );

        return Loan.find({
            tenantId,
            status: 'defaulted'
        })
            .populate(
                'member',
                MEMBER_PROJECTION
            )
            .sort(
                options.sort || {
                    createdAt: -1
                }
            )
            .skip(skip)
            .limit(limit)
            .lean();

    }

    /**
     * ========================================================================
     * EXPORT LOANS
     * ========================================================================
     *
     * Tenant is always enforced last.
     */

    static async exportLoans(
        filters = {},
        tenantId,
        options = {}
    ) {

        this.assertTenantId(tenantId);

        const {
            skip,
            limit
        } =
            this.normalizePagination(
                options
            );

        return Loan.find(
            this.tenantFilter(
                tenantId,
                filters
            )
        )
            .populate(
                'member',
                MEMBER_PROJECTION
            )
            .sort(
                options.sort || {
                    createdAt: -1
                }
            )
            .skip(skip)
            .limit(limit)
            .lean();

    }

    /**
     * ========================================================================
     * LOAN BOOK SUMMARY
     * ========================================================================
     */

    static async getLoanBookSummary(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        totalLoans: {
                            $sum: 1
                        },

                        totalAmount: {
                            $sum: {
                                $ifNull: [
                                    '$amount',
                                    0
                                ]
                            }
                        },

                        outstandingBalance: {
                            $sum: {
                                $ifNull: [
                                    '$outstandingBalance',
                                    0
                                ]
                            }
                        },

                        repaidAmount: {
                            $sum: {
                                $ifNull: [
                                    '$amountRepaid',
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        return result[0] || {
            totalLoans: 0,
            totalAmount: 0,
            outstandingBalance: 0,
            repaidAmount: 0
        };

    }

    /**
     * ========================================================================
     * PORTFOLIO METRICS
     * ========================================================================
     *
     * Single aggregation for dashboard/risk services where possible.
     */

    static async getPortfolioMetrics(
        tenantId
    ) {

        this.assertTenantId(tenantId);

        const result =
            await Loan.aggregate([
                {
                    $match: {
                        tenantId
                    }
                },
                {
                    $group: {
                        _id: null,

                        totalLoans: {
                            $sum: 1
                        },

                        totalDisbursed: {
                            $sum: {
                                $ifNull: [
                                    '$amount',
                                    0
                                ]
                            }
                        },

                        outstandingBalance: {
                            $sum: {
                                $ifNull: [
                                    '$outstandingBalance',
                                    0
                                ]
                            }
                        },

                        amountRepaid: {
                            $sum: {
                                $ifNull: [
                                    '$amountRepaid',
                                    0
                                ]
                            }
                        },

                        amountDue: {
                            $sum: {
                                $ifNull: [
                                    '$amountDue',
                                    0
                                ]
                            }
                        },

                        overdueBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gt: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    0
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        par30Balance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gte: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    30
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        par60Balance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gte: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    60
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        par90Balance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gte: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    90
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        nplBalance: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            {
                                                $in: [
                                                    '$status',
                                                    ACTIVE_STATUSES
                                                ]
                                            },
                                            {
                                                $gt: [
                                                    {
                                                        $ifNull: [
                                                            '$daysPastDue',
                                                            0
                                                        ]
                                                    },
                                                    90
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$outstandingBalance',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        writtenOffAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            '$status',
                                            WRITTEN_OFF_STATUSES
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            '$writtenOffAmount',
                                            0
                                        ]
                                    },
                                    0
                                ]
                            }
                        },

                        recoveredAmount: {
                            $sum: {
                                $ifNull: [
                                    '$amountRecovered',
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const metrics =
            result[0] || {};

        const outstanding =
            Number(
                metrics.outstandingBalance || 0
            );

        const amountDue =
            Number(
                metrics.amountDue || 0
            );

        const writtenOff =
            Number(
                metrics.writtenOffAmount || 0
            );

        return {
            totalLoans:
                Number(metrics.totalLoans || 0),

            totalDisbursed:
                Number(metrics.totalDisbursed || 0),

            outstandingBalance:
                outstanding,

            amountRepaid:
                Number(metrics.amountRepaid || 0),

            amountDue,

            overdueBalance:
                Number(metrics.overdueBalance || 0),

            par30:
                outstanding > 0
                    ? (
                        Number(
                            metrics.par30Balance || 0
                        ) /
                        outstanding
                    ) * 100
                    : 0,

            par60:
                outstanding > 0
                    ? (
                        Number(
                            metrics.par60Balance || 0
                        ) /
                        outstanding
                    ) * 100
                    : 0,

            par90:
                outstanding > 0
                    ? (
                        Number(
                            metrics.par90Balance || 0
                        ) /
                        outstanding
                    ) * 100
                    : 0,

            nplRatio:
                outstanding > 0
                    ? (
                        Number(
                            metrics.nplBalance || 0
                        ) /
                        outstanding
                    ) * 100
                    : 0,

            collectionRatio:
                amountDue > 0
                    ? (
                        Number(
                            metrics.amountRepaid || 0
                        ) /
                        amountDue
                    ) * 100
                    : 0,

            recoveryRate:
                writtenOff > 0
                    ? (
                        Number(
                            metrics.recoveredAmount || 0
                        ) /
                        writtenOff
                    ) * 100
                    : 0,

            generatedAt:
                new Date()
        };

    }

    /**
     * ========================================================================
     * COUNT
     * ========================================================================
     *
     * Generic count retained for compatibility.
     */

    static async count(
        filter = {}
    ) {

        if (
            !filter ||
            typeof filter !== 'object'
        ) {
            throw new Error(
                'Loan count filter must be an object'
            );
        }

        return Loan.countDocuments(
            filter
        );

    }

    /**
     * ========================================================================
     * TENANT-SCOPED COUNT
     * ========================================================================
     */

    static async countByTenant(
        tenantId,
        filter = {}
    ) {

        this.assertTenantId(tenantId);

        return Loan.countDocuments(
            this.tenantFilter(
                tenantId,
                filter
            )
        );

    }

}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = LoanRepository;