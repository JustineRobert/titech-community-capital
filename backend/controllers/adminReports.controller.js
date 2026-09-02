"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Reports Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminReports.controller.js
 *
 * Purpose:
 *   HTTP/application boundary for privileged TITech administrative reporting.
 *
 * Architectural position:
 *
 *   HTTP Request
 *        |
 *        v
 *   Authentication
 *        |
 *        v
 *   Authorization / RBAC
 *        |
 *        v
 *   Tenant Context
 *        |
 *        v
 *   adminReports.controller.js
 *        |
 *        v
 *   adminReports.service.js
 *        |
 *        +--> Report Query Services
 *        +--> Financial Services
 *        +--> Loan Services
 *        +--> Savings Services
 *        +--> Contribution Services
 *        +--> Risk Services
 *        +--> Compliance Services
 *        +--> Audit Services
 *        +--> Repositories
 *
 * =============================================================================
 *
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * 1. Thin HTTP boundary.
 * 2. No direct database access.
 * 3. No direct Mongoose model access.
 * 4. No business logic in this controller.
 * 5. No financial mutation.
 * 6. Tenant isolation is mandatory.
 * 7. Report generation is delegated to the service layer.
 * 8. Report exports are controlled and sanitized.
 * 9. Sensitive credentials and tokens are never returned.
 * 10. Internal stack traces are never exposed to clients.
 * 11. Request/correlation/actor context is propagated downstream.
 * 12. Pagination and sorting are bounded.
 * 13. Report filters are normalized at the HTTP boundary.
 * 14. The service layer remains the canonical reporting authority.
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminReports.controller";

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
        "ADMIN_REPORTS_INVALID_REQUEST",

    VALIDATION_FAILED:
        "ADMIN_REPORTS_VALIDATION_FAILED",

    UNAUTHENTICATED:
        "ADMIN_REPORTS_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_REPORTS_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_REPORTS_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_REPORTS_TENANT_MISMATCH",

    REPORT_NOT_FOUND:
        "ADMIN_REPORTS_REPORT_NOT_FOUND",

    REPORT_UNAVAILABLE:
        "ADMIN_REPORTS_REPORT_UNAVAILABLE",

    EXPORT_UNAVAILABLE:
        "ADMIN_REPORTS_EXPORT_UNAVAILABLE",

    SERVICE_UNAVAILABLE:
        "ADMIN_REPORTS_SERVICE_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_REPORTS_INTERNAL_ERROR"
});

/* =============================================================================
 * SERVICE RESOLUTION
 * =============================================================================
 */

const SERVICE_NAMES = Object.freeze([
    "adminReportsService",
    "reportsService",
    "administrativeReportsService"
]);

