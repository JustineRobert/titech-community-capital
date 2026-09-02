'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Loan Routes
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/routes/loan.routes.js
 *
 * Purpose:
 *   Enterprise HTTP route boundary for loan lifecycle operations.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 *   - Authentication
 *   - Tenant isolation context
 *   - RBAC / permission enforcement
 *   - Request / correlation / operation identity
 *   - Idempotency propagation for financial mutations
 *   - Request parameter validation
 *   - Existing controller compatibility
 *   - Existing validation middleware compatibility
 *   - Consistent route-level error handling
 *
 * Loan lifecycle:
 * ----------------------------------------------------------------------------
 *
 *   CREATE
 *      |
 *      v
 *   APPROVE
 *      |
 *      v
 *   DISBURSE
 *      |
 *      v
 *   REPAY
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   - post directly to the ledger
 *   - modify loan balances directly
 *   - update financial accounts directly
 *   - bypass LoanController
 *   - bypass validation middleware
 *   - bypass authorization middleware
 *
 * Controllers / domain services remain responsible for financial workflow
 * execution.
 *
 * ============================================================================
 */

const express =
    require('express');

const crypto =
    require('crypto');

/* ============================================================================
 * Router
 * ========================================================================== */

const router =
    express.Router({
        mergeParams:
            true,

        caseSensitive:
            false,

        strict:
            false,
    });

/* ============================================================================
 * Controllers
 * ========================================================================== */

const LoanController =
    require('../controllers/LoanController');

/* ============================================================================
 * Validation Middleware
 * ========================================================================== */

const validate =
    require('../middleware/validateLoan');

/* ============================================================================
 * Authentication / RBAC Middleware
 * ========================================================================== */

const auth =
    require('../../auth/middleware/authMiddleware');

const permit =
    require('../../auth/middleware/permissionMiddleware');

/* ============================================================================
 * Constants
 * ========================================================================== */

const ROUTER_NAME =
    'loan.routes';

const REQUEST_ID_HEADER =
    'x-request-id';

const CORRELATION_ID_HEADER =
    'x-correlation-id';

const OPERATION_ID_HEADER =
    'x-operation-id';

const IDEMPOTENCY_KEY_HEADER =
    'idempotency-key';

const TENANT_ID_HEADER =
    'x-tenant-id';

const MAX_ID_LENGTH =
    256;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    512;

const MUTATING_METHODS =
    Object.freeze([
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
    ]);

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

function generateId() {

    if (
        typeof crypto.randomUUID ===
        'function'
    ) {

        return crypto.randomUUID();
    }

    return [
        Date.now().toString(16),

        Math.random()
            .toString(16)
            .slice(2),
    ].join('-');
}

function normalizeId(
    value,
    maxLength = MAX_ID_LENGTH
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    const normalized =
        String(
            value
        )
            .trim();

    if (
        !normalized
    ) {

        return null;
    }

    return normalized.slice(
        0,
        maxLength
    );
}

function normalizeIdempotencyKey(
    value
) {

    return normalizeId(
        value,
        MAX_IDEMPOTENCY_KEY_LENGTH
    );
}

function isFunction(
    value
) {

    return typeof value ===
        'function';
}

function asyncHandler(
    handler
) {

    return function wrappedHandler(
        req,
        res,
        next
    ) {

        try {

            const result =
                handler(
                    req,
                    res,
                    next
                );

            if (
                result &&
                typeof result.then ===
                    'function'
            ) {

                return result.catch(
                    next
                );
            }

            return result;

        } catch (error) {

            return next(
                error
            );
        }
    };
}

/* ============================================================================
 * Request Identity Middleware
 * ========================================================================== */

/**
 * Establishes stable request-level identity before any controller executes.
 *
 * Authentication middleware has already run before this middleware, allowing
 * user/tenant data resolved upstream to take precedence.
 */
