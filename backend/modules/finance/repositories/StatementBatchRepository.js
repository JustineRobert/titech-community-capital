'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Core - Statement Batch Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/repositories/StatementBatchRepository.js
 *
 * Purpose:
 *   Production repository for durable statement-processing batch state.
 *
 * Supported:
 *   - create()
 *   - createBatch()
 *   - start()
 *   - findOne()
 *   - findById()
 *   - findByBatchId()
 *   - findByBatchKey()
 *   - findByProviderBatchId()
 *   - markProcessing()
 *   - heartbeat()
 *   - incrementCounts()
 *   - recordSuccess()
 *   - recordFailure()
 *   - recordSkipped()
 *   - recordDuplicate()
 *   - recordRetry()
 *   - complete()
 *   - completeBatch()
 *   - markPartial()
 *   - fail()
 *   - release()
 *   - releaseExpiredClaims()
 *   - setExpectedCount()
 *   - updateMetadata()
 *   - atomicTransition()
 *   - diagnostics()
 *
 * Enterprise guarantees:
 *   - Tenant-scoped queries
 *   - Atomic worker claims
 *   - Lease / heartbeat support
 *   - Optional claim-token ownership enforcement
 *   - Atomic counter increments
 *   - Compare-and-set state transitions
 *   - Duplicate batch detection
 *   - Idempotent reads / terminal-state protection
 *   - Safe retry/release workflows
 *   - Bounded metadata
 *   - Monetary field validation / normalization
 *
 * IMPORTANT:
 *   This repository stores batch coordination state.
 *   It does NOT own ledger posting, financial balances, or reconciliation
 *   truth. Those remain under their respective Finance Core engines.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const StatementBatch =
    require('../models/StatementBatch');

/* ============================================================================
 * Model constants
 * ========================================================================== */

const STATUS =
    StatementBatch.STATUS ||
    Object.freeze({
        CREATED: 'CREATED',
        PROCESSING: 'PROCESSING',
        PARTIAL: 'PARTIAL',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
        RELEASED: 'RELEASED',
        CANCELLED: 'CANCELLED'
    });

const TYPES =
    StatementBatch.TYPES ||
    Object.freeze({
        STATEMENT_PROCESSING:
            'STATEMENT_PROCESSING'
    });

/* ============================================================================
 * Internal constants
 * ========================================================================== */

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const MAX_LEASE_MS =
    24 * 60 * 60 * 1000;

const DEFAULT_RELEASE_LIMIT =
    100;

const MAX_RELEASE_LIMIT =
    1000;

const MAX_METADATA_KEYS =
    100;

const MAX_METADATA_STRING_LENGTH =
    2048;

const MAX_METADATA_ARRAY_ITEMS =
    50;

const MAX_ERROR_MESSAGE_LENGTH =
    2000;

/* ============================================================================
 * Error classes
 * ========================================================================== */

class StatementBatchRepositoryError
    extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'StatementBatchRepositoryError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            StatementBatchRepositoryError
        );
    }
}

function createValidationError(
    message,
    metadata = {}
) {

    return new StatementBatchRepositoryError(
        'STATEMENT_BATCH_VALIDATION_ERROR',
        message,
        metadata
    );
}

function createNotFoundError(
    tenantId,
    batchId
) {

    return new StatementBatchRepositoryError(
        'STATEMENT_BATCH_NOT_FOUND',
        'Statement batch not found',
        {
            tenantId,
            batchId
        }
    );
}

function createConflictError(
    message,
    metadata = {}
) {

    return new StatementBatchRepositoryError(
        'STATEMENT_BATCH_CONFLICT',
        message,
        metadata
    );
}

/* ============================================================================
 * Repository
 * ========================================================================== */

class StatementBatchRepository {

    constructor(options = {}) {

        this.model =
            options.model ||
            StatementBatch;

        this.clock =
            options.clock ||
            (() => new Date());

        this.logger =
            options.logger ||
            console;

        this.leaseMs =
            this.normalizeLeaseMs(
                options.leaseMs
            );

        this.maxMetadataKeys =
            Number.isInteger(
                options.maxMetadataKeys
            ) &&
            options.maxMetadataKeys > 0
                ? options.maxMetadataKeys
                : MAX_METADATA_KEYS;

        this.maxMetadataStringLength =
            Number.isInteger(
                options.maxMetadataStringLength
            ) &&
            options.maxMetadataStringLength > 0
                ? options.maxMetadataStringLength
                : MAX_METADATA_STRING_LENGTH;
    }

    /* ========================================================================
     * create()
     * ====================================================================== */

