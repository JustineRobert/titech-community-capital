"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Audit Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminAudit.controller.js
 *
 * Purpose:
 *   HTTP/application boundary for privileged TITech administrative audit
 *   operations.
 *
 * Architectural position:
 *
 *   HTTP
 *     |
 *     v
 *   Authentication
 *     |
 *     v
 *   Authorization / RBAC
 *     |
 *     v
 *   Tenant Context
 *     |
 *     v
 *   adminAudit.controller.js
 *     |
 *     v
 *   adminAudit.service.js
 *     |
 *     +--> Audit Repository
 *     +--> Audit Query Services
 *     +--> Security Events
 *     +--> Administrative Events
 *     +--> Financial Events
 *     +--> Authentication Events
 *     +--> Compliance Events
 *     +--> System Events
 *
 * =============================================================================
 *
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * 1. This controller is a THIN HTTP boundary.
 * 2. No direct database access.
 * 3. No direct Mongoose model access.
 * 4. No business logic.
 * 5. No authorization bypass.
 * 6. Tenant isolation is mandatory.
 * 7. Audit records are immutable from the controller.
 * 8. Sensitive credentials/tokens must never be returned.
 * 9. Internal exceptions must not leak stack traces.
 * 10. All operations carry request/correlation/actor context.
 * 11. Audit querying is read-only.
 * 12. Audit creation is delegated to the canonical audit service.
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * Audit is a security/compliance boundary.
 *
 * The controller MUST NOT expose:
 *
 *   - passwords
 *   - refresh tokens
 *   - access tokens
 *   - OTP secrets
 *   - API secrets
 *   - encryption keys
 *   - payment credentials
 *   - internal stack traces
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminAudit.controller";

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
        "ADMIN_AUDIT_INVALID_REQUEST",

    VALIDATION_FAILED:
        "ADMIN_AUDIT_VALIDATION_FAILED",

    UNAUTHENTICATED:
        "ADMIN_AUDIT_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_AUDIT_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_AUDIT_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_AUDIT_TENANT_MISMATCH",

    AUDIT_NOT_FOUND:
        "ADMIN_AUDIT_NOT_FOUND",

    AUDIT_IMMUTABLE:
        "ADMIN_AUDIT_IMMUTABLE",

    SERVICE_UNAVAILABLE:
        "ADMIN_AUDIT_SERVICE_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_AUDIT_INTERNAL_ERROR"
});

/* =============================================================================
 * SERVICE RESOLUTION
 * =============================================================================
 */

const SERVICE_NAMES = Object.freeze([
    "adminAuditService",
    "auditService",
    "administrativeAuditService"
]);

