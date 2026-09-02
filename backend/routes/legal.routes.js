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
 * Version:
 *   2026.2
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
 * GET  /health
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
 *   Body Parser
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant / Actor Context
 *        ↓
 *   Transport Validation
 *        ↓
 *   Legal Controller
 *        ↓
 *   Service / Repository / Audit Layer
 *
 * This router MUST NOT:
 *
 *   ✗ write legal acceptance records directly
 *   ✗ access MongoDB directly
 *   ✗ determine legal policy content directly
 *   ✗ trust client-supplied user identity
 *   ✗ trust client-supplied tenant identity
 *   ✗ expose internal controller/provider errors
 *   ✗ implement legal-business rules
 *   ✗ implement persistence logic
 *
 * Legal acceptance is an auditable user action.
 *
 * The controller/service layer remains responsible for:
 *
 *   • effective legal-version resolution
 *   • acceptance persistence
 *   • idempotency
 *   • audit events
 *   • compliance rules
 *   • legal-document integrity
 *   • tenant authorization
 *   • transaction boundaries
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * Production principles
 * ----------------------------------------------------------------------------
 *
 *   • Secure by default
 *   • Fail closed
 *   • Zero trust for client identity
 *   • Defense in depth
 *   • Stable API contracts
 *   • Observable requests
 *   • Non-leaking errors
 *   • Tenant isolation
 *   • Idempotent acceptance
 *   • Compliance-ready auditability
 *
 * ============================================================================
 */

const express = require('express');

const crypto = require('node:crypto');

const rateLimit = require('express-rate-limit');

const {
    body,
    validationResult,
} = require('express-validator');

/**
 * express-rate-limit exposes ipKeyGenerator in modern releases.
 *
 * Keep the fallback for environments running an older compatible release.
 */
const ipKeyGenerator =
    typeof rateLimit.ipKeyGenerator === 'function'
        ? rateLimit.ipKeyGenerator
        : (ip) => String(ip || 'unknown');

/**
 * ============================================================================
 * DEPENDENCIES
 * ============================================================================
 */

const legalController =
    require('../controllers/legalController');

const authMiddleware =
    require('../middleware/authMiddleware');

/**
 * ============================================================================
 * ROUTER
 * ============================================================================
 */

const router =
    express.Router({
        strict: false,
        caseSensitive: false,
    });

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechLegalRoutes';

const ROUTER_VERSION =
    '2026.2';

const SERVICE_NAME =
    'TITech Legal API';

const MAX_VERSION_LENGTH =
    50;

const MAX_REQUEST_ID_LENGTH =
    128;

const MAX_CORRELATION_ID_LENGTH =
    128;

const DEFAULT_BODY_LIMIT =
    '128kb';

const DEFAULT_PUBLIC_RATE_LIMIT =
    180;

const DEFAULT_ACCEPTANCE_RATE_LIMIT =
    20;

const PUBLIC_CACHE_SECONDS =
    300;

const PUBLIC_STALE_REVALIDATE_SECONDS =
    600;

/**
 * ============================================================================
 * ENVIRONMENT
 * ============================================================================
 */

const NODE_ENV =
    String(
        process.env.NODE_ENV ||
            'development'
    )
        .trim()
        .toLowerCase();

const IS_PRODUCTION =
    NODE_ENV === 'production';

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
    const method of REQUIRED_CONTROLLERS
) {
    if (
        typeof legalController?.[method] !==
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
 * GENERAL HELPERS
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null,
    maxLength = null
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    if (!normalized) {
        return fallback;
    }

    if (
        Number.isInteger(maxLength) &&
        normalized.length > maxLength
    ) {
        return fallback;
    }

    return normalized;
}

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const raw =
        process.env[name];

    if (
        raw === undefined ||
        raw === null ||
        raw === ''
    ) {
        return fallback;
    }

    const value =
        Number(raw);

    return (
        Number.isSafeInteger(value) &&
        value > 0
    )
        ? value
        : fallback;
}

function getBodyLimit() {
    const configured =
        normalizeString(
            process.env.TITECH_LEGAL_BODY_LIMIT
        );

    return (
        configured ||
        DEFAULT_BODY_LIMIT
    );
}

