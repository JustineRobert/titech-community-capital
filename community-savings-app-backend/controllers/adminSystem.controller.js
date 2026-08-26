"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative System Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminSystem.controller.js
 *
 * Purpose:
 *   HTTP/application boundary for privileged TITech platform-system
 *   administration and operational diagnostics.
 *
 * Architecture:
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
 *   Tenant / Platform Context
 *        |
 *        v
 *   adminSystem.controller.js
 *        |
 *        v
 *   adminSystem.service.js
 *        |
 *        +--> Infrastructure
 *        +--> Runtime
 *        +--> Database
 *        +--> Cache
 *        +--> Queue
 *        +--> External Integrations
 *        +--> Observability
 *        +--> Lifecycle
 *
 * =============================================================================
 *
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * 1. Thin HTTP boundary.
 * 2. No direct database access.
 * 3. No direct infrastructure mutation.
 * 4. No secrets/configuration credential disclosure.
 * 5. Tenant isolation where tenant-scoped operations are exposed.
 * 6. Platform-wide operations require elevated privileges.
 * 7. Service layer owns system orchestration.
 * 8. Read operations remain safe and side-effect free.
 * 9. Mutating operations are explicitly isolated.
 * 10. Internal stack traces are never returned to clients.
 * 11. Correlation/request/actor context is propagated downstream.
 * 12. Sensitive diagnostics are sanitized before leaving the service boundary.
 * 13. Compatibility aliases are retained for existing route integrations.
 * 14. TITech is the canonical platform identity.
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminSystem.controller";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

/* =============================================================================
 * HTTP STATUS
 * =============================================================================
 */

const HTTP_STATUS = Object.freeze({
    OK: 200,
    ACCEPTED: 202,

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
        "ADMIN_SYSTEM_INVALID_REQUEST",

    VALIDATION_FAILED:
        "ADMIN_SYSTEM_VALIDATION_FAILED",

    UNAUTHENTICATED:
        "ADMIN_SYSTEM_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_SYSTEM_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_SYSTEM_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_SYSTEM_TENANT_MISMATCH",

    RESOURCE_NOT_FOUND:
        "ADMIN_SYSTEM_RESOURCE_NOT_FOUND",

    OPERATION_NOT_SUPPORTED:
        "ADMIN_SYSTEM_OPERATION_NOT_SUPPORTED",

    SERVICE_UNAVAILABLE:
        "ADMIN_SYSTEM_SERVICE_UNAVAILABLE",

    OPERATION_UNAVAILABLE:
        "ADMIN_SYSTEM_OPERATION_UNAVAILABLE",

    INTERNAL_ERROR:
        "ADMIN_SYSTEM_INTERNAL_ERROR"
});

/* =============================================================================
 * SERVICE RESOLUTION
 * =============================================================================
 */

const SERVICE_NAMES = Object.freeze([
    "adminSystemService",
    "systemAdminService",
    "systemService",
    "administrativeSystemService"
]);

