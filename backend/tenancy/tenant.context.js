'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenant Context Manager
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.context.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Request-scoped tenant context manager for the TITech Community Capital
 * multi-tenant backend.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Maintain request-scoped tenant context with AsyncLocalStorage.
 * - Resolve tenant context from already-trusted authentication state.
 * - Support Express middleware.
 * - Support Koa middleware.
 * - Support manual/background-job tenant scopes.
 * - Preserve request and correlation identifiers.
 * - Attach tenant-scoped resources.
 * - Resolve tenant-scoped database/cache resources.
 * - Provide tenant-aware logging.
 * - Emit tenancy lifecycle events.
 * - Fail closed when strict tenancy validation is enabled.
 *
 * Security model
 * ----------------------------------------------------------------------------
 *
 * Tenant identity is NOT trusted merely because it appears in:
 *
 *   - x-tenant-id
 *   - x-tenant-domain
 *   - Host
 *   - Authorization header
 *
 * The authentication / authorization layer must first establish a trusted
 * principal and tenant context.
 *
 * This module may READ an already-verified tenant claim from:
 *
 *   req.user
 *   req.auth
 *   req.tenantContext
 *   req.tenant
 *
 * It NEVER calls jwt.decode() and treats an unverified token as authoritative.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const {
    AsyncLocalStorage,
} = require('node:async_hooks');

const {
    EventEmitter,
} = require('node:events');

const crypto =
    require('node:crypto');

const tenantConstants =
    require('./tenant.constants');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CONTEXT_KEY =
    'titech_tenant_context';

const DEFAULT_TENANT =
    tenantConstants.DEFAULTS.DEFAULT_TENANT;

const TENANT_HEADER =
    tenantConstants.AUTH?.TENANT_HEADER ||
    tenantConstants.ENV?.TENANT_ID_HEADER ||
    'x-tenant-id';

const TENANT_DOMAIN_HEADER =
    tenantConstants.AUTH?.TENANT_DOMAIN_HEADER ||
    tenantConstants.ENV?.TENANT_DOMAIN_HEADER ||
    'x-tenant-domain';

const TENANT_CLAIM =
    tenantConstants.AUTH?.TENANT_CLAIM ||
    tenantConstants.ENV?.JWT_TENANT_CLAIM ||
    'titech_tenant';

const SECONDARY_TENANT_CLAIM =
    tenantConstants.ENV?.TENANT_ID_CLAIM ||
    'tenant_id';

const LOG_PREFIX =
    tenantConstants.LOGGING?.TENANT_LOG_PREFIX ||
    'TITech.Tenancy.Context';

const STRICT_VALIDATION =
    Boolean(
        tenantConstants.ENV?.TENANT_CACHE_STRICT
    );

const NODE_ENV =
    String(
        tenantConstants.ENV?.NODE_ENV ||
        process.env.NODE_ENV ||
        'DEVELOPMENT'
    ).toUpperCase();

const IS_PRODUCTION =
    NODE_ENV === 'PRODUCTION';

const REQUIRE_TRUSTED_TENANT =
    parseBoolean(
        process.env.TITECH_REQUIRE_TRUSTED_TENANT,
        IS_PRODUCTION
    );

const ALLOW_DEFAULT_TENANT =
    parseBoolean(
        process.env.TITECH_ALLOW_DEFAULT_TENANT,
        !IS_PRODUCTION
    );

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class TenantContextError extends Error {
    constructor(
        message,
        code = 'TENANT_CONTEXT_ERROR',
        {
            statusCode = 500,
            cause = undefined,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'TenantContextError';

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
            TenantContextError
        );
    }
}

/**
 * ============================================================================
 * Event Emitter
 * ============================================================================
 *
 * Events:
 *
 * tenant:resolved
 * tenant:attached
 * tenant:cleared
 * tenant:error
 * resource:attached
 * resource:cleanup
 * ============================================================================
 */

const tenantEvents =
    new EventEmitter();

/**
 * Prevent a listener from causing process instability through an exception.
 */
tenantEvents.on(
    'error',
    () => {}
);

/**
 * ============================================================================
 * AsyncLocalStorage
 * ============================================================================
 */

const als =
    new AsyncLocalStorage();

/**
 * ============================================================================
 * Context Shape
 * ============================================================================
 *
 * {
 *   tenantId,
 *   tenantMeta,
 *   requestId,
 *   correlationId,
 *   actorId,
 *   source,
 *   authenticated,
 *   startTime,
 *   resources
 * }
 * ============================================================================
 */

function createContextObject({
    tenantId = null,
    tenantMeta = {},
    requestId = null,
    correlationId = null,
    actorId = null,
    source = 'unknown',
    authenticated = false,
} = {}) {
    const normalizedTenantId =
        tenantId
            ? normalizeTenantId(
                tenantId
            )
            : null;

    if (
        normalizedTenantId &&
        !tenantConstants.isValidTenantId(
            normalizedTenantId
        )
    ) {
        throw new TenantContextError(
            'Invalid tenant identifier.',
            'INVALID_TENANT_ID',
            {
                statusCode: 400,
            }
        );
    }

    return {
        tenantId:
            normalizedTenantId,

        tenantMeta:
            isPlainObject(
                tenantMeta
            )
                ? {
                    ...tenantMeta,
                }
                : {},

        requestId:
            normalizeIdentifier(
                requestId
            ),

        correlationId:
            normalizeIdentifier(
                correlationId
            ),

        actorId:
            normalizeIdentifier(
                actorId
            ),

        source:
            normalizeIdentifier(
                source
            ) ||
            'unknown',

        authenticated:
            Boolean(
                authenticated
            ),

        startTime:
            Date.now(),

        resources:
            {
                dbConnection:
                    null,

                cacheClient:
                    null,

                logger:
                    null,

                metrics:
                    null,
            },
    };
}

