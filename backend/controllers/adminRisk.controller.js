"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Risk Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminRisk.controller.js
 *
 * Production Grade
 * -----------------------------------------------------------------------------
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * - HTTP boundary for privileged risk-management operations.
 * - Resolve authenticated actor and trusted tenant context.
 * - Normalize request parameters.
 * - Delegate risk business logic to adminRisk.service.js.
 * - Preserve request/correlation/device metadata.
 * - Return stable API response envelopes.
 * - Normalize operational errors safely.
 * - Never access MongoDB directly.
 * - Never calculate authoritative financial risk inside the controller.
 * - Never mutate financial records directly.
 * - Never bypass tenant isolation.
 * - Never trust x-tenant-id as authorization proof.
 * - Never expose internal error details in production.
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 *   HTTP
 *     |
 *     v
 *   Authentication
 *     |
 *     v
 *   Authorization / Permission
 *     |
 *     v
 *   Tenant Context
 *     |
 *     v
 *   adminRisk.controller.js
 *     |
 *     v
 *   adminRisk.service.js
 *     |
 *     +--> Risk repositories
 *     +--> Loan repositories
 *     +--> Member repositories
 *     +--> Transaction repositories
 *     +--> KYC / AML services
 *     +--> Audit service
 *     +--> Observability
 *
 * Risk boundary
 * -----------------------------------------------------------------------------
 *
 *   Risk Controller
 *       -> request normalization
 *
 *   Risk Service
 *       -> authoritative risk policy
 *
 *   Risk Engine
 *       -> scoring / classification
 *
 *   Repository
 *       -> tenant-scoped persistence
 *
 *   Audit
 *       -> immutable administrative trail
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminRisk.controller";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

/* =============================================================================
 * HTTP Status Codes
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
 * Error Codes
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_REQUEST:
        "ADMIN_RISK_INVALID_REQUEST",

    VALIDATION_FAILED:
        "ADMIN_RISK_VALIDATION_FAILED",

    UNAUTHENTICATED:
        "ADMIN_RISK_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_RISK_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_RISK_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_RISK_TENANT_MISMATCH",

    RESOURCE_NOT_FOUND:
        "ADMIN_RISK_RESOURCE_NOT_FOUND",

    CONFLICT:
        "ADMIN_RISK_CONFLICT",

    SERVICE_UNAVAILABLE:
        "ADMIN_RISK_SERVICE_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_RISK_INTERNAL_ERROR"
});

/* =============================================================================
 * Service names
 * ============================================================================= */

const SERVICE_NAMES = Object.freeze([
    "adminRiskService",
    "riskService",
    "administrativeRiskService"
]);

/* =============================================================================
 * Service operation aliases
 * ============================================================================= */

