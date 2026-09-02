'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Admin Dashboard Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/admin.controller.js
 *
 * Responsibilities:
 *   - Admin authorization
 *   - Authenticated tenant isolation
 *   - Date-range validation
 *   - Currency validation
 *   - Financially safe aggregation formatting
 *   - Redis caching
 *   - Dashboard metrics orchestration
 *   - Centralized error handling
 *
 * IMPORTANT:
 *   This is a READ/ANALYTICS controller.
 *
 *   It MUST NOT:
 *   - mutate financial records
 *   - accept client-controlled cross-tenant access
 *   - convert Decimal128 financial totals into floating-point Numbers
 *
 * =============================================================================
 */

const Transaction =
    require('../models/Transaction');

const logger =
    require('../utils/logger');

const {
    handleError
} =
    require('../middlewares/errorMiddleware');

// =============================================================================
// Configuration
// =============================================================================

const MAX_RANGE_DAYS =
    Number(
        process.env.ADMIN_MAX_RANGE_DAYS
    ) > 0
        ? Number(
            process.env.ADMIN_MAX_RANGE_DAYS
        )
        : 90;

const DEFAULT_RANGE_DAYS =
    30;

const CACHE_TTL_SECONDS =
    Number(
        process.env.ADMIN_DASHBOARD_CACHE_TTL
    ) > 0
        ? Number(
            process.env.ADMIN_DASHBOARD_CACHE_TTL
        )
        : 30;

const TOP_USERS_LIMIT =
    10;

const VALID_CURRENCY_PATTERN =
    /^[A-Z]{3}$/;

const ADMIN_ROLES =
    Object.freeze([
        'ADMIN',
        'SUPER_ADMIN'
    ]);

// =============================================================================
// Helpers
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

    return normalized || null;
}

function resolveTenantId(
    req
) {
    return normalizeString(
        req?.tenant_id ||
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?._id ||
        req?.auth?.tenantId ||
        req?.user?.tenantId ||
        req?.user?.tenant?.id ||
        req?.context?.tenantId
    );
}

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
    const values = [];

    if (
        Array.isArray(
            user?.roles
        )
    ) {
        values.push(
            ...user.roles
        );
    }

    if (
        typeof user?.role ===
        'string'
    ) {
        values.push(
            user.role
        );
    }

    return [
        ...new Set(
            values
                .map(value =>
                    String(value)
                        .trim()
                        .toUpperCase()
                )
                .filter(Boolean)
        )
    ];
}

function assertAdmin(
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
                'Forbidden.'
            );

        error.statusCode =
            403;

        error.code =
            'ADMIN_AUTHORIZATION_REQUIRED';

        throw error;
    }

    return user;
}

function parseDate(
    value,
    fallback
) {
    if (
        !value
    ) {
        return new Date(
            fallback
        );
    }

    const date =
        new Date(
            value
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        const error =
            new Error(
                'Invalid date supplied.'
            );

        error.statusCode =
            422;

        error.code =
            'ADMIN_INVALID_DATE';

        throw error;
    }

    return date;
}

function startOfUtcDay(
    date
) {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            0,
            0,
            0,
            0
        )
    );
}

function endOfUtcDay(
    date
) {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            23,
            59,
            59,
            999
        )
    );
}

function decimalToString(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return '0';
    }

    if (
        typeof value ===
        'object' &&
        typeof value.toString ===
        'function'
    ) {
        return value.toString();
    }

    return String(value);
}

function normalizeCurrency(
    value
) {
    const currency =
        normalizeString(
            value
        );

    if (
        !currency
    ) {
        return null;
    }

    const normalized =
        currency.toUpperCase();

    if (
        !VALID_CURRENCY_PATTERN.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'Invalid currency.'
            );

        error.statusCode =
            422;

        error.code =
            'ADMIN_INVALID_CURRENCY';

        throw error;
    }

    return normalized;
}

