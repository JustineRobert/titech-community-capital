'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminController.js
 *
 * Responsibilities:
 *   - Administrative authorization
 *   - Tenant isolation
 *   - Request validation
 *   - Pagination normalization
 *   - Safe financial reporting
 *   - User administration
 *   - Loan/risk oversight
 *   - Group oversight
 *   - Audit read access
 *   - System health reporting
 *
 * Architectural rules:
 *   - Controllers do not implement financial business logic.
 *   - Controllers do not perform cross-tenant access implicitly.
 *   - Financial values are never converted to JavaScript floating point.
 *   - LoanAudit is used only for loan-domain audit evidence.
 *   - Generic administrative events belong to the generic audit subsystem.
 *   - Sensitive user fields are never returned.
 *   - Search input is escaped before MongoDB regex use.
 *   - Pagination is bounded.
 *
 * =============================================================================
 */

const mongoose =
    require('mongoose');

const User =
    require('../models/User');

const Group =
    require('../models/Group');

const Loan =
    require('../models/Loan');

const Contribution =
    require('../models/Contribution');

const LoanAudit =
    require('../models/LoanAudit');

const LoanRepaymentSchedule =
    require('../models/LoanRepaymentSchedule');

const asyncHandler =
    require('../utils/asyncHandler');

const logger =
    require('../utils/logger');

// =============================================================================
// Constants
// =============================================================================

const COMPONENT =
    'admin-controller';

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    100;

const DEFAULT_AUDIT_LIMIT =
    50;

const MAX_AUDIT_LIMIT =
    100;

const DEFAULT_ANALYTICS_PERIOD =
    '30d';

const ADMIN_ROLES =
    Object.freeze([
        'ADMIN',
        'SUPER_ADMIN'
    ]);

const SUPPORTED_PERIODS =
    Object.freeze([
        '7d',
        '30d',
        '90d',
        'all'
    ]);

// =============================================================================
// Generic Helpers
// =============================================================================

function normalizeString(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        null;
}

function escapeRegex(
    value
) {
    return String(value)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );
}

function normalizePositiveInteger(
    value,
    fallback,
    maximum
) {
    const parsed =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed < 1
    ) {
        return fallback;
    }

    return Math.min(
        parsed,
        maximum
    );
}

function resolvePagination(
    query,
    {
        defaultLimit = DEFAULT_LIMIT,
        maxLimit = MAX_LIMIT
    } = {}
) {
    const page =
        normalizePositiveInteger(
            query?.page,
            DEFAULT_PAGE,
            Number.MAX_SAFE_INTEGER
        );

    const limit =
        normalizePositiveInteger(
            query?.limit,
            defaultLimit,
            maxLimit
        );

    const skip =
        (
            page - 1
        ) * limit;

    return {
        page,
        limit,
        skip
    };
}

function isValidObjectId(
    value
) {
    return mongoose.Types.ObjectId.isValid(
        value
    );
}

function requireObjectId(
    value,
    field
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized ||
        !isValidObjectId(
            normalized
        )
    ) {
        const error =
            new Error(
                `${field} must be a valid identifier.`
            );

        error.statusCode =
            422;

        error.code =
            `ADMIN_INVALID_${field.toUpperCase()}`;

        throw error;
    }

    return normalized;
}

// =============================================================================
// Authentication / Authorization
// =============================================================================

function resolveUser(
    req
) {
    return (
        req?.user ||
        req?.auth?.user ||
        null
    );
}

function resolveRoles(
    user
) {
    const roles = [];

    if (
        Array.isArray(
            user?.roles
        )
    ) {
        roles.push(
            ...user.roles
        );
    }

    if (
        typeof user?.role ===
        'string'
    ) {
        roles.push(
            user.role
        );
    }

    return [
        ...new Set(
            roles
                .map(role =>
                    String(role)
                        .trim()
                        .toUpperCase()
                )
                .filter(Boolean)
        )
    ];
}

function requireAdminUser(
    req
) {
    const user =
        resolveUser(
            req
        );

    if (
        !user
    ) {
        const error =
            new Error(
                'Authentication required.'
            );

        error.statusCode =
            401;

        error.code =
            'ADMIN_AUTHENTICATION_REQUIRED';

        throw error;
    }

    const roles =
        resolveRoles(
            user
        );

    if (
        !ADMIN_ROLES.some(
            role =>
                roles.includes(
                    role
                )
        )
    ) {
        const error =
            new Error(
                'Admin access required.'
            );

        error.statusCode =
            403;

        error.code =
            'ADMIN_AUTHORIZATION_REQUIRED';

        throw error;
    }

    return user;
}

// =============================================================================
// Tenant Isolation
// =============================================================================

function resolveTenantId(
    req
) {
    const tenantId =
        normalizeString(
            req?.tenant_id ||
            req?.tenantId ||
            req?.tenant?.id ||
            req?.tenant?._id ||
            req?.auth?.tenantId ||
            req?.user?.tenantId ||
            req?.user?.tenant?.id ||
            req?.context?.tenantId
        );

    if (
        !tenantId
    ) {
        const error =
            new Error(
                'Authenticated tenant context is required.'
            );

        error.statusCode =
            400;

        error.code =
            'ADMIN_TENANT_CONTEXT_REQUIRED';

        throw error;
    }

    return tenantId;
}

