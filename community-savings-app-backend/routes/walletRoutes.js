'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Wallet Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/walletRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for wallet balance queries.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * GET /balance
 *
 * Security flow
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Context
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Object-Level Authorization
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Wallet Controller
 *        ↓
 *   Wallet Service / Repository
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ mutate wallet balances
 *   ✗ write ledger entries
 *   ✗ trust client-supplied tenantId
 *   ✗ trust client-supplied userId as wallet ownership
 *   ✗ expose another tenant's wallet
 *   ✗ calculate balances directly
 *
 * Balance calculation and financial integrity belong to the wallet/ledger
 * service layer.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express =
    require('express');

const crypto =
    require('node:crypto');

const rateLimit =
    require('express-rate-limit');

const router =
    express.Router({
        strict: false,
        caseSensitive: false,
    });

const walletController =
    require('../controllers/walletController');

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 */

const authModule =
    resolveAuthenticationModule();

const authenticate =
    typeof authModule === 'function'
        ? authModule
        : authModule?.authenticate ||
          authModule?.verifyToken ||
          authModule?.verifyAccessToken;

if (
    typeof authenticate !== 'function'
) {
    throw new TypeError(
        '[TITechWalletRoutes] Authentication middleware is unavailable.'
    );
}

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

if (
    typeof walletController?.getBalance !==
        'function'
) {
    throw new TypeError(
        '[TITechWalletRoutes] walletController.getBalance must be a function.'
    );
}

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechWalletRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Wallet API';

/**
 * ============================================================================
 * Request Context
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
        String(value).trim();

    return (
        normalized ||
        fallback
    );
}

function requestContext(
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
            req.headers?.['x-request-id']
        ) ||
        crypto.randomUUID();

    const correlationId =
        normalizeString(
            req.correlationId
        ) ||
        normalizeString(
            req.headers?.['x-correlation-id']
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
    requestContext
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
 * Authentication
 * ============================================================================
 */

router.use(
    authenticate
);

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 */

let tenantContextMiddleware =
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
        tenantContextMiddleware =
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
    tenantContextMiddleware =
        null;
}

router.use(
    tenantContextMiddleware ||
        fallbackTenantContext
);

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
                    'WALLET_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required.',

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
                    'WALLET_ACTOR_CONTEXT_REQUIRED',

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

    req.walletActorId =
        actorId;

    next();
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const walletReadLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_WALLET_READ_RATE_LIMIT',
                120
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
                    req.walletActorId
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
                        'WALLET_RATE_LIMITED',

                    message:
                        'Too many wallet balance requests. Please try again later.',

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
 * GET /balance
 * ============================================================================
 *
 * The controller should derive the wallet owner from the authenticated actor
 * and tenant context. It should not trust req.query.userId or req.body.userId.
 * ============================================================================
 */

router.get(
    '/balance',

    walletReadLimiter,

    asyncHandler(
        async (
            req,
            res,
            next
        ) => {
            req.walletContext =
                {
                    tenantId:
                        req.tenantId,

                    actorId:
                        req.walletActorId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                };

            return walletController.getBalance(
                req,
                res,
                next
            );
        }
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

                timestamp:
                    new Date().toISOString(),

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
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
                    'WALLET_ROUTE_NOT_FOUND',

                message:
                    'Wallet endpoint not found.',

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
                            ? 'WALLET_REQUEST_ERROR'
                            : 'WALLET_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The wallet request could not be completed.'
                        )
                        : 'The wallet request could not be completed.',

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
 * Helpers
 * ============================================================================
 */

function asyncHandler(
    handler
) {
    if (
        typeof handler !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] asyncHandler requires a function.`
        );
    }

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

function resolveAuthenticationModule() {
    const candidates = [
        '../middleware/auth',
        '../middlewares/auth',
        '../middleware/authMiddleware',
        '../middleware/requireAuth',
    ];

    for (
        const candidate of candidates
    ) {
        try {
            const loaded =
                require(
                    candidate
                );

            if (
                typeof loaded ===
                'function'
            ) {
                return loaded;
            }

            return loaded;
        } catch (
            error
        ) {
            if (
                error?.code !==
                'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    return null;
}

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