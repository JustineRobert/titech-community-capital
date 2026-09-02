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
 * GET  /api/referrals/health
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *       ↓
 *   Request / Correlation Metadata
 *       ↓
 *   Security Headers
 *       ↓
 *   Health Boundary / Authentication
 *       ↓
 *   Trusted Tenant + Actor Context
 *       ↓
 *   Rate Limiting
 *       ↓
 *   Validation / Normalization
 *       ↓
 *   Sanitized Controller Contract
 *       ↓
 *   Referral Controller
 *       ↓
 *   Referral Service
 *       ↓
 *   Tenant-scoped Persistence / Reward Logic / Audit
 *
 * Security Invariants
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ accept userId as an authority for referral ownership
 *   ✗ accept tenantId from request body/query as an authority
 *   ✗ calculate referral rewards
 *   ✗ award financial bonuses directly
 *   ✗ access persistence/database directly
 *   ✗ expose internal exceptions
 *   ✗ pass arbitrary request body fields into the controller
 *
 * Referral ownership, eligibility, reward calculation and financial mutation
 * belong to the service/domain/application layer.
 *
 * Configuration
 * ----------------------------------------------------------------------------
 *
 * Router configuration is intentionally static here.
 *
 * Environment/configuration resolution belongs to:
 *
 *   backend/config/*
 *
 * The application may optionally override the constants below by injecting
 * configuration through app.locals.config without requiring this router to
 * access process.env directly.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 *
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const {
    body,
    query,
    matchedData,
} = require('express-validator');

const asyncHandler = require('../utils/asyncHandler');

const {
    handleValidation,
} = require('../utils/validators');

const auth = require('../middleware/auth');

const {
    createReferral,
    getUserReferrals,
} = require('../controllers/referralController');

/**
 * ============================================================================
 * Router
 * ============================================================================
 */

const router = express.Router({
    strict: false,
    caseSensitive: false,
});

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME = 'TITechReferralRoutes';
const ROUTER_VERSION = '2026.2';
const SERVICE_NAME = 'TITech Referral API';

const DEFAULT_BODY_LIMIT = '128kb';

const MAX_NAME_LENGTH = 255;
const MAX_PHONE_LENGTH = 32;
const MAX_NOTE_LENGTH = 1000;

const MAX_PAGE = 1_000_000;
const DEFAULT_PAGE = 1;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const REQUEST_ID_MAX_LENGTH = 128;
const CORRELATION_ID_MAX_LENGTH = 128;

const CREATE_RATE_WINDOW_MS = 15 * 60 * 1000;
const CREATE_RATE_LIMIT = 20;

const READ_RATE_WINDOW_MS = 60 * 1000;
const READ_RATE_LIMIT = 120;

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

if (typeof createReferral !== 'function') {
    throw new TypeError(
        `[${ROUTER_NAME}] createReferral controller must be a function.`,
    );
}

if (typeof getUserReferrals !== 'function') {
    throw new TypeError(
        `[${ROUTER_NAME}] getUserReferrals controller must be a function.`,
    );
}

/**
 * ============================================================================
 * Authentication Contract
 * ============================================================================
 *
 * TITech may expose one canonical authentication function or one of the
 * supported compatibility names.
 * ============================================================================
 */

const verifyToken =
    typeof auth?.verifyToken === 'function'
        ? auth.verifyToken
        : typeof auth?.authenticate === 'function'
            ? auth.authenticate
            : typeof auth?.verifyAccessToken === 'function'
                ? auth.verifyAccessToken
                : null;

