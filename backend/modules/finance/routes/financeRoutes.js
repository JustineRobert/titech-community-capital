'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Enterprise Finance Routes
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/routes/financeRoutes.js
 *
 * Purpose:
 *   Production-grade HTTP route boundary for Finance Core operations.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 *   • Stable Finance API route registration
 *   • Authentication / authorization integration hooks
 *   • Tenant isolation
 *   • Correlation / request / operation identity propagation
 *   • Idempotency-key propagation
 *   • Input validation and bounded request metadata
 *   • Finance operation orchestration
 *   • Ledger posting
 *   • Reversals
 *   • Statement processing
 *   • Reconciliation
 *   • Period operations
 *   • Finance health / diagnostics
 *   • Structured request logging
 *   • Metrics integration
 *   • Trace context propagation
 *   • Safe async error handling
 *   • Consistent API response envelopes
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 *
 *   This router MUST remain an HTTP boundary.
 *
 *   It MUST NOT:
 *
 *     - modify database balances directly
 *     - construct ledger entries directly
 *     - bypass LedgerEngine
 *     - bypass ReversalEngine
 *     - bypass StatementProcessingService
 *     - bypass ReconciliationService
 *     - perform raw MongoDB mutations
 *
 *   Financial authority remains in Finance Core services.
 *
 * Compatibility:
 * ----------------------------------------------------------------------------
 *   • Express 4 / Express 5 compatible
 *   • CommonJS
 *   • Optional dependencies supported
 *   • Existing middleware can be injected
 *   • Existing service APIs remain untouched
 *
 * Typical registration:
 *
 *   const {
 *       createFinanceRouter
 *   } = require('./modules/finance/routes/financeRoutes');
 *
 *   app.use(
 *       '/api/v1/finance',
 *       createFinanceRouter({
 *           authMiddleware,
 *           tenantMiddleware,
 *           authorizationMiddleware,
 *           services: {
 *               ledgerEngine,
 *               reversalEngine,
 *               statementProcessingService,
 *               reconciliationService,
 *               periodEngine,
 *           },
 *           observability: {
 *               tracing,
 *               metrics,
 *           },
 *           logger,
 *       })
 *   );
 *
 * ============================================================================
 */

const express = require('express');
const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const ROUTER_NAME =
    'financeRoutes';

const API_DOMAIN =
    'finance';

const API_VERSION =
    'v1';

const MODULE_NAME =
    'finance-core';

const MAX_REASON_LENGTH =
    2000;

const MAX_METADATA_KEYS =
    50;

const MAX_PAGE_LIMIT =
    100;

const DEFAULT_PAGE_LIMIT =
    50;

const REQUEST_ID_HEADER =
    'x-request-id';

const CORRELATION_ID_HEADER =
    'x-correlation-id';

const IDEMPOTENCY_KEY_HEADER =
    'idempotency-key';

const TENANT_ID_HEADER =
    'x-tenant-id';

const OPERATION_ID_HEADER =
    'x-operation-id';

const TRACE_ID_HEADER =
    'x-trace-id';

const SUPPORTED_REVERSAL_TYPES =
    Object.freeze([
        'REFUND',
        'SETTLEMENT',
        'LOAN_DISBURSEMENT',
        'ADJUSTMENT',
    ]);

const ROUTE_TAGS =
    Object.freeze({
        LEDGER:
            'ledger',

        REVERSAL:
            'reversal',

        STATEMENT:
            'statement',

        RECONCILIATION:
            'reconciliation',

        PERIOD:
            'period',

        HEALTH:
            'health',
    });

const SENSITIVE_KEY_PATTERNS =
    Object.freeze([
        /password/i,
        /token/i,
        /secret/i,
        /authorization/i,
        /cookie/i,
        /private.?key/i,
        /passcode/i,
        /pin/i,
        /otp/i,
        /cvv/i,
        /card.?number/i,
        /account.?number/i,
        /wallet.?number/i,
        /national.?id/i,
        /identity.?number/i,
        /raw.?payload/i,
        /raw.?statement/i,
        /request.?body/i,
        /response.?body/i,
    ]);

/* ============================================================================
 * Errors
 * ========================================================================== */

class FinanceRouteError extends Error {

    constructor(
        code,
        message,
        statusCode = 400,
        metadata = {},
        cause = null
    ) {

        super(message);

        this.name =
            'FinanceRouteError';

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        if (
            cause
        ) {

            this.cause =
                cause;
        }

        Error.captureStackTrace?.(
            this,
            FinanceRouteError
        );
    }
}

