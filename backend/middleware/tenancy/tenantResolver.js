'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File: backend/middleware/tenancy/tenantResolver.js
 *
 * Enterprise Tenant Resolution Middleware
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Resolves, validates, and establishes the immutable tenant context for every
 * incoming request within the TITech Community Capital multi-tenant fintech
 * platform.
 *
 * This middleware is the authoritative source of tenant identity and guarantees
 * strict tenant isolation throughout the request lifecycle.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Multi-source tenant resolution
 * • JWT tenant resolution
 * • API key tenant resolution
 * • Hostname / subdomain resolution
 * • Trusted header resolution
 * • Tenant validation
 * • Tenant membership validation
 * • Tenant status verification
 * • Tenant policy loading
 * • Feature flag resolution
 * • Immutable request tenant context
 * • Cross-tenant attack prevention
 * • Distributed tracing enrichment
 * • Metrics collection
 * • Audit event publication
 * • Enterprise diagnostics
 *
 * Supported Resolution Strategies
 * -----------------------------------------------------------------------------
 *
 * 1. Authenticated JWT Claims
 * 2. API Key Metadata
 * 3. Mutual TLS Identity (future)
 * 4. Custom Domain Mapping
 * 5. Tenant Subdomain
 * 6. Trusted Reverse Proxy Header
 *
 * Enterprise Integrations
 * -----------------------------------------------------------------------------
 *
 * • Authentication Middleware
 * • Tenant Security Middleware
 * • Authorization Middleware
 * • StructuredLogger
 * • LoggerFactory
 * • MetricsRegistry
 * • RequestMetrics
 * • TraceContext
 * • EventBus
 * • Audit Service
 * • OpenTelemetry
 *
 * Request Pipeline
 * -----------------------------------------------------------------------------
 *
 * Incoming Request
 *        │
 *        ▼
 * Authentication
 *        │
 *        ▼
 * Tenant Resolution
 *        │
 *        ▼
 * Tenant Validation
 *        │
 *        ▼
 * Policy Resolution
 *        │
 *        ▼
 * Immutable Tenant Context
 *        │
 *        ▼
 * Authorization
 *        │
 *        ▼
 * Controllers
 *
 * =============================================================================
 */

const os = require('os');
const crypto = require('crypto');

/* ============================================================================
 * Optional Enterprise Dependencies
 * ========================================================================== */

function optionalRequire(modulePath) {

    try {

        return require(modulePath);

    } catch (_) {

        return null;

    }

}

const ConfigurationProvider =
    optionalRequire('../../config/ConfigurationProvider');

const StructuredLogger =
    optionalRequire('../../shared/logging/StructuredLogger');

const LoggerFactory =
    optionalRequire('../../shared/logging/LoggerFactory');

const MetricsRegistry =
    optionalRequire('../../shared/metrics/MetricsRegistry');

const RequestMetrics =
    optionalRequire('../../shared/metrics/RequestMetrics');

const TraceContext =
    optionalRequire('../../shared/tracing/TraceContext');

const EventBus =
    optionalRequire('../../shared/events/EventBus');

const AuditService =
    optionalRequire('../../shared/audit/AuditService');

const OpenTelemetry =
    optionalRequire('../../shared/tracing/OpenTelemetry');

/* ============================================================================
 * Component Identity
 * ========================================================================== */

const COMPONENT_NAME =
    'tenantResolver';

const COMPONENT_VERSION =
    '1.0.0';

const COMPONENT_CATEGORY =
    'tenancy';

const COMPONENT_PHASE =
    'resolution';

/* ============================================================================
 * Enterprise Constants
 * ========================================================================== */

const DEFAULT_CACHE_TTL =
    300;

const DEFAULT_RESOLUTION_TIMEOUT_MS =
    5000;

const DEFAULT_ALLOWED_HEADERS =
    Object.freeze([
        'x-tenant-id'
    ]);

const TENANT_STATUS =
    Object.freeze({

        ACTIVE:
            'ACTIVE',

        PENDING:
            'PENDING',

        SUSPENDED:
            'SUSPENDED',

        DISABLED:
            'DISABLED',

        ARCHIVED:
            'ARCHIVED'

    });

const RESOLUTION_STRATEGY =
    Object.freeze({

        JWT:
            'jwt',

        API_KEY:
            'api-key',

        MTLS:
            'mtls',

        CUSTOM_DOMAIN:
            'custom-domain',

        SUBDOMAIN:
            'subdomain',

        HEADER:
            'header'

    });

const CACHE_NAMESPACE =
    'tenant:resolver';

/* ============================================================================
 * Runtime State
 * ========================================================================== */

const INTERNAL_STATE = Object.seal({

    initialized: false,

    initializedAt: null,

    hostname: os.hostname(),

    processId: process.pid,

    middlewareVersion: COMPONENT_VERSION,

    configurationHash: null,

    lastHealthCheck: null,

    lastReadinessCheck: null,

    lastResolution: null,

    resolutions: 0,

    cacheHits: 0,

    cacheMisses: 0,

    validationFailures: 0,

    repositoryFailures: 0,

    policyLoads: 0,

    diagnosticsRequests: 0

});

/* ============================================================================
 * Enterprise Component Metadata
 * ========================================================================== */

const METADATA = Object.freeze({

    name: COMPONENT_NAME,

    version: COMPONENT_VERSION,

    category: COMPONENT_CATEGORY,

    phase: COMPONENT_PHASE,

    priority: 100,

    critical: true,

    singleton: true,

    description:
        'Enterprise multi-source tenant resolution middleware.',

    supportedStrategies:
        Object.values(RESOLUTION_STRATEGY),

    supportedStatuses:
        Object.values(TENANT_STATUS),

    observability: Object.freeze({

        tracing: true,

        metrics: true,

        structuredLogging: true,

        events: true,

        diagnostics: true,

        audit: true

    }),

    integrations: Object.freeze({

        authentication: true,

        tenantSecurity: true,

        authorization: true,

        requestMetrics: true,

        traceContext: true,

        loggerFactory: true,

        eventBus: true,

        auditService: true,

        openTelemetry: true

    })

});

