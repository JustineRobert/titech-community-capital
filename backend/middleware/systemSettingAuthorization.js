'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING AUTHORIZATION MIDDLEWARE
 * =============================================================================
 *
 * File:
 *   backend/middleware/systemSettingAuthorization.js
 *
 * Purpose:
 *   Centralized authorization middleware for TITech system-setting operations.
 *
 * Security objectives:
 *
 *   - Require an authenticated principal
 *   - Enforce RBAC / permission-based access
 *   - Enforce tenant isolation
 *   - Protect SYSTEM-level configuration
 *   - Distinguish read/write/manage privileges
 *   - Prevent arbitrary cross-tenant access
 *   - Prevent privilege escalation through request parameters/body
 *   - Support privileged platform administrators
 *   - Support tenant administrators
 *   - Fail closed when identity/authorization context is unavailable
 *   - Provide consistent authorization errors
 *
 * Architectural position:
 *
 *   Request
 *      |
 *      v
 *   Authentication Middleware
 *      |
 *      v
 *   systemSettingAuthorization
 *      |
 *      v
 *   Validation
 *      |
 *      v
 *   Controller
 *      |
 *      v
 *   Service
 *      |
 *      v
 *   SystemSetting
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * This middleware is an authorization boundary.
 *
 * It is NOT responsible for:
 *
 *   - Password verification
 *   - JWT creation
 *   - Database persistence
 *   - Configuration business rules
 *   - Financial transactions
 *   - Ledger operations
 *   - KYC decisions
 *   - AML decisions
 *
 * Those responsibilities belong to their respective services/layers.
 *
 * =============================================================================
 */

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const SYSTEM_TENANT_ID = 'SYSTEM';

const DEFAULT_TENANT_FIELD_CANDIDATES = Object.freeze([
    'tenantId',
    'tenantID',
    'tenant',
    'tenant_id'
]);

const DEFAULT_USER_ID_FIELD_CANDIDATES = Object.freeze([
    'id',
    '_id',
    'userId',
    'userID',
    'sub'
]);

/**
 * Platform-level roles.
 *
 * These roles may operate across tenant boundaries according to the operation
 * being requested.
 */
const PLATFORM_ADMIN_ROLES = Object.freeze([
    'SUPER_ADMIN',
    'SYSTEM_ADMIN',
    'PLATFORM_ADMIN',
    'ROOT_ADMIN'
]);

/**
 * Tenant-level roles.
 *
 * These roles are normally restricted to their own tenant.
 */
const TENANT_ADMIN_ROLES = Object.freeze([
    'TENANT_ADMIN',
    'ORGANIZATION_ADMIN',
    'ORG_ADMIN',
    'CONFIGURATION_ADMIN',
    'CONFIG_ADMIN'
]);

/**
 * Read permissions.
 */
const READ_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_READ',
    'SYSTEM_SETTING_READ',
    'SETTINGS_READ',
    'CONFIGURATION_READ',
    'SYSTEM_CONFIG_READ',
    'ADMIN'
]);

/**
 * Write permissions.
 */
const WRITE_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_WRITE',
    'SYSTEM_SETTING_WRITE',
    'SETTINGS_WRITE',
    'CONFIGURATION_WRITE',
    'SYSTEM_CONFIG_WRITE'
]);

/**
 * Manage permissions.
 *
 * Manage is intentionally stronger than ordinary write.
 */
const MANAGE_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_MANAGE',
    'SYSTEM_SETTING_MANAGE',
    'SETTINGS_MANAGE',
    'CONFIGURATION_MANAGE',
    'SYSTEM_CONFIG_MANAGE'
]);

/**
 * Cross-tenant permissions.
 *
 * These are intentionally explicit.
 */
const CROSS_TENANT_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_CROSS_TENANT',
    'SYSTEM_SETTING_CROSS_TENANT',
    'TENANT_SETTINGS_CROSS_TENANT',
    'CONFIGURATION_CROSS_TENANT',
    'TENANT_ADMIN_ALL'
]);

/**
 * SYSTEM-scope permissions.
 *
 * SYSTEM configuration is more privileged than ordinary tenant configuration.
 */
const SYSTEM_SCOPE_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_SYSTEM',
    'SYSTEM_SETTING_SYSTEM',
    'SYSTEM_CONFIG_WRITE',
    'PLATFORM_CONFIGURATION'
]);

/**
 * =============================================================================
 * ERROR FACTORY
 * =============================================================================
 */

