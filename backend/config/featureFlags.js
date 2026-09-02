'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/featureFlags.js
 *
 * Purpose:
 *   Enterprise production-grade feature flag configuration and evaluation
 *   boundary.
 *
 * Responsibilities:
 *   - Define centralized TITech feature flags.
 *   - Normalize environment-driven feature values.
 *   - Support boolean, percentage and environment-scoped rollout policies.
 *   - Support tenant/member/user/device targeting.
 *   - Keep financial safety features explicitly fail-closed.
 *   - Prevent accidental production activation of experimental capabilities.
 *   - Provide deterministic rollout decisions.
 *   - Provide immutable configuration.
 *   - Provide safe operational diagnostics.
 *   - Support compatibility with configProvider/bootstrapEnvironment.
 *
 * IMPORTANT:
 *
 *   This module defines FEATURE POLICY.
 *
 *   It does NOT:
 *     - execute business logic.
 *     - authorize users.
 *     - persist feature state.
 *     - call Redis.
 *     - call MongoDB.
 *     - initialize Express.
 *     - mutate process.env.
 *
 * Feature flags must NEVER bypass:
 *
 *   authentication
 *   authorization
 *   KYC/AML
 *   idempotency
 *   ledger integrity
 *   financial transaction validation
 *   audit requirements
 *
 * =============================================================================
 *
 * Feature lifecycle:
 *
 *   process.env
 *        ↓
 *   featureFlags.js
 *        ↓
 *   normalized immutable flag policy
 *        ↓
 *   application/configProvider
 *        ↓
 *   services
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional integrations
 * =============================================================================
 */

let startupErrors =
    null;

try {

    // eslint-disable-next-line global-require
    startupErrors =
        require('../bootstrap/startupErrors');

} catch {

    startupErrors =
        null;

}

let loggerModule =
    null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'feature-flags';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const FLAG_STATES =
    Object.freeze({

        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        CONDITIONAL:
            'conditional',

        EXPERIMENTAL:
            'experimental',

        DEPRECATED:
            'deprecated',

        KILL_SWITCH:
            'kill_switch',

    });

const FLAG_TYPES =
    Object.freeze({

        BOOLEAN:
            'boolean',

        PERCENTAGE:
            'percentage',

        ENVIRONMENT:
            'environment',

        TENANT:
            'tenant',

        USER:
            'user',

        DEVICE:
            'device',

        COMPOSITE:
            'composite',

    });

const ROLLOUT_STRATEGIES =
    Object.freeze({

        ALL:
            'all',

        NONE:
            'none',

        PERCENTAGE:
            'percentage',

        ALLOWLIST:
            'allowlist',

        ENVIRONMENT:
            'environment',

        TENANT:
            'tenant',

        USER:
            'user',

        DEVICE:
            'device',

        COMPOSITE:
            'composite',

    });

const ENVIRONMENTS =
    Object.freeze([
        'development',
        'test',
        'staging',
        'production',
    ]);

/**
 * =============================================================================
 * Safety classifications
 * =============================================================================
 *
 * These classifications prevent a generic feature toggle from becoming a
 * bypass for authoritative financial/security controls.
 * =============================================================================
 */

