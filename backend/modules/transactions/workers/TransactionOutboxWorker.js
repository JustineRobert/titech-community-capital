'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Outbox Worker
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/workers/TransactionOutboxWorker.js
 *
 * Purpose
 * -------
 * Durable asynchronous publisher for TransactionOutboxRecord.
 *
 * Lifecycle
 * ---------
 *
 *     PENDING
 *        │
 *        ▼
 *     claim()
 *        │
 *        ▼
 *   PROCESSING
 *        │
 *        ├───────────────┐
 *        ▼               ▼
 *     publish()        failure
 *        │               │
 *        ▼               ▼
 *    complete()       retry/dead-letter
 *        │
 *        ▼
 *    PUBLISHED
 *
 * Responsibilities
 * ----------------
 * • Poll durable outbox
 * • Atomically claim records
 * • Resolve transport routing
 * • Publish events
 * • Renew worker leases
 * • Complete successful deliveries
 * • Schedule retries
 * • Dead-letter exhausted events
 * • Recover expired leases
 * • Bounded concurrency
 * • Graceful shutdown
 * • Metrics
 * • Structured logging
 * • Tracing
 * • Operational health
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Financial transaction execution
 * • Ledger posting
 * • Payment execution
 * • Creating business events
 * • Mutating immutable event payloads
 *
 * ============================================================================
 */


const crypto =
    require('crypto');


/**
 * ============================================================================
 * Status
 * ============================================================================
 */

const WORKER_STATUS = Object.freeze({

    STOPPED:
        'STOPPED',

    STARTING:
        'STARTING',

    RUNNING:
        'RUNNING',

    DRAINING:
        'DRAINING',

    STOPPING:
        'STOPPING',

    DEGRADED:
        'DEGRADED',

    FAILED:
        'FAILED'

});


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_WORKER_INTERVAL_MS =
    1000;

const DEFAULT_BATCH_SIZE =
    50;

const DEFAULT_CONCURRENCY =
    10;

const DEFAULT_LEASE_MS =
    30000;

const DEFAULT_HEARTBEAT_INTERVAL_MS =
    10000;

const DEFAULT_RECOVERY_INTERVAL_MS =
    30000;

const DEFAULT_SHUTDOWN_TIMEOUT_MS =
    30000;

const DEFAULT_IDLE_DELAY_MS =
    250;


/**
 * ============================================================================
 * Safe Error
 * ============================================================================
 */

function safeError(
    error
) {

    if (!error) {

        return {

            name:
                'Error',

            code:
                'UNKNOWN_ERROR',

            message:
                'Unknown error'

        };

    }


    return {

        name:
            error.name ||
            'Error',

        code:
            error.code ||
            null,

        message:
            String(
                error.message ||
                error
            )
                .slice(
                    0,
                    2000
                ),

        retryable:
            error.retryable === true,

        statusCode:
            error.statusCode ||
            null,

        provider:
            error.provider ||
            null,

        providerCode:
            error.providerCode ||
            null

    };

}


/**
 * ============================================================================
 * Transaction Outbox Worker
 * ============================================================================
 */

class TransactionOutboxWorker {

