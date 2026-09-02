"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Dashboard Service
 * =============================================================================
 *
 * File:
 *   backend/services/admin/adminDashboard.service.js
 *
 * Purpose:
 *   Canonical application-service layer for the TITech administrative
 *   dashboard.
 *
 * Architecture:
 *
 *   HTTP
 *     │
 *     ▼
 *   adminDashboard.controller.js
 *     │
 *     ▼
 *   adminDashboard.service.js
 *     │
 *     ├── User / Member domain
 *     ├── Savings / Contributions
 *     ├── Wallet / Ledger
 *     ├── Loans
 *     ├── Transactions
 *     ├── Risk
 *     ├── KYC / AML
 *     ├── Notifications
 *     ├── Audit
 *     ├── Infrastructure
 *     ├── Observability
 *     └── Runtime
 *
 * =============================================================================
 *
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * 1. No Express request/response objects.
 * 2. No HTTP response construction.
 * 3. No controller logic.
 * 4. No direct UI assumptions.
 * 5. Tenant isolation is mandatory for tenant-scoped operations.
 * 6. Platform-level dashboard operations require explicit elevated context.
 * 7. Financial numbers are treated as sensitive operational data.
 * 8. Dashboard reads must not mutate financial state.
 * 9. Independent dashboard sections fail independently where possible.
 * 10. Expensive reads are bounded and executed concurrently where safe.
 * 11. Service dependencies are resolved through the application container.
 * 12. No secrets are exposed through dashboard projections.
 * 13. Operational errors are logged with correlation context.
 * 14. Database implementation details stay behind repositories/services.
 * 15. TITech is the canonical platform identity.
 *
 * =============================================================================
 */

const SERVICE_NAME =
    "adminDashboard.service";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

const DEFAULT_CURRENCY =
    "UGX";

/* =============================================================================
 * LIMITS
 * =============================================================================
 */

const DEFAULT_TOP_LIMIT =
    10;

const MAX_TOP_LIMIT =
    100;

const DEFAULT_RECENT_LIMIT =
    10;

const MAX_RECENT_LIMIT =
    50;

const DEFAULT_CONCURRENCY =
    6;

const MAX_CONCURRENCY =
    10;

/* =============================================================================
 * TIME CONSTANTS
 * =============================================================================
 */

const MS_PER_SECOND =
    1000;

const MS_PER_MINUTE =
    60 *
    MS_PER_SECOND;

const MS_PER_HOUR =
    60 *
    MS_PER_MINUTE;

const MS_PER_DAY =
    24 *
    MS_PER_HOUR;

/* =============================================================================
 * STATUS CONSTANTS
 * =============================================================================
 */

const STATUS = Object.freeze({
    ACTIVE:
        "active",

    INACTIVE:
        "inactive",

    PENDING:
        "pending",

    COMPLETED:
        "completed",

    FAILED:
        "failed",

    CANCELLED:
        "cancelled",

    OVERDUE:
        "overdue",

    SUSPENDED:
        "suspended",

    UNKNOWN:
        "unknown"
});

/* =============================================================================
 * OPERATION NAMES
 * =============================================================================
 */

const OPERATIONS = Object.freeze({
    OVERVIEW:
        "overview",

    METRICS:
        "metrics",

    SUMMARY:
        "summary",

    TRENDS:
        "trends",

    RECENT_ACTIVITY:
        "recentActivity",

    ALERTS:
        "alerts",

    HEALTH:
        "health",

    PERFORMANCE:
        "performance"
});

/* =============================================================================
 * ERROR CODES
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_CONTEXT:
        "ADMIN_DASHBOARD_INVALID_CONTEXT",

    TENANT_REQUIRED:
        "ADMIN_DASHBOARD_TENANT_REQUIRED",

    FORBIDDEN:
        "ADMIN_DASHBOARD_FORBIDDEN",

    INVALID_DATE_RANGE:
        "ADMIN_DASHBOARD_INVALID_DATE_RANGE",

    INVALID_PARAMETER:
        "ADMIN_DASHBOARD_INVALID_PARAMETER",

    DEPENDENCY_UNAVAILABLE:
        "ADMIN_DASHBOARD_DEPENDENCY_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_DASHBOARD_INTERNAL_ERROR"
});

/* =============================================================================
 * ROLE DEFINITIONS
 * =============================================================================
 */

const PLATFORM_ROLES = Object.freeze([
    "super_admin",
    "superadmin",
    "platform_admin",
    "system_admin",
    "operations_admin"
]);

/* =============================================================================
 * PERMISSIONS
 * =============================================================================
 */

const DASHBOARD_PERMISSIONS =
    Object.freeze([
        "dashboard.view",
        "dashboard.read",
        "admin.dashboard",
        "admin.dashboard.view",
        "system.admin",
        "*",
        "admin.*"
    ]);

/* =============================================================================
 * DEPENDENCY ALIASES
 * =============================================================================
 *
 * The service intentionally supports multiple canonical/legacy service names
 * so that migration of the application composition root can happen without
 * breaking the administrative dashboard.
 *
 * =============================================================================
 */

const DEPENDENCY_ALIASES = Object.freeze({
    member: [
        "memberService",
        "membersService",
        "userService",
        "usersService"
    ],

    user: [
        "userService",
        "usersService",
        "memberService"
    ],

    savings: [
        "savingsService",
        "savingsPlanService"
    ],

    contribution: [
        "contributionService",
        "contributionsService"
    ],

    wallet: [
        "walletService",
        "walletAccountService"
    ],

    ledger: [
        "ledgerService"
    ],

    transaction: [
        "transactionService",
        "financialTransactionService",
        "financialOperationService"
    ],

    loan: [
        "loanService",
        "loanWorkflowService",
        "loansService"
    ],

    risk: [
        "riskService",
        "adminRiskService"
    ],

    kyc: [
        "kycService",
        "kycAmlService",
        "complianceService"
    ],

    audit: [
        "auditService",
        "auditLogService"
    ],

    notification: [
        "notificationService",
        "notificationsService"
    ],

    report: [
        "reportService",
        "reportingService",
        "adminReportsService"
    ],

    analytics: [
        "analyticsService",
        "adminAnalyticsService"
    ],

    system: [
        "adminSystemService",
        "systemAdminService",
        "systemService"
    ],

    infrastructure: [
        "infrastructureService",
        "infrastructure"
    ],

    observability: [
        "observabilityService",
        "observability"
    ]
});

