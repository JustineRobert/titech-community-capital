'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise USSD Tenant Middleware Test Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/testUssdTenant.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Development / QA validation routes for:
 *
 *   - ussdTenantMiddleware
 *   - Tenant resolution
 *   - Service-code mapping
 *   - Request context
 *   - Correlation IDs
 *   - Tenant diagnostics
 *   - USSD feature/context resolution
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This is a TEST / DIAGNOSTIC router.
 *
 * It MUST NOT be exposed as an unrestricted production API.
 *
 * Production behavior:
 *
 *   - Disabled by default.
 *   - Can be enabled explicitly with:
 *
 *       TITECH_ENABLE_USSD_TEST_ROUTES=true
 *
 *   - Recommended to additionally protect at the reverse proxy/API gateway.
 *
 * Security principles:
 *
 *   ✗ Never expose secrets.
 *   ✗ Never expose complete tenant documents.
 *   ✗ Never trust client-supplied tenantId.
 *   ✗ Never log complete USSD payloads.
 *   ✗ Never expose stack traces to clients.
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

const {
    body,
} =
    require('express-validator');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const ussdTenantMiddleware =
    require(
        '../middleware/ussdTenantMiddleware'
    );

const logger =
    require('../utils/logger');

const metricsService =
    require('../services/metricsService');

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechTestUssdTenantRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech USSD Tenant Test';

const TEST_ROUTES_ENABLED =
    String(
        process.env
            .TITECH_ENABLE_USSD_TEST_ROUTES ||
            'false'
    ).toLowerCase() ===
    'true';

const NODE_ENV =
    String(
        process.env.NODE_ENV ||
        'development'
    ).toLowerCase();

const IS_PRODUCTION =
    NODE_ENV ===
    'production';

/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */

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
 * Environment Guard
 * ============================================================================
 *
 * Fail closed in production unless explicitly enabled.
 * ============================================================================
 */

if (
    IS_PRODUCTION &&
    !TEST_ROUTES_ENABLED
) {
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
                        'USSD_TEST_ROUTES_DISABLED',

                    message:
                        'USSD tenant test routes are disabled.',

                    timestamp:
                        new Date().toISOString(),
                });
        }
    );

    module.exports =
        {
            version:
                'v1',

            path:
                '/test/ussd-tenant',

            router,

            metadata:
                {
                    name:
                        'TITech USSD Tenant Middleware Test',

                    description:
                        'Disabled test router',

                    environment:
                        NODE_ENV,

                    enabled:
                        false,
                },
        };
} else {
    buildTestRouter();
}

/**
 * ============================================================================
 * Router Builder
 * ============================================================================
 */

