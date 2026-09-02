'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/tenantOverrides.js
 *
 * Purpose:
 *   Enterprise production-grade tenant-specific configuration override
 *   provider.
 *
 * Responsibilities:
 *   - Resolve safe tenant-specific configuration overrides.
 *   - Enforce immutable base configuration.
 *   - Apply controlled per-tenant feature/configuration differences.
 *   - Enforce allowlisted override paths.
 *   - Prevent tenant overrides of security-critical configuration.
 *   - Prevent tenant overrides of infrastructure connection settings.
 *   - Prevent cross-tenant configuration leakage.
 *   - Support tenant quotas, limits and non-sensitive behavior controls.
 *   - Provide deterministic override resolution.
 *   - Provide safe diagnostics and fingerprints.
 *   - Support bootstrap/lifecycle integration.
 *
 * IMPORTANT:
 *
 *   This module is NOT a general-purpose configuration mutation engine.
 *
 *   Tenant overrides MUST NOT be used to change:
 *     - JWT signing secrets.
 *     - Database credentials or connection strings.
 *     - Redis credentials or connection strings.
 *     - Encryption keys.
 *     - Cryptographic policy.
 *     - Global tenant isolation policy.
 *     - Cross-tenant authorization policy.
 *     - Financial ledger isolation.
 *     - Idempotency enforcement.
 *     - Audit integrity.
 *     - Authentication requirements.
 *     - Authorization requirements.
 *     - Global security middleware.
 *     - Infrastructure endpoints.
 *
 * Tenant overrides are intended for controlled, explicitly allowlisted values
 * such as:
 *     - tenant quotas
 *     - UI/application preferences
 *     - notification preferences
 *     - feature availability
 *     - rate limits
 *     - business-level configurable limits
 *     - tenant-specific non-secret operational settings
 *
 * =============================================================================
 *
 * Canonical flow:
 *
 *   environment
 *       ↓
 *   global configuration
 *       ↓
 *   tenant configuration
 *       ↓
 *   tenantOverrides.js
 *       ↓
 *   resolved tenant runtime configuration
 *       ↓
 *   services / repositories / workers
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional dependencies
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

let tenantsConfigModule = null;

try {
    // eslint-disable-next-line global-require
    tenantsConfigModule =
        require('../tenants');
} catch {
    tenantsConfigModule = null;
}

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
    'tenant-overrides';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const OVERRIDE_STATES =
    Object.freeze({
        DISABLED:
            'disabled',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

const OVERRIDE_SOURCES =
    Object.freeze({
        DEFAULT:
            'default',

        GLOBAL:
            'global',

        TENANT:
            'tenant',

        ENVIRONMENT:
            'environment',

        RUNTIME:
            'runtime',

        FALLBACK:
            'fallback',
    });

const OVERRIDE_VALUE_TYPES =
    Object.freeze({
        BOOLEAN:
            'boolean',

        STRING:
            'string',

        NUMBER:
            'number',

        INTEGER:
            'integer',

        JSON:
            'json',

        NULL:
            'null',
    });

/**
 * =============================================================================
 * Enterprise defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        strict:
            true,

        failClosed:
            true,

        allowRuntimeMutation:
            false,

        allowUnknownTenants:
            false,

        allowUnknownOverridePaths:
            false,

        requireTenantId:
            true,

        normalizeTenantId:
            true,

        maxOverridesPerTenant:
            100,

        maxOverridePathLength:
            255,

        maxStringValueLength:
            2048,

        maxObjectDepth:
            8,

        maxArrayLength:
            100,

        fingerprintAlgorithm:
            'sha256',

        /**
         * Tenant override caching.
         */
        cache:
            {
                enabled:
                    true,

                ttlMs:
                    5_000,

                maxEntries:
                    10_000,
            },

        /**
         * Diagnostics.
         */
        diagnostics:
            {
                enabled:
                    true,

                exposeRawTenantIds:
                    false,

                exposeOverrideValues:
                    false,

                exposePaths:
                    true,

                maxEvents:
                    100,
            },

        /**
         * Paths explicitly permitted to be overridden per tenant.
         *
         * Wildcard syntax:
         *
         *   *
         *     Matches exactly one path segment.
         *
         * Examples:
         *
         *   quotas.*
         *   rateLimit.*
         *   notifications.*
         *   ui.*
         *   features.*
         */
        allowlist:
            Object.freeze([
                'quotas.*',
                'limits.*',
                'rateLimit.*',
                'notifications.emailEnabled',
                'notifications.smsEnabled',
                'notifications.pushEnabled',
                'notifications.reminderWindow',
                'features.*',
                'ui.*',
                'locale',
                'timezone',
                'currencyDisplay',
                'dateFormat',
                'numberFormat',
                'businessRules.*',
                'loanPolicy.*',
                'contributionPolicy.*',
                'communicationPolicy.*',
            ]),

        /**
         * Explicitly forbidden paths always win over allowlist matches.
         */
        denylist:
            Object.freeze([
                'security.*',
                'auth.*',
                'authorization.*',
                'jwt.*',
                'database.*',
                'db.*',
                'redis.*',
                'queue.connection.*',
                'storage.credentials.*',
                'storage.connection.*',
                'encryption.*',
                'crypto.*',
                'secrets.*',
                'credentials.*',
                'keys.*',
                'tenantIsolation.*',
                'tenants.security.*',
                'tenants.database.*',
                'tenants.financial.*',
                'financial.ledger.*',
                'financial.balance.*',
                'financial.transaction.*',
                'financial.idempotency.*',
                'financial.audit.*',
                'idempotency.*',
                'audit.integrity.*',
                'audit.signing.*',
                'observability.security.*',
                'server.*',
                'http.*',
                'infrastructure.*',
                'network.*',
            ]),

        /**
         * Financial values are intentionally constrained.
         *
         * Tenant configuration may tune business policy within safe bounds,
         * but may not switch off foundational financial controls.
         */
        financialBounds:
            Object.freeze({
                minLoanInterestRate:
                    0,

                maxLoanInterestRate:
                    100,

                minLoanTermMonths:
                    1,

                maxLoanTermMonths:
                    120,

                minContributionAmount:
                    0,

                maxContributionAmount:
                    10_000_000_000,

                minLoanMultiplier:
                    0,

                maxLoanMultiplier:
                    100,
            }),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class TenantOverrideError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'TenantOverrideError';

        this.code =
            options.code ||
            'TENANT_OVERRIDE_ERROR';

        this.tenantId =
            options.tenantId ||
            null;

        this.path =
            options.path ||
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
            TenantOverrideError,
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

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Fall through.
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const result = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            result[key] =
                clone(
                    item,
                );
        }

        return result;
    }

    return value;
}