/* =============================================================================
 * SERVICE METHOD ALIASES
 * =============================================================================
 *
 * The controller exposes canonical operations while remaining compatible with
 * common naming conventions that may already exist in the service layer.
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({
    listAuditLogs: [
        "listAuditLogs",
        "getAuditLogs",
        "findAuditLogs",
        "searchAuditLogs"
    ],

    getAuditLog: [
        "getAuditLog",
        "getAuditLogById",
        "findAuditLogById"
    ],

    searchAuditLogs: [
        "searchAuditLogs",
        "search",
        "queryAuditLogs"
    ],

    getAuditSummary: [
        "getAuditSummary",
        "getSummary",
        "summarizeAuditLogs"
    ],

    getAuditStatistics: [
        "getAuditStatistics",
        "getStatistics",
        "getAuditStats"
    ],

    getAuditTimeline: [
        "getAuditTimeline",
        "getTimeline",
        "getAuditEventTimeline"
    ],

    getSecurityAuditLogs: [
        "getSecurityAuditLogs",
        "getSecurityLogs",
        "listSecurityAuditLogs"
    ],

    getAuthenticationAuditLogs: [
        "getAuthenticationAuditLogs",
        "getAuthAuditLogs",
        "listAuthenticationAuditLogs"
    ],

    getAuthorizationAuditLogs: [
        "getAuthorizationAuditLogs",
        "getAccessAuditLogs",
        "listAuthorizationAuditLogs"
    ],

    getAdministrativeAuditLogs: [
        "getAdministrativeAuditLogs",
        "getAdminAuditLogs",
        "listAdministrativeAuditLogs"
    ],

    getFinancialAuditLogs: [
        "getFinancialAuditLogs",
        "getFinancialLogs",
        "listFinancialAuditLogs"
    ],

    getLoanAuditLogs: [
        "getLoanAuditLogs",
        "getLoanLogs",
        "listLoanAuditLogs"
    ],

    getContributionAuditLogs: [
        "getContributionAuditLogs",
        "getContributionLogs",
        "listContributionAuditLogs"
    ],

    getSavingsAuditLogs: [
        "getSavingsAuditLogs",
        "getSavingsLogs",
        "listSavingsAuditLogs"
    ],

    getWithdrawalAuditLogs: [
        "getWithdrawalAuditLogs",
        "getWithdrawalLogs",
        "listWithdrawalAuditLogs"
    ],

    getTransactionAuditLogs: [
        "getTransactionAuditLogs",
        "getTransactionLogs",
        "listTransactionAuditLogs"
    ],

    getMobileMoneyAuditLogs: [
        "getMobileMoneyAuditLogs",
        "getMobileMoneyLogs",
        "listMobileMoneyAuditLogs"
    ],

    getKycAuditLogs: [
        "getKycAuditLogs",
        "getKYCLogs",
        "listKycAuditLogs"
    ],

    getAmlAuditLogs: [
        "getAmlAuditLogs",
        "getAMLLogs",
        "listAmlAuditLogs"
    ],

    getComplianceAuditLogs: [
        "getComplianceAuditLogs",
        "getComplianceLogs",
        "listComplianceAuditLogs"
    ],

    getRiskAuditLogs: [
        "getRiskAuditLogs",
        "getRiskLogs",
        "listRiskAuditLogs"
    ],

    getUserAuditLogs: [
        "getUserAuditLogs",
        "getUserLogs",
        "listUserAuditLogs"
    ],

    getTenantAuditLogs: [
        "getTenantAuditLogs",
        "getTenantLogs",
        "listTenantAuditLogs"
    ],

    getSystemAuditLogs: [
        "getSystemAuditLogs",
        "getSystemLogs",
        "listSystemAuditLogs"
    ],

    getApiAuditLogs: [
        "getApiAuditLogs",
        "getAPILogs",
        "listApiAuditLogs"
    ],

    getDataAccessAuditLogs: [
        "getDataAccessAuditLogs",
        "getDataAccessLogs",
        "listDataAccessAuditLogs"
    ],

    getExportAuditLogs: [
        "getExportAuditLogs",
        "getExportLogs",
        "listExportAuditLogs"
    ],

    getAuditLogByRequestId: [
        "getAuditLogByRequestId",
        "findByRequestId",
        "getLogsByRequestId"
    ],

    getAuditLogsByCorrelationId: [
        "getAuditLogsByCorrelationId",
        "findByCorrelationId",
        "getLogsByCorrelationId"
    ],

    getAuditLogsByActor: [
        "getAuditLogsByActor",
        "findByActor",
        "getLogsByActor"
    ],

    getAuditLogsByResource: [
        "getAuditLogsByResource",
        "findByResource",
        "getLogsByResource"
    ],

    getAuditLogsByEvent: [
        "getAuditLogsByEvent",
        "findByEvent",
        "getLogsByEvent"
    ],

    createAuditEvent: [
        "createAuditEvent",
        "recordAuditEvent",
        "record"
    ],

    exportAuditLogs: [
        "exportAuditLogs",
        "generateAuditExport",
        "createAuditExport"
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
        "event",
        "action",
        "actor",
        "actorId",
        "resource",
        "resourceType",
        "severity",
        "status"
    ]);

const ALLOWED_SORT_DIRECTIONS =
    Object.freeze([
        "asc",
        "desc"
    ]);

/* =============================================================================
 * EVENT CATEGORIES
 * =============================================================================
 */

const AUDIT_CATEGORIES =
    Object.freeze([
        "authentication",
        "authorization",
        "administrative",
        "financial",
        "loan",
        "contribution",
        "savings",
        "withdrawal",
        "transaction",
        "mobile_money",
        "kyc",
        "aml",
        "compliance",
        "risk",
        "user",
        "tenant",
        "system",
        "api",
        "data_access",
        "export",
        "security"
    ]);

/* =============================================================================
 * SEVERITY
 * =============================================================================
 */