function authorizationError(
    code,
    message,
    statusCode = 403
) {
    const error = new Error(message);

    error.name = 'SystemSettingAuthorizationError';
    error.code = code;
    error.statusCode = statusCode;
    error.status = statusCode;
    error.isOperational = true;

    return error;
}

/**
 * =============================================================================
 * NORMALIZATION
 * =============================================================================
 */

function normalizeString(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized
        ? normalized
        : null;
}

function normalizeUpper(value) {
    const normalized =
        normalizeString(value);

    return normalized
        ? normalized.toUpperCase()
        : null;
}

function normalizeTenantId(value) {
    const normalized =
        normalizeString(value);

    if (!normalized) {
        return null;
    }

    return normalized.toUpperCase() === SYSTEM_TENANT_ID
        ? SYSTEM_TENANT_ID
        : normalized;
}

/**
 * =============================================================================
 * PRINCIPAL RESOLUTION
 * =============================================================================
 *
 * Authentication middleware in different TITech deployments may expose the
 * principal under different request properties.
 *
 * We support the common forms without silently treating an unauthenticated
 * request as authorized.
 * =============================================================================
 */

function getPrincipal(req) {
    if (!req) {
        return null;
    }

    return (
        req.user ||
        req.authenticatedUser ||
        req.principal ||
        req.auth?.user ||
        req.auth ||
        null
    );
}

/**
 * =============================================================================
 * AUTHENTICATION CHECK
 * =============================================================================
 */

function isAuthenticated(req) {
    const principal =
        getPrincipal(req);

    if (!principal) {
        return false;
    }

    /**
     * Explicit authentication flags are honored when present.
     */
    if (
        principal.authenticated === false ||
        principal.isAuthenticated === false
    ) {
        return false;
    }

    return true;
}

/**
 * =============================================================================
 * USER ID EXTRACTION
 * =============================================================================
 */

function getPrincipalId(principal) {
    if (!principal) {
        return null;
    }

    for (
        const field of
        DEFAULT_USER_ID_FIELD_CANDIDATES
    ) {
        const value =
            principal[field];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim()
        ) {
            return String(value);
        }
    }

    return null;
}

/**
 * =============================================================================
 * ROLE EXTRACTION
 * =============================================================================
 */

function collectRoles(principal) {
    if (!principal) {
        return [];
    }

    const roles = [];

    const candidates = [
        principal.role,
        principal.roles,
        principal.userRole,
        principal.userRoles,
        principal.accountRole,
        principal.accountRoles
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            roles.push(...candidate);
            continue;
        }

        if (
            typeof candidate === 'string' &&
            candidate.trim()
        ) {
            roles.push(candidate);
        }
    }

    return [
        ...new Set(
            roles
                .filter(Boolean)
                .map(normalizeUpper)
                .filter(Boolean)
        )
    ];
}

/**
 * =============================================================================
 * PERMISSION EXTRACTION
 * =============================================================================
 */

function collectPermissions(principal) {
    if (!principal) {
        return [];
    }

    const permissions = [];

    const candidates = [
        principal.permission,
        principal.permissions,
        principal.privileges,
        principal.scopes,
        principal.authorities
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            permissions.push(...candidate);
            continue;
        }

        if (
            typeof candidate === 'string' &&
            candidate.trim()
        ) {
            permissions.push(candidate);
        }
    }

    return [
        ...new Set(
            permissions
                .filter(Boolean)
                .map(normalizeUpper)
                .filter(Boolean)
        )
    ];
}

/**
 * =============================================================================
 * ROLE / PERMISSION HELPERS
 * =============================================================================
 */

function hasAnyRole(
    roles,
    requiredRoles
) {
    return requiredRoles.some(
        (role) => roles.includes(
            normalizeUpper(role)
        )
    );
}

function hasAnyPermission(
    permissions,
    requiredPermissions
) {
    return requiredPermissions.some(
        (permission) =>
            permissions.includes(
                normalizeUpper(permission)
            )
    );
}

function isPlatformAdministrator(
    principal,
    roles
) {
    if (!principal) {
        return false;
    }

    if (
        principal.isSuperAdmin === true ||
        principal.isSystemAdmin === true ||
        principal.isPlatformAdmin === true
    ) {
        return true;
    }

    return hasAnyRole(
        roles,
        PLATFORM_ADMIN_ROLES
    );
}

