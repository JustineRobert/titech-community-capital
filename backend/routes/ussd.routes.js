'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise USSD Gateway Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/ussd.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP gateway for TITech Community Capital USSD traffic.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ USSD provider entry point
 * ✓ Request / correlation context
 * ✓ Tenant resolution
 * ✓ Request validation
 * ✓ Rate limiting
 * ✓ Provider/session protection
 * ✓ Metrics
 * ✓ Controlled diagnostics
 * ✓ Health endpoint
 * ✓ Consistent USSD response handling
 * ✓ Centralized route-level error handling
 *
 * Supported Providers
 * ----------------------------------------------------------------------------
 * ✓ Africa's Talking
 * ✓ MTN
 * ✓ Airtel
 * ✓ Future USSD aggregators
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 * ✗ mutate savings balances
 * ✗ write ledger entries
 * ✗ perform loan accounting
 * ✗ contain USSD business rules
 * ✗ trust client-supplied tenantId
 * ✗ log complete phone numbers
 * ✗ expose raw tenant/controller diagnostics
 *
 * Financial and business behavior belongs in the controller/service layer.
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

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

/**
 * ============================================================================
 * Dependencies
 * ============================================================================
 */

const ussdController =
    require('../controllers/ussdController');

const logger =
    require('../utils/logger');

const ussdTenantMiddleware =
    require(
        '../middleware/ussdTenantMiddleware'
    );

const metricsService =
    require('../services/metricsService');

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechUSSDGatewayRoutes';

const ROUTER_VERSION =
    '2026.1';

const ROUTE_NAME =
    'USSD_GATEWAY';

const SERVICE_NAME =
    'TITech USSD Gateway';

const DEFAULT_BODY_LIMIT =
    process.env.TITECH_USSD_BODY_LIMIT ||
    '128kb';

const MAX_SESSION_ID_LENGTH =
    255;

const MAX_SERVICE_CODE_LENGTH =
    64;

const MAX_PHONE_LENGTH =
    32;

const MAX_TEXT_LENGTH =
    4096;

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const ENABLE_DIAGNOSTICS =
    String(
        process.env.TITECH_USSD_DIAGNOSTICS_ENABLED ||
        'false'
    ).toLowerCase() ===
    'true';

const USSD_RATE_LIMIT =
    getPositiveIntegerEnv(
        'TITECH_USSD_GATEWAY_RATE_LIMIT',
        1000
    );

/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */

if (
    typeof ussdController?.handle !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] ussdController.handle must be a function.`
    );
}

if (
    typeof ussdTenantMiddleware !==
    'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] ussdTenantMiddleware must be a function.`
    );
}

