'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/syncService.js
 *
 * Purpose:
 *   Enterprise production-grade synchronization orchestration service for the
 *   TITech offline-first runtime.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Coordinate offline operation/event synchronization.
 *   ✓ Push pending local operations to the authoritative TITech backend.
 *   ✓ Pull remote events/state when supported.
 *   ✓ Use deterministic batches and cursors.
 *   ✓ Enforce bounded concurrency.
 *   ✓ Integrate device identity metadata.
 *   ✓ Preserve idempotency semantics.
 *   ✓ Classify retryable/non-retryable failures.
 *   ✓ Handle rate limits and Retry-After.
 *   ✓ Detect and persist conflicts.
 *   ✓ Never silently overwrite financial conflicts.
 *   ✓ Update local operation/event reconciliation state.
 *   ✓ Maintain synchronization checkpoints.
 *   ✓ Support pause/resume/cancel.
 *   ✓ Prevent concurrent synchronization runs.
 *   ✓ Provide health/readiness/diagnostics.
 *   ✓ Provide safe synchronization metrics.
 *   ✓ Support injectable transport clients for production and testing.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module orchestrates synchronization.
 *
 *   It does NOT:
 *
 *     - become the authoritative financial ledger;
 *     - bypass server-side authorization;
 *     - resolve financial conflicts automatically;
 *     - mutate MongoDB directly;
 *     - mutate Redis directly;
 *     - implement HTTP security middleware;
 *     - manage device private keys;
 *     - replace the event store;
 *     - replace the offline database;
 *     - silently retry non-idempotent financial operations.
 *
 * =============================================================================
 *
 * Canonical synchronization boundary
 * =============================================================================
 *
 *   Connectivity
 *       ↓
 *   syncService
 *       ↓
 *   offline/db
 *       ↓
 *   offline/eventStore
 *       ↓
 *   deviceIdentity
 *       ↓
 *   authoritative TITech API
 *       ↓
 *   server transaction boundary
 *       ↓
 *   ledger/repository
 *       ↓
 *   reconciliation response
 *       ↓
 *   local checkpoint
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const {
    OPERATION_STATES,
    SYNC_STATES,
    SYNC_RESULT_STATES,
    RETRY_CLASSES,
    BACKOFF_STRATEGIES,
    SYNC_DIRECTIONS,
    SYNC_DEFAULTS,
    QUEUE_DEFAULTS,
    IDEMPOTENCY_DEFAULTS,
    FINANCIAL_DEFAULTS,
    FINANCIAL_OPERATION_TYPES,
    EVENTS,
    HTTP_HEADERS,
    HTTP_STATUS_POLICY,
    CONSISTENCY_LEVELS,
} =
    require('./constants');

const {
    offlineDatabase,
    OfflineDatabaseError,
} =
    require('./db');

const {
    eventStore,
    EventStoreError,
} =
    require('./eventStore');

let deviceIdentityModule =
    null;

try {
    // eslint-disable-next-line global-require
    deviceIdentityModule =
        require('./deviceIdentity');
} catch {
    deviceIdentityModule =
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
    'offline.syncService';

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        direction:
            SYNC_DIRECTIONS.BIDIRECTIONAL,

        batchSize:
            SYNC_DEFAULTS.BATCH_SIZE,

        maxBatchSize:
            SYNC_DEFAULTS.MAX_BATCH_SIZE,

        maxConcurrentBatches:
            SYNC_DEFAULTS.MAX_CONCURRENT_BATCHES,

        intervalMs:
            SYNC_DEFAULTS.INTERVAL_MS,

        initialDelayMs:
            SYNC_DEFAULTS.INITIAL_DELAY_MS,

        maxSyncDurationMs:
            SYNC_DEFAULTS.MAX_SYNC_DURATION_MS,

        maxOperationAgeMs:
            SYNC_DEFAULTS.MAX_OPERATION_AGE_MS,

        maxFailuresBeforePause:
            SYNC_DEFAULTS.MAX_FAILURES_BEFORE_PAUSE,

        maxConflictsBeforePause:
            SYNC_DEFAULTS.MAX_CONFLICTS_BEFORE_PAUSE,

        pauseDurationMs:
            SYNC_DEFAULTS.PAUSE_DURATION_MS,

        requestTimeoutMs:
            30_000,

        maxResponseBytes:
            10 * 1024 * 1024,

        maxRetryAfterMs:
            120_000,

        maxAttempts:
            QUEUE_DEFAULTS.MAX_ATTEMPTS,

        retryStrategy:
            BACKOFF_STRATEGIES
                .EXPONENTIAL_JITTER,

        initialRetryDelayMs:
            QUEUE_DEFAULTS
                .INITIAL_RETRY_DELAY_MS,

        maxRetryDelayMs:
            QUEUE_DEFAULTS
                .MAX_RETRY_DELAY_MS,

        retryJitterRatio:
            QUEUE_DEFAULTS
                .RETRY_JITTER_RATIO,

        requireIdempotencyForMutations:
            IDEMPOTENCY_DEFAULTS
                .REQUIRE_FOR_MUTATIONS,

        requireIdempotencyForFinancial:
            FINANCIAL_DEFAULTS
                .REQUIRE_IDEMPOTENCY,

        requireRemoteAckForFinancial:
            FINANCIAL_DEFAULTS
                .REQUIRE_REMOTE_ACK,

        requireReconciliationForFinancial:
            FINANCIAL_DEFAULTS
                .REQUIRE_SERVER_RECONCILIATION,

        requireLedgerReconciliationForFinancial:
            FINANCIAL_DEFAULTS
                .REQUIRE_LEDGER_RECONCILIATION,

        allowAutomaticFinancialConflictResolution:
            FINANCIAL_DEFAULTS
                .ALLOW_FINANCIAL_AUTO_CONFLICT_RESOLUTION,

        checkpointName:
            'offline.sync',

        eventCheckpointName:
            'offline.events',

        operationCheckpointName:
            'offline.operations',

        requestHeaders:
            Object.freeze({}),

        endpoint:
            null,

        transport:
            null,

        request:
            null,

        onEvent:
            null,

        onConflict:
            null,

        onError:
            null,

        strict:
            true,

        autoStart:
            false,
    });

const SERVICE_STATES =
    Object.freeze({
        CREATED:
            'created',

        READY:
            'ready',

        RUNNING:
            'running',

        PAUSED:
            'paused',

        STOPPING:
            'stopping',

        STOPPED:
            'stopped',

        FAILED:
            'failed',
    });

const DEFAULT_OPERATION_BATCH_ENDPOINT =
    '/api/offline/sync';

const DEFAULT_EVENT_BATCH_ENDPOINT =
    '/api/offline/events/sync';

const RETRYABLE_NETWORK_CODES =
    Object.freeze([
        'ECONNRESET',
        'ECONNREFUSED',
        'ECONNABORTED',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_SOCKET',
    ]);

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class SyncServiceError
    extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'SyncServiceError';

        this.code =
            options.code ||
            'TITECH_OFFLINE_SYNC_ERROR';

        this.classification =
            options.classification ||
            RETRY_CLASSES.UNKNOWN;

        this.retryable =
            Boolean(
                options.retryable,
            );

        this.statusCode =
            options.statusCode ??
            null;

        this.operationId =
            options.operationId ||
            null;

        this.eventId =
            options.eventId ||
            null;

        this.batchId =
            options.batchId ||
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
            SyncServiceError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
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
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Synchronization must remain operational without logger availability.
    }
}

function nowMs() {

    return Date.now();
}

function isoNow() {

    return new Date().toISOString();
}