const METHOD_ALIASES = Object.freeze({
    getRiskOverview: [
        "getRiskOverview",
        "getOverview",
        "getRiskSummary",
        "getRiskDashboard"
    ],

    getRiskMetrics: [
        "getRiskMetrics",
        "calculateRiskMetrics",
        "getMetrics"
    ],

    getRiskProfile: [
        "getRiskProfile",
        "getMemberRiskProfile",
        "getCustomerRiskProfile"
    ],

    listRiskProfiles: [
        "listRiskProfiles",
        "getRiskProfiles",
        "findRiskProfiles"
    ],

    getRiskAssessment: [
        "getRiskAssessment",
        "getAssessment"
    ],

    createRiskAssessment: [
        "createRiskAssessment",
        "assessRisk",
        "performRiskAssessment"
    ],

    updateRiskAssessment: [
        "updateRiskAssessment",
        "reassessRisk"
    ],

    listRiskAlerts: [
        "listRiskAlerts",
        "getRiskAlerts",
        "findRiskAlerts"
    ],

    getRiskAlert: [
        "getRiskAlert",
        "getAlert"
    ],

    acknowledgeRiskAlert: [
        "acknowledgeRiskAlert",
        "acknowledgeAlert"
    ],

    resolveRiskAlert: [
        "resolveRiskAlert",
        "resolveAlert"
    ],

    dismissRiskAlert: [
        "dismissRiskAlert",
        "dismissAlert"
    ],

    listHighRiskMembers: [
        "listHighRiskMembers",
        "getHighRiskMembers",
        "findHighRiskMembers"
    ],

    listHighRiskLoans: [
        "listHighRiskLoans",
        "getHighRiskLoans",
        "findHighRiskLoans"
    ],

    getLoanRisk: [
        "getLoanRisk",
        "getLoanRiskProfile",
        "assessLoanRisk"
    ],

    getPortfolioRisk: [
        "getPortfolioRisk",
        "getLoanPortfolioRisk",
        "calculatePortfolioRisk"
    ],

    getMemberRisk: [
        "getMemberRisk",
        "getMemberRiskScore",
        "calculateMemberRisk"
    ],

    getFraudIndicators: [
        "getFraudIndicators",
        "findFraudIndicators",
        "getFraudRisk"
    ],

    getAMLIndicators: [
        "getAMLIndicators",
        "getAmlIndicators",
        "findAMLIndicators",
        "getComplianceIndicators"
    ],

    getKYCExceptions: [
        "getKYCExceptions",
        "getKycExceptions",
        "listKYCExceptions",
        "listKycExceptions"
    ],

    listRiskEvents: [
        "listRiskEvents",
        "getRiskEvents",
        "findRiskEvents"
    ],

    getRiskEvent: [
        "getRiskEvent",
        "getRiskEventById"
    ],

    createRiskEvent: [
        "createRiskEvent",
        "recordRiskEvent"
    ],

    updateRiskConfiguration: [
        "updateRiskConfiguration",
        "updateRiskSettings",
        "updateRiskRules"
    ],

    getRiskConfiguration: [
        "getRiskConfiguration",
        "getRiskSettings",
        "getRiskRules"
    ],

    getRiskTrends: [
        "getRiskTrends",
        "getRiskTrend",
        "calculateRiskTrends"
    ],

    getRiskDistribution: [
        "getRiskDistribution",
        "getRiskScoreDistribution"
    ],

    getRiskRecommendations: [
        "getRiskRecommendations",
        "getRecommendations"
    ]
});

/* =============================================================================
 * Pagination
 * ============================================================================= */

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/* =============================================================================
 * Risk levels
 * ============================================================================= */

const RISK_LEVELS = Object.freeze([
    "low",
    "medium",
    "moderate",
    "high",
    "critical",
    "unknown"
]);

/* =============================================================================
 * Normalization helpers
 * ============================================================================= */

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

function normalizeRiskLevel(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
    ) {
        return null;
    }

    const level =
        normalized.toLowerCase();

    return RISK_LEVELS.includes(
        level
    )
        ? level
        : normalized;
}

function normalizeIdentifier(
    value,
    fieldName
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
    ) {
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
 * Pagination
 * ============================================================================= */

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
 * Principal resolution
 * ============================================================================= */

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
 * Tenant resolution
 * =============================================================================
 *
 * IMPORTANT:
 *
 * A client-provided tenant header is contextual information only.
 * It is NOT authorization proof.
 *
 * Trusted tenant context should be established by authentication,
 * authorization and tenant middleware.
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
 * Request metadata
 * ============================================================================= */

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
 * Actor roles / permissions
 * ============================================================================= */

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

/* =============================================================================
 * Administrative risk roles
 * ============================================================================= */

const ADMIN_RISK_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "risk_admin",
        "risk_manager",
        "compliance_admin",
        "compliance_manager",
        "tenant_admin"
    ]);

/* =============================================================================
 * Risk permissions
 * ============================================================================= */

const RISK_PERMISSIONS =
    Object.freeze([
        "risk.view",
        "risk.read",
        "risk.manage",
        "risk.assess",
        "risk.alerts.manage",
        "risk.configuration.manage",
        "fraud.view",
        "fraud.manage",
        "aml.view",
        "aml.manage",
        "compliance.view",
        "compliance.manage",
        "portfolio.risk.view",
        "loan.risk.view",
        "admin.risk"
    ]);

/* =============================================================================
 * Defensive authorization
 * ============================================================================= */

function hasRiskRole(
    principal
) {
    const roles =
        resolveRoles(
            principal
        );

    return roles.some(
        role =>
            ADMIN_RISK_ROLES.includes(
                role
            )
    );
}