/**
 * ============================================================================
 * Context Inspection
 * ============================================================================
 */

function getTenantContext() {
    return (
        als.getStore() ||
        null
    );
}

function hasTenantContext() {
    const ctx =
        getTenantContext();

    return Boolean(
        ctx &&
        ctx.tenantId
    );
}

function getTenantId({
    required = false,
} = {}) {
    const ctx =
        getTenantContext();

    const tenantId =
        ctx?.tenantId ||
        null;

    if (
        !tenantId &&
        required
    ) {
        throw new TenantContextError(
            'No tenant context is available.',
            'TENANT_CONTEXT_REQUIRED',
            {
                statusCode: 500,
            }
        );
    }

    return tenantId;
}

function getActorId() {
    return (
        getTenantContext()
            ?.actorId ||
        null
    );
}

function getRequestId() {
    return (
        getTenantContext()
            ?.requestId ||
        null
    );
}

function getCorrelationId() {
    return (
        getTenantContext()
            ?.correlationId ||
        null
    );
}

/**
 * ============================================================================
 * Tenant Resolution
 * ============================================================================
 *
 * Resolution order:
 *
 *   1. Existing trusted tenant context
 *   2. req.adminContext / req.tenantContext
 *   3. req.tenant
 *   4. Verified authenticated principal tenant claim
 *   5. Authenticated principal tenantId
 *   6. Explicit header ONLY when trusted externally by prior middleware
 *   7. Host/domain resolution ONLY when explicitly enabled
 *   8. Default tenant only when explicitly allowed
 *
 * IMPORTANT:
 *
 * x-tenant-id is never considered proof of tenant identity by itself.
 * ============================================================================
 */

function resolveTenantIdFromRequest(
    req = {},
    {
        resolveFrom = 'auto',
        allowHeader = true,
        allowHost = true,
        allowVerifiedPrincipal = true,
        allowFallback = ALLOW_DEFAULT_TENANT,
        requireAuthenticatedPrincipal =
            REQUIRE_TRUSTED_TENANT,
    } = {}
) {
    try {
        /**
         * Existing trusted context.
         */
        const trustedContextTenant =
            extractTrustedTenantFromContext(
                req
            );

        if (
            trustedContextTenant
        ) {
            emitResolved(
                trustedContextTenant,
                'context'
            );

            return trustedContextTenant;
        }

        /**
         * Verified authentication context.
         *
         * This is the preferred source.
         */
        if (
            allowVerifiedPrincipal
        ) {
            const principalTenant =
                extractTenantFromVerifiedPrincipal(
                    req
                );

            if (
                principalTenant
            ) {
                emitResolved(
                    principalTenant,
                    'verified-principal'
                );

                return principalTenant;
            }
        }

        /**
         * Header handling.
         *
         * A raw header is accepted only when an earlier trusted middleware
         * explicitly marks it as trusted.
         */
        if (
            (
                resolveFrom === 'header' ||
                resolveFrom === 'auto'
            ) &&
            allowHeader &&
            isTrustedTenantHeader(
                req
            )
        ) {
            const headerTenant =
                getTenantHeader(
                    req
                );

            if (
                headerTenant
            ) {
                const normalized =
                    validateTenantOrThrow(
                        headerTenant
                    );

                emitResolved(
                    normalized,
                    'trusted-header'
                );

                return normalized;
            }
        }

        /**
         * Host/domain resolution.
         *
         * Domain resolution may be used only if explicitly enabled.
         */
        if (
            (
                resolveFrom === 'host' ||
                resolveFrom === 'auto'
            ) &&
            allowHost &&
            tenantConstants.FEATURE_FLAGS
                ?.TENANT_DOMAIN_RESOLUTION !==
                false
        ) {
            const domainTenant =
                resolveTenantFromHost(
                    req
                );

            if (
                domainTenant
            ) {
                emitResolved(
                    domainTenant,
                    'host'
                );

                return domainTenant;
            }
        }

        /**
         * JWT-only mode should fail if an authenticated tenant cannot be found.
         */
        if (
            resolveFrom === 'jwt' &&
            !extractTenantFromVerifiedPrincipal(
                req
            )
        ) {
            throw new TenantContextError(
                'Verified JWT tenant context is unavailable.',
                'VERIFIED_JWT_TENANT_REQUIRED',
                {
                    statusCode: 401,
                }
            );
        }

        /**
         * Trusted tenancy is mandatory for production financial operations.
         */
        if (
            requireAuthenticatedPrincipal &&
            !isAuthenticatedRequest(
                req
            )
        ) {
            throw new TenantContextError(
                'Authenticated tenant context is required.',
                'AUTHENTICATED_TENANT_REQUIRED',
                {
                    statusCode: 401,
                }
            );
        }

        /**
         * Default tenant should not silently become a production security
         * boundary.
         */
        if (
            allowFallback &&
            !IS_PRODUCTION
        ) {
            emitResolved(
                DEFAULT_TENANT,
                'fallback'
            );

            return DEFAULT_TENANT;
        }

        throw new TenantContextError(
            'Unable to resolve a trusted tenant.',
            'TENANT_RESOLUTION_FAILED',
            {
                statusCode: 403,
            }
        );
    } catch (
        error
    ) {
        emitTenantError(
            error,
            {
                stage:
                    'resolveTenantIdFromRequest',
            }
        );

        throw error;
    }
}

