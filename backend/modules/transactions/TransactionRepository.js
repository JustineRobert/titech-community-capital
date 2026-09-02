'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Repository
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/TransactionRepository.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 * • Persist transactions
 * • Retrieve transactions
 * • Update transaction state
 * • Atomic recovery claiming
 * • Recovery lease management
 * • Retry scheduling
 * • Recovery attempts
 * • Recovery history
 * • Dead-letter state
 * • Idempotency lookups
 * • Correlation tracking
 * • Tenant isolation
 * • Optimistic concurrency
 * • Soft delete
 * • Audit metadata
 * • Transaction lifecycle history
 *
 * Design principles
 * ----------------------------------------------------------------------------
 *
 * ✓ Tenant-aware by default
 * ✓ Recovery operations are concurrency-safe
 * ✓ State transitions use conditional updates
 * ✓ Recovery leases expire automatically
 * ✓ Repository remains Mongo/Mongoose friendly
 * ✓ No financial balances are mutated here
 * ✓ No direct ledger posting is performed here
 * ✓ Repository failures never silently become success
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Transaction Repository
 * ============================================================================
 */

class TransactionRepository {

    constructor(options = {}) {

        if (!options.model) {

            throw new Error(
                'TransactionRepository requires a transaction model.'
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


        this.tracer =
            options.tracer;


        this.clock =
            options.clock ||
            (() => new Date());


        this.tenantRequired =
            options.tenantRequired !== false;


        this.maxListLimit =
            Math.min(
                Number(options.maxListLimit) || 500,
                1000
            );


        this.recoveryLeaseField =
            options.recoveryLeaseField ||
            'recoveryLeaseUntil';


        this.recoveryOwnerField =
            options.recoveryOwnerField ||
            'recoveryOwner';


        this.ensureRepositoryCompatibility();

    }


    /**
     * =========================================================================
     * Create
     * =========================================================================
     */

    async create(transaction, options = {}) {

        const span =
            this.tracer?.startSpan?.(
                'transaction.repository.create'
            );


        try {

            this.assertTenantContext(
                transaction
            );


            const now =
                this.now();


            const document =
                new this.model({

                    ...transaction,

                    createdAt:
                        transaction.createdAt ||
                        now,

                    updatedAt:
                        now,

                    version:
                        transaction.version ||
                        1,

                    isDeleted:
                        false,

                    history:
                        Array.isArray(
                            transaction.history
                        )
                            ? transaction.history
                            : []

                });


            const saved =
                await document.save(
                    options
                );


            this.incrementMetric(
                'transaction_repository_create_total'
            );


            return saved;

        }

        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Find by Transaction ID
     * =========================================================================
     */

    async findByTransactionId(
        transactionId,
        options = {}
    ) {

        if (!transactionId) {

            throw new TypeError(
                'transactionId is required.'
            );

        }


        const filter =
            this.buildTenantFilter(
                {
                    transactionId
                },
                options
            );


        return this.model.findOne(
            filter,
            null,
            options
        );

    }


    /**
     * =========================================================================
     * Find by Database ID
     * =========================================================================
     */

    async findById(
        id,
        options = {}
    ) {

        const filter =
            this.buildTenantFilter(
                {
                    _id: id
                },
                options
            );


        return this.model.findOne(
            filter,
            null,
            options
        );

    }


    /**
     * =========================================================================
     * Find by Idempotency Key
     * =========================================================================
     */

    async findByIdempotencyKey(
        idempotencyKey,
        tenantId,
        options = {}
    ) {

        if (!idempotencyKey) {

            throw new TypeError(
                'idempotencyKey is required.'
            );

        }


        const effectiveTenantId =
            tenantId ||
            options.tenantId;


        this.assertTenantId(
            effectiveTenantId
        );


        return this.model.findOne({

            idempotencyKey,

            tenantId:
                effectiveTenantId,

            isDeleted:
                { $ne: true }

        }, null, options);

    }


    /**
     * =========================================================================
     * Find by Correlation ID
     * =========================================================================
     */

    async findByCorrelationId(
        correlationId,
        options = {}
    ) {

        if (!correlationId) {

            throw new TypeError(
                'correlationId is required.'
            );

        }


        return this.model.find(

            this.buildTenantFilter(
                {
                    correlationId
                },
                options
            )

        ).sort({

            createdAt:
                1

        });

    }


    /**
     * =========================================================================
     * Update State
     * =========================================================================
     *
     * Supports:
     *
     * repository.updateState(
     *     transactionId,
     *     state,
     *     metadata
     * )
     *
     * Optional metadata:
     *
     * • tenantId
     * • expectedState
     * • expectedVersion
     * • lastError
     * • recoveryOwner
     * • recoveryLeaseUntil
     * • retryAttempts
     * • retryAt
     * • historyEvent
     */

    async updateState(
        transactionId,
        state,
        metadata = {}
    ) {

        if (!transactionId) {

            throw new TypeError(
                'transactionId is required.'
            );

        }


        if (!state) {

            throw new TypeError(
                'state is required.'
            );

        }


        const now =
            this.now();


        const filter =
            this.buildTenantFilter(
                {
                    transactionId
                },
                metadata
            );


        if (
            metadata.expectedState
        ) {

            filter.state =
                metadata.expectedState;

        }


        if (
            Number.isInteger(
                metadata.expectedVersion
            )
        ) {

            filter.version =
                metadata.expectedVersion;

        }


        const update = {

            $set: {

                state,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1

            }

        };


        if (
            Object.prototype.hasOwnProperty.call(
                metadata,
                'lastError'
            )
        ) {

            update.$set.lastError =
                metadata.lastError;

        }


        this.applyRecoveryMetadata(
            update,
            metadata
        );


        if (
            metadata.historyEvent
        ) {

            update.$push = {

                history:
                    this.createHistoryEntry(
                        metadata.historyEvent,
                        metadata
                    )

            };

        }


        const updated =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true,

                    runValidators:
                        metadata.runValidators !== false

                }

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Transaction state update failed or optimistic concurrency check failed.'

            );

        }


        this.incrementMetric(
            'transaction_repository_state_update_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Atomic Recovery Claim
     * =========================================================================
     *
     * This is the most important addition for multi-instance recovery.
     *
     * A transaction may be claimed when:
     *
     * 1. It is still in the expected state.
     * 2. It is not deleted.
     * 3. It has no active recovery lease.
     * 4. Its existing lease has expired.
     *
     * The database performs the ownership transition atomically.
     */

    async claimForRecovery(
        transactionId,
        options = {}
    ) {

        if (!transactionId) {

            throw new TypeError(
                'transactionId is required.'
            );

        }


        const now =
            this.now();


        const leaseUntil =
            options.leaseUntil ||
            new Date(
                now.getTime() +
                120000
            );


        const owner =
            options.owner ||
            `recovery:${crypto.randomUUID()}`;


        const filter =
            this.buildTenantFilter(
                {

                    transactionId,

                    isDeleted:
                        { $ne: true }

                },

                options

            );


        if (
            options.expectedState
        ) {

            filter.state =
                options.expectedState;

        }


        /**
         * Claim only if:
         *
         * • recovery lease does not exist
         * OR
         * • recovery lease has expired
         */

        filter.$or = [

            {

                recoveryLeaseUntil:
                    {
                        $exists:
                            false
                    }

            },

            {

                recoveryLeaseUntil:
                    null

            },

            {

                recoveryLeaseUntil:
                    {
                        $lte:
                            now
                    }

            }

        ];


        const update = {

            $set: {

                state:
                    'RECOVERING',

                recoveryOwner:
                    owner,

                recoveryLeaseUntil:
                    leaseUntil,

                recoveryClaimedAt:
                    now,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1,

                recoveryAttempts:
                    1

            },

            $push: {

                history:
                    this.createHistoryEntry(

                        'RECOVERY_CLAIMED',

                        {

                            owner,

                            leaseUntil,

                            timestamp:
                                now

                        }

                    )

            }

        };


        const document =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true,

                    runValidators:
                        true

                }

            );


        if (!document) {

            this.incrementMetric(
                'transaction_repository_recovery_claim_conflict_total'
            );


            return false;

        }


        this.incrementMetric(
            'transaction_repository_recovery_claim_total'
        );


        return {

            owner,

            leaseUntil,

            claimedAt:
                now,

            transaction:
                document

        };

    }


