'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Financial Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/financial.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Defines the HTTP boundary for balance-affecting financial operations.
 *
 * Security / correctness chain
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        │
 *        ▼
 *   Request Metadata
 *        │
 *        ▼
 *   Authentication
 *        │
 *        ▼
 *   Tenant Authorization
 *        │
 *        ▼
 *   Rate Limiting
 *        │
 *        ▼
 *   Idempotency
 *        │
 *        ▼
 *   Controller
 *        │
 *        ▼
 *   Financial Transaction Service
 *        │
 *        ├── Financial Transaction
 *        ├── Ledger Entries
 *        ├── Balance Mutation
 *        └── Idempotency Completion
 *        │
 *        ▼
 *      COMMIT
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router deliberately does NOT:
 *
 *   - mutate balances
 *   - write ledger entries
 *   - create financial transactions directly
 *   - manage MongoDB sessions directly
 *   - implement idempotency persistence
 *   - perform accounting calculations
 *   - authorize tenants using client-supplied tenant IDs
 *
 * Those responsibilities belong to the controller/service/repository/domain
 * layers.
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

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false
    });

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechFinancialRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Financial API';

const API_VERSION =
    '1';

const MAX_BODY_SIZE =
    process.env.TITECH_FINANCIAL_BODY_LIMIT ||
    '1mb';

const MAX_ROUTE_ID_LENGTH =
    200;

/**
 * ============================================================================
 * REQUEST / CORRELATION METADATA
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

    return normalized || fallback;
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
 * SECURITY HEADERS
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
 * BODY PARSER
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            MAX_BODY_SIZE,

        strict:
            true
    })
);

/**
 * ============================================================================
 * IDEMPOTENCY MIDDLEWARE
 * ============================================================================
 *
 * The project may export:
 *
 *   module.exports.idempotency
 *
 * or:
 *
 *   module.exports = idempotency
 *
 * The route supports both contracts but fails closed if neither is available.
 * ============================================================================
 */

const idempotencyModule =
    require(
        '../middleware/idempotency'
    );

const idempotencyFactory =
    resolveRequiredMiddlewareExport(
        idempotencyModule,
        [
            'idempotency'
        ],
        'idempotency'
    );

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

const authenticate =
    resolveMiddleware(
        [
            '../middleware/authentication',
            '../middleware/auth',
            '../middleware/authenticate'
        ],
        'authenticate'
    );

/**
 * ============================================================================
 * TENANT AUTHORIZATION
 * ============================================================================
 */

const tenantAuthorization =
    resolveMiddleware(
        [
            '../middleware/tenantAuthorization',
            '../middleware/tenant.authorization',
            '../middleware/tenant'
        ],
        'tenantAuthorization'
    );

/**
 * ============================================================================
 * FINANCIAL CONTROLLER
 * ============================================================================
 */

const financialController =
    require(
        '../controllers/financial/financial.controller'
    );

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'createTransaction',
        'createContribution',
        'createDeposit',
        'createWithdrawal',
        'createTransfer',
        'disburseLoan',
        'repayLoan',
        'getWallet',
        'getTransaction',
        'getTransactionLedger'
    ]);

for (
    const handler
    of REQUIRED_CONTROLLERS
) {
    if (
        typeof financialController?.[
            handler
        ] !== 'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing financialController.${handler} export.`
        );
    }
}

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 *
 * Financial writes are intentionally stricter than reads.
 *
 * Idempotency protects replay/duplicate execution, while rate limiting protects
 * the HTTP boundary from abuse and resource exhaustion.
 * ============================================================================
 */

const financialWriteLimiter =
    createFinancialLimiter({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FINANCIAL_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'FINANCIAL_WRITE_RATE_LIMITED',

        message:
            'Too many financial operation requests. Please try again later.'
    });

const financialReadLimiter =
    createFinancialLimiter({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_FINANCIAL_READ_RATE_LIMIT',
                180
            ),

        code:
            'FINANCIAL_READ_RATE_LIMITED',

        message:
            'Too many financial queries. Please try again later.'
    });

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const value =
        Number(
            process.env[name]
        );

    return (
        Number.isInteger(value) &&
        value > 0
    )
        ? value
        : fallback;
}

function getRateLimitKey(
    req
) {
    return (
        normalizeString(
            req.user?.id ||
                req.user?._id ||
                req.user?.userId ||
                req.auth?.userId ||
                req.adminContext?.actorId
        ) ||
        normalizeString(
            req.ip
        ) ||
        normalizeString(
            req.socket?.remoteAddress
        ) ||
        'unknown'
    );
}

function createFinancialLimiter({
    windowMs,
    max,
    code,
    message
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
            return getRateLimitKey(
                req
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
                        new Date().toISOString()
                });
        }
    });
}

/**
 * ============================================================================
 * COMMON PARAMETER VALIDATION
 * ============================================================================
 */

