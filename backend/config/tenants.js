'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/tenants.js
 *
 * Purpose:
 *   Enterprise production-grade multi-tenant configuration and policy
 *   boundary for the TITech platform.
 *
 * Responsibilities:
 *   - Centralize multi-tenant configuration.
 *   - Define tenant isolation policy.
 *   - Define tenant identification sources.
 *   - Define tenant resolution policy.
 *   - Define tenant lifecycle states.
 *   - Define tenant limits and quotas.
 *   - Define tenant-aware caching/queue/storage namespaces.
 *   - Define cross-tenant access protection.
 *   - Define tenant-aware observability policy.
 *   - Define platform/system-tenant policy.
 *   - Define tenant configuration immutability.
 *   - Provide safe tenant diagnostics.
 *   - Support bootstrap/infrastructure/service contexts.
 *
 * IMPORTANT:
 *
 *   This module owns TENANT CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - resolve authenticated users.
 *     - create database connections.
 *     - enforce authorization.
 *     - mutate tenant records.
 *     - create Express middleware.
 *     - implement business logic.
 *     - implement financial transactions.
 *     - create Redis clients.
 *     - create storage clients.
 *
 * Runtime enforcement belongs to the tenant/auth/service/repository layers.
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/tenants.js
 *       ↓
 *   tenant middleware / auth
 *       ↓
 *   tenant context
 *       ↓
 *   repository / cache / queue / storage
 *
 * =============================================================================
 *
 * Tenant isolation principle:
 *
 *   request
 *      ↓
 *   authenticated principal
 *      ↓
 *   tenant context
 *      ↓
 *   authorization
 *      ↓
 *   tenant-scoped data access
 *
 * No business repository should rely on an implicit global tenant.
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider = null;

try {
    // eslint-disable-next-line global-require
    configProvider = require('./configProvider');
} catch {
    configProvider = null;
}

/**
 * =============================================================================
 * Optional startup-error integration
 * =============================================================================
 */

let startupErrors = null;

