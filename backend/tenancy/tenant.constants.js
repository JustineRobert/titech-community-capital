'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenancy Constants & Helpers
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.constants.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical tenancy configuration, constants, validation helpers and naming
 * utilities for the TITech Community Capital multi-tenant platform.
 *
 * Design goals
 * ----------------------------------------------------------------------------
 * - Strong tenant identity validation.
 * - No silent tenant-identity rewriting during authorization.
 * - Safe environment configuration parsing.
 * - Explicit tenancy-mode validation.
 * - Safe cache key generation.
 * - Safe SQL identifier generation for supported tenancy strategies.
 * - Tenant-aware observability helpers.
 * - Domain/subdomain tenant resolution.
 * - Production fail-closed behavior for invalid tenancy configuration.
 * - Stable CommonJS compatibility.
 *
 * Security model
 * ----------------------------------------------------------------------------
 *
 * IMPORTANT:
 *
 * A tenant ID received from:
 *
 *   - HTTP headers
 *   - query parameters
 *   - request body
 *   - hostname
 *
 * is NOT automatically a trusted tenant identity.
 *
 * Authentication / tenant authorization middleware must establish the
 * authoritative tenant context before financial or sensitive operations.
 *
 * This module only provides configuration and deterministic helper functions.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

/* eslint-disable no-console */

/**
 * ============================================================================
 * Internal Helpers
 * ============================================================================
 */

function toUpper(
    value,
    fallback = ''
) {
    if (
        typeof value !==
        'string'
    ) {
        return fallback;
    }

    return value
        .trim()
        .toUpperCase();
}

function toLower(
    value,
    fallback = ''
) {
    if (
        typeof value !==
        'string'
    ) {
        return fallback;
    }

    return value
        .trim()
        .toLowerCase();
}

function ensureString(
    value,
    fallback = ''
) {
    return (
        value ===
            null ||
        value ===
            undefined
    )
        ? fallback
        : String(value);
}