/* ============================================================================
 * Utility helpers
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
    value
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
        ).trim();

    return normalized ||
        null;
}

function requireValue(
    value,
    fieldName
) {

    const normalized =
        normalizeId(
            value
        );

    if (
        !normalized
    ) {

        throw new FinanceRouteError(
            'VALIDATION_ERROR',
            `${fieldName} is required`,
            400,
            {
                fieldName,
            }
        );
    }

    return normalized;
}

function normalizeReason(
    value
) {

    const normalized =
        normalizeId(
            value
        );

    if (
        !normalized
    ) {

        throw new FinanceRouteError(
            'VALIDATION_ERROR',
            'reason is required',
            400,
            {
                fieldName:
                    'reason',
            }
        );
    }

    return normalized.slice(
        0,
        MAX_REASON_LENGTH
    );
}

function normalizeLimit(
    value
) {

    const parsed =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <= 0
    ) {

        return DEFAULT_PAGE_LIMIT;
    }

    return Math.min(
        parsed,
        MAX_PAGE_LIMIT
    );
}

function normalizePage(
    value
) {

    const parsed =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <= 0
    ) {

        return 1;
    }

    return parsed;
}

function normalizeDate(
    value,
    fieldName
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    const date =
        new Date(
            value
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new FinanceRouteError(
            'VALIDATION_ERROR',
            `${fieldName} must be a valid date`,
            400,
            {
                fieldName,
            }
        );
    }

    return date;
}

function normalizeEnum(
    value,
    allowed,
    fieldName
) {

    const normalized =
        String(
            value ||
            ''
        )
            .trim()
            .toUpperCase();

    if (
        !allowed.includes(
            normalized
        )
    ) {

        throw new FinanceRouteError(
            'VALIDATION_ERROR',
            `Invalid ${fieldName}`,
            400,
            {
                fieldName,
                allowed,
            }
        );
    }

    return normalized;
}

function sanitizeObject(
    value = {},
    depth = 0
) {

    if (
        depth > 3
    ) {

        return '[max-depth]';
    }

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    if (
        typeof value ===
        'string'
    ) {

        return value.slice(
            0,
            MAX_REASON_LENGTH
        );
    }

    if (
        typeof value ===
            'number' ||
        typeof value ===
            'boolean'
    ) {

        return value;
    }

    if (
        value instanceof Date
    ) {

        return value.toISOString();
    }

    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .slice(
                0,
                MAX_METADATA_KEYS
            )
            .map(
                item =>
                    sanitizeObject(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        typeof value ===
        'object'
    ) {

        const output = {};
        let count = 0;

        for (
            const [
                key,
                nestedValue,
            ] of Object.entries(
                value
            )
        ) {

            if (
                count >=
                MAX_METADATA_KEYS
            ) {

                break;
            }

            if (
                SENSITIVE_KEY_PATTERNS.some(
                    pattern =>
                        pattern.test(
                            key
                        )
                )
            ) {

                continue;
            }

            output[
                String(
                    key
                ).slice(
                    0,
                    128
                )
            ] =
                sanitizeObject(
                    nestedValue,
                    depth + 1
                );

            count++;
        }

        return output;
    }

    return String(
        value
    ).slice(
        0,
        MAX_REASON_LENGTH
    );
}

function isPlainObject(
    value
) {

    return (
        value !== null &&
        typeof value ===
            'object' &&
        !Array.isArray(
            value
        )
    );
}

function isPromiseLike(
    value
) {

    return (
        value !== null &&
        value !== undefined &&
        typeof value.then ===
            'function'
    );
}

/* ============================================================================
 * Safe middleware wrappers
 * ========================================================================== */