function safeHeaderValue(
    value,
    maxLength
) {
    const normalized =
        normalizeString(
            value,
            null,
            maxLength
        );

    /**
     * Prevent CRLF/header injection.
     */
    if (
        normalized &&
        /[\r\n]/.test(
            normalized
        )
    ) {
        return null;
    }

    return normalized;
}

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 *
 * Request IDs are generated server-side unless a safe existing request ID is
 * already supplied by trusted upstream infrastructure.
 *
 * Client-provided IDs are treated only as correlation metadata and NEVER as
 * authentication or authorization credentials.
 * ============================================================================
 */

function requestMetadata(
    req,
    res,
    next
) {
    const upstreamRequestId =
        safeHeaderValue(
            req.requestId,
            MAX_REQUEST_ID_LENGTH
        ) ||
        safeHeaderValue(
            req.id,
            MAX_REQUEST_ID_LENGTH
        ) ||
        safeHeaderValue(
            req.headers?.[
                'x-request-id'
            ],
            MAX_REQUEST_ID_LENGTH
        );

    const requestId =
        upstreamRequestId ||
        crypto.randomUUID();

    const upstreamCorrelationId =
        safeHeaderValue(
            req.correlationId,
            MAX_CORRELATION_ID_LENGTH
        ) ||
        safeHeaderValue(
            req.headers?.[
                'x-correlation-id'
            ],
            MAX_CORRELATION_ID_LENGTH
        );

    const correlationId =
        upstreamCorrelationId ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    req.legalRouteStartedAt =
        process.hrtime.bigint();

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
 * RESPONSE / SECURITY HEADERS
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
         * Prevent browser/client caching for authenticated or operational
         * endpoints.
         *
         * Public legal documents may be cached briefly because they are public
         * resources. Versioned/legal content integrity remains the
         * responsibility of the controller/service layer.
         */
        const isPublicDocument =
            (
                req.method === 'GET' ||
                req.method === 'HEAD'
            ) &&
            (
                req.path ===
                    '/terms-of-service' ||
                req.path ===
                    '/privacy-policy' ||
                req.path ===
                    '/changelog'
            );

        if (
            isPublicDocument
        ) {
            res.setHeader(
                'Cache-Control',
                `public, max-age=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=${PUBLIC_STALE_REVALIDATE_SECONDS}`
            );

            res.removeHeader(
                'Pragma'
            );
        } else {
            res.setHeader(
                'Cache-Control',
                'no-store, no-cache, must-revalidate, private'
            );

            res.setHeader(
                'Pragma',
                'no-cache'
            );

            res.setHeader(
                'Expires',
                '0'
            );
        }

        next();
    }
);

/**
 * ============================================================================
 * BODY PARSER
 * ============================================================================
 *
 * Only JSON request bodies are required by the acceptance endpoint.
 *
 * The parser is intentionally bounded to reduce accidental or malicious
 * memory consumption.
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            getBodyLimit(),

        strict:
            true,

        type:
            [
                'application/json',
                'application/*+json',
            ],
    })
);

/**
 * ============================================================================
 * RATE LIMITER FACTORY
 * ============================================================================
 *
 * IMPORTANT:
 *
 * These functions are defined BEFORE limiter initialization so configuration
 * and dependency initialization are deterministic.
 * ============================================================================
 */

function resolveRateLimitKey(
    req,
    {
        authenticated = false,
    } = {}
) {
    const actorId =
        normalizeString(
            req.user?.id ||
                req.user?._id ||
                req.user?.userId ||
                req.auth?.userId ||
                req.adminContext?.actorId
        );

    const tenantId =
        normalizeString(
            req.user?.tenantId ||
                req.auth?.tenantId ||
                req.tenantId ||
                req.adminContext?.tenantId
        );

    if (
        authenticated &&
        actorId
    ) {
        return [
            'actor',
            tenantId || 'no-tenant',
            actorId,
        ].join(':');
    }

    /**
     * express-rate-limit's IPv6-safe helper prevents treating arbitrary
     * IPv6 representations as separate identities.
     */
    return [
        'ip',
        ipKeyGenerator(
            req.ip || 'unknown'
        ),
    ].join(':');
}

