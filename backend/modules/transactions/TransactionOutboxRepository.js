'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Outbox Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionOutboxRepository.js
 *
 * Purpose
 * -------
 * Durable persistence adapter for transaction-domain outbox events.
 *
 * Responsibilities
 * ----------------
 * ✓ Transactional outbox persistence
 * ✓ Atomic event insertion
 * ✓ Tenant-isolated event lookup
 * ✓ Deterministic event-key deduplication
 * ✓ Atomic worker claiming
 * ✓ Lease ownership
 * ✓ Lease renewal
 * ✓ Lease release
 * ✓ Optimistic concurrency
 * ✓ Publish state transitions
 * ✓ Retry persistence
 * ✓ Exponential backoff
 * ✓ Dead-letter handling
 * ✓ Replay support
 * ✓ Expired-lease recovery
 * ✓ MongoDB/Mongoose session support
 * ✓ Operational statistics
 * ✓ Health diagnostics
 *
 * Database
 * --------
 * Primary:
 *   MongoDB / Mongoose
 *
 * Compatible Architecture
 * -----------------------
 * A PostgreSQL implementation can satisfy the same logical repository
 * contract without changing the outbox worker.
 *
 * Important
 * ---------
 * This repository does not publish events.
 *
 * It only persists and coordinates durable delivery state.
 *
 * ============================================================================
 */

const {
    EventStatus
} = require('./TransactionOutboxModel');


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    batchSize:
        100,

    leaseTimeoutMs:
        30000,

    maxRetryAttempts:
        10,

    initialRetryDelayMs:
        1000,

    maxRetryDelayMs:
        60000,

    retryJitterRatio:
        0.25

});


/**
 * ============================================================================
 * Internal Delivery States
 * ============================================================================
 *
 * Keeps compatibility with the core model while supporting lease-aware
 * processing.
 * ============================================================================
 */

const STATUS = Object.freeze({

    CREATED:
        EventStatus.CREATED,

    PENDING:
        EventStatus.PENDING,

    PROCESSING:
        EventStatus.PROCESSING,

    PUBLISHED:
        EventStatus.PUBLISHED,

    FAILED:
        EventStatus.FAILED,

    DEAD_LETTER:
        EventStatus.DEAD_LETTER

});


/**
 * ============================================================================
 * Repository
 * ============================================================================
 */

class TransactionOutboxRepository {

    constructor(
        options = {}
    ) {

        if (
            !options.model
        ) {

            throw new Error(
                'TransactionOutboxRepository requires a Mongoose model'
            );

        }


        this.model =
            options.model;


        this.logger =
            options.logger ||
            console;


        this.metrics =
            options.metrics ||
            null;


        this.clock =
            options.clock ||
            Date;


        this.batchSize =
            this.normalizePositiveInteger(
                options.batchSize ||
                DEFAULTS.batchSize
            );


        this.leaseTimeoutMs =
            this.normalizePositiveInteger(
                options.leaseTimeoutMs ||
                options.lockTimeoutMs ||
                DEFAULTS.leaseTimeoutMs
            );


        this.maxRetryAttempts =
            this.normalizePositiveInteger(
                options.maxRetryAttempts ||
                DEFAULTS.maxRetryAttempts
            );


        this.initialRetryDelayMs =
            this.normalizePositiveInteger(
                options.initialRetryDelayMs ||
                DEFAULTS.initialRetryDelayMs
            );


        this.maxRetryDelayMs =
            this.normalizePositiveInteger(
                options.maxRetryDelayMs ||
                DEFAULTS.maxRetryDelayMs
            );


        this.retryJitterRatio =
            this.normalizeRatio(
                options.retryJitterRatio,
                DEFAULTS.retryJitterRatio
            );


        this.statistics = {

            created:
                0,

            duplicate:
                0,

            pendingQueries:
                0,

            claims:
                0,

            claimConflicts:
                0,

            renewals:
                0,

            renewalFailures:
                0,

            releases:
                0,

            published:
                0,

            failures:
                0,

            retries:
                0,

            deadLetters:
                0,

            deadLetterRetries:
                0,

            replays:
                0,

            deletions:
                0,

            recoveryQueries:
                0,

            recoveryReleases:
                0

        };

    }


