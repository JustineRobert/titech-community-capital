'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/redis.js
 *
 * Purpose:
 *   Enterprise production-grade Redis configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize Redis connection configuration.
 *   - Support standalone Redis, Redis Sentinel and Redis Cluster metadata.
 *   - Normalize Redis environment variables.
 *   - Define TLS/security policy.
 *   - Define retry/reconnect behavior.
 *   - Define socket, command and connection timeouts.
 *   - Define Redis role/capability policy.
 *   - Define cache/session/queue/pub-sub usage boundaries.
 *   - Prevent Redis from becoming authoritative financial state.
 *   - Provide safe operational diagnostics.
 *   - Support bootstrap/infrastructure lifecycle integration.
 *
 * IMPORTANT:
 *
 *   This file owns REDIS CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - create Redis clients.
 *     - open Redis connections.
 *     - execute Redis commands.
 *     - own BullMQ workers.
 *     - own cache implementations.
 *     - own Socket.IO adapters.
 *     - persist financial ledger state.
 *     - implement business logic.
 *
 * Canonical implementation belongs in the Redis/infrastructure service layer.
 *
 * =============================================================================
 *
 * Architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/redis.js
 *       ↓
 *   bootstrap/infrastructure.js
 *       ↓
 *   Redis service / cache / queues / realtime
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
    'redis-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const REDIS_MODES =
    Object.freeze({
        STANDALONE:
            'standalone',

        SENTINEL:
            'sentinel',

        CLUSTER:
            'cluster',
    });

const REDIS_STATES =
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

const REDIS_ROLES =
    Object.freeze({
        CACHE:
            'cache',

        SESSION:
            'session',

        QUEUE:
            'queue',

        PUBSUB:
            'pubsub',

        RATE_LIMIT:
            'rate_limit',

        LOCK:
            'lock',

        IDEMPOTENCY:
            'idempotency',

        GENERAL:
            'general',
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

        required:
            false,

        mode:
            REDIS_MODES.STANDALONE,

        host:
            '127.0.0.1',

        port:
            6379,

        database:
            0,

        username:
            null,

        password:
            null,

        url:
            null,

        tls:
            false,

        rejectUnauthorized:
            true,

        connectTimeoutMs:
            10_000,

        commandTimeoutMs:
            5_000,

        socketTimeoutMs:
            30_000,

        keepAliveMs:
            5_000,

        lazyConnect:
            true,

        enableReadyCheck:
            true,

        enableOfflineQueue:
            true,

        maxRetriesPerRequest:
            null,

        maxLoadingRetryTimeMs:
            10_000,

        retryDelayBaseMs:
            200,

        retryDelayMaxMs:
            5_000,

        retryJitterRatio:
            0.20,

        reconnectOnError:
            true,

        reconnectAttempts:
            20,

        disconnectTimeoutMs:
            10_000,

        family:
            0,

        keyPrefix:
            'titech:',

        namespace:
            'titech',

        cacheEnabled:
            true,

        queueEnabled:
            true,

        sessionEnabled:
            true,

        pubsubEnabled:
            true,

        rateLimitEnabled:
            true,

        lockEnabled:
            true,

        idempotencyEnabled:
            true,

        authoritativeFinancialState:
            false,

        allowFinancialWrites:
            false,

        allowLedgerStorage:
            false,

        allowBalanceStorageAsAuthority:
            false,

        healthCheckEnabled:
            true,

        healthCheckTimeoutMs:
            5_000,

        metricsEnabled:
            true,

        diagnosticsEnabled:
            true,

        shutdownTimeoutMs:
            10_000,

        cluster:
            {
                maxRedirections:
                    16,

                retryDelayOnFailoverMs:
                    100,

                retryDelayOnClusterDownMs:
                    100,

                scaleReads:
                    'master',

                enableReadyCheck:
                    true,
            },

        sentinel:
            {
                masterName:
                    null,

                sentinels:
                    [],

                role:
                    'master',

                enableTLSForSentinel:
                    false,

                failoverTimeoutMs:
                    60_000,

                sentinelRetryCount:
                    5,
            },
    });

/**
 * =============================================================================
 * Sensitive keys
 * =============================================================================
 */

const SENSITIVE_KEYS =
    Object.freeze([
        'password',
        'redisPassword',
        'usernamePassword',
        'token',
        'secret',
        'apiKey',
        'api_key',
        'authorization',
        'connectionString',
        'redisUrl',
        'redisUri',
    ]);

