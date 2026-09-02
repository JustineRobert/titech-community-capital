'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Dead-Letter Processor
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/reliability/TransactionDeadLetterProcessor.js
 *
 * Enterprise Transaction Reliability Infrastructure
 * ============================================================================
 *
 * Purpose
 * -------
 * Safely processes transactions/events that have entered a dead-letter state
 * after exhausting their normal delivery/retry lifecycle.
 *
 * Responsibilities
 * ----------------
 * • Discover dead-letter records
 * • Validate dead-letter records
 * • Enforce tenant isolation
 * • Prevent duplicate restoration
 * • Republish records through the configured publisher
 * • Track restoration attempts
 * • Support bounded batch processing
 * • Support controlled concurrency
 * • Preserve partial batch success
 * • Handle publisher failures safely
 * • Support retry/backoff metadata
 * • Mark records restored/failed where repository capabilities exist
 * • Emit operational metrics
 * • Emit structured audit events
 * • Provide health/status information
 *
 * Design Principles
 * -----------------
 * • At-least-once processing compatible
 * • Idempotency-first
 * • No financial mutation inside this component
 * • No swallowed infrastructure failures
 * • No unbounded concurrency
 * • Tenant-aware
 * • Observable
 * • Dependency injectable
 * • Backward compatible with simple repositories/publishers
 *
 * ============================================================================
 */

const crypto = require('crypto');

const DEFAULTS = Object.freeze({
    batchSize: 100,

    concurrency: 5,

    maxAttempts: 10,

    retryBaseDelayMs: 1000,

    retryMaxDelayMs: 300000,

    processingTimeoutMs: 30000,

    staleProcessingTimeoutMs: 300000,

    allowRetry: true,

    markRestored: true,

    markFailed: true,

    auditEnabled: true,

    metricsEnabled: true,

    strictValidation: true,

    continueOnError: true
});

const PROCESSING_STATES = Object.freeze({
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    RESTORED: 'RESTORED',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED'
});

const RESULT_STATUS = Object.freeze({
    RESTORED: 'RESTORED',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED'
});