function requestIdentity(
    req,
    res,
    next
) {

    try {

        const headers =
            req.headers ||
            {};

        const requestId =
            normalizeId(
                headers[
                    REQUEST_ID_HEADER
                ]
            ) ||
            normalizeId(
                req.requestId
            ) ||
            generateId();

        const correlationId =
            normalizeId(
                headers[
                    CORRELATION_ID_HEADER
                ]
            ) ||
            normalizeId(
                req.correlationId
            ) ||
            requestId;

        const operationId =
            normalizeId(
                headers[
                    OPERATION_ID_HEADER
                ]
            ) ||
            normalizeId(
                req.operationId
            ) ||
            generateId();

        const idempotencyKey =
            normalizeIdempotencyKey(
                headers[
                    IDEMPOTENCY_KEY_HEADER
                ]
            ) ||
            normalizeIdempotencyKey(
                req.idempotencyKey
            );

        /*
         * Never trust a client tenant header over an already authenticated /
         * resolved tenant context.
         */
        const authenticatedTenantId =
            normalizeId(
                req.tenantId
            ) ||
            normalizeId(
                req.user?.tenantId
            ) ||
            normalizeId(
                req.auth?.tenantId
            );

        const headerTenantId =
            normalizeId(
                headers[
                    TENANT_ID_HEADER
                ]
            );

        if (
            authenticatedTenantId &&
            headerTenantId &&
            authenticatedTenantId !==
                headerTenantId
        ) {

            const error =
                new Error(
                    'Tenant context mismatch'
                );

            error.code =
                'TENANT_CONTEXT_MISMATCH';

            error.statusCode =
                403;

            return next(
                error
            );
        }

        const tenantId =
            authenticatedTenantId ||
            headerTenantId;

        const userId =
            normalizeId(
                req.user?.id
            ) ||
            normalizeId(
                req.user?._id
            ) ||
            normalizeId(
                req.auth?.userId
            ) ||
            normalizeId(
                req.userId
            );

        req.requestId =
            requestId;

        req.correlationId =
            correlationId;

        req.operationId =
            operationId;

        req.idempotencyKey =
            idempotencyKey;

        req.tenantId =
            tenantId;

        req.financeContext = {

            module:
                'finance-core',

            domain:
                'loan',

            requestId,

            correlationId,

            operationId,

            idempotencyKey,

            tenantId,

            userId,
        };

        res.setHeader(
            REQUEST_ID_HEADER,
            requestId
        );

        res.setHeader(
            CORRELATION_ID_HEADER,
            correlationId
        );

        res.setHeader(
            OPERATION_ID_HEADER,
            operationId
        );

        return next();

    } catch (error) {

        return next(
            error
        );
    }
}

/* ============================================================================
 * Idempotency Enforcement
 * ========================================================================== */

/**
 * Financially mutating operations should normally carry an Idempotency-Key.
 *
 * The controller/domain layer remains responsible for durable idempotency
 * enforcement. This middleware only validates and propagates the key.
 */
function requireIdempotencyKey(
    req,
    _res,
    next
) {

    try {

        const key =
            normalizeIdempotencyKey(
                req.idempotencyKey ||
                req.headers[
                    IDEMPOTENCY_KEY_HEADER
                ]
            );

        if (
            !key
        ) {

            const error =
                new Error(
                    'Idempotency-Key header is required for this financial operation'
                );

            error.code =
                'IDEMPOTENCY_KEY_REQUIRED';

            error.statusCode =
                400;

            return next(
                error
            );
        }

        req.idempotencyKey =
            key;

        req.financeContext =
            {
                ...(req.financeContext ||
                    {}),

                idempotencyKey:
                    key,
            };

        return next();

    } catch (error) {

        return next(
            error
        );
    }
}

/* ============================================================================
 * Route Parameter Validation
 * ========================================================================== */

function validateLoanId(
    req,
    _res,
    next
) {

    const loanId =
        normalizeId(
            req.params?.id
        );

    if (
        !loanId
    ) {

        const error =
            new Error(
                'Loan id is required'
            );

        error.code =
            'LOAN_ID_REQUIRED';

        error.statusCode =
            400;

        return next(
            error
        );
    }

    req.params.id =
        loanId;

    return next();
}

