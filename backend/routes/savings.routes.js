'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Savings Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/savings.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP routing boundary for TITech Community Capital savings
 * operations.
 *
 * Route groups
 * ----------------------------------------------------------------------------
 *
 * Health / metadata:
 *
 *   GET  /health
 *   GET  /diagnostics
 *
 * Account management:
 *
 *   POST /
 *   GET  /accounts
 *   GET  /:accountId
 *
 * Financial mutations:
 *
 *   POST /deposit
 *   POST /withdraw
 *
 * Member statements:
 *
 *   GET /member/:memberId/balance
 *   GET /member/:memberId/mini-statement
 *   GET /member/:memberId/statement
 *   GET /member/:memberId/summary
 *
 * Interest:
 *
 *   GET /:accountId/interest
 *
 * Lifecycle:
 *
 *   POST /:accountId/activate
 *   POST /:accountId/close
 *
 * Administrative reporting:
 *
 *   GET /reports/portfolio
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
 *   Authentication
 *        ↓
 *   Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency for Financial Mutations
 *        ↓
 *   Authorization / Service Boundary
 *        ↓
 *   Savings Controller
 *        ↓
 *   Savings Service
 *        ↓
 *   Ledger / Wallet / Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ mutate balances directly
 *   ✗ write ledger entries directly
 *   ✗ calculate financial interest directly
 *   ✗ trust client-supplied tenantId
 *   ✗ trust client-supplied userId/memberId as authority
 *   ✗ expose another member's savings information
 *   ✗ expose internal diagnostics to ordinary users
 *
 * Business rules belong to the controller/service/domain layers.
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

const savingsController =
    require('../controllers/savingsController');

const tenantMiddleware =
    require('../middleware/tenantMiddleware');

const logger =
    require('../utils/logger');

const metricsService =
    require('../services/metricsService');

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
    'TITechSavingsRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Savings Service';

const API_VERSION =
    'v1';

const MAX_PAGE =
    1_000_000;

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    50;

const MAX_LIMIT =
    200;

const MAX_AMOUNT =
    Number(
        process.env.TITECH_SAVINGS_MAX_AMOUNT ||
        1_000_000_000_000_000
    );

const MAX_NOTE_LENGTH =
    1000;

const MAX_REASON_LENGTH =
    1000;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * Controller Contract Validation
 * ============================================================================
 */

const REQUIRED_HANDLERS =
    Object.freeze([
        'createSavingsAccount',
        'listAccounts',
        'getSavingsAccount',
        'deposit',
        'withdraw',
        'getBalance',
        'miniStatement',
        'statement',
        'summary',
        'calculateInterest',
        'activateAccount',
        'closeAccount',
        'portfolioReport',
    ]);