function hasRiskPermission(
    principal
) {
    const permissions =
        resolvePermissions(
            principal
        );

    return permissions.some(
        permission =>
            RISK_PERMISSIONS.includes(
                permission
            ) ||
            permission === "*" ||
            permission.endsWith(
                ":manage"
            ) &&
            permission.startsWith(
                "risk"
            )
    );
}

function assertRiskAccess(
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
     * The route authorization middleware remains authoritative.
     *
     * This additional check protects against accidentally mounting a sensitive
     * risk route without its expected permission middleware.
     */
    if (
        hasRiskRole(
            principal
        ) ||
        hasRiskPermission(
            principal
        ) ||
        req?.authorization?.allowed ===
            true ||
        req?.authz?.allowed ===
            true ||
        req?.permissionGranted ===
            true
    ) {
        return true;
    }

    const error =
        new Error(
            "You do not have permission to access administrative risk operations."
        );

    error.statusCode =
        HTTP_STATUS.FORBIDDEN;

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/* =============================================================================
 * Tenant assertion
 * ============================================================================= */

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
 * ServicesContext resolution
 * ============================================================================= */

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
 * Risk service resolution
 * ============================================================================= */

function resolveRiskService(
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
                    servicesContext.service ===
                    "function"
            ) {
                try {
                    const service =
                        servicesContext.service(
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
                    servicesContext.get ===
                    "function"
            ) {
                try {
                    const service =
                        servicesContext.get(
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
                servicesContext[name]
            ) {
                return servicesContext[name];
            }
        }
    }

    const locals =
        req?.app?.locals;

    if (
        locals
    ) {
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
 * Service method resolution
 * ============================================================================= */

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
 * Service invocation
 * ============================================================================= */

async function invokeService(
    req,
    operation,
    payload
) {
    const service =
        resolveRiskService(
            req
        );

    if (!service) {
        const error =
            new Error(
                "The administrative risk service is unavailable."
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
                `Administrative risk operation "${operation}" is not available.`
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
            `adminRisk.${operation}`,

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
                    `adminRisk.${operation}`,
                    {
                        request: req,

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
             * Preserve the local execution context when a compatibility
             * ServicesContext implementation does not support this signature.
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
            `adminRisk.${operation}`
        );
    }

    return method(
        payload,
        executionContext
    );
}

/* =============================================================================
 * Base request payload
 * ============================================================================= */

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
 * Common risk filters
 * ============================================================================= */

function buildRiskFilters(
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

        riskLevel:
            normalizeRiskLevel(
                query.riskLevel
            ),

        riskLevels:
            normalizeStringArray(
                query.riskLevels
            ),

        status:
            normalizeString(
                query.status
            ),

        category:
            normalizeString(
                query.category
            ),

        type:
            normalizeString(
                query.type
            ),

        source:
            normalizeString(
                query.source
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

        groupId:
            normalizeString(
                query.groupId
            ),

        branchId:
            normalizeString(
                query.branchId
            ),

        assignedTo:
            normalizeString(
                query.assignedTo
            ),

        acknowledged:
            normalizeBoolean(
                query.acknowledged
            ),

        resolved:
            normalizeBoolean(
                query.resolved
            ),

        from:
            normalizeString(
                query.from
            ),

        to:
            normalizeString(
                query.to
            )
    };
}

/* =============================================================================
 * Risk overview
 * ============================================================================= */

async function getRiskOverview(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskOverview",
        {
            filters:
                buildRiskFilters(
                    req
                )
        },
        "ADMIN_RISK_OVERVIEW_RETRIEVED"
    );
}

/* =============================================================================
 * Risk metrics
 * ============================================================================= */

async function getRiskMetrics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskMetrics",
        {
            filters:
                buildRiskFilters(
                    req
                )
        },
        "ADMIN_RISK_METRICS_RETRIEVED"
    );
}

/* =============================================================================
 * Risk profiles
 * ============================================================================= */

async function listRiskProfiles(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listRiskProfiles",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_RISK_PROFILES_RETRIEVED"
    );
}

async function getRiskProfile(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskProfile",
        {
            memberId:
                normalizeIdentifier(
                    req.params?.memberId ??
                    req.params?.userId ??
                    req.params?.id,
                    "memberId"
                )
        },
        "ADMIN_RISK_PROFILE_RETRIEVED"
    );
}

