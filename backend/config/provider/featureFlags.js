'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/featureFlags.js
 *
 * Purpose:
 *   Enterprise production-grade feature-flag provider.
 *
 * Responsibilities:
 *   - Centralize TITech feature-flag evaluation.
 *   - Provide deterministic boolean/string/number flag access.
 *   - Support environment-based defaults.
 *   - Support percentage-based rollout.
 *   - Support tenant-aware rollout.
 *   - Support user-aware rollout.
 *   - Support allowlists and denylists.
 *   - Support kill switches for critical subsystems.
 *   - Support financial-operation safety flags.
 *   - Prevent unsafe production defaults.
 *   - Provide immutable snapshots and diagnostics.
 *   - Support bootstrap/lifecycle integration.
 *
 * IMPORTANT:
 *
 *   Feature flags are configuration controls.
 *
 *   They do NOT:
 *     - replace authorization.
 *     - replace authentication.
 *     - replace tenant isolation.
 *     - replace financial transaction controls.
 *     - replace idempotency.
 *     - replace database constraints.
 *     - guarantee exactly-once execution.
 *
 * A feature flag may enable or disable a behavior, but the underlying service
 * must still enforce its own security, financial and consistency invariants.
 *
 * =============================================================================
 *
 * Canonical flow:
 *
 *   environment
 *       ↓
 *   config/featureFlags.js
 *       ↓
 *   provider/featureFlags.js
 *       ↓
 *   services / middleware / routes / workers
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const process =
    require('node:process');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configurationProviderModule =
    null;

try {
    // eslint-disable-next-line global-require
    configurationProviderModule =
        require('./ConfigurationProvider');
} catch {
    configurationProviderModule =
        null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
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
    'feature-flag-provider';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const FEATURE_FLAG_STATES =
    Object.freeze({
        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',

        READY:
            'ready',
    });

const FLAG_TYPES =
    Object.freeze({
        BOOLEAN:
            'boolean',

        STRING:
            'string',

        NUMBER:
            'number',

        JSON:
            'json',
    });

const ROLLOUT_STRATEGIES =
    Object.freeze({
        ALL:
            'all',

        NONE:
            'none',

        PERCENTAGE:
            'percentage',

        USER_ALLOWLIST:
            'user_allowlist',

        TENANT_ALLOWLIST:
            'tenant_allowlist',

        ENVIRONMENT:
            'environment',

        COMPOSITE:
            'composite',
    });

const FLAG_TARGETS =
    Object.freeze({
        GLOBAL:
            'global',

        USER:
            'user',

        TENANT:
            'tenant',

        REQUEST:
            'request',

        SERVICE:
            'service',
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

        failSafe:
            true,

        environment:
            process.env.NODE_ENV ||
            'development',

        defaultEvaluation:
            false,

        /**
         * Production safety:
         *
         * Unknown flags must default to the supplied fallback rather than
         * unexpectedly enabling functionality.
         */
        unknownFlagFallback:
            false,

        allowRuntimeMutation:
            false,

        allowEnvironmentOverrides:
            true,

        /**
         * Evaluation cache.
         */
        cacheEnabled:
            true,

        cacheTtlMs:
            5_000,

        /**
         * Deterministic rollout.
         */
        rolloutHashAlgorithm:
            'sha256',

        rolloutSalt:
            process.env.FEATURE_FLAG_ROLLOUT_SALT ||
            'titech-feature-rollout',

        /**
         * Diagnostics.
         */
        diagnostics:
            {
                enabled:
                    true,

                logEvaluations:
                    false,

                logDisabledFeatures:
                    false,

                exposeDefinitions:
                    true,

                exposeEvaluationContext:
                    false,

                exposeInternalRules:
                    false,

                maxEvents:
                    100,
            },

        /**
         * Critical safety defaults.
         *
         * These features remain conservative unless explicitly enabled.
         */
        criticalDefaults:
            {
                financialWrites:
                    true,

                paymentProcessing:
                    true,

                ledgerPosting:
                    true,

                idempotencyEnforcement:
                    true,

                tenantIsolation:
                    true,

                authentication:
                    true,

                authorization:
                    true,

                auditLogging:
                    true,

                databaseWrites:
                    true,

                queueProcessing:
                    true,

                redisCaching:
                    true,

                realtime:
                    true,
            },
    });

/**
 * =============================================================================
 * Built-in feature definitions
 * =============================================================================
 *
 * These are intentionally conservative and represent platform capabilities,
 * not business authorization.
 * =============================================================================
 */

const BUILTIN_FEATURES =
    Object.freeze({
        apiV2:
            {
                key:
                    'api.v2',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    false,

                description:
                    'Enable the TITech API v2 surface.',

                target:
                    FLAG_TARGETS.GLOBAL,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.NONE,
                    },
            },

        financialWrites:
            {
                key:
                    'financial.writes',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .financialWrites,

                description:
                    'Enable financial write operations. Financial services must enforce their own authorization and transaction invariants.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        paymentProcessing:
            {
                key:
                    'financial.paymentProcessing',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .paymentProcessing,

                description:
                    'Enable payment processing flows.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        ledgerPosting:
            {
                key:
                    'financial.ledgerPosting',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .ledgerPosting,

                description:
                    'Enable posting to the authoritative TITech ledger.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        idempotencyEnforcement:
            {
                key:
                    'financial.idempotencyEnforcement',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .idempotencyEnforcement,

                description:
                    'Enable idempotency enforcement for supported state-changing operations.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        tenantIsolation:
            {
                key:
                    'security.tenantIsolation',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .tenantIsolation,

                description:
                    'Enable tenant isolation enforcement paths.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        auditLogging:
            {
                key:
                    'security.auditLogging',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .auditLogging,

                description:
                    'Enable audit event generation.',

                target:
                    FLAG_TARGETS.GLOBAL,

                critical:
                    true,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        realtime:
            {
                key:
                    'realtime.enabled',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    DEFAULTS
                        .criticalDefaults
                        .realtime,

                description:
                    'Enable realtime and Socket.IO capabilities.',

                target:
                    FLAG_TARGETS.GLOBAL,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.ALL,
                    },
            },

        advancedAnalytics:
            {
                key:
                    'analytics.advanced',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    false,

                description:
                    'Enable advanced analytics features.',

                target:
                    FLAG_TARGETS.TENANT,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.PERCENTAGE,

                        percentage:
                            0,
                    },
            },

        betaDashboard:
            {
                key:
                    'dashboard.beta',

                type:
                    FLAG_TYPES.BOOLEAN,

                default:
                    false,

                description:
                    'Enable the beta dashboard experience.',

                target:
                    FLAG_TARGETS.USER,

                rollout:
                    {
                        strategy:
                            ROLLOUT_STRATEGIES.PERCENTAGE,

                        percentage:
                            0,
                    },
            },
    });

/**
 * =============================================================================
 * Sensitive names
 * =============================================================================
 */

const SENSITIVE_KEYS =
    Object.freeze([
        'password',
        'secret',
        'token',
        'authorization',
        'apiKey',
        'privateKey',
        'clientSecret',
        'encryptionKey',
        'connectionString',
    ]);

function isSensitiveKey(
    key,
) {
    return SENSITIVE_KEYS.some(
        sensitive =>
            String(
                key,
            )
                .toLowerCase()
                .includes(
                    String(
                        sensitive,
                    ).toLowerCase(),
                ),
    );
}

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

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            FeatureFlagError,
        );
    }
}

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !==
            'object'
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
        value === null ||
        value === undefined
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

        const output = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            output[key] =
                clone(
                    item,
                );
        }

        return output;
    }

    return value;
}

