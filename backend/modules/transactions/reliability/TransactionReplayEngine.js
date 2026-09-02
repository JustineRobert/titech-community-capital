'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Replay Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionReplayEngine.js
 *
 * Purpose:
 *   Provides controlled, observable and idempotent replay of persisted
 *   transaction events.
 *
 * Responsibilities:
 *   - Retrieve persisted transaction events
 *   - Validate replay requests
 *   - Enforce replay limits
 *   - Preserve transaction/correlation identity
 *   - Support bounded concurrent replay
 *   - Support dry-run execution
 *   - Prevent accidental duplicate replay
 *   - Support retry with exponential backoff
 *   - Provide per-event result isolation
 *   - Emit metrics
 *   - Integrate with tracing
 *   - Provide structured logging
 *   - Support tenant-aware replay
 *   - Maintain replay statistics
 *
 * Design principles:
 *   - No business logic
 *   - No direct database implementation
 *   - No direct event transport implementation
 *   - Repository and publisher are injected dependencies
 *   - Replay failures do not abort unrelated events
 *   - Idempotency is enforced where repository capabilities permit it
 *
 * =============================================================================
 */

const crypto = require('crypto');

const DEFAULTS = Object.freeze({
    maxEventsPerReplay: 1000,

    concurrency: 5,

    retryAttempts: 3,

    retryBaseDelayMs: 250,

    retryMaxDelayMs: 5000,

    operationTimeoutMs: 30000,

    source: 'transaction-replay-engine',

    dryRun: false,

    stopOnFatalError: false,

    validateEvents: true,

    enableMetrics: true,

    enableTracing: true,

    enableLogging: true
});

const REPLAY_STATUS = Object.freeze({
    SUCCESS: 'SUCCESS',

    FAILED: 'FAILED',

    SKIPPED: 'SKIPPED',

    DRY_RUN: 'DRY_RUN'
});

const REPLAY_REASON = Object.freeze({
    EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',

    INVALID_EVENT: 'INVALID_EVENT',

    ALREADY_REPLAYED: 'ALREADY_REPLAYED',

    PUBLISH_FAILED: 'PUBLISH_FAILED',

    TIMEOUT: 'TIMEOUT',

    DRY_RUN: 'DRY_RUN',

    INVALID_REQUEST: 'INVALID_REQUEST'
});