function buildTestRouter() {
    /**
     * ------------------------------------------------------------------------
     * Body Parser
     * ------------------------------------------------------------------------
     */

    router.use(
        express.json({
            limit:
                process.env
                    .TITECH_USSD_TEST_BODY_LIMIT ||
                '64kb',

            strict:
                true,
        })
    );

    /**
     * ------------------------------------------------------------------------
     * Request Context
     * ------------------------------------------------------------------------
     */

    router.use(
        requestContextMiddleware
    );

    /**
     * ------------------------------------------------------------------------
     * Security Headers
     * ------------------------------------------------------------------------
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
     * ------------------------------------------------------------------------
     * Rate Limiting
     * ------------------------------------------------------------------------
     */

    router.use(
        testRouteLimiter
    );

    /**
     * ------------------------------------------------------------------------
     * Metrics
     * ------------------------------------------------------------------------
     */

    router.use(
        metricsMiddleware
    );

    /**
     * ------------------------------------------------------------------------
     * Health
     * ------------------------------------------------------------------------
     */

    router.get(
        '/health',
        healthHandler
    );

    /**
     * ------------------------------------------------------------------------
     * Diagnostics
     * ------------------------------------------------------------------------
     */

    router.get(
        '/diagnostics',
        diagnosticsHandler
    );

    /**
     * ------------------------------------------------------------------------
     * Middleware Validation
     * ------------------------------------------------------------------------
     */

    router.post(
        '/',
        validateTenantTestPayload,
        ussdTenantMiddleware,
        middlewareValidationHandler
    );

    /**
     * ------------------------------------------------------------------------
     * Service-Code Resolution
     * ------------------------------------------------------------------------
     */

    router.post(
        '/service-code',
        validateServiceCodePayload,
        ussdTenantMiddleware,
        serviceCodeHandler
    );

    /**
     * ------------------------------------------------------------------------
     * Route Not Found
     * ------------------------------------------------------------------------
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
                        'USSD_TEST_ROUTE_NOT_FOUND',

                    message:
                        'USSD tenant test endpoint not found.',

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
     * ------------------------------------------------------------------------
     * Error Handler
     * ------------------------------------------------------------------------
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

            safeLogError(
                'USSD tenant test route error',
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
                        req.tenantId,
                }
            );

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
                        'USSD_TEST_ROUTE_ERROR',

                    message:
                        statusCode < 500
                            ? (
                                error?.message ||
                                'The USSD tenant test request could not be completed.'
                            )
                            : 'The USSD tenant test request could not be completed.',

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
     * ------------------------------------------------------------------------
     * Route Auto Loader Contract
     * ------------------------------------------------------------------------
     */

    module.exports =
        {
            version:
                'v1',

            path:
                '/test/ussd-tenant',

            router,

            metadata:
                {
                    name:
                        'TITech USSD Tenant Middleware Test',

                    description:
                        'Validates TITech USSD tenant resolution, service-code mapping and request context',

                    environment:
                        NODE_ENV,

                    enabled:
                        true,

                    testOnly:
                        true,
                },
        };
}

/**
 * ============================================================================
 * Request Context Middleware
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
 * Metrics Middleware
 * ============================================================================
 */

function metricsMiddleware(
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
                metricsService?.increment?.(
                    'titech.test.ussd.requests'
                );

                metricsService?.timing?.(
                    'titech.test.ussd.duration',
                    duration
                );

                metricsService?.increment?.(
                    `titech.test.ussd.status.${res.statusCode}`
                );
            } catch (
                error
            ) {
                safeLogWarn(
                    'USSD test metrics failed',
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

/**
 * ============================================================================
 * Test Rate Limiter
 * ============================================================================
 */

const testRouteLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_USSD_TEST_RATE_LIMIT',
                60
            ),

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        handler(
            req,
            res
        ) {
            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'USSD_TEST_RATE_LIMITED',

                    message:
                        'Too many USSD test requests.',

                    retryAfter:
                        60,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    });

/**
 * ============================================================================
 * Health Handler
 * ============================================================================
 */

function healthHandler(
    req,
    res
) {
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

            enabled:
                TEST_ROUTES_ENABLED,

            environment:
                NODE_ENV,

            testOnly:
                true,

            timestamp:
                new Date().toISOString(),

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        });
}

/**
 * ============================================================================
 * Diagnostics Handler
 * ============================================================================
 */

function diagnosticsHandler(
    req,
    res
) {
    return res
        .status(200)
        .json({
            success:
                true,

            service:
                SERVICE_NAME,

            version:
                ROUTER_VERSION,

            environment:
                NODE_ENV,

            enabled:
                TEST_ROUTES_ENABLED,

            endpoints:
                [
                    'POST /',
                    'POST /service-code',
                    'GET /health',
                    'GET /diagnostics',
                ],

            middleware:
                {
                    tenantResolution:
                        true,

                    requestContext:
                        true,

                    correlationIds:
                        true,

                    metrics:
                        true,
                },

            timestamp:
                new Date().toISOString(),

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        });
}

/**
 * ============================================================================
 * Tenant Middleware Validation
 * ============================================================================
 */