/**
 * ============================================================================
 * Verified Principal Extraction
 * ============================================================================
 *
 * This deliberately DOES NOT decode Authorization tokens.
 *
 * `req.user` / `req.auth` must be populated by the project's authentication
 * middleware after successful JWT verification.
 * ============================================================================
 */

function extractTenantFromVerifiedPrincipal(
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

    /**
     * Optional explicit marker can be used by the auth middleware.
     */
    if (
        principal.tokenVerified ===
            false ||
        principal.authenticated ===
            false
    ) {
        return null;
    }

    const candidate =
        principal[
            TENANT_CLAIM
        ] ||
        principal[
            SECONDARY_TENANT_CLAIM
        ] ||
        principal.tenantId ||
        principal.tenant?.id ||
        principal.tenant?.tenantId;

    if (
        !candidate
    ) {
        return null;
    }

    return validateTenantSafely(
        candidate
    );
}

/**
 * ============================================================================
 * Trusted Context Extraction
 * ============================================================================
 */

function extractTrustedTenantFromContext(
    req
) {
    const contextCandidates =
        [
            req?.adminContext?.tenantId,
            req?.tenantContext?.tenantId,
            req?.tenant?.tenantId,
        ];

    for (
        const candidate
        of contextCandidates
    ) {
        if (
            candidate &&
            tenantConstants.isValidTenantId(
                String(
                    candidate
                ).trim()
            )
        ) {
            return normalizeTenantId(
                candidate
            );
        }
    }

    /**
     * req.tenantId is accepted only when prior middleware marks it as trusted.
     */
    if (
        req?.tenantId &&
        (
            req.tenantContextTrusted ===
            true ||
            req.trustedTenant ===
            true ||
            req.securityContext
                ?.tenantTrusted ===
                true
        )
    ) {
        return validateTenantSafely(
            req.tenantId
        );
    }

    return null;
}

/**
 * ============================================================================
 * Header Handling
 * ============================================================================
 */

function getTenantHeader(
    req
) {
    const headers =
        req?.headers ||
        {};

    const value =
        headers[
            String(
                TENANT_HEADER
            ).toLowerCase()
        ] ||
        headers[
            TENANT_HEADER
        ];

    return normalizeString(
        value
    );
}

function getTenantDomainHeader(
    req
) {
    const headers =
        req?.headers ||
        {};

    return normalizeString(
        headers[
            String(
                TENANT_DOMAIN_HEADER
            ).toLowerCase()
        ] ||
        headers[
            TENANT_DOMAIN_HEADER
        ]
    );
}

function isTrustedTenantHeader(
    req
) {
    return (
        req?.tenantHeaderTrusted ===
            true ||
        req?.securityContext
            ?.tenantHeaderTrusted ===
            true ||
        req?.trustedTenantSource ===
            'header'
    );
}

/**
 * ============================================================================
 * Host Resolution
 * ============================================================================
 */

function resolveTenantFromHost(
    req
) {
    const explicitDomainHeader =
        getTenantDomainHeader(
            req
        );

    if (
        explicitDomainHeader
    ) {
        const tenantFromDomainHeader =
            tenantConstants.tenantIdFromHost(
                explicitDomainHeader
            );

        if (
            tenantFromDomainHeader
        ) {
            return tenantFromDomainHeader;
        }
    }

    const host =
        normalizeIdentifier(
            req?.headers?.host
        ) ||
        normalizeIdentifier(
            req?.hostname
        ) ||
        normalizeIdentifier(
            req?.host
        );

    if (
        !host
    ) {
        return null;
    }

    return tenantConstants.tenantIdFromHost(
        host
    );
}

/**
 * ============================================================================
 * Context Attachment
 * ============================================================================
 */

