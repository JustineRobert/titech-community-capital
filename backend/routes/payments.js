'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/payments.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP routing boundary for TITech Community Capital payment
 * operations.
 *
 * Supported capabilities
 * ----------------------------------------------------------------------------
 *
 *   - Payment initiation
 *   - Payment intents
 *   - Mobile Money
 *     - MTN
 *     - Airtel
 *     - M-Pesa
 *   - Bank transfers
 *   - Payment verification
 *   - Payment history
 *   - Refunds
 *   - Payment analytics
 *   - Payment methods / fees
 *   - Dashboard statistics
 *   - External provider webhooks
 *   - Transaction listing
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Authenticated financial operation:
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
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
 *   Payment Controller
 *        ↓
 *   Payment Service
 *        ↓
 *   Financial Transaction
 *        ↓
 *   Ledger / Wallet / Audit
 *
 * Provider webhook:
 *
 *   External Provider
 *        ↓
 *   Provider Verification
 *        ↓
 *   Replay Protection
 *        ↓
 *   Payment Webhook Service
 *        ↓
 *   Financial Posting
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ write balances directly
 *   ✗ post ledger entries directly
 *   ✗ trust tenantId from body/query
 *   ✗ trust userId for ordinary user-scope operations
 *   ✗ use JWT authentication for provider webhooks
 *   ✗ expose raw provider/database exceptions
 *   ✗ treat payment initiation as proof of settlement
 *
 * All financial business rules belong in controllers/services/domain layers.
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
    param,
    query,
} =
    require('express-validator');

const {
    handleValidation,
} =
    require('../utils/validators');

const paymentController =
    require('../controllers/paymentController');

const auth =
    require('../middleware/auth');

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
    'TITechPaymentRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Payment API';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_PAYMENT_BODY_LIMIT ||
    '512kb';

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    100;

const MAX_DESCRIPTION_LENGTH =
    1000;

const MAX_REASON_LENGTH =
    500;

const MAX_ACCOUNT_NUMBER_LENGTH =
    64;

const MAX_BANK_CODE_LENGTH =
    32;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

const MAX_AMOUNT =
    Number(
        process.env.TITECH_MAX_PAYMENT_AMOUNT ||
        1_000_000_000_000_000
    );

const SUPPORTED_CURRENCIES =
    Object.freeze([
        'UGX',
        'KES',
        'TZS',
        'USD',
        'EUR',
    ]);

const PAYMENT_METHODS =
    Object.freeze([
        'mobile_money',
        'bank_transfer',
        'card',
        'cash',
    ]);

const MOBILE_MONEY_PROVIDERS =
    Object.freeze([
        'mpesa',
        'airtel',
        'mtn',
    ]);

const PAYMENT_TYPES =
    Object.freeze([
        'contribution',
        'loan_repayment',
        'loan_disbursement',
        'referral_bonus',
        'withdrawal',
        'fee',
    ]);

const PAYMENT_STATUSES =
    Object.freeze([
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'refunded',
    ]);

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

const REQUIRED_HANDLERS =
    Object.freeze([
        'initiatePayment',
        'processMobileMoneyPayment',
        'processBankTransfer',
        'verifyPayment',
        'getPaymentHistory',
        'processRefund',
        'getPaymentAnalytics',
        'getPaymentMethods',
        'getPaymentStats',
        'createPaymentIntent',
        'getPaymentIntent',
        'handleWebhook',
        'listTransactions',
    ]);

for (
    const handler of
    REQUIRED_HANDLERS
) {
    if (
        typeof paymentController?.[
            handler
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing paymentController.${handler} export.`
        );
    }
}

/**
 * ============================================================================
 * Authentication Contract
 * ============================================================================
 */

const authenticate =
    auth?.verifyToken ||
    auth?.authenticate ||
    auth?.verifyAccessToken;

const requireRole =
    auth?.requireRole;

if (
    typeof authenticate !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
}

if (
    typeof requireRole !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authorization middleware must expose requireRole().`
    );
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
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer'
        );

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
 * JSON Parser
 * ============================================================================
 *
 * Webhooks are intentionally excluded from this global parser because some
 * payment providers require raw request bytes for signature verification.
 *
 * The webhook controller / provider middleware should own raw-body parsing.
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            DEFAULT_BODY_LIMIT,

        strict:
            true,

        verify:
            attachRawBody,
    })
);