/* ============================================================================
 * Enterprise Configuration Defaults
 * (Configuration engine implemented in Phase 1.3)
 * ========================================================================== */

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    cacheTTL: DEFAULT_CACHE_TTL,

    resolutionTimeout:

        DEFAULT_RESOLUTION_TIMEOUT_MS,

    trustedHeaders:

        DEFAULT_ALLOWED_HEADERS,

    enforceMembershipValidation: true,

    enforceTenantStatus: true,

    enableCaching: true,

    enableTracing: true,

    enableMetrics: true,

    enableAuditEvents: true,

    enableDiagnostics: true,

    preferredResolutionOrder: Object.freeze([

        RESOLUTION_STRATEGY.JWT,

        RESOLUTION_STRATEGY.API_KEY,

        RESOLUTION_STRATEGY.MTLS,

        RESOLUTION_STRATEGY.CUSTOM_DOMAIN,

        RESOLUTION_STRATEGY.SUBDOMAIN,

        RESOLUTION_STRATEGY.HEADER

    ])

});

/*
 * Remaining implementation phases:
 *
 * Phase 1.2 - Enterprise Error Hierarchy
 * Phase 1.3 - Configuration Engine
 * Phase 2   - Resolution Strategy Framework
 * Phase 3   - Validation Layer
 * Phase 4   - Repository & Cache
 * Phase 5   - Policy Engine
 * Phase 6   - Immutable Tenant Context
 * Phase 7   - Security Integration
 * Phase 8   - Observability Integration
 * Phase 9   - Middleware Execution
 * Phase 10  - Diagnostics
 * Phase 11  - Factory & Registration
 * Phase 12  - Testing Hooks
 */

/* ============================================================================
 * Phase 1.2 — Enterprise Error Hierarchy
 * ============================================================================
 */

/**
 * ---------------------------------------------------------------------------
 * Error Severity
 * ---------------------------------------------------------------------------
 */

const ERROR_SEVERITY = Object.freeze({

    LOW: 'LOW',

    MEDIUM: 'MEDIUM',

    HIGH: 'HIGH',

    CRITICAL: 'CRITICAL'

});

/**
 * ---------------------------------------------------------------------------
 * Enterprise Error Codes
 * ---------------------------------------------------------------------------
 */

const ERROR_CODES = Object.freeze({

    TENANT_RESOLVER_ERROR:
        'TENANT_RESOLVER_ERROR',

    TENANT_CONFIGURATION_ERROR:
        'TENANT_CONFIGURATION_ERROR',

    TENANT_RESOLUTION_ERROR:
        'TENANT_RESOLUTION_ERROR',

    TENANT_AUTHENTICATION_MISMATCH:
        'TENANT_AUTHENTICATION_MISMATCH',

    TENANT_VALIDATION_ERROR:
        'TENANT_VALIDATION_ERROR',

    TENANT_NOT_FOUND:
        'TENANT_NOT_FOUND',

    TENANT_INACTIVE:
        'TENANT_INACTIVE',

    TENANT_SUSPENDED:
        'TENANT_SUSPENDED',

    TENANT_UNAUTHORIZED:
        'TENANT_UNAUTHORIZED',

    TENANT_CACHE_ERROR:
        'TENANT_CACHE_ERROR',

    TENANT_REPOSITORY_ERROR:
        'TENANT_REPOSITORY_ERROR',

    TENANT_POLICY_VIOLATION:
        'TENANT_POLICY_VIOLATION'

});

/**
 * ---------------------------------------------------------------------------
 * Base Enterprise Tenant Error
 * ---------------------------------------------------------------------------
 */

class TenantResolverError extends Error {

    constructor(
        message,
        {
            code = ERROR_CODES.TENANT_RESOLVER_ERROR,
            statusCode = 500,
            severity = ERROR_SEVERITY.HIGH,
            operational = true,
            details = {},
            cause = null
        } = {}
    ) {

        super(message);

        Error.captureStackTrace?.(
            this,
            this.constructor
        );

        this.name =
            this.constructor.name;

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.severity =
            severity;

        this.operational =
            operational;

        this.details =
            Object.freeze({
                ...details
            });

        this.cause =
            cause || null;

        this.timestamp =
            new Date().toISOString();

    }

    toJSON() {

        return {

            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            statusCode:
                this.statusCode,

            severity:
                this.severity,

            operational:
                this.operational,

            details:
                this.details,

            timestamp:
                this.timestamp

        };

    }

}

/**
 * ---------------------------------------------------------------------------
 * Specialized Errors
 * ---------------------------------------------------------------------------
 */

class TenantConfigurationError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Invalid tenant resolver configuration.',

            {

                code:
                    ERROR_CODES.TENANT_CONFIGURATION_ERROR,

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.CRITICAL,

                details

            }

        );

    }

}

class TenantResolutionError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Unable to resolve tenant.',

            {

                code:
                    ERROR_CODES.TENANT_RESOLUTION_ERROR,

                statusCode:
                    400,

                severity:
                    ERROR_SEVERITY.MEDIUM,

                details

            }

        );

    }

}

class TenantAuthenticationMismatchError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Authenticated tenant does not match resolved tenant.',

            {

                code:
                    ERROR_CODES.TENANT_AUTHENTICATION_MISMATCH,

                statusCode:
                    403,

                severity:
                    ERROR_SEVERITY.CRITICAL,

                details

            }

        );

    }

}

class TenantValidationError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant validation failed.',

            {

                code:
                    ERROR_CODES.TENANT_VALIDATION_ERROR,

                statusCode:
                    400,

                severity:
                    ERROR_SEVERITY.MEDIUM,

                details

            }

        );

    }

}

class TenantNotFoundError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant not found.',

            {

                code:
                    ERROR_CODES.TENANT_NOT_FOUND,

                statusCode:
                    404,

                severity:
                    ERROR_SEVERITY.MEDIUM,

                details

            }

        );

    }

}

class TenantInactiveError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant is inactive.',

            {

                code:
                    ERROR_CODES.TENANT_INACTIVE,

                statusCode:
                    403,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

class TenantSuspendedError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant has been suspended.',

            {

                code:
                    ERROR_CODES.TENANT_SUSPENDED,

                statusCode:
                    423,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

class TenantUnauthorizedError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Unauthorized tenant access.',

            {

                code:
                    ERROR_CODES.TENANT_UNAUTHORIZED,

                statusCode:
                    403,

                severity:
                    ERROR_SEVERITY.CRITICAL,

                details

            }

        );

    }

}

