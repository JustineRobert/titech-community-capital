'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/transaction.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for TITech Community Capital transaction operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * Protected financial mutations:
 *
 *   POST /deposit
 *   POST /withdraw
 *
 * External provider callback:
 *
 *   POST /momo/webhook
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Member transaction:
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Context
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency
 *        ↓
 *   Transaction Controller
 *        ↓
 *   Financial Transaction Service
 *        ↓
 *   Ledger / Wallet / Audit
 *
 * Mobile Money webhook:
 *
 *   Provider
 *        ↓
 *   Provider Authentication / Signature Verification
 *        ↓
 *   Replay Protection
 *        ↓
 *   Transaction Webhook Controller / Service
 *        ↓
 *   Financial Posting
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ mutate balances directly
 *   ✗ write ledger entries directly
 *   ✗ trust client supplied userId/tenantId
 *   ✗ authenticate provider webhooks with user JWT
 *   ✗ process the same webhook through multiple financial paths
 *
 * Business logic belongs in controllers/services.
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
        strict: false,
        caseSensitive: false,
    });

const controller =
    require('../controllers/transaction.controller');

const authModule =
    require('../middlewares/auth');

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechTransactionRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Transaction API';

const MAX_AMOUNT =
    Number(
        process.env.TITECH_TRANSACTION_MAX_AMOUNT ||
        1_000_000_000_000_000
    );

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

const REQUIRED_HANDLERS =
    Object.freeze([
        'deposit',
        'withdraw',
        'momoWebhook',
    ]);

for (
    const handlerName of
    REQUIRED_HANDLERS
) {
    if (
        typeof controller?.[
            handlerName
        ] !== 'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing controller.${handlerName} export.`
        );
    }
}

/**
 * ============================================================================
 * Authentication Contract
 * ============================================================================
 *
 * Supports either:
 *
 *   module.exports = middleware
 *
 * or:
 *
 *   module.exports = {
 *      authenticate,
 *      verifyToken,
 *   }
 *
 * ============================================================================
 */

const authenticate =
    typeof authModule ===
        'function'
        ? authModule
        : authModule?.authenticate ||
          authModule?.verifyToken ||
          authModule?.verifyAccessToken;

if (
    typeof authenticate !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
}

/**
 * ============================================================================
 * Request / Correlation Context
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
 *
 * The webhook can require raw request bytes for signature verification.
 * Therefore we do not install a router-wide JSON parser.
 *
 * Financial mutation routes get their own bounded JSON parser below.
 * ============================================================================
 */

const financialJsonParser =
    express.json({
        limit:
            process.env.TITECH_TRANSACTION_BODY_LIMIT ||
            '256kb',

        strict:
            true,
    });

/**
 * ============================================================================
 * Trusted Tenant Context
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
                    'TRANSACTION_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for transaction operations.',

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
                    'TRANSACTION_ACTOR_CONTEXT_REQUIRED',

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

    req.transactionActorId =
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

/**
 ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const transactionLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_TRANSACTION_RATE_LIMIT',
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
                    req.transactionActorId ||
                    req.user?.id ||
                    req.user?._id ||
                    req.user?.userId
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
                        'TRANSACTION_RATE_LIMITED',

                    message:
                        'Too many transaction requests. Please try again later.',

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

const webhookLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_TRANSACTION_WEBHOOK_RATE_LIMIT',
                300
            ),

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        keyGenerator(
            req
        ) {
            return (
                normalizeString(
                    req.ip
                ) ||
                normalizeString(
                    req.socket?.remoteAddress
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
                        'TRANSACTION_WEBHOOK_RATE_LIMITED',

                    message:
                        'Too many payment-provider webhook requests.',

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
 * Idempotency
 * ============================================================================
 */

const idempotencyFactory =
    resolveIdempotencyFactory();

