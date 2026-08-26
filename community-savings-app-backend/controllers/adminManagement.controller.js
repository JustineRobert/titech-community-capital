"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Management Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminManagement.controller.js
 *
 * Purpose:
 *   Canonical HTTP boundary for privileged administrative management
 *   operations within the TITech Community Capital platform.
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        |
 *        v
 *   Authentication Middleware
 *        |
 *        v
 *   Authorization / Permission Middleware
 *        |
 *        v
 *   Tenant Context Middleware
 *        |
 *        v
 *   adminManagement.controller.js
 *        |
 *        v
 *   adminManagement.service.js
 *        |
 *        +---- repositories
 *        +---- identity services
 *        +---- role/permission services
 *        +---- audit services
 *        +---- notification services
 *        +---- compliance services
 *        +---- observability
 *
 * Controller responsibilities
 * -----------------------------------------------------------------------------
 *   - Validate the HTTP boundary.
 *   - Resolve authenticated principal.
 *   - Resolve trusted tenant context.
 *   - Enforce a defensive administrative authorization boundary.
 *   - Normalize IDs, pagination and filters.
 *   - Delegate all business logic to adminManagement.service.js.
 *   - Propagate request/correlation/device metadata.
 *   - Return stable API response envelopes.
 *   - Normalize errors safely.
 *   - Never query MongoDB directly.
 *   - Never mutate users directly.
 *   - Never mutate roles/permissions directly.
 *   - Never implement password logic.
 *   - Never implement authorization policy logic in business operations.
 *   - Never trust client-supplied tenant IDs as proof of authorization.
 *
 * Security model
 * -----------------------------------------------------------------------------
 *   Authentication
 *       -> identifies the actor.
 *
 *   Authorization middleware
 *       -> determines whether the actor may invoke the route.
 *
 *   Controller
 *       -> performs a second defensive boundary check and constructs the
 *          trusted operation context.
 *
 *   Service
 *       -> owns the authoritative business authorization decision.
 *
 *   Repository
 *       -> persists data under the authoritative tenant/security scope.
 *
 *   Audit service
 *       -> records privileged administrative actions.
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This controller deliberately contains NO direct database access.
 *
 * This controller deliberately contains NO ACFOS naming.
 *
 * =============================================================================
 */

const CONTROLLER_NAME =
    "adminManagement.controller";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

/* =============================================================================
 * HTTP constants
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
 * Application error codes
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_REQUEST:
        "ADMIN_MANAGEMENT_INVALID_REQUEST",

    UNAUTHENTICATED:
        "ADMIN_MANAGEMENT_UNAUTHENTICATED",

    FORBIDDEN:
        "ADMIN_MANAGEMENT_FORBIDDEN",

    TENANT_REQUIRED:
        "ADMIN_MANAGEMENT_TENANT_REQUIRED",

    TENANT_MISMATCH:
        "ADMIN_MANAGEMENT_TENANT_MISMATCH",

    SERVICE_UNAVAILABLE:
        "ADMIN_MANAGEMENT_SERVICE_UNAVAILABLE",

    RESOURCE_NOT_FOUND:
        "ADMIN_MANAGEMENT_RESOURCE_NOT_FOUND",

    CONFLICT:
        "ADMIN_MANAGEMENT_CONFLICT",

    VALIDATION_FAILED:
        "ADMIN_MANAGEMENT_VALIDATION_FAILED",

    INTERNAL_ERROR:
        "ADMIN_MANAGEMENT_INTERNAL_ERROR"
});

/* =============================================================================
 * Service resolution
 * =============================================================================
 *
 * The controller intentionally supports several service-context access patterns
 * so that the application can transition toward the canonical ServicesContext
 * architecture without forcing a single bootstrap migration.
 */

const SERVICE_NAMES = Object.freeze([
    "adminManagementService",
    "adminManagement",
    "administrationService",
    "adminService"
]);

