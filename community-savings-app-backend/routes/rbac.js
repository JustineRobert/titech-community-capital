'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise RBAC Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/rbac.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for Role-Based Access Control (RBAC) management.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /permission
 * POST /role
 * POST /assign
 *
 * Security chain
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Input Validation
 *        ↓
 *   Permission Check
 *        ↓
 *   RBAC Controller
 *        ↓
 *   RBAC Service
 *        ↓
 *   Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ modify roles/permissions directly
 *   ✗ access the database directly
 *   ✗ trust tenantId from request body
 *   ✗ permit privilege escalation
 *   ✗ allow ordinary users to assign themselves privileged roles
 *   ✗ expose internal RBAC errors
 *
 * The controller/service layer remains responsible for:
 *   - role hierarchy
 *   - permission inheritance
 *   - privileged-role restrictions
 *   - maker/checker policies
 *   - tenant isolation
 *   - audit logging
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express =
    require('express');

const crypto =
    require('node:crypto');

const rateLimit =
    require('express-rate-limit');

const {
    body,
} =
    require('express-validator');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const requireAuth =
    require(
        '../middleware/requireAuth'
    );

const checkPermission =
    require(
        '../middleware/checkPermission'
    );

const rbacController =
    require(
        '../controllers/rbac.controller'
    );

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechRbacRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech RBAC API';

const MAX_NAME_LENGTH =
    128;

const MAX_DESCRIPTION_LENGTH =
    500;

const MAX_ROLE_NAME_LENGTH =
    100;

const MAX_PERMISSION_NAME_LENGTH =
    128;

/**
 * ============================================================================
 * Dependency Contracts
 * ============================================================================
 */

if (
    typeof requireAuth !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] requireAuth middleware is required.`
    );
}

if (
    typeof checkPermission !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] checkPermission middleware is required.`
    );
}

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'createPermission',
        'createRole',
        'assignRole',
    ]);