/**
 * SUPER_ADMIN may explicitly request another tenant.
 *
 * Normal ADMIN users are always locked to their authenticated tenant.
 */
function resolveEffectiveTenantId(
    req,
    user
) {
    const authenticatedTenantId =
        resolveTenantId(
            req
        );

    const requestedTenantId =
        normalizeString(
            req.query?.tenantId
        );

    if (
        !requestedTenantId
    ) {
        return authenticatedTenantId;
    }

    const isSuperAdmin =
        resolveRoles(
            user
        ).includes(
            'SUPER_ADMIN'
        );

    if (
        !isSuperAdmin &&
        requestedTenantId !==
        authenticatedTenantId
    ) {
        const error =
            new Error(
                'Cross-tenant administration is forbidden.'
            );

        error.statusCode =
            403;

        error.code =
            'ADMIN_CROSS_TENANT_ACCESS_FORBIDDEN';

        throw error;
    }

    return requestedTenantId;
}

// =============================================================================
// Safe Financial Formatting
// =============================================================================

function decimalToString(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return '0';
    }

    return String(
        value
    );
}

function decimalToNumberUnsafe(
    value
) {
    /**
     * Deliberately NOT used for financial values.
     *
     * Kept here only as an architectural guard/documentation point.
     */
    return Number(
        value
    );
}

// =============================================================================
// Date Helpers
// =============================================================================

function resolveAnalyticsStartDate(
    period
) {
    const now =
        new Date();

    switch (
        period
    ) {
        case '7d':
            return new Date(
                now.getTime() -
                (
                    7 *
                    24 *
                    60 *
                    60 *
                    1000
                )
            );

        case '30d':
            return new Date(
                now.getTime() -
                (
                    30 *
                    24 *
                    60 *
                    60 *
                    1000
                )
            );

        case '90d':
            return new Date(
                now.getTime() -
                (
                    90 *
                    24 *
                    60 *
                    60 *
                    1000
                )
            );

        case 'all':
            return new Date(
                '2000-01-01T00:00:00.000Z'
            );

        default:
            return new Date(
                now.getTime() -
                (
                    30 *
                    24 *
                    60 *
                    60 *
                    1000
                )
            );
    }
}

function resolvePeriod(
    value
) {
    const period =
        normalizeString(
            value
        ) ||
        DEFAULT_ANALYTICS_PERIOD;

    if (
        !SUPPORTED_PERIODS.includes(
            period
        )
    ) {
        const error =
            new Error(
                'Unsupported analytics period.'
            );

        error.statusCode =
            422;

        error.code =
            'ADMIN_INVALID_ANALYTICS_PERIOD';

        throw error;
    }

    return period;
}

// =============================================================================
// Response Helpers
// =============================================================================

function buildMeta(
    req,
    tenantId,
    startedAt,
    additional = {}
) {
    return {
        requestId:
            normalizeString(
                req?.headers?.[
                    'x-request-id'
                ]
            ),

        correlationId:
            normalizeString(
                req?.headers?.[
                    'x-correlation-id'
                ]
            ),

        tenantId,

        executionTimeMs:
            Date.now() -
            startedAt,

        ...additional
    };
}

function success(
    res,
    data,
    {
        message = 'Success',
        statusCode = 200,
        meta = {}
    } = {}
) {
    return res
        .status(
            statusCode
        )
        .json({
            success:
                true,

            message,

            timestamp:
                new Date().toISOString(),

            meta,

            data
        });
}

// =============================================================================
// Admin Authorization Middleware
// =============================================================================

exports.requireAdmin =
    asyncHandler(
        async (
            req,
            res,
            next
        ) => {
            requireAdminUser(
                req
            );

            resolveTenantId(
                req
            );

            return next();
        }
    );

// =============================================================================
// Dashboard Metrics
// =============================================================================