function isTenantAdministrator(
    principal,
    roles
) {
    if (!principal) {
        return false;
    }

    if (
        principal.isTenantAdmin === true ||
        principal.isOrganizationAdmin === true
    ) {
        return true;
    }

    return hasAnyRole(
        roles,
        TENANT_ADMIN_ROLES
    );
}

/**
 * =============================================================================
 * TENANT EXTRACTION
 * =============================================================================
 */

function extractTenantFromObject(
    object
) {
    if (!object) {
        return null;
    }

    for (
        const field of
        DEFAULT_TENANT_FIELD_CANDIDATES
    ) {
        if (
            object[field] !== undefined &&
            object[field] !== null
        ) {
            const normalized =
                normalizeTenantId(
                    object[field]
                );

            if (normalized) {
                return normalized;
            }
        }
    }

    return null;
}

/**
 * Resolve the authenticated principal's tenant.
 *
 * Request-supplied tenant IDs are deliberately excluded from this function.
 */
function getPrincipalTenantId(
    principal
) {
    return extractTenantFromObject(
        principal
    );
}

/**
 * =============================================================================
 * REQUEST TENANT EXTRACTION
 * =============================================================================
 *
 * Tenant scope may originate from:
 *
 *   /tenant/:tenantId
 *   ?tenantId=...
 *   request body
 *
 * The body/query values are NEVER considered authoritative for authorization.
 * They are merely used to identify the requested scope so it can be compared
 * with the authenticated tenant.
 * =============================================================================
 */

function getRequestedTenantId(req) {
    if (!req) {
        return null;
    }

    /**
     * Explicit route parameter has highest precedence.
     */
    const parameterTenant =
        req.params &&
        extractTenantFromObject(
            req.params
        );

    if (parameterTenant) {
        return parameterTenant;
    }

    /**
     * Query parameters are supported for read-only administrative APIs.
     */
    const queryTenant =
        req.query &&
        extractTenantFromObject(
            req.query
        );

    if (queryTenant) {
        return queryTenant;
    }

    /**
     * Body tenant IDs are useful for identifying requested scope but must
     * never override the authenticated tenant.
     */
    const bodyTenant =
        req.body &&
        extractTenantFromObject(
            req.body
        );

    if (bodyTenant) {
        return bodyTenant;
    }

    return null;
}

/**
 * =============================================================================
 * SYSTEM SCOPE DETECTION
 * =============================================================================
 */

function isSystemScope(
    tenantId
) {
    return normalizeTenantId(
        tenantId
    ) === SYSTEM_TENANT_ID;
}

/**
 * =============================================================================
 * REQUEST OPERATION CLASSIFICATION
 * =============================================================================
 */

function getOperationFromRequest(
    req
) {
    if (!req) {
        return 'READ';
    }

    const method =
        String(req.method || 'GET')
            .toUpperCase();

    if (
        method === 'GET' ||
        method === 'HEAD' ||
        method === 'OPTIONS'
    ) {
        return 'READ';
    }

    /**
     * DELETE is considered destructive/manage-level access.
     */
    if (method === 'DELETE') {
        return 'MANAGE';
    }

    /**
     * POST/PATCH/PUT represent configuration mutation.
     */
    return 'WRITE';
}

/**
 * =============================================================================
 * AUTHORIZATION CONTEXT
 * =============================================================================
 */

function buildAuthorizationContext(
    req,
    options = {}
) {
    const principal =
        getPrincipal(req);

    const roles =
        collectRoles(principal);

    const permissions =
        collectPermissions(principal);

    const principalTenantId =
        getPrincipalTenantId(
            principal
        );

    const requestedTenantId =
        normalizeTenantId(
            options.tenantId ||
            getRequestedTenantId(req)
        );

    const operation =
        options.operation ||
        getOperationFromRequest(req);

    const platformAdministrator =
        isPlatformAdministrator(
            principal,
            roles
        );

    const tenantAdministrator =
        isTenantAdministrator(
            principal,
            roles
        );

    const crossTenant =
        hasAnyPermission(
            permissions,
            CROSS_TENANT_PERMISSIONS
        );

    const systemScope =
        isSystemScope(
            requestedTenantId
        );

    return {
        principal,
        principalId:
            getPrincipalId(principal),
        roles,
        permissions,
        principalTenantId,
        requestedTenantId,
        operation,
        platformAdministrator,
        tenantAdministrator,
        crossTenant,
        systemScope
    };
}

/**
 * =============================================================================
 * TENANT ISOLATION
 * =============================================================================
 *
 * This is the core multi-tenant security rule.
 *
 * A normal tenant administrator may only operate inside their own tenant.
 *
 * Cross-tenant access requires an explicit privileged role/permission.
 * =============================================================================
 */

