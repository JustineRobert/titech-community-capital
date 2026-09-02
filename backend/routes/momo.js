'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Mobile Money Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/momo.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for TITech Community Capital Mobile Money operations.
 *
 * Current implementation:
 *   - Supports simulated deposit
 *   - Supports simulated withdrawal
 *   - Runs fraud scoring before transaction creation
 *
 * Production architecture:
 *
 *   HTTP Request
 *        ↓
 *   Request Metadata
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Idempotency
 *        ↓
 *   Request Validation
 *        ↓
 *   Fraud / Risk Evaluation
 *        ↓
 *   Financial Service
 *        ↓
 *   Transaction / Ledger
 *        ↓
 *   Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router MUST NOT:
 *
 *   ✗ trust req.body.userId as authenticated identity
 *   ✗ trust req.body.tenantId
 *   ✗ directly mutate wallet balances
 *   ✗ bypass idempotency
 *   ✗ mark a real provider transaction successful before confirmation
 *   ✗ expose raw database/provider errors
 *
 * The current `Transaction` model write is retained only for compatibility
 * with the supplied implementation. In the final TITech production financial
 * architecture, this should move into a dedicated Mobile Money service.
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

const Transaction =
    require('../models/Transaction');

const {
    calculateFraudScore,
} =
    require('../services/fraudEngine');

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
    'TITechMobileMoneyRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Mobile Money API';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_MOMO_BODY_LIMIT ||
    '256kb';

const MAX_AMOUNT =
    Number(
        process.env.TITECH_MOMO_MAX_AMOUNT ||
        1_000_000_000_000_000
    );

const MAX_NETWORK_LENGTH =
    32;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */

if (
    !Transaction ||
    typeof Transaction.find !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Transaction model is unavailable.`
    );
}

if (
    typeof Transaction.prototype?.save !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Transaction model does not expose save().`
    );
}

if (
    typeof calculateFraudScore !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] fraudEngine.calculateFraudScore must be a function.`
    );
}

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 */

const authModule =
    resolveModule(
        [
            '../middleware/auth',
            '../middleware/requireAuth',
            '../middleware/authMiddleware',
        ]
    );

const authenticate =
    resolveMiddleware(
        authModule,
        [
            'verifyToken',
            'authenticate',
            'verifyAccessToken',
            'requireAuth',
        ]
    );

if (
    typeof authenticate !==
        'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Mobile Money routes require authentication middleware.`
    );
}

/**
 * ============================================================================
 * Optional Tenant Context
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
 * ============================================================================
 * Optional Idempotency Infrastructure
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

        res.setHeader(
            'X-Frame-Options',
            'DENY'
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
            DEFAULT_BODY_LIMIT,

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
    authenticate
);

/**
 * ============================================================================
 * Tenant / Actor Context
 * ============================================================================
 */

router.use(
    adminContextMiddleware ||
        fallbackTrustedContext
);

function fallbackTrustedContext(
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
                    'MOMO_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for Mobile Money operations.',

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
                    'MOMO_ACTOR_CONTEXT_REQUIRED',

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

    req.momoActorId =
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
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const momoLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_RATE_LIMIT',
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
                    req.momoActorId ||
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
                        'MOMO_RATE_LIMITED',

                    message:
                        'Too many Mobile Money requests. Please try again later.',

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
 * Idempotency
 * ============================================================================
 *
 * Prefer the project's canonical idempotency middleware.
 *
 * If it is unavailable, the route performs a strict header validation so the
 * API contract remains explicit. Full persistent idempotency should still be
 * supplied by the project's middleware/service before production deployment.
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
                    'Idempotency-Key is required for Mobile Money operations.',

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

/**
 * ============================================================================
 * Request Validation
 * ============================================================================
 */

const paymentValidators =
    [
        body('amount')
            .exists()
            .withMessage(
                'amount is required.'
            )
            .bail()
            .isFloat({
                gt:
                    0,

                max:
                    MAX_AMOUNT,
            })
            .withMessage(
                'amount must be greater than zero and within the supported limit.'
            )
            .toFloat(),

        body('network')
            .exists()
            .withMessage(
                'network is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    2,

                max:
                    MAX_NETWORK_LENGTH,
            })
            .withMessage(
                'network is invalid.'
            ),

        /**
         * Client-supplied userId is deliberately rejected.
         *
         * The authenticated actor is authoritative.
         */
        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied. The authenticated user is authoritative.'
            ),

        /**
         * Client-supplied tenantId is deliberately rejected.
         */
        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied. Trusted tenant context is authoritative.'
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
 * Validation Middleware
 * ============================================================================
 */

