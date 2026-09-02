'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/queues.js
 *
 * Purpose:
 *   Enterprise production-grade queue configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize asynchronous queue configuration.
 *   - Support BullMQ / Redis-backed queue workers.
 *   - Define queue names and workloads.
 *   - Define retry/backoff policies.
 *   - Define concurrency and throughput limits.
 *   - Define job retention policies.
 *   - Define delayed/repeatable job policy.
 *   - Define worker shutdown/drain policy.
 *   - Define queue health/readiness policy.
 *   - Define dead-letter/failure handling policy.
 *   - Define idempotency and job identity policy.
 *   - Prevent financial jobs from silently becoming unsafe.
 *   - Provide safe operational diagnostics.
 *   - Keep queue configuration separate from queue implementation.
 *
 * IMPORTANT:
 *
 *   This file owns QUEUE CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - create Redis clients.
 *     - create BullMQ queues.
 *     - create workers.
 *     - process jobs.
 *     - execute financial transactions.
 *     - implement ledger logic.
 *     - implement payment processing.
 *     - implement business services.
 *     - persist business audit records.
 *
 * Queue implementation belongs in the queue/infrastructure layer.
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/queues.js
 *       ↓
 *   queue infrastructure
 *       ↓
 *   workers
 *       ↓
 *   services / integrations
 *
 * =============================================================================
 *
 * Financial queue boundary:
 *
 *   HTTP / API
 *       ↓
 *   application service
 *       ↓
 *   financial transaction boundary
 *       ↓
 *   durable database commit
 *       ↓
 *   outbox / queue publication
 *       ↓
 *   worker
 *
 * A queue is NOT the source of truth for financial state.
 *
 * =============================================================================
 */

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
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'queue-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const QUEUE_STATES =
    Object.freeze({
        ENABLED: 'enabled',
        DISABLED: 'disabled',
        DEGRADED: 'degraded',
        INVALID: 'invalid',
    });

const QUEUE_DRIVE_MODES =
    Object.freeze({
        ASYNC: 'async',
        SYNC: 'sync',
    });

const JOB_PRIORITY =
    Object.freeze({
        CRITICAL: 1,
        HIGH: 2,
        NORMAL: 5,
        LOW: 10,
        BACKGROUND: 20,
    });

const JOB_CLASSES =
    Object.freeze({
        FINANCIAL: 'financial',
        SECURITY: 'security',
        AUTHENTICATION: 'authentication',
        NOTIFICATION: 'notification',
        INTEGRATION: 'integration',
        ANALYTICS: 'analytics',
        SYSTEM: 'system',
        MAINTENANCE: 'maintenance',
        GENERIC: 'generic',
    });

const FAILURE_POLICIES =
    Object.freeze({
        FAIL_CLOSED: 'fail_closed',
        FAIL_OPEN: 'fail_open',
        RETRY: 'retry',
        DEAD_LETTER: 'dead_letter',
    });