/* =============================================================================
 * SERVICE METHOD ALIASES
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({

    /* Runtime --------------------------------------------------------------- */

    getSystemStatus: [
        "getSystemStatus",
        "getStatus",
        "getSystemHealth"
    ],

    getRuntimeStatus: [
        "getRuntimeStatus",
        "getRuntimeInfo",
        "getRuntime"
    ],

    getRuntimeInfo: [
        "getRuntimeInfo",
        "getRuntimeStatus",
        "getRuntime"
    ],

    getSystemInfo: [
        "getSystemInfo",
        "getPlatformInfo",
        "getSystemMetadata"
    ],

    getVersionInfo: [
        "getVersionInfo",
        "getVersions",
        "getVersion"
    ],

    /* Health ---------------------------------------------------------------- */

    getHealth: [
        "getHealth",
        "health",
        "getSystemHealth"
    ],

    getReadiness: [
        "getReadiness",
        "readiness",
        "getReadinessStatus"
    ],

    getLiveness: [
        "getLiveness",
        "liveness",
        "getLivenessStatus"
    ],

    getDependenciesHealth: [
        "getDependenciesHealth",
        "getDependencyHealth",
        "getDependenciesStatus"
    ],

    getInfrastructureHealth: [
        "getInfrastructureHealth",
        "getInfrastructureStatus"
    ],

    /* Services -------------------------------------------------------------- */

    getServicesStatus: [
        "getServicesStatus",
        "getServiceStatus",
        "getServicesHealth"
    ],

    getServiceStatus: [
        "getServiceStatus",
        "getServicesStatus",
        "getServiceHealth"
    ],

    restartService: [
        "restartService",
        "restartManagedService"
    ],

    /* Database -------------------------------------------------------------- */

    getDatabaseStatus: [
        "getDatabaseStatus",
        "getDatabaseHealth",
        "getDatabaseInfo"
    ],

    getDatabaseStatistics: [
        "getDatabaseStatistics",
        "getDatabaseStats",
        "getDatabaseMetrics"
    ],

    /* Cache ----------------------------------------------------------------- */

    getCacheStatus: [
        "getCacheStatus",
        "getCacheHealth"
    ],

    getCacheStatistics: [
        "getCacheStatistics",
        "getCacheStats",
        "getCacheMetrics"
    ],

    clearCache: [
        "clearCache",
        "invalidateCache"
    ],

    /* Queue ----------------------------------------------------------------- */

    getQueueStatus: [
        "getQueueStatus",
        "getQueueHealth",
        "getQueuesStatus"
    ],

    getQueueStatistics: [
        "getQueueStatistics",
        "getQueueStats",
        "getQueueMetrics"
    ],

    retryFailedJobs: [
        "retryFailedJobs",
        "retryDeadLetterJobs"
    ],

    /* Infrastructure -------------------------------------------------------- */

    getInfrastructureStatus: [
        "getInfrastructureStatus",
        "getInfrastructureHealth"
    ],

    getInfrastructureMetrics: [
        "getInfrastructureMetrics",
        "getInfrastructureStats"
    ],

    /* Configuration --------------------------------------------------------- */

    getConfiguration: [
        "getConfiguration",
        "getSafeConfiguration",
        "getRuntimeConfiguration"
    ],

    getConfigurationStatus: [
        "getConfigurationStatus",
        "validateConfiguration",
        "getConfigurationHealth"
    ],

    validateConfiguration: [
        "validateConfiguration",
        "validateRuntimeConfiguration"
    ],

    /* Integrations ---------------------------------------------------------- */

    getIntegrationsStatus: [
        "getIntegrationsStatus",
        "getIntegrationStatus",
        "getIntegrationsHealth"
    ],

    getIntegrationStatus: [
        "getIntegrationStatus",
        "getIntegrationsStatus"
    ],

    testIntegration: [
        "testIntegration",
        "testExternalIntegration",
        "probeIntegration"
    ],

    /* Maintenance ----------------------------------------------------------- */

    getMaintenanceStatus: [
        "getMaintenanceStatus",
        "getMaintenanceMode",
        "getMaintenanceState"
    ],

    enableMaintenance: [
        "enableMaintenance",
        "activateMaintenance",
        "setMaintenanceMode"
    ],

    disableMaintenance: [
        "disableMaintenance",
        "deactivateMaintenance",
        "setMaintenanceMode"
    ],

    /* Diagnostics ----------------------------------------------------------- */

    getDiagnostics: [
        "getDiagnostics",
        "runDiagnostics",
        "getSystemDiagnostics"
    ],

    runDiagnostics: [
        "runDiagnostics",
        "getDiagnostics",
        "runSystemDiagnostics"
    ],

    getMetrics: [
        "getMetrics",
        "getSystemMetrics",
        "getOperationalMetrics"
    ],

    /* Lifecycle ------------------------------------------------------------- */

    getLifecycleStatus: [
        "getLifecycleStatus",
        "getApplicationLifecycleStatus",
        "getRuntimeLifecycle"
    ],

    shutdown: [
        "shutdown",
        "gracefulShutdown",
        "requestShutdown"
    ],

    restart: [
        "restart",
        "gracefulRestart",
        "requestRestart"
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
    "name";

const ALLOWED_SORT_FIELDS =
    Object.freeze([
        "name",
        "status",
        "state",
        "createdAt",
        "updatedAt",
        "startedAt",
        "lastCheckedAt",
        "latency",
        "duration"
    ]);

const ALLOWED_SORT_DIRECTIONS =
    Object.freeze([
        "asc",
        "desc"
    ]);

/* =============================================================================
 * ADMIN ROLES
 * =============================================================================
 */

const SYSTEM_ADMIN_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "operations_admin",
        "devops_admin",
        "infrastructure_admin",
        "tenant_admin"
    ]);

