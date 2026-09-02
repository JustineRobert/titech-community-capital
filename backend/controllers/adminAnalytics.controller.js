"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Analytics Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminAnalytics.controller.js
 *
 * Purpose:
 *   HTTP/application boundary for privileged TITech administrative analytics.
 *
 * Architecture:
 *
 *   HTTP Request
 *       |
 *       v
 *   Authentication
 *       |
 *       v
 *   Authorization / RBAC
 *       |
 *       v
 *   Tenant Context
 *       |
 *       v
 *   adminAnalytics.controller.js
 *       |
 *       v
 *   adminAnalytics.service.js
 *       |
 *       +--> Analytics Engine
 *       +--> Financial Read Models
 *       +--> Loan Read Models
 *       +--> Savings Read Models
 *       +--> Contribution Read Models
 *       +--> Member Read Models
 *       +--> Transaction Read Models
 *       +--> Audit / Observability
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This controller MUST NOT:
 *
 *   - Access MongoDB directly.
 *   - Import Mongoose models for analytics queries.
 *   - Mutate financial balances.
 *   - Create ledger entries.
 *   - Post transactions.
 *   - Approve/reject loans.
 *   - Calculate authoritative financial state.
 *   - Bypass tenant isolation.
 *   - Trust a client supplied tenant header as authorization proof.
 *   - Expose internal stack traces to clients.
 *
 * Analytics is a read/application concern.
 *
 * Financial truth remains owned by the canonical financial services and
 * repositories.
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminAnalytics.controller";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

/* =============================================================================
 * HTTP STATUS
 * =============================================================================
 */

const HTTP_STATUS = Object.freeze({
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,

    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,

    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
});

/* =============================================================================
 * ERROR CODES
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_REQUEST:
        "ADMIN_ANALYTICS_INVALID_REQUEST",

    VALIDATION_FAILED:
        "ADMIN_ANALYTICS_VALIDATION_FAILED",

    UNAUTHENTICATED:
        "ADMIN_ANALYTICS_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_ANALYTICS_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_ANALYTICS_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_ANALYTICS_TENANT_MISMATCH",

    RESOURCE_NOT_FOUND:
        "ADMIN_ANALYTICS_RESOURCE_NOT_FOUND",

    CONFLICT:
        "ADMIN_ANALYTICS_CONFLICT",

    SERVICE_UNAVAILABLE:
        "ADMIN_ANALYTICS_SERVICE_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_ANALYTICS_INTERNAL_ERROR"
});

/* =============================================================================
 * SERVICE RESOLUTION
 * =============================================================================
 */

const SERVICE_NAMES = Object.freeze([
    "adminAnalyticsService",
    "analyticsService",
    "administrativeAnalyticsService"
]);

/* =============================================================================
 * SERVICE METHOD ALIASES
 *
 * These aliases make the controller tolerant of naming conventions already
 * used by different route/service implementations while retaining one
 * canonical controller operation.
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({
    getOverview: [
        "getOverview",
        "getAnalyticsOverview",
        "getDashboardOverview"
    ],

    getDashboardAnalytics: [
        "getDashboardAnalytics",
        "getDashboardMetrics",
        "getAnalyticsDashboard"
    ],

    getSummary: [
        "getSummary",
        "getAnalyticsSummary",
        "getSystemSummary"
    ],

    getKpis: [
        "getKpis",
        "getKPIs",
        "getKeyPerformanceIndicators"
    ],

    getFinancialAnalytics: [
        "getFinancialAnalytics",
        "getFinancialMetrics",
        "getFinanceAnalytics"
    ],

    getRevenueAnalytics: [
        "getRevenueAnalytics",
        "getRevenueMetrics"
    ],

    getContributionAnalytics: [
        "getContributionAnalytics",
        "getContributionMetrics",
        "getContributionsAnalytics"
    ],

    getSavingsAnalytics: [
        "getSavingsAnalytics",
        "getSavingsMetrics"
    ],

    getWithdrawalAnalytics: [
        "getWithdrawalAnalytics",
        "getWithdrawalMetrics",
        "getWithdrawalsAnalytics"
    ],

    getTransactionAnalytics: [
        "getTransactionAnalytics",
        "getTransactionMetrics",
        "getTransactionsAnalytics"
    ],

    getLoanAnalytics: [
        "getLoanAnalytics",
        "getLoanMetrics",
        "getLoansAnalytics"
    ],

    getLoanPortfolioAnalytics: [
        "getLoanPortfolioAnalytics",
        "getPortfolioAnalytics",
        "getLoanPortfolioMetrics"
    ],

    getRepaymentAnalytics: [
        "getRepaymentAnalytics",
        "getRepaymentMetrics",
        "getLoanRepaymentAnalytics"
    ],

    getSavingsPlanAnalytics: [
        "getSavingsPlanAnalytics",
        "getSavingsPlanMetrics"
    ],

    getMemberAnalytics: [
        "getMemberAnalytics",
        "getMemberMetrics",
        "getMembersAnalytics"
    ],

    getGroupAnalytics: [
        "getGroupAnalytics",
        "getGroupMetrics",
        "getGroupsAnalytics"
    ],

    getUserAnalytics: [
        "getUserAnalytics",
        "getUserMetrics",
        "getUsersAnalytics"
    ],

    getGrowthAnalytics: [
        "getGrowthAnalytics",
        "getGrowthMetrics"
    ],

    getTrendAnalytics: [
        "getTrendAnalytics",
        "getTrends",
        "getAnalyticsTrends"
    ],

    getTimeSeries: [
        "getTimeSeries",
        "getAnalyticsTimeSeries",
        "getTimeSeriesAnalytics"
    ],

    getDistribution: [
        "getDistribution",
        "getAnalyticsDistribution",
        "getMetricDistribution"
    ],

    getPerformanceAnalytics: [
        "getPerformanceAnalytics",
        "getPerformanceMetrics"
    ],

    getOperationalAnalytics: [
        "getOperationalAnalytics",
        "getOperationalMetrics"
    ],

    getRiskAnalytics: [
        "getRiskAnalytics",
        "getRiskMetrics"
    ],

    getFraudAnalytics: [
        "getFraudAnalytics",
        "getFraudMetrics"
    ],

    getComplianceAnalytics: [
        "getComplianceAnalytics",
        "getComplianceMetrics"
    ],

    getKYCAnalytics: [
        "getKYCAnalytics",
        "getKycAnalytics",
        "getKYCStats"
    ],

    getAMLAnalytics: [
        "getAMLAnalytics",
        "getAmlAnalytics",
        "getAMLStats"
    ],

    getMobileMoneyAnalytics: [
        "getMobileMoneyAnalytics",
        "getMobileMoneyMetrics",
        "getMomoAnalytics"
    ],

    getMTNMoMoAnalytics: [
        "getMTNMoMoAnalytics",
        "getMtnMoMoAnalytics",
        "getMTNAnalytics"
    ],

    getAirtelMoneyAnalytics: [
        "getAirtelMoneyAnalytics",
        "getAirtelAnalytics"
    ],

    getChannelAnalytics: [
        "getChannelAnalytics",
        "getChannelMetrics"
    ],

    getGeographicAnalytics: [
        "getGeographicAnalytics",
        "getGeographyAnalytics",
        "getLocationAnalytics"
    ],

    getBranchAnalytics: [
        "getBranchAnalytics",
        "getBranchMetrics"
    ],

    getAgentAnalytics: [
        "getAgentAnalytics",
        "getAgentMetrics"
    ],

    getActivityAnalytics: [
        "getActivityAnalytics",
        "getActivityMetrics"
    ],

    getEngagementAnalytics: [
        "getEngagementAnalytics",
        "getEngagementMetrics"
    ],

    getRetentionAnalytics: [
        "getRetentionAnalytics",
        "getRetentionMetrics"
    ],

    getCohortAnalytics: [
        "getCohortAnalytics",
        "getCohortMetrics"
    ],

    getForecastAnalytics: [
        "getForecastAnalytics",
        "getForecasts",
        "getAnalyticsForecast"
    ],

    getCashFlowAnalytics: [
        "getCashFlowAnalytics",
        "getCashflowAnalytics",
        "getCashFlowMetrics"
    ],

    getBalanceAnalytics: [
        "getBalanceAnalytics",
        "getBalanceMetrics"
    ],

    getAgingAnalytics: [
        "getAgingAnalytics",
        "getAgingMetrics"
    ],

    getCustomReport: [
        "getCustomReport",
        "generateCustomReport",
        "runCustomReport"
    ],

    listReports: [
        "listReports",
        "getReports",
        "listAnalyticsReports"
    ],

    getReport: [
        "getReport",
        "getAnalyticsReport",
        "getReportById"
    ],

    generateReport: [
        "generateReport",
        "createReport",
        "generateAnalyticsReport"
    ],

    getAuditAnalytics: [
        "getAuditAnalytics",
        "getAuditMetrics"
    ],

    getSystemAnalytics: [
        "getSystemAnalytics",
        "getSystemMetrics"
    ]
});

/* =============================================================================
 * PAGINATION
 * =============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_PAGE_SIZE =
    25;

const MAX_PAGE_SIZE =
    100;

/* =============================================================================
 * ALLOWED ANALYTICS GRANULARITIES
 * =============================================================================
 */

