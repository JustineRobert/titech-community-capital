'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/ConfigurationProvider.js
 *
 * Purpose:
 *   Enterprise production-grade centralized configuration provider.
 *
 * Responsibilities:
 *   - Provide one canonical configuration access boundary.
 *   - Resolve configuration from the existing TITech configuration modules.
 *   - Support dot-notation configuration access.
 *   - Support explicit fallback values.
 *   - Provide immutable configuration snapshots.
 *   - Prevent accidental runtime configuration mutation.
 *   - Support environment-aware configuration.
 *   - Provide typed access helpers.
 *   - Provide safe diagnostics without exposing secrets.
 *   - Support bootstrap/lifecycle consumers.
 *   - Avoid circular dependency initialization wherever possible.
 *
 * IMPORTANT:
 *
 *   This module is a CONFIGURATION CONSUMER/ADAPTER.
 *
 *   It does NOT:
 *     - load databases.
 *     - create Redis clients.
 *     - create HTTP servers.
 *     - initialize Express.
 *     - mutate process.env.
 *     - execute business logic.
 *     - own financial state.
 *
 * Canonical configuration flow:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js / config modules
 *       ↓
 *   ConfigurationProvider
 *       ↓
 *   application / bootstrap / infrastructure
 *
 * =============================================================================
 */

const process =
    require('node:process');

const path =
    require('node:path');

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional dependency loading
 * =============================================================================
 *
 * ConfigurationProvider must remain loadable even when one optional config
 * module is unavailable. The individual configuration module remains
 * authoritative for its own validation.
 * =============================================================================
 */

function safeRequire(
    modulePath,
) {

    try {

        // eslint-disable-next-line global-require, import/no-dynamic-require
        return require(
            modulePath,
        );

    } catch {

        return null;
    }
}

/**
 * =============================================================================
 * Optional Logger
 * =============================================================================
 */

const loggerModule =
    safeRequire(
        '../../utils/logger',
    );

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'configuration-provider';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const CONFIGURATION_STATES =
    Object.freeze({
        INITIALIZING:
            'initializing',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',

        STOPPED:
            'stopped',
    });

const CONFIGURATION_SOURCES =
    Object.freeze({
        DEFAULT:
            'default',

        ENVIRONMENT:
            'environment',

        MODULE:
            'module',

        RUNTIME:
            'runtime',

        FALLBACK:
            'fallback',
    });

/**
 * =============================================================================
 * Known configuration modules
 * =============================================================================
 *
 * Loaded lazily to avoid forcing unrelated infrastructure into the bootstrap
 * graph.
 * =============================================================================
 */

const CONFIGURATION_MODULES =
    Object.freeze({
        environment:
            '../environment',

        bootstrapEnvironment:
            '../bootstrapEnvironment',

        defaults:
            '../defaults',

        audit:
            '../audit',

        cache:
            '../cache',

        cors:
            '../cors',

        featureFlags:
            '../featureFlags',

        fingerprint:
            '../fingerprint',

        jwt:
            '../jwt',

        logger:
            '../logger',

        mail:
            '../mail',

        performanceOptimization:
            '../performanceOptimization',

        queues:
            '../queues',

        redis:
            '../redis',

        runtime:
            '../runtime',

        storage:
            '../storage',

        swagger:
            '../swagger',

        swaggerConfig:
            '../swaggerConfig',

        tenants:
            '../tenants',
    });

/**
 * =============================================================================
 * Sensitive field patterns
 * =============================================================================
 */

const SENSITIVE_KEYS =
    Object.freeze([
        'password',
        'passwd',
        'secret',
        'token',
        'accessToken',
        'refreshToken',
        'authorization',
        'apiKey',
        'api_key',
        'privateKey',
        'private_key',
        'clientSecret',
        'client_secret',
        'encryptionKey',
        'encryption_key',
        'signingKey',
        'signing_key',
        'sessionSecret',
        'cookieSecret',
        'redisPassword',
        'mongoUri',
        'mongoUriFallback',
        'connectionString',
        'connectionUri',
        'dsn',
        'smtpPassword',
        'jwtSecret',
    ]);

const SENSITIVE_PATTERN =
    /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|signing[_-]?key|connection[_-]?(string|uri)|smtp[_-]?password|jwt[_-]?secret)/i;

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class ConfigurationProviderError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'ConfigurationProviderError';

        this.code =
            options.code ||
            'CONFIGURATION_PROVIDER_ERROR';

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
            ConfigurationProviderError,
        );
    }
}

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function isPlainObject(
    value,
) {

    if (
        value === null ||
        typeof value !==
            'object'
    ) {

        return false;
    }

    const prototype =
        Object.getPrototypeOf(
            value,
        );

    return (
        prototype ===
            Object.prototype ||
        prototype ===
            null
    );
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

function cloneValue(
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
                cloneValue(
                    item,
                ),
        );
    }

    if (
        isPlainObject(
            value,
        )
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
                cloneValue(
                    item,
                );
        }

        return result;
    }

    return value;
}