/* =============================================================================
 * METHOD ALIASES
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({

    /* Members --------------------------------------------------------------- */

    getMemberCount: [
        "getMemberCount",
        "countMembers",
        "getUserCount",
        "countUsers"
    ],

    getActiveMemberCount: [
        "getActiveMemberCount",
        "countActiveMembers",
        "getActiveUserCount"
    ],

    getNewMemberCount: [
        "getNewMemberCount",
        "countNewMembers",
        "getNewUserCount"
    ],

    getMemberStatistics: [
        "getMemberStatistics",
        "getUserStatistics",
        "getStatistics"
    ],

    /* Savings --------------------------------------------------------------- */

    getSavingsSummary: [
        "getSavingsSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getSavingsBalance: [
        "getSavingsBalance",
        "getTotalSavings",
        "getTotalSaved"
    ],

    getSavingsStatistics: [
        "getSavingsStatistics",
        "getStatistics"
    ],

    /* Contributions --------------------------------------------------------- */

    getContributionSummary: [
        "getContributionSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getContributionStatistics: [
        "getContributionStatistics",
        "getStatistics"
    ],

    getContributionVolume: [
        "getContributionVolume",
        "getTotalContributionVolume",
        "getVolume"
    ],

    /* Wallet ---------------------------------------------------------------- */

    getWalletSummary: [
        "getWalletSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getWalletBalance: [
        "getWalletBalance",
        "getTotalBalance",
        "getAggregateBalance"
    ],

    /* Ledger ---------------------------------------------------------------- */

    getLedgerSummary: [
        "getLedgerSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getLedgerStatistics: [
        "getLedgerStatistics",
        "getStatistics"
    ],

    /* Transactions ---------------------------------------------------------- */

    getTransactionSummary: [
        "getTransactionSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getTransactionStatistics: [
        "getTransactionStatistics",
        "getStatistics"
    ],

    /* Loans ----------------------------------------------------------------- */

    getLoanSummary: [
        "getLoanSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getLoanStatistics: [
        "getLoanStatistics",
        "getStatistics"
    ],

    getOutstandingLoans: [
        "getOutstandingLoans",
        "getOutstandingPortfolio",
        "getLoanPortfolio"
    ],

    getOverdueLoans: [
        "getOverdueLoans",
        "getOverduePortfolio"
    ],

    /* Risk ------------------------------------------------------------------ */

    getRiskSummary: [
        "getRiskSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getRiskStatistics: [
        "getRiskStatistics",
        "getStatistics"
    ],

    /* KYC / AML ------------------------------------------------------------- */

    getKycSummary: [
        "getKycSummary",
        "getKYCSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getComplianceSummary: [
        "getComplianceSummary",
        "getAmlSummary",
        "getDashboardSummary"
    ],

    /* Audit ----------------------------------------------------------------- */

    getAuditSummary: [
        "getAuditSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    getRecentAuditEvents: [
        "getRecentAuditEvents",
        "getRecentEvents",
        "getRecentLogs"
    ],

    /* Notifications --------------------------------------------------------- */

    getNotificationSummary: [
        "getNotificationSummary",
        "getDashboardSummary",
        "getSummary"
    ],

    /* Analytics ------------------------------------------------------------- */

    getTrends: [
        "getTrends",
        "getDashboardTrends",
        "getTrendData"
    ],

    getDashboardMetrics: [
        "getDashboardMetrics",
        "getMetrics",
        "getSummaryMetrics"
    ],

    /* Reports ---------------------------------------------------------------- */

    getDashboardReport: [
        "getDashboardReport",
        "getExecutiveSummary",
        "getSummary"
    ],

    /* System ---------------------------------------------------------------- */

    getSystemStatus: [
        "getSystemStatus",
        "getStatus",
        "getSystemHealth"
    ],

    getHealth: [
        "getHealth",
        "getSystemHealth",
        "getHealthStatus"
    ],

    getInfrastructureStatus: [
        "getInfrastructureStatus",
        "getInfrastructureHealth"
    ]
});

/* =============================================================================
 * UTILITY FUNCTIONS
 * =============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    try {
        const normalized =
            String(value).trim();

        return normalized.length
            ? normalized
            : fallback;
    } catch {
        return fallback;
    }
}

function normalizePositiveInteger(
    value,
    fallback,
    maximum
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(
            number
        ) ||
        number < 1
    ) {
        return fallback;
    }

    return Math.min(
        Math.floor(
            number
        ),
        maximum
    );
}

function normalizeBoolean(
    value,
    fallback = false
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    if (
        typeof value ===
        "boolean"
    ) {
        return value;
    }

    const normalized =
        String(value)
            .trim()
            .toLowerCase();

    if (
        [
            "true",
            "1",
            "yes",
            "on"
        ].includes(
            normalized
        )
    ) {
        return true;
    }

    if (
        [
            "false",
            "0",
            "no",
            "off"
        ].includes(
            normalized
        )
    ) {
        return false;
    }

    return fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {
    return Math.max(
        minimum,
        Math.min(
            maximum,
            value
        )
    );
}

/* =============================================================================
 * DATE HELPERS
 * =============================================================================
 */

function startOfDay(
    date
) {
    const value =
        new Date(
            date
        );

    value.setHours(
        0,
        0,
        0,
        0
    );

    return value;
}

function endOfDay(
    date
) {
    const value =
        new Date(
            date
        );

    value.setHours(
        23,
        59,
        59,
        999
    );

    return value;
}

function parseDate(
    value
) {
    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        !value
    ) {
        return null;
    }

    const parsed =
        new Date(
            value
        );

    return Number.isNaN(
        parsed.getTime()
    )
        ? null
        : parsed;
}

function buildDateRange(
    input = {}
) {
    const now =
        new Date();

    let from =
        parseDate(
            input.from ??
            input.startDate
        );

    let to =
        parseDate(
            input.to ??
            input.endDate
        );

    if (
        !from &&
        !to
    ) {
        to =
            endOfDay(
                now
            );

        from =
            startOfDay(
                new Date(
                    now.getTime() -
                    30 *
                    MS_PER_DAY
                )
            );
    } else {
        if (!from) {
            from =
                startOfDay(
                    new Date(
                        to.getTime() -
                        30 *
                        MS_PER_DAY
                    )
                );
        }

        if (!to) {
            to =
                endOfDay(
                    now
                );
        }
    }

    if (
        from > to
    ) {
        const error =
            new Error(
                "Dashboard date range is invalid."
            );

        error.code =
            ERROR_CODES.INVALID_DATE_RANGE;

        throw error;
    }

    const maximumRange =
        366 *
        MS_PER_DAY;

    if (
        to.getTime() -
        from.getTime() >
        maximumRange
    ) {
        from =
            new Date(
                to.getTime() -
                maximumRange
            );
    }

    return {
        from,
        to
    };
}