const FLAG_CLASSES =
    Object.freeze({

        PRESENTATION:
            'presentation',

        OPERATIONAL:
            'operational',

        INFRASTRUCTURE:
            'infrastructure',

        INTEGRATION:
            'integration',

        SECURITY:
            'security',

        COMPLIANCE:
            'compliance',

        FINANCIAL:
            'financial',

        EXPERIMENTAL:
            'experimental',

        DEPRECATED:
            'deprecated',

    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({

        enabled:
            true,

        strict:
            true,

        immutable:
            true,

        deterministicRollout:
            true,

        allowRuntimeOverrides:
            false,

        allowProductionExperiments:
            false,

        defaultPercentage:
            0,

        hashAlgorithm:
            'sha256',

        evaluationSalt:
            'titech',

        maxAllowlistEntries:
            10_000,

        maxFlags:
            1_000,

        diagnosticsEnabled:
            true,

        auditEvaluationFailures:
            true,

        /**
         * Safe evaluation fallback.
         *
         * A failed feature evaluation returns false rather than accidentally
         * enabling a protected feature.
         */
        evaluationFailureDefault:
            false,

    });

/**
 * =============================================================================
 * Default feature catalog
 * =============================================================================
 *
 * These defaults are deliberately conservative.
 *
 * Feature names use stable, lowercase, dot-separated identifiers.
 * =============================================================================
 */

const DEFAULT_FEATURES =
    Object.freeze({

        /**
         * -----------------------------------------------------------------------
         * Platform / runtime
         * -----------------------------------------------------------------------
         */

        'platform.observability':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.OPERATIONAL,

                environments:
                    Object.freeze([
                        'development',
                        'test',
                        'staging',
                        'production',
                    ]),
            }),

        'platform.metrics':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.OPERATIONAL,
            }),

        'platform.tracing':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.OPERATIONAL,
            }),

        'platform.resilience':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.OPERATIONAL,
            }),

        'platform.service-worker':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.DISABLED,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.EXPERIMENTAL,
            }),

        /**
         * -----------------------------------------------------------------------
         * Security / identity
         * -----------------------------------------------------------------------
         */

        'security.rate-limit':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.SECURITY,

                productionLocked:
                    true,
            }),

        'security.strict-cors':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.SECURITY,

                productionLocked:
                    true,
            }),

        'security.enhanced-headers':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.SECURITY,

                productionLocked:
                    true,
            }),

        'security.device-binding':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.SECURITY,
            }),

        /**
         * -----------------------------------------------------------------------
         * Finance / ledger
         * -----------------------------------------------------------------------
         *
         * These are never enabled by a generic percentage rollout alone.
         */

        'financial.idempotency':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        'financial.audit':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        'financial.atomic-transactions':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        'financial.ledger-validation':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        'financial.balance-cache':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.DISABLED,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,
            }),

        'financial.offline-posting':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        /**
         * -----------------------------------------------------------------------
         * KYC / AML / compliance
         * -----------------------------------------------------------------------
         */

        'compliance.kyc':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.COMPLIANCE,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        'compliance.aml':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.ENABLED,

                enabled:
                    true,

                defaultValue:
                    true,

                class:
                    FLAG_CLASSES.COMPLIANCE,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        /**
         * -----------------------------------------------------------------------
         * Integrations
         * -----------------------------------------------------------------------
         */

        'integration.mobile-money':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.CONDITIONAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.INTEGRATION,
            }),

        'integration.mtn-momo':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.CONDITIONAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.INTEGRATION,
            }),

        'integration.airtel-money':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.CONDITIONAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.INTEGRATION,
            }),

        'integration.stripe':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.CONDITIONAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.INTEGRATION,
            }),

        /**
         * -----------------------------------------------------------------------
         * Offline-first
         * -----------------------------------------------------------------------
         */

        'offline.enabled':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.EXPERIMENTAL,
            }),

        'offline.sync':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.EXPERIMENTAL,
            }),

        'offline.meeting-mode':
            Object.freeze({

                type:
                    FLAG_TYPES.BOOLEAN,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                class:
                    FLAG_CLASSES.FINANCIAL,

                productionLocked:
                    true,

                failClosed:
                    true,
            }),

        /**
         * -----------------------------------------------------------------------
         * Product rollout
         * -----------------------------------------------------------------------
         */

        'product.new-dashboard':
            Object.freeze({

                type:
                    FLAG_TYPES.PERCENTAGE,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                percentage:
                    0,

                class:
                    FLAG_CLASSES.PRESENTATION,
            }),

        'product.new-wallet-ui':
            Object.freeze({

                type:
                    FLAG_TYPES.PERCENTAGE,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                percentage:
                    0,

                class:
                    FLAG_CLASSES.PRESENTATION,
            }),

        'product.ai-insights':
            Object.freeze({

                type:
                    FLAG_TYPES.PERCENTAGE,

                state:
                    FLAG_STATES.EXPERIMENTAL,

                enabled:
                    false,

                defaultValue:
                    false,

                percentage:
                    0,

                class:
                    FLAG_CLASSES.EXPERIMENTAL,
            }),

    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class FeatureFlagError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'FeatureFlagError';

        this.code =
            options.code ||
            'FEATURE_FLAG_ERROR';

        this.flag =
            options.flag ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        this.cause =
            options.cause ||
            null;

        Error.captureStackTrace?.(
            this,
            this.constructor,
        );

    }

}

/**
 * =============================================================================
 * Utilities
 * =============================================================================
 */

function normalizeFlagName(
    value,
) {

    const normalized =
        String(
            value ||
                '',
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._-]/g,
                '-',
            )
            .replace(
                /-+/g,
                '-',
            )
            .replace(
                /\.{2,}/g,
                '.',
            )
            .replace(
                /^[-.]+|[-.]+$/g,
                '',
            );

    return normalized;

}

function normalizeEnvironment(
    value,
) {

    const normalized =
        String(
            value ||
                '',
        )
            .trim()
            .toLowerCase();

    return ENVIRONMENTS.includes(
        normalized,
    )
        ? normalized
        : 'development';

}

function normalizeIdentity(
    value,
) {

    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ''
    ) {

        return null;

    }

    return String(
        value,
    ).trim();

}

function toBoolean(
    value,
    fallback,
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

function toPercentage(
    value,
    fallback =
        0,
) {

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isFinite(
            parsed,
        )
    ) {

        return fallback;

    }

    return Math.min(
        100,
        Math.max(
            0,
            parsed,
        ),
    );

}

