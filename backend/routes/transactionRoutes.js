'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/transactionRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for TITech Community Capital transaction operations.
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 *
 * POST /withdraw
 *
 * Architecture
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
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency
 *        ↓
 *   Fraud / Risk Middleware
 *        ↓
 *   Transaction Controller / Service
 *        ↓
 *   Ledger
 *        ↓
 *   Wallet / Account
 *        ↓
 *   Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This route MUST NOT:
 *
 *   ✗ declare a withdrawal successful without a financial service
 *   ✗ modify balances directly
 *   ✗ write ledger entries directly
 *   ✗ trust client-supplied userId or tenantId
 *   ✗ rely on fraudMiddleware as authentication
 *   ✗ bypass idempotency
 *
 * All financial mutations belong to the canonical TITech financial service
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
} =
    require('express-validator');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const fraudMiddleware =
    require(
        '../middleware/fraudMiddleware'
    );

/**
 * ============================================================================
 * Resolve Authentication
 * ============================================================================
 */

const authenticate =
    resolveAuthenticationMiddleware();

if (
    typeof authenticate !==
        'function'
) {
    throw new TypeError(
        '[TITechTransactionRoutes] Authentication middleware is unavailable.'
    );
}

/**
 * ============================================================================
 * Resolve Transaction Handler
 * ============================================================================
 *
 * Prefer the canonical transaction controller/service. We deliberately do not
 * implement financial logic inside this route.
 * ============================================================================
 */

const withdrawHandler =
    resolveWithdrawalHandler();

if (
    typeof withdrawHandler !==
        'function'
) {
    throw new Error(
        '[TITechTransactionRoutes] No canonical withdrawal handler is configured.'
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
                    'TITech Transaction API',

                serviceVersion:
                    '2026.1',
            });
    }
} catch {
    adminContextMiddleware =
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
            process.env.TITECH_TRANSACTION_BODY_LIMIT ||
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
    authenticate
);

/**
 * ============================================================================
 * Trusted Tenant / Actor Context
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
                    'WITHDRAWAL_TENANT_CONTEXT_REQUIRED',

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
                    'WITHDRAWAL_ACTOR_CONTEXT_REQUIRED',

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

    next();
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const withdrawalLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_WITHDRAWAL_RATE_LIMIT',
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
                    req.transactionActorId
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
                        'WITHDRAWAL_RATE_LIMITED',

                    message:
                        'Too many withdrawal requests. Please try again later.',

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
        '[TITechTransactionRoutes] Persistent idempotency middleware is required.'
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
                    'Idempotency-Key is required for withdrawals.',

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
            255
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
            `[TITechTransactionRoutes] Invalid idempotency middleware for ${operation}.`
        );
    }

    return middleware;
}

/**
 * ============================================================================
 * Withdrawal Validation
 * ============================================================================
 */

const withdrawalValidation =
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
                    Number(
                        process.env
                            .TITECH_MAX_WITHDRAWAL_AMOUNT ||
                        1_000_000_000_000_000
                    ),
            })
            .withMessage(
                'amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('currency')
            .optional()
            .isString()
            .trim()
            .isLength({
                min:
                    3,

                max:
                    3,
            })
            .withMessage(
                'currency must be a three-letter code.'
            )
            .toUpperCase(),

        body('method')
            .optional()
            .isIn([
                'mobile_money',
                'bank_transfer',
                'wallet',
                'cash',
            ])
            .withMessage(
                'Unsupported withdrawal method.'
            ),

        body('phoneNumber')
            .optional()
            .isString()
            .trim()
            .isLength({
                min:
                    7,

                max:
                    32,
            })
            .withMessage(
                'Invalid phone number.'
            )
            .matches(
                /^\+?[0-9][0-9\s\-()]{6,30}$/
            )
            .withMessage(
                'Invalid phone number format.'
            ),

        body('reference')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    255,
            })
            .withMessage(
                'reference is too long.'
            ),

        /**
         * Never permit identity/tenant override.
         */
        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must come from trusted context.'
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
 * Validation Infrastructure
 * ============================================================================
 */

const handleValidation =
    resolveValidationHandler();

/**
 * ============================================================================
 * Withdrawal Route
 * ============================================================================
 *
 * POST /withdraw
 * ============================================================================
 */

router.post(
    '/withdraw',

    withdrawalLimiter,

    ...withdrawalValidation,

    handleValidation,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'WITHDRAWAL',
        'withdrawals'
    ),

    fraudMiddleware,

    asyncHandler(
        async (
            req,
            res,
            next
        ) => {
            /**
             * Explicit trusted transaction context.
             */
            req.transactionContext =
                {
                    tenantId:
                        req.tenantId,

                    actorId:
                        req.transactionActorId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    idempotencyKey:
                        req.idempotencyKey,
                };

            return withdrawHandler(
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
                    'TITech Transaction API',

                status:
                    'UP',

                withdrawal:
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
                            ? 'WITHDRAWAL_REQUEST_ERROR'
                            : 'WITHDRAWAL_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The withdrawal request could not be completed.'
                        )
                        : 'The withdrawal request could not be completed.',

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
 * Helper Resolution
 * ============================================================================
 */

function resolveAuthenticationMiddleware() {
    const candidates =
        [
            '../middleware/auth',
            '../middlewares/auth',
            '../middleware/authMiddleware',
            '../middleware/requireAuth',
        ];

    for (
        const candidate
        of candidates
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

            const middleware =
                loaded?.authenticate ||
                loaded?.verifyToken ||
                loaded?.verifyAccessToken ||
                loaded?.requireAuth;

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

function resolveWithdrawalHandler() {
    const candidates =
        [
            {
                path:
                    '../controllers/transaction.controller',

                names:
                    [
                        'withdraw',
                        'createWithdrawal',
                        'processWithdrawal',
                    ],
            },

            {
                path:
                    '../controllers/transactionController',

                names:
                    [
                        'withdraw',
                        'createWithdrawal',
                        'processWithdrawal',
                    ],
            },

            {
                path:
                    '../services/transaction.service',

                names:
                    [
                        'withdraw',
                        'createWithdrawal',
                        'processWithdrawal',
                    ],
            },
        ];

    for (
        const candidate
        of candidates
    ) {
        try {
            const loaded =
                require(
                    candidate.path
                );

            const moduleValue =
                loaded?.default ||
                loaded;

            if (
                typeof moduleValue ===
                    'function'
            ) {
                return moduleValue;
            }

            for (
                const name of
                candidate.names
            ) {
                if (
                    typeof moduleValue?.[
                        name
                    ] ===
                    'function'
                ) {
                    return moduleValue[
                        name
                    ];
                }
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

function resolveValidationHandler() {
    const candidates =
        [
            '../utils/validators',
            '../utils/validation',
        ];

    for (
        const candidate
        of candidates
    ) {
        try {
            const loaded =
                require(
                    candidate
                );

            const handler =
                loaded?.handleValidation ||
                loaded?.handleValidationErrors;

            if (
                typeof handler ===
                    'function'
            ) {
                return handler;
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

if (
    typeof handleValidation !==
        'function'
) {
    throw new Error(
        '[TITechTransactionRoutes] Validation infrastructure is unavailable.'
    );
}

function asyncHandler(
    handler
) {
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
 * Export
 * ============================================================================
 */

module.exports =
    router;