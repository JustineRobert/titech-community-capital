'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Publishing Engine
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 * - Discover pending transaction events
 * - Resolve event destinations
 * - Generate deterministic idempotency keys
 * - Publish events to the configured event bus
 * - Persist publication state
 * - Prevent process-local duplicate publication
 * - Support durable repository-level idempotency
 * - Retry transient publishing failures
 * - Record publication metrics
 * - Preserve tenant and aggregate routing
 * - Maintain transaction event observability
 *
 * Supported Event Infrastructure
 * ----------------------------------------------------------------------------
 *
 * - Kafka
 * - RabbitMQ
 * - Redis Streams
 * - AWS SNS/SQS
 *
 * Delivery Model
 * ----------------------------------------------------------------------------
 *
 * This engine provides:
 *
 * - At-least-once delivery
 * - Durable publication state
 * - Idempotency protection
 * - Safe retry handling
 * - Process-local duplicate suppression
 *
 * NOTE:
 *
 * True distributed exactly-once delivery cannot be guaranteed merely by using
 * an in-memory Set. The durable repository must enforce a unique idempotency
 * key and publication state atomically.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Publishing States
 * ============================================================================
 */

const PUBLISH_STATE = Object.freeze({

    PENDING:
        'PENDING',

    PUBLISHING:
        'PUBLISHING',

    PUBLISHED:
        'PUBLISHED',

    FAILED:
        'FAILED'

});


/**
 * ============================================================================
 * Transaction Publishing Engine
 * ============================================================================
 */

class TransactionPublishingEngine {


    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {

        this.repository =
            options.repository;


        this.router =
            options.router;


        this.eventBus =
            options.eventBus;


        this.logger =
            options.logger ||
            console;


        this.metrics =
            options.metrics ||
            null;


        this.batchSize =
            this.normalizePositiveInteger(
                options.batchSize,
                100
            );


        this.maxRetries =
            this.normalizeNonNegativeInteger(
                options.maxRetries,
                3
            );


        this.retryDelayMs =
            this.normalizeNonNegativeInteger(
                options.retryDelayMs,
                250
            );


        this.maxRetryDelayMs =
            this.normalizeNonNegativeInteger(
                options.maxRetryDelayMs,
                5000
            );


        this.retryBackoffMultiplier =
            Number.isFinite(
                Number(
                    options.retryBackoffMultiplier
                )
            )
                ? Math.max(
                    1,
                    Number(
                        options.retryBackoffMultiplier
                    )
                )
                : 2;


        this.markPublishing =
            options.markPublishing !== false;


        this.processedKeys =
            new Set();


        this.processingKeys =
            new Set();


        this.validateDependencies();

    }


    /**
     * =========================================================================
     * Publish Pending Events
     * =========================================================================
     *
     * Processes one bounded batch of pending events.
     *
     * By default, one failed event does not prevent the remaining records from
     * being attempted.
     *
     * @returns {Promise<Object>}
     */

    async publishPending() {

        const events =
            await this.repository.findPending(
                this.batchSize
            );


        if (
            !Array.isArray(events) ||
            events.length === 0
        ) {

            return {

                published:
                    0,

                failed:
                    0,

                skipped:
                    0,

                total:
                    0

            };

        }


        const results = [];

        for (
            const record
            of events
        ) {

            try {

                const result =
                    await this.publishRecord(
                        record
                    );


                results.push(
                    result
                );

            }

            catch (error) {

                results.push({

                    success:
                        false,

                    failed:
                        true,

                    recordId:
                        record?.id ||
                        record?._id ||
                        null,

                    error

                });

            }

        }


        const published =
            results.filter(
                result =>
                    result === true ||
                    result?.published === true
            ).length;


        const skipped =
            results.filter(
                result =>
                    result?.skipped === true
            ).length;


        const failed =
            results.filter(
                result =>
                    result?.failed === true
            ).length;


        this.incrementMetric(
            'transaction_events_publish_batch_total',
            1
        );


        this.incrementMetric(
            'transaction_events_published_total',
            published
        );


        this.incrementMetric(
            'transaction_events_failed_total',
            failed
        );


        return {

            published,

            failed,

            skipped,

            total:
                events.length

        };

    }


