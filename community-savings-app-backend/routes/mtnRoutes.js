'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise MTN Mobile Money Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/mtnRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for MTN Mobile Money collections, disbursements,
 * transaction status, reconciliation, health and operational metrics.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * Financial mutations:
 *
 *   POST /deposit
 *   POST /repay-loan
 *   POST /contribute-savings
 *   POST /withdraw
 *   POST /disburse
 *   POST /bulk-disburse
 *
 * Provider callback:
 *
 *   POST /webhook
 *
 * Read / operations:
 *
 *   GET /status/:reference
 *   GET /reconciliation/:date
 *   GET /health
 *   GET /metrics
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Authenticated financial request:
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Context
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Role / Permission
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Request Validation
 *        ↓
 *   Idempotency
 *        ↓
 *   MTN Controller
 *        ↓
 *   MTN Integration Service
 *        ↓
 *   Financial Transaction / Ledger / Audit
 *
 * Provider callback:
 *
 *   MTN
 *    ↓
 *   Webhook Authenticity Verification
 *    ↓
 *   Replay / Idempotency Protection
 *    ↓
 *   MTN Webhook Service
 *    ↓
 *   Financial Posting
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ mutate balances directly
 *   ✗ post ledger entries directly
 *   ✗ trust tenantId from req.body/query
 *   ✗ use JWT authentication for MTN callbacks
 *   ✗ silently bypass missing security middleware
 *   ✗ expose internal provider/database exceptions
 *
 * Business and financial logic belongs to controller/service/domain layers.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced by TITech Community Capital.
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
            false,
    });

const mtnController =
    require(
        '../controllers/mtnController'
    );

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechMtnRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech MTN Mobile Money API';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_MTN_BODY_LIMIT ||
    '1mb';

const MAX_REFERENCE_LENGTH =
    255;

const MAX_DATE_LENGTH =
    64;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

const REQUIRED_HANDLERS =
    Object.freeze([
        'deposit',
        'repayLoan',
        'contributeSavings',
        'withdraw',
        'disburse',
        'bulkDisburse',
        'webhook',
        'getStatus',
        'getReconciliation',
        'health',
        'metrics',
    ]);

for (
    const handler
    of REQUIRED_HANDLERS
) {
    if (
        typeof mtnController?.[
            handler
        ] !==
        'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Missing mtnController.${handler} export.`
        );
    }
}

/**
 * ============================================================================
 * Common Helpers
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
 * Request / Correlation Metadata
 * ============================================================================
 */

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
 * Body Parser
 * ============================================================================
 *
 * Do not globally parse the webhook here if the MTN integration requires the
 * raw request bytes for signature verification. The webhook controller/service
 * should own provider-specific body parsing.
 * ============================================================================
 */

const jsonParser =
    express.json({
        limit:
            DEFAULT_BODY_LIMIT,

        strict:
            true,
    });

/**
 * ============================================================================
 * Security Middleware Resolution
 * ============================================================================
 */

const authenticate =
    resolveRequiredMiddleware(
        [
            '../middleware/auth',
            '../middleware/authMiddleware',
            '../middleware/authentication',
            '../middleware/requireAuth',
        ],
        [
            'verifyToken',
            'verifyAccessToken',
            'authenticate',
            'requireAuth',
        ],
        'authentication'
    );

const authorize =
    resolveRequiredMiddleware(
        [
            '../middleware/authorize',
            '../middleware/authorization',
        ],
        [
            'authorize',
            'requireRole',
        ],
        'authorization'
    );

const tenantAuthorization =
    resolveRequiredMiddleware(
        [
            '../middleware/tenantAuthorization',
            '../middleware/tenant.authorization',
            '../middleware/tenantMiddleware',
            '../middleware/tenant',
        ],
        [
            'tenantAuthorization',
            'requireTenant',
            'tenantMiddleware',
        ],
        'tenant authorization'
    );

/**
 * ============================================================================
 * Idempotency Middleware
 * ============================================================================
 */

const idempotencyFactory =
    resolveRequiredModuleExport(
        [
            '../middleware/idempotency',
        ],
        [
            'idempotency',
        ],
        'idempotency'
    );