async function getMemberRisk(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMemberRisk",
        {
            memberId:
                normalizeIdentifier(
                    req.params?.memberId ??
                    req.params?.userId ??
                    req.params?.id,
                    "memberId"
                )
        },
        "ADMIN_MEMBER_RISK_RETRIEVED"
    );
}

/* =============================================================================
 * Risk assessment
 * ============================================================================= */

async function getRiskAssessment(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskAssessment",
        {
            assessmentId:
                normalizeIdentifier(
                    req.params?.assessmentId ??
                    req.params?.id,
                    "assessmentId"
                )
        },
        "ADMIN_RISK_ASSESSMENT_RETRIEVED"
    );
}

async function createRiskAssessment(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "createRiskAssessment",
        {
            input:
                req.body
        },
        "ADMIN_RISK_ASSESSMENT_CREATED",
        HTTP_STATUS.CREATED
    );
}

async function updateRiskAssessment(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "updateRiskAssessment",
        {
            assessmentId:
                normalizeIdentifier(
                    req.params?.assessmentId ??
                    req.params?.id,
                    "assessmentId"
                ),

            input:
                req.body
        },
        "ADMIN_RISK_ASSESSMENT_UPDATED"
    );
}

/* =============================================================================
 * Risk alerts
 * ============================================================================= */

async function listRiskAlerts(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listRiskAlerts",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_RISK_ALERTS_RETRIEVED"
    );
}

async function getRiskAlert(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskAlert",
        {
            alertId:
                normalizeIdentifier(
                    req.params?.alertId ??
                    req.params?.id,
                    "alertId"
                )
        },
        "ADMIN_RISK_ALERT_RETRIEVED"
    );
}

async function acknowledgeRiskAlert(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "acknowledgeRiskAlert",
        {
            alertId:
                normalizeIdentifier(
                    req.params?.alertId ??
                    req.params?.id,
                    "alertId"
                ),

            reason:
                normalizeString(
                    req.body?.reason
                )
        },
        "ADMIN_RISK_ALERT_ACKNOWLEDGED"
    );
}

async function resolveRiskAlert(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "resolveRiskAlert",
        {
            alertId:
                normalizeIdentifier(
                    req.params?.alertId ??
                    req.params?.id,
                    "alertId"
                ),

            resolution:
                normalizeString(
                    req.body?.resolution
                ),

            reason:
                normalizeString(
                    req.body?.reason
                )
        },
        "ADMIN_RISK_ALERT_RESOLVED"
    );
}

async function dismissRiskAlert(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "dismissRiskAlert",
        {
            alertId:
                normalizeIdentifier(
                    req.params?.alertId ??
                    req.params?.id,
                    "alertId"
                ),

            reason:
                normalizeString(
                    req.body?.reason
                )
        },
        "ADMIN_RISK_ALERT_DISMISSED"
    );
}

/* =============================================================================
 * High-risk members
 * ============================================================================= */

async function listHighRiskMembers(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listHighRiskMembers",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_HIGH_RISK_MEMBERS_RETRIEVED"
    );
}

/* =============================================================================
 * High-risk loans
 * ============================================================================= */

async function listHighRiskLoans(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listHighRiskLoans",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_HIGH_RISK_LOANS_RETRIEVED"
    );
}

/* =============================================================================
 * Loan risk
 * ============================================================================= */

async function getLoanRisk(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanRisk",
        {
            loanId:
                normalizeIdentifier(
                    req.params?.loanId ??
                    req.params?.id,
                    "loanId"
                )
        },
        "ADMIN_LOAN_RISK_RETRIEVED"
    );
}

/* =============================================================================
 * Portfolio risk
 * ============================================================================= */

async function getPortfolioRisk(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getPortfolioRisk",
        {
            filters:
                buildRiskFilters(
                    req
                )
        },
        "ADMIN_PORTFOLIO_RISK_RETRIEVED"
    );
}