    async create(
        payload = {},
        context = {}
    ) {

        const normalized =
            this.preparePayload(
                payload,
                context
            );

        try {

            return await this.model
                .create(
                    normalized
                );

        }
        catch (error) {

            if (
                this.isDuplicateKeyError(
                    error
                )
            ) {

                const existing =
                    await this.findByBatchKey(
                        normalized.tenantId,
                        normalized.batchKey
                    );

                const duplicate =
                    new StatementBatchRepositoryError(
                        'STATEMENT_BATCH_DUPLICATE',
                        'Statement batch already exists',
                        {
                            tenantId:
                                normalized.tenantId,

                            batchKey:
                                normalized.batchKey,

                            existing
                        }
                    );

                duplicate.existing =
                    existing;

                throw duplicate;
            }

            throw error;
        }
    }

    /* ========================================================================
     * createBatch()
     * ====================================================================== */

    async createBatch(
        context = {}
    ) {

        const tenantId =
            this.requireTenantId(
                context.tenantId
            );

        const batchKey =
            context.batchKey ||
            this.buildBatchKey(
                context
            );

        const idempotencyKey =
            context.idempotencyKey ||
            context.operationKey ||
            batchKey;

        const payload = {

            tenantId,

            batchId:
                context.batchId ||
                crypto.randomUUID(),

            batchKey,

            idempotencyKey,

            type:
                context.type ||
                TYPES.STATEMENT_PROCESSING,

            provider:
                context.provider ||
                null,

            providerBatchId:
                context.providerBatchId ||
                null,

            expectedCount:
                this.normalizeNonNegativeInteger(
                    context.expectedCount ??
                        0
                ),

            correlationId:
                context.correlationId ||
                null,

            requestId:
                context.requestId ||
                null,

            pipelineId:
                context.pipelineId ||
                null,

            statementTraceId:
                context.statementTraceId ||
                null,

            metadata:
                context.metadata ||
                {}
        };

        try {

            return await this.create(
                payload,
                context
            );

        }
        catch (error) {

            /*
             * Batch creation is intentionally idempotent by batchKey.
             * Returning an existing durable batch prevents duplicate pipeline
             * roots when two workers race to initialize the same batch.
             */
            if (
                error?.code ===
                    'STATEMENT_BATCH_DUPLICATE' &&
                error.existing
            ) {

                return error.existing;
            }

            throw error;
        }
    }

    /* ========================================================================
     * start()
     * ====================================================================== */

    async start(
        context = {}
    ) {

        const tenantId =
            this.requireTenantId(
                context.tenantId
            );

        const batch =
            await this.createBatch(
                context
            );

        return this.markProcessing(
            tenantId,
            batch.batchId,
            {
                workerId:
                    context.workerId ||
                    null,

                claimToken:
                    context.claimToken ||
                    null
            }
        );
    }

    /* ========================================================================
     * findOne()
     * ====================================================================== */