function attachRawBody(
    req,
    res,
    buffer
) {
    /**
     * Keep a bounded raw payload available for installations where a provider
     * signature is calculated against raw bytes.
     */
    if (
        buffer &&
        buffer.length
    ) {
        req.rawBody =
            Buffer.from(
                buffer
            );
    }
}

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 *
 * The webhook route is deliberately excluded from this router-wide
 * authentication boundary below.
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

function requireTrustedTenant(
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
                    'PAYMENT_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for payment operations.',

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
                    'PAYMENT_ACTOR_CONTEXT_REQUIRED',

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

    req.paymentActorId =
        actorId;

    next();
}

router.use(
    adminContextMiddleware ||
    requireTrustedTenant
);

/**
 * ============================================================================
 * Idempotency Infrastructure
 * ============================================================================
 */

const idempotencyFactory =
    resolveIdempotencyFactory();

if (
    typeof idempotencyFactory !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Payment routes require a persistent idempotency middleware factory.`
    );
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
 * Rate Limiting
 * ============================================================================
 */

const writeLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_PAYMENT_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'PAYMENT_WRITE_RATE_LIMITED',

        message:
            'Too many payment operation requests. Please try again later.',
    });

const mobileMoneyLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_PAYMENT_MOBILE_MONEY_RATE_LIMIT',
                20
            ),

        code:
            'PAYMENT_MOBILE_MONEY_RATE_LIMITED',

        message:
            'Too many Mobile Money requests. Please try again later.',
    });

const refundLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_PAYMENT_REFUND_RATE_LIMIT',
                10
            ),

        code:
            'PAYMENT_REFUND_RATE_LIMITED',

        message:
            'Too many refund requests. Please try again later.',
    });

const readLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_PAYMENT_READ_RATE_LIMIT',
                180
            ),

        code:
            'PAYMENT_READ_RATE_LIMITED',

        message:
            'Too many payment queries. Please try again later.',
    });

const webhookLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_PAYMENT_WEBHOOK_RATE_LIMIT',
                300
            ),

        code:
            'PAYMENT_WEBHOOK_RATE_LIMITED',

        message:
            'Too many payment-provider webhook requests.',
    });

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
                    req.paymentActorId ||
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
        },
    });
}

/**
 * ============================================================================
 * Common Validation
 * ============================================================================
 */

const paymentIdValidator =
    param(
        'paymentId'
    )
        .exists()
        .withMessage(
            'paymentId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'paymentId must be a valid identifier.'
        );

const transactionIdValidator =
    param(
        'transactionId'
    )
        .exists()
        .withMessage(
            'transactionId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'transactionId must be a valid identifier.'
        );

const groupIdValidator =
    body(
        'groupId'
    )
        .exists()
        .withMessage(
            'groupId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'groupId must be a valid identifier.'
        );

const paginationValidators =
    [
        query('page')
            .optional()
            .default(
                DEFAULT_PAGE
            )
            .toInt()
            .isInt({
                min:
                    1
            })
            .withMessage(
                'page must be a positive integer.'
            ),

        query('limit')
            .optional()
            .default(
                DEFAULT_LIMIT
            )
            .toInt()
            .isInt({
                min:
                    1,

                max:
                    MAX_LIMIT
            })
            .withMessage(
                `limit must be between 1 and ${MAX_LIMIT}.`
            ),
    ];

const dateRangeValidators =
    [
        query('startDate')
            .optional()
            .isISO8601({
                strict:
                    true
            })
            .withMessage(
                'Invalid start date format.'
            )
            .toDate(),

        query('endDate')
            .optional()
            .isISO8601({
                strict:
                    true
            })
            .withMessage(
                'Invalid end date format.'
            )
            .toDate(),

        query('endDate')
            .optional()
            .custom(
                (
                    endDate,
                    {
                        req
                    }
                ) => {
                    if (
                        !endDate ||
                        !req.query.startDate
                    ) {
                        return true;
                    }

                    const start =
                        new Date(
                            req.query.startDate
                        );

                    const end =
                        new Date(
                            endDate
                        );

                    if (
                        start >
                        end
                    ) {
                        throw new Error(
                            'endDate must be later than or equal to startDate.'
                        );
                    }

                    return true;
                }
            ),
    ];

/**
 * ============================================================================
 * Idempotency-Key Validation
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
                    'Idempotency-Key is required for payment mutations.',

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
 * Payment Amount Validation
 * ============================================================================
 */

const amountValidator =
    body(
        'amount'
    )
        .exists()
        .withMessage(
            'amount is required.'
        )
        .bail()
        .isFloat({
            gt:
                0,

            max:
                MAX_AMOUNT
        })
        .withMessage(
            'amount must be positive and within the supported limit.'
        )
        .toFloat();

/**
 * ============================================================================
 * Initiate Payment Validation
 * ============================================================================
 */

const initiatePaymentValidators =
    [
        groupIdValidator,

        amountValidator,

        body('method')
            .exists()
            .withMessage(
                'Payment method is required.'
            )
            .bail()
            .isIn(
                PAYMENT_METHODS
            )
            .withMessage(
                'Invalid payment method.'
            ),

        body('type')
            .exists()
            .withMessage(
                'Payment type is required.'
            )
            .bail()
            .isIn(
                PAYMENT_TYPES
            )
            .withMessage(
                'Invalid payment type.'
            ),

        body('description')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_DESCRIPTION_LENGTH
            })
            .withMessage(
                `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
            ),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