/* =============================================================================
 * Operation -> service method aliases
 * =============================================================================
 *
 * Canonical names are first.
 *
 * Compatibility aliases allow gradual migration from legacy controllers/services
 * without duplicating business logic here.
 */

const METHOD_ALIASES = Object.freeze({
    listUsers: [
        "listUsers",
        "getUsers",
        "findUsers",
        "getAdminUsers"
    ],

    getUser: [
        "getUser",
        "getUserById",
        "findUser"
    ],

    createUser: [
        "createUser",
        "provisionUser",
        "createAdminUser"
    ],

    updateUser: [
        "updateUser",
        "modifyUser",
        "updateAdminUser"
    ],

    deactivateUser: [
        "deactivateUser",
        "disableUser",
        "suspendUser"
    ],

    activateUser: [
        "activateUser",
        "enableUser",
        "restoreUser"
    ],

    deleteUser: [
        "deleteUser",
        "removeUser"
    ],

    resetUserCredentials: [
        "resetUserCredentials",
        "resetCredentials",
        "initiateCredentialReset"
    ],

    changeUserRole: [
        "changeUserRole",
        "assignRole",
        "updateUserRole"
    ],

    updateUserPermissions: [
        "updateUserPermissions",
        "setUserPermissions",
        "assignPermissions"
    ],

    listRoles: [
        "listRoles",
        "getRoles"
    ],

    getRole: [
        "getRole",
        "getRoleById"
    ],

    createRole: [
        "createRole",
        "addRole"
    ],

    updateRole: [
        "updateRole",
        "modifyRole"
    ],

    deleteRole: [
        "deleteRole",
        "removeRole"
    ],

    listPermissions: [
        "listPermissions",
        "getPermissions"
    ],

    getPermissionsMatrix: [
        "getPermissionsMatrix",
        "getAuthorizationMatrix",
        "getPermissionMatrix"
    ],

    listAuditLogs: [
        "listAuditLogs",
        "getAuditLogs",
        "findAuditLogs"
    ],

    getAuditLog: [
        "getAuditLog",
        "getAuditLogById"
    ],

    getSystemSettings: [
        "getSystemSettings",
        "getSettings"
    ],

    updateSystemSettings: [
        "updateSystemSettings",
        "updateSettings"
    ],

    getAdministrativeSummary: [
        "getAdministrativeSummary",
        "getAdminSummary",
        "getManagementSummary"
    ]
});

/* =============================================================================
 * Pagination
 * =============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_PAGE_SIZE =
    25;

const MAX_PAGE_SIZE =
    100;

/* =============================================================================
 * String normalization
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

/* =============================================================================
 * Boolean normalization
 * =============================================================================
 */

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
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes"
    ) {
        return true;
    }

    if (
        normalized === "false" ||
        normalized === "0" ||
        normalized === "no"
    ) {
        return false;
    }

    return fallback;
}

/* =============================================================================
 * Positive integer normalization
 * =============================================================================
 */

function normalizePositiveInteger(
    value,
    fallback,
    maximum
) {
    const numeric =
        Number(value);

    if (
        !Number.isFinite(numeric)
    ) {
        return fallback;
    }

    const integer =
        Math.floor(numeric);

    if (
        integer < 1
    ) {
        return fallback;
    }

    return Math.min(
        integer,
        maximum
    );
}

/* =============================================================================
 * Pagination normalization
 * =============================================================================
 */