    /**
     * =========================================================================
     * Publish Single Record
     * =========================================================================
     *
     * @param {Object} record
     * @returns {Promise<Object|Boolean>}
     */

    async publishRecord(record) {

        this.validateRecord(
            record
        );


        const event =
            record.event;


        const idempotencyKey =
            this.createIdempotencyKey(
                event
            );


        /**
         * Process-local duplicate protection.
         */

        if (
            this.processedKeys.has(
                idempotencyKey
            )
        ) {

            this.incrementMetric(
                'transaction_events_duplicate_skipped_total',
                1
            );


            return {

                published:
                    false,

                skipped:
                    true,

                reason:
                    'PROCESS_LOCAL_DUPLICATE',

                idempotencyKey

            };

        }


        /**
         * Prevent concurrent duplicate processing inside the same process.
         */

        if (
            this.processingKeys.has(
                idempotencyKey
            )
        ) {

            this.incrementMetric(
                'transaction_events_concurrent_duplicate_total',
                1
            );


            return {

                published:
                    false,

                skipped:
                    true,

                reason:
                    'CONCURRENT_PROCESSING',

                idempotencyKey

            };

        }


        this.processingKeys.add(
            idempotencyKey
        );


        try {

            /**
             * Durable idempotency check.
             *
             * Repository implementations may expose:
             *
             * hasPublished(idempotencyKey)
             * findByIdempotencyKey(idempotencyKey)
             *
             * The engine supports either without requiring the repository
             * implementation to expose both.
             */

            const alreadyPublished =
                await this.isDurablyPublished(
                    record,
                    idempotencyKey
                );


            if (alreadyPublished) {

                this.processedKeys.add(
                    idempotencyKey
                );


                this.incrementMetric(
                    'transaction_events_duplicate_skipped_total',
                    1
                );


                return {

                    published:
                        false,

                    skipped:
                        true,

                    reason:
                        'DURABLE_DUPLICATE',

                    idempotencyKey

                };

            }


            /**
             * Resolve destination.
             */

            const route =
                this.router.resolve(
                    event
                );


            const routingMetadata =
                this.resolveRoutingMetadata(
                    event,
                    route
                );


            const message =
                this.buildMessage(
                    event,
                    route,
                    routingMetadata,
                    idempotencyKey
                );


            /**
             * Move the record into PUBLISHING state where supported.
             *
             * This is an optimization for distributed workers. The repository
             * should implement this atomically where possible.
             */

            if (
                this.markPublishing
            ) {

                await this.markAsPublishing(
                    record,
                    idempotencyKey
                );

            }


            this.logDebug(
                'Publishing transaction event',
                {

                    eventId:
                        event.eventId,

                    recordId:
                        this.getRecordId(
                            record
                        ),

                    tenantId:
                        event.tenantId,

                    eventType:
                        event.eventType,

                    topic:
                        message.topic,

                    idempotencyKey

                }
            );


            const publishResult =
                await this.publishWithRetry(
                    message,
                    event,
                    idempotencyKey
                );


            /**
             * Publication succeeded.
             *
             * Repository persistence is deliberately performed after the
             * event bus acknowledges the publication.
             */

            await this.repository.markPublished(

                this.getRecordId(
                    record
                ),

                {

                    idempotencyKey,

                    publishedAt:
                        new Date(),

                    topic:
                        message.topic,

                    routingKey:
                        message.key || null,

                    provider:
                        route.provider ||
                        null

                }

            );


            this.processedKeys.add(
                idempotencyKey
            );


            this.incrementMetric(
                'transaction_events_published_total',
                1
            );


            this.logInfo(
                'Transaction event published',
                {

                    eventId:
                        event.eventId,

                    recordId:
                        this.getRecordId(
                            record
                        ),

                    tenantId:
                        event.tenantId,

                    eventType:
                        event.eventType,

                    topic:
                        message.topic,

                    idempotencyKey

                }
            );


            return {

                published:
                    true,

                skipped:
                    false,

                idempotencyKey,

                messageId:
                    publishResult?.messageId ||
                    publishResult?.id ||
                    event.eventId,

                result:
                    publishResult

            };

        }

        catch (error) {

            this.incrementMetric(
                'transaction_events_publish_failures_total',
                1
            );


            this.logError(
                'Transaction event publication failed',
                error,
                {

                    eventId:
                        event.eventId,

                    recordId:
                        this.getRecordId(
                            record
                        ),

                    tenantId:
                        event.tenantId,

                    eventType:
                        event.eventType,

                    idempotencyKey

                }
            );


            await this.markPublicationFailed(
                record,
                error,
                idempotencyKey
            );


            throw error;

        }

        finally {

            this.processingKeys.delete(
                idempotencyKey
            );

        }

    }