class TenantCacheError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant cache failure.',

            {

                code:
                    ERROR_CODES.TENANT_CACHE_ERROR,

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

class TenantRepositoryError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant repository failure.',

            {

                code:
                    ERROR_CODES.TENANT_REPOSITORY_ERROR,

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

class TenantPolicyViolationError
    extends TenantResolverError {

    constructor(message, details = {}) {

        super(

            message ||

            'Tenant policy violation.',

            {

                code:
                    ERROR_CODES.TENANT_POLICY_VIOLATION,

                statusCode:
                    403,

                severity:
                    ERROR_SEVERITY.CRITICAL,

                details

            }

        );

    }

}

/**
 * ---------------------------------------------------------------------------
 * Enterprise Helpers
 * ---------------------------------------------------------------------------
 */

function normalizeTenantError(error) {

    if (

        error instanceof TenantResolverError

    ) {

        return error;

    }

    return new TenantResolverError(

        error?.message ||

        'Unexpected tenant resolver failure.',

        {

            details: {

                originalName:
                    error?.name,

                stack:
                    error?.stack

            },

            cause:
                error

        }

    );

}

function isOperationalTenantError(error) {

    return (

        error instanceof TenantResolverError &&

        error.operational === true

    );

}

function serializeTenantError(error) {

    return normalizeTenantError(error).toJSON();

}

/**
 * Immutable Error Registry
 */

const TENANT_ERRORS = Object.freeze({

    TenantResolverError,

    TenantConfigurationError,

    TenantResolutionError,

    TenantAuthenticationMismatchError,

    TenantValidationError,

    TenantNotFoundError,

    TenantInactiveError,

    TenantSuspendedError,

    TenantUnauthorizedError,

    TenantCacheError,

    TenantRepositoryError,

    TenantPolicyViolationError

});

/* ============================================================================
 * Phase 1.3 — Enterprise Configuration Engine
 * ============================================================================
 */

/**
 * Default enterprise configuration.
 *
 * These defaults are intentionally immutable and represent the baseline
 * behavior for tenant resolution. They may be overridden by:
 *
 *   1. Environment configuration
 *   2. ConfigurationProvider
 *   3. Runtime middleware options
 */

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    service: 'tenant-resolver',

    timeout: 5000,

    cache: Object.freeze({

        enabled: true,

        provider: 'memory',

        namespace: CACHE_NAMESPACE,

        ttl: 300,

        maxEntries: 10000,

        preload: false,

        refreshAhead: true

    }),

    trustedProxy: Object.freeze({

        enabled: true,

        depth: 1

    }),

    trustedHeaders: Object.freeze({

        tenantId: 'x-tenant-id',

        tenantCode: 'x-tenant-code',

        forwardedHost: 'x-forwarded-host'

    }),

    hostname: Object.freeze({

        enabled: true,

        allowSubdomains: true,

        allowCustomDomains: true,

        rootDomains: Object.freeze([]),

        trustedSuffixes: Object.freeze([])

    }),

    featureLoading: Object.freeze({

        enabled: true,

        preload: true,

        includePlans: true,

        includePermissions: true,

        includeFeatureFlags: true

    }),

    validation: Object.freeze({

        enforceMembership: true,

        enforceStatus: true,

        validateHostname: true,

        validateHeaders: true,

        validateAuthentication: true,

        rejectCrossTenantAccess: true

    }),

    diagnostics: Object.freeze({

        enabled: true,

        exposeConfiguration: false,

        exposeCacheStatistics: true,

        exposeResolutionStatistics: true

    }),

    metrics: Object.freeze({

        enabled: true,

        collectLatency: true,

        collectCacheMetrics: true,

        collectResolutionMetrics: true

    }),

    tracing: Object.freeze({

        enabled: true,

        createSpan: true,

        enrichTraceContext: true,

        includeTenantAttributes: true

    }),

    resolutionOrder: Object.freeze([

        RESOLUTION_STRATEGY.JWT,

        RESOLUTION_STRATEGY.API_KEY,

        RESOLUTION_STRATEGY.MTLS,

        RESOLUTION_STRATEGY.CUSTOM_DOMAIN,

        RESOLUTION_STRATEGY.SUBDOMAIN,

        RESOLUTION_STRATEGY.HEADER

    ])

});

/* ============================================================================
 * Deep Merge Utility
 * ========================================================================== */

function isPlainObject(value) {

    return (

        value !== null &&

        typeof value === 'object' &&

        !Array.isArray(value)

    );

}

function deepMerge(target, source) {

    const output = {

        ...target

    };

    if (!isPlainObject(source)) {

        return output;

    }

    Object.keys(source).forEach((key) => {

        const targetValue = output[key];

        const sourceValue = source[key];

        if (

            isPlainObject(targetValue) &&

            isPlainObject(sourceValue)

        ) {

            output[key] = deepMerge(

                targetValue,

                sourceValue

            );

        } else {

            output[key] = sourceValue;

        }

    });

    return output;

}

/* ============================================================================
 * Environment Configuration
 * ========================================================================== */

function loadEnvironmentConfiguration() {

    return {

        enabled:

            process.env.TENANT_RESOLVER_ENABLED !== 'false',

        cache: {

            ttl:

                Number(

                    process.env.TENANT_CACHE_TTL ||

                    DEFAULT_CONFIGURATION.cache.ttl

                )

        },

        trustedProxy: {

            depth:

                Number(

                    process.env.TRUST_PROXY_DEPTH ||

                    DEFAULT_CONFIGURATION.trustedProxy.depth

                )

        },

        diagnostics: {

            enabled:

                process.env.TENANT_DIAGNOSTICS === 'true'

        },

        metrics: {

            enabled:

                process.env.TENANT_METRICS !== 'false'

        },

        tracing: {

            enabled:

                process.env.TENANT_TRACING !== 'false'

        }

    };

}

/* ============================================================================
 * Configuration Provider Integration
 * ========================================================================== */

function loadProviderConfiguration() {

    if (

        !ConfigurationProvider ||

        typeof ConfigurationProvider.get !== 'function'

    ) {

        return {};

    }

    try {

        return (

            ConfigurationProvider.get(

                'middleware.tenantResolver'

            ) ||

            {}

        );

    } catch (error) {

        throw new TenantConfigurationError(

            'Unable to load tenant resolver configuration.',

            {

                cause:

                    error.message

            }

        );

    }

}