function parseBoolean(
    value,
    fallback = false
) {
    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ''
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
        toLower(
            String(value)
        );

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

function parsePositiveInteger(
    value,
    fallback,
    {
        min = 1,
        max = Number.MAX_SAFE_INTEGER,
    } = {}
) {
    const parsed =
        Number(value);

    if (
        !Number.isSafeInteger(
            parsed
        ) ||
        parsed < min ||
        parsed > max
    ) {
        return fallback;
    }

    return parsed;
}

function parseNonNegativeInteger(
    value,
    fallback,
    {
        max = Number.MAX_SAFE_INTEGER,
    } = {}
) {
    const parsed =
        Number(value);

    if (
        !Number.isSafeInteger(
            parsed
        ) ||
        parsed < 0 ||
        parsed > max
    ) {
        return fallback;
    }

    return parsed;
}

function parseStringList(
    value
) {
    if (
        typeof value !==
        'string'
    ) {
        return [];
    }

    return Array.from(
        new Set(
            value
                .split(',')
                .map(
                    item =>
                        item
                            .trim()
                            .toLowerCase()
                )
                .filter(Boolean)
        )
    );
}

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
 * Raw Environment Configuration
 * ============================================================================
 */

const RAW_NODE_ENV =
    toUpper(
        process.env.NODE_ENV,
        'DEVELOPMENT'
    );

const RAW_TENANCY_MODE =
    toUpper(
        process.env.TENANCY_MODE,
        'SCHEMA'
    );

/**
 * ============================================================================
 * Supported Tenancy Modes
 * ============================================================================
 */

const TENANCY_MODES =
    Object.freeze({
        SINGLE:
            'SINGLE',

        SCHEMA:
            'SCHEMA',

        DATABASE:
            'DATABASE',

        ISOLATED:
            'ISOLATED',

        HYBRID:
            'HYBRID',
    });

const VALID_TENANCY_MODES =
    Object.freeze(
        new Set(
            Object.values(
                TENANCY_MODES
            )
        )
    );

const isProductionEnvironment =
    RAW_NODE_ENV ===
    'PRODUCTION';

/**
 * ============================================================================
 * Tenant Identity Configuration
 * ============================================================================
 */

const DEFAULT_TENANT_ID =
    toLower(
        process.env.DEFAULT_TENANT,
        'public'
    );

const TENANT_ID_HEADER =
    toLower(
        process.env.TENANT_ID_HEADER,
        'x-tenant-id'
    );

const TENANT_ID_CLAIM =
    ensureString(
        process.env.TENANT_ID_CLAIM,
        'tenant_id'
    ).trim();

const TENANT_DOMAIN_HEADER =
    toLower(
        process.env.TENANT_DOMAIN_HEADER,
        'x-tenant-domain'
    );

const JWT_TENANT_CLAIM =
    ensureString(
        process.env.JWT_TENANT_CLAIM,
        'titech_tenant'
    ).trim();

const TENANT_ID_PATTERN =
    ensureString(
        process.env.TENANT_ID_REGEX,
        '^[a-z0-9-]{3,64}$'
    ).trim();

/**
 * Compile validation regex once.
 *
 * Invalid production configuration is fatal rather than silently replaced.
 */
let TENANT_ID_REGEX;

try {
    TENANT_ID_REGEX =
        new RegExp(
            TENANT_ID_PATTERN
        );
} catch (
    error
) {
    if (
        isProductionEnvironment
    ) {
        throw new Error(
            `[TITech Tenancy] Invalid TENANT_ID_REGEX configuration: ${error.message}`
        );
    }

    TENANT_ID_REGEX =
        /^[a-z0-9-]{3,64}$/;
}

/**
 * ============================================================================
 * Database Identifier Configuration
 * ============================================================================
 */

const DB_TABLE_PREFIX =
    ensureString(
        process.env.DB_TABLE_PREFIX,
        'titech_'
    ).trim();

const DB_SCHEMA_PREFIX =
    ensureString(
        process.env.DB_SCHEMA_PREFIX,
        'titech_'
    ).trim();

const DB_NAME_PREFIX =
    ensureString(
        process.env.DB_NAME_PREFIX,
        'titech_'
    ).trim();

const MIGRATION_TABLE =
    ensureString(
        process.env.MIGRATION_TABLE,
        'titech_migrations'
    ).trim();

/**
 * ============================================================================
 * Cache Configuration
 * ============================================================================
 */

const CACHE_TTL_SECONDS =
    parsePositiveInteger(
        process.env.CACHE_TTL_SECONDS,
        300,
        {
            min:
                1,

            max:
                86400 * 30,
        }
    );

const CACHE_KEY_PREFIX =
    ensureString(
        process.env.CACHE_KEY_PREFIX,
        'titech:tenant:'
    ).trim();

/**
 * ============================================================================
 * Rate Limiting Configuration
 * ============================================================================
 */

const RATE_LIMIT_WINDOW_MS =
    parsePositiveInteger(
        process.env.RATE_LIMIT_WINDOW_MS,
        60_000,
        {
            min:
                1_000,

            max:
                86_400_000,
        }
    );

const RATE_LIMIT_MAX =
    parsePositiveInteger(
        process.env.RATE_LIMIT_MAX,
        600,
        {
            min:
                1,

            max:
                1_000_000,
        }
    );

/**
 * ============================================================================
 * Logging / Metrics
 * ============================================================================
 */

const LOG_LEVEL =
    ensureString(
        process.env.LOG_LEVEL,
        isProductionEnvironment
            ? 'info'
            : 'debug'
    )
        .trim()
        .toLowerCase();

const METRICS_PREFIX =
    ensureString(
        process.env.METRICS_PREFIX,
        'titech.tenancy'
    ).trim();

const HEALTHCHECK_PATH =
    ensureString(
        process.env.HEALTHCHECK_PATH,
        '/health/tenancy'
    ).trim();

/**
 * ============================================================================
 * Domain Configuration
 * ============================================================================
 */

const ALLOWED_TENANT_DOMAINS =
    parseStringList(
        process.env.ALLOWED_TENANT_DOMAINS
    );

/**
 * Strict domain validation.
 *
 * Example valid:
 *   tenant.titech.example
 *
 * Example rejected:
 *   tenant..titech.example
 *   tenant/titech.example
 *   attacker@titech.example
 */
const DOMAIN_LABEL_REGEX =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const HOSTNAME_REGEX =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * ============================================================================
 * Migration Configuration
 * ============================================================================
 */

const MIGRATION_STRATEGY =
    toLower(
        process.env.MIGRATION_STRATEGY,
        'per-tenant'
    );

const MIGRATION_STRATEGIES =
    Object.freeze({
        CENTRAL:
            'central',

        PER_TENANT:
            'per-tenant',
    });

const MIGRATION_PARALLEL_BATCH_SIZE =
    parsePositiveInteger(
        process.env.MIGRATION_PARALLEL_BATCH_SIZE,
        10,
        {
            min:
                1,

            max:
                100,
        }
    );

const MIGRATION_TIMEOUT_MS =
    parsePositiveInteger(
        process.env.MIGRATION_TIMEOUT_MS,
        10 * 60 * 1000,
        {
            min:
                1_000,

            max:
                60 * 60 * 1000,
        }
    );

/**
 * ============================================================================
 * Health Configuration
 * ============================================================================
 */

const HEALTH_CHECK_TIMEOUT_MS =
    parsePositiveInteger(
        process.env.TENANT_HEALTH_CHECK_TIMEOUT_MS,
        5_000,
        {
            min:
                100,

            max:
                60_000,
        }
    );

/**
 * ============================================================================
 * Feature Flags
 * ============================================================================
 *
 * Fixed an important bug from the original implementation:
 *
 *   process.env.X === 'true' || true
 *
 * always evaluates to true.
 * ============================================================================
 */

const FEATURE_FLAGS =
    Object.freeze({
        PER_TENANT_CACHE:
            parseBoolean(
                process.env.FEATURE_PER_TENANT_CACHE,
                true
            ),

        TENANT_SELF_REGISTRATION:
            parseBoolean(
                process.env.FEATURE_TENANT_SELF_REGISTRATION,
                false
            ),

        TENANT_DOMAIN_RESOLUTION:
            parseBoolean(
                process.env.FEATURE_TENANT_DOMAIN_RESOLUTION,
                true
            ),

        TENANT_HEADER_RESOLUTION:
            parseBoolean(
                process.env.FEATURE_TENANT_HEADER_RESOLUTION,
                true
            ),

        TENANT_JWT_RESOLUTION:
            parseBoolean(
                process.env.FEATURE_TENANT_JWT_RESOLUTION,
                true
            ),
    });

/**
 * ============================================================================
 * Runtime Configuration Validation
 * ============================================================================
 */

function validateConfiguration() {
    const errors =
        [];

    if (
        !VALID_TENANCY_MODES.has(
            RAW_TENANCY_MODE
        )
    ) {
        errors.push(
            `Unsupported TENANCY_MODE "${RAW_TENANCY_MODE}".`
        );
    }

    if (
        !DEFAULT_TENANT_ID
    ) {
        errors.push(
            'DEFAULT_TENANT must not be empty.'
        );
    }

    if (
        DEFAULT_TENANT_ID.length >
        64
    ) {
        errors.push(
            'DEFAULT_TENANT exceeds the maximum tenant ID length of 64.'
        );
    }

    if (
        !isValidTenantIdFormat(
            DEFAULT_TENANT_ID
        )
    ) {
        errors.push(
            `DEFAULT_TENANT "${DEFAULT_TENANT_ID}" does not match TENANT_ID_REGEX.`
        );
    }

    for (
        const [
            name,
            value,
        ] of [
            [
                'TENANT_ID_HEADER',
                TENANT_ID_HEADER,
            ],
            [
                'TENANT_ID_CLAIM',
                TENANT_ID_CLAIM,
            ],
            [
                'TENANT_DOMAIN_HEADER',
                TENANT_DOMAIN_HEADER,
            ],
            [
                'JWT_TENANT_CLAIM',
                JWT_TENANT_CLAIM,
            ],
        ]
    ) {
        if (
            !isSafeConfigKey(
                value
            )
        ) {
            errors.push(
                `${name} contains unsupported characters.`
            );
        }
    }

    if (
        !isSafeIdentifierPrefix(
            DB_TABLE_PREFIX
        )
    ) {
        errors.push(
            'DB_TABLE_PREFIX contains unsupported database identifier characters.'
        );
    }

    if (
        !isSafeIdentifierPrefix(
            DB_SCHEMA_PREFIX
        )
    ) {
        errors.push(
            'DB_SCHEMA_PREFIX contains unsupported database identifier characters.'
        );
    }

    if (
        !isSafeIdentifierPrefix(
            DB_NAME_PREFIX
        )
    ) {
        errors.push(
            'DB_NAME_PREFIX contains unsupported database identifier characters.'
        );
    }

    if (
        !isSafeDatabaseIdentifier(
            MIGRATION_TABLE
        )
    ) {
        errors.push(
            'MIGRATION_TABLE is not a safe database identifier.'
        );
    }

    if (
        !Object.values(
            MIGRATION_STRATEGIES
        ).includes(
            MIGRATION_STRATEGY
        )
    ) {
        errors.push(
            `Unsupported MIGRATION_STRATEGY "${MIGRATION_STRATEGY}".`
        );
    }

    if (
        ALLOWED_TENANT_DOMAINS.some(
            domain =>
                !isValidHostname(
                    domain
                )
        )
    ) {
        errors.push(
            'ALLOWED_TENANT_DOMAINS contains an invalid hostname.'
        );
    }

    if (
        errors.length
    ) {
        const message =
            `[TITech Tenancy] Invalid configuration:\n- ${errors.join(
                '\n- '
            )}`;

        if (
            isProductionEnvironment
        ) {
            throw new Error(
                message
            );
        }

        /**
         * Development/test environments may continue so unit tests can
         * inspect configuration, but the caller can still observe the
         * configuration errors.
         */
        console.warn(
            message
        );
    }
}

validateConfiguration();

/**
 * ============================================================================
 * Effective Tenancy Mode
 * ============================================================================
 */

function getTenancyMode() {
    if (
        VALID_TENANCY_MODES.has(
            RAW_TENANCY_MODE
        )
    ) {
        return RAW_TENANCY_MODE;
    }

    /**
     * Never silently degrade production to SINGLE tenancy.
     */
    if (
        isProductionEnvironment
    ) {
        throw new Error(
            `[TITech Tenancy] Invalid tenancy mode "${RAW_TENANCY_MODE}" in production.`
        );
    }

    return TENANCY_MODES.SCHEMA;
}

/**
 * ============================================================================
 * Tenancy State
 * ============================================================================
 */

function tenancyEnabled() {
    return (
        getTenancyMode() !==
        TENANCY_MODES.SINGLE
    );
}

/**
 * ============================================================================
 * Tenant ID Validation
 * ============================================================================
 *
 * SECURITY IMPORTANT:
 *
 * This validator does NOT sanitize or rewrite the value.
 *
 * A tenant identity received from a request should either:
 *   - pass validation exactly as supplied, or
 *   - be rejected.
 *
 * Silent rewriting can cause authorization ambiguity.
 * ============================================================================
 */

function isValidTenantId(
    tenantId
) {
    if (
        typeof tenantId !==
        'string'
    ) {
        return false;
    }

    const value =
        tenantId.trim();

    if (
        value.length <
            3 ||
        value.length >
            64
    ) {
        return false;
    }

    return isValidTenantIdFormat(
        value
    );
}

function isValidTenantIdFormat(
    tenantId
) {
    if (
        typeof tenantId !==
        'string'
    ) {
        return false;
    }

    const value =
        tenantId.trim();

    if (
        !value
    ) {
        return false;
    }

    /**
     * Avoid accepting partial regex matches from custom expressions.
     */
    TENANT_ID_REGEX.lastIndex =
        0;

    const match =
        TENANT_ID_REGEX.exec(
            value
        );

    return (
        Boolean(
            match
        ) &&
        match[0] ===
            value
    );
}

/**
 * ============================================================================
 * Tenant ID Normalization
 * ============================================================================
 *
 * Safe for trusted/internal values and persistence key construction.
 *
 * It is intentionally separate from `isValidTenantId()`.
 * ============================================================================
 */

function sanitizeTenantId(
    raw,
    {
        maxLength = 64,
        fallback = DEFAULT_TENANT_ID,
    } = {}
) {
    if (
        raw ===
            undefined ||
        raw ===
            null
    ) {
        return fallback;
    }

    const value =
        String(
            raw
        )
            .trim()
            .toLowerCase();

    if (
        !value
    ) {
        return fallback;
    }

    const cleaned =
        value
            .replace(
                /[^a-z0-9-]/g,
                '-'
            )
            .replace(
                /-+/g,
                '-'
            )
            .replace(
                /^-+/,
                ''
            )
            .replace(
                /-+$/,
                ''
            )
            .slice(
                0,
                maxLength
            );

    return (
        cleaned ||
        fallback
    );
}

/**
 * ============================================================================
 * Tenant Identity Assertion
 * ============================================================================
 */

function assertValidTenantId(
    tenantId
) {
    if (
        !isValidTenantId(
            tenantId
        )
    ) {
        const error =
            new TypeError(
                'Invalid tenant identifier.'
            );

        error.code =
            'INVALID_TENANT_ID';

        error.statusCode =
            400;

        throw error;
    }

    return tenantId;
}

/**
 * ============================================================================
 * Safe Database Identifier Helpers
 * ============================================================================
 */

function isSafeDatabaseIdentifier(
    value
) {
    return (
        typeof value ===
            'string' &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
            value
        )
    );
}

