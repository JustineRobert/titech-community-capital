'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING ROUTES
 * =============================================================================
 *
 * File:
 *   backend/routes/systemSettingRoutes.js
 *
 * Purpose:
 *   HTTP routing layer for centralized TITech Community Capital configuration.
 *
 * Architectural responsibilities:
 *
 *   - Route system-setting requests to the controller
 *   - Enforce authentication at the route boundary
 *   - Enforce administrative/configuration authorization
 *   - Apply request validation before controller execution
 *   - Support SYSTEM-level configuration
 *   - Support tenant-level configuration
 *   - Support effective configuration resolution
 *   - Support configuration health/status inspection
 *   - Preserve REST semantics
 *
 * IMPORTANT SECURITY PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * 1. System settings are privileged configuration state.
 * 2. Routes must never allow anonymous configuration mutation.
 * 3. Business authorization belongs in middleware/controller/service layers.
 * 4. Tenant identity must NOT be trusted from arbitrary request body fields.
 * 5. Controllers/services must derive the effective tenant scope from the
 *    authenticated principal and/or explicitly authorized administrative scope.
 * 6. Routes do not directly manipulate MongoDB documents.
 * 7. Sensitive configuration values should be redacted by the controller/
 *    serializer where appropriate.
 *
 * Expected architecture:
 *
 *   HTTP Request
 *        |
 *        v
 *   Authentication
 *        |
 *        v
 *   Authorization
 *        |
 *        v
 *   Validation
 *        |
 *        v
 *   SystemSettingController
 *        |
 *        v
 *   SystemSettingService
 *        |
 *        v
 *   SystemSetting Model
 *
 * =============================================================================
 */

const express = require('express');

const router = express.Router();

/**
 * =============================================================================
 * CONTROLLER
 * =============================================================================
 *
 * Keep the route layer independent from persistence/business logic.
 */

const systemSettingController =
    require('../controllers/systemSettingController');

/**
 * =============================================================================
 * OPTIONAL MIDDLEWARE RESOLUTION
 * =============================================================================
 *
 * TITech installations may use different authentication/authorization
 * middleware names. We intentionally resolve known middleware exports without
 * making the route silently insecure.
 *
 * If your project already has these middleware modules, they will be used.
 * Otherwise the local security guards below fail closed.
 * =============================================================================
 */

function resolveMiddleware(modulePath, exportNames = []) {
    try {
        const middlewareModule =
            require(modulePath);

        if (typeof middlewareModule === 'function') {
            return middlewareModule;
        }

        for (const exportName of exportNames) {
            if (
                middlewareModule &&
                typeof middlewareModule[exportName] === 'function'
            ) {
                return middlewareModule[exportName];
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * =============================================================================
 * AUTHENTICATION MIDDLEWARE
 * =============================================================================
 *
 * Prefer the application's existing authentication middleware.
 *
 * The route fallback deliberately fails closed.
 *
 * This prevents a deployment mistake where a missing authentication module
 * accidentally exposes configuration endpoints publicly.
 * =============================================================================
 */

const authenticate =
    resolveMiddleware(
        '../middleware/authMiddleware',
        [
            'authenticate',
            'requireAuth',
            'protect',
            'verifyToken',
            'authenticateUser'
        ]
    ) ||
    resolveMiddleware(
        '../middleware/auth',
        [
            'authenticate',
            'requireAuth',
            'protect',
            'verifyToken',
            'authenticateUser'
        ]
    );

/**
 * =============================================================================
 * FAIL-CLOSED AUTHENTICATION GUARD
 * =============================================================================
 */

function requireAuthentication(req, res, next) {
    /**
     * If a project-level authentication middleware exists, let it establish
     * req.user / req.auth.
     */
    if (authenticate) {
        return authenticate(req, res, next);
    }

    /**
     * Fallback:
     *
     * Some TITech deployments may already authenticate requests globally.
     * In that case req.user or req.auth should exist.
     *
     * If neither exists, reject the request rather than exposing settings.
     */
    if (
        req.user ||
        req.auth ||
        req.authenticatedUser
    ) {
        return next();
    }

    return res.status(401).json({
        success: false,
        error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication is required to access system settings.'
        }
    });
}

/**
 * =============================================================================
 * AUTHENTICATED PRINCIPAL HELPERS
 * =============================================================================
 */

function getPrincipal(req) {
    return (
        req.user ||
        req.authenticatedUser ||
        req.auth ||
        null
    );
}

function collectPrincipalRoles(principal) {
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
        } else if (
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
                .map((role) =>
                    String(role)
                        .trim()
                        .toUpperCase()
                )
        )
    ];
}

function collectPrincipalPermissions(principal) {
    if (!principal) {
        return [];
    }

    const permissions = [];

    const candidates = [
        principal.permission,
        principal.permissions,
        principal.privileges,
        principal.scopes
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            permissions.push(...candidate);
        } else if (
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
                .map((permission) =>
                    String(permission)
                        .trim()
                        .toUpperCase()
                )
        )
    ];
}