    /**
     * =========================================================================
     * Renew Recovery Lease
     * =========================================================================
     */

    async renewRecoveryLease(
        transactionId,
        options = {}
    ) {

        const owner =
            options.owner;


        if (!owner) {

            throw new TypeError(
                'Recovery lease owner is required.'
            );

        }


        const leaseUntil =
            options.leaseUntil ||
            new Date(

                this.now().getTime() +
                120000

            );


        const filter =
            this.buildTenantFilter(
                {

                    transactionId,

                    recoveryOwner:
                        owner,

                    isDeleted:
                        { $ne: true }

                },

                options

            );


        const update = {

            $set: {

                recoveryLeaseUntil:
                    leaseUntil,

                updatedAt:
                    this.now()

            },

            $inc: {

                version:
                    1

            }

        };


        const updated =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true

                }

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Recovery lease renewal failed.'

            );

        }


        this.incrementMetric(
            'transaction_repository_recovery_lease_renewal_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Release Recovery Lease
     * =========================================================================
     */

    async releaseRecoveryLease(
        transactionId,
        options = {}
    ) {

        const owner =
            options.owner;


        const filter =
            this.buildTenantFilter(
                {

                    transactionId,

                    isDeleted:
                        { $ne: true }

                },

                options

            );


        if (owner) {

            filter.recoveryOwner =
                owner;

        }


        const now =
            this.now();


        const update = {

            $set: {

                recoveryOwner:
                    null,

                recoveryLeaseUntil:
                    null,

                recoveryReleasedAt:
                    now,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1

            },

            $push: {

                history:
                    this.createHistoryEntry(

                        'RECOVERY_LEASE_RELEASED',

                        {

                            owner:
                                owner ||
                                null,

                            timestamp:
                                now

                        }

                    )

            }

        };


        const updated =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true

                }

            );


        if (!updated) {

            return null;

        }


        this.incrementMetric(
            'transaction_repository_recovery_lease_release_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Schedule Retry
     * =========================================================================
     */

    async scheduleRetry(
        transactionId,
        metadata = {}
    ) {

        const now =
            this.now();


        const retryAt =
            metadata.retryAt ||
            new Date(

                now.getTime() +
                Number(
                    metadata.retryDelayMs ||
                    0
                )

            );


        const tenantFilter =
            this.buildTenantFilter(
                {
                    transactionId
                },
                metadata
            );


        const update = {

            $set: {

                state:
                    metadata.state ||
                    'RETRYING',

                retryAt,

                retryScheduledAt:
                    now,

                recoveryOwner:
                    null,

                recoveryLeaseUntil:
                    null,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1

            },

            $push: {

                history:
                    this.createHistoryEntry(

                        'RECOVERY_RETRY_SCHEDULED',

                        {

                            retryAttempt:
                                metadata.retryAttempt ||
                                null,

                            retryAt,

                            retryDelayMs:
                                metadata.retryDelayMs ||
                                0,

                            owner:
                                metadata.owner ||
                                null,

                            timestamp:
                                now

                        }

                    )

            }

        };


        const updated =
            await this.model.findOneAndUpdate(

                tenantFilter,

                update,

                {

                    new:
                        true

                }

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Unable to schedule transaction retry.'

            );

        }


        this.incrementMetric(
            'transaction_repository_retry_schedule_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Record Recovery Attempt
     * =========================================================================
     */

    async recordRecoveryAttempt(
        transactionId,
        metadata = {}
    ) {

        const now =
            this.now();


        const update = {

            $set: {

                lastRecoveryAttemptAt:
                    now,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1

            },

            $push: {

                history:
                    this.createHistoryEntry(

                        'RECOVERY_ATTEMPT',

                        {

                            recoveryId:
                                metadata.recoveryId ||
                                null,

                            owner:
                                metadata.owner ||
                                null,

                            attempt:
                                metadata.attempt ||
                                null,

                            state:
                                metadata.state ||
                                null,

                            timestamp:
                                now

                        }

                    )

            }

        };


        const updated =
            await this.model.findOneAndUpdate(

                this.buildTenantFilter(
                    {
                        transactionId
                    },
                    metadata
                ),

                update,

                {

                    new:
                        true

                }

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Unable to record recovery attempt.'

            );

        }


        this.incrementMetric(
            'transaction_repository_recovery_attempt_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Record Recovery History
     * =========================================================================
     */

    async recordRecoveryHistory(
        transactionId,
        metadata = {}
    ) {

        const status =
            metadata.status ||
            'UNKNOWN';


        const now =
            this.now();


        const entry =
            this.createHistoryEntry(

                `RECOVERY_${status}`,

                {

                    ...metadata,

                    timestamp:
                        metadata.timestamp ||
                        now

                }

            );


        const updated =
            await this.model.findOneAndUpdate(

                this.buildTenantFilter(
                    {
                        transactionId
                    },
                    metadata
                ),

                {

                    $push: {

                        history:
                            entry

                    },

                    $set: {

                        lastRecoveryStatus:
                            status,

                        lastRecoveryCompletedAt:
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

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Unable to record recovery history.'

            );

        }


        this.incrementMetric(
            'transaction_repository_recovery_history_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Mark Recovery Successful
     * =========================================================================
     */

    async markRecoverySuccessful(
        transactionId,
        metadata = {}
    ) {

        return this.updateState(

            transactionId,

            metadata.state ||
                'COMPLETED',

            {

                ...metadata,

                historyEvent:
                    'RECOVERY_SUCCESS'

            }

        );

    }


    /**
     * =========================================================================
     * Mark Failed
     * =========================================================================
     */

    async markFailed(
        transactionId,
        error,
        metadata = {}
    ) {

        const normalizedError =
            this.normalizeError(
                error
            );


        return this.updateState(

            transactionId,

            metadata.state ||
                'FAILED',

            {

                ...metadata,

                lastError:
                    normalizedError,

                historyEvent:
                    'RECOVERY_FAILED'

            }

        );

    }


    /**
     * =========================================================================
     * Mark Dead Lettered
     * =========================================================================
     */

    async markDeadLettered(
        transactionId,
        metadata = {}
    ) {

        const now =
            this.now();


        const update = {

            $set: {

                state:
                    'DEAD_LETTERED',

                deadLetterId:
                    metadata.deadLetterId ||
                    null,

                deadLetterReason:
                    metadata.reason ||
                    null,

                deadLetteredAt:
                    now,

                lastError:
                    metadata.error ||
                    null,

                recoveryOwner:
                    null,

                recoveryLeaseUntil:
                    null,

                updatedAt:
                    now

            },

            $inc: {

                version:
                    1

            },

            $push: {

                history:
                    this.createHistoryEntry(

                        'DEAD_LETTERED',

                        {

                            deadLetterId:
                                metadata.deadLetterId ||
                                null,

                            reason:
                                metadata.reason ||
                                null,

                            error:
                                metadata.error ||
                                null,

                            timestamp:
                                now

                        }

                    )

            }

        };


        const updated =
            await this.model.findOneAndUpdate(

                this.buildTenantFilter(
                    {
                        transactionId
                    },
                    metadata
                ),

                update,

                {

                    new:
                        true

                }

            );


        if (!updated) {

            throw this.createConcurrencyError(

                transactionId,

                'Unable to mark transaction as dead-lettered.'

            );

        }


        this.incrementMetric(
            'transaction_repository_dead_letter_total'
        );


        return updated;

    }


    /**
     * =========================================================================
     * Save
     * =========================================================================
     */

    async save(
        transaction,
        options = {}
    ) {

        if (!transaction) {

            throw new TypeError(
                'Transaction is required.'
            );

        }


        this.assertTenantContext(
            transaction
        );


        transaction.updatedAt =
            this.now();


        transaction.version =
            (transaction.version || 0) + 1;


        return transaction.save(
            options
        );

    }


    /**
     * =========================================================================
     * Replace
     * =========================================================================
     */

    async replace(
        transactionId,
        replacement,
        options = {}
    ) {

        if (!transactionId) {

            throw new TypeError(
                'transactionId is required.'
            );

        }


        const filter =
            this.buildTenantFilter(
                {
                    transactionId
                },
                options
            );


        replacement.updatedAt =
            this.now();


        const result =
            await this.model.findOneAndReplace(

                filter,

                replacement,

                {

                    new:
                        true,

                    upsert:
                        false

                }

            );


        return result;

    }


    /**
     * =========================================================================
     * Soft Delete
     * =========================================================================
     */

    async delete(
        transactionId,
        options = {}
    ) {

        return this.model.findOneAndUpdate(

            this.buildTenantFilter(
                {
                    transactionId
                },
                options
            ),

            {

                $set: {

                    isDeleted:
                        true,

                    deletedAt:
                        this.now(),

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
                    true

            }

        );

    }


    /**
     * =========================================================================
     * Restore
     * =========================================================================
     */

    async restore(
        transactionId,
        options = {}
    ) {

        return this.model.findOneAndUpdate(

            {

                transactionId,

                ...this.buildTenantFilter(
                    {},
                    options,
                    {
                        includeDeleted:
                            true
                    }
                )

            },

            {

                $set: {

                    isDeleted:
                        false,

                    deletedAt:
                        null,

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
                    true

            }

        );

    }


    /**
     * =========================================================================
     * Exists
     * =========================================================================
     */

    async exists(
        transactionId,
        options = {}
    ) {

        return this.model.exists(

            this.buildTenantFilter(
                {
                    transactionId
                },
                options
            )

        );

    }


    /**
     * =========================================================================
     * List
     * =========================================================================
     */

    async list(
        filter = {},
        options = {}
    ) {

        const page =
            Math.max(
                1,
                Number(options.page) || 1
            );


        const limit =
            Math.min(

                this.maxListLimit,

                Math.max(
                    1,
                    Number(options.limit) || 50
                )

            );


        const skip =
            (page - 1) *
            limit;


        const query =
            this.buildTenantFilter(

                {

                    ...filter

                },

                options

            );


        const [items, total] =
            await Promise.all([

                this.model
                    .find(query)
                    .sort(
                        options.sort ||
                        {
                            createdAt:
                                -1
                        }
                    )
                    .skip(skip)
                    .limit(limit),

                this.model.countDocuments(
                    query
                )

            ]);


        return {

            items,

            pagination: {

                page,

                limit,

                total,

                pages:
                    Math.ceil(
                        total / limit
                    )

            }

        };

    }


    /**
     * =========================================================================
     * Find Recoverable Transactions
     * =========================================================================
     */

    async findRecoverable(
        options = {}
    ) {

        const now =
            this.now();


        const cutoff =
            options.cutoff ||
            new Date(

                now.getTime() -
                (
                    Number(
                        options.stuckTimeout
                    ) ||
                    300000
                )

            );


        const states =
            options.states ||
            [

                'RUNNING',

                'WAITING_EXTERNAL',

                'FAILED',

                'TIMED_OUT',

                'ROLLING_BACK'

            ];


        const filter = {

            state:
                {
                    $in:
                        states
                },

            updatedAt:
                {
                    $lte:
                        cutoff
                }

        };


        if (
            options.leaseAware !== false
        ) {

            filter.$or = [

                {

                    recoveryLeaseUntil:
                        {
                            $exists:
                                false
                        }

                },

                {

                    recoveryLeaseUntil:
                        null

                },

                {

                    recoveryLeaseUntil:
                        {
                            $lte:
                                now
                        }

                }

            ];

        }


        return this.list(

            filter,

            {

                ...options,

                page:
                    1,

                limit:
                    options.limit ||
                    100

            }

        );

    }


    /**
     * =========================================================================
     * Bulk Insert
     * =========================================================================
     */

    async bulkCreate(
        transactions,
        options = {}
    ) {

        if (
            !Array.isArray(
                transactions
            )
        ) {

            throw new TypeError(
                'transactions must be an array.'
            );

        }


        if (
            !transactions.length
        ) {

            return [];

        }


        const now =
            this.now();


        return this.model.insertMany(

            transactions.map(
                transaction => ({

                    ...transaction,

                    createdAt:
                        transaction.createdAt ||
                        now,

                    updatedAt:
                        now,

                    isDeleted:
                        false,

                    version:
                        transaction.version ||
                        1

                })
            ),

            {

                ordered:
                    true,

                ...options

            }

        );

    }


    /**
     * =========================================================================
     * Bulk Update State
     * =========================================================================
     */

    async bulkUpdateState(
        transactionIds,
        state,
        options = {}
    ) {

        if (
            !Array.isArray(
                transactionIds
            ) ||
            !transactionIds.length
        ) {

            return {

                acknowledged:
                    true,

                modifiedCount:
                    0

            };

        }


        const filter =
            this.buildTenantFilter(

                {

                    transactionId:
                        {
                            $in:
                                transactionIds
                        }

                },

                options

            );


        const now =
            this.now();


        const result =
            await this.model.updateMany(

                filter,

                {

                    $set: {

                        state,

                        updatedAt:
                            now

                    },

                    $inc: {

                        version:
                            1

                    }

                }

            );


        return result;

    }


    /**
     * =========================================================================
     * Count
     * =========================================================================
     */

    async count(
        filter = {},
        options = {}
    ) {

        return this.model.countDocuments(

            this.buildTenantFilter(
                filter,
                options
            )

        );

    }


    /**
     * =========================================================================
     * Transaction History
     * =========================================================================
     */

    async history(
        transactionId,
        options = {}
    ) {

        return this.model.findOne(

            this.buildTenantFilter(
                {
                    transactionId
                },
                options
            ),

            {

                history:
                    1,

                state:
                    1,

                transactionId:
                    1,

                tenantId:
                    1,

                version:
                    1

            }

        );

    }


    /**
     * =========================================================================
     * Optimistic Concurrency Update
     * =========================================================================
     */

    async updateWithVersion(
        transactionId,
        version,
        update,
        options = {}
    ) {

        if (
            !Number.isInteger(
                version
            )
        ) {

            throw new TypeError(
                'version must be an integer.'
            );

        }


        const filter =
            this.buildTenantFilter(

                {

                    transactionId,

                    version

                },

                options

            );


        const normalizedUpdate =
            {

                ...update,

                $inc: {

                    ...(update.$inc || {}),

                    version:
                        1

                },

                $set: {

                    ...(update.$set || {}),

                    updatedAt:
                        this.now()

                }

            };


        const result =
            await this.model.findOneAndUpdate(

                filter,

                normalizedUpdate,

                {

                    new:
                        true,

                    runValidators:
                        options.runValidators !== false

                }

            );


        if (!result) {

            throw this.createConcurrencyError(

                transactionId,

                'Optimistic concurrency update failed.'

            );

        }


        this.incrementMetric(
            'transaction_repository_optimistic_update_total'
        );


        return result;

    }


    /**
     * =========================================================================
     * Build Tenant Filter
     * =========================================================================
     *
     * Tenant isolation is enforced here rather than relying on every caller
     * remembering to add tenantId manually.
     */

    buildTenantFilter(
        filter = {},
        options = {},
        flags = {}
    ) {

        const output = {

            ...filter

        };


        if (
            !flags.includeDeleted
        ) {

            output.isDeleted =
                {
                    $ne:
                        true
                };

        }


        const tenantId =
            options.tenantId;


        if (
            tenantId !== undefined &&
            tenantId !== null
        ) {

            this.assertTenantId(
                tenantId
            );


            output.tenantId =
                tenantId;

        }

        else if (
            this.tenantRequired
        ) {

            /**
             * Existing internal/system operations can explicitly opt out.
             *
             * Example:
             *
             * repository.list(filter, {
             *     tenantRequired: false
             * });
             */

            if (
                options.tenantRequired !== false
            ) {

                throw new Error(
                    'Tenant context is required for this repository operation.'
                );

            }

        }


        return output;

    }


    /**
     * =========================================================================
     * Tenant Assertions
     * =========================================================================
     */

    assertTenantContext(
        transaction
    ) {

        if (
            !this.tenantRequired
        ) {

            return;

        }


        this.assertTenantId(
            transaction?.tenantId
        );

    }


    assertTenantId(
        tenantId
    ) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            tenantId === ''
        ) {

            throw new Error(
                'tenantId is required.'
            );

        }

    }


    /**
     * =========================================================================
     * Recovery Metadata
     * =========================================================================
     */

    applyRecoveryMetadata(
        update,
        metadata
    ) {

        const fields = [

            'recoveryOwner',

            'recoveryLeaseUntil',

            'recoveryClaimedAt',

            'recoveryReleasedAt',

            'retryAt',

            'retryScheduledAt',

            'retryAttempt',

            'deadLetterId',

            'deadLetterReason',

            'deadLetteredAt'

        ];


        for (
            const field
            of fields
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    metadata,
                    field
                )
            ) {

                update.$set[field] =
                    metadata[field];

            }

        }


        if (
            Number.isInteger(
                metadata.recoveryAttempts
            )
        ) {

            update.$set.recoveryAttempts =
                metadata.recoveryAttempts;

        }

    }


    /**
     * =========================================================================
     * History Entry
     * =========================================================================
     */

    createHistoryEntry(
        type,
        metadata = {}
    ) {

        return {

            id:
                crypto.randomUUID(),

            type,

            timestamp:
                metadata.timestamp ||
                this.now(),

            recoveryId:
                metadata.recoveryId ||
                null,

            owner:
                metadata.owner ||
                null,

            attempt:
                metadata.attempt ||
                null,

            state:
                metadata.state ||
                null,

            reason:
                metadata.reason ||
                null

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

            status:
                error.status ??
                error.statusCode ??
                null,

            retryable:
                error.retryable ??
                null

        };

    }


    /**
     * =========================================================================
     * Concurrency Error
     * =========================================================================
     */

    createConcurrencyError(
        transactionId,
        message
    ) {

        const error =
            new Error(
                message
            );


        error.code =
            'TRANSACTION_CONCURRENCY_CONFLICT';


        error.transactionId =
            transactionId;


        error.retryable =
            true;


        return error;

    }


    /**
     * =========================================================================
     * Repository Compatibility
     * =========================================================================
     */

    ensureRepositoryCompatibility() {

        const required =
            [

                'findOne',
                'find',
                'findOneAndUpdate',
                'countDocuments'

            ];


        for (
            const method
            of required
        ) {

            if (
                typeof this.model?.[method] !==
                'function'
            ) {

                throw new Error(

                    `TransactionRepository model is missing required method: ${method}`

                );

            }

        }

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

        try {

            this.metrics?.increment?.(
                name,
                value,
                labels
            );

        }

        catch (error) {

            this.logger.warn?.(

                'Transaction repository metric failed',

                {

                    metric:
                        name,

                    error:
                        error.message

                }

            );

        }

    }


    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        const value =
            this.clock();


        return value instanceof Date
            ? value
            : new Date(
                value
            );

    }


    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            tenantRequired:
                this.tenantRequired,

            maxListLimit:
                this.maxListLimit,

            recoveryLeaseField:
                this.recoveryLeaseField,

            recoveryOwnerField:
                this.recoveryOwnerField

        };

    }

}


/**
 * ============================================================================
 * Module Export
 * ============================================================================
 */

module.exports =
    TransactionRepository;