const AUDIT_SEVERITIES =
    Object.freeze([
        "debug",
        "info",
        "notice",
        "warning",
        "error",
        "critical"
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

function normalizeCategory(
    value
) {
    const normalized =
        normalizeString(
            value
        )?.toLowerCase();

    return AUDIT_CATEGORIES.includes(
        normalized
    )
        ? normalized
        : null;
}

function normalizeSeverity(
    value
) {
    const normalized =
        normalizeString(
            value
        )?.toLowerCase();

    return AUDIT_SEVERITIES.includes(
        normalized
    )
        ? normalized
        : null;
}

function normalizeSort(
    query
) {
    const requestedField =
        normalizeString(
            query.sortBy,
            DEFAULT_SORT_BY
        );

    const sortBy =
        ALLOWED_SORT_FIELDS.includes(
            requestedField
        )
            ? requestedField
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
 * TENANT CONTEXT
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
 * ACTOR
 * =============================================================================
 */

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

/* =============================================================================
 * AUTHORIZATION
 * =============================================================================
 */

const ADMIN_AUDIT_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "audit_admin",
        "audit_manager",
        "security_admin",
        "compliance_admin",
        "risk_admin",
        "tenant_admin"
    ]);

const AUDIT_PERMISSIONS =
    Object.freeze([
        "audit.view",
        "audit.read",
        "audit.manage",
        "audit.search",
        "audit.export",
        "audit.create",
        "audit.logs.read",
        "audit.logs.export",
        "security.audit",
        "security.audit.view",
        "compliance.audit",
        "admin.audit"
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

function hasAuditRole(
    principal
) {
    const roles =
        resolveRoles(
            principal
        );

    return roles.some(
        role =>
            ADMIN_AUDIT_ROLES.includes(
                role
            )
    );
}

function hasAuditPermission(
    principal
) {
    const permissions =
        resolvePermissions(
            principal
        );

    return permissions.some(
        permission =>
            AUDIT_PERMISSIONS.includes(
                permission
            ) ||
            permission === "*" ||
            permission === "admin.*"
    );
}

function assertAuditAccess(
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
     * Route-level authorization should remain the primary mechanism.
     *
     * This is an additional defensive boundary so that accidentally exposed
     * administrative audit endpoints do not become data-disclosure paths.
     */
    if (
        hasAuditRole(
            principal
        ) ||
        hasAuditPermission(
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
            "You do not have permission to access administrative audit data."
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
 * AUDIT SERVICE
 * =============================================================================
 */

function resolveAuditService(
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
                    // Continue service resolution.
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
                    // Continue service resolution.
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
                    // Continue service resolution.
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
        resolveAuditService(
            req
        );

    if (!service) {
        const error =
            new Error(
                "The administrative audit service is unavailable."
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
                `Administrative audit operation "${operation}" is not available.`
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
            `adminAudit.${operation}`,

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
            `adminAudit.${operation}`
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
 * AUDIT FILTERS
 * =============================================================================
 */

function buildAuditFilters(
    req
) {
    const query =
        req.query ||
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

        event:
            normalizeString(
                query.event
            ),

        events:
            normalizeStringArray(
                query.events
            ),

        action:
            normalizeString(
                query.action
            ),

        actions:
            normalizeStringArray(
                query.actions
            ),

        category:
            normalizeCategory(
                query.category
            ),

        categories:
            normalizeStringArray(
                query.categories
            ),

        severity:
            normalizeSeverity(
                query.severity
            ),

        severities:
            normalizeStringArray(
                query.severities
            ),

        status:
            normalizeString(
                query.status
            ),

        statuses:
            normalizeStringArray(
                query.statuses
            ),

        outcome:
            normalizeString(
                query.outcome
            ),

        actorId:
            normalizeString(
                query.actorId
            ),

        userId:
            normalizeString(
                query.userId
            ),

        resourceId:
            normalizeString(
                query.resourceId
            ),

        resourceType:
            normalizeString(
                query.resourceType
            ),

        resource:
            normalizeString(
                query.resource
            ),

        requestId:
            normalizeString(
                query.requestId
            ),

        correlationId:
            normalizeString(
                query.correlationId
            ),

        sessionId:
            normalizeString(
                query.sessionId
            ),

        deviceId:
            normalizeString(
                query.deviceId
            ),

        ipAddress:
            normalizeString(
                query.ipAddress
            ),

        provider:
            normalizeString(
                query.provider
            ),

        channel:
            normalizeString(
                query.channel
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

        includeSystem:
            normalizeBoolean(
                query.includeSystem,
                true
            ),

        includeSensitive:
            normalizeBoolean(
                query.includeSensitive,
                false
            ),

        includeMetadata:
            normalizeBoolean(
                query.includeMetadata,
                false
            ),

        ...sort
    };
}

/* =============================================================================
 * AUDIT LOG QUERY OPERATIONS
 * =============================================================================
 */

async function listAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listAuditLogs",
        {
            filters:
                buildAuditFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuditLog(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLog",
        {
            auditLogId:
                normalizeIdentifier(
                    req.params?.auditLogId ??
                    req.params?.id,
                    "auditLogId"
                )
        },
        "ADMIN_AUDIT_LOG_RETRIEVED"
    );
}

async function searchAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "searchAuditLogs",
        {
            filters:
                buildAuditFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_AUDIT_SEARCH_COMPLETED"
    );
}

async function getAuditSummary(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditSummary",
        {
            filters:
                buildAuditFilters(
                    req
                )
        },
        "ADMIN_AUDIT_SUMMARY_RETRIEVED"
    );
}

async function getAuditStatistics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditStatistics",
        {
            filters:
                buildAuditFilters(
                    req
                )
        },
        "ADMIN_AUDIT_STATISTICS_RETRIEVED"
    );
}

async function getAuditTimeline(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditTimeline",
        {
            filters:
                buildAuditFilters(
                    req
                )
        },
        "ADMIN_AUDIT_TIMELINE_RETRIEVED"
    );
}

/* =============================================================================
 * SECURITY / AUTHENTICATION
 * =============================================================================
 */

async function getSecurityAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSecurityAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_SECURITY_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuthenticationAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuthenticationAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_AUTHENTICATION_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuthorizationAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuthorizationAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_AUTHORIZATION_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * ADMINISTRATIVE
 * =============================================================================
 */

async function getAdministrativeAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAdministrativeAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_ADMINISTRATIVE_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * FINANCIAL
 * =============================================================================
 */

async function getFinancialAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getFinancialAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_FINANCIAL_AUDIT_LOGS_RETRIEVED"
    );
}

async function getLoanAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLoanAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_LOAN_AUDIT_LOGS_RETRIEVED"
    );
}