    /**
     * =========================================================================
     * Build Event Bus Message
     * =========================================================================
     */

    buildMessage(
        event,
        route,
        routingMetadata,
        idempotencyKey
    ) {

        const aggregateKey =
            routingMetadata.aggregateRoutingKey ||
            null;


        const tenantKey =
            routingMetadata.tenantRoutingKey ||
            null;


        const routingKey =
            aggregateKey ||
            tenantKey ||
            routingMetadata.routingKey ||
            null;


        return {

            id:
                event.eventId,


            eventId:
                event.eventId,


            eventType:
                event.eventType,


            eventVersion:
                event.eventVersion || 1,


            topic:
                route.topic,


            route:
                route.route || null,


            key:
                routingKey,


            partitionKey:
                aggregateKey ||
                tenantKey ||
                routingKey,


            tenant:
                event.tenantId || null,


            tenantId:
                event.tenantId || null,


            aggregate:
                event.aggregate || null,


            provider:
                route.provider ||
                routingMetadata.provider ||
                null,


            idempotencyKey,


            publishedAt:
                new Date().toISOString(),


            metadata: {

                tenantRoutingKey:
                    tenantKey,

                aggregateRoutingKey:
                    aggregateKey,

                routingKey,

                eventType:
                    event.eventType,

                eventVersion:
                    event.eventVersion || 1

            },


            payload:
                event

        };

    }


    /**
     * =========================================================================
     * Routing Metadata
     * =========================================================================
     */

    resolveRoutingMetadata(
        event,
        route
    ) {

        const aggregateRoutingKey =
            this.router.aggregateRoutingKey(
                event
            );


        const tenantRoutingKey =
            typeof this.router.tenantRoutingKey ===
            'function'
                ? this.router.tenantRoutingKey(
                    event
                )
                : null;


        const routingKey =
            typeof this.router.resolvePartitionKey ===
            'function'
                ? this.router.resolvePartitionKey(
                    event
                )
                : (
                    aggregateRoutingKey ||
                    tenantRoutingKey ||
                    null
                );


        const provider =
            event.provider ||
            event.providerId ||
            null;


        return {

            aggregateRoutingKey,

            tenantRoutingKey,

            routingKey,

            provider,

            topic:
                route.topic

        };

    }


    /**
     * =========================================================================
     * Publish With Retry
     * =========================================================================
     */