    /**
     * =========================================================================
     * Create
     * =========================================================================
     *
     * Must be called using the same MongoDB session as the business
     * transaction when implementing the transactional outbox pattern.
     *
     * Supports:
     *
     * await repository.create(record, session);
     */

    async create(
        record,
        session = null
    ) {

        this.validateRecord(
            record
        );


        try {

            const document =
                new this.model(
                    record
                );


            await document.save({

                session

            });


            this.statistics.created++;


            this.metrics?.increment?.(
                'transaction_outbox_created_total'
            );


            return document.toObject();


        }
        catch (error) {

            if (
                this.isDuplicateError(
                    error
                )
            ) {

                this.statistics.duplicate++;


                this.metrics?.increment?.(
                    'transaction_outbox_duplicate_total'
                );


                const existing =
                    await this.findExistingDuplicate(
                        record,
                        session
                    );


                if (
                    existing
                ) {

                    return existing;

                }

            }


            throw this.normalizeRepositoryError(
                error
            );

        }

    }


    /**
     * =========================================================================
     * Create Many
     * =========================================================================
     *
     * Intended for batch/event-import paths. For transactional outbox writes
     * belonging to a business transaction, prefer create() within that session.
     */

    async createMany(
        records = [],
        session = null
    ) {

        if (
            !Array.isArray(
                records
            )
        ) {

            throw new TypeError(
                'records must be an array'
            );

        }


        if (
            records.length === 0
        ) {

            return [];

        }


        records.forEach(
            record =>
                this.validateRecord(
                    record
                )
        );


        const documents =
            records.map(
                record =>
                    new this.model(
                        record
                    )
            );


        try {

            const saved =
                await this.model.insertMany(

                    documents,

                    {

                        session,

                        ordered:
                            true

                    }

                );


            this.statistics.created +=
                saved.length;


            this.metrics?.increment?.(

                'transaction_outbox_created_batch_total',

                {

                    count:
                        saved.length

                }

            );


            return saved.map(
                document =>
                    document.toObject()
            );

        }
        catch (error) {

            throw this.normalizeRepositoryError(
                error
            );

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

        const scopedQuery =
            this.normalizeQuery(
                query
            );


        let operation =
            this.model.findOne(
                scopedQuery
            );


        if (
            options.sort
        ) {

            operation =
                operation.sort(
                    options.sort
                );

        }


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
     * Find By ID
     * =========================================================================
     *
     * Retained for compatibility.
     */

    async findById(
        id,
        tenantId = null
    ) {

        if (
            !id
        ) {

            return null;

        }


        return this.findOne({

            ...(tenantId
                ? {
                    tenantId
                }
                : {}),

            id

        });

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
     * Find By Transaction
     * =========================================================================
     */

    async findByTransaction({
        tenantId,
        transactionId,
        limit =
            this.batchSize,
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
                    this.batchSize
                )
            )
            .lean()
            .exec();

    }


    /**
     * =========================================================================
     * Find Pending
     * =========================================================================
     *
     * Legacy-compatible method.
     *
     * New workers should prefer findDue()/claimBatch().
     */

    async findPending(
        limit =
            this.batchSize,
        options = {}
    ) {

        const now =
            this.now();


        const filter = {

            status:
                STATUS.PENDING,

            $or: [

                {

                    availableAt:
                        null

                },

                {

                    availableAt: {

                        $lte:
                            now

                    }

                }

            ]

        };


        if (
            options.tenantId
        ) {

            filter.tenantId =
                options.tenantId;

        }


        this.statistics.pendingQueries++;


        return this.model
            .find(
                filter
            )
            .sort({

                priority:
                    -1,

                availableAt:
                    1,

                createdAt:
                    1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.batchSize
                )
            )
            .lean()
            .exec();

    }


    /**
     * =========================================================================
     * Find Due
     * =========================================================================
     */

    async findDue({
        tenantId = null,
        provider = null,
        eventType = null,
        limit =
            this.batchSize,
        now =
            this.now()
    } = {}) {

        const pendingClause = {

            status:
                STATUS.PENDING,

            $or: [

                {
                    availableAt:
                        null
                },

                {
                    availableAt: {
                        $lte:
                            now
                    }
                }

            ]

        };


        const processingExpiredClause = {

            status:
                STATUS.PROCESSING,

            lockedAt: {

                $lte:

                    new Date(

                        now.getTime() -
                        this.leaseTimeoutMs

                    )

            }

        };


        const filter = {

            ...(tenantId
                ? {
                    tenantId
                }
                : {}),

            ...(provider
                ? {
                    provider:
                        String(
                            provider
                        ).toUpperCase()
                }
                : {}),

            ...(eventType
                ? {
                    eventType:
                        String(
                            eventType
                        ).toLowerCase()
                }
                : {}),

            $or: [

                pendingClause,

                processingExpiredClause

            ]

        };


        return this.model
            .find(
                filter
            )
            .sort({

                priority:
                    -1,

                createdAt:
                    1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.batchSize
                )
            )
            .lean()
            .exec();

    }


    /**
     * =========================================================================
     * Atomic Claim
     * =========================================================================
     *
     * The operation is atomic at MongoDB level.
     *
     * First worker wins.
     *
     * A worker can reclaim:
     *
     * 1. PENDING events
     * 2. PROCESSING events whose lease expired
     *
     */

    async claim({
        tenantId,
        eventId,
        workerId,
        leaseMs =
            this.leaseTimeoutMs,
        now =
            this.now()
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


        if (
            !workerId
        ) {

            throw new TypeError(
                'workerId is required'
            );

        }


        const leaseExpiresAt =
            new Date(

                now.getTime() +
                Math.max(
                    1000,
                    Number(
                        leaseMs
                    ) ||
                    this.leaseTimeoutMs
                )

            );


        const expiredLeaseCutoff =
            new Date(

                now.getTime() -
                this.leaseTimeoutMs

            );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    $or: [

                        {

                            status:
                                STATUS.PENDING,

                            $or: [

                                {

                                    availableAt:
                                        null

                                },

                                {

                                    availableAt: {

                                        $lte:
                                            now

                                    }

                                }

                            ]

                        },

                        {

                            status:
                                STATUS.PROCESSING,

                            lockedAt: {

                                $lte:
                                    expiredLeaseCutoff

                            }

                        },

                        /**
                         * Reentrant ownership at repository level.
                         *
                         * Useful when the same worker renews/reclaims its own
                         * event after a transient cycle.
                         */

                        {

                            status:
                                STATUS.PROCESSING,

                            lockedBy:
                                workerId

                        }

                    ]

                },

                {

                    $set: {

                        status:
                            STATUS.PROCESSING,

                        lockedAt:
                            now,

                        lockedBy:
                            workerId,

                        leaseExpiresAt,

                        updatedAt:
                            now

                    },

                    $inc: {

                        attempts:
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
            'transaction_outbox_claimed_total'
        );


        return result.toObject
            ? result.toObject()
            : result;

    }


    /**
     * =========================================================================
     * Mark Processing
     * =========================================================================
     *
     * Backward-compatible alias.
     */

    async markProcessing(
        id,
        workerId = null,
        options = {}
    ) {

        if (
            !options.tenantId
        ) {

            /**
             * Legacy calls may only supply id.
             * Prefer claim() in new code.
             */
            const record =
                await this.findById(
                    id
                );


            if (
                !record
            ) {

                return null;

            }


            if (
                workerId
            ) {

                return this.claim({

                    tenantId:
                        record.tenantId,

                    eventId:
                        record.eventId ||
                        record.id,

                    workerId,

                    leaseMs:
                        options.leaseMs ||
                        this.leaseTimeoutMs

                });

            }


            return this.model.findOneAndUpdate(

                {

                    id,

                    status:
                        STATUS.PENDING

                },

                {

                    $set: {

                        status:
                            STATUS.PROCESSING,

                        lockedAt:
                            this.now(),

                        lockedBy:
                            workerId,

                        updatedAt:
                            this.now()

                    },

                    $inc: {

                        attempts:
                            1,

                        version:
                            1

                    }

                },

                {

                    new:
                        true

                }

            ).lean().exec();

        }


        return this.claim({

            tenantId:
                options.tenantId,

            eventId:
                id,

            workerId:
                workerId ||
                `repository-${process.pid}`,

            leaseMs:
                options.leaseMs ||
                this.leaseTimeoutMs

        });

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
            this.batchSize,
        leaseMs =
            this.leaseTimeoutMs
    } = {}) {

        if (
            !workerId
        ) {

            throw new TypeError(
                'workerId is required'
            );

        }


        const records =
            await this.findDue({

                tenantId,

                limit:
                    batchSize

            });


        const claimed = [];


        for (
            const record
            of records
        ) {

            const claimedRecord =
                await this.claim({

                    tenantId:
                        record.tenantId,

                    eventId:
                        record.eventId ||
                        record.id,

                    workerId,

                    leaseMs

                });


            if (
                claimedRecord
            ) {

                claimed.push(
                    claimedRecord
                );

            }

        }


        return claimed;

    }


    /**
     * =========================================================================
     * Renew Lease
     * =========================================================================
     */

    async heartbeat({
        tenantId,
        eventId,
        workerId,
        leaseMs =
            this.leaseTimeoutMs,
        now =
            this.now()
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


        if (
            !workerId
        ) {

            throw new TypeError(
                'workerId is required'
            );

        }


        const leaseExpiresAt =
            new Date(

                now.getTime() +
                Math.max(
                    1000,
                    Number(
                        leaseMs
                    ) ||
                    this.leaseTimeoutMs
                )

            );


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        STATUS.PROCESSING,

                    lockedBy:
                        workerId

                },

                {

                    $set: {

                        leaseExpiresAt,

                        lockedAt:
                            now,

                        updatedAt:
                            now

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
            !result
        ) {

            this.statistics.renewalFailures++;


            throw this.createRepositoryError(

                'OUTBOX_LEASE_LOST',

                'Outbox lease is no longer owned by worker',

                {

                    tenantId,

                    eventId,

                    workerId,

                    retryable:
                        true

                }

            );

        }


        this.statistics.renewals++;


        this.metrics?.increment?.(
            'transaction_outbox_heartbeat_total'
        );


        return result.toObject
            ? result.toObject()
            : result;

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


        const result =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    eventId,

                    status:
                        STATUS.PROCESSING,

                    lockedBy:
                        workerId

                },

                {

                    $set: {

                        status:
                            STATUS.PENDING,

                        availableAt:
                            this.now(),

                        updatedAt:
                            this.now()

                    },

                    $unset: {

                        lockedAt:
                            1,

                        lockedBy:
                            1,

                        leaseExpiresAt:
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


            this.metrics?.increment?.(
                'transaction_outbox_lease_released_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Mark Published
     * =========================================================================
     */

    async markPublished(
        id,
        options = {}
    ) {

        const tenantId =
            options.tenantId ||
            null;

        const workerId =
            options.workerId ||
            null;


        const query = {

            ...(tenantId
                ? {
                    tenantId
                }
                : {}),

            ...(workerId
                ? {
                    lockedBy:
                        workerId
                }
                : {}),

            eventId:
                options.eventId ||
                id,

            status:
                STATUS.PROCESSING

        };


        const now =
            this.now();


        const update = {

            $set: {

                status:
                    STATUS.PUBLISHED,

                publishedAt:
                    now,

                updatedAt:
                    now

            },

            $unset: {

                lockedAt:
                    1,

                lockedBy:
                    1,

                leaseExpiresAt:
                    1,

                lastError:
                    1,

                availableAt:
                    1

            },

            $inc: {

                version:
                    1

            }

        };


        const result =
            await this.model.findOneAndUpdate(

                query,

                update,

                {

                    new:
                        true

                }

            ).exec();


        if (
            !result
        ) {

            throw this.createRepositoryError(

                'OUTBOX_COMPLETE_CONFLICT',

                'Unable to mark outbox event as published because the worker no longer owns the record',

                {

                    tenantId,

                    eventId:
                        options.eventId ||
                        id,

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
     * Complete
     * =========================================================================
     */

    async complete(
        options = {}
    ) {

        return this.markPublished(

            options.eventId,

            options

        );

    }


    /**
     * =========================================================================
     * Persist Failure + Retry
     * =========================================================================
     */

    async markFailed(
        id,
        error,
        options = {}
    ) {

        const eventId =
            options.eventId ||
            id;


        const tenantId =
            options.tenantId ||
            null;


        const workerId =
            options.workerId ||
            null;


        const record =
            await this.findOne({

                ...(tenantId
                    ? {
                        tenantId
                    }
                    : {}),

                eventId

            });


        if (
            !record
        ) {

            return null;

        }


        const currentAttempts =
            Math.max(

                0,

                Number(
                    record.attempts
                ) ||
                0

            );


        const attempts =
            currentAttempts + 1;


        const maxAttempts =
            Number(
                options.maxRetryAttempts ||
                record.maxAttempts ||
                this.maxRetryAttempts
            );


        const retryable =
            options.retryable !==
                undefined

                ? Boolean(
                    options.retryable
                )

                : (
                    error?.retryable !==
                    false
                );


        const exhausted =
            attempts >=
            maxAttempts;


        const terminal =
            !retryable ||
            exhausted;


        const now =
            this.now();


        const lastError =
            this.normalizeError(
                error
            );


        let nextAttemptAt =
            null;


        if (
            !terminal
        ) {

            nextAttemptAt =
                this.calculateRetryTime(
                    attempts
                );

        }


        const filter = {

            ...(tenantId
                ? {
                    tenantId
                }
                : {}),

            eventId

        };


        if (
            workerId
        ) {

            filter.status =
                STATUS.PROCESSING;

            filter.lockedBy =
                workerId;

        }


        const update = {

            $set: {

                status:
                    terminal

                        ? STATUS.DEAD_LETTER

                        : STATUS.PENDING,

                lastError,

                availableAt:
                    nextAttemptAt,

                updatedAt:
                    now,

                failedAt:
                    now,

                ...(terminal
                    ? {
                        deadLetteredAt:
                            now
                    }
                    : {})

            },

            $unset: {

                lockedAt:
                    1,

                lockedBy:
                    1,

                leaseExpiresAt:
                    1

            },

            $inc: {

                attempts:
                    1,

                version:
                    1

            }

        };


        const result =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true

                }

            ).exec();


        if (
            !result
        ) {

            throw this.createRepositoryError(

                'OUTBOX_FAILURE_CONFLICT',

                'Unable to persist outbox failure because record ownership changed',

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


        if (
            terminal
        ) {

            this.statistics.deadLetters++;


            this.metrics?.increment?.(
                'transaction_outbox_dead_lettered_total'
            );

        }
        else {

            this.statistics.retries++;


            this.metrics?.increment?.(
                'transaction_outbox_retry_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Fail Alias
     * =========================================================================
     */

    async fail(
        options = {}
    ) {

        return this.markFailed(

            options.eventId,

            options.error,

            options

        );

    }


    /**
     * =========================================================================
     * Dead Letter Retrieval
     * =========================================================================
     */

    async findDeadLetters(
        limit =
            this.batchSize,
        options = {}
    ) {

        const filter = {

            status:
                STATUS.DEAD_LETTER

        };


        if (
            options.tenantId
        ) {

            filter.tenantId =
                options.tenantId;

        }


        return this.model
            .find(
                filter
            )
            .sort({

                deadLetteredAt:
                    -1,

                updatedAt:
                    -1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.batchSize
                )
            )
            .lean()
            .exec();

    }


    /**
     * =========================================================================
     * Retry Dead Letter
     * =========================================================================
     */

    async retryDeadLetter(
        id,
        options = {}
    ) {

        const tenantId =
            options.tenantId ||
            null;


        const eventId =
            options.eventId ||
            id;


        const now =
            this.now();


        const filter = {

            ...(tenantId
                ? {
                    tenantId
                }
                : {}),

            eventId,

            status:
                STATUS.DEAD_LETTER

        };


        const update = {

            $set: {

                status:
                    STATUS.PENDING,

                availableAt:
                    now,

                updatedAt:
                    now,

                attempts:
                    0

            },

            $unset: {

                deadLetteredAt:
                    1,

                failedAt:
                    1,

                lastError:
                    1,

                lockedAt:
                    1,

                lockedBy:
                    1,

                leaseExpiresAt:
                    1

            },

            $inc: {

                version:
                    1

            }

        };


        const result =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true

                }

            ).exec();


        if (
            result
        ) {

            this.statistics.deadLetterRetries++;


            this.metrics?.increment?.(
                'transaction_outbox_dead_letter_retry_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Replay
     * =========================================================================
     *
     * Replay does not mutate the immutable event envelope.
     *
     * It only moves publication state back into PENDING.
     */

    async replay(
        id,
        options = {}
    ) {

        const tenantId =
            options.tenantId ||
            null;


        const eventId =
            options.eventId ||
            id;


        const now =
            this.now();


        const result =
            await this.model.findOneAndUpdate(

                {

                    ...(tenantId
                        ? {
                            tenantId
                        }
                        : {}),

                    eventId,

                    status: {

                        $in: [

                            STATUS.PUBLISHED,

                            STATUS.FAILED,

                            STATUS.DEAD_LETTER

                        ]

                    }

                },

                {

                    $set: {

                        status:
                            STATUS.PENDING,

                        availableAt:
                            now,

                        updatedAt:
                            now

                    },

                    $unset: {

                        publishedAt:
                            1,

                        failedAt:
                            1,

                        deadLetteredAt:
                            1,

                        lastError:
                            1,

                        lockedAt:
                            1,

                        lockedBy:
                            1,

                        leaseExpiresAt:
                            1

                    },

                    $inc: {

                        replayCount:
                            1,

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

            this.statistics.replays++;


            this.metrics?.increment?.(
                'transaction_outbox_replay_total'
            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Find Expired Locks / Leases
     * =========================================================================
     */

    async findExpiredLeases({
        tenantId = null,
        limit =
            this.batchSize,
        now =
            this.now()
    } = {}) {

        const cutoff =
            new Date(

                now.getTime() -
                this.leaseTimeoutMs

            );


        const filter = {

            status:
                STATUS.PROCESSING,

            lockedAt: {

                $lte:
                    cutoff

            }

        };


        if (
            tenantId
        ) {

            filter.tenantId =
                tenantId;

        }


        this.statistics.recoveryQueries++;


        return this.model
            .find(
                filter
            )
            .sort({

                lockedAt:
                    1

            })
            .limit(
                Math.max(
                    1,
                    Number(limit) ||
                    this.batchSize
                )
            )
            .lean()
            .exec();

    }


    /**
     * =========================================================================
     * Release Expired Leases
     * =========================================================================
     */

    async releaseExpiredLeases({
        tenantId = null,
        limit =
            this.batchSize,
        now =
            this.now()
    } = {}) {

        const expired =
            await this.findExpiredLeases({

                tenantId,

                limit,

                now

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
                            STATUS.PROCESSING,

                        lockedAt: {

                            $lte:

                                new Date(

                                    now.getTime() -
                                    this.leaseTimeoutMs

                                )

                        }

                    },

                    {

                        $set: {

                            status:
                                STATUS.PENDING,

                            availableAt:
                                now,

                            updatedAt:
                                now

                        },

                        $unset: {

                            lockedAt:
                                1,

                            lockedBy:
                                1,

                            leaseExpiresAt:
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

                released.push(
                    result
                );

                this.statistics.recoveryReleases++;

            }

        }


        if (
            released.length
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


    /**
     * =========================================================================
     * Optimistic Update
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


        const filter = {

            tenantId,

            eventId

        };


        if (
            expectedVersion !==
                null &&
            expectedVersion !==
                undefined
        ) {

            filter.version =
                Number(
                    expectedVersion
                );

        }


        if (
            workerId
        ) {

            filter.lockedBy =
                workerId;

        }


        const safePatch =
            this.sanitizeUpdatePatch(
                patch
            );


        const result =
            await this.model.findOneAndUpdate(

                filter,

                {

                    $set: {

                        ...safePatch,

                        updatedAt:
                            this.now()

                    },

                    $inc: {

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
            !result &&
            expectedVersion !==
                null &&
            expectedVersion !==
                undefined
        ) {

            throw this.createRepositoryError(

                'OUTBOX_VERSION_CONFLICT',

                'Outbox optimistic concurrency conflict',

                {

                    tenantId,

                    eventId,

                    expectedVersion,

                    retryable:
                        true

                }

            );

        }


        return result;

    }


    /**
     * =========================================================================
     * Remove
     * =========================================================================
     */

    async remove(
        id,
        options = {}
    ) {

        const filter = {

            ...(options.tenantId
                ? {
                    tenantId:
                        options.tenantId
                }
                : {}),

            eventId:
                options.eventId ||
                id

        };


        const result =
            await this.model.deleteOne(
                filter
            );


        if (
            result.deletedCount
        ) {

            this.statistics.deletions +=
                result.deletedCount;

        }


        return result;

    }


    /**
     * =========================================================================
     * Remove Published
     * =========================================================================
     *
     * Use only after retention/legal/compliance policy permits deletion.
     */

    async removePublished(
        beforeDate,
        options = {}
    ) {

        if (
            !beforeDate
        ) {

            throw new TypeError(
                'beforeDate is required'
            );

        }


        const filter = {

            status:
                STATUS.PUBLISHED,

            publishedAt: {

                $lt:
                    beforeDate

            }

        };


        if (
            options.tenantId
        ) {

            filter.tenantId =
                options.tenantId;

        }


        const result =
            await this.model.deleteMany(
                filter
            );


        this.statistics.deletions +=
            result.deletedCount ||
            0;


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

                component:
                    'transaction-outbox-repository',

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

                component:
                    'transaction-outbox-repository',

                latencyMs:
                    Date.now() -
                    started,

                error:
                    this.normalizeError(
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

            batchSize:
                this.batchSize,

            leaseTimeoutMs:
                this.leaseTimeoutMs,

            maxRetryAttempts:
                this.maxRetryAttempts,

            initialRetryDelayMs:
                this.initialRetryDelayMs,

            maxRetryDelayMs:
                this.maxRetryDelayMs

        };

    }


    /**
     * =========================================================================
     * Retry Backoff
     * =========================================================================
     */

    calculateRetryTime(
        attempt
    ) {

        const exponent =
            Math.max(

                0,

                Number(
                    attempt
                ) - 1

            );


        const exponential =
            Math.min(

                this.maxRetryDelayMs,

                this.initialRetryDelayMs *
                Math.pow(
                    2,
                    exponent
                )

            );


        const jitter =
            exponential *
            this.retryJitterRatio *
            Math.random();


        return new Date(

            this.now().getTime() +
            exponential +
            jitter

        );

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateRecord(
        record
    ) {

        if (
            !record ||
            typeof record !==
                'object'
        ) {

            throw new TypeError(
                'Outbox record must be an object'
            );

        }


        const event =
            record.event ||
            record;


        if (
            !record.id &&
            !record.eventId &&
            !event.eventId
        ) {

            throw new TypeError(
                'Outbox eventId is required'
            );

        }


        if (
            !record.tenantId &&
            !event.tenantId
        ) {

            throw new TypeError(
                'Outbox tenantId is required'
            );

        }


        if (
            !event.eventType
        ) {

            throw new TypeError(
                'Outbox eventType is required'
            );

        }


        if (
            !event.payload
        ) {

            throw new TypeError(
                'Outbox event payload is required'
            );

        }


        return true;

    }


    /**
     * =========================================================================
     * Duplicate Lookup
     * =========================================================================
     */

    async findExistingDuplicate(
        record,
        session = null
    ) {

        const tenantId =
            record.tenantId ||
            record.event?.tenantId;


        const eventId =
            record.eventId ||
            record.event?.eventId;


        const eventKey =
            record.eventKey ||
            record.event?.eventKey;


        if (
            tenantId &&
            eventId
        ) {

            const byEventId =
                await this.model.findOne({

                    tenantId,

                    eventId

                })
                .session(
                    session
                )
                .lean()
                .exec();


            if (
                byEventId
            ) {

                return byEventId;

            }

        }


        if (
            tenantId &&
            eventKey
        ) {

            const byEventKey =
                await this.model.findOne({

                    tenantId,

                    eventKey

                })
                .session(
                    session
                )
                .lean()
                .exec();


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
     * Safe Update Patch
     * =========================================================================
     *
     * Immutable event-envelope fields are intentionally excluded.
     */

    sanitizeUpdatePatch(
        patch = {}
    ) {

        const allowed = [

            'status',

            'availableAt',

            'publishedAt',

            'failedAt',

            'deadLetteredAt',

            'lockedAt',

            'lockedBy',

            'leaseExpiresAt',

            'lastError',

            'attempts',

            'maxAttempts',

            'replayCount',

            'nextAttemptAt',

            'priority',

            'updatedAt'

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
     * Query Normalization
     * =========================================================================
     */

    normalizeQuery(
        query = {}
    ) {

        return {

            ...query

        };

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (
            !error
        ) {

            return {

                name:
                    'Error',

                code:
                    'UNKNOWN',

                message:
                    'Unknown error',

                occurredAt:
                    this.now()

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

            stack:
                error.stack ||
                null,

            retryable:
                error.retryable !==
                    false,

            provider:
                error.provider ||
                null,

            providerCode:
                error.providerCode ||
                null,

            occurredAt:
                this.now()

        };

    }


    /**
     * =========================================================================
     * Repository Error
     * =========================================================================
     */

    createRepositoryError(
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

            (
                error?.name ===
                    'MongoServerError' &&

                Boolean(
                    error?.keyPattern
                )

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

            throw this.createRepositoryError(

                'OUTBOX_TENANT_REQUIRED',

                'tenantId is required'

            );

        }

    }


    /**
     * =========================================================================
     * Integer Validation
     * =========================================================================
     */

    normalizePositiveInteger(
        value
    ) {

        const number =
            Number(
                value
            );


        if (
            !Number.isFinite(
                number
            ) ||
            number <= 0
        ) {

            return 1;

        }


        return Math.floor(
            number
        );

    }


    /**
     * =========================================================================
     * Ratio
     * =========================================================================
     */

    normalizeRatio(
        value,
        fallback
    ) {

        const ratio =
            Number(
                value
            );


        if (
            !Number.isFinite(
                ratio
            )
        ) {

            return fallback;

        }


        return Math.min(

            1,

            Math.max(
                0,
                ratio
            )

        );

    }


    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        return new this.clock();

    }

}


/**
 * ============================================================================
 * Static API
 * ============================================================================
 */

TransactionOutboxRepository.Status =
    STATUS;


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TransactionOutboxRepository;