/* =============================================================================
 * CONTEXT
 * =============================================================================
 */

function normalizeContext(
    context = {}
) {
    const tenantId =
        normalizeString(
            context.tenantId
        );

    if (
        !tenantId
    ) {
        const error =
            new Error(
                "A tenant context is required for dashboard operations."
            );

        error.code =
            ERROR_CODES.TENANT_REQUIRED;

        throw error;
    }

    return {
        tenantId,

        actorId:
            normalizeString(
                context.actorId
            ),

        requestId:
            normalizeString(
                context.requestId
            ),

        correlationId:
            normalizeString(
                context.correlationId
            ),

        deviceId:
            normalizeString(
                context.deviceId
            ),

        principal:
            context.principal ??
            context.actor ??
            null
    };
}

/* =============================================================================
 * AUTHORIZATION
 * =============================================================================
 */

function resolveRoles(
    principal
) {
    if (
        !principal
    ) {
        return [];
    }

    const roles = [];

    if (
        principal.role
    ) {
        roles.push(
            principal.role
        );
    }

    if (
        Array.isArray(
            principal.roles
        )
    ) {
        roles.push(
            ...principal.roles
        );
    }

    return roles
        .filter(Boolean)
        .map(
            role =>
                String(
                    role
                )
                    .trim()
                    .toLowerCase()
        );
}

function resolvePermissions(
    principal
) {
    if (
        !principal
    ) {
        return [];
    }

    const permissions = [];

    if (
        Array.isArray(
            principal.permissions
        )
    ) {
        permissions.push(
            ...principal.permissions
        );
    }

    if (
        Array.isArray(
            principal.permissionCodes
        )
    ) {
        permissions.push(
            ...principal.permissionCodes
        );
    }

    return permissions
        .filter(Boolean)
        .map(
            permission =>
                String(
                    permission
                )
                    .trim()
                    .toLowerCase()
        );
}

function hasPlatformRole(
    principal
) {
    return resolveRoles(
        principal
    ).some(
        role =>
            PLATFORM_ROLES.includes(
                role
            )
    );
}

function hasDashboardPermission(
    principal
) {
    return resolvePermissions(
        principal
    ).some(
        permission =>
            DASHBOARD_PERMISSIONS.includes(
                permission
            )
    );
}