/* =============================================================================
 * SYSTEM PERMISSIONS
 * =============================================================================
 */

const SYSTEM_PERMISSIONS =
    Object.freeze([
        "system.view",
        "system.read",
        "system.manage",
        "system.admin",
        "system.diagnostics",
        "system.maintenance",
        "system.restart",
        "system.shutdown",
        "infrastructure.view",
        "infrastructure.manage",
        "admin.system",
        "admin.system.view",
        "admin.system.manage"
    ]);

/* =============================================================================
 * MAINTENANCE ACTIONS
 * =============================================================================
 */

const MAINTENANCE_ACTIONS =
    Object.freeze([
        "enable",
        "disable"
    ]);

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
 * PRINCIPAL
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

/* =============================================================================
 * TENANT
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
 * REQUEST ID
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

/* =============================================================================
 * CORRELATION ID
 * =============================================================================
 */

function resolveCorrelationId(
    req
) {
    return normalizeString(
        req?.correlationId ??
        req?.context?.correlationId ??
        req?.requestContext?.correlationId ??
        req?.headers?.["x-correlation-id"] ??
        resolveRequestId(
            req
        )
    );
}

/* =============================================================================
 * DEVICE ID
 * =============================================================================
 */

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
 * ROLE / PERMISSION RESOLUTION
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
        .map(
            role =>
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
        .map(
            permission =>
                String(permission)
                    .trim()
                    .toLowerCase()
        );
}

function hasSystemAdminRole(
    principal
) {
    return resolveRoles(
        principal
    ).some(
        role =>
            SYSTEM_ADMIN_ROLES.includes(
                role
            )
    );
}

function hasSystemPermission(
    principal
) {
    return resolvePermissions(
        principal
    ).some(
        permission =>
            SYSTEM_PERMISSIONS.includes(
                permission
            ) ||
            permission === "*" ||
            permission === "admin.*"
    );
}

/* =============================================================================
 * AUTHORIZATION
 * =============================================================================
 */

function assertAuthenticated(
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

    return principal;
}