for (
    const handlerName
    of REQUIRED_HANDLERS
) {
    if (
        typeof savingsController?.[
            handlerName
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing savingsController.${handlerName} export.`
        );
    }
}

/**
 * ============================================================================
 * Middleware Contract Validation
 * ============================================================================
 */

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
 * Optional Authentication Resolution
 * ============================================================================
 *
 * Tenant middleware must NOT be treated as a replacement for authentication.
 * ============================================================================
 */

const authenticate =
    resolveAuthenticationMiddleware();

if (
    typeof authenticate !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Savings routes require authentication middleware.`
    );
}

/**
 * ============================================================================
 * Optional Authorization
 * ============================================================================
 */

const requireRole =
    resolveRoleMiddleware();

/**
 * ============================================================================
 * Optional Idempotency
 * ============================================================================
 */

const idempotencyFactory =
    resolveIdempotencyFactory();

if (
    typeof idempotencyFactory !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Savings financial mutations require a persistent idempotency middleware factory.`
    );
}

/**
 * ============================================================================
 * Request / Correlation Metadata
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

        if (
            req.method ===
            'GET'
        ) {
            res.setHeader(
                'Cache-Control',
                'no-store'
            );
        } else {
            res.setHeader(
                'Cache-Control',
                'no-store'
            );

            res.setHeader(
                'Pragma',
                'no-cache'
            );
        }

        next();
    }
);

/**
 * ============================================================================
 * JSON Body Parser
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            process.env.TITECH_SAVINGS_BODY_LIMIT ||
            '256kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Route Metrics
 * ============================================================================
 *
 * Metrics failures are deliberately isolated from request processing.
 * ============================================================================
 */

function routeMetricsMiddleware(
    req,
    res,
    next
) {
    const startedAt =
        Date.now();

    res.once(
        'finish',
        () => {
            const duration =
                Date.now() -
                startedAt;

            try {
                if (
                    typeof metricsService?.increment ===
                    'function'
                ) {
                    metricsService.increment(
                        'titech.savings.route.requests'
                    );
                }

                if (
                    typeof metricsService?.timing ===
                    'function'
                ) {
                    metricsService.timing(
                        'titech.savings.route.duration',
                        duration
                    );
                }

                if (
                    typeof metricsService?.increment ===
                    'function'
                ) {
                    metricsService.increment(
                        `titech.savings.route.status.${res.statusCode}`
                    );
                }
            } catch (
                error
            ) {
                safeLogWarn(
                    'Savings metrics failed',
                    {
                        error:
                            error?.message,

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    }
                );
            }
        }
    );

    next();
}

router.use(
    routeMetricsMiddleware
);

/**
 * ============================================================================
 * Public Health
 * ============================================================================
 *
 * Health endpoints are intentionally registered BEFORE authentication and
 * tenant middleware.
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

                apiVersion:
                    API_VERSION,

                status:
                    'healthy',

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
 * Authentication / Tenant Boundary
 * ============================================================================
 */

router.use(
    authenticate
);

router.use(
    tenantMiddleware
);

/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 *
 * Diagnostics should be restricted to privileged operators.
 *
 * If the project's requireRole middleware is unavailable, the endpoint is not
 * exposed rather than becoming an accidental information disclosure endpoint.
 * ============================================================================
 */

if (
    typeof requireRole ===
    'function'
) {
    router.get(
        '/diagnostics',

        requireRole(
            'ADMIN'
        ),

        asyncHandler(
            async (
                req,
                res
            ) => {
                const diagnostics =
                    typeof savingsController
                        .getDiagnostics ===
                    'function'
                        ? await Promise.resolve(
                            savingsController.getDiagnostics(
                                req,
                                res
                            )
                        )
                        : {};

                return res
                    .status(200)
                    .json({
                        success:
                            true,

                        service:
                            SERVICE_NAME,

                        version:
                            ROUTER_VERSION,

                        diagnostics:
                            sanitizeDiagnostics(
                                diagnostics
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
}

/**
 * ============================================================================
 * Rate Limiters
 * ============================================================================
 */

const savingsReadLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_SAVINGS_READ_RATE_LIMIT',
                180
            ),

        code:
            'SAVINGS_READ_RATE_LIMITED',

        message:
            'Too many savings queries. Please try again later.',
    });

const savingsWriteLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_SAVINGS_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'SAVINGS_WRITE_RATE_LIMITED',

        message:
            'Too many savings operation requests. Please try again later.',
    });

const savingsFinancialLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_SAVINGS_FINANCIAL_RATE_LIMIT',
                20
            ),

        code:
            'SAVINGS_FINANCIAL_RATE_LIMITED',

        message:
            'Too many savings financial requests. Please try again later.',
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
 * Validation
 * ============================================================================
 */

const accountIdValidator =
    param('accountId')
        .exists()
        .withMessage(
            'accountId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'accountId must be a valid identifier.'
        );

const memberIdValidator =
    param('memberId')
        .exists()
        .withMessage(
            'memberId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'memberId must be a valid identifier.'
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
                    1,

                max:
                    MAX_PAGE,
            })
            .withMessage(
                'page must be a valid positive integer.'
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
                    MAX_LIMIT,
            })
            .withMessage(
                `limit must be between 1 and ${MAX_LIMIT}.`
            ),
    ];

const createAccountValidators =
    [
        body('groupId')
            .optional()
            .isMongoId()
            .withMessage(
                'groupId must be a valid identifier.'
            ),

        body('memberId')
            .optional()
            .isMongoId()
            .withMessage(
                'memberId must be a valid identifier.'
            ),

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
                'currency must be a valid three-letter code.'
            )
            .toUpperCase(),

        body('initialDeposit')
            .optional()
            .isFloat({
                min:
                    0,

                max:
                    MAX_AMOUNT,
            })
            .withMessage(
                'initialDeposit must be non-negative and within the supported limit.'
            )
            .toFloat(),

        body('accountType')
            .optional()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    100,
            })
            .withMessage(
                'accountType is invalid.'
            ),

        rejectClientIdentity(
            'tenantId'
        ),
    ];

const depositValidators =
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
                'Deposit amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('note')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NOTE_LENGTH,
            })
            .withMessage(
                `note cannot exceed ${MAX_NOTE_LENGTH} characters.`
            ),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

const withdrawValidators =
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
                'Withdrawal amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('note')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NOTE_LENGTH,
            })
            .withMessage(
                `note cannot exceed ${MAX_NOTE_LENGTH} characters.`
            ),

        body('reason')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_REASON_LENGTH,
            })
            .withMessage(
                `reason cannot exceed ${MAX_REASON_LENGTH} characters.`
            ),

        rejectClientIdentity(
            'tenantId'
        ),

        rejectClientIdentity(
            'userId'
        ),
    ];

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
                    'Idempotency-Key is required for savings financial mutations.',

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
 * Authorization Helpers
 * ============================================================================
 */

function requirePrivilegedSavingsRole(
    req,
    res,
    next
) {
    if (
        typeof requireRole !==
        'function'
    ) {
        return res
            .status(503)
            .json({
                success:
                    false,

                code:
                    'SAVINGS_AUTHORIZATION_UNAVAILABLE',

                message:
                    'Savings authorization infrastructure is unavailable.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    return requireRole(
        'ADMIN'
    )(
        req,
        res,
        next
    );
}

/**
 * ============================================================================
 * Account Management
 * ============================================================================
 *
 * IMPORTANT:
 * The generic account GET route is placed AFTER the explicit reporting and
 * member routes so Express cannot accidentally interpret "reports" as an
 * accountId.
 * ============================================================================
 */

/**
 * POST /api/savings
 */
router.post(
    '/',

    savingsWriteLimiter,

    validationChain(
        createAccountValidators
    ),

    asyncHandler(
        savingsController
            .createSavingsAccount
            .bind(
                savingsController
            )
    )
);

/**
 * GET /api/savings/accounts
 */
router.get(
    '/accounts',

    savingsReadLimiter,

    validationChain(
        paginationValidators
    ),

    asyncHandler(
        savingsController
            .listAccounts
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Financial Transactions
 * ============================================================================
 */

/**
 * POST /api/savings/deposit
 */
router.post(
    '/deposit',

    savingsFinancialLimiter,

    validationChain(
        depositValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'SAVINGS_DEPOSIT',
        'savings-deposits'
    ),

    asyncHandler(
        savingsController
            .deposit
            .bind(
                savingsController
            )
    )
);

/**
 * POST /api/savings/withdraw
 */
router.post(
    '/withdraw',

    savingsFinancialLimiter,

    validationChain(
        withdrawValidators
    ),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'SAVINGS_WITHDRAWAL',
        'savings-withdrawals'
    ),

    asyncHandler(
        savingsController
            .withdraw
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Member Statements / Balances
 * ============================================================================
 *
 * The route accepts memberId for compatibility, but the controller/service
 * MUST enforce object-level authorization.
 *
 * A member must not be able to query another tenant/member by changing this
 * parameter.
 * ============================================================================
 */

router.get(
    '/member/:memberId/balance',

    savingsReadLimiter,

    validationChain([
        memberIdValidator,
    ]),

    asyncHandler(
        savingsController
            .getBalance
            .bind(
                savingsController
            )
    )
);

router.get(
    '/member/:memberId/mini-statement',

    savingsReadLimiter,

    validationChain([
        memberIdValidator,
        ...paginationValidators,
    ]),

    asyncHandler(
        savingsController
            .miniStatement
            .bind(
                savingsController
            )
    )
);

router.get(
    '/member/:memberId/statement',

    savingsReadLimiter,

    validationChain([
        memberIdValidator,
        ...paginationValidators,
    ]),

    asyncHandler(
        savingsController
            .statement
            .bind(
                savingsController
            )
    )
);

router.get(
    '/member/:memberId/summary',

    savingsReadLimiter,

    validationChain([
        memberIdValidator,
    ]),

    asyncHandler(
        savingsController
            .summary
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Administrative Reporting
 * ============================================================================
 *
 * Explicitly registered BEFORE /:accountId.
 * ============================================================================
 */

router.get(
    '/reports/portfolio',

    savingsReadLimiter,

    requirePrivilegedSavingsRole,

    asyncHandler(
        savingsController
            .portfolioReport
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Account Lifecycle
 * ============================================================================
 */

/**
 * POST /api/savings/:accountId/activate
 */
router.post(
    '/:accountId/activate',

    savingsWriteLimiter,

    validationChain([
        accountIdValidator,

        rejectClientIdentity(
            'tenantId'
        ),
    ]),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'SAVINGS_ACCOUNT_ACTIVATE',
        'savings-account-lifecycle'
    ),

    asyncHandler(
        savingsController
            .activateAccount
            .bind(
                savingsController
            )
    )
);

/**
 * POST /api/savings/:accountId/close
 */
router.post(
    '/:accountId/close',

    savingsFinancialLimiter,

    validationChain([
        accountIdValidator,

        body('reason')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_REASON_LENGTH,
            })
            .withMessage(
                `reason cannot exceed ${MAX_REASON_LENGTH} characters.`
            ),

        rejectClientIdentity(
            'tenantId'
        ),
    ]),

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'SAVINGS_ACCOUNT_CLOSE',
        'savings-account-lifecycle'
    ),

    asyncHandler(
        savingsController
            .closeAccount
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Interest
 * ============================================================================
 */

router.get(
    '/:accountId/interest',

    savingsReadLimiter,

    validationChain([
        accountIdValidator,
    ]),

    asyncHandler(
        savingsController
            .calculateInterest
            .bind(
                savingsController
            )
    )
);

/**
 * ============================================================================
 * Generic Savings Account Lookup
 * ============================================================================
 *
 * MUST remain after all explicit static paths.
 * ============================================================================
 */

router.get(
    '/:accountId',

    savingsReadLimiter,

    validationChain([
        accountIdValidator,
    ]),

    asyncHandler(
        savingsController
            .getSavingsAccount
            .bind(
                savingsController
            )
    )
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
                    'SAVINGS_ROUTE_NOT_FOUND',

                message:
                    'Savings endpoint not found.',

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
 * Route Error Handler
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

        safeLogError(
            'Savings route error',
            {
                tenantId:
                    req.tenantId,

                userId:
                    req.user?.id ||
                    req.user?._id ||
                    req.user?.userId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                code:
                    error?.code,

                statusCode,

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
                            ? 'SAVINGS_REQUEST_ERROR'
                            : 'SAVINGS_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The savings request could not be completed.'
                        )
                        : 'The savings request could not be completed.',

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
 * Route Auto Loader Contract
 * ============================================================================
 */

module.exports =
    {
        version:
            API_VERSION,

        path:
            '/savings',

        router,

        metadata:
            {
                name:
                    'TITech Enterprise Savings Service',

                category:
                    'savings',

                service:
                    SERVICE_NAME,

                version:
                    ROUTER_VERSION,

                supports:
                    [
                        'savings_accounts',
                        'deposits',
                        'withdrawals',
                        'balances',
                        'mini_statements',
                        'statements',
                        'interest',
                        'portfolio_reporting',
                        'tenant_isolation',
                        'idempotent_financial_mutations',
                    ],
            },
    };

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

function resolveAuthenticationMiddleware() {
    const candidates =
        [
            '../middleware/auth',
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

function resolveRoleMiddleware() {
    const candidates =
        [
            '../middleware/auth',
            '../middleware/authorize',
            '../middleware/authorization',
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
                typeof loaded?.requireRole ===
                'function'
            ) {
                return loaded.requireRole;
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

function safeLogWarn(
    message,
    metadata
) {
    try {
        if (
            typeof logger?.warn ===
            'function'
        ) {
            logger.warn(
                message,
                metadata
            );
        }
    } catch {
        // Logging must never affect the request.
    }
}

function safeLogError(
    message,
    metadata
) {
    try {
        if (
            typeof logger?.error ===
            'function'
        ) {
            logger.error(
                message,
                metadata
            );
        }
    } catch {
        // Logging must never affect the request.
    }
}

function sanitizeDiagnostics(
    diagnostics
) {
    if (
        !diagnostics ||
        typeof diagnostics !==
        'object'
    ) {
        return {};
    }

    /**
     * Do not expose secrets, credentials, connection strings, stack traces,
     * environment variables or unrestricted internal state.
     *
     * Controller-specific diagnostics should ideally already be safe, but
     * this shallow sanitization prevents common accidental disclosures.
     */
    const result =
        {};

    for (
        const [
            key,
            value,
        ]
        of Object.entries(
            diagnostics
        )
    ) {
        const normalizedKey =
            String(
                key
            ).toLowerCase();

        if (
            normalizedKey.includes(
                'password'
            ) ||
            normalizedKey.includes(
                'secret'
            ) ||
            normalizedKey.includes(
                'token'
            ) ||
            normalizedKey.includes(
                'apikey'
            ) ||
            normalizedKey.includes(
                'api_key'
            ) ||
            normalizedKey.includes(
                'connection'
            ) ||
            normalizedKey.includes(
                'credential'
            )
        ) {
            continue;
        }

        result[key] =
            value;
    }

    return result;
}