function applyValidation(
    rules
) {
    if (
        typeof handleValidation !==
            'function'
    ) {
        return (
            req,
            res,
            next
        ) => {
            const error =
                new Error(
                    'Mobile Money validation infrastructure is unavailable.'
                );

            error.code =
                'MOMO_VALIDATION_UNAVAILABLE';

            error.statusCode =
                500;

            next(
                error
            );
        };
    }

    return [
        ...rules,
        handleValidation,
    ];
}

/**
 * ============================================================================
 * Resolve Authenticated Actor
 * ============================================================================
 */

function getAuthenticatedActor(
    req
) {
    return (
        normalizeString(
            req.momoActorId
        ) ||
        normalizeString(
            req.user?.id ||
                req.user?._id ||
                req.user?.userId
        ) ||
        normalizeString(
            req.auth?.userId
        )
    );
}

/**
 * ============================================================================
 * Transaction History
 * ============================================================================
 *
 * Reads only the authenticated actor's transactions.
 *
 * IMPORTANT:
 * The final production implementation should also include tenant scope:
 *
 *   { tenant: req.tenantId, user: actorId }
 *
 * if those fields exist in the Transaction model.
 * ============================================================================
 */

async function getRecentTransactionHistory(
    req
) {
    const actorId =
        getAuthenticatedActor(
            req
        );

    if (
        !actorId
    ) {
        const error =
            new Error(
                'Authenticated actor could not be resolved.'
            );

        error.code =
            'MOMO_ACTOR_NOT_RESOLVED';

        error.statusCode =
            401;

        throw error;
    }

    /**
     * Prefer tenant + user scoping when supported by the model.
     *
     * The current supplied model contract only demonstrates `user`.
     * Therefore this keeps `user` as the guaranteed query field.
     */
    return Transaction
        .find({
            user:
                actorId,
        })
        .sort({
            createdAt:
                -1,
        })
        .limit(
            5
        )
        .lean();
}

/**
 * ============================================================================
 * Fraud Evaluation
 * ============================================================================
 */

async function evaluateFraud(
    req,
    amount
) {
    const history =
        await getRecentTransactionHistory(
            req
        );

    const fraud =
        await Promise.resolve(
            calculateFraudScore(
                {
                    amount,
                    tenantId:
                        req.tenantId,
                    actorId:
                        getAuthenticatedActor(
                            req
                        ),
                    network:
                        req.body.network,
                },
                history
            )
        );

    if (
        !fraud ||
        typeof fraud !==
            'object'
    ) {
        const error =
            new Error(
                'Fraud engine returned an invalid result.'
            );

        error.code =
            'MOMO_FRAUD_ENGINE_INVALID_RESULT';

        error.statusCode =
            500;

        throw error;
    }

    return {
        isFraud:
            Boolean(
                fraud.isFraud
            ),

        score:
            Number(
                fraud.score ||
                    0
            ),
    };
}

/**
 * ============================================================================
 * Generate Reference
 * ============================================================================
 */

function generateReference(
    network,
    operation
) {
    const prefix =
        network ===
        'MTN'
            ? 'MTN'
            : network ===
              'AIRTEL'
                ? 'AIR'
                : 'MOMO';

    return [
        prefix,
        operation,
        Date.now(),
        crypto
            .randomBytes(
                6
            )
            .toString(
                'hex'
            )
            .toUpperCase(),
    ].join(
        '-'
    );
}

/**
 * ============================================================================
 * SIMULATED DEPOSIT
 * ============================================================================
 *
 * POST /api/momo/deposit
 *
 * This endpoint represents a simulation flow.
 *
 * A real production provider integration should not immediately set the
 * transaction to `success`; instead it should create a pending transaction and
 * transition the state from provider confirmation/webhook processing.
 * ============================================================================
 */