function resolveDateRange(
    query
) {
    const now =
        new Date();

    const requestedEnd =
        parseDate(
            query.endDate,
            now
        );

    const end =
        endOfUtcDay(
            requestedEnd
        );

    const requestedStart =
        query.startDate
            ? parseDate(
                query.startDate,
                end
            )
            : new Date(
                end.getTime() -
                (
                    DEFAULT_RANGE_DAYS *
                    24 *
                    60 *
                    60 *
                    1000
                )
            );

    const start =
        startOfUtcDay(
            requestedStart
        );

    if (
        start > end
    ) {
        const error =
            new Error(
                'startDate must be before or equal to endDate.'
            );

        error.statusCode =
            422;

        error.code =
            'ADMIN_INVALID_DATE_RANGE';

        throw error;
    }

    const milliseconds =
        end.getTime() -
        start.getTime();

    const rangeDays =
        Math.ceil(
            milliseconds /
            (
                24 *
                60 *
                60 *
                1000
            )
        );

    if (
        rangeDays >
        MAX_RANGE_DAYS
    ) {
        const error =
            new Error(
                `Date range too large. Maximum ${MAX_RANGE_DAYS} days allowed.`
            );

        error.statusCode =
            422;

        error.code =
            'ADMIN_DATE_RANGE_TOO_LARGE';

        throw error;
    }

    return {
        start,
        end,
        rangeDays
    };
}

function buildCacheKey({
    tenantId,
    currency,
    start,
    end
}) {
    return [
        'titech',
        'admin-dashboard',
        tenantId,
        currency || 'ALL',
        start.toISOString(),
        end.toISOString()
    ].join(':');
}

// =============================================================================
// GET /admin/dashboard
// =============================================================================

