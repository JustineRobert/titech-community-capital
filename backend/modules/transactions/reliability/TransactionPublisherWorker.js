'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Transaction Publisher Worker
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionPublisherWorker.js
 *
 * Purpose:
 *   Enterprise background worker responsible for continuously invoking the
 *   transaction publisher engine to process pending transaction events.
 *
 * Responsibilities:
 *   - Poll pending transaction events
 *   - Prevent overlapping publisher executions
 *   - Provide graceful start/stop lifecycle
 *   - Isolate publisher failures
 *   - Support configurable polling intervals
 *   - Support batch limits
 *   - Provide operational metrics hooks
 *   - Provide structured logging hooks
 *   - Provide tracing hooks
 *   - Protect against unhandled promise rejections
 *   - Support graceful shutdown with in-flight execution draining
 *   - Prevent multiple worker loops from being started
 *   - Support immediate first execution
 *   - Support timer unref in non-critical/background environments
 *
 * Design Principles:
 *   - No business logic
 *   - No transaction mutation
 *   - No direct database access
 *   - Delegates publishing to the supplied engine
 *   - Safe for long-running Node.js processes
 *   - Backward-compatible constructor/start/stop interface
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Worker States
 * =============================================================================
 */

const WorkerState = Object.freeze({
    CREATED: 'CREATED',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPING',
    STOPPED: 'STOPPED',
    FAILED: 'FAILED'
});

/**
 * =============================================================================
 * Default Configuration
 * =============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    intervalMs: 1000,

    batchSize: 100,

    /**
     * Execute publisher immediately when the worker starts.
     */
    runImmediately: true,

    /**
     * Prevent multiple publisher executions from overlapping.
     */
    preventOverlap: true,

    /**
     * Wait for an active publishing cycle during stop().
     */
    gracefulShutdown: true,

    /**
     * Maximum time stop() waits for an active publishing cycle.
     */
    shutdownTimeoutMs: 30000,

    /**
     * Do not keep the Node.js process alive solely because of this worker.
     */
    unrefTimer: true,

    /**
     * Continue polling after publisher failures.
     */
    continueOnError: true,

    /**
     * Emit operational lifecycle events.
     */
    emitLifecycleEvents: true,

    /**
     * Maximum number of consecutive failures before worker health
     * is considered degraded.
     *
     * This does not automatically stop the worker.
     */
    failureThreshold: 5,

    /**
     * Optional worker name for logs and metrics.
     */
    workerName: 'transaction-publisher-worker',

    /**
     * Optional service name.
     */
    serviceName:
        process.env.SERVICE_NAME ||
        'transaction-service'
});

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function toPositiveInteger(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }

    return Math.floor(number);
}

function toBoolean(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }

    return fallback;
}

/**
 * =============================================================================
 * Transaction Publisher Worker
 * =============================================================================
 */

