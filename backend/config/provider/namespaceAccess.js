'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/namespaceAccess.js
 *
 * Purpose:
 *   Enterprise production-grade namespace access policy and isolation provider.
 *
 * Responsibilities:
 *   - Define canonical TITech namespace construction.
 *   - Enforce namespace ownership boundaries.
 *   - Support tenant, organization, system and service namespaces.
 *   - Provide deterministic cache/queue/storage/database namespace helpers.
 *   - Prevent accidental cross-tenant namespace access.
 *   - Validate namespace formats.
 *   - Support financial/idempotency/audit namespace separation.
 *   - Provide safe namespace fingerprints.
 *   - Provide authorization-aware access decisions.
 *   - Support bootstrap/configuration lifecycle integration.
 *   - Provide operational diagnostics without exposing secrets.
 *
 * IMPORTANT:
 *
 *   This module defines NAMESPACE POLICY.
 *
 *   It does NOT:
 *     - authenticate users.
 *     - authorize business roles.
 *     - create Redis clients.
 *     - create database clients.
 *     - execute financial transactions.
 *     - write audit records.
 *     - create queues.
 *     - create storage clients.
 *
 * Runtime consumers remain responsible for enforcing the decision returned by
 * this policy provider.
 *
 * =============================================================================
 *
 * Canonical namespace model:
 *
 *   platform
 *      │
 *      ├── system
 *      │
 *      ├── organization
 *      │      │
 *      │      └── tenant
 *      │
 *      └── service
 *
 * Tenant-scoped examples:
 *
 *   tenant:<tenantId>
 *   tenant:<tenantId>:cache
 *   tenant:<tenantId>:queue
 *   tenant:<tenantId>:storage
 *   tenant:<tenantId>:idempotency
 *   tenant:<tenantId>:audit
 *   tenant:<tenantId>:ledger
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

let configurationProviderModule = null;

try {
    // eslint-disable-next-line global-require
    configurationProviderModule =
        require('./ConfigurationProvider');
} catch {
    configurationProviderModule = null;
}

/**
 * =============================================================================
 * Optional tenant configuration
 * =============================================================================
 */

let tenantConfigModule = null;

try {
    // eslint-disable-next-line global-require
    tenantConfigModule =
        require('../tenants');
} catch {
    tenantConfigModule = null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'namespace-access';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const NAMESPACE_TYPES =
    Object.freeze({
        PLATFORM:
            'platform',

        SYSTEM:
            'system',

        ORGANIZATION:
            'organization',

        TENANT:
            'tenant',

        USER:
            'user',

        SERVICE:
            'service',

        REQUEST:
            'request',

        CACHE:
            'cache',

        QUEUE:
            'queue',

        STORAGE:
            'storage',

        DATABASE:
            'database',

        IDEMPOTENCY:
            'idempotency',

        AUDIT:
            'audit',

        LEDGER:
            'ledger',

        BALANCE:
            'balance',

        LOCK:
            'lock',

        SESSION:
            'session',

        REALTIME:
            'realtime',
    });

const ACCESS_MODES =
    Object.freeze({
        READ:
            'read',

        WRITE:
            'write',

        DELETE:
            'delete',

        ADMIN:
            'admin',

        CROSS_TENANT:
            'cross_tenant',
    });

const ACCESS_RESULTS =
    Object.freeze({
        ALLOW:
            'allow',

        DENY:
            'deny',

        ERROR:
            'error',
    });

const NAMESPACE_STATES =
    Object.freeze({
        VALID:
            'valid',

        INVALID:
            'invalid',

        SYSTEM:
            'system',

        TENANT:
            'tenant',

        ORGANIZATION:
            'organization',
    });

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        strict:
            true,

        normalize:
            true,

        lowercase:
            true,

        maxLength:
            255,

        delimiter:
            ':',

        tenantPrefix:
            'tenant',

        organizationPrefix:
            'org',

        systemPrefix:
            'system',

        servicePrefix:
            'service',

        userPrefix:
            'user',

        requestPrefix:
            'request',

        platformPrefix:
            'platform',

        preventCrossTenantAccess:
            true,

        preventCrossOrganizationAccess:
            true,

        requireTenantContext:
            true,

        requireOrganizationContext:
            false,

        allowSystemContext:
            true,

        allowPlatformContext:
            true,

        allowServiceContext:
            true,

        allowUserContext:
            true,

        allowCrossTenantAdmin:
            false,

        allowCrossOrganizationAdmin:
            false,

        /**
         * Financial namespaces are stricter than generic application namespaces.
         */
        financial:
            {
                enabled:
                    true,

                preventCrossTenant:
                    true,

                requireTenantContext:
                    true,

                requireTenantMatch:
                    true,

                idempotencyTenantScoped:
                    true,

                auditTenantScoped:
                    true,

                ledgerTenantScoped:
                    true,

                balanceTenantScoped:
                    true,

                lockTenantScoped:
                    true,
            },

        cache:
            {
                enabled:
                    true,

                isolated:
                    true,

                prefix:
                    'cache',
            },

        queue:
            {
                enabled:
                    true,

                isolated:
                    true,

                prefix:
                    'queue',
            },

        storage:
            {
                enabled:
                    true,

                isolated:
                    true,

                prefix:
                    'storage',
            },

        database:
            {
                enabled:
                    true,

                isolated:
                    true,

                tenantField:
                    'tenantId',

                organizationField:
                    'organizationId',
            },

        observability:
            {
                enabled:
                    true,

                includeTenant:
                    true,

                includeOrganization:
                    true,

                hashTenant:
                    false,

                hashOrganization:
                    false,
            },

        diagnostics:
            {
                enabled:
                    true,

                exposeRawNamespaces:
                    false,

                exposeTenantIds:
                    false,

                exposeOrganizationIds:
                    false,

                maxEvents:
                    100,
            },
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class NamespaceAccessError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'NamespaceAccessError';

        this.code =
            options.code ||
            'NAMESPACE_ACCESS_ERROR';

        this.mode =
            options.mode ||
            null;

        this.namespace =
            options.namespace ||
            null;

        this.tenantId =
            options.tenantId ||
            null;

        this.organizationId =
            options.organizationId ||
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
            NamespaceAccessError,
        );
    }
}

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

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

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return value;
    }

    seen.add(
        value,
    );

    for (
        const key of
        Reflect.ownKeys(
            value,
        )
    ) {

        try {
            deepFreeze(
                value[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            value,
        );
    } catch {
        // Best effort.
    }

    return value;
}

function getProvider() {

    if (
        !configurationProviderModule
    ) {

        return null;
    }

    return (
        configurationProviderModule.provider ||
        configurationProviderModule
    );
}

function getConfig(
    path,
    fallback,
) {

    const provider =
        getProvider();

    try {

        if (
            typeof provider?.get ===
            'function'
        ) {

            return provider.get(
                path,
                fallback,
            );
        }

    } catch {
        // Fall through.
    }

    return fallback;
}

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;
    }
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Namespace policy must not fail because logging failed.
    }
}