const ERROR_CODES = Object.freeze({
    INVALID_MESSAGE: 'DLQ_INVALID_MESSAGE',
    MISSING_REPOSITORY: 'DLQ_REPOSITORY_UNAVAILABLE',
    MISSING_PUBLISHER: 'DLQ_PUBLISHER_UNAVAILABLE',
    MAX_ATTEMPTS_EXCEEDED: 'DLQ_MAX_ATTEMPTS_EXCEEDED',
    ALREADY_RESTORED: 'DLQ_ALREADY_RESTORED',
    PROCESSING_CONFLICT: 'DLQ_PROCESSING_CONFLICT',
    PROCESSING_TIMEOUT: 'DLQ_PROCESSING_TIMEOUT',
    PUBLISH_FAILED: 'DLQ_PUBLISH_FAILED',
    REPOSITORY_FAILURE: 'DLQ_REPOSITORY_FAILURE'
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function toPositiveInteger(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }

    return Math.floor(number);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function createError(code, message, details = {}) {
    const error = new Error(message);

    error.code = code;
    error.details = details;
    error.timestamp = new Date();

    return error;
}

/**
 * ============================================================================
 * TransactionDeadLetterProcessor
 * ============================================================================
 */

class TransactionDeadLetterProcessor {
    constructor(options = {}) {
        this.config = Object.freeze({
            ...DEFAULTS,
            ...(options.config || {})
        });

        this.repository = options.repository || null;

        this.publisher = options.publisher || null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.auditPublisher =
            options.auditPublisher ||
            null;

        this.clock =
            options.clock ||
            (() => Date.now());

        this.instanceId =
            options.instanceId ||
            this.generateInstanceId();

        this.startedAt = new Date();

        this.processing = new Map();

        this.statistics = {
            discovered: 0,
            attempted: 0,
            restored: 0,
            failed: 0,
            skipped: 0,
            repositoryFailures: 0,
            publisherFailures: 0,
            validationFailures: 0,
            maxAttemptFailures: 0
        };

        this.validateDependencies();
        this.normalizeConfiguration();
    }

    /**
     * ========================================================================
     * Configuration
     * ========================================================================
     */

    normalizeConfiguration() {
        this.config = Object.freeze({
            ...this.config,

            batchSize: clamp(
                toPositiveInteger(
                    this.config.batchSize,
                    DEFAULTS.batchSize
                ),
                1,
                10000
            ),

            concurrency: clamp(
                toPositiveInteger(
                    this.config.concurrency,
                    DEFAULTS.concurrency
                ),
                1,
                100
            ),

            maxAttempts: clamp(
                toPositiveInteger(
                    this.config.maxAttempts,
                    DEFAULTS.maxAttempts
                ),
                1,
                1000
            ),

            processingTimeoutMs: clamp(
                toPositiveInteger(
                    this.config.processingTimeoutMs,
                    DEFAULTS.processingTimeoutMs
                ),
                1000,
                3600000
            ),

            staleProcessingTimeoutMs: clamp(
                toPositiveInteger(
                    this.config.staleProcessingTimeoutMs,
                    DEFAULTS.staleProcessingTimeoutMs
                ),
                1000,
                86400000
            )
        });
    }

    /**
     * ========================================================================
     * Dependency Validation
     * ========================================================================
     */

    validateDependencies() {
        if (!this.repository) {
            throw createError(
                ERROR_CODES.MISSING_REPOSITORY,
                'Transaction dead-letter repository is required'
            );
        }

        if (!this.publisher) {
            throw createError(
                ERROR_CODES.MISSING_PUBLISHER,
                'Transaction dead-letter publisher is required'
            );
        }

        if (
            typeof this.repository.findDeadLetters !== 'function'
        ) {
            throw createError(
                ERROR_CODES.MISSING_REPOSITORY,
                'Repository must implement findDeadLetters(limit, options)'
            );
        }

        if (
            typeof this.publisher.publishRecord !== 'function'
        ) {
            throw createError(
                ERROR_CODES.MISSING_PUBLISHER,
                'Publisher must implement publishRecord(message)'
            );
        }
    }

    /**
     * ========================================================================
     * Instance Identity
     * ========================================================================
     */

    generateInstanceId() {
        return [
            'dlq-processor',
            process.pid,
            Date.now(),
            crypto.randomBytes(6).toString('hex')
        ].join('-');
    }

    getIdentity() {
        return Object.freeze({
            instanceId: this.instanceId,
            processId: process.pid,
            service:
                process.env.SERVICE_NAME ||
                'transaction-service',
            environment:
                process.env.NODE_ENV ||
                'development',
            startedAt: this.startedAt
        });
    }

    /**
     * ========================================================================
     * Main Processing Entry Point
     * ========================================================================
     *
     * Maintains compatibility with:
     *
     * processor.process(100)
     *
     * while also allowing:
     *
     * processor.process({
     *     limit: 100,
     *     tenantId: 'tenant-id'
     * })
     */

    async process(limitOrOptions = this.config.batchSize) {
        const options =
            this.normalizeProcessOptions(
                limitOrOptions
            );

        const startedAt = this.clock();

        let messages;

        try {
            messages =
                await this.findDeadLetters(options);
        } catch (error) {
            this.statistics.repositoryFailures++;

            this.logError(
                'Failed to discover dead-letter records',
                error,
                options
            );

            throw this.wrapRepositoryError(error);
        }

        const safeMessages =
            Array.isArray(messages)
                ? messages
                : [];

        this.statistics.discovered +=
            safeMessages.length;

        if (safeMessages.length === 0) {
            return this.createBatchResult({
                options,
                startedAt,
                results: []
            });
        }

        const results =
            await this.processBatch(
                safeMessages,
                options
            );

        return this.createBatchResult({
            options,
            startedAt,
            results
        });
    }

    /**
     * ========================================================================
     * Normalize Process Options
     * ========================================================================
     */

    normalizeProcessOptions(input) {
        if (
            typeof input === 'number' ||
            typeof input === 'string'
        ) {
            return {
                limit: clamp(
                    toPositiveInteger(
                        input,
                        this.config.batchSize
                    ),
                    1,
                    this.config.batchSize
                )
            };
        }

        if (!isObject(input)) {
            return {
                limit: this.config.batchSize
            };
        }

        return {
            limit: clamp(
                toPositiveInteger(
                    input.limit,
                    this.config.batchSize
                ),
                1,
                this.config.batchSize
            ),

            tenantId:
                input.tenantId || null,

            correlationId:
                input.correlationId ||
                this.generateCorrelationId(),

            dryRun:
                input.dryRun === true,

            concurrency: clamp(
                toPositiveInteger(
                    input.concurrency,
                    this.config.concurrency
                ),
                1,
                this.config.concurrency
            ),

            maxAttempts: clamp(
                toPositiveInteger(
                    input.maxAttempts,
                    this.config.maxAttempts
                ),
                1,
                this.config.maxAttempts
            ),

            continueOnError:
                input.continueOnError ??
                this.config.continueOnError
        };
    }

    /**
     * ========================================================================
     * Correlation Identity
     * ========================================================================
     */

    generateCorrelationId() {
        return [
            'corr',
            Date.now(),
            crypto.randomBytes(6).toString('hex')
        ].join('-');
    }

    /**
     * ========================================================================
     * Dead Letter Discovery
     * ========================================================================
     */

    async findDeadLetters(options) {
        const repositoryOptions = {
            tenantId: options.tenantId || undefined,

            state:
                PROCESSING_STATES.PENDING,

            processorId:
                this.instanceId
        };

        return this.repository.findDeadLetters(
            options.limit,
            repositoryOptions
        );
    }

    /**
     * ========================================================================
     * Batch Processing
     * ========================================================================
     */

    async processBatch(messages, options) {
        const results = [];

        const concurrency =
            Math.min(
                options.concurrency,
                messages.length
            );

        let cursor = 0;

        const worker = async () => {
            while (true) {
                const index = cursor++;

                if (index >= messages.length) {
                    return;
                }

                const message = messages[index];

                try {
                    const result =
                        await this.processMessage(
                            message,
                            options
                        );

                    results[index] = result;
                } catch (error) {
                    results[index] =
                        this.createFailureResult(
                            message,
                            error
                        );

                    if (
                        !options.continueOnError
                    ) {
                        throw error;
                    }
                }
            }
        };

        const workers =
            Array.from(
                { length: concurrency },
                () => worker()
            );

        await Promise.all(workers);

        return results;
    }

    /**
     * ========================================================================
     * Individual Message Processing
     * ========================================================================
     */

    async processMessage(message, options = {}) {
        const startedAt = this.clock();

        this.statistics.attempted++;

        let normalized;

        try {
            normalized =
                this.validateMessage(
                    message
                );
        } catch (error) {
            this.statistics.validationFailures++;

            return this.handleValidationFailure(
                message,
                error
            );
        }

        const messageId =
            normalized.id;

        const tenantId =
            normalized.tenantId;

        const processingKey =
            this.createProcessingKey(
                tenantId,
                messageId
            );

        /**
         * ---------------------------------------------------------------
         * Local concurrency guard
         * ---------------------------------------------------------------
         */

        if (
            this.processing.has(
                processingKey
            )
        ) {
            const error =
                createError(
                    ERROR_CODES.PROCESSING_CONFLICT,
                    'Dead-letter record is already being processed',
                    {
                        messageId,
                        tenantId
                    }
                );

            this.statistics.skipped++;

            return {
                id: messageId,
                tenantId,
                restored: false,
                status: RESULT_STATUS.SKIPPED,
                error: error.message,
                errorCode: error.code,
                durationMs:
                    this.clock() -
                    startedAt
            };
        }

        /**
         * ---------------------------------------------------------------
         * Attempt validation
         * ---------------------------------------------------------------
         */

        const attempts =
            normalized.attempts;

        if (
            attempts >=
            options.maxAttempts
        ) {
            this.statistics.maxAttemptFailures++;

            const error =
                createError(
                    ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
                    'Dead-letter record exceeded maximum restoration attempts',
                    {
                        messageId,
                        attempts,
                        maxAttempts:
                            options.maxAttempts
                    }
                );

            await this.markFailedSafely(
                normalized,
                error
            );

            return {
                id: messageId,
                tenantId,
                restored: false,
                status: RESULT_STATUS.FAILED,
                error: error.message,
                errorCode: error.code,
                attempts,
                durationMs:
                    this.clock() -
                    startedAt
            };
        }

        /**
         * ---------------------------------------------------------------
         * Already restored guard
         * ---------------------------------------------------------------
         */

        if (
            normalized.state ===
            PROCESSING_STATES.RESTORED
        ) {
            this.statistics.skipped++;

            return {
                id: messageId,
                tenantId,
                restored: true,
                status: RESULT_STATUS.SKIPPED,
                reason:
                    ERROR_CODES.ALREADY_RESTORED,
                attempts,
                durationMs:
                    this.clock() -
                    startedAt
            };
        }

        this.processing.set(
            processingKey,
            {
                messageId,
                tenantId,
                startedAt: new Date(),
                processorId: this.instanceId
            }
        );

        try {
            /**
             * -----------------------------------------------------------
             * Claim record
             * -----------------------------------------------------------
             */

            if (!options.dryRun) {
                await this.claimMessage(
                    normalized
                );
            }

            /**
             * -----------------------------------------------------------
             * Audit processing start
             * -----------------------------------------------------------
             */

            await this.publishAudit(
                'transaction.dlq.processing_started',
                {
                    messageId,
                    tenantId,
                    attempts,
                    correlationId:
                        options.correlationId
                }
            );

            /**
             * -----------------------------------------------------------
             * Publish / restore record
             * -----------------------------------------------------------
             */

            if (!options.dryRun) {
                await this.publishWithTimeout(
                    normalized
                );
            }

            /**
             * -----------------------------------------------------------
             * Mark restored
             * -----------------------------------------------------------
             */

            if (
                !options.dryRun &&
                this.config.markRestored
            ) {
                await this.markRestoredSafely(
                    normalized
                );
            }

            this.statistics.restored++;

            await this.publishAudit(
                'transaction.dlq.restored',
                {
                    messageId,
                    tenantId,
                    attempts:
                        attempts + 1,
                    correlationId:
                        options.correlationId
                }
            );

            this.incrementMetric(
                'transaction.dlq.restored'
            );

            return {
                id: messageId,
                tenantId,
                restored: true,
                status: RESULT_STATUS.RESTORED,
                attempts:
                    attempts + 1,
                dryRun:
                    options.dryRun,
                durationMs:
                    this.clock() -
                    startedAt
            };
        } catch (error) {
            this.statistics.failed++;

            if (
                this.isPublisherFailure(error)
            ) {
                this.statistics.publisherFailures++;
            }

            await this.handleProcessingFailure(
                normalized,
                error
            );

            this.incrementMetric(
                'transaction.dlq.failed'
            );

            const result =
                this.createFailureResult(
                    normalized,
                    error
                );

            result.durationMs =
                this.clock() -
                startedAt;

            return result;
        } finally {
            this.processing.delete(
                processingKey
            );
        }
    }

    /**
     * ========================================================================
     * Message Validation
     * ========================================================================
     */

    validateMessage(message) {
        if (!isObject(message)) {
            throw createError(
                ERROR_CODES.INVALID_MESSAGE,
                'Dead-letter message must be an object'
            );
        }

        const id =
            message.id ||
            message._id ||
            message.messageId ||
            message.eventId;

        if (!id) {
            throw createError(
                ERROR_CODES.INVALID_MESSAGE,
                'Dead-letter message ID is required'
            );
        }

        const tenantId =
            message.tenantId ||
            message.tenant?.id ||
            null;

        if (
            this.config.strictValidation &&
            !tenantId
        ) {
            throw createError(
                ERROR_CODES.INVALID_MESSAGE,
                'tenantId is required for dead-letter processing',
                { id }
            );
        }

        const attempts =
            Number.isFinite(
                Number(message.attempts)
            )
                ? Number(message.attempts)
                : Number(message.retryCount || 0);

        return {
            ...message,

            id: String(id),

            tenantId,

            attempts: Math.max(
                0,
                attempts
            ),

            state:
                message.state ||
                PROCESSING_STATES.PENDING
        };
    }

    /**
     * ========================================================================
     * Processing Key
     * ========================================================================
     */

    createProcessingKey(tenantId, messageId) {
        return [
            tenantId || 'global',
            messageId
        ].join(':');
    }

    /**
     * ========================================================================
     * Claim Message
     * ========================================================================
     */

    async claimMessage(message) {
        if (
            typeof this.repository.claim ===
            'function'
        ) {
            const claimed =
                await this.repository.claim({
                    id: message.id,
                    tenantId: message.tenantId,
                    processorId:
                        this.instanceId,
                    state:
                        PROCESSING_STATES.PROCESSING,
                    processingAt:
                        new Date()
                });

            if (claimed === false) {
                throw createError(
                    ERROR_CODES.PROCESSING_CONFLICT,
                    'Dead-letter record could not be claimed',
                    {
                        id: message.id,
                        tenantId:
                            message.tenantId
                    }
                );
            }
        }
    }

    /**
     * ========================================================================
     * Publish With Timeout
     * ========================================================================
     */

    async publishWithTimeout(message) {
        const timeout =
            this.config.processingTimeoutMs;

        let timer;

        const timeoutPromise =
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(
                        createError(
                            ERROR_CODES.PROCESSING_TIMEOUT,
                            'Dead-letter publication timed out',
                            {
                                id: message.id,
                                timeoutMs:
                                    timeout
                            }
                        )
                    );
                }, timeout);
            });

        try {
            return await Promise.race([
                this.publisher.publishRecord(
                    message
                ),
                timeoutPromise
            ]);
        } catch (error) {
            if (
                error?.code ===
                ERROR_CODES.PROCESSING_TIMEOUT
            ) {
                throw error;
            }

            throw createError(
                ERROR_CODES.PUBLISH_FAILED,
                error?.message ||
                    'Dead-letter publication failed',
                {
                    id: message.id,
                    causeCode:
                        error?.code
                }
            );
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * ========================================================================
     * Mark Restored
     * ========================================================================
     */

    async markRestoredSafely(message) {
        if (
            typeof this.repository.markRestored !==
            'function'
        ) {
            return;
        }

        try {
            await this.repository.markRestored({
                id: message.id,
                tenantId: message.tenantId,
                processorId:
                    this.instanceId,
                restoredAt:
                    new Date(),
                state:
                    PROCESSING_STATES.RESTORED
            });
        } catch (error) {
            this.logError(
                'Failed to mark dead-letter record as restored',
                error,
                {
                    messageId:
                        message.id,
                    tenantId:
                        message.tenantId
                }
            );

            throw createError(
                ERROR_CODES.REPOSITORY_FAILURE,
                'Dead-letter record was published but restoration state could not be persisted',
                {
                    id: message.id,
                    causeCode:
                        error?.code
                }
            );
        }
    }

    /**
     * ========================================================================
     * Failure Handling
     * ========================================================================
     */

    async handleProcessingFailure(
        message,
        error
    ) {
        const nextAttempt =
            message.attempts + 1;

        const retryAllowed =
            this.config.allowRetry &&
            nextAttempt <
                this.config.maxAttempts;

        const retryAt =
            retryAllowed
                ? new Date(
                      this.clock() +
                          this.calculateBackoff(
                              nextAttempt
                          )
                  )
                : null;

        if (
            this.config.markFailed
        ) {
            await this.markFailedSafely(
                message,
                error,
                {
                    attempts:
                        nextAttempt,
                    retryAllowed,
                    retryAt
                }
            );
        }

        await this.publishAudit(
            'transaction.dlq.processing_failed',
            {
                messageId:
                    message.id,
                tenantId:
                    message.tenantId,
                attempts:
                    nextAttempt,
                retryAllowed,
                retryAt,
                errorCode:
                    error?.code,
                error:
                    error?.message
            }
        );
    }

    /**
     * ========================================================================
     * Mark Failed
     * ========================================================================
     */

    async markFailedSafely(
        message,
        error,
        metadata = {}
    ) {
        if (
            typeof this.repository.markFailed !==
            'function'
        ) {
            return;
        }

        try {
            await this.repository.markFailed({
                id: message.id,
                tenantId: message.tenantId,
                processorId:
                    this.instanceId,
                state:
                    metadata.retryAllowed
                        ? PROCESSING_STATES.PENDING
                        : PROCESSING_STATES.FAILED,
                attempts:
                    metadata.attempts ??
                    message.attempts + 1,
                retryAllowed:
                    metadata.retryAllowed ??
                    false,
                retryAt:
                    metadata.retryAt ||
                    null,
                error: {
                    code:
                        error?.code ||
                        'DLQ_PROCESSING_ERROR',
                    message:
                        error?.message ||
                        'Unknown dead-letter processing error'
                },
                failedAt:
                    new Date()
            });
        } catch (repositoryError) {
            this.statistics.repositoryFailures++;

            this.logError(
                'Failed to persist dead-letter failure state',
                repositoryError,
                {
                    messageId:
                        message.id,
                    tenantId:
                        message.tenantId
                }
            );
        }
    }

    /**
     * ========================================================================
     * Validation Failure
     * ========================================================================
     */

    async handleValidationFailure(
        message,
        error
    ) {
        const id =
            message?.id ||
            message?._id ||
            message?.messageId ||
            null;

        const tenantId =
            message?.tenantId ||
            null;

        if (
            id &&
            this.config.markFailed
        ) {
            await this.markFailedSafely(
                {
                    id,
                    tenantId,
                    attempts:
                        Number(
                            message?.attempts ||
                                0
                        )
                },
                error
            );
        }

        return {
            id,
            tenantId,
            restored: false,
            status:
                RESULT_STATUS.FAILED,
            error:
                error.message,
            errorCode:
                error.code ||
                ERROR_CODES.INVALID_MESSAGE
        };
    }

    /**
     * ========================================================================
     * Backoff Calculation
     * ========================================================================
     */

    calculateBackoff(attempt) {
        const exponent =
            Math.max(
                0,
                attempt - 1
            );

        const delay =
            this.config.retryBaseDelayMs *
            Math.pow(2, exponent);

        return Math.min(
            delay,
            this.config.retryMaxDelayMs
        );
    }

    /**
     * ========================================================================
     * Failure Result
     * ========================================================================
     */

    createFailureResult(
        message,
        error
    ) {
        return {
            id:
                message?.id ||
                message?._id ||
                null,

            tenantId:
                message?.tenantId ||
                null,

            restored: false,

            status:
                RESULT_STATUS.FAILED,

            error:
                error?.message ||
                'Unknown processing error',

            errorCode:
                error?.code ||
                ERROR_CODES.PUBLISH_FAILED
        };
    }

    /**
     * ========================================================================
     * Error Classification
     * ========================================================================
     */

    isPublisherFailure(error) {
        return (
            error?.code ===
                ERROR_CODES.PUBLISH_FAILED ||
            error?.code ===
                ERROR_CODES.PROCESSING_TIMEOUT
        );
    }

    wrapRepositoryError(error) {
        return createError(
            ERROR_CODES.REPOSITORY_FAILURE,
            error?.message ||
                'Dead-letter repository operation failed',
            {
                causeCode:
                    error?.code
            }
        );
    }

    /**
     * ========================================================================
     * Audit Publisher
     * ========================================================================
     */

    async publishAudit(
        eventType,
        payload
    ) {
        if (
            !this.config.auditEnabled ||
            !this.auditPublisher
        ) {
            return;
        }

        try {
            if (
                typeof this.auditPublisher.publish ===
                'function'
            ) {
                await this.auditPublisher.publish({
                    eventType,
                    payload,
                    source:
                        this.instanceId,
                    timestamp:
                        new Date()
                });

                return;
            }

            if (
                typeof this.auditPublisher.publishEvent ===
                'function'
            ) {
                await this.auditPublisher.publishEvent({
                    eventType,
                    payload,
                    source:
                        this.instanceId,
                    timestamp:
                        new Date()
                });
            }
        } catch (error) {
            /**
             * Audit failure must not corrupt DLQ recovery.
             *
             * Operationally it is logged and counted, but the original
             * recovery result remains authoritative.
             */

            this.incrementMetric(
                'transaction.dlq.audit_failure'
            );

            this.logError(
                'DLQ audit publication failed',
                error,
                {
                    eventType
                }
            );
        }
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    incrementMetric(
        metric,
        value = 1
    ) {
        if (
            !this.config.metricsEnabled ||
            !this.metrics
        ) {
            return;
        }

        try {
            if (
                typeof this.metrics.increment ===
                'function'
            ) {
                this.metrics.increment(
                    metric,
                    value
                );
            }
        } catch (error) {
            this.logError(
                'DLQ metric emission failed',
                error,
                { metric }
            );
        }
    }

    /**
     * ========================================================================
     * Batch Result
     * ========================================================================
     */

    createBatchResult({
        options,
        startedAt,
        results
    }) {
        const restored =
            results.filter(
                item =>
                    item?.status ===
                    RESULT_STATUS.RESTORED
            ).length;

        const failed =
            results.filter(
                item =>
                    item?.status ===
                    RESULT_STATUS.FAILED
            ).length;

        const skipped =
            results.filter(
                item =>
                    item?.status ===
                    RESULT_STATUS.SKIPPED
            ).length;

        return {
            success:
                failed === 0,

            processorId:
                this.instanceId,

            correlationId:
                options.correlationId ||
                null,

            tenantId:
                options.tenantId ||
                null,

            requested:
                options.limit,

            processed:
                results.length,

            restored,

            failed,

            skipped,

            dryRun:
                options.dryRun === true,

            durationMs:
                this.clock() -
                startedAt,

            results,

            timestamp:
                new Date()
        };
    }

    /**
     * ========================================================================
     * Health
     * ========================================================================
     */

    getHealth() {
        return {
            status: 'UP',

            ready:
                Boolean(
                    this.repository &&
                    this.publisher
                ),

            processorId:
                this.instanceId,

            activeProcessing:
                this.processing.size,

            statistics: {
                ...this.statistics
            },

            uptimeMs:
                this.clock() -
                this.startedAt.getTime(),

            timestamp:
                new Date()
        };
    }

    /**
     * ========================================================================
     * Statistics
     * ========================================================================
     */

    getStatistics() {
        return Object.freeze({
            ...this.statistics
        });
    }

    /**
     * ========================================================================
     * Active Processing
     * ========================================================================
     */

    getActiveProcessing() {
        return Array.from(
            this.processing.values()
        ).map(item => ({
            ...item
        }));
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    logError(
        message,
        error,
        metadata = {}
    ) {
        try {
            if (
                typeof this.logger.error ===
                'function'
            ) {
                this.logger.error(
                    {
                        processorId:
                            this.instanceId,
                        error:
                            error?.message,
                        errorCode:
                            error?.code,
                        stack:
                            error?.stack,
                        ...metadata
                    },
                    message
                );

                return;
            }

            if (
                typeof this.logger.log ===
                'function'
            ) {
                this.logger.log(
                    message,
                    error,
                    metadata
                );
            }
        } catch (_) {
            /**
             * Logging must never interfere with transaction recovery.
             */
        }
    }

    /**
     * ========================================================================
     * Graceful Shutdown
     * ========================================================================
     */

    async shutdown(options = {}) {
        const timeoutMs =
            toPositiveInteger(
                options.timeoutMs,
                30000
            );

        const startedAt =
            this.clock();

        while (
            this.processing.size > 0 &&
            this.clock() - startedAt <
                timeoutMs
        ) {
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        50
                    )
            );
        }

        return {
            processorId:
                this.instanceId,

            drained:
                this.processing.size === 0,

            activeProcessing:
                this.processing.size,

            timestamp:
                new Date()
        };
    }
}

module.exports =
    TransactionDeadLetterProcessor;