function normalizeKey(
    key,
) {

    const normalized =
        String(
            key || '',
        )
            .trim();

    if (
        !normalized
    ) {

        throw new FeatureFlagError(
            'Feature flag key is required.',
            {
                code:
                    'FEATURE_FLAG_KEY_REQUIRED',
            },
        );
    }

    return normalized;
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

function asNumber(
    value,
    fallback,
) {

    const parsed =
        Number(
            value,
        );

    return Number.isFinite(
        parsed,
    )
        ? parsed
        : fallback;
}

function normalizePercentage(
    value,
) {

    return Math.min(
        100,
        Math.max(
            0,
            asNumber(
                value,
                0,
            ),
        ),
    );
}

function normalizeEnvironment(
    value,
) {

    const environment =
        String(
            value ||
                process.env.NODE_ENV ||
                DEFAULTS.environment,
        )
            .trim()
            .toLowerCase();

    return environment;
}

function getConfigurationProvider() {

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
        getConfigurationProvider();

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
        // Fall back to supplied default.
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
        // Feature flags must not fail because logging failed.
    }
}

/**
 * =============================================================================
 * Environment flag parsing
 * =============================================================================
 */

function environmentVariableName(
    key,
) {

    return (
        'FEATURE_FLAG_' +
        key
            .replace(
                /\./g,
                '_',
            )
            .replace(
                /[^A-Z0-9_]/gi,
                '_',
            )
            .toUpperCase()
    );
}

function parseEnvironmentOverride(
    key,
) {

    const variable =
        environmentVariableName(
            key,
        );

    const value =
        process.env[
            variable
        ];

    if (
        value === undefined
    ) {

        return {
            exists:
                false,

            variable,
            value:
                undefined,
        };
    }

    return {
        exists:
            true,

        variable,

        value,
    };
}

/**
 * =============================================================================
 * Deterministic rollout
 * =============================================================================
 */

function calculateRolloutBucket(
    {
        flagKey,
        subjectId,
        salt =
            DEFAULTS.rolloutSalt,
        algorithm =
            DEFAULTS.rolloutHashAlgorithm,
    },
) {

    const input =
        [
            salt,
            flagKey,
            subjectId,
        ].join(
            ':',
        );

    const digest =
        crypto
            .createHash(
                algorithm,
            )
            .update(
                input,
                'utf8',
            )
            .digest();

    /**
     * Use the first 4 bytes for a stable unsigned integer.
     */
    const integer =
        digest.readUInt32BE(
            0,
        );

    return (
        integer /
        0xFFFFFFFF
    ) *
        100;
}

/**
 * =============================================================================
 * Evaluation context
 * =============================================================================
 */

function normalizeEvaluationContext(
    context = {},
) {

    return {
        userId:
            context.userId ||
            context.actorId ||
            context.user?.id ||
            context.user?._id ||
            null,

        tenantId:
            context.tenantId ||
            context.tenant?.id ||
            context.tenant?._id ||
            null,

        organizationId:
            context.organizationId ||
            context.organization?.id ||
            context.organization?._id ||
            null,

        environment:
            normalizeEnvironment(
                context.environment ||
                getConfig(
                    'app.environment',
                    process.env.NODE_ENV,
                ),
            ),

        service:
            context.service ||
            SERVICE_NAME,

        requestId:
            context.requestId ||
            null,

        attributes:
            context.attributes &&
            typeof context.attributes ===
                'object'
                ? context.attributes
                : {},
    };
}