const DEFAULTS =
    Object.freeze({
        /**
         * ---------------------------------------------------------------------
         * Global queue system
         * ---------------------------------------------------------------------
         */
        enabled: true,

        required: false,

        provider: 'bullmq',

        driveMode: QUEUE_DRIVE_MODES.ASYNC,

        /**
         * ---------------------------------------------------------------------
         * Redis connectivity policy
         * ---------------------------------------------------------------------
         */
        redisConnection: {
            host: '127.0.0.1',
            port: 6379,
            db: 0,
            tls: false,
            connectTimeoutMs: 10_000,
            commandTimeoutMs: 5_000,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            keepAlive: 5_000,
        },

        /**
         * ---------------------------------------------------------------------
         * Worker defaults
         * ---------------------------------------------------------------------
         */
        worker: {
            concurrency: 5,
            limiterMax: 100,
            limiterDurationMs: 1_000,
            lockDurationMs: 30_000,
            lockRenewTimeMs: 10_000,
            stalledIntervalMs: 30_000,
            maxStalledCount: 1,
            autorun: true,
            useWorkerThreads: false,
            maxMemoryRestartMb: 512,
        },

        /**
         * ---------------------------------------------------------------------
         * Job defaults
         * ---------------------------------------------------------------------
         */
        job: {
            attempts: 3,

            backoff: {
                type: 'exponential',
                delayMs: 1_000,
                maxDelayMs: 60_000,
                jitterRatio: 0.20,
            },

            removeOnComplete: 1_000,

            removeOnFail: 5_000,

            timeoutMs: 60_000,

            maxAttemptsPerJob: 10,

            priority:
                JOB_PRIORITY.NORMAL,

            dedupeWindowMs: 300_000,

            preserveResult: false,

            failIfQueueDisabled: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Queue-specific defaults
         * ---------------------------------------------------------------------
         */
        queues: {
            default: {
                enabled: true,
                concurrency: 5,
                priority:
                    JOB_PRIORITY.NORMAL,
                attempts: 3,
            },

            notifications: {
                enabled: true,
                concurrency: 5,
                priority:
                    JOB_PRIORITY.NORMAL,
                attempts: 5,
            },

            email: {
                enabled: true,
                concurrency: 5,
                priority:
                    JOB_PRIORITY.NORMAL,
                attempts: 5,
            },

            sms: {
                enabled: true,
                concurrency: 5,
                priority:
                    JOB_PRIORITY.HIGH,
                attempts: 5,
            },

            payments: {
                enabled: true,
                concurrency: 3,
                priority:
                    JOB_PRIORITY.HIGH,
                attempts: 5,
            },

            financial: {
                enabled: true,
                concurrency: 2,
                priority:
                    JOB_PRIORITY.CRITICAL,
                attempts: 5,
            },

            audit: {
                enabled: true,
                concurrency: 3,
                priority:
                    JOB_PRIORITY.CRITICAL,
                attempts: 8,
            },

            analytics: {
                enabled: true,
                concurrency: 2,
                priority:
                    JOB_PRIORITY.LOW,
                attempts: 3,
            },

            integrations: {
                enabled: true,
                concurrency: 5,
                priority:
                    JOB_PRIORITY.NORMAL,
                attempts: 5,
            },

            maintenance: {
                enabled: true,
                concurrency: 1,
                priority:
                    JOB_PRIORITY.BACKGROUND,
                attempts: 2,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Financial queue safety
         * ---------------------------------------------------------------------
         */
        financial: {
            requireIdempotency: true,

            requireJobId: true,

            requireOutbox: true,

            requireDurableCommitBeforePublish: true,

            allowAtLeastOnce:
                true,

            allowInMemoryOnly: false,

            allowDiscardOnShutdown: false,

            failurePolicy:
                FAILURE_POLICIES.DEAD_LETTER,

            maxAttempts: 5,

            transactionTimeoutMs:
                120_000,

            visibilityTimeoutMs:
                60_000,

            deadLetterEnabled: true,

            deadLetterQueue:
                'financial.dead-letter',
        },

        /**
         * ---------------------------------------------------------------------
         * Dead-letter policy
         * ---------------------------------------------------------------------
         */
        deadLetter: {
            enabled: true,

            queueSuffix:
                'dead-letter',

            maxRetentionMs:
                30 * 24 * 60 * 60 * 1_000,

            alertAfterFailures: 1,

            preservePayload: true,

            preserveStack: true,
        },

        /**
         * ---------------------------------------------------------------------
         * Delay/repeat policy
         * ---------------------------------------------------------------------
         */
        scheduling: {
            delayedJobsEnabled: true,

            repeatableJobsEnabled: true,

            maxDelayMs:
                30 * 24 * 60 * 60 * 1_000,

            timezone:
                'UTC',
        },

        /**
         * ---------------------------------------------------------------------
         * Shutdown
         * ---------------------------------------------------------------------
         */
        shutdown: {
            drainEnabled: true,

            timeoutMs: 30_000,

            forceTimeoutMs: 10_000,

            waitForActiveJobs: true,

            failNewJobsAfterShutdown:
                true,
        },

        /**
         * ---------------------------------------------------------------------
         * Health/readiness
         * ---------------------------------------------------------------------
         */
        health: {
            enabled: true,

            timeoutMs: 5_000,

            maxQueueDepthWarning: 10_000,

            maxQueueDepthCritical: 50_000,

            maxWaitingJobsWarning: 10_000,

            staleWorkerThresholdMs:
                120_000,
        },

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */
        observability: {
            metricsEnabled: true,

            loggingEnabled: true,

            logJobPayload:
                false,

            logJobResult:
                false,

            logStack:
                true,

            slowJobThresholdMs:
                5_000,

            includeQueueName:
                true,

            includeJobId:
                true,

            includeTraceContext:
                true,

            includeTenantId:
                true,

            includeActorId:
                true,
        },

        /**
         * ---------------------------------------------------------------------
         * Security
         * ---------------------------------------------------------------------
         */
        security: {
            allowArbitraryJobNames:
                false,

            allowArbitraryQueueNames:
                false,

            allowProductionSyncMode:
                false,

            exposeQueueDiagnostics:
                false,

            preserveSensitivePayloads:
                false,

            productionRequireTls:
                true,

            productionRequireRedisAuth:
                true,
        },

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */
        diagnostics: {
            enabled: true,

            includeConnectionDetails:
                false,

            includeQueueConfiguration:
                true,
        },
    });

/**
 * =============================================================================
 * Built-in queue catalog
 * =============================================================================
 *
 * The queue catalog provides a stable canonical vocabulary for application
 * services. Business services should not construct arbitrary queue names.
 * =============================================================================
 */

const DEFAULT_QUEUE_DEFINITIONS =
    Object.freeze({
        default:
            Object.freeze({
                name:
                    'default',

                class:
                    JOB_CLASSES.GENERIC,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.default
                        .concurrency,

                priority:
                    DEFAULTS.queues.default
                        .priority,

                attempts:
                    DEFAULTS.queues.default
                        .attempts,
            }),

        notifications:
            Object.freeze({
                name:
                    'notifications',

                class:
                    JOB_CLASSES.NOTIFICATION,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.notifications
                        .concurrency,

                priority:
                    DEFAULTS.queues.notifications
                        .priority,

                attempts:
                    DEFAULTS.queues.notifications
                        .attempts,
            }),

        email:
            Object.freeze({
                name:
                    'email',

                class:
                    JOB_CLASSES.NOTIFICATION,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.email
                        .concurrency,

                priority:
                    DEFAULTS.queues.email
                        .priority,

                attempts:
                    DEFAULTS.queues.email
                        .attempts,
            }),

        sms:
            Object.freeze({
                name:
                    'sms',

                class:
                    JOB_CLASSES.NOTIFICATION,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.sms
                        .concurrency,

                priority:
                    DEFAULTS.queues.sms
                        .priority,

                attempts:
                    DEFAULTS.queues.sms
                        .attempts,
            }),

        payments:
            Object.freeze({
                name:
                    'payments',

                class:
                    JOB_CLASSES.FINANCIAL,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.payments
                        .concurrency,

                priority:
                    DEFAULTS.queues.payments
                        .priority,

                attempts:
                    DEFAULTS.queues.payments
                        .attempts,

                financial:
                    true,
            }),

        financial:
            Object.freeze({
                name:
                    'financial',

                class:
                    JOB_CLASSES.FINANCIAL,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.financial
                        .concurrency,

                priority:
                    DEFAULTS.queues.financial
                        .priority,

                attempts:
                    DEFAULTS.queues.financial
                        .attempts,

                financial:
                    true,
            }),

        audit:
            Object.freeze({
                name:
                    'audit',

                class:
                    JOB_CLASSES.SECURITY,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.audit
                        .concurrency,

                priority:
                    DEFAULTS.queues.audit
                        .priority,

                attempts:
                    DEFAULTS.queues.audit
                        .attempts,
            }),

        analytics:
            Object.freeze({
                name:
                    'analytics',

                class:
                    JOB_CLASSES.ANALYTICS,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.analytics
                        .concurrency,

                priority:
                    DEFAULTS.queues.analytics
                        .priority,

                attempts:
                    DEFAULTS.queues.analytics
                        .attempts,
            }),

        integrations:
            Object.freeze({
                name:
                    'integrations',

                class:
                    JOB_CLASSES.INTEGRATION,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.integrations
                        .concurrency,

                priority:
                    DEFAULTS.queues.integrations
                        .priority,

                attempts:
                    DEFAULTS.queues.integrations
                        .attempts,
            }),

        maintenance:
            Object.freeze({
                name:
                    'maintenance',

                class:
                    JOB_CLASSES.MAINTENANCE,

                enabled:
                    true,

                concurrency:
                    DEFAULTS.queues.maintenance
                        .concurrency,

                priority:
                    DEFAULTS.queues.maintenance
                        .priority,

                attempts:
                    DEFAULTS.queues.maintenance
                        .attempts,
            }),

        'financial.dead-letter':
            Object.freeze({
                name:
                    'financial.dead-letter',

                class:
                    JOB_CLASSES.FINANCIAL,

                enabled:
                    true,

                concurrency:
                    1,

                priority:
                    JOB_PRIORITY.CRITICAL,

                attempts:
                    1,

                deadLetter:
                    true,
            }),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class QueueConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'QueueConfigError';

        this.code =
            options.code ||
            'QUEUE_CONFIG_ERROR';

        this.field =
            options.field ||
            null;

        this.queue =
            options.queue ||
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
            QueueConfigError,
        );
    }
}

/**
 * =============================================================================
 * Utility functions
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

    return (
        normalized ||
        fallback
    );
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

    const match =
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        );

    return (
        match ||
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

function getBooleanConfig(
    path,
    fallback,
) {

    const value =
        getConfig(
            path,
            fallback,
        );

    return asBoolean(
        value,
        fallback,
    );
}

function getIntegerConfig(
    path,
    fallback,
) {

    return asPositiveInteger(
        getConfig(
            path,
            fallback,
        ),
        fallback,
    );
}

function getEnvironment() {

    return asString(
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                'development',
        ),
        'development',
    );
}

function isProduction() {

    return (
        getEnvironment() ===
        'production'
    );
}

/**
 * =============================================================================
 * Redis resolution
 * =============================================================================
 */

function createRedisConfig(
    source = {},
) {

    const redisUrl =
        source.url ||
        env(
            'REDIS_URL',
        ) ||
        env(
            'REDIS_URI',
        ) ||
        null;

    return Object.freeze({
        url:
            redisUrl,

        host:
            asString(
                source.host ||
                    env(
                        'REDIS_HOST',
                    ),
                DEFAULTS
                    .redisConnection
                    .host,
            ),

        port:
            asPositiveInteger(
                source.port ||
                    env(
                        'REDIS_PORT',
                    ),
                DEFAULTS
                    .redisConnection
                    .port,
            ),

        db:
            asNonNegativeInteger(
                source.db ||
                    env(
                        'REDIS_DB',
                    ),
                DEFAULTS
                    .redisConnection
                    .db,
            ),

        password:
            source.password ||
            env(
                'REDIS_PASSWORD',
            ) ||
            null,

        username:
            source.username ||
            env(
                'REDIS_USERNAME',
            ) ||
            null,

        tls:
            source.tls ??
            asBoolean(
                env(
                    'REDIS_TLS',
                ),
                DEFAULTS
                    .redisConnection
                    .tls,
            ),

        connectTimeoutMs:
            asPositiveInteger(
                source.connectTimeoutMs ||
                    env(
                        'REDIS_CONNECT_TIMEOUT_MS',
                    ),
                DEFAULTS
                    .redisConnection
                    .connectTimeoutMs,
            ),

        commandTimeoutMs:
            asPositiveInteger(
                source.commandTimeoutMs ||
                    env(
                        'REDIS_COMMAND_TIMEOUT_MS',
                    ),
                DEFAULTS
                    .redisConnection
                    .commandTimeoutMs,
            ),

        maxRetriesPerRequest:
            source.maxRetriesPerRequest ??
            DEFAULTS
                .redisConnection
                .maxRetriesPerRequest,

        enableReadyCheck:
            source.enableReadyCheck ??
            asBoolean(
                env(
                    'REDIS_ENABLE_READY_CHECK',
                ),
                DEFAULTS
                    .redisConnection
                    .enableReadyCheck,
            ),

        keepAlive:
            asPositiveInteger(
                source.keepAlive ||
                    env(
                        'REDIS_KEEP_ALIVE',
                    ),
                DEFAULTS
                    .redisConnection
                    .keepAlive,
            ),
    });
}

/**
 * =============================================================================
 * Queue-name normalization
 * =============================================================================
 */

function normalizeQueueName(
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
                /[^a-z0-9._:-]/g,
                '-',
            )
            .replace(
                /-+/g,
                '-',
            )
            .slice(
                0,
                128,
            );

    return normalized;
}

function namespacedQueueName(
    name,
) {

    const namespace =
        asString(
            env(
                'QUEUE_NAMESPACE',
            ),
            'titech',
        );

    return normalizeQueueName(
        `${namespace}.${name}`,
    );
}

/**
 * =============================================================================
 * Queue definition builder
 * =============================================================================
 */

function buildQueueDefinition(
    name,
    source = {},
) {

    const normalizedName =
        normalizeQueueName(
            name,
        );

    if (
        !normalizedName
    ) {

        throw new QueueConfigError(
            'Queue name must be non-empty.',
            {
                code:
                    'QUEUE_NAME_INVALID',
            },
        );
    }

    const defaults =
        DEFAULT_QUEUE_DEFINITIONS[
            normalizedName
        ] || {
            name:
                normalizedName,

            class:
                JOB_CLASSES.GENERIC,

            enabled:
                DEFAULTS.enabled,

            concurrency:
                DEFAULTS.worker
                    .concurrency,

            priority:
                DEFAULTS.job
                    .priority,

            attempts:
                DEFAULTS.job
                    .attempts,
        };

    const financial =
        source.financial ===
            true ||
        defaults.financial ===
            true ||
        source.class ===
            JOB_CLASSES.FINANCIAL;

    return {
        name:
            normalizedName,

        qualifiedName:
            namespacedQueueName(
                normalizedName,
            ),

        class:
            source.class ||
            defaults.class,

        enabled:
            source.enabled ??
            defaults.enabled,

        concurrency:
            asPositiveInteger(
                source.concurrency,
                defaults.concurrency,
            ),

        priority:
            asPositiveInteger(
                source.priority,
                defaults.priority,
            ),

        attempts:
            asPositiveInteger(
                source.attempts,
                financial
                    ? DEFAULTS.financial
                        .maxAttempts
                    : DEFAULTS.job
                        .attempts,
            ),

        financial,

        deadLetter:
            source.deadLetter ===
            true,

        failurePolicy:
            source.failurePolicy ||
            (
                financial
                    ? DEFAULTS
                        .financial
                        .failurePolicy
                    : FAILURE_POLICIES.RETRY
            ),

        removeOnComplete:
            source.removeOnComplete ??
            DEFAULTS.job
                .removeOnComplete,

        removeOnFail:
            source.removeOnFail ??
            DEFAULTS.job
                .removeOnFail,

        jobTimeoutMs:
            asPositiveInteger(
                source.jobTimeoutMs,
                financial
                    ? DEFAULTS
                        .financial
                        .transactionTimeoutMs
                    : DEFAULTS.job
                        .timeoutMs,
            ),

        priorityClass:
            source.priorityClass ||
            (
                financial
                    ? JOB_PRIORITY.CRITICAL
                    : defaults.priority
            ),
    };
}

/**
 * =============================================================================
 * Built-in queues with environment overrides
 * =============================================================================
 */

function buildQueues(
    customQueues = {},
) {

    const definitions = {
        ...DEFAULT_QUEUE_DEFINITIONS,
        ...(customQueues || {}),
    };

    const queues =
        {};

    for (
        const [
            name,
            source,
        ] of Object.entries(
            definitions,
        )
    ) {

        queues[
            normalizeQueueName(
                name,
            )
        ] =
            buildQueueDefinition(
                name,
                source,
            );
    }

    return deepFreeze(
        queues,
    );
}

/**
 * =============================================================================
 * Backoff policy
 * =============================================================================
 */

function calculateBackoff(
    attempt,
    options = {},
) {

    const initialDelayMs =
        asPositiveInteger(
            options.initialDelayMs,
            DEFAULTS.job
                .backoff
                .delayMs,
        );

    const maxDelayMs =
        asPositiveInteger(
            options.maxDelayMs,
            DEFAULTS.job
                .backoff
                .maxDelayMs,
        );

    const jitterRatio =
        Math.min(
            Math.max(
                Number(
                    options.jitterRatio ??
                    DEFAULTS.job
                        .backoff
                        .jitterRatio,
                ),
                0,
            ),
            1,
        );

    const normalizedAttempt =
        Math.max(
            1,
            Number(
                attempt,
            ) || 1,
        );

    const base =
        Math.min(
            initialDelayMs *
                Math.pow(
                    2,
                    normalizedAttempt -
                        1,
                ),
            maxDelayMs,
        );

    const jitter =
        base *
        jitterRatio *
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

function getBackoffStrategy(
    queueDefinition,
) {

    return deepFreeze({
        type:
            DEFAULTS.job
                .backoff
                .type,

        delayMs:
            DEFAULTS.job
                .backoff
                .delayMs,

        maxDelayMs:
            queueDefinition
                .financial
                ? DEFAULTS
                    .financial
                    .transactionTimeoutMs
                : DEFAULTS
                    .job
                    .backoff
                    .maxDelayMs,

        jitterRatio:
            DEFAULTS.job
                .backoff
                .jitterRatio,
    });
}

/**
 * =============================================================================
 * Job policy
 * =============================================================================
 */

function getJobPolicy(
    jobClass,
    options = {},
) {

    const normalizedClass =
        toEnum(
            jobClass,
            Object.values(
                JOB_CLASSES,
            ),
            JOB_CLASSES.GENERIC,
        );

    const financial =
        normalizedClass ===
        JOB_CLASSES.FINANCIAL;

    const security =
        normalizedClass ===
        JOB_CLASSES.SECURITY ||
        normalizedClass ===
        JOB_CLASSES.AUTHENTICATION;

    return deepFreeze({
        class:
            normalizedClass,

        financial,

        security,

        attempts:
            asPositiveInteger(
                options.attempts,
                financial
                    ? DEFAULTS.financial
                        .maxAttempts
                    : DEFAULTS.job
                        .attempts,
            ),

        priority:
            asPositiveInteger(
                options.priority,
                financial
                    ? JOB_PRIORITY.CRITICAL
                    : DEFAULTS.job
                        .priority,
            ),

        timeoutMs:
            asPositiveInteger(
                options.timeoutMs,
                financial
                    ? DEFAULTS
                        .financial
                        .transactionTimeoutMs
                    : DEFAULTS.job
                        .timeoutMs,
            ),

        idempotencyRequired:
            financial
                ? DEFAULTS
                    .financial
                    .requireIdempotency
                : security
                    ? true
                    : false,

        durablePublishRequired:
            financial
                ? DEFAULTS
                    .financial
                    .requireDurableCommitBeforePublish
                : false,

        failurePolicy:
            options.failurePolicy ||
            (
                financial
                    ? DEFAULTS
                        .financial
                        .failurePolicy
                    : security
                        ? FAILURE_POLICIES.RETRY
                        : FAILURE_POLICIES.RETRY
            ),
    });
}

/**
 * =============================================================================
 * Job identity / idempotency policy
 * =============================================================================
 */

function buildJobId(
    {
        queue,
        operation,
        idempotencyKey,
        entityId,
    } = {},
) {

    const values = [
        normalizeQueueName(
            queue,
        ),

        String(
            operation ||
                'operation',
        )
            .trim()
            .toLowerCase(),

        String(
            entityId ||
                '',
        ).trim(),

        String(
            idempotencyKey ||
                '',
        ).trim(),
    ];

    const raw =
        values.join(
            ':',
        );

    if (
        values.some(
            value =>
                !value,
        )
    ) {

        throw new QueueConfigError(
            'Queue job identity requires queue, operation, entityId and idempotencyKey.',
            {
                code:
                    'QUEUE_JOB_IDENTITY_INCOMPLETE',
            },
        );
    }

    return crypto
        .createHash(
            'sha256',
        )
        .update(
            raw,
            'utf8',
        )
        .digest(
            'hex',
        );
}

function validateFinancialJobIdentity(
    options = {},
) {

    if (
        !options.idempotencyKey
    ) {

        throw new QueueConfigError(
            'TITech financial queue jobs require an idempotency key.',
            {
                code:
                    'FINANCIAL_JOB_IDEMPOTENCY_REQUIRED',
            },
        );
    }

    if (
        !options.entityId
    ) {

        throw new QueueConfigError(
            'TITech financial queue jobs require a stable entity identifier.',
            {
                code:
                    'FINANCIAL_JOB_ENTITY_ID_REQUIRED',
            },
        );
    }

    if (
        !options.operation
    ) {

        throw new QueueConfigError(
            'TITech financial queue jobs require an operation name.',
            {
                code:
                    'FINANCIAL_JOB_OPERATION_REQUIRED',
            },
        );
    }

    return true;
}

/**
 * =============================================================================
 * Queue configuration builder
 * =============================================================================
 */

function createQueueConfig(
    input = {},
) {

    const source =
        input.queues ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const enabled =
        source.enabled ??
        asBoolean(
            env(
                'QUEUES_ENABLED',
            ),
            DEFAULTS.enabled,
        );

    const required =
        source.required ??
        asBoolean(
            env(
                'QUEUES_REQUIRED',
            ),
            DEFAULTS.required,
        );

    const redis =
        createRedisConfig(
            source.redis ||
                {},
        );

    const queues =
        buildQueues(
            source.queueDefinitions ||
                source.queues ||
                {},
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

        enabled,

        required,

        provider:
            asString(
                source.provider,
                env(
                    'QUEUE_PROVIDER',
                    DEFAULTS.provider,
                ),
            ).toLowerCase(),

        driveMode:
            toEnum(
                source.driveMode ??
                    env(
                        'QUEUE_DRIVE_MODE',
                    ),
                Object.values(
                    QUEUE_DRIVE_MODES,
                ),
                DEFAULTS.driveMode,
            ),

        redis,

        worker:
            {
                concurrency:
                    asPositiveInteger(
                        source.worker
                            ?.concurrency ??
                            env(
                                'QUEUE_WORKER_CONCURRENCY',
                            ),
                        DEFAULTS
                            .worker
                            .concurrency,
                    ),

                limiterMax:
                    asPositiveInteger(
                        source.worker
                            ?.limiterMax ??
                            env(
                                'QUEUE_WORKER_LIMITER_MAX',
                            ),
                        DEFAULTS
                            .worker
                            .limiterMax,
                    ),

                limiterDurationMs:
                    asPositiveInteger(
                        source.worker
                            ?.limiterDurationMs ??
                            env(
                                'QUEUE_WORKER_LIMITER_DURATION_MS',
                            ),
                        DEFAULTS
                            .worker
                            .limiterDurationMs,
                    ),

                lockDurationMs:
                    asPositiveInteger(
                        source.worker
                            ?.lockDurationMs ??
                            env(
                                'QUEUE_WORKER_LOCK_DURATION_MS',
                            ),
                        DEFAULTS
                            .worker
                            .lockDurationMs,
                    ),

                lockRenewTimeMs:
                    asPositiveInteger(
                        source.worker
                            ?.lockRenewTimeMs ??
                            env(
                                'QUEUE_WORKER_LOCK_RENEW_TIME_MS',
                            ),
                        DEFAULTS
                            .worker
                            .lockRenewTimeMs,
                    ),

                stalledIntervalMs:
                    asPositiveInteger(
                        source.worker
                            ?.stalledIntervalMs ??
                            env(
                                'QUEUE_WORKER_STALLED_INTERVAL_MS',
                            ),
                        DEFAULTS
                            .worker
                            .stalledIntervalMs,
                    ),

                maxStalledCount:
                    asNonNegativeInteger(
                        source.worker
                            ?.maxStalledCount ??
                            env(
                                'QUEUE_WORKER_MAX_STALLED_COUNT',
                            ),
                        DEFAULTS
                            .worker
                            .maxStalledCount,
                    ),

                autorun:
                    source.worker
                        ?.autorun ??
                    asBoolean(
                        env(
                            'QUEUE_WORKER_AUTORUN',
                        ),
                        DEFAULTS
                            .worker
                            .autorun,
                    ),

                useWorkerThreads:
                    source.worker
                        ?.useWorkerThreads ??
                    asBoolean(
                        env(
                            'QUEUE_WORKER_THREADS',
                        ),
                        DEFAULTS
                            .worker
                            .useWorkerThreads,
                    ),

                maxMemoryRestartMb:
                    asPositiveInteger(
                        source.worker
                            ?.maxMemoryRestartMb ??
                            env(
                                'QUEUE_WORKER_MAX_MEMORY_MB',
                            ),
                        DEFAULTS
                            .worker
                            .maxMemoryRestartMb,
                    ),
            },

        job:
            {
                attempts:
                    asPositiveInteger(
                        source.job
                            ?.attempts ??
                            env(
                                'QUEUE_JOB_ATTEMPTS',
                            ),
                        DEFAULTS
                            .job
                            .attempts,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.job
                            ?.timeoutMs ??
                            env(
                                'QUEUE_JOB_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .job
                            .timeoutMs,
                    ),

                maxAttemptsPerJob:
                    asPositiveInteger(
                        source.job
                            ?.maxAttemptsPerJob ??
                            env(
                                'QUEUE_JOB_MAX_ATTEMPTS',
                            ),
                        DEFAULTS
                            .job
                            .maxAttemptsPerJob,
                    ),

                priority:
                    asPositiveInteger(
                        source.job
                            ?.priority ??
                            env(
                                'QUEUE_JOB_PRIORITY',
                            ),
                        DEFAULTS
                            .job
                            .priority,
                    ),

                removeOnComplete:
                    source.job
                        ?.removeOnComplete ??
                    DEFAULTS
                        .job
                        .removeOnComplete,

                removeOnFail:
                    source.job
                        ?.removeOnFail ??
                    DEFAULTS
                        .job
                        .removeOnFail,

                dedupeWindowMs:
                    asPositiveInteger(
                        source.job
                            ?.dedupeWindowMs ??
                            env(
                                'QUEUE_JOB_DEDUPE_WINDOW_MS',
                            ),
                        DEFAULTS
                            .job
                            .dedupeWindowMs,
                    ),

                preserveResult:
                    source.job
                        ?.preserveResult ??
                    asBoolean(
                        env(
                            'QUEUE_JOB_PRESERVE_RESULT',
                        ),
                        DEFAULTS
                            .job
                            .preserveResult,
                    ),

                failIfQueueDisabled:
                    source.job
                        ?.failIfQueueDisabled ??
                    asBoolean(
                        env(
                            'QUEUE_JOB_FAIL_IF_DISABLED',
                        ),
                        DEFAULTS
                            .job
                            .failIfQueueDisabled,
                    ),

                backoff:
                    {
                        type:
                            asString(
                                source.job
                                    ?.backoff
                                    ?.type ??
                                    env(
                                        'QUEUE_BACKOFF_TYPE',
                                    ),
                                DEFAULTS
                                    .job
                                    .backoff
                                    .type,
                            ),

                        delayMs:
                            asPositiveInteger(
                                source.job
                                    ?.backoff
                                    ?.delayMs ??
                                    env(
                                        'QUEUE_BACKOFF_DELAY_MS',
                                    ),
                                DEFAULTS
                                    .job
                                    .backoff
                                    .delayMs,
                            ),

                        maxDelayMs:
                            asPositiveInteger(
                                source.job
                                    ?.backoff
                                    ?.maxDelayMs ??
                                    env(
                                        'QUEUE_BACKOFF_MAX_DELAY_MS',
                                    ),
                                DEFAULTS
                                    .job
                                    .backoff
                                    .maxDelayMs,
                            ),

                        jitterRatio:
                            Math.min(
                                1,
                                Math.max(
                                    0,
                                    Number(
                                        source.job
                                            ?.backoff
                                            ?.jitterRatio ??
                                            env(
                                                'QUEUE_BACKOFF_JITTER_RATIO',
                                            ) ??
                                            DEFAULTS
                                                .job
                                                .backoff
                                                .jitterRatio,
                                    ),
                                ),
                            ),
                    },
            },

        financial:
            {
                requireIdempotency:
                    source.financial
                        ?.requireIdempotency ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_REQUIRE_IDEMPOTENCY',
                        ),
                        DEFAULTS
                            .financial
                            .requireIdempotency,
                    ),

                requireJobId:
                    source.financial
                        ?.requireJobId ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_REQUIRE_JOB_ID',
                        ),
                        DEFAULTS
                            .financial
                            .requireJobId,
                    ),

                requireOutbox:
                    source.financial
                        ?.requireOutbox ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_REQUIRE_OUTBOX',
                        ),
                        DEFAULTS
                            .financial
                            .requireOutbox,
                    ),

                requireDurableCommitBeforePublish:
                    source.financial
                        ?.requireDurableCommitBeforePublish ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_REQUIRE_COMMIT_BEFORE_PUBLISH',
                        ),
                        DEFAULTS
                            .financial
                            .requireDurableCommitBeforePublish,
                    ),

                allowAtLeastOnce:
                    source.financial
                        ?.allowAtLeastOnce ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_ALLOW_AT_LEAST_ONCE',
                        ),
                        DEFAULTS
                            .financial
                            .allowAtLeastOnce,
                    ),

                allowInMemoryOnly:
                    source.financial
                        ?.allowInMemoryOnly ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_ALLOW_IN_MEMORY',
                        ),
                        DEFAULTS
                            .financial
                            .allowInMemoryOnly,
                    ),

                allowDiscardOnShutdown:
                    source.financial
                        ?.allowDiscardOnShutdown ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_ALLOW_DISCARD_ON_SHUTDOWN',
                        ),
                        DEFAULTS
                            .financial
                            .allowDiscardOnShutdown,
                    ),

                failurePolicy:
                    source.financial
                        ?.failurePolicy ||
                    DEFAULTS
                        .financial
                        .failurePolicy,

                maxAttempts:
                    asPositiveInteger(
                        source.financial
                            ?.maxAttempts ??
                            env(
                                'QUEUE_FINANCIAL_MAX_ATTEMPTS',
                            ),
                        DEFAULTS
                            .financial
                            .maxAttempts,
                    ),

                transactionTimeoutMs:
                    asPositiveInteger(
                        source.financial
                            ?.transactionTimeoutMs ??
                            env(
                                'QUEUE_FINANCIAL_TRANSACTION_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .financial
                            .transactionTimeoutMs,
                    ),

                visibilityTimeoutMs:
                    asPositiveInteger(
                        source.financial
                            ?.visibilityTimeoutMs ??
                            env(
                                'QUEUE_FINANCIAL_VISIBILITY_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .financial
                            .visibilityTimeoutMs,
                    ),

                deadLetterEnabled:
                    source.financial
                        ?.deadLetterEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_FINANCIAL_DEAD_LETTER_ENABLED',
                        ),
                        DEFAULTS
                            .financial
                            .deadLetterEnabled,
                    ),

                deadLetterQueue:
                    normalizeQueueName(
                        source.financial
                            ?.deadLetterQueue ||
                            DEFAULTS
                                .financial
                                .deadLetterQueue,
                    ),
            },

        deadLetter:
            {
                enabled:
                    source.deadLetter
                        ?.enabled ??
                    asBoolean(
                        env(
                            'QUEUE_DEAD_LETTER_ENABLED',
                        ),
                        DEFAULTS
                            .deadLetter
                            .enabled,
                    ),

                queueSuffix:
                    asString(
                        source.deadLetter
                            ?.queueSuffix,
                        DEFAULTS
                            .deadLetter
                            .queueSuffix,
                    ),

                maxRetentionMs:
                    asPositiveInteger(
                        source.deadLetter
                            ?.maxRetentionMs ??
                            env(
                                'QUEUE_DEAD_LETTER_RETENTION_MS',
                            ),
                        DEFAULTS
                            .deadLetter
                            .maxRetentionMs,
                    ),

                alertAfterFailures:
                    asPositiveInteger(
                        source.deadLetter
                            ?.alertAfterFailures ??
                            env(
                                'QUEUE_DEAD_LETTER_ALERT_AFTER_FAILURES',
                            ),
                        DEFAULTS
                            .deadLetter
                            .alertAfterFailures,
                    ),

                preservePayload:
                    source.deadLetter
                        ?.preservePayload ??
                    asBoolean(
                        env(
                            'QUEUE_DEAD_LETTER_PRESERVE_PAYLOAD',
                        ),
                        DEFAULTS
                            .deadLetter
                            .preservePayload,
                    ),

                preserveStack:
                    source.deadLetter
                        ?.preserveStack ??
                    asBoolean(
                        env(
                            'QUEUE_DEAD_LETTER_PRESERVE_STACK',
                        ),
                        DEFAULTS
                            .deadLetter
                            .preserveStack,
                    ),
            },

        scheduling:
            {
                delayedJobsEnabled:
                    source.scheduling
                        ?.delayedJobsEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_DELAYED_JOBS_ENABLED',
                        ),
                        DEFAULTS
                            .scheduling
                            .delayedJobsEnabled,
                    ),

                repeatableJobsEnabled:
                    source.scheduling
                        ?.repeatableJobsEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_REPEATABLE_JOBS_ENABLED',
                        ),
                        DEFAULTS
                            .scheduling
                            .repeatableJobsEnabled,
                    ),

                maxDelayMs:
                    asPositiveInteger(
                        source.scheduling
                            ?.maxDelayMs ??
                            env(
                                'QUEUE_MAX_DELAY_MS',
                            ),
                        DEFAULTS
                            .scheduling
                            .maxDelayMs,
                    ),

                timezone:
                    asString(
                        source.scheduling
                            ?.timezone ??
                            env(
                                'QUEUE_TIMEZONE',
                            ),
                        DEFAULTS
                            .scheduling
                            .timezone,
                    ),
            },

        shutdown:
            {
                drainEnabled:
                    source.shutdown
                        ?.drainEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_DRAIN_ON_SHUTDOWN',
                        ),
                        DEFAULTS
                            .shutdown
                            .drainEnabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.shutdown
                            ?.timeoutMs ??
                            env(
                                'QUEUE_SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .shutdown
                            .timeoutMs,
                    ),

                forceTimeoutMs:
                    asPositiveInteger(
                        source.shutdown
                            ?.forceTimeoutMs ??
                            env(
                                'QUEUE_FORCE_SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .shutdown
                            .forceTimeoutMs,
                    ),

                waitForActiveJobs:
                    source.shutdown
                        ?.waitForActiveJobs ??
                    asBoolean(
                        env(
                            'QUEUE_WAIT_FOR_ACTIVE_JOBS',
                        ),
                        DEFAULTS
                            .shutdown
                            .waitForActiveJobs,
                    ),

                failNewJobsAfterShutdown:
                    source.shutdown
                        ?.failNewJobsAfterShutdown ??
                    asBoolean(
                        env(
                            'QUEUE_FAIL_NEW_JOBS_AFTER_SHUTDOWN',
                        ),
                        DEFAULTS
                            .shutdown
                            .failNewJobsAfterShutdown,
                    ),
            },

        health:
            {
                enabled:
                    source.health
                        ?.enabled ??
                    asBoolean(
                        env(
                            'QUEUE_HEALTH_ENABLED',
                        ),
                        DEFAULTS
                            .health
                            .enabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.health
                            ?.timeoutMs ??
                            env(
                                'QUEUE_HEALTH_TIMEOUT_MS',
                            ),
                        DEFAULTS
                            .health
                            .timeoutMs,
                    ),

                maxQueueDepthWarning:
                    asPositiveInteger(
                        source.health
                            ?.maxQueueDepthWarning ??
                            env(
                                'QUEUE_DEPTH_WARNING',
                            ),
                        DEFAULTS
                            .health
                            .maxQueueDepthWarning,
                    ),

                maxQueueDepthCritical:
                    asPositiveInteger(
                        source.health
                            ?.maxQueueDepthCritical ??
                            env(
                                'QUEUE_DEPTH_CRITICAL',
                            ),
                        DEFAULTS
                            .health
                            .maxQueueDepthCritical,
                    ),

                maxWaitingJobsWarning:
                    asPositiveInteger(
                        source.health
                            ?.maxWaitingJobsWarning ??
                            env(
                                'QUEUE_WAITING_JOBS_WARNING',
                            ),
                        DEFAULTS
                            .health
                            .maxWaitingJobsWarning,
                    ),

                staleWorkerThresholdMs:
                    asPositiveInteger(
                        source.health
                            ?.staleWorkerThresholdMs ??
                            env(
                                'QUEUE_STALE_WORKER_THRESHOLD_MS',
                            ),
                        DEFAULTS
                            .health
                            .staleWorkerThresholdMs,
                    ),
            },

        observability:
            {
                metricsEnabled:
                    source.observability
                        ?.metricsEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_METRICS_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .metricsEnabled,
                    ),

                loggingEnabled:
                    source.observability
                        ?.loggingEnabled ??
                    asBoolean(
                        env(
                            'QUEUE_LOGGING_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .loggingEnabled,
                    ),

                logJobPayload:
                    source.observability
                        ?.logJobPayload ??
                    asBoolean(
                        env(
                            'QUEUE_LOG_PAYLOAD',
                        ),
                        DEFAULTS
                            .observability
                            .logJobPayload,
                    ),

                logJobResult:
                    source.observability
                        ?.logJobResult ??
                    asBoolean(
                        env(
                            'QUEUE_LOG_RESULT',
                        ),
                        DEFAULTS
                            .observability
                            .logJobResult,
                    ),

                logStack:
                    source.observability
                        ?.logStack ??
                    asBoolean(
                        env(
                            'QUEUE_LOG_STACK',
                        ),
                        DEFAULTS
                            .observability
                            .logStack,
                    ),

                slowJobThresholdMs:
                    asPositiveInteger(
                        source.observability
                            ?.slowJobThresholdMs ??
                            env(
                                'QUEUE_SLOW_JOB_THRESHOLD_MS',
                            ),
                        DEFAULTS
                            .observability
                            .slowJobThresholdMs,
                    ),

                includeQueueName:
                    source.observability
                        ?.includeQueueName ??
                    true,

                includeJobId:
                    source.observability
                        ?.includeJobId ??
                    true,

                includeTraceContext:
                    source.observability
                        ?.includeTraceContext ??
                    true,

                includeTenantId:
                    source.observability
                        ?.includeTenantId ??
                    true,

                includeActorId:
                    source.observability
                        ?.includeActorId ??
                    true,
            },

        security:
            {
                allowArbitraryJobNames:
                    source.security
                        ?.allowArbitraryJobNames ??
                    asBoolean(
                        env(
                            'QUEUE_ALLOW_ARBITRARY_JOB_NAMES',
                        ),
                        DEFAULTS
                            .security
                            .allowArbitraryJobNames,
                    ),

                allowArbitraryQueueNames:
                    source.security
                        ?.allowArbitraryQueueNames ??
                    asBoolean(
                        env(
                            'QUEUE_ALLOW_ARBITRARY_QUEUE_NAMES',
                        ),
                        DEFAULTS
                            .security
                            .allowArbitraryQueueNames,
                    ),

                allowProductionSyncMode:
                    source.security
                        ?.allowProductionSyncMode ??
                    asBoolean(
                        env(
                            'QUEUE_ALLOW_PRODUCTION_SYNC_MODE',
                        ),
                        DEFAULTS
                            .security
                            .allowProductionSyncMode,
                    ),

                exposeQueueDiagnostics:
                    source.security
                        ?.exposeQueueDiagnostics ??
                    asBoolean(
                        env(
                            'QUEUE_EXPOSE_DIAGNOSTICS',
                        ),
                        DEFAULTS
                            .security
                            .exposeQueueDiagnostics,
                    ),

                preserveSensitivePayloads:
                    source.security
                        ?.preserveSensitivePayloads ??
                    asBoolean(
                        env(
                            'QUEUE_PRESERVE_SENSITIVE_PAYLOADS',
                        ),
                        DEFAULTS
                            .security
                            .preserveSensitivePayloads,
                    ),

                productionRequireTls:
                    source.security
                        ?.productionRequireTls ??
                    asBoolean(
                        env(
                            'QUEUE_PRODUCTION_REQUIRE_TLS',
                        ),
                        DEFAULTS
                            .security
                            .productionRequireTls,
                    ),

                productionRequireRedisAuth:
                    source.security
                        ?.productionRequireRedisAuth ??
                    asBoolean(
                        env(
                            'QUEUE_PRODUCTION_REQUIRE_REDIS_AUTH',
                        ),
                        DEFAULTS
                            .security
                            .productionRequireRedisAuth,
                    ),
            },

        diagnostics:
            {
                enabled:
                    source.diagnostics
                        ?.enabled ??
                    asBoolean(
                        env(
                            'QUEUE_DIAGNOSTICS_ENABLED',
                        ),
                        DEFAULTS
                            .diagnostics
                            .enabled,
                    ),

                includeConnectionDetails:
                    source.diagnostics
                        ?.includeConnectionDetails ??
                    asBoolean(
                        env(
                            'QUEUE_DIAGNOSTICS_CONNECTION_DETAILS',
                        ),
                        DEFAULTS
                            .diagnostics
                            .includeConnectionDetails,
                    ),

                includeQueueConfiguration:
                    source.diagnostics
                        ?.includeQueueConfiguration ??
                    asBoolean(
                        env(
                            'QUEUE_DIAGNOSTICS_CONFIGURATION',
                        ),
                        DEFAULTS
                            .diagnostics
                            .includeQueueConfiguration,
                    ),
            },
    };

    return validateQueueConfig(
        config,
    );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateQueueConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Provider
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        config.provider !==
            DEFAULTS.provider
    ) {

        warnings.push({
            code:
                'QUEUE_PROVIDER_NONSTANDARD',

            field:
                'provider',

            message:
                `TITech queue provider "${config.provider}" is not the canonical BullMQ provider.`,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Redis
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        config.provider ===
            'bullmq'
    ) {

        if (
            !config.redis.url &&
            !config.redis.host
        ) {

            errors.push({
                code:
                    'QUEUE_REDIS_CONFIGURATION_MISSING',

                field:
                    'redis',

                message:
                    'TITech queues require Redis connection configuration.',
            });
        }

        if (
            production &&
            DEFAULTS.security
                .productionRequireTls &&
            !config.redis.tls &&
            !config.redis.url
                ?.startsWith(
                    'rediss://',
                )
        ) {

            errors.push({
                code:
                    'QUEUE_REDIS_TLS_REQUIRED',

                field:
                    'redis.tls',

                message:
                    'TITech production queue Redis connections require TLS.',
            });
        }

        if (
            production &&
            DEFAULTS.security
                .productionRequireRedisAuth &&
            !config.redis.password &&
            !config.redis.url
        ) {

            /**
             * Managed Redis platforms can authenticate through ACLs,
             * certificates, or workload identity. Treat this as warning rather
             * than an absolute failure when a secure URL exists.
             */
            if (
                config.redis.tls
            ) {

                warnings.push({
                    code:
                        'QUEUE_REDIS_PASSWORD_NOT_CONFIGURED',

                    field:
                        'redis.password',

                    message:
                        'Redis password is not configured; verify the deployment uses an alternative authenticated Redis mechanism.',
                });

            } else {

                errors.push({
                    code:
                        'QUEUE_REDIS_AUTH_CONFIGURATION_MISSING',

                    field:
                        'redis.password',

                    message:
                        'TITech production Redis authentication is not configured.',
                });

            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Production synchronous mode
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.driveMode ===
            QUEUE_DRIVE_MODES.SYNC &&
        !config.security
            .allowProductionSyncMode
    ) {

        errors.push({
            code:
                'QUEUE_SYNC_MODE_FORBIDDEN',

            field:
                'driveMode',

            message:
                'TITech production queue processing cannot default to synchronous mode.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Financial safety
     * -------------------------------------------------------------------------
     */

    if (
        production
    ) {

        if (
            !config.financial
                .requireIdempotency
        ) {

            errors.push({
                code:
                    'FINANCIAL_QUEUE_IDEMPOTENCY_REQUIRED',

                field:
                    'financial.requireIdempotency',

                message:
                    'TITech financial queue jobs must require idempotency.',
            });
        }

        if (
            !config.financial
                .requireJobId
        ) {

            errors.push({
                code:
                    'FINANCIAL_QUEUE_JOB_ID_REQUIRED',

                field:
                    'financial.requireJobId',

                message:
                    'TITech financial queue jobs must require stable job identity.',
            });
        }

        if (
            !config.financial
                .requireOutbox
        ) {

            errors.push({
                code:
                    'FINANCIAL_QUEUE_OUTBOX_REQUIRED',

                field:
                    'financial.requireOutbox',

                message:
                    'TITech financial queue publication must be backed by a durable outbox pattern.',
            });
        }

        if (
            !config.financial
                .requireDurableCommitBeforePublish
        ) {

            errors.push({
                code:
                    'FINANCIAL_QUEUE_COMMIT_BEFORE_PUBLISH_REQUIRED',

                field:
                    'financial.requireDurableCommitBeforePublish',

                message:
                    'TITech financial events must not be published before durable financial commit.',
            });
        }

        if (
            config.financial
                .allowInMemoryOnly
        ) {

            errors.push({
                code:
                    'FINANCIAL_IN_MEMORY_QUEUE_FORBIDDEN',

                field:
                    'financial.allowInMemoryOnly',

                message:
                    'TITech financial workloads cannot rely on memory-only queues.',
            });
        }

        if (
            config.financial
                .allowDiscardOnShutdown
        ) {

            errors.push({
                code:
                    'FINANCIAL_QUEUE_DISCARD_FORBIDDEN',

                field:
                    'financial.allowDiscardOnShutdown',

                message:
                    'TITech financial jobs cannot be silently discarded during shutdown.',
            });
        }

        if (
            !config.financial
                .deadLetterEnabled
        ) {

            errors.push({
                code:
                    'FINANCIAL_DEAD_LETTER_REQUIRED',

                field:
                    'financial.deadLetterEnabled',

                message:
                    'TITech financial queue dead-letter handling must be enabled.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Worker safety
     * -------------------------------------------------------------------------
     */

    if (
        config.worker.lockRenewTimeMs >=
        config.worker.lockDurationMs
    ) {

        errors.push({
            code:
                'QUEUE_LOCK_RENEW_INTERVAL_INVALID',

            field:
                'worker.lockRenewTimeMs',

            message:
                'Queue worker lock renewal must occur before lock expiry.',
        });
    }

    if (
        config.worker.maxStalledCount >
        10
    ) {

        warnings.push({
            code:
                'QUEUE_STALLED_RETRY_HIGH',

            field:
                'worker.maxStalledCount',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Backoff
     * -------------------------------------------------------------------------
     */

    if (
        config.job.backoff.maxDelayMs <
        config.job.backoff.delayMs
    ) {

        errors.push({
            code:
                'QUEUE_BACKOFF_INVALID',

            field:
                'job.backoff',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Dead letter
     * -------------------------------------------------------------------------
     */

    if (
        config.deadLetter.enabled &&
        config.deadLetter.maxRetentionMs <=
            0
    ) {

        errors.push({
            code:
                'QUEUE_DEAD_LETTER_RETENTION_INVALID',

            field:
                'deadLetter.maxRetentionMs',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     */

    if (
        config.shutdown.forceTimeoutMs >=
        config.shutdown.timeoutMs
    ) {

        warnings.push({
            code:
                'QUEUE_SHUTDOWN_FORCE_TIMEOUT_HIGH',

            field:
                'shutdown.forceTimeoutMs',

            message:
                'Force-shutdown timeout is greater than or equal to total queue shutdown timeout.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Sensitive payloads
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.security
            .preserveSensitivePayloads
    ) {

        errors.push({
            code:
                'QUEUE_SENSITIVE_PAYLOAD_STORAGE_FORBIDDEN',

            field:
                'security.preserveSensitivePayloads',

            message:
                'TITech production queues must not preserve sensitive job payloads by default.',
        });
    }

    if (
        production &&
        config.observability
            .logJobPayload
    ) {

        errors.push({
            code:
                'QUEUE_JOB_PAYLOAD_LOGGING_FORBIDDEN',

            field:
                'observability.logJobPayload',

            message:
                'TITech production queue payload logging is forbidden.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Queue catalogue
     * -------------------------------------------------------------------------
     */

    for (
        const [
            name,
            definition,
        ] of Object.entries(
            config.queues,
        )
    ) {

        if (
            !definition.qualifiedName
        ) {

            errors.push({
                code:
                    'QUEUE_NAME_INVALID',

                field:
                    `queues.${name}.qualifiedName`,
            });
        }

        if (
            definition.concurrency <=
            0
        ) {

            errors.push({
                code:
                    'QUEUE_CONCURRENCY_INVALID',

                queue:
                    name,

                field:
                    `queues.${name}.concurrency`,
            });
        }

        if (
            definition.financial &&
            definition.attempts >
                config.financial.maxAttempts
        ) {

            warnings.push({
                code:
                    'FINANCIAL_QUEUE_ATTEMPTS_CLAMPED',

                queue:
                    name,

                message:
                    `Financial queue "${name}" exceeds recommended retry policy.`,
            });
        }
    }

    if (
        errors.length >
        0
    ) {

        const error =
            new QueueConfigError(
                'TITech queue configuration validation failed.',
                {
                    code:
                        'QUEUE_CONFIGURATION_INVALID',

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
            ? QUEUE_STATES.DISABLED
            : warnings.length >
                0
                ? QUEUE_STATES.DEGRADED
                : QUEUE_STATES.ENABLED;

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
 * Queue lookup
 * =============================================================================
 */

function getQueueDefinition(
    name,
    config =
        defaultConfig,
) {

    const normalized =
        normalizeQueueName(
            name,
        );

    const queue =
        config.queues[
            normalized
        ];

    if (
        !queue
    ) {

        throw new QueueConfigError(
            `Unknown TITech queue "${name}".`,
            {
                code:
                    'QUEUE_UNKNOWN',

                queue:
                    normalized,
            },
        );
    }

    return queue;
}

/**
 * =============================================================================
 * Job options
 * =============================================================================
 */

function buildJobOptions(
    queueName,
    options = {},
) {

    const queue =
        getQueueDefinition(
            queueName,
        );

    const jobClass =
        options.class ||
        queue.class;

    const policy =
        getJobPolicy(
            jobClass,
            {
                attempts:
                    options.attempts ??
                    queue.attempts,

                priority:
                    options.priority ??
                    queue.priority,

                timeoutMs:
                    options.timeoutMs ??
                    queue.jobTimeoutMs,

                failurePolicy:
                    options.failurePolicy ??
                    queue.failurePolicy,
            },
        );

    const financial =
        queue.financial ||
        policy.financial;

    if (
        financial
    ) {

        validateFinancialJobIdentity(
            options,
        );
    }

    const jobId =
        options.jobId ||
        (
            financial
                ? buildJobId({
                    queue:
                        queue.name,

                    operation:
                        options.operation,

                    entityId:
                        options.entityId,

                    idempotencyKey:
                        options.idempotencyKey,
                })
                : null
        );

    return deepFreeze({
        jobId,

        attempts:
            Math.min(
                policy.attempts,
                queue.financial
                    ? DEFAULTS
                        .financial
                        .maxAttempts
                    : DEFAULTS
                        .job
                        .maxAttemptsPerJob,
            ),

        priority:
            policy.priority,

        timeout:
            policy.timeoutMs,

        removeOnComplete:
            queue.removeOnComplete,

        removeOnFail:
            queue.removeOnFail,

        backoff:
            {
                type:
                    DEFAULTS.job
                        .backoff
                        .type,

                delay:
                    calculateBackoff(
                        1,
                        {
                            initialDelayMs:
                                DEFAULTS
                                    .job
                                    .backoff
                                    .delayMs,

                            maxDelayMs:
                                DEFAULTS
                                    .job
                                    .backoff
                                    .maxDelayMs,

                            jitterRatio:
                                DEFAULTS
                                    .job
                                    .backoff
                                    .jitterRatio,
                        },
                    ),
            },

        stackTraceLimit:
            queue.financial ||
            policy.security
                ? 20
                : 10,

        metadata:
            {
                service:
                    SERVICE_NAME,

                application:
                    APPLICATION_NAME,

                queue:
                    queue.name,

                queueQualifiedName:
                    queue.qualifiedName,

                class:
                    jobClass,

                financial,

                idempotencyRequired:
                    policy
                        .idempotencyRequired,

                durablePublishRequired:
                    policy
                        .durablePublishRequired,

                failurePolicy:
                    policy.failurePolicy,
            },
    });
}

/**
 * =============================================================================
 * Queue health policy
 * =============================================================================
 */

function classifyQueueHealth(
    {
        waiting = 0,
        active = 0,
        delayed = 0,
        failed = 0,
        stalled = 0,
        workerLastSeenAt = null,
    } = {},
) {

    const totalBacklog =
        Number(waiting) +
        Number(delayed);

    const now =
        Date.now();

    const staleWorker =
        workerLastSeenAt
            ? (
                now -
                new Date(
                    workerLastSeenAt,
                ).getTime()
            ) >
                DEFAULTS.health
                    .staleWorkerThresholdMs
            : false;

    if (
        totalBacklog >=
        DEFAULTS.health
            .maxQueueDepthCritical
    ) {

        return 'critical';
    }

    if (
        totalBacklog >=
            DEFAULTS.health
                .maxQueueDepthWarning ||
        stalled > 0 ||
        staleWorker
    ) {

        return 'degraded';
    }

    return 'healthy';
}

/**
 * =============================================================================
 * Safe snapshot
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

        provider:
            config.provider,

        driveMode:
            config.driveMode,

        redis:
            {
                urlConfigured:
                    Boolean(
                        config.redis.url,
                    ),

                host:
                    config.redis.host,

                port:
                    config.redis.port,

                db:
                    config.redis.db,

                tls:
                    config.redis.tls,

                usernameConfigured:
                    Boolean(
                        config.redis.username,
                    ),

                passwordConfigured:
                    Boolean(
                        config.redis.password,
                    ),

                connectTimeoutMs:
                    config.redis
                        .connectTimeoutMs,

                commandTimeoutMs:
                    config.redis
                        .commandTimeoutMs,
            },

        worker:
            {
                concurrency:
                    config.worker
                        .concurrency,

                limiterMax:
                    config.worker
                        .limiterMax,

                limiterDurationMs:
                    config.worker
                        .limiterDurationMs,

                lockDurationMs:
                    config.worker
                        .lockDurationMs,

                lockRenewTimeMs:
                    config.worker
                        .lockRenewTimeMs,

                stalledIntervalMs:
                    config.worker
                        .stalledIntervalMs,

                maxStalledCount:
                    config.worker
                        .maxStalledCount,

                autorun:
                    config.worker
                        .autorun,
            },

        queues:
            Object.fromEntries(
                Object.entries(
                    config.queues,
                ).map(
                    ([
                        name,
                        queue,
                    ]) => [
                        name,
                        {
                            name:
                                queue.name,

                            qualifiedName:
                                queue.qualifiedName,

                            class:
                                queue.class,

                            enabled:
                                queue.enabled,

                            concurrency:
                                queue.concurrency,

                            priority:
                                queue.priority,

                            attempts:
                                queue.attempts,

                            financial:
                                queue.financial,

                            deadLetter:
                                queue.deadLetter,

                            failurePolicy:
                                queue.failurePolicy,
                        },
                    ],
                ),
            ),

        financial:
            {
                requireIdempotency:
                    config.financial
                        .requireIdempotency,

                requireJobId:
                    config.financial
                        .requireJobId,

                requireOutbox:
                    config.financial
                        .requireOutbox,

                requireDurableCommitBeforePublish:
                    config.financial
                        .requireDurableCommitBeforePublish,

                allowAtLeastOnce:
                    config.financial
                        .allowAtLeastOnce,

                allowInMemoryOnly:
                    config.financial
                        .allowInMemoryOnly,

                allowDiscardOnShutdown:
                    config.financial
                        .allowDiscardOnShutdown,

                failurePolicy:
                    config.financial
                        .failurePolicy,

                maxAttempts:
                    config.financial
                        .maxAttempts,

                deadLetterEnabled:
                    config.financial
                        .deadLetterEnabled,

                deadLetterQueue:
                    config.financial
                        .deadLetterQueue,
            },

        deadLetter:
            {
                enabled:
                    config.deadLetter
                        .enabled,

                maxRetentionMs:
                    config.deadLetter
                        .maxRetentionMs,

                alertAfterFailures:
                    config.deadLetter
                        .alertAfterFailures,

                preservePayload:
                    config.deadLetter
                        .preservePayload,

                preserveStack:
                    config.deadLetter
                        .preserveStack,
            },

        scheduling:
            config.scheduling,

        shutdown:
            config.shutdown,

        health:
            config.health,

        observability:
            {
                metricsEnabled:
                    config.observability
                        .metricsEnabled,

                loggingEnabled:
                    config.observability
                        .loggingEnabled,

                logJobPayload:
                    config.observability
                        .logJobPayload,

                logJobResult:
                    config.observability
                        .logJobResult,

                slowJobThresholdMs:
                    config.observability
                        .slowJobThresholdMs,
            },

        security:
            {
                allowArbitraryJobNames:
                    config.security
                        .allowArbitraryJobNames,

                allowArbitraryQueueNames:
                    config.security
                        .allowArbitraryQueueNames,

                allowProductionSyncMode:
                    config.security
                        .allowProductionSyncMode,

                exposeQueueDiagnostics:
                    config.security
                        .exposeQueueDiagnostics,

                preserveSensitivePayloads:
                    config.security
                        .preserveSensitivePayloads,
            },

        warnings:
            [
                ...(config.warnings ||
                    []),
            ],

        timestamp:
            new Date().toISOString(),
    });
}

/**
 * =============================================================================
 * Environment overrides
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [
        'QUEUES_ENABLED',
        'QUEUES_REQUIRED',
        'QUEUE_PROVIDER',
        'QUEUE_DRIVE_MODE',
        'QUEUE_NAMESPACE',

        'REDIS_URL',
        'REDIS_HOST',
        'REDIS_PORT',
        'REDIS_DB',
        'REDIS_TLS',
        'REDIS_USERNAME',

        'QUEUE_WORKER_CONCURRENCY',
        'QUEUE_WORKER_LIMITER_MAX',
        'QUEUE_WORKER_LIMITER_DURATION_MS',
        'QUEUE_WORKER_LOCK_DURATION_MS',
        'QUEUE_WORKER_LOCK_RENEW_TIME_MS',
        'QUEUE_WORKER_STALLED_INTERVAL_MS',
        'QUEUE_WORKER_MAX_STALLED_COUNT',
        'QUEUE_WORKER_AUTORUN',
        'QUEUE_WORKER_THREADS',
        'QUEUE_WORKER_MAX_MEMORY_MB',

        'QUEUE_JOB_ATTEMPTS',
        'QUEUE_JOB_TIMEOUT_MS',
        'QUEUE_JOB_MAX_ATTEMPTS',
        'QUEUE_JOB_PRIORITY',
        'QUEUE_JOB_DEDUPE_WINDOW_MS',
        'QUEUE_JOB_PRESERVE_RESULT',
        'QUEUE_JOB_FAIL_IF_DISABLED',

        'QUEUE_BACKOFF_TYPE',
        'QUEUE_BACKOFF_DELAY_MS',
        'QUEUE_BACKOFF_MAX_DELAY_MS',
        'QUEUE_BACKOFF_JITTER_RATIO',

        'QUEUE_FINANCIAL_REQUIRE_IDEMPOTENCY',
        'QUEUE_FINANCIAL_REQUIRE_JOB_ID',
        'QUEUE_FINANCIAL_REQUIRE_OUTBOX',
        'QUEUE_FINANCIAL_REQUIRE_COMMIT_BEFORE_PUBLISH',
        'QUEUE_FINANCIAL_ALLOW_AT_LEAST_ONCE',
        'QUEUE_FINANCIAL_ALLOW_IN_MEMORY',
        'QUEUE_FINANCIAL_ALLOW_DISCARD_ON_SHUTDOWN',
        'QUEUE_FINANCIAL_MAX_ATTEMPTS',
        'QUEUE_FINANCIAL_TRANSACTION_TIMEOUT_MS',
        'QUEUE_FINANCIAL_VISIBILITY_TIMEOUT_MS',
        'QUEUE_FINANCIAL_DEAD_LETTER_ENABLED',

        'QUEUE_DEAD_LETTER_ENABLED',
        'QUEUE_DEAD_LETTER_RETENTION_MS',
        'QUEUE_DEAD_LETTER_ALERT_AFTER_FAILURES',
        'QUEUE_DEAD_LETTER_PRESERVE_PAYLOAD',
        'QUEUE_DEAD_LETTER_PRESERVE_STACK',

        'QUEUE_DELAYED_JOBS_ENABLED',
        'QUEUE_REPEATABLE_JOBS_ENABLED',
        'QUEUE_MAX_DELAY_MS',
        'QUEUE_TIMEZONE',

        'QUEUE_DRAIN_ON_SHUTDOWN',
        'QUEUE_SHUTDOWN_TIMEOUT_MS',
        'QUEUE_FORCE_SHUTDOWN_TIMEOUT_MS',
        'QUEUE_WAIT_FOR_ACTIVE_JOBS',
        'QUEUE_FAIL_NEW_JOBS_AFTER_SHUTDOWN',

        'QUEUE_HEALTH_ENABLED',
        'QUEUE_HEALTH_TIMEOUT_MS',
        'QUEUE_DEPTH_WARNING',
        'QUEUE_DEPTH_CRITICAL',
        'QUEUE_WAITING_JOBS_WARNING',
        'QUEUE_STALE_WORKER_THRESHOLD_MS',

        'QUEUE_METRICS_ENABLED',
        'QUEUE_LOGGING_ENABLED',
        'QUEUE_LOG_PAYLOAD',
        'QUEUE_LOG_RESULT',
        'QUEUE_LOG_STACK',
        'QUEUE_SLOW_JOB_THRESHOLD_MS',

        'QUEUE_ALLOW_ARBITRARY_JOB_NAMES',
        'QUEUE_ALLOW_ARBITRARY_QUEUE_NAMES',
        'QUEUE_ALLOW_PRODUCTION_SYNC_MODE',
        'QUEUE_EXPOSE_DIAGNOSTICS',
        'QUEUE_PRESERVE_SENSITIVE_PAYLOADS',
        'QUEUE_PRODUCTION_REQUIRE_TLS',
        'QUEUE_PRODUCTION_REQUIRE_REDIS_AUTH',

        'QUEUE_DIAGNOSTICS_ENABLED',
        'QUEUE_DIAGNOSTICS_CONNECTION_DETAILS',
        'QUEUE_DIAGNOSTICS_CONFIGURATION',
    ];

    const result = {};

    for (
        const key of
        keys
    ) {

        result[key] =
            process.env[key];

    }

    result.REDIS_PASSWORD =
        process.env.REDIS_PASSWORD
            ? '[REDACTED]'
            : undefined;

    return Object.freeze(
        result,
    );
}

/**
 * =============================================================================
 * Bootstrap lifecycle
 * =============================================================================
 */

const defaultConfig =
    createQueueConfig();

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createQueueConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.queues =
            config;

        context.queueConfig =
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
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Core.
         */
        config:
            defaultConfig,

        queues:
            defaultConfig.queues,

        DEFAULTS,

        DEFAULT_QUEUE_DEFINITIONS,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        QUEUE_STATES,

        QUEUE_DRIVE_MODES,

        JOB_PRIORITY,

        JOB_CLASSES,

        FAILURE_POLICIES,

        /**
         * Errors.
         */
        QueueConfigError,

        /**
         * Configuration.
         */
        createQueueConfig,

        validateQueueConfig,

        getQueueDefinition,

        buildQueueDefinition,

        buildQueues,

        /**
         * Job policy.
         */
        getJobPolicy,

        getBackoffStrategy,

        calculateBackoff,

        buildJobOptions,

        buildJobId,

        validateFinancialJobIdentity,

        /**
         * Queue naming / infrastructure.
         */
        createRedisConfig,

        normalizeQueueName,

        namespacedQueueName,

        /**
         * Health / diagnostics.
         */
        classifyQueueHealth,

        getSnapshot,

        getEnvironmentOverrides,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,
    });