const GRANULARITIES = Object.freeze([
    "hour",
    "day",
    "week",
    "month",
    "quarter",
    "year"
]);

/* =============================================================================
 * ALLOWED AGGREGATION TYPES
 * =============================================================================
 */

const AGGREGATIONS = Object.freeze([
    "sum",
    "count",
    "avg",
    "average",
    "min",
    "max",
    "median",
    "distinct",
    "percentage",
    "rate"
]);

/* =============================================================================
 * NORMALIZATION
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

        return normalized.length > 0
            ? normalized
            : fallback;
    } catch {
        return fallback;
    }
}

function normalizeBoolean(
    value,
    fallback = undefined
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    if (
        typeof value === "boolean"
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
        ].includes(normalized)
    ) {
        return true;
    }

    if (
        [
            "false",
            "0",
            "no",
            "off"
        ].includes(normalized)
    ) {
        return false;
    }

    return fallback;
}

function normalizeNumber(
    value,
    fallback = undefined
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function normalizePositiveInteger(
    value,
    fallback,
    maximum = Number.MAX_SAFE_INTEGER
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number < 1
    ) {
        return fallback;
    }

    return Math.min(
        Math.floor(number),
        maximum
    );
}

function normalizeStringArray(
    value
) {
    if (
        Array.isArray(value)
    ) {
        return value
            .map(item =>
                normalizeString(item)
            )
            .filter(Boolean);
    }

    if (
        typeof value === "string"
    ) {
        return value
            .split(",")
            .map(item =>
                normalizeString(item)
            )
            .filter(Boolean);
    }

    return [];
}

function normalizeGranularity(
    value
) {
    const normalized =
        normalizeString(
            value,
            "day"
        ).toLowerCase();

    return GRANULARITIES.includes(
        normalized
    )
        ? normalized
        : "day";
}

function normalizeAggregation(
    value
) {
    const normalized =
        normalizeString(
            value,
            "sum"
        ).toLowerCase();

    return AGGREGATIONS.includes(
        normalized
    )
        ? normalized
        : "sum";
}

/* =============================================================================
 * PAGINATION
 * =============================================================================
 */

function normalizePagination(
    query = {}
) {
    const page =
        normalizePositiveInteger(
            query.page,
            DEFAULT_PAGE
        );

    const limit =
        normalizePositiveInteger(
            query.limit ??
                query.pageSize ??
                query.perPage,
            DEFAULT_PAGE_SIZE,
            MAX_PAGE_SIZE
        );

    return {
        page,
        limit,
        skip:
            (page - 1) *
            limit
    };
}

/* =============================================================================
 * PRINCIPAL
 * =============================================================================
 */

function resolvePrincipal(
    req
) {
    if (!req) {
        return null;
    }

    return (
        req.user ??
        req.auth?.user ??
        req.auth?.principal ??
        req.principal ??
        null
    );
}

/* =============================================================================
 * TENANT
 * =============================================================================
 *
 * Client supplied tenant headers are contextual only.
 *
 * Trusted tenant context must come from authenticated middleware or the
 * server-side request context.
 * =============================================================================
 */

function resolveTenantId(
    req
) {
    const principal =
        resolvePrincipal(
            req
        );

    return normalizeString(
        req?.context?.tenantId ??
        req?.requestContext?.tenantId ??
        req?.tenantId ??
        req?.tenant?.id ??
        req?.tenant?._id ??
        req?.auth?.tenantId ??
        principal?.tenantId ??
        principal?.tenant?.id ??
        principal?.tenant?._id
    );
}

/* =============================================================================
 * REQUEST CONTEXT
 * =============================================================================
 */

