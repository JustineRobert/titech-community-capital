'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise API v1 Production Route Registry
 * ============================================================================
 *
 * File:
 *   backend/routes/v1-production-routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical production API route registry for selected v1 capabilities:
 *
 *   1. Loan eligibility and management
 *   2. Administrative dashboard
 *   3. Community chat
 *   4. Referral system
 *   5. Security / monitoring
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
 *   RBAC / Object-Level Authorization
 *        ↓
 *   Idempotency for Financial Mutations
 *        ↓
 *   Controller
 *        ↓
 *   Service / Domain Layer
 *        ↓
 *   Audit / Ledger / Recovery where applicable
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This route file MUST NOT:
 *
 *   ✗ contain business logic
 *   ✗ mutate balances directly
 *   ✗ write ledger entries directly
 *   ✗ trust tenantId from a client request
 *   ✗ expose unrestricted administrator APIs
 *   ✗ expose fake/static financial metrics in production
 *   ✗ treat authentication as sufficient authorization
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
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

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

const authModule =
    require('../middleware/auth');

const {
    globalLimiter,
    authLimiter,
    emailLimiter,
    loanLimiter,
} =
    require('../middleware/securityHardening');

/**
 * ============================================================================
 * Controllers
 * ============================================================================
 */

const loanController =
    require('../controllers/loanController');

const adminController =
    require('../controllers/adminController');

const chatController =
    require('../controllers/chatController');

const referralController =
    require('../controllers/referralController');

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechV1ProductionRoutes';

const ROUTER_VERSION =
    '2026.1';

const API_VERSION =
    'v1';

const SERVICE_NAME =
    'TITech Community Capital API';

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

const MAX_PAGE =
    1_000_000;

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    100;

/**
 * ============================================================================
 * Authentication / Authorization Resolution
 * ============================================================================
 */

const verifyToken =
    authModule?.verifyToken ||
    authModule?.authenticate ||
    authModule?.verifyAccessToken;

const requireRole =
    authModule?.requireRole ||
    null;

if (
    typeof verifyToken !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
}

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 */

let tenantContextMiddleware =
    null;

