'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Group Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/groups.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for TITech Community Capital group-management
 * operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /groups
 * POST /:groupId/send-invitations
 * POST /join/:id
 * GET  /
 * POST /seed
 *
 * Security architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   RBAC / Domain Authorization
 *        ↓
 *   Group Controller
 *        ↓
 *   Group Service
 *        ↓
 *   Repository
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router MUST NOT:
 *
 *   ✗ access MongoDB directly
 *   ✗ choose tenantId from request body/query
 *   ✗ implement membership rules
 *   ✗ send invitations directly
 *   ✗ seed production data for ordinary users
 *
 * Business rules remain in controllers/services.
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
    param,
} = require('express-validator');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const asyncHandler =
    require(
        '../utils/asyncHandler'
    );

const {
    handleValidation,
} =
    require(
        '../utils/validators'
    );

const groupController =
    require(
        '../controllers/groupController'
    );

const {
    verifyToken,
} =
    require(
        '../middleware/auth'
    );

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechGroupsRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Groups API';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_GROUPS_BODY_LIMIT ||
    '512kb';

const MAX_GROUP_ID_LENGTH =
    128;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'createGroup',
        'sendBatchInvitations',
        'joinGroup',
        'getGroups',
        'seedGroups',
    ]);

for (
    const method of
    REQUIRED_CONTROLLERS
) {
    if (
        typeof groupController?.[
            method
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing groupController.${method} export.`
        );
    }
}

/**
 * ============================================================================
 * AUTHENTICATION CONTRACT
 * ============================================================================
 */

if (
    typeof verifyToken !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] verifyToken middleware is required.`
    );
}

/**
 * ============================================================================
 * OPTIONAL ADMIN ROLE MIDDLEWARE
 * ============================================================================
 */

let requireRole =
    null;

try {
    const auth =
        require(
            '../middleware/auth'
        );

    requireRole =
        auth?.requireRole ||
        null;
} catch {
    requireRole =
        null;
}

/**
 * ============================================================================
 * REQUEST METADATA
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
 * SECURITY HEADERS
 * ============================================================================
 */

router.use(
    (
        req,
        res,
        next
    ) => {
        res.setHeader(
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'strict-origin-when-cross-origin'
        );

        res.setHeader(
            'Cache-Control',
            'no-store'
        );

        res.setHeader(
            'Pragma',
            'no-cache'
        );

        next();
    }
);

/**
 * ============================================================================
 * BODY PARSER
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            DEFAULT_BODY_LIMIT,

        strict:
            true,
    })
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

router.use(
    verifyToken
);

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT
 * ============================================================================
 *
 * Prefer the canonical TITech admin context when available.
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
            req.tenantId ||
                req.user?.tenantId ||
                req.auth?.tenantId
        );

    const actorId =
        normalizeString(
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
                    'GROUP_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for group operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
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
                    'GROUP_ACTOR_CONTEXT_REQUIRED',

                message:
                    'An authenticated actor context is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            });
    }

    req.tenantId =
        tenantId;

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
 * RATE LIMITERS
 * ============================================================================
 */

const readLimiter =
    createLimiter({
        max:
            getPositiveIntegerEnv(
                'TITECH_GROUP_READ_RATE_LIMIT',
                120
            ),

        code:
            'GROUP_READ_RATE_LIMITED',

        message:
            'Too many group queries. Please try again later.'
    });

const writeLimiter =
    createLimiter({
        max:
            getPositiveIntegerEnv(
                'TITECH_GROUP_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'GROUP_WRITE_RATE_LIMITED',

        message:
            'Too many group operation requests. Please try again later.'
    });

const invitationLimiter =
    createLimiter({
        max:
            getPositiveIntegerEnv(
                'TITECH_GROUP_INVITATION_RATE_LIMIT',
                10
            ),

        code:
            'GROUP_INVITATION_RATE_LIMITED',

        message:
            'Too many group invitation requests. Please try again later.'
    });

const seedLimiter =
    createLimiter({
        max:
            getPositiveIntegerEnv(
                'TITECH_GROUP_SEED_RATE_LIMIT',
                3
            ),

        windowMs:
            15 *
            60 *
            1000,

        code:
            'GROUP_SEED_RATE_LIMITED',

        message:
            'Too many group initialization requests. Please try again later.'
    });

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const value =
        Number(
            process.env[name]
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

function createLimiter({
    max,
    code,
    message,
    windowMs =
        60 *
        1000,
}) {
    return rateLimit({
        windowMs,

        max,

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
                    req.user?.id ||
                        req.user?._id ||
                        req.user?.userId ||
                        req.auth?.userId
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
            const retryAfter =
                Math.ceil(
                    windowMs /
                        1000
                );

            res.setHeader(
                'Retry-After',
                String(
                    retryAfter
                )
            );

            return res
                .status(429)
                .json({
                    success:
                        false,

                    code,

                    message,

                    retryAfter,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString()
                });
        }
    });
}

/**
 * ============================================================================
 * ROUTE PARAMETER VALIDATION
 * ============================================================================
 */

function validateGroupId(
    parameterName
) {
    return [
        param(
            parameterName
        )
            .exists()
            .withMessage(
                `${parameterName} is required.`
            )
            .bail()
            .isMongoId()
            .withMessage(
                `${parameterName} must be a valid MongoDB ObjectId.`
            ),
    ];
}

/**
 * ============================================================================
 * ADMIN / INITIALIZATION AUTHORIZATION
 * ============================================================================
 *
 * Seed/initialization routes are configuration/data mutation endpoints and
 * should never be available to ordinary members.
 * ============================================================================
 */

function requireGroupAdmin(
    req,
    res,
    next
) {
    if (
        typeof requireRole !==
        'function'
    ) {
        return res
            .status(500)
            .json({
                success:
                    false,

                code:
                    'GROUP_ADMIN_AUTH_UNAVAILABLE',

                message:
                    'Group administrative authorization is unavailable.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            });
    }

    return requireRole(
        'admin'
    )(
        req,
        res,
        next
    );
}

/**
 * ============================================================================
 * CREATE GROUP
 * ============================================================================
 *
 * POST /api/groups/groups
 *
 * NOTE:
 * Keep this path if your current application already mounts `/groups` and
 * clients depend on `/groups`. Consider standardizing the resource path to
 * POST `/api/groups` during a future API version migration.
 * ============================================================================
 */

router.post(
    '/groups',

    writeLimiter,

    asyncHandler(
        groupController.createGroup
    )
);

/**
 * ============================================================================
 * SEND BATCH INVITATIONS
 * ============================================================================
 */

router.post(
    '/:groupId/send-invitations',

    invitationLimiter,

    validateGroupId(
        'groupId'
    ),

    handleValidation,

    asyncHandler(
        groupController.sendBatchInvitations
    )
);

/**
 * ============================================================================
 * JOIN GROUP
 * ============================================================================
 */

router.post(
    '/join/:id',

    writeLimiter,

    validateGroupId(
        'id'
    ),

    handleValidation,

    asyncHandler(
        groupController.joinGroup
    )
);

/**
 * ============================================================================
 * LIST GROUPS
 * ============================================================================
 */

router.get(
    '/',

    readLimiter,

    asyncHandler(
        groupController.getGroups
    )
);

/**
 * ============================================================================
 * GROUP INITIALIZATION / SEED
 * ============================================================================
 *
 * POST /api/groups/seed
 *
 * This is no longer available to every authenticated user.
 *
 * If your seeding mechanism is intended for deployment-only operations rather
 * than administrator use, move it to a dedicated migration/CLI command instead
 * of exposing it through HTTP.
 * ============================================================================
 */

router.post(
    '/seed',

    seedLimiter,

    requireGroupAdmin,

    asyncHandler(
        groupController.seedGroups
    )
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
    '/health',

    readLimiter,

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

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString()
            });
    }
);

/**
 * ============================================================================
 * ROUTE NOT FOUND
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
                    'GROUP_ROUTE_NOT_FOUND',

                message:
                    'Group endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString()
            });
    }
);

/**
 * ============================================================================
 * CENTRALIZED ERROR HANDLER
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

        const response = {
            success:
                false,

            code:
                normalizeString(
                    error?.code
                ) ||
                (
                    clientError
                        ? 'GROUP_REQUEST_ERROR'
                        : 'GROUP_INTERNAL_ERROR'
                ),

            message:
                clientError
                    ? (
                        error?.message ||
                        'The group request could not be completed.'
                    )
                    : 'The group request could not be completed.',

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            timestamp:
                new Date().toISOString()
        };

        if (
            clientError &&
            error?.details
        ) {
            response.details =
                error.details;
        }

        return res
            .status(
                statusCode
            )
            .json(
                response
            );
    }
);

/**
 * ============================================================================
 * ROUTER METADATA
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
 * EXPORT
 * ============================================================================
 */

module.exports =
    router;