function toList(
    value,
    fallback = [],
) {

    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ''
    ) {

        return [
            ...fallback,
        ];

    }

    const values =
        Array.isArray(
            value,
        )
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            values
                .map(
                    item =>
                        String(
                            item,
                        ).trim(),
                )
                .filter(
                    Boolean,
                ),
        ),
    ];

}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !==
            'object'
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
        const key of
        Reflect.ownKeys(
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

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule
        );

    } catch {

        return null;

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
            logger &&
            typeof logger[level] ===
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

            return;

        }

    } catch {

        // Fallback to console.

    }

    const text =
        `[${COMPONENT}] ${message}`;

    if (
        level === 'error' ||
        level === 'fatal'
    ) {

        process.stderr.write(
            `${text}\n`,
        );

    } else {

        process.stdout.write(
            `${text}\n`,
        );

    }

}

/**
 * =============================================================================
 * Environment variable naming
 * =============================================================================
 *
 * Example:
 *
 *   platform.observability
 *       →
 *   TITEC_FF_PLATFORM_OBSERVABILITY
 *
 * =============================================================================
 */

function environmentVariableName(
    flagName,
) {

    return (
        'TITEC_FF_' +
        normalizeFlagName(
            flagName,
        )
            .replace(
                /\./g,
                '_',
            )
            .replace(
                /-/g,
                '_',
            )
            .toUpperCase()
    );

}

function percentageVariableName(
    flagName,
) {

    return (
        `${environmentVariableName(
            flagName,
        )}_PERCENTAGE`
    );

}

function allowlistVariableName(
    flagName,
) {

    return (
        `${environmentVariableName(
            flagName,
        )}_ALLOWLIST`
    );

}

function environmentScopeVariableName(
    flagName,
) {

    return (
        `${environmentVariableName(
            flagName,
        )}_ENVIRONMENTS`
    );

}

/**
 * =============================================================================
 * Deterministic rollout
 * =============================================================================
 */

function stableHash(
    value,
    salt,
    algorithm =
        DEFAULTS.hashAlgorithm,
) {

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            `${salt}:${value}`,
            'utf8',
        )
        .digest(
            'hex',
        );

}

function hashToBucket(
    value,
    salt,
) {

    const hash =
        stableHash(
            value,
            salt,
        );

    /**
     * Use the first 8 hex characters.
     * Produces a deterministic unsigned 32-bit value.
     */
    const integer =
        Number.parseInt(
            hash.slice(
                0,
                8,
            ),
            16,
        );

    return (
        integer /
        0xffffffff
    ) *
    100;

}

/**
 * =============================================================================
 * Flag normalization
 * =============================================================================
 */

function normalizeFlagDefinition(
    name,
    definition = {},
    options = {},
) {

    const normalizedName =
        normalizeFlagName(
            name,
        );

    if (
        !normalizedName
    ) {

        throw new FeatureFlagError(
            'Feature flag name must be non-empty.',
            {
                code:
                    'FEATURE_FLAG_NAME_INVALID',
            },
        );

    }

    const type =
        definition.type ||
        FLAG_TYPES.BOOLEAN;

    const allowedTypes =
        Object.values(
            FLAG_TYPES,
        );

    if (
        !allowedTypes.includes(
            type,
        )
    ) {

        throw new FeatureFlagError(
            `Unsupported feature flag type "${type}".`,
            {
                code:
                    'FEATURE_FLAG_TYPE_INVALID',

                flag:
                    normalizedName,
            },
        );

    }

    const state =
        definition.state ||
        (
            definition.experimental
                ? FLAG_STATES.EXPERIMENTAL
                : FLAG_STATES.ENABLED
        );

    const defaultValue =
        toBoolean(
            definition.defaultValue,
            false,
        );

    const percentage =
        toPercentage(
            definition.percentage,
            DEFAULTS.defaultPercentage,
        );

    const environments =
        toList(
            definition.environments,
            [],
        )
            .map(
                normalizeEnvironment,
            );

    const allowlist =
        toList(
            definition.allowlist,
            [],
        );

    const definitionResult = {

        name:
            normalizedName,

        type,

        state,

        class:
            definition.class ||
            FLAG_CLASSES.OPERATIONAL,

        enabled:
            toBoolean(
                definition.enabled,
                defaultValue,
            ),

        defaultValue,

        percentage,

        environments,

        allowlist,

        tenants:
            toList(
                definition.tenants,
                [],
            ),

        users:
            toList(
                definition.users,
                [],
            ),

        devices:
            toList(
                definition.devices,
                [],
            ),

        strategy:
            definition.strategy ||
            inferStrategy(
                {
                    ...definition,

                    type,
                },
            ),

        salt:
            definition.salt ||
            DEFAULTS.evaluationSalt,

        productionLocked:
            definition.productionLocked ===
            true,

        failClosed:
            definition.failClosed ===
            true,

        experimental:
            state ===
                FLAG_STATES.EXPERIMENTAL ||
            definition.experimental ===
                true,

        deprecated:
            state ===
                FLAG_STATES.DEPRECATED ||
            definition.deprecated ===
                true,

        killSwitch:
            state ===
                FLAG_STATES.KILL_SWITCH ||
            definition.killSwitch ===
                true,

        metadata:
            definition.metadata &&
            typeof definition.metadata ===
                'object'
                ? {
                    ...definition.metadata,
                }
                : {},

    };

    /**
     * Runtime environment override.
     */
    const enabledOverride =
        resolveEnvironmentBoolean(
            normalizedName,
            options.environmentSource ||
                process.env,
        );

    if (
        enabledOverride !==
            null
    ) {

        definitionResult.enabled =
            enabledOverride;

    }

    /**
     * Runtime percentage override.
     */
    const percentageOverride =
        resolveEnvironmentPercentage(
            normalizedName,
            options.environmentSource ||
                process.env,
        );

    if (
        percentageOverride !==
            null
    ) {

        definitionResult.percentage =
            percentageOverride;

    }

    /**
     * Environment-scoped override.
     */
    const environmentOverride =
        resolveEnvironmentList(
            normalizedName,
            options.environmentSource ||
                process.env,
        );

    if (
        environmentOverride.length >
        0
    ) {

        definitionResult.environments =
            environmentOverride;

    }

    /**
     * Allowlist override.
     */
    const allowlistOverride =
        resolveEnvironmentAllowlist(
            normalizedName,
            options.environmentSource ||
                process.env,
        );

    if (
        allowlistOverride.length >
        0
    ) {

        definitionResult.allowlist =
            allowlistOverride;

    }

    return Object.freeze(
        definitionResult,
    );

}