/**
 * ============================================================================
 * Request Context
 * ============================================================================
 */

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
        'X-Request-ID',
        requestId
    );

    res.setHeader(
        'X-Correlation-ID',
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
 * Body Parsers
 * ============================================================================
 *
 * USSD gateways commonly use application/x-www-form-urlencoded. JSON is also
 * accepted for integration/testing compatibility.
 * ============================================================================
 */

router.use(
    express.urlencoded({
        extended:
            true,

        limit:
            DEFAULT_BODY_LIMIT,
    })
);

router.use(
    express.json({
        limit:
            DEFAULT_BODY_LIMIT,

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Request Metrics
 * ============================================================================
 */

router.use(
    requestMetricsMiddleware
);

function requestMetricsMiddleware(
    req,
    res,
    next
) {
    req.startedAt =
        Date.now();

    safeMetricIncrement(
        'titech.ussd.route.requests'
    );

    res.once(
        'finish',
        () => {
            const duration =
                Date.now() -
                req.startedAt;

            safeMetricTiming(
                'titech.ussd.route.duration',
                duration
            );

            safeMetricIncrement(
                `titech.ussd.route.status.${res.statusCode}`
            );
        }
    );

    next();
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 *
 * Phone numbers are hashed before being used in limiter keys.
 * ============================================================================
 */

const ussdLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            USSD_RATE_LIMIT,

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        keyGenerator(
            req
        ) {
            const phone =
                normalizeString(
                    req.body?.phoneNumber
                );

            if (
                phone
            ) {
                return hashIdentifier(
                    phone
                );
            }

            return (
                normalizeString(
                    req.ip
                ) ||
                normalizeString(
                    req.socket?.remoteAddress
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res
        ) {
            safeMetricIncrement(
                'titech.ussd.rate_limit.exceeded'
            );

            safeLogWarn(
                'USSD rate limit exceeded',
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    tenantId:
                        req.tenant?.id ||
                        req.tenantId,
                }
            );

            res.setHeader(
                'Retry-After',
                '60'
            );

            return res
                .status(429)
                .type(
                    'text/plain'
                )
                .send(
                    'END Too many requests. Please try again later.'
                );
        },
    });

/**
 * ============================================================================
 * Health
 * ============================================================================
 *
 * Health is intentionally available without tenant resolution.
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

                route:
                    ROUTE_NAME,

                version:
                    ROUTER_VERSION,

                status:
                    'UP',

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
 * Diagnostics
 * ============================================================================
 *
 * Disabled by default. This prevents accidental exposure of internal
 * controller/tenant diagnostics through a production route.
 * ============================================================================
 */

router.get(
    '/diagnostics',
    (
        req,
        res
    ) => {
        if (
            !ENABLE_DIAGNOSTICS
        ) {
            return res
                .status(404)
                .json({
                    success:
                        false,

                    code:
                        'USSD_DIAGNOSTICS_DISABLED',

                    message:
                        'USSD diagnostics are disabled.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        return res
            .status(200)
            .json({
                success:
                    true,

                service:
                    SERVICE_NAME,

                route:
                    ROUTE_NAME,

                version:
                    ROUTER_VERSION,

                diagnostics:
                    getSafeDiagnostics(),

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
 * Main USSD Gateway
 * ============================================================================
 *
 * POST /
 *
 * There is deliberately ONE canonical POST / route.
 * ============================================================================
 */

router.post(
    '/',

    ussdLimiter,

    validateUSSDPayload,

    ussdTenantMiddleware,

    async (
        req,
        res,
        next
    ) => {
        try {
            safeLogInfo(
                'USSD request received',
                {
                    tenantId:
                        req.tenant?.id ||
                        req.tenantId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    sessionId:
                        normalizeString(
                            req.body?.sessionId
                        ),

                    serviceCode:
                        normalizeString(
                            req.body?.serviceCode
                        ),
                }
            );

            const controllerRequest =
                buildControllerRequest(
                    req
                );

            const response =
                await ussdController.handle(
                    controllerRequest
                );

            const normalizedResponse =
                normalizeUSSDResponse(
                    response
                );

            safeMetricIncrement(
                'titech.ussd.responses'
            );

            return res
                .status(200)
                .type(
                    'text/plain'
                )
                .send(
                    normalizedResponse
                );
        } catch (
            error
        ) {
            return next(
                error
            );
        }
    }
);

/**
 * ============================================================================
 * Payload Validation
 * ============================================================================
 */

function validateUSSDPayload(
    req,
    res,
    next
) {
    const body =
        req.body || {};

    const sessionId =
        normalizeString(
            body.sessionId
        );

    const phoneNumber =
        normalizePhoneNumber(
            body.phoneNumber
        );

    const serviceCode =
        normalizeString(
            body.serviceCode
        );

    const text =
        String(
            body.text ||
            ''
        );

    if (
        !sessionId
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid session.'
            );
    }

    if (
        sessionId.length >
        MAX_SESSION_ID_LENGTH
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid session.'
            );
    }

    if (
        !phoneNumber
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid phone number.'
            );
    }

    if (
        !serviceCode
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid service code.'
            );
    }

    if (
        serviceCode.length >
        MAX_SERVICE_CODE_LENGTH
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid service code.'
            );
    }

    if (
        text.length >
        MAX_TEXT_LENGTH
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Request too long.'
            );
    }

    /**
     * Prevent client-side tenant impersonation.
     */
    if (
        Object.prototype.hasOwnProperty.call(
            body,
            'tenantId'
        )
    ) {
        return res
            .status(400)
            .type(
                'text/plain'
            )
            .send(
                'END Invalid request.'
            );
    }

    req.body =
        {
            ...body,

            sessionId,

            serviceCode,

            phoneNumber,

            text,
        };

    next();
}

/**
 * ============================================================================
 * Controller Request Context
 * ============================================================================
 */

function buildControllerRequest(
    req
) {
    return {
        tenant:
            sanitizeTenant(
                req.tenant
            ),

        tenantId:
            normalizeString(
                req.tenant?.id ||
                req.tenant?._id ||
                req.tenantId
            ),

        sessionId:
            req.body.sessionId,

        serviceCode:
            req.body.serviceCode,

        phoneNumber:
            req.body.phoneNumber,

        text:
            req.body.text,

        correlationId:
            req.correlationId,

        requestId:
            req.requestId,

        tenantContext:
            sanitizeTenantContext(
                req.tenantContext
            ),
    };
}

/**
 * ============================================================================
 * USSD Response Normalization
 * ============================================================================
 */

function normalizeUSSDResponse(
    response
) {
    const value =
        String(
            response ||
            ''
        ).trim();

    if (
        !value
    ) {
        return 'END Unable to process your request.';
    }

    if (
        value.startsWith(
            'CON '
        ) ||
        value.startsWith(
            'END '
        )
    ) {
        return value;
    }

    return `END ${value}`;
}

/**
 * ============================================================================
 * Safe Tenant Output
 * ============================================================================
 */

function sanitizeTenant(
    tenant
) {
    if (
        !tenant ||
        typeof tenant !==
            'object'
    ) {
        return null;
    }

    return {
        id:
            normalizeString(
                tenant.id ||
                tenant._id
            ),

        code:
            normalizeString(
                tenant.code
            ),

        name:
            normalizeString(
                tenant.name
            ),

        status:
            normalizeString(
                tenant.status
            ),
    };
}

function sanitizeTenantContext(
    context
) {
    if (
        !context ||
        typeof context !==
            'object'
    ) {
        return null;
    }

    const allowed =
        new Set([
            'tenantId',
            'tenantCode',
            'serviceCode',
            'requestId',
            'correlationId',
            'featureFlags',
        ]);

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            context
        )
    ) {
        if (
            allowed.has(
                key
            )
        ) {
            result[key] =
                value;
        }
    }

    return result;
}

/**
 * ============================================================================
 * Safe Diagnostics
 * ============================================================================
 */

function getSafeDiagnostics() {
    const controllerDiagnostics =
        typeof ussdController
            .getDiagnostics ===
        'function'
            ? ussdController
                .getDiagnostics()
            : null;

    return {
        route:
            ROUTE_NAME,

        version:
            ROUTER_VERSION,

        controller:
            sanitizeDiagnostics(
                controllerDiagnostics
            ),

        capabilities:
            {
                requestContext:
                    true,

                tenantResolution:
                    true,

                metrics:
                    true,

                diagnostics:
                    ENABLE_DIAGNOSTICS,
            },
    };
}

function sanitizeDiagnostics(
    diagnostics
) {
    if (
        !diagnostics ||
        typeof diagnostics !==
            'object'
    ) {
        return null;
    }

    const result =
        {};

    const forbidden =
        [
            'secret',
            'password',
            'token',
            'apikey',
            'api_key',
            'credential',
            'privatekey',
            'private_key',
            'connectionstring',
            'connection_string',
        ];

    for (
        const [
            key,
            value,
        ] of Object.entries(
            diagnostics
        )
    ) {
        const normalizedKey =
            String(
                key
            ).toLowerCase();

        if (
            forbidden.some(
                term =>
                    normalizedKey.includes(
                        term
                    )
            )
        ) {
            continue;
        }

        result[key] =
            value;
    }

    return result;
}

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

    const result =
        String(
            value
        ).trim();

    return (
        result ||
        fallback
    );
}

function normalizePhoneNumber(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
    ) {
        return null;
    }

    const cleaned =
        normalized.replace(
            /[\s\-()]/g,
            ''
        );

    if (
        !/^\+?[0-9]{7,32}$/.test(
            cleaned
        )
    ) {
        return null;
    }

    return cleaned;
}

function hashIdentifier(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            String(
                value
            ),
            'utf8'
        )
        .digest(
            'hex'
        );
}