/* =============================================================================
 * SERVICE METHOD ALIASES
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({

    /* Core reporting -------------------------------------------------------- */

    listReports: [
        "listReports",
        "getReports",
        "findReports"
    ],

    getReport: [
        "getReport",
        "getReportById",
        "findReportById"
    ],

    generateReport: [
        "generateReport",
        "createReport",
        "buildReport"
    ],

    refreshReport: [
        "refreshReport",
        "regenerateReport",
        "rebuildReport"
    ],

    getReportSummary: [
        "getReportSummary",
        "getSummary",
        "summarizeReport"
    ],

    getReportStatistics: [
        "getReportStatistics",
        "getStatistics",
        "getReportStats"
    ],

    /* Dashboard ------------------------------------------------------------- */

    getDashboardReport: [
        "getDashboardReport",
        "generateDashboardReport"
    ],

    getExecutiveReport: [
        "getExecutiveReport",
        "generateExecutiveReport"
    ],

    /* Financial ------------------------------------------------------------- */

    getFinancialReport: [
        "getFinancialReport",
        "generateFinancialReport"
    ],

    getFinancialSummaryReport: [
        "getFinancialSummaryReport",
        "generateFinancialSummaryReport"
    ],

    getTransactionReport: [
        "getTransactionReport",
        "generateTransactionReport"
    ],

    getWalletReport: [
        "getWalletReport",
        "generateWalletReport"
    ],

    getLedgerReport: [
        "getLedgerReport",
        "generateLedgerReport"
    ],

    getBalanceReport: [
        "getBalanceReport",
        "generateBalanceReport"
    ],

    /* Contributions --------------------------------------------------------- */

    getContributionReport: [
        "getContributionReport",
        "generateContributionReport"
    ],

    getContributionSummaryReport: [
        "getContributionSummaryReport",
        "generateContributionSummaryReport"
    ],

    /* Savings --------------------------------------------------------------- */

    getSavingsReport: [
        "getSavingsReport",
        "generateSavingsReport"
    ],

    getSavingsPerformanceReport: [
        "getSavingsPerformanceReport",
        "generateSavingsPerformanceReport"
    ],

    /* Loans ----------------------------------------------------------------- */

    getLoanReport: [
        "getLoanReport",
        "generateLoanReport"
    ],

    getLoanPortfolioReport: [
        "getLoanPortfolioReport",
        "generateLoanPortfolioReport"
    ],

    getLoanPerformanceReport: [
        "getLoanPerformanceReport",
        "generateLoanPerformanceReport"
    ],

    getLoanRepaymentReport: [
        "getLoanRepaymentReport",
        "generateLoanRepaymentReport"
    ],

    getDelinquencyReport: [
        "getDelinquencyReport",
        "generateDelinquencyReport"
    ],

    /* Users / members ------------------------------------------------------- */

    getUserReport: [
        "getUserReport",
        "generateUserReport"
    ],

    getMemberReport: [
        "getMemberReport",
        "generateMemberReport"
    ],

    getUserActivityReport: [
        "getUserActivityReport",
        "generateUserActivityReport"
    ],

    /* Mobile money ---------------------------------------------------------- */

    getMobileMoneyReport: [
        "getMobileMoneyReport",
        "generateMobileMoneyReport"
    ],

    getMobileMoneyReconciliationReport: [
        "getMobileMoneyReconciliationReport",
        "generateMobileMoneyReconciliationReport"
    ],

    /* KYC / AML / compliance ------------------------------------------------ */

    getKycReport: [
        "getKycReport",
        "generateKycReport"
    ],

    getAmlReport: [
        "getAmlReport",
        "generateAmlReport"
    ],

    getComplianceReport: [
        "getComplianceReport",
        "generateComplianceReport"
    ],

    getRegulatoryReport: [
        "getRegulatoryReport",
        "generateRegulatoryReport"
    ],

    /* Risk ------------------------------------------------------------------ */

    getRiskReport: [
        "getRiskReport",
        "generateRiskReport"
    ],

    getRiskSummaryReport: [
        "getRiskSummaryReport",
        "generateRiskSummaryReport"
    ],

    getFraudReport: [
        "getFraudReport",
        "generateFraudReport"
    ],

    /* Audit ----------------------------------------------------------------- */

    getAuditReport: [
        "getAuditReport",
        "generateAuditReport"
    ],

    getSecurityReport: [
        "getSecurityReport",
        "generateSecurityReport"
    ],

    /* Tenant / platform ----------------------------------------------------- */

    getTenantReport: [
        "getTenantReport",
        "generateTenantReport"
    ],

    getSystemReport: [
        "getSystemReport",
        "generateSystemReport"
    ],

    getOperationalReport: [
        "getOperationalReport",
        "generateOperationalReport"
    ],

    /* Export ---------------------------------------------------------------- */

    exportReport: [
        "exportReport",
        "generateReportExport",
        "createReportExport"
    ],

    scheduleReport: [
        "scheduleReport",
        "scheduleReportGeneration"
    ]
});

/* =============================================================================
 * PAGINATION
 * =============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_PAGE_SIZE =
    50;

const MAX_PAGE_SIZE =
    250;

/* =============================================================================
 * SORTING
 * =============================================================================
 */

const DEFAULT_SORT_BY =
    "createdAt";

const ALLOWED_SORT_FIELDS =
    Object.freeze([
        "createdAt",
        "updatedAt",
        "timestamp",
        "date",
        "name",
        "type",
        "status",
        "amount",
        "total",
        "count"
    ]);

const ALLOWED_SORT_DIRECTIONS =
    Object.freeze([
        "asc",
        "desc"
    ]);

/* =============================================================================
 * REPORT TYPES
 * =============================================================================
 */

const REPORT_TYPES =
    Object.freeze([
        "dashboard",
        "executive",
        "financial",
        "financial_summary",
        "transaction",
        "wallet",
        "ledger",
        "balance",
        "contribution",
        "contribution_summary",
        "savings",
        "savings_performance",
        "loan",
        "loan_portfolio",
        "loan_performance",
        "loan_repayment",
        "delinquency",
        "user",
        "member",
        "user_activity",
        "mobile_money",
        "mobile_money_reconciliation",
        "kyc",
        "aml",
        "compliance",
        "regulatory",
        "risk",
        "risk_summary",
        "fraud",
        "audit",
        "security",
        "tenant",
        "system",
        "operational"
    ]);

