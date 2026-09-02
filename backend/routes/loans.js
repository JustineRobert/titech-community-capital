'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Loan Management Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/loans.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP routing boundary for TITech Community Capital loan lifecycle
 * operations.
 *
 * Authenticated member routes
 * ----------------------------------------------------------------------------
 * POST /api/loans
 * GET  /api/loans
 * GET  /api/loans/:loanId
 * GET  /api/loans/:loanId/schedule
 * GET  /api/loans/:loanId/summary
 * POST /api/loans/:loanId/repayment
 *
 * Administrative routes
 * ----------------------------------------------------------------------------
 * POST /api/loans/:loanId/approve
 * POST /api/loans/:loanId/reject
 * POST /api/loans/:loanId/disburse
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
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Idempotency for financial mutations
 *        ↓
 *   RBAC / Administrative Authorization
 *        ↓
 *   Loan Controller
 *        ↓
 *   Loan Service
 *        ↓
 *   Financial Transaction / Ledger / Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router MUST NOT:
 *
 *   ✗ calculate loan balances directly
 *   ✗ mutate loan balances directly
 *   ✗ write ledger entries directly
 *   ✗ approve/reject loans in the route layer
 *   ✗ select another tenant from query/body input
 *   ✗ bypass idempotency for financial mutations
 *
 * Those responsibilities belong to the controller/service/domain/repository
 * layers.
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

const auth =
    require('../middleware/auth');

const loanController =
    require('../controllers/loanController');

/**
 * ============================================================================
 * ROUTER
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
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechLoanRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Loan API';

const MAX_DESCRIPTION_LENGTH =
    5000;

const MAX_PURPOSE_LENGTH =
    500;

const MAX_NOTES_LENGTH =
    2000;

const MAX_REASON_LENGTH =
    2000;

const MAX_REFERENCE_LENGTH =
    255;

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    100;

const MAX_DURATION_MONTHS =
    360;

const MAX_LOAN_AMOUNT =
    Number(
        process.env.TITECH_MAX_LOAN_AMOUNT ||
        1_000_000_000_000_000
    );

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
    Object.freeze([
        'createLoanApplication',
        'listLoans',
        'getLoanSummary',
        'getRepaymentSchedule',
        'getLoanDetail',
        'approveLoan',
        'rejectLoan',
        'disburseLoan',
        'recordRepayment',
    ]);

for (
    const method
    of REQUIRED_CONTROLLERS
) {
    if (
        typeof loanController?.[
            method
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing loanController.${method} export.`
        );
    }
}

/**
 * ============================================================================
 * AUTHENTICATION CONTRACT
 * ============================================================================
 */

const verifyToken =
    auth?.verifyToken ||
    auth?.authenticate;

const requireRole =
    auth?.requireRole;

if (
    typeof verifyToken !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware must expose verifyToken() or authenticate().`
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
 * REQUEST METADATA
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
 * BODY PARSER
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            process.env.TITECH_LOAN_BODY_LIMIT ||
            '512kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 *
 * Every loan endpoint is authenticated.
 * ============================================================================
 */

router.use(
    verifyToken
);

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT
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
                    'LOAN_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for loan operations.',

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
                    'LOAN_ACTOR_CONTEXT_REQUIRED',

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

router.use(
    adminContextMiddleware ||
    fallbackTenantContext
);

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 */

const loanReadLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_READ_RATE_LIMIT',
                120
            ),

        code:
            'LOAN_READ_RATE_LIMITED',

        message:
            'Too many loan queries. Please try again later.',
    });

const loanWriteLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'LOAN_WRITE_RATE_LIMITED',

        message:
            'Too many loan operation requests. Please try again later.',
    });

const loanApprovalLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_APPROVAL_RATE_LIMIT',
                20
            ),

        code:
            'LOAN_APPROVAL_RATE_LIMITED',

        message:
            'Too many loan administration requests. Please try again later.',
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
                    req.user?.id ||
                        req.user?._id ||
                        req.user?.userId ||
                        req.auth?.userId ||
                        req.adminContext?.actorId
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
 * COMMON VALIDATION
 * ============================================================================
 */

const loanIdValidator =
    param('loanId')
        .exists()
        .withMessage(
            'loanId is required.'
        )
        .bail()
        .isMongoId()
        .withMessage(
            'loanId must be a valid MongoDB ObjectId.'
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
                    MAX_LIMIT,
            })
            .withMessage(
                `limit must be between 1 and ${MAX_LIMIT}.`
            ),
    ];

/**
 * ============================================================================
 * LOAN APPLICATION VALIDATION
 * ============================================================================
 */

const createLoanValidators =
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
                    MAX_LOAN_AMOUNT,
            })
            .withMessage(
                'amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('duration')
            .exists()
            .withMessage(
                'duration is required.'
            )
            .bail()
            .isInt({
                min:
                    1,

                max:
                    MAX_DURATION_MONTHS,
            })
            .withMessage(
                `duration must be between 1 and ${MAX_DURATION_MONTHS} months.`
            )
            .toInt(),

        body('interestRate')
            .optional()
            .isFloat({
                min:
                    0,

                max:
                    100,
            })
            .withMessage(
                'interestRate must be between 0 and 100.'
            )
            .toFloat(),

        body('purpose')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_PURPOSE_LENGTH,
            })
            .withMessage(
                `purpose cannot exceed ${MAX_PURPOSE_LENGTH} characters.`
            ),

        body('description')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_DESCRIPTION_LENGTH,
            })
            .withMessage(
                `description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
            ),

        /**
         * Tenant identity must come from trusted authentication context.
         */
        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied in the loan application.'
            ),

        /**
         * Prevent client-side impersonation of another borrower.
         */
        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied. The authenticated user is authoritative.'
            ),
    ];