/**
 * =============================================================================
 * CONFIGURATION ADMINISTRATOR AUTHORIZATION
 * =============================================================================
 *
 * Supported administrative roles intentionally include common enterprise RBAC
 * naming conventions used by TITech deployments.
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * This middleware is an additional route-level guard. The controller/service
 * should still enforce authorization for sensitive operations.
 * =============================================================================
 */

const CONFIGURATION_ROLES = Object.freeze([
    'SUPER_ADMIN',
    'SYSTEM_ADMIN',
    'PLATFORM_ADMIN',
    'TENANT_ADMIN',
    'CONFIGURATION_ADMIN',
    'CONFIG_ADMIN'
]);

const CONFIGURATION_PERMISSIONS = Object.freeze([
    'SYSTEM_SETTINGS_READ',
    'SYSTEM_SETTINGS_WRITE',
    'SYSTEM_SETTING_READ',
    'SYSTEM_SETTING_WRITE',
    'CONFIGURATION_READ',
    'CONFIGURATION_WRITE',
    'SETTINGS_READ',
    'SETTINGS_WRITE',
    'ADMIN'
]);

function requireConfigurationAccess(options = {}) {
    const {
        write = false
    } = options;

    return function configurationAuthorization(
        req,
        res,
        next
    ) {
        const principal =
            getPrincipal(req);

        if (!principal) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTHENTICATION_REQUIRED',
                    message:
                        'Authentication is required to access system settings.'
                }
            });
        }

        /**
         * Explicit authorization flags are supported where an upstream
         * authorization middleware has already made the decision.
         */
        if (
            principal.isSuperAdmin === true ||
            principal.isSystemAdmin === true
        ) {
            return next();
        }

        const roles =
            collectPrincipalRoles(principal);

        const permissions =
            collectPrincipalPermissions(principal);

        const hasRole =
            roles.some((role) =>
                CONFIGURATION_ROLES.includes(role)
            );

        const requiredPermissions = write
            ? [
                'SYSTEM_SETTINGS_WRITE',
                'SYSTEM_SETTING_WRITE',
                'CONFIGURATION_WRITE',
                'SETTINGS_WRITE',
                'ADMIN'
            ]
            : [
                'SYSTEM_SETTINGS_READ',
                'SYSTEM_SETTING_READ',
                'CONFIGURATION_READ',
                'SETTINGS_READ',
                'ADMIN'
            ];

        const hasPermission =
            permissions.some((permission) =>
                requiredPermissions.includes(permission)
            );

        /**
         * Read operations may be granted to configuration administrators,
         * while mutation operations require explicit write capability or an
         * elevated administrative role.
         */
        if (hasRole) {
            return next();
        }

        if (hasPermission) {
            return next();
        }

        return res.status(403).json({
            success: false,
            error: {
                code: 'SYSTEM_SETTING_ACCESS_DENIED',
                message: write
                    ? 'You are not authorized to modify TITech system settings.'
                    : 'You are not authorized to access TITech system settings.'
            }
        });
    };
}

/**
 * =============================================================================
 * REQUEST ID / CORRELATION MIDDLEWARE
 * =============================================================================
 *
 * The controller/service can use req.requestId when available.
 *
 * Existing upstream request-ID middleware remains authoritative.
 */

function ensureRequestId(req, res, next) {
    const requestId =
        req.id ||
        req.requestId ||
        req.headers['x-request-id'] ||
        req.headers['x-correlation-id'];

    if (requestId) {
        req.requestId = String(requestId);
    }

    return next();
}

