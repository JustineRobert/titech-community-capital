'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Recovery Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionRecoveryManager.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose
 * -------
 * Coordinates recovery of transactions that were left in a recoverable/pending
 * state after:
 *
 *   - process crashes
 *   - application restarts
 *   - worker interruptions
 *   - transient infrastructure failures
 *   - distributed transaction timeouts
 *   - incomplete event publication
 *   - partial orchestration failures
 *
 * Design Principles
 * -----------------
 *   - No financial business logic
 *   - No direct ledger mutation
 *   - Repository-driven persistence
 *   - Idempotent recovery coordination
 *   - Bounded recovery batches
 *   - Failure isolation
 *   - Tenant-aware execution
 *   - Structured observability
 *   - Graceful lifecycle management
 *   - Safe concurrent invocation handling
 *   - Backward-compatible repository contract
 *
 * Expected Repository Contract
 * ----------------------------
 *
 * Minimum:
 *
 *   repository.findPending(limit)
 *
 * Optional:
 *
 *   repository.claimPending(record, options)
 *   repository.markRecoveryStarted(record, options)
 *   repository.markRecoveryCompleted(record, options)
 *   repository.markRecoveryFailed(record, error, options)
 *   repository.releaseRecovery(record, options)
 *
 * Optional Worker/Engine Integration
 * ----------------------------------
 *
 *   recoveryEngine.recover(record, context)
 *
 * The manager intentionally does not require a recovery engine. If one is not
 * supplied, it returns pending records for an external recovery pipeline.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,

    batchSize: 100,

    maxBatchSize: 1000,

    recoveryTimeoutMs: 30000,

    claimTimeoutMs: 60000,

    maxConcurrentRecoveries: 10,

    continueOnError: true,

    failFast: false,

    requireRepository: true,

    requireRecoveryEngine: false,

    markRecoveryLifecycle: true,

    metricsEnabled: true,

    loggingEnabled: true,

    tenantIsolation: true,

    preventConcurrentRuns: true,

    runLockTimeoutMs: 300000,

    staleRecoveryAfterMs: 300000,

    source: 'transaction-recovery-manager',

    serviceName:
        process.env.SERVICE_NAME ||
        'transaction-service'
});

const RECOVERY_STATE = Object.freeze({
    CREATED: 'CREATED',

    RUNNING: 'RUNNING',

    COMPLETED: 'COMPLETED',

    PARTIAL: 'PARTIAL',

    FAILED: 'FAILED',

    STOPPING: 'STOPPING',

    STOPPED: 'STOPPED'
});

const RESULT_STATUS = Object.freeze({
    RECOVERED: 'RECOVERED',

    PENDING: 'PENDING',

    FAILED: 'FAILED',

    SKIPPED: 'SKIPPED'
});

class TransactionRecoveryManager {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {

        this.config = Object.freeze({
            ...DEFAULT_CONFIG,
            ...(options.config || {})
        });

        this.repository =
            options.repository || null;

        this.recoveryEngine =
            options.recoveryEngine ||
            options.engine ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.clock =
            typeof options.clock === 'function'
                ? options.clock
                : () => Date.now();

        this.instanceId =
            options.instanceId ||
            this.generateInstanceId();

        this.state =
            RECOVERY_STATE.CREATED;

        this.running =
            false;

        this.stopping =
            false;

        this.activeRunId =
            null;

        this.activeRecoveries =
            new Map();

        this.completedRecoveries =
            0;

        this.failedRecoveries =
            0;

        this.skippedRecoveries =
            0;

        this.lastRun =
            null;

        this.lastFailure =
            null;

        this.totalRuns =
            0;

        this._runPromise =
            null;

        this.validateConfiguration();

        this.log(
            'info',
            'TransactionRecoveryManager initialized',
            {
                instanceId: this.instanceId,
                state: this.state,
                batchSize: this.config.batchSize,
                maxConcurrentRecoveries:
                    this.config.maxConcurrentRecoveries
            }
        );
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        if (
            this.config.requireRepository &&
            !this.repository
        ) {

            throw new Error(
                'TransactionRecoveryManager requires a repository.'
            );
        }

        if (
            !Number.isInteger(
                this.config.batchSize
            ) ||
            this.config.batchSize <= 0
        ) {

            throw new Error(
                'Recovery batchSize must be a positive integer.'
            );
        }

