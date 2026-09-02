'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Transaction Configuration Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/utils/TransactionConfigurationUtils.js
 *
 * Enterprise configuration utility layer for the transaction/event subsystem.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * • Merge runtime, environment, and default configuration
 * • Normalize configuration into deterministic runtime types
 * • Validate configuration constraints
 * • Prevent unsafe configuration values
 * • Preserve immutable configuration boundaries
 * • Sanitize configuration before logging
 * • Protect against accidental mutation
 * • Support backward-compatible partial configuration overrides
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * • No mutation of caller-owned objects
 * • Deterministic configuration resolution
 * • Secure-by-default behavior
 * • Explicit numeric bounds
 * • Defensive handling of malformed input
 * • Production-safe logging
 * • Stable public API
 *
 * ============================================================================
 */

const {
    deepClone,
    deepFreeze,
    isPlainObject
} = require('./TransactionObjectUtils');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CONFIGURATION_NAMESPACE = 'transactions.events';

const MAX_NAMESPACE_LENGTH = 100;

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    namespace: CONFIGURATION_NAMESPACE,

    batch: {

        enabled: true,

        maxSize: 100,

        flushIntervalMs: 1000,

        concurrency: 4

    },

    retry: {

        enabled: true,

        maxAttempts: 10,

        initialDelayMs: 1000,

        maxDelayMs: 60000,

        backoffFactor: 2

    },

    outbox: {

        pollingIntervalMs: 500,

        cleanupIntervalMs: 3600000

    },

    health: {

        enabled: true,

        staleThresholdMs: 30000

    }

});

/**
 * ============================================================================
 * Configuration Bounds
 * ============================================================================
 *
 * Hard upper bounds protect the transaction subsystem from accidental
 * resource exhaustion caused by invalid configuration.
 */

const CONFIGURATION_LIMITS = Object.freeze({

    batch: Object.freeze({

        maxSize: {

            min: 1,

            max: 10000

        },

        flushIntervalMs: {

            min: 10,

            max: 300000

        },

        concurrency: {

            min: 1,

            max: 100

        }

    }),

    retry: Object.freeze({

        maxAttempts: {

            min: 1,

            max: 100

        },

        initialDelayMs: {

            min: 1,

            max: 300000

        },

        maxDelayMs: {

            min: 1,

            max: 3600000

        },

        backoffFactor: {

            min: 1,

            max: 10

        }

    }),

    outbox: Object.freeze({

        pollingIntervalMs: {

            min: 10,

            max: 300000

        },

        cleanupIntervalMs: {

            min: 1000,

            max: 86400000

        }

    }),

    health: Object.freeze({

        staleThresholdMs: {

            min: 1000,

            max: 3600000

        }

    })

});

/**
 * ============================================================================
 * Sensitive Configuration Keys
 * ============================================================================
 *
 * Case-insensitive matching is used when sanitizing configuration for logs.
 */

const SENSITIVE_KEYS = new Set([

    'password',

    'passwd',

    'secret',

    'token',

    'accesstoken',

    'refreshtoken',

    'authorization',

    'apikey',

    'api_key',

    'privatekey',

    'private_key',

    'clientsecret',

    'client_secret',

    'credentials',

    'credential',

    'connectionstring',

    'connection_string',

    'dsn',

    'encryptionkey',

    'encryption_key',

    'signingkey',

    'signing_key'

]);

const REDACTED_VALUE = '[REDACTED]';

/**
 * ============================================================================
 * Deep Configuration Merge
 * ============================================================================
 *
 * Does not mutate either source.
 *
 * Object values are recursively merged.
 * Arrays and primitive values replace the previous value.
 *
 * @param {Object} base
 * @param {Object} override
 * @returns {Object}
 */

function mergeConfiguration(base = {}, override = {}) {

    const target = isPlainObject(base)

        ? deepClone(base)

        : {};

    if (!isPlainObject(override)) {

        return target;

    }

    Object.keys(override).forEach(key => {

        const incoming = override[key];

        if (

            isPlainObject(incoming) &&

            isPlainObject(target[key])

        ) {

            target[key] = mergeConfiguration(

                target[key],

                incoming

            );

            return;

        }

        target[key] = deepClone(incoming);

    });

    return target;

}

/**
 * ============================================================================
 * Resolve Configuration Defaults
 * ============================================================================
 *
 * Resolution precedence:
 *
 *     DEFAULT_CONFIGURATION
 *              ↓
 *     environment configuration
 *              ↓
 *     runtime configuration
 *
 * Runtime configuration therefore always wins.
 *
 * @param {Object} configuration
 * @param {Object} environment
 * @returns {Object}
 */