async function getContributionAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getContributionAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_CONTRIBUTION_AUDIT_LOGS_RETRIEVED"
    );
}

async function getSavingsAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSavingsAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_SAVINGS_AUDIT_LOGS_RETRIEVED"
    );
}

async function getWithdrawalAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getWithdrawalAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_WITHDRAWAL_AUDIT_LOGS_RETRIEVED"
    );
}

async function getTransactionAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTransactionAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_TRANSACTION_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * MOBILE MONEY
 * =============================================================================
 */

async function getMobileMoneyAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMobileMoneyAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_MOBILE_MONEY_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * KYC / AML / COMPLIANCE
 * =============================================================================
 */

async function getKycAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getKycAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_KYC_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAmlAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAmlAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_AML_AUDIT_LOGS_RETRIEVED"
    );
}

async function getComplianceAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getComplianceAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_COMPLIANCE_AUDIT_LOGS_RETRIEVED"
    );
}

async function getRiskAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRiskAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_RISK_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * USER / TENANT / SYSTEM
 * =============================================================================
 */

async function getUserAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getUserAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_USER_AUDIT_LOGS_RETRIEVED"
    );
}

async function getTenantAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getTenantAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_TENANT_AUDIT_LOGS_RETRIEVED"
    );
}

async function getSystemAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_SYSTEM_AUDIT_LOGS_RETRIEVED"
    );
}

async function getApiAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getApiAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_API_AUDIT_LOGS_RETRIEVED"
    );
}

async function getDataAccessAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDataAccessAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_DATA_ACCESS_AUDIT_LOGS_RETRIEVED"
    );
}

async function getExportAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getExportAuditLogs",
        buildSpecializedQueryPayload(
            req
        ),
        "ADMIN_EXPORT_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * CORRELATION QUERIES
 * =============================================================================
 */