function attachTenantContext({
    tenantId = null,
    req = null,
    requestId = null,
    correlationId = null,
    actorId = null,
    tenantMeta = {},
    source = 'manual',
    authenticated = false,
    strict = STRICT_VALIDATION,
} = {}) {
    const resolvedTenantId =
        tenantId ||
        (
            req
                ? resolveTenantIdFromRequest(
                    req
                )
                : null
        );

    if (
        !resolvedTenantId
    ) {
        if (
            strict ||
            REQUIRE_TRUSTED_TENANT
        ) {
            throw new TenantContextError(
                'Tenant context could not be resolved.',
                'TENANT_CONTEXT_REQUIRED',
                {
                    statusCode: 403,
                }
            );
        }
    }

    const normalizedTenantId =
        resolvedTenantId
            ? validateTenantOrThrow(
                resolvedTenantId
            )
            : null;

    const current =
        als.getStore();

    const context =
        createContextObject({
            tenantId:
                normalizedTenantId,

            tenantMeta,

            requestId:
                requestId ||
                req?.requestId,

            correlationId:
                correlationId ||
                req?.correlationId,

            actorId:
                actorId ||
                extractActorId(
                    req
                ),

            source,

            authenticated:
                authenticated ||
                isAuthenticatedRequest(
                    req
                ),
        });

    if (
        current
    ) {
        const merged =
            mergeContext(
                current,
                context
            );

        als.enterWith(
            merged
        );

        emitAttached(
            merged,
            {
                merged:
                    true,
            }
        );

        return merged;
    }

    als.enterWith(
        context
    );

    emitAttached(
        context,
        {
            merged:
                false,
        }
    );

    return context;
}

/**
 * ============================================================================
 * Run With Tenant Context
 * ============================================================================
 */

async function runWithTenantContext(
    {
        tenantId,
        tenantMeta = {},
        requestId = null,
        correlationId = null,
        actorId = null,
        source = 'manual',
        authenticated = false,
    } = {},
    fn
) {
    if (
        typeof fn !==
            'function'
    ) {
        throw new TenantContextError(
            'runWithTenantContext requires a callback function.',
            'TENANT_CONTEXT_CALLBACK_REQUIRED',
            {
                statusCode: 500,
            }
        );
    }

    const normalizedTenantId =
        validateTenantOrThrow(
            tenantId
        );

    const context =
        createContextObject({
            tenantId:
                normalizedTenantId,

            tenantMeta,

            requestId,

            correlationId,

            actorId,

            source,

            authenticated,
        });

    return als.run(
        context,
        async () => {
            emitAttached(
                context,
                {
                    runWith:
                        true,
                }
            );

            try {
                return await fn(
                    context
                );
            } finally {
                await cleanupResources(
                    context
                );

                emitCleared(
                    context,
                    {
                        runWith:
                            true,
                    }
                );
            }
        }
    );
}

/**
 * ============================================================================
 * Update Tenant Metadata
 * ============================================================================
 */

function setTenantMeta(
    meta = {},
    {
        replace = false,
    } = {}
) {
    const ctx =
        getTenantContext();

    if (
        !ctx
    ) {
        throw new TenantContextError(
            'No tenant context is available to update metadata.',
            'TENANT_CONTEXT_REQUIRED',
            {
                statusCode: 500,
            }
        );
    }

    if (
        !isPlainObject(
            meta
        )
    ) {
        throw new TenantContextError(
            'Tenant metadata must be a plain object.',
            'TENANT_METADATA_INVALID',
            {
                statusCode: 400,
            }
        );
    }

    ctx.tenantMeta =
        replace
            ? {
                ...meta,
            }
            : {
                ...ctx.tenantMeta,
                ...meta,
            };

    return {
        ...ctx.tenantMeta,
    };
}

/**
 * ============================================================================
 * Resource Management
 * ============================================================================
 */

function attachResource(
    key,
    resource,
    {
        replace = false,
    } = {}
) {
    const ctx =
        getTenantContext();

    if (
        !ctx
    ) {
        throw new TenantContextError(
            'No tenant context is available to attach a resource.',
            'TENANT_CONTEXT_REQUIRED',
            {
                statusCode: 500,
            }
        );
    }

    if (
        !normalizeIdentifier(
            key
        )
    ) {
        throw new TenantContextError(
            'Resource key is required.',
            'RESOURCE_KEY_REQUIRED',
            {
                statusCode: 400,
            }
        );
    }

    if (
        ctx.resources[key] &&
        !replace
    ) {
        return ctx.resources[key];
    }

    ctx.resources[key] =
        resource;

    tenantEvents.emit(
        'resource:attached',
        {
            tenantId:
                ctx.tenantId,

            resourceKey:
                key,
        }
    );

    return resource;
}

/**
 * ============================================================================
 * Resource Cleanup
 * ============================================================================
 */

async function cleanupResources(
    context = null
) {
    const ctx =
        context ||
        getTenantContext();

    if (
        !ctx?.resources
    ) {
        return;
    }

    const resources = {
        ...ctx.resources,
    };

    /**
     * Cleanup in reverse attachment order.
     *
     * This is not guaranteed to represent true dependency order for arbitrary
     * resources, but it is safer than random ordering.
     */
    const keys =
        Object.keys(
            resources
        ).reverse();

    for (
        const key of keys
    ) {
        const resource =
            resources[key];

        if (
            !resource
        ) {
            continue;
        }

        try {
            await closeResource(
                resource
            );

            tenantEvents.emit(
                'resource:cleanup',
                {
                    tenantId:
                        ctx.tenantId,

                    resourceKey:
                        key,
                }
            );
        } catch (
            error
        ) {
            emitTenantError(
                error,
                {
                    stage:
                        'resource-cleanup',

                    resourceKey:
                        key,

                    tenantId:
                        ctx.tenantId,
                }
            );
        }
    }

    ctx.resources =
        {
            dbConnection:
                null,

            cacheClient:
                null,

            logger:
                null,

            metrics:
                null,
        };
}