try {
    // eslint-disable-next-line global-require
    startupErrors = require('../bootstrap/startupErrors');
} catch {
    startupErrors = null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule = require('../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'tenant-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const TENANT_STATES =
    Object.freeze({
        PROVISIONING:
            'provisioning',

        ACTIVE:
            'active',

        SUSPENDED:
            'suspended',

        READ_ONLY:
            'read_only',

        DEACTIVATED:
            'deactivated',

        ARCHIVED:
            'archived',

        DELETED:
            'deleted',
    });

const TENANT_TYPES =
    Object.freeze({
        PLATFORM:
            'platform',

        COMMUNITY:
            'community',

        ORGANIZATION:
            'organization',

        PARTNER:
            'partner',

        ENTERPRISE:
            'enterprise',

        TEST:
            'test',
    });

const TENANT_ID_SOURCES =
    Object.freeze({
        HEADER:
            'header',

        SUBDOMAIN:
            'subdomain',

        PATH:
            'path',

        JWT:
            'jwt',

        API_KEY:
            'api_key',

        SESSION:
            'session',

        INTERNAL_CONTEXT:
            'internal_context',
    });

const TENANT_ISOLATION_MODES =
    Object.freeze({
        STRICT:
            'strict',

        SHARED_DATABASE:
            'shared_database',

        DATABASE_PER_TENANT:
            'database_per_tenant',

        HYBRID:
            'hybrid',
    });

const TENANT_FAILURE_MODES =
    Object.freeze({
        FAIL_CLOSED:
            'fail_closed',

        FAIL_OPEN:
            'fail_open',

        DEGRADED:
            'degraded',
    });

const TENANT_CONFIG_STATES =
    Object.freeze({
        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        /**
         * ---------------------------------------------------------------------
         * Global tenant system
         * ---------------------------------------------------------------------
         */

        enabled:
            true,

        required:
            false,

        isolationMode:
            TENANT_ISOLATION_MODES.STRICT,

        /**
         * Require an explicit tenant context for tenant-scoped requests.
         */
        requireTenantContext:
            true,

        /**
         * Allow explicitly designated platform/system routes to operate without
         * a tenant context.
         */
        allowSystemContext:
            true,

        /**
         * Never infer a tenant from untrusted request values when a trusted
         * identity source exists.
         */
        trustedIdentityRequired:
            true,

        /**
         * ---------------------------------------------------------------------
         * Tenant identification
         * ---------------------------------------------------------------------
         */

        identification:
            {
                sources:
                    [
                        TENANT_ID_SOURCES.JWT,
                        TENANT_ID_SOURCES.HEADER,
                        TENANT_ID_SOURCES.SUBDOMAIN,
                        TENANT_ID_SOURCES.PATH,
                    ],

                primary:
                    TENANT_ID_SOURCES.JWT,

                header:
                    'X-Tenant-ID',

                pathParameter:
                    'tenantId',

                subdomainPattern:
                    /^[a-z0-9][a-z0-9-]{1,62}$/,

                allowHeaderOverride:
                    false,

                allowQueryParameter:
                    false,

                queryParameter:
                    'tenantId',

                normalize:
                    true,

                maxLength:
                    64,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant identifiers
         * ---------------------------------------------------------------------
         */

        identifiers:
            {
                prefix:
                    'tnt_',

                minLength:
                    8,

                maxLength:
                    64,

                allowNumericOnly:
                    false,

                allowReservedNames:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant states
         * ---------------------------------------------------------------------
         */

        states:
            {
                active:
                    [
                        TENANT_STATES.ACTIVE,
                    ],

                readable:
                    [
                        TENANT_STATES.ACTIVE,
                        TENANT_STATES.READ_ONLY,
                    ],

                writable:
                    [
                        TENANT_STATES.ACTIVE,
                    ],

                blocked:
                    [
                        TENANT_STATES.SUSPENDED,
                        TENANT_STATES.DEACTIVATED,
                        TENANT_STATES.ARCHIVED,
                        TENANT_STATES.DELETED,
                    ],
            },

        /**
         * ---------------------------------------------------------------------
         * Platform/system tenant
         * ---------------------------------------------------------------------
         */

        systemTenant:
            {
                enabled:
                    true,

                id:
                    process.env.SYSTEM_TENANT_ID ||
                    'tnt_system',

                type:
                    TENANT_TYPES.PLATFORM,

                allowCrossTenantOperations:
                    false,

                requireExplicitPrivilege:
                    true,

                allowFinancialOperations:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Resource quotas
         * ---------------------------------------------------------------------
         */

        quotas:
            {
                maxUsers:
                    10_000,

                maxGroups:
                    1_000,

                maxLoans:
                    100_000,

                maxContributions:
                    1_000_000,

                maxApiRequestsPerMinute:
                    10_000,

                maxConcurrentRequests:
                    500,

                maxStorageBytes:
                    10 * 1024 * 1024 * 1024,

                maxMonthlyStorageGrowthBytes:
                    2 * 1024 * 1024 * 1024,

                maxQueueJobsPerMinute:
                    5_000,

                maxEmailJobsPerMinute:
                    1_000,

                maxSmsJobsPerMinute:
                    500,

                maxWebsocketConnections:
                    1_000,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant-specific rate limiting
         * ---------------------------------------------------------------------
         */

        rateLimit:
            {
                enabled:
                    true,

                strategy:
                    'sliding_window',

                windowMs:
                    60_000,

                requestsPerWindow:
                    10_000,

                burst:
                    100,

                failureMode:
                    TENANT_FAILURE_MODES.FAIL_CLOSED,

                trustProxy:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant cache policy
         * ---------------------------------------------------------------------
         */

        cache:
            {
                enabled:
                    true,

                namespace:
                    'tenant',

                includeTenantId:
                    true,

                requireTenantPrefix:
                    true,

                preventCrossTenantCacheReads:
                    true,

                preventCrossTenantCacheWrites:
                    true,

                defaultTtlSeconds:
                    300,

                maxTtlSeconds:
                    86_400,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant queue policy
         * ---------------------------------------------------------------------
         */

        queue:
            {
                enabled:
                    true,

                includeTenantId:
                    true,

                requireTenantJobId:
                    true,

                namespace:
                    'tenant',

                preventCrossTenantJobAccess:
                    true,

                allowPlatformQueueAccess:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant storage policy
         * ---------------------------------------------------------------------
         */

        storage:
            {
                enabled:
                    true,

                namespace:
                    'tenant',

                includeTenantId:
                    true,

                requireTenantPrefix:
                    true,

                preventCrossTenantObjectAccess:
                    true,

                privateByDefault:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Database policy
         * ---------------------------------------------------------------------
         */

        database:
            {
                enabled:
                    true,

                requireTenantScope:
                    true,

                injectTenantFilter:
                    false,

                allowUnscopedReads:
                    false,

                allowUnscopedWrites:
                    false,

                allowCrossTenantQueries:
                    false,

                tenantField:
                    'tenantId',

                organizationField:
                    'organizationId',
            },

        /**
         * ---------------------------------------------------------------------
         * Financial isolation
         * ---------------------------------------------------------------------
         *
         * Tenant boundaries around financial state are stricter than ordinary
         * application data.
         */

        financial:
            {
                enabled:
                    true,

                requireTenantContext:
                    true,

                requireTenantAuthorization:
                    true,

                preventCrossTenantTransactions:
                    true,

                preventCrossTenantLedgerAccess:
                    true,

                preventCrossTenantBalanceAccess:
                    true,

                preventCrossTenantIdempotency:
                    true,

                preventCrossTenantLocks:
                    true,

                requireTenantInAuditMetadata:
                    true,

                allowPlatformFinancialOperations:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Authentication/authorization
         * ---------------------------------------------------------------------
         */

        auth:
            {
                requireTenantClaim:
                    true,

                claimName:
                    'tenantId',

                organizationClaimName:
                    'organizationId',

                allowTenantSwitching:
                    false,

                tenantSwitchRequiresPrivilege:
                    true,

                requireMembership:
                    true,

                requireActiveMembership:
                    true,

                cacheMembership:
                    true,

                membershipCacheTtlSeconds:
                    300,
            },

        /**
         * ---------------------------------------------------------------------
         * Tenant context propagation
         * ---------------------------------------------------------------------
         */

        context:
            {
                asyncLocalStorage:
                    true,

                headerName:
                    'X-Tenant-ID',

                correlationHeaderName:
                    'X-Correlation-ID',

                includeTenantInLogs:
                    true,

                includeTenantInMetrics:
                    true,

                includeTenantInTraces:
                    true,

                includeTenantInJobs:
                    true,

                includeTenantInStorage:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        observability:
            {
                enabled:
                    true,

                metricsEnabled:
                    true,

                logsEnabled:
                    true,

                tracesEnabled:
                    true,

                includeTenantId:
                    true,

                hashTenantIdentifiers:
                    false,

                exposeTenantNames:
                    false,

                exposeTenantMetadata:
                    false,

                highCardinalityTenantLabels:
                    false,

                slowTenantOperationThresholdMs:
                    2_000,
            },

        /**
         * ---------------------------------------------------------------------
         * Security
         * ---------------------------------------------------------------------
         */

        security:
            {
                preventTenantEnumeration:
                    true,

                genericUnauthorizedResponses:
                    true,

                genericNotFoundResponses:
                    true,

                rejectMalformedTenantIds:
                    true,

                rejectUnknownTenants:
                    true,

                rejectInactiveTenants:
                    true,

                preventTenantIdFromClientPayload:
                    true,

                ignoreClientProvidedTenantField:
                    true,

                preventTenantContextMutation:
                    true,

                requireTrustedTenantContext:
                    true,

                allowCrossTenantAccess:
                    false,

                allowCrossTenantAdmin:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Provisioning
         * ---------------------------------------------------------------------
         */

        provisioning:
            {
                enabled:
                    true,

                defaultState:
                    TENANT_STATES.PROVISIONING,

                activationRequiresValidation:
                    true,

                requireUniqueSlug:
                    true,

                requireUniqueIdentifier:
                    true,

                rollbackOnFailure:
                    true,

                provisioningTimeoutMs:
                    120_000,
            },

        /**
         * ---------------------------------------------------------------------
         * Lifecycle
         * ---------------------------------------------------------------------
         */

        lifecycle:
            {
                allowSuspension:
                    true,

                allowReadOnlyMode:
                    true,

                allowDeactivation:
                    true,

                allowArchival:
                    true,

                allowDeletion:
                    false,

                deletionRequiresExplicitApproval:
                    true,

                deletionGracePeriodDays:
                    30,
            },

        /**
         * ---------------------------------------------------------------------
         * Health/readiness
         * ---------------------------------------------------------------------
         */

        health:
            {
                enabled:
                    true,

                timeoutMs:
                    5_000,

                requiredForReadiness:
                    true,

                verifySystemTenant:
                    true,

                verifyTenantRegistry:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        diagnostics:
            {
                enabled:
                    true,

                exposeTenantNames:
                    false,

                exposeTenantMetadata:
                    false,

                exposeTenantCounts:
                    true,

                exposeTenantIdentifiers:
                    false,

                exposeQuotas:
                    true,

                exposeConfiguration:
                    true,
            },
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class TenantConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'TenantConfigError';

        this.code =
            options.code ||
            'TENANT_CONFIG_ERROR';

        this.field =
            options.field ||
            null;

        this.tenantId =
            options.tenantId ||
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            TenantConfigError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function env(
    key,
    fallback = undefined,
) {

    const value =
        process.env[key];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    return String(
        value,
    ).trim();
}

function asBoolean(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    if (
        typeof value === 'boolean'
    ) {

        return value;
    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled',
        ].includes(
            normalized,
        )
    ) {

        return true;
    }

    if (
        [
            '0',
            'false',
            'no',
            'off',
            'disabled',
        ].includes(
            normalized,
        )
    ) {

        return false;
    }

    return fallback;
}

function asPositiveInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed <= 0
    ) {

        return fallback;
    }

    return parsed;
}

function asNonNegativeInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed < 0
    ) {

        return fallback;
    }

    return parsed;
}

function asString(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;
    }

    const normalized =
        String(
            value,
        ).trim();

    return normalized ||
        fallback;
}

function asList(
    value,
    fallback = [],
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return [
            ...fallback,
        ];
    }

    const source =
        Array.isArray(value)
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            source
                .map(
                    item =>
                        String(
                            item,
                        ).trim(),
                )
                .filter(Boolean),
        ),
    ];
}

function toEnum(
    value,
    allowed,
    fallback,
) {

    const normalized =
        asString(
            value,
            fallback,
        );

    return (
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        ) ||
        fallback
    );
}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !== 'object'
    ) {

        return object;
    }

    if (
        seen.has(
            object,
        )
    ) {

        return object;
    }

    seen.add(
        object,
    );

    for (
        const key of Reflect.ownKeys(
            object,
        )
    ) {

        try {

            deepFreeze(
                object[key],
                seen,
            );

        } catch {
            // Best effort.
        }
    }

    try {

        Object.freeze(
            object,
        );

    } catch {
        // Best effort.
    }

    return object;
}

/**
 * =============================================================================
 * Environment/configuration helpers
 * =============================================================================
 */

function getConfig(
    path,
    fallback,
) {

    try {

        if (
            typeof configProvider?.get ===
            'function'
        ) {

            return configProvider.get(
                path,
                fallback,
            );
        }

    } catch {
        // Fall through.
    }

    return fallback;
}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
            'function'
        ) {

            return configProvider.getEnvironment();
        }

    } catch {
        // Fall through.
    }

    return (
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                'development',
        ) ||
        'development'
    );
}

function isProduction(
    environment =
        getEnvironment(),
) {

    return environment ===
        'production';
}

/**
 * =============================================================================
 * Tenant identifier handling
 * =============================================================================
 */

const RESERVED_TENANT_NAMES =
    Object.freeze([
        'admin',
        'administrator',
        'api',
        'auth',
        'health',
        'internal',
        'system',
        'root',
        'support',
        'www',
        'null',
        'undefined',
    ]);

function normalizeTenantId(
    tenantId,
    config =
        defaultConfig,
) {

    if (
        tenantId === undefined ||
        tenantId === null
    ) {

        return null;
    }

    const normalized =
        String(
            tenantId,
        )
            .trim()
            .toLowerCase();

    if (
        !normalized
    ) {

        return null;
    }

    if (
        normalized.length >
        config.identifiers.maxLength
    ) {

        return null;
    }

    if (
        !/^[a-z][a-z0-9_-]*$/.test(
            normalized,
        )
    ) {

        return null;
    }

    if (
        !config.identifiers.allowReservedNames &&
        RESERVED_TENANT_NAMES.includes(
            normalized,
        )
    ) {

        return null;
    }

    return normalized;
}

function isValidTenantId(
    tenantId,
    config =
        defaultConfig,
) {

    const normalized =
        normalizeTenantId(
            tenantId,
            config,
        );

    if (
        !normalized
    ) {

        return false;
    }

    if (
        normalized.length <
        config.identifiers.minLength
    ) {

        return false;
    }

    if (
        config.identifiers.prefix &&
        !normalized.startsWith(
            config.identifiers.prefix,
        )
    ) {

        /**
         * Permit existing non-prefixed tenant IDs when a deployment explicitly
         * chooses not to require the prefix.
         */
        if (
            env(
                'TENANT_REQUIRE_PREFIX',
                'true',
            ) !==
            'false'
        ) {

            return false;
        }
    }

    if (
        !config.identifiers.allowNumericOnly &&
        /^\d+$/.test(
            normalized,
        )
    ) {

        return false;
    }

    return true;
}