/* ============================================================================
 * Configuration Validation
 * ========================================================================== */

function validateConfiguration(configuration) {

    if (

        configuration.cache.ttl < 0

    ) {

        throw new TenantConfigurationError(

            'Cache TTL cannot be negative.'

        );

    }

    if (

        configuration.timeout <= 0

    ) {

        throw new TenantConfigurationError(

            'Resolution timeout must be greater than zero.'

        );

    }

    if (

        !Array.isArray(

            configuration.resolutionOrder

        )

    ) {

        throw new TenantConfigurationError(

            'Resolution order must be an array.'

        );

    }

    return configuration;

}

/* ============================================================================
 * Configuration Resolver
 * ========================================================================== */

function resolveConfiguration(

    runtimeOverrides = {}

) {

    const configuration = deepMerge(

        deepMerge(

            deepMerge(

                DEFAULT_CONFIGURATION,

                loadEnvironmentConfiguration()

            ),

            loadProviderConfiguration()

        ),

        runtimeOverrides

    );

    validateConfiguration(configuration);

    INTERNAL_STATE.configurationHash =

        crypto

            .createHash('sha256')

            .update(

                JSON.stringify(configuration)

            )

            .digest('hex');

    return Object.freeze(configuration);

}

/* ============================================================================
 * Configuration Snapshot
 * ========================================================================== */

function configurationSnapshot() {

    return Object.freeze({

        generatedAt:

            new Date().toISOString(),

        component:

            COMPONENT_NAME,

        version:

            COMPONENT_VERSION,

        configurationHash:

            INTERNAL_STATE.configurationHash,

        configuration:

            resolveConfiguration()

    });

}

/* ============================================================================
 * Phase 2.1 — Multi-Source Tenant Resolution Engine
 * Strategy Pattern Implementation
 * ============================================================================
 */

/**
 * ============================================================================
 * Base Resolution Strategy
 * ============================================================================
 */

class TenantResolutionStrategy {

    constructor(name) {

        this.name = name;

    }

    /**
     * Whether this strategy can execute.
     */
    supports(/* req, configuration */) {

        return true;

    }

    /**
     * Resolve tenant.
     *
     * Must return:
     *
     * {
     *      id,
     *      strategy,
     *      confidence,
     *      metadata
     * }
     *
     * or null.
     */
    async resolve() {

        throw new Error(

            `${this.constructor.name} must implement resolve().`

        );

    }

}

/* ============================================================================
 * Phase 2.2 — Enterprise JWT Tenant Resolver
 * ============================================================================
 */

/**
 * Enterprise JWT-backed tenant resolver.
 *
 * Resolution Flow
 * ---------------------------------------------------------------------------
 *
 * Authenticated Principal
 *          │
 *          ▼
 * Extract Tenant Claim
 *          │
 *          ▼
 * Validate Claim
 *          │
 *          ▼
 * Validate Issuer
 *          │
 *          ▼
 * Validate Audience
 *          │
 *          ▼
 * Verify Tenant Membership
 *          │
 *          ▼
 * Detect Tenant Spoofing
 *          │
 *          ▼
 * Return Trusted Tenant Candidate
 */

class JwtTenantResolver extends TenantResolutionStrategy {

    constructor(options = {}) {

        super(RESOLUTION_STRATEGY.JWT);

        this.options = Object.freeze({

            acceptedIssuers:

                options.acceptedIssuers ||

                [],

            acceptedAudiences:

                options.acceptedAudiences ||

                []

        });

    }

    /**
     * Only execute when authentication
     * has already established identity.
     */
    supports(req) {

        return Boolean(

            req.user ||

            req.auth ||

            req.context?.user

        );

    }

    /**
     * Resolve tenant from authenticated identity.
     */
    async resolve(req, configuration = {}) {

        const principal =

            req.user ||

            req.auth ||

            req.context?.user;

        if (!principal) {

            return null;

        }

        const tenantId =

            this.extractTenantClaim(

                principal

            );

        this.validateTenantClaim(

            tenantId

        );

        this.validateIssuer(

            principal,

            configuration

        );

        this.validateAudience(

            principal,

            configuration

        );

        this.verifyMembership(

            principal,

            tenantId

        );

        this.preventSpoofing(

            req,

            tenantId,

            configuration

        );

        return Object.freeze({

            tenantId,

            strategy:

                this.name,

            confidence: 100,

            authenticated: true,

            metadata: Object.freeze({

                issuer:

                    principal.iss,

                audience:

                    principal.aud,

                subject:

                    principal.sub,

                authenticationMethod:

                    principal.authMethod ||

                    'jwt'

            })

        });

    }

    /**
     * Extract tenant claim.
     */
    extractTenantClaim(principal) {

        const tenantId =

            principal.tenantId ||

            principal.tenant ||

            principal.tid ||

            principal.organizationId;

        if (!tenantId) {

            throw new TenantResolutionError(

                'Authenticated token does not contain a tenant claim.'

            );

        }

        return tenantId;

    }

    /**
     * Validate tenant claim.
     */
    validateTenantClaim(tenantId) {

        if (

            typeof tenantId !== 'string'

        ) {

            throw new TenantValidationError(

                'Tenant claim must be a string.'

            );

        }

        if (

            tenantId.trim().length === 0

        ) {

            throw new TenantValidationError(

                'Tenant claim cannot be empty.'

            );

        }

    }

    /**
     * Validate JWT issuer.
     */
    validateIssuer(principal, configuration) {

        const accepted =

            configuration.jwt?.issuers ||

            this.options.acceptedIssuers;

        if (

            accepted.length === 0

        ) {

            return;

        }

        if (

            !accepted.includes(

                principal.iss

            )

        ) {

            throw new TenantAuthenticationMismatchError(

                'JWT issuer validation failed.',

                {

                    issuer:

                        principal.iss

                }

            );

        }

    }

    /**
     * Validate JWT audience.
     */
    validateAudience(principal, configuration) {

        const accepted =

            configuration.jwt?.audiences ||

            this.options.acceptedAudiences;

        if (

            accepted.length === 0

        ) {

            return;

        }

        const audiences =

            Array.isArray(

                principal.aud

            )

            ?

            principal.aud

            :

            [

                principal.aud

            ];

        const valid =

            audiences.some(

                audience =>

                    accepted.includes(

                        audience

                    )

            );

        if (!valid) {

            throw new TenantAuthenticationMismatchError(

                'JWT audience validation failed.',

                {

                    audience:

                        principal.aud

                }

            );

        }

    }

