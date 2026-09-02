'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Core - Statement Processing Operation Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/repositories/StatementProcessingOperationRepository.js
 *
 * Purpose:
 *   Enterprise distributed idempotency / operation-claim repository for the
 *   Statement Processing pipeline.
 *
 * Contract:
 *   claim()
 *   findOne()
 *   findById()
 *   complete()
 *   fail()
 *   release()
 *   heartbeat()
 *   releaseExpiredClaims()
 *
 * Additional supported operations:
 *   markProcessing()
 *   update()
 *   findByOperationKey()
 *   diagnostics()
 *
 * Enterprise guarantees:
 *   - Tenant-scoped operation identity
 *   - Atomic claim acquisition
 *   - Duplicate operation detection
 *   - Lease-based worker ownership
 *   - Claim-token ownership enforcement
 *   - Safe expired-claim reclamation
 *   - Compare-and-set lifecycle transitions
 *   - Old workers cannot mutate a reclaimed operation when claimToken is used
 *   - Completion is terminal
 *   - Error metadata is bounded
 *   - Sensitive metadata is filtered
 *   - OpenTelemetry / metrics are not required by this repository
 *
 * IMPORTANT:
 *   This repository coordinates statement-processing execution state.
 *   It does not own financial truth and does not mutate ledger balances.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const StatementProcessingOperation =
    require(
        '../models/StatementProcessingOperation'
    );

/* ============================================================================
 * Model constants
 * ========================================================================== */

const OPERATION_STATUS =
    StatementProcessingOperation.OPERATION_STATUS ||
    Object.freeze({
        CLAIMED:
            'CLAIMED',

        PROCESSING:
            'PROCESSING',

        COMPLETED:
            'COMPLETED',

        FAILED:
            'FAILED',

        RELEASED:
            'RELEASED'
    });

/* ============================================================================
 * Configuration
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

const MAX_ERROR_MESSAGE_LENGTH =
    2000;

/* ============================================================================
 * Error classes
 * ========================================================================== */

class StatementProcessingOperationRepositoryError
    extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'StatementProcessingOperationRepositoryError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            StatementProcessingOperationRepositoryError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new StatementProcessingOperationRepositoryError(
        'STATEMENT_OPERATION_VALIDATION_ERROR',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new StatementProcessingOperationRepositoryError(
        'STATEMENT_OPERATION_CONFLICT',
        message,
        metadata
    );
}

function notFoundError(
    message,
    metadata = {}
) {

    return new StatementProcessingOperationRepositoryError(
        'STATEMENT_OPERATION_NOT_FOUND',
        message,
        metadata
    );
}

/* ============================================================================
 * Utility functions
 * ========================================================================== */

function generateId() {

    if (
        typeof crypto.randomUUID ===
        'function'
    ) {

        return crypto.randomUUID();
    }

    return [
        Date.now().toString(16),
        Math.random()
            .toString(16)
            .slice(2)
    ].join('-');
}

function normalizeString(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeString(
            tenantId
        );

    if (
        !normalized
    ) {

        throw validationError(
            'tenantId is required'
        );
    }

    return normalized;
}

function requireOperationKey(
    key
) {

    const normalized =
        normalizeString(
            key
        );

    if (
        !normalized
    ) {

        throw validationError(
            'operation key is required'
        );
    }

    return normalized;
}

