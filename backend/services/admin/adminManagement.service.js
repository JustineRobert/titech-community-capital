"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Management Service
 * =============================================================================
 *
 * File:
 *   backend/services/admin/adminManagement.service.js
 *
 * Purpose:
 *   Canonical application-service boundary for TITech administrative
 *   management operations.
 *
 * Responsibilities:
 *
 *   - Administrative member/user discovery
 *   - Secure member lookup
 *   - Search and filtering
 *   - Account status management
 *   - Role management
 *   - Permission management
 *   - Account suspension/reactivation
 *   - Bulk administrative operations
 *   - Administrative audit integration
 *   - Tenant isolation
 *   - Operation authorization
 *   - Pagination normalization
 *   - Safe dependency resolution
 *   - Structured observability
 *
 * Architectural rule:
 *
 *   HTTP Controller
 *          │
 *          ▼
 *   AdminManagementService
 *          │
 *          ├── User / Member Service
 *          ├── Authorization Service
 *          ├── Audit Service
 *          ├── Notification Service
 *          └── Domain Services
 *
 * This service MUST NOT:
 *
 *   - receive Express req/res objects
 *   - send HTTP responses
 *   - mutate financial ledgers directly
 *   - mutate wallet balances directly
 *   - bypass domain services
 *   - expose passwords/tokens/secrets
 *   - trust tenantId supplied only by arbitrary request payload
 *
 * TITech is the canonical platform identity.
 *
 * =============================================================================
 */

const SERVICE_NAME =
    "adminManagement.service";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

/* =============================================================================
 * DEFAULTS / LIMITS
 * =============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    25;

const MAX_LIMIT =
    100;

const MAX_BULK_OPERATIONS =
    100;

const MAX_SEARCH_LENGTH =
    150;

const MAX_SORT_LENGTH =
    50;

/* =============================================================================
 * STATUS
 * =============================================================================
 */

const ACCOUNT_STATUS = Object.freeze({
    ACTIVE:
        "active",

    INACTIVE:
        "inactive",

    SUSPENDED:
        "suspended",

    PENDING:
        "pending",

    LOCKED:
        "locked",

    DISABLED:
        "disabled",

    DELETED:
        "deleted"
});

/* =============================================================================
 * ADMIN OPERATIONS
 * =============================================================================
 */

const OPERATIONS = Object.freeze({
    LIST:
        "list",

    SEARCH:
        "search",

    GET:
        "get",

    CREATE:
        "create",

    UPDATE:
        "update",

    ACTIVATE:
        "activate",

    DEACTIVATE:
        "deactivate",

    SUSPEND:
        "suspend",

    UNSUSPEND:
        "unsuspend",

    LOCK:
        "lock",

    UNLOCK:
        "unlock",

    DELETE:
        "delete",

    RESTORE:
        "restore",

    ROLE_UPDATE:
        "role.update",

    PERMISSION_UPDATE:
        "permission.update",

    BULK:
        "bulk"
});

/* =============================================================================
 * ERROR CODES
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_CONTEXT:
        "ADMIN_MANAGEMENT_INVALID_CONTEXT",

    TENANT_REQUIRED:
        "ADMIN_MANAGEMENT_TENANT_REQUIRED",

    FORBIDDEN:
        "ADMIN_MANAGEMENT_FORBIDDEN",

    INVALID_PARAMETER:
        "ADMIN_MANAGEMENT_INVALID_PARAMETER",

    INVALID_IDENTIFIER:
        "ADMIN_MANAGEMENT_INVALID_IDENTIFIER",

    USER_NOT_FOUND:
        "ADMIN_MANAGEMENT_USER_NOT_FOUND",

    DUPLICATE_OPERATION:
        "ADMIN_MANAGEMENT_DUPLICATE_OPERATION",

    BULK_LIMIT_EXCEEDED:
        "ADMIN_MANAGEMENT_BULK_LIMIT_EXCEEDED",

    INVALID_STATUS:
        "ADMIN_MANAGEMENT_INVALID_STATUS",

    INVALID_ROLE:
        "ADMIN_MANAGEMENT_INVALID_ROLE",

    INVALID_PERMISSION:
        "ADMIN_MANAGEMENT_INVALID_PERMISSION",

    DEPENDENCY_UNAVAILABLE:
        "ADMIN_MANAGEMENT_DEPENDENCY_UNAVAILABLE",

    CONFLICT:
        "ADMIN_MANAGEMENT_CONFLICT",

    INTERNAL_ERROR:
        "ADMIN_MANAGEMENT_INTERNAL_ERROR"
});

/* =============================================================================
 * PRIVILEGED ROLES
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

const MANAGEMENT_PERMISSIONS = Object.freeze([
    "admin.management",
    "admin.management.view",
    "admin.management.manage",
    "users.read",
    "users.manage",
    "members.read",
    "members.manage",
    "dashboard.admin",
    "system.admin",
    "*",
    "admin.*"
]);

const ROLE_MANAGEMENT_PERMISSIONS = Object.freeze([
    "admin.roles.manage",
    "users.roles.manage",
    "users.manage",
    "admin.management.manage",
    "*",
    "admin.*"
]);

const PERMISSION_MANAGEMENT_PERMISSIONS = Object.freeze([
    "admin.permissions.manage",
    "users.permissions.manage",
    "users.manage",
    "admin.management.manage",
    "*",
    "admin.*"
]);

/* =============================================================================
 * DEPENDENCY ALIASES
 * =============================================================================
 */

const DEPENDENCY_ALIASES = Object.freeze({
    user: [
        "userService",
        "usersService",
        "memberService",
        "membersService"
    ],

    member: [
        "memberService",
        "membersService",
        "userService",
        "usersService"
    ],

    auth: [
        "authService",
        "authenticationService"
    ],

    authorization: [
        "authorizationService",
        "permissionService",
        "rbacService",
        "accessControlService"
    ],

    audit: [
        "auditService",
        "auditLogService"
    ],

    notification: [
        "notificationService",
        "notificationsService"
    ],

    session: [
        "sessionService",
        "authSessionService"
    ],

    cache: [
        "cacheService",
        "redisService"
    ]
});