async function closeResource(
    resource
) {
    if (
        typeof resource.release ===
        'function'
    ) {
        return resource.release();
    }

    if (
        typeof resource.close ===
        'function'
    ) {
        return resource.close();
    }

    if (
        typeof resource.end ===
        'function'
    ) {
        return resource.end();
    }

    if (
        typeof resource.disconnect ===
        'function'
    ) {
        return resource.disconnect();
    }

    return undefined;
}

/**
 * ============================================================================
 * Clear Current Context
 * ============================================================================
 *
 * AsyncLocalStorage does not provide a global "clear current request" method
 * in the sense of mutating every descendant async resource. The safe pattern
 * is to run future work outside the tenant scope.
 *
 * Therefore this function cleans resources and then runs a null ALS scope.
 * ============================================================================
 */

async function clearTenantContext() {
    const current =
        getTenantContext();

    try {
        await cleanupResources(
            current
        );
    } finally {
        if (
            current
        ) {
            emitCleared(
                current
            );
        }

        /**
         * `enterWith(null)` is used only for the current synchronous execution
         * context. Request middleware should normally prefer `als.run()`.
         */
        als.enterWith(
            null
        );
    }
}

/**
 * ============================================================================
 * Express Middleware Factory
 * ============================================================================
 */

function expressTenantMiddleware(
    {
        resolveFrom = 'auto',
        attachToRequest = true,
        requestIdHeader = 'x-request-id',
        correlationIdHeader =
            'x-correlation-id',
        strict =
            REQUIRE_TRUSTED_TENANT,
        authenticatedOnly =
            REQUIRE_TRUSTED_TENANT,
    } = {}
) {
    return function tenantMiddleware(
        req,
        res,
        next
    ) {
        let context;

        try {
            const authenticated =
                isAuthenticatedRequest(
                    req
                );

            if (
                authenticatedOnly &&
                !authenticated
            ) {
                throw new TenantContextError(
                    'Authentication is required before tenant resolution.',
                    'TENANT_AUTHENTICATION_REQUIRED',
                    {
                        statusCode: 401,
                    }
                );
            }

            const tenantId =
                resolveTenantIdFromRequest(
                    req,
                    {
                        resolveFrom,

                        allowHeader:
                            resolveFrom ===
                                'header' ||
                            resolveFrom ===
                                'auto',

                        allowHost:
                            resolveFrom ===
                                'host' ||
                            resolveFrom ===
                                'auto',

                        allowVerifiedPrincipal:
                            resolveFrom ===
                                'jwt' ||
                            resolveFrom ===
                                'auto',

                        allowFallback:
                            !strict &&
                            ALLOW_DEFAULT_TENANT,

                        requireAuthenticatedPrincipal:
                            authenticatedOnly,
                    }
                );

            const requestId =
                getRequestHeader(
                    req,
                    requestIdHeader
                ) ||
                generateRequestId();

            const correlationId =
                getRequestHeader(
                    req,
                    correlationIdHeader
                ) ||
                requestId;

            const actorId =
                extractActorId(
                    req
                );

            context =
                createContextObject({
                    tenantId,

                    requestId,

                    correlationId,

                    actorId,

                    tenantMeta:
                        {},

                    source:
                        resolveFrom,

                    authenticated,
                });

            return als.run(
                context,
                () => {
                    if (
                        attachToRequest
                    ) {
                        attachRequestContext(
                            req,
                            context
                        );
                    }

                    res.setHeader(
                        'X-Request-Id',
                        requestId
                    );

                    res.setHeader(
                        'X-Correlation-Id',
                        correlationId
                    );

                    /**
                     * Cleanup is bound to the request lifecycle.
                     */
                    let cleaned =
                        false;

                    const cleanup =
                        async () => {
                            if (
                                cleaned
                            ) {
                                return;
                            }

                            cleaned =
                                true;

                            await cleanupResources(
                                context
                            );
                        };

                    res.once(
                        'finish',
                        () => {
                            void cleanup();
                        }
                    );

                    res.once(
                        'close',
                        () => {
                            void cleanup();
                        }
                    );

                    emitAttached(
                        context,
                        {
                            express:
                                true,
                        }
                    );

                    return next();
                }
            );
        } catch (
            error
        ) {
            emitTenantError(
                error,
                {
                    stage:
                        'express-middleware',
                }
            );

            return next(
                error
            );
        }
    };
}

/**
 * ============================================================================
 * Koa Middleware
 * ============================================================================
 */