function resolveRequestId(
    req
) {
    return normalizeString(
        req?.requestId ??
        req?.context?.requestId ??
        req?.requestContext?.requestId ??
        req?.id
    );
}

function resolveCorrelationId(
    req
) {
    return normalizeString(
        req?.correlationId ??
        req?.context?.correlationId ??
        req?.requestContext?.correlationId ??
        resolveRequestId(req)
    );
}

function resolveDeviceId(
    req
) {
    return normalizeString(
        req?.deviceId ??
        req?.context?.deviceId ??
        req?.requestContext?.deviceId ??
        req?.headers?.["x-device-id"]
    );
}

/* =============================================================================
 * AUTHORIZATION
 * =============================================================================
 */

function resolveRoles(
    principal
) {
    if (!principal) {
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
        .map(role =>
            String(role)
                .trim()
                .toLowerCase()
        );
}

function resolvePermissions(
    principal
) {
    if (!principal) {
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
        .map(permission =>
            String(permission)
                .trim()
                .toLowerCase()
        );
}

const ADMIN_ANALYTICS_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "analytics_admin",
        "analytics_manager",
        "reporting_admin",
        "reporting_manager",
        "finance_admin",
        "finance_manager",
        "risk_admin",
        "compliance_admin",
        "tenant_admin"
    ]);

const ANALYTICS_PERMISSIONS =
    Object.freeze([
        "analytics.view",
        "analytics.read",
        "analytics.manage",
        "analytics.reports",
        "analytics.export",
        "report.view",
        "report.read",
        "report.create",
        "report.generate",
        "financial.analytics",
        "financial.analytics.view",
        "loan.analytics",
        "savings.analytics",
        "member.analytics",
        "risk.analytics",
        "compliance.analytics",
        "admin.analytics"
    ]);

function hasAnalyticsRole(
    principal
) {
    const roles =
        resolveRoles(
            principal
        );

    return roles.some(
        role =>
            ADMIN_ANALYTICS_ROLES.includes(
                role
            )
    );
}

function hasAnalyticsPermission(
    principal
) {
    const permissions =
        resolvePermissions(
            principal
        );

    return permissions.some(
        permission =>
            ANALYTICS_PERMISSIONS.includes(
                permission
            ) ||
            permission === "*" ||
            permission === "admin.*"
    );
}