/* =============================================================================
 * EXPORT FORMATS
 * =============================================================================
 */

const EXPORT_FORMATS =
    Object.freeze([
        "json",
        "csv",
        "xlsx",
        "pdf"
    ]);

/* =============================================================================
 * REPORT STATUS
 * =============================================================================
 */

const REPORT_STATUSES =
    Object.freeze([
        "pending",
        "queued",
        "processing",
        "completed",
        "failed",
        "cancelled",
        "expired"
    ]);

/* =============================================================================
 * NORMALIZATION HELPERS
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
 * SORTING
 * =============================================================================
 */

function normalizeSort(
    query = {}
) {
    const requestedSortBy =
        normalizeString(
            query.sortBy,
            DEFAULT_SORT_BY
        );

    const sortBy =
        ALLOWED_SORT_FIELDS.includes(
            requestedSortBy
        )
            ? requestedSortBy
            : DEFAULT_SORT_BY;

    const requestedDirection =
        normalizeString(
            query.sortDirection ??
            query.sortOrder,
            "desc"
        )?.toLowerCase();

    const sortDirection =
        ALLOWED_SORT_DIRECTIONS.includes(
            requestedDirection
        )
            ? requestedDirection
            : "desc";

    return {
        sortBy,
        sortDirection
    };
}

/* =============================================================================
 * PRINCIPAL / AUTH CONTEXT
 * =============================================================================
 */

function resolvePrincipal(
    req
) {
    return (
        req?.user ??
        req?.auth?.user ??
        req?.auth?.principal ??
        req?.principal ??
        null
    );
}

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

function resolveActorId(
    req
) {
    const principal =
        resolvePrincipal(
            req
        );

    return normalizeString(
        principal?.id ??
        principal?._id ??
        principal?.userId ??
        req?.actorId ??
        req?.context?.actorId
    );
}

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
        req?.headers?.["x-correlation-id"] ??
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

const ADMIN_REPORT_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "report_admin",
        "report_manager",
        "finance_admin",
        "risk_admin",
        "compliance_admin",
        "audit_admin",
        "tenant_admin"
    ]);

const REPORT_PERMISSIONS =
    Object.freeze([
        "report.view",
        "report.read",
        "report.generate",
        "report.search",
        "report.export",
        "report.schedule",
        "reports.view",
        "reports.read",
        "reports.generate",
        "reports.export",
        "admin.reports",
        "admin.reports.view",
        "admin.reports.generate",
        "admin.reports.export"
    ]);

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

function hasReportRole(
    principal
) {
    return resolveRoles(
        principal
    ).some(
        role =>
            ADMIN_REPORT_ROLES.includes(
                role
            )
    );
}

function hasReportPermission(
    principal
) {
    return resolvePermissions(
        principal
    ).some(
        permission =>
            REPORT_PERMISSIONS.includes(
                permission
            ) ||
            permission === "*" ||
            permission === "admin.*"
    );
}

