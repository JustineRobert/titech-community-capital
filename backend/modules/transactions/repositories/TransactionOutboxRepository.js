'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Outbox Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/repositories/TransactionOutboxRepository.js
 *
 * Purpose
 * -------
 * Durable persistence/coordination adapter for TransactionOutboxRecord.
 *
 * Responsibilities
 * ----------------
 * • Tenant-scoped outbox persistence
 * • Idempotent creation
 * • Atomic worker claiming
 * • Lease renewal
 * • Lease release
 * • Optimistic concurrency
 * • Publish completion
 * • Failure recording
 * • Retry scheduling
 * • Dead-letter transitions
 * • Replay support
 * • Due-event queries
 * • Recovery queries
 * • Operational health
 *
 * Explicitly NOT Responsible For
 * --------------------------------
 * • Event publishing transport
 * • Kafka/RabbitMQ/Redis/SNS implementation
 * • Transaction business logic
 * • Ledger posting
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


const TransactionOutboxRecord =
    require('../models/TransactionOutboxRecord');


const {
    OUTBOX_STATUS
} =
    require('../models/TransactionOutboxRecord');


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_LEASE_MS =
    30000;

const DEFAULT_MAX_ATTEMPTS =
    10;

const DEFAULT_BATCH_SIZE =
    100;

const DEFAULT_RETRY_DELAY_MS =
    1000;


/**
 * ============================================================================
 * Error Helpers
 * ============================================================================
 */

function createRepositoryError(
    code,
    message,
    metadata = {}
) {

    const error =
        new Error(
            message
        );

    error.name =
        'TransactionOutboxRepositoryError';

    error.code =
        code;

    Object.assign(
        error,
        metadata
    );

    return error;

}


function normalizeError(
    error
) {

    if (!error) {

        return null;

    }


    return {

        name:
            error.name || 'Error',

        code:
            error.code || null,

        category:
            error.category || null,

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
            error.statusCode || null,

        provider:
            error.provider || null,

        providerCode:
            error.providerCode || null,

        at:
            new Date()

    };

}


/**
 * ============================================================================
 * Repository
 * ============================================================================
 */

class TransactionOutboxRepository {

    constructor(
        options = {}
    ) {

        this.model =
            options.model ||
            TransactionOutboxRecord;


        this.logger =
            options.logger ||
            console;


        this.metrics =
            options.metrics ||
            null;


        this.clock =
            options.clock ||
            Date;


        this.defaultLeaseMs =
            Number(
                options.defaultLeaseMs ||
                DEFAULT_LEASE_MS
            );


        this.defaultMaxAttempts =
            Number(
                options.defaultMaxAttempts ||
                DEFAULT_MAX_ATTEMPTS
            );


        this.defaultBatchSize =
            Number(
                options.defaultBatchSize ||
                DEFAULT_BATCH_SIZE
            );


        this.defaultRetryDelayMs =
            Number(
                options.defaultRetryDelayMs ||
                DEFAULT_RETRY_DELAY_MS
            );


        this.retryStrategy =
            options.retryStrategy ||
            null;


        this.statistics = {

            created:
                0,

            duplicateCreates:
                0,

            finds:
                0,

            updates:
                0,

            claims:
                0,

            claimConflicts:
                0,

            heartbeats:
                0,

            releases:
                0,

            published:
                0,

            failures:
                0,

            retries:
                0,

            deadLettered:
                0,

            replays:
                0

        };

    }


    /**
     * =========================================================================
     * Create
     * =========================================================================
     *
     * Idempotent by tenant + eventId and tenant + eventKey.
     */

    async create(
        event = {},
        options = {}
    ) {

        this.validateEventInput(
            event
        );


        const document =
            this.buildDocument(
                event,
                options
            );


        try {

            const created =
                await this.model.create(
                    document
                );


            this.statistics.created++;


            this.metrics?.increment?.(
                'transaction_outbox_created_total'
            );


            return created;

        }
        catch (error) {

            if (
                this.isDuplicateError(
                    error
                )
            ) {

                this.statistics.duplicateCreates++;


                this.metrics?.increment?.(
                    'transaction_outbox_duplicate_create_total'
                );


                const existing =
                    await this.findExistingDuplicate(
                        event
                    );


                if (
                    existing
                ) {

                    return existing;

                }

            }


            throw error;

        }

    }