function assertSystemAccess(
    req
) {
    const principal =
        assertAuthenticated(
            req
        );

    /*
     * Route middleware remains the canonical authorization boundary.
     *
     * These checks provide defense in depth and support installations where
     * authorization metadata is already attached to the request.
     */
    if (
        hasSystemAdminRole(
            principal
        ) ||
        hasSystemPermission(
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
            "You do not have permission to access TITech system administration."
        );

    error.statusCode =
        HTTP_STATUS.FORBIDDEN;

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/* =============================================================================
 * PLATFORM SCOPE
 * =============================================================================
 */

function assertPlatformOperation(
    req
) {
    const principal =
        assertAuthenticated(
            req
        );

    const roles =
        resolveRoles(
            principal
        );

    const permissions =
        resolvePermissions(
            principal
        );

    const isPlatformAdmin =
        roles.includes(
            "super_admin"
        ) ||
        roles.includes(
            "superadmin"
        ) ||
        roles.includes(
            "platform_admin"
        ) ||
        roles.includes(
            "system_admin"
        ) ||
        permissions.includes(
            "system.admin"
        ) ||
        permissions.includes(
            "system.manage"
        ) ||
        permissions.includes(
            "*"
        ) ||
        permissions.includes(
            "admin.*"
        );

    if (
        !isPlatformAdmin &&
        req?.authorization?.platformOperation !== true
    ) {
        const error =
            new Error(
                "Platform-level system administration privileges are required."
            );

        error.statusCode =
            HTTP_STATUS.FORBIDDEN;

        error.code =
            ERROR_CODES.FORBIDDEN;

        throw error;
    }

    return true;
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
 * SORT
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
            "asc"
        )?.toLowerCase();

    const sortDirection =
        ALLOWED_SORT_DIRECTIONS.includes(
            requestedDirection
        )
            ? requestedDirection
            : "asc";

    return {
        sortBy,
        sortDirection
    };
}

/* =============================================================================
 * SAFE QUERY FILTERS
 * =============================================================================
 */

function buildSystemFilters(
    req
) {
    const query =
        req?.query ||
        {};

    return {
        search:
            normalizeString(
                query.search ??
                query.q
            ),

        status:
            normalizeString(
                query.status
            ),

        state:
            normalizeString(
                query.state
            ),

        service:
            normalizeString(
                query.service
            ),

        serviceName:
            normalizeString(
                query.serviceName
            ),

        integration:
            normalizeString(
                query.integration
            ),

        provider:
            normalizeString(
                query.provider
            ),

        environment:
            normalizeString(
                query.environment
            ),

        from:
            normalizeString(
                query.from ??
                query.startDate
            ),

        to:
            normalizeString(
                query.to ??
                query.endDate
            ),

        includeDetails:
            normalizeBoolean(
                query.includeDetails,
                false
            ),

        includeMetrics:
            normalizeBoolean(
                query.includeMetrics,
                true
            ),

        includeDependencies:
            normalizeBoolean(
                query.includeDependencies,
                true
            ),

        ...normalizeSort(
            query
        )
    };
}

/* =============================================================================
 * REQUEST BODY
 * =============================================================================
 */

function buildRequestInput(
    req
) {
    const body =
        req?.body &&
        typeof req.body ===
            "object"
            ? req.body
            : {};

    return {
        reason:
            normalizeString(
                body.reason
            ),

        description:
            normalizeString(
                body.description
            ),

        service:
            normalizeString(
                body.service
            ),

        serviceName:
            normalizeString(
                body.serviceName
            ),

        integration:
            normalizeString(
                body.integration
            ),

        provider:
            normalizeString(
                body.provider
            ),

        force:
            normalizeBoolean(
                body.force,
                false
            ),

        dryRun:
            normalizeBoolean(
                body.dryRun,
                true
            ),

        confirmation:
            normalizeString(
                body.confirmation
            ),

        metadata:
            sanitizeMetadata(
                body.metadata
            )
    };
}

/* =============================================================================
 * SAFE METADATA
 * =============================================================================
 */

function sanitizeMetadata(
    metadata
) {
    if (
        !metadata ||
        typeof metadata !==
            "object" ||
        Array.isArray(
            metadata
        )
    ) {
        return {};
    }

    const output = {};

    const blockedKeys =
        new Set([
            "password",
            "passwd",
            "secret",
            "token",
            "accessToken",
            "refreshToken",
            "authorization",
            "cookie",
            "apiKey",
            "privateKey",
            "clientSecret",
            "databaseUrl",
            "mongoUri",
            "connectionString",
            "credential",
            "credentials",
            "otp"
        ]);

    for (
        const [
            key,
            value
        ] of Object.entries(
            metadata
        )
    ) {
        if (
            blockedKeys.has(
                key
            )
        ) {
            continue;
        }

        if (
            typeof value ===
            "string" &&
            value.length >
                1000
        ) {
            output[key] =
                value.slice(
                    0,
                    1000
                );

            continue;
        }

        if (
            value === null ||
            typeof value ===
                "string" ||
            typeof value ===
                "number" ||
            typeof value ===
                "boolean"
        ) {
            output[key] =
                value;
        }
    }

    return output;
}

/* =============================================================================
 * SERVICE RESOLUTION
 * =============================================================================
 */

function resolveSystemService(
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
                    // Continue.
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
                    // Continue.
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
                    // Continue.
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
 * METHOD RESOLUTION
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
        ] ||
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
        resolveSystemService(
            req
        );

    if (!service) {
        const error =
            new Error(
                "The TITech administrative system service is unavailable."
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
                `Administrative system operation "${operation}" is not available.`
            );

        error.statusCode =
            HTTP_STATUS.SERVICE_UNAVAILABLE;

        error.code =
            ERROR_CODES.OPERATION_UNAVAILABLE;

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
            `adminSystem.${operation}`,

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
            `adminSystem.${operation}`
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
    req,
    options = {}
) {
    const tenantId =
        options.platform
            ? resolveTenantId(
                req
            )
            : assertTenantContext(
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
 * GENERIC READ OPERATION
 * =============================================================================
 */

async function executeReadOperation(
    req,
    res,
    operation,
    input = {},
    options = {}
) {
    try {
        assertSystemAccess(
            req
        );

        if (
            options.platform
        ) {
            assertPlatformOperation(
                req
            );
        }

        const base =
            buildBasePayload(
                req,
                options
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
                    options.code ||
                    "ADMIN_SYSTEM_OPERATION_COMPLETED",

                tenantId:
                    base.tenantId
            },
            options.statusCode ||
                HTTP_STATUS.OK
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
 * GENERIC MUTATION OPERATION
 * =============================================================================
 */

async function executeMutationOperation(
    req,
    res,
    operation,
    input = {},
    options = {}
) {
    try {
        assertSystemAccess(
            req
        );

        if (
            options.platform
        ) {
            assertPlatformOperation(
                req
            );
        }

        const base =
            buildBasePayload(
                req,
                options
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
                    options.code ||
                    "ADMIN_SYSTEM_OPERATION_ACCEPTED",

                tenantId:
                    base.tenantId
            },
            options.statusCode ||
                HTTP_STATUS.ACCEPTED
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
 * RUNTIME
 * =============================================================================
 */

async function getSystemStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemStatus",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_SYSTEM_STATUS_RETRIEVED"
        }
    );
}

async function getRuntimeStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRuntimeStatus",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_RUNTIME_STATUS_RETRIEVED"
        }
    );
}

async function getRuntimeInfo(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRuntimeInfo",
        {},
        {
            platform: true,
            code:
                "ADMIN_RUNTIME_INFO_RETRIEVED"
        }
    );
}