function createLimiter({
    windowMs,
    max,
    code,
    message,
    authenticated = false,
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
            return resolveRateLimitKey(
                req,
                {
                    authenticated,
                }
            );
        },

        handler(
            req,
            res
        ) {
            const retryAfter =
                Math.max(
                    1,
                    Math.ceil(
                        windowMs /
                            1000
                    )
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
                DEFAULT_PUBLIC_RATE_LIMIT
            ),

        code:
            'LEGAL_READ_RATE_LIMITED',

        message:
            'Too many legal document requests. Please try again later.',

        authenticated:
            false,
    });

const acceptanceLimiter =
    createLimiter({
        windowMs:
            15 * 60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LEGAL_ACCEPTANCE_RATE_LIMIT',
                DEFAULT_ACCEPTANCE_RATE_LIMIT
            ),

        code:
            'LEGAL_ACCEPTANCE_RATE_LIMITED',

        message:
            'Too many legal acceptance requests. Please try again later.',

        authenticated:
            true,
    });

/**
 * ============================================================================
 * TENANT / ACTOR CONTEXT
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
} catch (
    error
) {
    /**
     * Optional infrastructure must not prevent the router from loading.
     *
     * The fallback context middleware below still requires authenticated
     * tenant and actor identity.
     *
     * Never expose this startup detail to clients.
     */
    adminContextMiddleware =
        null;

    if (
        !IS_PRODUCTION &&
        process.env.DEBUG === 'true'
    ) {
        // eslint-disable-next-line no-console
        console.warn(
            `[${ROUTER_NAME}] Optional admin context middleware unavailable; using trusted fallback context.`
        );
    }
}

/**
 * ============================================================================
 * TRUSTED LEGAL CONTEXT
 * ============================================================================
 *
 * Authentication MUST already have happened before this middleware runs.
 *
 * Client-supplied body/query parameters are deliberately ignored.
 * ============================================================================
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
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }

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
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }

    /**
     * If an admin-context middleware has already populated a tenant/actor
     * context, preserve it while establishing the legal-specific contract.
     */
    req.tenantId =
        tenantId;

    req.legalContext =
        Object.freeze({
            tenantId,

            actorId,

            userId:
                actorId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            service:
                SERVICE_NAME,

            serviceVersion:
                ROUTER_VERSION,
        });

    next();
}

/**
 * ============================================================================
 * LEGAL CONTEXT ENFORCEMENT
 * ============================================================================
 *
 * The optional admin context middleware is useful when available, but this
 * router still verifies that the context required by legal operations exists.
 *
 * This prevents an incorrectly configured optional middleware from silently
 * weakening tenant/actor requirements.
 * ============================================================================
 */

function enforceLegalContext(
    req,
    res,
    next
) {
    return trustedLegalContext(
        req,
        res,
        next
    );
}

/**
 * ============================================================================
 * VERSION VALIDATION
 * ============================================================================
 */

function isValidLegalVersion(
    value
) {
    if (
        typeof value !==
        'string'
    ) {
        return false;
    }

    const version =
        value.trim();

    if (
        !version ||
        version.length >
            MAX_VERSION_LENGTH
    ) {
        return false;
    }

    /**
     * Supports common semantic/date/legal document versions:
     *
     *   1.0
     *   1.0.1
     *   2026.1
     *   2026-01-15
     *   v1.0
     *   terms-2026.1
     *
     * The controller remains responsible for determining whether the version
     * actually exists and is effective.
     */
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(
        version
    );
}

/**
 * ============================================================================
 * ACCEPTANCE VALIDATION
 * ============================================================================
 *
 * Transport-level validation only.
 *
 * Business/legal rules remain in the controller/service layer.
 * ============================================================================
 */