function normalizeSegment(
    value,
    {
        required = true,
        lowercase =
            DEFAULTS.lowercase,
        maxLength =
            DEFAULTS.maxLength,
    } = {},
) {

    if (
        value === undefined ||
        value === null
    ) {

        if (
            required
        ) {

            throw new NamespaceAccessError(
                'Namespace segment is required.',
                {
                    code:
                        'NAMESPACE_SEGMENT_REQUIRED',
                },
            );
        }

        return null;
    }

    let normalized =
        String(
            value,
        ).trim();

    if (
        !normalized
    ) {

        if (
            required
        ) {

            throw new NamespaceAccessError(
                'Namespace segment cannot be empty.',
                {
                    code:
                        'NAMESPACE_SEGMENT_EMPTY',
                },
            );
        }

        return null;
    }

    if (
        lowercase
    ) {

        normalized =
            normalized.toLowerCase();
    }

    if (
        normalized.length >
        maxLength
    ) {

        throw new NamespaceAccessError(
            'Namespace segment exceeds maximum length.',
            {
                code:
                    'NAMESPACE_SEGMENT_TOO_LONG',

                details: {
                    maxLength,
                },
            },
        );
    }

    /**
     * Restrict namespace components to a safe filesystem/cache/queue-friendly
     * character set.
     */
    normalized =
        normalized.replace(
            /[^a-zA-Z0-9._-]/g,
            '_',
        );

    if (
        !normalized
    ) {

        throw new NamespaceAccessError(
            'Namespace segment contains no usable characters.',
            {
                code:
                    'NAMESPACE_SEGMENT_INVALID',
            },
        );
    }

    return normalized;
}

function normalizeTenantId(
    tenantId,
) {

    if (
        tenantConfigModule?.normalizeTenantId
    ) {

        try {

            return tenantConfigModule.normalizeTenantId(
                tenantId,
            );

        } catch {
            // Fall through.
        }
    }

    return normalizeSegment(
        tenantId,
    );
}

function isValidTenantId(
    tenantId,
) {

    if (
        tenantConfigModule?.isValidTenantId
    ) {

        try {

            return tenantConfigModule.isValidTenantId(
                tenantId,
            );

        } catch {
            return false;
        }
    }

    try {

        normalizeTenantId(
            tenantId,
        );

        return true;

    } catch {
        return false;
    }
}

function normalizeOrganizationId(
    organizationId,
) {

    return normalizeSegment(
        organizationId,
    );
}

function isSameIdentity(
    left,
    right,
) {

    if (
        left === undefined ||
        left === null ||
        right === undefined ||
        right === null
    ) {

        return false;
    }

    return (
        String(
            left,
        ).trim().toLowerCase() ===
        String(
            right,
        ).trim().toLowerCase()
    );
}