if (
    typeof idempotencyFactory !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Persistent idempotency middleware is required for financial transaction routes.`
    );
}

function requireIdempotencyKey(
    req,
    res,
    next
) {
    const key =
        normalizeString(
            req.headers?.[
                'idempotency-key'
            ]
        ) ||
        normalizeString(
            req.body?.idempotencyKey
        );

    if (
        !key
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'IDEMPOTENCY_KEY_REQUIRED',

                message:
                    'Idempotency-Key is required for financial transactions.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        key.length <
            16 ||
        key.length >
            MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency-Key must be between 16 and 255 characters.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        /[\u0000-\u001F\u007F]/.test(
            key
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency-Key contains unsupported characters.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.idempotencyKey =
        key;

    next();
}

function createIdempotencyMiddleware(
    operation,
    resource
) {
    const middleware =
        idempotencyFactory({
            operation,

            resource,

            required:
                true,
        });

    if (
        typeof middleware !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Invalid idempotency middleware for ${operation}.`
        );
    }

    return middleware;
}

/**
 * ============================================================================
 * Financial Request Validation
 * ============================================================================
 *
 * The exact shape can be expanded according to transaction.controller.
 * These checks prevent malformed financial requests while keeping domain rules
 * in the service layer.
 * ============================================================================
 */

const amountValidator =
    body('amount')
        .exists()
        .withMessage(
            'amount is required.'
        )
        .bail()
        .isFloat({
            gt: 0,
            max: MAX_AMOUNT,
        })
        .withMessage(
            'amount must be positive and within the supported limit.'
        )
        .toFloat();

const commonFinancialValidation =
    [
        amountValidator,

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must come from trusted tenant context.'
            ),

        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must come from authenticated context.'
            ),
    ];

/**
 * ============================================================================
 * Authentication / Tenant Boundary
 * ============================================================================
 *
 * Authentication is applied only to protected transaction mutation routes.
 * The MoMo webhook remains outside this boundary.
 * ============================================================================
 */

const authenticatedTenantStack =
    [
        authenticate,

        adminContextMiddleware ||
            fallbackTenantContext,
    ];

/**
 * ============================================================================
 * Deposit
 * ============================================================================
 *
 * POST /deposit
 * ============================================================================
 */

router.post(
    '/deposit',

    ...authenticatedTenantStack,

    transactionLimiter,

    financialJsonParser,

    ...commonFinancialValidation,

    resolveValidationHandler(),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'TRANSACTION_DEPOSIT',
        'transactions'
    ),

    asyncHandler(
        controller.deposit
    )
);

/**
 * ============================================================================
 * Withdrawal
 * ============================================================================
 *
 * POST /withdraw
 * ============================================================================
 */

router.post(
    '/withdraw',

    ...authenticatedTenantStack,

    transactionLimiter,

    financialJsonParser,

    ...commonFinancialValidation,

    resolveValidationHandler(),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'TRANSACTION_WITHDRAWAL',
        'transactions'
    ),

    asyncHandler(
        controller.withdraw
    )
);

/**
 * ============================================================================
 * Mobile Money Webhook
 * ============================================================================
 *
 * POST /momo/webhook
 *
 * No JWT authentication.
 *
 * The external provider is authenticated by the webhook controller/service.
 * That service should verify:
 *
 *   - provider signature/authentication
 *   - external transaction reference
 *   - provider status
 *   - replay/idempotency
 *   - transaction state transition
 *   - tenant resolution
 *
 * The route itself MUST NOT mutate the ledger/wallet.
 * ============================================================================
 */

router.post(
    '/momo/webhook',

    webhookLimiter,

    asyncHandler(
        controller.momoWebhook
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

                webhook:
                    'enabled',

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
                    'TRANSACTION_ROUTE_NOT_FOUND',

                message:
                    'Transaction endpoint not found.',

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
                            ? 'TRANSACTION_REQUEST_ERROR'
                            : 'TRANSACTION_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The transaction request could not be completed.'
                        )
                        : 'The transaction request could not be completed.',

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

function resolveValidationHandler() {
    let validators;

    try {
        validators =
            require(
                '../utils/validators'
            );
    } catch {
        validators =
            null;
    }

    const handler =
        validators?.handleValidation ||
        validators?.handleValidationErrors;

    if (
        typeof handler !==
        'function'
    ) {
        throw new Error(
            `[${ROUTER_NAME}] Transaction validation infrastructure is unavailable.`
        );
    }

    return handler;
}

function resolveIdempotencyFactory() {
    try {
        const loaded =
            require(
                '../middleware/idempotency'
            );

        if (
            typeof loaded ===
            'function'
        ) {
            return loaded;
        }

        if (
            typeof loaded?.idempotency ===
            'function'
        ) {
            return loaded.idempotency;
        }
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

    return null;
}

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