/**
 * =============================================================================
 * VALIDATION MIDDLEWARE
 * =============================================================================
 *
 * The validator module is intentionally resolved without making assumptions
 * about whether the project exports:
 *
 *   validateCreate
 *   validateUpdate
 *   validateSetValue
 *   validateKey
 *   etc.
 *
 * Missing validation middleware is treated as a deployment/configuration error
 * for mutation endpoints and fails closed.
 * =============================================================================
 */

let systemSettingValidator = null;

try {
    systemSettingValidator =
        require('../validators/systemSettingValidator');
} catch (error) {
    systemSettingValidator = null;
}

/**
 * Resolve a validator middleware by preferred export names.
 */

function resolveValidator(names, options = {}) {
    if (!systemSettingValidator) {
        if (options.required === false) {
            return function optionalValidator(req, res, next) {
                next();
            };
        }

        return function missingValidator(req, res) {
            return res.status(500).json({
                success: false,
                error: {
                    code: 'SYSTEM_SETTING_VALIDATOR_UNAVAILABLE',
                    message:
                        'System setting validation middleware is not configured.'
                }
            });
        };
    }

    for (const name of names) {
        if (
            typeof systemSettingValidator[name] === 'function'
        ) {
            return systemSettingValidator[name];
        }
    }

    /**
     * Support a validator module exporting one middleware function directly.
     */
    if (
        typeof systemSettingValidator === 'function'
    ) {
        return systemSettingValidator;
    }

    if (options.required === false) {
        return function optionalValidator(req, res, next) {
            next();
        };
    }

    return function missingValidator(req, res) {
        return res.status(500).json({
            success: false,
            error: {
                code: 'SYSTEM_SETTING_VALIDATOR_EXPORT_MISSING',
                message:
                    'Required system setting validation middleware is not exported.'
            }
        });
    };
}

/**
 * =============================================================================
 * VALIDATORS
 * =============================================================================
 */

const validateCreate =
    resolveValidator(
        [
            'validateCreate',
            'create',
            'validateCreateSetting',
            'validateCreateSystemSetting'
        ]
    );

const validateUpdate =
    resolveValidator(
        [
            'validateUpdate',
            'update',
            'validateUpdateSetting',
            'validateUpdateSystemSetting'
        ]
    );

const validateSetValue =
    resolveValidator(
        [
            'validateSetValue',
            'setValue',
            'validateValue',
            'validateSetSettingValue'
        ]
    );

const validateKey =
    resolveValidator(
        [
            'validateKey',
            'key',
            'validateSettingKey'
        ],
        {
            required: false
        }
    );

const validateTenant =
    resolveValidator(
        [
            'validateTenant',
            'tenant',
            'validateTenantScope'
        ],
        {
            required: false
        }
    );

/**
 * =============================================================================
 * ROUTE PARAMETER VALIDATION
 * =============================================================================
 */

function validateKeyParameter(req, res, next) {
    const key =
        req.params &&
        req.params.key;

    if (
        typeof key !== 'string' ||
        !key.trim()
    ) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_SETTING_KEY',
                message: 'A valid system setting key is required.'
            }
        });
    }

    return next();
}

/**
 * =============================================================================
 * TENANT SCOPE SAFETY
 * =============================================================================
 *
 * Prevent accidental SYSTEM-scope mutation through a tenant endpoint.
 *
 * The controller remains responsible for determining whether the authenticated
 * principal is actually permitted to operate on the requested tenant.
 * =============================================================================
 */

function rejectSystemTenantMutation(req, res, next) {
    const tenantId =
        req.params &&
        req.params.tenantId;

    if (
        tenantId &&
        String(tenantId)
            .trim()
            .toUpperCase() === 'SYSTEM'
    ) {
        return res.status(403).json({
            success: false,
            error: {
                code: 'SYSTEM_SCOPE_REQUIRES_PRIVILEGED_ENDPOINT',
                message:
                    'SYSTEM-level configuration requires the privileged SYSTEM settings endpoint.'
            }
        });
    }

    return next();
}