function validateTenantTestPayload(
    req,
    res,
    next
) {
    const validationError =
        validateCommonPayload(
            req.body
        );

    if (
        validationError
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    validationError.code,

                message:
                    validationError.message,

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
 * Service Code Validation
 * ============================================================================
 */

function validateServiceCodePayload(
    req,
    res,
    next
) {
    const validationError =
        validateCommonPayload(
            req.body
        );

    if (
        validationError
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    validationError.code,

                message:
                    validationError.message,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const serviceCode =
        normalizeString(
            req.body?.serviceCode
        );

    if (
        !serviceCode
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'USSD_SERVICE_CODE_REQUIRED',

                message:
                    'serviceCode is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        serviceCode.length >
        64
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'USSD_SERVICE_CODE_INVALID',

                message:
                    'serviceCode is too long.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.body.serviceCode =
        serviceCode;

    next();
}

/**
 * ============================================================================
 * Middleware Validation Handler
 * ============================================================================
 */

function middlewareValidationHandler(
    req,
    res
) {
    safeLogInfo(
        'USSD tenant test successful',
        {
            tenantId:
                req.tenantId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        }
    );

    return res
        .status(200)
        .json({
            success:
                true,

            message:
                'TITech USSD tenant middleware passed.',

            requestContext:
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                },

            tenant:
                sanitizeTenant(
                    req.tenant
                ),

            tenantContext:
                sanitizeTenantContext(
                    req.tenantContext
                ),

            diagnostics:
                sanitizeDiagnostics(
                    req.ussdDiagnostics
                ),

            request:
                {
                    serviceCode:
                        normalizeString(
                            req.body?.serviceCode
                        ),
                },

            timestamp:
                new Date().toISOString(),
        });
}

/**
 * ============================================================================
 * Service Code Handler
 * ============================================================================
 */

function serviceCodeHandler(
    req,
    res
) {
    return res
        .status(200)
        .json({
            success:
                true,

            serviceCode:
                normalizeString(
                    req.body?.serviceCode
                ),

            tenant:
                sanitizeTenant(
                    req.tenant
                ),

            tenantId:
                normalizeString(
                    req.tenantId
                ),

            tenantContext:
                sanitizeTenantContext(
                    req.tenantContext
                ),

            diagnostics:
                sanitizeDiagnostics(
                    req.ussdDiagnostics
                ),

            requestContext:
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                },

            timestamp:
                new Date().toISOString(),
        });
}

/**
 * ============================================================================
 * Common Payload Validation
 * ============================================================================
 */

function validateCommonPayload(
    payload
) {
    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload
        )
    ) {
        return {
            code:
                'USSD_TEST_PAYLOAD_INVALID',

            message:
                'Request body must be a JSON object.',
        };
    }

    /**
     * A test route must NEVER accept client-selected tenant identity as the
     * authoritative tenant.
     *
     * The actual ussdTenantMiddleware determines tenant context.
     */
    if (
        Object.prototype.hasOwnProperty.call(
            payload,
            'tenantId'
        )
    ) {
        return {
            code:
                'USSD_TEST_TENANT_OVERRIDE_FORBIDDEN',

            message:
                'tenantId must not be supplied by the test client.',
        };
    }

    return null;
}

/**
 * ============================================================================
 * Sanitization
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

    /**
     * Expose only safe context fields.
     */
    const result =
        {};

    const allowedKeys =
        new Set([
            'tenantId',
            'tenantCode',
            'serviceCode',
            'requestId',
            'correlationId',
            'environment',
            'featureFlags',
        ]);

    for (
        const [
            key,
            value,
        ]
        of Object.entries(
            context
        )
    ) {
        if (
            allowedKeys.has(
                key
            )
        ) {
            result[key] =
                value;
        }
    }

    return result;
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

    const forbiddenTerms =
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
            forbiddenTerms.some(
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
 * Logging Helpers
 * ============================================================================
 */

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
        // Diagnostics must never fail because logging failed.
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
        // Ignore logging failures.
    }
}

function safeLogError(
    message,
    metadata
) {
    try {
        logger?.error?.(
            message,
            metadata
        );
    } catch {
        // Ignore logging failures.
    }
}

/**
 * ============================================================================
 * Environment Helpers
 * ============================================================================
 */

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