exports.getDashboardMetrics =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const user =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    user
                );

            const tenantMatch = {
                tenantId
            };

            const [
                totalUsers,
                verifiedUsers,
                totalGroups,
                activeGroups,
                contributionCount,
                contributionTotals,
                totalLoans,
                disbursedLoans,
                repaidLoans,
                defaultedLoans,
                pendingLoans,
                disbursedTotals
            ] =
                await Promise.all([
                    User.countDocuments(
                        tenantMatch
                    ),

                    User.countDocuments({
                        ...tenantMatch,
                        isVerified:
                            true
                    }),

                    Group.countDocuments(
                        tenantMatch
                    ),

                    Group.countDocuments({
                        ...tenantMatch,
                        status:
                            'active'
                    }),

                    Contribution.countDocuments(
                        tenantMatch
                    ),

                    Contribution.aggregate([
                        {
                            $match:
                                tenantMatch
                        },
                        {
                            $group: {
                                _id:
                                    null,
                                total:
                                    {
                                        $sum:
                                            '$amount'
                                    }
                            }
                        }
                    ]),

                    Loan.countDocuments(
                        tenantMatch
                    ),

                    Loan.countDocuments({
                        ...tenantMatch,
                        status:
                            'disbursed'
                    }),

                    Loan.countDocuments({
                        ...tenantMatch,
                        status:
                            'repaid'
                    }),

                    Loan.countDocuments({
                        ...tenantMatch,
                        status:
                            'defaulted'
                    }),

                    Loan.countDocuments({
                        ...tenantMatch,
                        status:
                            'pending'
                    }),

                    Loan.aggregate([
                        {
                            $match: {
                                ...tenantMatch,
                                status:
                                    'disbursed'
                            }
                        },
                        {
                            $group: {
                                _id:
                                    null,
                                total:
                                    {
                                        $sum:
                                            '$amount'
                                    }
                            }
                        }
                    ])
                ]);

            const contributionAmount =
                contributionTotals[0]?.total;

            const disbursedAmount =
                disbursedTotals[0]?.total;

            const defaultRate =
                totalLoans > 0
                    ? (
                        (
                            defaultedLoans /
                            totalLoans
                        ) *
                        100
                    ).toFixed(
                        2
                    )
                    : '0.00';

            return success(
                res,
                {
                    users: {
                        total:
                            totalUsers,

                        verified:
                            verifiedUsers,

                        unverified:
                            totalUsers -
                            verifiedUsers
                    },

                    groups: {
                        total:
                            totalGroups,

                        active:
                            activeGroups
                    },

                    contributions: {
                        count:
                            contributionCount,

                        total:
                            decimalToString(
                                contributionAmount
                            )
                    },

                    loans: {
                        total:
                            totalLoans,

                        disbursed:
                            disbursedLoans,

                        disbursedAmount:
                            decimalToString(
                                disbursedAmount
                            ),

                        repaid:
                            repaidLoans,

                        defaulted:
                            defaultedLoans,

                        pending:
                            pendingLoans,

                        defaultRate:
                            `${defaultRate}%`
                    }
                },
                {
                    message:
                        'Admin dashboard metrics retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// User Management
// =============================================================================

exports.getUsers =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const user =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    user
                );

            const {
                page,
                limit,
                skip
            } =
                resolvePagination(
                    req.query
                );

            const status =
                normalizeString(
                    req.query?.status
                ) ||
                'all';

            const search =
                normalizeString(
                    req.query?.search
                );

            const query = {
                tenantId
            };

            if (
                status ===
                'verified'
            ) {
                query.isVerified =
                    true;
            } else if (
                status ===
                'unverified'
            ) {
                query.isVerified =
                    false;
            } else if (
                status ===
                'suspended'
            ) {
                query.status =
                    'suspended';
            }

            if (
                search
            ) {
                const safeSearch =
                    escapeRegex(
                        search
                    );

                query.$or = [
                    {
                        name: {
                            $regex:
                                safeSearch,
                            $options:
                                'i'
                        }
                    },
                    {
                        email: {
                            $regex:
                                safeSearch,
                            $options:
                                'i'
                        }
                    }
                ];
            }

            const [
                users,
                total
            ] =
                await Promise.all([
                    User.find(
                        query
                    )
                        .select(
                            [
                                'name',
                                'email',
                                'phone',
                                'role',
                                'roles',
                                'isVerified',
                                'status',
                                'createdAt',
                                'tenantId'
                            ].join(' ')
                        )
                        .sort({
                            createdAt:
                                -1
                        })
                        .skip(
                            skip
                        )
                        .limit(
                            limit
                        )
                        .lean(),

                    User.countDocuments(
                        query
                    )
                ]);

            return success(
                res,
                users,
                {
                    message:
                        'Users retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt,
                            {
                                page,
                                limit,
                                total,
                                count:
                                    users.length,
                                status,
                                search:
                                    search ||
                                    null
                            }
                        )
                }
            );
        }
    );

// =============================================================================
// User Details
// =============================================================================