    async publishWithRetry(
        message,
        event,
        idempotencyKey
    ) {

        let attempt = 0;

        let lastError = null;


        while (
            attempt <= this.maxRetries
        ) {

            try {

                attempt += 1;


                this.incrementMetric(
                    'transaction_events_publish_attempts_total',
                    1
                );


                const result =
                    await this.eventBus.publish(
                        message
                    );


                return result;

            }

            catch (error) {

                lastError =
                    error;


                const retryable =
                    this.isRetryableError(
                        error
                    );


                if (
                    !retryable ||
                    attempt > this.maxRetries
                ) {

                    throw error;

                }


                const delay =
                    this.calculateRetryDelay(
                        attempt
                    );


                this.logWarn(
                    'Retrying transaction event publication',
                    {

                        eventId:
                            event.eventId,

                        eventType:
                            event.eventType,

                        idempotencyKey,

                        attempt,

                        maxRetries:
                            this.maxRetries,

                        retryDelayMs:
                            delay

                    }
                );


                await this.sleep(
                    delay
                );

            }

        }


        throw lastError ||
            new Error(
                'Transaction event publication failed'
            );

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    isRetryableError(error) {

        if (!error) {

            return true;

        }


        if (
            error.retryable === true
        ) {

            return true;

        }


        if (
            error.retryable === false
        ) {

            return false;

        }


        const status =
            Number(
                error.status ||
                error.statusCode ||
                error.response?.status
            );


        /**
         * HTTP transient failures.
         */

        if (
            status === 408 ||
            status === 425 ||
            status === 429 ||
            status >= 500
        ) {

            return true;

        }


        const code =
            String(
                error.code ||
                ''
            ).toUpperCase();


        const retryableCodes =
            new Set([

                'ETIMEDOUT',

                'ECONNRESET',

                'ECONNREFUSED',

                'EAI_AGAIN',

                'ENETUNREACH',

                'EPIPE',

                'TIMEOUT',

                'SERVICE_UNAVAILABLE',

                'TEMPORARILY_UNAVAILABLE'

            ]);


        return retryableCodes.has(
            code
        );

    }


    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    calculateRetryDelay(
        attempt
    ) {

        const exponential =
            this.retryDelayMs *
            Math.pow(
                this.retryBackoffMultiplier,
                Math.max(
                    0,
                    attempt - 1
                )
            );


        const bounded =
            Math.min(
                exponential,
                this.maxRetryDelayMs
            );


        /**
         * Small jitter prevents multiple workers from retrying at exactly the
         * same time.
         */

        const jitter =
            Math.floor(
                Math.random() *
                Math.max(
                    1,
                    Math.floor(
                        bounded * 0.2
                    )
                )
            );


        return bounded + jitter;

    }


    /**
     * =========================================================================
     * Durable Publication Check
     * =========================================================================
     */

    async isDurablyPublished(
        record,
        idempotencyKey
    ) {

        if (
            typeof this.repository.hasPublished ===
            'function'
        ) {

            return Boolean(
                await this.repository.hasPublished(
                    idempotencyKey
                )
            );

        }


        if (
            typeof this.repository.findByIdempotencyKey ===
            'function'
        ) {

            const existing =
                await this.repository.findByIdempotencyKey(
                    idempotencyKey
                );


            if (!existing) {

                return false;

            }


            return (
                existing.status ===
                PUBLISH_STATE.PUBLISHED
            );

        }


        /**
         * Fall back to the supplied record's status.
         */

        return (
            record.status ===
            PUBLISH_STATE.PUBLISHED ||
            record.published === true
        );

    }


    /**
     * =========================================================================
     * Mark Publishing
     * =========================================================================
     */

    async markAsPublishing(
        record,
        idempotencyKey
    ) {

        if (
            typeof this.repository.markPublishing ===
            'function'
        ) {

            await this.repository.markPublishing(

                this.getRecordId(
                    record
                ),

                {

                    idempotencyKey,

                    publishingAt:
                        new Date()

                }

            );

        }

    }


    /**
     * =========================================================================
     * Mark Publication Failed
     * =========================================================================
     */

    async markPublicationFailed(
        record,
        error,
        idempotencyKey
    ) {

        try {

            await this.repository.markFailed(

                this.getRecordId(
                    record
                ),

                error,

                {

                    idempotencyKey,

                    failedAt:
                        new Date()

                }

            );

        }

        catch (repositoryError) {

            /**
             * Do not hide the original event-bus failure behind a repository
             * failure.
             */

            this.logError(
                'Failed to persist transaction event failure state',
                repositoryError,
                {

                    recordId:
                        this.getRecordId(
                            record
                        ),

                    idempotencyKey

                }
            );

        }

    }


    /**
     * =========================================================================
     * Idempotency Key
     * =========================================================================
     *
     * Deterministic key based on immutable event identity.
     *
     * Prefer an explicit event.idempotencyKey when supplied.
     */

    createIdempotencyKey(event) {

        if (
            event.idempotencyKey
        ) {

            return String(
                event.idempotencyKey
            );

        }


        const identity = [

            event.eventId ||
                '',

            event.eventVersion ||
                1,

            event.tenantId ||
                '',

            event.eventType ||
                ''

        ].join('|');


        return crypto

            .createHash(
                'sha256'
            )

            .update(
                identity,
                'utf8'
            )

            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Record Validation
     * =========================================================================
     */

    validateRecord(record) {

        if (
            !record ||
            typeof record !== 'object'
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: record must be an object'
            );

        }


        if (
            !record.event ||
            typeof record.event !== 'object'
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: record.event is required'
            );

        }


        if (
            !record.event.eventId
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: event.eventId is required'
            );

        }