/**
 * ============================================================================
 * LOAN LIST VALIDATION
 * ============================================================================
 */

const loanListValidators =
    [
        ...paginationValidators,

        query('status')
            .optional()
            .isIn([
                'pending',
                'approved',
                'rejected',
                'disbursed',
                'active',
                'partially_repaid',
                'overdue',
                'completed',
                'defaulted',
                'closed',
            ])
            .withMessage(
                'Invalid loan status.'
            ),

        query('sortBy')
            .optional()
            .isIn([
                'createdAt',
                'updatedAt',
                'amount',
                'status',
                'dueDate',
            ])
            .withMessage(
                'Invalid loan sort field.'
            ),

        query('sortOrder')
            .optional()
            .toLowerCase()
            .isIn([
                'asc',
                'desc',
            ])
            .withMessage(
                'sortOrder must be asc or desc.'
            ),
    ];

/**
 * ============================================================================
 * REPAYMENT SCHEDULE VALIDATION
 * ============================================================================
 */

const scheduleValidators =
    [
        loanIdValidator,

        ...paginationValidators,

        query('status')
            .optional()
            .isIn([
                'pending',
                'paid',
                'overdue',
                'partial',
                'waived',
            ])
            .withMessage(
                'Invalid repayment schedule status.'
            ),
    ];

/**
 * ============================================================================
 * ADMIN ACTION VALIDATION
 * ============================================================================
 */

const approvalValidators =
    [
        loanIdValidator,

        body('notes')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NOTES_LENGTH,
            })
            .withMessage(
                `notes cannot exceed ${MAX_NOTES_LENGTH} characters.`
            ),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),
    ];

const rejectionValidators =
    [
        loanIdValidator,

        body('reason')
            .exists()
            .withMessage(
                'reason is required.'
            )
            .bail()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_REASON_LENGTH,
            })
            .withMessage(
                `reason must be between 1 and ${MAX_REASON_LENGTH} characters.`
            ),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),
    ];

const disbursementValidators =
    [
        loanIdValidator,

        body('notes')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_NOTES_LENGTH,
            })
            .withMessage(
                `notes cannot exceed ${MAX_NOTES_LENGTH} characters.`
            ),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),
    ];

/**
 * ============================================================================
 * REPAYMENT VALIDATION
 * ============================================================================
 */

const repaymentValidators =
    [
        loanIdValidator,

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
                    MAX_LOAN_AMOUNT,
            })
            .withMessage(
                'amount must be positive and within the supported limit.'
            )
            .toFloat(),

        body('method')
            .optional()
            .isIn([
                'cash',
                'bank_transfer',
                'mobile_money',
                'card',
                'wallet',
                'other',
            ])
            .withMessage(
                'Invalid repayment method.'
            ),

        body('reference')
            .optional()
            .isString()
            .trim()
            .isLength({
                max:
                    MAX_REFERENCE_LENGTH,
            })
            .withMessage(
                `reference cannot exceed ${MAX_REFERENCE_LENGTH} characters.`
            ),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),

        /**
         * The repayment service should derive the authenticated payer where
         * appropriate rather than trusting body.userId.
         */
        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied.'
            ),
    ];

/**
 * ============================================================================
 * IDEMPOTENCY
 * ============================================================================
 */

let idempotencyModule =
    null;

try {
    idempotencyModule =
        require(
            '../middleware/idempotency'
        );
} catch {
    idempotencyModule =
        null;
}

const idempotencyFactory =
    resolveIdempotencyFactory(
        idempotencyModule
    );

if (
    typeof idempotencyFactory !==
    'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Idempotency middleware factory is required for financial loan mutations.`
    );
}

function resolveIdempotencyFactory(
    moduleValue
) {
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

    return null;
}