exports.getUserDetails =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const userId =
                requireObjectId(
                    req.params.userId,
                    'userId'
                );

            const user =
                await User.findOne({
                    _id:
                        userId,

                    tenantId
                })
                    .select(
                        '-password ' +
                        '-resetPasswordToken ' +
                        '-verificationToken ' +
                        '-verificationTokenExpires'
                    )
                    .lean();

            if (
                !user
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User not found.'
                    });
            }

            const [
                groups,
                loans,
                contributions,
                recentActivity
            ] =
                await Promise.all([
                    Group.find({
                        tenantId,
                        members:
                            userId
                    })
                        .select(
                            'name status createdAt'
                        )
                        .sort({
                            createdAt:
                                -1
                        })
                        .limit(
                            25
                        )
                        .lean(),

                    Loan.find({
                        tenantId,
                        user:
                            userId
                    })
                        .select(
                            'group amount status createdAt'
                        )
                        .sort({
                            createdAt:
                                -1
                        })
                        .limit(
                            25
                        )
                        .lean(),

                    Contribution.find({
                        tenantId,
                        user:
                            userId
                    })
                        .select(
                            'group amount createdAt'
                        )
                        .sort({
                            createdAt:
                                -1
                        })
                        .limit(
                            25
                        )
                        .lean(),

                    /**
                     * LoanAudit is loan-specific and requires loan/member
                     * context. Query it by tenant/member rather than treating
                     * it as a generic application audit store.
                     */
                    LoanAudit.find({
                        tenantId,
                        memberId:
                            userId
                    })
                        .sort({
                            createdAt:
                                -1
                        })
                        .limit(
                            10
                        )
                        .lean()
                ]);

            return success(
                res,
                {
                    user,

                    activity: {
                        groups:
                            groups.length,

                        loans:
                            loans.length,

                        contributions:
                            contributions.length
                    },

                    recentActivity
                },
                {
                    message:
                        'User details retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Verify User
// =============================================================================

exports.verifyUser =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const userId =
                requireObjectId(
                    req.params.userId,
                    'userId'
                );

            const user =
                await User.findOne({
                    _id:
                        userId,

                    tenantId
                });

            if (
                !user
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User not found.'
                    });
            }

            if (
                user.isVerified
            ) {
                return res
                    .status(
                        409
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User is already verified.'
                    });
            }

            user.isVerified =
                true;

            user.verificationToken =
                null;

            user.verificationTokenExpires =
                null;

            await user.save();

            /**
             * IMPORTANT:
             * Do not call LoanAudit.logAction().
             *
             * The current LoanAudit model is a loan-specific immutable audit
             * chain with required loan/member fields.
             *
             * Generic user-administration audit should be delegated to the
             * platform's generic audit service/middleware.
             */

            return success(
                res,
                {
                    userId:
                        String(
                            user._id
                        ),

                    verified:
                        true
                },
                {
                    message:
                        'User verified successfully.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Suspend User
// =============================================================================

exports.suspendUser =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const userId =
                requireObjectId(
                    req.params.userId,
                    'userId'
                );

            const reason =
                normalizeString(
                    req.body?.reason
                );

            if (
                !reason
            ) {
                return res
                    .status(
                        422
                    )
                    .json({
                        success:
                            false,
                        message:
                            'Suspension reason is required.'
                    });
            }

            if (
                String(
                    admin._id ||
                    admin.id
                ) ===
                String(
                    userId
                )
            ) {
                return res
                    .status(
                        409
                    )
                    .json({
                        success:
                            false,
                        message:
                            'An administrator cannot suspend their own account.'
                    });
            }

            const user =
                await User.findOne({
                    _id:
                        userId,
                    tenantId
                });

            if (
                !user
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User not found.'
                    });
            }

            user.status =
                'suspended';

            user.suspensionReason =
                reason;

            user.suspendedAt =
                new Date();

            await user.save();

            return success(
                res,
                {
                    userId:
                        String(
                            user._id
                        ),

                    status:
                        'suspended'
                },
                {
                    message:
                        'User suspended successfully.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Activate User
// =============================================================================

exports.activateUser =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const userId =
                requireObjectId(
                    req.params.userId,
                    'userId'
                );

            const user =
                await User.findOne({
                    _id:
                        userId,
                    tenantId
                });

            if (
                !user
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User not found.'
                    });
            }

            if (
                user.status !==
                'suspended'
            ) {
                return res
                    .status(
                        409
                    )
                    .json({
                        success:
                            false,
                        message:
                            'User is not suspended.'
                    });
            }

            user.status =
                'active';

            user.suspensionReason =
                null;

            user.suspendedAt =
                null;

            await user.save();

            return success(
                res,
                {
                    userId:
                        String(
                            user._id
                        ),

                    status:
                        'active'
                },
                {
                    message:
                        'User activated successfully.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Loan Risk Overview
// =============================================================================

exports.getLoanRiskOverview =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const now =
                new Date();

            const maturityWindow =
                new Date(
                    now.getTime() +
                    (
                        30 *
                        24 *
                        60 *
                        60 *
                        1000
                    )
                );

            const [
                atRiskLoans,
                approachingMaturity,
                defaultAnalysis
            ] =
                await Promise.all([
                    Loan.aggregate([
                        {
                            $match: {
                                tenantId,
                                status:
                                    'disbursed'
                            }
                        },

                        {
                            $lookup: {
                                from:
                                    'loanrepaymentschedules',

                                let: {
                                    loanId:
                                        '$_id'
                                },

                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            '$loan',
                                                            '$$loanId'
                                                        ]
                                                    },
                                                    {
                                                        $in: [
                                                            '$status',
                                                            [
                                                                'overdue',
                                                                'default'
                                                            ]
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    },

                                    {
                                        $limit:
                                            1
                                    }
                                ],

                                as:
                                    'riskSchedule'
                            }
                        },

                        {
                            $match: {
                                'riskSchedule.0':
                                    {
                                        $exists:
                                            true
                                    }
                            }
                        },

                        {
                            $group: {
                                _id:
                                    null,

                                count: {
                                    $sum:
                                        1
                                },

                                totalAmount: {
                                    $sum:
                                        '$amount'
                                }
                            }
                        }
                    ]),

                    Loan.countDocuments({
                        tenantId,

                        status:
                            'disbursed',

                        repaymentDate: {
                            $gte:
                                now,

                            $lte:
                                maturityWindow
                        }
                    }),

                    Loan.aggregate([
                        {
                            $match: {
                                tenantId,
                                status:
                                    'defaulted'
                            }
                        },

                        {
                            $group: {
                                _id:
                                    null,

                                count: {
                                    $sum:
                                        1
                                },

                                totalAmount: {
                                    $sum:
                                        '$amount'
                                },

                                averageAmount: {
                                    $avg:
                                        '$amount'
                                }
                            }
                        }
                    ])
                ]);

            const risk =
                atRiskLoans[0] ||
                {
                    count:
                        0,
                    totalAmount:
                        '0'
                };

            const defaults =
                defaultAnalysis[0] ||
                {
                    count:
                        0,
                    totalAmount:
                        '0',
                    averageAmount:
                        '0'
                };

            return success(
                res,
                {
                    atRisk: {
                        count:
                            Number(
                                risk.count ||
                                0
                            ),

                        totalAmount:
                            decimalToString(
                                risk.totalAmount
                            )
                    },

                    approachingMaturity,

                    defaultAnalysis: {
                        count:
                            Number(
                                defaults.count ||
                                0
                            ),

                        totalAmount:
                            decimalToString(
                                defaults.totalAmount
                            ),

                        averageAmount:
                            decimalToString(
                                defaults.averageAmount
                            )
                    }
                },
                {
                    message:
                        'Loan risk overview retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Group Oversight
// =============================================================================

exports.getGroupOversight =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const {
                page,
                limit,
                skip
            } =
                resolvePagination(
                    req.query
                );

            const [
                groups,
                total
            ] =
                await Promise.all([
                    Group.aggregate([
                        {
                            $match: {
                                tenantId
                            }
                        },

                        {
                            $lookup: {
                                from:
                                    'loans',

                                let: {
                                    groupId:
                                        '$_id'
                                },

                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            '$group',
                                                            '$$groupId'
                                                        ]
                                                    },
                                                    {
                                                        $eq: [
                                                            '$tenantId',
                                                            tenantId
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    },

                                    {
                                        $project: {
                                            status:
                                                1
                                        }
                                    }
                                ],

                                as:
                                    'loans'
                            }
                        },

                        {
                            $lookup: {
                                from:
                                    'contributions',

                                let: {
                                    groupId:
                                        '$_id'
                                },

                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            '$group',
                                                            '$$groupId'
                                                        ]
                                                    },
                                                    {
                                                        $eq: [
                                                            '$tenantId',
                                                            tenantId
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    },

                                    {
                                        $group: {
                                            _id:
                                                null,

                                            total:
                                                {
                                                    $sum:
                                                        '$amount'
                                                }
                                        }
                                    }
                                ],

                                as:
                                    'contributionTotals'
                            }
                        },

                        {
                            $project: {
                                name:
                                    1,

                                description:
                                    1,

                                status:
                                    1,

                                memberCount:
                                    {
                                        $size:
                                            {
                                                $ifNull: [
                                                    '$members',
                                                    []
                                                ]
                                            }
                                    },

                                totalContributions:
                                    {
                                        $ifNull: [
                                            {
                                                $arrayElemAt: [
                                                    '$contributionTotals.total',
                                                    0
                                                ]
                                            },
                                            '0'
                                        ]
                                    },

                                loanCount:
                                    {
                                        $size:
                                            '$loans'
                                    },

                                activeLoanCount:
                                    {
                                        $size:
                                            {
                                                $filter: {
                                                    input:
                                                        '$loans',

                                                    as:
                                                        'loan',

                                                    cond: {
                                                        $eq: [
                                                            '$$loan.status',
                                                            'disbursed'
                                                        ]
                                                    }
                                                }
                                            }
                                    },

                                createdAt:
                                    1
                            }
                        },

                        {
                            $sort: {
                                createdAt:
                                    -1
                            }
                        },

                        {
                            $skip:
                                skip
                        },

                        {
                            $limit:
                                limit
                        }
                    ]),

                    Group.countDocuments({
                        tenantId
                    })
                ]);

            return success(
                res,
                groups.map(
                    group => ({
                        ...group,

                        totalContributions:
                            decimalToString(
                                group.totalContributions
                            )
                    })
                ),
                {
                    message:
                        'Group oversight retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt,
                            {
                                page,
                                limit,
                                total,
                                count:
                                    groups.length
                            }
                        )
                }
            );
        }
    );