const acceptanceValidation =
    [
        body('termsVersion')
            .optional({
                nullable:
                    true,
            })
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_VERSION_LENGTH,
            })
            .custom(
                isValidLegalVersion
            )
            .withMessage(
                'termsVersion is invalid.'
            ),

        body('privacyVersion')
            .optional({
                nullable:
                    true,
            })
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_VERSION_LENGTH,
            })
            .custom(
                isValidLegalVersion
            )
            .withMessage(
                'privacyVersion is invalid.'
            ),

        body('accepted')
            .exists()
            .withMessage(
                'accepted is required.'
            )
            .isBoolean()
            .withMessage(
                'accepted must be a boolean.'
            )
            .toBoolean()
            .custom(
                (value) => {
                    if (
                        value !==
                        true
                    ) {
                        throw new Error(
                            'Legal acceptance must be explicitly confirmed.'
                        );
                    }

                    return true;
                }
            ),

        /**
         * Never accept client-selected identity as authoritative.
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

        /**
         * Prevent accidental acceptance-record metadata injection.
         */
        body('actorId')
            .not()
            .exists()
            .withMessage(
                'actorId must not be supplied.'
            ),

        body('acceptedAt')
            .not()
            .exists()
            .withMessage(
                'acceptedAt must not be supplied. The server determines acceptance time.'
            ),

        body('ipAddress')
            .not()
            .exists()
            .withMessage(
                'ipAddress must not be supplied.'
            ),

        body('userAgent')
            .not()
            .exists()
            .withMessage(
                'userAgent must not be supplied.'
            ),

        body('audit')
            .not()
            .exists()
            .withMessage(
                'audit must not be supplied by the client.'
            ),
    ];

/**
 * ============================================================================
 * VALIDATION INFRASTRUCTURE
 * ============================================================================
 *
 * Prefer the project's shared validator when available.
 *
 * A local fallback is retained so this router remains operational in projects
 * where ../utils/validators does not export the expected helper.
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

function localValidationHandler(
    req,
    res,
    next
) {
    const errors =
        validationResult(
            req
        );

    if (
        errors.isEmpty()
    ) {
        return next();
    }

    const details =
        errors
            .array()
            .map(
                (error) => ({
                    type:
                        error.type,

                    field:
                        error.path ||
                        error.param,

                    message:
                        error.msg,
                })
            );

    return res
        .status(400)
        .json({
            success:
                false,

            code:
                'LEGAL_VALIDATION_ERROR',

            message:
                'One or more legal request fields are invalid.',

            details,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            timestamp:
                new Date().toISOString(),
        });
}

function runValidation(
    rules
) {
    return [
        ...rules,

        typeof handleValidation ===
            'function'
            ? handleValidation
            : localValidationHandler,
    ];
}

/**
 * ============================================================================
 * UNKNOWN FIELD PROTECTION
 * ============================================================================
 *
 * Legal acceptance should have a deliberately narrow transport contract.
 *
 * This protects the controller from silently accepting future/unknown fields
 * that may accidentally be interpreted as trusted data.
 * ============================================================================
 */

const ALLOWED_ACCEPTANCE_FIELDS =
    new Set([
        'termsVersion',
        'privacyVersion',
        'accepted',
    ]);

