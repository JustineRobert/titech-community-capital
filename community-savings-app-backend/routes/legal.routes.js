'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/legal.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for TITech Community Capital legal and policy
 * documents.
 *
 * Public endpoints
 * ----------------------------------------------------------------------------
 * GET  /terms-of-service
 * GET  /privacy-policy
 * GET  /changelog
 *
 * Authenticated endpoints
 * ----------------------------------------------------------------------------
 * POST /accept-terms
 * GET  /acceptance-status
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
 *   Validation
 *        ↓
 *   Authentication for protected operations
 *        ↓
 *   Trusted Tenant / Actor Context
 *        ↓
 *   Legal Controller
 *
 * This router MUST NOT:
 *
 *   ✗ write legal acceptance records directly
 *   ✗ access MongoDB directly
 *   ✗ determine legal policy content directly
 *   ✗ trust client-supplied user identity
 *   ✗ expose internal controller/provider errors
 *
 * Legal acceptance is an auditable user action and the controller/service layer
 * remains responsible for persistence, effective-version handling, audit
 * events, and compliance rules.
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

const legalController =
    require(
        '../controllers/legalController'
    );

const authMiddleware =
    require(
        '../middleware/authMiddleware'
    );

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechLegalRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Legal API';

const MAX_VERSION_LENGTH =
    50;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'getTermsOfService',
        'getPrivacyPolicy',
        'getChangelog',
        'acceptTermsAndPrivacy',
        'getAcceptanceStatus',
    ]);

for (
    const method of
        REQUIRED_CONTROLLERS
) {
    if (
        typeof legalController?.[
            method
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing legalController.${method} export.`
        );
    }
}

/**
 * ============================================================================
 * AUTHENTICATION CONTRACT
 * ============================================================================
 */

const verifyAccessToken =
    authMiddleware?.verifyAccessToken ||
    authMiddleware?.verifyToken ||
    authMiddleware?.authenticate;

if (
    typeof verifyAccessToken !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
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

        /**
         * Legal documents may be cached briefly, while acceptance operations
         * and authenticated responses remain non-cacheable.
         */
        if (
            req.method ===
                'GET' &&
            !req.path.includes(
                'acceptance'
            )
        ) {
            res.setHeader(
                'Cache-Control',
                'public, max-age=300, stale-while-revalidate=600'
            );
        } else {
            res.setHeader(
                'Cache-Control',
                'no-store'
            );

            res.setHeader(
                'Pragma',
                'no-cache'
            );
        }

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
            process.env.TITECH_LEGAL_BODY_LIMIT ||
            '128kb',

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
                'TITECH_LEGAL_READ_RATE_LIMIT',
                180
            ),

        code:
            'LEGAL_READ_RATE_LIMITED',

        message:
            'Too many legal document requests. Please try again later.'
    });

const acceptanceLimiter =
    createLimiter({
        windowMs:
            15 * 60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LEGAL_ACCEPTANCE_RATE_LIMIT',
                20
            ),

        code:
            'LEGAL_ACCEPTANCE_RATE_LIMITED',

        message:
            'Too many legal acceptance requests. Please try again later.'
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
                        new Date().toISOString(),
                });
        }
    });
}

/**
 * ============================================================================
 * TENANT / ACTOR CONTEXT
 * ============================================================================
 *
 * Legal acceptance should be recorded against the authenticated actor and
 * trusted tenant context.
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

/**
 * Authenticated actor / tenant fallback.
 *
 * This does not authorize the actor beyond authentication; it simply makes
 * trusted identity available downstream.
 */
function trustedLegalContext(
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
                    'LEGAL_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required.',

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
                    'LEGAL_ACTOR_CONTEXT_REQUIRED',

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

    req.legalContext =
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
 * ACCEPTANCE VALIDATION
 * ============================================================================
 *
 * The controller may support richer acceptance records in the future.
 *
 * The route deliberately validates only transport-level fields.
 */
const acceptanceValidation =
    [
        body('termsVersion')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_VERSION_LENGTH
            })
            .withMessage(
                'termsVersion is invalid.'
            ),

        body('privacyVersion')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_VERSION_LENGTH
            })
            .withMessage(
                'privacyVersion is invalid.'
            ),

        body('accepted')
            .optional()
            .isBoolean()
            .withMessage(
                'accepted must be a boolean.'
            )
            .toBoolean(),

        /**
         * Never accept a client-selected actor or tenant as authoritative.
         */
        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied. The authenticated user is authoritative.'
            ),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied. The authenticated tenant is authoritative.'
            ),
    ];

/**
 * ============================================================================
 * VALIDATION INFRASTRUCTURE
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
        validators?.handleValidation ||
        validators?.handleValidationErrors ||
        null;
} catch {
    handleValidation =
        null;
}

function runValidation(
    rules
) {
    if (
        typeof handleValidation !==
            'function'
    ) {
        return (
            req,
            res
        ) => {
            return res
                .status(500)
                .json({
                    success:
                        false,

                    code:
                        'LEGAL_VALIDATION_UNAVAILABLE',

                    message:
                        'Legal validation infrastructure is unavailable.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        };
    }

    return [
        ...rules,

        handleValidation,
    ];
}

/**
 * ============================================================================
 * PUBLIC LEGAL DOCUMENTS
 * ============================================================================
 */

/**
 * GET /api/legal/terms-of-service
 */
router.get(
    '/terms-of-service',

    publicReadLimiter,

    asyncHandler(
        legalController.getTermsOfService
    )
);

/**
 * GET /api/legal/privacy-policy
 */
router.get(
    '/privacy-policy',

    publicReadLimiter,

    asyncHandler(
        legalController.getPrivacyPolicy
    )
);

/**
 * GET /api/legal/changelog
 */
router.get(
    '/changelog',

    publicReadLimiter,

    asyncHandler(
        legalController.getChangelog
    )
);

/**
 * ============================================================================
 * PROTECTED LEGAL ACCEPTANCE
 * ============================================================================
 *
 * POST /api/legal/accept-terms
 *
 * The authenticated user/tenant identity is taken from trusted context.
 *
 * The service/controller should persist:
 *
 *   actor
 *   tenant
 *   terms version
 *   privacy version
 *   acceptance timestamp
 *   request/correlation identity
 *   relevant audit metadata
 *
 * and should make acceptance idempotent where appropriate.
 */
router.post(
    '/accept-terms',

    verifyAccessToken,

    adminContextMiddleware ||
        trustedLegalContext,

    acceptanceLimiter,

    ...runValidation(
        acceptanceValidation
    ),

    asyncHandler(
        legalController.acceptTermsAndPrivacy
    )
);

/**
 * ============================================================================
 * ACCEPTANCE STATUS
 * ============================================================================
 *
 * GET /api/legal/acceptance-status
 */
router.get(
    '/acceptance-status',

    verifyAccessToken,

    adminContextMiddleware ||
        trustedLegalContext,

    asyncHandler(
        legalController.getAcceptanceStatus
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
                    new Date().toISOString(),
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
                    'LEGAL_ROUTE_NOT_FOUND',

                message:
                    'Legal endpoint not found.',

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
                        ? 'LEGAL_REQUEST_ERROR'
                        : 'LEGAL_INTERNAL_ERROR'
                ),

            message:
                clientError
                    ? (
                        error?.message ||
                        'The legal request could not be completed.'
                    )
                    : 'The legal request could not be completed.',

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