    constructor(
        options = {}
    ) {

        if (
            !options.repository
        ) {

            throw new Error(
                'TransactionOutboxRepository is required'
            );

        }


        if (
            !options.publisher &&
            !options.eventBus &&
            !options.transport
        ) {

            throw new Error(

                'A publisher, eventBus, or transport is required'

            );

        }


        this.repository =
            options.repository;


        this.publisher =
            options.publisher ||
            null;


        this.eventBus =
            options.eventBus ||
            null;


        this.transport =
            options.transport ||
            null;


        this.router =
            options.router ||
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


        this.workerId =
            options.workerId ||

            process.env.HOSTNAME ||

            `outbox-worker-${process.pid}-${crypto
                .randomUUID()
                .slice(
                    0,
                    8
                )}`;


        this.tenantId =
            options.tenantId ||
            null;


        this.intervalMs =
            Number(
                options.intervalMs ||
                DEFAULT_WORKER_INTERVAL_MS
            );


        this.batchSize =
            Number(
                options.batchSize ||
                DEFAULT_BATCH_SIZE
            );


        this.concurrency =
            Math.max(

                1,

                Number(
                    options.concurrency ||
                    DEFAULT_CONCURRENCY
                )

            );


        this.leaseMs =
            Math.max(

                1000,

                Number(
                    options.leaseMs ||
                    DEFAULT_LEASE_MS
                )

            );


        this.heartbeatIntervalMs =
            Math.max(

                500,

                Number(
                    options.heartbeatIntervalMs ||
                    DEFAULT_HEARTBEAT_INTERVAL_MS
                )

            );


        this.recoveryIntervalMs =
            Math.max(

                1000,

                Number(
                    options.recoveryIntervalMs ||
                    DEFAULT_RECOVERY_INTERVAL_MS
                )

            );


        this.shutdownTimeoutMs =
            Math.max(

                1000,

                Number(
                    options.shutdownTimeoutMs ||
                    DEFAULT_SHUTDOWN_TIMEOUT_MS
                )

            );


        this.idleDelayMs =
            Math.max(

                10,

                Number(
                    options.idleDelayMs ||
                    DEFAULT_IDLE_DELAY_MS
                )

            );


        this.autoStart =
            options.autoStart === true;


        this.running =
            false;


        this.status =
            WORKER_STATUS.STOPPED;


        this.stopRequested =
            false;


        this.loopPromise =
            null;


        this.recoveryPromise =
            null;


        this.recoveryTimer =
            null;


        this.activeJobs =
            new Map();


        this.startedAt =
            new Date();


        this.lastPollAt =
            null;


        this.lastSuccessAt =
            null;


        this.lastFailureAt =
            null;


        this.lastRecoveryAt =
            null;


        this.lastError =
            null;


        this.statistics = {

            polls:
                0,

            emptyPolls:
                0,

            claimed:
                0,

            claimConflicts:
                0,

            published:
                0,

            failed:
                0,

            retried:
                0,

            deadLettered:
                0,

            completed:
                0,

            heartbeats:
                0,

            heartbeatFailures:
                0,

            leaseLosses:
                0,

            recoveryCycles:
                0,

            recoveryReleased:
                0,

            recoveryFailures:
                0,

            processingErrors:
                0

        };


        if (
            this.autoStart
        ) {

            this.start()
                .catch(
                    error => {

                        this.logger.error?.({

                            message:
                                'Transaction outbox worker failed to start',

                            workerId:
                                this.workerId,

                            error:
                                safeError(
                                    error
                                )

                        });

                    }
                );

        }

    }


    /**
     * =========================================================================
     * Start Worker
     * =========================================================================
     */

    async start() {

        if (
            this.running
        ) {

            return false;

        }


        if (
            this.status ===
            WORKER_STATUS.DRAINING ||
            this.status ===
            WORKER_STATUS.STOPPING
        ) {

            throw new Error(
                'Transaction outbox worker is stopping'
            );

        }


        this.status =
            WORKER_STATUS.STARTING;


        this.stopRequested =
            false;


        this.running =
            true;


        this.startedAt =
            new Date();


        this.lastError =
            null;


        this.logger.info?.({

            message:
                'Transaction outbox worker starting',

            workerId:
                this.workerId,

            tenantId:
                this.tenantId,

            batchSize:
                this.batchSize,

            concurrency:
                this.concurrency,

            leaseMs:
                this.leaseMs

        });


        this.status =
            WORKER_STATUS.RUNNING;


        this.loopPromise =
            this.runLoop();


        this.startRecoveryScheduler();


        this.metrics?.increment?.(
            'transaction_outbox_worker_started_total'
        );


        return true;

    }


    /**
     * =========================================================================
     * Main Loop
     * =========================================================================
     */