function assertReportAccess(
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
     * Route-level authorization remains the primary policy boundary.
     *
     * These checks provide defense-in-depth if a report endpoint is accidentally
     * mounted without the expected authorization middleware.
     */
    if (
        hasReportRole(
            principal
        ) ||
        hasReportPermission(
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
            "You do not have permission to access administrative reports."
        );

    error.statusCode =
        HTTP_STATUS.FORBIDDEN;

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/* =============================================================================
 * TENANT CONTEXT
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
 * REPORT SERVICE
 * =============================================================================
 */

function resolveReportsService(
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
 * SERVICE METHOD RESOLUTION
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
        resolveReportsService(
            req
        );

    if (!service) {
        const error =
            new Error(
                "The administrative reports service is unavailable."
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
                `Administrative reports operation "${operation}" is not available.`
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

    const executionContext = {
        application:
            APPLICATION_NAME,

        controller:
            CONTROLLER_NAME,

        operation:
            `adminReports.${operation}`,

        request:
            req,

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
            ),

        tenantId:
            resolveTenantId(
                req
            ),

        actorId:
            resolveActorId(
                req
            ),

        principal:
            resolvePrincipal(
                req
            ),

        actor:
            resolvePrincipal(
                req
            )
    };

    if (
        servicesContext &&
        typeof
            servicesContext.assertReady ===
            "function"
    ) {
        await servicesContext.assertReady(
            `adminReports.${operation}`
        );
    }

    return method(
        payload,
        executionContext
    );
}

/* =============================================================================
 * BASE CONTEXT
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

        actorId:
            resolveActorId(
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
 * REPORT FILTERS
 * =============================================================================
 */

function buildReportFilters(
    req
) {
    const query =
        req?.query ||
        {};

    const sort =
        normalizeSort(
            query
        );

    return {
        search:
            normalizeString(
                query.search
            ),

        q:
            normalizeString(
                query.q
            ),

        reportType:
            normalizeReportType(
                query.reportType ??
                query.type
            ),

        reportTypes:
            normalizeStringArray(
                query.reportTypes
            ),

        status:
            normalizeReportStatus(
                query.status
            ),

        statuses:
            normalizeStringArray(
                query.statuses
            ),

        category:
            normalizeString(
                query.category
            ),

        categories:
            normalizeStringArray(
                query.categories
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

        date:
            normalizeString(
                query.date
            ),

        actorId:
            normalizeString(
                query.actorId
            ),

        userId:
            normalizeString(
                query.userId
            ),

        memberId:
            normalizeString(
                query.memberId
            ),

        resourceId:
            normalizeString(
                query.resourceId
            ),

        transactionId:
            normalizeString(
                query.transactionId
            ),

        loanId:
            normalizeString(
                query.loanId
            ),

        accountId:
            normalizeString(
                query.accountId
            ),

        provider:
            normalizeString(
                query.provider
            ),

        channel:
            normalizeString(
                query.channel
            ),

        currency:
            normalizeString(
                query.currency
            ),

        includeInactive:
            normalizeBoolean(
                query.includeInactive,
                false
            ),

        includeMetadata:
            normalizeBoolean(
                query.includeMetadata,
                false
            ),

        includeDetails:
            normalizeBoolean(
                query.includeDetails,
                true
            ),

        ...sort
    };
}

/* =============================================================================
 * REPORT INPUT
 * =============================================================================
 */

function buildReportInput(
    req
) {
    const body =
        req?.body &&
        typeof req.body ===
            "object"
            ? req.body
            : {};

    return {
        title:
            normalizeString(
                body.title
            ),

        description:
            normalizeString(
                body.description
            ),

        format:
            normalizeExportFormat(
                body.format,
                "json"
            ),

        fields:
            normalizeStringArray(
                body.fields
            ),

        columns:
            normalizeStringArray(
                body.columns
            ),

        includeMetadata:
            normalizeBoolean(
                body.includeMetadata,
                false
            ),

        includeDetails:
            normalizeBoolean(
                body.includeDetails,
                true
            ),

        delivery:
            normalizeString(
                body.delivery,
                "response"
            )
    };
}

/* =============================================================================
 * REPORT TYPE
 * =============================================================================
 */

function normalizeReportType(
    value
) {
    const normalized =
        normalizeString(
            value
        )?.toLowerCase();

    if (
        !normalized
    ) {
        return null;
    }

    return REPORT_TYPES.includes(
        normalized
    )
        ? normalized
        : normalized;
}

/* =============================================================================
 * REPORT STATUS
 * =============================================================================
 */

function normalizeReportStatus(
    value
) {
    const normalized =
        normalizeString(
            value
        )?.toLowerCase();

    if (
        !normalized
    ) {
        return null;
    }

    return REPORT_STATUSES.includes(
        normalized
    )
        ? normalized
        : normalized;
}

/* =============================================================================
 * EXPORT FORMAT
 * =============================================================================
 */

function normalizeExportFormat(
    value,
    fallback = "json"
) {
    const normalized =
        normalizeString(
            value,
            fallback
        )?.toLowerCase();

    return EXPORT_FORMATS.includes(
        normalized
    )
        ? normalized
        : fallback;
}

/* =============================================================================
 * IDENTIFIER
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
 * CORE REPORT OPERATIONS
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
                buildReportFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_REPORTS_LIST_RETRIEVED"
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
        "ADMIN_REPORT_RETRIEVED"
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
            reportType:
                normalizeReportType(
                    req.params?.reportType ??
                    req.body?.reportType ??
                    req.query?.reportType
                ),

            filters:
                buildReportFilters(
                    req
                ),

            input:
                buildReportInput(
                    req
                )
        },
        "ADMIN_REPORT_GENERATED",
        HTTP_STATUS.OK
    );
}

async function refreshReport(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "refreshReport",
        {
            reportId:
                normalizeIdentifier(
                    req.params?.reportId ??
                    req.params?.id,
                    "reportId"
                )
        },
        "ADMIN_REPORT_REFRESHED",
        HTTP_STATUS.OK
    );
}

async function getReportSummary(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getReportSummary",
        {
            filters:
                buildReportFilters(
                    req
                )
        },
        "ADMIN_REPORT_SUMMARY_RETRIEVED"
    );
}

async function getReportStatistics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getReportStatistics",
        {
            filters:
                buildReportFilters(
                    req
                )
        },
        "ADMIN_REPORT_STATISTICS_RETRIEVED"
    );
}

/* =============================================================================
 * DASHBOARD / EXECUTIVE
 * =============================================================================
 */

async function getDashboardReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDashboardReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_DASHBOARD_REPORT_RETRIEVED"
    );
}

async function getExecutiveReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getExecutiveReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_EXECUTIVE_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * FINANCIAL
 * =============================================================================
 */

async function getFinancialReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFinancialReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_FINANCIAL_REPORT_RETRIEVED"
    );
}