function getByPath(
    object,
    pathExpression,
    fallback,
) {

    if (
        !pathExpression
    ) {

        return (
            object === undefined
                ? fallback
                : object
        );
    }

    const parts =
        Array.isArray(
            pathExpression,
        )
            ? pathExpression
            : String(
                pathExpression,
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

function hasPath(
    object,
    pathExpression,
) {

    const sentinel =
        Symbol(
            'missing',
        );

    return (
        getByPath(
            object,
            pathExpression,
            sentinel,
        ) !==
        sentinel
    );
}

function setByPath(
    object,
    pathExpression,
    value,
) {

    if (
        !pathExpression
    ) {

        throw new ConfigurationProviderError(
            'Configuration path is required.',
            {
                code:
                    'CONFIGURATION_PATH_REQUIRED',
            },
        );
    }

    const parts =
        Array.isArray(
            pathExpression,
        )
            ? pathExpression
            : String(
                pathExpression,
            )
                .split('.')
                .filter(Boolean);

    let current =
        object;

    parts.forEach(
        (
            part,
            index,
        ) => {

            const final =
                index ===
                parts.length - 1;

            if (
                final
            ) {

                current[part] =
                    value;

                return;
            }

            if (
                !isPlainObject(
                    current[part],
                )
            ) {

                current[part] =
                    {};
            }

            current =
                current[part];
        },
    );

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
        );
}

function normalizeEnvironment(
    value,
) {

    const normalized =
        String(
            value ||
            process.env.NODE_ENV ||
            'development',
        )
            .trim()
            .toLowerCase();

    return (
        [
            'development',
            'test',
            'staging',
            'production',
        ].includes(
            normalized,
        )
            ? normalized
            : 'development'
    );
}

function isSensitiveKey(
    key,
) {

    return (
        SENSITIVE_KEYS.includes(
            key,
        ) ||
        SENSITIVE_PATTERN.test(
            key,
        )
    );
}

/**
 * =============================================================================
 * Sanitization
 * =============================================================================
 */

function sanitizeForDiagnostics(
    value,
    options = {},
    keyPath = '',
    seen = new WeakSet(),
) {

    const {
        redactSecrets = true,
        maxDepth = 12,
    } =
        options;

    if (
        keyPath
            .split('.')
            .length >
        maxDepth
    ) {

        return '[MAX_DEPTH]';
    }

    if (
        value === undefined
    ) {

        return undefined;
    }

    if (
        value === null
    ) {

        return null;
    }

    if (
        typeof value ===
        'string' ||
        typeof value ===
        'number' ||
        typeof value ===
        'boolean'
    ) {

        if (
            redactSecrets &&
            isSensitiveKey(
                keyPath.split('.').pop() || '',
            )
        ) {

            return '[REDACTED]';
        }

        return value;
    }

    if (
        typeof value ===
        'bigint'
    ) {

        return `${value}n`;
    }

    if (
        typeof value ===
        'function'
    ) {

        return '[FUNCTION]';
    }

    if (
        typeof value !==
        'object'
    ) {

        return String(
            value,
        );
    }

    if (
        seen.has(
            value,
        )
    ) {

        return '[CIRCULAR]';
    }

    seen.add(
        value,
    );

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            (
                item,
                index,
            ) =>
                sanitizeForDiagnostics(
                    item,
                    options,
                    keyPath
                        ? `${keyPath}.${index}`
                        : String(index),
                    seen,
                ),
        );
    }

    const result = {};

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        const childPath =
            keyPath
                ? `${keyPath}.${key}`
                : key;

        if (
            redactSecrets &&
            isSensitiveKey(
                key,
            )
        ) {

            result[key] =
                '[REDACTED]';

            continue;
        }

        result[key] =
            sanitizeForDiagnostics(
                item,
                options,
                childPath,
                seen,
            );
    }

    return result;
}

/**
 * =============================================================================
 * Environment provider
 * =============================================================================
 */

function readEnvironmentSnapshot() {

    return Object.freeze({
        NODE_ENV:
            process.env.NODE_ENV ||
            'development',

        NODE_VERSION:
            process.version,

        PLATFORM:
            process.platform,

        ARCHITECTURE:
            process.arch,

        PID:
            process.pid,
    });
}

/**
 * =============================================================================
 * Logger helper
 * =============================================================================
 */

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
        }

    } catch {
        // Configuration must never fail because logging failed.
    }
}

/**
 * =============================================================================
 * Provider class
 * =============================================================================
 */

class ConfigurationProvider {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                environment:
                    normalizeEnvironment(
                        options.environment,
                    ),

                strict:
                    options.strict ??
                    true,

                immutable:
                    options.immutable ??
                    true,

                loadModules:
                    options.loadModules ??
                    true,

                includeEnvironment:
                    options.includeEnvironment ??
                    true,

                includeDefaults:
                    options.includeDefaults ??
                    true,