const SENSITIVE_KEY_PATTERN =
    /(password|secret|token|authorization|api[_-]?key|credential|connection|string|redis[_-]?(url|uri))/i;

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class RedisConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'RedisConfigError';

        this.code =
            options.code ||
            'REDIS_CONFIG_ERROR';

        this.field =
            options.field ||
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
            RedisConfigError,
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

    return String(value).trim();
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
        String(value)
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled',
        ].includes(normalized)
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
        ].includes(normalized)
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
        Number(value);

    if (
        !Number.isInteger(parsed) ||
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
        Number(value);

    if (
        !Number.isInteger(parsed) ||
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
        String(value).trim();

    return normalized || fallback;
}

function toEnum(
    value,
    allowed,
    fallback,
) {

    const normalized =
        asString(value, fallback);

    const match =
        allowed.find(
            item =>
                String(item).toLowerCase() ===
                String(normalized).toLowerCase(),
        );

    return match || fallback;
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
        return [...fallback];
    }

    const source =
        Array.isArray(value)
            ? value
            : String(value).split(',');

    return [
        ...new Set(
            source
                .map(
                    item =>
                        String(item).trim(),
                )
                .filter(Boolean),
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
        typeof object !== 'object'
    ) {
        return object;
    }

    if (seen.has(object)) {
        return object;
    }

    seen.add(object);

    for (
        const key of Reflect.ownKeys(object)
    ) {
        try {
            deepFreeze(object[key], seen);
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(object);
    } catch {
        // Best effort.
    }

    return object;
}

function isProduction() {

    try {

        if (
            typeof configProvider?.isProduction ===
            'function'
        ) {
            return Boolean(
                configProvider.isProduction(),
            );
        }

        if (
            typeof configProvider?.getEnvironment ===
            'function'
        ) {
            return (
                configProvider.getEnvironment() ===
                'production'
            );
        }

    } catch {
        // Fall through.
    }

    return (
        process.env.NODE_ENV ===
        'production'
    );
}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
            'function'
        ) {
            return configProvider.getEnvironment();
        }

        if (
            typeof configProvider?.get ===
            'function'
        ) {
            return configProvider.get(
                'app.environment',
                process.env.NODE_ENV ||
                    'development',
            );
        }

    } catch {
        // Fall through.
    }

    return (
        process.env.NODE_ENV ||
        'development'
    );
}

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

            return;
        }

    } catch {
        // Best effort.
    }
}

/**
 * =============================================================================
 * Redis URL parsing
 * =============================================================================
 */

function parseRedisUrl(
    url,
) {

    if (!url) {
        return null;
    }

    let parsed;

    try {

        parsed =
            new URL(url);

    } catch (error) {

        throw new RedisConfigError(
            'TITech Redis URL is invalid.',
            {
                code:
                    'REDIS_URL_INVALID',

                field:
                    'url',

                cause:
                    error,

                details: {
                    protocol:
                        String(url).split(':')[0],
                },
            },
        );
    }

    const supportedProtocols = [
        'redis:',
        'rediss:',
    ];

    if (
        !supportedProtocols.includes(
            parsed.protocol,
        )
    ) {

        throw new RedisConfigError(
            `Unsupported Redis URL protocol "${parsed.protocol}".`,
            {
                code:
                    'REDIS_PROTOCOL_UNSUPPORTED',

                field:
                    'url',
            },
        );
    }

    const pathname =
        parsed.pathname &&
        parsed.pathname !== '/'
            ? parsed.pathname.slice(1)
            : null;

    return {
        protocol:
            parsed.protocol,

        tls:
            parsed.protocol === 'rediss:',

        host:
            parsed.hostname,

        port:
            parsed.port
                ? Number(parsed.port)
                : DEFAULTS.port,

        database:
            pathname &&
            /^\d+$/.test(pathname)
                ? Number(pathname)
                : DEFAULTS.database,

        username:
            parsed.username
                ? decodeURIComponent(
                    parsed.username,
                )
                : null,

        password:
            parsed.password
                ? decodeURIComponent(
                    parsed.password,
                )
                : null,
    };
}

/**
 * =============================================================================
 * Sentinel parser
 * =============================================================================
 */