function validateRouteParameter(
    parameterName
) {
    return (
        req,
        res,
        next
    ) => {
        const value =
            normalizeString(
                req.params?.[
                    parameterName
                ]
            );

        if (!value) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FINANCIAL_ROUTE_PARAMETER_REQUIRED',

                    message:
                        `${parameterName} is required.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        if (
            value.length >
            MAX_ROUTE_ID_LENGTH
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FINANCIAL_ROUTE_PARAMETER_TOO_LONG',

                    message:
                        `${parameterName} exceeds the maximum supported length.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        if (
            /[\u0000-\u001F\u007F]/.test(
                value
            )
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'FINANCIAL_ROUTE_PARAMETER_INVALID',

                    message:
                        `${parameterName} contains unsupported characters.`,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId
                });
        }

        req.validatedParams = {
            ...(
                req.validatedParams ||
                {}
            ),

            [parameterName]:
                value
        };

        next();
    };
}

/**
 * ============================================================================
 * IDEMPOTENCY HEADER VALIDATION
 * ============================================================================
 *
 * The middleware itself should persist and verify the key. This validator
 * ensures the request contains a sane key before entering the financial
 * transaction boundary.
 * ============================================================================
 */

function validateIdempotencyHeader(
    req,
    res,
    next
) {
    const headerName =
        'idempotency-key';

    const key =
        normalizeString(
            req.headers?.[
                headerName
            ]
        );

    if (!key) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'IDEMPOTENCY_KEY_REQUIRED',

                message:
                    'Idempotency-Key header is required for financial mutations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
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
                    req.correlationId
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
                    req.correlationId
            });
    }

    req.idempotencyKey =
        key;

    next();
}

/**
 * ============================================================================
 * JSON BODY VALIDATION
 * ============================================================================
 */

function requireObjectBody(
    req,
    res,
    next
) {
    if (
        !req.body ||
        typeof req.body !== 'object' ||
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
                    'INVALID_FINANCIAL_REQUEST_BODY',

                message:
                    'A JSON object request body is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            });
    }

    next();
}

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT
 * ============================================================================
 *
 * Tenant authorization middleware remains authoritative. This fallback does
 * not create authorization; it only verifies that the middleware populated a
 * trusted tenant context.
 * ============================================================================
 */

function requireTenantContext(
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

    if (!tenantId) {
        return res
            .status(403)
            .json({
                success:
                    false,

                code:
                    'TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for financial operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            });
    }

    /**
     * Keep the trusted tenant reference available downstream.
     *
     * Never copy tenantId from req.body/query into this field.
     */
    req.tenantId =
        tenantId;

    next();
}

/**
 * ============================================================================
 * AUTHENTICATION / TENANT CHAIN
 * ============================================================================
 */

router.use(
    authenticate
);

router.use(
    tenantAuthorization
);

router.use(
    requireTenantContext
);

/**
 * ============================================================================
 * FINANCIAL MUTATIONS
 * ============================================================================
 */

/**
 * POST /transactions
 */
router.post(
    '/transactions',

    financialWriteLimiter,

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'FINANCIAL_TRANSACTION',

        resource:
            'financial-transactions'
    }),

    financialController.createTransaction
);

/**
 * POST /contributions
 */
router.post(
    '/contributions',

    financialWriteLimiter,

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'CONTRIBUTION_CREATE',

        resource:
            'contributions'
    }),

    financialController.createContribution
);

/**
 * POST /deposits
 */
router.post(
    '/deposits',

    financialWriteLimiter,

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'DEPOSIT_CREATE',

        resource:
            'deposits'
    }),

    financialController.createDeposit
);

/**
 * POST /withdrawals
 */
router.post(
    '/withdrawals',

    financialWriteLimiter,

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'WITHDRAWAL_CREATE',

        resource:
            'withdrawals'
    }),

    financialController.createWithdrawal
);

/**
 * POST /transfers
 */
router.post(
    '/transfers',

    financialWriteLimiter,

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'TRANSFER_CREATE',

        resource:
            'transfers'
    }),

    financialController.createTransfer
);

/**
 * POST /loans/:loanId/disbursement
 */
router.post(
    '/loans/:loanId/disbursement',

    financialWriteLimiter,

    validateRouteParameter(
        'loanId'
    ),

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'LOAN_DISBURSEMENT',

        resource:
            'loan-disbursement'
    }),

    financialController.disburseLoan
);

/**
 * POST /loans/:loanId/repayment
 */
router.post(
    '/loans/:loanId/repayment',

    financialWriteLimiter,

    validateRouteParameter(
        'loanId'
    ),

    requireObjectBody,

    validateIdempotencyHeader,

    createIdempotencyMiddleware({
        operation:
            'LOAN_REPAYMENT',

        resource:
            'loan-repayment'
    }),

    financialController.repayLoan
);