try {
    const tenantModule =
        require(
            '../utils/admin/adminContext'
        );

    if (
        typeof tenantModule?.middleware ===
        'function'
    ) {
        tenantContextMiddleware =
            tenantModule.middleware({
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
    tenantContextMiddleware =
        null;
    }

function fallbackTenantContext(
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
                    'TENANT_CONTEXT_REQUIRED',

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
                    'ACTOR_CONTEXT_REQUIRED',

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

    req.routeActorId =
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
 * Request / Correlation Context
 * ============================================================================
 */

router.use(
    requestContextMiddleware
);

function requestContextMiddleware(
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
            process.env.TITECH_V1_BODY_LIMIT ||
            '512kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Controller Contract Validation
 * ============================================================================
 */

const REQUIRED_LOAN_HANDLERS =
    Object.freeze([
        'checkEligibility',
        'applyForLoan',
        'approveLoan',
        'rejectLoan',
        'disburseLoan',
        'repayLoan',
        'getLoanStatus',
        'getUserLoans',
        'getGroupLoans',
    ]);

const REQUIRED_ADMIN_HANDLERS =
    Object.freeze([
        'requireAdmin',
        'getDashboardMetrics',
        'getUsers',
        'getUserDetails',
        'verifyUser',
        'suspendUser',
        'activateUser',
        'getLoanRiskOverview',
        'getGroupOversight',
        'getAuditLog',
    ]);

const REQUIRED_CHAT_HANDLERS =
    Object.freeze([
        'sendMessage',
        'getGroupMessages',
        'markAsRead',
        'addReaction',
        'removeReaction',
        'flagMessage',
        'hideMessage',
        'getThreadedMessages',
    ]);

const REQUIRED_REFERRAL_HANDLERS =
    Object.freeze([
        'generateReferralCode',
        'getMyReferralCode',
        'useReferralCode',
        'getPendingReferrals',
        'getCompletedReferrals',
        'getReferralRewards',
        'getReferralDetails',
    ]);

validateControllerContract(
    loanController,
    'loanController',
    REQUIRED_LOAN_HANDLERS
);

validateControllerContract(
    adminController,
    'adminController',
    REQUIRED_ADMIN_HANDLERS
);

validateControllerContract(
    chatController,
    'chatController',
    REQUIRED_CHAT_HANDLERS
);

validateControllerContract(
    referralController,
    'referralController',
    REQUIRED_REFERRAL_HANDLERS
);

/**
 * ============================================================================
 * Global Authentication + Tenant Scope
 * ============================================================================
 *
 * Health/liveness is deliberately declared before this middleware.
 * Webhook-style public routes are not included in this registry.
 * ============================================================================
 */

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
                    SERVICE_NAME,

                apiVersion:
                    API_VERSION,

                version:
                    ROUTER_VERSION,

                status:
                    'UP',

                uptime:
                    process.uptime(),

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
 * Authentication
 * ============================================================================
 */

router.use(
    verifyToken
);

router.use(
    tenantContextMiddleware ||
    fallbackTenantContext
);

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

router.use(
    createScopedLimiter(
        globalLimiter,
        'global'
    )
);

/**
 * ============================================================================
 * Shared Validation
 * ============================================================================
 */

const mongoId =
    name =>
        param(name)
            .exists()
            .withMessage(
                `${name} is required.`
            )
            .bail()
            .isMongoId()
            .withMessage(
                `${name} must be a valid identifier.`
            );

const pagination =
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

/**
 * ============================================================================
 * Idempotency
 * ============================================================================
 */

const idempotencyFactory =
    resolveIdempotencyFactory();

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
                    'Idempotency-Key is required for this operation.',

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

    req.idempotencyKey =
        key;

    next();
}

function createIdempotency(
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
        ) => {
            const error =
                new Error(
                    'Persistent idempotency middleware is unavailable.'
                );

            error.code =
                'IDEMPOTENCY_UNAVAILABLE';

            error.statusCode =
                503;

            next(
                error
            );
        };
    }

    return idempotencyFactory({
        operation,
        resource,
        required:
            true,
    });
}

/**
 * ============================================================================
 * ROLE HELPERS
 * ============================================================================
 */

function adminOnly(
    req,
    res,
    next
) {
    if (
        typeof requireRole ===
        'function'
    ) {
        return requireRole(
            'ADMIN'
        )(
            req,
            res,
            next
        );
    }

    if (
        typeof adminController.requireAdmin ===
        'function'
    ) {
        return adminController.requireAdmin(
            req,
            res,
            next
        );
    }

    return res
        .status(503)
        .json({
            success:
                false,

            code:
                'ADMIN_AUTHORIZATION_UNAVAILABLE',

            message:
                'Administrative authorization is unavailable.',

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        });
}

function loanApprover(
    req,
    res,
    next
) {
    if (
        typeof requireRole ===
        'function'
    ) {
        return requireRole(
            'ADMIN',
            'GROUP_ADMIN',
            'TREASURER',
        )(
            req,
            res,
            next
        );
    }

    return adminOnly(
        req,
        res,
        next
    );
}

/**
 * ============================================================================
 * 1. LOAN ELIGIBILITY & MANAGEMENT
 * ============================================================================
 */

/**
 * GET /loans/eligibility/:groupId
 */
router.get(
    '/loans/eligibility/:groupId',

    loanLimiter,

    mongoId(
        'groupId'
    ),

    handleValidationErrors,

    asyncRoute(
        loanController.checkEligibility
    )
);

/**
 * POST /loans/apply
 *
 * Financial mutation:
 * requires idempotency.
 */
router.post(
    '/loans/apply',

    loanLimiter,

    amountValidation(),

    body('duration')
        .optional()
        .isInt({
            min:
                1,

            max:
                360,
        })
        .withMessage(
            'duration must be between 1 and 360 months.'
        ),

    body('purpose')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                1000,
        })
        .withMessage(
            'purpose is too long.'
        ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'LOAN_APPLICATION',
        'loan-applications'
    ),

    asyncRoute(
        loanController.applyForLoan
    )
);

/**
 * PUT /loans/:loanId/approve
 */
router.put(
    '/loans/:loanId/approve',

    loanLimiter,

    mongoId(
        'loanId'
    ),

    loanApprover,

    body('notes')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                1000,
        }),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'LOAN_APPROVAL',
        'loans'
    ),

    asyncRoute(
        loanController.approveLoan
    )
);