async function getFinancialSummaryReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFinancialSummaryReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_FINANCIAL_SUMMARY_REPORT_RETRIEVED"
    );
}

async function getTransactionReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTransactionReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_TRANSACTION_REPORT_RETRIEVED"
    );
}

async function getWalletReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getWalletReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_WALLET_REPORT_RETRIEVED"
    );
}

async function getLedgerReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLedgerReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_LEDGER_REPORT_RETRIEVED"
    );
}

async function getBalanceReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getBalanceReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_BALANCE_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * CONTRIBUTIONS
 * =============================================================================
 */

async function getContributionReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getContributionReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_CONTRIBUTION_REPORT_RETRIEVED"
    );
}

async function getContributionSummaryReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getContributionSummaryReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_CONTRIBUTION_SUMMARY_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * SAVINGS
 * =============================================================================
 */

async function getSavingsReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSavingsReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_SAVINGS_REPORT_RETRIEVED"
    );
}

async function getSavingsPerformanceReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSavingsPerformanceReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_SAVINGS_PERFORMANCE_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * LOANS
 * =============================================================================
 */

async function getLoanReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_LOAN_REPORT_RETRIEVED"
    );
}

async function getLoanPortfolioReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanPortfolioReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_LOAN_PORTFOLIO_REPORT_RETRIEVED"
    );
}

async function getLoanPerformanceReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanPerformanceReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_LOAN_PERFORMANCE_REPORT_RETRIEVED"
    );
}

async function getLoanRepaymentReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanRepaymentReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_LOAN_REPAYMENT_REPORT_RETRIEVED"
    );
}

async function getDelinquencyReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDelinquencyReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_DELINQUENCY_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * USERS / MEMBERS
 * =============================================================================
 */

async function getUserReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getUserReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_USER_REPORT_RETRIEVED"
    );
}

async function getMemberReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMemberReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_MEMBER_REPORT_RETRIEVED"
    );
}

async function getUserActivityReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getUserActivityReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_USER_ACTIVITY_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * MOBILE MONEY
 * =============================================================================
 */

async function getMobileMoneyReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMobileMoneyReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_MOBILE_MONEY_REPORT_RETRIEVED"
    );
}

async function getMobileMoneyReconciliationReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMobileMoneyReconciliationReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_MOBILE_MONEY_RECONCILIATION_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * KYC / AML / COMPLIANCE
 * =============================================================================
 */

async function getKycReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getKycReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_KYC_REPORT_RETRIEVED"
    );
}

async function getAmlReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAmlReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_AML_REPORT_RETRIEVED"
    );
}

async function getComplianceReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getComplianceReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_COMPLIANCE_REPORT_RETRIEVED"
    );
}

async function getRegulatoryReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRegulatoryReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_REGULATORY_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * RISK / FRAUD
 * =============================================================================
 */

async function getRiskReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_RISK_REPORT_RETRIEVED"
    );
}