function generateTenantId(
    config =
        defaultConfig,
) {

    const random =
        crypto
            .randomBytes(
                8,
            )
            .toString(
                'hex',
            );

    return `${config.identifiers.prefix}${random}`;
}

/**
 * =============================================================================
 * Tenant namespace handling
 * =============================================================================
 */

function tenantNamespace(
    tenantId,
    config =
        defaultConfig,
) {

    if (
        !isValidTenantId(
            tenantId,
            config,
        )
    ) {

        throw new TenantConfigError(
            'Invalid TITech tenant identifier.',
            {
                code:
                    'TENANT_IDENTIFIER_INVALID',

                tenantId,
            },
        );
    }

    return [
        config.context.includeTenant
            ? config.context.headerName
            : 'tenant',
        tenantId,
    ]
        .join(':')
        .toLowerCase();
}

function createCacheNamespace(
    tenantId,
    config =
        defaultConfig,
) {

    const normalized =
        normalizeTenantId(
            tenantId,
            config,
        );

    if (
        !normalized
    ) {

        throw new TenantConfigError(
            'Tenant context is required to create a tenant cache namespace.',
            {
                code:
                    'TENANT_CONTEXT_REQUIRED',
            },
        );
    }

    if (
        config.cache.requireTenantPrefix
    ) {

        return [
            config.cache.namespace,
            normalized,
        ].join(':');
    }

    return normalized;
}

function createQueueNamespace(
    tenantId,
    config =
        defaultConfig,
) {

    const normalized =
        normalizeTenantId(
            tenantId,
            config,
        );

    if (
        !normalized
    ) {

        throw new TenantConfigError(
            'Tenant context is required to create a tenant queue namespace.',
            {
                code:
                    'TENANT_CONTEXT_REQUIRED',
            },
        );
    }

    return [
        config.queue.namespace,
        normalized,
    ].join(':');
}

function createStorageNamespace(
    tenantId,
    config =
        defaultConfig,
) {

    const normalized =
        normalizeTenantId(
            tenantId,
            config,
        );

    if (
        !normalized
    ) {

        throw new TenantConfigError(
            'Tenant context is required to create a tenant storage namespace.',
            {
                code:
                    'TENANT_CONTEXT_REQUIRED',
            },
        );
    }

    return [
        config.storage.namespace,
        normalized,
    ].join('/');
}

/**
 * =============================================================================
 * Tenant extraction policy
 * =============================================================================
 */

function getTenantResolutionPolicy(
    config =
        defaultConfig,
) {

    return deepFreeze({
        primary:
            config.identification.primary,

        sources:
            [
                ...config.identification.sources,
            ],

        header:
            config.identification.header,

        pathParameter:
            config.identification.pathParameter,

        allowHeaderOverride:
            config.identification
                .allowHeaderOverride,

        allowQueryParameter:
            config.identification
                .allowQueryParameter,

        queryParameter:
            config.identification
                .queryParameter,

        trustedIdentityRequired:
            config.trustedIdentityRequired,

        requireTenantContext:
            config.requireTenantContext,
    });
}

/**
 * =============================================================================
 * Tenant state policy
 * =============================================================================
 */

function canReadTenant(
    state,
    config =
        defaultConfig,
) {

    return config.states.readable.includes(
        state,
    );
}

function canWriteTenant(
    state,
    config =
        defaultConfig,
) {

    return config.states.writable.includes(
        state,
    );
}

function canActivateTenant(
    state,
) {

    return (
        state ===
            TENANT_STATES.PROVISIONING ||
        state ===
            TENANT_STATES.READ_ONLY ||
        state ===
            TENANT_STATES.SUSPENDED
    );
}

function canSuspendTenant(
    state,
) {

    return state ===
        TENANT_STATES.ACTIVE;
}

function canDeleteTenant(
    state,
    config =
        defaultConfig,
) {

    return (
        config.lifecycle.allowDeletion &&
        (
            state ===
                TENANT_STATES.DEACTIVATED ||
            state ===
                TENANT_STATES.ARCHIVED
        )
    );
}

/**
 * =============================================================================
 * Cross-tenant access policy
 * =============================================================================
 */

function isCrossTenantAccessAllowed(
    {
        actorTenantId,
        targetTenantId,
        isPlatformPrincipal = false,
        explicitPrivilege = false,
    } = {},
    config =
        defaultConfig,
) {

    const actor =
        normalizeTenantId(
            actorTenantId,
            config,
        );

    const target =
        normalizeTenantId(
            targetTenantId,
            config,
        );

    if (
        !actor ||
        !target
    ) {

        return false;
    }

    if (
        actor ===
        target
    ) {

        return true;
    }

    if (
        !config.security.allowCrossTenantAccess
    ) {

        return false;
    }

    if (
        !isPlatformPrincipal
    ) {

        return false;
    }

    if (
        !explicitPrivilege
    ) {

        return false;
    }

    if (
        !config.security.allowCrossTenantAdmin
    ) {

        return false;
    }

    return true;
}

/**
 * =============================================================================
 * Financial tenant policy
 * =============================================================================
 */

function getFinancialTenantPolicy(
    config =
        defaultConfig,
) {

    return deepFreeze({
        enabled:
            config.financial.enabled,

        requireTenantContext:
            config.financial
                .requireTenantContext,

        requireTenantAuthorization:
            config.financial
                .requireTenantAuthorization,

        preventCrossTenantTransactions:
            config.financial
                .preventCrossTenantTransactions,

        preventCrossTenantLedgerAccess:
            config.financial
                .preventCrossTenantLedgerAccess,

        preventCrossTenantBalanceAccess:
            config.financial
                .preventCrossTenantBalanceAccess,

        preventCrossTenantIdempotency:
            config.financial
                .preventCrossTenantIdempotency,

        preventCrossTenantLocks:
            config.financial
                .preventCrossTenantLocks,

        requireTenantInAuditMetadata:
            config.financial
                .requireTenantInAuditMetadata,

        allowPlatformFinancialOperations:
            config.financial
                .allowPlatformFinancialOperations,
    });
}

/**
 * =============================================================================
 * Tenant request validation policy
 * =============================================================================
 */

function validateTenantContext(
    context,
    {
        requireTenant =
            defaultConfig
                .requireTenantContext,
        allowSystemContext =
            defaultConfig
                .allowSystemContext,
        systemContext = false,
        config =
            defaultConfig,
    } = {},
) {

    if (
        systemContext &&
        allowSystemContext
    ) {

        return {
            valid:
                true,

            tenantId:
                null,

            systemContext:
                true,
        };
    }

    const tenantId =
        normalizeTenantId(
            context?.tenantId,
            config,
        );

    if (
        requireTenant &&
        !tenantId
    ) {

        throw new TenantConfigError(
            'TITech tenant context is required.',
            {
                code:
                    'TENANT_CONTEXT_REQUIRED',
            },
        );
    }

    if (
        tenantId &&
        !isValidTenantId(
            tenantId,
            config,
        )
    ) {

        throw new TenantConfigError(
            'TITech tenant identifier is invalid.',
            {
                code:
                    'TENANT_IDENTIFIER_INVALID',

                tenantId,
            },
        );
    }

    return {
        valid:
            true,

        tenantId,

        systemContext:
            false,
    };
}

/**
 * =============================================================================
 * Tenant-scoped operation policy
 * =============================================================================
 */

function getOperationPolicy(
    {
        operationType =
            'read',
        financial = false,
        crossTenant = false,
    } = {},
    config =
        defaultConfig,
) {

    if (
        crossTenant &&
        !config.security.allowCrossTenantAccess
    ) {

        return deepFreeze({
            allowed:
                false,

            failureMode:
                TENANT_FAILURE_MODES.FAIL_CLOSED,

            reason:
                'Cross-tenant access is disabled.',
        });
    }

    if (
        financial &&
        crossTenant &&
        config.financial
            .preventCrossTenantTransactions
    ) {

        return deepFreeze({
            allowed:
                false,

            failureMode:
                TENANT_FAILURE_MODES.FAIL_CLOSED,

            reason:
                'Cross-tenant financial operations are forbidden.',
        });
    }

    if (
        financial &&
        (
            operationType ===
                'write' ||
            operationType ===
                'transaction'
        ) &&
        config.financial
            .requireTenantContext
    ) {

        return deepFreeze({
            allowed:
                true,

            requireTenantContext:
                true,

            failureMode:
                TENANT_FAILURE_MODES.FAIL_CLOSED,
        });
    }

    return deepFreeze({
        allowed:
            true,

        requireTenantContext:
            config.database
                .requireTenantScope,

        failureMode:
            TENANT_FAILURE_MODES.FAIL_CLOSED,
    });
}