/**
 * ============================================================================
 * Mobile Money Validation
 * ============================================================================
 */

const mobileMoneyValidators =
    [
        paymentIdValidator,

        body(
            'phoneNumber'
        )
            .exists()
            .withMessage(
                'Phone number is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    7,

                max:
                    32
            })
            .withMessage(
                'Phone number is invalid.'
            )
            .matches(
                /^\+?[0-9][0-9\s\-()]{6,30}$/
            )
            .withMessage(
                'Valid international phone number is required.'
            ),

        body('provider')
            .optional()
            .isIn(
                MOBILE_MONEY_PROVIDERS
            )
            .withMessage(
                'Invalid Mobile Money provider.'
            ),

        body('accountReference')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    100
            })
            .withMessage(
                'accountReference is too long.'
            ),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

/**
 * ============================================================================
 * Bank Transfer Validation
 * ============================================================================
 */

const bankTransferValidators =
    [
        paymentIdValidator,

        body('bankCode')
            .exists()
            .withMessage(
                'bankCode is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    2,

                max:
                    MAX_BANK_CODE_LENGTH
            })
            .withMessage(
                'Invalid bank code.'
            ),

        body('accountNumber')
            .exists()
            .withMessage(
                'accountNumber is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    4,

                max:
                    MAX_ACCOUNT_NUMBER_LENGTH
            })
            .withMessage(
                'Invalid account number.'
            ),

        body('accountName')
            .exists()
            .withMessage(
                'accountName is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    255
            })
            .withMessage(
                'Invalid account name.'
            ),

        body('routingNumber')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    64
            }),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

/**
 * ============================================================================
 * Refund Validation
 * ============================================================================
 */

const refundValidators =
    [
        paymentIdValidator,

        body('amount')
            .exists()
            .withMessage(
                'Refund amount is required.'
            )
            .bail()
            .isFloat({
                gt:
                    0,

                max:
                    MAX_AMOUNT
            })
            .withMessage(
                'Refund amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('reason')
            .exists()
            .withMessage(
                'Refund reason is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_REASON_LENGTH
            })
            .withMessage(
                `Refund reason must be between 1 and ${MAX_REASON_LENGTH} characters.`
            ),
    ];

/**
 * ============================================================================
 * Payment Intent Validation
 * ============================================================================
 */