        if (
            !this.repository ||
            typeof this.repository.findPending !==
            'function'
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: repository.findPending is required'
            );

        }


        if (
            !this.router ||
            typeof this.router.resolve !==
            'function'
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: router.resolve is required'
            );

        }


        if (
            !this.eventBus ||
            typeof this.eventBus.publish !==
            'function'
        ) {

            throw new TypeError(
                'TransactionPublishingEngine: eventBus.publish is required'
            );

        }

    }


    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        if (!this.repository) {

            throw new TypeError(
                'TransactionPublishingEngine: repository is required'
            );

        }


        if (!this.router) {

            throw new TypeError(
                'TransactionPublishingEngine: router is required'
            );

        }


        if (!this.eventBus) {

            throw new TypeError(
                'TransactionPublishingEngine: eventBus is required'
            );

        }

    }


    /**
     * =========================================================================
     * Record ID
     * =========================================================================
     */

    getRecordId(record) {

        return (
            record.id ||
            record._id ||
            record.event?.eventId
        );

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(milliseconds) {

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
     * Positive Integer Normalization
     * =========================================================================
     */

    normalizePositiveInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);


        if (
            !Number.isInteger(number) ||
            number <= 0
        ) {

            return fallback;

        }


        return number;

    }


    /**
     * =========================================================================
     * Non-Negative Integer Normalization
     * =========================================================================
     */

    normalizeNonNegativeInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);


        if (
            !Number.isInteger(number) ||
            number < 0
        ) {

            return fallback;

        }


        return number;

    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {

        if (
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
                    name,
                    value,
                    labels
                );

                return;

            }


            if (
                typeof this.metrics.inc ===
                'function'
            ) {

                this.metrics.inc(
                    name,
                    value,
                    labels
                );

            }

        }

        catch {

            /**
             * Metrics must never break event publication.
             */

        }

    }


    /**
     * =========================================================================
     * Logger Helpers
     * =========================================================================
     */

    logDebug(
        message,
        data = {}
    ) {

        try {

            if (
                typeof this.logger.debug ===
                'function'
            ) {

                this.logger.debug(
                    message,
                    data
                );

            }

        }

        catch {

            // Logging must never interrupt publication.

        }

    }


    logInfo(
        message,
        data = {}
    ) {

        try {

            if (
                typeof this.logger.info ===
                'function'
            ) {

                this.logger.info(
                    message,
                    data
                );

            }

            else if (
                typeof this.logger.log ===
                'function'
            ) {

                this.logger.log(
                    message,
                    data
                );

            }

        }

        catch {

            // Logging must never interrupt publication.

        }

    }


    logWarn(
        message,
        data = {}
    ) {

        try {

            if (
                typeof this.logger.warn ===
                'function'
            ) {

                this.logger.warn(
                    message,
                    data
                );

            }

        }

        catch {

            // Logging must never interrupt publication.

        }

    }


    logError(
        message,
        error,
        data = {}
    ) {

        try {

            if (
                typeof this.logger.error ===
                'function'
            ) {

                this.logger.error(
                    message,
                    error,
                    data
                );

            }

        }

        catch {

            // Logging must never interrupt publication.

        }

    }


    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            batchSize:
                this.batchSize,

            maxRetries:
                this.maxRetries,

            retryDelayMs:
                this.retryDelayMs,

            maxRetryDelayMs:
                this.maxRetryDelayMs,

            retryBackoffMultiplier:
                this.retryBackoffMultiplier,

            markPublishing:
                this.markPublishing,

            processedKeys:
                this.processedKeys.size,

            processingKeys:
                this.processingKeys.size

        };

    }


}


/**
 * ============================================================================
 * Static State Export
 * ============================================================================
 */

TransactionPublishingEngine.States =
    PUBLISH_STATE;


/**
 * ============================================================================
 * Module Export
 * ============================================================================
 */

module.exports =
    TransactionPublishingEngine;