/**
 * =============================================================================
 * ROUTE CONTROLLER METHOD RESOLUTION
 * =============================================================================
 *
 * This keeps the route compatible with either conventional naming or
 * enterprise-specific controller naming.
 * =============================================================================
 */

function controllerMethod(names) {
    for (const name of names) {
        if (
            typeof systemSettingController[name] === 'function'
        ) {
            return systemSettingController[name];
        }
    }

    return function missingControllerMethod(req, res) {
        return res.status(500).json({
            success: false,
            error: {
                code: 'SYSTEM_SETTING_CONTROLLER_METHOD_UNAVAILABLE',
                message:
                    'The requested TITech system-setting operation is not configured.'
            }
        });
    };
}

/**
 * =============================================================================
 * CONTROLLER HANDLERS
 * =============================================================================
 */

const listSettings =
    controllerMethod([
        'listSettings',
        'getAllSettings',
        'list'
    ]);

const getSetting =
    controllerMethod([
        'getSetting',
        'get'
    ]);

const createSetting =
    controllerMethod([
        'createSetting',
        'create'
    ]);

const updateSetting =
    controllerMethod([
        'updateSetting',
        'update'
    ]);

const setValue =
    controllerMethod([
        'setValue',
        'setSettingValue',
        'updateValue'
    ]);

const enableSetting =
    controllerMethod([
        'enableSetting',
        'enable'
    ]);

const disableSetting =
    controllerMethod([
        'disableSetting',
        'disable'
    ]);

const getEffectiveSetting =
    controllerMethod([
        'getEffectiveSetting',
        'getEffective'
    ]);

const getCategory =
    controllerMethod([
        'getCategory',
        'listCategory',
        'getSettingsByCategory'
    ]);

const getHealthSummary =
    controllerMethod([
        'getHealthSummary',
        'healthSummary',
        'health'
    ]);

const disableTenantOverride =
    controllerMethod([
        'disableTenantOverride',
        'resetTenantOverride'
    ]);

/**
 * =============================================================================
 * ROUTE SECURITY STACK
 * =============================================================================
 */

const authenticated =
    [
        ensureRequestId,
        requireAuthentication
    ];

const readAccess =
    [
        ...authenticated,
        requireConfigurationAccess({
            write: false
        })
    ];

const writeAccess =
    [
        ...authenticated,
        requireConfigurationAccess({
            write: true
        })
    ];

/**
 * =============================================================================
 * HEALTH / OPERATIONAL SUMMARY
 * =============================================================================
 *
 * GET
 *   /health
 *
 * Example:
 *   GET /api/v1/system-settings/health
 * =============================================================================
 */

router.get(
    '/health',
    ...readAccess,
    getHealthSummary
);

/**
 * =============================================================================
 * CATEGORY ROUTE
 * =============================================================================
 *
 * Must appear before /:key to avoid "category" being interpreted as a key.
 *
 * GET
 *   /category/:category
 * =============================================================================
 */

router.get(
    '/category/:category',
    ...readAccess,
    getCategory
);

/**
 * =============================================================================
 * EFFECTIVE SETTING
 * =============================================================================
 *
 * Tenant configuration overrides SYSTEM configuration.
 *
 * GET
 *   /effective/:key
 *
 * Tenant scope should normally be supplied through an authorized tenant
 * context rather than arbitrary client-controlled data.
 * =============================================================================
 */

router.get(
    '/effective/:key',
    ...readAccess,
    validateKeyParameter,
    validateKey,
    getEffectiveSetting
);

/**
 * =============================================================================
 * SYSTEM-LEVEL SETTINGS
 * =============================================================================
 *
 * These endpoints represent global TITech configuration.
 *
 * GET
 *   /system
 *
 * POST
 *   /system
 *
 * PATCH
 *   /system/:key
 *
 * PUT
 *   /system/:key/value
 *
 * PATCH
 *   /system/:key/enable
 *
 * PATCH
 *   /system/:key/disable
 * =============================================================================
 */

router.get(
    '/system',
    ...readAccess,
    listSettings
);

router.post(
    '/system',
    ...writeAccess,
    validateCreate,
    createSetting
);

router.get(
    '/system/:key',
    ...readAccess,
    validateKeyParameter,
    validateKey,
    getSetting
);