function authorizeTenantScope(
    context,
    options = {}
) {
    const {
        allowUnscopedRead = true,
        allowCrossTenant = false,
        requireTenant = false
    } = options;

    const {
        requestedTenantId,
        principalTenantId,
        platformAdministrator,
        crossTenant,
        operation
    } = context;

    /**
     * No requested tenant.
     *
     * This can be valid for platform-level listing or system-level endpoints.
     */
    if (!requestedTenantId) {
        if (requireTenant) {
            throw authorizationError(
                'TENANT_SCOPE_REQUIRED',
                'A tenant scope is required for this system-setting operation.'
            );
        }

        if (
            operation === 'READ' &&
            allowUnscopedRead
        ) {
            return true;
        }

        return true;
    }

    /**
     * SYSTEM scope is never treated as an ordinary tenant.
     */
    if (
        requestedTenantId ===
        SYSTEM_TENANT_ID
    ) {
        if (
            platformAdministrator ||
            (
                crossTenant &&
                hasAnyPermission(
                    context.permissions,
                    SYSTEM_SCOPE_PERMISSIONS
                )
            )
        ) {
            return true;
        }

        throw authorizationError(
            'SYSTEM_SCOPE_ACCESS_DENIED',
            'Access to TITech SYSTEM configuration requires privileged platform authorization.'
        );
    }

    /**
     * Platform administrators may access tenants.
     */
    if (platformAdministrator) {
        return true;
    }

    /**
     * Explicit cross-tenant access.
     */
    if (
        allowCrossTenant &&
        crossTenant
    ) {
        return true;
    }

    /**
     * A tenant-scoped principal must have a tenant identity.
     */
    if (!principalTenantId) {
        throw authorizationError(
            'TENANT_CONTEXT_MISSING',
            'The authenticated principal does not have a valid tenant context.'
        );
    }

    /**
     * Strict tenant isolation.
     */
    if (
        normalizeTenantId(
            principalTenantId
        ) !==
        normalizeTenantId(
            requestedTenantId
        )
    ) {
        throw authorizationError(
            'TENANT_ACCESS_DENIED',
            'You are not authorized to access configuration belonging to another tenant.'
        );
    }

    return true;
}

/**
 * =============================================================================
 * READ AUTHORIZATION
 * =============================================================================
 */

function authorizeRead(
    context,
    options = {}
) {
    const {
        allowTenantAdmin = true,
        allowCrossTenant = false,
        allowSystemScope = true,
        requirePermission = true
    } = options;

    const {
        principal,
        roles,
        permissions,
        platformAdministrator,
        tenantAdministrator,
        requestedTenantId
    } = context;

    if (!principal) {
        throw authorizationError(
            'AUTHENTICATION_REQUIRED',
            'Authentication is required to access TITech system settings.',
            401
        );
    }

    if (platformAdministrator) {
        return true;
    }

    if (
        allowTenantAdmin &&
        tenantAdministrator
    ) {
        /**
         * Tenant administrators still cannot automatically access SYSTEM
         * configuration.
         */
        if (
            isSystemScope(
                requestedTenantId
            )
        ) {
            throw authorizationError(
                'SYSTEM_SCOPE_ACCESS_DENIED',
                'Tenant administrators cannot access TITech SYSTEM configuration.'
            );
        }

        authorizeTenantScope(
            context,
            {
                allowCrossTenant,
                requireTenant:
                    Boolean(
                        requestedTenantId
                    )
            }
        );

        return true;
    }

    if (
        requirePermission &&
        !hasAnyPermission(
            permissions,
            READ_PERMISSIONS
        )
    ) {
        throw authorizationError(
            'SYSTEM_SETTING_READ_DENIED',
            'You do not have permission to read TITech system settings.'
        );
    }

    if (
        isSystemScope(
            requestedTenantId
        ) &&
        !platformAdministrator &&
        !hasAnyPermission(
            permissions,
            SYSTEM_SCOPE_PERMISSIONS
        )
    ) {
        if (allowSystemScope) {
            throw authorizationError(
                'SYSTEM_SCOPE_ACCESS_DENIED',
                'Access to TITech SYSTEM configuration requires privileged authorization.'
            );
        }
    }

    authorizeTenantScope(
        context,
        {
            allowCrossTenant,
            requireTenant:
                Boolean(
                    requestedTenantId
                )
        }
    );

    return true;
}