function isSafeIdentifierPrefix(
    value
) {
    return (
        typeof value ===
            'string' &&
        value.length > 0 &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
            value
        )
    );
}

function validateBaseTableName(
    baseTableName
) {
    const value =
        ensureString(
            baseTableName
        ).trim();

    if (
        !isSafeDatabaseIdentifier(
            value
        )
    ) {
        const error =
            new TypeError(
                `Invalid database table identifier "${value}".`
            );

        error.code =
            'INVALID_DATABASE_IDENTIFIER';

        throw error;
    }

    return value;
}

/**
 * ============================================================================
 * Database Naming Helpers
 * ============================================================================
 *
 * Only trusted/validated tenant identifiers should reach these helpers.
 * ============================================================================
 */

function tableNameForTenant(
    baseTableName,
    tenantId
) {
    const table =
        validateBaseTableName(
            baseTableName
        );

    const id =
        assertValidTenantId(
            tenantId
        );

    const result =
        `${DB_TABLE_PREFIX}${id}_${table}`;

    if (
        !isSafeDatabaseIdentifier(
            result
        )
    ) {
        throw new Error(
            'Generated tenant table name is invalid.'
        );
    }

    return result;
}

function schemaNameForTenant(
    tenantId
) {
    const id =
        assertValidTenantId(
            tenantId
        );

    const result =
        `${DB_SCHEMA_PREFIX}${id}`;

    if (
        !isSafeDatabaseIdentifier(
            result
        )
    ) {
        throw new Error(
            'Generated tenant schema name is invalid.'
        );
    }

    return result;
}

