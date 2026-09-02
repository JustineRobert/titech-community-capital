'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementBatchManager.js
 * ============================================================================
 *
 * Enterprise Statement Batch Lifecycle Manager
 *
 * Responsibilities:
 *
 * - Create and manage statement processing batches.
 * - Provide batch-level execution tracking.
 * - Maintain tenant isolation.
 * - Support large statement imports.
 * - Track processing lifecycle.
 * - Provide audit and observability metadata.
 * - Enforce explicit lifecycle transitions.
 * - Preserve immutable batch identity.
 * - Support distributed processing.
 *
 * Pipeline Position:
 *
 * StatementContext
 *      |
 *      v
 * StatementBatchManager
 *      |
 *      v
 * StatementImporter
 *      |
 *      v
 * StatementValidator
 *      |
 *      v
 * StatementRepository
 *
 * Batch Lifecycle:
 *
 * CREATED
 *    |
 *    v
 * PROCESSING
 *    |
 *    +------------------+
 *    |                  |
 *    v                  v
 * COMPLETED            FAILED
 *
 * CREATED
 *    |
 *    v
 * CANCELLED
 *
 * Design Principles:
 *
 * - Immutable identifiers.
 * - Explicit lifecycle transitions.
 * - Multi-tenant aware.
 * - Audit friendly.
 * - Distributed processing ready.
 * - Deterministic validation.
 * - Safe failure handling.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    StatementProcessingError
} = require('./StatementErrors');

/**
 * ============================================================================
 * Batch Status
 * ============================================================================
 */

const BATCH_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    CANCELLED:
        'CANCELLED'

});

/**
 * ============================================================================
 * Terminal Batch States
 * ============================================================================
 */

const TERMINAL_STATUSES = Object.freeze(
    new Set([
        BATCH_STATUS.COMPLETED,
        BATCH_STATUS.FAILED,
        BATCH_STATUS.CANCELLED
    ])
);

/**
 * ============================================================================
 * Allowed Lifecycle Transitions
 * ============================================================================
 *
 * Explicit state transitions prevent accidental lifecycle corruption.
 */

const ALLOWED_TRANSITIONS = Object.freeze({

    [BATCH_STATUS.CREATED]:
        Object.freeze([
            BATCH_STATUS.PROCESSING,
            BATCH_STATUS.CANCELLED
        ]),

    [BATCH_STATUS.PROCESSING]:
        Object.freeze([
            BATCH_STATUS.COMPLETED,
            BATCH_STATUS.FAILED,
            BATCH_STATUS.CANCELLED
        ]),

    [BATCH_STATUS.COMPLETED]:
        Object.freeze([]),

    [BATCH_STATUS.FAILED]:
        Object.freeze([]),

    [BATCH_STATUS.CANCELLED]:
        Object.freeze([])

});

/**
 * ============================================================================
 * Internal Utilities
 * ============================================================================
 */

