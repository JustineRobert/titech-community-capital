'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Mobile Money Integration Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/momo.Routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP boundary for Mobile Money provider integration.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * Tenant-scoped:
 *
 *   POST /deposit
 *
 * External provider:
 *
 *   POST /webhook
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Deposit initiation:
 *
 *   HTTP Request
 *        ↓
 *   Request Metadata
 *        ↓
 *   Authentication
 *        ↓
 *   Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency
 *        ↓
 *   MoMo Service
 *        ↓
 *   Provider
 *
 * Webhook:
 *
 *   Provider
 *        ↓
 *   Raw / verified callback handling
 *        ↓
 *   Signature / authenticity verification
 *        ↓
 *   Idempotency / replay protection
 *        ↓
 *   MoMo Webhook Handler
 *        ↓
 *   Financial Transaction Service
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ trust tenantId from req.body for tenant selection
 *   ✗ trust a webhook tenantId from the provider request body
 *   ✗ log full request bodies containing sensitive financial/PII information
 *   ✗ directly mutate balances or ledgers
 *   ✗ mark transactions as successful before provider confirmation
 *   ✗ use JWT authentication for external provider callbacks
 *
 * Provider authenticity, callback idempotency and transaction-state handling
 * belong to the Mobile Money integration/service layer.
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

const {
    initiateDeposit,
} =
    require(
        '../modules/integrations/momo.service'
    );

const {
    handleMomoCallback,
} =
    require(
        '../modules/integrations/momo.webhook'
    );

const tenantMiddleware =
    require(
        '../middleware/tenantMiddleware'
    );

const loggerModule =
    require(
        '../utils/logger'
    );

const logger =
    loggerModule ||
    console;

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
    'TITechMoMoIntegrationRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Mobile Money Integration API';

const MAX_PHONE_LENGTH =
    32;

const MAX_AMOUNT =
    Number(
        process.env.TITECH_MOMO_MAX_DEPOSIT_AMOUNT ||
        1_000_000_000_000_000
    );

const MAX_REFERENCE_LENGTH =
    255;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */

if (
    typeof initiateDeposit !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] momo.service.initiateDeposit must be a function.`
    );
}

if (
    typeof handleMomoCallback !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] momo.webhook.handleMomoCallback must be a function.`
    );
}

if (
    typeof tenantMiddleware !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] tenantMiddleware must be a function.`
    );
}

/**
 * ============================================================================
 * Optional Authentication
 * ============================================================================
 *
 * Deposit initiation should be authenticated. Tenant middleware alone must not
 * be treated as proof that the caller is an authorized TITech user.
 * ============================================================================
 */

let authenticate =
    null;

try {
    const auth =
        require(
            '../middleware/auth'
        );

    authenticate =
        auth?.verifyToken ||
        auth?.authenticate;
} catch {
    authenticate =
        null;
}

if (
    typeof authenticate !==
        'function'
) {
    try {
        const requireAuth =
            require(
                '../middleware/requireAuth'
            );

        authenticate =
            requireAuth;
    } catch {
        authenticate =
            null;
    }
}

if (
    typeof authenticate !==
        'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Deposit initiation requires authentication middleware.`
    );
}

/**
 * ============================================================================
 * Optional Canonical Idempotency Middleware
 * ============================================================================
 */

let idempotencyFactory =
    null;

try {
    const idempotencyModule =
        require(
            '../middleware/idempotency'
        );

    idempotencyFactory =
        typeof idempotencyModule ===
            'function'
            ? idempotencyModule
            : idempotencyModule?.idempotency ||
              null;
} catch {
    idempotencyFactory =
        null;
}

/**
 * ============================================================================
 * Request Metadata
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
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer'
        );

        /**
         * Financial initiation and provider callback responses should not be
         * cached.
         */
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
 * Body Parser
 * ============================================================================
 *
 * The MoMo webhook may require raw request bytes for signature verification.
 * Therefore this router does NOT blindly install express.json() globally.
 *
 * The webhook middleware should own raw-body parsing when the provider
 * signature scheme requires it.
 *
 * Deposit requests are parsed with a bounded JSON middleware on that route.
 * ============================================================================
 */

/**
 * ============================================================================
 * Deposit Rate Limiter
 * ============================================================================
 */

const depositLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_DEPOSIT_RATE_LIMIT',
                20
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
                        'MOMO_DEPOSIT_RATE_LIMITED',

                    message:
                        'Too many Mobile Money deposit requests. Please try again later.',

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
 * Deposit Request Body Parser
 * ============================================================================
 */

const depositBodyParser =
    express.json({
        limit:
            process.env.TITECH_MOMO_DEPOSIT_BODY_LIMIT ||
            '64kb',

        strict:
            true,
    });

/**
 * ============================================================================
 * Tenant + Authentication Boundary
 * ============================================================================
 */