async function getSystemInfo(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemInfo",
        {},
        {
            platform: true,
            code:
                "ADMIN_SYSTEM_INFO_RETRIEVED"
        }
    );
}

async function getVersionInfo(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getVersionInfo",
        {},
        {
            platform: true,
            code:
                "ADMIN_VERSION_INFO_RETRIEVED"
        }
    );
}

/* =============================================================================
 * HEALTH
 * =============================================================================
 */

async function getHealth(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getHealth",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_HEALTH_STATUS_RETRIEVED"
        }
    );
}

async function getReadiness(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getReadiness",
        {},
        {
            platform: true,
            code:
                "ADMIN_READINESS_STATUS_RETRIEVED"
        }
    );
}

async function getLiveness(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLiveness",
        {},
        {
            platform: true,
            code:
                "ADMIN_LIVENESS_STATUS_RETRIEVED"
        }
    );
}

async function getDependenciesHealth(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDependenciesHealth",
        {},
        {
            platform: true,
            code:
                "ADMIN_DEPENDENCIES_HEALTH_RETRIEVED"
        }
    );
}

async function getInfrastructureHealth(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getInfrastructureHealth",
        {},
        {
            platform: true,
            code:
                "ADMIN_INFRASTRUCTURE_HEALTH_RETRIEVED"
        }
    );
}

/* =============================================================================
 * SERVICES
 * =============================================================================
 */

async function getServicesStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getServicesStatus",
        {
            filters:
                buildSystemFilters(
                    req
                ),

            pagination:
                normalizePagination(
                    req.query ||
                        {}
                )
        },
        {
            platform: true,
            code:
                "ADMIN_SERVICES_STATUS_RETRIEVED"
        }
    );
}

async function getServiceStatus(
    req,
    res
) {
    const service =
        normalizeString(
            req.params?.service ??
            req.params?.serviceName ??
            req.query?.service
        );

    if (!service) {
        const error =
            new Error(
                "service is required."
            );

        error.statusCode =
            HTTP_STATUS.BAD_REQUEST;

        error.code =
            ERROR_CODES.INVALID_REQUEST;

        return sendError(
            req,
            res,
            error,
            "getServiceStatus"
        );
    }

    return executeReadOperation(
        req,
        res,
        "getServiceStatus",
        {
            service
        },
        {
            platform: true,
            code:
                "ADMIN_SERVICE_STATUS_RETRIEVED"
        }
    );
}

/* =============================================================================
 * DATABASE
 * =============================================================================
 */

async function getDatabaseStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDatabaseStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_DATABASE_STATUS_RETRIEVED"
        }
    );
}

async function getDatabaseStatistics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDatabaseStatistics",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_DATABASE_STATISTICS_RETRIEVED"
        }
    );
}

/* =============================================================================
 * CACHE
 * =============================================================================
 */

async function getCacheStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getCacheStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_CACHE_STATUS_RETRIEVED"
        }
    );
}

async function getCacheStatistics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getCacheStatistics",
        {},
        {
            platform: true,
            code:
                "ADMIN_CACHE_STATISTICS_RETRIEVED"
        }
    );
}