/**
 * =============================================================================
 * FeatureFlagProvider
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
                    asBoolean(
                        process.env.FEATURE_FLAGS_ENABLED,
                        DEFAULTS.enabled,
                    ),

                strict:
                    options.strict ??
                    DEFAULTS.strict,

                failSafe:
                    options.failSafe ??
                    DEFAULTS.failSafe,

                environment:
                    normalizeEnvironment(
                        options.environment ||
                        process.env.NODE_ENV ||
                        DEFAULTS.environment,
                    ),

                defaultEvaluation:
                    options.defaultEvaluation ??
                    DEFAULTS.defaultEvaluation,

                unknownFlagFallback:
                    options.unknownFlagFallback ??
                    DEFAULTS.unknownFlagFallback,

                allowRuntimeMutation:
                    options.allowRuntimeMutation ??
                    DEFAULTS.allowRuntimeMutation,

                allowEnvironmentOverrides:
                    options.allowEnvironmentOverrides ??
                    DEFAULTS.allowEnvironmentOverrides,

                cacheEnabled:
                    options.cacheEnabled ??
                    DEFAULTS.cacheEnabled,

                cacheTtlMs:
                    Number.isFinite(
                        options.cacheTtlMs,
                    )
                        ? options.cacheTtlMs
                        : DEFAULTS.cacheTtlMs,

                rolloutHashAlgorithm:
                    options.rolloutHashAlgorithm ||
                    DEFAULTS.rolloutHashAlgorithm,

                rolloutSalt:
                    options.rolloutSalt ||
                    DEFAULTS.rolloutSalt,

                diagnostics:
                    Object.freeze({
                        ...DEFAULTS.diagnostics,
                        ...(options.diagnostics || {}),
                    }),
            });

        this.state =
            FEATURE_FLAG_STATES
                .DISABLED;

        this.initializedAt =
            null;

        this.updatedAt =
            null;

        this.flags =
            new Map();

        this.overrides =
            new Map();

        this.cache =
            new Map();

        this.evaluationEvents =
            [];

        this.errors =
            [];

        this.warnings =
            [];

        this._initialized =
            false;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize.
     * -------------------------------------------------------------------------
     */

    initialize(
        definitions = {},
    ) {

        if (
            this._initialized
        ) {

            return this;
        }

        this.state =
            FEATURE_FLAG_STATES
                .DISABLED;

        this.flags.clear();

        /**
         * Built-in definitions.
         */
        for (
            const definition of
            Object.values(
                BUILTIN_FEATURES,
            )
        ) {

            this.register(
                definition,
            );
        }

        /**
         * Configuration-provided definitions.
         */
        this.loadConfiguredDefinitions();

        /**
         * Explicit definitions.
         */
        if (
            definitions &&
            typeof definitions ===
                'object'
        ) {

            if (
                Array.isArray(
                    definitions,
                )
            ) {

                for (
                    const definition of
                    definitions
                ) {

                    this.register(
                        definition,
                    );
                }

            } else {

                for (
                    const [
                        key,
                        value,
                    ] of Object.entries(
                        definitions,
                    )
                ) {

                    if (
                        value &&
                        typeof value ===
                            'object'
                    ) {

                        this.register({
                            key,
                            ...value,
                        });

                    } else {

                        this.register({
                            key,
                            default:
                                value,
                            type:
                                FLAG_TYPES.BOOLEAN,
                        });
                    }
                }
            }
        }

        this._initialized =
            true;

        this.initializedAt =
            new Date();

        this.updatedAt =
            new Date();

        this.state =
            this.errors.length > 0
                ? FEATURE_FLAG_STATES
                    .DEGRADED
                : FEATURE_FLAG_STATES
                    .READY;

        log(
            'info',
            {
                flagCount:
                    this.flags.size,

                state:
                    this.state,
            },
            'TITech feature flag provider initialized.',
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Load configured definitions.
     * -------------------------------------------------------------------------
     */

    loadConfiguredDefinitions() {

        const configured =
            getConfig(
                'featureFlags.flags',
                null,
            ) ||
            getConfig(
                'featureFlags.features',
                null,
            );

        if (
            !configured
        ) {

            return;
        }

        if (
            Array.isArray(
                configured,
            )
        ) {

            for (
                const definition of
                configured
            ) {

                try {

                    this.register(
                        definition,
                    );

                } catch (
                    error
                ) {

                    this.recordError(
                        error,
                    );

                }
            }

            return;
        }

        for (
            const [
                key,
                definition,
            ] of Object.entries(
                configured,
            )
        ) {

            try {

                if (
                    definition &&
                    typeof definition ===
                        'object'
                ) {

                    this.register({
                        key,
                        ...definition,
                    });

                } else {

                    this.register({
                        key,
                        default:
                            definition,
                        type:
                            typeof definition ===
                                'boolean'
                                ? FLAG_TYPES
                                    .BOOLEAN
                                : FLAG_TYPES
                                    .STRING,
                    });
                }

            } catch (
                error
            ) {

                this.recordError(
                    error,
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Register.
     * -------------------------------------------------------------------------
     */

    register(
        definition,
    ) {

        if (
            !definition ||
            typeof definition !==
                'object'
        ) {

            throw new FeatureFlagError(
                'Feature flag definition must be an object.',
                {
                    code:
                        'FEATURE_FLAG_DEFINITION_INVALID',
                },
            );
        }

        const key =
            normalizeKey(
                definition.key,
            );

        const type =
            Object.values(
                FLAG_TYPES,
            ).includes(
                definition.type,
            )
                ? definition.type
                : FLAG_TYPES
                    .BOOLEAN;

        const defaultValue =
            definition.default !==
                undefined
                ? definition.default
                : this.defaultForCriticalFlag(
                    key,
                );

        const rollout =
            this.normalizeRollout(
                definition.rollout,
            );

        const normalized = {
            key,

            type,

            default:
                this.coerceValue(
                    defaultValue,
                    type,
                ),

            description:
                definition.description ||
                '',

            target:
                definition.target ||
                FLAG_TARGETS.GLOBAL,

            critical:
                Boolean(
                    definition.critical,
                ),

            owner:
                definition.owner ||
                null,

            tags:
                Array.isArray(
                    definition.tags,
                )
                    ? [
                        ...new Set(
                            definition.tags
                                .map(
                                    String,
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            rollout,

            environments:
                definition.environments
                    ? [
                        ...new Set(
                            Array.isArray(
                                definition.environments,
                            )
                                ? definition.environments
                                : String(
                                    definition.environments,
                                )
                                    .split(',')
                                    .map(
                                        String,
                                    ),
                        ),
                    ]
                    : null,

            enabled:
                definition.enabled !==
                    false,

            expiresAt:
                definition.expiresAt
                    ? new Date(
                        definition.expiresAt,
                    )
                    : null,

            metadata:
                definition.metadata &&
                typeof definition.metadata ===
                    'object'
                    ? clone(
                        definition.metadata,
                    )
                    : {},
        };

        if (
            normalized.expiresAt &&
            Number.isNaN(
                normalized.expiresAt.getTime(),
            )
        ) {

            throw new FeatureFlagError(
                `Feature flag "${key}" has an invalid expiration date.`,
                {
                    code:
                        'FEATURE_FLAG_EXPIRATION_INVALID',

                    flag:
                        key,
                },
            );
        }

        if (
            normalized.rollout.strategy ===
                ROLLOUT_STRATEGIES.PERCENTAGE &&
            (
                normalized.rollout.percentage <
                    0 ||
                normalized.rollout.percentage >
                    100
            )
        ) {

            throw new FeatureFlagError(
                `Feature flag "${key}" has an invalid rollout percentage.`,
                {
                    code:
                        'FEATURE_FLAG_ROLLOUT_INVALID',

                    flag:
                        key,
                },
            );
        }

        this.flags.set(
            key,
            deepFreeze(
                normalized,
            ),
        );

        this.cache.clear();

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Critical defaults.
     * -------------------------------------------------------------------------
     */

    defaultForCriticalFlag(
        key,
    ) {

        const criticalDefaults =
            DEFAULTS
                .criticalDefaults;

        switch (
            key
        ) {

            case 'financial.writes':
                return criticalDefaults
                    .financialWrites;

            case 'financial.paymentProcessing':
                return criticalDefaults
                    .paymentProcessing;

            case 'financial.ledgerPosting':
                return criticalDefaults
                    .ledgerPosting;

            case 'financial.idempotencyEnforcement':
                return criticalDefaults
                    .idempotencyEnforcement;

            case 'security.tenantIsolation':
                return criticalDefaults
                    .tenantIsolation;

            case 'security.authentication':
                return criticalDefaults
                    .authentication;

            case 'security.authorization':
                return criticalDefaults
                    .authorization;

            case 'security.auditLogging':
                return criticalDefaults
                    .auditLogging;

            case 'database.writes':
                return criticalDefaults
                    .databaseWrites;

            case 'queue.processing':
                return criticalDefaults
                    .queueProcessing;

            case 'redis.caching':
                return criticalDefaults
                    .redisCaching;

            case 'realtime.enabled':
                return criticalDefaults
                    .realtime;

            default:
                return DEFAULTS
                    .defaultEvaluation;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Rollout normalization.
     * -------------------------------------------------------------------------
     */

    normalizeRollout(
        rollout = {},
    ) {

        const strategy =
            Object.values(
                ROLLOUT_STRATEGIES,
            ).includes(
                rollout.strategy,
            )
                ? rollout.strategy
                : ROLLOUT_STRATEGIES.ALL;

        return {
            strategy,

            percentage:
                normalizePercentage(
                    rollout.percentage,
                ),

            userAllowlist:
                Array.isArray(
                    rollout.userAllowlist,
                )
                    ? [
                        ...new Set(
                            rollout.userAllowlist
                                .map(
                                    String,
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            userDenylist:
                Array.isArray(
                    rollout.userDenylist,
                )
                    ? [
                        ...new Set(
                            rollout.userDenylist
                                .map(
                                    String,
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            tenantAllowlist:
                Array.isArray(
                    rollout.tenantAllowlist,
                )
                    ? [
                        ...new Set(
                            rollout.tenantAllowlist
                                .map(
                                    String,
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            tenantDenylist:
                Array.isArray(
                    rollout.tenantDenylist,
                )
                    ? [
                        ...new Set(
                            rollout.tenantDenylist
                                .map(
                                    String,
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            environments:
                Array.isArray(
                    rollout.environments,
                )
                    ? [
                        ...new Set(
                            rollout.environments
                                .map(
                                    value =>
                                        String(
                                            value,
                                        )
                                            .trim()
                                            .toLowerCase(),
                                )
                                .filter(Boolean),
                        ),
                    ]
                    : [],

            requireAll:
                Array.isArray(
                    rollout.requireAll,
                )
                    ? [
                        ...rollout.requireAll,
                    ]
                    : [],

            requireAny:
                Array.isArray(
                    rollout.requireAny,
                )
                    ? [
                        ...rollout.requireAny,
                    ]
                    : [],
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Value coercion.
     * -------------------------------------------------------------------------
     */

    coerceValue(
        value,
        type,
    ) {

        switch (
            type
        ) {

            case FLAG_TYPES.BOOLEAN:
                return asBoolean(
                    value,
                    false,
                );

            case FLAG_TYPES.NUMBER:
                return asNumber(
                    value,
                    0,
                );

            case FLAG_TYPES.JSON:

                if (
                    typeof value ===
                    'string'
                ) {

                    try {

                        return JSON.parse(
                            value,
                        );

                    } catch {

                        return {};
                    }
                }

                return clone(
                    value,
                );

            case FLAG_TYPES.STRING:
            default:
                return String(
                    value ??
                    '',
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Apply environment override.
     * -------------------------------------------------------------------------
     */

    resolveEnvironmentOverride(
        definition,
    ) {

        if (
            !this.options
                .allowEnvironmentOverrides
        ) {

            return {
                exists:
                    false,
            };
        }

        const override =
            parseEnvironmentOverride(
                definition.key,
            );

        if (
            !override.exists
        ) {

            return override;
        }

        return {
            ...override,

            value:
                this.coerceValue(
                    override.value,
                    definition.type,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Determine cache key.
     * -------------------------------------------------------------------------
     */

    createEvaluationCacheKey(
        key,
        context,
    ) {

        return JSON.stringify({
            key,

            environment:
                context.environment,

            userId:
                context.userId,

            tenantId:
                context.tenantId,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Get definition.
     * -------------------------------------------------------------------------
     */

    getDefinition(
        key,
    ) {

        this.ensureInitialized();

        const normalized =
            normalizeKey(
                key,
            );

        return (
            this.flags.get(
                normalized,
            ) ||
            null
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure initialized.
     * -------------------------------------------------------------------------
     */

    ensureInitialized() {

        if (
            !this._initialized
        ) {

            this.initialize();
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Evaluate.
     * -------------------------------------------------------------------------
     */

    evaluate(
        key,
        context = {},
        options = {},
    ) {

        this.ensureInitialized();

        const normalizedKey =
            normalizeKey(
                key,
            );

        const definition =
            this.flags.get(
                normalizedKey,
            );

        const evaluationContext =
            normalizeEvaluationContext(
                context,
            );

        if (
            !definition
        ) {

            const fallback =
                options.default ??
                this.options
                    .unknownFlagFallback;

            return this.createEvaluationResult(
                normalizedKey,
                fallback,
                {
                    reason:
                        'unknown_flag',

                    source:
                        'fallback',

                    context:
                        evaluationContext,
                },
            );
        }

        const cacheKey =
            this.createEvaluationCacheKey(
                normalizedKey,
                evaluationContext,
            );

        if (
            this.options.cacheEnabled &&
            !options.skipCache
        ) {

            const cached =
                this.getCached(
                    cacheKey,
                );

            if (
                cached
            ) {

                return cached;
            }
        }

        try {

            /**
             * -----------------------------------------------------------------
             * Disabled provider.
             * -----------------------------------------------------------------
             */

            if (
                !this.options.enabled
            ) {

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        this.safeFallbackValue(
                            definition,
                            options,
                        ),
                        {
                            reason:
                                'provider_disabled',

                            source:
                                'fallback',

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Explicit runtime override.
             * -----------------------------------------------------------------
             */

            if (
                this.overrides.has(
                    normalizedKey,
                )
            ) {

                const overridden =
                    this.overrides.get(
                        normalizedKey,
                    );

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        overridden,
                        {
                            reason:
                                'runtime_override',

                            source:
                                'runtime',

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Environment override.
             * -----------------------------------------------------------------
             */

            const environmentOverride =
                this.resolveEnvironmentOverride(
                    definition,
                );

            if (
                environmentOverride.exists
            ) {

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        environmentOverride.value,
                        {
                            reason:
                                'environment_override',

                            source:
                                environmentOverride.variable,

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Disabled definition.
             * -----------------------------------------------------------------
             */

            if (
                definition.enabled ===
                false
            ) {

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        this.safeFallbackValue(
                            definition,
                            options,
                        ),
                        {
                            reason:
                                'definition_disabled',

                            source:
                                'definition',

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Expiration.
             * -----------------------------------------------------------------
             */

            if (
                definition.expiresAt &&
                definition.expiresAt.getTime() <=
                    Date.now()
            ) {

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        this.safeFallbackValue(
                            definition,
                            options,
                        ),
                        {
                            reason:
                                'expired',

                            source:
                                'fallback',

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Environment targeting.
             * -----------------------------------------------------------------
             */

            if (
                definition.environments &&
                definition.environments.length > 0 &&
                !definition.environments
                    .map(
                        value =>
                            String(
                                value,
                            ).toLowerCase(),
                    )
                    .includes(
                        evaluationContext.environment,
                    )
            ) {

                return this.cacheEvaluation(
                    cacheKey,
                    this.createEvaluationResult(
                        normalizedKey,
                        this.safeFallbackValue(
                            definition,
                            options,
                        ),
                        {
                            reason:
                                'environment_mismatch',

                            source:
                                'targeting',

                            context:
                                evaluationContext,
                        },
                    ),
                );
            }

            /**
             * -----------------------------------------------------------------
             * Rollout evaluation.
             * -----------------------------------------------------------------
             */

            const rolloutResult =
                this.evaluateRollout(
                    definition,
                    evaluationContext,
                );

            return this.cacheEvaluation(
                cacheKey,
                this.createEvaluationResult(
                    normalizedKey,
                    rolloutResult.value
                        ? definition.default
                        : this.safeFallbackValue(
                            definition,
                            options,
                        ),
                    {
                        reason:
                            rolloutResult.reason,

                        source:
                            rolloutResult.source,

                        context:
                            evaluationContext,
                    },
                ),
            );

        } catch (
            error
        ) {

            this.recordError(
                error,
            );

            if (
                this.options.failSafe
            ) {

                return this.createEvaluationResult(
                    normalizedKey,
                    this.safeFallbackValue(
                        definition,
                        options,
                    ),
                    {
                        reason:
                            'evaluation_error',

                        source:
                            'failsafe',

                        context:
                            evaluationContext,

                        error:
                            safeError(
                                error,
                            ),
                    },
                );
            }

            throw error;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Rollout evaluation.
     * -------------------------------------------------------------------------
     */

    evaluateRollout(
        definition,
        context,
    ) {

        const rollout =
            definition.rollout ||
            {
                strategy:
                    ROLLOUT_STRATEGIES.ALL,
            };

        switch (
            rollout.strategy
        ) {

            case ROLLOUT_STRATEGIES.ALL:

                return {
                    value:
                        true,

                    reason:
                        'rollout_all',

                    source:
                        'rollout',
                };

            case ROLLOUT_STRATEGIES.NONE:

                return {
                    value:
                        false,

                    reason:
                        'rollout_none',

                    source:
                        'rollout',
                };

            case ROLLOUT_STRATEGIES.ENVIRONMENT:

                return {
                    value:
                        rollout.environments.includes(
                            context.environment,
                        ),

                    reason:
                        rollout.environments.includes(
                            context.environment,
                        )
                            ? 'environment_match'
                            : 'environment_mismatch',

                    source:
                        'rollout',
                };

            case ROLLOUT_STRATEGIES.USER_ALLOWLIST:

                if (
                    context.userId &&
                    rollout.userDenylist.includes(
                        String(
                            context.userId,
                        ),
                    )
                ) {

                    return {
                        value:
                            false,

                        reason:
                            'user_denylist',

                        source:
                            'rollout',
                    };
                }

                return {
                    value:
                        Boolean(
                            context.userId &&
                            rollout.userAllowlist.includes(
                                String(
                                    context.userId,
                                ),
                            ),
                        ),

                    reason:
                        context.userId &&
                        rollout.userAllowlist.includes(
                            String(
                                context.userId,
                            ),
                        )
                            ? 'user_allowlist'
                            : 'user_not_allowlisted',

                    source:
                        'rollout',
                };

            case ROLLOUT_STRATEGIES.TENANT_ALLOWLIST:

                if (
                    context.tenantId &&
                    rollout.tenantDenylist.includes(
                        String(
                            context.tenantId,
                        ),
                    )
                ) {

                    return {
                        value:
                            false,

                        reason:
                            'tenant_denylist',

                        source:
                            'rollout',
                    };
                }

                return {
                    value:
                        Boolean(
                            context.tenantId &&
                            rollout.tenantAllowlist.includes(
                                String(
                                    context.tenantId,
                                ),
                            ),
                        ),

                    reason:
                        context.tenantId &&
                        rollout.tenantAllowlist.includes(
                            String(
                                context.tenantId,
                            ),
                        )
                            ? 'tenant_allowlist'
                            : 'tenant_not_allowlisted',

                    source:
                        'rollout',
                };

            case ROLLOUT_STRATEGIES.PERCENTAGE: {

                const subject =
                    context.tenantId ||
                    context.userId;

                /**
                 * Percentage rollout must fail closed when no deterministic
                 * subject is available.
                 */
                if (
                    !subject
                ) {

                    return {
                        value:
                            false,

                        reason:
                            'rollout_subject_missing',

                        source:
                            'rollout',
                    };
                }

                const bucket =
                    calculateRolloutBucket({
                        flagKey:
                            definition.key,

                        subjectId:
                            String(
                                subject,
                            ),

                        salt:
                            this.options
                                .rolloutSalt,

                        algorithm:
                            this.options
                                .rolloutHashAlgorithm,
                    });

                return {
                    value:
                        bucket <
                        rollout.percentage,

                    reason:
                        bucket <
                            rollout.percentage
                            ? 'percentage_match'
                            : 'percentage_mismatch',

                    source:
                        'rollout',

                    bucket,

                    percentage:
                        rollout.percentage,
                };
            }

            case ROLLOUT_STRATEGIES.COMPOSITE: {

                const requiredResults =
                    rollout.requireAll.map(
                        flag =>
                            this.evaluate(
                                flag,
                                context,
                                {
                                    skipCache:
                                        true,
                                },
                            ).value,
                    );

                if (
                    requiredResults.some(
                        result =>
                            result !==
                            true,
                    )
                ) {

                    return {
                        value:
                            false,

                        reason:
                            'composite_require_all_failed',

                        source:
                            'rollout',
                    };
                }

                const anyResults =
                    rollout.requireAny.map(
                        flag =>
                            this.evaluate(
                                flag,
                                context,
                                {
                                    skipCache:
                                        true,
                                },
                            ).value,
                    );

                if (
                    anyResults.length > 0 &&
                    !anyResults.some(
                        result =>
                            result ===
                            true,
                    )
                ) {

                    return {
                        value:
                            false,

                        reason:
                            'composite_require_any_failed',

                        source:
                            'rollout',
                    };
                }

                return {
                    value:
                        true,

                    reason:
                        'composite_match',

                    source:
                        'rollout',
                };
            }

            default:

                return {
                    value:
                        false,

                    reason:
                        'unknown_rollout_strategy',

                    source:
                        'failsafe',
                };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Safe fallback.
     * -------------------------------------------------------------------------
     */

    safeFallbackValue(
        definition,
        options = {},
    ) {

        if (
            options.default !==
            undefined
        ) {

            return this.coerceValue(
                options.default,
                definition?.type ||
                    FLAG_TYPES.BOOLEAN,
            );
        }

        if (
            definition?.critical
        ) {

            return this.coerceValue(
                definition.default,
                definition.type,
            );
        }

        return this.coerceValue(
            this.options.unknownFlagFallback,
            definition?.type ||
                FLAG_TYPES.BOOLEAN,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Create evaluation result.
     * -------------------------------------------------------------------------
     */

    createEvaluationResult(
        key,
        value,
        metadata = {},
    ) {

        const result = {
            key,

            value,

            enabled:
                value === true,

            reason:
                metadata.reason ||
                'unknown',

            source:
                metadata.source ||
                'default',

            environment:
                metadata.context
                    ?.environment ||
                this.options.environment,

            timestamp:
                new Date().toISOString(),
        };

        if (
            metadata.bucket !==
            undefined
        ) {

            result.bucket =
                metadata.bucket;
        }

        if (
            metadata.percentage !==
            undefined
        ) {

            result.percentage =
                metadata.percentage;
        }

        if (
            metadata.error
        ) {

            result.error =
                metadata.error;
        }

        this.recordEvaluation(
            result,
            metadata.context,
        );

        return deepFreeze(
            result,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Evaluation event recording.
     * -------------------------------------------------------------------------
     */

    recordEvaluation(
        result,
        context,
    ) {

        if (
            !this.options
                .diagnostics
                .enabled ||
            !this.options
                .diagnostics
                .logEvaluations
        ) {

            return;
        }

        const event = {
            key:
                result.key,

            value:
                result.value,

            reason:
                result.reason,

            source:
                result.source,

            environment:
                result.environment,

            tenantId:
                this.options
                    .diagnostics
                    .exposeEvaluationContext
                    ? context?.tenantId ||
                        null
                    : undefined,

            userId:
                this.options
                    .diagnostics
                    .exposeEvaluationContext
                    ? context?.userId ||
                        null
                    : undefined,

            timestamp:
                result.timestamp,
        };

        this.evaluationEvents.unshift(
            event,
        );

        if (
            this.evaluationEvents.length >
            this.options
                .diagnostics
                .maxEvents
        ) {

            this.evaluationEvents.length =
                this.options
                    .diagnostics
                    .maxEvents;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Cache.
     * -------------------------------------------------------------------------
     */

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

        return entry.value;
    }

    cacheEvaluation(
        key,
        value,
    ) {

        if (
            !this.options.cacheEnabled
        ) {

            return value;
        }

        this.cache.set(
            key,
            {
                value,

                expiresAt:
                    Date.now() +
                    this.options
                        .cacheTtlMs,
            },
        );

        return value;
    }

    clearCache() {

        this.cache.clear();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Public convenience methods.
     * -------------------------------------------------------------------------
     */

    isEnabled(
        key,
        context = {},
        options = {},
    ) {

        return (
            this.evaluate(
                key,
                context,
                options,
            ).value ===
            true
        );
    }

    isDisabled(
        key,
        context = {},
        options = {},
    ) {

        return !this.isEnabled(
            key,
            context,
            options,
        );
    }

    getBoolean(
        key,
        defaultValue = false,
        context = {},
    ) {

        const result =
            this.evaluate(
                key,
                context,
                {
                    default:
                        defaultValue,
                },
            );

        return asBoolean(
            result.value,
            defaultValue,
        );
    }

    getString(
        key,
        defaultValue = '',
        context = {},
    ) {

        const result =
            this.evaluate(
                key,
                context,
                {
                    default:
                        defaultValue,
                },
            );

        return String(
            result.value ??
            defaultValue,
        );
    }

    getNumber(
        key,
        defaultValue = 0,
        context = {},
    ) {

        const result =
            this.evaluate(
                key,
                context,
                {
                    default:
                        defaultValue,
                },
            );

        return asNumber(
            result.value,
            defaultValue,
        );
    }

    getJson(
        key,
        defaultValue = {},
        context = {},
    ) {

        const result =
            this.evaluate(
                key,
                context,
                {
                    default:
                        defaultValue,
                },
            );

        return (
            result.value &&
            typeof result.value ===
                'object'
                ? clone(
                    result.value,
                )
                : clone(
                    defaultValue,
                )
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Runtime mutation.
     * -------------------------------------------------------------------------
     */

    setOverride(
        key,
        value,
    ) {

        if (
            !this.options
                .allowRuntimeMutation
        ) {

            throw new FeatureFlagError(
                'Runtime feature flag mutation is disabled.',
                {
                    code:
                        'FEATURE_FLAG_RUNTIME_MUTATION_DISABLED',

                    flag:
                        key,
                },
            );
        }

        const definition =
            this.getDefinition(
                key,
            );

        if (
            !definition
        ) {

            throw new FeatureFlagError(
                `Unknown feature flag "${key}".`,
                {
                    code:
                        'FEATURE_FLAG_UNKNOWN',

                    flag:
                        key,
                },
            );
        }

        if (
            definition.critical
        ) {

            throw new FeatureFlagError(
                `Critical feature flag "${key}" cannot be changed at runtime.`,
                {
                    code:
                        'CRITICAL_FEATURE_FLAG_MUTATION_FORBIDDEN',

                    flag:
                        key,
                },
            );
        }

        this.overrides.set(
            key,
            this.coerceValue(
                value,
                definition.type,
            ),
        );

        this.clearCache();

        this.updatedAt =
            new Date();

        return true;
    }

    clearOverride(
        key,
    ) {

        if (
            !this.overrides.has(
                key,
            )
        ) {

            return false;
        }

        this.overrides.delete(
            key,
        );

        this.clearCache();

        this.updatedAt =
            new Date();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics.
     * -------------------------------------------------------------------------
     */

    getState() {

        return {
            state:
                this.state,

            initialized:
                this._initialized,

            flagCount:
                this.flags.size,

            overrideCount:
                this.overrides.size,

            cacheEntries:
                this.cache.size,

            initializedAt:
                this.initializedAt,

            updatedAt:
                this.updatedAt,

            errorCount:
                this.errors.length,

            warningCount:
                this.warnings.length,
        };
    }

    getDefinitions() {

        const output = {};

        for (
            const [
                key,
                definition,
            ] of this.flags.entries()
        ) {

            const sanitized =
                clone(
                    definition,
                );

            if (
                sanitized.metadata &&
                typeof sanitized.metadata ===
                    'object'
            ) {

                for (
                    const metadataKey of
                    Object.keys(
                        sanitized.metadata,
                    )
                ) {

                    if (
                        isSensitiveKey(
                            metadataKey,
                        )
                    ) {

                        sanitized.metadata[
                            metadataKey
                        ] =
                            '[REDACTED]';
                    }
                }
            }

            output[key] =
                sanitized;
        }

        return deepFreeze(
            output,
        );
    }

    snapshot() {

        const definitions =
            this.options
                .diagnostics
                .exposeDefinitions
                ? this.getDefinitions()
                : {};

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            environment:
                this.options.environment,

            initialized:
                this._initialized,

            initializedAt:
                this.initializedAt,

            updatedAt:
                this.updatedAt,

            featureCount:
                this.flags.size,

            activeOverrides:
                this.overrides.size,

            cacheEntries:
                this.cache.size,

            definitions,

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

                            flag:
                                error?.flag,

                            message:
                                error?.message,
                        }),
                ),

            evaluationEvents:
                this.options
                    .diagnostics
                    .logEvaluations
                    ? clone(
                        this.evaluationEvents,
                    )
                    : [],

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
                FEATURE_FLAG_STATES.INVALID &&
            this._initialized;

        return {
            status:
                healthy
                    ? 'healthy'
                    : 'degraded',

            healthy,

            featureCount:
                this.flags.size,

            initialized:
                this._initialized,

            state:
                this.state,

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
            this._initialized &&
            this.state !==
                FEATURE_FLAG_STATES.INVALID;

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            state:
                this.state,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Errors/warnings.
     * -------------------------------------------------------------------------
     */

    recordError(
        error,
    ) {

        this.errors.push(
            error,
        );

        if (
            this.errors.length >
            100
        ) {

            this.errors.shift();
        }

        return error;
    }

    recordWarning(
        warning,
    ) {

        this.warnings.push(
            warning,
        );

        if (
            this.warnings.length >
            100
        ) {

            this.warnings.shift();
        }

        return warning;
    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown.
     * -------------------------------------------------------------------------
     */

    shutdown() {

        this.cache.clear();

        this.state =
            FEATURE_FLAG_STATES
                .DISABLED;

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.flags.clear();

        this.overrides.clear();

        this.cache.clear();

        this.evaluationEvents.length =
            0;

        this.errors.length =
            0;

        this.warnings.length =
            0;

        this.initializedAt =
            null;

        this.updatedAt =
            null;

        this._initialized =
            false;

        this.state =
            FEATURE_FLAG_STATES
                .DISABLED;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const featureFlags =
    new FeatureFlagProvider();

featureFlags.initialize();

/**
 * =============================================================================
 * Lifecycle compatibility
 * =============================================================================
 */

function initialize(
    context = {},
    definitions = {},
) {

    featureFlags.initialize(
        definitions,
    );

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.featureFlags =
            featureFlags;

        context.featureFlagProvider =
            featureFlags;
    }

    return featureFlags;
}

function start(
    context = {},
    definitions = {},
) {

    return initialize(
        context,
        definitions,
    );
}

function bootstrap(
    context = {},
    definitions = {},
) {

    return start(
        context,
        definitions,
    );
}

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function evaluate(
    key,
    context,
    options,
) {

    return featureFlags.evaluate(
        key,
        context,
        options,
    );
}

function isEnabled(
    key,
    context,
    options,
) {

    return featureFlags.isEnabled(
        key,
        context,
        options,
    );
}

function isDisabled(
    key,
    context,
    options,
) {

    return featureFlags.isDisabled(
        key,
        context,
        options,
    );
}

function getBoolean(
    key,
    defaultValue,
    context,
) {

    return featureFlags.getBoolean(
        key,
        defaultValue,
        context,
    );
}

function getString(
    key,
    defaultValue,
    context,
) {

    return featureFlags.getString(
        key,
        defaultValue,
        context,
    );
}

function getNumber(
    key,
    defaultValue,
    context,
) {

    return featureFlags.getNumber(
        key,
        defaultValue,
        context,
    );
}

function getJson(
    key,
    defaultValue,
    context,
) {

    return featureFlags.getJson(
        key,
        defaultValue,
        context,
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
        featureFlags,

        FeatureFlagProvider,

        FeatureFlagError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        FEATURE_FLAG_STATES,

        FLAG_TYPES,

        ROLLOUT_STRATEGIES,

        FLAG_TARGETS,

        DEFAULTS,

        BUILTIN_FEATURES,

        /**
         * Lifecycle.
         */
        initialize,

        start,

        bootstrap,

        shutdown:
            () =>
                featureFlags.shutdown(),

        /**
         * Evaluation.
         */
        evaluate,

        isEnabled,

        isDisabled,

        getBoolean,

        getString,

        getNumber,

        getJson,

        /**
         * Definitions.
         */
        register:
            definition =>
                featureFlags.register(
                    definition,
                ),

        getDefinition:
            key =>
                featureFlags.getDefinition(
                    key,
                ),

        getDefinitions:
            () =>
                featureFlags.getDefinitions(),

        /**
         * Rollout.
         */
        calculateRolloutBucket,

        normalizeEvaluationContext,

        /**
         * Runtime overrides.
         */
        setOverride:
            (
                key,
                value,
            ) =>
                featureFlags.setOverride(
                    key,
                    value,
                ),

        clearOverride:
            key =>
                featureFlags.clearOverride(
                    key,
                ),

        /**
         * Cache.
         */
        clearCache:
            () =>
                featureFlags.clearCache(),

        /**
         * Diagnostics.
         */
        getState:
            () =>
                featureFlags.getState(),

        health:
            () =>
                featureFlags.health(),

        readiness:
            () =>
                featureFlags.readiness(),

        snapshot:
            () =>
                featureFlags.snapshot(),

        /**
         * Test support.
         */
        reset:
            () =>
                featureFlags.reset(),
    });