    async findOne(
        filter = {},
        options = {}
    ) {

        const scopedFilter =
            this.applyTenantScope(
                filter,
                options.tenantId
            );

        let query =
            this.model.findOne(
                scopedFilter
            );

        if (
            options.lean !== false &&
            typeof query.lean === 'function'
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * findById()
     * ====================================================================== */

    async findById(
        id,
        options = {}
    ) {

        if (
            id === undefined ||
            id === null ||
            String(id).trim() === ''
        ) {
            throw createValidationError(
                'id is required'
            );
        }

        let query =
            this.model.findById(
                id
            );

        /*
         * For strict tenant isolation prefer findOne with tenantId instead of
         * findById when tenant context is supplied.
         */
        if (
            options.tenantId
        ) {

            query =
                this.model.findOne({
                    _id:
                        id,

                    tenantId:
                        options.tenantId
                });
        }

        if (
            options.lean !== false &&
            typeof query.lean === 'function'
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * findByBatchId()
     * ====================================================================== */

    async findByBatchId(
        tenantId,
        batchId,
        options = {}
    ) {

        return this.findOne(
            {
                tenantId:
                    this.requireTenantId(
                        tenantId
                    ),

                batchId:
                    this.requireBatchId(
                        batchId
                    )
            },
            options
        );
    }

    /* ========================================================================
     * findByBatchKey()
     * ====================================================================== */

    async findByBatchKey(
        tenantId,
        batchKey,
        options = {}
    ) {

        if (
            !tenantId ||
            !batchKey
        ) {
            return null;
        }

        return this.findOne(
            {
                tenantId:
                    this.requireTenantId(
                        tenantId
                    ),

                batchKey:
                    String(
                        batchKey
                    ).trim()
            },
            options
        );
    }

    /* ========================================================================
     * findByProviderBatchId()
     * ====================================================================== */

    async findByProviderBatchId(
        tenantId,
        provider,
        providerBatchId,
        options = {}
    ) {

        return this.findOne(
            {
                tenantId:
                    this.requireTenantId(
                        tenantId
                    ),

                provider:
                    String(
                        provider
                    ).trim(),

                providerBatchId:
                    String(
                        providerBatchId
                    ).trim()
            },
            options
        );
    }

    /* ========================================================================
     * markProcessing()
     * ====================================================================== */

    async markProcessing(
        tenantId,
        batchId,
        metadata = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const now =
            this.now();

        const claimToken =
            metadata.claimToken ||
            crypto.randomUUID();

        const workerId =
            metadata.workerId ||
            null;

        const update = {

            $set: {

                status:
                    STATUS.PROCESSING,

                startedAt:
                    metadata.startedAt ||
                    now,

                workerId,

                claimToken,

                leaseExpiresAt:
                    new Date(
                        now.getTime() +
                        this.leaseMs
                    ),

                lastHeartbeatAt:
                    now
            },

            $unset: {

                failedAt: 1,

                lastError: 1,

                releasedAt: 1
            },

            $inc: {

                version: 1
            }
        };

        const filter = {

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            status: {
                $in: [
                    STATUS.CREATED,
                    STATUS.PARTIAL,
                    STATUS.RELEASED
                ]
            }
        };

        /*
         * FAILED batches may be explicitly retried, but should not be silently
         * reactivated by an ordinary start() call unless the caller opts in.
         */
        if (
            metadata.allowFailedRetry === true
        ) {
            filter.status.$in.push(
                STATUS.FAILED
            );
        }

        const document =
            await this.model
                .findOneAndUpdate(
                    filter,
                    update,
                    {
                        new:
                            true,

                        runValidators:
                            true
                    }
                )
                .exec();

        if (!document) {

            const existing =
                await this.findByBatchId(
                    normalizedTenantId,
                    normalizedBatchId
                );

            if (
                existing &&
                existing.status ===
                    STATUS.PROCESSING
            ) {

                throw createConflictError(
                    'Statement batch is already being processed',
                    {
                        tenantId:
                            normalizedTenantId,

                        batchId:
                            normalizedBatchId,

                        workerId:
                            existing.workerId ||
                            null
                    }
                );
            }

            if (
                existing &&
                existing.status ===
                    STATUS.COMPLETED
            ) {

                return existing;
            }

            if (!existing) {

                throw createNotFoundError(
                    normalizedTenantId,
                    normalizedBatchId
                );
            }

            throw createConflictError(
                `Statement batch cannot transition to PROCESSING from ${existing.status}`,
                {
                    tenantId:
                        normalizedTenantId,

                    batchId:
                        normalizedBatchId,

                    status:
                        existing.status
                }
            );
        }

        return document;
    }

    /* ========================================================================
     * heartbeat()
     * ====================================================================== */

    async heartbeat(
        tenantId,
        batchId,
        {
            claimToken,
            workerId
        } = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        if (
            !claimToken &&
            !workerId
        ) {

            throw createValidationError(
                'claimToken or workerId is required for heartbeat'
            );
        }

        const now =
            this.now();

        const filter = {

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            status:
                STATUS.PROCESSING
        };

        if (
            claimToken
        ) {
            filter.claimToken =
                claimToken;
        }

        if (
            workerId
        ) {
            filter.workerId =
                workerId;
        }

        return this.model
            .findOneAndUpdate(
                filter,
                {
                    $set: {

                        lastHeartbeatAt:
                            now,

                        leaseExpiresAt:
                            new Date(
                                now.getTime() +
                                this.leaseMs
                            )
                    },

                    $inc: {

                        version: 1
                    }
                },
                {
                    new:
                        true
                }
            )
            .lean()
            .exec();
    }

    /* ========================================================================
     * incrementCounts()
     * ====================================================================== */

    async incrementCounts({
        tenantId,
        batchId,

        processed = 0,
        succeeded = 0,
        failed = 0,
        skipped = 0,
        duplicate = 0,
        retry = 0,

        totalAmount = 0,
        successfulAmount = 0,
        failedAmount = 0,

        claimToken = null,
        workerId = null
    } = {}) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const increments = {

            processedCount:
                this.normalizeNonNegativeInteger(
                    processed
                ),

            succeededCount:
                this.normalizeNonNegativeInteger(
                    succeeded
                ),

            failedCount:
                this.normalizeNonNegativeInteger(
                    failed
                ),

            skippedCount:
                this.normalizeNonNegativeInteger(
                    skipped
                ),

            duplicateCount:
                this.normalizeNonNegativeInteger(
                    duplicate
                ),

            retryCount:
                this.normalizeNonNegativeInteger(
                    retry
                ),

            totalAmount:
                this.normalizeMoney(
                    totalAmount
                ),

            successfulAmount:
                this.normalizeMoney(
                    successfulAmount
                ),

            failedAmount:
                this.normalizeMoney(
                    failedAmount
                )
        };

        const filter = {

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            status: {
                $in: [
                    STATUS.PROCESSING,
                    STATUS.PARTIAL
                ]
            }
        };

        this.applyClaimScope(
            filter,
            {
                claimToken,
                workerId
            }
        );

        return this.model
            .findOneAndUpdate(
                filter,
                {
                    $inc:
                        increments,

                    $set: {

                        lastHeartbeatAt:
                            this.now()
                    }
                },
                {
                    new:
                        true,

                    runValidators:
                        true
                }
            )
            .exec();
    }

    /* ========================================================================
     * recordSuccess()
     * ====================================================================== */

    async recordSuccess({
        tenantId,
        batchId,
        amount = 0,
        claimToken = null,
        workerId = null
    } = {}) {

        return this.incrementCounts({
            tenantId,
            batchId,

            processed:
                1,

            succeeded:
                1,

            successfulAmount:
                amount,

            claimToken,
            workerId
        });
    }

    /* ========================================================================
     * recordFailure()
     * ====================================================================== */

    async recordFailure({
        tenantId,
        batchId,
        amount = 0,
        claimToken = null,
        workerId = null
    } = {}) {

        return this.incrementCounts({
            tenantId,
            batchId,

            processed:
                1,

            failed:
                1,

            failedAmount:
                amount,

            claimToken,
            workerId
        });
    }

    /* ========================================================================
     * recordSkipped()
     * ====================================================================== */

    async recordSkipped({
        tenantId,
        batchId,
        claimToken = null,
        workerId = null
    } = {}) {

        return this.incrementCounts({
            tenantId,
            batchId,

            processed:
                1,

            skipped:
                1,

            claimToken,
            workerId
        });
    }

    /* ========================================================================
     * recordDuplicate()
     * ====================================================================== */

    async recordDuplicate({
        tenantId,
        batchId,
        claimToken = null,
        workerId = null
    } = {}) {

        return this.incrementCounts({
            tenantId,
            batchId,

            processed:
                1,

            duplicate:
                1,

            claimToken,
            workerId
        });
    }

    /* ========================================================================
     * recordRetry()
     * ====================================================================== */

    async recordRetry({
        tenantId,
        batchId,
        claimToken = null,
        workerId = null
    } = {}) {

        return this.incrementCounts({
            tenantId,
            batchId,

            retry:
                1,

            claimToken,
            workerId
        });
    }

    /* ========================================================================
     * complete()
     * ====================================================================== */

    async complete(
        batchId,
        metadata = {}
    ) {

        return this.completeBatch(
            batchId,
            metadata
        );
    }

    /* ========================================================================
     * completeBatch()
     * ====================================================================== */

    async completeBatch(
        batchId,
        metadata = {}
    ) {

        const tenantId =
            this.requireTenantId(
                metadata.tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const existing =
            await this.findByBatchId(
                tenantId,
                normalizedBatchId
            );

        if (!existing) {

            throw createNotFoundError(
                tenantId,
                normalizedBatchId
            );
        }

        /*
         * Terminal completion is idempotent.
         */
        if (
            existing.status ===
            STATUS.COMPLETED
        ) {

            return existing;
        }

        if (
            existing.status ===
                STATUS.FAILED &&
            metadata.allowFailedRetry !==
                true
        ) {

            throw createConflictError(
                'Failed statement batch cannot be completed without explicit retry authorization',
                {
                    tenantId,
                    batchId:
                        normalizedBatchId
                }
            );
        }

        const expectedCount =
            this.normalizeNonNegativeInteger(
                existing.expectedCount
            );

        const processedCount =
            this.normalizeNonNegativeInteger(
                existing.processedCount
            );

        const failedCount =
            this.normalizeNonNegativeInteger(
                existing.failedCount
            );

        /*
         * Explicit forceComplete is available for administrative workflows,
         * but should be used deliberately.
         */
        const forceComplete =
            metadata.forceComplete ===
            true;

        const isComplete =
            forceComplete ||
            (
                expectedCount > 0 &&
                processedCount >=
                    expectedCount
            );

        if (!isComplete) {

            return this.markPartial(
                tenantId,
                normalizedBatchId,
                {
                    ...metadata
                }
            );
        }

        /*
         * A batch with zero expected records is not automatically marked
         * completed unless the caller explicitly confirms completion.
         */
        if (
            expectedCount === 0 &&
            metadata.confirmEmpty ===
                true
        ) {
            // Explicitly confirmed empty batch.
        } else if (
            expectedCount === 0 &&
            !forceComplete
        ) {

            return this.markPartial(
                tenantId,
                normalizedBatchId,
                metadata
            );
        }

        const targetStatus =
            failedCount > 0 &&
            metadata.allowPartialCompletion !==
                false
                ? STATUS.PARTIAL
                : STATUS.COMPLETED;

        if (
            targetStatus ===
            STATUS.PARTIAL
        ) {

            return this.markPartial(
                tenantId,
                normalizedBatchId,
                metadata
            );
        }

        return this.atomicTransition({
            tenantId,

            batchId:
                normalizedBatchId,

            from: [
                STATUS.PROCESSING,
                STATUS.PARTIAL
            ],

            to:
                STATUS.COMPLETED,

            claimToken:
                metadata.claimToken ||
                null,

            workerId:
                metadata.workerId ||
                null,

            metadata: {
                ...metadata,

                completedAt:
                    metadata.completedAt ||
                    this.now()
            }
        });
    }

    /* ========================================================================
     * markPartial()
     * ====================================================================== */

    async markPartial(
        tenantId,
        batchId,
        metadata = {}
    ) {

        return this.atomicTransition({
            tenantId,
            batchId,

            from: [
                STATUS.PROCESSING
            ],

            to:
                STATUS.PARTIAL,

            claimToken:
                metadata.claimToken ||
                null,

            workerId:
                metadata.workerId ||
                null,

            metadata
        });
    }

    /* ========================================================================
     * fail()
     * ====================================================================== */

    async fail(
        batchId,
        {
            tenantId,
            errorCode,
            errorMessage,
            stage,
            retryable = false,
            metadata = {},
            claimToken = null,
            workerId = null
        } = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const safeErrorMessage =
            this.sanitizeErrorMessage(
                errorMessage
            );

        return this.atomicTransition({

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            from: [
                STATUS.CREATED,
                STATUS.PROCESSING,
                STATUS.PARTIAL
            ],

            to:
                STATUS.FAILED,

            claimToken,

            workerId,

            metadata: {

                ...metadata,

                failedAt:
                    this.now(),

                lastError: {

                    code:
                        errorCode ||
                        null,

                    message:
                        safeErrorMessage,

                    stage:
                        stage ||
                        null,

                    retryable:
                        Boolean(
                            retryable
                        ),

                    occurredAt:
                        this.now()
                }
            }
        });
    }

    /* ========================================================================
     * release()
     * ====================================================================== */

    async release(
        tenantId,
        batchId,
        {
            claimToken,
            workerId,
            reason = null
        } = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        if (
            !claimToken &&
            !workerId
        ) {

            throw createValidationError(
                'claimToken or workerId is required to release a batch'
            );
        }

        const filter = {

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            status:
                STATUS.PROCESSING
        };

        this.applyClaimScope(
            filter,
            {
                claimToken,
                workerId
            }
        );

        const update = {

            $set: {

                status:
                    STATUS.RELEASED,

                releasedAt:
                    this.now(),

                releaseReason:
                    reason
                        ? this.sanitizeErrorMessage(
                            reason
                        )
                        : null
            },

            $unset: {

                leaseExpiresAt: 1,

                claimToken: 1,

                workerId: 1
            },

            $inc: {

                version:
                    1
            }
        };

        return this.model
            .findOneAndUpdate(
                filter,
                update,
                {
                    new:
                        true,

                    runValidators:
                        true
                }
            )
            .exec();
    }

    /* ========================================================================
     * releaseExpiredClaims()
     * ====================================================================== */

    async releaseExpiredClaims(
        limit =
            DEFAULT_RELEASE_LIMIT
    ) {

        const normalizedLimit =
            this.normalizeReleaseLimit(
                limit
            );

        const now =
            this.now();

        const batches =
            await this.model
                .find({
                    status:
                        STATUS.PROCESSING,

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
                    normalizedLimit
                )
                .select({
                    _id: 1,
                    tenantId: 1,
                    batchId: 1,
                    workerId: 1,
                    claimToken: 1,
                    leaseExpiresAt: 1
                })
                .lean()
                .exec();

        if (
            batches.length ===
            0
        ) {

            return {
                released:
                    0,

                records:
                    []
            };
        }

        const ids =
            batches.map(
                batch =>
                    batch._id
            );

        const updateResult =
            await this.model
                .updateMany(
                    {
                        _id: {
                            $in: ids
                        },

                        status:
                            STATUS.PROCESSING,

                        leaseExpiresAt: {
                            $lte:
                                now
                        }
                    },
                    {
                        $set: {

                            status:
                                STATUS.RELEASED,

                            releasedAt:
                                now,

                            releaseReason:
                                'LEASE_EXPIRED'
                        },

                        $unset: {

                            leaseExpiresAt: 1,

                            claimToken: 1,

                            workerId: 1
                        },

                        $inc: {

                            version:
                                1
                        }
                    }
                );

        const released =
            updateResult.modifiedCount ||
            0;

        return {

            released,

            records:
                batches.slice(
                    0,
                    released
                )
        };
    }

    /* ========================================================================
     * setExpectedCount()
     * ====================================================================== */

    async setExpectedCount(
        tenantId,
        batchId,
        expectedCount
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const normalizedExpectedCount =
            this.normalizeNonNegativeInteger(
                expectedCount
            );

        return this.model
            .findOneAndUpdate(
                {
                    tenantId:
                        normalizedTenantId,

                    batchId:
                        normalizedBatchId,

                    status: {
                        $in: [
                            STATUS.CREATED,
                            STATUS.PROCESSING,
                            STATUS.PARTIAL
                        ]
                    }
                },
                {
                    $set: {
                        expectedCount:
                            normalizedExpectedCount
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
            )
            .exec();
    }

    /* ========================================================================
     * updateMetadata()
     * ====================================================================== */

    async updateMetadata(
        tenantId,
        batchId,
        metadata = {}
    ) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const sanitized =
            this.filterMetadata(
                metadata
            );

        return this.model
            .findOneAndUpdate(
                {
                    tenantId:
                        normalizedTenantId,

                    batchId:
                        normalizedBatchId,

                    status: {
                        $nin: [
                            STATUS.COMPLETED,
                            STATUS.CANCELLED
                        ]
                    }
                },
                {
                    $set: {

                        metadata:
                            sanitized
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
            )
            .exec();
    }

    /* ========================================================================
     * atomicTransition()
     * ====================================================================== */

    async atomicTransition({
        tenantId,
        batchId,
        from,
        to,
        claimToken = null,
        workerId = null,
        metadata = {}
    } = {}) {

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const normalizedBatchId =
            this.requireBatchId(
                batchId
            );

        const allowedFrom =
            Array.isArray(from)
                ? from
                : [from];

        if (
            allowedFrom.length ===
            0
        ) {

            throw createValidationError(
                'At least one source status is required'
            );
        }

        if (
            !to
        ) {

            throw createValidationError(
                'Target status is required'
            );
        }

        const update = {

            $set:
                this.buildStatusMetadata(
                    to,
                    metadata
                ),

            $inc: {

                version:
                    1
            }
        };

        const filter = {

            tenantId:
                normalizedTenantId,

            batchId:
                normalizedBatchId,

            status: {
                $in:
                    allowedFrom
            }
        };

        this.applyClaimScope(
            filter,
            {
                claimToken,
                workerId
            }
        );

        const document =
            await this.model
                .findOneAndUpdate(
                    filter,
                    update,
                    {
                        new:
                            true,

                        runValidators:
                            true
                    }
                )
                .exec();

        if (
            document
        ) {
            return document;
        }

        const existing =
            await this.findByBatchId(
                normalizedTenantId,
                normalizedBatchId
            );

        if (!existing) {

            throw createNotFoundError(
                normalizedTenantId,
                normalizedBatchId
            );
        }

        throw createConflictError(
            `Statement batch state transition conflict: ${existing.status} -> ${to}`,
            {
                tenantId:
                    normalizedTenantId,

                batchId:
                    normalizedBatchId,

                currentStatus:
                    existing.status,

                expectedStatuses:
                    allowedFrom,

                targetStatus:
                    to
            }
        );
    }

    /* ========================================================================
     * buildStatusMetadata()
     * ====================================================================== */

    buildStatusMetadata(
        status,
        metadata = {}
    ) {

        const result = {};

        const now =
            this.now();

        result.status =
            status;

        result.metadata =
            this.filterMetadata(
                metadata
            );

        switch (status) {

            case STATUS.PROCESSING:

                result.startedAt =
                    metadata.startedAt ||
                    now;

                result.lastHeartbeatAt =
                    now;

                result.leaseExpiresAt =
                    new Date(
                        now.getTime() +
                        this.leaseMs
                    );

                break;

            case STATUS.COMPLETED:

                result.completedAt =
                    metadata.completedAt ||
                    now;

                result.leaseExpiresAt =
                    null;

                break;

            case STATUS.PARTIAL:

                result.lastHeartbeatAt =
                    now;

                break;

            case STATUS.FAILED:

                result.failedAt =
                    metadata.failedAt ||
                    now;

                result.lastError =
                    metadata.lastError ||
                    null;

                result.leaseExpiresAt =
                    null;

                break;

            case STATUS.RELEASED:

                result.releasedAt =
                    metadata.releasedAt ||
                    now;

                result.releaseReason =
                    metadata.releaseReason ||
                    null;

                result.leaseExpiresAt =
                    null;

                break;

            case STATUS.CANCELLED:

                result.cancelledAt =
                    metadata.cancelledAt ||
                    now;

                result.leaseExpiresAt =
                    null;

                break;

            default:

                break;
        }

        return result;
    }

    /* ========================================================================
     * preparePayload()
     * ====================================================================== */

    preparePayload(
        payload = {},
        context = {}
    ) {

        const tenantId =
            payload.tenantId ||
            context.tenantId;

        const normalizedTenantId =
            this.requireTenantId(
                tenantId
            );

        const batchId =
            payload.batchId ||
            context.batchId ||
            crypto.randomUUID();

        const batchKey =
            payload.batchKey ||
            context.batchKey ||
            this.buildBatchKey({
                ...context,
                ...payload
            });

        const idempotencyKey =
            payload.idempotencyKey ||
            context.idempotencyKey ||
            context.operationKey ||
            batchKey;

        return {

            ...payload,

            tenantId:
                normalizedTenantId,

            batchId:
                String(
                    batchId
                ),

            batchKey:
                String(
                    batchKey
                ).trim(),

            idempotencyKey:
                String(
                    idempotencyKey
                ).trim(),

            type:
                payload.type ||
                TYPES.STATEMENT_PROCESSING,

            status:
                payload.status ||
                STATUS.CREATED,

            expectedCount:
                this.normalizeNonNegativeInteger(
                    payload.expectedCount
                ),

            processedCount:
                this.normalizeNonNegativeInteger(
                    payload.processedCount
                ),

            succeededCount:
                this.normalizeNonNegativeInteger(
                    payload.succeededCount
                ),

            failedCount:
                this.normalizeNonNegativeInteger(
                    payload.failedCount
                ),

            skippedCount:
                this.normalizeNonNegativeInteger(
                    payload.skippedCount
                ),

            duplicateCount:
                this.normalizeNonNegativeInteger(
                    payload.duplicateCount
                ),

            retryCount:
                this.normalizeNonNegativeInteger(
                    payload.retryCount
                ),

            totalAmount:
                this.normalizeMoney(
                    payload.totalAmount
                ),

            successfulAmount:
                this.normalizeMoney(
                    payload.successfulAmount
                ),

            failedAmount:
                this.normalizeMoney(
                    payload.failedAmount
                ),

            version:
                this.normalizeVersion(
                    payload.version
                ),

            metadata:
                this.filterMetadata(
                    payload.metadata ||
                    context.metadata ||
                    {}
                )
        };
    }

    /* ========================================================================
     * buildBatchKey()
     * ====================================================================== */

    buildBatchKey(
        context = {}
    ) {

        const components = [

            context.tenantId ||
                'unknown-tenant',

            context.provider ||
                'unknown-provider',

            context.providerBatchId ||
                context.statementId ||
                context.batchId ||
                context.operationKey ||
                'statement-batch'
        ];

        return components
            .map(
                value =>
                    String(
                        value
                    )
                        .trim()
                        .replace(
                            /:/g,
                            '_'
                        )
            )
            .join(':');
    }

    /* ========================================================================
     * applyTenantScope()
     * ====================================================================== */

    applyTenantScope(
        filter = {},
        tenantId
    ) {

        const result = {
            ...filter
        };

        if (
            tenantId
        ) {
            result.tenantId =
                tenantId;
        }

        return result;
    }

    /* ========================================================================
     * applyClaimScope()
     * ====================================================================== */

    applyClaimScope(
        filter,
        {
            claimToken,
            workerId
        } = {}
    ) {

        /*
         * When claimToken is available it is the strongest worker ownership
         * primitive and should be preferred.
         */
        if (
            claimToken
        ) {

            filter.claimToken =
                claimToken;

            return filter;
        }

        if (
            workerId
        ) {

            filter.workerId =
                workerId;
        }

        return filter;
    }

    /* ========================================================================
     * filterMetadata()
     * ====================================================================== */

    filterMetadata(
        metadata = {}
    ) {

        if (
            !metadata ||
            typeof metadata !==
                'object'
        ) {
            return {};
        }

        const forbiddenExact =
            new Set([
                'tenantId',
                'batchId',
                'batchKey',
                'idempotencyKey',
                'operationKey',
                'claimToken',
                'workerId',

                /*
                 * Do not duplicate business/financial values in arbitrary
                 * metadata where trace/repository payloads could expose them.
                 */
                'accountNumber',
                'walletNumber',
                'memberId'
            ]);

        const sensitivePatterns = [
            /password/i,
            /token/i,
            /secret/i,
            /authorization/i,
            /private.?key/i,
            /pin/i,
            /otp/i,
            /cvv/i,
            /card.?number/i,
            /account.?number/i,
            /wallet.?number/i,
            /national.?id/i,
            /identity.?number/i
        ];

        const output = {};

        let count = 0;

        for (
            const [
                key,
                value
            ] of Object.entries(
                metadata
            )
        ) {

            if (
                count >=
                this.maxMetadataKeys
            ) {
                break;
            }

            if (
                forbiddenExact.has(
                    key
                )
            ) {
                continue;
            }

            if (
                sensitivePatterns.some(
                    pattern =>
                        pattern.test(
                            key
                        )
                )
            ) {
                continue;
            }

            output[
                String(
                    key
                ).slice(
                    0,
                    128
                )
            ] =
                this.sanitizeMetadataValue(
                    value
                );

            count++;
        }

        return output;
    }

    /* ========================================================================
     * sanitizeMetadataValue()
     * ====================================================================== */

    sanitizeMetadataValue(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {
            return value;
        }

        if (
            typeof value ===
            'string'
        ) {

            return value.slice(
                0,
                this.maxMetadataStringLength
            );
        }

        if (
            typeof value ===
                'number' ||
            typeof value ===
                'boolean'
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            Array.isArray(value)
        ) {

            return value
                .slice(
                    0,
                    MAX_METADATA_ARRAY_ITEMS
                )
                .map(
                    item =>
                        this.sanitizeMetadataValue(
                            item
                        )
                );
        }

        if (
            typeof value ===
            'object'
        ) {

            const result = {};

            let count = 0;

            for (
                const [
                    key,
                    nestedValue
                ] of Object.entries(
                    value
                )
            ) {

                if (
                    count >=
                    this.maxMetadataKeys
                ) {
                    break;
                }

                if (
                    /password|token|secret|authorization|private.?key|pin|otp|cvv/i
                        .test(
                            key
                        )
                ) {
                    continue;
                }

                result[
                    String(
                        key
                    ).slice(
                        0,
                        128
                    )
                ] =
                    this.sanitizeMetadataValue(
                        nestedValue
                    );

                count++;
            }

            return result;
        }

        return String(
            value
        ).slice(
            0,
            this.maxMetadataStringLength
        );
    }

    /* ========================================================================
     * Monetary normalization
     * ====================================================================== */

    normalizeMoney(
        value
    ) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return 0;
        }

        const number =
            Number(value);

        if (
            !Number.isFinite(
                number
            )
        ) {

            throw createValidationError(
                'Monetary batch counter must be a finite number',
                {
                    value
                }
            );
        }

        /*
         * Financial money should generally be represented in minor units or a
         * decimal type in the actual model. This repository does not silently
         * invent currency precision; it only rejects invalid values.
         */
        return number;
    }

    /* ========================================================================
     * Integer normalization
     * ====================================================================== */

    normalizeNonNegativeInteger(
        value
    ) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return 0;
        }

        const number =
            Number(value);

        if (
            !Number.isInteger(
                number
            ) ||
            number < 0
        ) {

            throw createValidationError(
                'Batch counters must be non-negative integers',
                {
                    value
                }
            );
        }

        return number;
    }

    normalizeVersion(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {
            return 1;
        }

        const version =
            Number(value);

        if (
            !Number.isInteger(
                version
            ) ||
            version < 1
        ) {

            throw createValidationError(
                'version must be a positive integer'
            );
        }

        return version;
    }

    /* ========================================================================
     * Lease normalization
     * ====================================================================== */

    normalizeLeaseMs(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {
            return DEFAULT_LEASE_MS;
        }

        const numeric =
            Number(value);

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric <= 0
        ) {
            return DEFAULT_LEASE_MS;
        }

        return Math.min(
            numeric,
            MAX_LEASE_MS
        );
    }

    normalizeReleaseLimit(
        value
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isInteger(
                numeric
            ) ||
            numeric <= 0
        ) {
            return DEFAULT_RELEASE_LIMIT;
        }

        return Math.min(
            numeric,
            MAX_RELEASE_LIMIT
        );
    }

    /* ========================================================================
     * Validation
     * ====================================================================== */

    requireTenantId(
        tenantId
    ) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {

            throw createValidationError(
                'tenantId is required'
            );
        }

        return String(
            tenantId
        ).trim();
    }

    requireBatchId(
        batchId
    ) {

        if (
            batchId === undefined ||
            batchId === null ||
            String(batchId).trim() === ''
        ) {

            throw createValidationError(
                'batchId is required'
            );
        }

        return String(
            batchId
        ).trim();
    }

    sanitizeErrorMessage(
        message
    ) {

        if (
            message === undefined ||
            message === null
        ) {
            return null;
        }

        return String(
            message
        ).slice(
            0,
            MAX_ERROR_MESSAGE_LENGTH
        );
    }

    /* ========================================================================
     * Duplicate detection
     * ====================================================================== */

    isDuplicateKeyError(
        error
    ) {

        return Boolean(
            error &&
            (
                error.code ===
                    11000 ||
                error.keyPattern ||
                error.name ===
                    'MongoServerError' &&
                String(
                    error.message || ''
                ).includes(
                    'duplicate'
                )
            )
        );
    }

    /* ========================================================================
     * Clock
     * ====================================================================== */

    now() {

        const result =
            this.clock();

        const date =
            result instanceof Date
                ? new Date(
                    result.getTime()
                )
                : new Date(
                    result
                );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new Error(
                'StatementBatchRepository clock returned an invalid date'
            );
        }

        return date;
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {

            repository:
                'StatementBatchRepository',

            modelConfigured:
                Boolean(
                    this.model
                ),

            leaseMs:
                this.leaseMs,

            maxMetadataKeys:
                this.maxMetadataKeys,

            repositoryCapabilities: {

                create:
                    typeof this.model
                        ?.create ===
                    'function',

                findOne:
                    typeof this.model
                        ?.findOne ===
                    'function',

                findById:
                    typeof this.model
                        ?.findById ===
                    'function',

                findOneAndUpdate:
                    typeof this.model
                        ?.findOneAndUpdate ===
                    'function',

                updateMany:
                    typeof this.model
                        ?.updateMany ===
                    'function'
            },

            statuses:
                Object.values(
                    STATUS
                ),

            types:
                Object.values(
                    TYPES
                ),

            timestamp:
                this.now()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

StatementBatchRepository.STATUS =
    STATUS;

StatementBatchRepository.TYPES =
    TYPES;

StatementBatchRepository.Error =
    StatementBatchRepositoryError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    StatementBatchRepository;