/* =============================================================================
 * METHOD ALIASES
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({
    /* User discovery -------------------------------------------------------- */

    listUsers: [
        "listUsers",
        "getUsers",
        "findUsers",
        "listMembers",
        "getMembers",
        "findMembers"
    ],

    searchUsers: [
        "searchUsers",
        "searchMembers",
        "findUsers",
        "findMembers"
    ],

    getUser: [
        "getUser",
        "getUserById",
        "findUserById",
        "getMember",
        "getMemberById",
        "findMemberById"
    ],

    /* User mutation --------------------------------------------------------- */

    createUser: [
        "createUser",
        "createMember"
    ],

    updateUser: [
        "updateUser",
        "updateMember",
        "editUser",
        "editMember"
    ],

    activateUser: [
        "activateUser",
        "activateMember",
        "enableUser",
        "enableMember"
    ],

    deactivateUser: [
        "deactivateUser",
        "deactivateMember",
        "disableUser",
        "disableMember"
    ],

    suspendUser: [
        "suspendUser",
        "suspendMember"
    ],

    unsuspendUser: [
        "unsuspendUser",
        "unsuspendMember",
        "reinstateUser",
        "reinstateMember"
    ],

    lockUser: [
        "lockUser",
        "lockAccount"
    ],

    unlockUser: [
        "unlockUser",
        "unlockAccount"
    ],

    deleteUser: [
        "deleteUser",
        "deleteMember",
        "removeUser",
        "removeMember"
    ],

    restoreUser: [
        "restoreUser",
        "restoreMember"
    ],

    /* Roles ----------------------------------------------------------------- */

    getUserRoles: [
        "getUserRoles",
        "getRolesForUser",
        "getMemberRoles"
    ],

    setUserRoles: [
        "setUserRoles",
        "updateUserRoles",
        "assignRoles",
        "setMemberRoles"
    ],

    addUserRole: [
        "addUserRole",
        "assignRole",
        "addMemberRole"
    ],

    removeUserRole: [
        "removeUserRole",
        "revokeRole",
        "removeMemberRole"
    ],

    /* Permissions ----------------------------------------------------------- */

    getUserPermissions: [
        "getUserPermissions",
        "getPermissionsForUser",
        "getMemberPermissions"
    ],

    setUserPermissions: [
        "setUserPermissions",
        "updateUserPermissions",
        "assignPermissions",
        "setMemberPermissions"
    ],

    addUserPermission: [
        "addUserPermission",
        "grantPermission",
        "addMemberPermission"
    ],

    removeUserPermission: [
        "removeUserPermission",
        "revokePermission",
        "removeMemberPermission"
    ],

    /* Bulk ------------------------------------------------------------------ */

    bulkUpdateUsers: [
        "bulkUpdateUsers",
        "bulkUpdateMembers",
        "bulkUpdate"
    ],

    bulkActivateUsers: [
        "bulkActivateUsers",
        "bulkActivateMembers"
    ],

    bulkDeactivateUsers: [
        "bulkDeactivateUsers",
        "bulkDeactivateMembers"
    ],

    /* Audit ----------------------------------------------------------------- */

    recordAudit: [
        "recordAudit",
        "createAuditLog",
        "writeAuditLog",
        "logAdminAction",
        "record"
    ],

    /* Notifications --------------------------------------------------------- */

    notifyUser: [
        "notifyUser",
        "sendUserNotification",
        "sendNotification"
    ],

    /* Sessions -------------------------------------------------------------- */

    revokeUserSessions: [
        "revokeUserSessions",
        "invalidateUserSessions",
        "logoutAllSessions",
        "revokeSessions"
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

function normalizeIdentifier(
    value
) {
    const identifier =
        normalizeString(
            value
        );

    if (
        !identifier
    ) {
        const error =
            new Error(
                "A valid user identifier is required."
            );

        error.code =
            ERROR_CODES.INVALID_IDENTIFIER;

        throw error;
    }

    if (
        identifier.length >
        200
    ) {
        const error =
            new Error(
                "The supplied user identifier is invalid."
            );

        error.code =
            ERROR_CODES.INVALID_IDENTIFIER;

        throw error;
    }

    return identifier;
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

function normalizePage(
    value
) {
    return normalizePositiveInteger(
        value,
        DEFAULT_PAGE,
        Number.MAX_SAFE_INTEGER
    );
}

function normalizeLimit(
    value
) {
    return normalizePositiveInteger(
        value,
        DEFAULT_LIMIT,
        MAX_LIMIT
    );
}

function normalizeSearch(
    value
) {
    const search =
        normalizeString(
            value
        );

    if (
        !search
    ) {
        return null;
    }

    return search.slice(
        0,
        MAX_SEARCH_LENGTH
    );
}

function normalizeSort(
    value
) {
    const sort =
        normalizeString(
            value,
            "createdAt"
        );

    return sort.slice(
        0,
        MAX_SORT_LENGTH
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
                "A tenant context is required for administrative management."
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
            null,

        session:
            context.session ??
            null,

        metadata:
            context.metadata ??
            {}
    };
}

/* =============================================================================
 * PRINCIPAL HELPERS
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

    return [
        ...new Set(
            roles
                .filter(Boolean)
                .map(
                    role =>
                        String(
                            role
                        )
                            .trim()
                            .toLowerCase()
                )
        )
    ];
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

    return [
        ...new Set(
            permissions
                .filter(Boolean)
                .map(
                    permission =>
                        String(
                            permission
                        )
                            .trim()
                            .toLowerCase()
                )
        )
    ];
}

function hasRole(
    principal,
    roles
) {
    const principalRoles =
        resolveRoles(
            principal
        );

    return principalRoles.some(
        role =>
            roles.includes(
                role
            )
    );
}

function hasPermission(
    principal,
    permissions
) {
    const principalPermissions =
        resolvePermissions(
            principal
        );

    return principalPermissions.some(
        permission =>
            permissions.includes(
                permission
            )
    );
}

/* =============================================================================
 * SERVICE
 * =============================================================================
 */

class AdminManagementService {

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
            const service =
                this.tryResolveService(
                    name
                );

            if (
                service
            ) {
                return service;
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
                    // Continue.
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
                    // Continue.
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
                    // Continue.
                }
            }

            if (
                container[
                    name
                ]
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
        const payload = {
            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            message,

            ...metadata
        };

        if (
            this.logger &&
            typeof
                this.logger[
                    level
                ] === "function"
        ) {
            try {
                this.logger[
                    level
                ](
                    payload
                );

                return;
            } catch {
                // Logging must never break management operations.
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
                // Ignore.
            }
        }
    }

    /* =========================================================================
     * METRICS
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {
        if (
            !this.metrics
        ) {
            return;
        }

        try {
            if (
                typeof
                    this.metrics.increment ===
                    "function"
            ) {
                this.metrics.increment(
                    name,
                    value,
                    labels
                );

                return;
            }

            if (
                typeof
                    this.metrics.counter ===
                    "function"
            ) {
                const counter =
                    this.metrics.counter(
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
            // Metrics are non-critical.
        }
    }

    /* =========================================================================
     * AUTHORIZATION
     * =========================================================================
     */

    assertManagementAccess(
        context,
        options = {}
    ) {
        const principal =
            context.principal;

        /*
         * Router/controller authorization remains the primary security
         * boundary. Service-level checks provide defense in depth.
         */
        if (
            !principal
        ) {
            return true;
        }

        const roles =
            options.roles ??
            PLATFORM_ROLES;

        const permissions =
            options.permissions ??
            MANAGEMENT_PERMISSIONS;

        if (
            principal.isSuperAdmin ===
                true ||
            principal.isAdmin ===
                true ||
            hasRole(
                principal,
                roles
            ) ||
            hasPermission(
                principal,
                permissions
            )
        ) {
            return true;
        }

        const error =
            new Error(
                "The authenticated principal is not authorized to perform this administrative operation."
            );

        error.code =
            ERROR_CODES.FORBIDDEN;

        throw error;
    }

    assertRoleManagementAccess(
        context
    ) {
        return this.assertManagementAccess(
            context,
            {
                permissions:
                    ROLE_MANAGEMENT_PERMISSIONS
            }
        );
    }

    assertPermissionManagementAccess(
        context
    ) {
        return this.assertManagementAccess(
            context,
            {
                permissions:
                    PERMISSION_MANAGEMENT_PERMISSIONS
            }
        );
    }

    /* =========================================================================
     * DEPENDENCY INVOCATION
     * =========================================================================
     */

    async invoke(
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
                        `Required administrative dependency "${type}" is unavailable.`
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
                        `Administrative dependency "${type}" does not support "${operation}".`
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
     * AUDIT
     * =========================================================================
     */

    async audit(
        operation,
        context,
        metadata = {}
    ) {
        const auditService =
            this.resolveDependency(
                "audit"
            );

        if (
            !auditService
        ) {
            this.log(
                "warn",
                "Audit service unavailable during administrative operation.",
                {
                    operation,
                    actorId:
                        context.actorId,
                    tenantId:
                        context.tenantId
                }
            );

            return null;
        }

        const method =
            this.resolveMethod(
                auditService,
                "recordAudit"
            );

        if (
            !method
        ) {
            return null;
        }

        const payload = {
            tenantId:
                context.tenantId,

            actorId:
                context.actorId,

            action:
                operation,

            resource:
                "administrative-management",

            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            metadata:
                sanitizeAuditMetadata(
                    metadata
                )
        };

        try {
            return await method(
                payload,
                context
            );
        } catch (error) {
            /*
             * Audit failures should be visible and observable.
             *
             * Whether an audit failure should fail the business operation
             * is a platform-level policy decision. This service defaults to
             * non-blocking audit writes for management reads and lifecycle
             * operations.
             */
            this.log(
                "error",
                "Administrative audit write failed.",
                {
                    operation,
                    actorId:
                        context.actorId,
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

            this.incrementMetric(
                "titech_admin_management_audit_failure_total"
            );

            return null;
        }
    }

    /* =========================================================================
     * NORMALIZE LIST OPTIONS
     * =========================================================================
     */

    normalizeListOptions(
        input = {}
    ) {
        return {
            page:
                normalizePage(
                    input.page
                ),

            limit:
                normalizeLimit(
                    input.limit ??
                    input.pageSize
                ),

            search:
                normalizeSearch(
                    input.search ??
                    input.q ??
                    input.query
                ),

            status:
                normalizeString(
                    input.status
                ),

            role:
                normalizeString(
                    input.role
                ),

            sort:
                normalizeSort(
                    input.sort ??
                    input.sortBy
                ),

            order:
                String(
                    input.order ??
                    input.sortOrder ??
                    "desc"
                )
                    .trim()
                    .toLowerCase() ===
                    "asc"
                    ? "asc"
                    : "desc",

            includeDeleted:
                normalizeBoolean(
                    input.includeDeleted,
                    false
                ),

            includeSuspended:
                normalizeBoolean(
                    input.includeSuspended,
                    true
                )
        };
    }

    /* =========================================================================
     * LIST USERS
     * =========================================================================
     */

    async listUsers(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const options =
            this.normalizeListOptions(
                input
            );

        const startedAt =
            this.clock.now();

        this.incrementMetric(
            "titech_admin_management_list_total"
        );

        const result =
            await this.invoke(
                "user",
                "listUsers",
                {
                    ...options,

                    filters:
                        this.buildFilters(
                            options
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        const normalized =
            normalizePaginatedResult(
                result,
                options
            );

        const duration =
            this.clock.now()
                .getTime() -
            startedAt.getTime();

        this.log(
            "info",
            "Administrative user listing completed.",
            {
                tenantId:
                    normalizedContext.tenantId,

                actorId:
                    normalizedContext.actorId,

                requestId:
                    normalizedContext.requestId,

                page:
                    options.page,

                limit:
                    options.limit,

                durationMs:
                    duration
            }
        );

        return normalized;
    }

    /* =========================================================================
     * SEARCH
     * =========================================================================
     */

    async searchUsers(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const search =
            normalizeSearch(
                input.search ??
                input.q ??
                input.query
            );

        if (
            !search
        ) {
            const error =
                new Error(
                    "A search term is required."
                );

            error.code =
                ERROR_CODES.INVALID_PARAMETER;

            throw error;
        }

        const options =
            this.normalizeListOptions(
                {
                    ...input,
                    search
                }
            );

        const result =
            await this.invoke(
                "user",
                "searchUsers",
                {
                    ...options,
                    search
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        return normalizePaginatedResult(
            result,
            options
        );
    }

    /* =========================================================================
     * GET USER
     * =========================================================================
     */

    async getUser(
        userId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const result =
            await this.invoke(
                "user",
                "getUser",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    includeRoles:
                        normalizeBoolean(
                            input.includeRoles,
                            true
                        ),

                    includePermissions:
                        normalizeBoolean(
                            input.includePermissions,
                            true
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        if (
            !result
        ) {
            const error =
                new Error(
                    "The requested user could not be found."
                );

            error.code =
                ERROR_CODES.USER_NOT_FOUND;

            throw error;
        }

        return sanitizeUser(
            result,
            {
                includeRoles:
                    normalizeBoolean(
                        input.includeRoles,
                        true
                    ),

                includePermissions:
                    normalizeBoolean(
                        input.includePermissions,
                        true
                    )
            }
        );
    }

    /* =========================================================================
     * CREATE USER
     * =========================================================================
     */

    async createUser(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const payload =
            sanitizeCreatePayload(
                input
            );

        const result =
            await this.invoke(
                "user",
                "createUser",
                payload,
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.CREATE,
            normalizedContext,
            {
                userId:
                    extractUserId(
                        result
                    ),

                fields:
                    Object.keys(
                        payload
                    )
            }
        );

        return sanitizeUser(
            result
        );
    }

    /* =========================================================================
     * UPDATE USER
     * =========================================================================
     */

    async updateUser(
        userId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const payload =
            sanitizeUpdatePayload(
                input
            );

        const result =
            await this.invoke(
                "user",
                "updateUser",
                {
                    ...payload,

                    userId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                fields:
                    Object.keys(
                        payload
                    )
            }
        );

        return sanitizeUser(
            result
        );
    }

    /* =========================================================================
     * ACTIVATE
     * =========================================================================
     */

    async activateUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.ACTIVE,
            input,
            context,
            OPERATIONS.ACTIVATE
        );
    }

    /* =========================================================================
     * DEACTIVATE
     * =========================================================================
     */

    async deactivateUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.INACTIVE,
            input,
            context,
            OPERATIONS.DEACTIVATE
        );
    }

    /* =========================================================================
     * SUSPEND
     * =========================================================================
     */

    async suspendUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.SUSPENDED,
            input,
            context,
            OPERATIONS.SUSPEND
        );
    }

    /* =========================================================================
     * UNSUSPEND
     * =========================================================================
     */

    async unsuspendUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.ACTIVE,
            input,
            context,
            OPERATIONS.UNSUSPEND
        );
    }

    /* =========================================================================
     * LOCK
     * =========================================================================
     */

    async lockUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.LOCKED,
            input,
            context,
            OPERATIONS.LOCK
        );
    }

    /* =========================================================================
     * UNLOCK
     * =========================================================================
     */

    async unlockUser(
        userId,
        input = {},
        context = {}
    ) {
        return this.changeAccountStatus(
            userId,
            ACCOUNT_STATUS.ACTIVE,
            input,
            context,
            OPERATIONS.UNLOCK
        );
    }

    /* =========================================================================
     * STATUS CHANGE
     * =========================================================================
     */

    async changeAccountStatus(
        userId,
        status,
        input = {},
        context = {},
        operation = OPERATIONS.UPDATE
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        if (
            !Object.values(
                ACCOUNT_STATUS
            ).includes(
                status
            )
        ) {
            const error =
                new Error(
                    `Unsupported account status "${status}".`
                );

            error.code =
                ERROR_CODES.INVALID_STATUS;

            throw error;
        }

        /*
         * Prevent an administrator from accidentally changing their own
         * security-critical account state unless the domain service explicitly
         * allows it.
         */
        if (
            normalizedContext.actorId &&
            normalizedContext.actorId ===
                identifier &&
            [
                OPERATIONS.SUSPEND,
                OPERATIONS.DEACTIVATE,
                OPERATIONS.LOCK
            ].includes(
                operation
            )
        ) {
            const error =
                new Error(
                    "An administrator cannot perform this security-sensitive operation against their own account."
                );

            error.code =
                ERROR_CODES.CONFLICT;

            throw error;
        }

        const operationMap = {
            [OPERATIONS.ACTIVATE]:
                "activateUser",

            [OPERATIONS.DEACTIVATE]:
                "deactivateUser",

            [OPERATIONS.SUSPEND]:
                "suspendUser",

            [OPERATIONS.UNSUSPEND]:
                "unsuspendUser",

            [OPERATIONS.LOCK]:
                "lockUser",

            [OPERATIONS.UNLOCK]:
                "unlockUser"
        };

        const methodOperation =
            operationMap[
                operation
            ];

        let result;

        if (
            methodOperation
        ) {
            result =
                await this.invoke(
                    "user",
                    methodOperation,
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        status,

                        reason:
                            normalizeString(
                                input.reason
                            ),

                        metadata:
                            input.metadata ??
                            {}
                    },
                    normalizedContext,
                    {
                        required:
                            false
                    }
                );
        }

        /*
         * Generic status update fallback.
         */
        if (
            result === null ||
            result === undefined
        ) {
            result =
                await this.invoke(
                    "user",
                    "updateUser",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        status,

                        accountStatus:
                            status,

                        reason:
                            normalizeString(
                                input.reason
                            ),

                        metadata:
                            input.metadata ??
                            {}
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        /*
         * Security-sensitive state transitions should invalidate sessions.
         */
        if (
            [
                OPERATIONS.SUSPEND,
                OPERATIONS.DEACTIVATE,
                OPERATIONS.LOCK
            ].includes(
                operation
            )
        ) {
            await this.invoke(
                "session",
                "revokeUserSessions",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason,
                            operation
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );
        }

        await this.audit(
            operation,
            normalizedContext,
            {
                userId:
                    identifier,

                status,

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return sanitizeUser(
            result
        );
    }

    /* =========================================================================
     * DELETE
     * =========================================================================
     */

    async deleteUser(
        userId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        if (
            normalizedContext.actorId &&
            normalizedContext.actorId ===
                identifier
        ) {
            const error =
                new Error(
                    "An administrator cannot delete their own account."
                );

            error.code =
                ERROR_CODES.CONFLICT;

            throw error;
        }

        const result =
            await this.invoke(
                "user",
                "deleteUser",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        ),

                    softDelete:
                        normalizeBoolean(
                            input.softDelete,
                            true
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.DELETE,
            normalizedContext,
            {
                userId:
                    identifier,

                softDelete:
                    normalizeBoolean(
                        input.softDelete,
                        true
                    ),

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return sanitizeUser(
            result
        );
    }

    /* =========================================================================
     * RESTORE
     * =========================================================================
     */

    async restoreUser(
        userId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const result =
            await this.invoke(
                "user",
                "restoreUser",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.RESTORE,
            normalizedContext,
            {
                userId:
                    identifier,

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return sanitizeUser(
            result
        );
    }

    /* =========================================================================
     * ROLES
     * =========================================================================
     */

    async getUserRoles(
        userId,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const result =
            await this.invoke(
                "authorization",
                "getUserRoles",
                {
                    userId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result !== null
        ) {
            return normalizeArray(
                result
            );
        }

        return normalizeArray(
            await this.invoke(
                "user",
                "getUserRoles",
                {
                    userId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext
            )
        );
    }

    async setUserRoles(
        userId,
        roles,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRoleManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedRoles =
            normalizeRoles(
                roles
            );

        const result =
            await this.invoke(
                "authorization",
                "setUserRoles",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    roles:
                        normalizedRoles
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "setUserRoles",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        roles:
                            normalizedRoles
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.ROLE_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                roles:
                    normalizedRoles
            }
        );

        return normalizeArray(
            finalResult
        );
    }

    async addUserRole(
        userId,
        role,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRoleManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedRole =
            normalizeRole(
                role
            );

        const result =
            await this.invoke(
                "authorization",
                "addUserRole",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    role:
                        normalizedRole
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "addUserRole",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        role:
                            normalizedRole
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.ROLE_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                operation:
                    "add",

                role:
                    normalizedRole
            }
        );

        return finalResult;
    }

    async removeUserRole(
        userId,
        role,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRoleManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedRole =
            normalizeRole(
                role
            );

        /*
         * Prevent accidental removal of the final platform administrator role
         * through a naive service call. Domain-level policy can impose stricter
         * rules.
         */
        const currentRoles =
            await this.getUserRoles(
                identifier,
                normalizedContext
            );

        if (
            Array.isArray(
                currentRoles
            ) &&
            currentRoles.length ===
                1 &&
            currentRoles[0] ===
                normalizedRole &&
            PLATFORM_ROLES.includes(
                normalizedRole
            )
        ) {
            const error =
                new Error(
                    "The final privileged role cannot be removed through this operation."
                );

            error.code =
                ERROR_CODES.CONFLICT;

            throw error;
        }

        const result =
            await this.invoke(
                "authorization",
                "removeUserRole",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    role:
                        normalizedRole
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "removeUserRole",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        role:
                            normalizedRole
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.ROLE_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                operation:
                    "remove",

                role:
                    normalizedRole
            }
        );

        return finalResult;
    }

    /* =========================================================================
     * PERMISSIONS
     * =========================================================================
     */

    async getUserPermissions(
        userId,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const result =
            await this.invoke(
                "authorization",
                "getUserPermissions",
                {
                    userId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result !== null
        ) {
            return normalizeArray(
                result
            );
        }

        return normalizeArray(
            await this.invoke(
                "user",
                "getUserPermissions",
                {
                    userId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext
            )
        );
    }

    async setUserPermissions(
        userId,
        permissions,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertPermissionManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedPermissions =
            normalizePermissions(
                permissions
            );

        const result =
            await this.invoke(
                "authorization",
                "setUserPermissions",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    permissions:
                        normalizedPermissions
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "setUserPermissions",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        permissions:
                            normalizedPermissions
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.PERMISSION_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                permissions:
                    normalizedPermissions
            }
        );

        return normalizeArray(
            finalResult
        );
    }

    async addUserPermission(
        userId,
        permission,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertPermissionManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedPermission =
            normalizePermission(
                permission
            );

        const result =
            await this.invoke(
                "authorization",
                "addUserPermission",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    permission:
                        normalizedPermission
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "addUserPermission",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        permission:
                            normalizedPermission
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.PERMISSION_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                operation:
                    "add",

                permission:
                    normalizedPermission
            }
        );

        return finalResult;
    }

    async removeUserPermission(
        userId,
        permission,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertPermissionManagementAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                userId
            );

        const normalizedPermission =
            normalizePermission(
                permission
            );

        const result =
            await this.invoke(
                "authorization",
                "removeUserPermission",
                {
                    userId:
                        identifier,

                    id:
                        identifier,

                    permission:
                        normalizedPermission
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        let finalResult =
            result;

        if (
            finalResult === null ||
            finalResult === undefined
        ) {
            finalResult =
                await this.invoke(
                    "user",
                    "removeUserPermission",
                    {
                        userId:
                            identifier,

                        id:
                            identifier,

                        permission:
                            normalizedPermission
                    },
                    normalizedContext,
                    {
                        required:
                            true
                    }
                );
        }

        await this.audit(
            OPERATIONS.PERMISSION_UPDATE,
            normalizedContext,
            {
                userId:
                    identifier,

                operation:
                    "remove",

                permission:
                    normalizedPermission
            }
        );

        return finalResult;
    }

    /* =========================================================================
     * BULK MANAGEMENT
     * =========================================================================
     */

    async bulkUpdateUsers(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const ids =
            normalizeIdentifiers(
                input.userIds ??
                input.ids ??
                input.members
            );

        if (
            ids.length >
            MAX_BULK_OPERATIONS
        ) {
            const error =
                new Error(
                    `Bulk management is limited to ${MAX_BULK_OPERATIONS} users per operation.`
                );

            error.code =
                ERROR_CODES.BULK_LIMIT_EXCEEDED;

            throw error;
        }

        if (
            !ids.length
        ) {
            const error =
                new Error(
                    "At least one user identifier is required for a bulk operation."
                );

            error.code =
                ERROR_CODES.INVALID_PARAMETER;

            throw error;
        }

        const updates =
            sanitizeUpdatePayload(
                input.updates ??
                input
            );

        delete updates.userIds;
        delete updates.ids;
        delete updates.members;

        const result =
            await this.invoke(
                "user",
                "bulkUpdateUsers",
                {
                    userIds:
                        ids,

                    ids,

                    updates
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result !== null &&
            result !== undefined
        ) {
            await this.audit(
                OPERATIONS.BULK,
                normalizedContext,
                {
                    userIds:
                        ids,

                    count:
                        ids.length,

                    fields:
                        Object.keys(
                            updates
                        )
                }
            );

            return normalizeBulkResult(
                result,
                ids
            );
        }

        /*
         * Safe fallback:
         *
         * Execute through the canonical user domain service one user at a time.
         * This is intentionally sequential to avoid uncontrolled write
         * amplification against the database.
         */
        const results = [];

        for (
            const id of
                ids
        ) {
            try {
                const value =
                    await this.invoke(
                        "user",
                        "updateUser",
                        {
                            userId:
                                id,

                            id,

                            ...updates
                        },
                        normalizedContext,
                        {
                            required:
                                true
                        }
                    );

                results.push({
                    userId:
                        id,

                    success:
                        true,

                    data:
                        sanitizeUser(
                            value
                        )
                });
            } catch (error) {
                results.push({
                    userId:
                        id,

                    success:
                        false,

                    error:
                        normalizeError(
                            error
                        )
                });
            }
        }

        await this.audit(
            OPERATIONS.BULK,
            normalizedContext,
            {
                userIds:
                    ids,

                count:
                    ids.length,

                fields:
                    Object.keys(
                        updates
                    ),

                successful:
                    results.filter(
                        item =>
                            item.success
                    ).length,

                failed:
                    results.filter(
                        item =>
                            !item.success
                    ).length
            }
        );

        return {
            total:
                ids.length,

            successful:
                results.filter(
                    item =>
                        item.success
                ).length,

            failed:
                results.filter(
                    item =>
                        !item.success
                ).length,

            results
        };
    }

    /* =========================================================================
     * BULK ACTIVATE
     * =========================================================================
     */

    async bulkActivateUsers(
        userIds,
        input = {},
        context = {}
    ) {
        return this.bulkStatusChange(
            userIds,
            ACCOUNT_STATUS.ACTIVE,
            input,
            context,
            OPERATIONS.ACTIVATE
        );
    }

    /* =========================================================================
     * BULK DEACTIVATE
     * =========================================================================
     */

    async bulkDeactivateUsers(
        userIds,
        input = {},
        context = {}
    ) {
        return this.bulkStatusChange(
            userIds,
            ACCOUNT_STATUS.INACTIVE,
            input,
            context,
            OPERATIONS.DEACTIVATE
        );
    }

    /* =========================================================================
     * BULK STATUS CHANGE
     * =========================================================================
     */

    async bulkStatusChange(
        userIds,
        status,
        input = {},
        context = {},
        operation = OPERATIONS.UPDATE
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertManagementAccess(
            normalizedContext
        );

        const ids =
            normalizeIdentifiers(
                userIds
            );

        if (
            ids.length >
            MAX_BULK_OPERATIONS
        ) {
            const error =
                new Error(
                    `Bulk management is limited to ${MAX_BULK_OPERATIONS} users per operation.`
                );

            error.code =
                ERROR_CODES.BULK_LIMIT_EXCEEDED;

            throw error;
        }

        if (
            !Object.values(
                ACCOUNT_STATUS
            ).includes(
                status
            )
        ) {
            const error =
                new Error(
                    `Unsupported account status "${status}".`
                );

            error.code =
                ERROR_CODES.INVALID_STATUS;

            throw error;
        }

        const result =
            await this.invoke(
                "user",
                "bulkUpdateUsers",
                {
                    userIds:
                        ids,

                    ids,

                    updates: {
                        status,

                        accountStatus:
                            status,

                        reason:
                            normalizeString(
                                input.reason
                            )
                    }
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result !== null &&
            result !== undefined
        ) {
            await this.audit(
                operation,
                normalizedContext,
                {
                    userIds:
                        ids,

                    count:
                        ids.length,

                    status,

                    reason:
                        normalizeString(
                            input.reason
                        )
                }
            );

            return normalizeBulkResult(
                result,
                ids
            );
        }

        const results = [];

        for (
            const id of
                ids
        ) {
            try {
                const value =
                    await this.changeAccountStatus(
                        id,
                        status,
                        input,
                        normalizedContext,
                        operation
                    );

                results.push({
                    userId:
                        id,

                    success:
                        true,

                    data:
                        sanitizeUser(
                            value
                        )
                });
            } catch (error) {
                results.push({
                    userId:
                        id,

                    success:
                        false,

                    error:
                        normalizeError(
                            error
                        )
                });
            }
        }

        return {
            total:
                ids.length,

            successful:
                results.filter(
                    item =>
                        item.success
                ).length,

            failed:
                results.filter(
                    item =>
                        !item.success
                ).length,

            results
        };
    }

    /* =========================================================================
     * FILTER BUILDER
     * =========================================================================
     */

    buildFilters(
        options
    ) {
        const filters = {};

        if (
            options.status
        ) {
            filters.status =
                options.status;
        }

        if (
            options.role
        ) {
            filters.role =
                options.role;
        }

        if (
            !options.includeDeleted
        ) {
            filters.includeDeleted =
                false;
        }

        if (
            !options.includeSuspended
        ) {
            filters.excludeSuspended =
                true;
        }

        return filters;
    }

    /* =========================================================================
     * METADATA
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
                "management",

            multiTenant:
                true,

            financialMutation:
                false,

            directDatabaseAccess:
                false,

            directHTTPAccess:
                false,

            auditAware:
                true,

            sessionSecurityAware:
                true,

            supportedOperations:
                Object.values(
                    OPERATIONS
                )
        });
    }
}

/* =============================================================================
 * PAYLOAD SANITIZATION
 * =============================================================================
 */

const SENSITIVE_INPUT_FIELDS =
    Object.freeze([
        "password",
        "passwordHash",
        "currentPassword",
        "newPassword",
        "confirmPassword",
        "refreshToken",
        "accessToken",
        "token",
        "secret",
        "otp",
        "otpCode",
        "pin",
        "pinCode",
        "securityAnswer",
        "mfaSecret"
    ]);

const IMMUTABLE_FIELDS =
    Object.freeze([
        "_id",
        "id",
        "tenantId",
        "createdAt",
        "updatedAt",
        "passwordHash",
        "refreshTokens"
    ]);

function sanitizeCreatePayload(
    input = {}
) {
    const payload = {
        ...input
    };

    for (
        const field of
            SENSITIVE_INPUT_FIELDS
    ) {
        delete payload[
            field
        ];
    }

    /*
     * Do not permit arbitrary tenant switching through admin payloads.
     * tenantId is supplied from the trusted execution context.
     */
    delete payload.tenantId;

    return payload;
}

function sanitizeUpdatePayload(
    input = {}
) {
    const payload = {
        ...input
    };

    for (
        const field of
            IMMUTABLE_FIELDS
    ) {
        delete payload[
            field
        ];
    }

    for (
        const field of
            SENSITIVE_INPUT_FIELDS
    ) {
        delete payload[
            field
        ];
    }

    delete payload.tenantId;

    return payload;
}

function sanitizeUser(
    user,
    options = {}
) {
    if (
        !user
    ) {
        return null;
    }

    const source =
        typeof user.toObject ===
            "function"
            ? user.toObject()
            : {
                ...user
            };

    for (
        const field of
            SENSITIVE_INPUT_FIELDS
    ) {
        delete source[
            field
        ];
    }

    delete source.__v;

    if (
        options.includeRoles ===
        false
    ) {
        delete source.roles;
    }

    if (
        options.includePermissions ===
        false
    ) {
        delete source.permissions;
        delete source.permissionCodes;
    }

    return source;
}

function sanitizeAuditMetadata(
    metadata
) {
    if (
        !metadata ||
        typeof metadata !==
            "object"
    ) {
        return {};
    }

    const sanitized =
        JSON.parse(
            JSON.stringify(
                metadata,
                (
                    key,
                    value
                ) => {
                    if (
                        SENSITIVE_INPUT_FIELDS.includes(
                            key
                        )
                    ) {
                        return "[REDACTED]";
                    }

                    return value;
                }
            )
        );

    return sanitized;
}

/* =============================================================================
 * ROLE / PERMISSION NORMALIZATION
 * =============================================================================
 */

function normalizeRoles(
    roles
) {
    if (
        !Array.isArray(
            roles
        )
    ) {
        roles =
            roles === undefined ||
            roles === null
                ? []
                : [
                    roles
                ];
    }

    const normalized =
        roles
            .map(
                role =>
                    normalizeString(
                        role
                    )
            )
            .filter(Boolean)
            .map(
                role =>
                    role
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            "_"
                        )
            );

    if (
        normalized.some(
            role =>
                role.length >
                100
        )
    ) {
        const error =
            new Error(
                "One or more supplied roles are invalid."
            );

        error.code =
            ERROR_CODES.INVALID_ROLE;

        throw error;
    }

    return [
        ...new Set(
            normalized
        )
    ];
}

function normalizeRole(
    role
) {
    const normalized =
        normalizeRoles(
            [
                role
            ]
        );

    if (
        normalized.length !==
        1
    ) {
        const error =
            new Error(
                "A valid role is required."
            );

        error.code =
            ERROR_CODES.INVALID_ROLE;

        throw error;
    }

    return normalized[0];
}

function normalizePermissions(
    permissions
) {
    if (
        !Array.isArray(
            permissions
        )
    ) {
        permissions =
            permissions === undefined ||
            permissions === null
                ? []
                : [
                    permissions
                ];
    }

    const normalized =
        permissions
            .map(
                permission =>
                    normalizeString(
                        permission
                    )
            )
            .filter(Boolean)
            .map(
                permission =>
                    permission
                        .toLowerCase()
                        .trim()
            );

    if (
        normalized.some(
            permission =>
                permission.length >
                200
        )
    ) {
        const error =
            new Error(
                "One or more supplied permissions are invalid."
            );

        error.code =
            ERROR_CODES.INVALID_PERMISSION;

        throw error;
    }

    return [
        ...new Set(
            normalized
        )
    ];
}

function normalizePermission(
    permission
) {
    const normalized =
        normalizePermissions(
            [
                permission
            ]
        );

    if (
        normalized.length !==
        1
    ) {
        const error =
            new Error(
                "A valid permission is required."
            );

        error.code =
            ERROR_CODES.INVALID_PERMISSION;

        throw error;
    }

    return normalized[0];
}

/* =============================================================================
 * IDENTIFIERS
 * =============================================================================
 */

function normalizeIdentifiers(
    identifiers
) {
    if (
        !Array.isArray(
            identifiers
        )
    ) {
        identifiers =
            identifiers === undefined ||
            identifiers === null
                ? []
                : [
                    identifiers
                ];
    }

    const normalized =
        identifiers
            .map(
                normalizeIdentifier
            );

    return [
        ...new Set(
            normalized
        )
    ];
}

function extractUserId(
    user
) {
    if (
        !user
    ) {
        return null;
    }

    return (
        user.id ??
        user._id ??
        user.userId ??
        user.memberId ??
        null
    );
}

/* =============================================================================
 * PAGINATION
 * =============================================================================
 */

function normalizePaginatedResult(
    result,
    options
) {
    if (
        !result
    ) {
        return {
            data: [],
            pagination: {
                page:
                    options.page,

                limit:
                    options.limit,

                total:
                    0,

                totalPages:
                    0,

                hasNextPage:
                    false,

                hasPreviousPage:
                    options.page >
                    1
            }
        };
    }

    const source =
        result.data &&
        !Array.isArray(
            result.data
        )
            ? result.data
            : result;

    const items =
        Array.isArray(
            result
        )
            ? result
            : Array.isArray(
                result.items
            )
                ? result.items
                : Array.isArray(
                    result.results
                )
                    ? result.results
                    : Array.isArray(
                        result.data
                    )
                        ? result.data
                        : [];

    const total =
        Number.isFinite(
            Number(
                result.total
            )
        )
            ? Number(
                result.total
            )
            : Number.isFinite(
                Number(
                    source.total
                )
            )
                ? Number(
                    source.total
                )
                : items.length;

    const page =
        Number.isFinite(
            Number(
                result.page
            )
        )
            ? Number(
                result.page
            )
            : options.page;

    const limit =
        Number.isFinite(
            Number(
                result.limit ??
                result.pageSize
            )
        )
            ? Number(
                result.limit ??
                result.pageSize
            )
            : options.limit;

    const totalPages =
        total > 0
            ? Math.ceil(
                total /
                limit
            )
            : 0;

    return {
        data:
            items.map(
                item =>
                    sanitizeUser(
                        item
                    )
            ),

        pagination: {
            page,

            limit,

            total,

            totalPages,

            hasNextPage:
                page <
                totalPages,

            hasPreviousPage:
                page >
                1
        }
    };
}

/* =============================================================================
 * BULK RESULT
 * =============================================================================
 */

function normalizeBulkResult(
    result,
    identifiers
) {
    if (
        result &&
        typeof result ===
            "object"
    ) {
        return {
            total:
                Number(
                    result.total
                ) ||
                identifiers.length,

            successful:
                Number(
                    result.successful ??
                    result.successCount
                ) ||
                0,

            failed:
                Number(
                    result.failed ??
                    result.failureCount
                ) ||
                0,

            results:
                Array.isArray(
                    result.results
                )
                    ? result.results
                    : []
        };
    }

    return {
        total:
            identifiers.length,

        successful:
            identifiers.length,

        failed:
            0,

        results:
            identifiers.map(
                userId => ({
                    userId,
                    success:
                        true
                })
            )
    };
}

/* =============================================================================
 * ARRAY
 * =============================================================================
 */

function normalizeArray(
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
            value?.data
        )
    ) {
        return value.data;
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
            value?.results
        )
    ) {
        return value.results;
    }

    return [];
}

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeError(
    error
) {
    return {
        code:
            error?.code ??
            ERROR_CODES.INTERNAL_ERROR,

        message:
            error?.message ??
            "Administrative operation failed."
    };
}

/* =============================================================================
 * AUDIT / SECURITY HELPERS
 * =============================================================================
 */

function isSensitiveKey(
    key
) {
    return SENSITIVE_INPUT_FIELDS.includes(
        String(
            key
        )
            .toLowerCase()
    );
}

/* =============================================================================
 * FACTORY
 * =============================================================================
 */

function createAdminManagementService(
    dependencies = {}
) {
    return new AdminManagementService(
        dependencies
    );
}

/* =============================================================================
 * DEFAULT INSTANCE
 * =============================================================================
 */

const defaultService =
    createAdminManagementService();

/* =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports =
    Object.assign(
        defaultService,
        {
            AdminManagementService,

            createAdminManagementService,

            SERVICE_NAME,

            APPLICATION_NAME,

            ACCOUNT_STATUS,

            OPERATIONS,

            ERROR_CODES,

            getServiceMetadata:
                defaultService.getServiceMetadata.bind(
                    defaultService
                ),

            listUsers:
                defaultService.listUsers.bind(
                    defaultService
                ),

            searchUsers:
                defaultService.searchUsers.bind(
                    defaultService
                ),

            getUser:
                defaultService.getUser.bind(
                    defaultService
                ),

            createUser:
                defaultService.createUser.bind(
                    defaultService
                ),

            updateUser:
                defaultService.updateUser.bind(
                    defaultService
                ),

            activateUser:
                defaultService.activateUser.bind(
                    defaultService
                ),

            deactivateUser:
                defaultService.deactivateUser.bind(
                    defaultService
                ),

            suspendUser:
                defaultService.suspendUser.bind(
                    defaultService
                ),

            unsuspendUser:
                defaultService.unsuspendUser.bind(
                    defaultService
                ),

            lockUser:
                defaultService.lockUser.bind(
                    defaultService
                ),

            unlockUser:
                defaultService.unlockUser.bind(
                    defaultService
                ),

            deleteUser:
                defaultService.deleteUser.bind(
                    defaultService
                ),

            restoreUser:
                defaultService.restoreUser.bind(
                    defaultService
                ),

            getUserRoles:
                defaultService.getUserRoles.bind(
                    defaultService
                ),

            setUserRoles:
                defaultService.setUserRoles.bind(
                    defaultService
                ),

            addUserRole:
                defaultService.addUserRole.bind(
                    defaultService
                ),

            removeUserRole:
                defaultService.removeUserRole.bind(
                    defaultService
                ),

            getUserPermissions:
                defaultService.getUserPermissions.bind(
                    defaultService
                ),

            setUserPermissions:
                defaultService.setUserPermissions.bind(
                    defaultService
                ),

            addUserPermission:
                defaultService.addUserPermission.bind(
                    defaultService
                ),

            removeUserPermission:
                defaultService.removeUserPermission.bind(
                    defaultService
                ),

            bulkUpdateUsers:
                defaultService.bulkUpdateUsers.bind(
                    defaultService
                ),

            bulkActivateUsers:
                defaultService.bulkActivateUsers.bind(
                    defaultService
                ),

            bulkDeactivateUsers:
                defaultService.bulkDeactivateUsers.bind(
                    defaultService
                )
        }
    );