function parseSentinels(
    value,
) {

    const sources =
        asList(value, []);

    return sources.map(
        item => {

            if (
                typeof item === 'object' &&
                item !== null
            ) {

                return {
                    host:
                        asString(
                            item.host,
                            null,
                        ),

                    port:
                        asPositiveInteger(
                            item.port,
                            26379,
                        ),
                };
            }

            const text =
                String(item).trim();

            if (!text) {
                return null;
            }

            const [host, port] =
                text.split(':');

            return {
                host:
                    host || null,

                port:
                    port
                        ? asPositiveInteger(
                            port,
                            26379,
                        )
                        : 26379,
            };
        },
    ).filter(Boolean);
}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createRedisConfig(
    input = {},
) {

    const source =
        input.redis ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const rawUrl =
        source.url ||
        env('REDIS_URL') ||
        env('REDIS_URI') ||
        null;

    const parsedUrl =
        rawUrl
            ? parseRedisUrl(rawUrl)
            : null;

    const mode =
        toEnum(
            source.mode ||
                env('REDIS_MODE'),
            Object.values(
                REDIS_MODES,
            ),
            DEFAULTS.mode,
        );

    const tlsFromSource =
        source.tls ??
        asBoolean(
            env('REDIS_TLS'),
            parsedUrl?.tls ??
                DEFAULTS.tls,
        );

    const config = {

        component:
            COMPONENT,

        serviceName:
            asString(
                source.serviceName,
                SERVICE_NAME,
            ),

        applicationName:
            asString(
                source.applicationName,
                APPLICATION_NAME,
            ),

        environment,

        enabled:
            source.enabled ??
            asBoolean(
                env('REDIS_ENABLED'),
                DEFAULTS.enabled,
            ),

        required:
            source.required ??
            asBoolean(
                env('REDIS_REQUIRED'),
                DEFAULTS.required,
            ),

        mode,

        url:
            rawUrl,

        host:
            asString(
                source.host ||
                    env('REDIS_HOST'),
                parsedUrl?.host ||
                    DEFAULTS.host,
            ),

        port:
            asPositiveInteger(
                source.port ||
                    env('REDIS_PORT'),
                parsedUrl?.port ||
                    DEFAULTS.port,
            ),

        database:
            asNonNegativeInteger(
                source.database ??
                    source.db ??
                    env('REDIS_DB') ??
                    env('REDIS_DATABASE'),
                parsedUrl?.database ??
                    DEFAULTS.database,
            ),

        username:
            asString(
                source.username ||
                    env('REDIS_USERNAME'),
                parsedUrl?.username ||
                    DEFAULTS.username,
            ),

        password:
            source.password ||
            env('REDIS_PASSWORD') ||
            parsedUrl?.password ||
            DEFAULTS.password,

        tls:
            Boolean(tlsFromSource),

        tlsOptions:
            {
                rejectUnauthorized:
                    source.rejectUnauthorized ??
                    asBoolean(
                        env(
                            'REDIS_TLS_REJECT_UNAUTHORIZED',
                        ),
                        DEFAULTS
                            .rejectUnauthorized,
                    ),

                ca:
                    source.ca ||
                    env(
                        'REDIS_TLS_CA',
                    ) ||
                    null,

                cert:
                    source.cert ||
                    env(
                        'REDIS_TLS_CERT',
                    ) ||
                    null,

                key:
                    source.key ||
                    env(
                        'REDIS_TLS_KEY',
                    ) ||
                    null,

                servername:
                    source.servername ||
                    env(
                        'REDIS_TLS_SERVERNAME',
                    ) ||
                    null,
            },

        connection:
            {
                connectTimeoutMs:
                    asPositiveInteger(
                        source.connectTimeoutMs ||
                            env(
                                'REDIS_CONNECT_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .connectTimeoutMs,
                    ),

                commandTimeoutMs:
                    asPositiveInteger(
                        source.commandTimeoutMs ||
                            env(
                                'REDIS_COMMAND_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .commandTimeoutMs,
                    ),

                socketTimeoutMs:
                    asPositiveInteger(
                        source.socketTimeoutMs ||
                            env(
                                'REDIS_SOCKET_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .socketTimeoutMs,
                    ),

                keepAliveMs:
                    asPositiveInteger(
                        source.keepAliveMs ||
                            env(
                                'REDIS_KEEP_ALIVE_MS',
                            ),
                        DEFAULTS
                            .keepAliveMs,
                    ),

                family:
                    asNonNegativeInteger(
                        source.family ||
                            env(
                                'REDIS_FAMILY',
                            ),
                        DEFAULTS.family,
                    ),

                lazyConnect:
                    source.lazyConnect ??
                    asBoolean(
                        env(
                            'REDIS_LAZY_CONNECT',
                        ),
                        DEFAULTS
                            .lazyConnect,
                    ),

                enableReadyCheck:
                    source.enableReadyCheck ??
                    asBoolean(
                        env(
                            'REDIS_ENABLE_READY_CHECK',
                        ),
                        DEFAULTS
                            .enableReadyCheck,
                    ),

                enableOfflineQueue:
                    source.enableOfflineQueue ??
                    asBoolean(
                        env(
                            'REDIS_ENABLE_OFFLINE_QUEUE',
                        ),
                        DEFAULTS
                            .enableOfflineQueue,
                    ),

                maxRetriesPerRequest:
                    source.maxRetriesPerRequest ??
                    DEFAULTS
                        .maxRetriesPerRequest,

                maxLoadingRetryTimeMs:
                    asPositiveInteger(
                        source.maxLoadingRetryTimeMs ||
                            env(
                                'REDIS_MAX_LOADING_RETRY_TIME_MS',
                            ),
                        DEFAULTS
                            .maxLoadingRetryTimeMs,
                    ),

                disconnectTimeoutMs:
                    asPositiveInteger(
                        source.disconnectTimeoutMs ||
                            env(
                                'REDIS_DISCONNECT_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .disconnectTimeoutMs,
                    ),
            },

        retry:
            {
                attempts:
                    asPositiveInteger(
                        source.reconnectAttempts ||
                            env(
                                'REDIS_RECONNECT_ATTEMPTS',
                            ),
                        DEFAULTS
                            .reconnectAttempts,
                    ),

                delayBaseMs:
                    asPositiveInteger(
                        source.retryDelayBaseMs ||
                            env(
                                'REDIS_RETRY_DELAY_BASE_MS',
                            ),
                        DEFAULTS
                            .retryDelayBaseMs,
                    ),

                delayMaxMs:
                    asPositiveInteger(
                        source.retryDelayMaxMs ||
                            env(
                                'REDIS_RETRY_DELAY_MAX_MS',
                            ),
                        DEFAULTS
                            .retryDelayMaxMs,
                    ),

                jitterRatio:
                    Math.min(
                        1,
                        Math.max(
                            0,
                            Number(
                                source.retryJitterRatio ??
                                    env(
                                        'REDIS_RETRY_JITTER_RATIO',
                                    ) ??
                                    DEFAULTS
                                        .retryJitterRatio,
                            ),
                        ),
                    ),

                reconnectOnError:
                    source.reconnectOnError ??
                    asBoolean(
                        env(
                            'REDIS_RECONNECT_ON_ERROR',
                        ),
                        DEFAULTS
                            .reconnectOnError,
                    ),
            },

        namespace:
            asString(
                source.namespace ||
                    env('REDIS_NAMESPACE'),
                DEFAULTS.namespace,
            ),

        keyPrefix:
            asString(
                source.keyPrefix ||
                    env('REDIS_KEY_PREFIX'),
                `${asString(
                    source.namespace ||
                        env(
                            'REDIS_NAMESPACE',
                        ),
                    DEFAULTS.namespace,
                )}:`,
            ),

        roles:
            {
                cache:
                    source.cacheEnabled ??
                    asBoolean(
                        env(
                            'REDIS_CACHE_ENABLED',
                        ),
                        DEFAULTS.cacheEnabled,
                    ),

                session:
                    source.sessionEnabled ??
                    asBoolean(
                        env(
                            'REDIS_SESSION_ENABLED',
                        ),
                        DEFAULTS.sessionEnabled,
                    ),

                queue:
                    source.queueEnabled ??
                    asBoolean(
                        env(
                            'REDIS_QUEUE_ENABLED',
                        ),
                        DEFAULTS.queueEnabled,
                    ),

                pubsub:
                    source.pubsubEnabled ??
                    asBoolean(
                        env(
                            'REDIS_PUBSUB_ENABLED',
                        ),
                        DEFAULTS.pubsubEnabled,
                    ),

                rateLimit:
                    source.rateLimitEnabled ??
                    asBoolean(
                        env(
                            'REDIS_RATE_LIMIT_ENABLED',
                        ),
                        DEFAULTS.rateLimitEnabled,
                    ),

                lock:
                    source.lockEnabled ??
                    asBoolean(
                        env(
                            'REDIS_LOCK_ENABLED',
                        ),
                        DEFAULTS.lockEnabled,
                    ),

                idempotency:
                    source.idempotencyEnabled ??
                    asBoolean(
                        env(
                            'REDIS_IDEMPOTENCY_ENABLED',
                        ),
                        DEFAULTS.idempotencyEnabled,
                    ),
            },

        financial:
            {
                authoritativeState:
                    false,

                allowWrites:
                    source.allowFinancialWrites ??
                    asBoolean(
                        env(
                            'REDIS_ALLOW_FINANCIAL_WRITES',
                        ),
                        DEFAULTS.allowFinancialWrites,
                    ),

                allowLedgerStorage:
                    source.allowLedgerStorage ??
                    asBoolean(
                        env(
                            'REDIS_ALLOW_LEDGER_STORAGE',
                        ),
                        DEFAULTS.allowLedgerStorage,
                    ),

                allowBalanceStorageAsAuthority:
                    source.allowBalanceStorageAsAuthority ??
                    asBoolean(
                        env(
                            'REDIS_ALLOW_BALANCE_AUTHORITY',
                        ),
                        DEFAULTS
                            .allowBalanceStorageAsAuthority,
                    ),
            },

        cluster:
            {
                nodes:
                    source.cluster?.nodes ||
                    parseClusterNodes(
                        source.clusterNodes ||
                            env(
                                'REDIS_CLUSTER_NODES',
                            ),
                    ),

                maxRedirections:
                    asPositiveInteger(
                        source.cluster
                            ?.maxRedirections ||
                            env(
                                'REDIS_CLUSTER_MAX_REDIRECTIONS',
                            ),
                        DEFAULTS
                            .cluster
                            .maxRedirections,
                    ),

                retryDelayOnFailoverMs:
                    asPositiveInteger(
                        source.cluster
                            ?.retryDelayOnFailoverMs ||
                            env(
                                'REDIS_CLUSTER_FAILOVER_RETRY_DELAY_MS',
                            ),
                        DEFAULTS
                            .cluster
                            .retryDelayOnFailoverMs,
                    ),

                retryDelayOnClusterDownMs:
                    asPositiveInteger(
                        source.cluster
                            ?.retryDelayOnClusterDownMs ||
                            env(
                                'REDIS_CLUSTER_DOWN_RETRY_DELAY_MS',
                            ),
                        DEFAULTS
                            .cluster
                            .retryDelayOnClusterDownMs,
                    ),

                scaleReads:
                    asString(
                        source.cluster
                            ?.scaleReads ||
                            env(
                                'REDIS_CLUSTER_SCALE_READS',
                            ),
                        DEFAULTS
                            .cluster
                            .scaleReads,
                    ),

                enableReadyCheck:
                    source.cluster
                        ?.enableReadyCheck ??
                    asBoolean(
                        env(
                            'REDIS_CLUSTER_READY_CHECK',
                        ),
                        DEFAULTS
                            .cluster
                            .enableReadyCheck,
                    ),
            },

        sentinel:
            {
                masterName:
                    asString(
                        source.sentinel
                            ?.masterName ||
                            env(
                                'REDIS_SENTINEL_MASTER',
                            ),
                        DEFAULTS
                            .sentinel
                            .masterName,
                    ),

                sentinels:
                    parseSentinels(
                        source.sentinel
                            ?.sentinels ||
                        env(
                            'REDIS_SENTINELS',
                        ),
                    ),

                username:
                    asString(
                        source.sentinel
                            ?.username ||
                            env(
                                'REDIS_SENTINEL_USERNAME',
                            ),
                        null,
                    ),

                password:
                    source.sentinel
                        ?.password ||
                    env(
                        'REDIS_SENTINEL_PASSWORD',
                    ) ||
                    null,

                role:
                    asString(
                        source.sentinel
                            ?.role ||
                            env(
                                'REDIS_SENTINEL_ROLE',
                            ),
                        DEFAULTS
                            .sentinel
                            .role,
                    ),

                enableTLSForSentinel:
                    source.sentinel
                        ?.enableTLSForSentinel ??
                    asBoolean(
                        env(
                            'REDIS_SENTINEL_TLS',
                        ),
                        DEFAULTS
                            .sentinel
                            .enableTLSForSentinel,
                    ),

                failoverTimeoutMs:
                    asPositiveInteger(
                        source.sentinel
                            ?.failoverTimeoutMs ||
                            env(
                                'REDIS_SENTINEL_FAILOVER_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .sentinel
                            .failoverTimeoutMs,
                    ),

                sentinelRetryCount:
                    asPositiveInteger(
                        source.sentinel
                            ?.sentinelRetryCount ||
                            env(
                                'REDIS_SENTINEL_RETRY_COUNT',
                            ),
                        DEFAULTS
                            .sentinel
                            .sentinelRetryCount,
                    ),
            },

        health:
            {
                enabled:
                    source.healthCheckEnabled ??
                    asBoolean(
                        env(
                            'REDIS_HEALTH_CHECK_ENABLED',
                        ),
                        DEFAULTS
                            .healthCheckEnabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.healthCheckTimeoutMs ||
                            env(
                                'REDIS_HEALTH_CHECK_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .healthCheckTimeoutMs,
                    ),
            },

        metrics:
            {
                enabled:
                    source.metricsEnabled ??
                    asBoolean(
                        env(
                            'REDIS_METRICS_ENABLED',
                        ),
                        DEFAULTS
                            .metricsEnabled,
                    ),
            },

        diagnostics:
            {
                enabled:
                    source.diagnosticsEnabled ??
                    asBoolean(
                        env(
                            'REDIS_DIAGNOSTICS_ENABLED',
                        ),
                        DEFAULTS
                            .diagnosticsEnabled,
                    ),
            },

        shutdown:
            {
                timeoutMs:
                    asPositiveInteger(
                        source.shutdownTimeoutMs ||
                            env(
                                'REDIS_SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .shutdownTimeoutMs,
                    ),
            },
    };

    return validateRedisConfig(config);
}

/**
 * =============================================================================
 * Cluster node parsing
 * =============================================================================
 */

function parseClusterNodes(
    value,
) {

    const list =
        asList(
            value,
            [],
        );

    return list
        .map(
            item => {

                if (
                    typeof item ===
                    'object'
                ) {
                    return {
                        host:
                            asString(
                                item.host,
                                null,
                            ),

                        port:
                            asPositiveInteger(
                                item.port,
                                DEFAULTS.port,
                            ),
                    };
                }

                const text =
                    String(item)
                        .trim();

                const [host, port] =
                    text.split(':');

                return {
                    host:
                        host || null,

                    port:
                        asPositiveInteger(
                            port,
                            DEFAULTS.port,
                        ),
                };
            },
        )
        .filter(
            node =>
                Boolean(node.host),
        );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateRedisConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Mode
     * -------------------------------------------------------------------------
     */

    if (
        !Object.values(
            REDIS_MODES,
        ).includes(
            config.mode,
        )
    ) {
        errors.push({
            code:
                'REDIS_MODE_INVALID',

            field:
                'mode',

            message:
                `Unsupported TITech Redis mode "${config.mode}".`,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Basic connection
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        !config.url &&
        !config.host
    ) {
        errors.push({
            code:
                'REDIS_HOST_MISSING',

            field:
                'host',

            message:
                'TITech Redis host or REDIS_URL must be configured.',
        });
    }

    if (
        config.port <
            1 ||
        config.port >
            65_535
    ) {
        errors.push({
            code:
                'REDIS_PORT_INVALID',

            field:
                'port',
        });
    }

    if (
        production &&
        config.enabled &&
        !config.tls
    ) {
        errors.push({
            code:
                'REDIS_TLS_REQUIRED',

            field:
                'tls',

            message:
                'TITech production Redis must use TLS.',
        });
    }

    if (
        production &&
        config.tls &&
        !config.tlsOptions.rejectUnauthorized
    ) {
        errors.push({
            code:
                'REDIS_TLS_VERIFICATION_DISABLED',

            field:
                'tlsOptions.rejectUnauthorized',

            message:
                'TITech production Redis certificate verification cannot be disabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Standalone
     * -------------------------------------------------------------------------
     */

    if (
        config.mode ===
        REDIS_MODES.STANDALONE
    ) {

        if (
            config.cluster.nodes.length >
            0
        ) {
            warnings.push({
                code:
                    'REDIS_CLUSTER_NODES_IGNORED',

                message:
                    'Cluster node configuration exists but Redis mode is standalone.',
            });
        }

        if (
            config.sentinel.sentinels.length >
            0
        ) {
            warnings.push({
                code:
                    'REDIS_SENTINELS_IGNORED',

                message:
                    'Sentinel configuration exists but Redis mode is standalone.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Sentinel
     * -------------------------------------------------------------------------
     */

    if (
        config.mode ===
        REDIS_MODES.SENTINEL
    ) {

        if (
            !config.sentinel.masterName
        ) {
            errors.push({
                code:
                    'REDIS_SENTINEL_MASTER_MISSING',

                field:
                    'sentinel.masterName',
            });
        }

        if (
            config.sentinel.sentinels.length ===
            0
        ) {
            errors.push({
                code:
                    'REDIS_SENTINELS_MISSING',

                field:
                    'sentinel.sentinels',
            });
        }

        if (
            production &&
            config.sentinel.enableTLSForSentinel !==
            true
        ) {
            warnings.push({
                code:
                    'REDIS_SENTINEL_TLS_DISABLED',

                field:
                    'sentinel.enableTLSForSentinel',

                message:
                    'TITech production Redis Sentinel transport is not configured with TLS.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Cluster
     * -------------------------------------------------------------------------
     */

    if (
        config.mode ===
        REDIS_MODES.CLUSTER
    ) {

        if (
            config.cluster.nodes.length ===
            0 &&
            !config.url
        ) {
            errors.push({
                code:
                    'REDIS_CLUSTER_NODES_MISSING',

                field:
                    'cluster.nodes',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Connection semantics
     * -------------------------------------------------------------------------
     */

    if (
        config.connection
            .commandTimeoutMs >=
        config.connection
            .socketTimeoutMs
    ) {

        warnings.push({
            code:
                'REDIS_COMMAND_TIMEOUT_HIGH',

            field:
                'connection.commandTimeoutMs',

            message:
                'Redis command timeout is greater than or equal to socket timeout.',
        });
    }

    if (
        config.retry.delayMaxMs <
        config.retry.delayBaseMs
    ) {

        errors.push({
            code:
                'REDIS_RETRY_DELAY_INVALID',

            field:
                'retry',

            message:
                'Redis maximum retry delay must not be lower than the base retry delay.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Financial boundary
     * -------------------------------------------------------------------------
     *
     * Redis may support idempotency/locks/cache, but MongoDB/ledger remains
     * authoritative.
     */

    if (
        config.financial
            .authoritativeState
    ) {
        errors.push({
            code:
                'REDIS_FINANCIAL_AUTHORITY_FORBIDDEN',

            field:
                'financial.authoritativeState',

            message:
                'Redis cannot be the authoritative source of TITech financial state.',
        });
    }

    if (
        config.financial
            .allowLedgerStorage
    ) {
        errors.push({
            code:
                'REDIS_LEDGER_STORAGE_FORBIDDEN',

            field:
                'financial.allowLedgerStorage',

            message:
                'TITech ledger state must not be stored authoritatively in Redis.',
        });
    }

    if (
        config.financial
            .allowBalanceStorageAsAuthority
    ) {
        errors.push({
            code:
                'REDIS_BALANCE_AUTHORITY_FORBIDDEN',

            field:
                'financial.allowBalanceStorageAsAuthority',

            message:
                'Redis cannot be the authoritative source of TITech account balances.',
        });
    }

    if (
        config.financial
            .allowWrites
    ) {
        warnings.push({
            code:
                'REDIS_FINANCIAL_WRITES_ENABLED',

            field:
                'financial.allowWrites',

            message:
                'Redis financial writes are enabled for non-authoritative auxiliary state.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Production password/authentication policy
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.enabled &&
        !config.password &&
        !config.url
    ) {
        warnings.push({
            code:
                'REDIS_PASSWORD_NOT_CONFIGURED',

            field:
                'password',

            message:
                'Redis password is not configured; verify ACLs, mTLS, managed identity, or another authenticated deployment mechanism.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Role sanity
     * -------------------------------------------------------------------------
     */

    if (
        config.roles.queue &&
        !config.enabled
    ) {
        warnings.push({
            code:
                'REDIS_QUEUE_ROLE_DISABLED_WITH_REDIS',

            field:
                'roles.queue',
        });
    }

    if (
        config.roles.idempotency &&
        !config.roles.lock
    ) {
        warnings.push({
            code:
                'REDIS_IDEMPOTENCY_WITHOUT_LOCKS',

            message:
                'TITech idempotency is enabled while Redis lock capability is disabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.diagnostics.enabled &&
        config.diagnostics.includeConnectionDetails
    ) {
        warnings.push({
            code:
                'REDIS_CONNECTION_DIAGNOSTICS_ENABLED',

            message:
                'Redis connection details should remain restricted in production diagnostics.',
        });
    }

    if (
        errors.length >
        0
    ) {

        const error =
            new RedisConfigError(
                'TITech Redis configuration validation failed.',
                {
                    code:
                        'REDIS_CONFIGURATION_INVALID',

                    details:
                        {
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

                        details:
                            {
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
            ? REDIS_STATES.DISABLED
            : warnings.length >
                0
                ? REDIS_STATES.DEGRADED
                : REDIS_STATES.ENABLED;

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
 * Redis client options
 * =============================================================================
 *
 * Returns configuration suitable for ioredis-style consumers without creating
 * the actual client.
 * =============================================================================
 */

function getClientOptions(
    config =
        defaultConfig,
) {

    const common = {
        lazyConnect:
            config.connection
                .lazyConnect,

        enableReadyCheck:
            config.connection
                .enableReadyCheck,

        enableOfflineQueue:
            config.connection
                .enableOfflineQueue,

        maxRetriesPerRequest:
            config.connection
                .maxRetriesPerRequest,

        maxLoadingRetryTime:
            config.connection
                .maxLoadingRetryTimeMs,

        connectTimeout:
            config.connection
                .connectTimeoutMs,

        commandTimeout:
            config.connection
                .commandTimeoutMs,

        keepAlive:
            config.connection
                .keepAliveMs,

        family:
            config.connection
                .family,

        retryStrategy:
            times =>
                calculateRetryDelay(
                    times,
                    config.retry,
                ),

        reconnectOnError:
            config.retry
                .reconnectOnError
                ? () =>
                    true
                : undefined,

        keyPrefix:
            config.keyPrefix,
    };

    if (
        config.tls
    ) {

        common.tls = {
            rejectUnauthorized:
                config.tlsOptions
                    .rejectUnauthorized,

            ...(config.tlsOptions.ca
                ? {
                    ca:
                        config.tlsOptions
                            .ca,
                }
                : {}),

            ...(config.tlsOptions.cert
                ? {
                    cert:
                        config.tlsOptions
                            .cert,
                }
                : {}),

            ...(config.tlsOptions.key
                ? {
                    key:
                        config.tlsOptions
                            .key,
                }
                : {}),

            ...(config.tlsOptions.servername
                ? {
                    servername:
                        config.tlsOptions
                            .servername,
                }
                : {}),
        };
    }

    if (
        config.username
    ) {
        common.username =
            config.username;
    }

    if (
        config.password
    ) {
        common.password =
            config.password;
    }

    /**
     * Redis URL should be passed separately by the infrastructure implementation
     * when supported. We intentionally do not expose it through snapshots.
     */
    return deepFreeze(
        common,
    );
}

/**
 * =============================================================================
 * Retry calculation
 * =============================================================================
 */

function calculateRetryDelay(
    attempt,
    retry =
        defaultConfig.retry,
) {

    const normalizedAttempt =
        Math.max(
            1,
            Number(attempt) ||
                1,
        );

    const base =
        Math.min(
            retry.delayBaseMs *
                Math.pow(
                    2,
                    normalizedAttempt -
                        1,
                ),
            retry.delayMaxMs,
        );

    const jitter =
        base *
        retry.jitterRatio *
        (
            Math.random() -
            0.5
        );

    return Math.max(
        0,
        Math.floor(
            base +
                jitter,
        ),
    );
}

/**
 * =============================================================================
 * Role policy
 * =============================================================================
 */

function getRolePolicy(
    role,
    config =
        defaultConfig,
) {

    const normalized =
        toEnum(
            role,
            Object.values(
                REDIS_ROLES,
            ),
            REDIS_ROLES.GENERAL,
        );

    const enabled =
        {
            [REDIS_ROLES.CACHE]:
                config.roles.cache,

            [REDIS_ROLES.SESSION]:
                config.roles.session,

            [REDIS_ROLES.QUEUE]:
                config.roles.queue,

            [REDIS_ROLES.PUBSUB]:
                config.roles.pubsub,

            [REDIS_ROLES.RATE_LIMIT]:
                config.roles.rateLimit,

            [REDIS_ROLES.LOCK]:
                config.roles.lock,

            [REDIS_ROLES.IDEMPOTENCY]:
                config.roles.idempotency,

            [REDIS_ROLES.GENERAL]:
                config.enabled,
        }[
            normalized
        ];

    const authoritative =
        false;

    return deepFreeze({
        role:
            normalized,

        enabled:
            Boolean(enabled),

        authoritative,

        failureMode:
            normalized ===
            REDIS_ROLES.CACHE
                ? 'fail_open'
                : normalized ===
                      REDIS_ROLES.IDEMPOTENCY ||
                  normalized ===
                      REDIS_ROLES.LOCK
                    ? 'fail_closed'
                    : 'degraded',

        financialAuthority:
            false,
    });
}

/**
 * =============================================================================
 * Health policy
 * =============================================================================
 */

function classifyHealth(
    {
        connected = false,
        ready = false,
        latencyMs = null,
        error = null,
    } = {},
) {

    if (
        error
    ) {
        return 'unhealthy';
    }

    if (
        !connected ||
        !ready
    ) {
        return 'degraded';
    }

    if (
        Number.isFinite(
            latencyMs,
        ) &&
        latencyMs >
            1_000
    ) {
        return 'degraded';
    }

    return 'healthy';
}

/**
 * =============================================================================
 * Safe diagnostics
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
            config.serviceName,

        application:
            config.applicationName,

        environment:
            config.environment,

        state:
            config.state,

        enabled:
            config.enabled,

        required:
            config.required,

        mode:
            config.mode,

        urlConfigured:
            Boolean(
                config.url,
            ),

        host:
            config.host,

        port:
            config.port,

        database:
            config.database,

        usernameConfigured:
            Boolean(
                config.username,
            ),

        passwordConfigured:
            Boolean(
                config.password,
            ),

        tls:
            {
                enabled:
                    config.tls,

                rejectUnauthorized:
                    config.tlsOptions
                        .rejectUnauthorized,

                caConfigured:
                    Boolean(
                        config.tlsOptions
                            .ca,
                    ),

                certificateConfigured:
                    Boolean(
                        config.tlsOptions
                            .cert,
                    ),

                keyConfigured:
                    Boolean(
                        config.tlsOptions
                            .key,
                    ),
            },

        connection:
            {
                connectTimeoutMs:
                    config.connection
                        .connectTimeoutMs,

                commandTimeoutMs:
                    config.connection
                        .commandTimeoutMs,

                socketTimeoutMs:
                    config.connection
                        .socketTimeoutMs,

                keepAliveMs:
                    config.connection
                        .keepAliveMs,

                lazyConnect:
                    config.connection
                        .lazyConnect,

                enableReadyCheck:
                    config.connection
                        .enableReadyCheck,

                enableOfflineQueue:
                    config.connection
                        .enableOfflineQueue,

                maxRetriesPerRequest:
                    config.connection
                        .maxRetriesPerRequest,
            },

        retry:
            {
                attempts:
                    config.retry
                        .attempts,

                delayBaseMs:
                    config.retry
                        .delayBaseMs,

                delayMaxMs:
                    config.retry
                        .delayMaxMs,

                jitterRatio:
                    config.retry
                        .jitterRatio,

                reconnectOnError:
                    config.retry
                        .reconnectOnError,
            },

        namespace:
            config.namespace,

        keyPrefix:
            config.keyPrefix,

        roles:
            {
                cache:
                    config.roles.cache,

                session:
                    config.roles.session,

                queue:
                    config.roles.queue,

                pubsub:
                    config.roles.pubsub,

                rateLimit:
                    config.roles.rateLimit,

                lock:
                    config.roles.lock,

                idempotency:
                    config.roles.idempotency,
            },

        financial:
            {
                authoritativeState:
                    false,

                allowWrites:
                    config.financial
                        .allowWrites,

                allowLedgerStorage:
                    config.financial
                        .allowLedgerStorage,

                allowBalanceStorageAsAuthority:
                    config.financial
                        .allowBalanceStorageAsAuthority,
            },

        cluster:
            {
                nodeCount:
                    config.cluster
                        .nodes
                        .length,

                maxRedirections:
                    config.cluster
                        .maxRedirections,

                scaleReads:
                    config.cluster
                        .scaleReads,
            },

        sentinel:
            {
                masterName:
                    config.sentinel
                        .masterName,

                sentinelCount:
                    config.sentinel
                        .sentinels
                        .length,

                role:
                    config.sentinel
                        .role,

                tls:
                    config.sentinel
                        .enableTLSForSentinel,
            },

        health:
            {
                enabled:
                    config.health
                        .enabled,

                timeoutMs:
                    config.health
                        .timeoutMs,
            },

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
 * Environment override diagnostics
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [
        'REDIS_ENABLED',
        'REDIS_REQUIRED',
        'REDIS_MODE',
        'REDIS_HOST',
        'REDIS_PORT',
        'REDIS_DB',
        'REDIS_DATABASE',
        'REDIS_USERNAME',
        'REDIS_TLS',
        'REDIS_TLS_REJECT_UNAUTHORIZED',
        'REDIS_TLS_SERVERNAME',

        'REDIS_CONNECT_TIMEOUT_MS',
        'REDIS_COMMAND_TIMEOUT_MS',
        'REDIS_SOCKET_TIMEOUT_MS',
        'REDIS_KEEP_ALIVE_MS',
        'REDIS_FAMILY',
        'REDIS_LAZY_CONNECT',
        'REDIS_ENABLE_READY_CHECK',
        'REDIS_ENABLE_OFFLINE_QUEUE',
        'REDIS_MAX_RETRIES_PER_REQUEST',
        'REDIS_MAX_LOADING_RETRY_TIME_MS',
        'REDIS_DISCONNECT_TIMEOUT_MS',

        'REDIS_RECONNECT_ATTEMPTS',
        'REDIS_RETRY_DELAY_BASE_MS',
        'REDIS_RETRY_DELAY_MAX_MS',
        'REDIS_RETRY_JITTER_RATIO',
        'REDIS_RECONNECT_ON_ERROR',

        'REDIS_NAMESPACE',
        'REDIS_KEY_PREFIX',

        'REDIS_CACHE_ENABLED',
        'REDIS_SESSION_ENABLED',
        'REDIS_QUEUE_ENABLED',
        'REDIS_PUBSUB_ENABLED',
        'REDIS_RATE_LIMIT_ENABLED',
        'REDIS_LOCK_ENABLED',
        'REDIS_IDEMPOTENCY_ENABLED',

        'REDIS_ALLOW_FINANCIAL_WRITES',
        'REDIS_ALLOW_LEDGER_STORAGE',
        'REDIS_ALLOW_BALANCE_AUTHORITY',

        'REDIS_CLUSTER_NODES',
        'REDIS_CLUSTER_MAX_REDIRECTIONS',
        'REDIS_CLUSTER_FAILOVER_RETRY_DELAY_MS',
        'REDIS_CLUSTER_DOWN_RETRY_DELAY_MS',
        'REDIS_CLUSTER_SCALE_READS',
        'REDIS_CLUSTER_READY_CHECK',

        'REDIS_SENTINEL_MASTER',
        'REDIS_SENTINELS',
        'REDIS_SENTINEL_USERNAME',
        'REDIS_SENTINEL_ROLE',
        'REDIS_SENTINEL_TLS',
        'REDIS_SENTINEL_FAILOVER_TIMEOUT_MS',
        'REDIS_SENTINEL_RETRY_COUNT',

        'REDIS_HEALTH_CHECK_ENABLED',
        'REDIS_HEALTH_CHECK_TIMEOUT_MS',

        'REDIS_METRICS_ENABLED',
        'REDIS_DIAGNOSTICS_ENABLED',
        'REDIS_SHUTDOWN_TIMEOUT_MS',
    ];

    const result = {};

    for (
        const key of keys
    ) {

        result[key] =
            process.env[key];
    }

    result.REDIS_URL =
        process.env.REDIS_URL
            ? '[CONFIGURED]'
            : undefined;

    result.REDIS_URI =
        process.env.REDIS_URI
            ? '[CONFIGURED]'
            : undefined;

    result.REDIS_PASSWORD =
        process.env.REDIS_PASSWORD
            ? '[REDACTED]'
            : undefined;

    result.REDIS_TLS_CA =
        process.env.REDIS_TLS_CA
            ? '[REDACTED]'
            : undefined;

    result.REDIS_TLS_CERT =
        process.env.REDIS_TLS_CERT
            ? '[REDACTED]'
            : undefined;

    result.REDIS_TLS_KEY =
        process.env.REDIS_TLS_KEY
            ? '[REDACTED]'
            : undefined;

    result.REDIS_SENTINEL_PASSWORD =
        process.env.REDIS_SENTINEL_PASSWORD
            ? '[REDACTED]'
            : undefined;

    return Object.freeze(result);
}

function isSensitiveKey(
    key,
) {

    return (
        SENSITIVE_KEYS.includes(key) ||
        SENSITIVE_KEY_PATTERN.test(key)
    );
}

/**
 * =============================================================================
 * Bootstrap adapter
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createRedisConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context === 'object'
    ) {

        context.redis =
            config;

        context.redisConfig =
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
 * Default configuration
 * =============================================================================
 */

const defaultConfig =
    createRedisConfig();

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

        redis:
            defaultConfig,

        createRedisConfig,

        validateRedisConfig,

        /**
         * Constants.
         */
        DEFAULTS,

        REDIS_MODES,

        REDIS_STATES,

        REDIS_ROLES,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * URL / connection helpers.
         */
        parseRedisUrl,

        parseSentinels,

        parseClusterNodes,

        getClientOptions,

        calculateRetryDelay,

        /**
         * Runtime policy.
         */
        getRolePolicy,

        classifyHealth,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        isSensitiveKey,

        /**
         * Bootstrap compatibility.
         */
        initialize,

        start,

        bootstrap,
    });