/**
 * PUT /loans/:loanId/reject
 */
router.put(
    '/loans/:loanId/reject',

    loanLimiter,

    mongoId(
        'loanId'
    ),

    loanApprover,

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
                1000,
        })
        .withMessage(
            'reason must contain 1-1000 characters.'
        ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'LOAN_REJECTION',
        'loans'
    ),

    asyncRoute(
        loanController.rejectLoan
    )
);

/**
 * PUT /loans/:loanId/disburse
 *
 * Financial mutation.
 */
router.put(
    '/loans/:loanId/disburse',

    loanLimiter,

    mongoId(
        'loanId'
    ),

    loanApprover,

    requireIdempotencyKey,

    createIdempotency(
        'LOAN_DISBURSEMENT',
        'loan-disbursements'
    ),

    asyncRoute(
        loanController.disburseLoan
    )
);

/**
 * PUT /loans/:loanId/pay
 *
 * Financial mutation.
 */
router.put(
    '/loans/:loanId/pay',

    loanLimiter,

    mongoId(
        'loanId'
    ),

    amountValidation(),

    body('method')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                100,
        }),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'LOAN_REPAYMENT',
        'loan-repayments'
    ),

    asyncRoute(
        loanController.repayLoan
    )
);

/**
 * GET /loans/user/my-loans
 *
 * Explicit route precedes :loanId.
 */
router.get(
    '/loans/user/my-loans',

    loanLimiter,

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        loanController.getUserLoans
    )
);

/**
 * GET /loans/group/:groupId
 */
router.get(
    '/loans/group/:groupId',

    loanLimiter,

    mongoId(
        'groupId'
    ),

    [
        ...pagination,
    ],

    handleValidationErrors,

    loanApprover,

    asyncRoute(
        loanController.getGroupLoans
    )
);

/**
 * GET /loans/:loanId
 */
router.get(
    '/loans/:loanId',

    mongoId(
        'loanId'
    ),

    handleValidationErrors,

    asyncRoute(
        loanController.getLoanStatus
    )
);

/**
 * ============================================================================
 * 2. ADMIN DASHBOARD
 * ============================================================================
 */

router.get(
    '/admin/dashboard',

    adminOnly,

    asyncRoute(
        adminController.getDashboardMetrics
    )
);

router.get(
    '/admin/users',

    adminOnly,

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        adminController.getUsers
    )
);

router.get(
    '/admin/users/:userId',

    adminOnly,

    mongoId(
        'userId'
    ),

    handleValidationErrors,

    asyncRoute(
        adminController.getUserDetails
    )
);

router.put(
    '/admin/users/:userId/verify',

    adminOnly,

    mongoId(
        'userId'
    ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'ADMIN_USER_VERIFY',
        'users'
    ),

    asyncRoute(
        adminController.verifyUser
    )
);

router.put(
    '/admin/users/:userId/suspend',

    adminOnly,

    mongoId(
        'userId'
    ),

    body('reason')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                1000,
        }),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'ADMIN_USER_SUSPEND',
        'users'
    ),

    asyncRoute(
        adminController.suspendUser
    )
);

router.put(
    '/admin/users/:userId/activate',

    adminOnly,

    mongoId(
        'userId'
    ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'ADMIN_USER_ACTIVATE',
        'users'
    ),

    asyncRoute(
        adminController.activateUser
    )
);

router.get(
    '/admin/loan-risk',

    adminOnly,

    asyncRoute(
        adminController.getLoanRiskOverview
    )
);

router.get(
    '/admin/groups',

    adminOnly,

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        adminController.getGroupOversight
    )
);

router.get(
    '/admin/audit-log',

    adminOnly,

    [
        ...pagination,
    ],

    query('severity')
        .optional()
        .isIn([
            'INFO',
            'WARN',
            'ERROR',
            'CRITICAL',
        ]),

    query('action')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                100,
        }),

    handleValidationErrors,

    asyncRoute(
        adminController.getAuditLog
    )
);

/**
 * ============================================================================
 * 3. CHAT
 * ============================================================================
 */

/**
 * POST /chat/:groupId
 */