/* ============================================================================
 * Security / Cache Headers
 * ========================================================================== */

function financeResponseHeaders(
    req,
    res,
    next
) {

    /*
     * Financial API responses should never be cached by intermediary or
     * browser caches unless a dedicated immutable-cache policy is explicitly
     * introduced.
     */
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
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
        'X-Frame-Options',
        'DENY'
    );

    res.setHeader(
        'Referrer-Policy',
        'no-referrer'
    );

    /*
     * Explicitly identify the Finance API boundary without leaking internal
     * implementation details.
     */
    res.setHeader(
        'X-Finance-API-Version',
        'v1'
    );

    return next();
}

/* ============================================================================
 * Request Logging
 * ========================================================================== */

function requestLogging(
    req,
    _res,
    next
) {

    const startedAt =
        process.hrtime.bigint?.();

    req.financeRequestStartedAt =
        startedAt;

    return next();
}

/* ============================================================================
 * Global Security Layer
 * ========================================================================== */

/*
 * Existing authentication middleware remains the authoritative authentication
 * boundary.
 */
router.use(
    auth
);

/*
 * Establish request identity after authentication, so authenticated tenant and
 * user context take precedence over raw headers.
 */
router.use(
    requestIdentity
);

router.use(
    financeResponseHeaders
);

router.use(
    requestLogging
);

/* ============================================================================
 * LOAN ROUTES
 * ========================================================================== */

/**
 * @route   POST /api/loans
 * @desc    Create Loan Application
 * @access  ADMIN, LOAN_OFFICER
 *
 * Idempotency:
 *   Required.
 */
router.post(
    '/',
    permit(
        'ADMIN',
        'LOAN_OFFICER'
    ),
    requireIdempotencyKey,
    validate.createLoan,
    asyncHandler(
        LoanController.createLoan
    )
);

/**
 * @route   POST /api/loans/:id/approve
 * @desc    Approve Loan
 * @access  ADMIN, TREASURER
 *
 * Idempotency:
 *   Required because approval is a state-changing financial operation.
 */
router.post(
    '/:id/approve',
    permit(
        'ADMIN',
        'TREASURER'
    ),
    validateLoanId,
    requireIdempotencyKey,
    asyncHandler(
        LoanController.approveLoan
    )
);

/**
 * @route   POST /api/loans/:id/disburse
 * @desc    Disburse Loan
 * @access  TREASURER
 *
 * Idempotency:
 *   Required.
 *
 * This endpoint must eventually terminate in the immutable Ledger Engine
 * rather than directly updating balances.
 */
router.post(
    '/:id/disburse',
    permit(
        'TREASURER'
    ),
    validateLoanId,
    requireIdempotencyKey,
    validate.disburseLoan,
    asyncHandler(
        LoanController.disburseLoan
    )
);

/**
 * @route   POST /api/loans/:id/repay
 * @desc    Repay Loan
 * @access  MEMBER, TREASURER, ADMIN
 *
 * Idempotency:
 *   Required.
 */
router.post(
    '/:id/repay',
    permit(
        'MEMBER',
        'TREASURER',
        'ADMIN'
    ),
    validateLoanId,
    requireIdempotencyKey,
    validate.repayLoan,
    asyncHandler(
        LoanController.repayLoan
    )
);

/**
 * @route   GET /api/loans/:id
 * @desc    Get Loan by ID
 * @access  ADMIN, LOAN_OFFICER, TREASURER
 *
 * No Idempotency-Key required because this is a read-only operation.
 */
router.get(
    '/:id',
    permit(
        'ADMIN',
        'LOAN_OFFICER',
        'TREASURER'
    ),
    validateLoanId,
    asyncHandler(
        LoanController.getLoan
    )
);

/**
 * @route   GET /api/loans
 * @desc    Get Loans
 * @access  ADMIN, LOAN_OFFICER, TREASURER
 *
 * Pagination / filtering remain controller concerns.
 */