        if (
            this.config.batchSize >
            this.config.maxBatchSize
        ) {

            throw new Error(
                'Recovery batchSize cannot exceed maxBatchSize.'
            );
        }

        if (
            this.config.maxConcurrentRecoveries <= 0
        ) {

            throw new Error(
                'maxConcurrentRecoveries must be greater than zero.'
            );
        }

        if (
            this.config.recoveryTimeoutMs <= 0
        ) {

            throw new Error(
                'recoveryTimeoutMs must be greater than zero.'
            );
        }
    }

    /**
     * =========================================================================
     * Main Recovery Entry Point
     * =========================================================================
     *
     * Behaviour:
     *
     *   1. Validate runtime.
     *   2. Acquire manager-level execution lock.
     *   3. Load bounded pending transactions.
     *   4. Recover records with bounded concurrency.
     *   5. Isolate individual failures.
     *   6. Produce structured recovery summary.
     *   7. Release execution lock.
     *
     * If no recovery engine is configured, pending records are returned without
     * mutating them.
     */

    async recover(options = {}) {

        this.validateRuntime();

        if (
            this.stopping
        ) {

            throw this.createError(
                'RECOVERY_MANAGER_STOPPING',
                'Recovery manager is stopping.'
            );
        }

        if (
            this.config.preventConcurrentRuns &&
            this.running
        ) {

            return this.createConcurrentRunResult();
        }

        const runId =
            options.runId ||
            this.generateRunId();

        const startedAt =
            this.clock();

        this.totalRuns++;

        this.running =
            true;

        this.state =
            RECOVERY_STATE.RUNNING;

        this.activeRunId =
            runId;

        this._runPromise =
            this.executeRecoveryRun(
                runId,
                options,
                startedAt
            );

        try {

            return await this._runPromise;

        }
        finally {

            this.running =
                false;

            this.activeRunId =
                null;

            this._runPromise =
                null;

            if (
                !this.stopping
            ) {

                this.state =
                    RECOVERY_STATE.COMPLETED;
            }
        }
    }

    /**
     * =========================================================================
     * Execute Recovery Run
     * =========================================================================
     */