function resolveDefaults(

    configuration = {},

    environment = {}

) {

    const defaults = deepClone(

        DEFAULT_CONFIGURATION

    );

    const withEnvironment = mergeConfiguration(

        defaults,

        normalizeEnvironmentConfiguration(environment)

    );

    return mergeConfiguration(

        withEnvironment,

        isPlainObject(configuration)

            ? configuration

            : {}

    );

}

/**
 * ============================================================================
 * Normalize Configuration
 * ============================================================================
 *
 * Produces immutable configuration suitable for runtime consumption.
 *
 * @param {Object} configuration
 * @returns {Object}
 */

function normalizeConfiguration(configuration = {}) {

    const source = isPlainObject(configuration)

        ? configuration

        : {};

    const normalized = mergeConfiguration(

        DEFAULT_CONFIGURATION,

        source

    );

    /**
     * ------------------------------------------------------------------------
     * Root Configuration
     * ------------------------------------------------------------------------
     */

    normalized.enabled = normalizeBoolean(

        normalized.enabled,

        DEFAULT_CONFIGURATION.enabled

    );

    normalized.namespace = sanitizeString(

        normalized.namespace,

        CONFIGURATION_NAMESPACE

    );

    /**
     * ------------------------------------------------------------------------
     * Batch Configuration
     * ------------------------------------------------------------------------
     */

    normalized.batch = normalizeObject(

        normalized.batch,

        DEFAULT_CONFIGURATION.batch

    );

    normalized.batch.enabled = normalizeBoolean(

        normalized.batch.enabled,

        DEFAULT_CONFIGURATION.batch.enabled

    );

    normalized.batch.maxSize = normalizeBoundedInteger(

        normalized.batch.maxSize,

        DEFAULT_CONFIGURATION.batch.maxSize,

        CONFIGURATION_LIMITS.batch.maxSize

    );

    normalized.batch.flushIntervalMs = normalizeBoundedInteger(

        normalized.batch.flushIntervalMs,

        DEFAULT_CONFIGURATION.batch.flushIntervalMs,

        CONFIGURATION_LIMITS.batch.flushIntervalMs

    );

    normalized.batch.concurrency = normalizeBoundedInteger(

        normalized.batch.concurrency,

        DEFAULT_CONFIGURATION.batch.concurrency,

        CONFIGURATION_LIMITS.batch.concurrency

    );

    /**
     * ------------------------------------------------------------------------
     * Retry Configuration
     * ------------------------------------------------------------------------
     */

    normalized.retry = normalizeObject(

        normalized.retry,

        DEFAULT_CONFIGURATION.retry

    );

    normalized.retry.enabled = normalizeBoolean(

        normalized.retry.enabled,

        DEFAULT_CONFIGURATION.retry.enabled

    );

    normalized.retry.maxAttempts = normalizeBoundedInteger(

        normalized.retry.maxAttempts,

        DEFAULT_CONFIGURATION.retry.maxAttempts,

        CONFIGURATION_LIMITS.retry.maxAttempts

    );

    normalized.retry.initialDelayMs = normalizeBoundedInteger(

        normalized.retry.initialDelayMs,

        DEFAULT_CONFIGURATION.retry.initialDelayMs,

        CONFIGURATION_LIMITS.retry.initialDelayMs

    );

    normalized.retry.maxDelayMs = normalizeBoundedInteger(

        normalized.retry.maxDelayMs,

        DEFAULT_CONFIGURATION.retry.maxDelayMs,

        CONFIGURATION_LIMITS.retry.maxDelayMs

    );

    normalized.retry.backoffFactor = normalizeBoundedNumber(

        normalized.retry.backoffFactor,

        DEFAULT_CONFIGURATION.retry.backoffFactor,

        CONFIGURATION_LIMITS.retry.backoffFactor

    );

    /**
     * ------------------------------------------------------------------------
     * Ensure Maximum Retry Delay Is Never Lower Than Initial Delay
     * ------------------------------------------------------------------------
     */

    if (

        normalized.retry.maxDelayMs <

        normalized.retry.initialDelayMs

    ) {

        normalized.retry.maxDelayMs =

            normalized.retry.initialDelayMs;

    }

    /**
     * ------------------------------------------------------------------------
     * Outbox Configuration
     * ------------------------------------------------------------------------
     */

    normalized.outbox = normalizeObject(

        normalized.outbox,

        DEFAULT_CONFIGURATION.outbox

    );

    normalized.outbox.pollingIntervalMs = normalizeBoundedInteger(

        normalized.outbox.pollingIntervalMs,

        DEFAULT_CONFIGURATION.outbox.pollingIntervalMs,

        CONFIGURATION_LIMITS.outbox.pollingIntervalMs

    );

    normalized.outbox.cleanupIntervalMs = normalizeBoundedInteger(

        normalized.outbox.cleanupIntervalMs,

        DEFAULT_CONFIGURATION.outbox.cleanupIntervalMs,

        CONFIGURATION_LIMITS.outbox.cleanupIntervalMs

    );

    /**
     * ------------------------------------------------------------------------
     * Health Configuration
     * ------------------------------------------------------------------------
     */

    normalized.health = normalizeObject(

        normalized.health,

        DEFAULT_CONFIGURATION.health

    );

    normalized.health.enabled = normalizeBoolean(

        normalized.health.enabled,

        DEFAULT_CONFIGURATION.health.enabled

    );

    normalized.health.staleThresholdMs = normalizeBoundedInteger(

        normalized.health.staleThresholdMs,

        DEFAULT_CONFIGURATION.health.staleThresholdMs,

        CONFIGURATION_LIMITS.health.staleThresholdMs

    );

    /**
     * ------------------------------------------------------------------------
     * Configuration Validation
     * ------------------------------------------------------------------------
     */

    validateConfiguration(normalized);

    /**
     * ------------------------------------------------------------------------
     * Immutable Runtime Configuration
     * ------------------------------------------------------------------------
     */

    return deepFreeze(normalized);

}