/**
 * ============================================================================
 * FINANCIAL READS
 * ============================================================================
 */

/**
 * GET /wallet/:walletId
 */
router.get(
    '/wallet/:walletId',

    financialReadLimiter,

    validateRouteParameter(
        'walletId'
    ),

    financialController.getWallet
);

/**
 * GET /transactions/:transactionId
 */
router.get(
    '/transactions/:transactionId',

    financialReadLimiter,

    validateRouteParameter(
        'transactionId'
    ),

    financialController.getTransaction
);

/**
 * GET /transactions/:transactionId/ledger
 */
router.get(
    '/transactions/:transactionId/ledger',

    financialReadLimiter,

    validateRouteParameter(
        'transactionId'
    ),

    financialController.getTransactionLedger
);

/**
 * ============================================================================
 * ROUTER METADATA / HEALTH
 * ============================================================================
 *
 * Deliberately does not expose:
 *
 *   - database implementation
 *   - MongoDB session details
 *   - internal repository names
 *   - secrets
 *   - infrastructure topology
 * ============================================================================
 */

router.get(
    '/_meta',
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
                    API_VERSION,

                routerVersion:
                    ROUTER_VERSION,

                idempotency:
                    'required-for-financial-mutations',

                tenantScoped:
                    true,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString()
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
                    'FINANCIAL_ROUTE_NOT_FOUND',

                message:
                    'Financial endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString()
            });
    }
);

/**
 * ============================================================================
 * CENTRALIZED ERROR HANDLER
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
                        ? 'FINANCIAL_REQUEST_ERROR'
                        : 'FINANCIAL_INTERNAL_ERROR'
                ),

            message:
                clientError
                    ? (
                        error?.message ||
                        'The financial request could not be completed.'
                    )
                    : 'The financial request could not be completed.',

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            timestamp:
                new Date().toISOString()
        };

        /**
         * Only expose controlled details for client errors.
         *
         * Never expose:
         * - database errors
         * - stack traces
         * - connection strings
         * - internal filesystem paths
         */
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
 * IDEMPOTENCY FACTORY
 * ============================================================================
 */

function createIdempotencyMiddleware({
    operation,
    resource
}) {
    if (
        typeof idempotencyFactory !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] idempotency middleware must expose a callable factory.`
        );
    }

    const middleware =
        idempotencyFactory({
            operation,

            resource,

            required:
                true
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
 * SECURITY MIDDLEWARE RESOLVER
 * ============================================================================
 *
 * Supported module shapes:
 *
 *   module.exports = function middleware() {}
 *
 *   module.exports = {
 *       authenticate
 *   }
 *
 *   module.exports = {
 *       tenantAuthorization
 *   }
 *
 * Security middleware is always fail-closed.
 * ============================================================================
 */

function resolveRequiredMiddlewareExport(
    moduleValue,
    exportNames,
    logicalName
) {
    if (
        typeof moduleValue ===
        'function'
    ) {
        return moduleValue;
    }

    for (
        const exportName
        of exportNames
    ) {
        if (
            moduleValue &&
            typeof moduleValue[
                exportName
            ] ===
            'function'
        ) {
            return moduleValue[
                exportName
            ];
        }
    }

    throw new Error(
        `[${ROUTER_NAME}] Required middleware "${logicalName}" is not configured.`
    );
}

function resolveMiddleware(
    candidates,
    exportName
) {
    for (
        const candidate
        of candidates
    ) {
        try {
            const moduleValue =
                require(
                    candidate
                );

            const resolved =
                resolveRequiredCandidateExport(
                    moduleValue,
                    exportName
                );

            if (
                typeof resolved ===
                'function'
            ) {
                return resolved;
            }
        } catch (
            error
        ) {
            /**
             * Only ignore candidate lookup failures.
             *
             * A runtime exception from an existing middleware module must
             * surface rather than being hidden.
             */
            if (
                error &&
                error.code !==
                    'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    /**
     * Fail closed.
     *
     * Financial routes must never silently continue without security
     * middleware.
     */
    return function missingRequiredMiddleware(
        req,
        res,
        next
    ) {
        const error =
            new Error(
                `Required security middleware "${exportName}" is not configured.`
            );

        error.code =
            'FINANCIAL_SECURITY_MIDDLEWARE_NOT_CONFIGURED';

        error.statusCode =
            500;

        next(
            error
        );
    };
}

function resolveRequiredCandidateExport(
    moduleValue,
    exportName
) {
    if (
        typeof moduleValue ===
        'function'
    ) {
        return moduleValue;
    }

    if (
        moduleValue &&
        typeof moduleValue[
            exportName
        ] ===
            'function'
    ) {
        return moduleValue[
            exportName
        ];
    }

    return null;
}

/**
 * ============================================================================
 * ROUTER METADATA
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
 * EXPORT
 * ============================================================================
 */

module.exports =
    router;