function normalizeLimit(
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

/* ============================================================================
 * Repository
 * ========================================================================== */

class StatementProcessingOperationRepository {

    constructor(options = {}) {

        this.model =
            options.model ||
            StatementProcessingOperation;

        this.leaseMs =
            this.normalizeLeaseMs(
                options.leaseMs
            );

        this.clock =
            options.clock ||
            (() => new Date());

        this.logger =
            options.logger ||
            console;

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
     * Atomic Claim
     * ====================================================================== */

    async claim(
        key,
        context = {}
    ) {

        const operationKey =
            requireOperationKey(
                key
            );

        const tenantId =
            requireTenantId(
                context.tenantId
            );

        const now =
            this.now();

        const leaseExpiresAt =
            this.calculateLeaseExpiry(
                now
            );

        const claimToken =
            context.claimToken ||
            generateId();

        const idempotencyKey =
            normalizeString(
                context.idempotencyKey
            ) ||
            operationKey;

        /*
         * First attempt:
         *
         * Create the operation atomically if it does not exist.
         *
         * The compound unique index should be:
         *
         *   { tenantId: 1, operationKey: 1 } unique
         */
        try {

            const result =
                await this.model
                    .findOneAndUpdate(
                        {
                            tenantId,

                            operationKey
                        },
                        {
                            $setOnInsert: {

                                tenantId,

                                operationKey,

                                idempotencyKey,

                                statementId:
                                    normalizeString(
                                        context.statementId
                                    ),

                                provider:
                                    normalizeString(
                                        context.provider
                                    ),

                                providerStatementId:
                                    normalizeString(
                                        context.providerStatementId
                                    ),

                                correlationId:
                                    normalizeString(
                                        context.correlationId
                                    ),

                                requestId:
                                    normalizeString(
                                        context.requestId
                                    ),

                                status:
                                    OPERATION_STATUS.CLAIMED,

                                claimToken,

                                leaseExpiresAt,

                                lastHeartbeatAt:
                                    now,

                                attemptCount:
                                    1,

                                metadata:
                                    this.filterMetadata(
                                        context.metadata
                                    )
                            }
                        },
                        {
                            upsert:
                                true,

                            new:
                                true,

                            setDefaultsOnInsert:
                                true,

                            /*
                             * Works across Mongoose versions where rawResult
                             * is supported. The logic below also tolerates a
                             * normal document result.
                             */
                            rawResult:
                                true
                        }
                    );

            const value =
                result?.value ||
                result;

            /*
             * We own a newly inserted operation when the stored token equals
             * the token generated for this invocation.
             */
            if (
                value?.claimToken ===
                claimToken
            ) {

                return this.buildClaimResult(
                    true,
                    false,
                    claimToken,
                    value
                );
            }

            return this.resolveExistingClaim(
                tenantId,
                operationKey,
                value,
                {
                    ...context,

                    claimToken,
                    leaseExpiresAt,
                    now
                }
            );

        } catch (error) {

            /*
             * Concurrent insertion race.
             *
             * MongoDB's unique compound index determines the winner.
             * Re-read the durable record and resolve it exactly as if it had
             * already existed.
             */
            if (
                this.isDuplicateKeyError(
                    error
                )
            ) {

                const existing =
                    await this.findOne({
                        tenantId,

                        operationKey
                    });

                if (!existing) {
                    throw error;
                }

                return this.resolveExistingClaim(
                    tenantId,
                    operationKey,
                    existing,
                    {
                        ...context,

                        claimToken,
                        leaseExpiresAt,
                        now
                    }
                );
            }

            throw error;
        }
    }

    /* ========================================================================
     * Resolve Existing Operation
     * ====================================================================== */

    async resolveExistingClaim(
        tenantId,
        operationKey,
        existing,
        context
    ) {

        if (!existing) {

            throw notFoundError(
                'Statement processing operation was not found',
                {
                    tenantId,
                    operationKey
                }
            );
        }

        const now =
            context.now ||
            this.now();

        const status =
            String(
                existing.status ||
                ''
            )
                .trim()
                .toUpperCase();

        /*
         * Completed is terminal.
         *
         * Returning duplicate:true allows the caller to reuse the existing
         * result rather than executing the statement a second time.
         */
        if (
            status ===
            OPERATION_STATUS.COMPLETED
        ) {

            return this.buildClaimResult(
                false,
                true,
                null,
                existing
            );
        }

        /*
         * Active claim / processing lease.
         */
        if (
            (
                status ===
                    OPERATION_STATUS.CLAIMED ||
                status ===
                    OPERATION_STATUS.PROCESSING
            ) &&
            this.isLeaseActive(
                existing.leaseExpiresAt,
                now
            )
        ) {

            return this.buildClaimResult(
                false,
                true,
                null,
                existing
            );
        }

        /*
         * RELEASED / FAILED / expired CLAIMED or PROCESSING can be reclaimed.
         */
        if (
            status ===
                OPERATION_STATUS.RELEASED ||
            status ===
                OPERATION_STATUS.FAILED ||
            (
                (
                    status ===
                        OPERATION_STATUS.CLAIMED ||
                    status ===
                        OPERATION_STATUS.PROCESSING
                ) &&
                !this.isLeaseActive(
                    existing.leaseExpiresAt,
                    now
                )
            )
        ) {

            return this.reclaimExpired(
                tenantId,
                operationKey,
                existing,
                context
            );
        }

        /*
         * Unknown or unsupported state.
         *
         * Do not guess. Preserve financial processing safety.
         */
        throw conflictError(
            `Statement processing operation ${operationKey} is in unsupported state ${status}`,
            {
                tenantId,
                operationKey,
                status
            }
        );
    }

    /* ========================================================================
     * Reclaim Expired / Released / Failed Operation
     * ====================================================================== */

    async reclaimExpired(
        tenantId,
        operationKey,
        existing,
        context
    ) {

        const now =
            context.now ||
            this.now();

        const currentLease =
            existing?.leaseExpiresAt
                ? new Date(
                    existing.leaseExpiresAt
                )
                : null;

        if (
            currentLease &&
            !Number.isNaN(
                currentLease.getTime()
            ) &&
            currentLease >
                now
        ) {

            return this.buildClaimResult(
                false,
                true,
                null,
                existing
            );
        }

        const claimToken =
            context.claimToken ||
            generateId();

        const leaseExpiresAt =
            context.leaseExpiresAt ||
            this.calculateLeaseExpiry(
                now
            );

        /*
         * Compare-and-set reclamation.
         *
         * For an expired active claim, the previous claim token is included
         * when available. That prevents an old stale read from accidentally
         * reclaiming a newly assigned claim.
         */
        const filter = {

            tenantId,

            operationKey,

            $or: [
                {
                    status:
                        OPERATION_STATUS.RELEASED
                },

                {
                    status:
                        OPERATION_STATUS.FAILED
                },

                {
                    status:
                        OPERATION_STATUS.CLAIMED,

                    leaseExpiresAt: {
                        $lte:
                            now
                    }
                },

                {
                    status:
                        OPERATION_STATUS.PROCESSING,

                    leaseExpiresAt: {
                        $lte:
                            now
                    }
                }
            ]
        };

        /*
         * Strengthen expired CLAIMED/PROCESSING reclamation when possible.
         * MongoDB cannot express a single previous token constraint across
         * all $or branches cleanly without complicating the filter, therefore
         * the update remains protected by status/lease expiration and the
         * subsequent read validates ownership.
         */
        const update = {

            $set: {

                status:
                    OPERATION_STATUS.CLAIMED,

                claimToken,

                leaseExpiresAt,

                lastHeartbeatAt:
                    now,

                metadata:
                    context.metadata !==
                        undefined
                        ? this.filterMetadata(
                            context.metadata
                        )
                        : (
                            existing.metadata ||
                            {}
                        ),

                correlationId:
                    normalizeString(
                        context.correlationId
                    ) ||
                    existing.correlationId ||
                    null,

                requestId:
                    normalizeString(
                        context.requestId
                    ) ||
                    existing.requestId ||
                    null
            },

            $unset: {

                completedAt: 1,

                failedAt: 1,

                releasedAt: 1,

                error: 1
            },

            $inc: {

                attemptCount:
                    1
            }
        };

        const updated =
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

        if (!updated) {

            const current =
                await this.findOne({
                    tenantId,

                    operationKey
                });

            if (!current) {
                throw notFoundError(
                    'Statement processing operation disappeared during reclaim',
                    {
                        tenantId,
                        operationKey
                    }
                );
            }

            return this.resolveExistingClaim(
                tenantId,
                operationKey,
                current,
                context
            );
        }

        /*
         * Verify that the token we received belongs to this invocation.
         */
        if (
            updated.claimToken !==
            claimToken
        ) {

            return this.buildClaimResult(
                false,
                true,
                null,
                updated
            );
        }

        return this.buildClaimResult(
            true,
            false,
            claimToken,
            updated
        );
    }

    /* ========================================================================
     * Find One
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
            typeof query.lean ===
                'function'
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * Find By ID
     * ====================================================================== */

    async findById(
        id,
        options = {}
    ) {

        const normalizedId =
            normalizeString(
                id
            );

        if (
            !normalizedId
        ) {

            throw validationError(
                'id is required'
            );
        }

        let query;

        if (
            options.tenantId
        ) {

            query =
                this.model.findOne({
                    _id:
                        normalizedId,

                    tenantId:
                        this.requireTenantId(
                            options.tenantId
                        )
                });

        } else {

            query =
                this.model.findById(
                    normalizedId
                );
        }

        if (
            options.lean !== false &&
            typeof query.lean ===
                'function'
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * Find By Operation Key
     * ====================================================================== */

    async findByOperationKey(
        tenantId,
        key,
        options = {}
    ) {

        return this.findOne(
            {
                tenantId:
                    this.requireTenantId(
                        tenantId
                    ),

                operationKey:
                    requireOperationKey(
                        key
                    )
            },
            options
        );
    }

    /* ========================================================================
     * Mark Processing
     * ====================================================================== */

    async markProcessing(
        key,
        {
            tenantId,
            claimToken
        } = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const operationKey =
            requireOperationKey(
                key
            );

        if (
            !claimToken
        ) {

            throw validationError(
                'claimToken is required to mark an operation PROCESSING'
            );
        }

        const now =
            this.now();

        const updated =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        operationKey,

                        claimToken,

                        status:
                            OPERATION_STATUS.CLAIMED,

                        leaseExpiresAt: {
                            $gt:
                                now
                        }
                    },
                    {
                        $set: {

                            status:
                                OPERATION_STATUS.PROCESSING,

                            lastHeartbeatAt:
                                now,

                            leaseExpiresAt:
                                this.calculateLeaseExpiry(
                                    now
                                )
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

        if (
            !updated
        ) {

            const current =
                await this.findOne({
                    tenantId:
                        normalizedTenantId,

                    operationKey
                });

            if (!current) {
                throw notFoundError(
                    'Statement processing operation not found',
                    {
                        tenantId:
                            normalizedTenantId,

                        operationKey
                    }
                );
            }

            throw conflictError(
                'Statement processing operation cannot be marked PROCESSING',
                {
                    tenantId:
                        normalizedTenantId,

                    operationKey,

                    currentStatus:
                        current.status
                }
            );
        }

        return updated;
    }

    /* ========================================================================
     * Heartbeat
     * ====================================================================== */

    async heartbeat(
        key,
        {
            tenantId,
            claimToken
        } = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const operationKey =
            requireOperationKey(
                key
            );

        if (
            !claimToken
        ) {

            throw validationError(
                'claimToken is required for heartbeat'
            );
        }

        const now =
            this.now();

        const updated =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        operationKey,

                        claimToken,

                        status: {
                            $in: [
                                OPERATION_STATUS.CLAIMED,
                                OPERATION_STATUS.PROCESSING
                            ]
                        }
                    },
                    {
                        $set: {

                            lastHeartbeatAt:
                                now,

                            leaseExpiresAt:
                                this.calculateLeaseExpiry(
                                    now
                                )
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

        return updated;
    }

    /* ========================================================================
     * Complete
     * ====================================================================== */

    async complete(
        key,
        result = {}
    ) {

        const tenantId =
            requireTenantId(
                result.tenantId
            );

        const operationKey =
            requireOperationKey(
                key
            );

        const filter = {

            tenantId,

            operationKey,

            status: {
                $in: [
                    OPERATION_STATUS.CLAIMED,
                    OPERATION_STATUS.PROCESSING
                ]
            }
        };

        this.applyClaimToken(
            filter,
            result.claimToken
        );

        const now =
            this.now();

        const updated =
            await this.model
                .findOneAndUpdate(
                    filter,
                    {
                        $set: {

                            status:
                                OPERATION_STATUS.COMPLETED,

                            completedAt:
                                now,

                            resultId:
                                normalizeString(
                                    result.resultId
                                ),

                            error:
                                null
                        },

                        $unset: {

                            leaseExpiresAt: 1,

                            claimToken: 1
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

        if (
            updated
        ) {

            return updated;
        }

        /*
         * Make duplicate completion idempotent when the durable operation has
         * already been completed.
         */
        const existing =
            await this.findOne({
                tenantId,

                operationKey
            });

        if (
            existing?.status ===
            OPERATION_STATUS.COMPLETED
        ) {

            return existing;
        }

        throw conflictError(
            'Unable to complete statement processing operation',
            {
                tenantId,

                operationKey,

                currentStatus:
                    existing?.status ||
                    null
            }
        );
    }

    /* ========================================================================
     * Fail
     * ====================================================================== */

    async fail(
        key,
        {
            tenantId,
            claimToken,
            errorCode,
            errorMessage,
            stage,
            retryable = false
        } = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const operationKey =
            requireOperationKey(
                key
            );

        const filter = {

            tenantId:
                normalizedTenantId,

            operationKey,

            status: {
                $in: [
                    OPERATION_STATUS.CLAIMED,
                    OPERATION_STATUS.PROCESSING
                ]
            }
        };

        this.applyClaimToken(
            filter,
            claimToken
        );

        const now =
            this.now();

        const updated =
            await this.model
                .findOneAndUpdate(
                    filter,
                    {
                        $set: {

                            status:
                                OPERATION_STATUS.FAILED,

                            failedAt:
                                now,

                            error: {

                                code:
                                    normalizeString(
                                        errorCode
                                    ),

                                message:
                                    this.sanitizeErrorMessage(
                                        errorMessage
                                    ),

                                stage:
                                    normalizeString(
                                        stage
                                    ),

                                retryable:
                                    Boolean(
                                        retryable
                                    ),

                                occurredAt:
                                    now
                            }
                        },

                        $unset: {

                            leaseExpiresAt: 1,

                            claimToken: 1
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

        return updated;
    }

    /* ========================================================================
     * Release
     * ====================================================================== */

    async release(
        key,
        {
            tenantId,
            claimToken
        } = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const operationKey =
            requireOperationKey(
                key
            );

        if (
            !claimToken
        ) {

            throw validationError(
                'claimToken is required to release an operation'
            );
        }

        const filter = {

            tenantId:
                normalizedTenantId,

            operationKey,

            status: {
                $in: [
                    OPERATION_STATUS.CLAIMED,
                    OPERATION_STATUS.PROCESSING
                ]
            },

            claimToken
        };

        const now =
            this.now();

        return this.model
            .findOneAndUpdate(
                filter,
                {
                    $set: {

                        status:
                            OPERATION_STATUS.RELEASED,

                        releasedAt:
                            now
                    },

                    $unset: {

                        leaseExpiresAt: 1,

                        claimToken: 1
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
     * Release Expired Claims
     * ====================================================================== */

    async releaseExpiredClaims(
        limit =
            DEFAULT_RELEASE_LIMIT
    ) {

        const normalizedLimit =
            normalizeLimit(
                limit
            );

        const now =
            this.now();

        const candidates =
            await this.model
                .find({
                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING
                        ]
                    },

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
                    operationKey: 1,
                    claimToken: 1,
                    leaseExpiresAt: 1
                })
                .lean()
                .exec();

        if (
            candidates.length ===
            0
        ) {

            return {
                released:
                    0,

                records:
                    []
            };
        }

        const releasedRecords =
            [];

        /*
         * Each candidate is released with a compare-and-set filter using its
         * original claimToken. This prevents a new worker from being released
         * accidentally if it reclaimed the operation between the initial scan
         * and the update.
         */
        for (
            const candidate of
            candidates
        ) {

            const filter = {

                _id:
                    candidate._id,

                status: {
                    $in: [
                        OPERATION_STATUS.CLAIMED,
                        OPERATION_STATUS.PROCESSING
                    ]
                },

                leaseExpiresAt: {
                    $lte:
                        now
                },

                claimToken:
                    candidate.claimToken
            };

            const updated =
                await this.model
                    .findOneAndUpdate(
                        filter,
                        {
                            $set: {

                                status:
                                    OPERATION_STATUS.RELEASED,

                                releasedAt:
                                    now
                            },

                            $unset: {

                                leaseExpiresAt: 1,

                                claimToken: 1
                            }
                        },
                        {
                            new:
                                true
                        }
                    )
                    .lean()
                    .exec();

            if (
                updated
            ) {
                releasedRecords.push(
                    updated
                );
            }
        }

        return {

            released:
                releasedRecords.length,

            records:
                releasedRecords
        };
    }

    /* ========================================================================
     * Generic Update
     * ====================================================================== */

    async update(
        filter,
        update,
        options = {}
    ) {

        if (
            !filter ||
            typeof filter !== 'object'
        ) {

            throw validationError(
                'filter is required'
            );
        }

        return this.model
            .findOneAndUpdate(
                filter,
                update,
                {
                    new:
                        true,

                    runValidators:
                        options.runValidators !==
                        false
                }
            )
            .exec();
    }

    /* ========================================================================
     * Build Claim Result
     * ====================================================================== */

    buildClaimResult(
        claimed,
        duplicate,
        claimToken,
        record
    ) {

        return {

            claimed:
                Boolean(
                    claimed
                ),

            duplicate:
                Boolean(
                    duplicate
                ),

            claimToken:
                claimToken ||
                null,

            record:
                record || null
        };
    }

    /* ========================================================================
     * Claim / lease helpers
     * ====================================================================== */

    isLeaseActive(
        leaseExpiresAt,
        now
    ) {

        if (
            !leaseExpiresAt
        ) {
            return false;
        }

        const expiry =
            new Date(
                leaseExpiresAt
            );

        if (
            Number.isNaN(
                expiry.getTime()
            )
        ) {
            return false;
        }

        return expiry >
            now;
    }

    calculateLeaseExpiry(
        now
    ) {

        return new Date(
            now.getTime() +
            this.leaseMs
        );
    }

    applyClaimToken(
        filter,
        claimToken
    ) {

        if (
            claimToken
        ) {
            filter.claimToken =
                claimToken;
        }

        return filter;
    }

    /* ========================================================================
     * Metadata filtering
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

        const forbidden =
            new Set([
                'tenantId',
                'operationKey',
                'idempotencyKey',
                'claimToken',
                'accessToken',
                'refreshToken',
                'authorization',
                'password',
                'secret',
                'apiKey',
                'privateKey',
                'pin',
                'otp',
                'cvv',
                'cardNumber',
                'accountNumber',
                'walletNumber',
                'rawPayload',
                'requestBody',
                'responseBody'
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
            /identity.?number/i,
            /raw.?payload/i,
            /request.?body/i,
            /response.?body/i
        ];

        const result = {};
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
                forbidden.has(
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

            result[
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

        return result;
    }

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
            Array.isArray(
                value
            )
        ) {

            return value
                .slice(
                    0,
                    50
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

            const nested = {};
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

                nested[
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

            return nested;
        }

        return String(
            value
        ).slice(
            0,
            this.maxMetadataStringLength
        );
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
     * Validation
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

        const number =
            Number(value);

        if (
            !Number.isFinite(
                number
            ) ||
            number <= 0
        ) {
            return DEFAULT_LEASE_MS;
        }

        return Math.min(
            number,
            MAX_LEASE_MS
        );
    }

    /* ========================================================================
     * Duplicate key detection
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

                (
                    error.name ===
                        'MongoServerError' &&
                    String(
                        error.message ||
                        ''
                    )
                        .toLowerCase()
                        .includes(
                            'duplicate'
                        )
                )
            )
        );
    }

    /* ========================================================================
     * Tenant scope
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
                this.requireTenantId(
                    tenantId
                );
        }

        return result;
    }

    /* ========================================================================
     * Clock
     * ====================================================================== */

    now() {

        const value =
            this.clock();

        const date =
            value instanceof Date
                ? new Date(
                    value.getTime()
                )
                : new Date(
                    value
                );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new Error(
                'StatementProcessingOperationRepository clock returned an invalid date'
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
                'StatementProcessingOperationRepository',

            modelConfigured:
                Boolean(
                    this.model
                ),

            leaseMs:
                this.leaseMs,

            maxMetadataKeys:
                this.maxMetadataKeys,

            statuses:
                Object.values(
                    OPERATION_STATUS
                ),

            capabilities: {

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

            timestamp:
                this.now()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

StatementProcessingOperationRepository.STATUS =
    OPERATION_STATUS;

StatementProcessingOperationRepository.Error =
    StatementProcessingOperationRepositoryError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    StatementProcessingOperationRepository;