for (
    const method of
        REQUIRED_CONTROLLERS
) {
    if (
        typeof rbacController?.[
            method
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing rbacController.${method} export.`
        );
    }
}

/**
 * ============================================================================
 * Request Metadata
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        fallback
    );
}

function requestMetadata(
    req,
    res,
    next
) {
    const requestId =
        normalizeString(
            req.requestId
        ) ||
        normalizeString(
            req.id
        ) ||
        normalizeString(
            req.headers?.[
                'x-request-id'
            ]
        ) ||
        crypto.randomUUID();

    const correlationId =
        normalizeString(
            req.correlationId
        ) ||
        normalizeString(
            req.headers?.[
                'x-correlation-id'
            ]
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    res.setHeader(
        'X-Request-Id',
        requestId
    );

    res.setHeader(
        'X-Correlation-Id',
        correlationId
    );

    next();
}

router.use(
    requestMetadata
);

/**
 * ============================================================================
 * Security Headers
 * ============================================================================
 */

router.use(
    (
        req,
        res,
        next
    ) => {
        res.setHeader(
            'Cache-Control',
            'no-store'
        );

        res.setHeader(
            'Pragma',
            'no-cache'
        );

        res.setHeader(
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer'
        );

        next();
    }
);

/**
 * ============================================================================
 * Body Parser
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            process.env.TITECH_RBAC_BODY_LIMIT ||
            '256kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 *
 * All RBAC endpoints require an authenticated principal.
 * ============================================================================
 */

router.use(
    requireAuth
);

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 *
 * RBAC data is tenant-scoped. A request must never be able to select another
 * tenant using a client-supplied tenantId.
 * ============================================================================
 */

let adminContextMiddleware =
    null;

try {
    const adminContext =
        require(
            '../utils/admin/adminContext'
        );

    if (
        typeof adminContext?.middleware ===
            'function'
    ) {
        adminContextMiddleware =
            adminContext.middleware({
                requiredTenant:
                    true,

                requiredActor:
                    true,

                service:
                    SERVICE_NAME,

                serviceVersion:
                    ROUTER_VERSION,
            });
    }
} catch {
    adminContextMiddleware =
        null;
}

function fallbackTenantContext(
    req,
    res,
    next
) {
    const tenantId =
        normalizeString(
            req.adminContext?.tenantId ||
                req.tenantId ||
                req.user?.tenantId ||
                req.auth?.tenantId
        );

    const actorId =
        normalizeString(
            req.adminContext?.actorId ||
                req.user?.id ||
                req.user?._id ||
                req.user?.userId ||
                req.auth?.userId
        );

    if (
        !tenantId
    ) {
        return res
            .status(403)
            .json({
                success:
                    false,

                code:
                    'RBAC_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for RBAC operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !actorId
    ) {
        return res
            .status(401)
            .json({
                success:
                    false,

                code:
                    'RBAC_ACTOR_CONTEXT_REQUIRED',

                message:
                    'An authenticated actor context is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.tenantId =
        tenantId;

    req.rbacActorId =
        actorId;

    req.adminContext =
        {
            tenantId,

            actorId,

            userId:
                actorId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        };

    next();
}

router.use(
    adminContextMiddleware ||
        fallbackTenantContext
);

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const rbacWriteLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_RBAC_WRITE_RATE_LIMIT',
                30
            ),

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        keyGenerator(
            req
        ) {
            return (
                normalizeString(
                    req.rbacActorId ||
                        req.user?.id ||
                        req.user?._id ||
                        req.user?.userId ||
                        req.auth?.userId
                ) ||
                normalizeString(
                    req.tenantId
                ) ||
                normalizeString(
                    req.ip
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res
        ) {
            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'RBAC_RATE_LIMITED',

                    message:
                        'Too many RBAC management requests. Please try again later.',

                    retryAfter:
                        60,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    });

/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

const permissionValidators =
    [
        body('name')
            .exists()
            .withMessage(
                'Permission name is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    3,

                max:
                    MAX_PERMISSION_NAME_LENGTH
            })
            .withMessage(
                `Permission name must be between 3 and ${MAX_PERMISSION_NAME_LENGTH} characters.`
            )
            .matches(
                /^[a-z0-9:_-]+$/i
            )
            .withMessage(
                'Permission name may contain letters, numbers, colon, underscore and hyphen only.'
            ),

        body('description')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_DESCRIPTION_LENGTH
            })
            .withMessage(
                `Permission description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
            ),

        rejectClientTenant(),
    ];

const roleValidators =
    [
        body('name')
            .exists()
            .withMessage(
                'Role name is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    2,

                max:
                    MAX_ROLE_NAME_LENGTH
            })
            .withMessage(
                `Role name must be between 2 and ${MAX_ROLE_NAME_LENGTH} characters.`
            )
            .matches(
                /^[a-zA-Z0-9:_ -]+$/
            )
            .withMessage(
                'Role name contains unsupported characters.'
            ),

        body('description')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_DESCRIPTION_LENGTH
            })
            .withMessage(
                `Role description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
            ),

        body('permissions')
            .optional()
            .isArray({
                max:
                    100
            })
            .withMessage(
                'permissions must be an array of at most 100 entries.'
            ),

        body('permissions.*')
            .optional()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_PERMISSION_NAME_LENGTH
            })
            .withMessage(
                'Invalid permission name.'
            ),

        rejectClientTenant(),
    ];

const assignRoleValidators =
    [
        body('userId')
            .exists()
            .withMessage(
                'userId is required.'
            )
            .bail()
            .isMongoId()
            .withMessage(
                'userId must be a valid identifier.'
            ),

        body('role')
            .exists()
            .withMessage(
                'role is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    2,

                max:
                    MAX_ROLE_NAME_LENGTH
            })
            .withMessage(
                'Invalid role.'
            )
            .matches(
                /^[a-zA-Z0-9:_ -]+$/
            )
            .withMessage(
                'Role name contains unsupported characters.'
            ),

        rejectClientTenant(),
    ];

function rejectClientTenant() {
    return body(
        'tenantId'
    )
        .not()
        .exists()
        .withMessage(
            'tenantId must come from trusted authentication context.'
        );
}

/**
 * ============================================================================
 * Validation Middleware
 * ============================================================================
 */

function validationChain(
    rules
) {
    return [
        ...rules,
        handleValidation,
    ];
}

/**
 * ============================================================================
 * RBAC Permission Boundary
 * ============================================================================
 *
 * All RBAC mutations require the same application permission.
 *
 * Final service-level checks should still enforce:
 *   - privileged role protection
 *   - tenant isolation
 *   - administrator hierarchy
 *   - self-escalation prevention
 * ============================================================================
 */

const manageRoles =
    checkPermission(
        'roles:manage'
    );

if (
    typeof manageRoles !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] checkPermission('roles:manage') must return middleware.`
    );
}