function databaseNameForTenant(
    tenantId
) {
    const id =
        assertValidTenantId(
            tenantId
        );

    const result =
        `${DB_NAME_PREFIX}${id}`;

    if (
        !isSafeDatabaseIdentifier(
            result
        )
    ) {
        throw new Error(
            'Generated tenant database name is invalid.'
        );
    }

    return result;
}

/**
 * ============================================================================
 * Cache Key Helpers
 * ============================================================================
 */

function tenantCacheKey(
    tenantId,
    suffix = ''
) {
    const id =
        assertValidTenantId(
            tenantId
        );

    const normalizedSuffix =
        ensureString(
            suffix
        )
            .trim()
            .replace(
                /^:+/,
                ''
            )
            .replace(
                /[^a-zA-Z0-9:_-]/g,
                '_'
            );

    return normalizedSuffix
        ? `${CACHE_KEY_PREFIX}${id}:${normalizedSuffix}`
        : `${CACHE_KEY_PREFIX}${id}`;
}

/**
 * ============================================================================
 * Tenant Cache Namespace
 * ============================================================================
 */

function tenantCacheNamespace(
    tenantId
) {
    return tenantCacheKey(
        tenantId
    );
}

/**
 * ============================================================================
 * Tenant Domain Helpers
 * ============================================================================
 */