/**
 * =============================================================================
 * WRITE AUTHORIZATION
 * =============================================================================
 */

function authorizeWrite(
    context,
    options = {}
) {
    const {
        allowTenantAdmin = true,
        allowCrossTenant = false,
        allowSystemScope = false,
        requireExplicitPermission = true
    } = options;

    const {
        principal,
        permissions,
        platformAdministrator,
        tenantAdministrator,
        requestedTenantId
    } = context;

    if (!principal) {
        throw authorizationError(
            'AUTHENTICATION_REQUIRED',
            'Authentication is required to modify TITech system settings.',
            401
        );
    }

    /**
     * SYSTEM configuration is privileged.
     */
    if (
        isSystemScope(
            requestedTenantId
        )
    ) {
        if (
            platformAdministrator &&
            allowSystemScope
        ) {
            return true;
        }

        if (
            platformAdministrator &&
            hasAnyPermission(
                permissions,
                SYSTEM_SCOPE_PERMISSIONS
            )
        ) {
            return true;
        }

        throw authorizationError(
            'SYSTEM_CONFIGURATION_WRITE_DENIED',
            'Modification of TITech SYSTEM configuration requires privileged platform authorization.'
        );
    }

    /**
     * Platform administrators may operate on tenant settings.
     */
    if (platformAdministrator) {
        return true;
    }

    /**
     * Tenant administrators require appropriate write capability unless the
     * deployment explicitly permits the tenant-admin role to manage settings.
     */
    if (
        allowTenantAdmin &&
        tenantAdministrator
    ) {
        if (
            !requireExplicitPermission ||
            hasAnyPermission(
                permissions,
                WRITE_PERMISSIONS
            ) ||
            hasAnyPermission(
                permissions,
                MANAGE_PERMISSIONS
            )
        ) {
            authorizeTenantScope(
                context,
                {
                    allowCrossTenant,
                    requireTenant: true
                }
            );

            return true;
        }

        throw authorizationError(
            'SYSTEM_SETTING_WRITE_DENIED',
            'Your tenant administrator role does not have configuration write permission.'
        );
    }

    /**
     * Ordinary users require an explicit write permission.
     */
    if (
        !hasAnyPermission(
            permissions,
            WRITE_PERMISSIONS
        ) &&
        !hasAnyPermission(
            permissions,
            MANAGE_PERMISSIONS
        )
    ) {
        throw authorizationError(
            'SYSTEM_SETTING_WRITE_DENIED',
            'You do not have permission to modify TITech system settings.'
        );
    }

    authorizeTenantScope(
        context,
        {
            allowCrossTenant,
            requireTenant: true
        }
    );

    return true;
}

/**
 * =============================================================================
 * MANAGE AUTHORIZATION
 * =============================================================================
 *
 * Manage-level operations include destructive or highly privileged operations
 * such as deleting/restoring configuration or resetting tenant overrides.
 * =============================================================================
 */

function authorizeManage(
    context,
    options = {}
) {
    const {
        allowCrossTenant = false,
        allowSystemScope = false
    } = options;

    const {
        principal,
        permissions,
        platformAdministrator,
        requestedTenantId
    } = context;

    if (!principal) {
        throw authorizationError(
            'AUTHENTICATION_REQUIRED',
            'Authentication is required to manage TITech system settings.',
            401
        );
    }

    /**
     * Platform administrators are allowed only where the route explicitly
     * permits the scope.
     */
    if (
        platformAdministrator &&
        (
            !isSystemScope(
                requestedTenantId
            ) ||
            allowSystemScope
        )
    ) {
        return true;
    }

    /**
     * Explicit manage permission is required for non-platform principals.
     */
    if (
        !hasAnyPermission(
            permissions,
            MANAGE_PERMISSIONS
        )
    ) {
        throw authorizationError(
            'SYSTEM_SETTING_MANAGE_DENIED',
            'You do not have permission to perform this privileged TITech system-setting operation.'
        );
    }

    if (
        isSystemScope(
            requestedTenantId
        ) &&
        !allowSystemScope
    ) {
        throw authorizationError(
            'SYSTEM_CONFIGURATION_MANAGE_DENIED',
            'SYSTEM configuration management requires privileged platform authorization.'
        );
    }

    authorizeTenantScope(
        context,
        {
            allowCrossTenant,
            requireTenant:
                !isSystemScope(
                    requestedTenantId
                )
        }
    );

    return true;
}