router.patch(
    '/system/:key',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    validateUpdate,
    updateSetting
);

router.put(
    '/system/:key/value',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    validateSetValue,
    setValue
);

router.patch(
    '/system/:key/enable',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    enableSetting
);

router.patch(
    '/system/:key/disable',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    disableSetting
);

/**
 * =============================================================================
 * TENANT SETTINGS
 * =============================================================================
 *
 * GET
 *   /tenant/:tenantId
 *
 * POST
 *   /tenant/:tenantId
 *
 * GET
 *   /tenant/:tenantId/:key
 *
 * PATCH
 *   /tenant/:tenantId/:key
 *
 * PUT
 *   /tenant/:tenantId/:key/value
 *
 * PATCH
 *   /tenant/:tenantId/:key/enable
 *
 * PATCH
 *   /tenant/:tenantId/:key/disable
 *
 * The controller/service must independently verify that the authenticated
 * principal has access to the requested tenant.
 * =============================================================================
 */

router.get(
    '/tenant/:tenantId',
    ...readAccess,
    validateTenant,
    listSettings
);

router.post(
    '/tenant/:tenantId',
    ...writeAccess,
    validateTenant,
    validateCreate,
    rejectSystemTenantMutation,
    createSetting
);

router.get(
    '/tenant/:tenantId/:key',
    ...readAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    getSetting
);

router.patch(
    '/tenant/:tenantId/:key',
    ...writeAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    validateUpdate,
    rejectSystemTenantMutation,
    updateSetting
);

router.put(
    '/tenant/:tenantId/:key/value',
    ...writeAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    validateSetValue,
    rejectSystemTenantMutation,
    setValue
);

router.patch(
    '/tenant/:tenantId/:key/enable',
    ...writeAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    rejectSystemTenantMutation,
    enableSetting
);

router.patch(
    '/tenant/:tenantId/:key/disable',
    ...writeAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    rejectSystemTenantMutation,
    disableSetting
);

/**
 * =============================================================================
 * TENANT OVERRIDE MANAGEMENT
 * =============================================================================
 *
 * POST/PATCH operations affecting tenant overrides should remain explicit.
 *
 * DELETE is intentionally avoided because SystemSetting maintains configuration
 * history and the model's disableTenantOverride() performs a logical disable.
 *
 * POST
 *   /tenant/:tenantId/:key/reset
 *
 * This logically disables the tenant override so the SYSTEM value becomes
 * effective again.
 * =============================================================================
 */

router.post(
    '/tenant/:tenantId/:key/reset',
    ...writeAccess,
    validateTenant,
    validateKeyParameter,
    validateKey,
    rejectSystemTenantMutation,
    disableTenantOverride
);

/**
 * =============================================================================
 * GENERIC SETTING LOOKUP
 * =============================================================================
 *
 * These routes are intentionally placed after the explicit routes above.
 *
 * GET
 *   /:key
 *
 * PATCH
 *   /:key
 *
 * PUT
 *   /:key/value
 *
 * They are useful for backward compatibility with existing TITech clients
 * while the explicit /system and /tenant/:tenantId APIs remain preferred.
 * =============================================================================
 */

router.get(
    '/:key',
    ...readAccess,
    validateKeyParameter,
    validateKey,
    getSetting
);

router.patch(
    '/:key',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    validateUpdate,
    updateSetting
);

router.put(
    '/:key/value',
    ...writeAccess,
    validateKeyParameter,
    validateKey,
    validateSetValue,
    setValue
);

/**
 * =============================================================================
 * ROUTER ERROR GUARD
 * =============================================================================
 *
 * Route-local errors should be forwarded to the application's centralized
 * Express error handler. We intentionally do not serialize arbitrary errors
 * here because production error handling should remain centralized.
 * =============================================================================
 */

router.use(
    (error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }

        return next(error);
    }
);

/**
 * =============================================================================
 * ROUTER METADATA
 * =============================================================================
 *
 * Useful for diagnostics/tests without exposing internal implementation.
 * =============================================================================
 */

router.systemSettingRoutes = true;
router.resource = 'system-settings';
router.service = 'TITech Community Capital';

/**
 * =============================================================================
 * EXPORT
 * =============================================================================
 */

module.exports = router;