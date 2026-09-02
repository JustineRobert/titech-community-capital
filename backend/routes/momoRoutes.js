'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Mobile Money Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/momoRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP routing boundary for Mobile Money collection, disbursement,
 * and provider webhook operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /deposit
 *     Initiate a Mobile Money collection / Request-to-Pay transaction.
 *
 * POST /withdraw
 *     Initiate a Mobile Money disbursement.
 *
 * POST /webhook
 *     Canonical Mobile Money provider callback endpoint.
 *
 * Legacy / compatibility:
 *
 * POST /momo/callback
 *     Delegates to the SAME canonical webhook controller rather than executing
 *     financial logic in the route.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Collection:
 *
 *   HTTP Request
 *        ↓
 *   Request Context
 *        ↓
 *   Authentication
 *        ↓
 *   Tenant Authorization
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency
 *        ↓
 *   Collection Controller
 *        ↓
 *   MoMo Service / Provider Adapter
 *
 * Provider Callback:
 *
 *   Provider
 *        ↓
 *   Raw callback / signature verification
 *        ↓
 *   Webhook idempotency / replay protection
 *        ↓
 *   Webhook Controller
 *        ↓
 *   Financial Transaction Service
 *        ↓
 *   Ledger
 *        ↓
 *   Wallet
 *        ↓
 *   Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ create ledger entries directly
 *   ✗ credit/debit wallets directly
 *   ✗ update Transaction records directly
 *   ✗ trust provider tenantId from the request body
 *   ✗ authenticate external providers with user JWTs
 *   ✗ process a webhook through two independent code paths
 *
 * The route is intentionally thin.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology has been replaced with TITech Community Capital.
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

/**
 * ============================================================================
 * CONTROLLERS
 * ============================================================================
 */

const momoCollectionController =
    require(
        '../controllers/momoCollectionController'
    );

const momoDisbursementController =
    require(
        '../controllers/momoDisbursementController'
    );

const momoWebhookController =
    require(
        '../controllers/momoWebhookController'
    );

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechMoMoRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Mobile Money API';

const MAX_PHONE_LENGTH =
    32;

const MAX_AMOUNT =
    Number(
        process.env.TITECH_MOMO_MAX_AMOUNT ||
        1_000_000_000_000_000
    );

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * HANDLER VALIDATION
 * ============================================================================
 */