async function getRiskSummaryReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskSummaryReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_RISK_SUMMARY_REPORT_RETRIEVED"
    );
}

async function getFraudReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFraudReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_FRAUD_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * AUDIT / SECURITY
 * =============================================================================
 */

async function getAuditReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_AUDIT_REPORT_RETRIEVED"
    );
}

async function getSecurityReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSecurityReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_SECURITY_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * TENANT / SYSTEM / OPERATIONS
 * =============================================================================
 */

async function getTenantReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTenantReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_TENANT_REPORT_RETRIEVED"
    );
}

async function getSystemReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_SYSTEM_REPORT_RETRIEVED"
    );
}

async function getOperationalReport(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getOperationalReport",
        buildSpecializedReportPayload(
            req
        ),
        "ADMIN_OPERATIONAL_REPORT_RETRIEVED"
    );
}

/* =============================================================================
 * EXPORT
 * =============================================================================
 */

async function exportReport(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "exportReport",
        {
            reportId:
                req.params?.reportId
                    ? normalizeIdentifier(
                        req.params.reportId,
                        "reportId"
                    )
                    : null,

            reportType:
                normalizeReportType(
                    req.params?.reportType ??
                    req.body?.reportType ??
                    req.query?.reportType
                ),

            filters:
                buildReportFilters(
                    req
                ),

            input:
                buildReportInput(
                    req
                ),

            export:
                sanitizeExportInput(
                    req.body
                )
        },
        "ADMIN_REPORT_EXPORT_GENERATED",
        HTTP_STATUS.ACCEPTED
    );
}

/* =============================================================================
 * SCHEDULE
 * =============================================================================
 */

async function scheduleReport(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "scheduleReport",
        {
            reportType:
                normalizeReportType(
                    req.params?.reportType ??
                    req.body?.reportType
                ),

            filters:
                buildReportFilters(
                    req
                ),

            input:
                sanitizeScheduleInput(
                    req.body
                )
        },
        "ADMIN_REPORT_SCHEDULED",
        HTTP_STATUS.ACCEPTED
    );
}

/* =============================================================================
 * SPECIALIZED REPORT PAYLOAD
 * =============================================================================
 */

function buildSpecializedReportPayload(
    req
) {
    return {
        filters:
            buildReportFilters(
                req
            ),

        pagination:
            normalizePagination(
                req.query ||
                    {}
            ),

        input:
            buildReportInput(
                req
            )
    };
}

/* =============================================================================
 * EXPORT INPUT
 * =============================================================================
 */

function sanitizeExportInput(
    body
) {
    if (
        !body ||
        typeof body !==
            "object"
    ) {
        return {
            format:
                "json",

            fields:
                [],

            includeMetadata:
                false
        };
    }

    return {
        format:
            normalizeExportFormat(
                body.format,
                "json"
            ),

        fields:
            normalizeStringArray(
                body.fields
            ),

        columns:
            normalizeStringArray(
                body.columns
            ),

        filename:
            sanitizeFilename(
                body.filename
            ),

        includeMetadata:
            normalizeBoolean(
                body.includeMetadata,
                false
            ),

        includeDetails:
            normalizeBoolean(
                body.includeDetails,
                true
            )
    };
}

/* =============================================================================
 * SCHEDULE INPUT
 * =============================================================================
 */

function sanitizeScheduleInput(
    body
) {
    if (
        !body ||
        typeof body !==
            "object"
    ) {
        return {};
    }

    /*
     * Keep scheduling input deliberately narrow.
     *
     * The service remains responsible for validating cron/recurrence semantics.
     */
    return {
        frequency:
            normalizeString(
                body.frequency
            ),

        timezone:
            normalizeString(
                body.timezone
            ),

        format:
            normalizeExportFormat(
                body.format,
                "json"
            ),

        recipients:
            normalizeStringArray(
                body.recipients
            ),

        enabled:
            normalizeBoolean(
                body.enabled,
                true
            )
    };
}

/* =============================================================================
 * FILENAME SANITIZATION
 * =============================================================================
 */

