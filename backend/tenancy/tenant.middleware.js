'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenancy Middleware
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.middleware.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical tenant-boundary middleware for:
 *
 *   - Express
 *   - Koa
 *   - GraphQL
 *   - WebSocket handshakes
 *   - Tenant access-control policies
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Establish trusted tenant context.
 * - Require authenticated tenant identity where configured.
 * - Support controlled tenant-header resolution.
 * - Support hostname/domain tenant resolution.
 * - Reuse the canonical tenant.context implementation.
 * - Provide tenant-aware metrics and audit hooks.
 * - Provide tenant-scoped resource helpers.
 * - Provide optional access allowlists / denylists.
 * - Provide consistent request/correlation IDs.
 *
 * Security model
 * ----------------------------------------------------------------------------
 *
 * Tenant identification is NOT authorization.
 *
 * This middleware does not blindly trust:
 *
 *   x-tenant-id
 *   x-tenant-domain
 *   Host
 *
 * A raw client-controlled tenant identifier is never treated as authoritative
 * unless the caller explicitly marks the tenant source as trusted.
 *
 * Authentication should normally run BEFORE this middleware:
 *
 *   authenticate
 *       ↓
 *   tenant middleware
 *       ↓
 *   authorization
 *       ↓
 *   controller
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const crypto =
    require('node:crypto');

const tenantConstants =
    require('./tenant.constants');

const tenantContext =
    require('./tenant.context');