if (typeof verifyToken !== 'function') {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`,
    );
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function normalizeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized || fallback;
}

function normalizeIdentifier(
    value,
    maxLength = REQUEST_ID_MAX_LENGTH,
) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return null;
    }

    if (normalized.length > maxLength) {
        return null;
    }

    /**
     * Request/correlation identifiers should remain safe for headers and logs.
     */
    if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        return null;
    }

    return normalized;
}

function getConfig(req) {
    return req?.app?.locals?.config ?? {};
}

function getReferralConfig(req) {
    const config = getConfig(req);

    return (
        config?.referrals ??
        config?.referral ??
        {}
    );
}

function getPositiveInteger(
    value,
    fallback,
) {
    const number = Number(value);

    return Number.isInteger(number) && number > 0
        ? number
        : fallback;
}

function getBodyLimit(req) {
    const referralConfig = getReferralConfig(req);

    return (
        referralConfig?.bodyLimit ??
        DEFAULT_BODY_LIMIT
    );
}

/**
 * ============================================================================
 * Request / Correlation Metadata
 * ============================================================================
 */

function requestMetadata(req, res, next) {
    /**
     * Prefer an upstream-generated request ID already attached by the
     * application infrastructure.
     *
     * Only use incoming X-Request-Id / X-Correlation-Id when they pass
     * strict validation.
     */

    const requestId =
        normalizeIdentifier(req.requestId) ??
        normalizeIdentifier(
            req.id,
        ) ??
        normalizeIdentifier(
            req.headers?.['x-request-id'],
        ) ??
        crypto.randomUUID();

    const correlationId =
        normalizeIdentifier(
            req.correlationId,
            CORRELATION_ID_MAX_LENGTH,
        ) ??
        normalizeIdentifier(
            req.headers?.['x-correlation-id'],
            CORRELATION_ID_MAX_LENGTH,
        ) ??
        requestId;

    req.requestId = requestId;
    req.correlationId = correlationId;

    res.setHeader(
        'X-Request-Id',
        requestId,
    );

    res.setHeader(
        'X-Correlation-Id',
        correlationId,
    );

    next();
}

router.use(requestMetadata);

/**
 * ============================================================================
 * Security Headers
 * ============================================================================
 */

router.use((req, res, next) => {
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
    );

    res.setHeader(
        'Pragma',
        'no-cache',
    );

    res.setHeader(
        'Expires',
        '0',
    );

    res.setHeader(
        'X-Content-Type-Options',
        'nosniff',
    );

    res.setHeader(
        'Referrer-Policy',
        'no-referrer',
    );

    res.setHeader(
        'X-Frame-Options',
        'DENY',
    );

    res.setHeader(
        'X-Permitted-Cross-Domain-Policies',
        'none',
    );

    next();
});

/**
 * ============================================================================
 * Operational Health
 * ============================================================================
 *
 * Health is deliberately placed BEFORE authentication.
 *
 * This makes it usable by load balancers/orchestrators without requiring
 * an end-user access token.
 *
 * Note:
 * This is a router-level health signal, not a database/dependency readiness
 * probe. Dependency readiness belongs in the centralized observability /
 * health subsystem.
 * ============================================================================
 */

router.get(
    '/health',
    (req, res) => {
        return res
            .status(200)
            .json({
                success: true,
                service: SERVICE_NAME,
                version: ROUTER_VERSION,
                status: 'UP',
                route: 'referrals',
                tenantScoped: true,
                actorScoped: true,
                requestId: req.requestId,
                correlationId: req.correlationId,
                timestamp: new Date().toISOString(),
            });
    },
);

/**
 * ============================================================================
 * Body Parser
 * ============================================================================
 */

router.use(
    express.json({
        limit: DEFAULT_BODY_LIMIT,
        strict: true,
        type: 'application/json',
    }),
);

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 */

router.use(verifyToken);

/**
 * ============================================================================
 * Trusted Tenant + Actor Context
 * ============================================================================
 *
 * Tenant and actor identity MUST originate from trusted authenticated context.
 *
 * Accepted trusted sources:
 *
 *   req.adminContext
 *   req.auth
 *   req.user
 *
 * Intentionally NOT trusted:
 *
 *   req.body.tenantId
 *   req.body.userId
 *   req.query.tenantId
 *   req.query.userId
 *   arbitrary req.tenantId
 *
 * This prevents a lower-level middleware or request property from accidentally
 * becoming an authorization authority.
 * ============================================================================
 */

let adminContextMiddleware = null;

try {
    const adminContext = require(
        '../utils/admin/adminContext',
    );

    if (
        typeof adminContext?.middleware ===
        'function'
    ) {
        adminContextMiddleware =
            adminContext.middleware({
                requiredTenant: true,
                requiredActor: true,
                service: SERVICE_NAME,
                serviceVersion: ROUTER_VERSION,
            });
    }
} catch {
    /**
     * Optional compatibility path.
     *
     * The router falls back to authenticated user context when the centralized
     * admin context middleware is not installed.
     */
    adminContextMiddleware = null;
}

function fallbackTrustedContext(req, res, next) {
    const trustedTenantId =
        normalizeString(
            req.adminContext?.tenantId,
        ) ??
        normalizeString(
            req.auth?.tenantId,
        ) ??
        normalizeString(
            req.user?.tenantId,
        );

    const trustedActorId =
        normalizeString(
            req.adminContext?.actorId,
        ) ??
        normalizeString(
            req.auth?.userId,
        ) ??
        normalizeString(
            req.user?.id,
        ) ??
        normalizeString(
            req.user?._id,
        ) ??
        normalizeString(
            req.user?.userId,
        );

    if (!trustedTenantId) {
        return res
            .status(403)
            .json({
                success: false,
                code: 'REFERRAL_TENANT_CONTEXT_REQUIRED',
                message:
                    'A trusted tenant context is required for referral operations.',
                requestId: req.requestId,
                correlationId: req.correlationId,
                timestamp: new Date().toISOString(),
            });
    }

    if (!trustedActorId) {
        return res
            .status(401)
            .json({
                success: false,
                code: 'REFERRAL_ACTOR_CONTEXT_REQUIRED',
                message:
                    'An authenticated actor context is required.',
                requestId: req.requestId,
                correlationId: req.correlationId,
                timestamp: new Date().toISOString(),
            });
    }

    req.tenantId = trustedTenantId;
    req.referralActorId = trustedActorId;

    req.adminContext = {
        ...(req.adminContext ?? {}),
        tenantId: trustedTenantId,
        actorId: trustedActorId,
        userId: trustedActorId,
        requestId: req.requestId,
        correlationId: req.correlationId,
    };

    return next();
}

router.use(
    adminContextMiddleware ||
        fallbackTrustedContext,
);

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

function resolveCreateRateLimit(req) {
    const referralConfig = getReferralConfig(req);

    return getPositiveInteger(
        referralConfig?.createRateLimit,
        CREATE_RATE_LIMIT,
    );
}

function resolveReadRateLimit(req) {
    const referralConfig = getReferralConfig(req);

    return getPositiveInteger(
        referralConfig?.readRateLimit,
        READ_RATE_LIMIT,
    );
}

function createLimiter({
    windowMs,
    resolveMax,
    code,
    message,
}) {
    return rateLimit({
        windowMs,

        max: (req) => resolveMax(req),

        standardHeaders: 'draft-8',
        legacyHeaders: false,

        skipSuccessfulRequests: false,

        /**
         * All referral endpoints are already authenticated and tenant scoped.
         *
         * Prefer a composite tenant + actor key so the same actor identity
         * remains independently rate-limited within each tenant boundary.
         */
        keyGenerator(req) {
            const actorId =
                normalizeString(
                    req.referralActorId,
                );

            const tenantId =
                normalizeString(
                    req.tenantId,
                );

            if (tenantId && actorId) {
                return `${tenantId}:${actorId}`;
            }

            if (actorId) {
                return `actor:${actorId}`;
            }

            return `ip:${normalizeString(req.ip, 'unknown')}`;
        },

        handler(req, res) {
            const retryAfter = Math.ceil(
                windowMs / 1000,
            );

            res.setHeader(
                'Retry-After',
                String(retryAfter),
            );

            return res
                .status(429)
                .json({
                    success: false,
                    code,
                    message,
                    retryAfter,
                    requestId: req.requestId,
                    correlationId: req.correlationId,
                    timestamp: new Date().toISOString(),
                });
        },
    });
}

const referralWriteLimiter = createLimiter({
    windowMs: CREATE_RATE_WINDOW_MS,
    resolveMax: resolveCreateRateLimit,
    code: 'REFERRAL_CREATE_RATE_LIMITED',
    message:
        'Too many referral creation requests. Please try again later.',
});

const referralReadLimiter = createLimiter({
    windowMs: READ_RATE_WINDOW_MS,
    resolveMax: resolveReadRateLimit,
    code: 'REFERRAL_READ_RATE_LIMITED',
    message:
        'Too many referral queries. Please try again later.',
});

/**
 * ============================================================================
 * POST Validation
 * ============================================================================
 */

const createReferralValidators = [
    /**
     * Email
     * ------------------------------------------------------------------------
     */

    body('email')
        .exists({
            checkNull: true,
        })
        .withMessage(
            'Email address is required.',
        )
        .bail()
        .isString()
        .withMessage(
            'Email address must be a string.',
        )
        .bail()
        .isEmail()
        .withMessage(
            'A valid email address is required.',
        )
        .bail()
        .normalizeEmail(),

    /**
     * Name
     * ------------------------------------------------------------------------
     */

    body('name')
        .optional({
            nullable: true,
        })
        .isString()
        .withMessage(
            'Name must be a string.',
        )
        .bail()
        .trim()
        .isLength({
            max: MAX_NAME_LENGTH,
        })
        .withMessage(
            `Name cannot exceed ${MAX_NAME_LENGTH} characters.`,
        ),

    /**
     * Phone
     * ------------------------------------------------------------------------
     *
     * Supports:
     *
     *   +256700000000
     *   0700 000 000
     *   +256 700-000-000
     *   (0700) 000-000
     *
     * The previous /^**.../ expression was invalid JavaScript regex syntax.
     */

    body('phone')
        .optional({
            nullable: true,
        })
        .isString()
        .withMessage(
            'Phone number must be a string.',
        )
        .bail()
        .trim()
        .isLength({
            min: 7,
            max: MAX_PHONE_LENGTH,
        })
        .withMessage(
            `Phone number must contain between 7 and ${MAX_PHONE_LENGTH} characters.`,
        )
        .bail()
        .matches(
            /^\+?[0-9][0-9\s\-()]{6,30}$/,
        )
        .withMessage(
            'Invalid phone number format.',
        ),

    /**
     * Referral Note
     * ------------------------------------------------------------------------
     */

    body('note')
        .optional({
            nullable: true,
        })
        .isString()
        .withMessage(
            'Referral note must be a string.',
        )
        .bail()
        .trim()
        .isLength({
            max: MAX_NOTE_LENGTH,
        })
        .withMessage(
            `Referral note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
        ),

    /**
     * Identity Anti-Spoofing
     * ------------------------------------------------------------------------
     */

    body('userId')
        .custom((value) => {
            if (
                value !== undefined &&
                value !== null
            ) {
                throw new Error(
                    'userId must not be supplied. The authenticated user is authoritative.',
                );
            }

            return true;
        }),

    body('tenantId')
        .custom((value) => {
            if (
                value !== undefined &&
                value !== null
            ) {
                throw new Error(
                    'tenantId must not be supplied. Trusted tenant context is authoritative.',
                );
            }

            return true;
        }),
];