function normalizePagination(
    query = {}
) {
    const page =
        normalizePositiveInteger(
            query.page,
            DEFAULT_PAGE,
            Number.MAX_SAFE_INTEGER
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
 * Array normalization
 * =============================================================================
 */

function normalizeStringArray(
    value
) {
    if (
        Array.isArray(value)
    ) {
        return value
            .map(item =>
                normalizeString(
                    item
                )
            )
            .filter(Boolean);
    }

    if (
        typeof value === "string"
    ) {
        return value
            .split(",")
            .map(item =>
                normalizeString(
                    item
                )
            )
            .filter(Boolean);
    }

    return [];
}

/* =============================================================================
 * ID normalization
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

    /*
     * Do not impose Mongo ObjectId validation here.
     *
     * The service/repository layer remains authoritative for identifier type
     * because the platform may support UUIDs or other identifier strategies.
     */
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
 * Request principal
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
 * Tenant IDs are contextual.
 *
 * A request header such as x-tenant-id is NEVER considered sufficient proof of
 * authorization. The trusted tenant must originate from authenticated/security
 * context or an already-authorized middleware boundary.
 */

function resolveTenantId(
    req
) {
    const principal =
        resolvePrincipal(
            req
        );

    const tenantId =
        req?.context?.tenantId ??
        req?.requestContext?.tenantId ??
        req?.tenantId ??
        req?.tenant?.id ??
        req?.tenant?._id ??
        req?.auth?.tenantId ??
        principal?.tenantId ??
        principal?.tenant?.id ??
        principal?.tenant?._id ??
        null;

    return normalizeString(
        tenantId
    );
}

/* =============================================================================
 * Request metadata
 * =============================================================================
 */

function resolveRequestId(
    req
) {
    return normalizeString(
        req?.requestId ??
        req?.id ??
        req?.context?.requestId ??
        req?.requestContext?.requestId
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
 * Administrative roles
 * =============================================================================
 */

const ADMINISTRATIVE_ROLES =
    Object.freeze([
        "admin",
        "administrator",
        "super_admin",
        "superadmin",
        "platform_admin",
        "system_admin",
        "tenant_admin"
    ]);

/* =============================================================================
 * Extract roles
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

/* =============================================================================
 * Extract permissions
 * ============================================================================= */

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
 * Defensive administrative authorization
 * ============================================================================= */

function hasAdministrativeRole(
    principal
) {
    const roles =
        resolveRoles(
            principal
        );

    return roles.some(
        role =>
            ADMINISTRATIVE_ROLES.includes(
                role
            )
    );
}

function hasAdministrativePermission(
    principal
) {
    const permissions =
        resolvePermissions(
            principal
        );

    return permissions.some(
        permission =>
            permission ===
                "admin.manage" ||
            permission ===
                "administration.manage" ||
            permission ===
                "users.manage" ||
            permission ===
                "roles.manage" ||
            permission ===
                "permissions.manage" ||
            permission ===
                "*" ||
            permission.endsWith(
                ":manage"
            )
    );
}

/* =============================================================================
 * Authorization assertion
 * =============================================================================
 *
 * Route middleware should already perform authoritative authorization.
 *
 * This boundary exists to prevent accidental exposure if a route is mounted
 * without the expected authorization middleware.
 */

function assertAdministrativeAccess(
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

    if (
        hasAdministrativeRole(
            principal
        ) ||
        hasAdministrativePermission(
            principal
        )
    ) {
        return true;
    }

    /*
     * Trusted upstream authorization decision.
     *
     * The actual authorization middleware remains authoritative.
     */
    if (
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
            "You do not have permission to perform administrative management operations."
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
 * Service resolution
 * ============================================================================= */

function resolveManagementService(
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
            /*
             * Canonical service-context API.
             */
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

            /*
             * Alternate service accessor.
             */
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

            /*
             * Generic dependency getter.
             */
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

            /*
             * Direct dependency binding.
             */
            if (
                servicesContext[name]
            ) {
                return servicesContext[name];
            }
        }
    }

    /*
     * Express application locals compatibility.
     */
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

    /*
     * Request-scoped compatibility.
     */
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
    if (
        !service
    ) {
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
        resolveManagementService(
            req
        );

    if (
        !service
    ) {
        const error =
            new Error(
                "The administrative management service is unavailable."
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

    if (
        !method
    ) {
        const error =
            new Error(
                `Administrative management operation "${operation}" is not available.`
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

    /*
     * Create a request-scoped execution context.
     */
    let executionContext = {
        application:
            APPLICATION_NAME,

        controller:
            CONTROLLER_NAME,

        operation:
            `adminManagement.${operation}`,

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

    /*
     * Prefer the canonical ServicesContext operation scope where available.
     */
    if (
        servicesContext &&
        typeof
            servicesContext.forOperation ===
            "function"
    ) {
        try {
            executionContext =
                servicesContext.forOperation(
                    `adminManagement.${operation}`,
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
             * Keep the defensive local context if the compatibility accessor
             * does not support the expected signature.
             */
        }
    }

    /*
     * Enforce service readiness where the platform exposes it.
     */
    if (
        servicesContext &&
        typeof
            servicesContext.assertReady ===
            "function"
    ) {
        await servicesContext.assertReady(
            `adminManagement.${operation}`
        );
    }

    /*
     * Canonical service contract:
     *
     *   serviceMethod(payload, executionContext)
     *
     * All business logic remains inside the service.
     */
    return method(
        payload,
        executionContext
    );
}

/* =============================================================================
 * Request context payload
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
 * User filters
 * ============================================================================= */

function buildUserFilters(
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

        status:
            normalizeString(
                query.status
            ),

        role:
            normalizeString(
                query.role
            ),

        roles:
            normalizeStringArray(
                query.roles
            ),

        accountStatus:
            normalizeString(
                query.accountStatus
            ),

        verified:
            normalizeBoolean(
                query.verified
            ),

        groupId:
            normalizeString(
                query.groupId
            ),

        branchId:
            normalizeString(
                query.branchId
            ),

        sortBy:
            normalizeString(
                query.sortBy,
                "createdAt"
            ),

        sortOrder:
            normalizeString(
                query.sortOrder,
                "desc"
            )
            .toLowerCase()
    };
}

/* =============================================================================
 * User list
 * ============================================================================= */

async function listUsers(
    req,
    res
) {
    const operation =
        "listUsers";

    try {
        assertAdministrativeAccess(
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

                    filters:
                        buildUserFilters(
                            req
                        ),

                    pagination:
                        normalizePagination(
                            req.query ||
                                {}
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USERS_RETRIEVED",

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
 * Get user
 * ============================================================================= */

async function getUser(
    req,
    res
) {
    const operation =
        "getUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,
                    userId
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_RETRIEVED",

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
 * Create user
 * ============================================================================= */

async function createUser(
    req,
    res
) {
    const operation =
        "createUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        if (
            !req.body ||
            typeof req.body !==
                "object"
        ) {
            const error =
                new Error(
                    "A user payload is required."
                );

            error.statusCode =
                HTTP_STATUS.BAD_REQUEST;

            error.code =
                ERROR_CODES.INVALID_REQUEST;

            throw error;
        }

        /*
         * The service owns validation of:
         *   - email
         *   - phone
         *   - password/credential policy
         *   - role assignment
         *   - permission assignment
         *   - account state
         *   - tenant membership
         *   - duplicate identities
         */
        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    input:
                        req.body
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_CREATED",

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
            operation
        );
    }
}

/* =============================================================================
 * Update user
 * ============================================================================= */

async function updateUser(
    req,
    res
) {
    const operation =
        "updateUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        if (
            !req.body ||
            typeof req.body !==
                "object"
        ) {
            const error =
                new Error(
                    "A user update payload is required."
                );

            error.statusCode =
                HTTP_STATUS.BAD_REQUEST;

            error.code =
                ERROR_CODES.INVALID_REQUEST;

            throw error;
        }

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    input:
                        req.body
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_UPDATED",

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
 * Deactivate user
 * ============================================================================= */

async function deactivateUser(
    req,
    res
) {
    const operation =
        "deactivateUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    reason:
                        normalizeString(
                            req.body?.reason ??
                            req.query?.reason
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_DEACTIVATED",

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
 * Activate user
 * ============================================================================= */

async function activateUser(
    req,
    res
) {
    const operation =
        "activateUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    reason:
                        normalizeString(
                            req.body?.reason ??
                            req.query?.reason
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_ACTIVATED",

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
 * Delete user
 * =============================================================================
 *
 * Hard deletion is intentionally delegated to the service.
 *
 * The service should normally prefer:
 *
 *   deactivation
 *   anonymization
 *   retention-policy handling
 *
 * over irreversible deletion for regulated/financial records.
 */

async function deleteUser(
    req,
    res
) {
    const operation =
        "deleteUser";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    reason:
                        normalizeString(
                            req.body?.reason ??
                            req.query?.reason
                        ),

                    confirm:
                        normalizeBoolean(
                            req.body?.confirm,
                            false
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_DELETED",

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
 * Reset user credentials
 * ============================================================================= */

async function resetUserCredentials(
    req,
    res
) {
    const operation =
        "resetUserCredentials";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    notify:
                        normalizeBoolean(
                            req.body?.notify,
                            true
                        ),

                    reason:
                        normalizeString(
                            req.body?.reason
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_CREDENTIAL_RESET_INITIATED",

                tenantId:
                    base.tenantId
            },
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
 * Change user role
 * ============================================================================= */

async function changeUserRole(
    req,
    res
) {
    const operation =
        "changeUserRole";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const role =
            normalizeString(
                req.body?.role
            );

        if (
            !role
        ) {
            const error =
                new Error(
                    "A role is required."
                );

            error.statusCode =
                HTTP_STATUS.BAD_REQUEST;

            error.code =
                ERROR_CODES.INVALID_REQUEST;

            throw error;
        }

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    role,

                    reason:
                        normalizeString(
                            req.body?.reason
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_ROLE_UPDATED",

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
 * Update user permissions
 * ============================================================================= */

async function updateUserPermissions(
    req,
    res
) {
    const operation =
        "updateUserPermissions";

    try {
        assertAdministrativeAccess(
            req
        );

        const base =
            buildBasePayload(
                req
            );

        const userId =
            normalizeIdentifier(
                req.params?.userId ??
                req.params?.id,
                "userId"
            );

        const permissions =
            normalizeStringArray(
                req.body?.permissions
            );

        const result =
            await invokeService(
                req,
                operation,
                {
                    ...base,

                    userId,

                    permissions,

                    reason:
                        normalizeString(
                            req.body?.reason
                        )
                }
            );

        return sendSuccess(
            req,
            res,
            result,
            {
                code:
                    "ADMIN_USER_PERMISSIONS_UPDATED",

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
 * Roles
 * ============================================================================= */

async function listRoles(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listRoles",
        {
            pagination:
                normalizePagination(
                    req.query ||
                        {}
                ),

            search:
                normalizeString(
                    req.query?.search
                ),

            status:
                normalizeString(
                    req.query?.status
                )
        },
        "ADMIN_ROLES_RETRIEVED"
    );
}

async function getRole(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getRole",
        {
            roleId:
                normalizeIdentifier(
                    req.params?.roleId ??
                    req.params?.id,
                    "roleId"
                )
        },
        "ADMIN_ROLE_RETRIEVED"
    );
}

async function createRole(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "createRole",
        {
            input:
                req.body
        },
        "ADMIN_ROLE_CREATED",
        HTTP_STATUS.CREATED
    );
}

async function updateRole(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "updateRole",
        {
            roleId:
                normalizeIdentifier(
                    req.params?.roleId ??
                    req.params?.id,
                    "roleId"
                ),

            input:
                req.body
        },
        "ADMIN_ROLE_UPDATED"
    );
}

async function deleteRole(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "deleteRole",
        {
            roleId:
                normalizeIdentifier(
                    req.params?.roleId ??
                    req.params?.id,
                    "roleId"
                ),

            reason:
                normalizeString(
                    req.body?.reason
                ),

            confirm:
                normalizeBoolean(
                    req.body?.confirm,
                    false
                )
        },
        "ADMIN_ROLE_DELETED"
    );
}

/* =============================================================================
 * Permissions
 * ============================================================================= */

async function listPermissions(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listPermissions",
        {
            pagination:
                normalizePagination(
                    req.query ||
                        {}
                ),

            search:
                normalizeString(
                    req.query?.search
                ),

            resource:
                normalizeString(
                    req.query?.resource
                ),

            action:
                normalizeString(
                    req.query?.action
                )
        },
        "ADMIN_PERMISSIONS_RETRIEVED"
    );
}

async function getPermissionsMatrix(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getPermissionsMatrix",
        {
            role:
                normalizeString(
                    req.query?.role
                )
        },
        "ADMIN_PERMISSIONS_MATRIX_RETRIEVED"
    );
}

/* =============================================================================
 * Audit logs
 * ============================================================================= */

async function listAuditLogs(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "listAuditLogs",
        {
            pagination:
                normalizePagination(
                    req.query ||
                        {}
                ),

            filters: {
                actorId:
                    normalizeString(
                        req.query?.actorId
                    ),

                targetUserId:
                    normalizeString(
                        req.query?.targetUserId
                    ),

                action:
                    normalizeString(
                        req.query?.action
                    ),

                resource:
                    normalizeString(
                        req.query?.resource
                    ),

                severity:
                    normalizeString(
                        req.query?.severity
                    ),

                from:
                    normalizeString(
                        req.query?.from
                    ),

                to:
                    normalizeString(
                        req.query?.to
                    )
            }
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
            auditId:
                normalizeIdentifier(
                    req.params?.auditId ??
                    req.params?.id,
                    "auditId"
                )
        },
        "ADMIN_AUDIT_LOG_RETRIEVED"
    );
}

/* =============================================================================
 * System settings
 * ============================================================================= */

async function getSystemSettings(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getSystemSettings",
        {},
        "ADMIN_SYSTEM_SETTINGS_RETRIEVED"
    );
}

async function updateSystemSettings(
    req,
    res
) {
    return executeWriteOperation(
        req,
        res,
        "updateSystemSettings",
        {
            input:
                req.body
        },
        "ADMIN_SYSTEM_SETTINGS_UPDATED"
    );
}

/* =============================================================================
 * Administrative summary
 * ============================================================================= */

async function getAdministrativeSummary(
    req,
    res
) {
    return executeReadOperation(
        req,
        res,
        "getAdministrativeSummary",
        {},
        "ADMIN_MANAGEMENT_SUMMARY_RETRIEVED"
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
        assertAdministrativeAccess(
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
        assertAdministrativeAccess(
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
                "ADMIN_MANAGEMENT_SUCCESS",

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
                error.code ||
                mapStatusToCode(
                    explicitStatus
                ),

            message:
                explicitStatus >= 500
                    ? "The administrative operation could not be completed."
                    : (
                        error.message ||
                        "The administrative request is invalid."
                    )
        };
    }

    switch (
        error?.code
    ) {
        case ERROR_CODES.INVALID_REQUEST:
            return {
                statusCode:
                    HTTP_STATUS.BAD_REQUEST,

                code:
                    ERROR_CODES.INVALID_REQUEST,

                message:
                    error.message ||
                    "The administrative request is invalid."
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
                    "You do not have permission to perform this operation."
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
                    "The requested administrative resource was not found."
            };

        case ERROR_CODES.CONFLICT:
            return {
                statusCode:
                    HTTP_STATUS.CONFLICT,

                code:
                    ERROR_CODES.CONFLICT,

                message:
                    error.message ||
                    "The administrative operation conflicts with the current state."
            };

        default:
            return {
                statusCode:
                    HTTP_STATUS.INTERNAL_SERVER_ERROR,

                code:
                    ERROR_CODES.INTERNAL_ERROR,

                message:
                    "The administrative operation could not be completed."
            };
    }
}

/* =============================================================================
 * Status -> error code
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
 * Error logging
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
            resolvePrincipal(
                req
            )?.id ??
            resolvePrincipal(
                req
            )?._id ??
            null,

        error: {
            name:
                error?.name ||
                "Error",

            code:
                error?.code ||
                null,

            message:
                error?.message ||
                "Unknown administrative error",

            statusCode:
                error?.statusCode ??
                error?.status ??
                null
        }
    };

    /*
     * Never log request bodies here.
     *
     * Administrative request bodies may contain:
     *   - passwords
     *   - tokens
     *   - personal information
     *   - permission structures
     *   - confidential administrative data
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
 * Generic async handler adapter
 * =============================================================================
 *
 * Useful when integrating with Express versions/configurations that require
 * explicit Promise rejection forwarding.
 */

function createHandler(
    handler
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "Admin management handler must be a function."
        );
    }

    return function adminManagementHandler(
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
            "administration",

        resource:
            "management",

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

        financialWrites:
            false,

        pagination: {
            defaultPage:
                DEFAULT_PAGE,

            defaultPageSize:
                DEFAULT_PAGE_SIZE,

            maxPageSize:
                MAX_PAGE_SIZE
        },

        supportedResources: [
            "users",
            "roles",
            "permissions",
            "auditLogs",
            "systemSettings"
        ]
    });
}

/* =============================================================================
 * Public controller
 * ============================================================================= */

const controller =
    {
        /* ---------------------------------------------------------------------
         * Users
         * ------------------------------------------------------------------ */

        listUsers:
            createHandler(
                listUsers
            ),

        getUsers:
            createHandler(
                listUsers
            ),

        getUser:
            createHandler(
                getUser
            ),

        createUser:
            createHandler(
                createUser
            ),

        updateUser:
            createHandler(
                updateUser
            ),

        deactivateUser:
            createHandler(
                deactivateUser
            ),

        activateUser:
            createHandler(
                activateUser
            ),

        deleteUser:
            createHandler(
                deleteUser
            ),

        resetUserCredentials:
            createHandler(
                resetUserCredentials
            ),

        changeUserRole:
            createHandler(
                changeUserRole
            ),

        updateUserPermissions:
            createHandler(
                updateUserPermissions
            ),

        /* ---------------------------------------------------------------------
         * Roles
         * ------------------------------------------------------------------ */

        listRoles:
            createHandler(
                listRoles
            ),

        getRoles:
            createHandler(
                listRoles
            ),

        getRole:
            createHandler(
                getRole
            ),

        createRole:
            createHandler(
                createRole
            ),

        updateRole:
            createHandler(
                updateRole
            ),

        deleteRole:
            createHandler(
                deleteRole
            ),

        /* ---------------------------------------------------------------------
         * Permissions
         * ------------------------------------------------------------------ */

        listPermissions:
            createHandler(
                listPermissions
            ),

        getPermissions:
            createHandler(
                listPermissions
            ),

        getPermissionsMatrix:
            createHandler(
                getPermissionsMatrix
            ),

        /* ---------------------------------------------------------------------
         * Audit
         * ------------------------------------------------------------------ */

        listAuditLogs:
            createHandler(
                listAuditLogs
            ),

        getAuditLogs:
            createHandler(
                listAuditLogs
            ),

        getAuditLog:
            createHandler(
                getAuditLog
            ),

        /* ---------------------------------------------------------------------
         * Settings
         * ------------------------------------------------------------------ */

        getSystemSettings:
            createHandler(
                getSystemSettings
            ),

        getSettings:
            createHandler(
                getSystemSettings
            ),

        updateSystemSettings:
            createHandler(
                updateSystemSettings
            ),

        updateSettings:
            createHandler(
                updateSystemSettings
            ),

        /* ---------------------------------------------------------------------
         * Administrative summary
         * ------------------------------------------------------------------ */

        getAdministrativeSummary:
            createHandler(
                getAdministrativeSummary
            ),

        getAdminSummary:
            createHandler(
                getAdministrativeSummary
            ),

        /* ---------------------------------------------------------------------
         * Diagnostics
         * ------------------------------------------------------------------ */

        getControllerMetadata
    };

module.exports =
    Object.freeze(
        controller
    );