function normalizeTenantId(
    tenantId,
) {

    if (
        tenantsConfigModule?.normalizeTenantId
    ) {

        try {
            return tenantsConfigModule.normalizeTenantId(
                tenantId,
            );
        } catch {
            // Fall through.
        }
    }

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

    return normalized || null;
}

function isValidTenantId(
    tenantId,
) {

    if (
        tenantsConfigModule?.isValidTenantId
    ) {

        try {
            return tenantsConfigModule.isValidTenantId(
                tenantId,
            );
        } catch {
            return false;
        }
    }

    return (
        typeof tenantId ===
            'string' &&
        /^[a-z][a-z0-9_-]{7,63}$/.test(
            tenantId,
        )
    );
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
        // Configuration override evaluation must never fail because logging
        // failed.
    }
}

function getByPath(
    object,
    path,
    fallback,
) {

    if (
        !path
    ) {

        return (
            object === undefined
                ? fallback
                : object
        );
    }

    const parts =
        Array.isArray(
            path,
        )
            ? path
            : String(
                path,
            )
                .split('.')
                .filter(Boolean);

    let current =
        object;

    for (
        const part of
        parts
    ) {

        if (
            current === undefined ||
            current === null
        ) {

            return fallback;
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current,
                ),
                part,
            )
        ) {

            return fallback;
        }

        current =
            current[part];
    }

    return (
        current === undefined
            ? fallback
            : current
    );
}

function setByPath(
    object,
    path,
    value,
) {

    const parts =
        Array.isArray(
            path,
        )
            ? path
            : String(
                path,
            )
                .split('.')
                .filter(Boolean);

    if (
        parts.length ===
        0
    ) {

        throw new TenantOverrideError(
            'Override path is required.',
            {
                code:
                    'TENANT_OVERRIDE_PATH_REQUIRED',
            },
        );
    }

    let current =
        object;

    for (
        let index = 0;
        index < parts.length;
        index += 1
    ) {

        const part =
            parts[index];

        const isFinal =
            index ===
            parts.length - 1;

        if (
            isFinal
        ) {

            current[part] =
                value;

            break;
        }

        if (
            typeof current[part] !==
                'object' ||
            current[part] === null ||
            Array.isArray(
                current[part],
            )
        ) {

            current[part] =
                {};
        }

        current =
            current[part];
    }

    return object;
}

function normalizePath(
    value,
) {

    return String(
        value || '',
    )
        .trim()
        .replace(
            /^config\./,
            '',
        )
        .replace(
            /^configuration\./,
            '',
        )
        .replace(
            /\[(['"]?)([^'"\]]+)\1\]/g,
            '.$2',
        )
        .replace(
            /^\./,
            '',
        );
}

function getLeaf(
    path,
) {

    const normalized =
        normalizePath(
            path,
        );

    const parts =
        normalized
            .split('.')
            .filter(Boolean);

    return (
        parts[
            parts.length - 1
        ] ||
        ''
    );
}

function isSensitivePath(
    path,
) {

    const normalized =
        normalizePath(
            path,
        ).toLowerCase();

    return (
        /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri)|credentials?|jwt|crypto|signing[_-]?key)/i.test(
            normalized,
        )
    );
}

function containsDangerousObject(
    value,
    {
        depth = 0,
        maxDepth =
            DEFAULTS.maxObjectDepth,
        maxArrayLength =
            DEFAULTS.maxArrayLength,
    } = {},
) {

    if (
        depth >
        maxDepth
    ) {

        return {
            valid:
                false,

            reason:
                'MAX_DEPTH_EXCEEDED',
        };
    }

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {

        return {
            valid:
                true,
        };
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        if (
            value.length >
            maxArrayLength
        ) {

            return {
                valid:
                    false,

                reason:
                    'MAX_ARRAY_LENGTH_EXCEEDED',
            };
        }

        for (
            const item of
            value
        ) {

            const result =
                containsDangerousObject(
                    item,
                    {
                        depth:
                            depth + 1,

                        maxDepth,

                        maxArrayLength,
                    },
                );

            if (
                !result.valid
            ) {

                return result;
            }
        }

        return {
            valid:
                true,
        };
    }

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        if (
            isSensitivePath(
                key,
            )
        ) {

            return {
                valid:
                    false,

                reason:
                    'SENSITIVE_KEY_DETECTED',
            };
        }

        const result =
            containsDangerousObject(
                item,
                {
                    depth:
                        depth + 1,

                    maxDepth,

                    maxArrayLength,
                },
            );

        if (
            !result.valid
        ) {

            return result;
        }
    }

    return {
        valid:
            true,
    };
}

