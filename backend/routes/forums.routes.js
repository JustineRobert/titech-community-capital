'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Community Forums Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/forums.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP routing boundary for TITech Community Capital community forums.
 *
 * Public endpoints
 * ----------------------------------------------------------------------------
 * GET  /categories
 * GET  /category/:slug
 * GET  /topic/:slug
 * GET  /trending
 * GET  /latest
 * GET  /search
 *
 * Authenticated endpoints
 * ----------------------------------------------------------------------------
 * POST /topic
 * POST /topic/:topicId/reply
 * POST /reply/:replyId/accept
 * POST /:targetId/react
 *
 * Administrative endpoint
 * ----------------------------------------------------------------------------
 * POST /init
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   RBAC / Object Authorization
 *        ↓
 *   Validation
 *        ↓
 *   Forum Controller
 *        ↓
 *   Service / Repository
 *
 * This router MUST NOT:
 *
 *   ✗ access the database directly
 *   ✗ trust client-supplied tenantId
 *   ✗ implement forum business rules
 *   ✗ perform moderation logic directly
 *   ✗ expose internal exceptions
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
    query,
    body,
} = require('express-validator');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const forumController =
    require(
        '../controllers/forumController'
    );

const authMiddleware =
    require(
        '../middleware/authMiddleware'
    );

/**
 * ============================================================================
 * AUTHENTICATION CONTRACT
 * ============================================================================
 */

const verifyAccessToken =
    authMiddleware?.verifyAccessToken ||
    authMiddleware?.authenticate ||
    authMiddleware?.verifyToken;

if (
    typeof verifyAccessToken !==
    'function'
) {
    throw new TypeError(
        '[TITechForumsRoutes] Authentication middleware is not available.'
    );
}

/**
 * ============================================================================
 * OPTIONAL ROLE / PERMISSION MIDDLEWARE
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
 * OPTIONAL ADMIN CONTEXT
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
                    'TITech Community Forums API',

                serviceVersion:
                    '2026.1',
            });
    }
} catch {
    adminContextMiddleware =
        null;
}

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechForumsRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Community Forums';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_FORUMS_BODY_LIMIT ||
    '1mb';

const MAX_ID_LENGTH =
    200;

const MAX_SEARCH_LENGTH =
    200;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'getCategories',
        'getTopicsByCategory',
        'getTopic',
        'getTrendingTopics',
        'getLatestTopics',
        'searchTopics',
        'createTopic',
        'addReply',
        'acceptAnswer',
        'reactToContent',
        'initializeForum',
    ]);

for (
    const name of
        REQUIRED_CONTROLLERS
) {
    if (
        typeof forumController?.[
            name
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing forumController.${name} export.`
        );
    }
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
        value === undefined ||
        value === null
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
            'X-Frame-Options',
            'DENY'
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
 * RATE LIMITERS
 * ============================================================================
 */

const publicReadLimiter =
    createLimiter({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FORUMS_PUBLIC_RATE_LIMIT',
                180
            ),

        code:
            'FORUMS_READ_RATE_LIMITED',

        message:
            'Too many forum requests. Please try again later.',
    });

const writeLimiter =
    createLimiter({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FORUMS_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'FORUMS_WRITE_RATE_LIMITED',

        message:
            'Too many forum write requests. Please try again later.',
    });

const reactionLimiter =
    createLimiter({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FORUMS_REACTION_RATE_LIMIT',
                60
            ),

        code:
            'FORUMS_REACTION_RATE_LIMITED',

        message:
            'Too many forum reaction requests. Please try again later.',
    });