    /**
     * =========================================================================
     * Create Many
     * =========================================================================
     */

    async createMany(
        events = []
    ) {

        if (
            !Array.isArray(events)
        ) {

            throw new TypeError(
                'events must be an array'
            );

        }


        if (
            events.length === 0
        ) {

            return [];

        }


        const documents =
            events.map(
                event =>
                    this.buildDocument(
                        event
                    )
            );


        try {

            const result =
                await this.model.insertMany(
                    documents,
                    {
                        ordered:
                            false
                    }
                );


            this.statistics.created +=
                result.length;


            return result;

        }
        catch (error) {

            /**
             * MongoDB unordered bulk insert may report duplicate events while
             * still inserting the non-duplicates. Surface the error so callers
             * can decide whether to inspect/reconcile.
             */
            throw error;

        }

    }


    /**
     * =========================================================================
     * Find One
     * =========================================================================
     */

    async findOne(
        query = {},
        options = {}
    ) {

        this.statistics.finds++;


        const filter =
            this.normalizeScopedQuery(
                query
            );


        let operation =
            this.model.findOne(
                filter
            );


        if (
            options.select
        ) {

            operation =
                operation.select(
                    options.select
                );

        }


        if (
            options.lean
        ) {

            operation =
                operation.lean();

        }


        return operation.exec();

    }


    /**
     * =========================================================================
     * Find By Event ID
     * =========================================================================
     */

    async findByEventId({

        tenantId,

        eventId

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !eventId
        ) {

            throw new TypeError(
                'eventId is required'
            );

        }


        return this.findOne({

            tenantId,

            eventId

        });

    }


    /**
     * =========================================================================
     * Find By Event Key
     * =========================================================================
     */

    async findByEventKey({

        tenantId,

        eventKey

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !eventKey
        ) {

            throw new TypeError(
                'eventKey is required'
            );

        }


        return this.findOne({

            tenantId,

            eventKey

        });

    }


    /**
     * =========================================================================
     * Find By Fingerprint
     * =========================================================================
     */

    async findByFingerprint({

        tenantId,

        fingerprint

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !fingerprint
        ) {

            throw new TypeError(
                'fingerprint is required'
            );

        }


        return this.findOne({

            tenantId,

            fingerprint

        });

    }


    /**
     * =========================================================================
     * Find By Transaction
     * =========================================================================
     */