/**
 * ============================================================================
 * Create Permission
 * ============================================================================
 *
 * POST /api/rbac/permission
 * ============================================================================
 */

router.post(
    '/permission',

    rbacWriteLimiter,

    manageRoles,

    validationChain(
        permissionValidators
    ),

    asyncHandler(
        rbacController.createPermission
    )
);

/**
 * ============================================================================
 * Create Role
 * ============================================================================
 *
 * POST /api/rbac/role
 * ============================================================================
 */

router.post(
    '/role',

    rbacWriteLimiter,

    manageRoles,

    validationChain(
        roleValidators
    ),

    asyncHandler(
        rbacController.createRole
    )
);

/**
 * ============================================================================
 * Assign Role
 * ============================================================================
 *
 * POST /api/rbac/assign
 * ============================================================================
 */

router.post(
    '/assign',

    rbacWriteLimiter,

    manageRoles,

    validationChain(
        assignRoleValidators
    ),

    asyncHandler(
        rbacController.assignRole
    )
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 */

router.get(
    '/health',
    (
        req,
        res
    ) => {
        return res
            .status(200)
            .json({
                success:
                    true,

                service:
                    SERVICE_NAME,

                version:
                    ROUTER_VERSION,

                status:
                    'UP',

                tenantScoped:
                    true,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * 404
 * ============================================================================
 */

router.use(
    (
        req,
        res
    ) => {
        return res
            .status(404)
            .json({
                success:
                    false,

                code:
                    'RBAC_ROUTE_NOT_FOUND',

                message:
                    'RBAC endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Centralized Error Handler
 * ============================================================================
 */

router.use(
    (
        error,
        req,
        res,
        next
    ) => {
        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        const statusCode =
            Number(
                error?.statusCode
            ) >= 400 &&
            Number(
                error?.statusCode
            ) < 600
                ? Number(
                    error.statusCode
                )
                : 500;

        const clientError =
            statusCode >= 400 &&
            statusCode < 500;

        return res
            .status(
                statusCode
            )
            .json({
                success:
                    false,

                code:
                    normalizeString(
                        error?.code
                    ) ||
                    (
                        clientError
                            ? 'RBAC_REQUEST_ERROR'
                            : 'RBAC_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The RBAC request could not be completed.'
                        )
                        : 'The RBAC request could not be completed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Async Handler
 * ============================================================================
 */

function asyncHandler(
    handler
) {
    return (
        req,
        res,
        next
    ) => {
        Promise
            .resolve(
                handler(
                    req,
                    res,
                    next
                )
            )
            .catch(
                next
            );
    };
}

/**
 * ============================================================================
 * Environment Helper
 * ============================================================================
 */

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const value =
        Number(
            process.env[
                name
            ]
        );

    return (
        Number.isInteger(
            value
        ) &&
        value > 0
    )
        ? value
        : fallback;
}

/**
 * ============================================================================
 * Router Metadata
 * ============================================================================
 */

router.routerName =
    ROUTER_NAME;

router.routerVersion =
    ROUTER_VERSION;

router.serviceName =
    SERVICE_NAME;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    router;