/* =============================================================================
 * Fraud indicators
 * ============================================================================= */

async function getFraudIndicators(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFraudIndicators",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_FRAUD_INDICATORS_RETRIEVED"
    );
}

/* =============================================================================
 * AML indicators
 * ============================================================================= */

async function getAMLIndicators(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAMLIndicators",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_AML_INDICATORS_RETRIEVED"
    );
}

/* =============================================================================
 * KYC exceptions
 * ============================================================================= */

async function getKYCExceptions(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getKYCExceptions",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_KYC_EXCEPTIONS_RETRIEVED"
    );
}

/* =============================================================================
 * Risk events
 * ============================================================================= */

async function listRiskEvents(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listRiskEvents",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_RISK_EVENTS_RETRIEVED"
    );
}

async function getRiskEvent(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskEvent",
        {
            eventId:
                normalizeIdentifier(
                    req.params?.eventId ??
                    req.params?.id,
                    "eventId"
                )
        },
        "ADMIN_RISK_EVENT_RETRIEVED"
    );
}

async function createRiskEvent(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "createRiskEvent",
        {
            input:
                req.body
        },
        "ADMIN_RISK_EVENT_CREATED",
        HTTP_STATUS.CREATED
    );
}

/* =============================================================================
 * Risk configuration
 * ============================================================================= */

async function getRiskConfiguration(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskConfiguration",
        {},
        "ADMIN_RISK_CONFIGURATION_RETRIEVED"
    );
}

async function updateRiskConfiguration(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "updateRiskConfiguration",
        {
            input:
                req.body
        },
        "ADMIN_RISK_CONFIGURATION_UPDATED"
    );
}

/* =============================================================================
 * Risk trends
 * ============================================================================= */

async function getRiskTrends(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskTrends",
        {
            filters:
                buildRiskFilters(
                    req
                ),

            granularity:
                normalizeString(
                    req.query?.granularity,
                    "day"
                )
        },
        "ADMIN_RISK_TRENDS_RETRIEVED"
    );
}

/* =============================================================================
 * Risk distribution
 * ============================================================================= */

async function getRiskDistribution(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskDistribution",
        {
            filters:
                buildRiskFilters(
                    req
                )
        },
        "ADMIN_RISK_DISTRIBUTION_RETRIEVED"
    );
}

/* =============================================================================
 * Risk recommendations
 * ============================================================================= */

async function getRiskRecommendations(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskRecommendations",
        {
            memberId:
                normalizeString(
                    req.params?.memberId ??
                    req.query?.memberId
                ),

            loanId:
                normalizeString(
                    req.params?.loanId ??
                    req.query?.loanId
                ),

            riskLevel:
                normalizeRiskLevel(
                    req.query?.riskLevel
                )
        },
        "ADMIN_RISK_RECOMMENDATIONS_RETRIEVED"
    );
}

/* =============================================================================
 * Generic read operation
 * ============================================================================= */