async function clearCache(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "clearCache",
        buildRequestInput(
            req
        ),
        {
            platform: true,
            code:
                "ADMIN_CACHE_CLEAR_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

/* =============================================================================
 * QUEUES
 * =============================================================================
 */

async function getQueueStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getQueueStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_QUEUE_STATUS_RETRIEVED"
        }
    );
}

async function getQueueStatistics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getQueueStatistics",
        {},
        {
            platform: true,
            code:
                "ADMIN_QUEUE_STATISTICS_RETRIEVED"
        }
    );
}

async function retryFailedJobs(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "retryFailedJobs",
        buildRequestInput(
            req
        ),
        {
            platform: true,
            code:
                "ADMIN_FAILED_JOBS_RETRY_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

/* =============================================================================
 * INFRASTRUCTURE
 * =============================================================================
 */

async function getInfrastructureStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getInfrastructureStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_INFRASTRUCTURE_STATUS_RETRIEVED"
        }
    );
}

async function getInfrastructureMetrics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getInfrastructureMetrics",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_INFRASTRUCTURE_METRICS_RETRIEVED"
        }
    );
}

/* =============================================================================
 * CONFIGURATION
 * =============================================================================
 */

async function getConfiguration(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getConfiguration",
        {
            /*
             * Explicitly tell the service that this is a safe configuration
             * projection. The service must never return raw credentials.
             */
            safeOnly:
                true,

            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_CONFIGURATION_RETRIEVED"
        }
    );
}

async function getConfigurationStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getConfigurationStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_CONFIGURATION_STATUS_RETRIEVED"
        }
    );
}

async function validateConfiguration(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "validateConfiguration",
        {},
        {
            platform: true,
            code:
                "ADMIN_CONFIGURATION_VALIDATED"
        }
    );
}

/* =============================================================================
 * INTEGRATIONS
 * =============================================================================
 */

async function getIntegrationsStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getIntegrationsStatus",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_INTEGRATIONS_STATUS_RETRIEVED"
        }
    );
}

async function getIntegrationStatus(
    req,
    res
) {
    const integration =
        normalizeString(
            req.params?.integration ??
            req.params?.provider ??
            req.query?.integration
        );

    if (!integration) {
        const error =
            new Error(
                "integration is required."
            );

        error.statusCode =
            HTTP_STATUS.BAD_REQUEST;

        error.code =
            ERROR_CODES.INVALID_REQUEST;

        return sendError(
            req,
            res,
            error,
            "getIntegrationStatus"
        );
    }

    return executeReadOperation(
        req,
        res,
        "getIntegrationStatus",
        {
            integration
        },
        {
            platform: true,
            code:
                "ADMIN_INTEGRATION_STATUS_RETRIEVED"
        }
    );
}

async function testIntegration(
    req,
    res
) {
    const input =
        buildRequestInput(
            req
        );

    const integration =
        normalizeString(
            req.params?.integration ??
            req.params?.provider ??
            input.integration
        );

    if (!integration) {
        const error =
            new Error(
                "integration is required."
            );

        error.statusCode =
            HTTP_STATUS.BAD_REQUEST;

        error.code =
            ERROR_CODES.INVALID_REQUEST;

        return sendError(
            req,
            res,
            error,
            "testIntegration"
        );
    }

    return executeMutationOperation(
        req,
        res,
        "testIntegration",
        {
            ...input,
            integration
        },
        {
            platform: true,
            code:
                "ADMIN_INTEGRATION_TEST_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

/* =============================================================================
 * MAINTENANCE
 * =============================================================================
 */

async function getMaintenanceStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMaintenanceStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_MAINTENANCE_STATUS_RETRIEVED"
        }
    );
}