router.post(
    '/chat/:groupId',

    mongoId(
        'groupId'
    ),

    body('message')
        .exists()
        .withMessage(
            'message is required.'
        )
        .bail()
        .isString()
        .trim()
        .isLength({
            min:
                1,

            max:
                5000,
        })
        .withMessage(
            'message must contain 1-5000 characters.'
        ),

    handleValidationErrors,

    asyncRoute(
        chatController.sendMessage
    )
);

router.get(
    '/chat/:groupId',

    mongoId(
        'groupId'
    ),

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        chatController.getGroupMessages
    )
);

router.put(
    '/chat/message/:messageId/read',

    mongoId(
        'messageId'
    ),

    handleValidationErrors,

    asyncRoute(
        chatController.markAsRead
    )
);

router.post(
    '/chat/message/:messageId/reaction',

    mongoId(
        'messageId'
    ),

    body('reaction')
        .exists()
        .withMessage(
            'reaction is required.'
        )
        .isString()
        .trim()
        .isLength({
            min:
                1,

            max:
                50,
        }),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'CHAT_REACTION_ADD',
        'chat-reactions'
    ),

    asyncRoute(
        chatController.addReaction
    )
);

router.delete(
    '/chat/message/:messageId/reaction',

    mongoId(
        'messageId'
    ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'CHAT_REACTION_REMOVE',
        'chat-reactions'
    ),

    asyncRoute(
        chatController.removeReaction
    )
);

router.post(
    '/chat/message/:messageId/flag',

    mongoId(
        'messageId'
    ),

    body('reason')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                500,
        }),

    handleValidationErrors,

    asyncRoute(
        chatController.flagMessage
    )
);

router.put(
    '/chat/message/:messageId/hide',

    adminOnly,

    mongoId(
        'messageId'
    ),

    body('reason')
        .optional()
        .isString()
        .trim()
        .isLength({
            max:
                500,
        }),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'CHAT_MESSAGE_HIDE',
        'chat-messages'
    ),

    asyncRoute(
        chatController.hideMessage
    )
);

router.get(
    '/chat/thread/:parentMessageId',

    mongoId(
        'parentMessageId'
    ),

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        chatController.getThreadedMessages
    )
);

/**
 * ============================================================================
 * 4. REFERRALS
 * ============================================================================
 */

router.post(
    '/referrals/generate',

    authLimiter,

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'REFERRAL_CODE_GENERATE',
        'referral-codes'
    ),

    asyncRoute(
        referralController.generateReferralCode
    )
);

router.get(
    '/referrals/my-code',

    asyncRoute(
        referralController.getMyReferralCode
    )
);

/**
 * Referral code application may be part of signup and can therefore be public,
 * but must have dedicated abuse protection.
 */
router.post(
    '/referrals/use',

    authLimiter,

    body('code')
        .exists()
        .withMessage(
            'Referral code is required.'
        )
        .bail()
        .isString()
        .trim()
        .isLength({
            min:
                3,

            max:
                100,
        }),

    body('userId')
        .not()
        .exists()
        .withMessage(
            'userId must not be supplied.'
        ),

    handleValidationErrors,

    requireIdempotencyKey,

    createIdempotency(
        'REFERRAL_CODE_USE',
        'referrals'
    ),

    asyncRoute(
        referralController.useReferralCode
    )
);

router.get(
    '/referrals/pending',

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        referralController.getPendingReferrals
    )
);

router.get(
    '/referrals/completed',

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        referralController.getCompletedReferrals
    )
);

router.get(
    '/referrals/rewards',

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        referralController.getReferralRewards
    )
);

router.get(
    '/referrals/:referralId',

    mongoId(
        'referralId'
    ),

    handleValidationErrors,

    asyncRoute(
        referralController.getReferralDetails
    )
);

/**
 * ============================================================================
 * 5. SECURITY / MONITORING
 * ============================================================================
 */

/**
 * Metrics must not return hard-coded fake values.
 *
 * Prefer an existing Prometheus/metrics service. If none exists, expose a
 * controlled operational response rather than fabricated financial metrics.
 */