// =============================================================================
// Audit Trail
// =============================================================================

exports.getAuditLog =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const limit =
                normalizePositiveInteger(
                    req.query?.limit,
                    DEFAULT_AUDIT_LIMIT,
                    MAX_AUDIT_LIMIT
                );

            const page =
                normalizePositiveInteger(
                    req.query?.page,
                    1,
                    Number.MAX_SAFE_INTEGER
                );

            const skip =
                (
                    page -
                    1
                ) *
                limit;

            const eventType =
                normalizeString(
                    req.query?.eventType
                );

            const actorId =
                normalizeString(
                    req.query?.actorId
                );

            const filter = {
                tenantId
            };

            if (
                eventType
            ) {
                filter.eventType =
                    eventType;
            }

            if (
                actorId
            ) {
                if (
                    !isValidObjectId(
                        actorId
                    )
                ) {
                    return res
                        .status(
                            422
                        )
                        .json({
                            success:
                                false,
                            message:
                                'Invalid actorId.'
                        });
                }

                filter.actorId =
                    actorId;
            }

            const [
                logs,
                total
            ] =
                await Promise.all([
                    LoanAudit.find(
                        filter
                    )
                        .sort({
                            createdAt:
                                -1,

                            _id:
                                -1
                        })
                        .skip(
                            skip
                        )
                        .limit(
                            limit
                        )
                        .lean(),

                    LoanAudit.countDocuments(
                        filter
                    )
                ]);

            return success(
                res,
                logs,
                {
                    message:
                        'Audit trail retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt,
                            {
                                page,
                                limit,
                                total,
                                count:
                                    logs.length,
                                eventType:
                                    eventType ||
                                    null
                            }
                        )
                }
            );
        }
    );