function normalizeHostname(
    host
) {
    if (
        typeof host !==
        'string'
    ) {
        return null;
    }

    let hostname =
        host.trim().toLowerCase();

    /**
     * Support accidental trailing dot in fully-qualified hostnames.
     */
    hostname =
        hostname.replace(
            /\.$/,
            ''
        );

    /**
     * Remove one port suffix only when it is clearly a hostname:port form.
     * IPv6 literals are intentionally rejected for tenant-domain resolution.
     */
    const colonCount =
        (
            hostname.match(
                /:/g
            ) || []
        ).length;

    if (
        colonCount ===
        1
    ) {
        const parts =
            hostname.split(
                ':'
            );

        if (
            /^\d+$/.test(
                parts[1]
            )
        ) {
            hostname =
                parts[0];
        }
    }

    return (
        isValidHostname(
            hostname
        )
            ? hostname
            : null
    );
}

function isValidHostname(
    hostname
) {
    if (
        typeof hostname !==
        'string'
    ) {
        return false;
    }

    const value =
        hostname
            .trim()
            .toLowerCase()
            .replace(
                /\.$/,
                ''
            );

    if (
        !HOSTNAME_REGEX.test(
            value
        )
    ) {
        return false;
    }

    return value
        .split('.')
        .every(
            label =>
                DOMAIN_LABEL_REGEX.test(
                    label
                )
        );
}