/**
 * =============================================================================
 * REQUEST CONTEXT ATTACHMENT
 * =============================================================================
 *
 * Downstream controller/service layers can use req.systemSettingAuth without
 * having to re-derive the identity context.
 *
 * This does NOT replace service-level authorization.
 */
function attachAuthorizationContext(
    req,
    context
) {
    req.systemSettingAuth = {
        principalId:
            context.principalId,

        principalTenantId:
            context.principalTenantId,

        requestedTenantId:
            context.requestedTenantId,

        operation:
            context.operation,

        roles: [
            ...context.roles
        ],

        permissions: [
            ...context.permissions
        ],

        platformAdministrator:
            context.platformAdministrator,

        tenantAdministrator:
            context.tenantAdministrator,

        crossTenant:
            context.crossTenant,

        systemScope:
            context.systemScope,

        authorizedAt:
            new Date()
    };
}

/**
 * =============================================================================
 * CORE AUTHORIZATION FACTORY
 * =============================================================================
 */

function createAuthorizationMiddleware(
    options = {}
) {
    const {
        operation = null,

        allowCrossTenant = false,

        allowSystemScope = false,

        allowTenantAdmin = true,

        requireTenant = false,

        requirePermission = true
    } = options;

    return function systemSettingAuthorization(
        req,
        res,
        next
    ) {
        try {
            /**
             * Authentication must already have occurred.
             */
            if (!isAuthenticated(req)) {
                return next(
                    authorizationError(
                        'AUTHENTICATION_REQUIRED',
                        'Authentication is required to access TITech system settings.',
                        401
                    )
                );
            }

            const context =
                buildAuthorizationContext(
                    req,
                    {
                        operation:
                            operation ||
                            getOperationFromRequest(
                                req
                            )
                    }
                );

            /**
             * A route can explicitly require a tenant.
             */
            if (
                requireTenant &&
                !context.requestedTenantId
            ) {
                return next(
                    authorizationError(
                        'TENANT_SCOPE_REQUIRED',
                        'A tenant scope is required for this TITech system-setting operation.'
                    )
                );
            }

            switch (
                String(
                    context.operation
                ).toUpperCase()
            ) {
                case 'READ':
                    authorizeRead(
                        context,
                        {
                            allowTenantAdmin,
                            allowCrossTenant,
                            allowSystemScope,
                            requirePermission
                        }
                    );
                    break;

                case 'WRITE':
                    authorizeWrite(
                        context,
                        {
                            allowTenantAdmin,
                            allowCrossTenant,
                            allowSystemScope,
                            requireExplicitPermission:
                                requirePermission
                        }
                    );
                    break;

                case 'MANAGE':
                    authorizeManage(
                        context,
                        {
                            allowCrossTenant,
                            allowSystemScope
                        }
                    );
                    break;

                default:
                    throw authorizationError(
                        'INVALID_SYSTEM_SETTING_OPERATION',
                        'The requested system-setting authorization operation is invalid.',
                        500
                    );
            }

            attachAuthorizationContext(
                req,
                context
            );

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * =============================================================================
 * SPECIALIZED MIDDLEWARE
 * =============================================================================
 */

/**
 * Read access.
 */
function authorizeSystemSettingRead(
    options = {}
) {
    return createAuthorizationMiddleware({
        ...options,
        operation: 'READ'
    });
}

/**
 * Write access.
 */
function authorizeSystemSettingWrite(
    options = {}
) {
    return createAuthorizationMiddleware({
        ...options,
        operation: 'WRITE'
    });
}

/**
 * Manage access.
 */
function authorizeSystemSettingManage(
    options = {}
) {
    return createAuthorizationMiddleware({
        ...options,
        operation: 'MANAGE'
    });
}

/**
 * Tenant-only read access.
 *
 * SYSTEM scope is explicitly rejected.
 */
function authorizeTenantSettingRead(
    options = {}
) {
    return createAuthorizationMiddleware({
        ...options,
        operation: 'READ',
        requireTenant: true,
        allowSystemScope: false
    });
}

/**
 * Tenant-only write access.
 *
 * SYSTEM scope is explicitly rejected.
 */
function authorizeTenantSettingWrite(
    options = {}
) {
    return createAuthorizationMiddleware({
        ...options,
        operation: 'WRITE',
        requireTenant: true,
        allowSystemScope: false
    });
}

/**
 * SYSTEM-level read access.
 *
 * Requires platform/system authorization.
 */
function authorizeSystemScopeRead(
    options = {}
) {
    return function systemScopeRead(
        req,
        res,
        next
    ) {
        try {
            if (!isAuthenticated(req)) {
                return next(
                    authorizationError(
                        'AUTHENTICATION_REQUIRED',
                        'Authentication is required to access TITech SYSTEM configuration.',
                        401
                    )
                );
            }

            const principal =
                getPrincipal(req);

            const roles =
                collectRoles(principal);

            const permissions =
                collectPermissions(principal);

            const platformAdministrator =
                isPlatformAdministrator(
                    principal,
                    roles
                );

            const allowed =
                platformAdministrator ||
                hasAnyPermission(
                    permissions,
                    SYSTEM_SCOPE_PERMISSIONS
                );

            if (!allowed) {
                return next(
                    authorizationError(
                        'SYSTEM_SCOPE_ACCESS_DENIED',
                        'Access to TITech SYSTEM configuration requires privileged authorization.'
                    )
                );
            }

            const context =
                buildAuthorizationContext(
                    req,
                    {
                        operation: 'READ',
                        tenantId:
                            SYSTEM_TENANT_ID
                    }
                );

            attachAuthorizationContext(
                req,
                context
            );

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * SYSTEM-level write access.
 *
 * This is intentionally stricter than ordinary configuration writes.
 */
function authorizeSystemScopeWrite(
    options = {}
) {
    return function systemScopeWrite(
        req,
        res,
        next
    ) {
        try {
            if (!isAuthenticated(req)) {
                return next(
                    authorizationError(
                        'AUTHENTICATION_REQUIRED',
                        'Authentication is required to modify TITech SYSTEM configuration.',
                        401
                    )
                );
            }

            const principal =
                getPrincipal(req);

            const roles =
                collectRoles(principal);

            const permissions =
                collectPermissions(principal);

            const platformAdministrator =
                isPlatformAdministrator(
                    principal,
                    roles
                );

            const allowed =
                platformAdministrator ||
                hasAnyPermission(
                    permissions,
                    SYSTEM_SCOPE_PERMISSIONS
                );

            if (!allowed) {
                return next(
                    authorizationError(
                        'SYSTEM_CONFIGURATION_WRITE_DENIED',
                        'Modification of TITech SYSTEM configuration requires privileged platform authorization.'
                    )
                );
            }

            const context =
                buildAuthorizationContext(
                    req,
                    {
                        operation: 'WRITE',
                        tenantId:
                            SYSTEM_TENANT_ID
                    }
                );

            attachAuthorizationContext(
                req,
                context
            );

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * Cross-tenant access.
 *
 * This does not grant write access by itself. It only establishes that the
 * principal is allowed to cross tenant boundaries; the operation-specific
 * middleware still determines read/write/manage privileges.
 */
function authorizeCrossTenant(
    options = {}
) {
    return function crossTenantAuthorization(
        req,
        res,
        next
    ) {
        try {
            if (!isAuthenticated(req)) {
                return next(
                    authorizationError(
                        'AUTHENTICATION_REQUIRED',
                        'Authentication is required for cross-tenant TITech configuration access.',
                        401
                    )
                );
            }

            const principal =
                getPrincipal(req);

            const roles =
                collectRoles(principal);

            const permissions =
                collectPermissions(principal);

            const allowed =
                isPlatformAdministrator(
                    principal,
                    roles
                ) ||
                hasAnyPermission(
                    permissions,
                    CROSS_TENANT_PERMISSIONS
                );

            if (!allowed) {
                return next(
                    authorizationError(
                        'CROSS_TENANT_ACCESS_DENIED',
                        'Cross-tenant TITech configuration access is not authorized.'
                    )
                );
            }

            const context =
                buildAuthorizationContext(
                    req,
                    {
                        operation:
                            options.operation ||
                            getOperationFromRequest(
                                req
                            )
                    }
                );

            attachAuthorizationContext(
                req,
                context
            );

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * =============================================================================
 * SYSTEM SETTING PROTECTION GUARD
 * =============================================================================
 *
 * Used after a setting has been loaded by the controller/service when the
 * request attempts to modify a protected setting.
 *
 * The actual setting should be available as:
 *
 *   req.systemSetting
 *
 * or:
 *
 *   res.locals.systemSetting
 *
 * =============================================================================
 */

function authorizeProtectedSettingUpdate(
    options = {}
) {
    return function protectedSettingAuthorization(
        req,
        res,
        next
    ) {
        try {
            const setting =
                req.systemSetting ||
                res.locals?.systemSetting ||
                null;

            if (!setting) {
                return next(
                    authorizationError(
                        'SYSTEM_SETTING_CONTEXT_MISSING',
                        'The system-setting authorization context is missing.',
                        500
                    )
                );
            }

            /**
             * Non-protected settings continue through normal authorization.
             */
            if (
                setting.isSystem !== true &&
                setting.editable !== false
            ) {
                return next();
            }

            const principal =
                getPrincipal(req);

            const roles =
                collectRoles(principal);

            const permissions =
                collectPermissions(principal);

            const platformAdministrator =
                isPlatformAdministrator(
                    principal,
                    roles
                );

            const protectedPermission =
                hasAnyPermission(
                    permissions,
                    [
                        ...MANAGE_PERMISSIONS,
                        ...SYSTEM_SCOPE_PERMISSIONS
                    ]
                );

            if (
                !platformAdministrator &&
                !protectedPermission &&
                options.allowProtected !== true
            ) {
                return next(
                    authorizationError(
                        'PROTECTED_SYSTEM_SETTING',
                        'This TITech system setting is protected and requires elevated authorization.'
                    )
                );
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * =============================================================================
 * TENANT OWNERSHIP GUARD
 * =============================================================================
 *
 * This guard is useful when a controller has already resolved a setting and
 * placed it in req.systemSetting.
 *
 * It verifies that the setting's tenant matches the authenticated principal.
 */
function authorizeSettingOwnership(
    options = {}
) {
    return function settingOwnershipAuthorization(
        req,
        res,
        next
    ) {
        try {
            const setting =
                req.systemSetting ||
                res.locals?.systemSetting ||
                null;

            if (!setting) {
                return next(
                    authorizationError(
                        'SYSTEM_SETTING_CONTEXT_MISSING',
                        'The system-setting authorization context is missing.',
                        500
                    )
                );
            }

            const principal =
                getPrincipal(req);

            const roles =
                collectRoles(principal);

            const permissions =
                collectPermissions(principal);

            const platformAdministrator =
                isPlatformAdministrator(
                    principal,
                    roles
                );

            if (platformAdministrator) {
                return next();
            }

            const settingTenant =
                normalizeTenantId(
                    setting.tenantId
                );

            const principalTenant =
                getPrincipalTenantId(
                    principal
                );

            if (
                settingTenant ===
                SYSTEM_TENANT_ID
            ) {
                return next(
                    authorizationError(
                        'SYSTEM_SCOPE_ACCESS_DENIED',
                        'The requested configuration belongs to the TITech SYSTEM scope.'
                    )
                );
            }

            if (
                hasAnyPermission(
                    permissions,
                    CROSS_TENANT_PERMISSIONS
                )
            ) {
                return next();
            }

            if (
                !principalTenant ||
                principalTenant !==
                settingTenant
            ) {
                return next(
                    authorizationError(
                        'TENANT_ACCESS_DENIED',
                        'You are not authorized to access this tenant configuration.'
                    )
                );
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports = {
    /**
     * Primary generic middleware factory.
     */
    createAuthorizationMiddleware,

    /**
     * Standard authorization middleware.
     */
    authorizeSystemSettingRead,
    authorizeSystemSettingWrite,
    authorizeSystemSettingManage,

    /**
     * Tenant-scoped authorization.
     */
    authorizeTenantSettingRead,
    authorizeTenantSettingWrite,

    /**
     * Privileged SYSTEM scope.
     */
    authorizeSystemScopeRead,
    authorizeSystemScopeWrite,

    /**
     * Cross-tenant authorization.
     */
    authorizeCrossTenant,

    /**
     * Additional setting-level guards.
     */
    authorizeProtectedSettingUpdate,
    authorizeSettingOwnership,

    /**
     * Utility functions exported for testing/service integration.
     */
    getPrincipal,
    getPrincipalId,
    getPrincipalTenantId,
    getRequestedTenantId,
    collectRoles,
    collectPermissions,
    isPlatformAdministrator,
    isTenantAdministrator,
    isSystemScope,
    buildAuthorizationContext,

    /**
     * Constants.
     */
    SYSTEM_TENANT_ID,
    PLATFORM_ADMIN_ROLES,
    TENANT_ADMIN_ROLES,
    READ_PERMISSIONS,
    WRITE_PERMISSIONS,
    MANAGE_PERMISSIONS,
    CROSS_TENANT_PERMISSIONS,
    SYSTEM_SCOPE_PERMISSIONS
};