class TransactionReplayEngine {
    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {
        this.repository = options.repository;

        this.publisher = options.publisher;

        this.logger = options.logger || console;

        this.metrics = options.metrics || null;

        this.tracer = options.tracer || null;

        this.config = Object.freeze({
            ...DEFAULTS,
            ...(options.config || {})
        });

        this.identity = Object.freeze({
            engineId:
                options.engineId ||
                `transaction-replay-${process.pid}-${Date.now()}-${crypto
                    .randomBytes(4)
                    .toString('hex')}`,

            service:
                process.env.SERVICE_NAME ||
                'transaction-service',

            environment:
                process.env.NODE_ENV ||
                'development',

            hostname:
                process.env.HOSTNAME ||
                'localhost',

            processId:
                process.pid
        });

        this.running = false;

        this.activeReplays = 0;

        this.statistics = {
            requested: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            dryRun: 0,
            retries: 0,
            startedAt: null,
            lastReplayAt: null,
            lastError: null
        };

        this.validateDependencies();

        this.logInfo(
            'TransactionReplayEngine initialized',
            {
                engineId: this.identity.engineId,
                concurrency: this.config.concurrency,
                maxEventsPerReplay:
                    this.config.maxEventsPerReplay
            }
        );
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {
        if (!this.repository) {
            throw new Error(
                'TransactionReplayEngine requires a repository.'
            );
        }

        if (
            typeof this.repository.findById !== 'function'
        ) {
            throw new Error(
                'TransactionReplayEngine repository must implement findById().'
            );
        }

        if (!this.publisher) {
            throw new Error(
                'TransactionReplayEngine requires a publisher.'
            );
        }

        if (
            typeof this.publisher.publishRecord !== 'function'
        ) {
            throw new Error(
                'TransactionReplayEngine publisher must implement publishRecord().'
            );
        }
    }

    /**
     * =========================================================================
     * Main Replay Entry Point
     * =========================================================================
     *
     * Backwards compatible:
     *
     *   replay(eventIds)
     *
     * Extended:
     *
     *   replay(eventIds, options)
     */

    async replay(eventIds = [], options = {}) {
        const startedAt = Date.now();

        const request = this.normalizeReplayRequest(
            eventIds,
            options
        );

        this.statistics.requested += request.eventIds.length;

        this.statistics.startedAt =
            this.statistics.startedAt || new Date();

        this.statistics.lastReplayAt =
            new Date();

        this.activeReplays++;

        this.running = true;

        const replayId = crypto.randomUUID();

        const context = {
            replayId,

            engineId:
                this.identity.engineId,

            tenantId:
                request.tenantId || null,

            correlationId:
                request.correlationId,

            source:
                request.source,

            dryRun:
                request.dryRun,

            startedAt:
                new Date()
        };

        this.logInfo(
            'Transaction replay started',
            {
                replayId,
                eventCount: request.eventIds.length,
                tenantId: request.tenantId || null,
                dryRun: request.dryRun
            }
        );

        this.metricIncrement(
            'transaction.replay.started'
        );

        const span = this.startSpan(
            'transaction.replay',
            context
        );

        try {
            const results =
                await this.executeReplay(
                    request,
                    context
                );

            const summary =
                this.buildReplaySummary(
                    results,
                    context,
                    startedAt
                );

            this.recordStatistics(
                results
            );

            this.metricReplaySummary(
                summary
            );

            this.logInfo(
                'Transaction replay completed',
                {
                    replayId,
                    total:
                        summary.total,
                    succeeded:
                        summary.succeeded,
                    failed:
                        summary.failed,
                    skipped:
                        summary.skipped,
                    durationMs:
                        summary.durationMs
                }
            );

            return this.formatReplayResponse(
                results,
                summary,
                request
            );
        }
        catch (error) {
            this.statistics.lastError = {
                message: error.message,
                code:
                    error.code ||
                    'TRANSACTION_REPLAY_FAILED',
                timestamp:
                    new Date()
            };

            this.metricIncrement(
                'transaction.replay.failed'
            );

            this.logError(
                'Transaction replay execution failed',
                {
                    replayId,
                    error
                }
            );

            throw this.normalizeReplayError(
                error,
                context
            );
        }
        finally {
            this.finishSpan(
                span,
                context
            );

            this.activeReplays = Math.max(
                0,
                this.activeReplays - 1
            );

            if (this.activeReplays === 0) {
                this.running = false;
            }
        }
    }

    /**
     * =========================================================================
     * Request Normalization
     * =========================================================================
     */

    normalizeReplayRequest(
        eventIds,
        options
    ) {
        if (!Array.isArray(eventIds)) {
            throw this.createReplayError(
                'eventIds must be an array.',
                'INVALID_REPLAY_REQUEST'
            );
        }

        const normalizedIds =
            eventIds
                .filter(
                    id =>
                        id !== null &&
                        id !== undefined &&
                        String(id).trim() !== ''
                )
                .map(
                    id => String(id).trim()
                );

        const uniqueIds =
            [...new Set(normalizedIds)];

        if (
            uniqueIds.length >
            this.config.maxEventsPerReplay
        ) {
            throw this.createReplayError(
                `Replay request exceeds maximum event limit of ${this.config.maxEventsPerReplay}.`,
                'REPLAY_LIMIT_EXCEEDED'
            );
        }

        const concurrency =
            this.normalizePositiveInteger(
                options.concurrency,
                this.config.concurrency
            );

        const retryAttempts =
            this.normalizeNonNegativeInteger(
                options.retryAttempts,
                this.config.retryAttempts
            );

        const retryBaseDelayMs =
            this.normalizePositiveInteger(
                options.retryBaseDelayMs,
                this.config.retryBaseDelayMs
            );

        const retryMaxDelayMs =
            this.normalizePositiveInteger(
                options.retryMaxDelayMs,
                this.config.retryMaxDelayMs
            );

        return Object.freeze({
            eventIds:
                uniqueIds,

            tenantId:
                options.tenantId || null,

            correlationId:
                options.correlationId ||
                crypto.randomUUID(),

            source:
                options.source ||
                this.config.source,

            concurrency,

            retryAttempts,

            retryBaseDelayMs,

            retryMaxDelayMs,

            dryRun:
                options.dryRun ??
                this.config.dryRun,

            stopOnFatalError:
                options.stopOnFatalError ??
                this.config.stopOnFatalError,

            validateEvents:
                options.validateEvents ??
                this.config.validateEvents,

            operationTimeoutMs:
                this.normalizePositiveInteger(
                    options.operationTimeoutMs,
                    this.config.operationTimeoutMs
                ),

            metadata:
                Object.freeze({
                    ...(options.metadata || {})
                })
        });
    }

    /**
     * =========================================================================
     * Replay Execution
     * =========================================================================
     */

    async executeReplay(
        request,
        context
    ) {
        if (request.eventIds.length === 0) {
            return [];
        }

        const results = [];

        let cursor = 0;

        const worker = async () => {
            while (true) {
                const index = cursor++;

                if (
                    index >=
                    request.eventIds.length
                ) {
                    return;
                }

                const eventId =
                    request.eventIds[index];

                let result;

                try {
                    result =
                        await this.replaySingleEvent(
                            eventId,
                            request,
                            context
                        );
                }
                catch (error) {
                    result =
                        this.createFailedResult(
                            eventId,
                            error,
                            context
                        );

                    if (
                        request.stopOnFatalError &&
                        this.isFatalError(error)
                    ) {
                        throw error;
                    }
                }

                results[index] = result;
            }
        };

        const workerCount =
            Math.min(
                request.concurrency,
                request.eventIds.length
            );

        await Promise.all(
            Array.from(
                {
                    length: workerCount
                },
                () => worker()
            )
        );

        return results;
    }

    /**
     * =========================================================================
     * Single Event Replay
     * =========================================================================
     */

    async replaySingleEvent(
        eventId,
        request,
        context
    ) {
        const eventStartedAt =
            Date.now();

        const eventContext = {
            ...context,

            eventId,

            correlationId:
                request.correlationId,

            tenantId:
                request.tenantId
        };

        this.metricIncrement(
            'transaction.replay.event.started'
        );

        const span = this.startSpan(
            'transaction.replay.event',
            eventContext
        );

        try {
            const event =
                await this.findEvent(
                    eventId
                );

            if (!event) {
                this.statistics.skipped++;

                this.metricIncrement(
                    'transaction.replay.event.not_found'
                );

                return {
                    eventId,

                    status:
                        REPLAY_STATUS.SKIPPED,

                    reason:
                        REPLAY_REASON.EVENT_NOT_FOUND,

                    replayId:
                        context.replayId,

                    durationMs:
                        Date.now() -
                        eventStartedAt
                };
            }

            if (
                request.validateEvents
            ) {
                this.validateEvent(
                    event,
                    eventId,
                    request
                );
            }

            if (
                request.tenantId &&
                !this.validateTenantOwnership(
                    event,
                    request.tenantId
                )
            ) {
                throw this.createReplayError(
                    'Event does not belong to requested tenant.',
                    'TENANT_MISMATCH'
                );
            }

            if (
                await this.hasAlreadyBeenReplayed(
                    event
                )
            ) {
                this.statistics.skipped++;

                this.metricIncrement(
                    'transaction.replay.event.duplicate'
                );

                return {
                    eventId,

                    status:
                        REPLAY_STATUS.SKIPPED,

                    reason:
                        REPLAY_REASON.ALREADY_REPLAYED,

                    replayId:
                        context.replayId,

                    durationMs:
                        Date.now() -
                        eventStartedAt
                };
            }

            if (
                request.dryRun
            ) {
                this.statistics.dryRun++;

                this.metricIncrement(
                    'transaction.replay.event.dry_run'
                );

                return {
                    eventId,

                    status:
                        REPLAY_STATUS.DRY_RUN,

                    reason:
                        REPLAY_REASON.DRY_RUN,

                    replayId:
                        context.replayId,

                    eventType:
                        event.eventType ||
                        event.type ||
                        null,

                    transactionId:
                        event.transactionId ||
                        null,

                    durationMs:
                        Date.now() -
                        eventStartedAt
                };
            }

            const replayEnvelope =
                this.createReplayEnvelope(
                    event,
                    eventContext
                );

            const publishResult =
                await this.publishWithRetry(
                    replayEnvelope,
                    request,
                    eventContext
                );

            await this.markReplayCompleted(
                event,
                replayEnvelope,
                publishResult
            );

            this.statistics.succeeded++;

            this.metricIncrement(
                'transaction.replay.event.success'
            );

            return {
                eventId,

                status:
                    REPLAY_STATUS.SUCCESS,

                replayId:
                    context.replayId,

                transactionId:
                    event.transactionId ||
                    null,

                correlationId:
                    eventContext.correlationId,

                attempts:
                    publishResult.attempts,

                publisherResult:
                    publishResult.result,

                durationMs:
                    Date.now() -
                    eventStartedAt
            };
        }
        catch (error) {
            this.statistics.failed++;

            this.metricIncrement(
                'transaction.replay.event.failed'
            );

            this.statistics.lastError = {
                eventId,

                message:
                    error.message,

                code:
                    error.code ||
                    'REPLAY_EVENT_FAILED',

                timestamp:
                    new Date()
            };

            this.logError(
                'Transaction event replay failed',
                {
                    eventId,
                    replayId:
                        context.replayId,
                    error
                }
            );

            return this.createFailedResult(
                eventId,
                error,
                context,
                eventStartedAt
            );
        }
        finally {
            this.finishSpan(
                span,
                eventContext
            );

            this.metricObserve(
                'transaction.replay.event.duration_ms',
                Date.now() -
                    eventStartedAt
            );
        }
    }

    /**
     * =========================================================================
     * Repository Lookup
     * =========================================================================
     */

    async findEvent(eventId) {
        return this.withTimeout(
            this.repository.findById(
                eventId
            ),
            this.config.operationTimeoutMs,
            'Transaction event lookup timed out.'
        );
    }

    /**
     * =========================================================================
     * Event Validation
     * =========================================================================
     */

    validateEvent(
        event,
        eventId,
        request
    ) {
        if (!event) {
            throw this.createReplayError(
                'Transaction event is missing.',
                REPLAY_REASON.INVALID_EVENT
            );
        }

        const transactionId =
            event.transactionId;

        const eventType =
            event.eventType ||
            event.type;

        if (!transactionId) {
            throw this.createReplayError(
                `Event ${eventId} does not contain transactionId.`,
                REPLAY_REASON.INVALID_EVENT
            );
        }

        if (!eventType) {
            throw this.createReplayError(
                `Event ${eventId} does not contain eventType.`,
                REPLAY_REASON.INVALID_EVENT
            );
        }

        if (
            request.tenantId &&
            !event.tenantId
        ) {
            throw this.createReplayError(
                `Event ${eventId} does not contain tenantId.`,
                'TENANT_CONTEXT_MISSING'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Tenant Isolation
     * =========================================================================
     */

    validateTenantOwnership(
        event,
        tenantId
    ) {
        if (!tenantId) {
            return true;
        }

        return (
            String(event.tenantId) ===
            String(tenantId)
        );
    }

    /**
     * =========================================================================
     * Idempotency Detection
     * =========================================================================
     */

    async hasAlreadyBeenReplayed(
        event
    ) {
        if (
            typeof this.repository.hasBeenReplayed ===
            'function'
        ) {
            return Boolean(
                await this.repository.hasBeenReplayed(
                    this.getEventIdentity(event)
                )
            );
        }

        if (
            typeof this.repository.isReplayed ===
            'function'
        ) {
            return Boolean(
                await this.repository.isReplayed(
                    this.getEventIdentity(event)
                )
            );
        }

        if (
            event.replayed === true ||
            event.replayCompleted === true
        ) {
            return true;
        }

        return false;
    }

    /**
     * =========================================================================
     * Event Identity
     * =========================================================================
     */

    getEventIdentity(event) {
        return (
            event.eventId ||
            event.id ||
            event._id ||
            event.transactionEventId
        );
    }

    /**
     * =========================================================================
     * Replay Envelope
     * =========================================================================
     */

    createReplayEnvelope(
        event,
        context
    ) {
        return {
            ...event,

            replay: true,

            replayId:
                context.replayId,

            replayedAt:
                new Date(),

            replaySource:
                this.identity.engineId,

            replayContext: {
                transactionId:
                    event.transactionId ||
                    null,

                correlationId:
                    context.correlationId,

                tenantId:
                    event.tenantId ||
                    context.tenantId ||
                    null,

                source:
                    context.source
            }
        };
    }

    /**
     * =========================================================================
     * Publisher Retry
     * =========================================================================
     */

    async publishWithRetry(
        envelope,
        request,
        context
    ) {
        let attempt = 0;

        let lastError = null;

        while (
            attempt <=
            request.retryAttempts
        ) {
            attempt++;

            try {
                this.metricIncrement(
                    'transaction.replay.publish.attempt'
                );

                const result =
                    await this.withTimeout(
                        this.publisher.publishRecord(
                            envelope
                        ),
                        request.operationTimeoutMs,
                        'Transaction event publication timed out.'
                    );

                return {
                    result,

                    attempts:
                        attempt
                };
            }
            catch (error) {
                lastError = error;

                if (
                    attempt >
                    request.retryAttempts
                ) {
                    break;
                }

                const delay =
                    this.calculateBackoffDelay(
                        attempt,
                        request.retryBaseDelayMs,
                        request.retryMaxDelayMs
                    );

                this.statistics.retries++;

                this.metricIncrement(
                    'transaction.replay.publish.retry'
                );

                this.logWarn(
                    'Transaction replay publication retry scheduled',
                    {
                        replayId:
                            context.replayId,

                        eventId:
                            context.eventId,

                        attempt,

                        nextAttempt:
                            attempt + 1,

                        delayMs:
                            delay,

                        error:
                            error.message
                    }
                );

                await this.sleep(
                    delay
                );
            }
        }

        const error =
            this.createReplayError(
                lastError?.message ||
                    'Transaction event publication failed.',
                REPLAY_REASON.PUBLISH_FAILED
            );

        error.cause = lastError;

        throw error;
    }

    /**
     * =========================================================================
     * Mark Replay Completed
     * =========================================================================
     */

    async markReplayCompleted(
        event,
        envelope,
        publishResult
    ) {
        if (
            typeof this.repository.markReplayed ===
            'function'
        ) {
            await this.repository.markReplayed(
                this.getEventIdentity(event),
                {
                    replayId:
                        envelope.replayId,

                    replayedAt:
                        new Date(),

                    attempts:
                        publishResult.attempts
                }
            );

            return;
        }

        if (
            typeof this.repository.markReplayCompleted ===
            'function'
        ) {
            await this.repository.markReplayCompleted(
                this.getEventIdentity(event),
                {
                    replayId:
                        envelope.replayId,

                    replayedAt:
                        new Date(),

                    attempts:
                        publishResult.attempts
                }
            );
        }
    }

    /**
     * =========================================================================
     * Replay Summary
     * =========================================================================
     */

    buildReplaySummary(
        results,
        context,
        startedAt
    ) {
        const summary = {
            replayId:
                context.replayId,

            total:
                results.length,

            succeeded:
                results.filter(
                    result =>
                        result?.status ===
                        REPLAY_STATUS.SUCCESS
                ).length,

            failed:
                results.filter(
                    result =>
                        result?.status ===
                        REPLAY_STATUS.FAILED
                ).length,

            skipped:
                results.filter(
                    result =>
                        result?.status ===
                        REPLAY_STATUS.SKIPPED
                ).length,

            dryRun:
                results.filter(
                    result =>
                        result?.status ===
                        REPLAY_STATUS.DRY_RUN
                ).length,

            durationMs:
                Date.now() -
                startedAt,

            completedAt:
                new Date()
        };

        summary.successRate =
            summary.total > 0
                ? Number(
                    (
                        summary.succeeded /
                        summary.total
                    ).toFixed(4)
                )
                : 1;

        summary.failureRate =
            summary.total > 0
                ? Number(
                    (
                        summary.failed /
                        summary.total
                    ).toFixed(4)
                )
                : 0;

        return summary;
    }

    /**
     * =========================================================================
     * Response Formatting
     * =========================================================================
     *
     * The `results` array is retained as the first-class replay result so
     * existing callers expecting an array can still consume the result.
     */

    formatReplayResponse(
        results,
        summary,
        request
    ) {
        if (
            request.returnSummary === false
        ) {
            return results;
        }

        /*
         * Preserve historical behavior:
         *
         * replay([...]) -> results array
         *
         * Additional summary information is exposed through the non-enumerable
         * property where possible so existing array consumers remain compatible.
         */

        try {
            Object.defineProperty(
                results,
                'summary',
                {
                    value:
                        summary,

                    enumerable:
                        false,

                    configurable:
                        true
                }
            );

            Object.defineProperty(
                results,
                'replayId',
                {
                    value:
                        summary.replayId,

                    enumerable:
                        false,

                    configurable:
                        true
                }
            );
        }
        catch (error) {
            this.logWarn(
                'Unable to attach replay metadata to result array',
                {
                    error:
                        error.message
                }
            );
        }

        return results;
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    recordStatistics(
        results
    ) {
        this.statistics.processed +=
            results.length;
    }

    getStatistics() {
        return {
            ...this.statistics,

            activeReplays:
                this.activeReplays,

            running:
                this.running,

            engineId:
                this.identity.engineId
        };
    }

    resetStatistics() {
        this.statistics = {
            requested: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            dryRun: 0,
            retries: 0,
            startedAt: null,
            lastReplayAt: null,
            lastError: null
        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    getHealth() {
        return {
            status:
                this.repository &&
                this.publisher
                    ? 'READY'
                    : 'DEGRADED',

            ready:
                Boolean(
                    this.repository &&
                    this.publisher
                ),

            running:
                this.running,

            activeReplays:
                this.activeReplays,

            engineId:
                this.identity.engineId,

            statistics:
                this.getStatistics()
        };
    }

    async isReady() {
        return Boolean(
            this.repository &&
            this.publisher
        );
    }

    /**
     * =========================================================================
     * Backoff
     * =========================================================================
     */

    calculateBackoffDelay(
        attempt,
        baseDelay,
        maxDelay
    ) {
        const exponential =
            baseDelay *
            Math.pow(
                2,
                Math.max(
                    0,
                    attempt - 1
                )
            );

        const jitter =
            Math.floor(
                Math.random() *
                Math.max(
                    1,
                    Math.floor(
                        exponential * 0.25
                    )
                )
            );

        return Math.min(
            maxDelay,
            exponential + jitter
        );
    }

    /**
     * =========================================================================
     * Timeout Utility
     * =========================================================================
     */

    async withTimeout(
        promise,
        timeoutMs,
        message
    ) {
        let timer;

        const timeoutPromise =
            new Promise(
                (_, reject) => {
                    timer = setTimeout(
                        () => {
                            const error =
                                new Error(
                                    message
                                );

                            error.code =
                                'TRANSACTION_REPLAY_TIMEOUT';

                            reject(error);
                        },
                        timeoutMs
                    );
                }
            );

        try {
            return await Promise.race([
                promise,
                timeoutPromise
            ]);
        }
        finally {
            clearTimeout(timer);
        }
    }

    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        milliseconds
    ) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createReplayError(
        message,
        code = 'TRANSACTION_REPLAY_FAILED'
    ) {
        const error =
            new Error(message);

        error.code = code;

        error.engineId =
            this.identity.engineId;

        error.timestamp =
            new Date();

        return error;
    }

    normalizeReplayError(
        error,
        context
    ) {
        if (
            error &&
            error.code
        ) {
            error.replayId =
                context.replayId;

            return error;
        }

        const normalized =
            this.createReplayError(
                error?.message ||
                    'Transaction replay failed.'
            );

        normalized.cause =
            error;

        normalized.replayId =
            context.replayId;

        return normalized;
    }

    createFailedResult(
        eventId,
        error,
        context,
        startedAt = Date.now()
    ) {
        return {
            eventId,

            status:
                REPLAY_STATUS.FAILED,

            reason:
                error.code ===
                'TRANSACTION_REPLAY_TIMEOUT'
                    ? REPLAY_REASON.TIMEOUT
                    : REPLAY_REASON.PUBLISH_FAILED,

            replayId:
                context.replayId,

            error: {
                code:
                    error.code ||
                    'TRANSACTION_REPLAY_FAILED',

                message:
                    error.message,

                retryable:
                    this.isRetryableError(
                        error
                    )
            },

            durationMs:
                Date.now() -
                startedAt
        };
    }

    isRetryableError(
        error
    ) {
        if (!error) {
            return false;
        }

        const nonRetryableCodes = new Set([
            'INVALID_REPLAY_REQUEST',
            'REPLAY_LIMIT_EXCEEDED',
            'INVALID_EVENT',
            'TENANT_MISMATCH',
            'TENANT_CONTEXT_MISSING',
            'ALREADY_REPLAYED'
        ]);

        return !nonRetryableCodes.has(
            error.code
        );
    }

    isFatalError(
        error
    ) {
        if (!error) {
            return false;
        }

        return [
            'INVALID_REPLAY_REQUEST',
            'REPLAY_LIMIT_EXCEEDED',
            'TENANT_MISMATCH'
        ].includes(
            error.code
        );
    }

    /**
     * =========================================================================
     * Numeric Normalization
     * =========================================================================
     */

    normalizePositiveInteger(
        value,
        fallback
    ) {
        const parsed =
            Number(value);

        if (
            !Number.isFinite(parsed) ||
            parsed <= 0
        ) {
            return fallback;
        }

        return Math.floor(parsed);
    }

    normalizeNonNegativeInteger(
        value,
        fallback
    ) {
        const parsed =
            Number(value);

        if (
            !Number.isFinite(parsed) ||
            parsed < 0
        ) {
            return fallback;
        }

        return Math.floor(parsed);
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    metricIncrement(
        name,
        value = 1
    ) {
        if (
            !this.config.enableMetrics
        ) {
            return;
        }

        try {
            if (
                typeof this.metrics?.increment ===
                'function'
            ) {
                this.metrics.increment(
                    name,
                    value
                );
            }
        }
        catch (error) {
            this.logWarn(
                'Transaction replay metric increment failed',
                {
                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    metricObserve(
        name,
        value
    ) {
        if (
            !this.config.enableMetrics
        ) {
            return;
        }

        try {
            if (
                typeof this.metrics?.observe ===
                'function'
            ) {
                this.metrics.observe(
                    name,
                    value
                );
            }
        }
        catch (error) {
            this.logWarn(
                'Transaction replay metric observation failed',
                {
                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    metricReplaySummary(
        summary
    ) {
        this.metricObserve(
            'transaction.replay.duration_ms',
            summary.durationMs
        );

        this.metricIncrement(
            'transaction.replay.events.succeeded',
            summary.succeeded
        );

        this.metricIncrement(
            'transaction.replay.events.failed',
            summary.failed
        );

        this.metricIncrement(
            'transaction.replay.events.skipped',
            summary.skipped
        );
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        context
    ) {
        if (
            !this.config.enableTracing
        ) {
            return null;
        }

        try {
            if (
                typeof this.tracer?.startSpan ===
                'function'
            ) {
                return this.tracer.startSpan(
                    name,
                    {
                        attributes: {
                            'transaction.replay_id':
                                context.replayId,

                            'transaction.event_id':
                                context.eventId ||
                                null,

                            'transaction.tenant_id':
                                context.tenantId ||
                                null,

                            'transaction.correlation_id':
                                context.correlationId
                        }
                    }
                );
            }
        }
        catch (error) {
            this.logWarn(
                'Transaction replay tracing initialization failed',
                {
                    error:
                        error.message
                }
            );
        }

        return null;
    }

    finishSpan(
        span,
        context
    ) {
        if (!span) {
            return;
        }

        try {
            if (
                typeof span.setAttribute ===
                'function'
            ) {
                span.setAttribute(
                    'transaction.replay_id',
                    context.replayId
                );
            }

            if (
                typeof span.end ===
                'function'
            ) {
                span.end();
            }
        }
        catch (error) {
            this.logWarn(
                'Transaction replay tracing finalization failed',
                {
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    logInfo(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            if (
                typeof this.logger?.info ===
                'function'
            ) {
                this.logger.info(
                    {
                        component:
                            'TransactionReplayEngine',

                        ...metadata
                    },
                    message
                );
            }
        }
        catch (error) {
            // Logging must never break transaction replay.
        }
    }

    logWarn(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            if (
                typeof this.logger?.warn ===
                'function'
            ) {
                this.logger.warn(
                    {
                        component:
                            'TransactionReplayEngine',

                        ...metadata
                    },
                    message
                );
            }
        }
        catch (error) {
            // Logging must never break transaction replay.
        }
    }

    logError(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            if (
                typeof this.logger?.error ===
                'function'
            ) {
                this.logger.error(
                    {
                        component:
                            'TransactionReplayEngine',

                        ...metadata,

                        error:
                            metadata.error
                                ? {
                                    message:
                                        metadata.error.message,

                                    code:
                                        metadata.error.code,

                                    stack:
                                        metadata.error.stack
                                }
                                : undefined
                    },
                    message
                );
            }
        }
        catch (error) {
            // Logging must never break transaction replay.
        }
    }
}

module.exports = TransactionReplayEngine;