/**
 * ============================================================================
 * Pagination Validation
 * ============================================================================
 */

const paginationValidators = [
    query('page')
        .optional()
        .default(DEFAULT_PAGE)
        .toInt()
        .isInt({
            min: 1,
            max: MAX_PAGE,
        })
        .withMessage(
            'page must be a valid positive integer.',
        ),

    query('limit')
        .optional()
        .default(DEFAULT_LIMIT)
        .toInt()
        .isInt({
            min: 1,
            max: MAX_LIMIT,
        })
        .withMessage(
            `limit must be between 1 and ${MAX_LIMIT}.`,
        ),
];

/**
 * ============================================================================
 * Validation Helper
 * ============================================================================
 */

function validationChain(rules) {
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
        createReferralValidators,
    ),
    asyncHandler(
        async (req, res, next) => {
            /**
             * matchedData() prevents arbitrary/unvalidated body properties
             * from flowing into downstream business logic.
             */

            const validated = matchedData(
                req,
                {
                    locations: ['body'],
                    includeOptionals: true,
                },
            );

            const requestBody = {
                ...(validated ?? {}),

                email: normalizeString(
                    validated?.email,
                )?.toLowerCase(),

                name: normalizeString(
                    validated?.name,
                ),

                phone: normalizeString(
                    validated?.phone,
                ),

                note: normalizeString(
                    validated?.note,
                ),
            };

            /**
             * Trusted identity and tracing metadata are appended AFTER
             * validation, never accepted from the client.
             */

            req.body = {
                ...requestBody,

                tenantId: req.tenantId,
                actorId: req.referralActorId,

                requestId: req.requestId,
                correlationId:
                    req.correlationId,
            };

            return createReferral(
                req,
                res,
                next,
            );
        },
    ),
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
        paginationValidators,
    ),
    asyncHandler(
        async (req, res, next) => {
            /**
             * Controller receives sanitized pagination values plus trusted
             * actor/tenant context.
             *
             * The controller can derive the user identity from:
             *
             *   req.referralActorId
             *   req.adminContext.actorId
             *
             * and tenant from:
             *
             *   req.tenantId
             *   req.adminContext.tenantId
             */

            const validated = matchedData(
                req,
                {
                    locations: ['query'],
                    includeOptionals: true,
                },
            );

            req.query = {
                page:
                    validated?.page ??
                    DEFAULT_PAGE,

                limit:
                    validated?.limit ??
                    DEFAULT_LIMIT,
            };

            return getUserReferrals(
                req,
                res,
                next,
            );
        },
    ),
);