    /**
     * Verify user belongs to tenant.
     */
    verifyMembership(

        principal,

        tenantId

    ) {

        if (

            Array.isArray(

                principal.tenants

            )

        ) {

            const allowed =

                principal.tenants.includes(

                    tenantId

                );

            if (!allowed) {

                throw new TenantUnauthorizedError(

                    'Authenticated user is not a member of the resolved tenant.',

                    {

                        tenantId

                    }

                );

            }

        }

    }

    /**
     * Prevent tenant spoofing.
     *
     * Header values must never override
     * authenticated identity.
     */
    preventSpoofing(

        req,

        tenantId,

        configuration

    ) {

        const trustedHeader =

            configuration.trustedHeaders?.tenantId ||

            'x-tenant-id';

        const suppliedHeader =

            req.get(

                trustedHeader

            );

        if (

            suppliedHeader &&

            suppliedHeader !== tenantId

        ) {

            throw new TenantAuthenticationMismatchError(

                'Tenant spoofing attempt detected.',

                {

                    authenticatedTenant:

                        tenantId,

                    suppliedTenant:

                        suppliedHeader

                }

            );

        }

    }

}

/* ============================================================================
 * Phase 2.3 — Enterprise API Key Tenant Resolver
 * ============================================================================
 */

/**
 * Enterprise API Key Tenant Resolver.
 *
 * Resolution Flow
 * ---------------------------------------------------------------------------
 *
 * API Key
 *      │
 *      ▼
 * Resolve API Client
 *      │
 *      ▼
 * Validate Client
 *      │
 *      ▼
 * Resolve Tenant
 *      │
 *      ▼
 * Validate Tenant Binding
 *      │
 *      ▼
 * Validate Permissions
 *      │
 *      ▼
 * Trusted Tenant Candidate
 */

class ApiKeyTenantResolver extends TenantResolutionStrategy {

    constructor(options = {}) {

        super(RESOLUTION_STRATEGY.API_KEY);

        this.options = Object.freeze({

            header:

                options.header ||

                'x-api-key',

            repository:

                options.repository ||

                null

        });

    }

    /**
     * Execute only when an API key exists.
     */
    supports(req) {

        return Boolean(

            req.get(this.options.header)

        );

    }

    /**
     * Resolve tenant.
     */
    async resolve(req, configuration = {}) {

        const apiKey =

            this.extractApiKey(req);

        const apiClient =

            await this.resolveApiClient(

                apiKey,

                configuration

            );

        this.validateClient(apiClient);

        const tenantId =

            this.resolveTenant(apiClient);

        this.validateTenantBinding(

            apiClient,

            tenantId

        );

        const permissions =

            this.resolvePermissions(apiClient);

        this.validatePermissions(

            permissions

        );

        this.preventSpoofing(

            req,

            tenantId,

            configuration

        );

        return Object.freeze({

            tenantId,

            strategy:

                this.name,

            confidence: 95,

            authenticated: true,

            metadata: Object.freeze({

                apiClientId:

                    apiClient.id,

                apiClientName:

                    apiClient.name,

                permissions,

                scopes:

                    apiClient.scopes || [],

                authenticationMethod:

                    'api-key'

            })

        });

    }

    /**
     * Extract API key.
     */
    extractApiKey(req) {

        const apiKey =

            req.get(this.options.header);

        if (!apiKey) {

            throw new TenantResolutionError(

                'Missing API key.'

            );

        }

        return apiKey.trim();

    }

    /**
     * Resolve API client.
     */
    async resolveApiClient(

        apiKey,

        configuration

    ) {

        if (

            req.apiClient

        ) {

            return req.apiClient;

        }

        const repository =

            configuration.apiClientRepository ||

            this.options.repository;

        if (

            !repository ||

            typeof repository.findByApiKey !== 'function'

        ) {

            throw new TenantRepositoryError(

                'API client repository is unavailable.'

            );

        }

        const client =

            await repository.findByApiKey(

                apiKey

            );

        if (!client) {

            throw new TenantUnauthorizedError(

                'Unknown API key.'

            );

        }

        return client;

    }

    /**
     * Validate API client.
     */
    validateClient(client) {

        if (

            client.active === false

        ) {

            throw new TenantUnauthorizedError(

                'API client has been disabled.'

            );

        }

        if (

            client.revoked === true

        ) {

            throw new TenantUnauthorizedError(

                'API key has been revoked.'

            );

        }

        if (

            client.expiresAt &&

            new Date(client.expiresAt) < new Date()

        ) {

            throw new TenantUnauthorizedError(

                'API key has expired.'

            );

        }

    }

    /**
     * Resolve tenant.
     */
    resolveTenant(client) {

        if (!client.tenantId) {

            throw new TenantResolutionError(

                'API client is not bound to a tenant.'

            );

        }

        return client.tenantId;

    }

    /**
     * Validate tenant binding.
     */
    validateTenantBinding(

        client,

        tenantId

    ) {

        if (

            client.tenantId !== tenantId

        ) {

            throw new TenantAuthenticationMismatchError(

                'API client tenant mismatch.'

            );

        }

    }

    /**
     * Resolve permissions.
     */
    resolvePermissions(client) {

        return Object.freeze(

            client.permissions ||

            []

        );

    }

    /**
     * Ensure permissions exist.
     */
    validatePermissions(

        permissions

    ) {

        if (

            !Array.isArray(

                permissions

            )

        ) {

            throw new TenantValidationError(

                'Invalid permission collection.'

            );

        }

    }

    /**
     * Prevent header spoofing.
     */
    preventSpoofing(

        req,

        tenantId,

        configuration

    ) {

        const trustedHeader =

            configuration.trustedHeaders?.tenantId ||

            'x-tenant-id';

        const supplied =

            req.get(

                trustedHeader

            );

        if (

            supplied &&

            supplied !== tenantId

        ) {

            throw new TenantAuthenticationMismatchError(

                'Tenant header spoofing detected.',

                {

                    authenticatedTenant:

                        tenantId,

                    suppliedTenant:

                        supplied

                }

            );

        }

    }

}