    async executeRecoveryRun(
        runId,
        options,
        startedAt
    ) {

        let pendingTransactions = [];

        const summary = {
            runId,

            instanceId:
                this.instanceId,

            startedAt:
                new Date(
                    startedAt
                ).toISOString(),

            completedAt:
                null,

            durationMs:
                null,

            status:
                RECOVERY_STATE.RUNNING,

            discovered:
                0,

            recovered:
                0,

            failed:
                0,

            skipped:
                0,

            pending:
                0,

            results: []
        };

        try {

            this.incrementMetric(
                'transaction.recovery.runs.started'
            );

            pendingTransactions =
                await this.findPendingTransactions(
                    options
                );

            summary.discovered =
                pendingTransactions.length;

            if (
                pendingTransactions.length === 0
            ) {

                summary.status =
                    RECOVERY_STATE.COMPLETED;

                return this.finalizeSummary(
                    summary,
                    startedAt
                );
            }

            /*
             * ---------------------------------------------------------------
             * Without a recovery engine, preserve the old behaviour:
             * return pending records rather than pretending recovery occurred.
             * ---------------------------------------------------------------
             */

            if (
                !this.recoveryEngine
            ) {

                summary.pending =
                    pendingTransactions.length;

                summary.status =
                    RECOVERY_STATE.COMPLETED;

                summary.results =
                    pendingTransactions.map(
                        record =>
                            this.createPendingResult(
                                record
                            )
                    );

                return this.finalizeSummary(
                    summary,
                    startedAt
                );
            }

            const results =
                await this.recoverBatch(
                    pendingTransactions,
                    options,
                    runId
                );

            summary.results =
                results;

            for (
                const result of results
            ) {

                switch (
                    result.status
                ) {

                    case RESULT_STATUS.RECOVERED:

                        summary.recovered++;
                        break;

                    case RESULT_STATUS.FAILED:

                        summary.failed++;
                        break;

                    case RESULT_STATUS.SKIPPED:

                        summary.skipped++;
                        break;

                    case RESULT_STATUS.PENDING:

                        summary.pending++;
                        break;

                    default:
                        break;
                }
            }

            if (
                summary.failed > 0 &&
                summary.recovered > 0
            ) {

                summary.status =
                    RECOVERY_STATE.PARTIAL;
            }
            else if (
                summary.failed > 0
            ) {

                summary.status =
                    RECOVERY_STATE.FAILED;
            }
            else {

                summary.status =
                    RECOVERY_STATE.COMPLETED;
            }

            return this.finalizeSummary(
                summary,
                startedAt
            );

        }
        catch (error) {

            this.lastFailure =
                this.serializeError(
                    error
                );

            summary.status =
                RECOVERY_STATE.FAILED;

            summary.error =
                this.serializeError(
                    error
                );

            this.incrementMetric(
                'transaction.recovery.runs.failed'
            );

            this.log(
                'error',
                'Transaction recovery run failed',
                {
                    runId,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );

            if (
                this.config.failFast
            ) {

                throw error;
            }

            return this.finalizeSummary(
                summary,
                startedAt
            );
        }
    }

    /**
     * =========================================================================
     * Find Pending Transactions
     * =========================================================================
     */

    async findPendingTransactions(options = {}) {

        if (
            !this.repository ||
            typeof this.repository.findPending !==
                'function'
        ) {

            throw this.createError(
                'RECOVERY_REPOSITORY_UNAVAILABLE',
                'Repository.findPending(limit) is required.'
            );
        }

        const requestedLimit =
            options.limit ||
            this.config.batchSize;

        const limit =
            Math.min(
                Math.max(
                    1,
                    Number(
                        requestedLimit
                    )
                ),
                this.config.maxBatchSize
            );

        const queryOptions = {
            limit,

            source:
                this.config.source,

            instanceId:
                this.instanceId,

            staleRecoveryAfterMs:
                this.config.staleRecoveryAfterMs
        };

        let result;

        /*
         * Backward-compatible repository invocation.
         *
         * Existing repositories may only accept:
         *
         *   findPending(limit)
         *
         * More advanced repositories may support:
         *
         *   findPending(limit, options)
         */

        try {

            result =
                await this.repository.findPending(
                    limit,
                    queryOptions
                );

        }
        catch (error) {

            this.log(
                'error',
                'Unable to query pending transactions',
                {
                    limit,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );

            throw error;
        }

        if (
            !Array.isArray(result)
        ) {

            throw this.createError(
                'INVALID_RECOVERY_REPOSITORY_RESULT',
                'Repository.findPending() must return an array.'
            );
        }

        return result;
    }

    /**
     * =========================================================================
     * Batch Recovery
     * =========================================================================
     */

    async recoverBatch(
        transactions,
        options = {},
        runId
    ) {

        const results = [];

        const concurrency =
            Math.max(
                1,
                Math.min(
                    this.config.maxConcurrentRecoveries,
                    transactions.length
                )
            );

        let cursor = 0;

        const worker = async () => {

            while (
                true
            ) {

                const index =
                    cursor++;

                if (
                    index >=
                    transactions.length
                ) {

                    return;
                }

                const transaction =
                    transactions[index];

                const result =
                    await this.recoverSingle(
                        transaction,
                        {
                            ...options,
                            runId
                        }
                    );

                results[index] =
                    result;
            }
        };

        const workers =
            Array.from(
                {
                    length:
                        concurrency
                },
                () =>
                    worker()
            );

        await Promise.all(
            workers
        );

        return results;
    }

    /**
     * =========================================================================
     * Single Transaction Recovery
     * =========================================================================
     */

    async recoverSingle(
        transaction,
        options = {}
    ) {

        const transactionId =
            this.getTransactionId(
                transaction
            );

        const recoveryId =
            this.generateRecoveryId();

        const startedAt =
            this.clock();

        if (
            !transactionId
        ) {

            this.skippedRecoveries++;

            return {
                recoveryId,

                status:
                    RESULT_STATUS.SKIPPED,

                error: {
                    code:
                        'MISSING_TRANSACTION_ID',

                    message:
                        'Pending transaction does not contain a transaction ID.'
                }
            };
        }

        if (
            this.activeRecoveries.has(
                transactionId
            )
        ) {

            this.skippedRecoveries++;

            return {
                recoveryId,

                transactionId,

                status:
                    RESULT_STATUS.SKIPPED,

                reason:
                    'TRANSACTION_ALREADY_BEING_RECOVERED'
            };
        }

        this.activeRecoveries.set(
            transactionId,
            {
                recoveryId,

                transactionId,

                startedAt
            }
        );

        try {

            const context =
                this.createRecoveryContext(
                    transaction,
                    {
                        ...options,
                        recoveryId
                    }
                );

            await this.markRecoveryStarted(
                transaction,
                context
            );

            const result =
                await this.executeWithTimeout(
                    () =>
                        this.recoveryEngine.recover(
                            transaction,
                            context
                        ),
                    this.config.recoveryTimeoutMs
                );

            await this.markRecoveryCompleted(
                transaction,
                result,
                context
            );

            this.completedRecoveries++;

            this.incrementMetric(
                'transaction.recovery.transactions.recovered'
            );

            const completedAt =
                this.clock();

            return {
                recoveryId,

                transactionId,

                status:
                    RESULT_STATUS.RECOVERED,

                durationMs:
                    completedAt -
                    startedAt,

                result:
                    this.sanitizeResult(
                        result
                    )
            };

        }
        catch (error) {

            this.failedRecoveries++;

            this.incrementMetric(
                'transaction.recovery.transactions.failed'
            );

            const context =
                this.createRecoveryContext(
                    transaction,
                    {
                        ...options,
                        recoveryId
                    }
                );

            await this.markRecoveryFailed(
                transaction,
                error,
                context
            );

            this.log(
                'error',
                'Transaction recovery failed',
                {
                    recoveryId,
                    transactionId,
                    error:
                        this.serializeError(
                            error
                        )
                }
            );

            if (
                !this.config.continueOnError
            ) {

                throw error;
            }

            return {
                recoveryId,

                transactionId,

                status:
                    RESULT_STATUS.FAILED,

                durationMs:
                    this.clock() -
                    startedAt,

                error:
                    this.serializeError(
                        error
                    )
            };
        }
        finally {

            this.activeRecoveries.delete(
                transactionId
            );
        }
    }

    /**
     * =========================================================================
     * Recovery Context
     * =========================================================================
     */

    createRecoveryContext(
        transaction,
        options = {}
    ) {

        return Object.freeze({
            recoveryId:
                options.recoveryId ||
                this.generateRecoveryId(),

            runId:
                options.runId ||
                this.activeRunId,

            transactionId:
                this.getTransactionId(
                    transaction
                ),

            correlationId:
                this.getCorrelationId(
                    transaction
                ),

            tenantId:
                this.getTenantId(
                    transaction
                ),

            source:
                this.config.source,

            serviceName:
                this.config.serviceName,

            instanceId:
                this.instanceId,

            recoveredAt:
                new Date(),

            attempt:
                this.getRecoveryAttempt(
                    transaction
                )
        });
    }

    /**
     * =========================================================================
     * Repository Lifecycle Hooks
     * =========================================================================
     */

    async markRecoveryStarted(
        transaction,
        context
    ) {

        if (
            !this.config.markRecoveryLifecycle
        ) {

            return;
        }

        if (
            typeof this.repository.markRecoveryStarted ===
            'function'
        ) {

            await this.repository.markRecoveryStarted(
                transaction,
                context
            );

            return;
        }

        if (
            typeof this.repository.claimPending ===
            'function'
        ) {

            await this.repository.claimPending(
                transaction,
                {
                    ...context,
                    claimTimeoutMs:
                        this.config.claimTimeoutMs
                }
            );
        }
    }

    async markRecoveryCompleted(
        transaction,
        result,
        context
    ) {

        if (
            !this.config.markRecoveryLifecycle
        ) {

            return;
        }

        if (
            typeof this.repository.markRecoveryCompleted ===
            'function'
        ) {

            await this.repository.markRecoveryCompleted(
                transaction,
                {
                    ...context,
                    result
                }
            );
        }
    }

    async markRecoveryFailed(
        transaction,
        error,
        context
    ) {

        if (
            !this.config.markRecoveryLifecycle
        ) {

            return;
        }

        if (
            typeof this.repository.markRecoveryFailed ===
            'function'
        ) {

            try {

                await this.repository.markRecoveryFailed(
                    transaction,
                    error,
                    context
                );

            }
            catch (lifecycleError) {

                this.log(
                    'error',
                    'Failed to persist recovery failure state',
                    {
                        transactionId:
                            context.transactionId,

                        error:
                            this.serializeError(
                                lifecycleError
                            )
                    }
                );
            }
        }
    }

    /**
     * =========================================================================
     * Timeout Wrapper
     * =========================================================================
     */

    async executeWithTimeout(
        action,
        timeoutMs
    ) {

        let timer;

        const timeout =
            new Promise(
                (_, reject) => {

                    timer =
                        setTimeout(
                            () => {

                                const error =
                                    this.createError(
                                        'TRANSACTION_RECOVERY_TIMEOUT',
                                        `Transaction recovery exceeded ${timeoutMs}ms.`
                                    );

                                reject(
                                    error
                                );
                            },
                            timeoutMs
                        );

                    if (
                        typeof timer.unref ===
                        'function'
                    ) {

                        timer.unref();
                    }
                }
            );

        try {

            return await Promise.race([
                Promise.resolve().then(
                    action
                ),
                timeout
            ]);

        }
        finally {

            clearTimeout(
                timer
            );
        }
    }

    /**
     * =========================================================================
     * Runtime Validation
     * =========================================================================
     */

    validateRuntime() {

        if (
            !this.config.enabled
        ) {

            throw this.createError(
                'RECOVERY_MANAGER_DISABLED',
                'Transaction recovery manager is disabled.'
            );
        }

        if (
            !this.repository
        ) {

            throw this.createError(
                'RECOVERY_REPOSITORY_UNAVAILABLE',
                'Transaction recovery repository is unavailable.'
            );
        }

        if (
            this.stopping
        ) {

            throw this.createError(
                'RECOVERY_MANAGER_STOPPING',
                'Transaction recovery manager is stopping.'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Concurrent Run Result
     * =========================================================================
     */

    createConcurrentRunResult() {

        return {
            runId:
                this.activeRunId,

            instanceId:
                this.instanceId,

            status:
                'ALREADY_RUNNING',

            running:
                true,

            startedAt:
                this.lastRun?.startedAt ||
                null
        };
    }

    /**
     * =========================================================================
     * Pending Result
     * =========================================================================
     */

    createPendingResult(
        transaction
    ) {

        return {
            transactionId:
                this.getTransactionId(
                    transaction
                ),

            status:
                RESULT_STATUS.PENDING
        };
    }

    /**
     * =========================================================================
     * Finalize Summary
     * =========================================================================
     */

    finalizeSummary(
        summary,
        startedAt
    ) {

        const completedAt =
            this.clock();

        summary.completedAt =
            new Date(
                completedAt
            ).toISOString();

        summary.durationMs =
            completedAt -
            startedAt;

        this.lastRun =
            Object.freeze({
                ...summary
            });

        if (
            summary.status ===
            RECOVERY_STATE.FAILED
        ) {

            this.state =
                RECOVERY_STATE.FAILED;
        }
        else if (
            summary.status ===
            RECOVERY_STATE.PARTIAL
        ) {

            this.state =
                RECOVERY_STATE.PARTIAL;
        }
        else {

            this.state =
                RECOVERY_STATE.COMPLETED;
        }

        this.incrementMetric(
            'transaction.recovery.runs.completed'
        );

        this.observeMetric(
            'transaction.recovery.duration',
            summary.durationMs
        );

        this.log(
            'info',
            'Transaction recovery run completed',
            {
                runId:
                    summary.runId,

                status:
                    summary.status,

                discovered:
                    summary.discovered,

                recovered:
                    summary.recovered,

                failed:
                    summary.failed,

                skipped:
                    summary.skipped,

                pending:
                    summary.pending,

                durationMs:
                    summary.durationMs
            }
        );

        return summary;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    getHealth() {

        return {
            status:
                this.stopping
                    ? 'STOPPING'
                    : this.running
                        ? 'RUNNING'
                        : 'READY',

            state:
                this.state,

            ready:
                !this.stopping &&
                Boolean(
                    this.repository
                ),

            running:
                this.running,

            activeRunId:
                this.activeRunId,

            activeRecoveries:
                this.activeRecoveries.size,

            completedRecoveries:
                this.completedRecoveries,

            failedRecoveries:
                this.failedRecoveries,

            skippedRecoveries:
                this.skippedRecoveries,

            totalRuns:
                this.totalRuns,

            lastRun:
                this.lastRun,

            lastFailure:
                this.lastFailure,

            instanceId:
                this.instanceId
        };
    }

    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async stop(options = {}) {

        if (
            this.stopping
        ) {

            return this.getHealth();
        }

        this.stopping =
            true;

        this.state =
            RECOVERY_STATE.STOPPING;

        const timeoutMs =
            options.timeoutMs ||
            this.config.recoveryTimeoutMs;

        const startedAt =
            this.clock();

        while (
            this.running &&
            this.clock() -
                startedAt <
                timeoutMs
        ) {

            await this.sleep(
                50
            );
        }

        this.running =
            false;

        this.state =
            RECOVERY_STATE.STOPPED;

        this.log(
            'info',
            'TransactionRecoveryManager stopped',
            {
                instanceId:
                    this.instanceId
            }
        );

        return this.getHealth();
    }

    /**
     * =========================================================================
     * Identity Helpers
     * =========================================================================
     */

    getTransactionId(
        transaction
    ) {

        return (
            transaction?.transactionId ||
            transaction?.id ||
            transaction?._id?.toString?.() ||
            null
        );
    }

    getCorrelationId(
        transaction
    ) {

        return (
            transaction?.correlationId ||
            transaction?.metadata?.correlationId ||
            null
        );
    }

    getTenantId(
        transaction
    ) {

        return (
            transaction?.tenantId ||
            transaction?.context?.tenantId ||
            null
        );
    }

    getRecoveryAttempt(
        transaction
    ) {

        const attempt =
            Number(
                transaction?.recoveryAttempt ??
                transaction?.attempt ??
                0
            );

        return Number.isFinite(
            attempt
        )
            ? attempt + 1
            : 1;
    }

    /**
     * =========================================================================
     * Identifier Generators
     * =========================================================================
     */

    generateInstanceId() {

        return `recovery-manager-${process.pid}-${crypto.randomUUID()}`;
    }

    generateRunId() {

        return `recovery-run-${crypto.randomUUID()}`;
    }

    generateRecoveryId() {

        return `recovery-${crypto.randomUUID()}`;
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

        if (
            !this.config.metricsEnabled
        ) {

            return;
        }

        try {

            this.metrics?.increment?.(
                name,
                value
            );

        }
        catch (error) {

            this.log(
                'warn',
                'Recovery metrics increment failed',
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

        if (
            !this.config.metricsEnabled
        ) {

            return;
        }

        try {

            this.metrics?.observe?.(
                name,
                value
            );

        }
        catch (error) {

            this.log(
                'warn',
                'Recovery metrics observation failed',
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
     * Structured Logging
     * =========================================================================
     */

    log(
        level,
        message,
        metadata = {}
    ) {

        if (
            !this.config.loggingEnabled
        ) {

            return;
        }

        const payload = {
            service:
                this.config.serviceName,

            component:
                'TransactionRecoveryManager',

            instanceId:
                this.instanceId,

            state:
                this.state,

            timestamp:
                new Date().toISOString(),

            ...metadata
        };

        try {

            if (
                typeof this.logger?.[level] ===
                'function'
            ) {

                this.logger[level](
                    payload,
                    message
                );

            }
            else if (
                typeof this.logger?.log ===
                'function'
            ) {

                this.logger.log(
                    payload,
                    message
                );
            }

        }
        catch (_) {

            /*
             * Observability must never crash financial recovery.
             */
        }
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        code,
        message
    ) {

        const error =
            new Error(
                message
            );

        error.code =
            code;

        error.timestamp =
            new Date();

        error.component =
            'TransactionRecoveryManager';

        error.instanceId =
            this.instanceId;

        if (
            this.activeRunId
        ) {

            error.runId =
                this.activeRunId;
        }

        return error;
    }

    /**
     * =========================================================================
     * Error Serialization
     * =========================================================================
     */

    serializeError(
        error
    ) {

        if (
            !error
        ) {

            return null;
        }

        return {
            name:
                error.name ||
                'Error',

            code:
                error.code ||
                'RECOVERY_ERROR',

            message:
                error.message ||
                String(error),

            stack:
                error.stack,

            transactionId:
                error.transactionId,

            timestamp:
                error.timestamp ||
                new Date()
        };
    }

    /**
     * =========================================================================
     * Result Sanitization
     * =========================================================================
     *
     * Prevents accidental circular structures from being returned in recovery
     * summaries.
     */

    sanitizeResult(
        result
    ) {

        if (
            result === null ||
            result === undefined
        ) {

            return result;
        }

        if (
            typeof result !==
            'object'
        ) {

            return result;
        }

        try {

            return JSON.parse(
                JSON.stringify(
                    result
                )
            );

        }
        catch (_) {

            return {
                available:
                    true,

                serializable:
                    false
            };
        }
    }

    /**
     * =========================================================================
     * Sleep Utility
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
}

module.exports = TransactionRecoveryManager;