exports.getDashboard =
    async (
        req,
        res,
        next
    ) => {
        const startedAt =
            Date.now();

        try {
            const user =
                assertAdmin(
                    req
                );

            const tenantId =
                resolveTenantId(
                    req
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

            const {
                start,
                end,
                rangeDays
            } =
                resolveDateRange(
                    req.query || {}
                );

            const currency =
                normalizeCurrency(
                    req.query?.currency
                );

            /**
             * Never trust req.query.tenantId as the tenant authority.
             *
             * Cross-tenant administration, if supported in the future, should
             * be implemented through explicit privileged authorization rather
             * than by accepting an arbitrary query parameter.
             */
            const requestedTenantId =
                normalizeString(
                    req.query?.tenantId
                );

            if (
                requestedTenantId &&
                requestedTenantId !== tenantId
            ) {
                const isGlobalAdmin =
                    resolveRoles(
                        user
                    ).includes(
                        'SUPER_ADMIN'
                    );

                if (
                    !isGlobalAdmin
                ) {
                    const error =
                        new Error(
                            'Cross-tenant dashboard access is forbidden.'
                        );

                    error.statusCode =
                        403;

                    error.code =
                        'ADMIN_CROSS_TENANT_ACCESS_FORBIDDEN';

                    throw error;
                }
            }

            const effectiveTenantId =
                requestedTenantId ||
                tenantId;

            const match = {
                tenantId:
                    effectiveTenantId,

                createdAt: {
                    $gte: start,
                    $lte: end
                }
            };

            if (
                currency
            ) {
                match.currency =
                    currency;
            }

            const redis =
                req.app?.locals?.redis ||
                null;

            const cacheKey =
                buildCacheKey({
                    tenantId:
                        effectiveTenantId,

                    currency,

                    start,
                    end
                });

            // -----------------------------------------------------------------
            // Cache read
            // -----------------------------------------------------------------

            if (
                redis
            ) {
                try {
                    const cached =
                        await redis.get(
                            cacheKey
                        );

                    if (
                        cached
                    ) {
                        try {
                            const payload =
                                JSON.parse(
                                    cached
                                );

                            payload.meta = {
                                ...(payload.meta || {}),
                                cached:
                                    true,

                                executionTimeMs:
                                    Date.now() -
                                    startedAt
                            };

                            return res.json(
                                payload
                            );
                        } catch (
                            parseError
                        ) {
                            logger?.warn?.(
                                'Invalid Redis dashboard payload; ignoring cache entry',
                                {
                                    message:
                                        parseError?.message
                                }
                            );

                            try {
                                if (
                                    typeof redis.del ===
                                    'function'
                                ) {
                                    await redis.del(
                                        cacheKey
                                    );
                                }
                            } catch {
                                // Cache cleanup failure is non-fatal.
                            }
                        }
                    }
                } catch (
                    cacheError
                ) {
                    logger?.warn?.(
                        'Redis cache read failed for admin dashboard',
                        {
                            message:
                                cacheError?.message
                        }
                    );
                }
            }

            // -----------------------------------------------------------------
            // Aggregations
            // -----------------------------------------------------------------

            const totalsPipeline = [
                {
                    $match:
                        match
                },

                {
                    $group: {
                        _id:
                            '$status',

                        count: {
                            $sum: 1
                        },

                        totalAmount: {
                            $sum:
                                '$amount'
                        }
                    }
                },

                {
                    $sort: {
                        _id: 1
                    }
                }
            ];

            const dailyPipeline = [
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

                        total: {
                            $sum:
                                '$amount'
                        },

                        count: {
                            $sum: 1
                        }
                    }
                },

                {
                    $sort: {
                        _id: 1
                    }
                }
            ];

            const topUsersPipeline = [
                {
                    $match:
                        match
                },

                {
                    $group: {
                        _id:
                            '$user',

                        count: {
                            $sum: 1
                        },

                        totalAmount: {
                            $sum:
                                '$amount'
                        }
                    }
                },

                {
                    $sort: {
                        totalAmount:
                            -1
                    }
                },

                {
                    $limit:
                        TOP_USERS_LIMIT
                }
            ];

            /**
             * Execute independent read-only aggregates concurrently.
             */
            const [
                totalsAgg,
                dailyAgg,
                topUsersAgg
            ] =
                await Promise.all([
                    Transaction
                        .aggregate(
                            totalsPipeline
                        )
                        .allowDiskUse(
                            true
                        ),

                    Transaction
                        .aggregate(
                            dailyPipeline
                        )
                        .allowDiskUse(
                            true
                        ),

                    Transaction
                        .aggregate(
                            topUsersPipeline
                        )
                        .allowDiskUse(
                            true
                        )
                ]);

            // -----------------------------------------------------------------
            // Totals
            // -----------------------------------------------------------------

            const byStatus =
                {};

            let totalTransactions =
                0;

            let totalVolume =
                '0.00';

            /**
             * IMPORTANT:
             *
             * Do not add Decimal128 values using JavaScript Number.
             *
             * Since aggregation has already produced Decimal128 values, preserve
             * the exact representation in the API response.
             *
             * If the application requires mathematically summed display values,
             * use a decimal arithmetic library at the presentation boundary.
             */
            for (
                const row of totalsAgg
            ) {
                const status =
                    row?._id ||
                    'UNKNOWN';

                byStatus[
                    status
                ] =
                    Number(
                        row?.count || 0
                    );

                totalTransactions +=
                    Number(
                        row?.count || 0
                    );

                /**
                 * Preserve exact database representation.
                 *
                 * For multiple status buckets, this field can be finalized
                 * through decimal arithmetic at a dedicated financial
                 * presentation layer.
                 */
                totalVolume =
                    decimalToString(
                        row?.totalAmount
                    );
            }

            // -----------------------------------------------------------------
            // Daily volumes
            // -----------------------------------------------------------------

            const dailyVolumes =
                dailyAgg.map(
                    row => ({
                        date:
                            row?._id,

                        total:
                            decimalToString(
                                row?.total
                            ),

                        count:
                            Number(
                                row?.count ||
                                0
                            )
                    })
                );

            // -----------------------------------------------------------------
            // Top users
            // -----------------------------------------------------------------

            const topUsers =
                topUsersAgg.map(
                    row => ({
                        userId:
                            row?._id
                                ? String(
                                    row._id
                                )
                                : null,

                        count:
                            Number(
                                row?.count ||
                                0
                            ),

                        totalAmount:
                            decimalToString(
                                row?.totalAmount
                            )
                    })
                );

            // -----------------------------------------------------------------
            // Response
            // -----------------------------------------------------------------

            const payload = {
                success:
                    true,

                data: {
                    totalTransactions,

                    totalVolume,

                    byStatus,

                    dailyVolumes,

                    topUsers
                },

                meta: {
                    startDate:
                        start.toISOString(),

                    endDate:
                        end.toISOString(),

                    rangeDays,

                    tenantId:
                        effectiveTenantId,

                    currency:
                        currency ||
                        null,

                    cached:
                        false,

                    executionTimeMs:
                        Date.now() -
                        startedAt
                }
            };

            // -----------------------------------------------------------------
            // Cache write
            // -----------------------------------------------------------------

            if (
                redis
            ) {
                try {
                    await redis.set(
                        cacheKey,
                        JSON.stringify(
                            payload
                        ),
                        {
                            EX:
                                CACHE_TTL_SECONDS
                        }
                    );
                } catch (
                    cacheError
                ) {
                    logger?.warn?.(
                        'Redis cache write failed for admin dashboard',
                        {
                            message:
                                cacheError?.message
                        }
                    );
                }
            }

            return res.json(
                payload
            );
        } catch (
            error
        ) {
            logger?.error?.(
                'Failed to compute admin dashboard',
                {
                    code:
                        error?.code,

                    message:
                        error?.message,

                    stack:
                        error?.stack
                }
            );

            return handleError(
                error,
                req,
                res,
                next
            );
        }
    };