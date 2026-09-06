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
 * Purpose:
 *   Secure HTTP routing boundary for TITech Community Capital loan lifecycle
 *   operations.
 *
 * Authenticated member routes:
 *   POST /api/loans
 *   GET  /api/loans
 *   GET  /api/loans/:loanId
 *   GET  /api/loans/:loanId/schedule
 *   GET  /api/loans/:loanId/summary
 *   POST /api/loans/:loanId/repayment
 *
 * Administrative routes:
 *   POST /api/loans/:loanId/approve
 *   POST /api/loans/:loanId/reject
 *   POST /api/loans/:loanId/disburse
 *
 * Architecture:
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
 *   Idempotency
 *        ↓
 *   RBAC / Administrative Authorization
 *        ↓
 *   Loan Controller
 *        ↓
 *   Loan Service
 *        ↓
 *   Financial Transaction / Ledger / Audit
 *
 * IMPORTANT:
 *   This router must never:
 *
 *   - calculate loan balances;
 *   - mutate financial balances directly;
 *   - write ledger entries;
 *   - perform accounting;
 *   - select a tenant from request body/query input;
 *   - bypass idempotency for financial mutations;
 *   - implement loan business decisions.
 *
 * ============================================================================
 */

// ============================================================================
// Dependencies
// ============================================================================

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

// -----------------------------------------------------------------------------
// Controller resolution
// -----------------------------------------------------------------------------
//
// Prefer the existing plural filename used by the supplied controller:
//   controllers/loansController.js
//
// Fall back to:
//   controllers/loanController.js
//
// The method contract is still validated below.
// -----------------------------------------------------------------------------

let loanController;

try {
    loanController =
        require('../controllers/loansController');
} catch (pluralError) {
    try {
        loanController =
            require('../controllers/loanController');
    } catch (singularError) {
        throw new Error(
            '[TITechLoanRoutes] Unable to load loan controller. ' +
            'Expected ../controllers/loansController or ../controllers/loanController.'
        );
    }
}

// ============================================================================
// Router
// ============================================================================

const router =
    express.Router({
        strict: false,
        caseSensitive: false,
    });

// ============================================================================
// Metadata
// ============================================================================

const ROUTER_NAME =
    'TITechLoanRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Loan API';

const OPERATION_PREFIX =
    'LOAN';

const MAX_HEADER_LENGTH =
    128;

const MAX_IDENTIFIER_LENGTH =
    128;

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

const DEFAULT_LOAN_LIMIT =
    '1000000000000000';

/**
 * Keep maximum monetary limits as strings.
 *
 * IMPORTANT:
 * Do not convert financial limits to JavaScript Number.
 *
 * The controller/service layer must perform exact decimal comparison using
 * the project's canonical money implementation.
 */
const MAX_LOAN_AMOUNT =
    normalizeMoneyString(
        process.env.TITECH_MAX_LOAN_AMOUNT ||
        DEFAULT_LOAN_LIMIT
    );