function tenantIdFromHost(
    host
) {
    const hostname =
        normalizeHostname(
            host
        );

    if (
        !hostname ||
        !ALLOWED_TENANT_DOMAINS.length
    ) {
        return null;
    }

    for (
        const configuredDomain
        of ALLOWED_TENANT_DOMAINS
    ) {
        const domain =
            normalizeHostname(
                configuredDomain
            );

        if (
            !domain
        ) {
            continue;
        }

        if (
            hostname ===
            domain
        ) {
            continue;
        }

        const suffix =
            `.${domain}`;

        if (
            !hostname.endsWith(
                suffix
            )
        ) {
            continue;
        }

        const subdomain =
            hostname.slice(
                0,
                -suffix.length
            );

        /**
         * Only a single tenant label is accepted.
         *
         * This prevents:
         *
         *   a.b.titech.example
         *
         * from being interpreted ambiguously.
         */
        if (
            !subdomain ||
            subdomain.includes(
                '.'
            )
        ) {
            continue;
        }

        if (
            isValidTenantId(
                subdomain
            )
        ) {
            return subdomain;
        }
    }

    return null;
}

/**
 * ============================================================================
 * Tenant Identity Extraction
 * ============================================================================
 *
 * Returns candidates, not trust decisions.
 *
 * `trustedTenantIdFromRequest()` must still be based on authenticated claims or
 * a tenant authorization mechanism before the value is used for sensitive
 * operations.
 * ============================================================================
 */

function tenantCandidatesFromRequest(
    req
) {
    if (
        !req ||
        typeof req !==
            'object'
    ) {
        return [];
    }

    const candidates =
        [];

    const headerValue =
        req.headers?.[
            TENANT_ID_HEADER
        ];

    if (
        headerValue
    ) {
        candidates.push(
            {
                source:
                    'header',

                value:
                    String(
                        headerValue
                    ).trim(),
            }
        );
    }

    const claimValue =
        req.user?.[
            JWT_TENANT_CLAIM
        ] ||
        req.auth?.[
            JWT_TENANT_CLAIM
        ] ||
        req.user?.[
            TENANT_ID_CLAIM
        ] ||
        req.auth?.[
            TENANT_ID_CLAIM
        ];

    if (
        claimValue
    ) {
        candidates.push(
            {
                source:
                    'jwt',

                value:
                    String(
                        claimValue
                    ).trim(),
            }
        );
    }

    const domainValue =
        tenantIdFromHost(
            req.headers?.host
        );

    if (
        domainValue
    ) {
        candidates.push(
            {
                source:
                    'domain',

                value:
                    domainValue,
            }
        );
    }

    const requestTenant =
        req.tenantId ||
        req.tenant?.id ||
        req.tenant?.tenantId;

    if (
        requestTenant
    ) {
        candidates.push(
            {
                source:
                    'context',

                value:
                    String(
                        requestTenant
                    ).trim(),
            }
        );
    }

    return candidates;
}

/**
 * ============================================================================
 * Trusted Tenant Resolution Helper
 * ============================================================================
 *
 * This helper intentionally requires an existing authenticated/authorized
 * context. It does NOT treat a client header as sufficient proof of tenancy.
 * ============================================================================
 */

function trustedTenantIdFromRequest(
    req
) {
    const contextTenant =
        req?.adminContext?.tenantId ||
        req?.tenantContext?.tenantId ||
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?.tenantId;

    if (
        contextTenant &&
        isValidTenantId(
            String(
                contextTenant
            )
        )
    ) {
        return String(
            contextTenant
        ).trim().toLowerCase();
    }

    const jwtTenant =
        req?.user?.[
            JWT_TENANT_CLAIM
        ] ||
        req?.auth?.[
            JWT_TENANT_CLAIM
        ] ||
        req?.user?.[
            TENANT_ID_CLAIM
        ] ||
        req?.auth?.[
            TENANT_ID_CLAIM
        ];

    if (
        jwtTenant &&
        isValidTenantId(
            String(
                jwtTenant
            )
        )
    ) {
        return String(
            jwtTenant
        ).trim().toLowerCase();
    }

    /**
     * A header alone is intentionally insufficient for trusted operations.
     */
    return null;
}

/**
 * ============================================================================
 * Tenant Cache / Rate-Limit Identity Helpers
 * ============================================================================
 */