/**
 * ============================================================================
 * Normalize Environment Configuration
 * ============================================================================
 *
 * Environment variables arrive as strings.
 *
 * This utility converts recognized environment values into runtime types
 * without blindly converting arbitrary environment variables.
 *
 * Supported variables:
 *
 * TRANSACTION_EVENTS_ENABLED
 * TRANSACTION_EVENTS_NAMESPACE
 * TRANSACTION_EVENTS_BATCH_ENABLED
 * TRANSACTION_EVENTS_BATCH_MAX_SIZE
 * TRANSACTION_EVENTS_BATCH_FLUSH_INTERVAL_MS
 * TRANSACTION_EVENTS_BATCH_CONCURRENCY
 * TRANSACTION_EVENTS_RETRY_ENABLED
 * TRANSACTION_EVENTS_RETRY_MAX_ATTEMPTS
 * TRANSACTION_EVENTS_RETRY_INITIAL_DELAY_MS
 * TRANSACTION_EVENTS_RETRY_MAX_DELAY_MS
 * TRANSACTION_EVENTS_RETRY_BACKOFF_FACTOR
 * TRANSACTION_EVENTS_OUTBOX_POLLING_INTERVAL_MS
 * TRANSACTION_EVENTS_OUTBOX_CLEANUP_INTERVAL_MS
 * TRANSACTION_EVENTS_HEALTH_ENABLED
 * TRANSACTION_EVENTS_HEALTH_STALE_THRESHOLD_MS
 *
 * @param {Object} environment
 * @returns {Object}
 */

function normalizeEnvironmentConfiguration(

    environment = {}

) {

    if (!isPlainObject(environment)) {

        return {};

    }

    const normalized = {};

    const assignIfDefined = (

        path,

        value

    ) => {

        if (value !== undefined && value !== null && value !== '') {

            setNestedValue(

                normalized,

                path,

                value

            );

        }

    };

    assignIfDefined(

        ['enabled'],

        parseBooleanEnvironment(

            environment.TRANSACTION_EVENTS_ENABLED

        )

    );

    assignIfDefined(

        ['namespace'],

        environment.TRANSACTION_EVENTS_NAMESPACE

    );

    assignIfDefined(

        ['batch', 'enabled'],

        parseBooleanEnvironment(

            environment.TRANSACTION_EVENTS_BATCH_ENABLED

        )

    );

    assignIfDefined(

        ['batch', 'maxSize'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_BATCH_MAX_SIZE

        )

    );

    assignIfDefined(

        ['batch', 'flushIntervalMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_BATCH_FLUSH_INTERVAL_MS

        )

    );

    assignIfDefined(

        ['batch', 'concurrency'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_BATCH_CONCURRENCY

        )

    );

    assignIfDefined(

        ['retry', 'enabled'],

        parseBooleanEnvironment(

            environment.TRANSACTION_EVENTS_RETRY_ENABLED

        )

    );

    assignIfDefined(

        ['retry', 'maxAttempts'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_RETRY_MAX_ATTEMPTS

        )

    );

    assignIfDefined(

        ['retry', 'initialDelayMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_RETRY_INITIAL_DELAY_MS

        )

    );

    assignIfDefined(

        ['retry', 'maxDelayMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_RETRY_MAX_DELAY_MS

        )

    );

    assignIfDefined(

        ['retry', 'backoffFactor'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_RETRY_BACKOFF_FACTOR

        )

    );

    assignIfDefined(

        ['outbox', 'pollingIntervalMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_OUTBOX_POLLING_INTERVAL_MS

        )

    );

    assignIfDefined(

        ['outbox', 'cleanupIntervalMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_OUTBOX_CLEANUP_INTERVAL_MS

        )

    );

    assignIfDefined(

        ['health', 'enabled'],

        parseBooleanEnvironment(

            environment.TRANSACTION_EVENTS_HEALTH_ENABLED

        )

    );

    assignIfDefined(

        ['health', 'staleThresholdMs'],

        parseNumberEnvironment(

            environment.TRANSACTION_EVENTS_HEALTH_STALE_THRESHOLD_MS

        )

    );

    return normalized;

}