function rejectUnknownAcceptanceFields(
    req,
    res,
    next
) {
    if (
        !req.body ||
        typeof req.body !==
            'object' ||
        Array.isArray(
            req.body
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'LEGAL_INVALID_BODY',

                message:
                    'A valid JSON object is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }

    const unknownFields =
        Object.keys(
            req.body
        ).filter(
            (field) =>
                !ALLOWED_ACCEPTANCE_FIELDS.has(
                    field
                )
        );

    if (
        unknownFields.length
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'LEGAL_UNKNOWN_FIELDS',

                message:
                    'The request contains unsupported fields.',

                details:
                    unknownFields.map(
                        (field) =>
                            ({
                                field,
                                message:
                                    'This field is not accepted by the legal API.',
                            })
                    ),

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }

    next();
}

/**
 * ============================================================================
 * ASYNC HANDLER
 * ============================================================================
 *
 * Controllers may return promises or use synchronous Express handlers.
 * ============================================================================
 */

function asyncHandler(
    handler
) {
    return function legalAsyncHandler(
        req,
        res,
        next
    ) {
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
 * REQUEST DURATION
 * ============================================================================
 */

function attachRequestDuration(
    req,
    res,
    next
) {
    res.on(
        'finish',
        () => {
            try {
                if (
                    !req.legalRouteStartedAt
                ) {
                    return;
                }

                const durationNs =
                    process.hrtime.bigint() -
                    req.legalRouteStartedAt;

                const durationMs =
                    Number(
                        durationNs
                    ) /
                    1e6;

                /**
                 * Useful for upstream observability without exposing the
                 * metric as a response header.
                 *
                 * Controllers/services can consume req.legalMetrics if
                 * required.
                 */
                req.legalMetrics =
                    {
                        durationMs:
                            Number(
                                durationMs.toFixed(
                                    3
                                )
                            ),

                        method:
                            req.method,

                        route:
                            req.route?.path ||
                            req.path,

                        statusCode:
                            res.statusCode,
                    };
            } catch {
                /**
                 * Observability must never interfere with legal operations.
                 */
            }
        }
    );

    next();
}

router.use(
    attachRequestDuration
);

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
 * The authenticated user/tenant identity is taken exclusively from trusted
 * authentication/context middleware.
 *
 * The service/controller should persist at minimum:
 *
 *   • actor
 *   • tenant
 *   • terms version
 *   • privacy version
 *   • acceptance timestamp
 *   • request identity
 *   • correlation identity
 *   • relevant audit metadata
 *   • legal-document fingerprint/hash where supported
 *
 * Acceptance should be idempotent where appropriate.
 * ============================================================================
 */

router.post(
    '/accept-terms',

    verifyAccessToken,

    /**
     * Optional enterprise context middleware.
     *
     * It enriches the request when available.
     */
    adminContextMiddleware ||
        ((req, res, next) =>
            next()),

    /**
     * Mandatory legal context enforcement.
     *
     * This ensures that optional middleware cannot weaken the legal contract.
     */
    enforceLegalContext,

    acceptanceLimiter,

    rejectUnknownAcceptanceFields,

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
 * ============================================================================
 */

router.get(
    '/acceptance-status',

    verifyAccessToken,

    adminContextMiddleware ||
        ((req, res, next) =>
            next()),

    enforceLegalContext,

    asyncHandler(
        legalController.getAcceptanceStatus
    )
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 *
 * Health does not consume the legal-document read limiter.
 *
 * This endpoint verifies router availability only.
 *
 * Dependency health such as MongoDB, Redis, queues, external providers, etc.
 * belongs to the application readiness/health subsystem.
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

                environment:
                    NODE_ENV,

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
 *
 * IMPORTANT:
 *
 * Internal errors are intentionally converted into a stable generic response.
 *
 * Never expose:
 *
 *   • stack traces
 *   • database errors
 *   • MongoDB details
 *   • JWT internals
 *   • provider credentials
 *   • filesystem paths
 *   • internal service topology
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

        /**
         * --------------------------------------------------------------------
         * JSON / BODY PARSER ERRORS
         * --------------------------------------------------------------------
         */

        if (
            error?.type ===
                'entity.parse.failed' ||
            error?.type ===
                'entity.too.large'
        ) {
            const tooLarge =
                error.type ===
                'entity.too.large';

            return res
                .status(
                    tooLarge
                        ? 413
                        : 400
                )
                .json({
                    success:
                        false,

                    code:
                        tooLarge
                            ? 'LEGAL_BODY_TOO_LARGE'
                            : 'LEGAL_INVALID_JSON',

                    message:
                        tooLarge
                            ? 'The legal request body is too large.'
                            : 'The legal request contains invalid JSON.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        }

        /**
         * --------------------------------------------------------------------
         * STATUS CODE NORMALIZATION
         * --------------------------------------------------------------------
         */

        const rawStatus =
            Number(
                error?.statusCode ||
                    error?.status
            );

        const statusCode =
            Number.isInteger(
                rawStatus
            ) &&
            rawStatus >= 400 &&
            rawStatus < 600
                ? rawStatus
                : 500;

        const clientError =
            statusCode >= 400 &&
            statusCode < 500;

        /**
         * --------------------------------------------------------------------
         * SAFE ERROR CODE
         * --------------------------------------------------------------------
         *
         * Only expose explicitly approved error codes from the application
         * contract. Otherwise use generic categories.
         */

        const knownCode =
            normalizeString(
                error?.code,
                null,
                100
            );

        const safeClientCodes =
            new Set([
                'LEGAL_VALIDATION_ERROR',
                'LEGAL_INVALID_BODY',
                'LEGAL_UNKNOWN_FIELDS',
                'LEGAL_ROUTE_NOT_FOUND',
                'LEGAL_TENANT_CONTEXT_REQUIRED',
                'LEGAL_ACTOR_CONTEXT_REQUIRED',
                'LEGAL_READ_RATE_LIMITED',
                'LEGAL_ACCEPTANCE_RATE_LIMITED',
                'LEGAL_REQUEST_ERROR',
                'LEGAL_VERSION_NOT_FOUND',
                'LEGAL_ACCEPTANCE_REQUIRED',
                'LEGAL_ACCEPTANCE_CONFLICT',
                'LEGAL_UNAUTHORIZED',
                'LEGAL_FORBIDDEN',
            ]);

        const responseCode =
            clientError &&
            knownCode &&
            safeClientCodes.has(
                knownCode
            )
                ? knownCode
                : (
                    clientError
                        ? 'LEGAL_REQUEST_ERROR'
                        : 'LEGAL_INTERNAL_ERROR'
                );

        /**
         * --------------------------------------------------------------------
         * SAFE MESSAGE
         * --------------------------------------------------------------------
         */

        let message =
            clientError
                ? (
                    normalizeString(
                        error?.publicMessage,
                        null,
                        500
                    ) ||
                    (
                        safeClientCodes.has(
                            knownCode
                        )
                            ? normalizeString(
                                error?.message,
                                null,
                                500
                            )
                            : 'The legal request could not be completed.'
                    )
                )
                : 'The legal request could not be completed.';

        /**
         * Never return an empty error message.
         */
        if (
            !message
        ) {
            message =
                'The legal request could not be completed.';
        }

        const response = {
            success:
                false,

            code:
                responseCode,

            message,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            timestamp:
                new Date().toISOString(),
        };

        /**
         * --------------------------------------------------------------------
         * VALIDATION DETAILS
         * --------------------------------------------------------------------
         *
         * Details are exposed only for controlled client-side errors.
         */
        if (
            clientError &&
            Array.isArray(
                error?.details
            )
        ) {
            response.details =
                error.details;
        }

        /**
         * --------------------------------------------------------------------
         * SERVER-SIDE LOGGING
         * --------------------------------------------------------------------
         *
         * Logging belongs to the application logger. The router deliberately
         * avoids printing sensitive stack traces directly to clients.
         *
         * If a logger is attached globally, expose a small structured event.
         */
        if (
            !clientError
        ) {
            const logger =
                req.app?.locals?.logger;

            if (
                logger &&
                typeof logger.error ===
                    'function'
            ) {
                try {
                    logger.error(
                        {
                            service:
                                SERVICE_NAME,

                            router:
                                ROUTER_NAME,

                            version:
                                ROUTER_VERSION,

                            requestId:
                                req.requestId,

                            correlationId:
                                req.correlationId,

                            method:
                                req.method,

                            path:
                                req.path,

                            statusCode,

                            errorCode:
                                knownCode,

                            error:
                                error,
                        },
                        'Legal route request failed.'
                    );
                } catch {
                    /**
                     * Logging must never replace the API response.
                     */
                }
            }
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
 *
 * These properties are informational and may be consumed by startup,
 * diagnostics or route-registration tooling.
 * ============================================================================
 */

router.routerName =
    ROUTER_NAME;

router.routerVersion =
    ROUTER_VERSION;

router.serviceName =
    SERVICE_NAME;

router.serviceVersion =
    ROUTER_VERSION;

router.environment =
    NODE_ENV;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
    router;