    async runLoop() {

        while (
            !this.stopRequested
        ) {

            let processed =
                0;


            try {

                processed =
                    await this.processBatch();

            }
            catch (error) {

                this.statistics.processingErrors++;


                this.lastFailureAt =
                    new Date();


                this.lastError =
                    safeError(
                        error
                    );


                this.status =
                    WORKER_STATUS.DEGRADED;


                this.logger.error?.({

                    message:
                        'Transaction outbox worker polling cycle failed',

                    workerId:
                        this.workerId,

                    error:
                        safeError(
                            error
                        )

                });


                this.metrics?.increment?.(
                    'transaction_outbox_worker_poll_failure_total'
                );


                /**
                 * A transient repository failure should not permanently kill
                 * the worker.
                 */
                await this.sleep(
                    Math.max(
                        this.intervalMs,
                        this.idleDelayMs
                    )
                );


                if (
                    !this.stopRequested
                ) {

                    this.status =
                        WORKER_STATUS.RUNNING;

                }


                continue;

            }


            if (
                this.stopRequested
            ) {

                break;

            }


            if (
                processed ===
                0
            ) {

                this.statistics.emptyPolls++;


                await this.sleep(
                    this.idleDelayMs
                );

            }
            else {

                /**
                 * Continue immediately when there is more work, rather than
                 * sleeping for the entire polling interval.
                 */
                await this.sleep(
                    this.intervalMs
                );

            }

        }


        this.running =
            false;


        return true;

    }


    /**
     * =========================================================================
     * Process Batch
     * =========================================================================
     */

    async processBatch() {

        this.statistics.polls++;


        this.lastPollAt =
            new Date();


        const records =
            await this.repository.claimBatch({

                tenantId:
                    this.tenantId,

                workerId:
                    this.workerId,

                batchSize:
                    Math.max(
                        1,
                        this.batchSize
                    ),

                leaseMs:
                    this.leaseMs

            });


        if (
            !Array.isArray(records) ||
            records.length ===
                0
        ) {

            return 0;

        }


        this.statistics.claimed +=
            records.length;


        this.metrics?.increment?.(

            'transaction_outbox_claimed_total',

            {

                count:
                    records.length

            }

        );


        const queue =
            [...records];


        const workers =
            Math.min(

                this.concurrency,

                queue.length

            );


        const processingWorkers =
            [];


        for (
            let index = 0;
            index < workers;
            index++
        ) {

            processingWorkers.push(
                this.runQueueWorker(
                    queue
                )
            );

        }


        await Promise.all(
            processingWorkers
        );


        return records.length;

    }


    /**
     * =========================================================================
     * Queue Worker
     * =========================================================================
     */

    async runQueueWorker(
        queue
    ) {

        while (
            queue.length &&
            !this.stopRequested
        ) {

            const record =
                queue.shift();


            if (
                !record
            ) {

                return;

            }


            try {

                await this.processRecord(
                    record
                );

            }
            catch (error) {

                this.statistics.processingErrors++;


                this.logger.error?.({

                    message:
                        'Outbox record processing failed',

                    workerId:
                        this.workerId,

                    eventId:
                        record.eventId,

                    tenantId:
                        record.tenantId,

                    error:
                        safeError(
                            error
                        )

                });

            }

        }

    }


    /**
     * =========================================================================
     * Process One Outbox Record
     * =========================================================================
     */