function assertAnalyticsAccess(
    req
) {
    const principal =
        resolvePrincipal(
            req
        );

    if (!principal) {
        const error =
            new Error(
                "Authentication is required."
            );

        error.statusCode =
            HTTP_STATUS.UNAUTHORIZED;

        error.code =
            ERROR_CODES.UNAUTHENTICATED;

        throw error;
    }

    /*
     * Route-level authorization remains the primary authorization mechanism.
     *
     * This defensive check prevents an accidentally unprotected administrative
     * analytics route from exposing privileged data.
     */
    if (
        hasAnalyticsRole(
            principal
        ) ||
        hasAnalyticsPermission(
            principal
        ) ||
        req?.authorization?.allowed === true ||
        req?.authz?.allowed === true ||
        req?.permissionGranted === true
    ) {
        return true;
    }

    const error =
        new Error(
            "You do not have permission to access administrative analytics."
        );

    error.statusCode =
        HTTP_STATUS.FORBIDDEN;

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/* =============================================================================
 * TENANT ASSERTION
 * =============================================================================
 */

function assertTenantContext(
    req
) {
    const tenantId =
        resolveTenantId(
            req
        );

    if (!tenantId) {
        const error =
            new Error(
                "A valid tenant context is required."
            );

        error.statusCode =
            HTTP_STATUS.FORBIDDEN;

        error.code =
            ERROR_CODES.TENANT_REQUIRED;

        throw error;
    }

    return tenantId;
}

/* =============================================================================
 * SERVICE CONTEXT
 * =============================================================================
 */

function resolveServicesContext(
    req
) {
    return (
        req?.servicesContext ??
        req?.serviceContext ??
        req?.context?.services ??
        req?.services ??
        req?.container ??
        req?.app?.locals?.servicesContext ??
        req?.app?.locals?.services ??
        null
    );
}

/* =============================================================================
 * ANALYTICS SERVICE
 * =============================================================================
 */

function resolveAnalyticsService(
    req
) {
    const servicesContext =
        resolveServicesContext(
            req
        );

    if (
        servicesContext
    ) {
        for (
            const name of
                SERVICE_NAMES
        ) {
            if (
                typeof
                    servicesContext.requireService ===
                    "function"
            ) {
                try {
                    const service =
                        servicesContext.requireService(
                            name
                        );

                    if (service) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                typeof
                    servicesContext.service ===
                    "function"
            ) {
                try {
                    const service =
                        servicesContext.service(
                            name
                        );

                    if (service) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                typeof
                    servicesContext.get ===
                    "function"
            ) {
                try {
                    const service =
                        servicesContext.get(
                            name
                        );

                    if (service) {
                        return service;
                    }
                } catch {
                    // Continue resolution.
                }
            }

            if (
                servicesContext[name]
            ) {
                return servicesContext[name];
            }
        }
    }

    const locals =
        req?.app?.locals;

    if (locals) {
        for (
            const name of
                SERVICE_NAMES
        ) {
            if (
                locals[name]
            ) {
                return locals[name];
            }
        }
    }

    for (
        const name of
            SERVICE_NAMES
    ) {
        if (
            req?.[name]
        ) {
            return req[name];
        }
    }

    return null;
}

/* =============================================================================
 * SERVICE METHOD
 * =============================================================================
 */

function resolveServiceMethod(
    service,
    operation
) {
    if (!service) {
        return null;
    }

    const aliases =
        METHOD_ALIASES[
            operation
        ] ??
        [];

    for (
        const methodName of
            aliases
    ) {
        if (
            typeof
                service[methodName] ===
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

/* =============================================================================
 * SERVICE INVOCATION
 * =============================================================================
 */

async function invokeService(
    req,
    operation,
    payload
) {
    const service =
        resolveAnalyticsService(
            req
        );

    if (!service) {
        const error =
            new Error(
                "The administrative analytics service is unavailable."
            );

        error.statusCode =
            HTTP_STATUS.SERVICE_UNAVAILABLE;

        error.code =
            ERROR_CODES.SERVICE_UNAVAILABLE;

        throw error;
    }

    const method =
        resolveServiceMethod(
            service,
            operation
        );

    if (!method) {
        const error =
            new Error(
                `Administrative analytics operation "${operation}" is not available.`
            );

        error.statusCode =
            HTTP_STATUS.SERVICE_UNAVAILABLE;

        error.code =
            ERROR_CODES.SERVICE_UNAVAILABLE;

        throw error;
    }

    const servicesContext =
        resolveServicesContext(
            req
        );

    let executionContext = {
        application:
            APPLICATION_NAME,

        controller:
            CONTROLLER_NAME,

        operation:
            `adminAnalytics.${operation}`,

        request:
            req,

        requestId:
            resolveRequestId(req),

        correlationId:
            resolveCorrelationId(req),

        deviceId:
            resolveDeviceId(req),

        tenantId:
            resolveTenantId(req),

        principal:
            resolvePrincipal(req),

        actor:
            resolvePrincipal(req)
    };

    if (
        servicesContext &&
        typeof
            servicesContext.forOperation ===
            "function"
    ) {
        try {
            executionContext =
                servicesContext.forOperation(
                    `adminAnalytics.${operation}`,
                    {
                        request:
                            req,

                        tenantId:
                            resolveTenantId(req),

                        actor:
                            resolvePrincipal(req),

                        requestId:
                            resolveRequestId(req),

                        correlationId:
                            resolveCorrelationId(req)
                    }
                );
        } catch {
            /*
             * Compatibility fallback for ServicesContext implementations that
             * do not expose the canonical forOperation contract.
             */
        }
    }

    if (
        servicesContext &&
        typeof
            servicesContext.assertReady ===
            "function"
    ) {
        await servicesContext.assertReady(
            `adminAnalytics.${operation}`
        );
    }

    return method(
        payload,
        executionContext
    );
}

/* =============================================================================
 * BASE PAYLOAD
 * =============================================================================
 */

function buildBasePayload(
    req
) {
    const tenantId =
        assertTenantContext(
            req
        );

    return {
        tenantId,

        actor:
            resolvePrincipal(
                req
            ),

        requestId:
            resolveRequestId(
                req
            ),

        correlationId:
            resolveCorrelationId(
                req
            ),

        deviceId:
            resolveDeviceId(
                req
            )
    };
}

/* =============================================================================
 * ANALYTICS FILTERS
 * =============================================================================
 */

function buildAnalyticsFilters(
    req
) {
    const query =
        req.query ||
        {};

    return {
        search:
            normalizeString(
                query.search
            ),

        metric:
            normalizeString(
                query.metric
            ),

        metrics:
            normalizeStringArray(
                query.metrics
            ),

        dimension:
            normalizeString(
                query.dimension
            ),

        dimensions:
            normalizeStringArray(
                query.dimensions
            ),

        groupBy:
            normalizeStringArray(
                query.groupBy
            ),

        segment:
            normalizeString(
                query.segment
            ),

        segments:
            normalizeStringArray(
                query.segments
            ),

        status:
            normalizeString(
                query.status
            ),

        type:
            normalizeString(
                query.type
            ),

        category:
            normalizeString(
                query.category
            ),

        channel:
            normalizeString(
                query.channel
            ),

        provider:
            normalizeString(
                query.provider
            ),

        currency:
            normalizeString(
                query.currency
            ),

        branchId:
            normalizeString(
                query.branchId
            ),

        groupId:
            normalizeString(
                query.groupId
            ),

        memberId:
            normalizeString(
                query.memberId
            ),

        userId:
            normalizeString(
                query.userId
            ),

        loanId:
            normalizeString(
                query.loanId
            ),

        planId:
            normalizeString(
                query.planId
            ),

        from:
            normalizeString(
                query.from
            ),

        to:
            normalizeString(
                query.to
            ),

        startDate:
            normalizeString(
                query.startDate
            ),

        endDate:
            normalizeString(
                query.endDate
            ),

        granularity:
            normalizeGranularity(
                query.granularity
            ),

        aggregation:
            normalizeAggregation(
                query.aggregation
            ),

        includeComparison:
            normalizeBoolean(
                query.includeComparison,
                false
            ),

        includeForecast:
            normalizeBoolean(
                query.includeForecast,
                false
            ),

        includeInactive:
            normalizeBoolean(
                query.includeInactive,
                false
            )
    };
}

/* =============================================================================
 * DASHBOARD / OVERVIEW
 * =============================================================================
 */

async function getOverview(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getOverview",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_OVERVIEW_RETRIEVED"
    );
}

async function getDashboardAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDashboardAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_DASHBOARD_ANALYTICS_RETRIEVED"
    );
}

async function getSummary(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSummary",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_SUMMARY_RETRIEVED"
    );
}

async function getKpis(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getKpis",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_KPIS_RETRIEVED"
    );
}

/* =============================================================================
 * FINANCIAL ANALYTICS
 * =============================================================================
 */

async function getFinancialAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFinancialAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_FINANCIAL_ANALYTICS_RETRIEVED"
    );
}

async function getRevenueAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRevenueAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_REVENUE_ANALYTICS_RETRIEVED"
    );
}

async function getContributionAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getContributionAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_CONTRIBUTION_ANALYTICS_RETRIEVED"
    );
}

async function getSavingsAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSavingsAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_SAVINGS_ANALYTICS_RETRIEVED"
    );
}

async function getWithdrawalAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getWithdrawalAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_WITHDRAWAL_ANALYTICS_RETRIEVED"
    );
}

async function getTransactionAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTransactionAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_TRANSACTION_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * LOAN ANALYTICS
 * =============================================================================
 */

async function getLoanAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_LOAN_ANALYTICS_RETRIEVED"
    );
}

async function getLoanPortfolioAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanPortfolioAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_LOAN_PORTFOLIO_ANALYTICS_RETRIEVED"
    );
}

async function getRepaymentAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRepaymentAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_REPAYMENT_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * SAVINGS PLAN ANALYTICS
 * =============================================================================
 */

async function getSavingsPlanAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSavingsPlanAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_SAVINGS_PLAN_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * MEMBER / USER / GROUP ANALYTICS
 * =============================================================================
 */

async function getMemberAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMemberAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_MEMBER_ANALYTICS_RETRIEVED"
    );
}

async function getGroupAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getGroupAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_GROUP_ANALYTICS_RETRIEVED"
    );
}

async function getUserAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getUserAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_USER_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * GROWTH / TRENDS
 * =============================================================================
 */

async function getGrowthAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getGrowthAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_GROWTH_ANALYTICS_RETRIEVED"
    );
}