/**
 * =============================================================================
 * Tenant quota policy
 * =============================================================================
 */

function getQuota(
    resource,
    config =
        defaultConfig,
) {

    if (
        !Object.prototype.hasOwnProperty.call(
            config.quotas,
            resource,
        )
    ) {

        throw new TenantConfigError(
            `Unknown TITech tenant quota "${resource}".`,
            {
                code:
                    'TENANT_QUOTA_UNKNOWN',

                field:
                    `quotas.${resource}`,
            },
        );
    }

    return config.quotas[
        resource
    ];
}

function isWithinQuota(
    resource,
    currentValue,
    config =
        defaultConfig,
) {

    const limit =
        getQuota(
            resource,
            config,
        );

    return (
        Number(
            currentValue,
        ) <=
        limit
    );
}

/**
 * =============================================================================
 * Tenant context fingerprint
 * =============================================================================
 */

function fingerprintTenantContext(
    {
        tenantId,
        organizationId = null,
    } = {},
) {

    const payload =
        JSON.stringify({
            tenantId:
                normalizeTenantId(
                    tenantId,
                    defaultConfig,
                ),

            organizationId:
                organizationId
                    ? String(
                        organizationId,
                    ).trim()
                    : null,
        });

    return crypto
        .createHash(
            'sha256',
        )
        .update(
            payload,
            'utf8',
        )
        .digest(
            'hex',
        );
}