async function enableMaintenance(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "enableMaintenance",
        {
            ...buildRequestInput(
                req
            ),

            action:
                "enable"
        },
        {
            platform: true,
            code:
                "ADMIN_MAINTENANCE_ENABLE_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

async function disableMaintenance(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "disableMaintenance",
        {
            ...buildRequestInput(
                req
            ),

            action:
                "disable"
        },
        {
            platform: true,
            code:
                "ADMIN_MAINTENANCE_DISABLE_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

/* =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

async function getDiagnostics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getDiagnostics",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_DIAGNOSTICS_RETRIEVED"
        }
    );
}

async function runDiagnostics(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "runDiagnostics",
        {
            ...buildRequestInput(
                req
            ),

            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_DIAGNOSTICS_EXECUTION_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

async function getMetrics(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getMetrics",
        {
            filters:
                buildSystemFilters(
                    req
                )
        },
        {
            platform: true,
            code:
                "ADMIN_SYSTEM_METRICS_RETRIEVED"
        }
    );
}

/* =============================================================================
 * LIFECYCLE
 * =============================================================================
 */

async function getLifecycleStatus(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getLifecycleStatus",
        {},
        {
            platform: true,
            code:
                "ADMIN_LIFECYCLE_STATUS_RETRIEVED"
        }
    );
}

async function shutdown(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "shutdown",
        buildRequestInput(
            req
        ),
        {
            platform: true,
            code:
                "ADMIN_SHUTDOWN_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

async function restart(
    req,
    res
) {
    return executeMutationOperation(
        req,
        res,
        "restart",
        buildRequestInput(
            req
        ),
        {
            platform: true,
            code:
                "ADMIN_RESTART_ACCEPTED",
            statusCode:
                HTTP_STATUS.ACCEPTED
        }
    );
}

/* =============================================================================
 * RESPONSE
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
                "ADMIN_SYSTEM_SUCCESS",

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
                    ? "The TITech system operation could not be completed."
                    : (
                        error?.message ||
                        "The system request is invalid."
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
                    "The system request is invalid."
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
                    "You do not have permission to perform this system operation."
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

        case ERROR_CODES.RESOURCE_NOT_FOUND:
            return {
                statusCode:
                    HTTP_STATUS.NOT_FOUND,

                code:
                    ERROR_CODES.RESOURCE_NOT_FOUND,

                message:
                    "The requested system resource was not found."
            };

        case ERROR_CODES.OPERATION_NOT_SUPPORTED:
        case ERROR_CODES.OPERATION_UNAVAILABLE:
        case ERROR_CODES.SERVICE_UNAVAILABLE:
            return {
                statusCode:
                    HTTP_STATUS.SERVICE_UNAVAILABLE,

                code:
                    error.code,

                message:
                    "The requested system operation is temporarily unavailable."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The TITech system operation could not be completed."
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

        case HTTP_STATUS.BAD_REQUEST:
        case HTTP_STATUS.UNPROCESSABLE_ENTITY:
            return ERROR_CODES.INVALID_REQUEST;

        case HTTP_STATUS.SERVICE_UNAVAILABLE:
            return ERROR_CODES.SERVICE_UNAVAILABLE;

        default:
            return ERROR_CODES.INTERNAL_ERROR;
    }
}

/* =============================================================================
 * ERROR LOGGING
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

        application:
            APPLICATION_NAME,

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
                "Unknown administrative system error"
        }
    };

    /*
     * Never log:
     *
     * - authorization headers
     * - access tokens
     * - refresh tokens
     * - passwords
     * - API secrets
     * - database connection strings
     * - private keys
     * - payment credentials
     * - complete request bodies
     * - raw configuration
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
 * EXPRESS WRAPPER
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
            "Administrative system handler must be a function."
        );
    }

    return function adminSystemHandler(
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
            "system-administration",

        resource:
            "administrative-system",

        multiTenant:
            true,

        platformScoped:
            true,

        serviceDriven:
            true,

        directDatabaseAccess:
            false,

        directInfrastructureAccess:
            false,

        secretDisclosure:
            false,

        supportedOperations:
            Object.freeze(
                Object.keys(
                    METHOD_ALIASES
                )
            ),

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
        },

        maintenanceActions:
            MAINTENANCE_ACTIONS
    });
}

/* =============================================================================
 * PUBLIC CONTROLLER
 * =============================================================================
 */

const controller = {

    /* Runtime --------------------------------------------------------------- */

    getSystemStatus:
        createHandler(
            getSystemStatus
        ),

    getStatus:
        createHandler(
            getSystemStatus
        ),

    getRuntimeStatus:
        createHandler(
            getRuntimeStatus
        ),

    getRuntimeInfo:
        createHandler(
            getRuntimeInfo
        ),

    getSystemInfo:
        createHandler(
            getSystemInfo
        ),

    getVersionInfo:
        createHandler(
            getVersionInfo
        ),

    getVersions:
        createHandler(
            getVersionInfo
        ),

    /* Health ---------------------------------------------------------------- */

    getHealth:
        createHandler(
            getHealth
        ),

    health:
        createHandler(
            getHealth
        ),

    getReadiness:
        createHandler(
            getReadiness
        ),

    readiness:
        createHandler(
            getReadiness
        ),

    getLiveness:
        createHandler(
            getLiveness
        ),

    liveness:
        createHandler(
            getLiveness
        ),

    getDependenciesHealth:
        createHandler(
            getDependenciesHealth
        ),

    getInfrastructureHealth:
        createHandler(
            getInfrastructureHealth
        ),

    /* Services -------------------------------------------------------------- */

    getServicesStatus:
        createHandler(
            getServicesStatus
        ),

    getServices:
        createHandler(
            getServicesStatus
        ),

    getServiceStatus:
        createHandler(
            getServiceStatus
        ),

    /* Database -------------------------------------------------------------- */

    getDatabaseStatus:
        createHandler(
            getDatabaseStatus
        ),

    getDatabaseHealth:
        createHandler(
            getDatabaseStatus
        ),

    getDatabaseStatistics:
        createHandler(
            getDatabaseStatistics
        ),

    getDatabaseStats:
        createHandler(
            getDatabaseStatistics
        ),

    /* Cache ----------------------------------------------------------------- */

    getCacheStatus:
        createHandler(
            getCacheStatus
        ),

    getCacheHealth:
        createHandler(
            getCacheStatus
        ),

    getCacheStatistics:
        createHandler(
            getCacheStatistics
        ),

    getCacheStats:
        createHandler(
            getCacheStatistics
        ),

    clearCache:
        createHandler(
            clearCache
        ),

    invalidateCache:
        createHandler(
            clearCache
        ),

    /* Queue ----------------------------------------------------------------- */

    getQueueStatus:
        createHandler(
            getQueueStatus
        ),

    getQueuesStatus:
        createHandler(
            getQueueStatus
        ),

    getQueueStatistics:
        createHandler(
            getQueueStatistics
        ),

    getQueueStats:
        createHandler(
            getQueueStatistics
        ),

    retryFailedJobs:
        createHandler(
            retryFailedJobs
        ),

    /* Infrastructure -------------------------------------------------------- */

    getInfrastructureStatus:
        createHandler(
            getInfrastructureStatus
        ),

    getInfrastructureMetrics:
        createHandler(
            getInfrastructureMetrics
        ),

    /* Configuration --------------------------------------------------------- */

    getConfiguration:
        createHandler(
            getConfiguration
        ),

    getSafeConfiguration:
        createHandler(
            getConfiguration
        ),

    getConfigurationStatus:
        createHandler(
            getConfigurationStatus
        ),

    validateConfiguration:
        createHandler(
            validateConfiguration
        ),

    /* Integrations ---------------------------------------------------------- */

    getIntegrationsStatus:
        createHandler(
            getIntegrationsStatus
        ),

    getIntegrationStatus:
        createHandler(
            getIntegrationStatus
        ),

    testIntegration:
        createHandler(
            testIntegration
        ),

    /* Maintenance ----------------------------------------------------------- */

    getMaintenanceStatus:
        createHandler(
            getMaintenanceStatus
        ),

    getMaintenanceMode:
        createHandler(
            getMaintenanceStatus
        ),

    enableMaintenance:
        createHandler(
            enableMaintenance
        ),

    disableMaintenance:
        createHandler(
            disableMaintenance
        ),

    /* Diagnostics ----------------------------------------------------------- */

    getDiagnostics:
        createHandler(
            getDiagnostics
        ),

    runDiagnostics:
        createHandler(
            runDiagnostics
        ),

    getMetrics:
        createHandler(
            getMetrics
        ),

    getSystemMetrics:
        createHandler(
            getMetrics
        ),

    /* Lifecycle ------------------------------------------------------------- */

    getLifecycleStatus:
        createHandler(
            getLifecycleStatus
        ),

    shutdown:
        createHandler(
            shutdown
        ),

    gracefulShutdown:
        createHandler(
            shutdown
        ),

    restart:
        createHandler(
            restart
        ),

    gracefulRestart:
        createHandler(
            restart
        ),

    /* Metadata -------------------------------------------------------------- */

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