function normalizeMiddleware(
    middleware
) {

    if (
        typeof middleware ===
        'function'
    ) {

        return middleware;
    }

    return (
        _req,
        _res,
        next
    ) => next();
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
                isPromiseLike(
                    result
                )
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
 * Default request context
 * ========================================================================== */

function extractRequestIdentity(
    req
) {

    const header =
        req.headers ||
        {};

    const requestId =
        normalizeId(
            header[
                REQUEST_ID_HEADER
            ]
        ) ||
        normalizeId(
            req.requestId
        ) ||
        generateId();

    const correlationId =
        normalizeId(
            header[
                CORRELATION_ID_HEADER
            ]
        ) ||
        normalizeId(
            req.correlationId
        ) ||
        requestId;

    const operationId =
        normalizeId(
            header[
                OPERATION_ID_HEADER
            ]
        ) ||
        normalizeId(
            req.operationId
        ) ||
        generateId();

    const idempotencyKey =
        normalizeId(
            header[
                IDEMPOTENCY_KEY_HEADER
            ]
        ) ||
        normalizeId(
            req.idempotencyKey
        );

    const traceId =
        normalizeId(
            header[
                TRACE_ID_HEADER
            ]
        ) ||
        normalizeId(
            req.traceId
        );

    const tenantId =
        normalizeId(
            req.tenantId
        ) ||
        normalizeId(
            header[
                TENANT_ID_HEADER
            ]
        );

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

    return {
        requestId,
        correlationId,
        operationId,
        idempotencyKey,
        traceId,
        tenantId,
        userId,
    };
}

/* ============================================================================
 * Response helpers
 * ========================================================================== */

function setIdentityHeaders(
    res,
    context
) {

    if (
        context.requestId
    ) {

        res.setHeader(
            REQUEST_ID_HEADER,
            context.requestId
        );
    }

    if (
        context.correlationId
    ) {

        res.setHeader(
            CORRELATION_ID_HEADER,
            context.correlationId
        );
    }

    if (
        context.operationId
    ) {

        res.setHeader(
            OPERATION_ID_HEADER,
            context.operationId
        );
    }

    if (
        context.traceId
    ) {

        res.setHeader(
            TRACE_ID_HEADER,
            context.traceId
        );
    }
}

function sendSuccess(
    res,
    {
        statusCode = 200,
        data = null,
        context = {},
        meta = {},
    } = {}
) {

    setIdentityHeaders(
        res,
        context
    );

    return res
        .status(
            statusCode
        )
        .json({
            success:
                true,

            data,

            meta: {
                ...meta,

                requestId:
                    context.requestId ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                operationId:
                    context.operationId ||
                    null,

                traceId:
                    context.traceId ||
                    null,

                timestamp:
                    new Date()
                        .toISOString()
            },
        });
}

function sendCreated(
    res,
    data,
    context,
    meta = {}
) {

    return sendSuccess(
        res,
        {
            statusCode:
                201,

            data,

            context,

            meta,
        }
    );
}

function sendAccepted(
    res,
    data,
    context,
    meta = {}
) {

    return sendSuccess(
        res,
        {
            statusCode:
                202,

            data,

            context,

            meta,
        }
    );
}

/* ============================================================================
 * Request-context middleware
 * ========================================================================== */

function createContextMiddleware(
    {
        requireTenant = true,
        requireAuthentication = false,
    } = {}
) {

    return (
        req,
        res,
        next
    ) => {

        try {

            const identity =
                extractRequestIdentity(
                    req
                );

            /*
             * Do not overwrite a stronger upstream tenant resolution.
             */
            if (
                identity.tenantId
            ) {

                req.tenantId =
                    identity.tenantId;
            }

            req.requestId =
                identity.requestId;

            req.correlationId =
                identity.correlationId;

            req.operationId =
                identity.operationId;

            req.idempotencyKey =
                identity.idempotencyKey;

            req.traceId =
                identity.traceId;

            req.financeContext = {

                ...identity,

                module:
                    MODULE_NAME,

                apiDomain:
                    API_DOMAIN,

                apiVersion:
                    API_VERSION,

                service:
                    req.serviceName ||
                    MODULE_NAME
            };

            if (
                requireAuthentication &&
                !identity.userId
            ) {

                throw new FinanceRouteError(
                    'AUTHENTICATION_REQUIRED',
                    'Authentication is required',
                    401
                );
            }

            if (
                requireTenant &&
                !identity.tenantId
            ) {

                throw new FinanceRouteError(
                    'TENANT_REQUIRED',
                    'Tenant context is required',
                    400
                );
            }

            setIdentityHeaders(
                res,
                req.financeContext
            );

            next();

        } catch (error) {

            next(
                error
            );
        }
    };
}

/* ============================================================================
 * Service resolver
 * ========================================================================== */

function resolveServices(
    options
) {

    const services =
        options.services ||
        {};

    return {

        ledgerEngine:
            services.ledgerEngine ||
            options.ledgerEngine ||
            null,

        ledgerRepository:
            services.ledgerRepository ||
            options.ledgerRepository ||
            services.ledgerEngine
                ?.repositories
                ?.ledger ||
            options.ledgerEngine
                ?.repositories
                ?.ledger ||
            null,

        reversalEngine:
            services.reversalEngine ||
            options.reversalEngine ||
            null,

        adjustmentManager:
            services.adjustmentManager ||
            options.adjustmentManager ||
            null,

        statementProcessingService:
            services.statementProcessingService ||
            options.statementProcessingService ||
            null,

        statementRepository:
            services.statementRepository ||
            options.statementRepository ||
            null,

        reconciliationService:
            services.reconciliationService ||
            options.reconciliationService ||
            null,

        periodEngine:
            services.periodEngine ||
            options.periodEngine ||
            null,

        financialStatementService:
            services.financialStatementService ||
            options.financialStatementService ||
            null,

        balanceService:
            services.balanceService ||
            options.balanceService ||
            null,

        snapshotEngine:
            services.snapshotEngine ||
            options.snapshotEngine ||
            null,

        auditService:
            services.auditService ||
            options.auditService ||
            null,
    };
}

function requireService(
    service,
    name
) {

    if (
        !service
    ) {

        throw new FinanceRouteError(
            'SERVICE_UNAVAILABLE',
            `${name} is unavailable`,
            503,
            {
                service:
                    name
            }
        );
    }

    return service;
}

function requireMethod(
    service,
    method,
    serviceName
) {

    requireService(
        service,
        serviceName
    );

    if (
        typeof service[
            method
        ] !==
        'function'
    ) {

        throw new FinanceRouteError(
            'SERVICE_METHOD_UNAVAILABLE',
            `${serviceName}.${method}() is unavailable`,
            503,
            {
                service:
                    serviceName,

                method
            }
        );
    }

    return service[
        method
    ].bind(
        service
    );
}

/* ============================================================================
 * Finance context builder
 * ========================================================================== */

function buildFinanceContext(
    req,
    additional = {}
) {

    const base =
        req.financeContext ||
        extractRequestIdentity(
            req
        );

    return {

        ...base,

        ...sanitizeObject(
            additional
        ),

        tenantId:
            normalizeId(
                additional.tenantId
            ) ||
            normalizeId(
                base.tenantId
            ),

        userId:
            normalizeId(
                additional.userId
            ) ||
            normalizeId(
                base.userId
            ),

        requestId:
            normalizeId(
                additional.requestId
            ) ||
            normalizeId(
                base.requestId
            ),

        correlationId:
            normalizeId(
                additional.correlationId
            ) ||
            normalizeId(
                base.correlationId
            ),

        operationId:
            normalizeId(
                additional.operationId
            ) ||
            normalizeId(
                base.operationId
            ),

        idempotencyKey:
            normalizeId(
                additional.idempotencyKey
            ) ||
            normalizeId(
                base.idempotencyKey
            ),

        traceId:
            normalizeId(
                additional.traceId
            ) ||
            normalizeId(
                base.traceId
            )
    };
}

/* ============================================================================
 * Factory
 * ========================================================================== */

function createFinanceRouter(
    options = {}
) {

    const router =
        express.Router({
            mergeParams:
                true,

            caseSensitive:
                false,

            strict:
                false,
        });

    const services =
        resolveServices(
            options
        );

    const logger =
        options.logger ||
        console;

    const metrics =
        options.metrics ||
        options.observability
            ?.metrics ||
        null;

    const tracing =
        options.tracing ||
        options.observability
            ?.tracing ||
        null;

    const authMiddleware =
        normalizeMiddleware(
            options.authMiddleware ||
            options.authenticate
        );

    const tenantMiddleware =
        normalizeMiddleware(
            options.tenantMiddleware ||
            options.resolveTenant
        );

    const authorizationMiddleware =
        normalizeMiddleware(
            options.authorizationMiddleware ||
            options.authorizeFinance
        );

    const rateLimitMiddleware =
        normalizeMiddleware(
            options.rateLimitMiddleware
        );

    const requestContextMiddleware =
        createContextMiddleware({
            requireTenant:
                options.requireTenant !==
                false,

            requireAuthentication:
                options.requireAuthentication ===
                true,
        });

    /*
     * Middleware order is deliberate:
     *
     * 1. Authentication
     * 2. Tenant resolution
     * 3. Request identity
     * 4. Authorization
     * 5. Rate limiting
     *
     * Finance business handlers only run after the operational context has
     * been established.
     */
    router.use(
        authMiddleware
    );

    router.use(
        tenantMiddleware
    );

    router.use(
        requestContextMiddleware
    );

    router.use(
        authorizationMiddleware
    );

    router.use(
        rateLimitMiddleware
    );

    /* ========================================================================
     * HEALTH / DIAGNOSTICS
     * ====================================================================== */

    router.get(
        '/health',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const servicesState = {

                    ledgerEngine:
                        Boolean(
                            services.ledgerEngine
                        ),

                    ledgerRepository:
                        Boolean(
                            services.ledgerRepository
                        ),

                    reversalEngine:
                        Boolean(
                            services.reversalEngine
                        ),

                    statementProcessingService:
                        Boolean(
                            services
                                .statementProcessingService
                        ),

                    reconciliationService:
                        Boolean(
                            services
                                .reconciliationService
                        ),

                    periodEngine:
                        Boolean(
                            services.periodEngine
                        ),
                };

                const available =
                    Object.values(
                        servicesState
                    ).filter(Boolean).length;

                const required =
                    Object.keys(
                        servicesState
                    ).length;

                const healthy =
                    available ===
                    required;

                return sendSuccess(
                    res,
                    {
                        statusCode:
                            healthy
                                ? 200
                                : 503,

                        data: {
                            status:
                                healthy
                                    ? 'healthy'
                                    : 'degraded',

                            module:
                                MODULE_NAME,

                            domain:
                                API_DOMAIN,

                            version:
                                API_VERSION,

                            services:
                                servicesState,

                            tracing:
                                typeof tracing
                                    ?.diagnostics ===
                                    'function'
                                    ? tracing
                                        .diagnostics()
                                    : null,

                            timestamp:
                                new Date()
                                    .toISOString(),
                        },

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    router.get(
        '/diagnostics',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const diagnostics = {};

                const diagnosticServices =
                    [
                        [
                            'ledgerEngine',
                            services.ledgerEngine,
                        ],

                        [
                            'reversalEngine',
                            services.reversalEngine,
                        ],

                        [
                            'statementProcessingService',
                            services
                                .statementProcessingService,
                        ],

                        [
                            'reconciliationService',
                            services
                                .reconciliationService,
                        ],

                        [
                            'periodEngine',
                            services.periodEngine,
                        ],
                    ];

                for (
                    const [
                        name,
                        service,
                    ]
                    of diagnosticServices
                ) {

                    if (
                        typeof service
                            ?.diagnostics ===
                        'function'
                    ) {

                        try {

                            diagnostics[name] =
                                await service
                                    .diagnostics();

                        } catch (error) {

                            diagnostics[name] = {
                                available:
                                    false,

                                error:
                                    normalizeError(
                                        error
                                    ),
                            };
                        }

                    } else {

                        diagnostics[name] = {
                            configured:
                                Boolean(
                                    service
                                ),
                        };
                    }
                }

                if (
                    typeof tracing
                        ?.diagnostics ===
                    'function'
                ) {

                    diagnostics.tracing =
                        tracing.diagnostics();
                }

                return sendSuccess(
                    res,
                    {
                        data:
                            diagnostics,

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /* ========================================================================
     * LEDGER
     * ====================================================================== */

    /**
     * GET /ledger/:ledgerId
     */
    router.get(
        '/ledger/:ledgerId',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const ledgerId =
                    requireValue(
                        req.params.ledgerId,
                        'ledgerId'
                    );

                const repository =
                    requireService(
                        services.ledgerRepository,
                        'ledgerRepository'
                    );

                let ledger;

                if (
                    typeof repository
                        .findById ===
                    'function'
                ) {

                    /*
                     * Prefer tenant-scoped repository APIs.
                     */
                    try {

                        ledger =
                            await repository
                                .findById(
                                    ledgerId,
                                    {
                                        tenantId:
                                            req
                                                .financeContext
                                                .tenantId,

                                        lean:
                                            true,
                                    }
                                );

                    } catch (_error) {

                        if (
                            typeof repository
                                .findOne ===
                            'function'
                        ) {

                            ledger =
                                await repository
                                    .findOne({
                                        _id:
                                            ledgerId,

                                        tenantId:
                                            req
                                                .financeContext
                                                .tenantId,
                                    });
                        } else {

                            throw _error;
                        }
                    }

                } else if (
                    typeof repository
                        .findOne ===
                    'function'
                ) {

                    ledger =
                        await repository
                            .findOne({
                                _id:
                                    ledgerId,

                                tenantId:
                                    req
                                        .financeContext
                                        .tenantId,
                            });

                } else {

                    throw new FinanceRouteError(
                        'SERVICE_METHOD_UNAVAILABLE',
                        'ledgerRepository lookup is unavailable',
                        503
                    );
                }

                if (
                    !ledger
                ) {

                    throw new FinanceRouteError(
                        'LEDGER_NOT_FOUND',
                        'Ledger record not found',
                        404,
                        {
                            ledgerId,
                        }
                    );
                }

                return sendSuccess(
                    res,
                    {
                        data:
                            ledger,

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /**
     * POST /ledger/post
     *
     * Expected body:
     * {
     *   journal,
     *   operationKey?,
     *   idempotencyKey?
     * }
     */
    router.post(
        '/ledger/post',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const ledgerEngine =
                    services.ledgerEngine;

                const post =
                    requireMethod(
                        ledgerEngine,
                        'post',
                        'ledgerEngine'
                    );

                const journal =
                    req.body?.journal;

                if (
                    !journal ||
                    typeof journal !==
                        'object'
                ) {

                    throw new FinanceRouteError(
                        'VALIDATION_ERROR',
                        'journal is required',
                        400
                    );
                }

                const context =
                    buildFinanceContext(
                        req,
                        {
                            operation:
                                'finance.ledger.post',

                            operationKey:
                                req.body
                                    ?.operationKey,

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,
                        }
                    );

                const result =
                    await post(
                        {
                            journal,

                            operationKey:
                                context
                                    .operationKey ||
                                null,
                        },

                        context
                    );

                return sendCreated(
                    res,
                    result,
                    context
                );
            }
        )
    );

    /* ========================================================================
     * REVERSALS
     * ====================================================================== */

    /**
     * POST /reversals
     *
     * Body:
     * {
     *   type:
     *      REFUND |
     *      SETTLEMENT |
     *      LOAN_DISBURSEMENT |
     *      ADJUSTMENT,
     *   originalLedgerId,
     *   reason,
     *   metadata?
     * }
     */
    router.post(
        '/reversals',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const reversalEngine =
                    requireService(
                        services.reversalEngine,
                        'reversalEngine'
                    );

                const type =
                    normalizeEnum(
                        req.body?.type,
                        SUPPORTED_REVERSAL_TYPES,
                        'reversal type'
                    );

                const originalLedgerId =
                    requireValue(
                        req.body
                            ?.originalLedgerId,
                        'originalLedgerId'
                    );

                const reason =
                    normalizeReason(
                        req.body?.reason
                    );

                const metadata =
                    isPlainObject(
                        req.body
                            ?.metadata
                    )
                        ? req.body.metadata
                        : {};

                const context =
                    buildFinanceContext(
                        req,
                        {
                            type,

                            operation:
                                'finance.reversal',

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,

                            approvalId:
                                req.body
                                    ?.approvalId,

                            metadata,
                        }
                    );

                const reversal =
                    await requireMethod(
                        reversalEngine,
                        'reverse',
                        'reversalEngine'
                    )({
                        type,

                        originalLedgerId,

                        reason,

                        tenantId:
                            context.tenantId,

                        userId:
                            context.userId,

                        correlationId:
                            context.correlationId,

                        requestId:
                            context.requestId,

                        operationId:
                            context.operationId,

                        idempotencyKey:
                            context.idempotencyKey,

                        approvalId:
                            context.approvalId,

                        metadata,
                    });

                return sendCreated(
                    res,
                    reversal,
                    context
                );
            }
        )
    );

    /**
     * POST /reversals/:type
     *
     * Convenience endpoint for clients that prefer a typed route.
     *
     * The service-facing contract remains ReversalEngine.reverse().
     */
    router.post(
        '/reversals/:type',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const reversalEngine =
                    requireService(
                        services.reversalEngine,
                        'reversalEngine'
                    );

                const type =
                    normalizeEnum(
                        req.params.type,
                        SUPPORTED_REVERSAL_TYPES,
                        'reversal type'
                    );

                const originalLedgerId =
                    requireValue(
                        req.body
                            ?.originalLedgerId,
                        'originalLedgerId'
                    );

                const reason =
                    normalizeReason(
                        req.body?.reason
                    );

                const metadata =
                    isPlainObject(
                        req.body
                            ?.metadata
                    )
                        ? req.body.metadata
                        : {};

                const context =
                    buildFinanceContext(
                        req,
                        {
                            type,

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,

                            approvalId:
                                req.body
                                    ?.approvalId,

                            metadata,
                        }
                    );

                const result =
                    await requireMethod(
                        reversalEngine,
                        'reverse',
                        'reversalEngine'
                    )({
                        type,

                        originalLedgerId,

                        reason,

                        tenantId:
                            context.tenantId,

                        userId:
                            context.userId,

                        correlationId:
                            context.correlationId,

                        requestId:
                            context.requestId,

                        operationId:
                            context.operationId,

                        idempotencyKey:
                            context.idempotencyKey,

                        approvalId:
                            context.approvalId,

                        metadata,
                    });

                return sendCreated(
                    res,
                    result,
                    context
                );
            }
        )
    );

    /* ========================================================================
     * ADJUSTMENTS
     * ====================================================================== */

    /**
     * POST /adjustments
     *
     * Body:
     * {
     *   journal,
     *   reason,
     *   approvalId?,
     *   adjustmentPeriodId?,
     *   metadata?
     * }
     */
    router.post(
        '/adjustments',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const adjustmentManager =
                    requireService(
                        services.adjustmentManager,
                        'adjustmentManager'
                    );

                const journal =
                    req.body
                        ?.journal;

                if (
                    !journal ||
                    typeof journal !==
                        'object'
                ) {

                    throw new FinanceRouteError(
                        'VALIDATION_ERROR',
                        'journal is required',
                        400
                    );
                }

                const reason =
                    normalizeReason(
                        req.body
                            ?.reason
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            operation:
                                'finance.adjustment',

                            approvalId:
                                req.body
                                    ?.approvalId,

                            adjustmentPeriodId:
                                req.body
                                    ?.adjustmentPeriodId,

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,

                            metadata:
                                req.body
                                    ?.metadata ||
                                {},
                        }
                    );

                const result =
                    await requireMethod(
                        adjustmentManager,
                        'execute',
                        'adjustmentManager'
                    )({
                        journal,

                        reason,

                        context
                    });

                return sendCreated(
                    res,
                    result,
                    context
                );
            }
        )
    );

    /* ========================================================================
     * STATEMENT PROCESSING
     * ====================================================================== */

    /**
     * POST /statements/process
     */
    router.post(
        '/statements/process',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const service =
                    requireService(
                        services.statementProcessingService,
                        'statementProcessingService'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            operation:
                                'finance.statement.process',

                            statementId:
                                req.body
                                    ?.statementId,

                            batchId:
                                req.body
                                    ?.batchId,

                            provider:
                                req.body
                                    ?.provider,

                            providerStatementId:
                                req.body
                                    ?.providerStatementId,

                            providerBatchId:
                                req.body
                                    ?.providerBatchId,

                            operationKey:
                                req.body
                                    ?.operationKey,

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,
                        }
                    );

                const process =
                    requireMethod(
                        service,
                        'process',
                        'statementProcessingService'
                    );

                /*
                 * Preserve compatibility with services exposing:
                 *
                 *   process(input, context)
                 *
                 * or:
                 *
                 *   process({ ..., context })
                 */
                const input =
                    isPlainObject(
                        req.body
                    )
                        ? {
                            ...req.body,

                            tenantId:
                                context.tenantId,

                            correlationId:
                                context
                                    .correlationId,

                            requestId:
                                context
                                    .requestId,

                            operationId:
                                context
                                    .operationId,

                            idempotencyKey:
                                context
                                    .idempotencyKey,
                        }
                        : {};

                const result =
                    await process(
                        input,
                        context
                    );

                return sendAccepted(
                    res,
                    result,
                    context
                );
            }
        )
    );

    /**
     * GET /statements/:statementId
     */
    router.get(
        '/statements/:statementId',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const repository =
                    requireService(
                        services.statementRepository,
                        'statementRepository'
                    );

                const tenantId =
                    requireValue(
                        req.financeContext
                            .tenantId,
                        'tenantId'
                    );

                const statementId =
                    requireValue(
                        req.params
                            .statementId,
                        'statementId'
                    );

                let result;

                if (
                    typeof repository
                        .findByStatementId ===
                    'function'
                ) {

                    result =
                        await repository
                            .findByStatementId(
                                tenantId,
                                statementId
                            );

                } else if (
                    typeof repository
                        .findOne ===
                    'function'
                ) {

                    result =
                        await repository
                            .findOne({
                                tenantId,

                                statementId,
                            });

                } else {

                    throw new FinanceRouteError(
                        'SERVICE_METHOD_UNAVAILABLE',
                        'statementRepository lookup is unavailable',
                        503
                    );
                }

                if (
                    !result
                ) {

                    throw new FinanceRouteError(
                        'STATEMENT_NOT_FOUND',
                        'Statement not found',
                        404,
                        {
                            statementId,
                        }
                    );
                }

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /**
     * GET /statements/processing
     */
    router.get(
        '/statements/processing',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const repository =
                    requireService(
                        services.statementRepository,
                        'statementRepository'
                    );

                const result =
                    await requireMethod(
                        repository,
                        'findProcessing',
                        'statementRepository'
                    )({
                        tenantId:
                            req.financeContext
                                .tenantId,

                        statuses:
                            req.query.statuses
                                ? String(
                                    req.query
                                        .statuses
                                )
                                    .split(',')
                                    .map(
                                        status =>
                                            String(
                                                status
                                            )
                                                .trim()
                                                .toUpperCase()
                                    )
                                : undefined,

                        limit:
                            normalizeLimit(
                                req.query.limit
                            ),
                    });

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        meta: {
                            page:
                                normalizePage(
                                    req.query.page
                                ),

                            limit:
                                normalizeLimit(
                                    req.query.limit
                                ),

                            count:
                                Array.isArray(
                                    result
                                )
                                    ? result.length
                                    : 0,
                        },

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /* ========================================================================
     * RECONCILIATION
     * ====================================================================== */

    /**
     * POST /reconciliation/run
     */
    router.post(
        '/reconciliation/run',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const service =
                    requireService(
                        services.reconciliationService,
                        'reconciliationService'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            operation:
                                'finance.reconciliation.run',

                            reconciliationId:
                                req.body
                                    ?.reconciliationId,

                            runId:
                                req.body
                                    ?.runId,

                            batchId:
                                req.body
                                    ?.batchId,

                            provider:
                                req.body
                                    ?.provider,

                            source:
                                req.body
                                    ?.source,

                            idempotencyKey:
                                req.idempotencyKey ||
                                req.body
                                    ?.idempotencyKey,

                            metadata:
                                req.body
                                    ?.metadata ||
                                {},
                        }
                    );

                /*
                 * Support the existing tracing/service naming patterns.
                 */
                if (
                    typeof service
                        .run ===
                    'function'
                ) {

                    const result =
                        await service.run(
                            req.body,
                            context
                        );

                    return sendAccepted(
                        res,
                        result,
                        context
                    );
                }

                if (
                    typeof service
                        .reconcile ===
                    'function'
                ) {

                    const result =
                        await service.reconcile(
                            req.body,
                            context
                        );

                    return sendAccepted(
                        res,
                        result,
                        context
                    );
                }

                if (
                    typeof service
                        .execute ===
                    'function'
                ) {

                    const result =
                        await service.execute(
                            req.body,
                            context
                        );

                    return sendAccepted(
                        res,
                        result,
                        context
                    );
                }

                throw new FinanceRouteError(
                    'SERVICE_METHOD_UNAVAILABLE',
                    'reconciliationService does not expose run(), reconcile(), or execute()',
                    503
                );
            }
        )
    );

    /**
     * POST /reconciliation/validate-settlement-reversal
     */
    router.post(
        '/reconciliation/validate-settlement-reversal',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const service =
                    requireMethod(
                        services.reconciliationService,
                        'validateSettlementReversal',
                        'reconciliationService'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            operation:
                                'finance.reconciliation.validateSettlementReversal',
                        }
                    );

                const result =
                    await service({
                        tenantId:
                            context.tenantId,

                        provider:
                            req.body
                                ?.provider,

                        providerReference:
                            req.body
                                ?.providerReference,

                        providerSettlementId:
                            req.body
                                ?.providerSettlementId,

                        settlementId:
                            req.body
                                ?.settlementId,

                        originalLedgerId:
                            req.body
                                ?.originalLedgerId,

                        correlationId:
                            context
                                .correlationId,
                    });

                return sendSuccess(
                    res,
                    {
                        data:
                            result ===
                            undefined
                                ? {
                                    valid:
                                        true,
                                }
                                : result,

                        context,
                    }
                );
            }
        )
    );

    /* ========================================================================
     * PERIOD MANAGEMENT
     * ====================================================================== */

    /**
     * GET /periods/current
     */
    router.get(
        '/periods/current',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const periodEngine =
                    requireService(
                        services.periodEngine,
                        'periodEngine'
                    );

                const method =
                    periodEngine
                        .getCurrentPeriod;

                if (
                    typeof method !==
                    'function'
                ) {

                    throw new FinanceRouteError(
                        'SERVICE_METHOD_UNAVAILABLE',
                        'periodEngine.getCurrentPeriod() is unavailable',
                        503
                    );
                }

                const result =
                    await method.call(
                        periodEngine,
                        {
                            tenantId:
                                req.financeContext
                                    .tenantId,
                        }
                    );

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /**
     * POST /periods/validate-posting
     */
    router.post(
        '/periods/validate-posting',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const periodEngine =
                    requireService(
                        services.periodEngine,
                        'periodEngine'
                    );

                const validate =
                    requireMethod(
                        periodEngine,
                        'validatePostingPeriod',
                        'periodEngine'
                    );

                const transactionDate =
                    normalizeDate(
                        req.body
                            ?.transactionDate,
                        'transactionDate'
                    );

                if (
                    !transactionDate
                ) {

                    throw new FinanceRouteError(
                        'VALIDATION_ERROR',
                        'transactionDate is required',
                        400
                    );
                }

                const result =
                    await validate({
                        tenantId:
                            req.financeContext
                                .tenantId,

                        transactionDate,
                    });

                return sendSuccess(
                    res,
                    {
                        data: {
                            valid:
                                result ===
                                undefined
                                    ? true
                                    : Boolean(
                                        result
                                    ),
                        },

                        context:
                            req.financeContext,
                    }
                );
            }
        )
    );

    /**
     * POST /periods/:periodId/lock
     */
    router.post(
        '/periods/:periodId/lock',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const periodEngine =
                    requireService(
                        services.periodEngine,
                        'periodEngine'
                    );

                const lock =
                    requireMethod(
                        periodEngine,
                        'lockPeriod',
                        'periodEngine'
                    );

                const periodId =
                    requireValue(
                        req.params
                            .periodId,
                        'periodId'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            periodId,
                        }
                    );

                const result =
                    await lock(
                        periodId,
                        context
                    );

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context,
                    }
                );
            }
        )
    );

    /**
     * POST /periods/:periodId/close
     */
    router.post(
        '/periods/:periodId/close',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const periodEngine =
                    requireService(
                        services.periodEngine,
                        'periodEngine'
                    );

                const close =
                    requireMethod(
                        periodEngine,
                        'closePeriod',
                        'periodEngine'
                    );

                const periodId =
                    requireValue(
                        req.params
                            .periodId,
                        'periodId'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            periodId,

                            approvalId:
                                req.body
                                    ?.approvalId,

                            metadata:
                                req.body
                                    ?.metadata ||
                                {},
                        }
                    );

                const result =
                    await close({
                        periodId,

                        context,
                    });

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context,
                    }
                );
            }
        )
    );

    /**
     * POST /periods/:periodId/reopen
     */
    router.post(
        '/periods/:periodId/reopen',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const periodEngine =
                    requireService(
                        services.periodEngine,
                        'periodEngine'
                    );

                const reopen =
                    requireMethod(
                        periodEngine,
                        'reopenPeriod',
                        'periodEngine'
                    );

                const periodId =
                    requireValue(
                        req.params
                            .periodId,
                        'periodId'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            periodId,

                            approvalId:
                                req.body
                                    ?.approvalId,

                            metadata:
                                req.body
                                    ?.metadata ||
                                {},
                        }
                    );

                const result =
                    await reopen({
                        periodId,

                        approvalRequest:
                            req.body
                                ?.approvalRequest ||
                            req.body
                                ?.approval ||
                            {},

                        context,
                    });

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context,
                    }
                );
            }
        )
    );

    /* ========================================================================
     * BALANCES
     * ====================================================================== */

    /**
     * GET /accounts/:accountId/balance
     *
     * Supports balanceService implementations exposing:
     *   getBalance()
     *   getAccountBalance()
     *   calculate()
     */
    router.get(
        '/accounts/:accountId/balance',
        asyncHandler(
            async (
                req,
                res
            ) => {

                const balanceService =
                    requireService(
                        services.balanceService,
                        'balanceService'
                    );

                const accountId =
                    requireValue(
                        req.params
                            .accountId,
                        'accountId'
                    );

                const context =
                    buildFinanceContext(
                        req,
                        {
                            accountId,
                        }
                    );

                let result;

                if (
                    typeof balanceService
                        .getBalance ===
                    'function'
                ) {

                    result =
                        await balanceService
                            .getBalance({
                                tenantId:
                                    context.tenantId,

                                accountId,

                                context,
                            });

                } else if (
                    typeof balanceService
                        .getAccountBalance ===
                    'function'
                ) {

                    result =
                        await balanceService
                            .getAccountBalance({
                                tenantId:
                                    context.tenantId,

                                accountId,

                                context,
                            });

                } else if (
                    typeof balanceService
                        .calculate ===
                    'function'
                ) {

                    result =
                        await balanceService
                            .calculate({
                                tenantId:
                                    context.tenantId,

                                accountId,

                                context,
                            });

                } else {

                    throw new FinanceRouteError(
                        'SERVICE_METHOD_UNAVAILABLE',
                        'balanceService does not expose a supported balance method',
                        503
                    );
                }

                return sendSuccess(
                    res,
                    {
                        data:
                            result,

                        context,
                    }
                );
            }
        )
    );

    /* ========================================================================
     * NOT FOUND
     * ====================================================================== */

    router.use(
        (
            req,
            _res,
            next
        ) => {

            next(
                new FinanceRouteError(
                    'ROUTE_NOT_FOUND',
                    `Finance route not found: ${req.method} ${req.originalUrl}`,
                    404,
                    {
                        method:
                            req.method,

                        path:
                            req.path,
                    }
                )
            );
        }
    );

    /* ========================================================================
     * ERROR HANDLER
     * ====================================================================== */

    router.use(
        (
            error,
            req,
            res,
            _next
        ) => {

            const normalized =
                normalizeRouteError(
                    error
                );

            const context =
                req.financeContext ||
                extractRequestIdentity(
                    req
                );

            setIdentityHeaders(
                res,
                context
            );

            /*
             * Log server-side details without exposing sensitive request data.
             */
            try {

                const logMethod =
                    normalized.statusCode >=
                    500
                        ? logger.error
                        : logger.warn;

                if (
                    typeof logMethod ===
                    'function'
                ) {

                    logMethod.call(
                        logger,
                        '[FinanceRoutes] Finance request failed',
                        {
                            module:
                                MODULE_NAME,

                            method:
                                req.method,

                            path:
                                req.path,

                            statusCode:
                                normalized
                                    .statusCode,

                            code:
                                normalized.code,

                            requestId:
                                context.requestId,

                            correlationId:
                                context.correlationId,

                            operationId:
                                context.operationId,

                            tenantId:
                                context.tenantId,

                            error:
                                normalized.logError,
                        }
                    );
                }

            } catch (_) {
                // Logging must never fail response handling.
            }

            /*
             * Optional metrics.
             */
            try {

                if (
                    typeof metrics
                        ?.increment ===
                    'function'
                ) {

                    metrics.increment(
                        'finance_http_errors_total',
                        {
                            route:
                                req.route
                                    ?.path ||
                                req.path,

                            method:
                                req.method,

                            code:
                                normalized.code,

                            status:
                                String(
                                    normalized
                                        .statusCode
                                ),
                        }
                    );
                } else if (
                    typeof metrics?.inc ===
                    'function'
                ) {

                    metrics.inc(
                        'finance_http_errors_total',
                        {
                            route:
                                req.route
                                    ?.path ||
                                req.path,

                            method:
                                req.method,

                            code:
                                normalized.code,

                            status:
                                String(
                                    normalized
                                        .statusCode
                                ),
                        }
                    );
                }

            } catch (_) {
                // Metrics are non-fatal.
            }

            if (
                res.headersSent
            ) {

                return;
            }

            const exposeDetails =
                options.exposeErrors ===
                true ||
                process.env.NODE_ENV !==
                    'production';

            const responseError = {

                code:
                    normalized.code,

                message:
                    exposeDetails
                        ? normalized.message
                        : getPublicErrorMessage(
                            normalized
                        ),
            };

            return res
                .status(
                    normalized.statusCode
                )
                .json({
                    success:
                        false,

                    error:
                        responseError,

                    meta: {

                        requestId:
                            context.requestId ||
                            null,

                        correlationId:
                            context.correlationId ||
                            null,

                        operationId:
                            context.operationId ||
                            null,

                        traceId:
                            context.traceId ||
                            null,

                        timestamp:
                            new Date()
                                .toISOString(),
                    },
                });
        }
    );

    return router;
}