    async findByTransaction({

        tenantId,

        transactionId,

        limit =
            this.defaultBatchSize,

        skip = 0

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !transactionId
        ) {

            throw new TypeError(
                'transactionId is required'
            );

        }


        return this.model
            .find({

                tenantId,

                transactionId

            })
            .sort({
                createdAt:
                    -1
            })
            .skip(
                Math.max(
                    0,
                    Number(skip) || 0
                )
            )
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.defaultBatchSize
                )
            )
            .exec();

    }


    /**
     * =========================================================================
     * Find Due Events
     * =========================================================================
     *
     * Work is claimable when:
     *
     * PENDING and available,
     * or
     * PROCESSING with an expired lease.
     */

    async findDue({

        tenantId = null,

        provider = null,

        eventType = null,

        limit =
            this.defaultBatchSize,

        now =
            this.now(),

        includeProcessing =
            true

    } = {}) {

        const filter = {

            ...(tenantId
                ? { tenantId }
                : {}),

            ...(provider
                ? { provider: String(provider).toUpperCase() }
                : {}),

            ...(eventType
                ? { eventType: String(eventType).toLowerCase() }
                : {}),

            $or: [

                {

                    status:
                        OUTBOX_STATUS.PENDING,

                    $or: [

                        {
                            nextAttemptAt:
                                null
                        },

                        {
                            nextAttemptAt: {
                                $lte:
                                    now
                            }
                        }

                    ]

                }

            ]

        };


        if (
            includeProcessing
        ) {

            filter.$or.push({

                status:
                    OUTBOX_STATUS.PROCESSING,

                leaseExpiresAt: {

                    $lte:
                        now

                }

            });

        }


        return this.model
            .find(
                filter
            )
            .sort({

                nextAttemptAt:
                    1,

                createdAt:
                    1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.defaultBatchSize
                )
            )
            .exec();

    }


    /**
     * =========================================================================
     * Atomic Claim
     * =========================================================================
     *
     * The central concurrency primitive.
     *
     * Only one worker can claim an event whose lease is currently valid.
     */

    async claim({

        tenantId,

        workerId,

        leaseMs =
            this.defaultLeaseMs,

        eventId = null,

        eventKey = null,

        now =
            this.now()

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !workerId
        ) {

            throw new TypeError(
                'workerId is required'
            );

        }


        if (
            !eventId &&
            !eventKey
        ) {

            throw new TypeError(
                'eventId or eventKey is required for claim'
            );

        }


        const identityFilter = {

            tenantId,

            ...(eventId
                ? { eventId }
                : { eventKey })

        };


        const leaseExpiresAt =
            new Date(

                now.getTime() +
                Math.max(
                    1000,
                    Number(leaseMs) ||
                    this.defaultLeaseMs
                )

            );


        const result =
            await this.model.findOneAndUpdate(

                {

                    ...identityFilter,

                    $or: [

                        {
                            status:
                                OUTBOX_STATUS.PENDING,

                            $or: [

                                {
                                    nextAttemptAt:
                                        null
                                },

                                {
                                    nextAttemptAt: {
                                        $lte:
                                            now
                                    }
                                }

                            ]

                        },

                        {
                            status:
                                OUTBOX_STATUS.PROCESSING,

                            claimedBy:
                                workerId

                        },

                        {
                            status:
                                OUTBOX_STATUS.PROCESSING,

                            leaseExpiresAt: {
                                $lte:
                                    now
                            }

                        }

                    ],

                    $expr: {

                        $lt: [

                            '$attemptCount',

                            '$maxAttempts'

                        ]

                    }

                },

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PROCESSING,

                        claimedBy:
                            workerId,

                        leaseExpiresAt,

                        lastHeartbeatAt:
                            now,

                        lastAttemptAt:
                            now

                    },

                    $inc: {

                        attemptCount:
                            1,

                        deliveryVersion:
                            1,

                        version:
                            1

                    },

                    $unset: {

                        failedAt:
                            1,

                        lastError:
                            1

                    }

                },

                {

                    new:
                        true,

                    runValidators:
                        true

                }

            ).exec();


        if (
            !result
        ) {

            this.statistics.claimConflicts++;


            this.metrics?.increment?.(
                'transaction_outbox_claim_conflict_total'
            );


            return null;

        }


        this.statistics.claims++;


        this.metrics?.increment?.(
            'transaction_outbox_claim_success_total'
        );


        return result;

    }


    /**
     * =========================================================================
     * Claim Batch
     * =========================================================================
     */

    async claimBatch({

        tenantId = null,

        workerId,

        batchSize =
            this.defaultBatchSize,

        leaseMs =
            this.defaultLeaseMs

    } = {}) {

        this.requireWorker(
            workerId
        );


        const due =
            await this.findDue({

                tenantId,

                limit:
                    batchSize

            });


        const claimed = [];


        for (
            const item
            of due
        ) {

            const result =
                await this.claim({

                    tenantId:
                        item.tenantId,

                    workerId,

                    leaseMs,

                    eventId:
                        item.eventId

                });


            if (
                result
            ) {

                claimed.push(
                    result
                );

            }

        }


        return claimed;

    }


    /**
     * =========================================================================
     * Heartbeat / Renew Lease
     * =========================================================================
     */

    async heartbeat({

        tenantId,

        eventId,

        workerId,

        leaseMs =
            this.defaultLeaseMs,

        now =
            this.now()

    } = {}) {

        this.requireTenant(
            tenantId
        );

        this.requireWorker(
            workerId
        );


        if (
            !eventId
        ) {

            throw new TypeError(
                'eventId is required'
            );

        }


        const leaseExpiresAt =
            new Date(

                now.getTime() +
                Math.max(
                    1000,
                    Number(leaseMs) ||
                    this.defaultLeaseMs
                )

            );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        OUTBOX_STATUS.PROCESSING,

                    claimedBy:
                        workerId

                },

                {

                    $set: {

                        leaseExpiresAt,

                        lastHeartbeatAt:
                            now

                    },

                    $inc: {

                        deliveryVersion:
                            1,

                        version:
                            1

                    }

                },

                {

                    new:
                        true,

                    runValidators:
                        true

                }

            ).exec();


        if (
            result
        ) {

            this.statistics.heartbeats++;


            return result;

        }


        throw createRepositoryError(

            'OUTBOX_LEASE_LOST',

            'Outbox worker lease is no longer owned',

            {

                tenantId,

                eventId,

                workerId,

                retryable:
                    true

            }

        );

    }


    /**
     * =========================================================================
     * Release Lease
     * =========================================================================
     */

    async releaseLease({

        tenantId,

        eventId,

        workerId

    } = {}) {

        this.requireTenant(
            tenantId
        );

        this.requireWorker(
            workerId
        );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    claimedBy:
                        workerId

                },

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PENDING,

                        nextAttemptAt:
                            this.now(),

                        deliveryVersion:
                            1

                    },

                    $unset: {

                        claimedBy:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1

                    },

                    $inc: {

                        version:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        if (
            result
        ) {

            this.statistics.releases++;

        }


        return result;

    }


    /**
     * =========================================================================
     * Update
     * =========================================================================
     */

    async update({

        tenantId,

        eventId,

        patch = {},

        expectedVersion = null,

        workerId = null

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !eventId
        ) {

            throw new TypeError(
                'eventId is required'
            );

        }


        const filter = {

            tenantId,

            eventId

        };


        if (
            expectedVersion !== null &&
            expectedVersion !== undefined
        ) {

            filter.version =
                Number(
                    expectedVersion
                );

        }


        if (
            workerId
        ) {

            filter.claimedBy =
                workerId;

        }


        const safePatch =
            this.buildSafeDeliveryPatch(
                patch
            );


        const result =
            await this.model.findOneAndUpdate(

                filter,

                {

                    $set:
                        safePatch,

                    $inc: {

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true,

                    runValidators:
                        true

                }

            ).exec();


        if (
            !result &&
            expectedVersion !== null &&
            expectedVersion !== undefined
        ) {

            throw createRepositoryError(

                'OUTBOX_VERSION_CONFLICT',

                'Outbox record optimistic version conflict',

                {

                    tenantId,

                    eventId,

                    expectedVersion,

                    retryable:
                        true

                }

            );

        }


        this.statistics.updates++;


        return result;

    }


    /**
     * =========================================================================
     * Mark Published
     * =========================================================================
     */

    async complete({

        tenantId,

        eventId,

        workerId,

        publishedAt =
            this.now(),

        publishResult = null

    } = {}) {

        this.requireTenant(
            tenantId
        );

        this.requireWorker(
            workerId
        );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        OUTBOX_STATUS.PROCESSING,

                    claimedBy:
                        workerId

                },

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PUBLISHED,

                        publishedAt,

                        publishCount:
                            1,

                        lastAttemptAt:
                            publishedAt

                    },

                    $unset: {

                        claimedBy:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1,

                        nextAttemptAt:
                            1,

                        lastError:
                            1

                    },

                    $inc: {

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        if (
            !result
        ) {

            throw createRepositoryError(

                'OUTBOX_COMPLETE_CONFLICT',

                'Unable to complete outbox record because the worker no longer owns the lease',

                {

                    tenantId,

                    eventId,

                    workerId,

                    retryable:
                        true

                }

            );

        }


        this.statistics.published++;


        this.metrics?.increment?.(
            'transaction_outbox_published_total'
        );


        return result;

    }


    /**
     * =========================================================================
     * Mark Published Alias
     * =========================================================================
     */

    async markPublished(
        options = {}
    ) {

        return this.complete(
            options
        );

    }


    /**
     * =========================================================================
     * Fail
     * =========================================================================
     */

    async fail({

        tenantId,

        eventId,

        workerId,

        error,

        retryable = null,

        retryDelayMs =
            null

    } = {}) {

        this.requireTenant(
            tenantId
        );

        this.requireWorker(
            workerId
        );


        const normalizedError =
            normalizeError(
                error
            );


        const shouldRetry =
            retryable !== null
                ? Boolean(
                    retryable
                )
                : Boolean(
                    error?.retryable
                );


        const existing =
            await this.findByEventId({

                tenantId,

                eventId

            });


        if (
            !existing
        ) {

            return null;

        }


        const nextAttempt =
            Number(
                existing.attemptCount
            ) + 1;


        const exhausted =
            nextAttempt >=
            Number(
                existing.maxAttempts
            );


        const terminalFailure =
            !shouldRetry ||
            exhausted;


        if (
            terminalFailure
        ) {

            return this.deadLetter({

                tenantId,

                eventId,

                workerId,

                error:
                    normalizedError

            });

        }


        const delay =
            retryDelayMs !== null
                ? Math.max(
                    0,
                    Number(
                        retryDelayMs
                    )
                )
                : await this.calculateRetryDelay({

                    attempt:
                        nextAttempt,

                    error

                });


        const now =
            this.now();


        const nextAttemptAt =
            new Date(

                now.getTime() +
                delay

            );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        OUTBOX_STATUS.PROCESSING,

                    claimedBy:
                        workerId

                },

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PENDING,

                        nextAttemptAt,

                        lastError:
                            normalizedError,

                        failedAt:
                            now,

                        lastAttemptAt:
                            now

                    },

                    $unset: {

                        claimedBy:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1

                    },

                    $inc: {

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        if (
            !result
        ) {

            throw createRepositoryError(

                'OUTBOX_FAIL_CONFLICT',

                'Unable to persist outbox failure because the worker no longer owns the lease',

                {

                    tenantId,

                    eventId,

                    workerId,

                    retryable:
                        true

                }

            );

        }


        this.statistics.failures++;
        this.statistics.retries++;


        this.metrics?.increment?.(
            'transaction_outbox_retry_scheduled_total'
        );


        return result;

    }


    /**
     * =========================================================================
     * Schedule Retry
     * =========================================================================
     */

    async scheduleRetry({

        tenantId,

        eventId,

        workerId,

        delayMs = null,

        error = null

    } = {}) {

        return this.fail({

            tenantId,

            eventId,

            workerId,

            error,

            retryable:
                true,

            retryDelayMs:
                delayMs

        });

    }


    /**
     * =========================================================================
     * Dead Letter
     * =========================================================================
     */

    async deadLetter({

        tenantId,

        eventId,

        workerId = null,

        error = null

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !eventId
        ) {

            throw new TypeError(
                'eventId is required'
            );

        }


        const filter = {

            tenantId,

            eventId

        };


        if (
            workerId
        ) {

            filter.status =
                OUTBOX_STATUS.PROCESSING;

            filter.claimedBy =
                workerId;

        }


        const now =
            this.now();


        const result =
            await this.model.findOneAndUpdate(

                filter,

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.DEAD_LETTERED,

                        deadLetteredAt:
                            now,

                        failedAt:
                            now,

                        lastError:
                            normalizeError(
                                error
                            )

                    },

                    $unset: {

                        claimedBy:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1,

                        nextAttemptAt:
                            1

                    },

                    $inc: {

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        if (
            result
        ) {

            this.statistics.deadLettered++;


            this.metrics?.increment?.(
                'transaction_outbox_dead_lettered_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Replay Published Event
     * =========================================================================
     *
     * Replay changes delivery state, not the immutable event envelope.
     */

    async replay({

        tenantId,

        eventId,

        workerId = null,

        delayMs = 0

    } = {}) {

        this.requireTenant(
            tenantId
        );


        if (
            !eventId
        ) {

            throw new TypeError(
                'eventId is required'
            );

        }


        const now =
            this.now();


        const nextAttemptAt =
            new Date(

                now.getTime() +
                Math.max(
                    0,
                    Number(
                        delayMs
                    )
                )

            );


        const filter = {

            tenantId,

            eventId,

            status: {

                $in: [

                    OUTBOX_STATUS.PUBLISHED,

                    OUTBOX_STATUS.FAILED,

                    OUTBOX_STATUS.DEAD_LETTERED,

                    OUTBOX_STATUS.PENDING

                ]

            }

        };


        const result =
            await this.model.findOneAndUpdate(

                filter,

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PENDING,

                        nextAttemptAt,

                        lastReplayedAt:
                            now

                    },

                    $unset: {

                        publishedAt:
                            1,

                        failedAt:
                            1,

                        deadLetteredAt:
                            1,

                        claimedBy:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1,

                        lastError:
                            1

                    },

                    $inc: {

                        replayCount:
                            1,

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        if (
            result
        ) {

            this.statistics.replays++;


            this.metrics?.increment?.(
                'transaction_outbox_replay_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Cancel
     * =========================================================================
     */

    async cancel({

        tenantId,

        eventId,

        reason = null

    } = {}) {

        this.requireTenant(
            tenantId
        );


        const now =
            this.now();


        return this.model.findOneAndUpdate(

            {

                tenantId,

                eventId,

                status: {

                    $in: [

                        OUTBOX_STATUS.PENDING,

                        OUTBOX_STATUS.FAILED

                    ]

                }

            },

            {

                $set: {

                    status:
                        OUTBOX_STATUS.CANCELLED,

                    cancelledAt:
                        now,

                    lastError:
                        reason
                            ? normalizeError(
                                new Error(
                                    String(
                                        reason
                                    )
                                )
                            )
                            : null

                },

                $inc: {

                    version:
                        1,

                    deliveryVersion:
                        1

                }

            },

            {

                new:
                    true

            }

        ).exec();

    }


    /**
     * =========================================================================
     * Find Expired Leases
     * =========================================================================
     */

    async findExpiredLeases({

        tenantId = null,

        limit =
            this.defaultBatchSize,

        now =
            this.now()

    } = {}) {

        return this.model
            .find({

                ...(tenantId
                    ? { tenantId }
                    : {}),

                status:
                    OUTBOX_STATUS.PROCESSING,

                leaseExpiresAt: {

                    $lte:
                        now

                }

            })
            .sort({

                leaseExpiresAt:
                    1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.defaultBatchSize
                )
            )
            .exec();

    }


    /**
     * =========================================================================
     * Release Expired Leases
     * =========================================================================
     */

    async releaseExpiredLeases({

        tenantId = null,

        now =
            this.now(),

        limit =
            this.defaultBatchSize

    } = {}) {

        const expired =
            await this.findExpiredLeases({

                tenantId,

                now,

                limit

            });


        const released = [];


        for (
            const record
            of expired
        ) {

            const result =
                await this.model.findOneAndUpdate(

                    {

                        _id:
                            record._id,

                        status:
                            OUTBOX_STATUS.PROCESSING,

                        leaseExpiresAt: {

                            $lte:
                                now

                        }

                    },

                    {

                        $set: {

                            status:
                                OUTBOX_STATUS.PENDING,

                            nextAttemptAt:
                                now

                        },

                        $unset: {

                            claimedBy:
                                1,

                            leaseExpiresAt:
                                1,

                            lastHeartbeatAt:
                                1

                        },

                        $inc: {

                            version:
                                1,

                            deliveryVersion:
                                1

                        }

                    },

                    {

                        new:
                            true

                    }

                ).exec();


            if (
                result
            ) {

                released.push(
                    result
                );

            }

        }


        return released;

    }


    /**
     * =========================================================================
     * Reset Failed Record
     * =========================================================================
     */

    async resetForRetry({

        tenantId,

        eventId

    } = {}) {

        this.requireTenant(
            tenantId
        );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        OUTBOX_STATUS.FAILED

                },

                {

                    $set: {

                        status:
                            OUTBOX_STATUS.PENDING,

                        nextAttemptAt:
                            this.now()

                    },

                    $unset: {

                        failedAt:
                            1,

                        lastError:
                            1

                    },

                    $inc: {

                        version:
                            1,

                        deliveryVersion:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).exec();


        return result;

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const started =
            Date.now();


        try {

            await this.model
                .findOne(
                    {}
                )
                .select(
                    '_id'
                )
                .lean()
                .exec();


            return {

                status:
                    'UP',

                repository:
                    'TransactionOutboxRepository',

                model:
                    this.model.modelName ||
                    'TransactionOutboxRecord',

                latencyMs:
                    Date.now() -
                    started,

                statistics:
                    this.stats()

            };

        }
        catch (error) {

            return {

                status:
                    'DOWN',

                repository:
                    'TransactionOutboxRepository',

                latencyMs:
                    Date.now() -
                    started,

                error:
                    normalizeError(
                        error
                    )

            };

        }

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            repository:
                'TransactionOutboxRepository',

            defaults: {

                leaseMs:
                    this.defaultLeaseMs,

                maxAttempts:
                    this.defaultMaxAttempts,

                batchSize:
                    this.defaultBatchSize,

                retryDelayMs:
                    this.defaultRetryDelayMs

            }

        };

    }


    /**
     * =========================================================================
     * Build Document
     * =========================================================================
     */

    buildDocument(
        event,
        options = {}
    ) {

        this.validateEventInput(
            event
        );


        const now =
            this.now();


        const routing =
            event.routing ||
            {

                topic:
                    event.topic ||
                    null,

                route:
                    event.route ||
                    null,

                routingKey:
                    event.routingKey ||
                    null,

                partitionKey:
                    event.partitionKey ||
                    event.routingKey ||
                    null,

                tenantRoutingKey:
                    event.tenantRoutingKey ||
                    null,

                aggregateRoutingKey:
                    event.aggregateRoutingKey ||
                    null,

                providerRoutingKey:
                    event.providerRoutingKey ||
                    null

            };


        return {

            tenantId:
                event.tenantId,

            organizationId:
                event.organizationId ||
                null,

            eventId:
                event.eventId,

            eventKey:
                event.eventKey,

            eventType:
                event.eventType,

            eventVersion:
                event.eventVersion,

            schemaVersion:
                event.schemaVersion,

            category:
                event.category,

            fingerprint:
                event.fingerprint,

            transactionId:
                event.transactionId ||
                null,

            parentTransactionId:
                event.parentTransactionId ||
                null,

            correlationId:
                event.correlationId ||
                null,

            requestId:
                event.requestId ||
                null,

            idempotencyKey:
                event.idempotencyKey ||
                null,

            userId:
                event.userId ||
                null,

            customerId:
                event.customerId ||
                null,

            provider:
                event.provider ||
                null,

            operation:
                event.operation ||
                null,

            source:
                event.source ||
                event.service ||
                'transaction-service',

            aggregate:
                event.aggregate ||
                null,

            trace:
                event.trace ||
                null,

            payload:
                event.payload,

            metadata:
                event.metadata ||
                {},

            occurredAt:
                event.occurredAt
                    ? new Date(
                        event.occurredAt
                    )
                    : now,

            routing,

            status:
                options.status ||
                OUTBOX_STATUS.PENDING,

            maxAttempts:
                Number(
                    options.maxAttempts ||
                    this.defaultMaxAttempts
                ),

            attemptCount:
                0,

            nextAttemptAt:
                options.nextAttemptAt ||
                now,

            deliveryVersion:
                0,

            version:
                0

        };

    }


    /**
     * =========================================================================
     * Safe Delivery Patch
     * =========================================================================
     */

    buildSafeDeliveryPatch(
        patch = {}
    ) {

        const allowed = [

            'status',

            'publishedAt',

            'failedAt',

            'deadLetteredAt',

            'cancelledAt',

            'attemptCount',

            'maxAttempts',

            'nextAttemptAt',

            'lastAttemptAt',

            'claimedBy',

            'leaseExpiresAt',

            'lastHeartbeatAt',

            'lastError',

            'publishCount',

            'deliveryVersion',

            'replayCount',

            'lastReplayedAt'

        ];


        return allowed.reduce(

            (
                output,
                field
            ) => {

                if (
                    Object.prototype.hasOwnProperty.call(
                        patch,
                        field
                    )
                ) {

                    output[field] =
                        patch[field];

                }


                return output;

            },

            {}

        );

    }


    /**
     * =========================================================================
     * Existing Duplicate
     * =========================================================================
     */

    async findExistingDuplicate(
        event
    ) {

        if (
            event.tenantId &&
            event.eventId
        ) {

            const byEventId =
                await this.findByEventId({

                    tenantId:
                        event.tenantId,

                    eventId:
                        event.eventId

                });


            if (
                byEventId
            ) {

                return byEventId;

            }

        }


        if (
            event.tenantId &&
            event.eventKey
        ) {

            const byEventKey =
                await this.findByEventKey({

                    tenantId:
                        event.tenantId,

                    eventKey:
                        event.eventKey

                });


            if (
                byEventKey
            ) {

                return byEventKey;

            }

        }


        return null;

    }


    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    async calculateRetryDelay({

        attempt,

        error

    } = {}) {

        if (
            typeof this.retryStrategy?.calculateDelay ===
            'function'
        ) {

            return Math.max(

                0,

                Number(
                    await this.retryStrategy
                        .calculateDelay({

                            attempt,

                            error

                        })
                )

            );

        }


        const exponential =
            Math.min(

                60000,

                this.defaultRetryDelayMs *
                Math.pow(
                    2,
                    Math.max(
                        0,
                        attempt - 1
                    )
                )

            );


        const jitter =
            Math.floor(
                Math.random() *
                Math.max(
                    1,
                    exponential * 0.25
                )
            );


        return exponential + jitter;

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateEventInput(
        event
    ) {

        if (
            !event ||
            typeof event !==
            'object'
        ) {

            throw new TypeError(
                'Transaction outbox event must be an object'
            );

        }


        const required = [

            'tenantId',

            'eventId',

            'eventKey',

            'eventType',

            'eventVersion',

            'schemaVersion',

            'category',

            'fingerprint',

            'payload'

        ];


        const missing =
            required.filter(
                field =>
                    event[field] ===
                    undefined ||
                    event[field] ===
                    null ||
                    event[field] === ''
            );


        if (
            missing.length
        ) {

            throw new TypeError(

                `Transaction outbox event missing required fields: ${missing.join(', ')}`

            );

        }


        if (
            !event.routing &&
            !event.topic &&
            !event.partitionKey &&
            !event.routingKey
        ) {

            throw new TypeError(

                'Transaction outbox event routing metadata is required'

            );

        }


        return true;

    }


    /**
     * =========================================================================
     * Scoped Query
     * =========================================================================
     */

    normalizeScopedQuery(
        query
    ) {

        const result = {
            ...query
        };


        if (
            query.tenantId
        ) {

            result.tenantId =
                query.tenantId;

        }


        return result;

    }


    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */

    isDuplicateError(
        error
    ) {

        return (

            error?.code ===
                11000 ||

            error?.name ===
                'MongoServerError' &&
            Boolean(
                error?.keyPattern
            )

        );

    }


    /**
     * =========================================================================
     * Tenant Validation
     * =========================================================================
     */

    requireTenant(
        tenantId
    ) {

        if (
            !tenantId
        ) {

            throw createRepositoryError(

                'OUTBOX_TENANT_REQUIRED',

                'tenantId is required'

            );

        }

    }


    /**
     * =========================================================================
     * Worker Validation
     * =========================================================================
     */

    requireWorker(
        workerId
    ) {

        if (
            !workerId
        ) {

            throw createRepositoryError(

                'OUTBOX_WORKER_REQUIRED',

                'workerId is required'

            );

        }

    }


    /**
     * =========================================================================
     * Now
     * =========================================================================
     */

    now() {

        return new this.clock();

    }


    /**
     * =========================================================================
     * Close / Shutdown
     * =========================================================================
     */

    async shutdown() {

        return true;

    }

}


module.exports =
    TransactionOutboxRepository;


module.exports.TransactionOutboxRepository =
    TransactionOutboxRepository;


module.exports.OUTBOX_STATUS =
    OUTBOX_STATUS;