// ============================================================================
// Controller Contract
// ============================================================================

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
    const method of REQUIRED_CONTROLLERS
) {
    if (
        typeof loanController?.[method] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing loanController.${method} export.`
        );
    }
}

// ============================================================================
// Authentication Contract
// ============================================================================

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

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeString(
    value,
    fallback = null,
    {
        maxLength = MAX_IDENTIFIER_LENGTH,
        allowEmpty = false,
    } = {}
) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    if (
        Array.isArray(value) ||
        (
            typeof value !==
            'string'
        )
    ) {
        return fallback;
    }

    const normalized =
        value.trim();

    if (
        !allowEmpty &&
        !normalized
    ) {
        return fallback;
    }

    if (
        normalized.length >
        maxLength
    ) {
        return fallback;
    }

    return normalized;
}

function normalizeHeader(
    value
) {
    return normalizeString(
        value,
        null,
        {
            maxLength:
                MAX_HEADER_LENGTH,
        }
    );
}

function isValidMoneyString(
    value
) {
    return (
        typeof value === 'string' &&
        /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
            value.trim()
        )
    );
}

function normalizeMoneyString(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            'Financial monetary values must be decimal strings.'
        );
    }

    const normalized =
        value.trim();

    if (
        !isValidMoneyString(
            normalized
        )
    ) {
        throw new TypeError(
            `Invalid monetary value: ${normalized}`
        );
    }

    return normalized;
}

// ============================================================================
// Request Metadata
// ============================================================================

function requestMetadata(
    req,
    res,
    next
) {
    const suppliedRequestId =
        normalizeHeader(
            req.requestId
        ) ||
        normalizeHeader(
            req.id
        ) ||
        normalizeHeader(
            req.headers?.[
                'x-request-id'
            ]
        );

    const requestId =
        suppliedRequestId ||
        crypto.randomUUID();

    const suppliedCorrelationId =
        normalizeHeader(
            req.correlationId
        ) ||
        normalizeHeader(
            req.headers?.[
                'x-correlation-id'
            ]
        );

    const correlationId =
        suppliedCorrelationId ||
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

    return next();
}

router.use(
    requestMetadata
);

// ============================================================================
// Security Headers
// ============================================================================

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

        return next();
    }
);

// ============================================================================
// Body Parser
// ============================================================================

router.use(
    express.json({
        limit:
            process.env.TITECH_LOAN_BODY_LIMIT ||
            '512kb',

        strict:
            true,
    })
);

// ============================================================================
// Authentication
// ============================================================================

router.use(
    verifyToken
);

// ============================================================================
// Trusted Tenant / Actor Context
// ============================================================================
//
// Prefer the canonical admin context middleware when available.
//
// SECURITY:
//   Client-supplied body.tenantId/query.tenantId is never trusted.
//
// ============================================================================

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
    /**
     * Only trusted server-side context is accepted.
     *
     * Deliberately excluded:
     *   req.query.tenantId
     *   req.body.tenantId
     *   arbitrary tenant headers
     *   req.tenantId unless established by trusted middleware
     */

    const tenantId =
        normalizeString(
            req.context?.tenantId
        ) ||
        normalizeString(
            req.auth?.tenantId
        ) ||
        normalizeString(
            req.user?.tenantId
        );

    const actorId =
        normalizeString(
            req.user?.id
        ) ||
        normalizeString(
            req.user?._id
        ) ||
        normalizeString(
            req.user?.userId
        ) ||
        normalizeString(
            req.auth?.userId
        );

    if (
        !tenantId
    ) {
        return res
            .status(403)
            .json({
                success: false,

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
                success: false,

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

    return next();
}

router.use(
    adminContextMiddleware ||
    fallbackTenantContext
);

// ============================================================================
// Rate Limiting
// ============================================================================

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const raw =
        process.env[name];

    if (
        raw === undefined ||
        raw === null ||
        raw === ''
    ) {
        return fallback;
    }

    const value =
        Number(raw);

    if (
        !Number.isSafeInteger(
            value
        ) ||
        value <= 0
    ) {
        return fallback;
    }

    return value;
}

function resolveActorKey(
    req
) {
    return (
        normalizeString(
            req.user?.id
        ) ||
        normalizeString(
            req.user?._id
        ) ||
        normalizeString(
            req.user?.userId
        ) ||
        normalizeString(
            req.auth?.userId
        ) ||
        normalizeString(
            req.adminContext?.actorId
        ) ||
        normalizeString(
            req.ip
        ) ||
        'unknown'
    );
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
            true,

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        keyGenerator(
            req
        ) {
            return resolveActorKey(
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
                        new Date().toISOString(),
                });
        },
    });
}

const loanReadLimiter =
    createLimiter({
        windowMs:
            60 * 1000,

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
            60 * 1000,

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
            60 * 1000,

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

// ============================================================================
// Common Validation
// ============================================================================

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
                min: 1,
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
                min: 1,
                max: MAX_LIMIT,
            })
            .withMessage(
                `limit must be between 1 and ${MAX_LIMIT}.`
            ),
    ];

// ============================================================================
// Loan Application Validation
// ============================================================================

const createLoanValidators =
    [
        body('amount')
            .exists()
            .withMessage(
                'amount is required.'
            )
            .bail()
            .isString()
            .withMessage(
                'amount must be supplied as a decimal string.'
            )
            .bail()
            .matches(
                /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
            )
            .withMessage(
                'amount must be a fixed-point monetary value with at most two decimal places.'
            )
            .bail()
            .custom(
                value =>
                    !/^0(?:\.0{1,2})?$/.test(
                        value
                    )
            )
            .withMessage(
                'amount must be greater than zero.'
            )
            .custom(
                value =>
                    compareMoneyStrings(
                        value,
                        MAX_LOAN_AMOUNT
                    ) <= 0
            )
            .withMessage(
                'amount exceeds the supported loan limit.'
            ),

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
            .isString()
            .withMessage(
                'interestRate must be supplied as a decimal string.'
            )
            .bail()
            .matches(
                /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/
            )
            .withMessage(
                'interestRate must be a valid decimal value.'
            ),

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

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied. Tenant context is server-controlled.'
            ),

        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied. The authenticated user is authoritative.'
            ),
    ];

// ============================================================================
// Loan List Validation
// ============================================================================

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

        query('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),
    ];

// ============================================================================
// Schedule Validation
// ============================================================================

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

        query('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must not be supplied.'
            ),
    ];

// ============================================================================
// Administrative Validation
// ============================================================================

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

// ============================================================================
// Repayment Validation
// ============================================================================

const repaymentValidators =
    [
        loanIdValidator,

        body('amount')
            .exists()
            .withMessage(
                'amount is required.'
            )
            .bail()
            .isString()
            .withMessage(
                'amount must be supplied as a decimal string.'
            )
            .bail()
            .matches(
                /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
            )
            .withMessage(
                'amount must be a fixed-point monetary value with at most two decimal places.'
            )
            .bail()
            .custom(
                value =>
                    !/^0(?:\.0{1,2})?$/.test(
                        value
                    )
            )
            .withMessage(
                'amount must be greater than zero.'
            ),

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

        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must not be supplied.'
            ),
    ];

// ============================================================================
// Idempotency
// ============================================================================

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

    if (
        typeof moduleValue?.middleware ===
        'function'
    ) {
        return moduleValue.middleware;
    }

    if (
        typeof moduleValue?.create ===
        'function'
    ) {
        return moduleValue.create;
    }

    return null;
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
        `[${ROUTER_NAME}] Idempotency middleware factory is required for loan mutation routes.`
    );
}

function idempotency(
    operation,
    resource
) {
    const middleware =
        idempotencyFactory({
            operation,
            resource,
            required: true,
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
    const raw =
        req.headers?.[
            'idempotency-key'
        ];

    const key =
        normalizeString(
            raw,
            null,
            {
                maxLength: 255,
            }
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
                    'Idempotency-Key is required for loan mutation operations.',

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

    /**
     * Reject control characters.
     */
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

    return next();
}

// ============================================================================
// Body Validation Helper
// ============================================================================

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

    return next();
}

function applyValidation(
    rules
) {
    return [
        ...rules,
        handleValidation,
    ];
}

// ============================================================================
// Async Controller Adapter
// ============================================================================

function asyncHandler(
    controllerMethod
) {
    if (
        typeof controllerMethod !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Controller method must be a function.`
        );
    }

    return function wrappedLoanHandler(
        req,
        res,
        next
    ) {
        return Promise
            .resolve(
                controllerMethod(
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

// ============================================================================
// Health Endpoint
// ============================================================================
//
// IMPORTANT:
// Keep this BEFORE "/:loanId" so "health" is not interpreted as a loan ID.
//
// ============================================================================

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

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

// ============================================================================
// Authenticated Member Routes
// ============================================================================

// POST /api/loans
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

// GET /api/loans
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

// GET /api/loans/:loanId/summary
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

// GET /api/loans/:loanId/schedule
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

// ============================================================================
// Administrative Routes
// ============================================================================

// POST /api/loans/:loanId/approve
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

// POST /api/loans/:loanId/reject
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

// POST /api/loans/:loanId/disburse
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

// ============================================================================
// Repayment
// ============================================================================

// POST /api/loans/:loanId/repayment
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

// ============================================================================
// Loan Detail
// ============================================================================
//
// Keep this AFTER all static /specialized routes.
//
// ============================================================================

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

// ============================================================================
// 404
// ============================================================================

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

// ============================================================================
// Centralized Error Handler
// ============================================================================

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

        const rawStatus =
            Number(
                error?.statusCode
            );

        const statusCode =
            Number.isInteger(
                rawStatus
            ) &&
            rawStatus >= 400 &&
            rawStatus < 600
                ? rawStatus
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

        /**
         * Never expose stack traces or internal error details in production.
         */
        if (
            process.env.NODE_ENV !==
            'production' &&
            error?.stack
        ) {
            response.debug =
                {
                    stack:
                        error.stack,
                };
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

// ============================================================================
// Router Metadata
// ============================================================================

router.routerName =
    ROUTER_NAME;

router.routerVersion =
    ROUTER_VERSION;

router.serviceName =
    SERVICE_NAME;

// ============================================================================
// Export
// ============================================================================

module.exports =
    router;

// ============================================================================
// Exact Money Comparison
// ============================================================================
//
// Compares non-negative decimal strings with up to two fractional digits.
//
// Returns:
//   -1 if left < right
//    0 if left = right
//    1 if left > right
//
// This avoids Number()/parseFloat() for financial limits.
// ============================================================================

function compareMoneyStrings(
    left,
    right
) {
    const normalize =
        value => {
            const normalized =
                String(
                    value
                )
                    .trim()
                    .replace(
                        /^(\d+)\.?\d*$/,
                        '$1'
                    );

            const parts =
                normalized.split(
                    '.'
                );

            const whole =
                parts[0]
                    .replace(
                        /^0+(?=\d)/,
                        ''
                    );

            const fraction =
                (
                    parts[1] ||
                    ''
                )
                    .padEnd(
                        2,
                        '0'
                    )
                    .slice(
                        0,
                        2
                    );

            return {
                whole,
                fraction,
            };
        };

    const a =
        normalize(
            left
        );

    const b =
        normalize(
            right
        );

    if (
        a.whole.length !==
        b.whole.length
    ) {
        return (
            a.whole.length <
            b.whole.length
        )
            ? -1
            : 1;
    }

    if (
        a.whole !==
        b.whole
    ) {
        return (
            a.whole <
            b.whole
        )
            ? -1
            : 1;
    }

    if (
        a.fraction ===
        b.fraction
    ) {
        return 0;
    }

    return (
        a.fraction <
        b.fraction
    )
        ? -1
        : 1;
}