    async processRecord(
        record
    ) {

        const eventId =
            record.eventId;


        const startedAt =
            Date.now();


        const correlationId =
            record.correlationId ||
            crypto.randomUUID();


        const span =
            this.startSpan(

                'transaction.outbox.publish',

                {

                    eventId,

                    tenantId:
                        record.tenantId,

                    transactionId:
                        record.transactionId,

                    correlationId,

                    eventType:
                        record.eventType

                }

            );


        const job = {

            eventId,

            tenantId:
                record.tenantId,

            correlationId,

            startedAt:
                new Date(),

            leaseLost:
                false,

            heartbeatTimer:
                null

        };


        this.activeJobs.set(
            eventId,
            job
        );


        this.startHeartbeat(
            job
        );


        try {

            /**
             * ---------------------------------------------------------------
             * Route
             * ---------------------------------------------------------------
             */

            const routing =
                this.resolveRouting(
                    record
                );


            /**
             * ---------------------------------------------------------------
             * Immutable event projection
             * ---------------------------------------------------------------
             *
             * We intentionally do not mutate the persisted record.
             */

            const event =
                this.toPublishableEvent(
                    record,
                    routing
                );


            /**
             * ---------------------------------------------------------------
             * Publish
             * ---------------------------------------------------------------
             */

            const publishResult =
                await this.publish(

                    event,

                    routing,

                    {

                        correlationId,

                        tenantId:
                            record.tenantId,

                        transactionId:
                            record.transactionId,

                        eventId

                    }

                );


            /**
             * ---------------------------------------------------------------
             * Verify we still own the lease.
             * ---------------------------------------------------------------
             */

            if (
                job.leaseLost
            ) {

                this.statistics.leaseLosses++;


                throw this.createLeaseLostError(
                    record
                );

            }


            /**
             * ---------------------------------------------------------------
             * Complete durable outbox state.
             * ---------------------------------------------------------------
             */

            await this.repository.complete({

                tenantId:
                    record.tenantId,

                eventId,

                workerId:
                    this.workerId,

                publishedAt:
                    new Date(),

                publishResult

            });


            this.statistics.published++;
            this.statistics.completed++;


            this.lastSuccessAt =
                new Date();


            this.metrics?.increment?.(
                'transaction_outbox_publish_success_total'
            );


            this.metrics?.histogram?.(

                'transaction_outbox_publish_duration_ms',

                Date.now() -
                startedAt

            );


            this.setSpanSuccess(
                span
            );


            return publishResult;

        }
        catch (error) {

            this.statistics.failed++;


            this.lastFailureAt =
                new Date();


            this.lastError =
                safeError(
                    error
                );


            this.metrics?.increment?.(
                'transaction_outbox_publish_failure_total'
            );


            this.setSpanError(
                span,
                error
            );


            /**
             * ---------------------------------------------------------------
             * Lease loss is special.
             * ---------------------------------------------------------------
             *
             * DO NOT attempt to mutate the record after another worker may
             * have acquired the lease.
             */

            if (
                job.leaseLost ||
                error?.code ===
                    'OUTBOX_LEASE_LOST'
            ) {

                this.statistics.leaseLosses++;


                return null;

            }


            await this.handleFailure(
                record,
                error
            );


            return null;

        }
        finally {

            this.stopHeartbeat(
                job
            );


            this.activeJobs.delete(
                eventId
            );


            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Publish Transport
     * =========================================================================
     *
     * Supports:
     *
     * publisher.publish(event, routing)
     *
     * eventBus.publish(event)
     *
     * eventBus.publish({
     *     type,
     *     payload
     * })
     *
     * transport.publish(event, routing)
     */

    async publish(
        event,
        routing,
        context
    ) {

        if (
            this.publisher &&
            typeof this.publisher.publish ===
            'function'
        ) {

            return this.publisher.publish(

                event,

                routing,

                context

            );

        }


        if (
            this.transport &&
            typeof this.transport.publish ===
            'function'
        ) {

            return this.transport.publish(

                event,

                routing,

                context

            );

        }


        if (
            this.eventBus &&
            typeof this.eventBus.publish ===
            'function'
        ) {

            /**
             * Some internal event buses accept the raw event.
             */
            if (
                this.eventBus.acceptsEnvelope ===
                true
            ) {

                return this.eventBus.publish(
                    event
                );

            }


            return this.eventBus.publish({

                type:
                    event.eventType,

                eventId:
                    event.eventId,

                tenantId:
                    event.tenantId,

                transactionId:
                    event.transactionId,

                correlationId:
                    event.correlationId,

                payload:
                    event

            });

        }


        throw new Error(
            'No compatible event publisher transport is configured'
        );

    }


    /**
     * =========================================================================
     * Resolve Routing
     * =========================================================================
     */

    resolveRouting(
        record
    ) {

        if (
            record.routing
        ) {

            return {

                ...record.routing,

                topic:
                    record.routing.topic ||
                    null,

                route:
                    record.routing.route ||
                    null,

                partitionKey:
                    record.routing.partitionKey ||
                    record.routing.routingKey ||
                    null

            };

        }


        if (
            !this.router
        ) {

            return {

                topic:
                    null,

                route:
                    null,

                routingKey:
                    null,

                partitionKey:
                    null

            };

        }


        return this.router.resolveRoutingMetadata(

            this.toPublishableEvent(
                record
            )

        );

    }


    /**
     * =========================================================================
     * Publishable Event
     * =========================================================================
     */

    toPublishableEvent(
        record,
        routing = null
    ) {

        const event = {

            eventId:
                record.eventId,

            eventKey:
                record.eventKey,

            eventType:
                record.eventType,

            eventVersion:
                record.eventVersion,

            schemaVersion:
                record.schemaVersion,

            category:
                record.category,

            occurredAt:
                record.occurredAt,

            publishedAt:
                null,

            source:
                record.source,

            environment:
                record.metadata?.environment ||
                process.env.NODE_ENV ||
                'development',

            tenantId:
                record.tenantId,

            organizationId:
                record.organizationId ||
                null,

            userId:
                record.userId ||
                null,

            customerId:
                record.customerId ||
                null,

            transactionId:
                record.transactionId ||
                null,

            parentTransactionId:
                record.parentTransactionId ||
                null,

            correlationId:
                record.correlationId ||
                null,

            requestId:
                record.requestId ||
                null,

            idempotencyKey:
                record.idempotencyKey ||
                null,

            provider:
                record.provider ||
                null,

            operation:
                record.operation ||
                null,

            aggregate:
                record.aggregate ||
                null,

            trace:
                record.trace ||
                null,

            payload:
                record.payload,

            metadata:
                record.metadata ||
                {},

            routing:
                routing ||
                record.routing ||
                null,

            fingerprint:
                record.fingerprint

        };


        return Object.freeze(
            event
        );

    }


    /**
     * =========================================================================
     * Failure Handling
     * =========================================================================
     */

    async handleFailure(
        record,
        error
    ) {

        const retryable =
            this.classifyRetryability(
                error
            );


        try {

            const result =
                await this.repository.fail({

                    tenantId:
                        record.tenantId,

                    eventId:
                        record.eventId,

                    workerId:
                        this.workerId,

                    error,

                    retryable

                });


            if (
                result?.status ===
                'DEAD_LETTERED'
            ) {

                this.statistics.deadLettered++;


                this.metrics?.increment?.(
                    'transaction_outbox_dead_letter_total'
                );

            }
            else {

                this.statistics.retried++;


                this.metrics?.increment?.(
                    'transaction_outbox_retry_total'
                );

            }


            return result;

        }
        catch (persistError) {

            /**
             * Another worker may have reclaimed the record after the original
             * lease was lost. Never blindly overwrite it.
             */

            this.logger.error?.({

                message:
                    'Failed to persist outbox delivery failure',

                workerId:
                    this.workerId,

                eventId:
                    record.eventId,

                tenantId:
                    record.tenantId,

                originalError:
                    safeError(
                        error
                    ),

                persistenceError:
                    safeError(
                        persistError
                    )

            });


            return null;

        }

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    classifyRetryability(
        error
    ) {

        if (
            typeof error?.retryable ===
            'boolean'
        ) {

            return error.retryable;

        }


        const status =
            Number(
                error?.statusCode ||
                error?.status
            );


        if (
            [
                408,
                409,
                425,
                429,
                500,
                502,
                503,
                504

            ].includes(
                status
            )
        ) {

            return true;

        }


        return [

            'ETIMEDOUT',
            'ECONNRESET',
            'ECONNREFUSED',
            'ECONNABORTED',
            'EAI_AGAIN',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'NETWORK_ERROR',
            'SERVICE_UNAVAILABLE',
            'PROVIDER_UNAVAILABLE',
            'OUTBOX_LEASE_LOST'

        ].includes(

            String(
                error?.code ||
                ''
            )
                .toUpperCase()

        );

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    startHeartbeat(
        job
    ) {

        job.heartbeatTimer =
            setInterval(

                async () => {

                    if (
                        this.stopRequested ||
                        job.leaseLost
                    ) {

                        return;

                    }


                    try {

                        await this.repository.heartbeat({

                            tenantId:
                                job.tenantId,

                            eventId:
                                job.eventId,

                            workerId:
                                this.workerId,

                            leaseMs:
                                this.leaseMs

                        });


                        this.statistics.heartbeats++;


                        this.metrics?.increment?.(
                            'transaction_outbox_heartbeat_total'
                        );

                    }
                    catch (error) {

                        this.statistics.heartbeatFailures++;


                        job.leaseLost =
                            true;


                        this.statistics.leaseLosses++;


                        this.metrics?.increment?.(
                            'transaction_outbox_heartbeat_failure_total'
                        );


                        this.logger.error?.({

                            message:
                                'Outbox lease heartbeat failed',

                            workerId:
                                this.workerId,

                            eventId:
                                job.eventId,

                            tenantId:
                                job.tenantId,

                            error:
                                safeError(
                                    error
                                )

                        });

                    }

                },

                this.heartbeatIntervalMs

            );


    }


    stopHeartbeat(
        job
    ) {

        if (
            job?.heartbeatTimer
        ) {

            clearInterval(
                job.heartbeatTimer
            );


            job.heartbeatTimer =
                null;

        }

    }


    /**
     * =========================================================================
     * Lease-Lost Error
     * =========================================================================
     */

    createLeaseLostError(
        record
    ) {

        const error =
            new Error(

                `Outbox lease lost for event ${record.eventId}`

            );


        error.code =
            'OUTBOX_LEASE_LOST';


        error.retryable =
            true;


        error.tenantId =
            record.tenantId;


        error.eventId =
            record.eventId;


        return error;

    }


    /**
     * =========================================================================
     * Recover Expired Leases
     * =========================================================================
     */

    async recoverExpiredLeases() {

        if (
            this.stopRequested
        ) {

            return [];

        }


        try {

            this.statistics.recoveryCycles++;


            const released =
                await this.repository
                    .releaseExpiredLeases({

                        tenantId:
                            this.tenantId,

                        limit:
                            this.batchSize

                    });


            this.statistics.recoveryReleased +=
                released.length;


            this.lastRecoveryAt =
                new Date();


            if (
                released.length > 0
            ) {

                this.metrics?.increment?.(

                    'transaction_outbox_expired_leases_released_total',

                    {

                        count:
                            released.length

                    }

                );

            }


            return released;

        }
        catch (error) {

            this.statistics.recoveryFailures++;


            this.logger.error?.({

                message:
                    'Outbox expired lease recovery failed',

                workerId:
                    this.workerId,

                error:
                    safeError(
                        error
                    )

            });


            this.metrics?.increment?.(
                'transaction_outbox_lease_recovery_failure_total'
            );


            return [];

        }

    }


    /**
     * =========================================================================
     * Recovery Scheduler
     * =========================================================================
     */

    startRecoveryScheduler() {

        if (
            this.recoveryTimer
        ) {

            return;

        }


        this.recoveryTimer =
            setInterval(

                () => {

                    this.recoveryPromise =
                        this.recoverExpiredLeases()
                            .catch(
                                error => {

                                    this.logger.error?.({

                                        message:
                                            'Outbox recovery scheduler failed',

                                        error:
                                            safeError(
                                                error
                                            )

                                    });

                                }
                            );

                },

                this.recoveryIntervalMs

            );

    }


    stopRecoveryScheduler() {

        if (
            this.recoveryTimer
        ) {

            clearInterval(
                this.recoveryTimer
            );


            this.recoveryTimer =
                null;

        }

    }


    /**
     * =========================================================================
     * Graceful Shutdown
     * =========================================================================
     */

    async shutdown(
        options = {}
    ) {

        if (
            !this.running &&
            this.status ===
                WORKER_STATUS.STOPPED
        ) {

            this.stopRecoveryScheduler();


            return true;

        }


        this.status =
            WORKER_STATUS.DRAINING;


        this.stopRequested =
            true;


        this.stopRecoveryScheduler();


        this.metrics?.increment?.(
            'transaction_outbox_worker_shutdown_total'
        );


        this.logger.info?.({

            message:
                'Transaction outbox worker draining',

            workerId:
                this.workerId,

            activeJobs:
                this.activeJobs.size

        });


        const timeoutMs =
            Number(
                options.timeoutMs ||
                this.shutdownTimeoutMs
            );


        await this.waitForDrain(
            timeoutMs
        );


        this.status =
            WORKER_STATUS.STOPPING;


        try {

            if (
                this.loopPromise
            ) {

                await Promise.race([

                    this.loopPromise,

                    this.sleep(
                        timeoutMs
                    )

                ]);

            }

        }
        catch (error) {

            this.logger.warn?.({

                message:
                    'Outbox worker loop did not stop cleanly',

                workerId:
                    this.workerId,

                error:
                    safeError(
                        error
                    )

            });

        }


        /**
         * If any active job remains, release only leases that this worker still
         * owns. If the process is being terminated immediately, the leases will
         * naturally expire and another worker can recover them.
         */

        await this.releaseOwnedLeases();


        this.running =
            false;


        this.status =
            WORKER_STATUS.STOPPED;


        this.loopPromise =
            null;


        this.logger.info?.({

            message:
                'Transaction outbox worker stopped',

            workerId:
                this.workerId,

            statistics:
                this.stats()

        });


        return true;

    }


    /**
     * =========================================================================
     * Wait For Drain
     * =========================================================================
     */

    async waitForDrain(
        timeoutMs
    ) {

        const started =
            Date.now();


        while (
            this.activeJobs.size > 0 &&
            Date.now() -
                started <
            timeoutMs
        ) {

            await this.sleep(
                50
            );

        }


        return this.activeJobs.size === 0;

    }


    /**
     * =========================================================================
     * Release Owned Leases
     * =========================================================================
     */

    async releaseOwnedLeases() {

        const jobs =
            Array.from(
                this.activeJobs.values()
            );


        for (
            const job
            of jobs
        ) {

            try {

                await this.repository.releaseLease({

                    tenantId:
                        job.tenantId,

                    eventId:
                        job.eventId,

                    workerId:
                        this.workerId

                });

            }
            catch (error) {

                /**
                 * The lease may already have expired or been reclaimed.
                 * Do not prevent shutdown.
                 */

                this.logger.warn?.({

                    message:
                        'Failed to release outbox lease during shutdown',

                    workerId:
                        this.workerId,

                    eventId:
                        job.eventId,

                    error:
                        safeError(
                            error
                        )

                });

            }

        }

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let repositoryHealth =
            null;


        try {

            repositoryHealth =
                await this.repository.health?.();

        }
        catch (error) {

            repositoryHealth = {

                status:
                    'DOWN',

                error:
                    safeError(
                        error
                    )

            };

        }


        const repositoryStatus =
            repositoryHealth?.status ||
            'UNKNOWN';


        const workerHealthy =
            this.status ===
                WORKER_STATUS.RUNNING ||
            this.status ===
                WORKER_STATUS.DEGRADED;


        return {

            status:

                !workerHealthy ||
                repositoryStatus ===
                    'DOWN'

                    ? 'DOWN'

                    : this.status ===
                        WORKER_STATUS.DEGRADED ||
                      repositoryStatus ===
                        'DEGRADED'

                        ? 'DEGRADED'

                        : 'UP',

            component:
                'transaction-outbox-worker',

            workerId:
                this.workerId,

            tenantId:
                this.tenantId,

            workerStatus:
                this.status,

            running:
                this.running,

            activeJobs:
                this.activeJobs.size,

            repository:
                repositoryHealth,

            lastPollAt:
                this.lastPollAt,

            lastSuccessAt:
                this.lastSuccessAt,

            lastFailureAt:
                this.lastFailureAt,

            lastRecoveryAt:
                this.lastRecoveryAt,

            lastError:
                this.lastError,

            statistics:
                this.stats()

        };

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            workerId:
                this.workerId,

            tenantId:
                this.tenantId,

            status:
                this.status,

            running:
                this.running,

            activeJobs:
                this.activeJobs.size,

            batchSize:
                this.batchSize,

            concurrency:
                this.concurrency,

            leaseMs:
                this.leaseMs,

            heartbeatIntervalMs:
                this.heartbeatIntervalMs,

            uptimeMs:
                this.startedAt
                    ? Date.now() -
                      this.startedAt.getTime()
                    : 0

        };

    }


    /**
     * =========================================================================
     * Span
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        try {

            return this.tracer?.startSpan?.(

                name,

                {

                    attributes

                }

            );

        }
        catch (_) {

            return null;

        }

    }


    setSpanSuccess(
        span
    ) {

        try {

            span?.setStatus?.({

                code:
                    1

            });

        }
        catch (_) {
            // Tracing must never affect event delivery.
        }

    }


    setSpanError(
        span,
        error
    ) {

        try {

            span?.recordException?.(
                error
            );

            span?.setStatus?.({

                code:
                    2,

                message:
                    error?.message

            });

        }
        catch (_) {
            // Tracing must never affect event delivery.
        }

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        ms
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}


TransactionOutboxWorker.Status =
    WORKER_STATUS;


module.exports =
    TransactionOutboxWorker;


module.exports.TransactionOutboxWorker =
    TransactionOutboxWorker;


module.exports.WORKER_STATUS =
    WORKER_STATUS;