function ensureHandler(
    handler,
    name,
    modulePath,
) {
    if (
        typeof handler !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing or invalid handler "${name}" exported from "${modulePath}". Expected a function, received ${typeof handler}.`
        );
    }

    return handler;
}

function resolveHandler(
    controller,
    candidates,
    name,
    modulePath,
) {
    for (
        const candidate of
        candidates
    ) {
        if (
            typeof controller?.[
                candidate
            ] ===
            'function'
        ) {
            return controller[
                candidate
            ];
        }
    }

    return ensureHandler(
        null,
        name,
        modulePath,
    );
}

const requestToPay =
    resolveHandler(
        momoCollectionController,
        [
            'requestToPay',
            'handleRequestToPay',
            'initiateCollection',
        ],
        'requestToPay',
        '../controllers/momoCollectionController',
    );

const disburse =
    resolveHandler(
        momoDisbursementController,
        [
            'disburse',
            'handleDisburse',
            'initiateDisbursement',
        ],
        'disburse',
        '../controllers/momoDisbursementController',
    );

const momoCallback =
    resolveHandler(
        momoWebhookController,
        [
            'momoCallback',
            'handleMoMoWebhook',
            'handleWebhook',
            'handleMomoCallback',
        ],
        'momoCallback',
        '../controllers/momoWebhookController',
    );

/**
 * ============================================================================
 * ASYNC HANDLER
 * ============================================================================
 */

function asyncHandler(
    handler,
) {
    ensureHandler(
        handler,
        'asyncHandler target',
        ROUTER_NAME,
    );

    return (
        req,
        res,
        next,
    ) => {
        Promise
            .resolve(
                handler(
                    req,
                    res,
                    next,
                ),
            )
            .catch(
                next,
            );
    };
}

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null,
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
            value,
        ).trim();

    return (
        normalized ||
        fallback
    );
}

function requestMetadata(
    req,
    res,
    next,
) {
    const requestId =
        normalizeString(
            req.requestId,
        ) ||
        normalizeString(
            req.id,
        ) ||
        normalizeString(
            req.headers?.[
                'x-request-id'
            ],
        ) ||
        crypto.randomUUID();

    const correlationId =
        normalizeString(
            req.correlationId,
        ) ||
        normalizeString(
            req.headers?.[
                'x-correlation-id'
            ],
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

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

router.use(
    requestMetadata,
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
        next,
    ) => {
        res.setHeader(
            'X-Content-Type-Options',
            'nosniff',
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer',
        );

        /**
         * Financial/mobile-money responses must not be cached.
         */
        res.setHeader(
            'Cache-Control',
            'no-store',
        );

        res.setHeader(
            'Pragma',
            'no-cache',
        );

        next();
    },
);

/**
 * ============================================================================
 * BODY PARSER
 * ============================================================================
 *
 * Webhook signature verification may require access to the raw request body.
 *
 * Therefore:
 *
 *   - collection/disbursement routes use JSON parsing
 *   - webhook parsing is delegated to the webhook/controller infrastructure
 *
 * Do NOT install a global express.json() here if the provider signature
 * implementation requires raw bytes.
 * ============================================================================
 */

const financialJsonParser =
    express.json({
        limit:
            process.env.TITECH_MOMO_BODY_LIMIT ||
            '256kb',

        strict:
            true,
    });

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

const authenticate =
    resolveAuthenticationMiddleware();

if (
    typeof authenticate !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Mobile Money collection/disbursement routes require authentication middleware.`,
    );
}

/**
 * ============================================================================
 * TENANT AUTHORIZATION
 * ============================================================================
 */

const tenantAuthorization =
    resolveTenantAuthorizationMiddleware();