router.post(
    '/deposit',

    authenticate,

    tenantMiddleware,

    depositLimiter,

    depositBodyParser,

    validateDepositRequest,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MOMO_DEPOSIT_INITIATION',
        'momo-deposits'
    ),

    asyncHandler(
        async (
            req,
            res
        ) => {
            const tenantId =
                normalizeString(
                    req.tenantId
                );

            const phone =
                normalizeString(
                    req.body.phone
                );

            const amount =
                Number(
                    req.body.amount
                );

            const result =
                await initiateDeposit({
                    tenantId,

                    phone,

                    amount,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    idempotencyKey:
                        req.idempotencyKey,
                });

            /**
             * Do not log the full phone number.
             */
            safeLogInfo(
                '[TITechMoMoRoutes] Deposit initiated',
                {
                    tenantId,
                    amount,

                    reference:
                        normalizeString(
                            result?.reference
                        ),

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                }
            );

            return res
                .status(202)
                .json({
                    success:
                        true,

                    message:
                        'Mobile Money deposit initiated.',

                    reference:
                        normalizeString(
                            result?.reference
                        ),

                    status:
                        normalizeString(
                            result?.status,
                            'pending'
                        ),

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        }
    )
);

/**
 * ============================================================================
 * WEBHOOK
 * ============================================================================
 *
 * IMPORTANT:
 * No `tenantMiddleware`.
 * No JWT authentication.
 *
 * The provider is the caller.
 *
 * `handleMomoCallback` MUST:
 *
 *   1. Verify provider authenticity/signature.
 *   2. Validate the callback schema.
 *   3. Resolve the tenant from the verified transaction/provider reference.
 *   4. Enforce callback idempotency/replay protection.
 *   5. Validate the expected transaction state transition.
 *   6. Execute the financial posting workflow through the service layer.
 *   7. Return the provider's required acknowledgement.
 *
 * ============================================================================
 */

router.post(
    '/webhook',

    webhookLimiter,

    handleMomoCallback
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 *
 * This endpoint intentionally does not reveal provider credentials,
 * configuration or connectivity internals.
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

                webhook:
                    'enabled',

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
 * Route Not Found
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

        /**
         * Never log complete request bodies because they may contain:
         * - phone numbers
         * - transaction references
         * - provider payloads
         * - signatures
         * - financial information
         */
        safeLogError(
            '[TITechMoMoRoutes] Request error',
            {
                code:
                    error?.code,

                statusCode,

                tenantId:
                    normalizeString(
                        req.tenantId
                    ),

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                message:
                    error?.message,
            }
        );

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
    }
);

/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

function validateDepositRequest(
    req,
    res,
    next
) {
    const body =
        req.body;

    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(
            body
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_MOMO_REQUEST_BODY',

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
            body.phone
        );

    const amount =
        Number(
            body.amount
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

    /**
     * Keep this deliberately broad because provider-specific MSISDN formats
     * should be validated by the MoMo service/provider adapter.
     */
    if (
        !/^\+?[0-9][0-9\s\-()]{6,30}$/.test(
            phone
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
            amount
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
     * Reject client-selected tenant identity.
     */
    if (
        Object.prototype.hasOwnProperty.call(
            body,
            'tenantId'
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_TENANT_OVERRIDE_FORBIDDEN',

                message:
                    'tenantId must come from trusted tenant context.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    /**
     * Reject client-selected user identity.
     */
    if (
        Object.prototype.hasOwnProperty.call(
            body,
            'userId'
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_USER_OVERRIDE_FORBIDDEN',

                message:
                    'userId must come from authenticated context.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    /**
     * Normalize the phone for downstream service handling.
     */
    req.body =
        {
            ...body,

            phone:
                phone.replace(
                    /[\s()-]/g,
                    ''
                ),

            amount,
        };

    next();
}

/**
 * ============================================================================
 * Idempotency
 * ============================================================================
 */

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
                    'Idempotency-Key is required for Mobile Money deposit initiation.',

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
    if (
        typeof idempotencyFactory !==
            'function'
    ) {
        /**
         * Do not silently turn idempotency off.
         *
         * The header is still required, but persistent replay protection is
         * explicitly reported as unavailable.
         */
        return (
            req,
            res,
            next
        ) => {
            const error =
                new Error(
                    'Persistent idempotency middleware is not configured.'
                );

            error.code =
                'MOMO_IDEMPOTENCY_MIDDLEWARE_UNAVAILABLE';

            error.statusCode =
                503;

            next(
                error
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
            `[${ROUTER_NAME}] Invalid idempotency middleware contract for ${operation}.`
        );
    }

    return middleware;
}

/**
 * ============================================================================
 * Webhook Rate Limiting
 * ============================================================================
 *
 * This is deliberately independent of tenant identity because the provider
 * callback is external.
 *
 * Production installations should also apply upstream IP/signature controls
 * at the load balancer/API gateway where possible.
 * ============================================================================
 */

const webhookLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_WEBHOOK_RATE_LIMIT',
                300
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
            res.setHeader(
                'Retry-After',
                '60'
            );

            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_WEBHOOK_RATE_LIMITED',

                    message:
                        'Too many Mobile Money callback requests.',

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
 * Safe Logging
 * ============================================================================
 */

function safeLogInfo(
    message,
    metadata
) {
    try {
        if (
            typeof logger.info ===
                'function'
        ) {
            logger.info(
                message,
                metadata
            );
        }
    } catch {
        // Never allow logging failure to break a financial request.
    }
}

function safeLogError(
    message,
    metadata
) {
    try {
        if (
            typeof logger.error ===
                'function'
        ) {
            logger.error(
                message,
                metadata
            );
        }
    } catch {
        // Never allow logging failure to mask the original error.
    }
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