function safeLogInfo(
    message,
    metadata
) {
    try {
        logger?.info?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break USSD processing.
    }
}

function safeLogWarn(
    message,
    metadata
) {
    try {
        logger?.warn?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break USSD processing.
    }
}

function safeMetricIncrement(
    name
) {
    try {
        metricsService?.increment?.(
            name
        );
    } catch {
        // Metrics failures must never break USSD processing.
    }
}

function safeMetricTiming(
    name,
    value
) {
    try {
        metricsService?.timing?.(
            name,
            value
        );
    } catch {
        // Metrics failures must never break USSD processing.
    }
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
        safeLogError(
            'USSD route failure',
            {
                code:
                    error?.code,

                message:
                    error?.message,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                tenantId:
                    req.tenant?.id ||
                    req.tenantId,

                sessionId:
                    req.body?.sessionId,
            }
        );

        safeMetricIncrement(
            'titech.ussd.errors'
        );

        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        return res
            .status(
                Number(
                    error?.statusCode
                ) >= 400 &&
                Number(
                    error?.statusCode
                ) < 600
                    ? Number(
                        error.statusCode
                    )
                    : 500
            )
            .type(
                'text/plain'
            )
            .send(
                'END Service temporarily unavailable.'
            );
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
            'v1',

        path:
            '/ussd',

        router,

        metadata:
            {
                name:
                    SERVICE_NAME,

                route:
                    '/api/v1/ussd',

                version:
                    ROUTER_VERSION,

                supports:
                    [
                        'AfricaTalking',
                        'MTN',
                        'Airtel',
                        'future_aggregators',
                    ],

                tenantScoped:
                    true,

                productionGrade:
                    true,
            },
    };