if (
    typeof tenantAuthorization !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Mobile Money routes require tenant authorization middleware.`,
    );
}

/**
 * ============================================================================
 * OPTIONAL IDEMPOTENCY
 * ============================================================================
 */

const idempotencyFactory =
    resolveIdempotencyFactory();

/**
 * ============================================================================
 * ROUTE LIMITERS
 * ============================================================================
 */

const collectionLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_COLLECTION_RATE_LIMIT',
                30,
            ),

        code:
            'MOMO_COLLECTION_RATE_LIMITED',

        message:
            'Too many Mobile Money collection requests. Please try again later.',
    });

const disbursementLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_DISBURSEMENT_RATE_LIMIT',
                20,
            ),

        code:
            'MOMO_DISBURSEMENT_RATE_LIMITED',

        message:
            'Too many Mobile Money disbursement requests. Please try again later.',
    });

const webhookLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_WEBHOOK_RATE_LIMIT',
                300,
            ),

        code:
            'MOMO_WEBHOOK_RATE_LIMITED',

        message:
            'Too many Mobile Money webhook requests.',
    });

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
            req,
        ) {
            return (
                normalizeString(
                    req.user?.id ||
                        req.user?._id ||
                        req.user?.userId ||
                        req.auth?.userId,
                ) ||
                normalizeString(
                    req.tenantId,
                ) ||
                normalizeString(
                    req.ip,
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res,
        ) {
            const retryAfter =
                Math.ceil(
                    windowMs /
                        1000,
                );

            res.setHeader(
                'Retry-After',
                String(
                    retryAfter,
                ),
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
 * TRUSTED TENANT CONTEXT
 * ============================================================================
 *
 * Tenant identity must come from authenticated context.
 * ============================================================================
 */

function requireTrustedTenant(
    req,
    res,
    next,
) {
    const tenantId =
        normalizeString(
            req.adminContext?.tenantId ||
                req.tenantId ||
                req.user?.tenantId ||
                req.auth?.tenantId,
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
                    'MOMO_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for Mobile Money operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.tenantId =
        tenantId;

    next();
}

/**
 * ============================================================================
 * DEPOSIT VALIDATION
 * ============================================================================
 */

function validateDeposit(
    req,
    res,
    next,
) {
    const requestBody =
        req.body;

    if (
        !requestBody ||
        typeof requestBody !==
            'object' ||
        Array.isArray(
            requestBody,
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_INVALID_REQUEST_BODY',

                message:
                    'A JSON object request body is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const phone =
        normalizeString(
            requestBody.phone,
        );

    const amount =
        Number(
            requestBody.amount,
        );

    if (
        !phone
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_PHONE_REQUIRED',

                message:
                    'Phone number is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        phone.length >
        MAX_PHONE_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_PHONE_INVALID',

                message:
                    'Phone number is invalid.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !/^\+?[0-9][0-9\s\-()]{6,30}$/.test(
            phone,
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_PHONE_INVALID',

                message:
                    'Phone number format is invalid.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !Number.isFinite(
            amount,
        ) ||
        amount <=
            0 ||
        amount >
            MAX_AMOUNT
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_AMOUNT_INVALID',

                message:
                    'Amount must be a positive value within the supported limit.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    /**
     * Prevent client-side tenant or actor impersonation.
     */
    if (
        Object.prototype.hasOwnProperty.call(
            requestBody,
            'tenantId',
        ) ||
        Object.prototype.hasOwnProperty.call(
            requestBody,
            'userId',
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_IDENTITY_OVERRIDE_FORBIDDEN',

                message:
                    'Tenant and user identity must come from trusted authenticated context.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.body =
        {
            ...requestBody,

            phone:
                phone.replace(
                    /[\s()-]/g,
                    '',
                ),

            amount,
        };

    next();
}

/**
 * ============================================================================
 * IDEMPOTENCY KEY
 * ============================================================================
 */

function requireIdempotencyKey(
    req,
    res,
    next,
) {
    const key =
        normalizeString(
            req.headers?.[
                'idempotency-key'
            ],
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
                    'Idempotency-Key is required for Mobile Money financial operations.',

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
            key,
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

function buildIdempotencyMiddleware(
    operation,
    resource,
) {
    if (
        typeof idempotencyFactory !==
            'function'
    ) {
        return (
            req,
            res,
            next,
        ) => {
            const error =
                new Error(
                    'Persistent idempotency middleware is not configured.',
                );

            error.code =
                'MOMO_IDEMPOTENCY_UNAVAILABLE';

            error.statusCode =
                503;

            next(
                error,
            );
        };
    }

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
            `[${ROUTER_NAME}] Invalid idempotency middleware contract for ${operation}.`,
        );
    }

    return middleware;
}

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

    authenticate,

    tenantAuthorization,

    requireTrustedTenant,

    collectionLimiter,

    financialJsonParser,

    validateDeposit,

    requireIdempotencyKey,

    buildIdempotencyMiddleware(
        'MOMO_COLLECTION',
        'momo-collections',
    ),

    asyncHandler(
        requestToPay,
    ),
);

/**
 * ============================================================================
 * Withdrawal / Disbursement
 * ============================================================================
 *
 * POST /withdraw
 *
 * This route should use the same financial protection model as collections.
 * ============================================================================
 */

router.post(
    '/withdraw',

    authenticate,

    tenantAuthorization,

    requireTrustedTenant,

    disbursementLimiter,

    financialJsonParser,

    requireIdempotencyKey,

    buildIdempotencyMiddleware(
        'MOMO_DISBURSEMENT',
        'momo-disbursements',
    ),

    asyncHandler(
        disburse,
    ),
);

/**
 * ============================================================================
 * CANONICAL WEBHOOK
 * ============================================================================
 *
 * POST /webhook
 *
 * NO JWT AUTHENTICATION.
 * NO tenantMiddleware.
 *
 * The controller/service must authenticate the provider callback.
 * ============================================================================
 */

router.post(
    '/webhook',

    webhookLimiter,

    asyncHandler(
        momoCallback,
    ),
);

/**
 * ============================================================================
 * LEGACY WEBHOOK COMPATIBILITY ALIAS
 * ============================================================================
 *
 * POST /momo/callback
 *
 * This intentionally delegates to exactly the same controller as /webhook.
 *
 * There is NO second ledger/wallet implementation here.
 *
 * New provider configuration should use:
 *
 *   POST /webhook
 *
 * ============================================================================
 */

router.post(
    '/momo/callback',

    webhookLimiter,

    asyncHandler(
        momoCallback,
    ),
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
        res,
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

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * ============================================================================
 * NOT FOUND
 * ============================================================================
 */

router.use(
    (
        req,
        res,
    ) => {
        return res
            .status(404)
            .json({
                success:
                    false,

                code:
                    'MOMO_ROUTE_NOT_FOUND',

                message:
                    'Mobile Money endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    },
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
        next,
    ) => {
        if (
            res.headersSent
        ) {
            return next(
                error,
            );
        }

        const statusCode =
            Number(
                error?.statusCode,
            ) >=
                400 &&
            Number(
                error?.statusCode,
            ) <
                600
                ? Number(
                    error.statusCode,
                )
                : 500;

        const clientError =
            statusCode >=
                400 &&
            statusCode <
                500;

        return res
            .status(
                statusCode,
            )
            .json({
                success:
                    false,

                code:
                    normalizeString(
                        error?.code,
                    ) ||
                    (
                        clientError
                            ? 'MOMO_REQUEST_ERROR'
                            : 'MOMO_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The Mobile Money request could not be completed.'
                        )
                        : 'The Mobile Money request could not be completed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * ============================================================================
 * Helper Resolution
 * ============================================================================
 */

function resolveAuthenticationMiddleware() {
    const candidates = [
        '../middleware/auth',
        '../middleware/requireAuth',
        '../middleware/authMiddleware',
    ];

    for (
        const candidate of
        candidates
    ) {
        try {
            const moduleValue =
                require(
                    candidate,
                );

            const middleware =
                resolveMiddleware(
                    moduleValue,
                    [
                        'verifyToken',
                        'authenticate',
                        'verifyAccessToken',
                        'requireAuth',
                    ],
                );

            if (
                typeof middleware ===
                    'function'
            ) {
                return middleware;
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
    }

    return null;
}

function resolveTenantAuthorizationMiddleware() {
    const candidates = [
        '../middleware/tenantAuthorization',
        '../middleware/tenant.authorization',
        '../middleware/tenantMiddleware',
        '../middleware/tenant',
    ];

    for (
        const candidate of
        candidates
    ) {
        try {
            const moduleValue =
                require(
                    candidate,
                );

            const middleware =
                resolveMiddleware(
                    moduleValue,
                    [
                        'tenantAuthorization',
                        'requireTenant',
                        'tenantMiddleware',
                    ],
                );

            if (
                typeof middleware ===
                    'function'
            ) {
                return middleware;
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
    }

    return null;
}

function resolveMiddleware(
    moduleValue,
    names,
) {
    if (
        typeof moduleValue ===
            'function'
    ) {
        return moduleValue;
    }

    if (
        !moduleValue
    ) {
        return null;
    }

    for (
        const name of
        names
    ) {
        if (
            typeof moduleValue[
                name
            ] ===
                'function'
        ) {
            return moduleValue[
                name
            ];
        }
    }

    return null;
}

function resolveIdempotencyFactory() {
    try {
        const moduleValue =
            require(
                '../middleware/idempotency',
            );

        if (
            typeof moduleValue ===
                'function'
        ) {
            return moduleValue;
        }

        if (
            typeof moduleValue?.idempotency ===
                'function'
        ) {
            return moduleValue.idempotency;
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
    fallback,
) {
    const value =
        Number(
            process.env[
                name
            ],
        );

    return (
        Number.isInteger(
            value,
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