function tenantRateLimitKey(
    req,
    {
        fallbackToIp = true,
        includeActor = true,
    } = {}
) {
    const tenantId =
        trustedTenantIdFromRequest(
            req
        );

    const actorId =
        req?.user?.id ||
        req?.user?._id ||
        req?.user?.userId ||
        req?.auth?.userId;

    if (
        tenantId &&
        includeActor &&
        actorId
    ) {
        return (
            `rate:${tenantId}:actor:${sanitizeOpaqueIdentifier(
                actorId
            )}`
        );
    }

    if (
        tenantId
    ) {
        return `rate:${tenantId}`;
    }

    if (
        fallbackToIp
    ) {
        const ip =
            req?.ip ||
            req?.socket
                ?.remoteAddress ||
            req?.connection
                ?.remoteAddress ||
            'unknown';

        return `rate:ip:${sanitizeOpaqueIdentifier(
            ip
        )}`;
    }

    return 'rate:unknown';
}

function sanitizeOpaqueIdentifier(
    value
) {
    return ensureString(
        value,
        'unknown'
    )
        .trim()
        .replace(
            /[^a-zA-Z0-9._:-]/g,
            '_'
        )
        .slice(
            0,
            255
        );
}

/**
 * ============================================================================
 * Authentication Constants
 * ============================================================================
 */

const AUTH =
    Object.freeze({
        TENANT_CLAIM:
            JWT_TENANT_CLAIM,

        TENANT_HEADER:
            TENANT_ID_HEADER,

        TENANT_DOMAIN_HEADER:
            TENANT_DOMAIN_HEADER,

        TENANT_ID_CLAIM:
            TENANT_ID_CLAIM,

        HEADER_RESOLUTION_ENABLED:
            FEATURE_FLAGS
                .TENANT_HEADER_RESOLUTION,

        JWT_RESOLUTION_ENABLED:
            FEATURE_FLAGS
                .TENANT_JWT_RESOLUTION,

        DOMAIN_RESOLUTION_ENABLED:
            FEATURE_FLAGS
                .TENANT_DOMAIN_RESOLUTION,
    });

/**
 * ============================================================================
 * Rate Limit Constants
 * ============================================================================
 */

const RATE_LIMIT =
    Object.freeze({
        WINDOW_MS:
            RATE_LIMIT_WINDOW_MS,

        MAX:
            RATE_LIMIT_MAX,

        keyGenerator:
            tenantRateLimitKey,
    });

/**
 * ============================================================================
 * Migration Constants
 * ============================================================================
 */

const MIGRATION =
    Object.freeze({
        MIGRATION_TABLE,

        STRATEGY:
            MIGRATION_STRATEGY,

        PARALLEL_BATCH_SIZE:
            MIGRATION_PARALLEL_BATCH_SIZE,

        TIMEOUT_MS:
            MIGRATION_TIMEOUT_MS,
    });

/**
 * ============================================================================
 * Logging Constants
 * ============================================================================
 */