const {
    tenantEvents,
} =
    tenantContext;

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_OPTIONS =
    Object.freeze({
        attachToRequest:
            true,

        requestIdHeader:
            'x-request-id',

        correlationIdHeader:
            'x-correlation-id',

        tenantHeader:
            tenantConstants.AUTH?.TENANT_HEADER ||
            tenantConstants.ENV?.TENANT_ID_HEADER ||
            'x-tenant-id',

        tenantDomainHeader:
            tenantConstants.AUTH?.TENANT_DOMAIN_HEADER ||
            tenantConstants.ENV?.TENANT_DOMAIN_HEADER ||
            'x-tenant-domain',

        jwtTenantClaim:
            tenantConstants.AUTH?.TENANT_CLAIM ||
            tenantConstants.ENV?.JWT_TENANT_CLAIM ||
            'titech_tenant',

        fallbackTenant:
            tenantConstants.DEFAULTS?.DEFAULT_TENANT ||
            'public',

        strictValidation:
            Boolean(
                tenantConstants.ENV?.TENANT_CACHE_STRICT
            ),

        requireAuthenticatedTenant:
            process.env.NODE_ENV ===
            'production',

        allowFallbackTenant:
            process.env.NODE_ENV !==
            'production',

        allowTrustedHeader:
            false,

        allowHostResolution:
            true,

        enableRateLimit:
            false,

        enableMetrics:
            true,

        enableAudit:
            true,

        logLevel:
            tenantConstants.ENV?.LOG_LEVEL ||
            'info',

        logger:
            null,

        metrics:
            null,

        rateLimiter:
            null,

        cacheClient:
            null,

        dbResolver:
            null,

        auditLogger:
            null,
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class TenantMiddlewareError extends Error {
    constructor(
        message,
        code = 'TENANT_MIDDLEWARE_ERROR',
        {
            statusCode = 500,
            cause = undefined,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'TenantMiddlewareError';

        this.code =
            code;

        this.statusCode =
            statusCode;

        if (
            cause
        ) {
            this.cause =
                cause;
        }

        Error.captureStackTrace?.(
            this,
            TenantMiddlewareError
        );
    }
}

/**
 * ============================================================================
 * Header Helpers
 * ============================================================================
 */

function readHeader(
    req,
    headerName
) {
    if (
        !req?.headers ||
        !headerName
    ) {
        return null;
    }

    const normalizedName =
        String(
            headerName
        ).toLowerCase();

    return (
        req.headers[
            normalizedName
        ] ||
        req.headers[
            headerName
        ] ||
        null
    );
}

function normalizeIdentifier(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        null
    );
}

function generateRequestId() {
    return crypto.randomUUID();
}

/**
 * ============================================================================
 * Trusted Authentication Detection
 * ============================================================================
 */

function isAuthenticatedRequest(
    req
) {
    if (
        !req
    ) {
        return false;
    }

    if (
        typeof req.isAuthenticated ===
        'function'
    ) {
        try {
            if (
                req.isAuthenticated()
            ) {
                return true;
            }
        } catch {
            // Continue with other authentication signals.
        }
    }

    if (
        req.authenticated ===
            true ||
        req.securityContext
            ?.authenticated ===
            true
    ) {
        return true;
    }

    return Boolean(
        req.user ||
        req.auth
    );
}

function getAuthenticatedActorId(
    req
) {
    return (
        normalizeIdentifier(
            req?.user?.id ||
            req?.user?._id ||
            req?.user?.userId ||
            req?.auth?.userId ||
            req?.auth?.id
        )
    );
}

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 *
 * Uses only already-established authenticated/authorized identity.
 * ============================================================================
 */

function getVerifiedPrincipalTenant(
    req
) {
    const principal =
        req?.user ||
        req?.auth ||
        null;

    if (
        !principal ||
        typeof principal !==
            'object'
    ) {
        return null;
    }

    if (
        principal.authenticated ===
            false ||
        principal.tokenVerified ===
            false
    ) {
        return null;
    }

    const claimName =
        tenantConstants.AUTH?.TENANT_CLAIM ||
        tenantConstants.ENV?.JWT_TENANT_CLAIM ||
        'titech_tenant';

    const fallbackClaimName =
        tenantConstants.AUTH?.TENANT_ID_CLAIM ||
        tenantConstants.ENV?.TENANT_ID_CLAIM ||
        'tenant_id';

    const candidate =
        principal[
            claimName
        ] ||
        principal[
            fallbackClaimName
        ] ||
        principal.tenantId ||
        principal.tenant?.id ||
        principal.tenant?.tenantId;

    if (
        !candidate
    ) {
        return null;
    }

    return validateTenant(
        candidate
    );
}

function getExistingTrustedTenant(
    req
) {
    const candidates =
        [
            req?.adminContext?.tenantId,

            req?.tenantContext?.tenantId,

            req?.tenant?.tenantId,

            (
                req?.tenantContextTrusted ===
                    true ||
                req?.trustedTenant ===
                    true ||
                req?.securityContext
                    ?.tenantTrusted ===
                    true
            )
                ? req?.tenantId
                : null,
        ];

    for (
        const candidate
        of candidates
    ) {
        if (
            candidate
        ) {
            const valid =
                validateTenant(
                    candidate
                );

            if (
                valid
            ) {
                return valid;
            }
        }
    }

    return null;
}

/**
 * ============================================================================
 * Tenant Header Trust
 * ============================================================================
 */

function isTrustedHeader(
    req,
    options
) {
    return (
        options.allowTrustedHeader &&
        (
            req?.tenantHeaderTrusted ===
                true ||
            req?.securityContext
                ?.tenantHeaderTrusted ===
                true ||
            req?.trustedTenantSource ===
                'header'
        )
    );
}

function readTenantHeader(
    req,
    options
) {
    return normalizeIdentifier(
        readHeader(
            req,
            options.tenantHeader
        )
    );
}

/**
 * ============================================================================
 * Host Resolution
 * ============================================================================
 */

function resolveFromHost(
    req,
    options
) {
    if (
        !options.allowHostResolution
    ) {
        return null;
    }

    const explicitDomain =
        normalizeIdentifier(
            readHeader(
                req,
                options.tenantDomainHeader
            )
        );

    if (
        explicitDomain
    ) {
        const domainTenant =
            tenantConstants.tenantIdFromHost(
                explicitDomain
            );

        if (
            domainTenant
        ) {
            return domainTenant;
        }
    }

    const host =
        normalizeIdentifier(
            readHeader(
                req,
                'host'
            ) ||
            req?.hostname ||
            req?.host
        );

    if (
        !host
    ) {
        return null;
    }

    return tenantConstants
        .tenantIdFromHost(
            host
        );
}

/**
 * ============================================================================
 * Tenant Resolution
 * ============================================================================
 */

function resolveTenantForRequest(
    req,
    options
) {
    const existingTrustedTenant =
        getExistingTrustedTenant(
            req
        );

    if (
        existingTrustedTenant
    ) {
        return {
            tenantId:
                existingTrustedTenant,

            source:
                'trusted-context',

            authenticated:
                isAuthenticatedRequest(
                    req
                ),
        };
    }

    const authenticated =
        isAuthenticatedRequest(
            req
        );

    /**
     * Verified authenticated principal is the preferred source.
     */
    const principalTenant =
        getVerifiedPrincipalTenant(
            req
        );

    if (
        principalTenant
    ) {
        return {
            tenantId:
                principalTenant,

            source:
                'verified-principal',

            authenticated:
                true,
        };
    }

    /**
     * Trusted header is allowed only when explicitly configured.
     */
    if (
        isTrustedHeader(
            req,
            options
        )
    ) {
        const headerTenant =
            readTenantHeader(
                req,
                options
            );

        if (
            headerTenant
        ) {
            return {
                tenantId:
                    validateTenantOrThrow(
                        headerTenant
                    ),

                source:
                    'trusted-header',

                authenticated,
            };
        }
    }

    /**
     * Hostname-based tenant resolution.
     */
    const hostTenant =
        resolveFromHost(
            req,
            options
        );

    if (
        hostTenant
    ) {
        return {
            tenantId:
                validateTenantOrThrow(
                    hostTenant
                ),

            source:
                'host',

            authenticated,
        };
    }

    if (
        options.requireAuthenticatedTenant &&
        !authenticated
    ) {
        throw new TenantMiddlewareError(
            'Authenticated tenant context is required.',
            'TENANT_AUTHENTICATION_REQUIRED',
            {
                statusCode:
                    401,
            }
        );
    }

    /**
     * Production should normally fail closed.
     */
    if (
        options.allowFallbackTenant &&
        !options.strictValidation
    ) {
        return {
            tenantId:
                validateTenantOrThrow(
                    options.fallbackTenant
                ),

            source:
                'fallback',

            authenticated,
        };
    }

    throw new TenantMiddlewareError(
        'Unable to resolve a trusted tenant.',
        'TENANT_RESOLUTION_FAILED',
        {
            statusCode:
                403,
        }
    );
}

/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

function validateTenant(
    value
) {
    const normalized =
        normalizeIdentifier(
            value
        )?.toLowerCase();

    if (
        !normalized
    ) {
        return null;
    }

    if (
        typeof tenantConstants
            .isValidTenantId ===
            'function' &&
        tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        return normalized;
    }

    return null;
}

function validateTenantOrThrow(
    value
) {
    const tenantId =
        validateTenant(
            value
        );

    if (
        !tenantId
    ) {
        throw new TenantMiddlewareError(
            'Invalid tenant identifier.',
            'INVALID_TENANT_ID',
            {
                statusCode:
                    400,
            }
        );
    }

    return tenantId;
}

/**
 * ============================================================================
 * Request Context Helpers
 * ============================================================================
 */

function buildRequestContext(
    req,
    options,
    tenantId,
    source,
    authenticated
) {
    const requestId =
        normalizeIdentifier(
            readHeader(
                req,
                options.requestIdHeader
            )
        ) ||
        normalizeIdentifier(
            req?.requestId
        ) ||
        generateRequestId();

    const correlationId =
        normalizeIdentifier(
            readHeader(
                req,
                options.correlationIdHeader
            )
        ) ||
        normalizeIdentifier(
            req?.correlationId
        ) ||
        requestId;

    return {
        requestId,

        correlationId,

        tenantId,

        tenantMeta:
            {},

        actorId:
            getAuthenticatedActorId(
                req
            ),

        source,

        authenticated,

        startTime:
            Date.now(),
    };
}

function attachRequestContext(
    req,
    context,
    options
) {
    if (
        !options.attachToRequest
    ) {
        return;
    }

    req.titechTenant =
        context;

    req.tenantContext =
        context;

    req.tenantId =
        context.tenantId;

    req.tenant =
        context.tenantId;

    req.requestId =
        context.requestId;

    req.correlationId =
        context.correlationId;

    req.tenantContextTrusted =
        true;

    req.getTenantId =
        () =>
            tenantContext.getTenantId({
                required:
                    true,
            });

    req.getTenantContext =
        () =>
            tenantContext.getTenantContext();

    req.getTenantActorId =
        () =>
            tenantContext.getActorId();
}

/**
 * ============================================================================
 * Audit
 * ============================================================================
 */

function buildAuditRecord({
    tenantId,
    req,
    action,
    outcome,
    meta = {},
} = {}) {
    return {
        timestamp:
            new Date()
                .toISOString(),

        service:
            'TITech.Tenancy',

        tenant:
            tenantId ||
            null,

        requestId:
            normalizeIdentifier(
                req?.requestId
            ) ||
            normalizeIdentifier(
                readHeader(
                    req,
                    'x-request-id'
                )
            ),

        correlationId:
            normalizeIdentifier(
                req?.correlationId
            ) ||
            normalizeIdentifier(
                readHeader(
                    req,
                    'x-correlation-id'
                )
            ),

        actorId:
            getAuthenticatedActorId(
                req
            ),

        path:
            req?.originalUrl ||
            req?.url ||
            null,

        method:
            req?.method ||
            null,

        action:
            action ||
            null,

        outcome:
            outcome ||
            null,

        meta:
            sanitizeAuditMeta(
                meta
            ),
    };
}

function sanitizeAuditMeta(
    meta
) {
    if (
        !isPlainObject(
            meta
        )
    ) {
        return {};
    }

    const result =
        {};

    const sensitive =
        /password|secret|token|authorization|cookie|credential|private.?key|api.?key/i;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            meta
        )
    ) {
        if (
            sensitive.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

function defaultAuditLogger(
    logger,
    record
) {
    try {
        const output =
            logger &&
            typeof logger.info ===
                'function'
                ? logger.info.bind(
                    logger
                )
                : console.info.bind(
                    console
                );

        output(
            'TITech Tenant Audit',
            record
        );
    } catch (
        error
    ) {
        safeLogError(
            logger,
            'TITech audit logging failed',
            {
                error:
                    error?.message,
            }
        );
    }
}

/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

function recordMetric(
    metrics,
    metric,
    labels,
    logger
) {
    if (
        !metrics ||
        typeof metrics.increment !==
            'function'
    ) {
        return;
    }

    try {
        metrics.increment(
            metric,
            labels
        );
    } catch (
        error
    ) {
        safeLogWarn(
            logger,
            'TITech metrics increment failed',
            {
                metric,
                error:
                    error?.message,
            }
        );
    }
}

function recordGauge(
    metrics,
    metric,
    value,
    labels,
    logger
) {
    if (
        !metrics ||
        typeof metrics.gauge !==
            'function'
    ) {
        return;
    }

    try {
        metrics.gauge(
            metric,
            value,
            labels
        );
    } catch (
        error
    ) {
        safeLogWarn(
            logger,
            'TITech metrics gauge failed',
            {
                metric,
                error:
                    error?.message,
            }
        );
    }
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

async function enforceRateLimit(
    {
        rateLimiter,
        tenantId,
        req,
        logger,
        metrics,
        options,
    }
) {
    if (
        !options.enableRateLimit ||
        !rateLimiter ||
        typeof rateLimiter.consume !==
            'function'
    ) {
        return null;
    }

    const actorId =
        getAuthenticatedActorId(
            req
        );

    const key =
        actorId
            ? `rate:${tenantId}:actor:${actorId}`
            : `rate:${tenantId}`;

    try {
        const result =
            await rateLimiter.consume(
                key
            );

        if (
            !result ||
            result.ok ===
                false
        ) {
            const error =
                new TenantMiddlewareError(
                    'Tenant rate limit exceeded.',
                    'TENANT_RATE_LIMITED',
                    {
                        statusCode:
                            429,
                    }
                );

            if (
                result
            ) {
                error.remaining =
                    result.remaining;

                error.reset =
                    result.reset;
            }

            recordMetric(
                metrics,
                'titech.tenancy.rate_limit.blocked',
                {
                    tenant:
                        tenantId,
                },
                logger
            );

            return {
                blocked:
                    true,

                error,

                remaining:
                    result?.remaining,

                reset:
                    result?.reset,
            };
        }

        return {
            blocked:
                false,

            remaining:
                result.remaining,

            reset:
                result.reset,
        };
    } catch (
        error
    ) {
        /**
         * Rate-limiter failure policy is configurable.
         *
         * For financial/security-sensitive environments, fail-closed is the
         * safer production default.
         */
        if (
            options.failClosedOnRateLimiterError
        ) {
            throw new TenantMiddlewareError(
                'Tenant rate-limiting service is unavailable.',
                'TENANT_RATE_LIMITER_UNAVAILABLE',
                {
                    statusCode:
                        503,

                    cause:
                        error,
                }
            );
        }

        safeLogWarn(
            logger,
            'TITech rate limiter failed open',
            {
                error:
                    error?.message,
            }
        );

        return {
            blocked:
                false,

            limiterError:
                true,
        };
    }
}

/**
 * ============================================================================
 * Resource Integration
 * ============================================================================
 */

function attachConfiguredResources(
    {
        cacheClient,
        dbResolver,
        req,
    }
) {
    if (
        cacheClient
    ) {
        try {
            tenantContext.attachResource(
                'cacheClient',
                cacheClient
            );
        } catch (
            error
        ) {
            throw new TenantMiddlewareError(
                'Failed to attach tenant cache client.',
                'TENANT_CACHE_ATTACHMENT_FAILED',
                {
                    statusCode:
                        500,

                    cause:
                        error,
                }
            );
        }
    }

    if (
        dbResolver
    ) {
        req.getTenantDb =
            async () => {
                if (
                    typeof dbResolver ===
                        'function'
                ) {
                    return dbResolver(
                        tenantContext.getTenantId({
                            required:
                                true,
                        }),
                        tenantContext.getTenantContext()
                    );
                }

                if (
                    typeof dbResolver
                        .getDbConnectionForCurrentTenant ===
                    'function'
                ) {
                    return dbResolver
                        .getDbConnectionForCurrentTenant();
                }

                throw new TenantMiddlewareError(
                    'Invalid tenant database resolver.',
                    'TENANT_DB_RESOLVER_INVALID'
                );
            };
    } else if (
        typeof tenantContext.createDbResolver ===
            'function' &&
        typeof req.getTenantDb !==
            'function'
    ) {
        req.getTenantDb =
            async () => {
                throw new TenantMiddlewareError(
                    'No tenant database resolver is configured.',
                    'TENANT_DB_RESOLVER_NOT_CONFIGURED',
                    {
                        statusCode:
                            503,
                    }
                );
            };
    }
}

/**
 * ============================================================================
 * Express Middleware Factory
 * ============================================================================
 */

function createExpressTenantMiddleware(
    userOptions = {}
) {
    const options =
        Object.freeze({
            ...DEFAULT_OPTIONS,
            ...userOptions,
        });

    const logger =
        options.logger;

    const metrics =
        options.metrics;

    const rateLimiter =
        options.rateLimiter;

    const auditLogger =
        options.auditLogger ||
        defaultAuditLogger;

    return function tenantMiddleware(
        req,
        res,
        next
    ) {
        let context = null;
        let cleanupStarted =
            false;

        try {
            const resolution =
                resolveTenantForRequest(
                    req,
                    options
                );

            context =
                tenantContext.createContextObject
                    ? tenantContext.createContextObject({
                        tenantId:
                            resolution.tenantId,

                        tenantMeta:
                            {},

                        requestId:
                            readHeader(
                                req,
                                options.requestIdHeader
                            ) ||
                            req.requestId ||
                            generateRequestId(),

                        correlationId:
                            readHeader(
                                req,
                                options.correlationIdHeader
                            ) ||
                            req.correlationId,

                        actorId:
                            getAuthenticatedActorId(
                                req
                            ),

                        source:
                            resolution.source,

                        authenticated:
                            resolution.authenticated,
                    })
                    : {
                        ...buildRequestContext(
                            req,
                            options,
                            resolution.tenantId,
                            resolution.source,
                            resolution.authenticated
                        ),
                    };

            if (
                !context.correlationId
            ) {
                context.correlationId =
                    context.requestId;
            }

            /**
             * Important:
             *
             * tenantContext.attachTenantContext() uses AsyncLocalStorage, but
             * Express request scoping is best preserved by entering the
             * context synchronously before next() is invoked.
             */
            return tenantContext.runWithTenantContext
                ? runExpressContext(
                    context,
                    req,
                    res,
                    next,
                    options,
                    logger,
                    metrics,
                    rateLimiter,
                    auditLogger
                )
                : next(
                    new TenantMiddlewareError(
                        'Tenant context implementation is unavailable.',
                        'TENANT_CONTEXT_UNAVAILABLE'
                    )
                );
        } catch (
            error
        ) {
            emitMiddlewareError(
                error,
                'express-middleware'
            );

            return next(
                error
            );
        }

        async function cleanup() {
            if (
                cleanupStarted
            ) {
                return;
            }

            cleanupStarted =
                true;

            try {
                await tenantContext.cleanupResources();

                recordGauge(
                    metrics,
                    tenantConstants.METRICS?.tenantGauge?.(
                        context?.tenantId
                    ),
                    0,
                    {
                        tenant:
                            context?.tenantId,
                    },
                    logger
                );
            } catch (
                error
            ) {
                emitMiddlewareError(
                    error,
                    'express-cleanup'
                );
            }
        }

        async function runExpressContext(
            contextObject,
            request,
            response,
            nextMiddleware,
            opts,
            log,
            metric,
            limiter,
            audit
        ) {
            return tenantContext.runWithTenantContext(
                {
                    tenantId:
                        contextObject.tenantId,

                    tenantMeta:
                        contextObject.tenantMeta,

                    requestId:
                        contextObject.requestId,

                    correlationId:
                        contextObject.correlationId,

                    actorId:
                        contextObject.actorId,

                    source:
                        contextObject.source,

                    authenticated:
                        contextObject.authenticated,
                },
                async () => {
                    attachRequestContext(
                        request,
                        contextObject,
                        opts
                    );

                    response.setHeader(
                        'X-Request-Id',
                        contextObject.requestId
                    );

                    response.setHeader(
                        'X-Correlation-Id',
                        contextObject.correlationId
                    );

                    try {
                        const limit =
                            await enforceRateLimit({
                                rateLimiter:
                                    limiter,

                                tenantId:
                                    contextObject.tenantId,

                                req:
                                    request,

                                logger:
                                    log,

                                metrics:
                                    metric,

                                options:
                                    opts,
                            });

                        if (
                            limit?.blocked
                        ) {
                            request.rateLimit =
                                {
                                    remaining:
                                        limit.remaining,

                                    reset:
                                        limit.reset,
                                };

                            if (
                                opts.enableAudit
                            ) {
                                const record =
                                    buildAuditRecord({
                                        tenantId:
                                            contextObject.tenantId,

                                        req:
                                            request,

                                        action:
                                            'tenant_rate_limit',

                                        outcome:
                                            'blocked',
                                    });

                                audit(
                                    log,
                                    record
                                );
                            }

                            return nextMiddleware(
                                limit.error
                            );
                        }

                        if (
                            limit
                        ) {
                            request.rateLimit =
                                {
                                    remaining:
                                        limit.remaining,

                                    reset:
                                        limit.reset,
                                };
                        }

                        attachConfiguredResources(
                            {
                                cacheClient:
                                    opts.cacheClient,

                                dbResolver:
                                    opts.dbResolver,

                                req:
                                    request,
                            }
                        );

                        recordMetric(
                            metric,
                            tenantConstants.METRICS?.requestCounter?.(
                                contextObject.tenantId
                            ),
                            {
                                tenant:
                                    contextObject.tenantId,
                            },
                            log
                        );

                        if (
                            opts.enableAudit
                        ) {
                            const record =
                                buildAuditRecord({
                                    tenantId:
                                        contextObject.tenantId,

                                    req:
                                        request,

                                    action:
                                        'tenant_resolve',

                                    outcome:
                                        'ok',

                                    meta:
                                        {
                                            source:
                                                contextObject.source,
                                        },
                                });

                            audit(
                                log,
                                record
                            );
                        }

                        response.once(
                            'finish',
                            () => {
                                void cleanup();
                            }
                        );

                        response.once(
                            'close',
                            () => {
                                void cleanup();
                            }
                        );

                        tenantEvents.emit(
                            'tenant:attached',
                            {
                                tenantId:
                                    contextObject.tenantId,

                                meta:
                                    {
                                        source:
                                            contextObject.source,

                                        requestId:
                                            contextObject.requestId,

                                        correlationId:
                                            contextObject.correlationId,
                                    },
                            }
                        );

                        return nextMiddleware();
                    } catch (
                        error
                    ) {
                        if (
                            opts.enableAudit
                        ) {
                            const record =
                                buildAuditRecord({
                                    tenantId:
                                        contextObject.tenantId,

                                    req:
                                        request,

                                    action:
                                        'tenant_resolve',

                                    outcome:
                                        'error',

                                    meta:
                                        {
                                            code:
                                                error?.code,
                                        },
                                });

                            audit(
                                log,
                                record
                            );
                        }

                        emitMiddlewareError(
                            error,
                            'express-processing'
                        );

                        return nextMiddleware(
                            error
                        );
                    }
                }
            );
        }
    };
}

/**
 * ============================================================================
 * Koa Middleware
 * ============================================================================
 *
 * Uses the canonical tenant.context API directly. It does NOT build a fake
 * Express response/request object.
 * ============================================================================
 */

function createKoaTenantMiddleware(
    userOptions = {}
) {
    const options =
        Object.freeze({
            ...DEFAULT_OPTIONS,
            ...userOptions,
        });

    const logger =
        options.logger;

    const metrics =
        options.metrics;

    const rateLimiter =
        options.rateLimiter;

    const auditLogger =
        options.auditLogger ||
        defaultAuditLogger;

    return async function koaTenantMiddleware(
        ctx,
        next
    ) {
        const req =
            ctx.request;

        const resolution =
            resolveTenantForRequest(
                req,
                options
            );

        const requestId =
            readHeader(
                req,
                options.requestIdHeader
            ) ||
            ctx.requestId ||
            generateRequestId();

        const correlationId =
            readHeader(
                req,
                options.correlationIdHeader
            ) ||
            ctx.correlationId ||
            requestId;

        const actorId =
            getAuthenticatedActorId(
                req
            );

        return tenantContext.runWithTenantContext(
            {
                tenantId:
                    resolution.tenantId,

                tenantMeta:
                    {},

                requestId,

                correlationId,

                actorId,

                source:
                    resolution.source,

                authenticated:
                    resolution.authenticated,
            },
            async context => {
                try {
                    ctx.state =
                        ctx.state ||
                        {};

                    ctx.state.titechTenant =
                        context;

                    ctx.state.tenant =
                        context.tenantId;

                    ctx.state.tenantId =
                        context.tenantId;

                    ctx.state.requestId =
                        requestId;

                    ctx.state.correlationId =
                        correlationId;

                    const limit =
                        await enforceRateLimit({
                            rateLimiter,

                            tenantId:
                                context.tenantId,

                            req,

                            logger,

                            metrics,

                            options,
                        });

                    if (
                        limit?.blocked
                    ) {
                        if (
                            options.enableAudit
                        ) {
                            const record =
                                buildAuditRecord({
                                    tenantId:
                                        context.tenantId,

                                    req,

                                    action:
                                        'tenant_rate_limit',

                                    outcome:
                                        'blocked',
                                });

                            auditLogger(
                                logger,
                                record
                            );
                        }

                        ctx.status =
                            429;

                        ctx.body =
                            {
                                success:
                                    false,

                                code:
                                    'TENANT_RATE_LIMITED',

                                message:
                                    'Tenant rate limit exceeded.',

                                requestId,

                                correlationId,
                            };

                        return;
                    }

                    attachConfiguredResources(
                        {
                            cacheClient:
                                options.cacheClient,

                            dbResolver:
                                options.dbResolver,

                            req,
                        }
                    );

                    ctx.state.rateLimit =
                        limit;

                    recordMetric(
                        metrics,
                        tenantConstants.METRICS?.requestCounter?.(
                            context.tenantId
                        ),
                        {
                            tenant:
                                context.tenantId,
                        },
                        logger
                    );

                    if (
                        options.enableAudit
                    ) {
                        const record =
                            buildAuditRecord({
                                tenantId:
                                    context.tenantId,

                                req,

                                action:
                                    'tenant_resolve',

                                outcome:
                                    'ok',

                                meta:
                                    {
                                        source:
                                            context.source,
                                    },
                            });

                        auditLogger(
                            logger,
                            record
                        );
                    }

                    await next();
                } catch (
                    error
                ) {
                    emitMiddlewareError(
                        error,
                        'koa-middleware'
                    );

                    throw error;
                }
            }
        );
    };
}

/**
 * ============================================================================
 * GraphQL Context Factory
 * ============================================================================
 *
 * HTTP:
 *   context = ({ req })
 *
 * WebSocket/subscription:
 *   connection.context already contains a trusted tenant context.
 * ============================================================================
 */

function createGraphQLContextFactory(
    userOptions = {}
) {
    const options =
        Object.freeze({
            ...DEFAULT_OPTIONS,
            ...userOptions,
        });

    return async function graphqlContext(
        params = {}
    ) {
        const req =
            params.req ||
            null;

        const connection =
            params.connection ||
            null;

        /**
         * Subscription context must already be authenticated and tenant
         * validated during the WebSocket handshake.
         */
        if (
            connection?.context
                ?.tenant
        ) {
            const tenantId =
                validateTenantOrThrow(
                    connection
                        .context
                        .tenant
                );

            const context =
                await tenantContext.runWithTenantContext(
                    {
                        tenantId,

                        tenantMeta:
                            connection
                                .context
                                .tenantMeta ||
                            {},

                        requestId:
                            connection
                                .context
                                .requestId ||
                            generateRequestId(),

                        correlationId:
                            connection
                                .context
                                .correlationId ||
                            connection
                                .context
                                .requestId ||
                            generateRequestId(),

                        actorId:
                            connection
                                .context
                                .actorId ||
                            null,

                        source:
                            'graphql-subscription',

                        authenticated:
                            connection
                                .context
                                .authenticated !==
                            false,
                    },
                    async scope =>
                        scope
                );

            return {
                tenant:
                    tenantId,

                tenantId,

                titech:
                    context,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,
            };
        }

        if (
            !req
        ) {
            throw new TenantMiddlewareError(
                'GraphQL request context is unavailable.',
                'GRAPHQL_REQUEST_CONTEXT_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const resolution =
            resolveTenantForRequest(
                req,
                options
            );

        const requestId =
            readHeader(
                req,
                options.requestIdHeader
            ) ||
            req.requestId ||
            generateRequestId();

        const correlationId =
            readHeader(
                req,
                options.correlationIdHeader
            ) ||
            req.correlationId ||
            requestId;

        const context =
            await tenantContext.runWithTenantContext(
                {
                    tenantId:
                        resolution.tenantId,

                    tenantMeta:
                        {},

                    requestId,

                    correlationId,

                    actorId:
                        getAuthenticatedActorId(
                            req
                        ),

                    source:
                        resolution.source,

                    authenticated:
                        resolution.authenticated,
                },
                async scope =>
                    scope
            );

        return {
            tenant:
                context.tenantId,

            tenantId:
                context.tenantId,

            titech:
                context,

            requestId,

            correlationId,
        };
    };
}

/**
 * ============================================================================
 * WebSocket Handshake Helper
 * ============================================================================
 *
 * The returned context is intended to be persisted on the socket/session.
 *
 * A WebSocket client header is NOT automatically trusted.
 * An upstream authentication layer should verify the user/session first.
 * ============================================================================
 */

function wsHandshake(
    req,
    userOptions = {}
) {
    const options =
        Object.freeze({
            ...DEFAULT_OPTIONS,
            ...userOptions,
        });

    const resolution =
        resolveTenantForRequest(
            req,
            options
        );

    const requestId =
        readHeader(
            req,
            options.requestIdHeader
        ) ||
        generateRequestId();

    const correlationId =
        readHeader(
            req,
            options.correlationIdHeader
        ) ||
        requestId;

    const actorId =
        getAuthenticatedActorId(
            req
        );

    const socketContext =
        {
            tenant:
                resolution.tenantId,

            tenantId:
                resolution.tenantId,

            tenantMeta:
                {},

            requestId,

            correlationId,

            actorId,

            source:
                resolution.source,

            authenticated:
                resolution.authenticated,
        };

    tenantEvents.emit(
        'tenant:resolved',
        {
            tenantId:
                resolution.tenantId,

            source:
                resolution.source,

            meta:
                {
                    transport:
                        'websocket',

                    requestId,

                    correlationId,
                },
        }
    );

    return socketContext;
}

/**
 * ============================================================================
 * Tenant Access Control
 * ============================================================================
 */

function createTenantAccessControl({
    allowed = null,
    denied = null,
    matchRegex = true,
} = {}) {
    const allowedRules =
        compileTenantRules(
            allowed,
            matchRegex
        );

    const deniedRules =
        compileTenantRules(
            denied,
            matchRegex
        );

    return function tenantAccessControl(
        req,
        res,
        next
    ) {
        try {
            const tenantId =
                tenantContext.getTenantId({
                    required:
                        true,
                });

            if (
                !tenantId
            ) {
                return next(
                    new TenantMiddlewareError(
                        'Tenant context is required.',
                        'TENANT_CONTEXT_REQUIRED',
                        {
                            statusCode:
                                403,
                        }
                    )
                );
            }

            if (
                allowedRules.length &&
                !matchesTenantRule(
                    tenantId,
                    allowedRules
                )
            ) {
                const error =
                    new TenantMiddlewareError(
                        'Tenant is not allowed to access this resource.',
                        'TENANT_ACCESS_DENIED',
                        {
                            statusCode:
                                403,
                        }
                    );

                tenantEvents.emit(
                    'tenant:error',
                    {
                        error,

                        meta:
                            {
                                tenantId,

                                stage:
                                    'access-control-allowed',
                            },
                    }
                );

                return next(
                    error
                );
            }

            if (
                deniedRules.length &&
                matchesTenantRule(
                    tenantId,
                    deniedRules
                )
            ) {
                const error =
                    new TenantMiddlewareError(
                        'Tenant access is denied.',
                        'TENANT_ACCESS_DENIED',
                        {
                            statusCode:
                                403,
                        }
                    );

                tenantEvents.emit(
                    'tenant:error',
                    {
                        error,

                        meta:
                            {
                                tenantId,

                                stage:
                                    'access-control-denied',
                            },
                    }
                );

                return next(
                    error
                );
            }

            return next();
        } catch (
            error
        ) {
            return next(
                error
            );
        }
    };
}

function compileTenantRules(
    rules,
    matchRegex
) {
    if (
        !Array.isArray(
            rules
        )
    ) {
        return [];
    }

    return rules
        .map(
            rule => {
                if (
                    rule instanceof RegExp
                ) {
                    return rule;
                }

                const value =
                    normalizeIdentifier(
                        rule
                    );

                if (
                    !value
                ) {
                    return null;
                }

                if (
                    matchRegex &&
                    value.startsWith('/') &&
                    value.lastIndexOf('/') >
                        0
                ) {
                    const lastSlash =
                        value.lastIndexOf(
                            '/'
                        );

                    try {
                        return new RegExp(
                            value.slice(
                                1,
                                lastSlash
                            ),
                            value.slice(
                                lastSlash + 1
                            )
                        );
                    } catch {
                        return validateTenant(
                            value
                        );
                    }
                }

                return validateTenant(
                    value
                );
            }
        )
        .filter(Boolean);
}

function matchesTenantRule(
    tenantId,
    rules
) {
    return rules.some(
        rule => {
            if (
                rule instanceof RegExp
            ) {
                return rule.test(
                    tenantId
                );
            }

            return (
                rule ===
                tenantId
            );
        }
    );
}

/**
 * ============================================================================
 * Express Full Tenancy Stack
 * ============================================================================
 */

function createExpressTenancyStack(
    options = {}
) {
    const {
        accessControl = null,
        ...tenantOptions
    } =
        options;

    const tenantResolver =
        createExpressTenantMiddleware(
            tenantOptions
        );

    if (
        accessControl
    ) {
        const accessMiddleware =
            createTenantAccessControl(
                accessControl
            );

        return [
            tenantResolver,
            accessMiddleware,
        ];
    }

    return [
        tenantResolver,
    ];
}

/**
 * ============================================================================
 * Logging Helpers
 * ============================================================================
 */

function safeLogWarn(
    logger,
    message,
    metadata = {}
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
        // Logging failures must never interrupt a request.
    }
}

function safeLogError(
    logger,
    message,
    metadata = {}
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
        // Logging failures must never interrupt a request.
    }
}

/**
 * ============================================================================
 * Event Helper
 * ============================================================================
 */

function emitMiddlewareError(
    error,
    stage
) {
    try {
        tenantEvents.emit(
            'tenant:error',
            {
                error,

                meta:
                    {
                        stage,

                        code:
                            error?.code,

                        statusCode:
                            error?.statusCode,
                    },
            }
        );
    } catch {
        // Event listeners must never break middleware.
    }
}

/**
 * ============================================================================
 * Plain Object Helper
 * ============================================================================
 */

function isPlainObject(
    value
) {
    return (
        value !==
            null &&
        typeof value ===
            'object' &&
        !Array.isArray(
            value
        )
    );
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Error
         */
        TenantMiddlewareError,

        /**
         * Middleware factories
         */
        createExpressTenantMiddleware,

        createKoaTenantMiddleware,

        createGraphQLContextFactory,

        wsHandshake,

        /**
         * Access control
         */
        createTenantAccessControl,

        createExpressTenancyStack,

        /**
         * Audit
         */
        buildAuditRecord,

        defaultAuditLogger,

        /**
         * Defaults
         */
        DEFAULT_OPTIONS,

        /**
         * Helpers
         */
        readHeader,

        resolveTenantForRequest,

        validateTenant,

        validateTenantOrThrow,

        isAuthenticatedRequest,

        getAuthenticatedActorId,
    });