function koaTenantMiddleware(
    {
        resolveFrom = 'auto',
        attachToContext = true,
        requestIdHeader =
            'x-request-id',
        correlationIdHeader =
            'x-correlation-id',
        strict =
            REQUIRE_TRUSTED_TENANT,
        authenticatedOnly =
            REQUIRE_TRUSTED_TENANT,
    } = {}
) {
    return async function tenantMiddleware(
        ctx,
        next
    ) {
        try {
            const req =
                ctx.request;

            const authenticated =
                isAuthenticatedRequest(
                    req
                ) ||
                Boolean(
                    ctx.state
                        ?.authenticated
                );

            if (
                authenticatedOnly &&
                !authenticated
            ) {
                throw new TenantContextError(
                    'Authentication is required before tenant resolution.',
                    'TENANT_AUTHENTICATION_REQUIRED',
                    {
                        statusCode: 401,
                    }
                );
            }

            const tenantId =
                resolveTenantIdFromRequest(
                    req,
                    {
                        resolveFrom,

                        allowHeader:
                            resolveFrom ===
                                'header' ||
                            resolveFrom ===
                                'auto',

                        allowHost:
                            resolveFrom ===
                                'host' ||
                            resolveFrom ===
                                'auto',

                        allowVerifiedPrincipal:
                            resolveFrom ===
                                'jwt' ||
                            resolveFrom ===
                                'auto',

                        allowFallback:
                            !strict &&
                            ALLOW_DEFAULT_TENANT,

                        requireAuthenticatedPrincipal:
                            authenticatedOnly,
                    }
                );

            const requestId =
                getRequestHeader(
                    req,
                    requestIdHeader
                ) ||
                generateRequestId();

            const correlationId =
                getRequestHeader(
                    req,
                    correlationIdHeader
                ) ||
                requestId;

            const context =
                createContextObject({
                    tenantId,

                    requestId,

                    correlationId,

                    actorId:
                        extractActorId(
                            req
                        ),

                    tenantMeta:
                        {},

                    source:
                        resolveFrom,

                    authenticated,
                });

            return als.run(
                context,
                async () => {
                    if (
                        attachToContext
                    ) {
                        ctx.state[
                            CONTEXT_KEY
                        ] =
                            context;

                        ctx.state.tenant =
                            context
                                .tenantId;

                        ctx.state.tenantId =
                            context
                                .tenantId;
                    }

                    ctx.set(
                        'X-Request-Id',
                        requestId
                    );

                    ctx.set(
                        'X-Correlation-Id',
                        correlationId
                    );

                    emitAttached(
                        context,
                        {
                            koa:
                                true,
                        }
                    );

                    try {
                        await next();
                    } finally {
                        await cleanupResources(
                            context
                        );

                        emitCleared(
                            context,
                            {
                                koa:
                                    true,
                            }
                        );
                    }
                }
            );
        } catch (
            error
        ) {
            emitTenantError(
                error,
                {
                    stage:
                        'koa-middleware',
                }
            );

            throw error;
        }
    };
}

/**
 * ============================================================================
 * Database Resolver
 * ============================================================================
 *
 * getDbConfigForTenant must return:
 *
 * {
 *   createConnection: async () => connection
 * }
 *
 * Connections are request-scoped unless the integrator provides a shared
 * connection object with a no-op/released cleanup method.
 * ============================================================================
 */

function createDbResolver(
    getDbConfigForTenant
) {
    if (
        typeof getDbConfigForTenant !==
        'function'
    ) {
        throw new TenantContextError(
            'getDbConfigForTenant must be a function.',
            'DB_RESOLVER_INVALID'
        );
    }

    return async function getDbConnectionForCurrentTenant() {
        const ctx =
            getTenantContext();

        if (
            !ctx?.tenantId
        ) {
            throw new TenantContextError(
                'No tenant context is available for database resolution.',
                'TENANT_CONTEXT_REQUIRED',
                {
                    statusCode: 500,
                }
            );
        }

        if (
            ctx.resources
                ?.dbConnection
        ) {
            return ctx.resources
                .dbConnection;
        }

        const config =
            await getDbConfigForTenant(
                ctx.tenantId,
                {
                    ...ctx.tenantMeta,
                }
            );

        if (
            !config ||
            typeof config.createConnection !==
                'function'
        ) {
            throw new TenantContextError(
                'Invalid database configuration returned for tenant.',
                'TENANT_DATABASE_CONFIG_INVALID',
                {
                    statusCode: 500,
                }
            );
        }

        const connection =
            await config
                .createConnection();

        attachResource(
            'dbConnection',
            connection
        );

        return connection;
    };
}

/**
 * ============================================================================
 * Cache Resolver
 * ============================================================================
 */

function createCacheResolver(
    getCacheClientForTenant
) {
    if (
        typeof getCacheClientForTenant !==
        'function'
    ) {
        throw new TenantContextError(
            'getCacheClientForTenant must be a function.',
            'CACHE_RESOLVER_INVALID'
        );
    }

    return async function getCacheForCurrentTenant() {
        const ctx =
            getTenantContext();

        if (
            !ctx?.tenantId
        ) {
            throw new TenantContextError(
                'No tenant context is available for cache resolution.',
                'TENANT_CONTEXT_REQUIRED',
                {
                    statusCode: 500,
                }
            );
        }

        if (
            ctx.resources
                ?.cacheClient
        ) {
            return ctx.resources
                .cacheClient;
        }

        const client =
            await getCacheClientForTenant(
                ctx.tenantId,
                {
                    ...ctx.tenantMeta,
                }
            );

        if (
            !client
        ) {
            throw new TenantContextError(
                'No cache client was returned for tenant.',
                'TENANT_CACHE_CLIENT_INVALID',
                {
                    statusCode: 500,
                }
            );
        }

        attachResource(
            'cacheClient',
            client
        );

        return client;
    };
}

/**
 * ============================================================================
 * Tenant-Aware Logger
 * ============================================================================
 */