async function getAuditLogByRequestId(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLogByRequestId",
        {
            requestId:
                normalizeIdentifier(
                    req.params?.requestId ??
                    req.query?.requestId,
                    "requestId"
                ),

            filters:
                buildAuditFilters(
                    req
                )
        },
        "ADMIN_REQUEST_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuditLogsByCorrelationId(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLogsByCorrelationId",
        {
            correlationId:
                normalizeIdentifier(
                    req.params?.correlationId ??
                    req.query?.correlationId,
                    "correlationId"
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_CORRELATION_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuditLogsByActor(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLogsByActor",
        {
            actorId:
                normalizeIdentifier(
                    req.params?.actorId ??
                    req.query?.actorId,
                    "actorId"
                ),

            filters:
                buildAuditFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_ACTOR_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuditLogsByResource(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLogsByResource",
        {
            resourceId:
                normalizeIdentifier(
                    req.params?.resourceId ??
                    req.query?.resourceId,
                    "resourceId"
                ),

            resourceType:
                normalizeString(
                    req.params?.resourceType ??
                    req.query?.resourceType
                ),

            filters:
                buildAuditFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_RESOURCE_AUDIT_LOGS_RETRIEVED"
    );
}

async function getAuditLogsByEvent(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAuditLogsByEvent",
        {
            event:
                normalizeIdentifier(
                    req.params?.event ??
                    req.query?.event,
                    "event"
                ),

            filters:
                buildAuditFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        "ADMIN_EVENT_AUDIT_LOGS_RETRIEVED"
    );
}

/* =============================================================================
 * AUDIT EVENT CREATION
 * =============================================================================
 *
 * Normally audit events should be produced automatically by application
 * services/middleware.
 *
 * This endpoint exists only for explicitly authorized administrative/system
 * integrations that have a legitimate reason to record an event through the
 * audit service.
 *
 * The controller never accepts tenantId as authoritative input.
 * =============================================================================
 */

async function createAuditEvent(
    req,
    res
) {
    try {
        assertAuditAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const input =
            req.body &&
            typeof req.body ===
                "object"
                ? {
                    ...req.body
                }
                : {};

        /*
         * Never permit clients to override security context.
         */
        delete input.tenantId;
        delete input.actorId;
        delete input.actor;
        delete input.requestId;
        delete input.correlationId;
        delete input.deviceId;

        const result =
            await invokeService(
                req,
                "createAuditEvent",
                {
                    ...base,

                    input
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_AUDIT_EVENT_RECORDED",

                tenantId:
                    base.tenantId
            },
            HTTP_STATUS.CREATED
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            "createAuditEvent"
        );
    }
}

/* =============================================================================
 * EXPORT
 * =============================================================================
 */

async function exportAuditLogs(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "exportAuditLogs",
        {
            filters:
                buildAuditFilters(
                    req
                ),

            input:
                sanitizeExportInput(
                    req.body
                )
        },
        "ADMIN_AUDIT_EXPORT_GENERATED",
        HTTP_STATUS.ACCEPTED
    );
}

/* =============================================================================
 * SPECIALIZED QUERY PAYLOAD
 * =============================================================================
 */

function buildSpecializedQueryPayload(
    req
) {
    return {
        filters:
            buildAuditFilters(
                req
            ),

        pagination:
            normalizePagination(
                req.query ||
                    {}
            )
    };
}

/* =============================================================================
 * EXPORT INPUT SANITIZATION
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
        return {};
    }

    /*
     * Explicit allow-list prevents accidental propagation of security context
     * or authorization fields from the request body.
     */
    return {
        format:
            normalizeString(
                body.format,
                "csv"
            ),

        fields:
            normalizeStringArray(
                body.fields
            ),

        filename:
            normalizeString(
                body.filename
            ),

        includeMetadata:
            normalizeBoolean(
                body.includeMetadata,
                false
            )
    };
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
        assertAuditAccess(
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
        assertAuditAccess(
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
                "ADMIN_AUDIT_SUCCESS",

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
                    ? "The audit operation could not be completed."
                    : (
                        error?.message ||
                        "The administrative audit request is invalid."
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
                    "The administrative audit request is invalid."
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
                    "You do not have permission to access audit data."
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
                    "The requested audit resource is outside the authorized tenant."
            };

        case ERROR_CODES.AUDIT_NOT_FOUND:
            return {
                statusCode:
                    HTTP_STATUS.NOT_FOUND,

                code:
                    ERROR_CODES.AUDIT_NOT_FOUND,

                message:
                    "The requested audit record was not found."
            };

        case ERROR_CODES.AUDIT_IMMUTABLE:
            return {
                statusCode:
                    HTTP_STATUS.CONFLICT,

                code:
                    ERROR_CODES.AUDIT_IMMUTABLE,

                message:
                    "Audit records are immutable."
            };

        case ERROR_CODES.SERVICE_UNAVAILABLE:
            return {
                statusCode:
                    HTTP_STATUS.SERVICE_UNAVAILABLE,

                code:
                    ERROR_CODES.SERVICE_UNAVAILABLE,

                message:
                    "The audit service is temporarily unavailable."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The audit operation could not be completed."
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
            return ERROR_CODES.AUDIT_NOT_FOUND;

        case HTTP_STATUS.CONFLICT:
            return ERROR_CODES.AUDIT_IMMUTABLE;

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
                "Unknown administrative audit error"
        },

        actorRole:
            resolveRoles(
                principal
            )
    };

    /*
     * NEVER log:
     *
     * - request body
     * - authorization headers
     * - access tokens
     * - refresh tokens
     * - OTPs
     * - passwords
     * - KYC documents
     * - AML payloads
     * - payment credentials
     * - complete audit records
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
            // Logging must never break the response.
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
            "Admin audit handler must be a function."
        );
    }

    return function adminAuditHandler(
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
            "audit",

        resource:
            "administrative-audit",

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

        immutableAuditRecords:
            true,

        financialMutation:
            false,

        supportedCategories:
            AUDIT_CATEGORIES,

        supportedSeverities:
            AUDIT_SEVERITIES,

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
     * Core audit log operations
     * ---------------------------------------------------------------------- */

    listAuditLogs:
        createHandler(
            listAuditLogs
        ),

    getAuditLogs:
        createHandler(
            listAuditLogs
        ),

    findAuditLogs:
        createHandler(
            listAuditLogs
        ),

    getAuditLog:
        createHandler(
            getAuditLog
        ),

    getAuditLogById:
        createHandler(
            getAuditLog
        ),

    searchAuditLogs:
        createHandler(
            searchAuditLogs
        ),

    queryAuditLogs:
        createHandler(
            searchAuditLogs
        ),

    getAuditSummary:
        createHandler(
            getAuditSummary
        ),

    getSummary:
        createHandler(
            getAuditSummary
        ),

    getAuditStatistics:
        createHandler(
            getAuditStatistics
        ),

    getAuditStats:
        createHandler(
            getAuditStatistics
        ),

    getAuditTimeline:
        createHandler(
            getAuditTimeline
        ),

    getTimeline:
        createHandler(
            getAuditTimeline
        ),

    /* -------------------------------------------------------------------------
     * Security / authentication / authorization
     * ---------------------------------------------------------------------- */

    getSecurityAuditLogs:
        createHandler(
            getSecurityAuditLogs
        ),

    getSecurityLogs:
        createHandler(
            getSecurityAuditLogs
        ),

    getAuthenticationAuditLogs:
        createHandler(
            getAuthenticationAuditLogs
        ),

    getAuthAuditLogs:
        createHandler(
            getAuthenticationAuditLogs
        ),

    getAuthorizationAuditLogs:
        createHandler(
            getAuthorizationAuditLogs
        ),

    getAccessAuditLogs:
        createHandler(
            getAuthorizationAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * Administrative
     * ---------------------------------------------------------------------- */

    getAdministrativeAuditLogs:
        createHandler(
            getAdministrativeAuditLogs
        ),

    getAdminAuditLogs:
        createHandler(
            getAdministrativeAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * Financial
     * ---------------------------------------------------------------------- */

    getFinancialAuditLogs:
        createHandler(
            getFinancialAuditLogs
        ),

    getFinancialLogs:
        createHandler(
            getFinancialAuditLogs
        ),

    getLoanAuditLogs:
        createHandler(
            getLoanAuditLogs
        ),

    getLoanLogs:
        createHandler(
            getLoanAuditLogs
        ),

    getContributionAuditLogs:
        createHandler(
            getContributionAuditLogs
        ),

    getContributionLogs:
        createHandler(
            getContributionAuditLogs
        ),

    getSavingsAuditLogs:
        createHandler(
            getSavingsAuditLogs
        ),

    getSavingsLogs:
        createHandler(
            getSavingsAuditLogs
        ),

    getWithdrawalAuditLogs:
        createHandler(
            getWithdrawalAuditLogs
        ),

    getWithdrawalLogs:
        createHandler(
            getWithdrawalAuditLogs
        ),

    getTransactionAuditLogs:
        createHandler(
            getTransactionAuditLogs
        ),

    getTransactionLogs:
        createHandler(
            getTransactionAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * Mobile money
     * ---------------------------------------------------------------------- */

    getMobileMoneyAuditLogs:
        createHandler(
            getMobileMoneyAuditLogs
        ),

    getMobileMoneyLogs:
        createHandler(
            getMobileMoneyAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * KYC / AML / compliance / risk
     * ---------------------------------------------------------------------- */

    getKycAuditLogs:
        createHandler(
            getKycAuditLogs
        ),

    getKYCLogs:
        createHandler(
            getKycAuditLogs
        ),

    getAmlAuditLogs:
        createHandler(
            getAmlAuditLogs
        ),

    getAMLLogs:
        createHandler(
            getAmlAuditLogs
        ),

    getComplianceAuditLogs:
        createHandler(
            getComplianceAuditLogs
        ),

    getComplianceLogs:
        createHandler(
            getComplianceAuditLogs
        ),

    getRiskAuditLogs:
        createHandler(
            getRiskAuditLogs
        ),

    getRiskLogs:
        createHandler(
            getRiskAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * User / tenant / system
     * ---------------------------------------------------------------------- */

    getUserAuditLogs:
        createHandler(
            getUserAuditLogs
        ),

    getUserLogs:
        createHandler(
            getUserAuditLogs
        ),

    getTenantAuditLogs:
        createHandler(
            getTenantAuditLogs
        ),

    getTenantLogs:
        createHandler(
            getTenantAuditLogs
        ),

    getSystemAuditLogs:
        createHandler(
            getSystemAuditLogs
        ),

    getSystemLogs:
        createHandler(
            getSystemAuditLogs
        ),

    getApiAuditLogs:
        createHandler(
            getApiAuditLogs
        ),

    getAPILogs:
        createHandler(
            getApiAuditLogs
        ),

    getDataAccessAuditLogs:
        createHandler(
            getDataAccessAuditLogs
        ),

    getDataAccessLogs:
        createHandler(
            getDataAccessAuditLogs
        ),

    getExportAuditLogs:
        createHandler(
            getExportAuditLogs
        ),

    getExportLogs:
        createHandler(
            getExportAuditLogs
        ),

    /* -------------------------------------------------------------------------
     * Correlation / forensic queries
     * ---------------------------------------------------------------------- */

    getAuditLogByRequestId:
        createHandler(
            getAuditLogByRequestId
        ),

    findByRequestId:
        createHandler(
            getAuditLogByRequestId
        ),

    getAuditLogsByCorrelationId:
        createHandler(
            getAuditLogsByCorrelationId
        ),

    findByCorrelationId:
        createHandler(
            getAuditLogsByCorrelationId
        ),

    getAuditLogsByActor:
        createHandler(
            getAuditLogsByActor
        ),

    findByActor:
        createHandler(
            getAuditLogsByActor
        ),

    getAuditLogsByResource:
        createHandler(
            getAuditLogsByResource
        ),

    findByResource:
        createHandler(
            getAuditLogsByResource
        ),

    getAuditLogsByEvent:
        createHandler(
            getAuditLogsByEvent
        ),

    findByEvent:
        createHandler(
            getAuditLogsByEvent
        ),

    /* -------------------------------------------------------------------------
     * Controlled audit recording / export
     * ---------------------------------------------------------------------- */

    createAuditEvent:
        createHandler(
            createAuditEvent
        ),

    recordAuditEvent:
        createHandler(
            createAuditEvent
        ),

    exportAuditLogs:
        createHandler(
            exportAuditLogs
        ),

    generateAuditExport:
        createHandler(
            exportAuditLogs
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