/**
 * ============================================================================
 * 404
 * ============================================================================
 */

router.use(
    (req, res) => {
        return res
            .status(404)
            .json({
                success: false,
                code: 'REFERRAL_ROUTE_NOT_FOUND',
                message:
                    'Referral endpoint not found.',
                requestId: req.requestId,
                correlationId: req.correlationId,
                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * ============================================================================
 * Error Handler
 * ============================================================================
 *
 * Internal errors are intentionally not returned to clients.
 *
 * The centralized application logger/observability layer should receive the
 * original error before this boundary if the application has a global error
 * middleware.
 * ============================================================================
 */

router.use(
    (error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }

        const rawStatusCode = Number(
            error?.statusCode,
        );

        const statusCode =
            Number.isInteger(rawStatusCode) &&
            rawStatusCode >= 400 &&
            rawStatusCode < 600
                ? rawStatusCode
                : 500;

        const clientError =
            statusCode >= 400 &&
            statusCode < 500;

        const errorCode =
            normalizeString(
                error?.code,
            ) ??
            (
                clientError
                    ? 'REFERRAL_REQUEST_ERROR'
                    : 'REFERRAL_INTERNAL_ERROR'
            );

        /**
         * Prevent arbitrary server-side error codes from becoming an
         * uncontrolled public API surface for unexpected failures.
         */
        const publicCode =
            clientError
                ? errorCode
                : 'REFERRAL_INTERNAL_ERROR';

        const publicMessage =
            clientError &&
            normalizeString(
                error?.message,
            )
                ? error.message
                : 'The referral request could not be completed.';

        return res
            .status(statusCode)
            .json({
                success: false,
                code: publicCode,
                message: publicMessage,
                requestId: req.requestId,
                correlationId: req.correlationId,
                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * ============================================================================
 * Router Metadata
 * ============================================================================
 */

router.routerName = ROUTER_NAME;
router.routerVersion = ROUTER_VERSION;
router.serviceName = SERVICE_NAME;

module.exports = router;