/**
 * ============================================================================
 * Normalize Object
 * ============================================================================
 */

function normalizeObject(value, fallback) {

    if (!isPlainObject(value)) {

        return deepClone(fallback);

    }

    return mergeConfiguration(

        fallback,

        value

    );

}

/**
 * ============================================================================
 * Boolean Normalization
 * ============================================================================
 */

function normalizeBoolean(value, fallback) {

    if (typeof value === 'boolean') {

        return value;

    }

    if (typeof value === 'number') {

        if (value === 1) return true;

        if (value === 0) return false;

    }

    if (typeof value === 'string') {

        const normalized = value

            .trim()

            .toLowerCase();

        if (

            ['true', '1', 'yes', 'on', 'enabled']

                .includes(normalized)

        ) {

            return true;

        }

        if (

            ['false', '0', 'no', 'off', 'disabled']

                .includes(normalized)

        ) {

            return false;

        }

    }

    return fallback;

}

/**
 * ============================================================================
 * Bounded Integer Normalization
 * ============================================================================
 */

function normalizeBoundedInteger(

    value,

    fallback,

    bounds

) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

        return fallback;

    }

    const integer = Math.trunc(number);

    return clamp(

        integer,

        bounds.min,

        bounds.max

    );

}

/**
 * ============================================================================
 * Bounded Number Normalization
 * ============================================================================
 */

function normalizeBoundedNumber(

    value,

    fallback,

    bounds

) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

        return fallback;

    }

    return clamp(

        number,

        bounds.min,

        bounds.max

    );

}

/**
 * ============================================================================
 * Clamp
 * ============================================================================
 */

function clamp(value, min, max) {

    return Math.min(

        Math.max(value, min),

        max

    );

}

/**
 * ============================================================================
 * String Sanitization
 * ============================================================================
 */

function sanitizeString(

    value,

    fallback = CONFIGURATION_NAMESPACE

) {

    if (typeof value !== 'string') {

        return fallback;

    }

    const sanitized = value

        .trim()

        .replace(

            /[^a-zA-Z0-9._:-]/g,

            ''

        )

        .substring(

            0,

            MAX_NAMESPACE_LENGTH

        );

    return sanitized || fallback;

}

/**
 * ============================================================================
 * Configuration Validation
 * ============================================================================
 *
 * Performs semantic validation after normalization.
 *
 * @param {Object} configuration
 * @returns {true}
 */

function validateConfiguration(configuration) {

    if (!isPlainObject(configuration)) {

        throw createConfigurationError(

            'Configuration must be a plain object.'

        );

    }

    if (

        !isPlainObject(configuration.batch) ||

        !isPlainObject(configuration.retry) ||

        !isPlainObject(configuration.outbox) ||

        !isPlainObject(configuration.health)

    ) {

        throw createConfigurationError(

            'Invalid transaction configuration structure.'

        );

    }

    if (

        configuration.retry.maxDelayMs <

        configuration.retry.initialDelayMs

    ) {

        throw createConfigurationError(

            'retry.maxDelayMs must be greater than or equal to retry.initialDelayMs.'

        );

    }

    if (

        configuration.batch.maxSize < 1

    ) {

        throw createConfigurationError(

            'batch.maxSize must be greater than zero.'

        );

    }

    if (

        configuration.batch.concurrency < 1

    ) {

        throw createConfigurationError(

            'batch.concurrency must be greater than zero.'

        );

    }

    if (

        configuration.retry.maxAttempts < 1

    ) {

        throw createConfigurationError(

            'retry.maxAttempts must be greater than zero.'

        );

    }

    return true;

}