function sanitizeFilename(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (!normalized) {
        return null;
    }

    return normalized
        .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        )
        .slice(
            0,
            180
        );
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
        assertReportAccess(
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
        assertReportAccess(
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
                "ADMIN_REPORTS_SUCCESS",

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
                    ? "The report operation could not be completed."
                    : (
                        error?.message ||
                        "The administrative report request is invalid."
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
                    "The administrative report request is invalid."
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
                    "You do not have permission to access administrative reports."
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
                    "The requested report is outside the authorized tenant."
            };

        case ERROR_CODES.REPORT_NOT_FOUND:
            return {
                statusCode:
                    HTTP_STATUS.NOT_FOUND,

                code:
                    ERROR_CODES.REPORT_NOT_FOUND,

                message:
                    "The requested report was not found."
            };

        case ERROR_CODES.REPORT_UNAVAILABLE:
        case ERROR_CODES.EXPORT_UNAVAILABLE:
        case ERROR_CODES.SERVICE_UNAVAILABLE:
            return {
                statusCode:
                    HTTP_STATUS.SERVICE_UNAVAILABLE,

                code:
                    error.code,

                message:
                    "The requested reporting operation is temporarily unavailable."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The report operation could not be completed."
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
            return ERROR_CODES.REPORT_NOT_FOUND;

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
            resolveActorId(
                req
            ),

        actorRoles:
            resolveRoles(
                principal
            ),

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
                "Unknown administrative reports error"
        }
    };

    /*
     * Never log:
     *
     * - request body
     * - authorization headers
     * - access tokens
     * - refresh tokens
     * - passwords
     * - OTPs
     * - payment credentials
     * - complete financial report payloads
     * - KYC/AML document contents
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
            // Logging must never break the HTTP response.
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
 * EXPRESS HANDLER WRAPPER
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
            "Administrative reports handler must be a function."
        );
    }

    return function adminReportsHandler(
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
            "reporting",

        resource:
            "administrative-reports",

        multiTenant:
            true,

        serviceDriven:
            true,

        directDatabaseAccess:
            false,

        privilegedOperations:
            true,

        financialMutation:
            false,

        supportedReportTypes:
            REPORT_TYPES,

        supportedExportFormats:
            EXPORT_FORMATS,

        supportedStatuses:
            REPORT_STATUSES,

        pagination: {
            defaultPage:
                DEFAULT_PAGE,

            defaultPageSize:
                DEFAULT_PAGE_SIZE,

            maxPageSize:
                MAX_PAGE_SIZE
        },

        sorting: {
            defaultSortBy:
                DEFAULT_SORT_BY,

            fields:
                ALLOWED_SORT_FIELDS,

            directions:
                ALLOWED_SORT_DIRECTIONS
        }
    });
}

/* =============================================================================
 * PUBLIC CONTROLLER
 * =============================================================================
 */

const controller = {

    /* -------------------------------------------------------------------------
     * Core reports
     * ---------------------------------------------------------------------- */

    listReports:
        createHandler(
            listReports
        ),

    getReports:
        createHandler(
            listReports
        ),

    getReport:
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

    refreshReport:
        createHandler(
            refreshReport
        ),

    regenerateReport:
        createHandler(
            refreshReport
        ),

    getReportSummary:
        createHandler(
            getReportSummary
        ),

    getSummary:
        createHandler(
            getReportSummary
        ),

    getReportStatistics:
        createHandler(
            getReportStatistics
        ),

    getReportStats:
        createHandler(
            getReportStatistics
        ),

    /* -------------------------------------------------------------------------
     * Dashboard / executive
     * ---------------------------------------------------------------------- */

    getDashboardReport:
        createHandler(
            getDashboardReport
        ),

    generateDashboardReport:
        createHandler(
            getDashboardReport
        ),

    getExecutiveReport:
        createHandler(
            getExecutiveReport
        ),

    generateExecutiveReport:
        createHandler(
            getExecutiveReport
        ),

    /* -------------------------------------------------------------------------
     * Financial
     * ---------------------------------------------------------------------- */

    getFinancialReport:
        createHandler(
            getFinancialReport
        ),

    generateFinancialReport:
        createHandler(
            getFinancialReport
        ),

    getFinancialSummaryReport:
        createHandler(
            getFinancialSummaryReport
        ),

    getTransactionReport:
        createHandler(
            getTransactionReport
        ),

    getWalletReport:
        createHandler(
            getWalletReport
        ),

    getLedgerReport:
        createHandler(
            getLedgerReport
        ),

    getBalanceReport:
        createHandler(
            getBalanceReport
        ),

    /* -------------------------------------------------------------------------
     * Contributions
     * ---------------------------------------------------------------------- */

    getContributionReport:
        createHandler(
            getContributionReport
        ),

    generateContributionReport:
        createHandler(
            getContributionReport
        ),

    getContributionSummaryReport:
        createHandler(
            getContributionSummaryReport
        ),

    /* -------------------------------------------------------------------------
     * Savings
     * ---------------------------------------------------------------------- */

    getSavingsReport:
        createHandler(
            getSavingsReport
        ),

    generateSavingsReport:
        createHandler(
            getSavingsReport
        ),

    getSavingsPerformanceReport:
        createHandler(
            getSavingsPerformanceReport
        ),

    /* -------------------------------------------------------------------------
     * Loans
     * ---------------------------------------------------------------------- */

    getLoanReport:
        createHandler(
            getLoanReport
        ),

    generateLoanReport:
        createHandler(
            getLoanReport
        ),

    getLoanPortfolioReport:
        createHandler(
            getLoanPortfolioReport
        ),

    getLoanPerformanceReport:
        createHandler(
            getLoanPerformanceReport
        ),

    getLoanRepaymentReport:
        createHandler(
            getLoanRepaymentReport
        ),

    getDelinquencyReport:
        createHandler(
            getDelinquencyReport
        ),

    /* -------------------------------------------------------------------------
     * Users / members
     * ---------------------------------------------------------------------- */

    getUserReport:
        createHandler(
            getUserReport
        ),

    generateUserReport:
        createHandler(
            getUserReport
        ),

    getMemberReport:
        createHandler(
            getMemberReport
        ),

    generateMemberReport:
        createHandler(
            getMemberReport
        ),

    getUserActivityReport:
        createHandler(
            getUserActivityReport
        ),

    /* -------------------------------------------------------------------------
     * Mobile money
     * ---------------------------------------------------------------------- */

    getMobileMoneyReport:
        createHandler(
            getMobileMoneyReport
        ),

    generateMobileMoneyReport:
        createHandler(
            getMobileMoneyReport
        ),

    getMobileMoneyReconciliationReport:
        createHandler(
            getMobileMoneyReconciliationReport
        ),

    /* -------------------------------------------------------------------------
     * KYC / AML / compliance
     * ---------------------------------------------------------------------- */

    getKycReport:
        createHandler(
            getKycReport
        ),

    generateKycReport:
        createHandler(
            getKycReport
        ),

    getAmlReport:
        createHandler(
            getAmlReport
        ),

    generateAmlReport:
        createHandler(
            getAmlReport
        ),

    getComplianceReport:
        createHandler(
            getComplianceReport
        ),

    generateComplianceReport:
        createHandler(
            getComplianceReport
        ),

    getRegulatoryReport:
        createHandler(
            getRegulatoryReport
        ),

    /* -------------------------------------------------------------------------
     * Risk / fraud
     * ---------------------------------------------------------------------- */

    getRiskReport:
        createHandler(
            getRiskReport
        ),

    generateRiskReport:
        createHandler(
            getRiskReport
        ),

    getRiskSummaryReport:
        createHandler(
            getRiskSummaryReport
        ),

    getFraudReport:
        createHandler(
            getFraudReport
        ),

    /* -------------------------------------------------------------------------
     * Audit / security
     * ---------------------------------------------------------------------- */

    getAuditReport:
        createHandler(
            getAuditReport
        ),

    generateAuditReport:
        createHandler(
            getAuditReport
        ),

    getSecurityReport:
        createHandler(
            getSecurityReport
        ),

    generateSecurityReport:
        createHandler(
            getSecurityReport
        ),

    /* -------------------------------------------------------------------------
     * Tenant / system / operations
     * ---------------------------------------------------------------------- */

    getTenantReport:
        createHandler(
            getTenantReport
        ),

    generateTenantReport:
        createHandler(
            getTenantReport
        ),

    getSystemReport:
        createHandler(
            getSystemReport
        ),

    generateSystemReport:
        createHandler(
            getSystemReport
        ),

    getOperationalReport:
        createHandler(
            getOperationalReport
        ),

    generateOperationalReport:
        createHandler(
            getOperationalReport
        ),

    /* -------------------------------------------------------------------------
     * Export / scheduling
     * ---------------------------------------------------------------------- */

    exportReport:
        createHandler(
            exportReport
        ),

    generateReportExport:
        createHandler(
            exportReport
        ),

    scheduleReport:
        createHandler(
            scheduleReport
        ),

    scheduleReportGeneration:
        createHandler(
            scheduleReport
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