/**
 * ============================================================================
 * Tenant Context
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
 * Do not accept tenant identity from body/query.
 */
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
                    'MTN_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for MTN Mobile Money operations.',

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
                    'MTN_ACTOR_CONTEXT_REQUIRED',

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

    req.mtnActorId =
        actorId;

    next();
}

/**
 * ============================================================================
 * Rate Limiters
 * ============================================================================
 */

const collectionLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_COLLECTION_RATE_LIMIT',
                30
            ),

        code:
            'MTN_COLLECTION_RATE_LIMITED',

        message:
            'Too many MTN collection requests. Please try again later.',
    });

const repaymentLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_REPAYMENT_RATE_LIMIT',
                30
            ),

        code:
            'MTN_REPAYMENT_RATE_LIMITED',

        message:
            'Too many MTN repayment requests. Please try again later.',
    });

const savingsLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_SAVINGS_RATE_LIMIT',
                30
            ),

        code:
            'MTN_SAVINGS_RATE_LIMITED',

        message:
            'Too many MTN savings contribution requests. Please try again later.',
    });

const disbursementLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_DISBURSEMENT_RATE_LIMIT',
                20
            ),

        code:
            'MTN_DISBURSEMENT_RATE_LIMITED',

        message:
            'Too many MTN disbursement requests. Please try again later.',
    });

const webhookLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_WEBHOOK_RATE_LIMIT',
                300
            ),

        code:
            'MTN_WEBHOOK_RATE_LIMITED',

        message:
            'Too many MTN webhook requests.',
    });

const readLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_READ_RATE_LIMIT',
                180
            ),

        code:
            'MTN_READ_RATE_LIMITED',

        message:
            'Too many MTN API requests. Please try again later.',
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
                    req.mtnActorId ||
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
 * Generic Validation
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
                    'Idempotency-Key is required for MTN financial mutations.',

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
                    'INVALID_MTN_REQUEST_BODY',

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

/**
 * ============================================================================
 * Provider Reference Validation
 * ============================================================================
 */

function validateReference(
    req,
    res,
    next
) {
    const reference =
        normalizeString(
            req.params.reference
        );

    if (
        !reference
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_REFERENCE_REQUIRED',

                message:
                    'Reference parameter is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        reference.length >
        MAX_REFERENCE_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_REFERENCE_INVALID',

                message:
                    'Reference parameter is too long.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        /[\u0000-\u001F\u007F]/.test(
            reference
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_REFERENCE_INVALID',

                message:
                    'Reference parameter contains unsupported characters.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.validatedReference =
        reference;

    next();
}

/**
 * ============================================================================
 * Reconciliation Date Validation
 * ============================================================================
 */

function validateDate(
    req,
    res,
    next
) {
    const date =
        normalizeString(
            req.params.date
        );

    if (
        !date
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_DATE_REQUIRED',

                message:
                    'Reconciliation date is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        date.length >
        MAX_DATE_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_DATE_INVALID',

                message:
                    'Reconciliation date is invalid.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    /**
     * Prefer YYYY-MM-DD for reconciliation endpoints.
     */
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            date
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_DATE_INVALID',

                message:
                    'Reconciliation date must use YYYY-MM-DD format.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const parsed =
        new Date(
            `${date}T00:00:00.000Z`
        );

    if (
        Number.isNaN(
            parsed.getTime()
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_DATE_INVALID',

                message:
                    'Invalid reconciliation date.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.validatedDate =
        date;

    next();
}

/**
 * ============================================================================
 * Financial Idempotency
 * ============================================================================
 */

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
 * Collection Routes
 * ============================================================================
 */

router.post(
    '/deposit',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    collectionLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_DEPOSIT',
        'mtn-deposits'
    ),

    asyncHandler(
        mtnController.deposit
    )
);

router.post(
    '/repay-loan',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    repaymentLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_LOAN_REPAYMENT',
        'mtn-loan-repayments'
    ),

    asyncHandler(
        mtnController.repayLoan
    )
);

router.post(
    '/contribute-savings',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    savingsLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_SAVINGS_CONTRIBUTION',
        'mtn-savings-contributions'
    ),

    asyncHandler(
        mtnController.contributeSavings
    )
);

/**
 * ============================================================================
 * Disbursement Routes
 * ============================================================================
 */

router.post(
    '/withdraw',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    disbursementLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_WITHDRAWAL',
        'mtn-withdrawals'
    ),

    asyncHandler(
        mtnController.withdraw
    )
);