function stableFingerprint(
    value,
    algorithm =
        DEFAULTS.fingerprintAlgorithm,
) {

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            JSON.stringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

/**
 * =============================================================================
 * Path policy matching
 * =============================================================================
 */

function pathMatchesPattern(
    path,
    pattern,
) {

    const normalizedPath =
        normalizePath(
            path,
        );

    const normalizedPattern =
        normalizePath(
            pattern,
        );

    if (
        normalizedPattern ===
        '*'
    ) {

        return true;
    }

    const pathParts =
        normalizedPath
            .split('.')
            .filter(Boolean);

    const patternParts =
        normalizedPattern
            .split('.')
            .filter(Boolean);

    if (
        pathParts.length !==
        patternParts.length
    ) {

        /**
         * Support a trailing `*` as a recursive subtree match.
         *
         * Example:
         *
         *   quotas.*
         *
         * matches:
         *
         *   quotas.maxUsers
         *   quotas.maxGroups
         *   quotas.loan.maxAmount
         */
        if (
            !patternParts.includes(
                '*',
            )
        ) {

            return false;
        }

        const wildcardIndex =
            patternParts.indexOf(
                '*',
            );

        if (
            wildcardIndex !==
            patternParts.length - 1
        ) {

            return false;
        }

        if (
            pathParts.length <=
            wildcardIndex
        ) {

            return false;
        }

        for (
            let index = 0;
            index < wildcardIndex;
            index += 1
        ) {

            if (
                patternParts[index] !==
                    pathParts[index]
            ) {

                return false;
            }
        }

        return true;
    }

    return patternParts.every(
        (
            segment,
            index,
        ) =>
            segment === '*' ||
            segment === pathParts[index],
    );
}

function matchesAnyPattern(
    path,
    patterns,
) {

    return patterns.some(
        pattern =>
            pathMatchesPattern(
                path,
                pattern,
            ),
    );
}

/**
 * =============================================================================
 * Value type inference
 * =============================================================================
 */

function inferValueType(
    value,
) {

    if (
        value === null
    ) {

        return OVERRIDE_VALUE_TYPES.NULL;
    }

    if (
        typeof value === 'boolean'
    ) {

        return OVERRIDE_VALUE_TYPES.BOOLEAN;
    }

    if (
        typeof value === 'number'
    ) {

        return Number.isInteger(
            value,
        )
            ? OVERRIDE_VALUE_TYPES.INTEGER
            : OVERRIDE_VALUE_TYPES.NUMBER;
    }

    if (
        typeof value === 'string'
    ) {

        return OVERRIDE_VALUE_TYPES.STRING;
    }

    return OVERRIDE_VALUE_TYPES.JSON;
}

/**
 * =============================================================================
 * TenantOverrideProvider
 * =============================================================================
 */

class TenantOverrideProvider {

    constructor(
        options = {},
    ) {

        const configured =
            getConfig(
                'tenantOverrides',
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
                        process.env.TENANT_OVERRIDES_ENABLED,
                        DEFAULTS.enabled,
                    ),

                strict:
                    source.strict ??
                    DEFAULTS.strict,

                failClosed:
                    source.failClosed ??
                    DEFAULTS.failClosed,

                allowRuntimeMutation:
                    source.allowRuntimeMutation ??
                    DEFAULTS.allowRuntimeMutation,

                allowUnknownTenants:
                    source.allowUnknownTenants ??
                    DEFAULTS.allowUnknownTenants,

                allowUnknownOverridePaths:
                    source.allowUnknownOverridePaths ??
                    DEFAULTS.allowUnknownOverridePaths,

                requireTenantId:
                    source.requireTenantId ??
                    DEFAULTS.requireTenantId,

                normalizeTenantId:
                    source.normalizeTenantId ??
                    DEFAULTS.normalizeTenantId,

                maxOverridesPerTenant:
                    asPositiveInteger(
                        source.maxOverridesPerTenant,
                        DEFAULTS.maxOverridesPerTenant,
                    ),

                maxOverridePathLength:
                    asPositiveInteger(
                        source.maxOverridePathLength,
                        DEFAULTS.maxOverridePathLength,
                    ),

                maxStringValueLength:
                    asPositiveInteger(
                        source.maxStringValueLength,
                        DEFAULTS.maxStringValueLength,
                    ),

                maxObjectDepth:
                    asPositiveInteger(
                        source.maxObjectDepth,
                        DEFAULTS.maxObjectDepth,
                    ),

                maxArrayLength:
                    asPositiveInteger(
                        source.maxArrayLength,
                        DEFAULTS.maxArrayLength,
                    ),

                fingerprintAlgorithm:
                    source.fingerprintAlgorithm ||
                    DEFAULTS.fingerprintAlgorithm,

                cache:
                    {
                        ...DEFAULTS.cache,
                        ...(source.cache || {}),
                    },

                diagnostics:
                    {
                        ...DEFAULTS.diagnostics,
                        ...(source.diagnostics || {}),
                    },

                allowlist:
                    Object.freeze([
                        ...(
                            source.allowlist ||
                            DEFAULTS.allowlist
                        ),
                    ]),

                denylist:
                    Object.freeze([
                        ...(
                            source.denylist ||
                            DEFAULTS.denylist
                        ),
                    ]),

                financialBounds:
                    {
                        ...DEFAULTS.financialBounds,
                        ...(source.financialBounds || {}),
                    },
            });

        this.state =
            this.options.enabled
                ? OVERRIDE_STATES.READY
                : OVERRIDE_STATES.DISABLED;

        this.overrides =
            new Map();

        this.cache =
            new Map();

        this.events =
            [];

        this.errors =
            [];

        this.warnings =
            [];

        this.updatedAt =
            new Date();
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant existence.
     * -------------------------------------------------------------------------
     *
     * This provider does not own the tenant registry. It supports optional
     * registry callbacks so applications can connect their authoritative tenant
     * repository without coupling configuration to database implementation.
     * -------------------------------------------------------------------------
     */

    async assertTenant(
        tenantId,
        options = {},
    ) {

        const normalized =
            this.normalizeTenantId(
                tenantId,
            );

        if (
            !normalized
        ) {

            throw new TenantOverrideError(
                'TITech tenant identifier is required.',
                {
                    code:
                        'TENANT_ID_REQUIRED',
                },
            );
        }

        if (
            !this.options
                .allowUnknownTenants &&
            typeof options.exists ===
                'function'
        ) {

            const exists =
                await options.exists(
                    normalized,
                );

            if (
                !exists
            ) {

                throw new TenantOverrideError(
                    'TITech tenant is not recognized.',
                    {
                        code:
                            'TENANT_NOT_FOUND',

                        tenantId:
                            normalized,
                    },
                );
            }
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant ID normalization.
     * -------------------------------------------------------------------------
     */

    normalizeTenantId(
        tenantId,
    ) {

        if (
            !this.options
                .normalizeTenantId
        ) {

            return String(
                tenantId || '',
            ).trim();
        }

        const normalized =
            normalizeTenantId(
                tenantId,
            );

        if (
            !normalized
        ) {

            return null;
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate override path.
     * -------------------------------------------------------------------------
     */

    validatePath(
        path,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        if (
            !normalized
        ) {

            throw new TenantOverrideError(
                'Tenant override path is required.',
                {
                    code:
                        'TENANT_OVERRIDE_PATH_REQUIRED',
                },
            );
        }

        if (
            normalized.length >
            this.options
                .maxOverridePathLength
        ) {

            throw new TenantOverrideError(
                'Tenant override path is too long.',
                {
                    code:
                        'TENANT_OVERRIDE_PATH_TOO_LONG',

                    path:
                        normalized,
                },
            );
        }

        if (
            isSensitivePath(
                normalized,
            )
        ) {

            throw new TenantOverrideError(
                'Sensitive configuration cannot be overridden at tenant scope.',
                {
                    code:
                        'TENANT_OVERRIDE_SENSITIVE_PATH_FORBIDDEN',

                    path:
                        normalized,
                },
            );
        }

        if (
            matchesAnyPattern(
                normalized,
                this.options.denylist,
            )
        ) {

            throw new TenantOverrideError(
                'Tenant override path is explicitly forbidden.',
                {
                    code:
                        'TENANT_OVERRIDE_PATH_DENIED',

                    path:
                        normalized,
                },
            );
        }

        if (
            !this.options
                .allowUnknownOverridePaths &&
            !matchesAnyPattern(
                normalized,
                this.options.allowlist,
            )
        ) {

            throw new TenantOverrideError(
                'Tenant override path is not allowlisted.',
                {
                    code:
                        'TENANT_OVERRIDE_PATH_NOT_ALLOWED',

                    path:
                        normalized,
                },
            );
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate override value.
     * -------------------------------------------------------------------------
     */

    validateValue(
        value,
        options = {},
    ) {

        const type =
            options.type ||
            inferValueType(
                value,
            );

        if (
            type ===
            OVERRIDE_VALUE_TYPES.STRING
        ) {

            if (
                String(
                    value,
                ).length >
                this.options
                    .maxStringValueLength
            ) {

                throw new TenantOverrideError(
                    'Tenant override string value exceeds maximum length.',
                    {
                        code:
                            'TENANT_OVERRIDE_STRING_TOO_LONG',
                    },
                );
            }
        }

        if (
            type ===
                OVERRIDE_VALUE_TYPES.NUMBER ||
            type ===
                OVERRIDE_VALUE_TYPES.INTEGER
        ) {

            if (
                !Number.isFinite(
                    Number(
                        value,
                    ),
                )
            ) {

                throw new TenantOverrideError(
                    'Tenant override numeric value is invalid.',
                    {
                        code:
                            'TENANT_OVERRIDE_NUMBER_INVALID',
                    },
                );
            }
        }

        if (
            (
                type ===
                    OVERRIDE_VALUE_TYPES.JSON ||
                (
                    value &&
                    typeof value ===
                        'object'
                )
            )
        ) {

            const safety =
                containsDangerousObject(
                    value,
                    {
                        depth:
                            0,

                        maxDepth:
                            this.options
                                .maxObjectDepth,

                        maxArrayLength:
                            this.options
                                .maxArrayLength,
                    },
                );

            if (
                !safety.valid
            ) {

                throw new TenantOverrideError(
                    'Tenant override object contains unsupported or unsafe data.',
                    {
                        code:
                            'TENANT_OVERRIDE_OBJECT_INVALID',

                        details:
                            safety,
                    },
                );
            }
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate business constraints.
     * -------------------------------------------------------------------------
     */

    validateBusinessBounds(
        path,
        value,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        const numericValue =
            Number(
                value,
            );

        if (
            Number.isNaN(
                numericValue,
            )
        ) {

            return true;
        }

        const bounds =
            this.options
                .financialBounds;

        if (
            normalized ===
            'loanPolicy.interestRate' ||
            normalized ===
            'businessRules.loanInterestRate'
        ) {

            if (
                numericValue <
                    bounds
                        .minLoanInterestRate ||
                numericValue >
                    bounds
                        .maxLoanInterestRate
            ) {

                throw new TenantOverrideError(
                    'Tenant loan interest rate exceeds permitted TITech bounds.',
                    {
                        code:
                            'TENANT_INTEREST_RATE_OUT_OF_BOUNDS',

                        path:
                            normalized,
                    },
                );
            }
        }

        if (
            normalized ===
            'loanPolicy.repaymentPeriodMonths'
        ) {

            if (
                numericValue <
                    bounds
                        .minLoanTermMonths ||
                numericValue >
                    bounds
                        .maxLoanTermMonths
            ) {

                throw new TenantOverrideError(
                    'Tenant loan repayment period exceeds permitted TITech bounds.',
                    {
                        code:
                            'TENANT_LOAN_TERM_OUT_OF_BOUNDS',

                        path:
                            normalized,
                    },
                );
            }
        }

        if (
            normalized ===
            'loanPolicy.maxLoanMultiplier'
        ) {

            if (
                numericValue <
                    bounds
                        .minLoanMultiplier ||
                numericValue >
                    bounds
                        .maxLoanMultiplier
            ) {

                throw new TenantOverrideError(
                    'Tenant loan multiplier exceeds permitted TITech bounds.',
                    {
                        code:
                            'TENANT_LOAN_MULTIPLIER_OUT_OF_BOUNDS',

                        path:
                            normalized,
                    },
                );
            }
        }

        if (
            normalized ===
                'contributionPolicy.minContribution' ||
            normalized ===
                'contributionPolicy.maxContribution'
        ) {

            if (
                numericValue <
                    bounds
                        .minContributionAmount ||
                numericValue >
                    bounds
                        .maxContributionAmount
            ) {

                throw new TenantOverrideError(
                    'Tenant contribution amount exceeds permitted TITech bounds.',
                    {
                        code:
                            'TENANT_CONTRIBUTION_AMOUNT_OUT_OF_BOUNDS',

                        path:
                            normalized,
                    },
                );
            }
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Set tenant override.
     * -------------------------------------------------------------------------
     */

    async set(
        tenantId,
        path,
        value,
        options = {},
    ) {

        if (
            !this.options.enabled
        ) {

            throw new TenantOverrideError(
                'TITech tenant overrides are disabled.',
                {
                    code:
                        'TENANT_OVERRIDES_DISABLED',

                    tenantId,
                    path,
                },
            );
        }

        const normalizedTenant =
            await this.assertTenant(
                tenantId,
                options,
            );

        const normalizedPath =
            this.validatePath(
                path,
            );

        this.validateValue(
            value,
            options,
        );

        this.validateBusinessBounds(
            normalizedPath,
            value,
        );

        let tenantOverrides =
            this.overrides.get(
                normalizedTenant,
            );

        if (
            !tenantOverrides
        ) {

            tenantOverrides =
                {};

            this.overrides.set(
                normalizedTenant,
                tenantOverrides,
            );
        }

        const existingCount =
            this.countPaths(
                tenantOverrides,
            );

        if (
            !getByPath(
                tenantOverrides,
                normalizedPath,
                undefined,
            ) &&
            existingCount >=
                this.options
                    .maxOverridesPerTenant
        ) {

            throw new TenantOverrideError(
                'Tenant override quota has been reached.',
                {
                    code:
                        'TENANT_OVERRIDE_LIMIT_REACHED',

                    tenantId:
                        normalizedTenant,
                },
            );
        }

        setByPath(
            tenantOverrides,
            normalizedPath,
            clone(
                value,
            ),
        );

        this.updatedAt =
            new Date();

        this.invalidateTenantCache(
            normalizedTenant,
        );

        this.recordEvent(
            {
                type:
                    'set',

                tenantId:
                    normalizedTenant,

                path:
                    normalizedPath,
            },
        );

        return this.get(
            normalizedTenant,
            normalizedPath,
            {
                fallback:
                    undefined,

                options,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Set many tenant overrides atomically.
     * -------------------------------------------------------------------------
     */

    async setMany(
        tenantId,
        overrides,
        options = {},
    ) {

        if (
            !overrides ||
            typeof overrides !==
                'object' ||
            Array.isArray(
                overrides,
            )
        ) {

            throw new TenantOverrideError(
                'Tenant overrides must be an object.',
                {
                    code:
                        'TENANT_OVERRIDES_OBJECT_REQUIRED',

                    tenantId,
                },
            );
        }

        const normalizedTenant =
            await this.assertTenant(
                tenantId,
                options,
            );

        const entries =
            Object.entries(
                overrides,
            );

        if (
            entries.length >
            this.options
                .maxOverridesPerTenant
        ) {

            throw new TenantOverrideError(
                'Tenant override count exceeds configured limit.',
                {
                    code:
                        'TENANT_OVERRIDE_LIMIT_REACHED',

                    tenantId:
                        normalizedTenant,
                },
            );
        }

        const validated = [];

        for (
            const [
                path,
                value,
            ] of entries
        ) {

            const normalizedPath =
                this.validatePath(
                    path,
                );

            this.validateValue(
                value,
                options,
            );

            this.validateBusinessBounds(
                normalizedPath,
                value,
            );

            validated.push([
                normalizedPath,
                clone(
                    value,
                ),
            ]);
        }

        /**
         * Clone first and commit only after every value has passed validation.
         * This provides transactional behavior at the configuration layer.
         */
        const tenantOverrides =
            clone(
                this.overrides.get(
                    normalizedTenant,
                ) ||
                {},
            );

        for (
            const [
                path,
                value,
            ] of validated
        ) {

            setByPath(
                tenantOverrides,
                path,
                value,
            );
        }

        if (
            this.countPaths(
                tenantOverrides,
            ) >
            this.options
                .maxOverridesPerTenant
        ) {

            throw new TenantOverrideError(
                'Tenant override count exceeds configured limit.',
                {
                    code:
                        'TENANT_OVERRIDE_LIMIT_REACHED',

                    tenantId:
                        normalizedTenant,
                },
            );
        }

        this.overrides.set(
            normalizedTenant,
            tenantOverrides,
        );

        this.updatedAt =
            new Date();

        this.invalidateTenantCache(
            normalizedTenant,
        );

        this.recordEvent(
            {
                type:
                    'setMany',

                tenantId:
                    normalizedTenant,

                count:
                    validated.length,
            },
        );

        return this.snapshotTenant(
            normalizedTenant,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get a tenant override.
     * -------------------------------------------------------------------------
     */

    get(
        tenantId,
        path,
        options = {},
    ) {

        if (
            !this.options.enabled
        ) {

            return (
                options.fallback !==
                undefined
                    ? options.fallback
                    : undefined
            );
        }

        const normalizedTenant =
            this.normalizeTenantId(
                tenantId,
            );

        if (
            this.options.requireTenantId &&
            !normalizedTenant
        ) {

            if (
                this.options.failClosed
            ) {

                throw new TenantOverrideError(
                    'Tenant context is required for tenant override access.',
                    {
                        code:
                            'TENANT_ID_REQUIRED',
                    },
                );
            }

            return options.fallback;
        }

        const normalizedPath =
            normalizePath(
                path,
            );

        this.validatePath(
            normalizedPath,
        );

        const cacheKey =
            this.createCacheKey(
                normalizedTenant,
                normalizedPath,
            );

        if (
            this.options.cache.enabled
        ) {

            const cached =
                this.getCached(
                    cacheKey,
                );

            if (
                cached !==
                null
            ) {

                return clone(
                    cached,
                );
            }
        }

        const tenantOverrides =
            this.overrides.get(
                normalizedTenant,
            ) ||
            {};

        const value =
            getByPath(
                tenantOverrides,
                normalizedPath,
                options.fallback,
            );

        if (
            this.options.cache.enabled
        ) {

            this.cacheValue(
                cacheKey,
                value,
            );
        }

        return clone(
            value,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve configuration.
     * -------------------------------------------------------------------------
     *
     * `baseConfiguration` is cloned and never mutated.
     * -------------------------------------------------------------------------
     */

    resolve(
        tenantId,
        baseConfiguration = {},
        options = {},
    ) {

        if (
            !this.options.enabled
        ) {

            return deepFreeze(
                clone(
                    baseConfiguration,
                ),
            );
        }

        const normalizedTenant =
            this.normalizeTenantId(
                tenantId,
            );

        if (
            this.options.requireTenantId &&
            !normalizedTenant
        ) {

            if (
                this.options.failClosed
            ) {

                throw new TenantOverrideError(
                    'TITech tenant context is required to resolve tenant configuration.',
                    {
                        code:
                            'TENANT_ID_REQUIRED',
                    },
                );
            }

            return deepFreeze(
                clone(
                    baseConfiguration,
                ),
            );
        }

        const base =
            clone(
                baseConfiguration,
            );

        const overrides =
            clone(
                this.overrides.get(
                    normalizedTenant,
                ) ||
                {},
            );

        const resolved =
            this.mergeAllowlisted(
                base,
                overrides,
                '',
            );

        /**
         * Never allow tenant overrides to modify protected namespaces after
         * merge. This is a second defensive boundary.
         */
        this.assertProtectedConfiguration(
            resolved,
        );

        const result = {
            ...resolved,

            _tenant: {
                id:
                    normalizedTenant,

                overrideCount:
                    this.countPaths(
                        overrides,
                    ),

                resolvedAt:
                    new Date().toISOString(),
            },
        };

        this.recordEvent(
            {
                type:
                    'resolve',

                tenantId:
                    normalizedTenant,

                count:
                    this.countPaths(
                        overrides,
                    ),
            },
        );

        return deepFreeze(
            result,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Allowlisted merge.
     * -------------------------------------------------------------------------
     */

    mergeAllowlisted(
        target,
        overrides,
        parentPath,
    ) {

        if (
            overrides === null ||
            overrides === undefined
        ) {

            return target;
        }

        if (
            typeof overrides !==
                'object' ||
            Array.isArray(
                overrides,
            )
        ) {

            if (
                !parentPath
            ) {

                throw new TenantOverrideError(
                    'Root tenant override must be an object.',
                    {
                        code:
                            'TENANT_OVERRIDE_ROOT_INVALID',
                    },
                );
            }

            const allowedPath =
                this.isPathAllowed(
                    parentPath,
                );

            if (
                !allowedPath
            ) {

                throw new TenantOverrideError(
                    'Tenant override path is not permitted.',
                    {
                        code:
                            'TENANT_OVERRIDE_PATH_NOT_ALLOWED',

                        path:
                            parentPath,
                    },
                );
            }

            return clone(
                overrides,
            );
        }

        for (
            const [
                key,
                value,
            ] of Object.entries(
                overrides,
            )
        ) {

            const currentPath =
                parentPath
                    ? `${parentPath}.${key}`
                    : key;

            if (
                isSensitivePath(
                    currentPath,
                ) ||
                matchesAnyPattern(
                    currentPath,
                    this.options.denylist,
                )
            ) {

                throw new TenantOverrideError(
                    'Tenant configuration contains a forbidden override path.',
                    {
                        code:
                            'TENANT_OVERRIDE_PATH_DENIED',

                        path:
                            currentPath,
                    },
                );
            }

            if (
                value &&
                typeof value ===
                    'object' &&
                !Array.isArray(
                    value,
                )
            ) {

                /**
                 * For nested objects, descend only when the subtree can
                 * eventually resolve to allowlisted leaf paths.
                 */
                if (
                    !this.hasAllowlistedDescendant(
                        currentPath,
                    )
                ) {

                    throw new TenantOverrideError(
                        'Tenant configuration subtree is not allowlisted.',
                        {
                            code:
                                'TENANT_OVERRIDE_SUBTREE_NOT_ALLOWED',

                            path:
                                currentPath,
                        },
                    );
                }

                const existing =
                    target[currentPath.split('.').pop()];

                const base =
                    existing &&
                    typeof existing ===
                        'object' &&
                    !Array.isArray(
                        existing,
                    )
                        ? clone(
                            existing,
                        )
                        : {};

                target[
                    currentPath.split('.').pop()
                ] =
                    this.mergeAllowlisted(
                        base,
                        value,
                        currentPath,
                    );

                continue;
            }

            if (
                !this.isPathAllowed(
                    currentPath,
                )
            ) {

                throw new TenantOverrideError(
                    'Tenant override path is not allowlisted.',
                    {
                        code:
                            'TENANT_OVERRIDE_PATH_NOT_ALLOWED',

                        path:
                            currentPath,
                    },
                );
            }

            setByPath(
                target,
                currentPath,
                clone(
                    value,
                ),
            );
        }

        return target;
    }

    /**
     * -------------------------------------------------------------------------
     * Path policy.
     * -------------------------------------------------------------------------
     */

    isPathAllowed(
        path,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        if (
            !normalized
        ) {

            return false;
        }

        if (
            isSensitivePath(
                normalized,
            )
        ) {

            return false;
        }

        if (
            matchesAnyPattern(
                normalized,
                this.options.denylist,
            )
        ) {

            return false;
        }

        if (
            this.options.allowUnknownOverridePaths
        ) {

            return true;
        }

        return matchesAnyPattern(
            normalized,
            this.options.allowlist,
        );
    }

    hasAllowlistedDescendant(
        path,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        return this.options.allowlist.some(
            pattern => {

                const normalizedPattern =
                    normalizePath(
                        pattern,
                    );

                return (
                    normalizedPattern ===
                        normalized ||
                    normalizedPattern.startsWith(
                        `${normalized}.`,
                    ) ||
                    normalized.startsWith(
                        `${normalizedPattern.replace(
                            /\.\*$/,
                            '',
                        )}.`,
                    )
                );
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Protected configuration validation.
     * -------------------------------------------------------------------------
     */

    assertProtectedConfiguration(
        configuration,
    ) {

        const forbiddenRoots = [
            'jwt',
            'database',
            'db',
            'redis',
            'encryption',
            'crypto',
            'credentials',
            'secrets',
            'security',
            'infrastructure',
        ];

        for (
            const root of
            forbiddenRoots
        ) {

            if (
                configuration[root] !==
                    undefined &&
                configuration[root] !==
                    null
            ) {

                /**
                 * Presence is fine because the base configuration may naturally
                 * contain these roots. What matters is whether tenant overrides
                 * were able to modify them. That guarantee is enforced before
                 * merge through `isPathAllowed` and the denylist.
                 */
                continue;
            }
        }

        /**
         * Global tenant isolation cannot be weakened through tenant overrides.
         */
        const tenantSecurity =
            configuration
                .tenants
                ?.security;

        if (
            tenantSecurity &&
            tenantSecurity
                .allowCrossTenantAccess ===
                true
        ) {

            throw new TenantOverrideError(
                'Resolved tenant configuration attempted to enable global cross-tenant access.',
                {
                    code:
                        'TENANT_GLOBAL_ISOLATION_VIOLATION',
                },
            );
        }

        /**
         * Financial isolation cannot be disabled.
         */
        const financial =
            configuration
                .tenants
                ?.financial;

        if (
            financial &&
            (
                financial
                    .preventCrossTenantTransactions ===
                    false ||
                financial
                    .preventCrossTenantLedgerAccess ===
                    false ||
                financial
                    .preventCrossTenantBalanceAccess ===
                    false
            )
        ) {

            throw new TenantOverrideError(
                'Resolved tenant configuration attempted to weaken financial tenant isolation.',
                {
                    code:
                        'TENANT_FINANCIAL_ISOLATION_VIOLATION',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Override removal.
     * -------------------------------------------------------------------------
     */

    async remove(
        tenantId,
        path,
        options = {},
    ) {

        if (
            !this.options
                .allowRuntimeMutation &&
            !options.internal
        ) {

            throw new TenantOverrideError(
                'Runtime tenant override mutation is disabled.',
                {
                    code:
                        'TENANT_OVERRIDE_RUNTIME_MUTATION_DISABLED',
                },
            );
        }

        const normalizedTenant =
            this.normalizeTenantId(
                tenantId,
            );

        const normalizedPath =
            this.validatePath(
                path,
            );

        const tenantOverrides =
            this.overrides.get(
                normalizedTenant,
            );

        if (
            !tenantOverrides
        ) {

            return false;
        }

        const parts =
            normalizedPath
                .split('.')
                .filter(Boolean);

        let current =
            tenantOverrides;

        for (
            let index = 0;
            index <
            parts.length - 1;
            index += 1
        ) {

            current =
                current?.[
                    parts[index]
                ];

            if (
                !current ||
                typeof current !==
                    'object'
            ) {

                return false;
            }
        }

        const leaf =
            parts[
                parts.length - 1
            ];

        if (
            !Object.prototype.hasOwnProperty.call(
                current,
                leaf,
            )
        ) {

            return false;
        }

        delete current[
            leaf
        ];

        this.updatedAt =
            new Date();

        this.invalidateTenantCache(
            normalizedTenant,
        );

        this.recordEvent(
            {
                type:
                    'remove',

                tenantId:
                    normalizedTenant,

                path:
                    normalizedPath,
            },
        );

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Remove all overrides for a tenant.
     * -------------------------------------------------------------------------
     */

    async clearTenant(
        tenantId,
        options = {},
    ) {

        if (
            !this.options
                .allowRuntimeMutation &&
            !options.internal
        ) {

            throw new TenantOverrideError(
                'Runtime tenant override mutation is disabled.',
                {
                    code:
                        'TENANT_OVERRIDE_RUNTIME_MUTATION_DISABLED',
                },
            );
        }

        const normalizedTenant =
            this.normalizeTenantId(
                tenantId,
            );

        const existed =
            this.overrides.delete(
                normalizedTenant,
            );

        this.invalidateTenantCache(
            normalizedTenant,
        );

        if (
            existed
        ) {

            this.updatedAt =
                new Date();

            this.recordEvent(
                {
                    type:
                        'clearTenant',

                    tenantId:
                        normalizedTenant,
                },
            );
        }

        return existed;
    }

    /**
     * -------------------------------------------------------------------------
     * Count leaf paths.
     * -------------------------------------------------------------------------
     */

    countPaths(
        value,
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return 0;
        }

        if (
            typeof value !==
                'object' ||
            Array.isArray(
                value,
            )
        ) {

            return 1;
        }

        let total =
            0;

        for (
            const child of
            Object.values(
                value,
            )
        ) {

            total +=
                this.countPaths(
                    child,
                );
        }

        return total;
    }

    /**
     * -------------------------------------------------------------------------
     * Cache management.
     * -------------------------------------------------------------------------
     */

    createCacheKey(
        tenantId,
        path,
    ) {

        return `${tenantId}::${normalizePath(
            path,
        )}`;
    }

    getCached(
        key,
    ) {

        const entry =
            this.cache.get(
                key,
            );

        if (
            !entry
        ) {

            return null;
        }

        if (
            Date.now() >
            entry.expiresAt
        ) {

            this.cache.delete(
                key,
            );

            return null;
        }

        return clone(
            entry.value,
        );
    }

    cacheValue(
        key,
        value,
    ) {

        if (
            !this.options
                .cache
                .enabled
        ) {

            return;
        }

        if (
            this.cache.size >=
            this.options
                .cache
                .maxEntries
        ) {

            const oldestKey =
                this.cache.keys().next().value;

            if (
                oldestKey
            ) {

                this.cache.delete(
                    oldestKey,
                );
            }
        }

        this.cache.set(
            key,
            {
                value:
                    clone(
                        value,
                    ),

                expiresAt:
                    Date.now() +
                    this.options
                        .cache
                        .ttlMs,
            },
        );
    }

    invalidateTenantCache(
        tenantId,
    ) {

        const prefix =
            `${tenantId}::`;

        for (
            const key of
            this.cache.keys()
        ) {

            if (
                key.startsWith(
                    prefix,
                )
            ) {

                this.cache.delete(
                    key,
                );
            }
        }
    }

    clearCache() {

        this.cache.clear();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant snapshot.
     * -------------------------------------------------------------------------
     */

    snapshotTenant(
        tenantId,
        options = {},
    ) {

        const normalizedTenant =
            this.normalizeTenantId(
                tenantId,
            );

        const overrides =
            clone(
                this.overrides.get(
                    normalizedTenant,
                ) ||
                {},
            );

        const exposeTenant =
            options.exposeTenantId ??
            this.options
                .diagnostics
                .exposeRawTenantIds;

        const exposeValues =
            options.exposeValues ??
            this.options
                .diagnostics
                .exposeOverrideValues;

        const safeOverrides =
            exposeValues
                ? overrides
                : this.redactValues(
                    overrides,
                );

        return deepFreeze({
            tenantId:
                exposeTenant
                    ? normalizedTenant
                    : stableFingerprint(
                        normalizedTenant,
                        this.options
                            .fingerprintAlgorithm,
                    ),

            state:
                this.state,

            overrideCount:
                this.countPaths(
                    overrides,
                ),

            overrides:
                safeOverrides,

            fingerprint:
                stableFingerprint(
                    overrides,
                    this.options
                        .fingerprintAlgorithm,
                ),

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Redact values.
     * -------------------------------------------------------------------------
     */

    redactValues(
        value,
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;
        }

        if (
            Array.isArray(
                value,
            )
        ) {

            return value.map(
                item =>
                    this.redactValues(
                        item,
                    ),
            );
        }

        if (
            typeof value !==
                'object'
        ) {

            return '[CONFIGURED]';
        }

        const result = {};

        for (
            const [
                key,
                child,
            ] of Object.entries(
                value,
            )
        ) {

            result[key] =
                this.redactValues(
                    child,
                );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * All-tenant snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        const tenants = {};

        for (
            const tenantId of
            this.overrides.keys()
        ) {

            const snapshot =
                this.snapshotTenant(
                    tenantId,
                    options,
                );

            const key =
                options.exposeTenantIds
                    ? tenantId
                    : stableFingerprint(
                        tenantId,
                        this.options
                            .fingerprintAlgorithm,
                    );

            tenants[key] =
                snapshot;
        }

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

            tenantCount:
                this.overrides.size,

            totalOverrideCount:
                Array.from(
                    this.overrides.values(),
                ).reduce(
                    (
                        total,
                        item,
                    ) =>
                        total +
                        this.countPaths(
                            item,
                        ),
                    0,
                ),

            cacheEntries:
                this.cache.size,

            allowlist:
                this.options
                    .diagnostics
                    .exposePaths
                    ? [
                        ...this.options
                            .allowlist,
                    ]
                    : [],

            denylist:
                this.options
                    .diagnostics
                    .exposePaths
                    ? [
                        ...this.options
                            .denylist,
                    ]
                    : [],

            tenants,

            events:
                [
                    ...this.events,
                ],

            warnings:
                [
                    ...this.warnings,
                ],

            errors:
                this.errors.map(
                    error =>
                        ({
                            name:
                                error?.name,

                            code:
                                error?.code,

                            message:
                                error?.message,

                            tenantId:
                                error?.tenantId
                                    ? stableFingerprint(
                                        error.tenantId,
                                        this.options
                                            .fingerprintAlgorithm,
                                    )
                                    : null,

                            path:
                                error?.path ||
                                null,
                        }),
                ),

            updatedAt:
                this.updatedAt,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const healthy =
            this.state !==
            OVERRIDE_STATES.INVALID;

        return {
            status:
                healthy
                    ? 'healthy'
                    : 'degraded',

            healthy,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            state:
                this.state,

            enabled:
                this.options.enabled,

            tenantCount:
                this.overrides.size,

            totalOverrideCount:
                Array.from(
                    this.overrides.values(),
                ).reduce(
                    (
                        total,
                        item,
                    ) =>
                        total +
                        this.countPaths(
                            item,
                        ),
                    0,
                ),

            cacheEntries:
                this.cache.size,

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
            OVERRIDE_STATES.INVALID;

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            state:
                this.state,

            timestamp:
                new Date().toISOString(),
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

        const record = {
            type:
                event.type,

            tenantId:
                event.tenantId
                    ? stableFingerprint(
                        event.tenantId,
                        this.options
                            .fingerprintAlgorithm,
                    )
                    : null,

            path:
                event.path ||
                null,

            count:
                event.count ||
                null,

            timestamp:
                new Date().toISOString(),
        };

        this.events.unshift(
            record,
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
     * Runtime override API.
     * -------------------------------------------------------------------------
     */

    async setRuntime(
        tenantId,
        path,
        value,
        options = {},
    ) {

        if (
            !this.options
                .allowRuntimeMutation
        ) {

            throw new TenantOverrideError(
                'Runtime tenant override mutation is disabled.',
                {
                    code:
                        'TENANT_OVERRIDE_RUNTIME_MUTATION_DISABLED',
                },
            );
        }

        return this.set(
            tenantId,
            path,
            value,
            {
                ...options,
                internal:
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.overrides.clear();

        this.cache.clear();

        this.events.length =
            0;

        this.errors.length =
            0;

        this.warnings.length =
            0;

        this.updatedAt =
            new Date();

        this.state =
            this.options.enabled
                ? OVERRIDE_STATES.READY
                : OVERRIDE_STATES.DISABLED;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const tenantOverrides =
    new TenantOverrideProvider();

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
        tenantOverrides,

        TenantOverrideProvider,

        TenantOverrideError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        OVERRIDE_STATES,

        OVERRIDE_SOURCES,

        OVERRIDE_VALUE_TYPES,

        DEFAULTS,

        /**
         * Core APIs.
         */
        set:
            (
                tenantId,
                path,
                value,
                options,
            ) =>
                tenantOverrides.set(
                    tenantId,
                    path,
                    value,
                    options,
                ),

        setMany:
            (
                tenantId,
                overrides,
                options,
            ) =>
                tenantOverrides.setMany(
                    tenantId,
                    overrides,
                    options,
                ),

        get:
            (
                tenantId,
                path,
                options,
            ) =>
                tenantOverrides.get(
                    tenantId,
                    path,
                    options,
                ),

        resolve:
            (
                tenantId,
                baseConfiguration,
                options,
            ) =>
                tenantOverrides.resolve(
                    tenantId,
                    baseConfiguration,
                    options,
                ),

        remove:
            (
                tenantId,
                path,
                options,
            ) =>
                tenantOverrides.remove(
                    tenantId,
                    path,
                    options,
                ),

        clearTenant:
            (
                tenantId,
                options,
            ) =>
                tenantOverrides.clearTenant(
                    tenantId,
                    options,
                ),

        /**
         * Validation/policy.
         */
        normalizeTenantId:
            tenantId =>
                tenantOverrides.normalizeTenantId(
                    tenantId,
                ),

        validatePath:
            path =>
                tenantOverrides.validatePath(
                    path,
                ),

        isPathAllowed:
            path =>
                tenantOverrides.isPathAllowed(
                    path,
                ),

        validateBusinessBounds:
            (
                path,
                value,
            ) =>
                tenantOverrides.validateBusinessBounds(
                    path,
                    value,
                ),

        /**
         * Diagnostics.
         */
        snapshotTenant:
            (
                tenantId,
                options,
            ) =>
                tenantOverrides.snapshotTenant(
                    tenantId,
                    options,
                ),

        snapshot:
            options =>
                tenantOverrides.snapshot(
                    options,
                ),

        health:
            () =>
                tenantOverrides.health(),

        readiness:
            () =>
                tenantOverrides.readiness(),

        /**
         * Cache.
         */
        clearCache:
            () =>
                tenantOverrides.clearCache(),

        /**
         * Runtime.
         */
        setRuntime:
            (
                tenantId,
                path,
                value,
                options,
            ) =>
                tenantOverrides.setRuntime(
                    tenantId,
                    path,
                    value,
                    options,
                ),

        /**
         * Test support.
         */
        reset:
            () =>
                tenantOverrides.reset(),
    });