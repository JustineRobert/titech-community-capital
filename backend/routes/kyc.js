'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise KYC Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/kyc.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for Know Your Customer (KYC) verification operations.
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 *
 * POST /api/kyc/verify
 *
 * Security architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Request Validation
 *        ↓
 *   KYC Controller
 *        ↓
 *   KYC Service / Provider
 *        ↓
 *   Compliance / Audit
 *
 * This router MUST NOT:
 *
 *   ✗ perform identity verification directly
 *   ✗ call external KYC providers directly
 *   ✗ modify user records directly
 *   ✗ bypass tenant isolation
 *   ✗ expose provider secrets or raw provider errors
 *
 * Business and compliance logic belongs in the KYC controller/service layer.
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

const kycController =
    require(
        '../controllers/kyc.controller'
    );

const requireAuth =
    require(
        '../middleware/requireAuth'
    );

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechKycRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech KYC API';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_KYC_BODY_LIMIT ||
    '1mb';

const DEFAULT_RATE_LIMIT =
    Number(
        process.env.TITECH_KYC_RATE_LIMIT ||
        10
    );

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

if (
    !kycController ||
    typeof kycController.verifyUser !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Missing kycController.verifyUser export.`
    );
}

/**
 * ============================================================================
 * AUTHENTICATION CONTRACT
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
 * AUTHENTICATION
 * ============================================================================
 */

router.use(
    requireAuth
);

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT
 * ============================================================================
 *
 * KYC information is highly sensitive and must be isolated by tenant.
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
                    'KYC_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for KYC operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (!actorId) {
        return res
            .status(401)
            .json({
                success:
                    false,

                code:
                    'KYC_ACTOR_CONTEXT_REQUIRED',

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
 * RATE LIMITING
 * ============================================================================
 *
 * KYC verification can invoke expensive third-party compliance providers.
 * Rate limiting therefore protects both TITech and external providers.
 * ============================================================================
 */

const kycLimiter =
    rateLimit({
        windowMs:
            15 *
            60 *
            1000,

        max:
            Number.isInteger(
                DEFAULT_RATE_LIMIT
            ) &&
            DEFAULT_RATE_LIMIT > 0
                ? DEFAULT_RATE_LIMIT
                : 10,

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
                        req.auth?.userId ||
                        req.adminContext?.actorId
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
                15 *
                60;

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

                    code:
                        'KYC_RATE_LIMITED',

                    message:
                        'Too many KYC verification attempts. Please try again later.',

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

/**
 * ============================================================================
 * REQUEST VALIDATION
 * ============================================================================
 *
 * The exact KYC payload belongs to the service/provider contract. These checks
 * prevent malformed/unbounded requests while leaving provider-specific
 * validation to the domain service.
 * ============================================================================
 */

const validateKycRequest =
    [
        body()
            .custom(
                value => {
                    if (
                        !value ||
                        typeof value !==
                            'object' ||
                        Array.isArray(
                            value
                        )
                    ) {
                        throw new Error(
                            'KYC verification requires a JSON object.'
                        );
                    }

                    return true;
                }
            ),

        /**
         * The caller should not be able to select another tenant through the
         * KYC body.
         */
        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied in the KYC request.'
            ),

        /**
         * The caller should not be able to impersonate another authenticated
         * actor through a top-level userId.
         *
         * Administrative/on-behalf verification should use a dedicated,
         * explicitly authorized endpoint/service path.
         */
        body('userId')
            .optional()
            .isString()
            .withMessage(
                'userId must be a string when provided.'
            )
            .trim()
            .isLength({
                max:
                    128,
            })
            .withMessage(
                'userId is too long.'
            ),
    ];

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

/**
 * ============================================================================
 * AUTHENTICATED ACTOR BOUNDARY
 * ============================================================================
 */

function enforceActorIdentity(
    req,
    res,
    next
) {
    const actorId =
        normalizeString(
            req.adminContext?.actorId ||
                req.user?.id ||
                req.user?._id ||
                req.user?.userId ||
                req.auth?.userId
        );

    if (!actorId) {
        return res
            .status(401)
            .json({
                success:
                    false,

                code:
                    'KYC_AUTHENTICATED_ACTOR_REQUIRED',

                message:
                    'The authenticated user could not be resolved.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.kycActorId =
        actorId;

    next();
}

/**
 * ============================================================================
 * VERIFICATION ROUTE
 * ============================================================================
 *
 * POST /api/kyc/verify
 *
 * By default, the authenticated user's identity is the subject of verification.
 *
 * If staff/admin on-behalf verification is required later, implement that as a
 * separately authorized administrative route rather than weakening this
 * endpoint.
 * ============================================================================
 */

router.post(
    '/verify',

    kycLimiter,

    enforceActorIdentity,

    ...validateKycRequest,

    ...(typeof handleValidation ===
    'function'
        ? [
            handleValidation,
        ]
        : [
            (
                req,
                res,
                next
            ) => {
                return next(
                    new KycRouteError(
                        'KYC validation infrastructure is unavailable.',
                        {
                            code:
                                'KYC_VALIDATION_UNAVAILABLE',

                            statusCode:
                                500,
                        }
                    )
                );
            },
        ]),

    asyncHandler(
        (
            req,
            res,
            next
        ) =>
            kycController.verifyUser(
                req,
                res,
                next
            )
    )
);

/**
 * ============================================================================
 * HEALTH
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

                authenticated:
                    true,

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
                    'KYC_ROUTE_NOT_FOUND',

                message:
                    'KYC endpoint not found.',

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
 * ERROR HANDLER
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
                        ? 'KYC_REQUEST_ERROR'
                        : 'KYC_INTERNAL_ERROR'
                ),

            message:
                clientError
                    ? (
                        error?.message ||
                        'The KYC verification request could not be completed.'
                    )
                    : 'The KYC verification request could not be completed.',

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
 * ROUTE ERROR
 * ============================================================================
 */

class KycRouteError
    extends Error {
    constructor(
        message,
        {
            code =
                'KYC_ROUTE_ERROR',

            statusCode =
                500,

            details =
                null,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'KycRouteError';

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.details =
            details;
    }
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
    router;