function contextLogger(
    baseLogger = console
) {
    return {
        info(
            message,
            meta = {}
        ) {
            writeContextLog(
                baseLogger,
                'info',
                message,
                meta
            );
        },

        warn(
            message,
            meta = {}
        ) {
            writeContextLog(
                baseLogger,
                'warn',
                message,
                meta
            );
        },

        error(
            message,
            meta = {}
        ) {
            writeContextLog(
                baseLogger,
                'error',
                message,
                meta
            );
        },

        debug(
            message,
            meta = {}
        ) {
            if (
                String(
                    tenantConstants.LOGGING
                        ?.LEVEL ||
                    ''
                ).toLowerCase() !==
                    'debug'
            ) {
                return;
            }

            writeContextLog(
                baseLogger,
                'debug',
                message,
                meta
            );
        },
    };
}

function writeContextLog(
    baseLogger,
    level,
    message,
    metadata
) {
    const ctx =
        getTenantContext();

    const tenantId =
        ctx?.tenantId ||
        'none';

    const requestId =
        ctx?.requestId ||
        null;

    const correlationId =
        ctx?.correlationId ||
        null;

    const actorId =
        ctx?.actorId ||
        null;

    const safeMeta =
        sanitizeLogMeta(
            {
                ...metadata,

                tenantId,

                requestId,

                correlationId,

                actorId,
            }
        );

    const formattedMessage =
        `${LOG_PREFIX} [${tenantId}] ${message}`;

    if (
        typeof baseLogger?.[level] ===
        'function'
    ) {
        baseLogger[
            level
        ](
            formattedMessage,
            safeMeta
        );
    }
}

/**
 * ============================================================================
 * Background / Queue Helper
 * ============================================================================
 */

function wrapAsyncHandlerWithTenant(
    tenantId,
    fn,
    tenantMeta = {},
    options = {}
) {
    if (
        typeof fn !==
        'function'
    ) {
        throw new TenantContextError(
            'wrapAsyncHandlerWithTenant requires a function.',
            'TENANT_CONTEXT_CALLBACK_REQUIRED'
        );
    }

    return async function wrappedTenantHandler(
        ...args
    ) {
        return runWithTenantContext(
            {
                tenantId,

                tenantMeta,

                requestId:
                    options.requestId ||
                    null,

                correlationId:
                    options.correlationId ||
                    null,

                actorId:
                    options.actorId ||
                    null,

                source:
                    options.source ||
                    'background',

                authenticated:
                    options.authenticated !==
                        false,
            },
            async (
                context
            ) => fn(
                ...args,
                context
            )
        );
    };
}

/**
 * ============================================================================
 * Resource Access
 * ============================================================================
 */

function getResource(
    key,
    {
        required = false,
    } = {}
) {
    const ctx =
        getTenantContext();

    const resource =
        ctx?.resources?.[
            key
        ] ||
        null;

    if (
        !resource &&
        required
    ) {
        throw new TenantContextError(
            `Tenant resource "${key}" is not available.`,
            'TENANT_RESOURCE_REQUIRED',
            {
                statusCode: 500,
            }
        );
    }

    return resource;
}

/**
 * ============================================================================
 * Convenience Context API
 * ============================================================================
 */

function getContextValue(
    key,
    fallback = null
) {
    const ctx =
        getTenantContext();

    return (
        ctx?.[
            key
        ] ??
        fallback
    );
}

/**
 * ============================================================================
 * Request Attachment
 * ============================================================================
 */

function attachRequestContext(
    req,
    context
) {
    req[
        CONTEXT_KEY
    ] =
        context;

    /**
     * Preserve existing project conventions.
     */
    req.tenantId =
        context.tenantId;

    req.tenant =
        context.tenantId;

    req.requestId =
        context.requestId;

    req.correlationId =
        context.correlationId;

    req.tenantContext =
        context;

    req.tenantContextTrusted =
        true;

    req.getTenantId =
        () =>
            getTenantId();

    req.getTenantContext =
        () =>
            getTenantContext();

    req.getTenantActorId =
        () =>
            getActorId();
}

/**
 * ============================================================================
 * Authentication Helpers
 * ============================================================================
 */