const LOGGING =
    Object.freeze({
        LEVEL:
            LOG_LEVEL,

        TENANT_LOG_PREFIX:
            'TITech.Tenancy',

        format(
            level,
            message,
            meta = {}
        ) {
            const timestamp =
                new Date()
                    .toISOString();

            const safeMeta =
                sanitizeLogMeta(
                    meta
                );

            return [
                timestamp,
                `[${String(
                    level
                ).toUpperCase()}]`,
                'TITech.Tenancy',
                '-',
                String(
                    message
                ),
                Object.keys(
                    safeMeta
                ).length
                    ? JSON.stringify(
                        safeMeta
                    )
                    : '',
            ]
                .join(
                    ' '
                )
                .trim();
        },
    });

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

    const sensitiveKeyPattern =
        /(password|secret|token|apikey|api_key|authorization|cookie|private.?key|credential)/i;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            meta
        )
    ) {
        if (
            sensitiveKeyPattern.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        /**
         * Keep log metadata shallow and bounded.
         */
        if (
            typeof value ===
                'string' &&
            value.length >
                1_000
        ) {
            result[key] =
                value.slice(
                    0,
                    1_000
                ) +
                '…';

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

const METRICS =
    Object.freeze({
        PREFIX:
            METRICS_PREFIX,

        tenantGauge(
            tenantId
        ) {
            const id =
                assertValidTenantId(
                    tenantId
                );

            return `${METRICS_PREFIX}.tenant.${id}.active`;
        },

        requestCounter(
            tenantId
        ) {
            const id =
                assertValidTenantId(
                    tenantId
                );

            return `${METRICS_PREFIX}.tenant.${id}.requests`;
        },

        errorCounter(
            tenantId
        ) {
            const id =
                assertValidTenantId(
                    tenantId
                );

            return `${METRICS_PREFIX}.tenant.${id}.errors`;
        },
    });

/**
 * ============================================================================
 * Health / Readiness
 * ============================================================================
 */

const HEALTH =
    Object.freeze({
        PATH:
            HEALTHCHECK_PATH,

        CHECK_TIMEOUT_MS:
            HEALTH_CHECK_TIMEOUT_MS,
    });

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS =
    Object.freeze({
        TENANCY_MODE:
            getTenancyMode(),

        DEFAULT_TENANT:
            DEFAULT_TENANT_ID,

        TENANT_ID_HEADER,

        TENANT_ID_CLAIM,

        TENANT_DOMAIN_HEADER,

        JWT_TENANT_CLAIM,

        CACHE_TTL_SECONDS,

        RATE_LIMIT_WINDOW_MS,

        RATE_LIMIT_MAX,

        LOG_LEVEL,

        CACHE_KEY_PREFIX,

        METRICS_PREFIX,

        HEALTHCHECK_PATH,
    });

/**
 * ============================================================================
 * Environment Snapshot
 * ============================================================================
 *
 * Expose normalized configuration instead of a raw process.env mirror.
 * ============================================================================
 */

const ENV =
    Object.freeze({
        NODE_ENV:
            RAW_NODE_ENV,

        TENANCY_MODE:
            getTenancyMode(),

        TENANT_ID_HEADER,

        TENANT_ID_CLAIM,

        TENANT_DOMAIN_HEADER,

        DEFAULT_TENANT:
            DEFAULT_TENANT_ID,

        TENANT_ID_REGEX:
            TENANT_ID_PATTERN,

        DB_TABLE_PREFIX,

        DB_SCHEMA_PREFIX,

        DB_NAME_PREFIX,

        MIGRATION_TABLE,

        JWT_TENANT_CLAIM,

        CACHE_TTL_SECONDS,

        CACHE_KEY_PREFIX,

        RATE_LIMIT_WINDOW_MS,

        RATE_LIMIT_MAX,

        LOG_LEVEL,

        METRICS_PREFIX,

        HEALTHCHECK_PATH,

        ALLOWED_TENANT_DOMAINS:
            Object.freeze(
                [
                    ...ALLOWED_TENANT_DOMAINS,
                ]
            ),

        TENANT_CACHE_STRICT:
            parseBoolean(
                process.env
                    .TENANT_CACHE_STRICT,
                false
            ),
    });

/**
 * ============================================================================
 * Tenant Cache Policy
 * ============================================================================
 */

const TENANT_CACHE =
    Object.freeze({
        TTL_SECONDS:
            CACHE_TTL_SECONDS,

        KEY_PREFIX:
            CACHE_KEY_PREFIX,

        STRICT:
            ENV
                .TENANT_CACHE_STRICT,

        PER_TENANT_ENABLED:
            FEATURE_FLAGS
                .PER_TENANT_CACHE,

        key(
            tenantId,
            suffix = ''
        ) {
            return tenantCacheKey(
                tenantId,
                suffix
            );
        },
    });

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Configuration
         */
        ENV,

        DEFAULTS,

        TENANCY_MODES,

        TENANT_ID_REGEX,

        AUTH,

        RATE_LIMIT,

        MIGRATION,

        LOGGING,

        METRICS,

        HEALTH,

        FEATURE_FLAGS,

        TENANT_CACHE,

        ALLOWED_TENANT_DOMAINS,

        /**
         * Tenant identity
         */
        sanitizeTenantId,

        isValidTenantId,

        assertValidTenantId,

        tenantCandidatesFromRequest,

        trustedTenantIdFromRequest,

        tenantIdFromHost,

        /**
         * Database naming
         */
        tableNameForTenant,

        schemaNameForTenant,

        databaseNameForTenant,

        isSafeDatabaseIdentifier,

        /**
         * Cache / rate-limit helpers
         */
        tenantCacheKey,

        tenantCacheNamespace,

        tenantRateLimitKey,

        /**
         * Runtime state
         */
        isProduction:
            isProductionEnvironment,

        tenancyEnabled,

        getTenancyMode,

        /**
         * Utility predicates
         */
        isPlainObject,

        isValidHostname,
    });