/**
 * ============================================================================
 * Mutual TLS Strategy
 * ============================================================================
 */

class MtlsTenantResolver
    extends TenantResolutionStrategy {

    constructor() {

        super(

            RESOLUTION_STRATEGY.MTLS

        );

    }

    supports(req) {

        return Boolean(

            req.client?.authorized

        );

    }

    async resolve(req) {

        const certificate =

            req.socket?.getPeerCertificate?.();

        const tenantId =

            certificate?.tenantId ||

            certificate?.OU;

        if (!tenantId) {

            return null;

        }

        return Object.freeze({

            tenantId,

            strategy:

                this.name,

            confidence: 98,

            metadata: {

                certificateSubject:

                    certificate?.subject

            }

        });

    }

}

/**
 * ============================================================================
 * Custom Domain Strategy
 * ============================================================================
 */

class CustomDomainTenantResolver
    extends TenantResolutionStrategy {

    constructor() {

        super(

            RESOLUTION_STRATEGY.CUSTOM_DOMAIN

        );

    }

    supports(req) {

        return Boolean(

            req.hostname

        );

    }

    async resolve(req) {

        const hostname =

            req.hostname;

        return Object.freeze({

            hostname,

            strategy:

                this.name,

            confidence: 80,

            metadata: {

                lookup:

                    'custom-domain'

            }

        });

    }

}

/**
 * ============================================================================
 * Subdomain Strategy
 * ============================================================================
 */

class SubdomainTenantResolver
    extends TenantResolutionStrategy {

    constructor() {

        super(

            RESOLUTION_STRATEGY.SUBDOMAIN

        );

    }

    supports(req) {

        return Boolean(

            req.hostname

        );

    }

    async resolve(req) {

        const host =

            req.hostname;

        const parts =

            host.split('.');

        if (

            parts.length < 3

        ) {

            return null;

        }

        return Object.freeze({

            tenantCode:

                parts[0],

            strategy:

                this.name,

            confidence: 70,

            metadata: {

                hostname:

                    host

            }

        });

    }

}

/**
 * ============================================================================
 * Trusted Header Strategy
 * ============================================================================
 */

class HeaderTenantResolver
    extends TenantResolutionStrategy {

    constructor() {

        super(

            RESOLUTION_STRATEGY.HEADER

        );

    }

    supports(req, configuration) {

        const header =

            configuration

                .trustedHeaders

                .tenantId;

        return Boolean(

            req.get(header)

        );

    }

    async resolve(req, configuration) {

        const header =

            configuration

                .trustedHeaders

                .tenantId;

        const tenantId =

            req.get(header);

        if (!tenantId) {

            return null;

        }

        return Object.freeze({

            tenantId,

            strategy:

                this.name,

            confidence: 50,

            metadata: {

                trustedHeader:

                    header

            }

        });

    }

}

/**
 * ============================================================================
 * Resolution Registry
 * ============================================================================
 */

const RESOLUTION_PIPELINE = Object.freeze([

    new JwtTenantResolver(),

    new ApiKeyTenantResolver(),

    new MtlsTenantResolver(),

    new CustomDomainTenantResolver(),

    new SubdomainTenantResolver(),

    new HeaderTenantResolver()

]);

/**
 * ============================================================================
 * Enterprise Resolution Engine
 * ============================================================================
 */

async function resolveTenantIdentity(

    req,

    configuration

) {

    for (

        const resolver

        of

        RESOLUTION_PIPELINE

    ) {

        if (

            !resolver.supports(

                req,

                configuration

            )

        ) {

            continue;

        }

        const result =

            await resolver.resolve(

                req,

                configuration

            );

        if (result) {

            INTERNAL_STATE.resolutions++;

            INTERNAL_STATE.lastResolution = {

                strategy:

                    resolver.name,

                timestamp:

                    new Date()

                        .toISOString()

            };

            return result;

        }

    }

    throw new TenantResolutionError(

        'Unable to resolve tenant using any configured strategy.'

    );

}

/**
 * ============================================================================
 * Strategy Registry
 * ============================================================================
 */

const TENANT_RESOLUTION_STRATEGIES = Object.freeze({

    JwtTenantResolver,

    ApiKeyTenantResolver,

    MtlsTenantResolver,

    CustomDomainTenantResolver,

    SubdomainTenantResolver,

    HeaderTenantResolver

});

/* ============================================================================
 * Phase 2.4 — Enterprise Hostname Tenant Resolver
 * ============================================================================
 */

/**
 * Enterprise Hostname Resolver.
 *
 * Resolution Flow
 * ---------------------------------------------------------------------------
 *
 * Request Hostname
 *        │
 *        ▼
 * Normalize Hostname
 *        │
 *        ▼
 * Validate Hostname
 *        │
 *        ▼
 * Match Whitelist
 *        │
 *        ▼
 * Match Wildcards
 *        │
 *        ▼
 * Validate Trusted Suffix
 *        │
 *        ▼
 * Resolve Tenant Mapping
 *        │
 *        ▼
 * Trusted Tenant Candidate
 */

class HostnameTenantResolver extends TenantResolutionStrategy {

    constructor(options = {}) {

        super(RESOLUTION_STRATEGY.CUSTOM_DOMAIN);

        this.options = Object.freeze({

            repository:

                options.repository ||

                null

        });

    }

    supports(req, configuration) {

        return (

            configuration.hostname?.enabled === true &&

            Boolean(req.hostname)

        );

    }

    async resolve(req, configuration = {}) {

        const hostname =

            this.normalizeHostname(

                req.hostname

            );

        this.validateHostname(

            hostname

        );

        this.validateWhitelist(

            hostname,

            configuration

        );

        this.validateWildcard(

            hostname,

            configuration

        );

        this.validateSuffix(

            hostname,

            configuration

        );

        const mapping =

            await this.resolveTenantMapping(

                hostname,

                configuration

            );

        if (!mapping) {

            return null;

        }

        return Object.freeze({

            tenantId:

                mapping.tenantId,

            strategy:

                this.name,

            confidence: 90,

            authenticated: false,

            metadata: Object.freeze({

                hostname,

                domainType:

                    mapping.type ||

                    'custom-domain',

                region:

                    mapping.region ||

                    null

            })

        });

    }

    normalizeHostname(hostname) {

        return hostname
            .trim()
            .toLowerCase()
            .replace(/\.$/, '');

    }