// =============================================================================
// Loan Analytics
// =============================================================================

exports.getLoanAnalytics =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const period =
                resolvePeriod(
                    req.query?.period
                );

            const startDate =
                resolveAnalyticsStartDate(
                    period
                );

            const match = {
                tenantId,

                createdAt: {
                    $gte:
                        startDate
                }
            };

            const [
                statusStats,
                trendData,
                repaymentData
            ] =
                await Promise.all([
                    Loan.aggregate([
                        {
                            $match:
                                match
                        },

                        {
                            $group: {
                                _id:
                                    '$status',

                                count:
                                    {
                                        $sum:
                                            1
                                    },

                                totalAmount:
                                    {
                                        $sum:
                                            '$amount'
                                    },

                                averageAmount:
                                    {
                                        $avg:
                                            '$amount'
                                    }
                            }
                        },

                        {
                            $sort: {
                                _id:
                                    1
                            }
                        }
                    ]),

                    Loan.aggregate([
                        {
                            $match:
                                match
                        },

                        {
                            $group: {
                                _id: {
                                    $dateToString: {
                                        format:
                                            '%Y-%m-%d',

                                        date:
                                            '$createdAt',

                                        timezone:
                                            'UTC'
                                    }
                                },

                                count:
                                    {
                                        $sum:
                                            1
                                    },

                                amount:
                                    {
                                        $sum:
                                            '$amount'
                                    }
                            }
                        },

                        {
                            $sort: {
                                _id:
                                    1
                            }
                        }
                    ]),

                    LoanRepaymentSchedule.aggregate([
                        {
                            $match: {
                                tenantId,

                                createdAt: {
                                    $gte:
                                        startDate
                                }
                            }
                        },

                        {
                            $group: {
                                _id:
                                    '$status',

                                count:
                                    {
                                        $sum:
                                            1
                                    },

                                totalAmount:
                                    {
                                        $sum:
                                            '$totalAmount'
                                    }
                            }
                        },

                        {
                            $sort: {
                                _id:
                                    1
                            }
                        }
                    ])
                ]);

            let totalLoansInPeriod =
                0;

            const statusDistribution =
                statusStats.map(
                    entry => {
                        totalLoansInPeriod +=
                            Number(
                                entry.count ||
                                0
                            );

                        return {
                            status:
                                entry._id ||
                                'UNKNOWN',

                            count:
                                Number(
                                    entry.count ||
                                    0
                                ),

                            totalAmount:
                                decimalToString(
                                    entry.totalAmount
                                ),

                            averageAmount:
                                decimalToString(
                                    entry.averageAmount
                                )
                        };
                    }
                );

            const creationTrend =
                trendData.map(
                    entry => ({
                        date:
                            entry._id,

                        count:
                            Number(
                                entry.count ||
                                0
                            ),

                        amount:
                            decimalToString(
                                entry.amount
                            )
                    })
                );

            const repaymentStatus =
                repaymentData.map(
                    entry => ({
                        status:
                            entry._id ||
                            'UNKNOWN',

                        count:
                            Number(
                                entry.count ||
                                0
                            ),

                        totalAmount:
                            decimalToString(
                                entry.totalAmount
                            )
                    })
                );

            return success(
                res,
                {
                    period,

                    statusDistribution,

                    creationTrend,

                    repaymentStatus,

                    summary: {
                        totalLoansInPeriod
                    }
                },
                {
                    message:
                        'Loan analytics retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// User Analytics
// =============================================================================

exports.getUserAnalytics =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const [
                activeUsers,
                verificationStats,
                roleStats
            ] =
                await Promise.all([
                    User.aggregate([
                        {
                            $match: {
                                tenantId
                            }
                        },

                        {
                            $lookup: {
                                from:
                                    'contributions',

                                let: {
                                    userId:
                                        '$_id'
                                },

                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            '$user',
                                                            '$$userId'
                                                        ]
                                                    },
                                                    {
                                                        $eq: [
                                                            '$tenantId',
                                                            tenantId
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    },

                                    {
                                        $group: {
                                            _id:
                                                null,

                                            count:
                                                {
                                                    $sum:
                                                        1
                                                },

                                            total:
                                                {
                                                    $sum:
                                                        '$amount'
                                                }
                                        }
                                    }
                                ],

                                as:
                                    'contributionStats'
                            }
                        },

                        {
                            $lookup: {
                                from:
                                    'loans',

                                let: {
                                    userId:
                                        '$_id'
                                },

                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            '$user',
                                                            '$$userId'
                                                        ]
                                                    },
                                                    {
                                                        $eq: [
                                                            '$tenantId',
                                                            tenantId
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    },

                                    {
                                        $count:
                                            'count'
                                    }
                                ],

                                as:
                                    'loanStats'
                            }
                        },

                        {
                            $project: {
                                name:
                                    1,

                                email:
                                    1,

                                phone:
                                    1,

                                isVerified:
                                    1,

                                role:
                                    1,

                                contributionCount:
                                    {
                                        $ifNull: [
                                            {
                                                $arrayElemAt: [
                                                    '$contributionStats.count',
                                                    0
                                                ]
                                            },
                                            0
                                        ]
                                    },

                                totalContributed:
                                    {
                                        $ifNull: [
                                            {
                                                $arrayElemAt: [
                                                    '$contributionStats.total',
                                                    0
                                                ]
                                            },
                                            '0'
                                        ]
                                    },

                                loanCount:
                                    {
                                        $ifNull: [
                                            {
                                                $arrayElemAt: [
                                                    '$loanStats.count',
                                                    0
                                                ]
                                            },
                                            0
                                        ]
                                    },

                                createdAt:
                                    1
                            }
                        },

                        {
                            $sort: {
                                totalContributed:
                                    -1
                            }
                        },

                        {
                            $limit:
                                20
                        }
                    ]),

                    User.aggregate([
                        {
                            $match: {
                                tenantId
                            }
                        },

                        {
                            $group: {
                                _id:
                                    '$isVerified',

                                count:
                                    {
                                        $sum:
                                            1
                                    }
                            }
                        }
                    ]),

                    User.aggregate([
                        {
                            $match: {
                                tenantId
                            }
                        },

                        {
                            $group: {
                                _id:
                                    '$role',

                                count:
                                    {
                                        $sum:
                                            1
                                    }
                            }
                        },

                        {
                            $sort: {
                                count:
                                    -1
                            }
                        }
                    ])
                ]);

            const formattedUsers =
                activeUsers.map(
                    user => ({
                        ...user,

                        totalContributed:
                            decimalToString(
                                user.totalContributed
                            ),

                        contributionCount:
                            Number(
                                user.contributionCount ||
                                0
                            ),

                        loanCount:
                            Number(
                                user.loanCount ||
                                0
                            )
                    })
                );

            return success(
                res,
                {
                    topUsers:
                        formattedUsers,

                    verification:
                        verificationStats,

                    roleDistribution:
                        roleStats
                },
                {
                    message:
                        'User analytics retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// System Health
// =============================================================================

exports.getSystemHealth =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            requireAdminUser(
                req
            );

            const tenantId =
                resolveTenantId(
                    req
                );

            const dbReady =
                mongoose.connection.readyState ===
                1;

            if (
                !dbReady
            ) {
                return res
                    .status(
                        503
                    )
                    .json({
                        success:
                            false,

                        message:
                            'Database service is unavailable.',

                        data: {
                            database: {
                                status:
                                    'disconnected',

                                connected:
                                    false
                            }
                        }
                    });
            }

            const queryStartedAt =
                Date.now();

            const totalUsers =
                await User.countDocuments({
                    tenantId
                });

            const queryTime =
                Date.now() -
                queryStartedAt;

            const overdueCount =
                await LoanRepaymentSchedule.countDocuments({
                    tenantId,

                    'installments.dueDate':
                        {
                            $lt:
                                new Date()
                        },

                    'installments.paid':
                        false
                });

            let performanceStatus =
                'slow';

            if (
                queryTime <
                100
            ) {
                performanceStatus =
                    'healthy';
            } else if (
                queryTime <
                500
            ) {
                performanceStatus =
                    'acceptable';
            }

            return success(
                res,
                {
                    database: {
                        status:
                            'connected',

                        connected:
                            true
                    },

                    performance: {
                        queryTimeMs:
                            queryTime,

                        status:
                            performanceStatus
                    },

                    data: {
                        totalUsers,

                        overdueLoans:
                            overdueCount,

                        timestamp:
                            new Date()
                    }
                },
                {
                    message:
                        'System health retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Payment Analytics
// =============================================================================

exports.getPaymentAnalytics =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const [
                result
            ] =
                await LoanRepaymentSchedule.aggregate([
                    {
                        $match: {
                            tenantId
                        }
                    },

                    {
                        $facet: {
                            byStatus: [
                                {
                                    $group: {
                                        _id:
                                            '$status',

                                        count:
                                            {
                                                $sum:
                                                    1
                                            },

                                        totalAmount:
                                            {
                                                $sum:
                                                    '$totalAmount'
                                            }
                                    }
                                }
                            ],

                            installmentAnalysis: [
                                {
                                    $unwind:
                                        '$installments'
                                },

                                {
                                    $group: {
                                        _id:
                                            '$installments.paid',

                                        count:
                                            {
                                                $sum:
                                                    1
                                            },

                                        totalAmount:
                                            {
                                                $sum:
                                                    '$installments.amount'
                                            }
                                    }
                                }
                            ],

                            collectionRate: [
                                {
                                    $group: {
                                        _id:
                                            null,

                                        totalSchedules:
                                            {
                                                $sum:
                                                    1
                                            },

                                        totalAmount:
                                            {
                                                $sum:
                                                    '$totalAmount'
                                            },

                                        totalPaid:
                                            {
                                                $sum:
                                                    '$totalPaid'
                                            }
                                    }
                                }
                            ]
                        }
                    }
                ]);

            const collection =
                result?.collectionRate?.[0] ||
                null;

            /**
             * Do not calculate percentages with binary floating-point money.
             *
             * totalPaid and totalAmount are kept exact. A dedicated decimal
             * service can calculate the percentage if exact percentage
             * arithmetic is required.
             */
            const totalAmount =
                decimalToString(
                    collection?.totalAmount
                );

            const totalPaid =
                decimalToString(
                    collection?.totalPaid
                );

            return success(
                res,
                {
                    scheduleStatus:
                        (
                            result?.byStatus ||
                            []
                        ).map(
                            entry => ({
                                status:
                                    entry._id,

                                count:
                                    Number(
                                        entry.count ||
                                        0
                                    ),

                                totalAmount:
                                    decimalToString(
                                        entry.totalAmount
                                    )
                            })
                        ),

                    installmentStatus:
                        (
                            result?.installmentAnalysis ||
                            []
                        ).map(
                            entry => ({
                                paid:
                                    Boolean(
                                        entry._id
                                    ),

                                count:
                                    Number(
                                        entry.count ||
                                        0
                                    ),

                                totalAmount:
                                    decimalToString(
                                        entry.totalAmount
                                    )
                            })
                        ),

                    collectionMetrics: {
                        totalSchedules:
                            Number(
                                collection?.totalSchedules ||
                                0
                            ),

                        totalAmount,

                        totalPaid,

                        collectionRate:
                            null
                    }
                },
                {
                    message:
                        'Payment analytics retrieved.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

// =============================================================================
// Compliance Report
// =============================================================================

exports.getComplianceReport =
    asyncHandler(
        async (
            req,
            res
        ) => {
            const startedAt =
                Date.now();

            const admin =
                requireAdminUser(
                    req
                );

            const tenantId =
                resolveEffectiveTenantId(
                    req,
                    admin
                );

            const now =
                new Date();

            const thirtyDaysAgo =
                new Date(
                    now.getTime() -
                    (
                        30 *
                        24 *
                        60 *
                        60 *
                        1000
                    )
                );

            const [
                riskyLoans,
                recentDefaults,
                unverifiedUsers,
                totalUsers
            ] =
                await Promise.all([
                    LoanRepaymentSchedule.find({
                        tenantId,

                        $expr: {
                            $gt: [
                                {
                                    $size: {
                                        $filter: {
                                            input:
                                                '$installments',

                                            as:
                                                'inst',

                                            cond: {
                                                $and: [
                                                    {
                                                        $lt: [
                                                            '$$inst.dueDate',
                                                            now
                                                        ]
                                                    },

                                                    {
                                                        $eq: [
                                                            '$$inst.paid',
                                                            false
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    }
                                },

                                0
                            ]
                        }
                    })
                        .select(
                            'loan status installments createdAt'
                        )
                        .populate(
                            'loan'
                        )
                        .limit(
                            100
                        )
                        .lean(),

                    LoanAudit.find({
                        tenantId,

                        eventType:
                            'LOAN_DEFAULTED',

                        createdAt: {
                            $gte:
                                thirtyDaysAgo
                        }
                    })
                        .sort({
                            createdAt:
                                -1
                        })
                        .limit(
                            50
                        )
                        .lean(),

                    User.countDocuments({
                        tenantId,

                        isVerified:
                            false
                    }),

                    User.countDocuments({
                        tenantId
                    })
                ]);

            const verifiedUsers =
                totalUsers -
                unverifiedUsers;

            const verificationRate =
                totalUsers > 0
                    ? (
                        (
                            verifiedUsers /
                            totalUsers
                        ) *
                        100
                    ).toFixed(
                        2
                    )
                    : '0.00';

            /**
             * This is deliberately a bounded operational score, not a financial
             * or regulatory risk model.
             */
            const operationalRiskScore =
                Math.min(
                    100,
                    (
                        riskyLoans.length +
                        recentDefaults.length
                    ) *
                    10
                );

            return success(
                res,
                {
                    riskAssessment: {
                        highRiskLoans:
                            riskyLoans.length,

                        recentDefaults:
                            recentDefaults.length,

                        operationalRiskScore
                    },

                    compliance: {
                        userVerificationRate:
                            `${verificationRate}%`,

                        verifiedUsers,

                        unverifiedUsers,

                        totalUsers
                    },

                    recentIssues: {
                        overdueLoans:
                            riskyLoans,

                        defaults:
                            recentDefaults
                    },

                    timestamp:
                        new Date()
                },
                {
                    message:
                        'Compliance report generated.',

                    meta:
                        buildMeta(
                            req,
                            tenantId,
                            startedAt
                        )
                }
            );
        }
    );

module.exports =
    exports;