async function getTrendAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTrendAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_TREND_ANALYTICS_RETRIEVED"
    );
}

async function getTimeSeries(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTimeSeries",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_TIMESERIES_RETRIEVED"
    );
}

async function getDistribution(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDistribution",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_DISTRIBUTION_RETRIEVED"
    );
}

/* =============================================================================
 * PERFORMANCE / OPERATIONS
 * =============================================================================
 */

async function getPerformanceAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getPerformanceAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_PERFORMANCE_ANALYTICS_RETRIEVED"
    );
}

async function getOperationalAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getOperationalAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_OPERATIONAL_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * RISK / FRAUD / COMPLIANCE
 * =============================================================================
 */

async function getRiskAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_RISK_ANALYTICS_RETRIEVED"
    );
}

async function getFraudAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFraudAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_FRAUD_ANALYTICS_RETRIEVED"
    );
}

async function getComplianceAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getComplianceAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_COMPLIANCE_ANALYTICS_RETRIEVED"
    );
}

async function getKYCAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getKYCAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_KYC_ANALYTICS_RETRIEVED"
    );
}

async function getAMLAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAMLAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_AML_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * MOBILE MONEY
 * =============================================================================
 */

async function getMobileMoneyAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMobileMoneyAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_MOBILE_MONEY_ANALYTICS_RETRIEVED"
    );
}

async function getMTNMoMoAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMTNMoMoAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_MTN_MOMO_ANALYTICS_RETRIEVED"
    );
}

async function getAirtelMoneyAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAirtelMoneyAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_AIRTEL_MONEY_ANALYTICS_RETRIEVED"
    );
}

async function getChannelAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getChannelAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_CHANNEL_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * GEOGRAPHIC / BRANCH / AGENT
 * =============================================================================
 */

async function getGeographicAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getGeographicAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_GEOGRAPHIC_ANALYTICS_RETRIEVED"
    );
}

async function getBranchAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getBranchAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_BRANCH_ANALYTICS_RETRIEVED"
    );
}

async function getAgentAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAgentAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_AGENT_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * ENGAGEMENT / RETENTION
 * =============================================================================
 */

async function getActivityAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getActivityAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ACTIVITY_ANALYTICS_RETRIEVED"
    );
}

async function getEngagementAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getEngagementAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ENGAGEMENT_ANALYTICS_RETRIEVED"
    );
}

async function getRetentionAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRetentionAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_RETENTION_ANALYTICS_RETRIEVED"
    );
}

async function getCohortAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getCohortAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_COHORT_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * FORECASTING / CASH FLOW
 * =============================================================================
 */

async function getForecastAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getForecastAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_FORECAST_ANALYTICS_RETRIEVED"
    );
}

async function getCashFlowAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getCashFlowAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_CASH_FLOW_ANALYTICS_RETRIEVED"
    );
}

async function getBalanceAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getBalanceAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_BALANCE_ANALYTICS_RETRIEVED"
    );
}

async function getAgingAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAgingAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_AGING_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * REPORTING
 * =============================================================================
 */

async function listReports(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listReports",
        {
            filters:
                buildAnalyticsFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_ANALYTICS_REPORTS_RETRIEVED"
    );
}

async function getReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getReport",
        {
            reportId:
                normalizeIdentifier(
                    req.params?.reportId ??
                    req.params?.id,
                    "reportId"
                )
        },
        "ADMIN_ANALYTICS_REPORT_RETRIEVED"
    );
}

async function generateReport(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "generateReport",
        {
            input:
                req.body,

            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_ANALYTICS_REPORT_GENERATED",
        HTTP_STATUS.CREATED
    );
}

async function getCustomReport(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "getCustomReport",
        {
            input:
                req.body,

            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_CUSTOM_ANALYTICS_REPORT_GENERATED",
        HTTP_STATUS.OK
    );
}

/* =============================================================================
 * AUDIT / SYSTEM
 * =============================================================================
 */

async function getAuditAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_AUDIT_ANALYTICS_RETRIEVED"
    );
}

async function getSystemAnalytics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemAnalytics",
        {
            filters:
                buildAnalyticsFilters(
                    req
                )
        },
        "ADMIN_SYSTEM_ANALYTICS_RETRIEVED"
    );
}

/* =============================================================================
 * IDENTIFIER VALIDATION
 * =============================================================================
 */

function normalizeIdentifier(
    value,
    fieldName
) {
    const normalized =
        normalizeString(
            value
        );

    if (!normalized) {
        const error =
            new Error(
                `${fieldName} is required.`
            );

        error.statusCode =
            HTTP_STATUS.BAD_REQUEST;

        error.code =
            ERROR_CODES.INVALID_REQUEST;

        throw error;
    }

    if (
        normalized.length > 256
    ) {
        const error =
            new Error(
                `${fieldName} is invalid.`
            );

        error.statusCode =
            HTTP_STATUS.BAD_REQUEST;

        error.code =
            ERROR_CODES.INVALID_REQUEST;

        throw error;
    }

    return normalized;
}

/* =============================================================================
 * GENERIC READ EXECUTOR
 * =============================================================================
 */