router.post(
    '/disburse',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    disbursementLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_DISBURSEMENT',
        'mtn-disbursements'
    ),

    asyncHandler(
        mtnController.disburse
    )
);

router.post(
    '/bulk-disburse',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    disbursementLimiter,

    jsonParser,

    requireObjectBody,

    requireIdempotencyKey,

    createIdempotencyMiddleware(
        'MTN_BULK_DISBURSEMENT',
        'mtn-bulk-disbursements'
    ),

    asyncHandler(
        mtnController.bulkDisburse
    )
);

/**
 * ============================================================================
 * Webhook
 * ============================================================================
 *
 * MTN is the caller.
 *
 * DO NOT add:
 *
 *   authenticate
 *   tenantAuthorization
 *
 * The webhook controller must authenticate the provider callback using the
 * provider-specific mechanism and must establish the correct TITech tenant from
 * the persisted transaction/reference.
 * ============================================================================
 */

router.post(
    '/webhook',

    webhookLimiter,

    asyncHandler(
        mtnController.webhook
    )
);

/**
 * ============================================================================
 * Status
 * ============================================================================
 */

router.get(
    '/status/:reference',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    readLimiter,

    validateReference,

    asyncHandler(
        mtnController.getStatus
    )
);

/**
 * ============================================================================
 * Reconciliation
 * ============================================================================
 */

router.get(
    '/reconciliation/:date',

    authenticate,

    tenantAuthorization,

    adminContextMiddleware ||
        requireTrustedTenant,

    readLimiter,

    validateDate,

    asyncHandler(
        mtnController.getReconciliation
    )
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 *
 * Keep health lightweight. Provider connectivity/readiness belongs in the
 * controller or centralized health subsystem.
 * ============================================================================
 */

router.get(
    '/health',

    authenticate,

    readLimiter,

    asyncHandler(
        mtnController.health
    )
);

/**
 * ============================================================================
 * Metrics
 * ============================================================================
 *
 * Operational metrics should remain authenticated and appropriately
 * authorized.
 * ============================================================================
 */

router.get(
    '/metrics',

    authenticate,

    readLimiter,

    asyncHandler(
        mtnController.metrics
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
                    'MTN_ROUTE_NOT_FOUND',

                message:
                    'MTN Mobile Money endpoint not found.',

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
                            ? 'MTN_REQUEST_ERROR'
                            : 'MTN_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The MTN Mobile Money request could not be completed.'
                        )
                        : 'The MTN Mobile Money request could not be completed.',

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
 * Middleware Resolution
 * ============================================================================
 */

function resolveRequiredMiddleware(
    candidates,
    exports,
    name
) {
    const moduleValue =
        resolveOptionalModule(
            candidates
        );

    const middleware =
        resolveMiddlewareExport(
            moduleValue,
            exports
        );

    if (
        typeof middleware !==
        'function'
    ) {
        throw new Error(
            `[${ROUTER_NAME}] Required ${name} middleware is not configured.`
        );
    }

    return middleware;
}

function resolveRequiredModuleExport(
    candidates,
    exports,
    name
) {
    const moduleValue =
        resolveOptionalModule(
            candidates
        );

    const resolved =
        resolveMiddlewareExport(
            moduleValue,
            exports
        );

    if (
        typeof resolved !==
        'function'
    ) {
        throw new Error(
            `[${ROUTER_NAME}] Required ${name} middleware is not configured.`
        );
    }

    return resolved;
}

function resolveOptionalModule(
    candidates
) {
    for (
        const candidate
        of candidates
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

function resolveMiddlewareExport(
    moduleValue,
    exports
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
        const exportName
        of exports
    ) {
        if (
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