/* ============================================================================
 * Error normalization
 * ========================================================================== */

function normalizeRouteError(
    error
) {

    if (
        error instanceof
        FinanceRouteError
    ) {

        return {

            code:
                error.code ||
                'FINANCE_ERROR',

            message:
                error.message ||
                'Finance request failed',

            statusCode:
                Number.isInteger(
                    error.statusCode
                )
                    ? error.statusCode
                    : 400,

            logError:
                normalizeError(
                    error
                ),
        };
    }

    const statusFromError =
        Number.isInteger(
            error?.statusCode
        )
            ? error.statusCode
            : Number.isInteger(
                error?.status
            )
                ? error.status
                : null;

    const statusCode =
        statusFromError &&
        statusFromError >= 400 &&
        statusFromError <= 599
            ? statusFromError
            : 500;

    return {

        code:
            error?.code ||
            'FINANCE_INTERNAL_ERROR',

        message:
            String(
                error?.message ||
                'Finance request failed'
            ).slice(
                0,
                MAX_REASON_LENGTH
            ),

        statusCode,

        logError:
            normalizeError(
                error
            ),
    };
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
                MAX_REASON_LENGTH
            ),
    };
}

function getPublicErrorMessage(
    normalized
) {

    if (
        normalized.statusCode ===
        400
    ) {

        return normalized.message;
    }

    if (
        normalized.statusCode ===
            401 ||
        normalized.statusCode ===
            403
    ) {

        return normalized.message;
    }

    if (
        normalized.statusCode ===
        404
    ) {

        return normalized.message;
    }

    if (
        normalized.statusCode ===
        409
    ) {

        return normalized.message;
    }

    if (
        normalized.statusCode ===
        429
    ) {

        return 'Too many requests.';
    }

    return 'Finance operation failed.';
}

/* ============================================================================
 * Default router
 * ========================================================================== */

/**
 * The default export is a ready-to-mount router with no external services.
 *
 * Applications with real dependencies should prefer:
 *
 *   createFinanceRouter({
 *       services,
 *       middleware...
 *   })
 *
 * The default router is intentionally useful for discovery/startup loading,
 * but service-backed routes will respond with 503 until dependencies are
 * supplied through the factory.
 */
const defaultRouter =
    createFinanceRouter({
        requireTenant:
            false,

        requireAuthentication:
            false,
    });

/* ============================================================================
 * Public API
 * ========================================================================== */

module.exports =
    defaultRouter;

module.exports.createFinanceRouter =
    createFinanceRouter;

module.exports.FinanceRouteError =
    FinanceRouteError;

module.exports.ROUTER_NAME =
    ROUTER_NAME;

module.exports.API_DOMAIN =
    API_DOMAIN;

module.exports.API_VERSION =
    API_VERSION;

module.exports.SUPPORTED_REVERSAL_TYPES =
    SUPPORTED_REVERSAL_TYPES;