router.get(
    '/metrics',

    async (
        req,
        res
    ) => {
        const metricsService =
            resolveMetricsService();

        if (
            !metricsService
        ) {
            return res
                .status(503)
                .type(
                    'text/plain'
                )
                .send(
                    '# TITech metrics unavailable\n'
                );
        }

        try {
            if (
                typeof metricsService
                    .getPrometheusMetrics ===
                'function'
            ) {
                const output =
                    await metricsService
                        .getPrometheusMetrics();

                return res
                    .status(200)
                    .type(
                        'text/plain'
                    )
                    .send(
                        output
                    );
            }

            if (
                typeof metricsService
                    .getMetrics ===
                'function'
            ) {
                const data =
                    await metricsService
                        .getMetrics();

                return res
                    .status(200)
                    .json({
                        success:
                            true,

                        service:
                            SERVICE_NAME,

                        metrics:
                            data,

                        timestamp:
                            new Date()
                                .toISOString(),

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    });
            }

            return res
                .status(503)
                .type(
                    'text/plain'
                )
                .send(
                    '# TITech metrics unavailable\n'
                );
        } catch (
            error
        ) {
            return res
                .status(503)
                .type(
                    'text/plain'
                )
                .send(
                    '# TITech metrics temporarily unavailable\n'
                );
        }
    }
);

/**
 * Security audit trail.
 */
router.get(
    '/security/audit-trail',

    adminOnly,

    [
        ...pagination,
    ],

    handleValidationErrors,

    asyncRoute(
        adminController.getAuditLog
    )
);

/**
 * ============================================================================
 * 6. LEGACY LOAN COMPATIBILITY
 * ============================================================================
 *
 * Preserve compatibility while directing clients to the canonical endpoint.
 *
 * 308 is used rather than 301 so a POST remains a POST.
 * ============================================================================
 */

router.post(
    '/loans',

    (
        req,
        res
    ) => {
        return res
            .status(308)
            .json({
                success:
                    false,

                code:
                    'ENDPOINT_MOVED',

                message:
                    'This endpoint has moved to POST /api/v1/loans/apply.',

                url:
                    '/api/v1/loans/apply',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),
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
                    'API_ROUTE_NOT_FOUND',

                message:
                    'The requested TITech API route was not found.',

                path:
                    req.originalUrl ||
                    req.url,

                method:
                    req.method,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),
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
            ) >=
                400 &&
            Number(
                error?.statusCode
            ) <
                600
                ? Number(
                    error.statusCode
                )
                : 500;

        const clientError =
            statusCode >=
                400 &&
            statusCode <
                500;

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
                            ? 'API_REQUEST_ERROR'
                            : 'API_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The request could not be completed.'
                        )
                        : 'The request could not be completed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Helpers
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

function amountValidation() {
    return body('amount')
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
                        .TITECH_MAX_LOAN_AMOUNT ||
                    1_000_000_000_000_000
                ),
        })
        .withMessage(
            'amount must be positive and within the supported limit.'
        )
        .toFloat();
}

function validateControllerContract(
    controller,
    controllerName,
    methods
) {
    for (
        const method of methods
    ) {
        if (
            typeof controller?.[
                method
            ] !==
            'function'
        ) {
            throw new TypeError(
                `[${ROUTER_NAME}] ${controllerName}.${method} is required.`
            );
        }
    }
}

function asyncRoute(
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

function handleValidationErrors(
    req,
    res,
    next
) {
    /**
     * Reuse project validation infrastructure when available.
     */
    try {
        const validators =
            require(
                '../utils/validators'
            );

        const handler =
            validators?.handleValidation ||
            validators?.handleValidationErrors;

        if (
            typeof handler ===
            'function'
        ) {
            return handler(
                req,
                res,
                next
            );
        }
    } catch (
        error
    ) {
        if (
            error?.code !==
            'MODULE_NOT_FOUND'
        ) {
            return next(
                error
            );
        }
    }

    return next();
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

function resolveMetricsService() {
    const candidates =
        [
            '../services/metricsService',
            '../services/metrics.service',
            '../utils/metrics',
        ];

    for (
        const candidate of
        candidates
    ) {
        try {
            const loaded =
                require(
                    candidate
                );

            return (
                loaded?.default ||
                loaded
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

function createScopedLimiter(
    limiter,
    name
) {
    if (
        typeof limiter ===
        'function'
    ) {
        return limiter;
    }

    return (
        req,
        res,
        next
    ) => next();
}