function randomId(
    prefix,
) {

    return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeInteger(
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

    return Number.isInteger(
        parsed,
    )
        ? parsed
        : fallback;
}

function normalizePositiveInteger(
    value,
    fallback,
    maximum = Number.MAX_SAFE_INTEGER,
) {

    const normalized =
        Math.min(
            maximum,
            Math.max(
                1,
                normalizeInteger(
                    value,
                    fallback,
                ),
            ),
        );

    return normalized;
}

function isFinancialOperation(
    operation,
) {

    const type =
        String(
            operation?.operationType ||
            operation?.type ||
            '',
        )
            .trim()
            .toLowerCase();

    return FINANCIAL_OPERATION_TYPES
        .some(
            candidate =>
                type ===
                    candidate ||
                type.startsWith(
                    `${candidate}.`,
                ),
        );
}

function isMutationOperation(
    operation,
) {

    const type =
        String(
            operation?.operationType ||
            operation?.type ||
            '',
        )
            .trim()
            .toLowerCase();

    return [
        'create',
        'update',
        'delete',
        'patch',
        'upsert',
        'command',
    ].includes(
        type,
    );
}

function classifyStatus(
    statusCode,
) {

    const status =
        Number(
            statusCode,
        );

    if (
        Number.isInteger(
            status,
        ) &&
        HTTP_STATUS_POLICY
            .RETRYABLE
            .includes(
                status,
            )
    ) {

        if (
            status ===
            429
        ) {

            return RETRY_CLASSES
                .RATE_LIMIT;
        }

        if (
            [
                408,
                504,
            ].includes(
                status,
            )
        ) {

            return RETRY_CLASSES
                .TIMEOUT;
        }

        return RETRY_CLASSES
            .SERVICE_UNAVAILABLE;
    }

    if (
        status ===
        401
    ) {

        return RETRY_CLASSES
            .AUTHENTICATION;
    }

    if (
        status ===
        403
    ) {

        return RETRY_CLASSES
            .AUTHORIZATION;
    }

    if (
        [
            400,
            422,
        ].includes(
            status,
        )
    ) {

        return RETRY_CLASSES
            .VALIDATION;
    }

    if (
        status ===
        409
    ) {

        return RETRY_CLASSES
            .CONFLICT;
    }

    if (
        status ===
        404
    ) {

        return RETRY_CLASSES
            .NOT_FOUND;
    }

    return RETRY_CLASSES
        .UNKNOWN;
}

function isRetryableStatus(
    statusCode,
) {

    return HTTP_STATUS_POLICY
        .RETRYABLE
        .includes(
            Number(
                statusCode,
            ),
        );
}

function extractRetryAfterMs(
    headers,
    now = new Date(),
) {

    if (
        !headers
    ) {

        return null;
    }

    const getHeader =
        name => {

            if (
                typeof headers.get ===
                'function'
            ) {

                return headers.get(
                    name,
                );
            }

            return (
                headers[name] ??
                headers[
                    name.toLowerCase()
                ] ??
                null
            );
        };

    const raw =
        getHeader(
            'retry-after',
        );

    if (
        raw ===
        null ||
        raw ===
        undefined
    ) {

        return null;
    }

    const value =
        String(raw).trim();

    if (
        /^\d+$/.test(
            value,
        )
    ) {

        return Number(value) *
            1000;
    }

    const date =
        Date.parse(
            value,
        );

    if (
        Number.isFinite(
            date,
        )
    ) {

        return Math.max(
            0,
            date -
            now.getTime(),
        );
    }

    return null;
}

function computeBackoffDelay(
    attempt,
    options = DEFAULTS,
) {

    const normalizedAttempt =
        Math.max(
            1,
            Number(
                attempt,
            ) || 1,
        );

    const initial =
        Number(
            options.initialRetryDelayMs,
        );

    const maximum =
        Number(
            options.maxRetryDelayMs,
        );

    let base =
        initial;

    switch (
        options.retryStrategy
    ) {

        case BACKOFF_STRATEGIES
            .FIXED:

            base =
                initial;

            break;

        case BACKOFF_STRATEGIES
            .LINEAR:

            base =
                initial *
                normalizedAttempt;

            break;

        case BACKOFF_STRATEGIES
            .EXPONENTIAL:

            base =
                initial *
                Math.pow(
                    2,
                    normalizedAttempt -
                    1,
                );

            break;

        case BACKOFF_STRATEGIES
            .FULL_JITTER:

            base =
                Math.random() *
                Math.min(
                    maximum,
                    initial *
                    Math.pow(
                        2,
                        normalizedAttempt -
                        1,
                    ),
                );

            return Math.floor(
                base,
            );

        case BACKOFF_STRATEGIES
            .DECORRELATED_JITTER:

            base =
                initial +
                Math.random() *
                Math.max(
                    initial,
                    maximum -
                    initial,
                );

            return Math.floor(
                Math.min(
                    maximum,
                    base,
                ),
            );

        case BACKOFF_STRATEGIES
            .EXPONENTIAL_JITTER:
        default:

            base =
                initial *
                Math.pow(
                    2,
                    normalizedAttempt -
                    1,
                );
    }

    const capped =
        Math.min(
            maximum,
            base,
        );

    const jitterRatio =
        Math.max(
            0,
            Math.min(
                1,
                Number(
                    options.retryJitterRatio,
                ) || 0,
            ),
        );

    const jitter =
        capped *
        jitterRatio *
        (
            Math.random() -
            0.5
        );

    return Math.max(
        0,
        Math.floor(
            capped +
            jitter,
        ),
    );
}

function sleep(
    milliseconds,
    signal,
) {

    const delay =
        Math.max(
            0,
            Number(milliseconds) ||
            0,
        );

    if (
        delay ===
        0
    ) {

        return Promise.resolve();
    }

    return new Promise(
        (
            resolve,
            reject,
        ) => {

            let timer =
                null;

            const onAbort =
                () => {

                    if (
                        timer
                    ) {

                        clearTimeout(
                            timer,
                        );
                    }

                    signal?.removeEventListener(
                        'abort',
                        onAbort,
                    );

                    reject(
                        new SyncServiceError(
                            'TITech synchronization sleep was aborted.',
                            {
                                code:
                                    'TITECH_OFFLINE_SYNC_ABORTED',

                                classification:
                                    RETRY_CLASSES
                                        .TRANSIENT,

                                retryable:
                                    true,
                            },
                        ),
                    );
                };

            if (
                signal?.aborted
            ) {

                onAbort();

                return;
            }

            if (
                signal
            ) {

                signal.addEventListener(
                    'abort',
                    onAbort,
                    {
                        once:
                            true,
                    },
                );
            }

            timer =
                setTimeout(
                    () => {

                        signal?.removeEventListener(
                            'abort',
                            onAbort,
                        );

                        resolve();

                    },
                    delay,
                );

            timer.unref?.();
        },
    );
}

function getHeader(
    headers,
    name,
) {

    if (
        !headers
    ) {

        return null;
    }

    if (
        typeof headers.get ===
        'function'
    ) {

        return headers.get(
            name,
        );
    }

    return (
        headers[name] ??
        headers[
            name.toLowerCase()
        ] ??
        null
    );
}

function safeResponseBody(
    body,
    maxBytes,
) {

    if (
        body ===
        null ||
        body ===
        undefined
    ) {

        return null;
    }

    if (
        Buffer.isBuffer(
            body,
        )
    ) {

        if (
            body.length >
            maxBytes
        ) {

            return '[RESPONSE_TOO_LARGE]';
        }

        return body.toString(
            'utf8',
        );
    }

    if (
        typeof body ===
        'string'
    ) {

        return body.length >
            maxBytes
            ? body.slice(
                0,
                maxBytes,
            )
            : body;
    }

    return body;
}

async function parseTransportResponse(
    response,
    maxResponseBytes,
) {

    const status =
        Number(
            response?.status,
        );

    let body =
        null;

    if (
        typeof response?.json ===
        'function'
    ) {

        try {
            body =
                await response.json();
        } catch {
            try {

                body =
                    typeof response.text ===
                        'function'
                        ? await response.text()
                        : null;

            } catch {
                body =
                    null;
            }
        }

    } else if (
        typeof response?.text ===
        'function'
    ) {

        try {
            body =
                await response.text();
        } catch {
            body =
                null;
        }

    } else {

        body =
            response?.body ??
            null;
    }

    return {
        status,

        ok:
            response?.ok !==
                undefined
                ? Boolean(
                    response.ok,
                )
                : status >=
                    200 &&
                  status <
                    300,

        headers:
            response?.headers ||
            null,

        body:
            safeResponseBody(
                body,
                maxResponseBytes,
            ),
    };
}

/**
 * =============================================================================
 * SyncService
 * =============================================================================
 */

class SyncService {

    constructor(
        options = {},
    ) {

        this.options =
            {
                ...DEFAULTS,
                ...options,
            };

        this.state =
            SERVICE_STATES.CREATED;

        this.runPromise =
            null;

        this.stopRequested =
            false;

        this.abortController =
            null;

        this.intervalTimer =
            null;

        this.pauseTimer =
            null;

        this.startedAt =
            null;

        this.lastRunAt =
            null;

        this.lastSuccessAt =
            null;

        this.lastFailureAt =
            null;

        this.lastError =
            null;

        this.lastResult =
            null;

        this.currentSyncId =
            null;

        this.currentBatchId =
            null;

        this.failureCount =
            0;

        this.conflictCount =
            0;

        this.metrics = {
            syncRuns:
                0,

            successfulRuns:
                0,

            failedRuns:
                0,

            partialRuns:
                0,

            operationsSelected:
                0,

            operationsSent:
                0,

            operationsSucceeded:
                0,

            operationsFailed:
                0,

            operationsRetried:
                0,

            operationsConflicted:
                0,

            operationsSkipped:
                0,

            eventsPulled:
                0,

            eventsApplied:
                0,

            eventsFailed:
                0,

            batches:
                0,

            networkFailures:
                0,

            rateLimited:
                0,

            authenticationFailures:
                0,

            authorizationFailures:
                0,
        };

        this.assertOptionLimits();
    }

    /**
     * -------------------------------------------------------------------------
     * Validate options.
     * -------------------------------------------------------------------------
     */

    assertOptionLimits() {

        this.options.batchSize =
            normalizePositiveInteger(
                this.options.batchSize,
                SYNC_DEFAULTS
                    .BATCH_SIZE,
                this.options
                    .maxBatchSize ||
                    SYNC_DEFAULTS
                        .MAX_BATCH_SIZE,
            );

        this.options.maxBatchSize =
            normalizePositiveInteger(
                this.options.maxBatchSize,
                SYNC_DEFAULTS
                    .MAX_BATCH_SIZE,
                SYNC_DEFAULTS
                    .MAX_BATCH_SIZE,
            );

        this.options.maxConcurrentBatches =
            normalizePositiveInteger(
                this.options
                    .maxConcurrentBatches,
                SYNC_DEFAULTS
                    .MAX_CONCURRENT_BATCHES,
                32,
            );

        this.options.maxAttempts =
            normalizePositiveInteger(
                this.options.maxAttempts,
                QUEUE_DEFAULTS
                    .MAX_ATTEMPTS,
                100,
            );

        this.options.requestTimeoutMs =
            normalizePositiveInteger(
                this.options
                    .requestTimeoutMs,
                30_000,
                10 * 60 * 1000,
            );

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize service.
     * -------------------------------------------------------------------------
     */

    initialize() {

        if (
            this.state ===
                SERVICE_STATES.READY ||
            this.state ===
                SERVICE_STATES.PAUSED
        ) {

            return this;
        }

        offlineDatabase.initialize();
        eventStore.initialize();

        this.state =
            SERVICE_STATES.READY;

        this.startedAt =
            this.startedAt ||
            isoNow();

        this.lastError =
            null;

        if (
            this.options.autoStart &&
            this.options.enabled
        ) {

            this.start();
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Start scheduler.
     * -------------------------------------------------------------------------
     */

    start() {

        this.initialize();

        if (
            !this.options.enabled
        ) {

            this.state =
                SERVICE_STATES
                    .STOPPED;

            return this;
        }

        if (
            this.intervalTimer
        ) {

            return this;
        }

        this.stopRequested =
            false;

        this.intervalTimer =
            setInterval(
                () => {

                    if (
                        this.state !==
                            SERVICE_STATES.READY ||
                        this.runPromise
                    ) {

                        return;
                    }

                    this.run()
                        .catch(
                            error =>
                                this.handleBackgroundError(
                                    error,
                                ),
                        );
                },
                this.options
                    .intervalMs,
            );

        this.intervalTimer.unref?.();

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Stop scheduler.
     * -------------------------------------------------------------------------
     */

    async stop() {

        this.stopRequested =
            true;

        if (
            this.intervalTimer
        ) {

            clearInterval(
                this.intervalTimer,
            );

            this.intervalTimer =
                null;
        }

        if (
            this.pauseTimer
        ) {

            clearTimeout(
                this.pauseTimer,
            );

            this.pauseTimer =
                null;
        }

        if (
            this.runPromise
        ) {

            this.abortController
                ?.abort();

            try {
                await this.runPromise;
            } catch {
                // The caller stopping the service does not need a duplicate
                // synchronization failure.
            }
        }

        this.state =
            SERVICE_STATES
                .STOPPED;

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Request manual pause.
     * -------------------------------------------------------------------------
     */

    pause(
        reason =
            'manual_pause',
    ) {

        if (
            this.pauseTimer
        ) {

            clearTimeout(
                this.pauseTimer,
            );

            this.pauseTimer =
                null;
        }

        this.state =
            SERVICE_STATES
                .PAUSED;

        this.stopRequested =
            false;

        log(
            'warn',
            {
                reason,
                syncId:
                    this.currentSyncId,
            },
            'TITech offline synchronization paused.',
        );

        return this.state;
    }

    /**
     * -------------------------------------------------------------------------
     * Resume.
     * -------------------------------------------------------------------------
     */

    resume() {

        if (
            this.state ===
            SERVICE_STATES
                .STOPPED
        ) {

            this.initialize();
        }

        this.state =
            SERVICE_STATES
                .READY;

        this.failureCount =
            0;

        this.conflictCount =
            0;

        return this.state;
    }

    /**
     * -------------------------------------------------------------------------
     * Schedule automatic resume.
     * -------------------------------------------------------------------------
     */

    scheduleResume(
        delayMs =
            this.options
                .pauseDurationMs,
    ) {

        if (
            this.pauseTimer
        ) {

            clearTimeout(
                this.pauseTimer,
            );
        }

        this.state =
            SERVICE_STATES
                .PAUSED;

        this.pauseTimer =
            setTimeout(
                () => {

                    this.pauseTimer =
                        null;

                    if (
                        !this.stopRequested
                    ) {

                        this.resume();

                        this.run()
                            .catch(
                                error =>
                                    this.handleBackgroundError(
                                        error,
                                    ),
                            );
                    }
                },
                delayMs,
            );

        this.pauseTimer.unref?.();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Run synchronization once.
     * -------------------------------------------------------------------------
     */

    async run(
        options = {},
    ) {

        this.initialize();

        if (
            !this.options.enabled
        ) {

            return {
                status:
                    SYNC_RESULT_STATES
                        .SKIPPED,

                reason:
                    'disabled',
            };
        }

        if (
            this.state ===
            SERVICE_STATES
                .PAUSED
        ) {

            return {
                status:
                    SYNC_RESULT_STATES
                        .SKIPPED,

                reason:
                    'paused',
            };
        }

        if (
            this.state ===
            SERVICE_STATES
                .STOPPING ||
            this.stopRequested
        ) {

            return {
                status:
                    SYNC_RESULT_STATES
                        .CANCELLED,

                reason:
                    'stopping',
            };
        }

        if (
            this.runPromise
        ) {

            return this.runPromise;
        }

        this.abortController =
            new AbortController();

        const signal =
            this.abortController
                .signal;

        this.currentSyncId =
            randomId(
                'sync',
            );

        const startedAt =
            nowMs();

        this.currentBatchId =
            null;

        this.state =
            SERVICE_STATES
                .RUNNING;

        this.metrics.syncRuns +=
            1;

        this.lastRunAt =
            isoNow();

        this.runPromise =
            this.executeRun(
                {
                    ...options,
                    signal,
                    syncId:
                        this.currentSyncId,
                },
            );

        try {

            const result =
                await this.runPromise;

            this.lastResult =
                result;

            this.lastSuccessAt =
                result.status ===
                    SYNC_RESULT_STATES
                        .SUCCESS ||
                result.status ===
                    SYNC_RESULT_STATES
                        .PARTIAL
                    ? isoNow()
                    : this.lastSuccessAt;

            if (
                result.status ===
                SYNC_RESULT_STATES
                    .SUCCESS
            ) {

                this.metrics
                    .successfulRuns +=
                    1;

            } else if (
                result.status ===
                SYNC_RESULT_STATES
                    .PARTIAL
            ) {

                this.metrics
                    .partialRuns +=
                    1;
            }

            this.failureCount =
                0;

            if (
                this.state !==
                    SERVICE_STATES.PAUSED &&
                !this.stopRequested
            ) {

                this.state =
                    SERVICE_STATES
                        .READY;
            }

            return result;

        } catch (
            error
        ) {

            this.failureCount +=
                1;

            this.metrics.failedRuns +=
                1;

            this.lastFailureAt =
                isoNow();

            this.lastError =
                error;

            if (
                this.failureCount >=
                this.options
                    .maxFailuresBeforePause
            ) {

                this.scheduleResume();

            } else if (
                this.state !==
                    SERVICE_STATES
                        .PAUSED &&
                !this.stopRequested
            ) {

                this.state =
                    SERVICE_STATES
                        .READY;
            }

            throw error;

        } finally {

            this.runPromise =
                null;

            this.currentBatchId =
                null;

            this.abortController =
                null;

            if (
                this.state ===
                SERVICE_STATES
                    .RUNNING
            ) {

                this.state =
                    SERVICE_STATES
                        .READY;
            }

            const durationMs =
                nowMs() -
                startedAt;

            log(
                'debug',
                {
                    syncId:
                        this.currentSyncId,

                    durationMs,

                    status:
                        this.lastResult
                            ?.status ||
                        null,
                },
                'TITech offline synchronization run completed.',
            );

        }
    }

    /**
     * -------------------------------------------------------------------------
     * Main synchronization execution.
     * -------------------------------------------------------------------------
     */

    async executeRun(
        context,
    ) {

        const startedAt =
            nowMs();

        const deadline =
            startedAt +
            this.options
                .maxSyncDurationMs;

        const summary = {
            syncId:
                context.syncId,

            status:
                SYNC_RESULT_STATES
                    .SUCCESS,

            startedAt:
                new Date(
                    startedAt,
                ).toISOString(),

            batches:
                0,

            operationsSelected:
                0,

            operationsSent:
                0,

            operationsSucceeded:
                0,

            operationsFailed:
                0,

            operationsRetried:
                0,

            operationsConflicted:
                0,

            operationsSkipped:
                0,

            eventsPulled:
                0,

            eventsApplied:
                0,

            eventsFailed:
                0,

            conflicts:
                [],

            errors:
                [],

            direction:
                this.options
                    .direction,

            completedAt:
                null,

            durationMs:
                null,
        };

        try {

            this.emit(
                EVENTS.SYNC_STARTED,
                {
                    syncId:
                        context.syncId,
                },
            );

            this.assertDeadline(
                deadline,
                context.signal,
            );

            if (
                this.options.direction ===
                    SYNC_DIRECTIONS.PUSH ||
                this.options.direction ===
                    SYNC_DIRECTIONS.BIDIRECTIONAL ||
                this.options.direction ===
                    SYNC_DIRECTIONS.REPLAY
            ) {

                const pushResult =
                    await this.pushPendingOperations(
                        {
                            ...context,
                            deadline,
                        },
                    );

                mergeSummary(
                    summary,
                    pushResult,
                );
            }

            this.assertDeadline(
                deadline,
                context.signal,
            );

            if (
                this.options.direction ===
                    SYNC_DIRECTIONS.PULL ||
                this.options.direction ===
                    SYNC_DIRECTIONS.BIDIRECTIONAL
            ) {

                const pullResult =
                    await this.pullRemoteEvents(
                        {
                            ...context,
                            deadline,
                        },
                    );

                mergeSummary(
                    summary,
                    pullResult,
                );
            }

            this.assertDeadline(
                deadline,
                context.signal,
            );

            const reconciliationResult =
                await this.reconcileAcknowledgements(
                    {
                        ...context,
                        deadline,
                    },
                );

            mergeSummary(
                summary,
                reconciliationResult,
            );

            if (
                summary.operationsConflicted >
                0 ||
                summary.eventsFailed >
                0
            ) {

                summary.status =
                    SYNC_RESULT_STATES
                        .PARTIAL;

            } else {

                summary.status =
                    SYNC_RESULT_STATES
                        .SUCCESS;
            }

            summary.completedAt =
                isoNow();

            summary.durationMs =
                nowMs() -
                startedAt;

            this.emit(
                summary.status ===
                    SYNC_RESULT_STATES
                        .SUCCESS
                    ? EVENTS.SYNC_COMPLETED
                    : EVENTS.SYNC_PARTIAL,
                summary,
            );

            return Object.freeze(
                summary,
            );

        } catch (
            error
        ) {

            summary.status =
                SYNC_RESULT_STATES
                    .FAILED;

            summary.completedAt =
                isoNow();

            summary.durationMs =
                nowMs() -
                startedAt;

            summary.errors.push(
                this.toSafeError(
                    error,
                ),
            );

            this.emit(
                EVENTS.SYNC_FAILED,
                {
                    ...summary,
                    error:
                        this.toSafeError(
                            error,
                        ),
                },
            );

            throw error instanceof
                SyncServiceError
                ? error
                : new SyncServiceError(
                    'TITech offline synchronization failed.',
                    {
                        code:
                            'TITECH_OFFLINE_SYNC_RUN_FAILED',

                        classification:
                            RETRY_CLASSES
                                .TRANSIENT,

                        retryable:
                            true,

                        cause:
                            error,

                        details: {
                            syncId:
                                context.syncId,
                        },
                    },
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Push pending local operations.
     * -------------------------------------------------------------------------
     */

    async pushPendingOperations(
        context,
    ) {

        const result = {
            operationsSelected:
                0,

            operationsSent:
                0,

            operationsSucceeded:
                0,

            operationsFailed:
                0,

            operationsRetried:
                0,

            operationsConflicted:
                0,

            operationsSkipped:
                0,

            conflicts:
                [],

            errors:
                [],

            batches:
                0,
        };

        while (
            !this.stopRequested
        ) {

            this.assertDeadline(
                context.deadline,
                context.signal,
            );

            const batch =
                this.selectPendingOperations();

            if (
                batch.length ===
                0
            ) {

                break;
            }

            this.currentBatchId =
                randomId(
                    'batch',
                );

            result.batches +=
                1;

            this.metrics.batches +=
                1;

            result.operationsSelected +=
                batch.length;

            this.metrics
                .operationsSelected +=
                batch.length;

            const batchResult =
                await this.pushBatch(
                    batch,
                    {
                        ...context,

                        batchId:
                            this.currentBatchId,
                    },
                );

            mergeSummary(
                result,
                batchResult,
            );

            if (
                result.batches >
                this.options.maxBatchSize
            ) {

                break;
            }

            if (
                batch.length <
                this.options.batchSize
            ) {

                break;
            }
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Select pending operations.
     * -------------------------------------------------------------------------
     */

    selectPendingOperations() {

        const result =
            offlineDatabase.listOperations({
                page:
                    1,

                limit:
                    this.options.batchSize,

                state:
                    OPERATION_STATES
                        .PENDING,
            });

        const retryable =
            offlineDatabase.listOperations({
                page:
                    1,

                limit:
                    this.options.batchSize,

                state:
                    OPERATION_STATES
                        .RETRYABLE_FAILURE,
            });

        const combined =
            [
                ...result.data,
                ...retryable.data,
            ];

        const seen =
            new Set();

        return combined
            .filter(
                operation => {

                    if (
                        seen.has(
                            operation.operationId,
                        )
                    ) {

                        return false;
                    }

                    seen.add(
                        operation.operationId,
                    );

                    return true;
                },
            )
            .slice(
                0,
                this.options
                    .batchSize,
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Push one batch.
     * -------------------------------------------------------------------------
     */

    async pushBatch(
        operations,
        context,
    ) {

        const result = {
            operationsSent:
                0,

            operationsSucceeded:
                0,

            operationsFailed:
                0,

            operationsRetried:
                0,

            operationsConflicted:
                0,

            operationsSkipped:
                0,

            conflicts:
                [],

            errors:
                [],
        };

        /**
         * Claim operations first. This prevents multiple workers/runs from
         * processing the same outbox entry simultaneously.
         */
        const claimed =
            [];

        for (
            const operation of
            operations
        ) {

            this.assertDeadline(
                context.deadline,
                context.signal,
            );

            try {

                const claim =
                    offlineDatabase
                        .claimNextOperation(
                            context.syncId,
                        );

                if (
                    !claim ||
                    !claim.operation
                ) {

                    result
                        .operationsSkipped +=
                        1;

                    this.metrics
                        .operationsSkipped +=
                        1;

                    continue;
                }

                /**
                 * Ensure the claim corresponds to one of this batch's
                 * selected operations. If the queue changed between selection
                 * and claim, another current operation may be returned.
                 */
                if (
                    claim.operation
                        .operationId !==
                    operation.operationId
                ) {

                    try {

                        offlineDatabase
                            .completeOperation(
                                claim.operation
                                    .operationId,
                                claim.lockToken,
                                {
                                    success:
                                        false,

                                    retryable:
                                        true,

                                    errorCode:
                                        'SYNC_SELECTION_CHANGED',

                                    errorMessage:
                                        'Operation selection changed while claiming the synchronization batch.',
                                },
                            );

                    } catch {
                        // Do not hide the primary selection mismatch.
                    }

                    result
                        .operationsSkipped +=
                        1;

                    this.metrics
                        .operationsSkipped +=
                        1;

                    continue;
                }

                claimed.push(
                    claim,
                );

            } catch (
                error
            ) {

                result.operationsFailed +=
                    1;

                result.errors.push(
                    this.toSafeError(
                        error,
                        {
                            operationId:
                                operation
                                    .operationId,
                        },
                    ),
                );
            }
        }

        if (
            claimed.length ===
            0
        ) {

            return result;
        }

        const response =
            await this.sendOperations(
                claimed.map(
                    claim =>
                        claim.operation,
                ),
                context,
            );

        result.operationsSent +=
            claimed.length;

        this.metrics
            .operationsSent +=
            claimed.length;

        await this.processBatchResponse(
            claimed,
            response,
            result,
            context,
        );

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Send operations to authoritative backend.
     * -------------------------------------------------------------------------
     */

    async sendOperations(
        operations,
        context,
    ) {

        const endpoint =
            this.resolveOperationEndpoint();

        const payload = {
            syncId:
                context.syncId,

            batchId:
                context.batchId,

            client:
                this.getClientIdentityMetadata(),

            operations:
                operations.map(
                    operation =>
                        this.prepareOperationForTransport(
                            operation,
                        ),
                ),

            timestamp:
                isoNow(),
        };

        const headers =
            this.buildHeaders(
                {
                    batchId:
                        context.batchId,

                    correlationId:
                        context.syncId,
                },
            );

        return this.transportRequest(
            {
                method:
                    'POST',

                endpoint,

                headers,

                body:
                    payload,

                signal:
                    context.signal,
            },
            {
                context,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Prepare operation for transport.
     * -------------------------------------------------------------------------
     */

    prepareOperationForTransport(
        operation,
    ) {

        const financial =
            isFinancialOperation(
                operation,
            );

        if (
            this.options
                .requireIdempotencyForMutations &&
            isMutationOperation(
                operation,
            ) &&
            !operation.idempotencyKey &&
            !operation.idempotencyHash
        ) {

            throw new SyncServiceError(
                'TITech mutation is missing an idempotency identifier.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_IDEMPOTENCY_REQUIRED',

                    classification:
                        RETRY_CLASSES
                            .VALIDATION,

                    retryable:
                        false,

                    operationId:
                        operation.operationId,
                },
            );
        }

        if (
            financial &&
            this.options
                .requireIdempotencyForFinancial &&
            !operation.idempotencyKey &&
            !operation.idempotencyHash
        ) {

            throw new SyncServiceError(
                'TITech financial offline operation is missing an idempotency identifier.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_FINANCIAL_IDEMPOTENCY_REQUIRED',

                    classification:
                        RETRY_CLASSES
                            .FINANCIAL,

                    retryable:
                        false,

                    operationId:
                        operation.operationId,
                },
            );
        }

        return {
            operationId:
                operation.operationId,

            operationType:
                operation.operationType,

            state:
                operation.state,

            version:
                operation.version,

            revision:
                operation.revision,

            tenantId:
                operation.tenantId,

            userId:
                operation.userId,

            clientId:
                operation.clientId,

            deviceId:
                operation.deviceId,

            idempotencyKey:
                operation.idempotencyKey,

            idempotencyHash:
                operation.idempotencyHash,

            correlationId:
                operation.correlationId,

            causationId:
                operation.causationId,

            traceId:
                operation.traceId,

            parentOperationId:
                operation.parentOperationId,

            payload:
                operation.payload,

            payloadEncrypted:
                operation.payloadEncrypted,

            payloadIntegrityHash:
                operation.payloadIntegrityHash,

            payloadFingerprint:
                operation.payloadFingerprint,

            metadata:
                operation.metadata,

            createdAt:
                operation.createdAt,

            updatedAt:
                operation.updatedAt,

            expiresAt:
                operation.expiresAt,

            isFinancial:
                Boolean(
                    operation.isFinancial,
                ),

            requiresReconciliation:
                Boolean(
                    operation
                        .requiresReconciliation,
                ),

            consistency:
                financial
                    ? CONSISTENCY_LEVELS
                        .FINANCIAL_STRONG
                    : CONSISTENCY_LEVELS
                        .EVENTUAL,

            deviceIdentity:
                this.getClientIdentityMetadata(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Process server batch response.
     * -------------------------------------------------------------------------
     */

    async processBatchResponse(
        claimed,
        response,
        result,
        context,
    ) {

        if (
            !response ||
            typeof response !==
                'object'
        ) {

            throw new SyncServiceError(
                'TITech synchronization transport returned an invalid response.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_INVALID_RESPONSE',

                    classification:
                        RETRY_CLASSES
                            .TRANSIENT,

                    retryable:
                        true,

                    batchId:
                        context.batchId,
                },
            );
        }

        const status =
            Number(
                response.status,
            );

        if (
            !response.ok
        ) {

            const classification =
                classifyStatus(
                    status,
                );

            if (
                status ===
                409
            ) {

                const conflictResult =
                    await this.processBatchConflict(
                        claimed,
                        response,
                        result,
                        context,
                    );

                mergeSummary(
                    result,
                    conflictResult,
                );

                return;
            }

            const retryable =
                isRetryableStatus(
                    status,
                );

            for (
                const claim of
                claimed
            ) {

                await this.finalizeFailedOperation(
                    claim,
                    {
                        retryable,

                        classification,

                        statusCode:
                            status,

                        errorCode:
                            `HTTP_${status}`,

                        errorMessage:
                            this.extractResponseErrorMessage(
                                response,
                            ),
                    },
                    result,
                );
            }

            if (
                status ===
                429
            ) {

                this.metrics
                    .rateLimited +=
                    1;

                const retryAfter =
                    Math.min(
                        this.options
                            .maxRetryAfterMs,
                        extractRetryAfterMs(
                            response.headers,
                        ) ||
                        computeBackoffDelay(
                            1,
                            this.options,
                        ),
                    );

                await sleep(
                    retryAfter,
                    context.signal,
                );
            }

            if (
                status ===
                401
            ) {

                this.metrics
                    .authenticationFailures +=
                    1;
            }

            if (
                status ===
                403
            ) {

                this.metrics
                    .authorizationFailures +=
                    1;
            }

            throw new SyncServiceError(
                `TITech synchronization request failed with HTTP ${status}.`,
                {
                    code:
                        'TITECH_OFFLINE_SYNC_HTTP_ERROR',

                    classification,

                    retryable,

                    statusCode:
                        status,

                    batchId:
                        context.batchId,

                    details: {
                        response:
                            this.safeRemoteError(
                                response,
                            ),
                    },
                },
            );
        }

        const body =
            response.body || {};

        const operationResults =
            Array.isArray(
                body.operations,
            )
                ? body.operations
                : (
                    Array.isArray(
                        body.results,
                    )
                        ? body.results
                        : []
                );

        if (
            operationResults.length ===
            0
        ) {

            /**
             * A successful batch without per-operation acknowledgements is
             * unsafe for exactly-once financial processing.
             */
            for (
                const claim of
                claimed
            ) {

                const financial =
                    isFinancialOperation(
                        claim.operation,
                    );

                if (
                    financial &&
                    this.options
                        .requireRemoteAckForFinancial
                ) {

                    await this.finalizeFailedOperation(
                        claim,
                        {
                            retryable:
                                true,

                            classification:
                                RETRY_CLASSES
                                    .SERVICE_UNAVAILABLE,

                            errorCode:
                                'FINANCIAL_REMOTE_ACK_REQUIRED',

                            errorMessage:
                                'Authoritative server did not return an operation acknowledgement.',
                        },
                        result,
                    );

                } else {

                    await this.finalizeSuccessfulOperation(
                        claim,
                        {
                            reconciled:
                                true,
                        },
                        result,
                    );
                }
            }

            return;
        }

        const responseByOperationId =
            new Map();

        for (
            const operationResult of
            operationResults
        ) {

            if (
                operationResult?.operationId
            ) {

                responseByOperationId.set(
                    operationResult
                        .operationId,
                    operationResult,
                );
            }
        }

        for (
            const claim of
            claimed
        ) {

            this.assertAbortNotRequested(
                context.signal,
            );

            const operationResult =
                responseByOperationId.get(
                    claim.operation
                        .operationId,
                );

            if (
                !operationResult
            ) {

                const financial =
                    isFinancialOperation(
                        claim.operation,
                    );

                if (
                    financial &&
                    this.options
                        .requireRemoteAckForFinancial
                ) {

                    await this.finalizeFailedOperation(
                        claim,
                        {
                            retryable:
                                true,

                            classification:
                                RETRY_CLASSES
                                    .SERVICE_UNAVAILABLE,

                            errorCode:
                                'FINANCIAL_OPERATION_ACK_MISSING',

                            errorMessage:
                                'Server response did not contain an acknowledgement for a financial operation.',
                        },
                        result,
                    );

                } else {

                    result.operationsSkipped +=
                        1;

                    this.metrics
                        .operationsSkipped +=
                        1;

                    await this.releaseClaimForRetry(
                        claim,
                    );
                }

                continue;
            }

            await this.processOperationResult(
                claim,
                operationResult,
                result,
                context,
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Process one acknowledged operation.
     * -------------------------------------------------------------------------
     */

    async processOperationResult(
        claim,
        operationResult,
        result,
        context,
    ) {

        const status =
            String(
                operationResult.status ||
                operationResult.result ||
                '',
            )
                .trim()
                .toLowerCase();

        if (
            [
                'success',
                'succeeded',
                'completed',
                'accepted',
                'duplicate',
                'already_processed',
                'replayed',
            ].includes(
                status,
            )
        ) {

            const financial =
                isFinancialOperation(
                    claim.operation,
                );

            const reconciled =
                operationResult.reconciled ===
                    true ||
                !financial;

            if (
                financial &&
                this.options
                    .requireReconciliationForFinancial &&
                !reconciled
            ) {

                await this.finalizeFailedOperation(
                    claim,
                    {
                        retryable:
                            true,

                        classification:
                            RETRY_CLASSES
                                .SERVICE_UNAVAILABLE,

                        errorCode:
                            'FINANCIAL_RECONCILIATION_REQUIRED',

                        errorMessage:
                            'Financial operation was acknowledged but authoritative reconciliation is incomplete.',
                    },
                    result,
                );

                return;
            }

            await this.finalizeSuccessfulOperation(
                claim,
                {
                    reconciled,

                    response:
                        operationResult,

                    duplicate:
                        [
                            'duplicate',
                            'already_processed',
                            'replayed',
                        ].includes(
                            status,
                        ),
                },
                result,
            );

            return;
        }

        if (
            status ===
            'conflict'
        ) {

            await this.persistConflict(
                claim.operation,
                operationResult,
                result,
                context,
            );

            return;
        }

        if (
            status ===
            'retry' ||
            status ===
            'retryable' ||
            operationResult.retryable ===
                true
        ) {

            await this.finalizeFailedOperation(
                claim,
                {
                    retryable:
                        true,

                    classification:
                        this.normalizeClassification(
                            operationResult
                                .classification ||
                            RETRY_CLASSES
                                .TRANSIENT,
                        ),

                    errorCode:
                        operationResult
                            .errorCode ||
                        'REMOTE_RETRYABLE_FAILURE',

                    errorMessage:
                        operationResult
                            .message ||
                        'Remote synchronization operation is retryable.',
                },
                result,
            );

            result.operationsRetried +=
                1;

            this.metrics
                .operationsRetried +=
                1;

            return;
        }

        await this.finalizeFailedOperation(
            claim,
            {
                retryable:
                    false,

                classification:
                    this.normalizeClassification(
                        operationResult
                            .classification ||
                        RETRY_CLASSES
                            .BUSINESS,
                    ),

                errorCode:
                    operationResult
                        .errorCode ||
                    'REMOTE_OPERATION_FAILED',

                errorMessage:
                    operationResult
                        .message ||
                    'Remote operation failed.',
            },
            result,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Finalize successful operation.
     * -------------------------------------------------------------------------
     */

    async finalizeSuccessfulOperation(
        claim,
        outcome,
        result,
    ) {

        const operation =
            claim.operation;

        const financial =
            isFinancialOperation(
                operation,
            );

        const reconciled =
            Boolean(
                outcome.reconciled,
            );

        const updated =
            offlineDatabase.completeOperation(
                operation.operationId,
                claim.lockToken,
                {
                    success:
                        !financial ||
                        reconciled,

                    retryable:
                        financial &&
                        !reconciled,

                    reconciled,

                    errorCode:
                        financial &&
                        !reconciled
                            ? 'FINANCIAL_RECONCILIATION_REQUIRED'
                            : null,

                    errorMessage:
                        financial &&
                        !reconciled
                            ? 'Financial operation requires authoritative reconciliation.'
                            : null,
                },
            );

        if (
            updated &&
            (
                updated.state ===
                    OPERATION_STATES
                        .SUCCEEDED ||
                updated.state ===
                    OPERATION_STATES
                        .RECONCILED
            )
        ) {

            result.operationsSucceeded +=
                1;

            this.metrics
                .operationsSucceeded +=
                1;

            if (
                reconciled
            ) {

                try {

                    await this.persistOperationAcknowledgement(
                        operation,
                        outcome.response ||
                        {},
                    );

                } catch (
                    error
                ) {

                    log(
                        'warn',
                        {
                            operationId:
                                operation
                                    .operationId,
                        },
                        'TITech operation acknowledgement persistence failed.',
                    );
                }
            }
        } else {

            result.operationsRetried +=
                1;

            this.metrics
                .operationsRetried +=
                1;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Finalize failed operation.
     * -------------------------------------------------------------------------
     */

    async finalizeFailedOperation(
        claim,
        failure,
        result,
    ) {

        const operation =
            claim.operation;

        const attempts =
            Number(
                operation.attempts ||
                0,
            );

        const retryable =
            Boolean(
                failure.retryable &&
                attempts <
                    Math.min(
                        operation.maxAttempts ||
                            this.options
                                .maxAttempts,
                        this.options
                            .maxAttempts,
                    ),
            );

        await offlineDatabase.completeOperation(
            operation.operationId,
            claim.lockToken,
            {
                success:
                    false,

                retryable,

                errorCode:
                    failure.errorCode,

                errorMessage:
                    failure.errorMessage,
            },
        );

        result.operationsFailed +=
            1;

        this.metrics
            .operationsFailed +=
            1;

        if (
            retryable
        ) {

            result.operationsRetried +=
                1;

            this.metrics
                .operationsRetried +=
                1;
        }

        if (
            failure.classification ===
            RETRY_CLASSES.NETWORK ||
            failure.classification ===
            RETRY_CLASSES.TIMEOUT ||
            failure.classification ===
            RETRY_CLASSES.SERVICE_UNAVAILABLE
        ) {

            this.metrics
                .networkFailures +=
                1;
        }

        result.errors.push({
            operationId:
                operation.operationId,

            retryable,

            classification:
                failure.classification,

            code:
                failure.errorCode,

            message:
                failure.errorMessage,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Release a claim for retry.
     * -------------------------------------------------------------------------
     */

    async releaseClaimForRetry(
        claim,
    ) {

        return offlineDatabase.completeOperation(
            claim.operation.operationId,
            claim.lockToken,
            {
                success:
                    false,

                retryable:
                    true,

                errorCode:
                    'SYNC_CLAIM_RELEASED',

                errorMessage:
                    'TITech synchronization claim was released without processing.',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Conflict processing.
     * -------------------------------------------------------------------------
     */

    async processBatchConflict(
        claimed,
        response,
        result,
        context,
    ) {

        const conflictResults =
            Array.isArray(
                response.body?.conflicts,
            )
                ? response.body.conflicts
                : [];

        const byOperationId =
            new Map();

        for (
            const conflict of
            conflictResults
        ) {

            if (
                conflict?.operationId
            ) {

                byOperationId.set(
                    conflict.operationId,
                    conflict,
                );
            }
        }

        for (
            const claim of
            claimed
        ) {

            const conflict =
                byOperationId.get(
                    claim.operation
                        .operationId,
                ) ||
                {
                    operationId:
                        claim.operation
                            .operationId,

                    conflictType:
                        'remote_conflict',

                    severity:
                        isFinancialOperation(
                            claim.operation,
                        )
                            ? 'critical'
                            : 'high',

                    message:
                        'Remote synchronization conflict.',
                };

            await this.persistConflict(
                claim.operation,
                conflict,
                result,
                context,
                claim,
            );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Persist conflict.
     * -------------------------------------------------------------------------
     */

    async persistConflict(
        operation,
        conflict,
        result,
        context,
        claim = null,
    ) {

        const financial =
            isFinancialOperation(
                operation,
            );

        const conflictRecord = {
            conflictId:
                conflict.conflictId ||
                randomId(
                    'conflict',
                ),

            operationId:
                operation.operationId,

            conflictType:
                conflict.conflictType ||
                'remote_conflict',

            severity:
                conflict.severity ||
                (
                    financial
                        ? 'critical'
                        : 'high'
                ),

            strategy:
                financial
                    ? FINANCIAL_DEFAULTS
                        .DEFAULT_CONFLICT_STRATEGY
                    : (
                        conflict.strategy ||
                        'manual'
                    ),

            localVersion:
                conflict.localVersion ??
                operation.version ??
                null,

            remoteVersion:
                conflict.remoteVersion ??
                null,

            localHash:
                operation
                    .payloadIntegrityHash ||
                null,

            remoteHash:
                conflict.remoteHash ||
                null,

            localPayload:
                operation.payload,

            remotePayload:
                conflict.remotePayload ??
                null,

            state:
                OPERATION_STATES
                    .CONFLICT,

            metadata: {
                syncId:
                    context.syncId,

                batchId:
                    context.batchId,

                financial,

                automaticResolutionAllowed:
                    financial
                        ? this.options
                            .allowAutomaticFinancialConflictResolution
                        : true,
            },
        };

        const stored =
            offlineDatabase
                .createConflict(
                    conflictRecord,
                );

        if (
            claim
        ) {

            try {

                await offlineDatabase
                    .completeOperation(
                        operation.operationId,
                        claim.lockToken,
                        {
                            success:
                                false,

                            retryable:
                                false,

                            errorCode:
                                financial
                                    ? 'FINANCIAL_CONFLICT'
                                    : 'SYNC_CONFLICT',

                            errorMessage:
                                conflict.message ||
                                'TITech synchronization conflict requires reconciliation.',
                        },
                    );

            } catch (
                error
            ) {

                result.errors.push(
                    this.toSafeError(
                        error,
                        {
                            operationId:
                                operation
                                    .operationId,
                        },
                    ),
                );
            }
        }

        result.operationsConflicted +=
            1;

        result.conflicts.push(
            stored,
        );

        this.metrics
            .operationsConflicted +=
            1;

        this.conflictCount +=
            1;

        this.emit(
            EVENTS.CONFLICT_DETECTED,
            {
                conflict:
                    stored,

                operationId:
                    operation.operationId,

                financial,
            },
        );

        if (
            this.conflictCount >=
            this.options
                .maxConflictsBeforePause
        ) {

            this.scheduleResume(
                this.options
                    .pauseDurationMs,
            );
        }

        if (
            typeof this.options
                .onConflict ===
            'function'
        ) {

            try {

                await this.options
                    .onConflict(
                        stored,
                    );

            } catch (
                error
            ) {

                log(
                    'warn',
                    {
                        conflictId:
                            stored
                                .conflictId,
                    },
                    'TITech synchronization conflict callback failed.',
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Pull remote events.
     * -------------------------------------------------------------------------
     */

    async pullRemoteEvents(
        context,
    ) {

        const result = {
            eventsPulled:
                0,

            eventsApplied:
                0,

            eventsFailed:
                0,

            errors:
                [],
        };

        const checkpoint =
            offlineDatabase
                .getCheckpoint(
                    this.options
                        .eventCheckpointName,
                );

        const cursor =
            checkpoint?.cursor ||
            0;

        const endpoint =
            this.resolveEventEndpoint();

        const headers =
            this.buildHeaders({
                correlationId:
                    context.syncId,
            });

        const response =
            await this.transportRequest(
                {
                    method:
                        'GET',

                    endpoint:
                        `${endpoint}?after=${encodeURIComponent(
                            cursor,
                        )}&limit=${encodeURIComponent(
                            this.options
                                .batchSize,
                        )}`,

                    headers,

                    signal:
                        context.signal,
                },
                {
                    context,
                },
            );

        if (
            !response.ok
        ) {

            throw new SyncServiceError(
                `TITech event synchronization pull failed with HTTP ${response.status}.`,
                {
                    code:
                        'TITECH_OFFLINE_SYNC_EVENT_PULL_FAILED',

                    classification:
                        classifyStatus(
                            response.status,
                        ),

                    retryable:
                        isRetryableStatus(
                            response.status,
                        ),

                    statusCode:
                        response.status,
                },
            );
        }

        const body =
            response.body ||
            {};

        const events =
            Array.isArray(
                body.events,
            )
                ? body.events
                : [];

        result.eventsPulled +=
            events.length;

        this.metrics.eventsPulled +=
            events.length;

        let latestCursor =
            cursor;

        for (
            const event of
            events
        ) {

            this.assertAbortNotRequested(
                context.signal,
            );

            try {

                const appended =
                    this.appendRemoteEvent(
                        event,
                    );

                result.eventsApplied +=
                    1;

                this.metrics
                    .eventsApplied +=
                    1;

                latestCursor =
                    Math.max(
                        latestCursor,
                        Number(
                            event.globalSequence ||
                            event.sequence ||
                            latestCursor,
                        ),
                    );

                this.emit(
                    EVENTS.RECONCILIATION_STARTED,
                    {
                        syncId:
                            context.syncId,

                        eventId:
                            appended
                                ?.eventId,
                    },
                );

            } catch (
                error
            ) {

                result.eventsFailed +=
                    1;

                this.metrics
                    .eventsFailed +=
                    1;

                result.errors.push(
                    this.toSafeError(
                        error,
                        {
                            eventId:
                                event.eventId,
                        },
                    ),
                );
            }
        }

        if (
            latestCursor !==
            cursor
        ) {

            offlineDatabase
                .saveCheckpoint(
                    this.options
                        .eventCheckpointName,
                    latestCursor,
                    {
                        version:
                            1,

                        metadata: {
                            syncId:
                                context.syncId,
                        },
                    },
                );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Append remote event.
     * -------------------------------------------------------------------------
     */

    appendRemoteEvent(
        event,
    ) {

        if (
            !event?.eventId
        ) {

            throw new SyncServiceError(
                'Remote TITech event is missing eventId.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_REMOTE_EVENT_INVALID',

                    classification:
                        RETRY_CLASSES
                            .VALIDATION,

                    retryable:
                        false,

                    eventId:
                        null,
                },
            );
        }

        try {

            const existing =
                eventStore.get(
                    event.eventId,
                );

            if (
                existing
            ) {

                return existing;
            }

            return eventStore.append(
                {
                    ...event,

                    eventState:
                        event.eventState ||
                        'reconciled',
                },
                {
                    allowUnencrypted:
                        !event.payloadEncrypted,
                },
            );

        } catch (
            error
        ) {

            if (
                error instanceof
                EventStoreError
            ) {

                throw error;
            }

            throw new SyncServiceError(
                'TITech remote event append failed.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_EVENT_APPEND_FAILED',

                    classification:
                        RETRY_CLASSES
                            .TRANSIENT,

                    retryable:
                        true,

                    eventId:
                        event.eventId,

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Reconcile acknowledgements/checkpoints.
     * -------------------------------------------------------------------------
     */

    async reconcileAcknowledgements(
        context,
    ) {

        const result = {
            eventsApplied:
                0,

            errors:
                [],
        };

        /**
         * Persist synchronization cursor/state as a durable checkpoint.
         */
        try {

            offlineDatabase
                .saveCheckpoint(
                    this.options
                        .operationCheckpointName,
                    context.syncId,
                    {
                        version:
                            1,

                        metadata: {
                            completedAt:
                                isoNow(),

                            state:
                                SYNC_STATES
                                    .COMPLETED,
                        },
                    },
                );

        } catch (
            error
        ) {

            result.errors.push(
                this.toSafeError(
                    error,
                ),
            );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Transport request.
     * -------------------------------------------------------------------------
     */

    async transportRequest(
        request,
        context = {},
    ) {

        const transport =
            this.resolveTransport();

        if (
            !transport
        ) {

            throw new SyncServiceError(
                'TITech offline synchronization transport is unavailable.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_TRANSPORT_UNAVAILABLE',

                    classification:
                        RETRY_CLASSES
                            .SERVICE_UNAVAILABLE,

                    retryable:
                        true,
                },
            );
        }

        const startedAt =
            nowMs();

        let response;

        try {

            response =
                await this.executeTransport(
                    transport,
                    request,
                );

        } catch (
            error
        ) {

            const classification =
                this.classifyTransportError(
                    error,
                );

            throw new SyncServiceError(
                'TITech offline synchronization transport request failed.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_TRANSPORT_FAILED',

                    classification,

                    retryable:
                        classification !==
                        RETRY_CLASSES
                            .AUTHENTICATION &&
                        classification !==
                        RETRY_CLASSES
                            .AUTHORIZATION &&
                        classification !==
                        RETRY_CLASSES
                            .VALIDATION,

                    cause:
                        error,

                    details: {
                        durationMs:
                            nowMs() -
                            startedAt,

                        method:
                            request
                                .method,

                        endpoint:
                            request
                                .endpoint,
                    },
                },
            );
        }

        const parsed =
            await parseTransportResponse(
                response,
                this.options
                    .maxResponseBytes,
            );

        if (
            parsed.status ===
            429
        ) {

            const retryAfterMs =
                Math.min(
                    this.options
                        .maxRetryAfterMs,
                    extractRetryAfterMs(
                        parsed.headers,
                    ) ||
                    computeBackoffDelay(
                        1,
                        this.options,
                    ),
                );

            parsed.retryAfterMs =
                retryAfterMs;
        }

        return parsed;
    }

    /**
     * -------------------------------------------------------------------------
     * Execute transport implementation.
     * -------------------------------------------------------------------------
     */

    async executeTransport(
        transport,
        request,
    ) {

        /**
         * Custom transport object.
         */
        if (
            typeof transport.request ===
            'function'
        ) {

            return transport.request(
                request,
            );
        }

        /**
         * Function transport.
         */
        if (
            typeof transport ===
            'function'
        ) {

            return transport(
                request,
            );
        }

        /**
         * Axios-like transport.
         */
        if (
            typeof transport.request ===
            'object' &&
            typeof transport.request
                ?.then ===
            'function'
        ) {

            return transport.request;
        }

        throw new SyncServiceError(
            'TITech synchronization transport does not expose request().',
            {
                code:
                    'TITECH_OFFLINE_SYNC_TRANSPORT_INVALID',

                classification:
                    RETRY_CLASSES
                        .SERVICE_UNAVAILABLE,

                retryable:
                    false,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve configured transport.
     * -------------------------------------------------------------------------
     */

    resolveTransport() {

        if (
            this.options.transport
        ) {

            return this.options
                .transport;
        }

        if (
            typeof this.options.request ===
            'function'
        ) {

            return {
                request:
                    this.options.request,
            };
        }

        /**
         * Native fetch is used only when an explicit endpoint is configured.
         * This keeps synchronization endpoint selection configuration-driven.
         */
        if (
            typeof globalThis.fetch ===
                'function' &&
            this.resolveOperationEndpoint()
        ) {

            return {
                request:
                    request =>
                        this.nativeFetchRequest(
                            request,
                        ),
            };
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Native fetch adapter.
     * -------------------------------------------------------------------------
     */

    async nativeFetchRequest(
        request,
    ) {

        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () =>
                    controller.abort(),
                this.options
                    .requestTimeoutMs,
            );

        timeout.unref?.();

        const onAbort =
            () =>
                controller.abort();

        request.signal?.addEventListener(
            'abort',
            onAbort,
            {
                once:
                    true,
            },
        );

        try {

            const headers =
                {
                    Accept:
                        'application/json',

                    'Content-Type':
                        'application/json',

                    ...this.options
                        .requestHeaders,

                    ...request.headers,
                };

            const body =
                request.body !==
                    undefined &&
                request.body !==
                    null
                    ? JSON.stringify(
                        request.body,
                    )
                    : undefined;

            const response =
                await fetch(
                    request.endpoint,
                    {
                        method:
                            request.method ||
                            'GET',

                        headers,

                        body,

                        signal:
                            controller
                                .signal,
                    },
                );

            return response;

        } finally {

            clearTimeout(
                timeout,
            );

            request.signal?.removeEventListener(
                'abort',
                onAbort,
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve endpoints.
     * -------------------------------------------------------------------------
     */

    resolveOperationEndpoint() {

        if (
            typeof this.options
                .endpoint ===
            'string'
        ) {

            return this.options
                .endpoint;
        }

        return DEFAULT_OPERATION_BATCH_ENDPOINT;
    }

    resolveEventEndpoint() {

        if (
            typeof this.options
                .eventEndpoint ===
            'string'
        ) {

            return this.options
                .eventEndpoint;
        }

        return DEFAULT_EVENT_BATCH_ENDPOINT;
    }

    /**
     * -------------------------------------------------------------------------
     * Headers.
     * -------------------------------------------------------------------------
     */

    buildHeaders(
        context = {},
    ) {

        const headers = {
            Accept:
                'application/json',

            'Content-Type':
                'application/json',
        };

        const identity =
            this.getClientIdentityMetadata();

        if (
            context.correlationId
        ) {

            headers[
                HTTP_HEADERS
                    .CORRELATION_ID
            ] =
                context.correlationId;
        }

        if (
            context.batchId
        ) {

            headers[
                'X-Sync-Batch-ID'
            ] =
                context.batchId;
        }

        if (
            identity.deviceId
        ) {

            headers[
                HTTP_HEADERS
                    .DEVICE_ID
            ] =
                identity.deviceId;
        }

        if (
            identity.clientId
        ) {

            headers[
                HTTP_HEADERS
                    .CLIENT_ID
            ] =
                identity.clientId;
        }

        if (
            identity.fingerprint
        ) {

            headers[
                'X-Device-Fingerprint'
            ] =
                identity.fingerprint;
        }

        return {
            ...this.options
                .requestHeaders,

            ...headers,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Client/device identity metadata.
     * -------------------------------------------------------------------------
     */

    getClientIdentityMetadata() {

        const identity =
            deviceIdentityModule
                ?.deviceIdentity;

        return {
            deviceId:
                identity?.deviceId ||
                null,

            fingerprint:
                identity
                    ?.deviceFingerprint ||
                null,

            keyId:
                identity
                    ?.keyState
                    ?.keyId ||
                null,

            clientId:
                identity
                    ?.deviceMetadata
                    ?.appVersion ||
                null,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Retry classification.
     * -------------------------------------------------------------------------
     */

    classifyTransportError(
        error,
    ) {

        const code =
            String(
                error?.code ||
                '',
            ).toUpperCase();

        if (
            RETRYABLE_NETWORK_CODES
                .includes(
                    code,
                )
        ) {

            return RETRY_CLASSES
                .NETWORK;
        }

        if (
            /timeout/i.test(
                error?.message ||
                '',
            )
        ) {

            return RETRY_CLASSES
                .TIMEOUT;
        }

        return RETRY_CLASSES
            .UNKNOWN;
    }

    normalizeClassification(
        value,
    ) {

        const normalized =
            String(
                value ||
                RETRY_CLASSES.UNKNOWN,
            )
                .trim()
                .toLowerCase();

        return Object.values(
            RETRY_CLASSES,
        ).includes(
            normalized,
        )
            ? normalized
            : RETRY_CLASSES
                .UNKNOWN;
    }

    /**
     * -------------------------------------------------------------------------
     * Response error message.
     * -------------------------------------------------------------------------
     */

    extractResponseErrorMessage(
        response,
    ) {

        const body =
            response?.body;

        if (
            typeof body ===
            'string'
        ) {

            return body.slice(
                0,
                1_024,
            );
        }

        return (
            body?.message ||
            body?.error?.message ||
            body?.code ||
            `HTTP ${response?.status || 0}`
        );
    }

    safeRemoteError(
        response,
    ) {

        return {
            status:
                response?.status ||
                null,

            code:
                response?.body
                    ?.code ||
                null,

            message:
                this.extractResponseErrorMessage(
                    response,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Persist acknowledgement metadata.
     * -------------------------------------------------------------------------
     */

    async persistOperationAcknowledgement(
        operation,
        response,
    ) {

        try {

            return offlineDatabase
                .appendAuditEvent(
                    {
                        operationId:
                            operation
                                .operationId,

                        eventType:
                            'offline.operation.acknowledged',

                        actorId:
                            operation
                                .userId,

                        tenantId:
                            operation
                                .tenantId,

                        correlationId:
                            operation
                                .correlationId,

                        payload: {
                            operationId:
                                operation
                                    .operationId,

                            response:
                                sanitizeAcknowledgement(
                                    response,
                                ),

                            recordedAt:
                                isoNow(),
                        },
                    },
                );

        } catch (
            error
        ) {

            throw new SyncServiceError(
                'TITech operation acknowledgement audit persistence failed.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_ACK_AUDIT_FAILED',

                    classification:
                        RETRY_CLASSES
                            .TRANSIENT,

                    retryable:
                        true,

                    operationId:
                        operation
                            .operationId,

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Deadline / abort protection.
     * -------------------------------------------------------------------------
     */

    assertAbortNotRequested(
        signal,
    ) {

        if (
            signal?.aborted ||
            this.stopRequested
        ) {

            throw new SyncServiceError(
                'TITech synchronization operation was cancelled.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_ABORTED',

                    classification:
                        RETRY_CLASSES
                            .TRANSIENT,

                    retryable:
                        true,
                },
            );
        }
    }

    assertDeadline(
        deadline,
        signal,
    ) {

        this.assertAbortNotRequested(
            signal,
        );

        if (
            Number.isFinite(
                deadline,
            ) &&
            nowMs() >=
            deadline
        ) {

            throw new SyncServiceError(
                'TITech synchronization maximum duration was exceeded.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_DEADLINE_EXCEEDED',

                    classification:
                        RETRY_CLASSES
                            .TIMEOUT,

                    retryable:
                        true,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Event emission.
     * -------------------------------------------------------------------------
     */

    emit(
        eventName,
        payload,
    ) {

        if (
            typeof this.options
                .onEvent ===
            'function'
        ) {

            try {

                this.options
                    .onEvent(
                        eventName,
                        payload,
                    );

            } catch (
                error
            ) {

                log(
                    'warn',
                    {
                        eventName,
                    },
                    `TITech sync event callback failed: ${
                        error.message
                    }`,
                );
            }
        }

        log(
            'debug',
            {
                event:
                    eventName,

                syncId:
                    payload?.syncId,

                operationId:
                    payload?.operationId,

                eventId:
                    payload?.eventId,
            },
            `TITech offline synchronization event: ${eventName}`,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Background error handler.
     * -------------------------------------------------------------------------
     */

    handleBackgroundError(
        error,
    ) {

        this.lastError =
            error;

        if (
            typeof this.options
                .onError ===
            'function'
        ) {

            try {

                this.options
                    .onError(
                        error,
                    );

            } catch {
                // Never throw from scheduler callback.
            }
        }

        log(
            'error',
            {
                code:
                    error?.code,

                classification:
                    error?.classification,

                retryable:
                    error?.retryable,
            },
            'TITech background synchronization failed.',
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe error serialization.
     * -------------------------------------------------------------------------
     */

    toSafeError(
        error,
        context = {},
    ) {

        return {
            name:
                error?.name ||
                'Error',

            code:
                error?.code ||
                'TITECH_OFFLINE_SYNC_ERROR',

            classification:
                error?.classification ||
                null,

            retryable:
                Boolean(
                    error?.retryable,
                ),

            statusCode:
                error?.statusCode ??
                null,

            operationId:
                context.operationId ||
                error?.operationId ||
                null,

            eventId:
                context.eventId ||
                error?.eventId ||
                null,

            message:
                String(
                    error?.message ||
                    'Synchronization error.',
                ).slice(
                    0,
                    1_024,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return Object.freeze({
            component:
                COMPONENT,

            state:
                this.state,

            currentSyncId:
                this.currentSyncId,

            currentBatchId:
                this.currentBatchId,

            startedAt:
                this.startedAt,

            lastRunAt:
                this.lastRunAt,

            lastSuccessAt:
                this.lastSuccessAt,

            lastFailureAt:
                this.lastFailureAt,

            failureCount:
                this.failureCount,

            conflictCount:
                this.conflictCount,

            metrics:
                {
                    ...this.metrics,
                },

            lastResult:
                this.lastResult
                    ? sanitizeSyncResult(
                        this.lastResult,
                    )
                    : null,

            lastError:
                this.lastError
                    ? this.toSafeError(
                        this.lastError,
                    )
                    : null,

            timestamp:
                isoNow(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const ready =
            this.state ===
                SERVICE_STATES.READY ||
            this.state ===
                SERVICE_STATES.RUNNING;

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            state:
                this.state,

            timestamp:
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const ready =
            this.state ===
                SERVICE_STATES.READY ||
            this.state ===
                SERVICE_STATES.RUNNING;

        const unhealthy =
            this.state ===
                SERVICE_STATES.FAILED;

        return {
            status:
                unhealthy
                    ? 'unhealthy'
                    : ready
                        ? 'healthy'
                        : 'degraded',

            healthy:
                !unhealthy,

            ready,

            state:
                this.state,

            failureCount:
                this.failureCount,

            conflictCount:
                this.conflictCount,

            lastSuccessAt:
                this.lastSuccessAt,

            lastFailureAt:
                this.lastFailureAt,

            timestamp:
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Reset runtime state.
     * -------------------------------------------------------------------------
     */

    reset() {

        if (
            this.runPromise
        ) {

            throw new SyncServiceError(
                'TITech synchronization service cannot be reset while a sync run is active.',
                {
                    code:
                        'TITECH_OFFLINE_SYNC_RESET_NOT_ALLOWED',
                },
            );
        }

        this.stopRequested =
            false;

        this.state =
            SERVICE_STATES.CREATED;

        this.startedAt =
            null;

        this.lastRunAt =
            null;

        this.lastSuccessAt =
            null;

        this.lastFailureAt =
            null;

        this.lastError =
            null;

        this.lastResult =
            null;

        this.currentSyncId =
            null;

        this.currentBatchId =
            null;

        this.failureCount =
            0;

        this.conflictCount =
            0;

        this.metrics =
            {
                syncRuns:
                    0,

                successfulRuns:
                    0,

                failedRuns:
                    0,

                partialRuns:
                    0,

                operationsSelected:
                    0,

                operationsSent:
                    0,

                operationsSucceeded:
                    0,

                operationsFailed:
                    0,

                operationsRetried:
                    0,

                operationsConflicted:
                    0,

                operationsSkipped:
                    0,

                eventsPulled:
                    0,

                eventsApplied:
                    0,

                eventsFailed:
                    0,

                batches:
                    0,

                networkFailures:
                    0,

                rateLimited:
                    0,

                authenticationFailures:
                    0,

                authorizationFailures:
                    0,
            };

        return this;
    }
}

/**
 * =============================================================================
 * Result helpers
 * =============================================================================
 */

function mergeSummary(
    target,
    source,
) {

    if (
        !target ||
        !source
    ) {

        return target;
    }

    const numericFields = [
        'batches',
        'operationsSelected',
        'operationsSent',
        'operationsSucceeded',
        'operationsFailed',
        'operationsRetried',
        'operationsConflicted',
        'operationsSkipped',
        'eventsPulled',
        'eventsApplied',
        'eventsFailed',
    ];

    for (
        const field of
        numericFields
    ) {

        if (
            Number.isFinite(
                source[field],
            )
        ) {

            target[field] =
                Number(
                    target[field] ||
                    0,
                ) +
                Number(
                    source[field],
                );
        }
    }

    if (
        Array.isArray(
            source.conflicts,
        )
    ) {

        target.conflicts =
            [
                ...(target.conflicts || []),
                ...source.conflicts,
            ];
    }

    if (
        Array.isArray(
            source.errors,
        )
    ) {

        target.errors =
            [
                ...(target.errors || []),
                ...source.errors,
            ];
    }

    return target;
}

function sanitizeAcknowledgement(
    value,
) {

    if (
        value ===
        null ||
        value ===
        undefined
    ) {

        return null;
    }

    if (
        typeof value !==
        'object'
    ) {

        return String(
            value,
        ).slice(
            0,
            1_024,
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

        if (
            /token|secret|password|authorization|private.?key|credential/i.test(
                key,
            )
        ) {

            result[key] =
                '[REDACTED]';

            continue;
        }

        if (
            typeof item ===
            'object' &&
            item !==
            null
        ) {

            result[key] =
                sanitizeAcknowledgement(
                    item,
                );

        } else {

            result[key] =
                item;
        }
    }

    return result;
}

function sanitizeSyncResult(
    result,
) {

    return {
        syncId:
            result.syncId ||
            null,

        status:
            result.status ||
            null,

        operationsSelected:
            result.operationsSelected ||
            0,

        operationsSent:
            result.operationsSent ||
            0,

        operationsSucceeded:
            result.operationsSucceeded ||
            0,

        operationsFailed:
            result.operationsFailed ||
            0,

        operationsRetried:
            result.operationsRetried ||
            0,

        operationsConflicted:
            result.operationsConflicted ||
            0,

        operationsSkipped:
            result.operationsSkipped ||
            0,

        eventsPulled:
            result.eventsPulled ||
            0,

        eventsApplied:
            result.eventsApplied ||
            0,

        eventsFailed:
            result.eventsFailed ||
            0,

        durationMs:
            result.durationMs ||
            null,

        conflicts:
            Array.isArray(
                result.conflicts,
            )
                ? result.conflicts.map(
                    conflict =>
                        ({
                            conflictId:
                                conflict
                                    ?.conflictId ||
                                null,

                            operationId:
                                conflict
                                    ?.operationId ||
                                null,

                            conflictType:
                                conflict
                                    ?.conflictType ||
                                null,

                            severity:
                                conflict
                                    ?.severity ||
                                null,

                            strategy:
                                conflict
                                    ?.strategy ||
                                null,
                        }),
                )
                : [],

        errors:
            Array.isArray(
                result.errors,
            )
                ? result.errors.map(
                    error =>
                        ({
                            code:
                                error
                                    ?.code ||
                                null,

                            classification:
                                error
                                    ?.classification ||
                                null,

                            retryable:
                                Boolean(
                                    error
                                        ?.retryable,
                                ),

                            operationId:
                                error
                                    ?.operationId ||
                                null,

                            eventId:
                                error
                                    ?.eventId ||
                                null,

                            message:
                                error
                                    ?.message ||
                                null,
                        }),
                )
                : [],
    };
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const syncService =
    new SyncService();

/**
 * =============================================================================
 * Convenience API
 * ============================================================================= */

function initialize(
    options = {},
) {

    if (
        options &&
        Object.keys(
            options,
        ).length
    ) {

        /**
         * Custom synchronization policies should use:
         *
         *   new SyncService(options)
         *
         * The singleton intentionally retains its construction-time policy.
         */
    }

    return syncService.initialize();
}

function start() {

    return syncService.start();
}

function stop() {

    return syncService.stop();
}

function run(
    options,
) {

    return syncService.run(
        options,
    );
}

function pause(
    reason,
) {

    return syncService.pause(
        reason,
    );
}

function resume() {

    return syncService.resume();
}

function snapshot() {

    return syncService.snapshot();
}

function readiness() {

    return syncService.readiness();
}

function health() {

    return syncService.health();
}

function reset() {

    return syncService.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Metadata.
         */
        COMPONENT,

        DEFAULTS,

        SERVICE_STATES,

        RETRYABLE_NETWORK_CODES,

        DEFAULT_OPERATION_BATCH_ENDPOINT,

        DEFAULT_EVENT_BATCH_ENDPOINT,

        /**
         * Error/service classes.
         */
        SyncServiceError,

        SyncService,

        syncService,

        /**
         * Lifecycle.
         */
        initialize,

        start,

        stop,

        pause,

        resume,

        run,

        reset,

        /**
         * Runtime state.
         */
        snapshot,

        readiness,

        health,

        /**
         * Pure helpers.
         */
        computeBackoffDelay,

        classifyStatus,

        isRetryableStatus,

        extractRetryAfterMs,

        isFinancialOperation,

        mergeSummary,
    });