async function executeReadOperation(
    req,
    res,
    operation,
    input,
    successCode
) {
    try {
        assertAnalyticsAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,
                    ...input
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    successCode,

                tenantId:
                    base.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/* =============================================================================
 * GENERIC WRITE EXECUTOR
 *
 * Reporting operations may create report artifacts, but they still must not
 * mutate authoritative financial state.
 * =============================================================================
 */

async function executeWriteOperation(
    req,
    res,
    operation,
    input,
    successCode,
    statusCode = HTTP_STATUS.OK
) {
    try {
        assertAnalyticsAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,
                    ...input
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    successCode,

                tenantId:
                    base.tenantId
            },
            statusCode
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/* =============================================================================
 * SUCCESS RESPONSE
 * =============================================================================
 */

function sendSuccess(
    req,
    res,
    data,
    metadata = {},
    statusCode = HTTP_STATUS.OK
) {
    return res
        .status(
            statusCode
        )
        .json({
            success: true,

            code:
                metadata.code ||
                "ADMIN_ANALYTICS_SUCCESS",

            data,

            meta: {
                requestId:
                    metadata.requestId ??
                    resolveRequestId(
                        req
                    ),

                correlationId:
                    metadata.correlationId ??
                    resolveCorrelationId(
                        req
                    ),

                tenantId:
                    metadata.tenantId ??
                    resolveTenantId(
                        req
                    ),

                ...(
                    metadata.meta ||
                    {}
                )
            }
        });
}

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeHttpError(
    error
) {
    const explicitStatus =
        Number(
            error?.statusCode ??
            error?.status ??
            error?.httpStatus ??
            0
        );

    if (
        explicitStatus >= 400 &&
        explicitStatus < 600
    ) {
        return {
            statusCode:
                explicitStatus,

            code:
                error?.code ||
                mapStatusToCode(
                    explicitStatus
                ),

            message:
                explicitStatus >= 500
                    ? "The analytics operation could not be completed."
                    : (
                        error?.message ||
                        "The administrative analytics request is invalid."
                    )
        };
    }

    switch (
        error?.code
    ) {
        case ERROR_CODES.INVALID_REQUEST:
        case ERROR_CODES.VALIDATION_FAILED:
            return {
                statusCode:
                    HTTP_STATUS.BAD_REQUEST,

                code:
                    error.code,

                message:
                    error.message ||
                    "The administrative analytics request is invalid."
            };

        case ERROR_CODES.UNAUTHENTICATED:
            return {
                statusCode:
                    HTTP_STATUS.UNAUTHORIZED,

                code:
                    ERROR_CODES.UNAUTHENTICATED,

                message:
                    "Authentication is required."
            };

        case ERROR_CODES.FORBIDDEN:
            return {
                statusCode:
                    HTTP_STATUS.FORBIDDEN,

                code:
                    ERROR_CODES.FORBIDDEN,

                message:
                    "You do not have permission to perform this analytics operation."
            };

        case ERROR_CODES.TENANT_REQUIRED:
            return {
                statusCode:
                    HTTP_STATUS.FORBIDDEN,

                code:
                    ERROR_CODES.TENANT_REQUIRED,

                message:
                    "A valid tenant context is required."
            };

        case ERROR_CODES.TENANT_MISMATCH:
            return {
                statusCode:
                    HTTP_STATUS.FORBIDDEN,

                code:
                    ERROR_CODES.TENANT_MISMATCH,

                message:
                    "The requested analytics resource is outside the authorized tenant."
            };

        case ERROR_CODES.RESOURCE_NOT_FOUND:
            return {
                statusCode:
                    HTTP_STATUS.NOT_FOUND,

                code:
                    ERROR_CODES.RESOURCE_NOT_FOUND,

                message:
                    "The requested analytics resource was not found."
            };

        case ERROR_CODES.CONFLICT:
            return {
                statusCode:
                    HTTP_STATUS.CONFLICT,

                code:
                    ERROR_CODES.CONFLICT,

                message:
                    error.message ||
                    "The analytics operation conflicts with the current state."
            };

        case ERROR_CODES.SERVICE_UNAVAILABLE:
            return {
                statusCode:
                    HTTP_STATUS.SERVICE_UNAVAILABLE,

                code:
                    ERROR_CODES.SERVICE_UNAVAILABLE,

                message:
                    "The analytics service is temporarily unavailable."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The analytics operation could not be completed."
            };
    }
}

/* =============================================================================
 * STATUS -> ERROR CODE
 * =============================================================================
 */

function mapStatusToCode(
    statusCode
) {
    switch (
        statusCode
    ) {
        case HTTP_STATUS.UNAUTHORIZED:
            return ERROR_CODES.UNAUTHENTICATED;

        case HTTP_STATUS.FORBIDDEN:
            return ERROR_CODES.FORBIDDEN;

        case HTTP_STATUS.NOT_FOUND:
            return ERROR_CODES.RESOURCE_NOT_FOUND;

        case HTTP_STATUS.CONFLICT:
            return ERROR_CODES.CONFLICT;

        case HTTP_STATUS.SERVICE_UNAVAILABLE:
            return ERROR_CODES.SERVICE_UNAVAILABLE;

        case HTTP_STATUS.BAD_REQUEST:
        case HTTP_STATUS.UNPROCESSABLE_ENTITY:
            return ERROR_CODES.INVALID_REQUEST;

        default:
            return ERROR_CODES.INTERNAL_ERROR;
    }
}

/* =============================================================================
 * SAFE ERROR LOGGING
 * =============================================================================
 */

function logControllerError(
    req,
    error,
    operation
) {
    const logger =
        req?.logger ??
        req?.servicesContext?.logger ??
        req?.serviceContext?.logger ??
        req?.app?.locals?.logger ??
        null;

    const principal =
        resolvePrincipal(
            req
        );

    const metadata = {
        controller:
            CONTROLLER_NAME,

        operation,

        requestId:
            resolveRequestId(
                req
            ),

        correlationId:
            resolveCorrelationId(
                req
            ),

        tenantId:
            resolveTenantId(
                req
            ),

        actorId:
            principal?.id ??
            principal?._id ??
            null,

        error: {
            name:
                error?.name ||
                "Error",

            code:
                error?.code ||
                null,

            statusCode:
                error?.statusCode ??
                error?.status ??
                null,

            message:
                error?.message ||
                "Unknown administrative analytics error"
        }
    };

    /*
     * Deliberately do NOT log:
     *
     * - req.body
     * - authorization headers
     * - access tokens
     * - refresh tokens
     * - KYC payloads
     * - AML payloads
     * - complete financial records
     * - customer-sensitive analytics payloads
     */

    if (
        logger &&
        typeof logger.error ===
            "function"
    ) {
        try {
            logger.error(
                metadata
            );

            return;
        } catch {
            // Logging must never break an API response.
        }
    }

    if (
        process.env.NODE_ENV !==
        "production"
    ) {
        try {
            // eslint-disable-next-line no-console
            console.error(
                `[${CONTROLLER_NAME}]`,
                metadata
            );
        } catch {
            // Intentionally ignored.
        }
    }
}

/* =============================================================================
 * ERROR RESPONSE
 * =============================================================================
 */

function sendError(
    req,
    res,
    error,
    operation
) {
    logControllerError(
        req,
        error,
        operation
    );

    const normalized =
        normalizeHttpError(
            error
        );

    if (
        res.headersSent
    ) {
        return undefined;
    }

    return res
        .status(
            normalized.statusCode
        )
        .json({
            success: false,

            code:
                normalized.code,

            message:
                normalized.message,

            requestId:
                resolveRequestId(
                    req
                ),

            correlationId:
                resolveCorrelationId(
                    req
                )
        });
}

/* =============================================================================
 * EXPRESS ASYNC HANDLER
 * =============================================================================
 */

function createHandler(
    handler
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "Admin analytics handler must be a function."
        );
    }

    return function adminAnalyticsHandler(
        req,
        res,
        next
    ) {
        Promise.resolve(
            handler(
                req,
                res
            )
        ).catch(
            error => {
                if (
                    res.headersSent
                ) {
                    if (
                        typeof next ===
                        "function"
                    ) {
                        return next(
                            error
                        );
                    }

                    return undefined;
                }

                return sendError(
                    req,
                    res,
                    error,
                    "unhandled"
                );
            }
        );
    };
}

/* =============================================================================
 * CONTROLLER METADATA
 * =============================================================================
 */

function getControllerMetadata() {
    return Object.freeze({
        name:
            CONTROLLER_NAME,

        application:
            APPLICATION_NAME,

        domain:
            "analytics",

        resource:
            "administrative-analytics",

        multiTenant:
            true,

        serviceDriven:
            true,

        directDatabaseAccess:
            false,

        privilegedOperations:
            true,

        auditRequired:
            true,

        financialMutation:
            false,

        authoritativeFinancialState:
            false,

        supportedDomains: [
            "overview",
            "dashboard",
            "kpis",
            "financial",
            "revenue",
            "contributions",
            "savings",
            "withdrawals",
            "transactions",
            "loans",
            "loan-portfolio",
            "repayments",
            "savings-plans",
            "members",
            "groups",
            "users",
            "growth",
            "trends",
            "time-series",
            "distribution",
            "performance",
            "operations",
            "risk",
            "fraud",
            "compliance",
            "kyc",
            "aml",
            "mobile-money",
            "mtn-momo",
            "airtel-money",
            "channels",
            "geography",
            "branches",
            "agents",
            "activity",
            "engagement",
            "retention",
            "cohorts",
            "forecasting",
            "cash-flow",
            "balances",
            "aging",
            "reports",
            "audit",
            "system"
        ],

        pagination: {
            defaultPage:
                DEFAULT_PAGE,

            defaultPageSize:
                DEFAULT_PAGE_SIZE,

            maxPageSize:
                MAX_PAGE_SIZE
        },

        granularity:
            GRANULARITIES,

        aggregations:
            AGGREGATIONS
    });
}

/* =============================================================================
 * PUBLIC CONTROLLER
 * =============================================================================
 */

const controller = {
    /* -------------------------------------------------------------------------
     * Overview
     * ---------------------------------------------------------------------- */

    getOverview:
        createHandler(
            getOverview
        ),

    getAnalyticsOverview:
        createHandler(
            getOverview
        ),

    getDashboardAnalytics:
        createHandler(
            getDashboardAnalytics
        ),

    getDashboardMetrics:
        createHandler(
            getDashboardAnalytics
        ),

    getAnalyticsDashboard:
        createHandler(
            getDashboardAnalytics
        ),

    getSummary:
        createHandler(
            getSummary
        ),

    getAnalyticsSummary:
        createHandler(
            getSummary
        ),

    getKpis:
        createHandler(
            getKpis
        ),

    getKPIs:
        createHandler(
            getKpis
        ),

    getKeyPerformanceIndicators:
        createHandler(
            getKpis
        ),

    /* -------------------------------------------------------------------------
     * Financial
     * ---------------------------------------------------------------------- */

    getFinancialAnalytics:
        createHandler(
            getFinancialAnalytics
        ),

    getFinancialMetrics:
        createHandler(
            getFinancialAnalytics
        ),

    getRevenueAnalytics:
        createHandler(
            getRevenueAnalytics
        ),

    getRevenueMetrics:
        createHandler(
            getRevenueAnalytics
        ),

    getContributionAnalytics:
        createHandler(
            getContributionAnalytics
        ),

    getContributionMetrics:
        createHandler(
            getContributionAnalytics
        ),

    getSavingsAnalytics:
        createHandler(
            getSavingsAnalytics
        ),

    getSavingsMetrics:
        createHandler(
            getSavingsAnalytics
        ),

    getWithdrawalAnalytics:
        createHandler(
            getWithdrawalAnalytics
        ),

    getWithdrawalMetrics:
        createHandler(
            getWithdrawalAnalytics
        ),

    getTransactionAnalytics:
        createHandler(
            getTransactionAnalytics
        ),

    getTransactionMetrics:
        createHandler(
            getTransactionAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Loans
     * ---------------------------------------------------------------------- */

    getLoanAnalytics:
        createHandler(
            getLoanAnalytics
        ),

    getLoanMetrics:
        createHandler(
            getLoanAnalytics
        ),

    getLoanPortfolioAnalytics:
        createHandler(
            getLoanPortfolioAnalytics
        ),

    getPortfolioAnalytics:
        createHandler(
            getLoanPortfolioAnalytics
        ),

    getLoanPortfolioMetrics:
        createHandler(
            getLoanPortfolioAnalytics
        ),

    getRepaymentAnalytics:
        createHandler(
            getRepaymentAnalytics
        ),

    getRepaymentMetrics:
        createHandler(
            getRepaymentAnalytics
        ),

    getSavingsPlanAnalytics:
        createHandler(
            getSavingsPlanAnalytics
        ),

    getSavingsPlanMetrics:
        createHandler(
            getSavingsPlanAnalytics
        ),

    /* -------------------------------------------------------------------------
     * People / groups
     * ---------------------------------------------------------------------- */

    getMemberAnalytics:
        createHandler(
            getMemberAnalytics
        ),

    getMemberMetrics:
        createHandler(
            getMemberAnalytics
        ),

    getGroupAnalytics:
        createHandler(
            getGroupAnalytics
        ),

    getGroupMetrics:
        createHandler(
            getGroupAnalytics
        ),

    getUserAnalytics:
        createHandler(
            getUserAnalytics
        ),

    getUserMetrics:
        createHandler(
            getUserAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Trends
     * ---------------------------------------------------------------------- */

    getGrowthAnalytics:
        createHandler(
            getGrowthAnalytics
        ),

    getGrowthMetrics:
        createHandler(
            getGrowthAnalytics
        ),

    getTrendAnalytics:
        createHandler(
            getTrendAnalytics
        ),

    getTrends:
        createHandler(
            getTrendAnalytics
        ),

    getAnalyticsTrends:
        createHandler(
            getTrendAnalytics
        ),

    getTimeSeries:
        createHandler(
            getTimeSeries
        ),

    getAnalyticsTimeSeries:
        createHandler(
            getTimeSeries
        ),

    getDistribution:
        createHandler(
            getDistribution
        ),

    getAnalyticsDistribution:
        createHandler(
            getDistribution
        ),

    /* -------------------------------------------------------------------------
     * Operations
     * ---------------------------------------------------------------------- */

    getPerformanceAnalytics:
        createHandler(
            getPerformanceAnalytics
        ),

    getPerformanceMetrics:
        createHandler(
            getPerformanceAnalytics
        ),

    getOperationalAnalytics:
        createHandler(
            getOperationalAnalytics
        ),

    getOperationalMetrics:
        createHandler(
            getOperationalAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Risk / fraud / compliance
     * ---------------------------------------------------------------------- */

    getRiskAnalytics:
        createHandler(
            getRiskAnalytics
        ),

    getRiskMetrics:
        createHandler(
            getRiskAnalytics
        ),

    getFraudAnalytics:
        createHandler(
            getFraudAnalytics
        ),

    getFraudMetrics:
        createHandler(
            getFraudAnalytics
        ),

    getComplianceAnalytics:
        createHandler(
            getComplianceAnalytics
        ),

    getComplianceMetrics:
        createHandler(
            getComplianceAnalytics
        ),

    getKYCAnalytics:
        createHandler(
            getKYCAnalytics
        ),

    getKycAnalytics:
        createHandler(
            getKYCAnalytics
        ),

    getKYCStats:
        createHandler(
            getKYCAnalytics
        ),

    getAMLAnalytics:
        createHandler(
            getAMLAnalytics
        ),

    getAmlAnalytics:
        createHandler(
            getAMLAnalytics
        ),

    getAMLStats:
        createHandler(
            getAMLAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Mobile money
     * ---------------------------------------------------------------------- */

    getMobileMoneyAnalytics:
        createHandler(
            getMobileMoneyAnalytics
        ),

    getMobileMoneyMetrics:
        createHandler(
            getMobileMoneyAnalytics
        ),

    getMomoAnalytics:
        createHandler(
            getMobileMoneyAnalytics
        ),

    getMTNMoMoAnalytics:
        createHandler(
            getMTNMoMoAnalytics
        ),

    getMtnMoMoAnalytics:
        createHandler(
            getMTNMoMoAnalytics
        ),

    getMTNAnalytics:
        createHandler(
            getMTNMoMoAnalytics
        ),

    getAirtelMoneyAnalytics:
        createHandler(
            getAirtelMoneyAnalytics
        ),

    getAirtelAnalytics:
        createHandler(
            getAirtelMoneyAnalytics
        ),

    getChannelAnalytics:
        createHandler(
            getChannelAnalytics
        ),

    getChannelMetrics:
        createHandler(
            getChannelAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Geographic / operational dimensions
     * ---------------------------------------------------------------------- */

    getGeographicAnalytics:
        createHandler(
            getGeographicAnalytics
        ),

    getGeographyAnalytics:
        createHandler(
            getGeographicAnalytics
        ),

    getLocationAnalytics:
        createHandler(
            getGeographicAnalytics
        ),

    getBranchAnalytics:
        createHandler(
            getBranchAnalytics
        ),

    getBranchMetrics:
        createHandler(
            getBranchAnalytics
        ),

    getAgentAnalytics:
        createHandler(
            getAgentAnalytics
        ),

    getAgentMetrics:
        createHandler(
            getAgentAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Engagement
     * ---------------------------------------------------------------------- */

    getActivityAnalytics:
        createHandler(
            getActivityAnalytics
        ),

    getActivityMetrics:
        createHandler(
            getActivityAnalytics
        ),

    getEngagementAnalytics:
        createHandler(
            getEngagementAnalytics
        ),

    getEngagementMetrics:
        createHandler(
            getEngagementAnalytics
        ),

    getRetentionAnalytics:
        createHandler(
            getRetentionAnalytics
        ),

    getRetentionMetrics:
        createHandler(
            getRetentionAnalytics
        ),

    getCohortAnalytics:
        createHandler(
            getCohortAnalytics
        ),

    getCohortMetrics:
        createHandler(
            getCohortAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Forecasting / liquidity
     * ---------------------------------------------------------------------- */

    getForecastAnalytics:
        createHandler(
            getForecastAnalytics
        ),

    getForecasts:
        createHandler(
            getForecastAnalytics
        ),

    getAnalyticsForecast:
        createHandler(
            getForecastAnalytics
        ),

    getCashFlowAnalytics:
        createHandler(
            getCashFlowAnalytics
        ),

    getCashflowAnalytics:
        createHandler(
            getCashFlowAnalytics
        ),

    getCashFlowMetrics:
        createHandler(
            getCashFlowAnalytics
        ),

    getBalanceAnalytics:
        createHandler(
            getBalanceAnalytics
        ),

    getBalanceMetrics:
        createHandler(
            getBalanceAnalytics
        ),

    getAgingAnalytics:
        createHandler(
            getAgingAnalytics
        ),

    getAgingMetrics:
        createHandler(
            getAgingAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Reporting
     * ---------------------------------------------------------------------- */

    listReports:
        createHandler(
            listReports
        ),

    getReports:
        createHandler(
            listReports
        ),

    listAnalyticsReports:
        createHandler(
            listReports
        ),

    getReport:
        createHandler(
            getReport
        ),

    getAnalyticsReport:
        createHandler(
            getReport
        ),

    getReportById:
        createHandler(
            getReport
        ),

    generateReport:
        createHandler(
            generateReport
        ),

    createReport:
        createHandler(
            generateReport
        ),

    generateAnalyticsReport:
        createHandler(
            generateReport
        ),

    getCustomReport:
        createHandler(
            getCustomReport
        ),

    generateCustomReport:
        createHandler(
            getCustomReport
        ),

    runCustomReport:
        createHandler(
            getCustomReport
        ),

    /* -------------------------------------------------------------------------
     * Audit / system
     * ---------------------------------------------------------------------- */

    getAuditAnalytics:
        createHandler(
            getAuditAnalytics
        ),

    getAuditMetrics:
        createHandler(
            getAuditAnalytics
        ),

    getSystemAnalytics:
        createHandler(
            getSystemAnalytics
        ),

    getSystemMetrics:
        createHandler(
            getSystemAnalytics
        ),

    /* -------------------------------------------------------------------------
     * Metadata
     * ---------------------------------------------------------------------- */

    getControllerMetadata
};

/* =============================================================================
 * EXPORT
 * =============================================================================
 */

module.exports =
    Object.freeze(
        controller
    );