const adminLimiter =
    createLimiter({
        windowMs:
            15 * 60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FORUMS_ADMIN_RATE_LIMIT',
                20
            ),

        code:
            'FORUMS_ADMIN_RATE_LIMITED',

        message:
            'Too many administrative forum requests. Please try again later.',
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
    windowMs,
    max,
    code,
    message,
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

function validateRouteId(
    name
) {
    return (
        req,
        res,
        next
    ) => {
        const value =
            normalizeString(
                req.params?.[
                    name
                ]
            );

        if (!value) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FORUM_ROUTE_PARAMETER_REQUIRED',

                    message:
                        `${name} is required.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        if (
            value.length >
            MAX_ID_LENGTH
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FORUM_ROUTE_PARAMETER_TOO_LONG',

                    message:
                        `${name} exceeds the maximum supported length.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        if (
            /[\u0000-\u001F\u007F]/.test(
                value
            )
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FORUM_ROUTE_PARAMETER_INVALID',

                    message:
                        `${name} contains unsupported characters.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        next();
    };
}

/**
 * ============================================================================
 * SLUG VALIDATION
 * ============================================================================
 */

function validateSlug(
    name
) {
    return [
        param(name)
            .trim()
            .notEmpty()
            .withMessage(
                `${name} is required.`
            )
            .isLength({
                max:
                    120
            })
            .withMessage(
                `${name} is too long.`
            )
            .matches(
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/i
            )
            .withMessage(
                `${name} must be a valid slug.`
            ),
    ];
}

/**
 * ============================================================================
 * SEARCH VALIDATION
 * ============================================================================
 */

const searchValidators =
    [
        query('q')
            .optional()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_SEARCH_LENGTH
            })
            .withMessage(
                `Search query must be between 1 and ${MAX_SEARCH_LENGTH} characters.`
            )
            .custom(
                value => {
                    if (
                        /[\u0000-\u001F\u007F]/.test(
                            value
                        )
                    ) {
                        throw new Error(
                            'Search query contains unsupported characters.'
                        );
                    }

                    return true;
                }
            ),

        query('page')
            .optional()
            .toInt()
            .isInt({
                min:
                    1
            })
            .withMessage(
                'page must be at least 1.'
            ),

        query('limit')
            .optional()
            .toInt()
            .isInt({
                min:
                    1,

                max:
                    100
            })
            .withMessage(
                'limit must be between 1 and 100.'
            ),
    ];

/**
 * ============================================================================
 * VALIDATION MIDDLEWARE
 * ============================================================================
 */

let handleValidation =
    null;

try {
    const validators =
        require(
            '../utils/validators'
        );

    handleValidation =
        validators.handleValidation ||
        validators.handleValidationErrors ||
        null;
} catch {
    handleValidation =
        null;
}

function validate(
    rules
) {
    return [
        ...rules,

        ...(typeof handleValidation ===
        'function'
            ? [
                handleValidation,
            ]
            : []),
    ];
}

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT FALLBACK
 * ============================================================================
 */

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

    if (!tenantId) {
        return res
            .status(403)
            .json({
                success:
                    false,

                code:
                    'FORUM_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for forum operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            });
    }

    if (!actorId) {
        return res
            .status(401)
            .json({
                success:
                    false,

                code:
                    'FORUM_ACTOR_CONTEXT_REQUIRED',

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

/**
 * ============================================================================
 * PUBLIC ENDPOINTS
 * ============================================================================
 */

router.get(
    '/categories',

    publicReadLimiter,

    asyncHandler(
        forumController.getCategories
    )
);

router.get(
    '/category/:slug',

    publicReadLimiter,

    validate(
        validateSlug(
            'slug'
        )
    ),

    asyncHandler(
        forumController.getTopicsByCategory
    )
);

router.get(
    '/topic/:slug',

    publicReadLimiter,

    validate(
        validateSlug(
            'slug'
        )
    ),

    asyncHandler(
        forumController.getTopic
    )
);

router.get(
    '/trending',

    publicReadLimiter,

    asyncHandler(
        forumController.getTrendingTopics
    )
);

router.get(
    '/latest',

    publicReadLimiter,

    asyncHandler(
        forumController.getLatestTopics
    )
);

router.get(
    '/search',

    publicReadLimiter,

    validate(
        searchValidators
    ),

    asyncHandler(
        forumController.searchTopics
    )
);

/**
 * ============================================================================
 * AUTHENTICATED FORUM CONTEXT
 * ============================================================================
 */

router.use(
    verifyAccessToken
);

if (
    adminContextMiddleware
) {
    router.use(
        adminContextMiddleware
    );
} else {
    router.use(
        fallbackTenantContext
    );
}

/**
 * ============================================================================
 * CREATE TOPIC
 * ============================================================================
 */

router.post(
    '/topic',

    writeLimiter,

    asyncHandler(
        forumController.createTopic
    )
);

/**
 * ============================================================================
 * REPLY
 * ============================================================================
 */

router.post(
    '/topic/:topicId/reply',

    writeLimiter,

    validate([
        validateRouteId(
            'topicId'
        )[0],
    ]),

    asyncHandler(
        forumController.addReply
    )
);

/**
 * ============================================================================
 * ACCEPT ANSWER
 * ============================================================================
 *
 * The controller/service should perform final ownership/moderation checks.
 * This route only establishes authenticated access.
 * ============================================================================
 */

router.post(
    '/reply/:replyId/accept',

    writeLimiter,

    validate([
        validateRouteId(
            'replyId'
        )[0],
    ]),

    asyncHandler(
        forumController.acceptAnswer
    )
);

/**
 * ============================================================================
 * CONTENT REACTION
 * ============================================================================
 */

router.post(
    '/:targetId/react',

    reactionLimiter,

    validate([
        validateRouteId(
            'targetId'
        )[0],
        body('reaction')
            .exists()
            .withMessage(
                'reaction is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    50,
            })
            .withMessage(
                'reaction is invalid.'
            ),
    ]),

    asyncHandler(
        forumController.reactToContent
    )
);

/**
 * ============================================================================
 * ADMIN INITIALIZATION
 * ============================================================================
 *
 * Forum initialization is a privileged data/configuration mutation.
 *
 * It MUST NOT remain publicly accessible.
 * ============================================================================
 */

router.post(
    '/init',

    adminLimiter,

    typeof requireRole ===
    'function'
        ? requireRole(
            'admin'
        )
        : (
            req,
            res
        ) =>
            res
                .status(500)
                .json({
                    success:
                        false,

                    code:
                        'FORUM_ADMIN_AUTH_UNAVAILABLE',

                    message:
                        'Forum administrative authorization is unavailable.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                }),

    asyncHandler(
        forumController.initializeForum
    )
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
    '/health',

    publicReadLimiter,

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
 * NOT FOUND
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
                    'FORUM_ROUTE_NOT_FOUND',

                message:
                    'Forum endpoint not found.',

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

        const response =
            {
                success:
                    false,

                code:
                    normalizeString(
                        error?.code
                    ) ||
                    (
                        clientError
                            ? 'FORUM_REQUEST_ERROR'
                            : 'FORUM_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The forum request could not be completed.'
                        )
                        : 'The forum request could not be completed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
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