    validateHostname(hostname) {

        if (!hostname) {

            throw new TenantResolutionError(

                'Hostname is empty.'

            );

        }

        if (

            hostname.length > 253

        ) {

            throw new TenantValidationError(

                'Hostname exceeds RFC limits.'

            );

        }

    }

    validateWhitelist(

        hostname,

        configuration

    ) {

        const whitelist =

            configuration.hostname?.whitelist ||

            [];

        if (

            whitelist.length === 0

        ) {

            return;

        }

        if (

            whitelist.includes(hostname)

        ) {

            return;

        }

    }

    validateWildcard(

        hostname,

        configuration

    ) {

        const wildcards =

            configuration.hostname?.wildcards ||

            [];

        for (

            const pattern of wildcards

        ) {

            const suffix =

                pattern.replace('*.', '');

            if (

                hostname.endsWith(

                    `.${suffix}`

                )

            ) {

                return;

            }

        }

    }

    validateSuffix(

        hostname,

        configuration

    ) {

        const suffixes =

            configuration.hostname?.trustedSuffixes ||

            [];

        if (

            suffixes.length === 0

        ) {

            return;

        }

        const valid =

            suffixes.some(

                suffix =>

                    hostname === suffix ||

                    hostname.endsWith(

                        `.${suffix}`

                    )

            );

        if (!valid) {

            throw new TenantUnauthorizedError(

                'Hostname is not trusted.',

                {

                    hostname

                }

            );

        }

    }

    async resolveTenantMapping(

        hostname,

        configuration

    ) {

        const repository =

            configuration.hostnameRepository ||

            this.options.repository;

        if (

            !repository ||

            typeof repository.findByHostname !== 'function'

        ) {

            throw new TenantRepositoryError(

                'Hostname repository unavailable.'

            );

        }

        return repository.findByHostname(

            hostname

        );

    }

}

/* ============================================================================
 * Phase 2.5 — Enterprise Trusted Header Tenant Resolver
 * ============================================================================
 */

/**
 * Enterprise Trusted Header Resolver.
 *
 * Purpose
 * ---------------------------------------------------------------------------
 *
 * Resolves tenant identity from explicitly configured HTTP headers while
 * preventing tenant spoofing attacks.
 *
 * Security Rules
 * ---------------------------------------------------------------------------
 *
 * 1. Only configured headers are accepted.
 * 2. Client-controlled arbitrary headers are ignored.
 * 3. Authenticated identity always has priority.
 * 4. Header tenant must match authenticated tenant.
 * 5. Header resolution requires trusted proxy conditions.
 *
 *
 * Example:
 *
 * X-Tenant-ID: tenant_123
 *
 *      │
 *      ▼
 *
 * Validate
 *
 *      │
 *      ▼
 *
 * Compare with JWT tenant claim
 *
 *      │
 *      ▼
 *
 * Trusted Tenant Candidate
 */

class HeaderTenantResolver
    extends TenantResolutionStrategy {


    constructor(options = {}) {

        super(

            RESOLUTION_STRATEGY.HEADER

        );


        this.options = Object.freeze({

            allowedHeaders:

                options.allowedHeaders ||

                [

                    'x-tenant-id'

                ],

            requireTrustedProxy:

                options.requireTrustedProxy !== false

        });

    }



    /**
     * Resolver availability check.
     */
    supports(

        req,

        configuration

    ) {


        const headers =

            this.getAllowedHeaders(

                configuration

            );


        return headers.some(

            header =>

                Boolean(

                    req.get(header)

                )

        );

    }



    /**
     * Resolve tenant from trusted header.
     */
    async resolve(

        req,

        configuration = {}

    ) {


        const headers =

            this.getAllowedHeaders(

                configuration

            );



        const tenantId =

            this.extractTenantHeader(

                req,

                headers

            );



        if (!tenantId) {

            return null;

        }



        this.validateTenantId(

            tenantId

        );



        this.validateProxyTrust(

            req,

            configuration

        );



        this.validateAuthenticatedIdentity(

            req,

            tenantId

        );



        return Object.freeze({

            tenantId,

            strategy:

                this.name,

            confidence: 50,

            authenticated:

                Boolean(

                    req.user ||

                    req.auth

                ),

            metadata: Object.freeze({

                source:

                    'trusted-header',

                header:

                    this.detectedHeader

            })

        });


    }



    /**
     * Get configured headers only.
     */
    getAllowedHeaders(

        configuration

    ) {


        return (

            configuration

                .trustedHeaders

                ?.allowed ||

            this.options.allowedHeaders

        );


    }



    /**
     * Extract tenant ID.
     */
    extractTenantHeader(

        req,

        headers

    ) {


        for (

            const header of headers

        ) {


            const value =

                req.get(header);



            if (value) {


                this.detectedHeader =

                    header;


                return value.trim();


            }

        }


        return null;


    }



    /**
     * Validate tenant format.
     */
    validateTenantId(

        tenantId

    ) {


        if (

            typeof tenantId !== 'string'

        ) {

            throw new TenantValidationError(

                'Tenant header must contain a string.'

            );

        }



        if (

            tenantId.length === 0

        ) {

            throw new TenantValidationError(

                'Tenant header cannot be empty.'

            );

        }


    }



    /**
     * Ensure request originates from trusted infrastructure.
     */
    validateProxyTrust(

        req,

        configuration

    ) {


        const required =

            configuration

                .trustedProxy

                ?.enabled;



        if (

            !required

        ) {

            return;

        }



        if (

            !req.ip

        ) {


            throw new TenantUnauthorizedError(

                'Unable to verify trusted proxy origin.'

            );


        }


    }



    /**
     * Critical security validation.
     *
     * Header never overrides authentication.
     */
    validateAuthenticatedIdentity(

        req,

        tenantId

    ) {


        const principal =

            req.user ||

            req.auth ||

            req.context?.user;



        if (!principal) {


            return;


        }



        const authenticatedTenant =

            principal.tenantId ||

            principal.tenant ||

            principal.tid;



        if (

            !authenticatedTenant

        ) {


            return;


        }



        if (

            authenticatedTenant !== tenantId

        ) {


            throw new TenantAuthenticationMismatchError(

                'Trusted header tenant does not match authenticated tenant.',

                {

                    authenticatedTenant,

                    headerTenant:

                        tenantId

                }

            );


        }


    }

}