function stableFingerprint(
    value,
    algorithm =
        'sha256',
) {

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            String(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function buildNamespace(
    segments,
    delimiter =
        DEFAULTS.delimiter,
) {

    const values =
        segments.filter(
            value =>
                value !== undefined &&
                value !== null &&
                String(
                    value,
                ).length > 0,
        );

    if (
        values.length === 0
    ) {

        throw new NamespaceAccessError(
            'Cannot build an empty namespace.',
            {
                code:
                    'NAMESPACE_EMPTY',
            },
        );
    }

    return values.join(
        delimiter,
    );
}

/**
 * =============================================================================
 * NamespaceAccessProvider
 * =============================================================================
 */

class NamespaceAccessProvider {

    constructor(
        options = {},
    ) {

        const configured =
            getConfig(
                'namespaceAccess',
                {},
            );

        const source = {
            ...configured,
            ...options,
        };

        this.options =
            deepFreeze({
                ...DEFAULTS,

                enabled:
                    source.enabled ??
                    asBoolean(
                        process.env.NAMESPACE_ACCESS_ENABLED,
                        DEFAULTS.enabled,
                    ),

                strict:
                    source.strict ??
                    DEFAULTS.strict,

                normalize:
                    source.normalize ??
                    DEFAULTS.normalize,

                lowercase:
                    source.lowercase ??
                    DEFAULTS.lowercase,

                maxLength:
                    asPositiveInteger(
                        source.maxLength,
                        DEFAULTS.maxLength,
                    ),

                delimiter:
                    source.delimiter ||
                    DEFAULTS.delimiter,

                tenantPrefix:
                    source.tenantPrefix ||
                    DEFAULTS.tenantPrefix,

                organizationPrefix:
                    source.organizationPrefix ||
                    DEFAULTS.organizationPrefix,

                systemPrefix:
                    source.systemPrefix ||
                    DEFAULTS.systemPrefix,

                servicePrefix:
                    source.servicePrefix ||
                    DEFAULTS.servicePrefix,

                userPrefix:
                    source.userPrefix ||
                    DEFAULTS.userPrefix,

                requestPrefix:
                    source.requestPrefix ||
                    DEFAULTS.requestPrefix,

                platformPrefix:
                    source.platformPrefix ||
                    DEFAULTS.platformPrefix,

                preventCrossTenantAccess:
                    source.preventCrossTenantAccess ??
                    DEFAULTS.preventCrossTenantAccess,

                preventCrossOrganizationAccess:
                    source.preventCrossOrganizationAccess ??
                    DEFAULTS.preventCrossOrganizationAccess,

                requireTenantContext:
                    source.requireTenantContext ??
                    DEFAULTS.requireTenantContext,

                requireOrganizationContext:
                    source.requireOrganizationContext ??
                    DEFAULTS.requireOrganizationContext,

                allowSystemContext:
                    source.allowSystemContext ??
                    DEFAULTS.allowSystemContext,

                allowPlatformContext:
                    source.allowPlatformContext ??
                    DEFAULTS.allowPlatformContext,

                allowServiceContext:
                    source.allowServiceContext ??
                    DEFAULTS.allowServiceContext,

                allowUserContext:
                    source.allowUserContext ??
                    DEFAULTS.allowUserContext,

                allowCrossTenantAdmin:
                    source.allowCrossTenantAdmin ??
                    DEFAULTS.allowCrossTenantAdmin,

                allowCrossOrganizationAdmin:
                    source.allowCrossOrganizationAdmin ??
                    DEFAULTS.allowCrossOrganizationAdmin,

                financial:
                    {
                        ...DEFAULTS.financial,
                        ...(source.financial || {}),
                    },

                cache:
                    {
                        ...DEFAULTS.cache,
                        ...(source.cache || {}),
                    },

                queue:
                    {
                        ...DEFAULTS.queue,
                        ...(source.queue || {}),
                    },

                storage:
                    {
                        ...DEFAULTS.storage,
                        ...(source.storage || {}),
                    },

                database:
                    {
                        ...DEFAULTS.database,
                        ...(source.database || {}),
                    },

                observability:
                    {
                        ...DEFAULTS.observability,
                        ...(source.observability || {}),
                    },

                diagnostics:
                    {
                        ...DEFAULTS.diagnostics,
                        ...(source.diagnostics || {}),
                    },
            });

        this.state =
            NAMESPACE_STATES.VALID;

        this.events =
            [];

        this.lastDecision =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant namespace
     * -------------------------------------------------------------------------
     */

    tenant(
        tenantId,
        scope = null,
    ) {

        const normalized =
            normalizeTenantId(
                tenantId,
            );

        if (
            !isValidTenantId(
                normalized,
            )
        ) {

            throw new NamespaceAccessError(
                'Invalid TITech tenant identifier.',
                {
                    code:
                        'TENANT_IDENTIFIER_INVALID',

                    tenantId,
                },
            );
        }

        const segments = [
            this.options.tenantPrefix,
            normalized,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                    {
                        maxLength:
                            this.options.maxLength,
                    },
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Organization namespace
     * -------------------------------------------------------------------------
     */

    organization(
        organizationId,
        scope = null,
    ) {

        const normalized =
            normalizeOrganizationId(
                organizationId,
            );

        const segments = [
            this.options
                .organizationPrefix,
            normalized,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                    {
                        maxLength:
                            this.options.maxLength,
                    },
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * System namespace
     * -------------------------------------------------------------------------
     */

    system(
        scope = null,
    ) {

        const segments = [
            this.options
                .systemPrefix,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Platform namespace
     * -------------------------------------------------------------------------
     */

    platform(
        scope = null,
    ) {

        const segments = [
            this.options
                .platformPrefix,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Service namespace
     * -------------------------------------------------------------------------
     */

    service(
        serviceName,
        scope = null,
    ) {

        const service =
            normalizeSegment(
                serviceName,
            );

        const segments = [
            this.options
                .servicePrefix,
            service,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * User namespace.
     * -------------------------------------------------------------------------
     */

    user(
        userId,
        scope = null,
    ) {

        if (
            !this.options
                .allowUserContext
        ) {

            throw new NamespaceAccessError(
                'TITech user namespaces are disabled.',
                {
                    code:
                        'USER_NAMESPACE_DISABLED',
                },
            );
        }

        const user =
            normalizeSegment(
                userId,
            );

        const segments = [
            this.options
                .userPrefix,
            user,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Request namespace.
     * -------------------------------------------------------------------------
     */

    request(
        requestId,
        scope = null,
    ) {

        const request =
            normalizeSegment(
                requestId,
            );

        const segments = [
            this.options
                .requestPrefix,
            request,
        ];

        if (
            scope
        ) {

            segments.push(
                normalizeSegment(
                    scope,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Generic tenant resource namespace.
     * -------------------------------------------------------------------------
     */

    tenantResource(
        tenantId,
        resource,
        identifier = null,
    ) {

        const normalizedTenant =
            normalizeTenantId(
                tenantId,
            );

        const normalizedResource =
            normalizeSegment(
                resource,
            );

        const segments = [
            this.options.tenantPrefix,
            normalizedTenant,
            normalizedResource,
        ];

        if (
            identifier !==
            null &&
            identifier !==
            undefined
        ) {

            segments.push(
                normalizeSegment(
                    identifier,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Cache namespace.
     * -------------------------------------------------------------------------
     */

    cache(
        tenantId,
        resource,
        identifier = null,
    ) {

        if (
            !this.options.cache.enabled
        ) {

            throw new NamespaceAccessError(
                'TITech tenant cache namespaces are disabled.',
                {
                    code:
                        'TENANT_CACHE_NAMESPACE_DISABLED',
                },
            );
        }

        const tenant =
            normalizeTenantId(
                tenantId,
            );

        const segments = [
            this.options
                .cache
                .prefix,

            this.options
                .tenantPrefix,

            tenant,

            normalizeSegment(
                resource,
            ),
        ];

        if (
            identifier !==
            null &&
            identifier !==
            undefined
        ) {

            segments.push(
                normalizeSegment(
                    identifier,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Queue namespace.
     * -------------------------------------------------------------------------
     */

    queue(
        tenantId,
        queueName,
        identifier = null,
    ) {

        if (
            !this.options.queue.enabled
        ) {

            throw new NamespaceAccessError(
                'TITech tenant queue namespaces are disabled.',
                {
                    code:
                        'TENANT_QUEUE_NAMESPACE_DISABLED',
                },
            );
        }

        const tenant =
            normalizeTenantId(
                tenantId,
            );

        const segments = [
            this.options
                .queue
                .prefix,

            this.options
                .tenantPrefix,

            tenant,

            normalizeSegment(
                queueName,
            ),
        ];

        if (
            identifier !==
            null &&
            identifier !==
            undefined
        ) {

            segments.push(
                normalizeSegment(
                    identifier,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Storage namespace.
     * -------------------------------------------------------------------------
     */

    storage(
        tenantId,
        objectPath,
    ) {

        if (
            !this.options.storage.enabled
        ) {

            throw new NamespaceAccessError(
                'TITech tenant storage namespaces are disabled.',
                {
                    code:
                        'TENANT_STORAGE_NAMESPACE_DISABLED',
                },
            );
        }

        const tenant =
            normalizeTenantId(
                tenantId,
            );

        const normalizedPath =
            String(
                objectPath ||
                '',
            )
                .split('/')
                .map(
                    segment =>
                        normalizeSegment(
                            segment,
                        ),
                )
                .join('/');

        if (
            !normalizedPath
        ) {

            throw new NamespaceAccessError(
                'Tenant storage object path is required.',
                {
                    code:
                        'TENANT_STORAGE_PATH_REQUIRED',
                },
            );
        }

        return [
            this.options.storage.prefix,
            this.options.tenantPrefix,
            tenant,
            normalizedPath,
        ].join('/');
    }

    /**
     * -------------------------------------------------------------------------
     * Database namespace.
     * -------------------------------------------------------------------------
     */

    database(
        tenantId,
        collection,
    ) {

        if (
            !this.options.database.enabled
        ) {

            throw new NamespaceAccessError(
                'TITech tenant database namespaces are disabled.',
                {
                    code:
                        'TENANT_DATABASE_NAMESPACE_DISABLED',
                },
            );
        }

        const tenant =
            normalizeTenantId(
                tenantId,
            );

        return buildNamespace(
            [
                this.options
                    .tenantPrefix,

                tenant,

                this.options
                    .database
                    .tenantField,

                normalizeSegment(
                    collection,
                ),
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Financial namespace.
     * -------------------------------------------------------------------------
     */

    financial(
        tenantId,
        resource,
        identifier = null,
    ) {

        if (
            !this.options.financial.enabled
        ) {

            throw new NamespaceAccessError(
                'TITech financial namespaces are disabled.',
                {
                    code:
                        'FINANCIAL_NAMESPACE_DISABLED',
                },
            );
        }

        if (
            this.options.financial
                .requireTenantContext &&
            !tenantId
        ) {

            throw new NamespaceAccessError(
                'Tenant context is mandatory for TITech financial namespaces.',
                {
                    code:
                        'FINANCIAL_TENANT_CONTEXT_REQUIRED',
                },
            );
        }

        const tenant =
            normalizeTenantId(
                tenantId,
            );

        const normalizedResource =
            normalizeSegment(
                resource,
            );

        const allowedFinancialResources =
            new Set([
                'payment',
                'payments',
                'transaction',
                'transactions',
                'ledger',
                'balance',
                'balances',
                'idempotency',
                'lock',
                'locks',
                'audit',
                'reconciliation',
            ]);

        if (
            this.options.strict &&
            !allowedFinancialResources.has(
                normalizedResource,
            )
        ) {

            throw new NamespaceAccessError(
                `Unsupported TITech financial namespace resource "${normalizedResource}".`,
                {
                    code:
                        'FINANCIAL_NAMESPACE_RESOURCE_INVALID',
                },
            );
        }

        const segments = [
            'financial',
            this.options
                .tenantPrefix,
            tenant,
            normalizedResource,
        ];

        if (
            identifier !==
            null &&
            identifier !==
            undefined
        ) {

            segments.push(
                normalizeSegment(
                    identifier,
                ),
            );
        }

        return buildNamespace(
            segments,
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Idempotency namespace.
     * -------------------------------------------------------------------------
     */

    idempotency(
        tenantId,
        key,
    ) {

        if (
            this.options.financial
                .idempotencyTenantScoped
        ) {

            return this.financial(
                tenantId,
                'idempotency',
                key,
            );
        }

        return buildNamespace(
            [
                'idempotency',
                normalizeSegment(
                    key,
                ),
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Audit namespace.
     * -------------------------------------------------------------------------
     */

    audit(
        tenantId,
        scope = 'event',
        identifier = null,
    ) {

        if (
            this.options.financial
                .auditTenantScoped
        ) {

            return this.financial(
                tenantId,
                'audit',
                identifier
                    ? `${scope}${this.options.delimiter}${identifier}`
                    : scope,
            );
        }

        return buildNamespace(
            [
                'audit',
                normalizeSegment(
                    scope,
                ),
                identifier !==
                    null &&
                identifier !==
                    undefined
                    ? normalizeSegment(
                        identifier,
                    )
                    : null,
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Ledger namespace.
     * -------------------------------------------------------------------------
     */

    ledger(
        tenantId,
        accountId = null,
    ) {

        if (
            this.options.financial
                .ledgerTenantScoped
        ) {

            return this.financial(
                tenantId,
                'ledger',
                accountId,
            );
        }

        return buildNamespace(
            [
                'ledger',
                accountId
                    ? normalizeSegment(
                        accountId,
                    )
                    : null,
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Balance namespace.
     * -------------------------------------------------------------------------
     */

    balance(
        tenantId,
        accountId = null,
    ) {

        if (
            this.options.financial
                .balanceTenantScoped
        ) {

            return this.financial(
                tenantId,
                'balance',
                accountId,
            );
        }

        return buildNamespace(
            [
                'balance',
                accountId
                    ? normalizeSegment(
                        accountId,
                    )
                    : null,
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Lock namespace.
     * -------------------------------------------------------------------------
     */

    lock(
        tenantId,
        resource,
        identifier,
    ) {

        if (
            this.options.financial
                .lockTenantScoped
        ) {

            return this.financial(
                tenantId,
                'lock',
                `${resource}${this.options.delimiter}${identifier}`,
            );
        }

        return buildNamespace(
            [
                'lock',
                normalizeSegment(
                    resource,
                ),
                normalizeSegment(
                    identifier,
                ),
            ],
            this.options.delimiter,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Parse namespace.
     * -------------------------------------------------------------------------
     */

    parse(
        namespace,
    ) {

        if (
            namespace === undefined ||
            namespace === null
        ) {

            return {
                valid:
                    false,

                state:
                    NAMESPACE_STATES.INVALID,

                namespace:
                    null,

                segments:
                    [],
            };
        }

        const normalized =
            String(
                namespace,
            ).trim();

        if (
            !normalized
        ) {

            return {
                valid:
                    false,

                state:
                    NAMESPACE_STATES.INVALID,

                namespace:
                    normalized,

                segments:
                    [],
            };
        }

        const segments =
            normalized
                .split(
                    this.options.delimiter,
                )
                .filter(Boolean);

        if (
            segments.length ===
            0
        ) {

            return {
                valid:
                    false,

                state:
                    NAMESPACE_STATES.INVALID,

                namespace:
                    normalized,

                segments,
            };
        }

        const first =
            segments[0];

        if (
            first ===
            this.options.tenantPrefix
        ) {

            return {
                valid:
                    segments.length >= 2,

                state:
                    NAMESPACE_STATES.TENANT,

                namespace:
                    normalized,

                segments,

                tenantId:
                    segments[1] ||
                    null,

                scope:
                    segments.slice(
                        2,
                    ),
            };
        }

        if (
            first ===
            this.options.organizationPrefix
        ) {

            return {
                valid:
                    segments.length >= 2,

                state:
                    NAMESPACE_STATES.ORGANIZATION,

                namespace:
                    normalized,

                segments,

                organizationId:
                    segments[1] ||
                    null,

                scope:
                    segments.slice(
                        2,
                    ),
            };
        }

        if (
            first ===
            this.options.systemPrefix
        ) {

            return {
                valid:
                    true,

                state:
                    NAMESPACE_STATES.SYSTEM,

                namespace:
                    normalized,

                segments,

                scope:
                    segments.slice(
                        1,
                    ),
            };
        }

        return {
            valid:
                true,

            state:
                NAMESPACE_STATES.VALID,

            namespace:
                normalized,

            segments,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Namespace ownership.
     * -------------------------------------------------------------------------
     */

    getOwnership(
        namespace,
    ) {

        const parsed =
            this.parse(
                namespace,
            );

        if (
            !parsed.valid
        ) {

            return {
                valid:
                    false,

                ownerType:
                    null,

                ownerId:
                    null,
            };
        }

        return {
            valid:
                true,

            ownerType:
                parsed.state,

            ownerId:
                parsed.tenantId ||
                parsed.organizationId ||
                null,

            tenantId:
                parsed.tenantId ||
                null,

            organizationId:
                parsed.organizationId ||
                null,

            namespace:
                parsed.namespace,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Namespace access decision.
     * -------------------------------------------------------------------------
     */

    authorize(
        {
            namespace,
            mode =
                ACCESS_MODES.READ,

            actorTenantId =
                null,

            targetTenantId =
                null,

            actorOrganizationId =
                null,

            targetOrganizationId =
                null,

            isAuthenticated =
                true,

            isPlatformPrincipal =
                false,

            isSystemPrincipal =
                false,

            isServicePrincipal =
                false,

            explicitCrossTenantPrivilege =
                false,

            explicitCrossOrganizationPrivilege =
                false,

            financial =
                false,

            requireTenant =
                this.options
                    .requireTenantContext,

            requireOrganization =
                this.options
                    .requireOrganizationContext,
        } = {},
    ) {

        const parsed =
            this.parse(
                namespace,
            );

        if (
            !parsed.valid
        ) {

            return this.deny(
                'NAMESPACE_INVALID',
                {
                    namespace,
                    mode,
                },
            );
        }

        if (
            !this.options.enabled
        ) {

            return this.deny(
                'NAMESPACE_ACCESS_DISABLED',
                {
                    namespace,
                    mode,
                },
            );
        }

        if (
            !isAuthenticated &&
            !isPlatformPrincipal &&
            !isSystemPrincipal &&
            !isServicePrincipal
        ) {

            return this.deny(
                'AUTHENTICATION_REQUIRED',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * System namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.state ===
            NAMESPACE_STATES.SYSTEM
        ) {

            if (
                this.options
                    .allowSystemContext &&
                (
                    isSystemPrincipal ||
                    isPlatformPrincipal
                )
            ) {

                return this.allow(
                    'SYSTEM_CONTEXT',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.deny(
                'SYSTEM_NAMESPACE_FORBIDDEN',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Tenant namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.state ===
            NAMESPACE_STATES.TENANT
        ) {

            const namespaceTenant =
                parsed.tenantId;

            if (
                requireTenant &&
                !actorTenantId &&
                !isPlatformPrincipal &&
                !isSystemPrincipal
            ) {

                return this.deny(
                    'TENANT_CONTEXT_REQUIRED',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            if (
                actorTenantId &&
                !isSameIdentity(
                    actorTenantId,
                    namespaceTenant,
                )
            ) {

                const crossTenant =
                    (
                        mode ===
                            ACCESS_MODES.CROSS_TENANT ||
                        mode ===
                            ACCESS_MODES.ADMIN
                    );

                if (
                    this.options
                        .preventCrossTenantAccess &&
                    !(
                        crossTenant &&
                        isPlatformPrincipal &&
                        explicitCrossTenantPrivilege &&
                        this.options
                            .allowCrossTenantAdmin
                    )
                ) {

                    if (
                        financial &&
                        this.options.financial
                            .preventCrossTenant
                    ) {

                        return this.deny(
                            'FINANCIAL_CROSS_TENANT_ACCESS_FORBIDDEN',
                            {
                                namespace,
                                mode,
                                financial:
                                    true,
                            },
                        );
                    }

                    return this.deny(
                        'CROSS_TENANT_ACCESS_FORBIDDEN',
                        {
                            namespace,
                            mode,
                        },
                    );
                }
            }

            if (
                targetTenantId &&
                !isSameIdentity(
                    targetTenantId,
                    namespaceTenant,
                )
            ) {

                return this.deny(
                    'TARGET_TENANT_NAMESPACE_MISMATCH',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            if (
                financial &&
                this.options.financial
                    .requireTenantMatch &&
                !isSameIdentity(
                    actorTenantId,
                    namespaceTenant,
                ) &&
                !(
                    isPlatformPrincipal &&
                    explicitCrossTenantPrivilege
                )
            ) {

                return this.deny(
                    'FINANCIAL_TENANT_MISMATCH',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.allow(
                'TENANT_CONTEXT',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Organization namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.state ===
            NAMESPACE_STATES.ORGANIZATION
        ) {

            const namespaceOrganization =
                parsed.organizationId;

            if (
                requireOrganization &&
                !actorOrganizationId &&
                !isPlatformPrincipal &&
                !isSystemPrincipal
            ) {

                return this.deny(
                    'ORGANIZATION_CONTEXT_REQUIRED',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            if (
                actorOrganizationId &&
                !isSameIdentity(
                    actorOrganizationId,
                    namespaceOrganization,
                )
            ) {

                const crossOrganization =
                    (
                        mode ===
                            ACCESS_MODES.CROSS_TENANT ||
                        mode ===
                            ACCESS_MODES.ADMIN
                    );

                if (
                    this.options
                        .preventCrossOrganizationAccess &&
                    !(
                        crossOrganization &&
                        isPlatformPrincipal &&
                        explicitCrossOrganizationPrivilege &&
                        this.options
                            .allowCrossOrganizationAdmin
                    )
                ) {

                    return this.deny(
                        'CROSS_ORGANIZATION_ACCESS_FORBIDDEN',
                        {
                            namespace,
                            mode,
                        },
                    );
                }
            }

            if (
                targetOrganizationId &&
                !isSameIdentity(
                    targetOrganizationId,
                    namespaceOrganization,
                )
            ) {

                return this.deny(
                    'TARGET_ORGANIZATION_NAMESPACE_MISMATCH',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.allow(
                'ORGANIZATION_CONTEXT',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Platform namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.namespace.startsWith(
                this.options.platformPrefix +
                    this.options.delimiter,
            ) ||
            parsed.namespace ===
                this.options.platformPrefix
        ) {

            if (
                this.options
                    .allowPlatformContext &&
                (
                    isPlatformPrincipal ||
                    isSystemPrincipal
                )
            ) {

                return this.allow(
                    'PLATFORM_CONTEXT',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.deny(
                'PLATFORM_NAMESPACE_FORBIDDEN',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Service namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.namespace.startsWith(
                this.options.servicePrefix +
                    this.options.delimiter,
            )
        ) {

            if (
                this.options
                    .allowServiceContext &&
                (
                    isServicePrincipal ||
                    isPlatformPrincipal ||
                    isSystemPrincipal
                )
            ) {

                return this.allow(
                    'SERVICE_CONTEXT',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.deny(
                'SERVICE_NAMESPACE_FORBIDDEN',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * User namespace.
         * ---------------------------------------------------------------------
         */

        if (
            parsed.namespace.startsWith(
                this.options.userPrefix +
                    this.options.delimiter,
            )
        ) {

            if (
                this.options
                    .allowUserContext
            ) {

                return this.allow(
                    'USER_CONTEXT',
                    {
                        namespace,
                        mode,
                    },
                );
            }

            return this.deny(
                'USER_NAMESPACE_FORBIDDEN',
                {
                    namespace,
                    mode,
                },
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Unknown namespace.
         * ---------------------------------------------------------------------
         */

        return this.deny(
            'NAMESPACE_TYPE_UNKNOWN',
            {
                namespace,
                mode,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Allow decision.
     * -------------------------------------------------------------------------
     */

    allow(
        reason,
        details = {},
    ) {

        const decision = {
            result:
                ACCESS_RESULTS.ALLOW,

            allowed:
                true,

            reason,

            component:
                COMPONENT,

            ...details,

            timestamp:
                new Date().toISOString(),
        };

        this.lastDecision =
            decision;

        this.recordEvent(
            decision,
        );

        return Object.freeze(
            decision,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Deny decision.
     * -------------------------------------------------------------------------
     */

    deny(
        reason,
        details = {},
    ) {

        const decision = {
            result:
                ACCESS_RESULTS.DENY,

            allowed:
                false,

            reason,

            component:
                COMPONENT,

            ...details,

            timestamp:
                new Date().toISOString(),
        };

        this.lastDecision =
            decision;

        this.recordEvent(
            decision,
        );

        return Object.freeze(
            decision,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Assert access.
     * -------------------------------------------------------------------------
     */

    assert(
        options,
    ) {

        const decision =
            this.authorize(
                options,
            );

        if (
            !decision.allowed
        ) {

            throw new NamespaceAccessError(
                `TITech namespace access denied: ${decision.reason}.`,
                {
                    code:
                        `NAMESPACE_ACCESS_DENIED_${decision.reason}`,

                    mode:
                        options?.mode,

                    namespace:
                        options?.namespace,

                    tenantId:
                        options?.targetTenantId ||
                        options?.actorTenantId,

                    organizationId:
                        options?.targetOrganizationId ||
                        options?.actorOrganizationId,

                    details:
                        {
                            decision:
                                decision.reason,
                        },
                },
            );
        }

        return decision;
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant match helper.
     * -------------------------------------------------------------------------
     */

    assertTenantMatch(
        actorTenantId,
        targetTenantId,
        options = {},
    ) {

        return this.assert({
            namespace:
                options.namespace ||
                this.tenant(
                    targetTenantId,
                ),

            mode:
                options.mode ||
                ACCESS_MODES.READ,

            actorTenantId,

            targetTenantId,

            isAuthenticated:
                options.isAuthenticated ??
                true,

            isPlatformPrincipal:
                options.isPlatformPrincipal ??
                false,

            explicitCrossTenantPrivilege:
                options.explicitCrossTenantPrivilege ??
                false,

            financial:
                options.financial ??
                false,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Financial access helper.
     * -------------------------------------------------------------------------
     */

    authorizeFinancial(
        {
            tenantId,
            actorTenantId,
            namespace,
            mode =
                ACCESS_MODES.WRITE,
            isAuthenticated =
                true,
            isPlatformPrincipal =
                false,
            explicitCrossTenantPrivilege =
                false,
        } = {},
    ) {

        if (
            !this.options.financial
                .enabled
        ) {

            return this.deny(
                'FINANCIAL_NAMESPACE_POLICY_DISABLED',
                {
                    namespace,
                    mode,
                },
            );
        }

        if (
            this.options.financial
                .requireTenantContext &&
            !tenantId
        ) {

            return this.deny(
                'FINANCIAL_TENANT_CONTEXT_REQUIRED',
                {
                    namespace,
                    mode,
                },
            );
        }

        if (
            this.options.financial
                .requireTenantMatch &&
            !isSameIdentity(
                tenantId,
                actorTenantId,
            ) &&
            !(
                isPlatformPrincipal &&
                explicitCrossTenantPrivilege
            )
        ) {

            return this.deny(
                'FINANCIAL_TENANT_MISMATCH',
                {
                    namespace,
                    mode,
                },
            );
        }

        if (
            this.options.financial
                .preventCrossTenant &&
            !isSameIdentity(
                tenantId,
                actorTenantId,
            ) &&
            !(
                isPlatformPrincipal &&
                explicitCrossTenantPrivilege &&
                this.options.allowCrossTenantAdmin
            )
        ) {

            return this.deny(
                'FINANCIAL_CROSS_TENANT_ACCESS_FORBIDDEN',
                {
                    namespace,
                    mode,
                },
            );
        }

        return this.allow(
            'FINANCIAL_TENANT_CONTEXT',
            {
                namespace,
                mode,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Namespace fingerprint.
     * -------------------------------------------------------------------------
     */

    fingerprint(
        namespace,
        options = {},
    ) {

        return stableFingerprint(
            namespace,
            options.algorithm ||
                'sha256',
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe identifier.
     * -------------------------------------------------------------------------
     *
     * Useful when tenant identifiers must not appear directly in metrics or
     * logs.
     * -------------------------------------------------------------------------
     */

    safeIdentifier(
        identifier,
        options = {},
    ) {

        if (
            options.hash !==
            true
        ) {

            return String(
                identifier || '',
            );
        }

        return stableFingerprint(
            identifier,
            options.algorithm ||
                'sha256',
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Namespace equality.
     * -------------------------------------------------------------------------
     */

    equals(
        first,
        second,
    ) {

        if (
            first === undefined ||
            second === undefined ||
            first === null ||
            second === null
        ) {

            return false;
        }

        return (
            String(
                first,
            ) ===
            String(
                second,
            )
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Namespace ownership validator.
     * -------------------------------------------------------------------------
     */

    validateOwnership(
        namespace,
        {
            tenantId = null,
            organizationId = null,
        } = {},
    ) {

        const ownership =
            this.getOwnership(
                namespace,
            );

        if (
            !ownership.valid
        ) {

            return {
                valid:
                    false,

                reason:
                    'NAMESPACE_INVALID',
            };
        }

        if (
            ownership.tenantId &&
            tenantId &&
            !isSameIdentity(
                ownership.tenantId,
                tenantId,
            )
        ) {

            return {
                valid:
                    false,

                reason:
                    'TENANT_MISMATCH',
            };
        }

        if (
            ownership.organizationId &&
            organizationId &&
            !isSameIdentity(
                ownership.organizationId,
                organizationId,
            )
        ) {

            return {
                valid:
                    false,

                reason:
                    'ORGANIZATION_MISMATCH',
            };
        }

        return {
            valid:
                true,

            reason:
                'OWNERSHIP_VALID',

            ...ownership,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Event recording.
     * -------------------------------------------------------------------------
     */

    recordEvent(
        event,
    ) {

        if (
            !this.options
                .diagnostics
                .enabled
        ) {

            return;
        }

        const safeEvent = {
            result:
                event.result,

            allowed:
                event.allowed,

            reason:
                event.reason,

            mode:
                event.mode ||
                null,

            namespace:
                this.options
                    .diagnostics
                    .exposeRawNamespaces
                    ? event.namespace ||
                        null
                    : event.namespace
                        ? this.fingerprint(
                            event.namespace,
                        )
                        : null,

            tenantId:
                this.options
                    .diagnostics
                    .exposeTenantIds
                    ? event.tenantId ||
                        null
                    : event.tenantId
                        ? this.safeIdentifier(
                            event.tenantId,
                            {
                                hash:
                                    true,
                            },
                        )
                        : null,

            organizationId:
                this.options
                    .diagnostics
                    .exposeOrganizationIds
                    ? event.organizationId ||
                        null
                    : event.organizationId
                        ? this.safeIdentifier(
                            event.organizationId,
                            {
                                hash:
                                    true,
                            },
                        )
                        : null,

            timestamp:
                event.timestamp ||
                new Date().toISOString(),
        };

        this.events.unshift(
            safeEvent,
        );

        if (
            this.events.length >
            this.options
                .diagnostics
                .maxEvents
        ) {

            this.events.length =
                this.options
                    .diagnostics
                    .maxEvents;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const valid =
            this.options.enabled &&
            this.options.strict &&
            this.options.maxLength > 0;

        return {
            status:
                valid
                    ? 'healthy'
                    : 'degraded',

            healthy:
                valid,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            state:
                this.state,

            tenantIsolation:
                this.options
                    .preventCrossTenantAccess,

            organizationIsolation:
                this.options
                    .preventCrossOrganizationAccess,

            financialIsolation:
                this.options
                    .financial
                    .preventCrossTenant,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const ready =
            this.options.enabled &&
            this.state !==
                NAMESPACE_STATES.INVALID;

        return {
            ready,

            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            state:
                this.state,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            enabled:
                this.options.enabled,

            strict:
                this.options.strict,

            delimiter:
                this.options.delimiter,

            prefixes: {
                tenant:
                    this.options
                        .tenantPrefix,

                organization:
                    this.options
                        .organizationPrefix,

                system:
                    this.options
                        .systemPrefix,

                service:
                    this.options
                        .servicePrefix,

                user:
                    this.options
                        .userPrefix,

                request:
                    this.options
                        .requestPrefix,

                platform:
                    this.options
                        .platformPrefix,
            },

            isolation: {
                preventCrossTenantAccess:
                    this.options
                        .preventCrossTenantAccess,

                preventCrossOrganizationAccess:
                    this.options
                        .preventCrossOrganizationAccess,

                requireTenantContext:
                    this.options
                        .requireTenantContext,

                requireOrganizationContext:
                    this.options
                        .requireOrganizationContext,

                financial:
                    this.options
                        .financial,
            },

            resources: {
                cache:
                    this.options
                        .cache,

                queue:
                    this.options
                        .queue,

                storage:
                    this.options
                        .storage,

                database:
                    this.options
                        .database,
            },

            lastDecision:
                this.lastDecision
                    ? {
                        result:
                            this.lastDecision
                                .result,

                        allowed:
                            this.lastDecision
                                .allowed,

                        reason:
                            this.lastDecision
                                .reason,
                    }
                    : null,

            eventCount:
                this.events.length,

            events:
                [
                    ...this.events,
                ],

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.events.length =
            0;

        this.lastDecision =
            null;

        this.state =
            NAMESPACE_STATES.VALID;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const namespaceAccess =
    new NamespaceAccessProvider();

/**
 * =============================================================================
 * Convenience functions
 * =============================================================================
 */

function tenant(
    tenantId,
    scope,
) {

    return namespaceAccess.tenant(
        tenantId,
        scope,
    );
}

function organization(
    organizationId,
    scope,
) {

    return namespaceAccess.organization(
        organizationId,
        scope,
    );
}

function system(
    scope,
) {

    return namespaceAccess.system(
        scope,
    );
}

function platform(
    scope,
) {

    return namespaceAccess.platform(
        scope,
    );
}

function service(
    serviceName,
    scope,
) {

    return namespaceAccess.service(
        serviceName,
        scope,
    );
}

function user(
    userId,
    scope,
) {

    return namespaceAccess.user(
        userId,
        scope,
    );
}

function request(
    requestId,
    scope,
) {

    return namespaceAccess.request(
        requestId,
        scope,
    );
}

function cache(
    tenantId,
    resource,
    identifier,
) {

    return namespaceAccess.cache(
        tenantId,
        resource,
        identifier,
    );
}

function queue(
    tenantId,
    queueName,
    identifier,
) {

    return namespaceAccess.queue(
        tenantId,
        queueName,
        identifier,
    );
}

function storage(
    tenantId,
    objectPath,
) {

    return namespaceAccess.storage(
        tenantId,
        objectPath,
    );
}

function database(
    tenantId,
    collection,
) {

    return namespaceAccess.database(
        tenantId,
        collection,
    );
}

function financial(
    tenantId,
    resource,
    identifier,
) {

    return namespaceAccess.financial(
        tenantId,
        resource,
        identifier,
    );
}

function idempotency(
    tenantId,
    key,
) {

    return namespaceAccess.idempotency(
        tenantId,
        key,
    );
}

function audit(
    tenantId,
    scope,
    identifier,
) {

    return namespaceAccess.audit(
        tenantId,
        scope,
        identifier,
    );
}

function ledger(
    tenantId,
    accountId,
) {

    return namespaceAccess.ledger(
        tenantId,
        accountId,
    );
}

function balance(
    tenantId,
    accountId,
) {

    return namespaceAccess.balance(
        tenantId,
        accountId,
    );
}

function lock(
    tenantId,
    resource,
    identifier,
) {

    return namespaceAccess.lock(
        tenantId,
        resource,
        identifier,
    );
}

function parse(
    namespace,
) {

    return namespaceAccess.parse(
        namespace,
    );
}

function authorize(
    options,
) {

    return namespaceAccess.authorize(
        options,
    );
}

function assertAccess(
    options,
) {

    return namespaceAccess.assert(
        options,
    );
}

function authorizeFinancial(
    options,
) {

    return namespaceAccess.authorizeFinancial(
        options,
    );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton.
         */
        namespaceAccess,

        NamespaceAccessProvider,

        NamespaceAccessError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        NAMESPACE_TYPES,

        ACCESS_MODES,

        ACCESS_RESULTS,

        NAMESPACE_STATES,

        DEFAULTS,

        /**
         * Namespace builders.
         */
        tenant,

        organization,

        system,

        platform,

        service,

        user,

        request,

        tenantResource:
            (
                tenantId,
                resource,
                identifier,
            ) =>
                namespaceAccess.tenantResource(
                    tenantId,
                    resource,
                    identifier,
                ),

        cache,

        queue,

        storage,

        database,

        financial,

        idempotency,

        audit,

        ledger,

        balance,

        lock,

        /**
         * Parsing/ownership.
         */
        parse,

        getOwnership:
            namespace =>
                namespaceAccess.getOwnership(
                    namespace,
                ),

        validateOwnership:
            (
                namespace,
                options,
            ) =>
                namespaceAccess.validateOwnership(
                    namespace,
                    options,
                ),

        fingerprint:
            (
                namespace,
                options,
            ) =>
                namespaceAccess.fingerprint(
                    namespace,
                    options,
                ),

        safeIdentifier:
            (
                identifier,
                options,
            ) =>
                namespaceAccess.safeIdentifier(
                    identifier,
                    options,
                ),

        equals:
            (
                first,
                second,
            ) =>
                namespaceAccess.equals(
                    first,
                    second,
                ),

        /**
         * Access control.
         */
        authorize,

        assert:
            assertAccess,

        assertTenantMatch:
            (
                actorTenantId,
                targetTenantId,
                options,
            ) =>
                namespaceAccess.assertTenantMatch(
                    actorTenantId,
                    targetTenantId,
                    options,
                ),

        authorizeFinancial,

        /**
         * Operational state.
         */
        health:
            () =>
                namespaceAccess.health(),

        readiness:
            () =>
                namespaceAccess.readiness(),

        snapshot:
            () =>
                namespaceAccess.snapshot(),

        reset:
            () =>
                namespaceAccess.reset(),
    });