router.post(
    '/deposit',

    momoLimiter,

    ...applyValidation(
        paymentValidators
    ),

    requireIdempotencyKey,

    createOptionalIdempotencyMiddleware(
        'MOMO_DEPOSIT',
        'momo-deposit'
    ),

    asyncHandler(
        async (
            req,
            res
        ) => {
            const actorId =
                getAuthenticatedActor(
                    req
                );

            const amount =
                Number(
                    req.body.amount
                );

            const network =
                normalizeString(
                    req.body.network
                ).toUpperCase();

            const fraud =
                await evaluateFraud(
                    req,
                    amount
                );

            const reference =
                generateReference(
                    network,
                    'DEP'
                );

            const txn =
                new Transaction({
                    user:
                        actorId,

                    amount,

                    type:
                        'deposit',

                    network,

                    status:
                        'success',

                    reference,

                    isFraud:
                        fraud.isFraud,

                    fraudScore:
                        fraud.score,

                    /**
                     * Populate tenant when the model supports the field.
                     * Mongoose ignores undefined paths that are not in a strict
                     * schema, but this should be verified against the actual
                     * Transaction schema.
                     */
                    tenant:
                        req.tenantId,

                    metadata: {
                        channel:
                            'mobile-money',

                        providerSimulation:
                            true,

                        provider:
                            network,

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,

                        idempotencyKey:
                            req.idempotencyKey,
                    },
                });

            await txn.save();

            return res
                .status(201)
                .json({
                    success:
                        true,

                    transaction:
                        sanitizeTransaction(
                            txn
                        ),

                    fraud: {
                        flagged:
                            fraud.isFraud,

                        score:
                            fraud.score,
                    },

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
 * SIMULATED WITHDRAWAL
 * ============================================================================
 *
 * POST /api/momo/withdraw
 * ============================================================================
 */

router.post(
    '/withdraw',

    momoLimiter,

    ...applyValidation(
        paymentValidators
    ),

    requireIdempotencyKey,

    createOptionalIdempotencyMiddleware(
        'MOMO_WITHDRAWAL',
        'momo-withdrawal'
    ),

    asyncHandler(
        async (
            req,
            res
        ) => {
            const actorId =
                getAuthenticatedActor(
                    req
                );

            const amount =
                Number(
                    req.body.amount
                );

            const network =
                normalizeString(
                    req.body.network
                ).toUpperCase();

            const fraud =
                await evaluateFraud(
                    req,
                    amount
                );

            const reference =
                generateReference(
                    network,
                    'WDR'
                );

            const txn =
                new Transaction({
                    user:
                        actorId,

                    amount,

                    type:
                        'withdraw',

                    network,

                    status:
                        'success',

                    reference,

                    isFraud:
                        fraud.isFraud,

                    fraudScore:
                        fraud.score,

                    tenant:
                        req.tenantId,

                    metadata: {
                        channel:
                            'mobile-money',

                        providerSimulation:
                            true,

                        provider:
                            network,

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,

                        idempotencyKey:
                            req.idempotencyKey,
                    },
                });

            await txn.save();

            return res
                .status(201)
                .json({
                    success:
                        true,

                    transaction:
                        sanitizeTransaction(
                            txn
                        ),

                    fraud: {
                        flagged:
                            fraud.isFraud,

                        score:
                            fraud.score,
                    },

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

                simulation:
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
 * Helpers
 * ============================================================================
 */

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

function resolveModule(
    candidates
) {
    for (
        const candidate of
        candidates
    ) {
        try {
            return require(
                candidate
            );
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
    names
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

function createOptionalIdempotencyMiddleware(
    operation,
    resource
) {
    if (
        typeof idempotencyFactory !==
            'function'
    ) {
        return (
            req,
            res,
            next
        ) =>
            next();
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
 * Remove fields that should never be sent blindly to clients.
 */
function sanitizeTransaction(
    transaction
) {
    if (
        !transaction
    ) {
        return null;
    }

    const source =
        typeof transaction.toObject ===
            'function'
            ? transaction.toObject()
            : {
                ...transaction,
            };

    delete source.__v;

    /**
     * Never expose internal persistence/security metadata.
     */
    if (
        source.metadata
    ) {
        source.metadata =
            {
                channel:
                    source.metadata.channel,

                provider:
                    source.metadata.provider,

                providerSimulation:
                    source.metadata.providerSimulation,
            };
    }

    return source;
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