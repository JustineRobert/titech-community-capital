'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Referral Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/referrals.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for TITech Community Capital referral operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /api/referrals
 * GET  /api/referrals
 *
 * Architecture
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
 *   Validation / Normalization
 *        ↓
 *   Referral Controller
 *        ↓
 *   Referral Service
 *        ↓
 *   Tenant-scoped Persistence / Reward Logic / Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ accept userId as an authority for referral ownership
 *   ✗ accept tenantId from the request body as an authority
 *   ✗ calculate referral rewards directly
 *   ✗ award financial bonuses directly
 *   ✗ access the database directly
 *   ✗ expose internal exceptions
 *
 * Referral ownership and reward eligibility belong to the service/domain
 * layer.
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
    query,
} =
    require('express-validator');

const asyncHandler =
    require('../utils/asyncHandler');

const {
    handleValidation,
} =
    require('../utils/validators');

const auth =
    require('../middleware/auth');

const {
    createReferral,
    getUserReferrals,
} =
    require(
        '../controllers/referralController'
    );

/**
 * ============================================================================
 * Router
 * ============================================================================
 */

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechReferralRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Referral API';

const MAX_NAME_LENGTH =
    255;

const MAX_PHONE_LENGTH =
    32;

const MAX_NOTE_LENGTH =
    1000;

const MAX_PAGE =
    1_000_000;

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    50;

const MAX_LIMIT =
    200;

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

if (
    typeof createReferral !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] createReferral controller must be a function.`
    );
}

if (
    typeof getUserReferrals !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] getUserReferrals controller must be a function.`
    );
}

/**
 * ============================================================================
 * Authentication Contract
 * ============================================================================
 */

const verifyToken =
    auth?.verifyToken ||
    auth?.authenticate ||
    auth?.verifyAccessToken;

if (
    typeof verifyToken !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
}

/**
 * ============================================================================
 * Request / Correlation Metadata
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
            process.env.TITECH_REFERRAL_BODY_LIMIT ||
            '128kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 */

router.use(
    verifyToken
);

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 *
 * Referrals are tenant-scoped. Tenant identity must originate from the
 * authenticated request context rather than body/query input.
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
}

function fallbackTrustedContext(
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
                    'REFERRAL_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for referral operations.',

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
                    'REFERRAL_ACTOR_CONTEXT_REQUIRED',

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

    req.referralActorId =
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
    fallbackTrustedContext
);

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const referralWriteLimiter =
    createLimiter({
        windowMs:
            15 *
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_REFERRAL_CREATE_RATE_LIMIT',
                20
            ),

        code:
            'REFERRAL_CREATE_RATE_LIMITED',

        message:
            'Too many referral creation requests. Please try again later.',
    });

const referralReadLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_REFERRAL_READ_RATE_LIMIT',
                120
            ),

        code:
            'REFERRAL_READ_RATE_LIMITED',

        message:
            'Too many referral queries. Please try again later.',
    });

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
                    req.referralActorId ||
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
                        new Date().toISOString(),
                });
        },
    });
}

/**
 * ============================================================================
 * Create Referral Validation
 * ============================================================================
 */

const createReferralValidators =
    [
        body('email')
            .exists()
            .withMessage(
                'Email address is required.'
            )
            .bail()
            .isEmail()
            .withMessage(
                'A valid email address is required.'
            )
            .normalizeEmail(),

        body('name')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NAME_LENGTH,
            })
            .withMessage(
                `Name cannot exceed ${MAX_NAME_LENGTH} characters.`
            ),

        body('phone')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_PHONE_LENGTH,
            })
            .withMessage(
                `Phone number cannot exceed ${MAX_PHONE_LENGTH} characters.`
            )
            .matches(
                /^\+?[0-9][0-9\s\-()]{6,30}$/
            )
            .withMessage(
                'Invalid phone number format.'
            ),

        body('note')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NOTE_LENGTH,
            })
            .withMessage(
                `Referral note cannot exceed ${MAX_NOTE_LENGTH} characters.`
            ),

        /**
         * Referral ownership MUST come from authentication.
         */
        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied. The authenticated user is authoritative.'
            ),

        /**
         * Tenant MUST come from trusted context.
         */
        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied. Trusted tenant context is authoritative.'
            ),
    ];

/**
 * ============================================================================
 * Pagination Validation
 * ============================================================================
 */

const paginationValidators =
    [
        query('page')
            .optional()
            .default(
                DEFAULT_PAGE
            )
            .toInt()
            .isInt({
                min:
                    1,

                max:
                    MAX_PAGE,
            })
            .withMessage(
                'page must be a valid positive integer.'
            ),

        query('limit')
            .optional()
            .default(
                DEFAULT_LIMIT
            )
            .toInt()
            .isInt({
                min:
                    1,

                max:
                    MAX_LIMIT,
            })
            .withMessage(
                `limit must be between 1 and ${MAX_LIMIT}.`
            ),
    ];

/**
 * ============================================================================
 * Validation Helper
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
 * POST /api/referrals
 * ============================================================================
 */

router.post(
    '/',
    
    referralWriteLimiter,

    validationChain(
        createReferralValidators
    ),

    asyncHandler(
        async (
            req,
            res,
            next
        ) => {
            /**
             * Normalize request data before the controller receives it.
             */
            req.body =
                {
                    ...req.body,

                    email:
                        normalizeString(
                            req.body.email
                        )?.toLowerCase(),

                    name:
                        normalizeString(
                            req.body.name
                        ),

                    phone:
                        normalizeString(
                            req.body.phone
                        ),

                    note:
                        normalizeString(
                            req.body.note
                        ),

                    /**
                     * Expose trusted identity to downstream service/controller.
                     */
                    tenantId:
                        req.tenantId,

                    actorId:
                        req.referralActorId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                };

            return createReferral(
                req,
                res,
                next
            );
        }
    )
);

/**
 * ============================================================================
 * GET /api/referrals
 * ============================================================================
 */

router.get(
    '/',

    referralReadLimiter,

    validationChain(
        paginationValidators
    ),

    asyncHandler(
        getUserReferrals
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

                actorScoped:
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
                    'REFERRAL_ROUTE_NOT_FOUND',

                message:
                    'Referral endpoint not found.',

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
 * Error Handler
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
                            ? 'REFERRAL_REQUEST_ERROR'
                            : 'REFERRAL_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The referral request could not be completed.'
                        )
                        : 'The referral request could not be completed.',

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