function inferStrategy(
    definition,
) {

    if (
        Array.isArray(
            definition.allowlist,
        ) &&
        definition.allowlist.length >
            0
    ) {

        return ROLLOUT_STRATEGIES.ALLOWLIST;

    }

    if (
        Number.isFinite(
            Number(
                definition.percentage,
            ),
        ) &&
        Number(
            definition.percentage,
        ) >
            0
    ) {

        return ROLLOUT_STRATEGIES.PERCENTAGE;

    }

    if (
        Array.isArray(
            definition.environments,
        ) &&
        definition.environments.length >
            0
    ) {

        return ROLLOUT_STRATEGIES.ENVIRONMENT;

    }

    return (
        definition.type ===
            FLAG_TYPES.BOOLEAN
            ? ROLLOUT_STRATEGIES.ALL
            : ROLLOUT_STRATEGIES.COMPOSITE
    );

}

/**
 * =============================================================================
 * Environment override helpers
 * =============================================================================
 */

function resolveEnvironmentBoolean(
    flagName,
    source,
) {

    const key =
        environmentVariableName(
            flagName,
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            source,
            key,
        )
    ) {

        return null;

    }

    return toBoolean(
        source[key],
        null,
    );

}

function resolveEnvironmentPercentage(
    flagName,
    source,
) {

    const key =
        percentageVariableName(
            flagName,
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            source,
            key,
        )
    ) {

        return null;

    }

    const parsed =
        Number(
            source[key],
        );

    if (
        !Number.isFinite(
            parsed,
        )
    ) {

        return null;

    }

    return toPercentage(
        parsed,
        null,
    );

}

function resolveEnvironmentList(
    flagName,
    source,
) {

    const key =
        environmentScopeVariableName(
            flagName,
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            source,
            key,
        )
    ) {

        return [];

    }

    return toList(
        source[key],
        [],
    );

}

function resolveEnvironmentAllowlist(
    flagName,
    source,
) {

    const key =
        allowlistVariableName(
            flagName,
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            source,
            key,
        )
    ) {

        return [];

    }

    return toList(
        source[key],
        [],
    );

}

/**
 * =============================================================================
 * Default catalog construction
 * =============================================================================
 */

function mergeDefinitions(
    base,
    override,
) {

    const result =
        {
            ...base,
        };

    for (
        const [
            name,
            definition,
        ] of Object.entries(
            override ||
                {},
        )
    ) {

        const normalizedName =
            normalizeFlagName(
                name,
            );

        result[
            normalizedName
        ] =
            {
                ...(
                    result[
                        normalizedName
                    ] ||
                    {}
                ),

                ...definition,
            };

    }

    return result;

}

function resolveFeatureDefinitions(
    options = {},
) {

    const source =
        options.source ||
        process.env;

    const customDefinitions =
        options.flags ||
        options.features ||
        {};

    const merged =
        mergeDefinitions(
            DEFAULT_FEATURES,
            customDefinitions,
        );

    const normalized =
        {};

    const names =
        Object.keys(
            merged,
        );

    if (
        names.length >
        DEFAULTS.maxFlags
    ) {

        throw new FeatureFlagError(
            `TITech feature flag count exceeds the configured maximum of ${DEFAULTS.maxFlags}.`,
            {
                code:
                    'FEATURE_FLAG_LIMIT_EXCEEDED',
            },
        );

    }

    for (
        const name of
        names
    ) {

        normalized[
            normalizeFlagName(
                name,
            )
        ] =
            normalizeFlagDefinition(
                name,
                merged[name],
                {
                    environmentSource:
                        source,
                },
            );

    }

    return Object.freeze(
        normalized,
    );

}