async function executeReadOperation(
    req,
    res,
    operation,
    input,
    successCode
) {
    try {
        assertRiskAccess(
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
 * Generic write operation
 * ============================================================================= */

async function executeWriteOperation(
    req,
    res,
    operation,
    input,
    successCode,
    statusCode = HTTP_STATUS.OK
) {
    try {
        assertRiskAccess(
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
 * Success response
 * ============================================================================= */

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
                "ADMIN_RISK_SUCCESS",

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
 * Error normalization
 * ============================================================================= */

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
                    ? "The risk operation could not be completed."
                    : (
                        error?.message ||
                        "The administrative risk request is invalid."
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
                    "The administrative risk request is invalid."
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
                    "You do not have permission to perform this risk operation."
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
                    "The requested resource is outside the authorized tenant."
            };

        case ERROR_CODES.RESOURCE_NOT_FOUND:
            return {
                statusCode:
                    HTTP_STATUS.NOT_FOUND,

                code:
                    ERROR_CODES.RESOURCE_NOT_FOUND,

                message:
                    "The requested risk resource was not found."
            };

        case ERROR_CODES.CONFLICT:
            return {
                statusCode:
                    HTTP_STATUS.CONFLICT,

                code:
                    ERROR_CODES.CONFLICT,

                message:
                    error.message ||
                    "The risk operation conflicts with the current state."
            };

        case ERROR_CODES.SERVICE_UNAVAILABLE:
            return {
                statusCode:
                    HTTP_STATUS.SERVICE_UNAVAILABLE,

                code:
                    ERROR_CODES.SERVICE_UNAVAILABLE,

                message:
                    "The risk service is temporarily unavailable."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The risk operation could not be completed."
            };
    }
}

/* =============================================================================
 * HTTP status -> error code
 * ============================================================================= */

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
 * Secure logging
 * ============================================================================= */

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
                "Unknown administrative risk error"
        }
    };

    /*
     * Never log:
     *
     * - req.body
     * - credentials
     * - tokens
     * - complete KYC records
     * - AML payloads
     * - financial account details
     * - private customer information
     */

    if (
        logger &&
        typeof
            logger.error ===
            "function"
    ) {
        try {
            logger.error(
                metadata
            );

            return;
        } catch {
            // Logging must never break the API response.
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
 * Error response
 * ============================================================================= */

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
 * Async Express handler adapter
 * ============================================================================= */

function createHandler(
    handler
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "Admin risk handler must be a function."
        );
    }

    return function adminRiskHandler(
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
 * Controller metadata
 * ============================================================================= */

function getControllerMetadata() {
    return Object.freeze({
        name:
            CONTROLLER_NAME,

        application:
            APPLICATION_NAME,

        domain:
            "risk",

        resource:
            "administrative-risk",

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

        financialPosting:
            false,

        riskEngineOwnedByService:
            true,

        supportedResources: [
            "risk-overview",
            "risk-metrics",
            "risk-profiles",
            "risk-assessments",
            "risk-alerts",
            "high-risk-members",
            "high-risk-loans",
            "loan-risk",
            "portfolio-risk",
            "fraud-indicators",
            "aml-indicators",
            "kyc-exceptions",
            "risk-events",
            "risk-configuration",
            "risk-trends",
            "risk-distribution",
            "risk-recommendations"
        ],

        pagination: {
            defaultPage:
                DEFAULT_PAGE,

            defaultPageSize:
                DEFAULT_PAGE_SIZE,

            maxPageSize:
                MAX_PAGE_SIZE
        }
    });
}

/* =============================================================================
 * Public controller
 * ============================================================================= */

const controller = {
    /* -------------------------------------------------------------------------
     * Overview / metrics
     * ---------------------------------------------------------------------- */

    getRiskOverview:
        createHandler(
            getRiskOverview
        ),

    getRiskDashboard:
        createHandler(
            getRiskOverview
        ),

    getRiskMetrics:
        createHandler(
            getRiskMetrics
        ),

    getMetrics:
        createHandler(
            getRiskMetrics
        ),

    /* -------------------------------------------------------------------------
     * Risk profiles
     * ---------------------------------------------------------------------- */

    listRiskProfiles:
        createHandler(
            listRiskProfiles
        ),

    getRiskProfiles:
        createHandler(
            listRiskProfiles
        ),

    getRiskProfile:
        createHandler(
            getRiskProfile
        ),

    getMemberRisk:
        createHandler(
            getMemberRisk
        ),

    getMemberRiskScore:
        createHandler(
            getMemberRisk
        ),

    /* -------------------------------------------------------------------------
     * Assessments
     * ---------------------------------------------------------------------- */

    getRiskAssessment:
        createHandler(
            getRiskAssessment
        ),

    createRiskAssessment:
        createHandler(
            createRiskAssessment
        ),

    assessRisk:
        createHandler(
            createRiskAssessment
        ),

    updateRiskAssessment:
        createHandler(
            updateRiskAssessment
        ),

    reassessRisk:
        createHandler(
            updateRiskAssessment
        ),

    /* -------------------------------------------------------------------------
     * Alerts
     * ---------------------------------------------------------------------- */

    listRiskAlerts:
        createHandler(
            listRiskAlerts
        ),

    getRiskAlerts:
        createHandler(
            listRiskAlerts
        ),

    getRiskAlert:
        createHandler(
            getRiskAlert
        ),

    acknowledgeRiskAlert:
        createHandler(
            acknowledgeRiskAlert
        ),

    acknowledgeAlert:
        createHandler(
            acknowledgeRiskAlert
        ),

    resolveRiskAlert:
        createHandler(
            resolveRiskAlert
        ),

    resolveAlert:
        createHandler(
            resolveRiskAlert
        ),

    dismissRiskAlert:
        createHandler(
            dismissRiskAlert
        ),

    dismissAlert:
        createHandler(
            dismissRiskAlert
        ),

    /* -------------------------------------------------------------------------
     * High-risk populations
     * ---------------------------------------------------------------------- */

    listHighRiskMembers:
        createHandler(
            listHighRiskMembers
        ),

    getHighRiskMembers:
        createHandler(
            listHighRiskMembers
        ),

    listHighRiskLoans:
        createHandler(
            listHighRiskLoans
        ),

    getHighRiskLoans:
        createHandler(
            listHighRiskLoans
        ),

    /* -------------------------------------------------------------------------
     * Loan / portfolio risk
     * ---------------------------------------------------------------------- */

    getLoanRisk:
        createHandler(
            getLoanRisk
        ),

    getLoanRiskProfile:
        createHandler(
            getLoanRisk
        ),

    getPortfolioRisk:
        createHandler(
            getPortfolioRisk
        ),

    getLoanPortfolioRisk:
        createHandler(
            getPortfolioRisk
        ),

    /* -------------------------------------------------------------------------
     * Fraud / AML / KYC
     * ---------------------------------------------------------------------- */

    getFraudIndicators:
        createHandler(
            getFraudIndicators
        ),

    getFraudRisk:
        createHandler(
            getFraudIndicators
        ),

    getAMLIndicators:
        createHandler(
            getAMLIndicators
        ),

    getAmlIndicators:
        createHandler(
            getAMLIndicators
        ),

    getComplianceIndicators:
        createHandler(
            getAMLIndicators
        ),

    getKYCExceptions:
        createHandler(
            getKYCExceptions
        ),

    getKycExceptions:
        createHandler(
            getKYCExceptions
        ),

    listKYCExceptions:
        createHandler(
            getKYCExceptions
        ),

    listKycExceptions:
        createHandler(
            getKYCExceptions
        ),

    /* -------------------------------------------------------------------------
     * Risk events
     * ---------------------------------------------------------------------- */

    listRiskEvents:
        createHandler(
            listRiskEvents
        ),

    getRiskEvents:
        createHandler(
            listRiskEvents
        ),

    getRiskEvent:
        createHandler(
            getRiskEvent
        ),

    createRiskEvent:
        createHandler(
            createRiskEvent
        ),

    recordRiskEvent:
        createHandler(
            createRiskEvent
        ),

    /* -------------------------------------------------------------------------
     * Risk configuration
     * ---------------------------------------------------------------------- */

    getRiskConfiguration:
        createHandler(
            getRiskConfiguration
        ),

    getRiskSettings:
        createHandler(
            getRiskConfiguration
        ),

    getRiskRules:
        createHandler(
            getRiskConfiguration
        ),

    updateRiskConfiguration:
        createHandler(
            updateRiskConfiguration
        ),

    updateRiskSettings:
        createHandler(
            updateRiskConfiguration
        ),

    updateRiskRules:
        createHandler(
            updateRiskConfiguration
        ),

    /* -------------------------------------------------------------------------
     * Analytics
     * ---------------------------------------------------------------------- */

    getRiskTrends:
        createHandler(
            getRiskTrends
        ),

    getRiskTrend:
        createHandler(
            getRiskTrends
        ),

    getRiskDistribution:
        createHandler(
            getRiskDistribution
        ),

    getRiskScoreDistribution:
        createHandler(
            getRiskDistribution
        ),

    getRiskRecommendations:
        createHandler(
            getRiskRecommendations
        ),

    getRecommendations:
        createHandler(
            getRiskRecommendations
        ),

    /* -------------------------------------------------------------------------
     * Diagnostics
     * ---------------------------------------------------------------------- */

    getControllerMetadata
};

module.exports =
    Object.freeze(
        controller
    );