function isAuthenticatedRequest(
    req
) {
    if (
        !req ||
        typeof req !==
            'object'
    ) {
        return false;
    }

    if (
        req.isAuthenticated ===
        'function'
    ) {
        try {
            if (
                req.isAuthenticated()
            ) {
                return true;
            }
        } catch {
            // Continue.
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

function extractActorId(
    req
) {
    const actorId =
        req?.user?.id ||
        req?.user?._id ||
        req?.user?.userId ||
        req?.auth?.userId ||
        req?.auth?.id ||
        null;

    return normalizeIdentifier(
        actorId
    );
}

/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

function validateTenantOrThrow(
    tenantId
) {
    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (
        !normalized ||
        !tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        throw new TenantContextError(
            'Invalid tenant identifier.',
            'INVALID_TENANT_ID',
            {
                statusCode: 400,
            }
        );
    }

    return normalized;
}

function validateTenantSafely(
    tenantId
) {
    try {
        return validateTenantOrThrow(
            tenantId
        );
    } catch {
        return null;
    }
}

function normalizeTenantId(
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

    const tenantId =
        String(
            value
        )
            .trim()
            .toLowerCase();

    return tenantId ||
        null;
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

    const result =
        String(
            value
        ).trim();

    return result ||
        null;
}

/**
 * ============================================================================
 * Context Merge
 * ============================================================================
 */

function mergeContext(
    current,
    nextContext
) {
    const merged =
        {
            ...current,

            ...nextContext,

            tenantId:
                nextContext.tenantId ||
                current.tenantId ||
                null,

            tenantMeta:
                {
                    ...(current.tenantMeta ||
                        {}),

                    ...(nextContext.tenantMeta ||
                        {}),
                },

            resources:
                current.resources ||
                nextContext.resources ||
                {},
        };

    return merged;
}

/**
 * ============================================================================
 * Event Helpers
 * ============================================================================
 */

function emitResolved(
    tenantId,
    source,
    meta = {}
) {
    tenantEvents.emit(
        'tenant:resolved',
        {
            tenantId,

            source,

            meta:
                sanitizeEventMeta(
                    meta
                ),
        }
    );
}

function emitAttached(
    context,
    meta = {}
) {
    tenantEvents.emit(
        'tenant:attached',
        {
            tenantId:
                context?.tenantId ||
                null,

            meta:
                sanitizeEventMeta(
                    {
                        ...meta,

                        requestId:
                            context?.requestId,

                        correlationId:
                            context?.correlationId,
                    }
                ),
        }
    );
}

function emitCleared(
    context,
    meta = {}
) {
    tenantEvents.emit(
        'tenant:cleared',
        {
            tenantId:
                context?.tenantId ||
                null,

            meta:
                sanitizeEventMeta(
                    meta
                ),
        }
    );
}

function emitTenantError(
    error,
    meta = {}
) {
    tenantEvents.emit(
        'tenant:error',
        {
            error,

            meta:
                sanitizeEventMeta(
                    meta
                ),
        }
    );
}

function sanitizeEventMeta(
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

    for (
        const [
            key,
            value,
        ] of Object.entries(
            meta
        )
    ) {
        if (
            /password|secret|token|authorization|credential/i.test(
                key
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
 * Request Header
 * ============================================================================
 */

function getRequestHeader(
    req,
    headerName
) {
    const headers =
        req?.headers ||
        {};

    return (
        headers[
            String(
                headerName
            ).toLowerCase()
        ] ||
        headers[
            headerName
        ] ||
        null
    );
}

/**
 * ============================================================================
 * Request ID
 * ============================================================================
 */

function generateRequestId() {
    return crypto
        .randomUUID();
}

/**
 * ============================================================================
 * Boolean Helper
 * ============================================================================
 */

function parseBoolean(
    value,
    fallback
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    if (
        typeof value ===
        'boolean'
    ) {
        return value;
    }

    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        [
            'true',
            '1',
            'yes',
            'on',
        ].includes(
            normalized
        )
    ) {
        return true;
    }

    if (
        [
            'false',
            '0',
            'no',
            'off',
        ].includes(
            normalized
        )
    ) {
        return false;
    }

    return fallback;
}

/**
 * ============================================================================
 * Object Helper
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
 * Log Sanitizer
 * ============================================================================
 */

function sanitizeLogMeta(
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

        if (
            typeof value ===
                'string' &&
            value.length >
                1000
        ) {
            result[key] =
                `${value.slice(
                    0,
                    1000
                )}…`;

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Constants
         */
        DEFAULTS:
            Object.freeze({
                CONTEXT_KEY,

                TENANT_HEADER,

                TENANT_DOMAIN_HEADER,

                JWT_TENANT_CLAIM:
                    TENANT_CLAIM,

                SECONDARY_TENANT_CLAIM,

                FALLBACK_TENANT:
                    DEFAULT_TENANT,

                LOG_PREFIX,

                ENABLE_STRICT_VALIDATION:
                    STRICT_VALIDATION,

                REQUIRE_TRUSTED_TENANT,

                ALLOW_DEFAULT_TENANT,
            }),

        /**
         * Errors / events
         */
        TenantContextError,

        tenantEvents,

        /**
         * Context lifecycle
         */
        createContextObject,

        attachTenantContext,

        runWithTenantContext,

        getTenantContext,

        hasTenantContext,

        getTenantId,

        getActorId,

        getRequestId,

        getCorrelationId,

        setTenantMeta,

        clearTenantContext,

        /**
         * Resources
         */
        attachResource,

        getResource,

        cleanupResources,

        /**
         * Express / Koa middleware
         */
        expressTenantMiddleware,

        koaTenantMiddleware,

        /**
         * Tenant resolution
         */
        resolveTenantIdFromRequest,

        extractTenantFromVerifiedPrincipal,

        extractTrustedTenantFromContext,

        trustedTenantFromRequest:
            extractTrustedTenantFromContext,

        resolveTenantFromHost,

        /**
         * Infrastructure resolvers
         */
        createDbResolver,

        createCacheResolver,

        /**
         * Logging
         */
        contextLogger,

        /**
         * Background work
         */
        wrapAsyncHandlerWithTenant,

        /**
         * Utility
         */
        validateTenantOrThrow,

        normalizeTenantId,

        isAuthenticatedRequest,
    });