                allowRuntimeOverrides:
                    options.allowRuntimeOverrides ??
                    false,

                failOnModuleError:
                    options.failOnModuleError ??
                    false,
            });

        this.state =
            CONFIGURATION_STATES
                .INITIALIZING;

        this.initializedAt =
            null;

        this.updatedAt =
            null;

        this.errors =
            [];

        this.warnings =
            [];

        this.modules =
            new Map();

        this.sources =
            new Map();

        this.configuration =
            {};

        this.runtimeOverrides =
            {};

        this._initialized =
            false;

        this._initializationPromise =
            null;

        if (
            options.autoInitialize !==
            false
        ) {

            this.initialize();

        }
    }

    /**
     * -------------------------------------------------------------------------
     * Module loading
     * -------------------------------------------------------------------------
     */

    loadModule(
        name,
        options = {},
    ) {

        if (
            typeof name !==
            'string' ||
            !name.trim()
        ) {

            throw new ConfigurationProviderError(
                'Configuration module name is required.',
                {
                    code:
                        'CONFIGURATION_MODULE_NAME_REQUIRED',
                },
            );
        }

        const normalizedName =
            name.trim();

        const modulePath =
            options.path ||
            CONFIGURATION_MODULES[
                normalizedName
            ];

        if (
            !modulePath
        ) {

            if (
                options.required
            ) {

                throw new ConfigurationProviderError(
                    `Unknown configuration module "${normalizedName}".`,
                    {
                        code:
                            'CONFIGURATION_MODULE_UNKNOWN',

                        path:
                            normalizedName,
                    },
                );
            }

            return null;
        }

        if (
            this.modules.has(
                normalizedName,
            )
        ) {

            return this.modules.get(
                normalizedName,
            );
        }

        const started =
            process.hrtime.bigint();

        try {

            const loaded =
                safeRequire(
                    modulePath,
                );

            if (
                loaded === null
            ) {

                throw new ConfigurationProviderError(
                    `Unable to load configuration module "${normalizedName}".`,
                    {
                        code:
                            'CONFIGURATION_MODULE_LOAD_FAILED',

                        path:
                            normalizedName,
                    },
                );
            }

            const record = {
                name:
                    normalizedName,

                modulePath,

                module:
                    loaded,

                loadedAt:
                    new Date(),

                durationMs:
                    Number(
                        process.hrtime.bigint() -
                        started,
                    ) /
                    1_000_000,

                error:
                    null,
            };

            this.modules.set(
                normalizedName,
                Object.freeze(
                    record,
                ),
            );

            return loaded;

        } catch (error) {

            const normalizedError =
                error instanceof
                ConfigurationProviderError
                    ? error
                    : new ConfigurationProviderError(
                        `Failed to load configuration module "${normalizedName}".`,
                        {
                            code:
                                'CONFIGURATION_MODULE_LOAD_FAILED',

                            path:
                                normalizedName,

                            cause:
                                error,
                        },
                    );

            const record = {
                name:
                    normalizedName,

                modulePath,

                module:
                    null,

                loadedAt:
                    new Date(),

                durationMs:
                    Number(
                        process.hrtime.bigint() -
                        started,
                    ) /
                    1_000_000,

                error:
                    normalizedError,
            };

            this.modules.set(
                normalizedName,
                Object.freeze(
                    record,
                ),
            );

            this.errors.push(
                normalizedError,
            );

            if (
                options.required ||
                this.options.failOnModuleError
            ) {

                throw normalizedError;
            }

            this.warnings.push({
                module:
                    normalizedName,

                code:
                    normalizedError.code,

                message:
                    normalizedError.message,
            });

            return null;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Extract canonical configuration from module.
     * -------------------------------------------------------------------------
     */

    extractModuleConfiguration(
        name,
        moduleValue,
    ) {

        if (
            moduleValue ===
            null ||
            moduleValue ===
            undefined
        ) {

            return undefined;
        }

        /**
         * A module may expose:
         *
         *   config
         *   default
         *   environment
         *   runtime
         *   redis
         *   storage
         *   tenants
         *   swagger
         *
         * Prefer the explicit `config` field where available.
         */
        if (
            Object.prototype.hasOwnProperty.call(
                moduleValue,
                'config',
            )
        ) {

            return moduleValue.config;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                moduleValue,
                name,
            )
        ) {

            return moduleValue[
                name
            ];
        }

        if (
            Object.prototype.hasOwnProperty.call(
                moduleValue,
                'default',
            )
        ) {

            return moduleValue.default;
        }

        if (
            isPlainObject(
                moduleValue,
            )
        ) {

            return moduleValue;
        }

        return moduleValue;
    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap.
     * -------------------------------------------------------------------------
     */

    async initialize() {

        if (
            this._initialized
        ) {

            return this;
        }

        if (
            this._initializationPromise
        ) {

            return this._initializationPromise;
        }

        this._initializationPromise =
            (async () => {

                this.state =
                    CONFIGURATION_STATES
                        .INITIALIZING;

                this.initializedAt =
                    new Date();

                this.errors.length =
                    0;

                this.warnings.length =
                    0;

                try {

                    const environment =
                        normalizeEnvironment(
                            this.options
                                .environment,
                        );

                    this.options =
                        Object.freeze({
                            ...this.options,

                            environment,
                        });

                    /**
                     * ---------------------------------------------------------
                     * Base application/environment metadata
                     * ---------------------------------------------------------
                     */

                    setByPath(
                        this.configuration,
                        'app.environment',
                        environment,
                    );

                    setByPath(
                        this.configuration,
                        'app.serviceName',
                        SERVICE_NAME,
                    );

                    setByPath(
                        this.configuration,
                        'app.name',
                        APPLICATION_NAME,
                    );

                    setByPath(
                        this.configuration,
                        'app.version',
                        process.env.APP_VERSION ||
                            process.env.npm_package_version ||
                            '0.0.0',
                    );

                    setByPath(
                        this.configuration,
                        'runtime.process',
                        readEnvironmentSnapshot(),
                    );

                    /**
                     * ---------------------------------------------------------
                     * Load configuration modules.
                     * ---------------------------------------------------------
                     */

                    if (
                        this.options.loadModules
                    ) {

                        for (
                            const [
                                name,
                                modulePath,
                            ] of Object.entries(
                                CONFIGURATION_MODULES,
                            )
                        ) {

                            const loaded =
                                this.loadModule(
                                    name,
                                    {
                                        path:
                                            modulePath,

                                        required:
                                            false,
                                    },
                                );

                            if (
                                loaded ===
                                null
                            ) {

                                continue;
                            }

                            const extracted =
                                this.extractModuleConfiguration(
                                    name,
                                    loaded,
                                );

                            if (
                                extracted ===
                                undefined
                            ) {

                                continue;
                            }

                            setByPath(
                                this.configuration,
                                name,
                                cloneValue(
                                    extracted,
                                ),
                            );

                            this.sources.set(
                                name,
                                CONFIGURATION_SOURCES
                                    .MODULE,
                            );
                        }
                    }

                    /**
                     * ---------------------------------------------------------
                     * Add direct environment metadata.
                     * ---------------------------------------------------------
                     */

                    if (
                        this.options
                            .includeEnvironment
                    ) {

                        setByPath(
                            this.configuration,
                            'environment',
                            cloneValue(
                                readEnvironmentSnapshot(),
                            ),
                        );

                        this.sources.set(
                            'environment',
                            CONFIGURATION_SOURCES
                                .ENVIRONMENT,
                        );
                    }

                    /**
                     * ---------------------------------------------------------
                     * Add common runtime values.
                     * ---------------------------------------------------------
                     */

                    setByPath(
                        this.configuration,
                        'meta.component',
                        COMPONENT,
                    );

                    setByPath(
                        this.configuration,
                        'meta.service',
                        SERVICE_NAME,
                    );

                    setByPath(
                        this.configuration,
                        'meta.application',
                        APPLICATION_NAME,
                    );

                    setByPath(
                        this.configuration,
                        'meta.environment',
                        environment,
                    );

                    setByPath(
                        this.configuration,
                        'meta.initializedAt',
                        this.initializedAt
                            .toISOString(),
                    );

                    /**
                     * ---------------------------------------------------------
                     * Freeze configuration.
                     * ---------------------------------------------------------
                     */

                    if (
                        this.options.immutable
                    ) {

                        this.configuration =
                            deepFreeze(
                                this.configuration,
                            );
                    }

                    this.updatedAt =
                        new Date();

                    this._initialized =
                        true;

                    this.state =
                        this.errors.length >
                            0
                            ? CONFIGURATION_STATES
                                .DEGRADED
                            : CONFIGURATION_STATES
                                .READY;

                    log(
                        'info',
                        {
                            state:
                                this.state,

                            moduleCount:
                                this.modules.size,

                            warningCount:
                                this.warnings.length,

                            errorCount:
                                this.errors.length,
                        },
                        'TITech configuration provider initialized.',
                    );

                    return this;

                } catch (error) {

                    this.state =
                        CONFIGURATION_STATES
                            .INVALID;

                    this.errors.push(
                        error,
                    );

                    log(
                        'error',
                        {
                            error: {
                                name:
                                    error?.name,

                                code:
                                    error?.code,

                                message:
                                    error?.message,
                            },
                        },
                        'TITech configuration provider initialization failed.',
                    );

                    throw (
                        error instanceof
                        ConfigurationProviderError
                            ? error
                            : new ConfigurationProviderError(
                                'TITech configuration provider initialization failed.',
                                {
                                    code:
                                        'CONFIGURATION_INITIALIZATION_FAILED',

                                    cause:
                                        error,
                                },
                            )
                    );
                }
            })();

        try {

            return await this._initializationPromise;

        } finally {

            if (
                this.state ===
                CONFIGURATION_STATES
                    .INVALID
            ) {

                this._initializationPromise =
                    null;
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Synchronous ensure initialized.
     * -------------------------------------------------------------------------
     *
     * Configuration modules in this architecture are loaded synchronously,
     * therefore most consumers can safely use get() immediately after
     * requiring this provider.
     * -------------------------------------------------------------------------
     */

    ensureInitialized() {

        if (
            !this._initialized
        ) {

            /**
             * The constructor performs the synchronous configuration build.
             * The asynchronous lifecycle method remains available for bootstrap
             * integrations.
             */
            this.buildSynchronously();
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Synchronous configuration builder.
     * -------------------------------------------------------------------------
     */

    buildSynchronously() {

        if (
            this._initialized
        ) {

            return this;
        }

        this.state =
            CONFIGURATION_STATES
                .INITIALIZING;

        this.initializedAt =
            this.initializedAt ||
            new Date();

        try {

            setByPath(
                this.configuration,
                'app.environment',
                normalizeEnvironment(
                    this.options
                        .environment,
                ),
            );

            setByPath(
                this.configuration,
                'app.serviceName',
                SERVICE_NAME,
            );

            setByPath(
                this.configuration,
                'app.name',
                APPLICATION_NAME,
            );

            setByPath(
                this.configuration,
                'app.version',
                process.env.APP_VERSION ||
                    process.env.npm_package_version ||
                    '0.0.0',
            );

            if (
                this.options
                    .loadModules
            ) {

                for (
                    const [
                        name,
                        modulePath,
                    ] of Object.entries(
                        CONFIGURATION_MODULES,
                    )
                ) {

                    const loaded =
                        this.loadModule(
                            name,
                            {
                                path:
                                    modulePath,

                                required:
                                    false,
                            },
                        );

                    if (
                        loaded ===
                        null
                    ) {

                        continue;
                    }

                    const extracted =
                        this.extractModuleConfiguration(
                            name,
                            loaded,
                        );

                    if (
                        extracted ===
                        undefined
                    ) {

                        continue;
                    }

                    setByPath(
                        this.configuration,
                        name,
                        cloneValue(
                            extracted,
                        ),
                    );

                    this.sources.set(
                        name,
                        CONFIGURATION_SOURCES
                            .MODULE,
                    );
                }
            }

            if (
                this.options
                    .includeEnvironment
            ) {

                setByPath(
                    this.configuration,
                    'environment',
                    cloneValue(
                        readEnvironmentSnapshot(),
                    ),
                );

                this.sources.set(
                    'environment',
                    CONFIGURATION_SOURCES
                        .ENVIRONMENT,
                );
            }

            setByPath(
                this.configuration,
                'meta',
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    environment:
                        normalizeEnvironment(
                            this.options
                                .environment,
                        ),

                    initializedAt:
                        this.initializedAt
                            .toISOString(),
                },
            );

            if (
                this.options.immutable
            ) {

                this.configuration =
                    deepFreeze(
                        this.configuration,
                    );
            }

            this.updatedAt =
                new Date();

            this._initialized =
                true;

            this.state =
                this.errors.length >
                    0
                    ? CONFIGURATION_STATES
                        .DEGRADED
                    : CONFIGURATION_STATES
                        .READY;

            return this;

        } catch (error) {

            this.state =
                CONFIGURATION_STATES
                    .INVALID;

            this.errors.push(
                error,
            );

            throw (
                error instanceof
                ConfigurationProviderError
                    ? error
                    : new ConfigurationProviderError(
                        'TITech synchronous configuration initialization failed.',
                        {
                            code:
                                'CONFIGURATION_SYNC_INITIALIZATION_FAILED',

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Value access.
     * -------------------------------------------------------------------------
     */

    get(
        pathExpression,
        fallback = undefined,
    ) {

        this.ensureInitialized();

        const normalizedPath =
            normalizePath(
                pathExpression,
            );

        /**
         * Runtime overrides deliberately take precedence only when explicitly
         * enabled.
         */
        if (
            this.options
                .allowRuntimeOverrides &&
            hasPath(
                this.runtimeOverrides,
                normalizedPath,
            )
        ) {

            return getByPath(
                this.runtimeOverrides,
                normalizedPath,
                fallback,
            );
        }

        return getByPath(
            this.configuration,
            normalizedPath,
            fallback,
        );
    }

    has(
        pathExpression,
    ) {

        this.ensureInitialized();

        const normalizedPath =
            normalizePath(
                pathExpression,
            );

        if (
            this.options
                .allowRuntimeOverrides &&
            hasPath(
                this.runtimeOverrides,
                normalizedPath,
            )
        ) {

            return true;
        }

        return hasPath(
            this.configuration,
            normalizedPath,
        );
    }

    require(
        pathExpression,
    ) {

        const value =
            this.get(
                pathExpression,
                undefined,
            );

        if (
            value === undefined ||
            value === null
        ) {

            throw new ConfigurationProviderError(
                `Required configuration "${pathExpression}" is unavailable.`,
                {
                    code:
                        'REQUIRED_CONFIGURATION_MISSING',

                    path:
                        pathExpression,
                },
            );
        }

        return value;
    }

    /**
     * -------------------------------------------------------------------------
     * Typed accessors.
     * -------------------------------------------------------------------------
     */

    getString(
        pathExpression,
        fallback = undefined,
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

        if (
            value === undefined ||
            value === null
        ) {

            return fallback;
        }

        return String(
            value,
        );
    }

    getBoolean(
        pathExpression,
        fallback = false,
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

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

    getNumber(
        pathExpression,
        fallback = undefined,
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

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

    getInteger(
        pathExpression,
        fallback = undefined,
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

        const parsed =
            Number(
                value,
            );

        return Number.isInteger(
            parsed,
        )
            ? parsed
            : fallback;
    }

    getArray(
        pathExpression,
        fallback = [],
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

        return Array.isArray(
            value,
        )
            ? value
            : fallback;
    }

    getObject(
        pathExpression,
        fallback = {},
    ) {

        const value =
            this.get(
                pathExpression,
                fallback,
            );

        return isPlainObject(
            value,
        )
            ? value
            : fallback;
    }

    /**
     * -------------------------------------------------------------------------
     * Environment.
     * -------------------------------------------------------------------------
     */

    getEnvironment() {

        return normalizeEnvironment(
            this.get(
                'app.environment',
                process.env.NODE_ENV ||
                    'development',
            ),
        );
    }

    isDevelopment() {

        return (
            this.getEnvironment() ===
            'development'
        );
    }

    isTest() {

        return (
            this.getEnvironment() ===
            'test'
        );
    }

    isStaging() {

        return (
            this.getEnvironment() ===
            'staging'
        );
    }

    isProduction() {

        return (
            this.getEnvironment() ===
            'production'
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Runtime overrides.
     * -------------------------------------------------------------------------
     */

    setRuntime(
        pathExpression,
        value,
    ) {

        if (
            !this.options
                .allowRuntimeOverrides
        ) {

            throw new ConfigurationProviderError(
                'Runtime configuration overrides are disabled.',
                {
                    code:
                        'RUNTIME_CONFIGURATION_OVERRIDE_DISABLED',

                    path:
                        pathExpression,
                },
            );
        }

        const normalizedPath =
            normalizePath(
                pathExpression,
            );

        if (
            isSensitiveKey(
                normalizedPath
                    .split('.')
                    .pop(),
            )
        ) {

            throw new ConfigurationProviderError(
                'Sensitive configuration values cannot be overridden at runtime.',
                {
                    code:
                        'SENSITIVE_RUNTIME_OVERRIDE_FORBIDDEN',

                    path:
                        normalizedPath,
                },
            );
        }

        this.runtimeOverrides =
            cloneValue(
                this.runtimeOverrides,
            );

        setByPath(
            this.runtimeOverrides,
            normalizedPath,
            value,
        );

        if (
            this.options
                .immutable
        ) {

            this.runtimeOverrides =
                deepFreeze(
                    this.runtimeOverrides,
                );
        }

        this.updatedAt =
            new Date();

        return this.get(
            normalizedPath,
        );
    }

    clearRuntimeOverride(
        pathExpression,
    ) {

        if (
            !this.options
                .allowRuntimeOverrides
        ) {

            return false;
        }

        const normalizedPath =
            normalizePath(
                pathExpression,
            );

        const parts =
            normalizedPath
                .split('.')
                .filter(Boolean);

        if (
            parts.length ===
            0
        ) {

            return false;
        }

        const parentPath =
            parts.slice(
                0,
                -1,
            );

        const leaf =
            parts[
                parts.length - 1
            ];

        const parent =
            getByPath(
                this.runtimeOverrides,
                parentPath,
                null,
            );

        if (
            !parent ||
            typeof parent !==
                'object'
        ) {

            return false;
        }

        const clone =
            cloneValue(
                this.runtimeOverrides,
            );

        const cloneParent =
            getByPath(
                clone,
                parentPath,
                null,
            );

        if (
            !cloneParent ||
            typeof cloneParent !==
                'object'
        ) {

            return false;
        }

        delete cloneParent[
            leaf
        ];

        this.runtimeOverrides =
            this.options
                .immutable
                ? deepFreeze(
                    clone,
                )
                : clone;

        this.updatedAt =
            new Date();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Configuration snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        this.ensureInitialized();

        const {
            includeSecrets =
                false,
            includeRuntimeOverrides =
                false,
        } =
            options;

        const snapshot =
            cloneValue(
                this.configuration,
            );

        if (
            includeRuntimeOverrides &&
            this.options
                .allowRuntimeOverrides
        ) {

            setByPath(
                snapshot,
                '_runtimeOverrides',
                cloneValue(
                    this.runtimeOverrides,
                ),
            );
        }

        return deepFreeze(
            sanitizeForDiagnostics(
                snapshot,
                {
                    redactSecrets:
                        !includeSecrets,

                    maxDepth:
                        20,
                },
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe operational snapshot.
     * -------------------------------------------------------------------------
     */

    operationalSnapshot() {

        this.ensureInitialized();

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
                this.getEnvironment(),

            initialized:
                this._initialized,

            initializedAt:
                this.initializedAt,

            updatedAt:
                this.updatedAt,

            moduleCount:
                this.modules.size,

            loadedModules:
                [
                    ...this.modules.values(),
                ].filter(
                    record =>
                        Boolean(
                            record.module,
                        ),
                ).map(
                    record =>
                        ({
                            name:
                                record.name,

                            modulePath:
                                record.modulePath,

                            loadedAt:
                                record.loadedAt,

                            durationMs:
                                Number(
                                    record.durationMs.toFixed(
                                        3,
                                    ),
                                ),

                            available:
                                Boolean(
                                    record.module,
                                ),

                            error:
                                record.error
                                    ? {
                                        code:
                                            record.error.code,

                                        message:
                                            record.error.message,
                                    }
                                    : null,
                        }),
                ),

            warningCount:
                this.warnings.length,

            errorCount:
                this.errors.length,

            warnings:
                this.warnings.map(
                    warning =>
                        ({
                            ...warning,
                        }),
                ),

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

                            path:
                                error?.path ||
                                null,
                        }),
                ),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Configuration fingerprint.
     * -------------------------------------------------------------------------
     */

    fingerprint(
        options = {},
    ) {

        const {
            includeSecrets =
                false,
        } =
            options;

        const snapshot =
            sanitizeForDiagnostics(
                this.snapshot(
                    {
                        includeSecrets,
                    },
                ),
                {
                    redactSecrets:
                        !includeSecrets,
                },
            );

        const canonical =
            JSON.stringify(
                snapshot,
                Object.keys(
                    snapshot,
                ).sort(),
            );

        return crypto
            .createHash(
                'sha256',
            )
            .update(
                canonical,
                'utf8',
            )
            .digest(
                'hex',
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Module access.
     * -------------------------------------------------------------------------
     */

    getModule(
        name,
    ) {

        this.ensureInitialized();

        const record =
            this.modules.get(
                name,
            );

        return (
            record?.module ||
            undefined
        );
    }

    hasModule(
        name,
    ) {

        this.ensureInitialized();

        return this.modules.has(
            name,
        );
    }

    getModuleRecord(
        name,
    ) {

        this.ensureInitialized();

        const record =
            this.modules.get(
                name,
            );

        if (
            !record
        ) {

            return undefined;
        }

        return deepFreeze({
            ...record,

            module:
                '[HIDDEN]',
        });
    }

    listModules() {

        this.ensureInitialized();

        return Object.freeze(
            [
                ...this.modules.keys(),
            ],
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Source tracking.
     * -------------------------------------------------------------------------
     */

    getSource(
        pathExpression,
    ) {

        const normalizedPath =
            normalizePath(
                pathExpression,
            );

        const root =
            normalizedPath
                .split('.')[0];

        return (
            this.sources.get(
                root,
            ) ||
            CONFIGURATION_SOURCES
                .DEFAULT
        );
    }

    getSources() {

        this.ensureInitialized();

        return deepFreeze(
            Object.fromEntries(
                this.sources.entries(),
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Validate required values.
     * -------------------------------------------------------------------------
     */

    requireAll(
        paths = [],
    ) {

        if (
            !Array.isArray(
                paths,
            )
        ) {

            throw new ConfigurationProviderError(
                'Configuration paths must be an array.',
                {
                    code:
                        'CONFIGURATION_PATHS_INVALID',
                },
            );
        }

        const missing = [];

        for (
            const pathExpression of
            paths
        ) {

            try {

                this.require(
                    pathExpression,
                );

            } catch {

                missing.push(
                    pathExpression,
                );
            }
        }

        if (
            missing.length >
            0
        ) {

            throw new ConfigurationProviderError(
                'Required TITech configuration values are missing.',
                {
                    code:
                        'REQUIRED_CONFIGURATION_VALUES_MISSING',

                    details: {
                        missing,
                    },
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     *
     * Intended for isolated tests only.
     * -------------------------------------------------------------------------
     */

    reset(
        options = {},
    ) {

        if (
            this._initialized &&
            !options.force
        ) {

            throw new ConfigurationProviderError(
                'Active configuration provider cannot be reset without force.',
                {
                    code:
                        'CONFIGURATION_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            CONFIGURATION_STATES
                .STOPPED;

        this.initializedAt =
            null;

        this.updatedAt =
            null;

        this.modules.clear();

        this.sources.clear();

        this.errors.length =
            0;

        this.warnings.length =
            0;

        this.configuration =
            {};

        this.runtimeOverrides =
            {};

        this._initialized =
            false;

        this._initializationPromise =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const provider =
    new ConfigurationProvider({
        environment:
            process.env.NODE_ENV ||
            'development',

        strict:
            true,

        immutable:
            true,

        loadModules:
            true,

        includeEnvironment:
            true,

        includeDefaults:
            true,

        allowRuntimeOverrides:
            false,

        failOnModuleError:
            false,

        autoInitialize:
            false,
    });

/**
 * Build configuration synchronously so legacy consumers can safely call:
 *
 *   configProvider.get(...)
 *
 * immediately after require().
 */
provider.buildSynchronously();

/**
 * =============================================================================
 * Compatibility API
 * =============================================================================
 */

function get(
    pathExpression,
    fallback,
) {

    return provider.get(
        pathExpression,
        fallback,
    );
}

function has(
    pathExpression,
) {

    return provider.has(
        pathExpression,
    );
}

function requireConfig(
    pathExpression,
) {

    return provider.require(
        pathExpression,
    );
}

function getString(
    pathExpression,
    fallback,
) {

    return provider.getString(
        pathExpression,
        fallback,
    );
}

function getBoolean(
    pathExpression,
    fallback,
) {

    return provider.getBoolean(
        pathExpression,
        fallback,
    );
}

function getNumber(
    pathExpression,
    fallback,
) {

    return provider.getNumber(
        pathExpression,
        fallback,
    );
}

function getInteger(
    pathExpression,
    fallback,
) {

    return provider.getInteger(
        pathExpression,
        fallback,
    );
}

function getArray(
    pathExpression,
    fallback,
) {

    return provider.getArray(
        pathExpression,
        fallback,
    );
}

function getObject(
    pathExpression,
    fallback,
) {

    return provider.getObject(
        pathExpression,
        fallback,
    );
}

function getEnvironment() {

    return provider.getEnvironment();
}

function isDevelopment() {

    return provider.isDevelopment();
}

function isTest() {

    return provider.isTest();
}

function isStaging() {

    return provider.isStaging();
}

function isProduction() {

    return provider.isProduction();
}

function getConfiguration() {

    return provider.configuration;
}

function snapshot(
    options,
) {

    return provider.snapshot(
        options,
    );
}

function operationalSnapshot() {

    return provider.operationalSnapshot();
}

function fingerprint(
    options,
) {

    return provider.fingerprint(
        options,
    );
}

function getModule(
    name,
) {

    return provider.getModule(
        name,
    );
}

function hasModule(
    name,
) {

    return provider.hasModule(
        name,
    );
}

function listModules() {

    return provider.listModules();
}

function getSource(
    pathExpression,
) {

    return provider.getSource(
        pathExpression,
    );
}

function getSources() {

    return provider.getSources();
}

function requireAll(
    paths,
) {

    return provider.requireAll(
        paths,
    );
}

/**
 * =============================================================================
 * Lifecycle compatibility
 * =============================================================================
 */

async function initialize(
    context = {},
) {

    await provider.initialize();

    if (
        context &&
        typeof context ===
        'object'
    ) {

        context.configuration =
            provider;

        context.configProvider =
            provider;

        context.config =
            provider.configuration;
    }

    return provider;
}

async function start(
    context = {},
) {

    return initialize(
        context,
    );
}

async function bootstrap(
    context = {},
) {

    return start(
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
         * ---------------------------------------------------------------------
         * Canonical provider.
         * ---------------------------------------------------------------------
         */

        provider,

        ConfigurationProvider,

        ConfigurationProviderError,

        /**
         * ---------------------------------------------------------------------
         * Constants.
         * ---------------------------------------------------------------------
         */

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        CONFIGURATION_STATES,

        CONFIGURATION_SOURCES,

        CONFIGURATION_MODULES,

        /**
         * ---------------------------------------------------------------------
         * Direct access.
         * ---------------------------------------------------------------------
         */

        config:
            provider.configuration,

        configuration:
            provider.configuration,

        get,

        has,

        require:
            requireConfig,

        getString,

        getBoolean,

        getNumber,

        getInteger,

        getArray,

        getObject,

        getConfiguration,

        /**
         * ---------------------------------------------------------------------
         * Environment helpers.
         * ---------------------------------------------------------------------
         */

        getEnvironment,

        isDevelopment,

        isTest,

        isStaging,

        isProduction,

        /**
         * ---------------------------------------------------------------------
         * Modules.
         * ---------------------------------------------------------------------
         */

        getModule,

        hasModule,

        listModules,

        /**
         * ---------------------------------------------------------------------
         * Diagnostics.
         * ---------------------------------------------------------------------
         */

        snapshot,

        operationalSnapshot,

        fingerprint,

        getSource,

        getSources,

        requireAll,

        /**
         * ---------------------------------------------------------------------
         * Lifecycle.
         * ---------------------------------------------------------------------
         */

        initialize,

        start,

        bootstrap,

        /**
         * ---------------------------------------------------------------------
         * Low-level helpers.
         * ---------------------------------------------------------------------
         */

        getByPath,

        setByPath,

        normalizePath,

        sanitizeForDiagnostics,
    });