/**
 * =============================================================================
 * Feature Flag Provider
 * =============================================================================
 */

class FeatureFlagProvider {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({

                enabled:
                    options.enabled ??
                    DEFAULTS.enabled,

                strict:
                    options.strict ??
                    DEFAULTS.strict,

                immutable:
                    options.immutable ??
                    DEFAULTS.immutable,

                deterministicRollout:
                    options.deterministicRollout ??
                    DEFAULTS.deterministicRollout,

                allowRuntimeOverrides:
                    options.allowRuntimeOverrides ??
                    DEFAULTS.allowRuntimeOverrides,

                allowProductionExperiments:
                    options.allowProductionExperiments ??
                    DEFAULTS.allowProductionExperiments,

                environment:
                    normalizeEnvironment(
                        options.environment ||
                            process.env.NODE_ENV,
                    ),

                evaluationSalt:
                    options.evaluationSalt ||
                    process.env
                        .TITEC_FEATURE_FLAG_SALT ||
                    DEFAULTS.evaluationSalt,

                source:
                    options.source ||
                    process.env,

            });

        this.state =
            'created';

        this.flags =
            {};

        this.overrides =
            {};

        this.initialized =
            false;

        this.initializedAt =
            null;

        this.version =
            0;

    }

    /**
     * -------------------------------------------------------------------------
     * Initialize
     * -------------------------------------------------------------------------
     */

    initialize(
        options = {},
    ) {

        if (
            this.initialized &&
            !options.force
        ) {

            return this;

        }

        const source =
            options.source ||
            this.options.source;

        const definitions =
            resolveFeatureDefinitions(
                {
                    ...options,

                    source,
                },
            );

        if (
            options.override &&
            !this.options.allowRuntimeOverrides &&
            options.allowRuntimeOverrides !==
                true
        ) {

            throw new FeatureFlagError(
                'TITech runtime feature flag overrides are disabled.',
                {
                    code:
                        'FEATURE_FLAG_RUNTIME_OVERRIDE_DISABLED',
                },
            );

        }

        const runtimeOverrides =
            options.override ||
            {};

        const merged =
            {
                ...definitions,
            };

        for (
            const [
                name,
                override,
            ] of Object.entries(
                runtimeOverrides,
            )
        ) {

            const normalizedName =
                normalizeFlagName(
                    name,
                );

            if (
                !merged[
                    normalizedName
                ]
            ) {

                if (
                    this.options.strict
                ) {

                    throw new FeatureFlagError(
                        `Unknown TITech feature flag "${name}".`,
                        {
                            code:
                                'FEATURE_FLAG_UNKNOWN',

                            flag:
                                normalizedName,
                        },
                    );

                }

                continue;

            }

            merged[
                normalizedName
            ] =
                normalizeFlagDefinition(
                    normalizedName,
                    {
                        ...merged[
                            normalizedName
                        ],

                        ...(override || {}),
                    },
                    {
                        environmentSource:
                            source,
                    },
                );

        }

        this._validateProductionSafety(
            merged,
        );

        this.flags =
            this.options.immutable
                ? deepFreeze(
                    merged,
                )
                : merged;

        this.overrides =
            this.options.immutable
                ? deepFreeze(
                    {
                        ...runtimeOverrides,
                    },
                )
                : {
                    ...runtimeOverrides,
                };

        this.state =
            'ready';

        this.initialized =
            true;

        this.initializedAt =
            new Date();

        this.version +=
            1;

        return this;

    }

    /**
     * -------------------------------------------------------------------------
     * Production safety
     * -------------------------------------------------------------------------
     */

    _validateProductionSafety(
        flags,
    ) {

        if (
            this.options.environment !==
            'production'
        ) {

            return true;

        }

        const errors =
            [];

        for (
            const [
                name,
                definition,
            ] of Object.entries(
                flags,
            )
        ) {

            /**
             * Production-locked features must use explicit boolean safety
             * semantics and cannot be turned on by percentage rollout.
             */
            if (
                definition.productionLocked
            ) {

                if (
                    definition.type ===
                    FLAG_TYPES.PERCENTAGE
                ) {

                    errors.push({
                        flag:
                            name,

                        code:
                            'PRODUCTION_LOCKED_PERCENTAGE',

                        message:
                            'Production-locked TITech features cannot use percentage-only rollout.',
                    });

                }

            }

            /**
             * Financial/compliance/security fail-closed features must never have
             * a false fallback when evaluation fails.
             */
            if (
                definition.failClosed &&
                definition.defaultValue !==
                    true
            ) {

                errors.push({
                    flag:
                        name,

                    code:
                        'FAIL_CLOSED_DEFAULT_INVALID',

                    message:
                        'Fail-closed TITech feature flags must default to enabled safety behavior.',
                });

            }

            /**
             * Experimental features are blocked in production by default.
             */
            if (
                definition.experimental &&
                !this.options
                    .allowProductionExperiments
            ) {

                if (
                    definition.enabled ===
                        true ||
                    definition.percentage >
                        0
                ) {

                    errors.push({
                        flag:
                            name,

                        code:
                            'PRODUCTION_EXPERIMENT_FORBIDDEN',

                        message:
                            'Experimental TITech features cannot be enabled in production without explicit permission.',
                    });

                }

            }

        }

        if (
            errors.length >
            0
        ) {

            throw new FeatureFlagError(
                'TITech production feature-flag safety validation failed.',
                {
                    code:
                        'FEATURE_FLAG_PRODUCTION_SAFETY_FAILED',

                    details: {
                        errors,
                    },
                },
            );

        }

        return true;

    }

    /**
     * -------------------------------------------------------------------------
     * Resolve
     * -------------------------------------------------------------------------
     */

    get(
        name,
    ) {

        this._ensureInitialized();

        const normalizedName =
            normalizeFlagName(
                name,
            );

        return (
            this.flags[
                normalizedName
            ] ||
            null
        );

    }

    has(
        name,
    ) {

        return Boolean(
            this.get(
                name,
            ),
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Evaluation
     * -------------------------------------------------------------------------
     */

    isEnabled(
        name,
        context = {},
        options = {},
    ) {

        const definition =
            this.get(
                name,
            );

        if (
            !definition
        ) {

            if (
                this.options.strict &&
                options.strict !==
                    false
            ) {

                throw new FeatureFlagError(
                    `Unknown TITech feature flag "${name}".`,
                    {
                        code:
                            'FEATURE_FLAG_UNKNOWN',

                        flag:
                            name,
                    },
                );

            }

            return (
                options.defaultValue ??
                DEFAULTS
                    .evaluationFailureDefault
            );

        }

        try {

            return this._evaluate(
                definition,
                context,
            );

        } catch (error) {

            if (
                definition.failClosed ||
                options.failClosed
            ) {

                log(
                    'error',
                    {
                        flag:
                            definition.name,

                        error:
                            {
                                name:
                                    error?.name,

                                code:
                                    error?.code,

                                message:
                                    error?.message,
                            },
                    },
                    'TITech feature flag evaluation failed; fail-closed result applied.',
                );

                return false;

            }

            log(
                'warn',
                {
                    flag:
                        definition.name,

                    error:
                        {
                            name:
                                error?.name,

                            code:
                                error?.code,

                            message:
                                error?.message,
                        },
                },
                'TITech feature flag evaluation failed.',
            );

            return (
                options.defaultValue ??
                definition.defaultValue ??
                DEFAULTS
                    .evaluationFailureDefault
            );

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Internal evaluation engine
     * -------------------------------------------------------------------------
     */

    _evaluate(
        definition,
        context = {},
    ) {

        if (
            !this.options.enabled
        ) {

            return false;

        }

        if (
            definition.killSwitch
        ) {

            return false;

        }

        if (
            definition.deprecated
        ) {

            return false;

        }

        /**
         * Production experimental safety.
         */
        if (
            this.options.environment ===
                'production' &&
            definition.experimental &&
            !this.options
                .allowProductionExperiments
        ) {

            return false;

        }

        /**
         * Explicit environment restriction.
         */
        if (
            definition.environments.length >
            0
        ) {

            if (
                !definition.environments.includes(
                    this.options.environment,
                )
            ) {

                return false;

            }

        }

        /**
         * Explicit allowlist.
         */
        if (
            definition.allowlist.length >
            0
        ) {

            const identity =
                this._resolvePrimaryIdentity(
                    context,
                );

            if (
                !identity ||
                !definition.allowlist.includes(
                    identity,
                )
            ) {

                return false;

            }

            return true;

        }

        /**
         * Tenant targeting.
         */
        if (
            definition.tenants.length >
            0
        ) {

            const tenantId =
                normalizeIdentity(
                    context.tenantId,
                );

            if (
                !tenantId ||
                !definition.tenants.includes(
                    tenantId,
                )
            ) {

                return false;

            }

        }

        /**
         * User targeting.
         */
        if (
            definition.users.length >
            0
        ) {

            const userId =
                normalizeIdentity(
                    context.userId ||
                        context.actorId,
                );

            if (
                !userId ||
                !definition.users.includes(
                    userId,
                )
            ) {

                return false;

            }

        }

        /**
         * Device targeting.
         */
        if (
            definition.devices.length >
            0
        ) {

            const deviceId =
                normalizeIdentity(
                    context.deviceId,
                );

            if (
                !deviceId ||
                !definition.devices.includes(
                    deviceId,
                )
            ) {

                return false;

            }

        }

        /**
         * Type/strategy evaluation.
         */
        switch (
            definition.strategy
        ) {

            case ROLLOUT_STRATEGIES.NONE:

                return false;

            case ROLLOUT_STRATEGIES.ALL:

                return definition.enabled;

            case ROLLOUT_STRATEGIES.ALLOWLIST:

                return (
                    definition.allowlist.includes(
                        this._resolvePrimaryIdentity(
                            context,
                        ),
                    )
                );

            case ROLLOUT_STRATEGIES.ENVIRONMENT:

                return (
                    definition.environments.includes(
                        this.options.environment,
                    )
                );

            case ROLLOUT_STRATEGIES.TENANT:

                return this._evaluateTargeted(
                    definition,
                    context.tenantId,
                );

            case ROLLOUT_STRATEGIES.USER:

                return this._evaluateTargeted(
                    definition,
                    context.userId ||
                        context.actorId,
                );

            case ROLLOUT_STRATEGIES.DEVICE:

                return this._evaluateTargeted(
                    definition,
                    context.deviceId,
                );

            case ROLLOUT_STRATEGIES.PERCENTAGE:

                return this._evaluatePercentage(
                    definition,
                    context,
                );

            case ROLLOUT_STRATEGIES.COMPOSITE:

                return this._evaluateComposite(
                    definition,
                    context,
                );

            default:

                return this._evaluateDefault(
                    definition,
                );

        }

    }

    _evaluateDefault(
        definition,
    ) {

        if (
            definition.type ===
            FLAG_TYPES.BOOLEAN
        ) {

            return Boolean(
                definition.enabled,
            );

        }

        return Boolean(
            definition.defaultValue,
        );

    }

    _evaluateTargeted(
        definition,
        identity,
    ) {

        const normalized =
            normalizeIdentity(
                identity,
            );

        if (
            !normalized
        ) {

            return false;

        }

        if (
            definition.allowlist.length >
            0
        ) {

            return definition.allowlist.includes(
                normalized,
            );

        }

        if (
            definition.percentage >
            0
        ) {

            return this._evaluatePercentage(
                definition,
                {
                    identity:
                        normalized,
                },
            );

        }

        return Boolean(
            definition.enabled,
        );

    }

    _evaluatePercentage(
        definition,
        context,
    ) {

        if (
            !definition.enabled &&
            definition.percentage <=
                0
        ) {

            return false;

        }

        const identity =
            this._resolveRolloutIdentity(
                definition,
                context,
            );

        if (
            !identity
        ) {

            /**
             * Do not randomly enable a percentage feature when there is no
             * stable identity.
             */
            return false;

        }

        const bucket =
            hashToBucket(
                identity,
                `${this.options.evaluationSalt}:${definition.salt}`,
            );

        return (
            bucket <
            definition.percentage
        );

    }

    _evaluateComposite(
        definition,
        context,
    ) {

        /**
         * Explicit allowlists and targeting have already been processed.
         */
        if (
            definition.allowlist.length >
            0 ||
            definition.tenants.length >
            0 ||
            definition.users.length >
            0 ||
            definition.devices.length >
            0 ||
            definition.environments.length >
            0
        ) {

            return true;

        }

        if (
            definition.percentage >
            0
        ) {

            return this._evaluatePercentage(
                definition,
                context,
            );

        }

        return Boolean(
            definition.enabled,
        );

    }

    _resolvePrimaryIdentity(
        context,
    ) {

        return (
            normalizeIdentity(
                context.userId,
            ) ||
            normalizeIdentity(
                context.actorId,
            ) ||
            normalizeIdentity(
                context.tenantId,
            ) ||
            normalizeIdentity(
                context.deviceId,
            ) ||
            normalizeIdentity(
                context.identity,
            ) ||
            null
        );

    }

    _resolveRolloutIdentity(
        definition,
        context,
    ) {

        return (
            normalizeIdentity(
                context.identity,
            ) ||
            normalizeIdentity(
                context.userId,
            ) ||
            normalizeIdentity(
                context.actorId,
            ) ||
            normalizeIdentity(
                context.tenantId,
            ) ||
            normalizeIdentity(
                context.deviceId,
            ) ||
            `${this.options.environment}:${definition.name}`
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Bulk evaluation
     * -------------------------------------------------------------------------
     */

    evaluate(
        names,
        context = {},
    ) {

        const list =
            Array.isArray(
                names,
            )
                ? names
                : [
                    names,
                ];

        const result =
            {};

        for (
            const name of
            list
        ) {

            const normalizedName =
                normalizeFlagName(
                    name,
                );

            result[
                normalizedName
            ] =
                this.isEnabled(
                    normalizedName,
                    context,
                );

        }

        return Object.freeze(
            result,
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        this._ensureInitialized();

        const includeDefinitions =
            options.includeDefinitions !==
            false;

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            initialized:
                this.initialized,

            initializedAt:
                this.initializedAt,

            version:
                this.version,

            environment:
                this.options.environment,

            enabled:
                this.options.enabled,

            deterministicRollout:
                this.options.deterministicRollout,

            flagCount:
                Object.keys(
                    this.flags,
                ).length,

            enabledCount:
                Object.values(
                    this.flags,
                ).filter(
                    flag =>
                        flag.enabled,
                ).length,

            experimentalCount:
                Object.values(
                    this.flags,
                ).filter(
                    flag =>
                        flag.experimental,
                ).length,

            definitions:
                includeDefinitions
                    ? this.flags
                    : undefined,

            timestamp:
                new Date().toISOString(),
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    getEnabledFlags() {

        this._ensureInitialized();

        return Object.freeze(
            Object.values(
                this.flags,
            )
                .filter(
                    flag =>
                        flag.enabled,
                )
                .map(
                    flag =>
                        flag.name,
                ),
        );

    }

    getDisabledFlags() {

        this._ensureInitialized();

        return Object.freeze(
            Object.values(
                this.flags,
            )
                .filter(
                    flag =>
                        !flag.enabled,
                )
                .map(
                    flag =>
                        flag.name,
                ),
        );

    }

    getExperimentalFlags() {

        this._ensureInitialized();

        return Object.freeze(
            Object.values(
                this.flags,
            )
                .filter(
                    flag =>
                        flag.experimental,
                )
                .map(
                    flag =>
                        flag.name,
                ),
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap adapter
     * -------------------------------------------------------------------------
     */

    async start(
        context = {},
    ) {

        this.initialize();

        if (
            context &&
            typeof context ===
                'object'
        ) {

            context.featureFlags =
                this;

        }

        return this;

    }

    async bootstrap(
        context = {},
    ) {

        return this.start(
            context,
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Internal
     * -------------------------------------------------------------------------
     */

    _ensureInitialized() {

        if (
            !this.initialized
        ) {

            this.initialize();

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Reset
     * -------------------------------------------------------------------------
     */

    reset() {

        this.flags =
            {};

        this.overrides =
            {};

        this.initialized =
            false;

        this.initializedAt =
            null;

        this.version =
            0;

        this.state =
            'created';

        return this;

    }

}

/**
 * =============================================================================
 * Default singleton
 * =============================================================================
 */

const featureFlags =
    new FeatureFlagProvider();

featureFlags.initialize();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function getFlag(
    name,
) {

    return featureFlags.get(
        name,
    );

}

function hasFlag(
    name,
) {

    return featureFlags.has(
        name,
    );

}

function isEnabled(
    name,
    context,
    options,
) {

    return featureFlags.isEnabled(
        name,
        context,
        options,
    );

}

function evaluate(
    names,
    context,
) {

    return featureFlags.evaluate(
        names,
        context,
    );

}

function getSnapshot(
    options,
) {

    return featureFlags.snapshot(
        options,
    );

}

function getEnabledFlags() {

    return featureFlags.getEnabledFlags();

}

function getDisabledFlags() {

    return featureFlags.getDisabledFlags();

}

function getExperimentalFlags() {

    return featureFlags.getExperimentalFlags();

}

function initialize(
    options,
) {

    return featureFlags.initialize(
        options,
    );

}

async function start(
    context,
) {

    return featureFlags.start(
        context,
    );

}

async function bootstrap(
    context,
) {

    return featureFlags.bootstrap(
        context,
    );

}

/**
 * =============================================================================
 * Environment feature flag inspection
 * =============================================================================
 */

function getEnvironmentFlagVariables() {

    const result =
        {};

    for (
        const [
            key,
        ] of Object.entries(
            process.env,
        )
    ) {

        if (
            key.startsWith(
                'TITEC_FF_',
            )
        ) {

            result[key] =
                isSensitiveKey(
                    key,
                )
                    ? '[REDACTED]'
                    : process.env[
                        key
                    ];

        }

    }

    return Object.freeze(
        result,
    );

}

function isSensitiveKey(
    key,
) {

    return /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(
        key,
    );

}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 */

function reset() {

    return featureFlags.reset();

}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Core provider.
         */
        FeatureFlagProvider,

        FeatureFlagError,

        featureFlags,

        provider:
            featureFlags,

        /**
         * Constants.
         */
        FLAG_STATES,

        FLAG_TYPES,

        ROLLOUT_STRATEGIES,

        FLAG_CLASSES,

        ENVIRONMENTS,

        DEFAULTS,

        DEFAULT_FEATURES,

        /**
         * Access.
         */
        get:
            getFlag,

        getFlag,

        has:
            hasFlag,

        hasFlag,

        isEnabled,

        evaluate,

        /**
         * Lifecycle.
         */
        initialize,

        start,

        bootstrap,

        /**
         * Diagnostics.
         */
        snapshot:
            getSnapshot,

        getSnapshot,

        getEnabledFlags,

        getDisabledFlags,

        getExperimentalFlags,

        getEnvironmentFlagVariables,

        /**
         * Environment helpers.
         */
        environmentVariableName,

        percentageVariableName,

        allowlistVariableName,

        environmentScopeVariableName,

        /**
         * Test/process isolation.
         */
        reset,

        /**
         * Metadata.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

    });