/**
 * ============================================================================
 * Environment Boolean Parser
 * ============================================================================
 */

function parseBooleanEnvironment(value) {

    if (value === undefined || value === null) {

        return undefined;

    }

    return normalizeBoolean(

        value,

        undefined

    );

}

/**
 * ============================================================================
 * Environment Number Parser
 * ============================================================================
 */

function parseNumberEnvironment(value) {

    if (value === undefined || value === null || value === '') {

        return undefined;

    }

    const number = Number(value);

    return Number.isFinite(number)

        ? number

        : undefined;

}

/**
 * ============================================================================
 * Nested Object Setter
 * ============================================================================
 */

function setNestedValue(

    target,

    path,

    value

) {

    let cursor = target;

    for (let index = 0; index < path.length - 1; index += 1) {

        const key = path[index];

        if (!isPlainObject(cursor[key])) {

            cursor[key] = {};

        }

        cursor = cursor[key];

    }

    cursor[path[path.length - 1]] = value;

}

/**
 * ============================================================================
 * Sensitive Configuration Sanitization
 * ============================================================================
 *
 * Returns a cloned object.
 *
 * The original configuration is never modified.
 *
 * @param {Object} configuration
 * @returns {Object}
 */

function sanitizeForLogging(configuration = {}) {

    const sanitized = deepClone(

        configuration

    );

    sanitizeObject(

        sanitized

    );

    return sanitized;

}

/**
 * ============================================================================
 * Recursive Sensitive Field Sanitizer
 * ============================================================================
 */

function sanitizeObject(object) {

    if (Array.isArray(object)) {

        object.forEach(item => {

            if (isPlainObject(item) || Array.isArray(item)) {

                sanitizeObject(item);

            }

        });

        return;

    }

    if (!isPlainObject(object)) {

        return;

    }

    Object.keys(object).forEach(key => {

        const normalizedKey = key

            .toLowerCase()

            .replace(/[-\s]/g, '');

        if (

            SENSITIVE_KEYS.has(normalizedKey) ||

            isSensitiveKey(normalizedKey)

        ) {

            object[key] = REDACTED_VALUE;

            return;

        }

        if (

            isPlainObject(object[key]) ||

            Array.isArray(object[key])

        ) {

            sanitizeObject(

                object[key]

            );

        }

    });

}

/**
 * ============================================================================
 * Additional Sensitive-Key Detection
 * ============================================================================
 *
 * Catches fields such as:
 *
 * • jwtSecret
 * • databasePassword
 * • oauthClientSecret
 * • encryptionPrivateKey
 */

function isSensitiveKey(key) {

    const patterns = [

        /password/i,

        /secret/i,

        /token/i,

        /privatekey/i,

        /apikey/i,

        /credential/i,

        /authorization/i,

        /connectionstring/i,

        /encryptionkey/i,

        /signingkey/i

    ];

    return patterns.some(

        pattern => pattern.test(key)

    );

}

/**
 * ============================================================================
 * Create Configuration Error
 * ============================================================================
 */

function createConfigurationError(message) {

    const error = new Error(message);

    error.name = 'TransactionConfigurationError';

    error.code = 'INVALID_TRANSACTION_CONFIGURATION';

    error.timestamp = new Date();

    return error;

}

/**
 * ============================================================================
 * Public Configuration Builder
 * ============================================================================
 *
 * Convenience method for callers that need:
 *
 *     environment
 *          ↓
 *     defaults
 *          ↓
 *     runtime overrides
 *          ↓
 *     normalization
 *          ↓
 *     immutable configuration
 *
 * @param {Object} configuration
 * @param {Object} environment
 * @returns {Object}
 */

function buildConfiguration(

    configuration = {},

    environment = process.env

) {

    const resolved = resolveDefaults(

        configuration,

        environment

    );

    return normalizeConfiguration(

        resolved

    );

}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports = {

    DEFAULT_CONFIGURATION,

    CONFIGURATION_LIMITS,

    mergeConfiguration,

    resolveDefaults,

    normalizeConfiguration,

    normalizeEnvironmentConfiguration,

    validateConfiguration,

    sanitizeForLogging,

    buildConfiguration

};