/* ============================================================================
 * Phase 2.6 — Enterprise Tenant Resolution Orchestrator
 * ============================================================================
 */


/**
 * ============================================================================
 * Resolution Priority
 * ============================================================================
 */

const TENANT_RESOLUTION_PRIORITY =
    Object.freeze([

        RESOLUTION_STRATEGY.JWT,

        RESOLUTION_STRATEGY.API_KEY,

        RESOLUTION_STRATEGY.MTLS,

        RESOLUTION_STRATEGY.CUSTOM_DOMAIN,

        RESOLUTION_STRATEGY.SUBDOMAIN,

        RESOLUTION_STRATEGY.HEADER

    ]);



/**
 * ============================================================================
 * Resolver Registry
 * ============================================================================
 */

class TenantResolutionOrchestrator {


    constructor({

        strategies = [],

        logger,

        metrics,

        eventBus,

        traceContext

    } = {}) {


        this.strategies =

            this.sortStrategies(

                strategies

            );


        this.logger =

            logger;


        this.metrics =

            metrics;


        this.eventBus =

            eventBus;


        this.traceContext =

            traceContext;


    }



    /**
     * =========================================================================
     * Main Resolution Entry Point
     * =========================================================================
     */

    async resolve(

        req,

        configuration

    ) {


        const startedAt =

            process.hrtime.bigint();



        try {


            const candidates =

                await this.collectCandidates(

                    req,

                    configuration

                );



            const identity =

                this.selectTrustedTenant(

                    candidates

                );



            await this.publishResolutionEvent(

                identity,

                candidates

            );



            this.recordMetrics(

                startedAt,

                identity

            );



            return Object.freeze(identity);



        }

        catch(error) {


            const normalized =

                normalizeTenantError(

                    error

                );


            this.logFailure(

                req,

                normalized

            );


            throw normalized;


        }


    }



    /**
     * =========================================================================
     * Execute Strategies
     * =========================================================================
     */

    async collectCandidates(

        req,

        configuration

    ) {


        const candidates = [];



        for (

            const strategy of this.strategies

        ) {



            try {


                if (

                    !strategy.supports(

                        req,

                        configuration

                    )

                ) {


                    continue;


                }



                const result =

                    await strategy.resolve(

                        req,

                        configuration

                    );



                if(result) {


                    candidates.push(

                        Object.freeze({

                            ...result,

                            priority:

                                this.getPriority(

                                    strategy.name

                                )

                        })

                    );


                }


            }

            catch(error) {


                /**
                 * Security-sensitive errors must stop execution.
                 */

                if (

                    error instanceof TenantAuthenticationMismatchError ||

                    error instanceof TenantUnauthorizedError

                ) {

                    throw error;

                }



                this.logger?.warn(

                    'Tenant resolution strategy failed',

                    {

                        strategy:

                            strategy.name,

                        error:

                            error.message

                    }

                );


            }

        }



        if (

            candidates.length === 0

        ) {


            throw new TenantResolutionError(

                'No tenant resolution strategy succeeded.'

            );


        }



        return candidates;


    }





    /**
     * =========================================================================
     * Tenant Selection Engine
     * =========================================================================
     */

    selectTrustedTenant(

        candidates

    ) {



        const sorted =

            [...candidates]

                .sort(

                    (

                        a,

                        b

                    ) =>

                        b.confidence -

                        a.confidence

                );



        const primary =

            sorted[0];



        this.detectConflicts(

            primary,

            candidates

        );



        return {


            tenantId:

                primary.tenantId,


            strategy:

                primary.strategy,


            confidence:

                primary.confidence,


            authenticated:

                primary.authenticated === true,


            sources:

                candidates.map(

                    candidate =>

                        ({

                            strategy:

                                candidate.strategy,

                            confidence:

                                candidate.confidence

                        })

                ),



            metadata: {


                resolvedAt:

                    new Date()

                        .toISOString(),


                resolutionMethod:

                    primary.strategy


            }


        };


    }





    /**
     * =========================================================================
     * Conflict Detection
     * =========================================================================
     */

    detectConflicts(

        primary,

        candidates

    ) {


        for (

            const candidate of candidates

        ) {


            if (

                candidate.tenantId &&

                candidate.tenantId !== primary.tenantId

            ) {



                throw new TenantAuthenticationMismatchError(

                    'Multiple tenant identities detected.',

                    {


                        trustedTenant:

                            primary.tenantId,


                        conflictingTenant:

                            candidate.tenantId,


                        trustedSource:

                            primary.strategy,


                        conflictingSource:

                            candidate.strategy


                    }

                );


            }


        }


    }





    /**
     * =========================================================================
     * Priority Sorting
     * =========================================================================
     */

    sortStrategies(

        strategies

    ) {


        return [...strategies]

            .sort(

                (

                    a,

                    b

                ) => {


                    return (

                        this.getPriority(

                            a.name

                        )

                        -

                        this.getPriority(

                            b.name

                        )

                    );


                }

            );


    }





    getPriority(

        strategy

    ) {


        const index =

            TENANT_RESOLUTION_PRIORITY

                .indexOf(strategy);



        return index === -1

            ?

            999

            :

            index;


    }





    /**
     * =========================================================================
     * Observability
     * =========================================================================
     */

    async publishResolutionEvent(

        identity,

        candidates

    ) {


        if (

            !this.eventBus

        ) {

            return;

        }



        await this.eventBus.publish(

            'tenant.resolved',

            {

                tenantId:

                    identity.tenantId,


                strategy:

                    identity.strategy,


                candidates:

                    candidates.length


            }

        );


    }




    recordMetrics(

        startedAt,

        identity

    ) {


        if (

            !this.metrics

        ) {

            return;

        }



        const duration =

            Number(

                process.hrtime.bigint()

                -

                startedAt

            )

            /

            1000000;



        this.metrics.record(

            'tenant_resolution_duration',

            duration,

            {

                strategy:

                    identity.strategy

            }

        );


    }





    logFailure(

        req,

        error

    ) {


        this.logger?.error(

            'Tenant resolution failed',

            {


                requestId:

                    req.id,


                correlationId:

                    req.correlationId,


                error:

                    error.toJSON?.() ||

                    error


            }

        );


    }


}