function assertAccess(
    context
) {
    const principal =
        context.principal;

    /*
     * The controller/router remains the primary authorization boundary.
     *
     * The service performs defense-in-depth validation when principal
     * information is available.
     */
    if (
        !principal
    ) {
        return true;
    }

    if (
        hasPlatformRole(
            principal
        ) ||
        hasDashboardPermission(
            principal
        ) ||
        principal.isAdmin === true ||
        principal.isSuperAdmin === true
    ) {
        return true;
    }

    const error =
        new Error(
            "The authenticated principal is not authorized to access the TITech administrative dashboard."
        );

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/* =============================================================================
 * SERVICE CONSTRUCTOR
 * =============================================================================
 */

class AdminDashboardService {

    constructor(
        dependencies = {}
    ) {
        this.dependencies =
            dependencies;

        this.servicesContext =
            dependencies.servicesContext ??
            dependencies.serviceContext ??
            dependencies.container ??
            null;

        this.logger =
            dependencies.logger ??
            null;

        this.metrics =
            dependencies.metrics ??
            dependencies.observability ??
            null;

        this.cache =
            dependencies.cache ??
            dependencies.cacheService ??
            null;

        this.clock =
            dependencies.clock ??
            {
                now: () =>
                    new Date()
            };
    }

    /* =========================================================================
     * DEPENDENCY RESOLUTION
     * =========================================================================
     */

    resolveDependency(
        type
    ) {
        const aliases =
            DEPENDENCY_ALIASES[
                type
            ] ||
            [];

        for (
            const name of
                aliases
        ) {
            const resolved =
                this.tryResolveService(
                    name
                );

            if (
                resolved
            ) {
                return resolved;
            }
        }

        return null;
    }

    tryResolveService(
        name
    ) {
        const container =
            this.servicesContext;

        if (
            container
        ) {
            if (
                typeof
                    container.requireService ===
                    "function"
            ) {
                try {
                    const service =
                        container.requireService(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                typeof
                    container.service ===
                    "function"
            ) {
                try {
                    const service =
                        container.service(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                typeof
                    container.get ===
                    "function"
            ) {
                try {
                    const service =
                        container.get(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                container[name]
            ) {
                return container[
                    name
                ];
            }
        }

        if (
            this.dependencies[
                name
            ]
        ) {
            return this.dependencies[
                name
            ];
        }

        return null;
    }

    resolveMethod(
        service,
        operation
    ) {
        if (
            !service
        ) {
            return null;
        }

        const aliases =
            METHOD_ALIASES[
                operation
            ] ||
            [];

        for (
            const methodName of
                aliases
        ) {
            if (
                typeof
                    service[
                        methodName
                    ] ===
                    "function"
            ) {
                return service[
                    methodName
                ].bind(
                    service
                );
            }
        }

        return null;
    }

    /* =========================================================================
     * LOGGING
     * =========================================================================
     */

    log(
        level,
        message,
        metadata = {}
    ) {
        const logger =
            this.logger;

        const payload = {
            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            message,

            ...metadata
        };

        if (
            logger &&
            typeof logger[
                level
            ] === "function"
        ) {
            try {
                logger[
                    level
                ](
                    payload
                );

                return;
            } catch {
                // Logging must never break dashboard reads.
            }
        }

        if (
            level ===
                "error" &&
            process.env.NODE_ENV !==
                "production"
        ) {
            try {
                // eslint-disable-next-line no-console
                console.error(
                    `[${SERVICE_NAME}]`,
                    payload
                );
            } catch {
                // Ignore fallback logging failures.
            }
        }
    }

    /* =========================================================================
     * OBSERVABILITY
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {
        const metrics =
            this.metrics;

        if (
            !metrics
        ) {
            return;
        }

        try {
            if (
                typeof
                    metrics.increment ===
                    "function"
            ) {
                metrics.increment(
                    name,
                    value,
                    labels
                );

                return;
            }

            if (
                typeof
                    metrics.counter ===
                    "function"
            ) {
                const counter =
                    metrics.counter(
                        name
                    );

                if (
                    counter &&
                    typeof
                        counter.inc ===
                        "function"
                ) {
                    counter.inc(
                        labels,
                        value
                    );
                }
            }
        } catch {
            // Metrics must never break business operations.
        }
    }

    /* =========================================================================
     * DEPENDENCY INVOCATION
     * =========================================================================
     */

    async invokeDependency(
        type,
        operation,
        payload,
        context,
        options = {}
    ) {
        const service =
            this.resolveDependency(
                type
            );

        if (
            !service
        ) {
            if (
                options.required
            ) {
                const error =
                    new Error(
                        `Required dashboard dependency "${type}" is unavailable.`
                    );

                error.code =
                    ERROR_CODES.DEPENDENCY_UNAVAILABLE;

                throw error;
            }

            return null;
        }

        const method =
            this.resolveMethod(
                service,
                operation
            );

        if (
            !method
        ) {
            if (
                options.required
            ) {
                const error =
                    new Error(
                        `Dashboard dependency "${type}" does not support "${operation}".`
                    );

                error.code =
                    ERROR_CODES.DEPENDENCY_UNAVAILABLE;

                throw error;
            }

            return null;
        }

        return method(
            {
                ...payload,
                tenantId:
                    context.tenantId
            },
            context
        );
    }

    /* =========================================================================
     * SAFE INVOCATION
     * =========================================================================
     */

    async safeInvoke(
        name,
        callback,
        context,
        fallback = null
    ) {
        const startedAt =
            this.clock.now();

        try {
            const result =
                await callback();

            const duration =
                this.clock.now()
                    .getTime() -
                startedAt.getTime();

            this.incrementMetric(
                "titech_admin_dashboard_dependency_success_total",
                1,
                {
                    dependency:
                        name
                }
            );

            this.incrementMetric(
                "titech_admin_dashboard_dependency_duration_ms",
                duration,
                {
                    dependency:
                        name
                }
            );

            return {
                ok: true,
                value: result,
                duration
            };
        } catch (error) {
            const duration =
                this.clock.now()
                    .getTime() -
                startedAt.getTime();

            this.incrementMetric(
                "titech_admin_dashboard_dependency_failure_total",
                1,
                {
                    dependency:
                        name
                }
            );

            this.log(
                "warn",
                "Dashboard dependency failed.",
                {
                    dependency:
                        name,

                    duration,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId,

                    error: {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message
                    }
                }
            );

            return {
                ok: false,
                value: fallback,
                duration,
                error
            };
        }
    }

    /* =========================================================================
     * CONCURRENCY
     * =========================================================================
     */

    async mapWithConcurrency(
        items,
        worker,
        concurrency =
            DEFAULT_CONCURRENCY
    ) {
        const limit =
            clamp(
                normalizePositiveInteger(
                    concurrency,
                    DEFAULT_CONCURRENCY,
                    MAX_CONCURRENCY
                ),
                1,
                MAX_CONCURRENCY
            );

        const results =
            new Array(
                items.length
            );

        let cursor =
            0;

        const workers =
            Array.from(
                {
                    length:
                        Math.min(
                            limit,
                            items.length
                        )
                },
                async () => {
                    while (
                        true
                    ) {
                        const index =
                            cursor++;

                        if (
                            index >=
                            items.length
                        ) {
                            return;
                        }

                        results[
                            index
                        ] =
                            await worker(
                                items[
                                    index
                                ],
                                index
                            );
                    }
                }
            );

        await Promise.all(
            workers
        );

        return results;
    }

    /* =========================================================================
     * CACHE
     * =========================================================================
     */

    buildCacheKey(
        operation,
        context,
        options = {}
    ) {
        return [
            "titech",
            "admin-dashboard",
            operation,
            context.tenantId,
            options.dateRange?.from
                ?.toISOString?.() ??
                "",
            options.dateRange?.to
                ?.toISOString?.() ??
                "",
            options.topLimit ??
                "",
            options.recentLimit ??
                ""
        ].join(
            ":"
        );
    }

    async getCached(
        key
    ) {
        if (
            !this.cache
        ) {
            return null;
        }

        try {
            if (
                typeof
                    this.cache.get ===
                    "function"
            ) {
                return await this.cache.get(
                    key
                );
            }

            return null;
        } catch {
            return null;
        }
    }

    async setCached(
        key,
        value,
        ttl
    ) {
        if (
            !this.cache
        ) {
            return;
        }

        try {
            if (
                typeof
                    this.cache.set ===
                    "function"
            ) {
                await this.cache.set(
                    key,
                    value,
                    ttl
                );
            }
        } catch {
            // Cache failure must never fail the dashboard request.
        }
    }

    /* =========================================================================
     * INPUT NORMALIZATION
     * =========================================================================
     */

    normalizeOptions(
        input = {}
    ) {
        const dateRange =
            buildDateRange(
                input
            );

        return {
            dateRange,

            topLimit:
                normalizePositiveInteger(
                    input.topLimit ??
                    input.limit,
                    DEFAULT_TOP_LIMIT,
                    MAX_TOP_LIMIT
                ),

            recentLimit:
                normalizePositiveInteger(
                    input.recentLimit,
                    DEFAULT_RECENT_LIMIT,
                    MAX_RECENT_LIMIT
                ),

            includeTrends:
                normalizeBoolean(
                    input.includeTrends,
                    true
                ),

            includeRecentActivity:
                normalizeBoolean(
                    input.includeRecentActivity,
                    true
                ),

            includeAlerts:
                normalizeBoolean(
                    input.includeAlerts,
                    true
                ),

            includeHealth:
                normalizeBoolean(
                    input.includeHealth,
                    true
                ),

            includePerformance:
                normalizeBoolean(
                    input.includePerformance,
                    true
                ),

            includeRisk:
                normalizeBoolean(
                    input.includeRisk,
                    true
                ),

            includeKyc:
                normalizeBoolean(
                    input.includeKyc,
                    true
                ),

            includeInfrastructure:
                normalizeBoolean(
                    input.includeInfrastructure,
                    true
                ),

            cache:
                normalizeBoolean(
                    input.cache,
                    true
                ),

            cacheTtl:
                normalizePositiveInteger(
                    input.cacheTtl,
                    30,
                    300
                )
        };
    }

    /* =========================================================================
     * OVERVIEW
     * =========================================================================
     */

    async getOverview(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const options =
            this.normalizeOptions(
                input
            );

        const startedAt =
            this.clock.now();

        this.incrementMetric(
            "titech_admin_dashboard_overview_total"
        );

        const cacheKey =
            this.buildCacheKey(
                OPERATIONS.OVERVIEW,
                normalizedContext,
                options
            );

        if (
            options.cache
        ) {
            const cached =
                await this.getCached(
                    cacheKey
                );

            if (
                cached
            ) {
                return {
                    ...cached,

                    meta: {
                        ...cached.meta,

                        cached:
                            true
                    }
                };
            }
        }

        const sections =
            await this.loadOverviewSections(
                options,
                normalizedContext
            );

        const duration =
            this.clock.now()
                .getTime() -
            startedAt.getTime();

        const result = {
            application:
                APPLICATION_NAME,

            currency:
                DEFAULT_CURRENCY,

            tenantId:
                normalizedContext.tenantId,

            generatedAt:
                this.clock.now()
                    .toISOString(),

            period: {
                from:
                    options.dateRange.from
                        .toISOString(),

                to:
                    options.dateRange.to
                        .toISOString()
            },

            summary:
                this.buildSummary(
                    sections
                ),

            members:
                sections.members,

            savings:
                sections.savings,

            contributions:
                sections.contributions,

            wallets:
                sections.wallets,

            loans:
                sections.loans,

            transactions:
                sections.transactions,

            risk:
                sections.risk,

            compliance:
                sections.compliance,

            activity:
                sections.activity,

            alerts:
                sections.alerts,

            health:
                sections.health,

            performance:
                sections.performance,

            trends:
                sections.trends,

            meta: {
                durationMs:
                    duration,

                cached:
                    false,

                partial:
                    sections.partial,

                failedSections:
                    sections.failedSections
            }
        };

        if (
            options.cache
        ) {
            await this.setCached(
                cacheKey,
                result,
                options.cacheTtl
            );
        }

        return result;
    }

    /* =========================================================================
     * OVERVIEW SECTIONS
     * =========================================================================
     */

    async loadOverviewSections(
        options,
        context
    ) {
        const jobs = [];

        jobs.push({
            name:
                "members",

            execute:
                () =>
                    this.loadMembers(
                        options,
                        context
                    )
        });

        jobs.push({
            name:
                "savings",

            execute:
                () =>
                    this.loadSavings(
                        options,
                        context
                    )
        });

        jobs.push({
            name:
                "contributions",

            execute:
                () =>
                    this.loadContributions(
                        options,
                        context
                    )
        });

        jobs.push({
            name:
                "wallets",

            execute:
                () =>
                    this.loadWallets(
                        options,
                        context
                    )
        });

        jobs.push({
            name:
                "loans",

            execute:
                () =>
                    this.loadLoans(
                        options,
                        context
                    )
        });

        jobs.push({
            name:
                "transactions",

            execute:
                () =>
                    this.loadTransactions(
                        options,
                        context
                    )
        });

        if (
            options.includeRisk
        ) {
            jobs.push({
                name:
                    "risk",

                execute:
                    () =>
                        this.loadRisk(
                            options,
                            context
                        )
            });
        }

        if (
            options.includeKyc
        ) {
            jobs.push({
                name:
                    "compliance",

                execute:
                    () =>
                        this.loadCompliance(
                            options,
                            context
                        )
            });
        }

        if (
            options.includeRecentActivity
        ) {
            jobs.push({
                name:
                    "activity",

                execute:
                    () =>
                        this.loadRecentActivity(
                            options,
                            context
                        )
            });
        }

        if (
            options.includeAlerts
        ) {
            jobs.push({
                name:
                    "alerts",

                execute:
                    () =>
                        this.loadAlerts(
                            options,
                            context
                        )
            });
        }

        if (
            options.includeHealth
        ) {
            jobs.push({
                name:
                    "health",

                execute:
                    () =>
                        this.loadHealth(
                            options,
                            context
                        )
            });
        }

        if (
            options.includePerformance
        ) {
            jobs.push({
                name:
                    "performance",

                execute:
                    () =>
                        this.loadPerformance(
                            options,
                            context
                        )
            });
        }

        if (
            options.includeTrends
        ) {
            jobs.push({
                name:
                    "trends",

                execute:
                    () =>
                        this.loadTrends(
                            options,
                            context
                        )
            });
        }

        const results =
            await this.mapWithConcurrency(
                jobs,
                async job => {
                    const response =
                        await this.safeInvoke(
                            job.name,
                            job.execute,
                            context,
                            this.emptySection(
                                job.name
                            )
                        );

                    return {
                        name:
                            job.name,

                        ...response
                    };
                }
            );

        const sections = {};

        const failedSections = [];

        let partial =
            false;

        for (
            const item of
                results
        ) {
            sections[
                item.name
            ] =
                item.value;

            if (
                !item.ok
            ) {
                partial =
                    true;

                failedSections.push(
                    item.name
                );
            }
        }

        return {
            ...sections,

            partial,

            failedSections
        };
    }

    /* =========================================================================
     * MEMBERS
     * =========================================================================
     */

    async loadMembers(
        options,
        context
    ) {
        const summary =
            await this.safeInvoke(
                "members.summary",
                () =>
                    this.invokeDependency(
                        "member",
                        "getMemberStatistics",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        if (
            summary.ok &&
            summary.value
        ) {
            return this.normalizeMemberSummary(
                summary.value
            );
        }

        const count =
            await this.safeInvoke(
                "members.count",
                () =>
                    this.invokeDependency(
                        "member",
                        "getMemberCount",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        const active =
            await this.safeInvoke(
                "members.active",
                () =>
                    this.invokeDependency(
                        "member",
                        "getActiveMemberCount",
                        {},
                        context
                    ),
                context,
                null
            );

        const newlyRegistered =
            await this.safeInvoke(
                "members.new",
                () =>
                    this.invokeDependency(
                        "member",
                        "getNewMemberCount",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return {
            total:
                extractNumber(
                    count.value
                ),

            active:
                extractNumber(
                    active.value
                ),

            new:
                extractNumber(
                    newlyRegistered.value
                ),

            inactive:
                null,

            growthRate:
                null
        };
    }

    normalizeMemberSummary(
        value
    ) {
        return {
            total:
                extractNumber(
                    value?.total ??
                    value?.count ??
                    value?.totalMembers
                ),

            active:
                extractNumber(
                    value?.active ??
                    value?.activeMembers
                ),

            new:
                extractNumber(
                    value?.new ??
                    value?.newMembers
                ),

            inactive:
                extractNumber(
                    value?.inactive ??
                    value?.inactiveMembers
                ),

            growthRate:
                extractNumber(
                    value?.growthRate ??
                    value?.growth
                )
        };
    }

    /* =========================================================================
     * SAVINGS
     * =========================================================================
     */

    async loadSavings(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "savings.summary",
                () =>
                    this.invokeDependency(
                        "savings",
                        "getSavingsSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return this.normalizeFinancialSummary(
            result.value
        );
    }

    /* =========================================================================
     * CONTRIBUTIONS
     * =========================================================================
     */

    async loadContributions(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "contributions.summary",
                () =>
                    this.invokeDependency(
                        "contribution",
                        "getContributionSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return this.normalizeFinancialSummary(
            result.value
        );
    }

    /* =========================================================================
     * WALLETS
     * =========================================================================
     */

    async loadWallets(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "wallets.summary",
                () =>
                    this.invokeDependency(
                        "wallet",
                        "getWalletSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return this.normalizeFinancialSummary(
            result.value
        );
    }

    /* =========================================================================
     * LOANS
     * =========================================================================
     */

    async loadLoans(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "loans.summary",
                () =>
                    this.invokeDependency(
                        "loan",
                        "getLoanSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        const summary =
            this.normalizeLoanSummary(
                result.value
            );

        const overdue =
            await this.safeInvoke(
                "loans.overdue",
                () =>
                    this.invokeDependency(
                        "loan",
                        "getOverdueLoans",
                        {
                            dateRange:
                                options.dateRange,

                            limit:
                                options.topLimit
                        },
                        context
                    ),
                context,
                null
            );

        summary.overdue =
            normalizeCollection(
                overdue.value
            );

        return summary;
    }

    normalizeLoanSummary(
        value
    ) {
        return {
            total:
                extractNumber(
                    value?.total ??
                    value?.count ??
                    value?.totalLoans
                ),

            active:
                extractNumber(
                    value?.active ??
                    value?.activeLoans
                ),

            pending:
                extractNumber(
                    value?.pending ??
                    value?.pendingLoans
                ),

            completed:
                extractNumber(
                    value?.completed ??
                    value?.completedLoans
                ),

            overdue:
                extractNumber(
                    value?.overdue ??
                    value?.overdueLoans
                ),

            outstanding:
                extractAmount(
                    value?.outstanding ??
                    value?.outstandingAmount ??
                    value?.portfolioOutstanding
                ),

            disbursed:
                extractAmount(
                    value?.disbursed ??
                    value?.disbursedAmount
                ),

            repaid:
                extractAmount(
                    value?.repaid ??
                    value?.repaidAmount
                )
        };
    }

    /* =========================================================================
     * TRANSACTIONS
     * =========================================================================
     */

    async loadTransactions(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "transactions.summary",
                () =>
                    this.invokeDependency(
                        "transaction",
                        "getTransactionSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return this.normalizeTransactionSummary(
            result.value
        );
    }

    normalizeTransactionSummary(
        value
    ) {
        return {
            total:
                extractNumber(
                    value?.total ??
                    value?.count ??
                    value?.totalTransactions
                ),

            successful:
                extractNumber(
                    value?.successful ??
                    value?.completed ??
                    value?.successfulTransactions
                ),

            pending:
                extractNumber(
                    value?.pending ??
                    value?.pendingTransactions
                ),

            failed:
                extractNumber(
                    value?.failed ??
                    value?.failedTransactions
                ),

            cancelled:
                extractNumber(
                    value?.cancelled ??
                    value?.cancelledTransactions
                ),

            volume:
                extractAmount(
                    value?.volume ??
                    value?.totalVolume ??
                    value?.transactionVolume
                )
        };
    }

    /* =========================================================================
     * RISK
     * =========================================================================
     */

    async loadRisk(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "risk.summary",
                () =>
                    this.invokeDependency(
                        "risk",
                        "getRiskSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        return {
            ...normalizeObject(
                result.value
            ),

            score:
                extractNumber(
                    result.value?.score ??
                    result.value?.riskScore
                ),

            level:
                normalizeString(
                    result.value?.level ??
                    result.value?.riskLevel
                ),

            alerts:
                extractNumber(
                    result.value?.alerts ??
                    result.value?.riskAlerts
                ),

            highRisk:
                extractNumber(
                    result.value?.highRisk ??
                    result.value?.highRiskMembers
                )
        };
    }

    /* =========================================================================
     * COMPLIANCE
     * =========================================================================
     */

    async loadCompliance(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "compliance.summary",
                async () => {
                    const kyc =
                        await this.invokeDependency(
                            "kyc",
                            "getKycSummary",
                            {
                                dateRange:
                                    options.dateRange
                            },
                            context
                        );

                    const aml =
                        await this.invokeDependency(
                            "kyc",
                            "getComplianceSummary",
                            {
                                dateRange:
                                    options.dateRange
                            },
                            context
                        );

                    return {
                        kyc,
                        aml
                    };
                },
                context,
                null
            );

        const value =
            normalizeObject(
                result.value
            );

        return {
            kyc:
                normalizeObject(
                    value.kyc
                ),

            aml:
                normalizeObject(
                    value.aml
                ),

            verified:
                extractNumber(
                    value?.kyc?.verified ??
                    value?.kyc?.approved
                ),

            pending:
                extractNumber(
                    value?.kyc?.pending
                ),

            rejected:
                extractNumber(
                    value?.kyc?.rejected
                ),

            alerts:
                extractNumber(
                    value?.aml?.alerts ??
                    value?.aml?.openAlerts
                )
        };
    }

    /* =========================================================================
     * RECENT ACTIVITY
     * =========================================================================
     */

    async loadRecentActivity(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "activity.recent",
                () =>
                    this.invokeDependency(
                        "audit",
                        "getRecentAuditEvents",
                        {
                            dateRange:
                                options.dateRange,

                            limit:
                                options.recentLimit
                        },
                        context
                    ),
                context,
                []
            );

        return normalizeCollection(
            result.value
        );
    }

    /* =========================================================================
     * ALERTS
     * =========================================================================
     */

    async loadAlerts(
        options,
        context
    ) {
        const risk =
            await this.safeInvoke(
                "alerts.risk",
                () =>
                    this.invokeDependency(
                        "risk",
                        "getRiskSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        const compliance =
            await this.safeInvoke(
                "alerts.compliance",
                () =>
                    this.invokeDependency(
                        "kyc",
                        "getComplianceSummary",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                null
            );

        const alerts = [];

        const riskAlerts =
            extractNumber(
                risk.value?.alerts ??
                risk.value?.riskAlerts
            );

        if (
            riskAlerts > 0
        ) {
            alerts.push({
                type:
                    "risk",

                severity:
                    "high",

                count:
                    riskAlerts
            });
        }

        const complianceAlerts =
            extractNumber(
                compliance.value?.alerts ??
                compliance.value?.openAlerts
            );

        if (
            complianceAlerts > 0
        ) {
            alerts.push({
                type:
                    "compliance",

                severity:
                    "high",

                count:
                    complianceAlerts
            });
        }

        return alerts;
    }

    /* =========================================================================
     * HEALTH
     * =========================================================================
     */

    async loadHealth(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "system.health",
                () =>
                    this.invokeDependency(
                        "system",
                        "getHealth",
                        {},
                        context
                    ),
                context,
                null
            );

        return normalizeHealth(
            result.value
        );
    }

    /* =========================================================================
     * PERFORMANCE
     * =========================================================================
     */

    async loadPerformance(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "system.performance",
                () =>
                    this.invokeDependency(
                        "system",
                        "getSystemStatus",
                        {},
                        context
                    ),
                context,
                null
            );

        const infrastructure =
            options.includeInfrastructure
                ? await this.safeInvoke(
                    "infrastructure.status",
                    () =>
                        this.invokeDependency(
                            "infrastructure",
                            "getInfrastructureStatus",
                            {},
                            context
                        ),
                    context,
                    null
                )
                : null;

        return {
            system:
                normalizeObject(
                    result.value
                ),

            infrastructure:
                normalizeObject(
                    infrastructure?.value
                )
        };
    }

    /* =========================================================================
     * TRENDS
     * =========================================================================
     */

    async loadTrends(
        options,
        context
    ) {
        const result =
            await this.safeInvoke(
                "analytics.trends",
                () =>
                    this.invokeDependency(
                        "analytics",
                        "getTrends",
                        {
                            dateRange:
                                options.dateRange
                        },
                        context
                    ),
                context,
                []
            );

        return normalizeCollection(
            result.value
        );
    }

    /* =========================================================================
     * METRICS
     * =========================================================================
     */

    async getMetrics(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const options =
            this.normalizeOptions(
                input
            );

        const result =
            await this.invokeDependency(
                "analytics",
                "getDashboardMetrics",
                {
                    dateRange:
                        options.dateRange,

                    topLimit:
                        options.topLimit
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result
        ) {
            return result;
        }

        const overview =
            await this.getOverview(
                input,
                normalizedContext
            );

        return {
            members:
                overview.members,

            savings:
                overview.savings,

            contributions:
                overview.contributions,

            loans:
                overview.loans,

            transactions:
                overview.transactions,

            risk:
                overview.risk,

            compliance:
                overview.compliance
        };
    }

    /* =========================================================================
     * SUMMARY
     * =========================================================================
     */

    async getSummary(
        input = {},
        context = {}
    ) {
        const overview =
            await this.getOverview(
                input,
                context
            );

        return {
            application:
                overview.application,

            tenantId:
                overview.tenantId,

            currency:
                overview.currency,

            period:
                overview.period,

            summary:
                overview.summary,

            members:
                overview.members,

            savings:
                overview.savings,

            contributions:
                overview.contributions,

            wallets:
                overview.wallets,

            loans:
                overview.loans,

            transactions:
                overview.transactions,

            risk:
                overview.risk,

            compliance:
                overview.compliance,

            meta:
                overview.meta
        };
    }

    /* =========================================================================
     * TRENDS PUBLIC API
     * =========================================================================
     */

    async getTrends(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const options =
            this.normalizeOptions(
                input
            );

        const result =
            await this.loadTrends(
                options,
                normalizedContext
            );

        return {
            period: {
                from:
                    options.dateRange.from
                        .toISOString(),

                to:
                    options.dateRange.to
                        .toISOString()
            },

            data:
                result
        };
    }

    /* =========================================================================
     * RECENT ACTIVITY PUBLIC API
     * =========================================================================
     */

    async getRecentActivity(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const options =
            this.normalizeOptions(
                input
            );

        return this.loadRecentActivity(
            options,
            normalizedContext
        );
    }

    /* =========================================================================
     * ALERTS PUBLIC API
     * =========================================================================
     */

    async getAlerts(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const options =
            this.normalizeOptions(
                input
            );

        return this.loadAlerts(
            options,
            normalizedContext
        );
    }

    /* =========================================================================
     * HEALTH PUBLIC API
     * =========================================================================
     */

    async getHealth(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        return this.loadHealth(
            this.normalizeOptions(
                input
            ),
            normalizedContext
        );
    }

    /* =========================================================================
     * PERFORMANCE PUBLIC API
     * =========================================================================
     */

    async getPerformance(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        return this.loadPerformance(
            this.normalizeOptions(
                input
            ),
            normalizedContext
        );
    }

    /* =========================================================================
     * DASHBOARD REPORT
     * =========================================================================
     */

    async getDashboardReport(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        assertAccess(
            normalizedContext
        );

        const reportService =
            this.resolveDependency(
                "report"
            );

        const method =
            this.resolveMethod(
                reportService,
                "getDashboardReport"
            );

        if (
            method
        ) {
            return method(
                {
                    ...input,
                    tenantId:
                        normalizedContext.tenantId
                },
                normalizedContext
            );
        }

        return this.getOverview(
            input,
            normalizedContext
        );
    }

    /* =========================================================================
     * SUMMARY BUILDER
     * =========================================================================
     */

    buildSummary(
        sections
    ) {
        const savings =
            extractAmount(
                sections.savings?.total ??
                sections.savings?.balance ??
                sections.savings?.amount
            );

        const contributions =
            extractAmount(
                sections.contributions?.total ??
                sections.contributions?.volume ??
                sections.contributions?.amount
            );

        const loanOutstanding =
            extractAmount(
                sections.loans?.outstanding
            );

        const transactionVolume =
            extractAmount(
                sections.transactions?.volume
            );

        const memberCount =
            extractNumber(
                sections.members?.total
            );

        return {
            members:
                memberCount,

            activeMembers:
                extractNumber(
                    sections.members?.active
                ),

            totalSavings:
                savings,

            contributionVolume:
                contributions,

            loanOutstanding:
                loanOutstanding,

            transactionVolume:
                transactionVolume,

            activeLoans:
                extractNumber(
                    sections.loans?.active
                ),

            overdueLoans:
                extractNumber(
                    sections.loans?.overdue
                ),

            pendingTransactions:
                extractNumber(
                    sections.transactions?.pending
                ),

            failedTransactions:
                extractNumber(
                    sections.transactions?.failed
                ),

            riskAlerts:
                extractNumber(
                    sections.risk?.alerts
                ),

            complianceAlerts:
                extractNumber(
                    sections.compliance?.alerts
                )
        };
    }

    /* =========================================================================
     * EMPTY SECTION
     * =========================================================================
     */

    emptySection(
        name
    ) {
        switch (
            name
        ) {
            case "members":
                return {
                    total:
                        null,

                    active:
                        null,

                    new:
                        null,

                    inactive:
                        null,

                    growthRate:
                        null
                };

            case "savings":
            case "contributions":
            case "wallets":
                return {
                    total:
                        null,

                    amount:
                        null,

                    volume:
                        null,

                    count:
                        null
                };

            case "loans":
                return {
                    total:
                        null,

                    active:
                        null,

                    pending:
                        null,

                    completed:
                        null,

                    overdue:
                        null,

                    outstanding:
                        null,

                    disbursed:
                        null,

                    repaid:
                        null
                };

            case "transactions":
                return {
                    total:
                        null,

                    successful:
                        null,

                    pending:
                        null,

                    failed:
                        null,

                    cancelled:
                        null,

                    volume:
                        null
                };

            case "risk":
                return {
                    score:
                        null,

                    level:
                        null,

                    alerts:
                        null,

                    highRisk:
                        null
                };

            case "compliance":
                return {
                    kyc:
                        {},

                    aml:
                        {},

                    verified:
                        null,

                    pending:
                        null,

                    rejected:
                        null,

                    alerts:
                        null
                };

            case "activity":
            case "trends":
                return [];

            case "alerts":
                return [];

            case "health":
                return {
                    status:
                        STATUS.UNKNOWN
                };

            case "performance":
                return {
                    system:
                        {},

                    infrastructure:
                        {}
                };

            default:
                return {};
        }
    }

    /* =========================================================================
     * SERVICE METADATA
     * =========================================================================
     */

    getServiceMetadata() {
        return Object.freeze({
            name:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            domain:
                "administration",

            resource:
                "dashboard",

            multiTenant:
                true,

            readOnly:
                true,

            directDatabaseAccess:
                false,

            directInfrastructureMutation:
                false,

            financialMutation:
                false,

            cacheAware:
                true,

            resilientAggregation:
                true,

            supportedOperations:
                Object.values(
                    OPERATIONS
                )
        });
    }
}

/* =============================================================================
 * NORMALIZATION HELPERS
 * =============================================================================
 */

function normalizeObject(
    value
) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(
            value
        )
    ) {
        return {};
    }

    return {
        ...value
    };
}

function normalizeCollection(
    value
) {
    if (
        Array.isArray(
            value
        )
    ) {
        return value;
    }

    if (
        Array.isArray(
            value?.items
        )
    ) {
        return value.items;
    }

    if (
        Array.isArray(
            value?.data
        )
    ) {
        return value.data;
    }

    if (
        Array.isArray(
            value?.results
        )
    ) {
        return value.results;
    }

    return [];
}

function extractNumber(
    value,
    fallback = null
) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    const number =
        Number(
            value
        );

    return Number.isFinite(
        number
    )
        ? number
        : fallback;
}

function extractAmount(
    value,
    fallback = null
) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    if (
        typeof value ===
        "object"
    ) {
        return (
            extractNumber(
                value.amount,
                fallback
            )
        );
    }

    return extractNumber(
        value,
        fallback
    );
}

function normalizeFinancialSummary(
    value
) {
    const normalized =
        normalizeObject(
            value
        );

    return {
        ...normalized,

        total:
            extractNumber(
                normalized.total ??
                normalized.count ??
                normalized.totalCount
            ),

        count:
            extractNumber(
                normalized.count ??
                normalized.total ??
                normalized.totalCount
            ),

        amount:
            extractAmount(
                normalized.amount ??
                normalized.balance ??
                normalized.totalAmount ??
                normalized.totalValue
            ),

        balance:
            extractAmount(
                normalized.balance ??
                normalized.amount ??
                normalized.totalBalance
            ),

        volume:
            extractAmount(
                normalized.volume ??
                normalized.totalVolume ??
                normalized.amount
            )
    };
}

function normalizeHealth(
    value
) {
    const normalized =
        normalizeObject(
            value
        );

    return {
        ...normalized,

        status:
            normalizeString(
                normalized.status ??
                normalized.state,
                STATUS.UNKNOWN
            ),

        healthy:
            normalized.healthy ===
                undefined
                ? undefined
                : Boolean(
                    normalized.healthy
                ),

        uptime:
            extractNumber(
                normalized.uptime
            ),

        latency:
            extractNumber(
                normalized.latency ??
                normalized.latencyMs
            )
    };
}

/* =============================================================================
 * FACTORY
 * =============================================================================
 */

function createAdminDashboardService(
    dependencies = {}
) {
    return new AdminDashboardService(
        dependencies
    );
}

/* =============================================================================
 * DEFAULT INSTANCE
 * =============================================================================
 *
 * The default instance is deliberately dependency-light.
 *
 * In the canonical TITech composition root, inject the actual service
 * container, logger, observability, and cache implementation.
 *
 * =============================================================================
 */

const defaultService =
    createAdminDashboardService();

/* =============================================================================
 * COMPATIBILITY EXPORTS
 * =============================================================================
 */

module.exports =
    Object.assign(
        defaultService,
        {
            AdminDashboardService,

            createAdminDashboardService,

            SERVICE_NAME,

            APPLICATION_NAME,

            OPERATIONS,

            ERROR_CODES,

            getServiceMetadata:
                defaultService.getServiceMetadata.bind(
                    defaultService
                ),

            getOverview:
                defaultService.getOverview.bind(
                    defaultService
                ),

            getDashboard:
                defaultService.getOverview.bind(
                    defaultService
                ),

            getMetrics:
                defaultService.getMetrics.bind(
                    defaultService
                ),

            getSummary:
                defaultService.getSummary.bind(
                    defaultService
                ),

            getTrends:
                defaultService.getTrends.bind(
                    defaultService
                ),

            getRecentActivity:
                defaultService.getRecentActivity.bind(
                    defaultService
                ),

            getAlerts:
                defaultService.getAlerts.bind(
                    defaultService
                ),

            getHealth:
                defaultService.getHealth.bind(
                    defaultService
                ),

            getPerformance:
                defaultService.getPerformance.bind(
                    defaultService
                ),

            getDashboardReport:
                defaultService.getDashboardReport.bind(
                    defaultService
                )
        }
    );