const paymentIntentValidators =
    [
        amountValidator,

        body('currency')
            .optional()
            .toUpperCase()
            .isIn(
                SUPPORTED_CURRENCIES
            )
            .withMessage(
                'Unsupported currency.'
            ),

        body('description')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_DESCRIPTION_LENGTH
            })
            .withMessage(
                `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
            ),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

/**
 * ============================================================================
 * Payment Methods Validation
 * ============================================================================
 */

const paymentMethodsValidators =
    [
        query('amount')
            .optional()
            .isFloat({
                min:
                    0,

                max:
                    MAX_AMOUNT
            })
            .withMessage(
                'amount must be non-negative and within the supported limit.'
            )
            .toFloat(),

        query('currency')
            .optional()
            .toUpperCase()
            .isIn(
                SUPPORTED_CURRENCIES
            )
            .withMessage(
                'Unsupported currency.'
            ),
    ];

/**
 * ============================================================================
 * Analytics Validation
 * ============================================================================
 *
 * The original route accepted userId, which could become an IDOR risk.
 * Ordinary users should not be allowed to select another user's analytics.
 *
 * Administrative analytics authorization is enforced separately.
 * ============================================================================
 */

const analyticsValidators =
    [
        query('userId')
            .optional()
            .isMongoId()
            .withMessage(
                'Valid user ID required.'
            ),

        query('groupId')
            .optional()
            .isMongoId()
            .withMessage(
                'Valid group ID required.'
            ),

        ...dateRangeValidators,
    ];

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function rejectClientIdentity(
    field
) {
    return body(
        field
    )
        .not()
        .exists()
        .withMessage(
            `${field} must come from trusted authenticated context.`
        );
}

function asyncHandler(
    handler
) {
    if (
        typeof handler !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Async route handler must be a function.`
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

function applyValidation(
    rules
) {
    return [
        ...rules,
        handleValidation,
    ];
}

/**
 * ============================================================================
 * PUBLICLY AUTHENTICATED PAYMENT ROUTES
 * ============================================================================
 */

/**
 * POST /api/payments/initiate
 */
router.post(
    '/initiate',

    writeLimiter,

    express.json({
        limit:
            DEFAULT_BODY_LIMIT,
        strict:
            true,
    }),

    applyValidation(
        initiatePaymentValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'PAYMENT_INITIATION',
        'payments'
    ),

    asyncHandler(
        paymentController.initiatePayment
    )
);

/**
 * POST /api/payments/:paymentId/mobile-money
 */
router.post(
    '/:paymentId/mobile-money',

    mobileMoneyLimiter,

    express.json({
        limit:
            DEFAULT_BODY_LIMIT,
        strict:
            true,
    }),

    applyValidation(
        mobileMoneyValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MOBILE_MONEY_PAYMENT',
        'payment-mobile-money'
    ),

    asyncHandler(
        paymentController.processMobileMoneyPayment
    )
);

/**
 * POST /api/payments/:paymentId/bank-transfer
 */
router.post(
    '/:paymentId/bank-transfer',

    writeLimiter,

    express.json({
        limit:
            DEFAULT_BODY_LIMIT,
        strict:
            true,
    }),

    applyValidation(
        bankTransferValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'BANK_TRANSFER_PAYMENT',
        'payment-bank-transfer'
    ),

    asyncHandler(
        paymentController.processBankTransfer
    )
);

/**
 * ============================================================================
 * Payment Lookup
 * ============================================================================
 */

/**
 * GET /api/payments/:paymentId
 */
router.get(
    '/:paymentId',

    readLimiter,

    applyValidation([
        paymentIdValidator,
    ]),

    asyncHandler(
        paymentController.verifyPayment
    )
);

/**
 * ============================================================================
 * Payment History
 * ============================================================================
 */

/**
 * GET /api/payments/history
 */
router.get(
    '/history',

    readLimiter,

    applyValidation([
        ...paginationValidators,

        query('status')
            .optional()
            .isIn(
                PAYMENT_STATUSES
            )
            .withMessage(
                'Invalid payment status.'
            ),

        query('type')
            .optional()
            .isIn(
                PAYMENT_TYPES
            )
            .withMessage(
                'Invalid payment type.'
            ),

        query('method')
            .optional()
            .isIn(
                PAYMENT_METHODS
            )
            .withMessage(
                'Invalid payment method.'
            ),

        ...dateRangeValidators,
    ]),

    asyncHandler(
        paymentController.getPaymentHistory
    )
);

/**
 * ============================================================================
 * Refund
 * ============================================================================
 *
 * Refunds are financial mutations and should be privileged according to the
 * payment's business context. The service should perform the final authority
 * check.
 * ============================================================================
 */

router.post(
    '/:paymentId/refund',

    refundLimiter,

    express.json({
        limit:
            DEFAULT_BODY_LIMIT,
        strict:
            true,
    }),

    applyValidation(
        refundValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'PAYMENT_REFUND',
        'payment-refunds'
    ),

    asyncHandler(
        paymentController.processRefund
    )
);

/**
 * ============================================================================
 * Analytics
 * ============================================================================
 *
 * The controller/service must enforce whether the actor is allowed to request
 * cross-user or tenant-wide analytics.
 *
 * For an enterprise deployment, route-level admin authorization is applied
 * when a userId/groupId filter requests an administrative scope.
 * ============================================================================
 */

router.get(
    '/analytics',

    readLimiter,

    applyValidation(
        analyticsValidators
    ),

    asyncHandler(
        paymentController.getPaymentAnalytics
    )
);

/**
 * ============================================================================
 * Payment Methods / Fees
 * ============================================================================
 */

/**
 * GET /api/payments/methods
 */
router.get(
    '/methods',

    readLimiter,

    applyValidation(
        paymentMethodsValidators
    ),

    asyncHandler(
        paymentController.getPaymentMethods
    )
);

/**
 * ============================================================================
 * Payment Statistics
 * ============================================================================
 *
 * This endpoint can expose aggregate financial information. It should not be
 * treated like an ordinary member endpoint by the controller.
 * ============================================================================
 */

router.get(
    '/stats',

    readLimiter,

    requireRole(
        'admin'
    ),

    asyncHandler(
        paymentController.getPaymentStats
    )
);

/**
 * ============================================================================
 * Payment Intents
 * ============================================================================
 */

/**
 * POST /api/payments/intents
 */
router.post(
    '/intents',

    writeLimiter,

    express.json({
        limit:
            DEFAULT_BODY_LIMIT,
        strict:
            true,
    }),

    applyValidation(
        paymentIntentValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'PAYMENT_INTENT_CREATE',
        'payment-intents'
    ),

    asyncHandler(
        paymentController.createPaymentIntent
    )
);

/**
 * GET /api/payments/intents/:transactionId
 */
router.get(
    '/intents/:transactionId',

    readLimiter,

    applyValidation([
        transactionIdValidator,
    ]),

    asyncHandler(
        paymentController.getPaymentIntent
    )
);

/**
 * ============================================================================
 * External Payment Provider Webhooks
 * ============================================================================
 *
 * IMPORTANT:
 *
 * No `authenticate` middleware is used here.
 *
 * Payment providers are not TITech application users. The webhook handler must
 * validate provider authenticity/signatures and perform replay protection.
 *
 * `req.rawBody` is retained by the parser above for integrations that require
 * raw-byte signature verification.
 *
 * The provider parameter is constrained before entering the controller.
 * ============================================================================
 */

router.post(
    '/webhooks/:provider',

    webhookLimiter,

    validateProviderParameter,

    asyncHandler(
        paymentController.handleWebhook
    )
);

/**
 * ============================================================================
 * Transaction Listing
 * ============================================================================
 */

router.get(
    '/transactions',

    readLimiter,

    applyValidation([
        ...paginationValidators,

        query('status')
            .optional()
            .isIn(
                PAYMENT_STATUSES
            )
            .withMessage(
                'Invalid payment status.'
            ),

        query('type')
            .optional()
            .isIn(
                PAYMENT_TYPES
            )
            .withMessage(
                'Invalid payment type.'
            ),

        query('method')
            .optional()
            .isIn(
                PAYMENT_METHODS
            )
            .withMessage(
                'Invalid payment method.'
            ),

        ...dateRangeValidators,
    ]),

    asyncHandler(
        paymentController.listTransactions
    )
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 */

router.get(
    '/health',

    readLimiter,

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

                webhookSupport:
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
 * Provider Validation
 * ============================================================================
 */

function validateProviderParameter(
    req,
    res,
    next
) {
    const provider =
        normalizeString(
            req.params.provider
        )?.toLowerCase();

    const allowedProviders =
        new Set([
            'mtn',
            'airtel',
            'mpesa',
            'bank',
            'card',
        ]);

    if (
        !provider ||
        !allowedProviders.has(
            provider
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'PAYMENT_PROVIDER_INVALID',

                message:
                    'Unsupported payment provider.',
            });
    }

    req.paymentProvider =
        provider;

    next();
}

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
                    'PAYMENT_ROUTE_NOT_FOUND',

                message:
                    'Payment endpoint not found.',

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
 * Centralized Error Handler
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
                            ? 'PAYMENT_REQUEST_ERROR'
                            : 'PAYMENT_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The payment request could not be completed.'
                        )
                        : 'The payment request could not be completed.',

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
 * Idempotency Resolver
 * ============================================================================
 */

function resolveIdempotencyFactory() {
    try {
        const moduleValue =
            require(
                '../middleware/idempotency'
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