router.get(
    '/',
    permit(
        'ADMIN',
        'LOAN_OFFICER',
        'TREASURER'
    ),
    asyncHandler(
        LoanController.getLoans
    )
);

/* ============================================================================
 * Route-Level Error Handler
 * ========================================================================== */

router.use(
    (
        error,
        req,
        res,
        _next
    ) => {

        const statusCode =
            normalizeStatusCode(
                error
            );

        const errorCode =
            error?.code ||
            'LOAN_ROUTE_ERROR';

        const safeMessage =
            statusCode >= 500
                ? 'Loan operation failed'
                : String(
                    error?.message ||
                    'Loan request failed'
                ).slice(
                    0,
                    2000
                );

        /*
         * Log server-side details, not raw request bodies.
         */
        try {

            const logger =
                req.logger ||
                req.app?.locals?.logger ||
                console;

            const logMethod =
                statusCode >= 500
                    ? logger.error
                    : logger.warn;

            if (
                isFunction(
                    logMethod
                )
            ) {

                logMethod.call(
                    logger,
                    '[LoanRoutes] Request failed',
                    {
                        route:
                            req.route
                                ?.path ||
                            req.path,

                        method:
                            req.method,

                        statusCode,

                        code:
                            errorCode,

                        requestId:
                            req.requestId ||
                            null,

                        correlationId:
                            req.correlationId ||
                            null,

                        operationId:
                            req.operationId ||
                            null,

                        tenantId:
                            req.tenantId ||
                            null,

                        userId:
                            req.financeContext
                                ?.userId ||
                            null,

                        error:
                            normalizeError(
                                error
                            ),
                    }
                );
            }

        } catch (_) {
            // Logging must never interfere with the API response.
        }

        if (
            res.headersSent
        ) {

            return;
        }

        return res
            .status(
                statusCode
            )
            .json({
                success:
                    false,

                error: {
                    code:
                        errorCode,

                    message:
                        safeMessage,
                },

                meta: {

                    requestId:
                        req.requestId ||
                        null,

                    correlationId:
                        req.correlationId ||
                        null,

                    operationId:
                        req.operationId ||
                        null,

                    tenantId:
                        req.tenantId ||
                        null,

                    timestamp:
                        new Date()
                            .toISOString(),
                },
            });
    }
);

/* ============================================================================
 * Helpers
 * ========================================================================== */

function normalizeStatusCode(
    error
) {

    const candidate =
        Number(
            error?.statusCode ??
            error?.status ??
            error?.httpStatus
        );

    if (
        Number.isInteger(
            candidate
        ) &&
        candidate >= 400 &&
        candidate <= 599
    ) {

        return candidate;
    }

    /*
     * Common authentication / authorization errors.
     */
    if (
        error?.code ===
            'UNAUTHORIZED'
    ) {

        return 401;
    }

    if (
        error?.code ===
            'FORBIDDEN'
    ) {

        return 403;
    }

    if (
        error?.code ===
            'TENANT_CONTEXT_MISMATCH'
    ) {

        return 403;
    }

    if (
        error?.code ===
            'IDEMPOTENCY_KEY_REQUIRED'
    ) {

        return 400;
    }

    return 500;
}

function normalizeError(
    error
) {

    if (
        !error
    ) {

        return null;
    }

    return {

        name:
            error.name ||
            'Error',

        code:
            error.code ||
            null,

        message:
            String(
                error.message ||
                'Unknown error'
            ).slice(
                0,
                2000
            ),
    };
}

/* ============================================================================
 * Route Metadata
 * ========================================================================== */

router.ROUTER_NAME =
    ROUTER_NAME;

router.ROUTE_DOMAIN =
    'finance.loan';

router.SUPPORTED_OPERATIONS =
    Object.freeze({
        CREATE:
            'loan.create',

        APPROVE:
            'loan.approve',

        DISBURSE:
            'loan.disburse',

        REPAY:
            'loan.repay',

        READ:
            'loan.read',

        LIST:
            'loan.list',
    });

router.MUTATING_METHODS =
    MUTATING_METHODS;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    router;