/**
 * =============================================================================
 * Environment overrides
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [
        'TENANTS_ENABLED',
        'TENANTS_REQUIRED',
        'TENANT_ISOLATION_MODE',

        'TENANT_ID_HEADER',
        'TENANT_ID_PRIMARY_SOURCE',
        'TENANT_ALLOW_HEADER_OVERRIDE',
        'TENANT_ALLOW_QUERY_PARAMETER',
        'TENANT_QUERY_PARAMETER',
        'TENANT_REQUIRE_PREFIX',
        'TENANT_ID_PREFIX',
        'TENANT_ID_MIN_LENGTH',
        'TENANT_ID_MAX_LENGTH',

        'SYSTEM_TENANT_ID',

        'TENANT_MAX_USERS',
        'TENANT_MAX_GROUPS',
        'TENANT_MAX_LOANS',
        'TENANT_MAX_CONTRIBUTIONS',
        'TENANT_MAX_API_REQUESTS_PER_MINUTE',
        'TENANT_MAX_CONCURRENT_REQUESTS',
        'TENANT_MAX_STORAGE_BYTES',
        'TENANT_MAX_QUEUE_JOBS_PER_MINUTE',
        'TENANT_MAX_EMAIL_JOBS_PER_MINUTE',
        'TENANT_MAX_SMS_JOBS_PER_MINUTE',
        'TENANT_MAX_WEBSOCKET_CONNECTIONS',

        'TENANT_RATE_LIMIT_ENABLED',
        'TENANT_RATE_LIMIT_WINDOW_MS',
        'TENANT_RATE_LIMIT_REQUESTS',
        'TENANT_RATE_LIMIT_BURST',

        'TENANT_CACHE_ENABLED',
        'TENANT_QUEUE_ENABLED',
        'TENANT_STORAGE_ENABLED',

        'TENANT_DATABASE_SCOPE_REQUIRED',
        'TENANT_DATABASE_UNSCOPED_READS',
        'TENANT_DATABASE_UNSCOPED_WRITES',

        'TENANT_FINANCIAL_ENABLED',
        'TENANT_FINANCIAL_CROSS_TENANT_FORBIDDEN',
        'TENANT_FINANCIAL_PLATFORM_OPERATIONS',

        'TENANT_REQUIRE_AUTH_CLAIM',
        'TENANT_ALLOW_SWITCHING',

        'TENANT_LOGS_ENABLED',
        'TENANT_METRICS_ENABLED',
        'TENANT_TRACES_ENABLED',
        'TENANT_HIGH_CARDINALITY_LABELS',

        'TENANT_PREVENT_ENUMERATION',
        'TENANT_GENERIC_UNAUTHORIZED',
        'TENANT_GENERIC_NOT_FOUND',
        'TENANT_CLIENT_PAYLOAD_OVERRIDE',

        'TENANT_PROVISIONING_ENABLED',
        'TENANT_PROVISIONING_TIMEOUT_MS',

        'TENANT_ALLOW_DELETION',
        'TENANT_DELETION_GRACE_PERIOD_DAYS',

        'TENANT_HEALTH_ENABLED',
        'TENANT_HEALTH_TIMEOUT_MS',
        'TENANT_HEALTH_REQUIRED',
    ];

    const result = {};

    for (
        const key of keys
    ) {

        result[key] =
            process.env[key];
    }

    return Object.freeze(
        result,
    );
}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateTenantConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        isProduction(
            config.environment,
        );

    /**
     * -------------------------------------------------------------------------
     * Isolation
     * -------------------------------------------------------------------------
     */

    if (
        config.isolationMode ===
        TENANT_ISOLATION_MODES.STRICT
    ) {

        if (
            !config.requireTenantContext
        ) {

            errors.push({
                code:
                    'TENANT_CONTEXT_REQUIRED_IN_STRICT_MODE',

                field:
                    'requireTenantContext',
            });
        }

        if (
            !config.database
                .requireTenantScope
        ) {

            errors.push({
                code:
                    'TENANT_DATABASE_SCOPE_REQUIRED',

                field:
                    'database.requireTenantScope',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Header/query trust boundary
     * -------------------------------------------------------------------------
     */

    if (
        config.identification
            .allowHeaderOverride &&
        config.trustedIdentityRequired
    ) {

        errors.push({
            code:
                'TENANT_HEADER_OVERRIDE_UNSAFE',

            field:
                'identification.allowHeaderOverride',

            message:
                'TITech tenant identity cannot be freely overridden by an untrusted request header.',
        });
    }

    if (
        config.identification
            .allowQueryParameter
    ) {

        warnings.push({
            code:
                'TENANT_QUERY_PARAMETER_ENABLED',

            field:
                'identification.allowQueryParameter',

            message:
                'Tenant identifiers supplied through query parameters are high risk and should be limited to trusted internal tooling.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Security
     * -------------------------------------------------------------------------
     */

    if (
        config.security
            .allowTenantContextMutation
    ) {

        errors.push({
            code:
                'TENANT_CONTEXT_MUTATION_FORBIDDEN',

            field:
                'security.allowTenantContextMutation',
        });
    }

    if (
        production &&
        config.security
            .allowCrossTenantAccess
    ) {

        errors.push({
            code:
                'CROSS_TENANT_ACCESS_FORBIDDEN',

            field:
                'security.allowCrossTenantAccess',

            message:
                'TITech production cross-tenant access must remain disabled unless an explicitly isolated administrative path is implemented.',
        });
    }

    if (
        production &&
        !config.security
            .preventTenantEnumeration
    ) {

        errors.push({
            code:
                'TENANT_ENUMERATION_PROTECTION_REQUIRED',

            field:
                'security.preventTenantEnumeration',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Financial boundaries
     * -------------------------------------------------------------------------
     */

    if (
        config.financial.enabled &&
        !config.financial
            .requireTenantContext
    ) {

        errors.push({
            code:
                'FINANCIAL_TENANT_CONTEXT_REQUIRED',

            field:
                'financial.requireTenantContext',
        });
    }

    if (
        config.financial.enabled &&
        !config.financial
            .preventCrossTenantTransactions
    ) {

        errors.push({
            code:
                'CROSS_TENANT_FINANCIAL_TRANSACTIONS_FORBIDDEN',

            field:
                'financial.preventCrossTenantTransactions',
        });
    }

    if (
        config.financial.enabled &&
        !config.financial
            .preventCrossTenantLedgerAccess
    ) {

        errors.push({
            code:
                'CROSS_TENANT_LEDGER_ACCESS_FORBIDDEN',

            field:
                'financial.preventCrossTenantLedgerAccess',
        });
    }

    if (
        config.financial.enabled &&
        !config.financial
            .preventCrossTenantBalanceAccess
    ) {

        errors.push({
            code:
                'CROSS_TENANT_BALANCE_ACCESS_FORBIDDEN',

            field:
                'financial.preventCrossTenantBalanceAccess',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Cache/queue/storage isolation
     * -------------------------------------------------------------------------
     */

    if (
        config.cache.enabled &&
        !config.cache
            .preventCrossTenantCacheReads
    ) {

        errors.push({
            code:
                'CROSS_TENANT_CACHE_READS_FORBIDDEN',

            field:
                'cache.preventCrossTenantCacheReads',
        });
    }

    if (
        config.queue.enabled &&
        !config.queue
            .preventCrossTenantJobAccess
    ) {

        errors.push({
            code:
                'CROSS_TENANT_QUEUE_ACCESS_FORBIDDEN',

            field:
                'queue.preventCrossTenantJobAccess',
        });
    }

    if (
        config.storage.enabled &&
        !config.storage
            .preventCrossTenantObjectAccess
    ) {

        errors.push({
            code:
                'CROSS_TENANT_STORAGE_ACCESS_FORBIDDEN',

            field:
                'storage.preventCrossTenantObjectAccess',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Observability
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.observability
            .highCardinalityTenantLabels
    ) {

        warnings.push({
            code:
                'TENANT_HIGH_CARDINALITY_METRICS',

            field:
                'observability.highCardinalityTenantLabels',

            message:
                'Tenant IDs should generally not be unrestricted Prometheus metric labels in high-tenant-count deployments.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * System tenant
     * -------------------------------------------------------------------------
     */

    if (
        config.systemTenant.enabled &&
        !isValidTenantId(
            config.systemTenant.id,
            config,
        )
    ) {

        errors.push({
            code:
                'SYSTEM_TENANT_ID_INVALID',

            field:
                'systemTenant.id',
        });
    }

    if (
        config.systemTenant
            .allowFinancialOperations
    ) {

        errors.push({
            code:
                'SYSTEM_TENANT_FINANCIAL_OPERATIONS_FORBIDDEN',

            field:
                'systemTenant.allowFinancialOperations',

            message:
                'Platform/system context must not silently execute tenant financial operations.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Lifecycle
     * -------------------------------------------------------------------------
     */

    if (
        config.lifecycle
            .allowDeletion &&
        !config.lifecycle
            .deletionRequiresExplicitApproval
    ) {

        errors.push({
            code:
                'TENANT_DELETION_APPROVAL_REQUIRED',

            field:
                'lifecycle.deletionRequiresExplicitApproval',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Quotas
     * -------------------------------------------------------------------------
     */

    for (
        const [
            resource,
            limit,
        ] of Object.entries(
            config.quotas,
        )
    ) {

        if (
            !Number.isInteger(
                limit,
            ) ||
            limit <= 0
        ) {

            errors.push({
                code:
                    'TENANT_QUOTA_INVALID',

                field:
                    `quotas.${resource}`,
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Failure
     * -------------------------------------------------------------------------
     */

    if (
        errors.length >
        0
    ) {

        const error =
            new TenantConfigError(
                'TITech tenant configuration validation failed.',
                {
                    code:
                        'TENANT_CONFIGURATION_INVALID',

                    details: {
                        errors,
                        warnings,
                    },
                },
            );

        if (
            startupErrors?.configurationError
        ) {

            try {

                throw startupErrors.configurationError(
                    error.message,
                    {
                        cause:
                            error,

                        critical:
                            config.required,

                        fatal:
                            config.required,

                        details: {
                            component:
                                COMPONENT,

                            errors,
                            warnings,
                        },
                    },
                );

            } catch (
                wrappedError
            ) {

                throw wrappedError;
            }
        }

        throw error;
    }

    const state =
        !config.enabled
            ? TENANT_CONFIG_STATES.DISABLED
            : warnings.length > 0
                ? TENANT_CONFIG_STATES.DEGRADED
                : TENANT_CONFIG_STATES.ENABLED;

    return deepFreeze({
        ...config,

        state,

        warnings:
            Object.freeze(
                warnings,
            ),
    });
}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createTenantConfig(
    input = {},
) {

    const source =
        input.tenants ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const config = {

        component:
            COMPONENT,

        environment,

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'TENANTS_ENABLED',
                ),
                DEFAULTS.enabled,
            ),

        required:
            source.required ??
            asBoolean(
                env(
                    'TENANTS_REQUIRED',
                ),
                DEFAULTS.required,
            ),

        isolationMode:
            toEnum(
                source.isolationMode ||
                env(
                    'TENANT_ISOLATION_MODE',
                ),
                Object.values(
                    TENANT_ISOLATION_MODES,
                ),
                DEFAULTS.isolationMode,
            ),

        requireTenantContext:
            source.requireTenantContext ??
            asBoolean(
                env(
                    'TENANT_CONTEXT_REQUIRED',
                ),
                DEFAULTS.requireTenantContext,
            ),

        allowSystemContext:
            source.allowSystemContext ??
            asBoolean(
                env(
                    'TENANT_ALLOW_SYSTEM_CONTEXT',
                ),
                DEFAULTS.allowSystemContext,
            ),

        trustedIdentityRequired:
            source.trustedIdentityRequired ??
            asBoolean(
                env(
                    'TENANT_TRUSTED_IDENTITY_REQUIRED',
                ),
                DEFAULTS.trustedIdentityRequired,
            ),

        identification:
            {
                sources:
                    asList(
                        source.identification
                            ?.sources ||
                        env(
                            'TENANT_ID_SOURCES',
                        ),
                        DEFAULTS
                            .identification
                            .sources,
                    ).filter(
                        sourceName =>
                            Object.values(
                                TENANT_ID_SOURCES,
                            ).includes(
                                sourceName,
                            ),
                    ),

                primary:
                    toEnum(
                        source.identification
                            ?.primary ||
                        env(
                            'TENANT_ID_PRIMARY_SOURCE',
                        ),
                        Object.values(
                            TENANT_ID_SOURCES,
                        ),
                        DEFAULTS
                            .identification
                            .primary,
                    ),

                header:
                    asString(
                        source.identification
                            ?.header ||
                        env(
                            'TENANT_ID_HEADER',
                        ),
                        DEFAULTS
                            .identification
                            .header,
                    ),

                pathParameter:
                    asString(
                        source.identification
                            ?.pathParameter ||
                        env(
                            'TENANT_ID_PATH_PARAMETER',
                        ),
                        DEFAULTS
                            .identification
                            .pathParameter,
                    ),

                subdomainPattern:
                    DEFAULTS
                        .identification
                        .subdomainPattern,

                allowHeaderOverride:
                    source.identification
                        ?.allowHeaderOverride ??
                    asBoolean(
                        env(
                            'TENANT_ALLOW_HEADER_OVERRIDE',
                        ),
                        DEFAULTS
                            .identification
                            .allowHeaderOverride,
                    ),

                allowQueryParameter:
                    source.identification
                        ?.allowQueryParameter ??
                    asBoolean(
                        env(
                            'TENANT_ALLOW_QUERY_PARAMETER',
                        ),
                        DEFAULTS
                            .identification
                            .allowQueryParameter,
                    ),

                queryParameter:
                    asString(
                        source.identification
                            ?.queryParameter ||
                        env(
                            'TENANT_QUERY_PARAMETER',
                        ),
                        DEFAULTS
                            .identification
                            .queryParameter,
                    ),

                normalize:
                    source.identification
                        ?.normalize ??
                    true,

                maxLength:
                    asPositiveInteger(
                        source.identification
                            ?.maxLength ||
                        env(
                            'TENANT_ID_MAX_LENGTH',
                        ),
                        DEFAULTS
                            .identification
                            .maxLength,
                    ),
            },

        identifiers:
            {
                prefix:
                    asString(
                        source.identifiers
                            ?.prefix ||
                        env(
                            'TENANT_ID_PREFIX',
                        ),
                        DEFAULTS
                            .identifiers
                            .prefix,
                    ),

                minLength:
                    asPositiveInteger(
                        source.identifiers
                            ?.minLength ||
                        env(
                            'TENANT_ID_MIN_LENGTH',
                        ),
                        DEFAULTS
                            .identifiers
                            .minLength,
                    ),

                maxLength:
                    asPositiveInteger(
                        source.identifiers
                            ?.maxLength ||
                        env(
                            'TENANT_ID_MAX_LENGTH',
                        ),
                        DEFAULTS
                            .identifiers
                            .maxLength,
                    ),

                allowNumericOnly:
                    source.identifiers
                        ?.allowNumericOnly ??
                    false,

                allowReservedNames:
                    source.identifiers
                        ?.allowReservedNames ??
                    false,
            },

        states:
            {
                active:
                    [
                        ...DEFAULTS
                            .states
                            .active,
                    ],

                readable:
                    [
                        ...DEFAULTS
                            .states
                            .readable,
                    ],

                writable:
                    [
                        ...DEFAULTS
                            .states
                            .writable,
                    ],

                blocked:
                    [
                        ...DEFAULTS
                            .states
                            .blocked,
                    ],
            },

        systemTenant:
            {
                enabled:
                    source.systemTenant
                        ?.enabled ??
                    true,

                id:
                    asString(
                        source.systemTenant
                            ?.id ||
                        env(
                            'SYSTEM_TENANT_ID',
                        ),
                        DEFAULTS
                            .systemTenant
                            .id,
                    ),

                type:
                    TENANT_TYPES.PLATFORM,

                allowCrossTenantOperations:
                    source.systemTenant
                        ?.allowCrossTenantOperations ??
                    false,

                requireExplicitPrivilege:
                    source.systemTenant
                        ?.requireExplicitPrivilege ??
                    true,

                allowFinancialOperations:
                    source.systemTenant
                        ?.allowFinancialOperations ??
                    false,
            },

        quotas:
            {
                maxUsers:
                    asPositiveInteger(
                        source.quotas
                            ?.maxUsers ||
                        env(
                            'TENANT_MAX_USERS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxUsers,
                    ),

                maxGroups:
                    asPositiveInteger(
                        source.quotas
                            ?.maxGroups ||
                        env(
                            'TENANT_MAX_GROUPS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxGroups,
                    ),

                maxLoans:
                    asPositiveInteger(
                        source.quotas
                            ?.maxLoans ||
                        env(
                            'TENANT_MAX_LOANS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxLoans,
                    ),

                maxContributions:
                    asPositiveInteger(
                        source.quotas
                            ?.maxContributions ||
                        env(
                            'TENANT_MAX_CONTRIBUTIONS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxContributions,
                    ),

                maxApiRequestsPerMinute:
                    asPositiveInteger(
                        source.quotas
                            ?.maxApiRequestsPerMinute ||
                        env(
                            'TENANT_MAX_API_REQUESTS_PER_MINUTE',
                        ),
                        DEFAULTS
                            .quotas
                            .maxApiRequestsPerMinute,
                    ),

                maxConcurrentRequests:
                    asPositiveInteger(
                        source.quotas
                            ?.maxConcurrentRequests ||
                        env(
                            'TENANT_MAX_CONCURRENT_REQUESTS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxConcurrentRequests,
                    ),

                maxStorageBytes:
                    asPositiveInteger(
                        source.quotas
                            ?.maxStorageBytes ||
                        env(
                            'TENANT_MAX_STORAGE_BYTES',
                        ),
                        DEFAULTS
                            .quotas
                            .maxStorageBytes,
                    ),

                maxMonthlyStorageGrowthBytes:
                    asPositiveInteger(
                        source.quotas
                            ?.maxMonthlyStorageGrowthBytes ||
                        env(
                            'TENANT_MAX_MONTHLY_STORAGE_GROWTH_BYTES',
                        ),
                        DEFAULTS
                            .quotas
                            .maxMonthlyStorageGrowthBytes,
                    ),

                maxQueueJobsPerMinute:
                    asPositiveInteger(
                        source.quotas
                            ?.maxQueueJobsPerMinute ||
                        env(
                            'TENANT_MAX_QUEUE_JOBS_PER_MINUTE',
                        ),
                        DEFAULTS
                            .quotas
                            .maxQueueJobsPerMinute,
                    ),

                maxEmailJobsPerMinute:
                    asPositiveInteger(
                        source.quotas
                            ?.maxEmailJobsPerMinute ||
                        env(
                            'TENANT_MAX_EMAIL_JOBS_PER_MINUTE',
                        ),
                        DEFAULTS
                            .quotas
                            .maxEmailJobsPerMinute,
                    ),

                maxSmsJobsPerMinute:
                    asPositiveInteger(
                        source.quotas
                            ?.maxSmsJobsPerMinute ||
                        env(
                            'TENANT_MAX_SMS_JOBS_PER_MINUTE',
                        ),
                        DEFAULTS
                            .quotas
                            .maxSmsJobsPerMinute,
                    ),

                maxWebsocketConnections:
                    asPositiveInteger(
                        source.quotas
                            ?.maxWebsocketConnections ||
                        env(
                            'TENANT_MAX_WEBSOCKET_CONNECTIONS',
                        ),
                        DEFAULTS
                            .quotas
                            .maxWebsocketConnections,
                    ),
            },

        rateLimit:
            {
                enabled:
                    source.rateLimit
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_RATE_LIMIT_ENABLED',
                        ),
                        DEFAULTS
                            .rateLimit
                            .enabled,
                    ),

                strategy:
                    asString(
                        source.rateLimit
                            ?.strategy,
                        DEFAULTS
                            .rateLimit
                            .strategy,
                    ),

                windowMs:
                    asPositiveInteger(
                        source.rateLimit
                            ?.windowMs ||
                        env(
                            'TENANT_RATE_LIMIT_WINDOW_MS',
                        ),
                        DEFAULTS
                            .rateLimit
                            .windowMs,
                    ),

                requestsPerWindow:
                    asPositiveInteger(
                        source.rateLimit
                            ?.requestsPerWindow ||
                        env(
                            'TENANT_RATE_LIMIT_REQUESTS',
                        ),
                        DEFAULTS
                            .rateLimit
                            .requestsPerWindow,
                    ),

                burst:
                    asPositiveInteger(
                        source.rateLimit
                            ?.burst ||
                        env(
                            'TENANT_RATE_LIMIT_BURST',
                        ),
                        DEFAULTS
                            .rateLimit
                            .burst,
                    ),

                failureMode:
                    TENANT_FAILURE_MODES.FAIL_CLOSED,

                trustProxy:
                    source.rateLimit
                        ?.trustProxy ??
                    false,
            },

        cache:
            {
                enabled:
                    source.cache
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_CACHE_ENABLED',
                        ),
                        DEFAULTS
                            .cache
                            .enabled,
                    ),

                namespace:
                    asString(
                        source.cache
                            ?.namespace,
                        DEFAULTS
                            .cache
                            .namespace,
                    ),

                includeTenantId:
                    source.cache
                        ?.includeTenantId ??
                    true,

                requireTenantPrefix:
                    source.cache
                        ?.requireTenantPrefix ??
                    true,

                preventCrossTenantCacheReads:
                    source.cache
                        ?.preventCrossTenantCacheReads ??
                    true,

                preventCrossTenantCacheWrites:
                    source.cache
                        ?.preventCrossTenantCacheWrites ??
                    true,

                defaultTtlSeconds:
                    asPositiveInteger(
                        source.cache
                            ?.defaultTtlSeconds,
                        DEFAULTS
                            .cache
                            .defaultTtlSeconds,
                    ),

                maxTtlSeconds:
                    asPositiveInteger(
                        source.cache
                            ?.maxTtlSeconds,
                        DEFAULTS
                            .cache
                            .maxTtlSeconds,
                    ),
            },

        queue:
            {
                enabled:
                    source.queue
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_QUEUE_ENABLED',
                        ),
                        DEFAULTS
                            .queue
                            .enabled,
                    ),

                includeTenantId:
                    source.queue
                        ?.includeTenantId ??
                    true,

                requireTenantJobId:
                    source.queue
                        ?.requireTenantJobId ??
                    true,

                namespace:
                    asString(
                        source.queue
                            ?.namespace,
                        DEFAULTS
                            .queue
                            .namespace,
                    ),

                preventCrossTenantJobAccess:
                    source.queue
                        ?.preventCrossTenantJobAccess ??
                    true,

                allowPlatformQueueAccess:
                    source.queue
                        ?.allowPlatformQueueAccess ??
                    false,
            },

        storage:
            {
                enabled:
                    source.storage
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_STORAGE_ENABLED',
                        ),
                        DEFAULTS
                            .storage
                            .enabled,
                    ),

                namespace:
                    asString(
                        source.storage
                            ?.namespace,
                        DEFAULTS
                            .storage
                            .namespace,
                    ),

                includeTenantId:
                    source.storage
                        ?.includeTenantId ??
                    true,

                requireTenantPrefix:
                    source.storage
                        ?.requireTenantPrefix ??
                    true,

                preventCrossTenantObjectAccess:
                    source.storage
                        ?.preventCrossTenantObjectAccess ??
                    true,

                privateByDefault:
                    source.storage
                        ?.privateByDefault ??
                    true,
            },

        database:
            {
                enabled:
                    source.database
                        ?.enabled ??
                    true,

                requireTenantScope:
                    source.database
                        ?.requireTenantScope ??
                    asBoolean(
                        env(
                            'TENANT_DATABASE_SCOPE_REQUIRED',
                        ),
                        DEFAULTS
                            .database
                            .requireTenantScope,
                    ),

                injectTenantFilter:
                    source.database
                        ?.injectTenantFilter ??
                    false,

                allowUnscopedReads:
                    source.database
                        ?.allowUnscopedReads ??
                    asBoolean(
                        env(
                            'TENANT_DATABASE_UNSCOPED_READS',
                        ),
                        DEFAULTS
                            .database
                            .allowUnscopedReads,
                    ),

                allowUnscopedWrites:
                    source.database
                        ?.allowUnscopedWrites ??
                    asBoolean(
                        env(
                            'TENANT_DATABASE_UNSCOPED_WRITES',
                        ),
                        DEFAULTS
                            .database
                            .allowUnscopedWrites,
                    ),

                allowCrossTenantQueries:
                    source.database
                        ?.allowCrossTenantQueries ??
                    false,

                tenantField:
                    asString(
                        source.database
                            ?.tenantField,
                        DEFAULTS
                            .database
                            .tenantField,
                    ),

                organizationField:
                    asString(
                        source.database
                            ?.organizationField,
                        DEFAULTS
                            .database
                            .organizationField,
                    ),
            },

        financial:
            {
                enabled:
                    source.financial
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_FINANCIAL_ENABLED',
                        ),
                        DEFAULTS
                            .financial
                            .enabled,
                    ),

                requireTenantContext:
                    source.financial
                        ?.requireTenantContext ??
                    true,

                requireTenantAuthorization:
                    source.financial
                        ?.requireTenantAuthorization ??
                    true,

                preventCrossTenantTransactions:
                    source.financial
                        ?.preventCrossTenantTransactions ??
                    asBoolean(
                        env(
                            'TENANT_FINANCIAL_CROSS_TENANT_FORBIDDEN',
                        ),
                        DEFAULTS
                            .financial
                            .preventCrossTenantTransactions,
                    ),

                preventCrossTenantLedgerAccess:
                    source.financial
                        ?.preventCrossTenantLedgerAccess ??
                    true,

                preventCrossTenantBalanceAccess:
                    source.financial
                        ?.preventCrossTenantBalanceAccess ??
                    true,

                preventCrossTenantIdempotency:
                    source.financial
                        ?.preventCrossTenantIdempotency ??
                    true,

                preventCrossTenantLocks:
                    source.financial
                        ?.preventCrossTenantLocks ??
                    true,

                requireTenantInAuditMetadata:
                    source.financial
                        ?.requireTenantInAuditMetadata ??
                    true,

                allowPlatformFinancialOperations:
                    source.financial
                        ?.allowPlatformFinancialOperations ??
                    asBoolean(
                        env(
                            'TENANT_FINANCIAL_PLATFORM_OPERATIONS',
                        ),
                        DEFAULTS
                            .financial
                            .allowPlatformFinancialOperations,
                    ),
            },

        auth:
            {
                requireTenantClaim:
                    source.auth
                        ?.requireTenantClaim ??
                    asBoolean(
                        env(
                            'TENANT_REQUIRE_AUTH_CLAIM',
                        ),
                        DEFAULTS
                            .auth
                            .requireTenantClaim,
                    ),

                claimName:
                    asString(
                        source.auth
                            ?.claimName,
                        DEFAULTS
                            .auth
                            .claimName,
                    ),

                organizationClaimName:
                    asString(
                        source.auth
                            ?.organizationClaimName,
                        DEFAULTS
                            .auth
                            .organizationClaimName,
                    ),

                allowTenantSwitching:
                    source.auth
                        ?.allowTenantSwitching ??
                    asBoolean(
                        env(
                            'TENANT_ALLOW_SWITCHING',
                        ),
                        DEFAULTS
                            .auth
                            .allowTenantSwitching,
                    ),

                tenantSwitchRequiresPrivilege:
                    source.auth
                        ?.tenantSwitchRequiresPrivilege ??
                    true,

                requireMembership:
                    source.auth
                        ?.requireMembership ??
                    true,

                requireActiveMembership:
                    source.auth
                        ?.requireActiveMembership ??
                    true,

                cacheMembership:
                    source.auth
                        ?.cacheMembership ??
                    true,

                membershipCacheTtlSeconds:
                    asPositiveInteger(
                        source.auth
                            ?.membershipCacheTtlSeconds,
                        DEFAULTS
                            .auth
                            .membershipCacheTtlSeconds,
                    ),
            },

        context:
            {
                asyncLocalStorage:
                    source.context
                        ?.asyncLocalStorage ??
                    true,

                headerName:
                    asString(
                        source.context
                            ?.headerName,
                        DEFAULTS
                            .context
                            .headerName,
                    ),

                correlationHeaderName:
                    asString(
                        source.context
                            ?.correlationHeaderName,
                        DEFAULTS
                            .context
                            .correlationHeaderName,
                    ),

                includeTenantInLogs:
                    source.context
                        ?.includeTenantInLogs ??
                    true,

                includeTenantInMetrics:
                    source.context
                        ?.includeTenantInMetrics ??
                    true,

                includeTenantInTraces:
                    source.context
                        ?.includeTenantInTraces ??
                    true,

                includeTenantInJobs:
                    source.context
                        ?.includeTenantInJobs ??
                    true,

                includeTenantInStorage:
                    source.context
                        ?.includeTenantInStorage ??
                    true,
            },

        observability:
            {
                enabled:
                    source.observability
                        ?.enabled ??
                    true,

                metricsEnabled:
                    source.observability
                        ?.metricsEnabled ??
                    asBoolean(
                        env(
                            'TENANT_METRICS_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .metricsEnabled,
                    ),

                logsEnabled:
                    source.observability
                        ?.logsEnabled ??
                    asBoolean(
                        env(
                            'TENANT_LOGS_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .logsEnabled,
                    ),

                tracesEnabled:
                    source.observability
                        ?.tracesEnabled ??
                    asBoolean(
                        env(
                            'TENANT_TRACES_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .tracesEnabled,
                    ),

                includeTenantId:
                    source.observability
                        ?.includeTenantId ??
                    true,

                hashTenantIdentifiers:
                    source.observability
                        ?.hashTenantIdentifiers ??
                    false,

                exposeTenantNames:
                    source.observability
                        ?.exposeTenantNames ??
                    false,

                exposeTenantMetadata:
                    source.observability
                        ?.exposeTenantMetadata ??
                    false,

                highCardinalityTenantLabels:
                    source.observability
                        ?.highCardinalityTenantLabels ??
                    asBoolean(
                        env(
                            'TENANT_HIGH_CARDINALITY_LABELS',
                        ),
                        DEFAULTS
                            .observability
                            .highCardinalityTenantLabels,
                    ),

                slowTenantOperationThresholdMs:
                    asPositiveInteger(
                        source.observability
                            ?.slowTenantOperationThresholdMs,
                        DEFAULTS
                            .observability
                            .slowTenantOperationThresholdMs,
                    ),
            },

        security:
            {
                preventTenantEnumeration:
                    source.security
                        ?.preventTenantEnumeration ??
                    asBoolean(
                        env(
                            'TENANT_PREVENT_ENUMERATION',
                        ),
                        DEFAULTS
                            .security
                            .preventTenantEnumeration,
                    ),

                genericUnauthorizedResponses:
                    source.security
                        ?.genericUnauthorizedResponses ??
                    asBoolean(
                        env(
                            'TENANT_GENERIC_UNAUTHORIZED',
                        ),
                        DEFAULTS
                            .security
                            .genericUnauthorizedResponses,
                    ),

                genericNotFoundResponses:
                    source.security
                        ?.genericNotFoundResponses ??
                    asBoolean(
                        env(
                            'TENANT_GENERIC_NOT_FOUND',
                        ),
                        DEFAULTS
                            .security
                            .genericNotFoundResponses,
                    ),

                rejectMalformedTenantIds:
                    source.security
                        ?.rejectMalformedTenantIds ??
                    true,

                rejectUnknownTenants:
                    source.security
                        ?.rejectUnknownTenants ??
                    true,

                rejectInactiveTenants:
                    source.security
                        ?.rejectInactiveTenants ??
                    true,

                preventTenantIdFromClientPayload:
                    source.security
                        ?.preventTenantIdFromClientPayload ??
                    true,

                ignoreClientProvidedTenantField:
                    source.security
                        ?.ignoreClientProvidedTenantField ??
                    asBoolean(
                        env(
                            'TENANT_CLIENT_PAYLOAD_OVERRIDE',
                        ),
                        DEFAULTS
                            .security
                            .ignoreClientProvidedTenantField,
                    ),

                preventTenantContextMutation:
                    source.security
                        ?.preventTenantContextMutation ??
                    true,

                requireTrustedTenantContext:
                    source.security
                        ?.requireTrustedTenantContext ??
                    true,

                allowCrossTenantAccess:
                    source.security
                        ?.allowCrossTenantAccess ??
                    false,

                allowCrossTenantAdmin:
                    source.security
                        ?.allowCrossTenantAdmin ??
                    false,
            },

        provisioning:
            {
                enabled:
                    source.provisioning
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_PROVISIONING_ENABLED',
                        ),
                        DEFAULTS
                            .provisioning
                            .enabled,
                    ),

                defaultState:
                    source.provisioning
                        ?.defaultState ||
                    DEFAULTS
                        .provisioning
                        .defaultState,

                activationRequiresValidation:
                    source.provisioning
                        ?.activationRequiresValidation ??
                    true,

                requireUniqueSlug:
                    source.provisioning
                        ?.requireUniqueSlug ??
                    true,

                requireUniqueIdentifier:
                    source.provisioning
                        ?.requireUniqueIdentifier ??
                    true,

                rollbackOnFailure:
                    source.provisioning
                        ?.rollbackOnFailure ??
                    true,

                provisioningTimeoutMs:
                    asPositiveInteger(
                        source.provisioning
                            ?.provisioningTimeoutMs ||
                        env(
                            'TENANT_PROVISIONING_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .provisioning
                            .provisioningTimeoutMs,
                    ),
            },

        lifecycle:
            {
                allowSuspension:
                    source.lifecycle
                        ?.allowSuspension ??
                    true,

                allowReadOnlyMode:
                    source.lifecycle
                        ?.allowReadOnlyMode ??
                    true,

                allowDeactivation:
                    source.lifecycle
                        ?.allowDeactivation ??
                    true,

                allowArchival:
                    source.lifecycle
                        ?.allowArchival ??
                    true,

                allowDeletion:
                    source.lifecycle
                        ?.allowDeletion ??
                    asBoolean(
                        env(
                            'TENANT_ALLOW_DELETION',
                        ),
                        DEFAULTS
                            .lifecycle
                            .allowDeletion,
                    ),

                deletionRequiresExplicitApproval:
                    source.lifecycle
                        ?.deletionRequiresExplicitApproval ??
                    true,

                deletionGracePeriodDays:
                    asPositiveInteger(
                        source.lifecycle
                            ?.deletionGracePeriodDays ||
                        env(
                            'TENANT_DELETION_GRACE_PERIOD_DAYS',
                        ),
                        DEFAULTS
                            .lifecycle
                            .deletionGracePeriodDays,
                    ),
            },

        health:
            {
                enabled:
                    source.health
                        ?.enabled ??
                    asBoolean(
                        env(
                            'TENANT_HEALTH_ENABLED',
                        ),
                        DEFAULTS
                            .health
                            .enabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.health
                            ?.timeoutMs ||
                        env(
                            'TENANT_HEALTH_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .health
                            .timeoutMs,
                    ),

                requiredForReadiness:
                    source.health
                        ?.requiredForReadiness ??
                    asBoolean(
                        env(
                            'TENANT_HEALTH_REQUIRED',
                        ),
                        DEFAULTS
                            .health
                            .requiredForReadiness,
                    ),

                verifySystemTenant:
                    source.health
                        ?.verifySystemTenant ??
                    true,

                verifyTenantRegistry:
                    source.health
                        ?.verifyTenantRegistry ??
                    true,
            },

        diagnostics:
            {
                enabled:
                    source.diagnostics
                        ?.enabled ??
                    true,

                exposeTenantNames:
                    source.diagnostics
                        ?.exposeTenantNames ??
                    false,

                exposeTenantMetadata:
                    source.diagnostics
                        ?.exposeTenantMetadata ??
                    false,

                exposeTenantCounts:
                    source.diagnostics
                        ?.exposeTenantCounts ??
                    true,

                exposeTenantIdentifiers:
                    source.diagnostics
                        ?.exposeTenantIdentifiers ??
                    false,

                exposeQuotas:
                    source.diagnostics
                        ?.exposeQuotas ??
                    true,

                exposeConfiguration:
                    source.diagnostics
                        ?.exposeConfiguration ??
                    true,
            },
    };

    return validateTenantConfig(
        config,
    );
}

/**
 * =============================================================================
 * Default immutable configuration
 * =============================================================================
 */

const defaultConfig =
    createTenantConfig();

/**
 * =============================================================================
 * Lifecycle compatibility
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createTenantConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.tenants =
            config;

        context.tenantConfig =
            config;
    }

    return config;
}

async function start(
    context = {},
    options = {},
) {

    return initialize(
        context,
        options,
    );
}

async function bootstrap(
    context = {},
    options = {},
) {

    return start(
        context,
        options,
    );
}

/**
 * =============================================================================
 * Safe diagnostics snapshot
 * =============================================================================
 */

function getSnapshot(
    config =
        defaultConfig,
) {

    return deepFreeze({
        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        application:
            APPLICATION_NAME,

        environment:
            config.environment,

        state:
            config.state,

        enabled:
            config.enabled,

        required:
            config.required,

        isolationMode:
            config.isolationMode,

        requireTenantContext:
            config.requireTenantContext,

        identification:
            {
                primary:
                    config.identification
                        .primary,

                sources:
                    [
                        ...config.identification
                            .sources,
                    ],

                header:
                    config.identification
                        .header,

                allowHeaderOverride:
                    config.identification
                        .allowHeaderOverride,

                allowQueryParameter:
                    config.identification
                        .allowQueryParameter,
            },

        identifiers:
            {
                prefix:
                    config.identifiers
                        .prefix,

                minLength:
                    config.identifiers
                        .minLength,

                maxLength:
                    config.identifiers
                        .maxLength,
            },

        systemTenant:
            {
                enabled:
                    config.systemTenant
                        .enabled,

                id:
                    config.diagnostics
                        .exposeTenantIdentifiers
                        ? config.systemTenant.id
                        : '[HIDDEN]',

                type:
                    config.systemTenant
                        .type,

                allowCrossTenantOperations:
                    config.systemTenant
                        .allowCrossTenantOperations,

                allowFinancialOperations:
                    config.systemTenant
                        .allowFinancialOperations,
            },

        quotas:
            config.diagnostics
                .exposeQuotas
                ? config.quotas
                : {},

        rateLimit:
            config.rateLimit,

        cache:
            config.cache,

        queue:
            config.queue,

        storage:
            config.storage,

        database:
            config.database,

        financial:
            config.financial,

        auth:
            {
                requireTenantClaim:
                    config.auth
                        .requireTenantClaim,

                claimName:
                    config.auth
                        .claimName,

                allowTenantSwitching:
                    config.auth
                        .allowTenantSwitching,

                requireMembership:
                    config.auth
                        .requireMembership,

                requireActiveMembership:
                    config.auth
                        .requireActiveMembership,
            },

        context:
            config.context,

        observability:
            config.observability,

        security:
            {
                preventTenantEnumeration:
                    config.security
                        .preventTenantEnumeration,

                genericUnauthorizedResponses:
                    config.security
                        .genericUnauthorizedResponses,

                genericNotFoundResponses:
                    config.security
                        .genericNotFoundResponses,

                rejectUnknownTenants:
                    config.security
                        .rejectUnknownTenants,

                rejectInactiveTenants:
                    config.security
                        .rejectInactiveTenants,

                allowCrossTenantAccess:
                    config.security
                        .allowCrossTenantAccess,

                allowCrossTenantAdmin:
                    config.security
                        .allowCrossTenantAdmin,
            },

        provisioning:
            config.provisioning,

        lifecycle:
            config.lifecycle,

        health:
            config.health,

        warnings:
            [
                ...(config.warnings || []),
            ],

        timestamp:
            new Date().toISOString(),
    });
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Core configuration.
         */
        config:
            defaultConfig,

        tenants:
            defaultConfig,

        DEFAULTS,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Constants.
         */
        TENANT_STATES,

        TENANT_TYPES,

        TENANT_ID_SOURCES,

        TENANT_ISOLATION_MODES,

        TENANT_FAILURE_MODES,

        TENANT_CONFIG_STATES,

        /**
         * Error.
         */
        TenantConfigError,

        /**
         * Configuration.
         */
        createTenantConfig,

        validateTenantConfig,

        /**
         * Tenant IDs/namespaces.
         */
        normalizeTenantId,

        isValidTenantId,

        generateTenantId,

        tenantNamespace,

        createCacheNamespace,

        createQueueNamespace,

        createStorageNamespace,

        /**
         * Tenant resolution.
         */
        getTenantResolutionPolicy,

        validateTenantContext,

        /**
         * Tenant state/lifecycle.
         */
        canReadTenant,

        canWriteTenant,

        canActivateTenant,

        canSuspendTenant,

        canDeleteTenant,

        /**
         * Authorization/isolation.
         */
        isCrossTenantAccessAllowed,

        getOperationPolicy,

        getFinancialTenantPolicy,

        /**
         * Quotas.
         */
        getQuota,

        isWithinQuota,

        /**
         * Context.
         */
        fingerprintTenantContext,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        /**
         * Bootstrap compatibility.
         */
        initialize,

        start,

        bootstrap,
    });