function isPlainObject(value) {

    if (!value || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeCount(value, fieldName) {

    const numericValue = Number(value);

    if (
        !Number.isInteger(numericValue) ||
        numericValue < 0
    ) {

        throw new StatementProcessingError(

            `Invalid batch ${fieldName}`,

            {
                field: fieldName,
                value
            },

            {
                code: 'STATEMENT_BATCH_INVALID_PROGRESS'
            }

        );

    }

    return numericValue;
}

function freezeDate(value) {

    if (!(value instanceof Date)) {
        return value;
    }

    return new Date(value.getTime());
}

function immutableBatch(batch) {

    const copy = {
        ...batch
    };

    /*
     * Dates remain Date instances while the containing object is immutable.
     * Callers receive lifecycle snapshots rather than a mutable batch object.
     */
    if (copy.createdAt instanceof Date) {
        copy.createdAt = freezeDate(copy.createdAt);
    }

    if (copy.startedAt instanceof Date) {
        copy.startedAt = freezeDate(copy.startedAt);
    }

    if (copy.completedAt instanceof Date) {
        copy.completedAt = freezeDate(copy.completedAt);
    }

    if (copy.updatedAt instanceof Date) {
        copy.updatedAt = freezeDate(copy.updatedAt);
    }

    return Object.freeze(copy);
}

/**
 * ============================================================================
 * StatementBatchManager
 * ============================================================================
 */

class StatementBatchManager {

    /**
     * =========================================================================
     * Create Processing Batch
     * =========================================================================
     *
     * @param {Object} context StatementContext
     * @returns {Object} Immutable batch snapshot
     */

    createBatch(context) {

        try {

            this.validateContext(context);

            const now = new Date();

            const batch = {

                /**
                 * Immutable processing identity.
                 */
                batchId:
                    crypto.randomUUID(),

                /**
                 * Tenant isolation boundary.
                 */
                tenantId:
                    context.tenantId,

                /**
                 * Distributed tracing metadata.
                 */
                correlationId:
                    context.correlationId || null,

                requestId:
                    context.requestId || null,

                executionId:
                    context.executionId || null,

                traceId:
                    context.traceId || null,

                /**
                 * Processing origin.
                 */
                source:
                    context.source || null,

                /**
                 * Runtime actor/service metadata.
                 */
                userId:
                    context.userId || null,

                actor:
                    context.actor || null,

                service:
                    context.service || 'statement-processing',

                environment:
                    context.environment ||
                    process.env.NODE_ENV ||
                    'development',

                /**
                 * Lifecycle.
                 */
                status:
                    BATCH_STATUS.CREATED,

                /**
                 * Processing counters.
                 */
                statementCount:
                    0,

                processedCount:
                    0,

                failedCount:
                    0,

                /**
                 * Lifecycle timestamps.
                 */
                createdAt:
                    now,

                startedAt:
                    null,

                completedAt:
                    null,

                updatedAt:
                    now,

                /**
                 * Failure/cancellation metadata.
                 */
                failureReason:
                    null,

                cancellationReason:
                    null,

                /**
                 * Audit metadata.
                 */
                metadata:
                    isPlainObject(context.metadata)
                        ? Object.freeze({
                            ...context.metadata
                        })
                        : Object.freeze({})

            };

            return immutableBatch(batch);

        } catch (error) {

            if (
                error instanceof StatementProcessingError
            ) {
                throw error;
            }

            throw new StatementProcessingError(

                'Failed creating statement batch',

                {
                    originalError:
                        error?.message ||
                        String(error)
                },

                {
                    code:
                        'STATEMENT_BATCH_CREATION_FAILED',

                    retryable:
                        false,

                    cause:
                        error
                }

            );

        }

    }

    /**
     * =========================================================================
     * Start Batch Processing
     * =========================================================================
     *
     * CREATED -> PROCESSING
     *
     * @param {Object} batch
     * @returns {Object} Updated immutable batch snapshot
     */

    start(batch) {

        this.validateBatch(batch);

        this.assertTransition(
            batch.status,
            BATCH_STATUS.PROCESSING
        );

        const now = new Date();

        return immutableBatch({

            ...batch,

            status:
                BATCH_STATUS.PROCESSING,

            startedAt:
                batch.startedAt || now,

            updatedAt:
                now

        });

    }

    /**
     * =========================================================================
     * Update Batch Progress
     * =========================================================================
     *
     * Progress updates are only permitted while processing.
     *
     * Invariants:
     *
     * processedCount <= statementCount
     * failedCount <= statementCount
     * processedCount + failedCount <= statementCount
     *
     * @param {Object} batch
     * @param {Object} progress
     */

    updateProgress(

        batch,

        {
            processed =
                batch?.processedCount ?? 0,

            failed =
                batch?.failedCount ?? 0,

            total =
                batch?.statementCount ?? 0

        } = {}

    ) {

        this.validateBatch(batch);

        if (
            batch.status !==
            BATCH_STATUS.PROCESSING
        ) {

            throw new StatementProcessingError(

                'Batch progress can only be updated while processing',

                {
                    batchId:
                        batch.batchId,

                    status:
                        batch.status
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_STATE'
                }

            );

        }

        const statementCount =
            normalizeCount(
                total,
                'statementCount'
            );

        const processedCount =
            normalizeCount(
                processed,
                'processedCount'
            );

        const failedCount =
            normalizeCount(
                failed,
                'failedCount'
            );

        if (
            processedCount >
            statementCount
        ) {

            throw new StatementProcessingError(

                'Processed statement count cannot exceed total statement count',

                {
                    batchId:
                        batch.batchId,

                    statementCount,

                    processedCount
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_PROGRESS'
                }

            );

        }

        if (
            failedCount >
            statementCount
        ) {

            throw new StatementProcessingError(

                'Failed statement count cannot exceed total statement count',

                {
                    batchId:
                        batch.batchId,

                    statementCount,

                    failedCount
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_PROGRESS'
                }

            );

        }

        if (
            processedCount +
            failedCount >
            statementCount
        ) {

            throw new StatementProcessingError(

                'Processed and failed counts cannot exceed total statement count',

                {
                    batchId:
                        batch.batchId,

                    statementCount,

                    processedCount,

                    failedCount
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_PROGRESS'
                }

            );

        }

        return immutableBatch({

            ...batch,

            statementCount,

            processedCount,

            failedCount,

            updatedAt:
                new Date()

        });

    }

    /**
     * =========================================================================
     * Complete Batch
     * =========================================================================
     *
     * PROCESSING -> COMPLETED
     *
     * Completion is only permitted when all statements have been accounted for.
     *
     * @param {Object} batch
     */

    complete(batch) {

        this.validateBatch(batch);

        this.assertTransition(
            batch.status,
            BATCH_STATUS.COMPLETED
        );

        if (
            batch.processedCount +
            batch.failedCount <
            batch.statementCount
        ) {

            throw new StatementProcessingError(

                'Cannot complete batch before all statements are accounted for',

                {
                    batchId:
                        batch.batchId,

                    statementCount:
                        batch.statementCount,

                    processedCount:
                        batch.processedCount,

                    failedCount:
                        batch.failedCount
                },

                {
                    code:
                        'STATEMENT_BATCH_INCOMPLETE'
                }

            );

        }

        const now = new Date();

        return immutableBatch({

            ...batch,

            status:
                BATCH_STATUS.COMPLETED,

            completedAt:
                now,

            updatedAt:
                now

        });

    }

    /**
     * =========================================================================
     * Fail Batch
     * =========================================================================
     *
     * PROCESSING -> FAILED
     *
     * @param {Object} batch
     * @param {Error|string} reason
     */

    fail(batch, reason = null) {

        this.validateBatch(batch);

        this.assertTransition(
            batch.status,
            BATCH_STATUS.FAILED
        );

        const now = new Date();

        return immutableBatch({

            ...batch,

            status:
                BATCH_STATUS.FAILED,

            failureReason:
                this.normalizeReason(reason),

            completedAt:
                now,

            updatedAt:
                now

        });

    }

    /**
     * =========================================================================
     * Cancel Batch
     * =========================================================================
     *
     * CREATED/PROCESSING -> CANCELLED
     *
     * @param {Object} batch
     * @param {Error|string} reason
     */

    cancel(batch, reason = null) {

        this.validateBatch(batch);

        this.assertTransition(
            batch.status,
            BATCH_STATUS.CANCELLED
        );

        const now = new Date();

        return immutableBatch({

            ...batch,

            status:
                BATCH_STATUS.CANCELLED,

            cancellationReason:
                this.normalizeReason(reason),

            completedAt:
                now,

            updatedAt:
                now

        });

    }

    /**
     * =========================================================================
     * Validate Context
     * =========================================================================
     *
     * Tenant identity is mandatory because statement processing is a
     * multi-tenant financial workflow.
     */

    validateContext(context) {

        if (!context) {

            throw new StatementProcessingError(

                'Statement context required',

                {
                    reason:
                        'MISSING_CONTEXT'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT'
                }

            );

        }

        if (
            !context.tenantId
        ) {

            throw new StatementProcessingError(

                'Tenant context required',

                {
                    reason:
                        'MISSING_TENANT'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT'
                }

            );

        }

        if (
            typeof context.tenantId !==
            'string' ||
            !context.tenantId.trim()
        ) {

            throw new StatementProcessingError(

                'Invalid tenant context',

                {
                    reason:
                        'INVALID_TENANT'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT'
                }

            );

        }

    }

    /**
     * =========================================================================
     * Validate Batch
     * =========================================================================
     */

    validateBatch(batch) {

        if (
            !batch ||
            typeof batch !== 'object'
        ) {

            throw new StatementProcessingError(

                'Invalid statement batch',

                {
                    reason:
                        'INVALID_BATCH'
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID'
                }

            );

        }

        if (
            !batch.batchId ||
            typeof batch.batchId !== 'string'
        ) {

            throw new StatementProcessingError(

                'Statement batch identifier required',

                {
                    reason:
                        'MISSING_BATCH_ID'
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID'
                }

            );

        }

        if (
            !batch.tenantId ||
            typeof batch.tenantId !== 'string'
        ) {

            throw new StatementProcessingError(

                'Statement batch tenant identifier required',

                {
                    batchId:
                        batch.batchId,

                    reason:
                        'MISSING_TENANT_ID'
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID'
                }

            );

        }

        if (
            !Object.values(BATCH_STATUS)
                .includes(batch.status)
        ) {

            throw new StatementProcessingError(

                'Invalid statement batch status',

                {
                    batchId:
                        batch.batchId,

                    status:
                        batch.status
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_STATUS'
                }

            );

        }

        /*
         * Validate counters when present.
         */

        normalizeCount(
            batch.statementCount ?? 0,
            'statementCount'
        );

        normalizeCount(
            batch.processedCount ?? 0,
            'processedCount'
        );

        normalizeCount(
            batch.failedCount ?? 0,
            'failedCount'
        );

        return true;

    }

    /**
     * =========================================================================
     * Assert Lifecycle Transition
     * =========================================================================
     */

    assertTransition(
        currentStatus,
        nextStatus
    ) {

        const allowed =
            ALLOWED_TRANSITIONS[currentStatus] || [];

        if (
            !allowed.includes(nextStatus)
        ) {

            throw new StatementProcessingError(

                `Invalid batch lifecycle transition: ${currentStatus} -> ${nextStatus}`,

                {
                    currentStatus,
                    nextStatus
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID_TRANSITION'
                }

            );

        }

    }

    /**
     * =========================================================================
     * Check Terminal State
     * =========================================================================
     */

    isTerminal(batch) {

        this.validateBatch(batch);

        return TERMINAL_STATUSES.has(
            batch.status
        );

    }

    /**
     * =========================================================================
     * Check Completion
     * =========================================================================
     */

    isComplete(batch) {

        this.validateBatch(batch);

        return (

            batch.status ===
            BATCH_STATUS.COMPLETED

        );

    }

    /**
     * =========================================================================
     * Check Failure
     * =========================================================================
     */

    isFailed(batch) {

        this.validateBatch(batch);

        return (

            batch.status ===
            BATCH_STATUS.FAILED

        );

    }

    /**
     * =========================================================================
     * Check Cancellation
     * =========================================================================
     */

    isCancelled(batch) {

        this.validateBatch(batch);

        return (

            batch.status ===
            BATCH_STATUS.CANCELLED

        );

    }

    /**
     * =========================================================================
     * Normalize Failure/Cancellation Reason
     * =========================================================================
     */

    normalizeReason(reason) {

        if (reason instanceof Error) {

            return reason.message;

        }

        if (
            reason === null ||
            reason === undefined
        ) {

            return null;

        }

        if (
            typeof reason === 'string'
        ) {

            return reason.trim() || null;

        }

        return String(reason);

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementBatchManager;

module.exports.BATCH_STATUS =
    BATCH_STATUS;

module.exports.TERMINAL_STATUSES =
    TERMINAL_STATUSES;

module.exports.ALLOWED_TRANSITIONS =
    ALLOWED_TRANSITIONS;