function idempotency(
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
                    'Idempotency-Key is required for financial loan operations.',

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

/**
 * ============================================================================
 * VALIDATION HELPER
 * ============================================================================
 */

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
 * MEMBER / USER LOAN ROUTES
 * ============================================================================
 */

/**
 * POST /api/loans
 *
 * Create loan application.
 */
router.post(
    '/',

    loanWriteLimiter,

    requireObjectBody,

    applyValidation(
        createLoanValidators
    ),

    requireIdempotencyKey,

    idempotency(
        'LOAN_APPLICATION_CREATE',
        'loans'
    ),

    asyncHandler(
        loanController.createLoanApplication
    )
);

/**
 * GET /api/loans
 *
 * The controller/service must return only loans the authenticated user is
 * authorized to see unless an explicitly privileged administrative scope has
 * been established.
 */
router.get(
    '/',

    loanReadLimiter,

    applyValidation(
        loanListValidators
    ),

    asyncHandler(
        loanController.listLoans
    )
);

/**
 * GET /api/loans/:loanId/summary
 */
router.get(
    '/:loanId/summary',

    loanReadLimiter,

    applyValidation([
        loanIdValidator,
    ]),

    asyncHandler(
        loanController.getLoanSummary
    )
);

/**
 * GET /api/loans/:loanId/schedule
 */
router.get(
    '/:loanId/schedule',

    loanReadLimiter,

    applyValidation(
        scheduleValidators
    ),

    asyncHandler(
        loanController.getRepaymentSchedule
    )
);

/**
 * GET /api/loans/:loanId
 */
router.get(
    '/:loanId',

    loanReadLimiter,

    applyValidation([
        loanIdValidator,
    ]),

    asyncHandler(
        loanController.getLoanDetail
    )
);

/**
 * ============================================================================
 * ADMIN LOAN LIFECYCLE
 * ============================================================================
 *
 * Loan approval/rejection/disbursement are privileged financial state changes.
 *
 * Final maker-checker, authorization, eligibility and workflow validation
 * belongs in the service layer.
 * ============================================================================
 */

/**
 * POST /api/loans/:loanId/approve
 */
router.post(
    '/:loanId/approve',

    loanApprovalLimiter,

    requireRole(
        'admin'
    ),

    requireObjectBody,

    applyValidation(
        approvalValidators
    ),

    requireIdempotencyKey,

    idempotency(
        'LOAN_APPROVAL',
        'loan-approval'
    ),

    asyncHandler(
        loanController.approveLoan
    )
);

/**
 * POST /api/loans/:loanId/reject
 */
router.post(
    '/:loanId/reject',

    loanApprovalLimiter,

    requireRole(
        'admin'
    ),

    requireObjectBody,

    applyValidation(
        rejectionValidators
    ),

    requireIdempotencyKey,

    idempotency(
        'LOAN_REJECTION',
        'loan-rejection'
    ),

    asyncHandler(
        loanController.rejectLoan
    )
);

/**
 * POST /api/loans/:loanId/disburse
 *
 * This is a balance-affecting operation and therefore requires idempotency.
 */
router.post(
    '/:loanId/disburse',

    loanApprovalLimiter,

    requireRole(
        'admin'
    ),

    requireObjectBody,

    applyValidation(
        disbursementValidators
    ),

    requireIdempotencyKey,

    idempotency(
        'LOAN_DISBURSEMENT',
        'loan-disbursement'
    ),

    asyncHandler(
        loanController.disburseLoan
    )
);

/**
 * ============================================================================
 * LOAN REPAYMENT
 * ============================================================================
 *
 * Balance-affecting operation.
 *
 * Authentication + tenant context + validation + idempotency are mandatory.
 * ============================================================================
 */

router.post(
    '/:loanId/repayment',

    loanWriteLimiter,

    requireObjectBody,

    applyValidation(
        repaymentValidators
    ),

    requireIdempotencyKey,

    idempotency(
        'LOAN_REPAYMENT',
        'loan-repayment'
    ),

    asyncHandler(
        loanController.recordRepayment
    )
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
    '/health',

    loanReadLimiter,

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
                    'LOAN_ROUTE_NOT_FOUND',

                message:
                    'Loan endpoint not found.',

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
                        ? 'LOAN_REQUEST_ERROR'
                        : 'LOAN_INTERNAL_ERROR'
                ),

            message:
                clientError
                    ? (
                        error?.message ||
                        'The loan request could not be completed.'
                    )
                    : 'The loan request could not be completed.',

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

/**
 * ============================================================================
 * LOCAL HELPERS
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
                    'INVALID_LOAN_REQUEST_BODY',

                message:
                    'A JSON object request body is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    next();
}

function createRouteLimiter({
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
                        req.auth?.userId ||
                        req.adminContext?.actorId
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

const loanReadLimiter =
    createRouteLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_READ_RATE_LIMIT',
                120
            ),

        code:
            'LOAN_READ_RATE_LIMITED',

        message:
            'Too many loan queries. Please try again later.',
    });

const loanWriteLimiter =
    createRouteLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_WRITE_RATE_LIMIT',
                30
            ),

        code:
            'LOAN_WRITE_RATE_LIMITED',

        message:
            'Too many loan operation requests. Please try again later.',
    });

const loanApprovalLimiter =
    createRouteLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_LOAN_APPROVAL_RATE_LIMIT',
                20
            ),

        code:
            'LOAN_APPROVAL_RATE_LIMITED',

        message:
            'Too many loan administration requests. Please try again later.',
    });