class TransactionPublisherWorker {
    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {
        this.engine = options.engine;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.eventEmitter =
            options.eventEmitter ||
            null;

        this.config = Object.freeze({
            ...DEFAULT_CONFIG,

            ...(options.config || {}),

            /**
             * Preserve backward compatibility with the previous
             * `interval` option.
             */
            intervalMs: toPositiveInteger(
                options.interval ??
                    options.intervalMs ??
                    options.config?.intervalMs,
                DEFAULT_CONFIG.intervalMs
            ),

            batchSize: toPositiveInteger(
                options.batchSize ??
                    options.config?.batchSize,
                DEFAULT_CONFIG.batchSize
            ),

            runImmediately: toBoolean(
                options.runImmediately ??
                    options.config?.runImmediately,
                DEFAULT_CONFIG.runImmediately
            ),

            preventOverlap: toBoolean(
                options.preventOverlap ??
                    options.config?.preventOverlap,
                DEFAULT_CONFIG.preventOverlap
            ),

            gracefulShutdown: toBoolean(
                options.gracefulShutdown ??
                    options.config?.gracefulShutdown,
                DEFAULT_CONFIG.gracefulShutdown
            ),

            shutdownTimeoutMs: toPositiveInteger(
                options.shutdownTimeoutMs ??
                    options.config?.shutdownTimeoutMs,
                DEFAULT_CONFIG.shutdownTimeoutMs
            ),

            unrefTimer: toBoolean(
                options.unrefTimer ??
                    options.config?.unrefTimer,
                DEFAULT_CONFIG.unrefTimer
            ),

            continueOnError: toBoolean(
                options.continueOnError ??
                    options.config?.continueOnError,
                DEFAULT_CONFIG.continueOnError
            ),

            emitLifecycleEvents: toBoolean(
                options.emitLifecycleEvents ??
                    options.config?.emitLifecycleEvents,
                DEFAULT_CONFIG.emitLifecycleEvents
            ),

            failureThreshold: toPositiveInteger(
                options.failureThreshold ??
                    options.config?.failureThreshold,
                DEFAULT_CONFIG.failureThreshold
            ),

            workerName:
                options.workerName ||
                options.config?.workerName ||
                DEFAULT_CONFIG.workerName,

            serviceName:
                options.serviceName ||
                options.config?.serviceName ||
                DEFAULT_CONFIG.serviceName
        });

        /**
         * ---------------------------------------------------------------------
         * Runtime Identity
         * ---------------------------------------------------------------------
         */

        this.identity = Object.freeze({
            workerId:
                options.workerId ||
                `tx-publisher-worker-${process.pid}-${Date.now()}-${crypto
                    .randomBytes(4)
                    .toString('hex')}`,

            workerName:
                this.config.workerName,

            serviceName:
                this.config.serviceName,

            processId:
                process.pid,

            hostname:
                process.env.HOSTNAME ||
                'localhost',

            environment:
                process.env.NODE_ENV ||
                'development'
        });

        /**
         * ---------------------------------------------------------------------
         * Lifecycle State
         * ---------------------------------------------------------------------
         */

        this.state = WorkerState.CREATED;

        this.running = false;

        this.timer = null;

        this.currentExecution = null;

        this.stopPromise = null;

        /**
         * ---------------------------------------------------------------------
         * Operational Counters
         * ---------------------------------------------------------------------
         */

        this.statistics = {
            executions: 0,

            successfulExecutions: 0,

            failedExecutions: 0,

            skippedExecutions: 0,

            publishedRecords: 0,

            consecutiveFailures: 0,

            maxConsecutiveFailures: 0,

            startedAt: null,

            stoppedAt: null,

            lastExecutionAt: null,

            lastSuccessAt: null,

            lastFailureAt: null,

            lastDurationMs: null,

            lastError: null
        };

        /**
         * ---------------------------------------------------------------------
         * Validate dependencies
         * ---------------------------------------------------------------------
         */

        this.validateDependencies();

        this.log(
            'info',
            'TransactionPublisherWorker created',
            this.getRuntimeContext()
        );
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {
        if (!this.engine) {
            throw new Error(
                'TransactionPublisherWorker requires an engine.'
            );
        }

        if (
            typeof this.engine.publishPending !==
            'function'
        ) {
            throw new Error(
                'TransactionPublisherWorker engine must expose publishPending().'
            );
        }
    }

    /**
     * =========================================================================
     * Runtime Context
     * =========================================================================
     */

    getRuntimeContext() {
        return {
            workerId: this.identity.workerId,

            workerName:
                this.identity.workerName,

            serviceName:
                this.identity.serviceName,

            processId:
                this.identity.processId,

            state:
                this.state,

            running:
                this.running,

            intervalMs:
                this.config.intervalMs,

            batchSize:
                this.config.batchSize
        };
    }

    /**
     * =========================================================================
     * Start Worker
     * =========================================================================
     */

    async start() {
        /**
         * Idempotent start.
         */

        if (
            this.state === WorkerState.RUNNING ||
            this.state === WorkerState.STARTING
        ) {
            return this.getStatus();
        }

        if (
            this.state === WorkerState.STOPPING
        ) {
            throw this.createLifecycleError(
                'WORKER_STOPPING',
                'Transaction publisher worker is currently stopping.'
            );
        }

        this.validateDependencies();

        this.state = WorkerState.STARTING;

        this.emitLifecycle(
            'worker.starting'
        );

        try {
            this.running = true;

            this.statistics.startedAt =
                new Date();

            this.statistics.stoppedAt =
                null;

            this.state =
                WorkerState.RUNNING;

            /**
             * -----------------------------------------------------------------
             * Immediate execution
             * -----------------------------------------------------------------
             */

            if (
                this.config.runImmediately
            ) {
                await this.runOnce();
            }

            /**
             * -----------------------------------------------------------------
             * Start polling timer
             * -----------------------------------------------------------------
             */

            if (
                this.running &&
                !this.timer
            ) {
                this.timer =
                    setInterval(
                        () => {
                            void this.runOnce();
                        },
                        this.config.intervalMs
                    );

                if (
                    this.config.unrefTimer &&
                    typeof this.timer.unref ===
                        'function'
                ) {
                    this.timer.unref();
                }
            }

            this.emitLifecycle(
                'worker.started'
            );

            this.log(
                'info',
                'TransactionPublisherWorker started',
                this.getRuntimeContext()
            );

            return this.getStatus();
        } catch (error) {
            this.state =
                WorkerState.FAILED;

            this.running = false;

            this.clearTimer();

            this.statistics.lastError =
                this.serializeError(error);

            this.log(
                'error',
                'TransactionPublisherWorker failed during startup',
                {
                    ...this.getRuntimeContext(),
                    error:
                        this.serializeError(error)
                }
            );

            this.emitLifecycle(
                'worker.failed',
                {
                    error:
                        this.serializeError(error)
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Execute One Publishing Cycle
     * =========================================================================
     */

    async runOnce() {
        /**
         * Worker may have been stopped while a timer callback was queued.
         */

        if (!this.running) {
            return {
                skipped: true,
                reason: 'WORKER_NOT_RUNNING'
            };
        }

        /**
         * Prevent concurrent publisher executions.
         */

        if (
            this.currentExecution &&
            this.config.preventOverlap
        ) {
            this.statistics.skippedExecutions += 1;

            this.incrementMetric(
                'transaction.publisher.worker.skipped'
            );

            this.emitLifecycle(
                'worker.execution.skipped',
                {
                    reason:
                        'EXECUTION_IN_PROGRESS'
                }
            );

            return {
                skipped: true,
                reason:
                    'EXECUTION_IN_PROGRESS'
            };
        }

        const executionId =
            `publish-${Date.now()}-${crypto
                .randomBytes(4)
                .toString('hex')}`;

        const startedAt =
            process.hrtime.bigint();

        const execution = {
            executionId,

            startedAt:
                new Date(),

            promise:
                null
        };

        this.currentExecution =
            execution;

        this.statistics.executions += 1;

        this.statistics.lastExecutionAt =
            execution.startedAt;

        this.emitLifecycle(
            'worker.execution.started',
            {
                executionId
            }
        );

        const span =
            this.startTrace(
                'transaction.publisher.worker.execute',
                {
                    executionId
                }
            );

        try {
            execution.promise =
                this.executePublisher(
                    executionId
                );

            const result =
                await execution.promise;

            const durationMs =
                this.calculateDurationMs(
                    startedAt
                );

            this.statistics.successfulExecutions += 1;

            this.statistics.consecutiveFailures = 0;

            this.statistics.lastSuccessAt =
                new Date();

            this.statistics.lastDurationMs =
                durationMs;

            const publishedCount =
                this.extractPublishedCount(
                    result
                );

            this.statistics.publishedRecords +=
                publishedCount;

            this.observeMetric(
                'transaction.publisher.worker.duration_ms',
                durationMs
            );

            this.incrementMetric(
                'transaction.publisher.worker.success'
            );

            this.incrementMetric(
                'transaction.publisher.worker.records_published',
                publishedCount
            );

            this.emitLifecycle(
                'worker.execution.completed',
                {
                    executionId,
                    durationMs,
                    publishedCount,
                    result
                }
            );

            return {
                success: true,

                executionId,

                durationMs,

                publishedCount,

                result
            };
        } catch (error) {
            const durationMs =
                this.calculateDurationMs(
                    startedAt
                );

            this.statistics.failedExecutions += 1;

            this.statistics.consecutiveFailures += 1;

            this.statistics.maxConsecutiveFailures =
                Math.max(
                    this.statistics.maxConsecutiveFailures,
                    this.statistics.consecutiveFailures
                );

            this.statistics.lastFailureAt =
                new Date();

            this.statistics.lastDurationMs =
                durationMs;

            this.statistics.lastError =
                this.serializeError(error);

            this.observeMetric(
                'transaction.publisher.worker.duration_ms',
                durationMs
            );

            this.incrementMetric(
                'transaction.publisher.worker.failure'
            );

            this.emitLifecycle(
                'worker.execution.failed',
                {
                    executionId,
                    durationMs,
                    error:
                        this.serializeError(error)
                }
            );

            this.log(
                'error',
                'Transaction publisher execution failed',
                {
                    ...this.getRuntimeContext(),
                    executionId,
                    durationMs,
                    consecutiveFailures:
                        this.statistics
                            .consecutiveFailures,
                    error:
                        this.serializeError(error)
                }
            );

            /**
             * Do not automatically terminate the worker unless explicitly
             * configured. Background publisher failures are isolated so that
             * transient database/network/provider errors do not permanently
             * kill the worker loop.
             */

            if (
                !this.config.continueOnError
            ) {
                this.state =
                    WorkerState.FAILED;

                this.running = false;

                this.clearTimer();
            }

            return {
                success: false,

                executionId,

                durationMs,

                error:
                    this.serializeError(error)
            };
        } finally {
            this.finishTrace(
                span
            );

            this.currentExecution =
                null;
        }
    }

    /**
     * =========================================================================
     * Execute Publisher Engine
     * =========================================================================
     */

    async executePublisher(executionId) {
        /**
         * Prefer the extended interface when available.
         *
         * Supported:
         *   publishPending()
         *   publishPending(limit)
         *   publishPending({ limit, executionId, workerId })
         *
         * The implementation intentionally detects function arity so the
         * existing engine remains compatible.
         */

        const publishPending =
            this.engine.publishPending.bind(
                this.engine
            );

        if (
            publishPending.length === 0
        ) {
            return publishPending();
        }

        if (
            publishPending.length === 1
        ) {
            return publishPending(
                this.config.batchSize
            );
        }

        return publishPending({
            limit:
                this.config.batchSize,

            batchSize:
                this.config.batchSize,

            executionId,

            workerId:
                this.identity.workerId
        });
    }

    /**
     * =========================================================================
     * Stop Worker
     * =========================================================================
     */

    async stop(options = {}) {
        if (
            this.state === WorkerState.STOPPED ||
            this.state === WorkerState.CREATED
        ) {
            this.running = false;

            this.clearTimer();

            this.state =
                WorkerState.STOPPED;

            this.statistics.stoppedAt =
                new Date();

            return this.getStatus();
        }

        if (
            this.stopPromise
        ) {
            return this.stopPromise;
        }

        this.stopPromise =
            this.performStop(
                options
            );

        try {
            return await this.stopPromise;
        } finally {
            this.stopPromise =
                null;
        }
    }

    /**
     * =========================================================================
     * Stop Implementation
     * =========================================================================
     */

    async performStop(options = {}) {
        this.state =
            WorkerState.STOPPING;

        this.running = false;

        this.emitLifecycle(
            'worker.stopping'
        );

        /**
         * Stop future polling immediately.
         */

        this.clearTimer();

        /**
         * Wait for active publisher execution where configured.
         */

        if (
            this.config.gracefulShutdown &&
            this.currentExecution
        ) {
            await this.waitForCurrentExecution(
                options.timeoutMs ||
                    this.config.shutdownTimeoutMs
            );
        }

        this.state =
            WorkerState.STOPPED;

        this.statistics.stoppedAt =
            new Date();

        this.emitLifecycle(
            'worker.stopped'
        );

        this.log(
            'info',
            'TransactionPublisherWorker stopped',
            this.getRuntimeContext()
        );

        return this.getStatus();
    }

    /**
     * =========================================================================
     * Wait For Active Execution
     * =========================================================================
     */

    async waitForCurrentExecution(timeoutMs) {
        const execution =
            this.currentExecution;

        if (
            !execution ||
            !execution.promise
        ) {
            return;
        }

        let timeoutHandle;

        try {
            await Promise.race([
                execution.promise,

                new Promise(resolve => {
                    timeoutHandle =
                        setTimeout(
                            resolve,
                            timeoutMs
                        );

                    if (
                        typeof timeoutHandle.unref ===
                            'function'
                    ) {
                        timeoutHandle.unref();
                    }
                })
            ]);
        } catch (error) {
            /**
             * runOnce() already isolates publisher failures.
             * This catch protects shutdown from future engine changes.
             */

            this.log(
                'warn',
                'Active publisher execution failed during shutdown',
                {
                    executionId:
                        execution.executionId,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        } finally {
            if (timeoutHandle) {
                clearTimeout(
                    timeoutHandle
                );
            }
        }

        /**
         * The worker is stopped regardless of whether the publisher operation
         * completed before the shutdown deadline.
         */
    }

    /**
     * =========================================================================
     * Restart Worker
     * =========================================================================
     */

    async restart(options = {}) {
        await this.stop(
            options
        );

        return this.start();
    }

    /**
     * =========================================================================
     * Timer Management
     * =========================================================================
     */

    clearTimer() {
        if (this.timer) {
            clearInterval(
                this.timer
            );

            this.timer =
                null;
        }
    }

    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    getStatus() {
        const now =
            Date.now();

        const lastExecution =
            this.statistics.lastExecutionAt
                ? this.statistics
                      .lastExecutionAt
                : null;

        return {
            workerId:
                this.identity.workerId,

            workerName:
                this.identity.workerName,

            serviceName:
                this.identity.serviceName,

            state:
                this.state,

            running:
                this.running,

            healthy:
                this.isHealthy(),

            degraded:
                this.isDegraded(),

            executing:
                Boolean(
                    this.currentExecution
                ),

            executionId:
                this.currentExecution?.executionId ||
                null,

            intervalMs:
                this.config.intervalMs,

            batchSize:
                this.config.batchSize,

            uptimeMs:
                this.statistics.startedAt
                    ? now -
                      this.statistics.startedAt.getTime()
                    : 0,

            lastExecutionAt:
                lastExecution,

            lastSuccessAt:
                this.statistics.lastSuccessAt,

            lastFailureAt:
                this.statistics.lastFailureAt,

            lastDurationMs:
                this.statistics.lastDurationMs,

            lastError:
                this.statistics.lastError,

            statistics: {
                ...this.statistics
            }
        };
    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */

    isHealthy() {
        if (
            this.state !==
            WorkerState.RUNNING
        ) {
            return false;
        }

        return (
            this.statistics.consecutiveFailures <
            this.config.failureThreshold
        );
    }

    /**
     * =========================================================================
     * Degraded State
     * =========================================================================
     */

    isDegraded() {
        return (
            this.statistics.consecutiveFailures >=
            this.config.failureThreshold
        );
    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    isReady() {
        return (
            this.running &&
            this.state ===
                WorkerState.RUNNING
        );
    }

    /**
     * =========================================================================
     * Liveness
     * =========================================================================
     */

    isAlive() {
        return (
            this.state !==
            WorkerState.FAILED
        );
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1
    ) {
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
        } catch (error) {
            this.log(
                'warn',
                'Transaction publisher metric increment failed',
                {
                    metric:
                        name,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    observeMetric(
        name,
        value
    ) {
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
        } catch (error) {
            this.log(
                'warn',
                'Transaction publisher metric observation failed',
                {
                    metric:
                        name,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startTrace(
        name,
        attributes = {}
    ) {
        try {
            if (
                typeof this.tracer?.startSpan ===
                'function'
            ) {
                const span =
                    this.tracer.startSpan(
                        name,
                        {
                            attributes: {
                                ...attributes,

                                workerId:
                                    this.identity.workerId,

                                workerName:
                                    this.identity.workerName
                            }
                        }
                    );

                return span;
            }
        } catch (error) {
            this.log(
                'warn',
                'Transaction publisher tracing start failed',
                {
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }

        return null;
    }

    finishTrace(span) {
        if (!span) {
            return;
        }

        try {
            if (
                typeof span.end ===
                'function'
            ) {
                span.end();
            }
        } catch (error) {
            this.log(
                'warn',
                'Transaction publisher tracing finalization failed',
                {
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * =========================================================================
     * Lifecycle Events
     * =========================================================================
     */

    emitLifecycle(
        event,
        payload = {}
    ) {
        if (
            !this.config.emitLifecycleEvents
        ) {
            return;
        }

        const eventPayload = {
            event,

            timestamp:
                new Date(),

            workerId:
                this.identity.workerId,

            workerName:
                this.identity.workerName,

            state:
                this.state,

            ...payload
        };

        try {
            if (
                this.eventEmitter &&
                typeof this.eventEmitter.emit ===
                    'function'
            ) {
                this.eventEmitter.emit(
                    event,
                    eventPayload
                );
            }
        } catch (error) {
            this.log(
                'warn',
                'Transaction publisher lifecycle event failed',
                {
                    event,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * =========================================================================
     * Published Count Extraction
     * =========================================================================
     */

    extractPublishedCount(result) {
        if (
            typeof result ===
            'number'
        ) {
            return Math.max(
                0,
                result
            );
        }

        if (
            Array.isArray(result)
        ) {
            return result.length;
        }

        if (
            result &&
            typeof result ===
                'object'
        ) {
            const candidates = [
                result.publishedCount,
                result.published,
                result.processedCount,
                result.processed,
                result.count
            ];

            for (
                const candidate of
                candidates
            ) {
                const number =
                    Number(
                        candidate
                    );

                if (
                    Number.isFinite(
                        number
                    ) &&
                    number >= 0
                ) {
                    return number;
                }
            }
        }

        return 0;
    }

    /**
     * =========================================================================
     * Duration
     * =========================================================================
     */

    calculateDurationMs(
        startedAt
    ) {
        return Number(
            process.hrtime.bigint() -
                startedAt
        ) / 1e6;
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createLifecycleError(
        code,
        message
    ) {
        const error =
            new Error(
                message
            );

        error.name =
            'TransactionPublisherWorkerError';

        error.code =
            code;

        error.workerId =
            this.identity.workerId;

        error.timestamp =
            new Date();

        return error;
    }

    /**
     * =========================================================================
     * Error Serialization
     * =========================================================================
     */

    serializeError(error) {
        if (!error) {
            return null;
        }

        return {
            name:
                error.name ||
                'Error',

            message:
                error.message ||
                String(error),

            code:
                error.code ||
                null,

            stack:
                error.stack ||
                null
        };
    }

    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    log(
        level,
        message,
        context = {}
    ) {
        const logger =
            this.logger;

        const method =
            typeof logger?.[level] ===
            'function'
                ? logger[level]
                : logger?.log;

        if (
            typeof method !==
            'function'
        ) {
            return;
        }

        try {
            method.call(
                logger,
                {
                    component:
                        'TransactionPublisherWorker',

                    workerId:
                        this.identity.workerId,

                    workerName:
                        this.identity.workerName,

                    serviceName:
                        this.identity.serviceName,

                    ...context
                },
                message
            );
        } catch {
            /**
             * Logging must never crash the worker.
             */
        }
    }
}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = TransactionPublisherWorker;

module.exports.TransactionPublisherWorker =
    TransactionPublisherWorker;

module.exports.WorkerState =
    WorkerState;

module.exports.DEFAULT_CONFIG =
    DEFAULT_CONFIG;