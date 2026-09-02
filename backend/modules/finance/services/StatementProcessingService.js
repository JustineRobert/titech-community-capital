'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Processing Service
 * ============================================================================
 *
 * Enterprise orchestration service for external financial statement ingestion.
 *
 * Responsibility
 * ----------------------------------------------------------------------------
 *
 * This service owns the statement-processing workflow:
 *
 *   process()
 *      |
 *      +-- Idempotency
 *      |
 *      +-- Batch coordination
 *      |
 *      +-- Import
 *      |
 *      +-- Normalization
 *      |
 *      +-- Validation
 *      |
 *      +-- Repository persistence
 *      |
 *      +-- Downstream event publication
 *      |
 *      +-- Final result
 *
 * It does NOT own:
 *
 * • low-level tracing implementation
 * • accounting posting
 * • ledger mutation
 * • provider-specific parsing
 * • database implementation
 * • reconciliation matching rules
 *
 * Those responsibilities are delegated to injected dependencies.
 *
 * Design Goals
 * ----------------------------------------------------------------------------
 *
 * • Production-grade orchestration
 * • Multi-tenant safe
 * • Idempotent processing
 * • Provider-aware
 * • Batch-aware
 * • Retry-aware
 * • Trace-aware
 * • Event-aware
 * • Repository-agnostic
 * • Transaction-safe where infrastructure supports it
 * • No direct ledger mutation
 * • Immutable input handling
 * • Deterministic operation identity
 * • Safe error propagation
 * • Observability failure isolation
 * • Backward-compatible dependency injection
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROCESSING_STATUS = Object.freeze({

    RECEIVED: 'RECEIVED',

    PROCESSING: 'PROCESSING',

    IMPORTED: 'IMPORTED',

    NORMALIZED: 'NORMALIZED',

    VALIDATED: 'VALIDATED',

    PERSISTED: 'PERSISTED',

    BATCHED: 'BATCHED',

    COMPLETED: 'COMPLETED',

    DUPLICATE: 'DUPLICATE',

    FAILED: 'FAILED',

    PARTIAL: 'PARTIAL'
});

const FAILURE_STAGE = Object.freeze({

    IDEMPOTENCY: 'IDEMPOTENCY',

    BATCH: 'BATCH',

    IMPORT: 'IMPORT',

    NORMALIZE: 'NORMALIZE',

    VALIDATE: 'VALIDATE',

    PERSIST: 'PERSIST',

    EVENT: 'EVENT',

    UNKNOWN: 'UNKNOWN'
});

const EVENT_NAMES = Object.freeze({

    STATEMENT_PROCESSING_STARTED:
        'statement.processing.started',

    STATEMENT_PROCESSING_COMPLETED:
        'statement.processing.completed',

    STATEMENT_PROCESSING_FAILED:
        'statement.processing.failed',

    STATEMENT_DUPLICATE:
        'statement.processing.duplicate',

    STATEMENT_IMPORTED:
        'statement.imported',

    STATEMENT_NORMALIZED:
        'statement.normalized',

    STATEMENT_VALIDATED:
        'statement.validated',

    STATEMENT_PERSISTED:
        'statement.persisted',

    STATEMENT_BATCHED:
        'statement.batched'
});

const DEFAULTS = Object.freeze({

    enabled: true,

    strictDependencies: true,

    requireTenantId: true,

    requireProvider: false,

    requireIdempotency: true,

    requireBatch: false,

    publishEvents: true,

    failOnEventPublishError: false,

    enableRetry: true,

    maxAttempts: 3,

    retryDelayMs: 250,

    maxRetryDelayMs: 10000,

    exponentialBackoff: true,

    generateCorrelationId: true,

    generateOperationId: true,

    generateIdempotencyKey: true,

    includeInputFingerprint: true,

    maxInputFingerprintBytes: 1024 * 1024,

    allowEmptyStatements: false,

    allowPartialBatch: true
});

/**
 * ============================================================================
 * Error Classes
 * ============================================================================
 */

class StatementProcessingError extends Error {

    constructor(
        message,
        {
            code = 'STATEMENT_PROCESSING_ERROR',
            stage = FAILURE_STAGE.UNKNOWN,
            retryable = false,
            details = null,
            cause = null
        } = {}
    ) {

        super(message);

        this.name =
            'StatementProcessingError';

        this.code =
            code;

        this.stage =
            stage;

        this.retryable =
            Boolean(retryable);

        this.details =
            details;

        this.cause =
            cause || null;
    }
}

class StatementDuplicateError
    extends StatementProcessingError {

    constructor(
        message = 'Statement has already been processed',
        details = {}
    ) {

        super(
            message,
            {
                code:
                    'STATEMENT_DUPLICATE',

                stage:
                    FAILURE_STAGE.IDEMPOTENCY,

                retryable:
                    false,

                details
            }
        );

        this.name =
            'StatementDuplicateError';
    }
}

class StatementValidationError
    extends StatementProcessingError {

    constructor(
        message = 'Statement validation failed',
        details = {}
    ) {

        super(
            message,
            {
                code:
                    'STATEMENT_VALIDATION_FAILED',

                stage:
                    FAILURE_STAGE.VALIDATE,

                retryable:
                    false,

                details
            }
        );

        this.name =
            'StatementValidationError';
    }
}

class StatementPersistenceError
    extends StatementProcessingError {

    constructor(
        message = 'Statement persistence failed',
        details = {},
        cause = null
    ) {

        super(
            message,
            {
                code:
                    'STATEMENT_PERSISTENCE_FAILED',

                stage:
                    FAILURE_STAGE.PERSIST,

                retryable:
                    true,

                details,

                cause
            }
        );

        this.name =
            'StatementPersistenceError';
    }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function generateId() {

    return crypto.randomUUID();
}

function isFunction(value) {

    return typeof value === 'function';
}

function hasMethod(
    target,
    method
) {

    return Boolean(
        target &&
        isFunction(
            target[method]
        )
    );
}

function sleep(ms) {

    if (
        !Number.isFinite(ms) ||
        ms <= 0
    ) {

        return Promise.resolve();
    }

    return new Promise(resolve => {

        setTimeout(
            resolve,
            ms
        );

    });
}

function safeString(
    value,
    maxLength = 2048
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    const stringValue =
        String(value);

    return (
        stringValue.length <= maxLength
            ? stringValue
            : `${stringValue.slice(0, maxLength)}...`
    );
}

function normalizeError(error) {

    if (!error) {
        return null;
    }

    return {

        name:
            error.name ||
            'Error',

        message:
            safeString(
                error.message ||
                'Unknown error'
            ),

        code:
            error.code ||
            null,

        status:
            error.status ||
            null,

        stage:
            error.stage ||
            null,

        retryable:
            Boolean(
                error.retryable
            )
    };
}

/**
 * ============================================================================
 * Statement Processing Service
 * ============================================================================
 */

class StatementProcessingService {

    constructor(options = {}) {

        /**
         * ====================================================================
         * Core dependencies
         * ====================================================================
         */

        this.importer =
            options.importer ||
            null;

        this.normalizer =
            options.normalizer ||
            null;

        this.validator =
            options.validator ||
            null;

        this.repository =
            options.repository ||
            null;

        /**
         * Optional batch manager.
         */
        this.batchManager =
            options.batchManager ||
            null;

        /**
         * Optional idempotency infrastructure.
         *
         * Compatible with:
         *
         * claim()
         * get()
         * find()
         * exists()
         * complete()
         * fail()
         * release()
         */
        this.idempotencyStore =
            options.idempotencyStore ||
            options.idempotency ||
            null;

        /**
         * Optional event publisher.
         */
        this.eventPublisher =
            options.eventPublisher ||
            options.eventBus ||
            null;

        /**
         * Finance-specific tracing facade.
         */
        this.statementTracing =
            options.statementTracing ||
            options.tracing ||
            null;

        /**
         * Structured logger.
         */
        this.logger =
            options.logger ||
            console;

        /**
         * Metrics adapter.
         */
        this.metrics =
            options.metrics ||
            null;

        /**
         * Optional transaction/unit-of-work provider.
         *
         * Expected optional contract:
         *
         * withTransaction(fn)
         *
         */
        this.unitOfWork =
            options.unitOfWork ||
            options.transactionManager ||
            null;

        /**
         * Optional audit service.
         */
        this.auditService =
            options.auditService ||
            null;

        /**
         * Optional clock.
         */
        this.clock =
            options.clock ||
            Date;

        /**
         * Runtime configuration.
         */
        this.config = {

            ...DEFAULTS,

            ...options
        };

        /**
         * Statistics.
         */
        this.statistics = {

            processed:
                0,

            completed:
                0,

            duplicates:
                0,

            failed:
                0,

            partial:
                0,

            imported:
                0,

            normalized:
                0,

            validated:
                0,

            persisted:
                0,

            batches:
                0,

            retries:
                0,

            eventFailures:
                0
        };

        /**
         * Dependency validation.
         */
        this.validateDependencies();
    }

    /**
     * ========================================================================
     * Public API — process()
     * ========================================================================
     *
     * Main statement-processing orchestration entry point.
     *
     * ========================================================================
     */

    async process(
        input,
        context = {}
    ) {

        const execution =
            this.createExecutionContext(
                input,
                context
            );

        this.statistics.processed++;

        const processCallback =
            async (
                span,
                traceContext
            ) => {

                const ctx =
                    this.mergeContext(
                        execution,
                        traceContext
                    );

                this.safeTraceEvent(
                    span,
                    EVENT_NAMES.STATEMENT_PROCESSING_STARTED,
                    this.lifecycleMetadata(ctx)
                );

                try {

                    const result =
                        await this.executeProcess(
                            input,
                            ctx,
                            span
                        );

                    this.statistics.completed++;

                    this.safeTraceEvent(
                        span,
                        EVENT_NAMES.STATEMENT_PROCESSING_COMPLETED,
                        this.lifecycleMetadata(
                            {
                                ...ctx,

                                status:
                                    result.status
                            }
                        )
                    );

                    await this.publishLifecycleEvent(
                        EVENT_NAMES.STATEMENT_PROCESSING_COMPLETED,
                        result,
                        ctx
                    );

                    await this.recordAudit(
                        'statement.processing.completed',
                        result,
                        ctx
                    );

                    return result;

                }
                catch (error) {

                    this.statistics.failed++;

                    const normalized =
                        normalizeError(error);

                    this.safeTraceEvent(
                        span,
                        EVENT_NAMES.STATEMENT_PROCESSING_FAILED,
                        {
                            ...this.lifecycleMetadata(
                                ctx
                            ),

                            errorCode:
                                normalized?.code ||
                                null,

                            stage:
                                error?.stage ||
                                FAILURE_STAGE.UNKNOWN
                        }
                    );

                    await this.publishLifecycleEvent(
                        EVENT_NAMES.STATEMENT_PROCESSING_FAILED,
                        {
                            ...ctx,

                            error:
                                normalized
                        },
                        ctx,
                        {
                            allowFailure:
                                true
                        }
                    );

                    await this.recordAudit(
                        'statement.processing.failed',
                        {
                            ...ctx,

                            error:
                                normalized
                        },
                        ctx
                    );

                    throw error;
                }
            };

        /**
         * Tracing facade is deliberately optional.
         */
        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'process'
            )
        ) {

            return this.statementTracing.process(
                processCallback,
                execution
            );
        }

        return processCallback(
            null,
            execution
        );
    }

    /**
     * ========================================================================
     * Main Processing Workflow
     * ========================================================================
     */

    async executeProcess(
        input,
        context,
        rootSpan
    ) {

        /**
         * --------------------------------------------------------------------
         * Phase 1 — Idempotency
         * --------------------------------------------------------------------
         */

        const idempotency =
            await this.checkIdempotency(
                context,
                rootSpan
            );

        if (
            idempotency.duplicate
        ) {

            this.statistics.duplicates++;

            this.safeTraceEvent(
                rootSpan,
                EVENT_NAMES.STATEMENT_DUPLICATE,
                {
                    statementId:
                        context.statementId,

                    batchId:
                        context.batchId,

                    operationKey:
                        context.operationKey
                }
            );

            await this.publishLifecycleEvent(
                EVENT_NAMES.STATEMENT_DUPLICATE,
                {
                    status:
                        PROCESSING_STATUS.DUPLICATE,

                    existing:
                        idempotency.record,

                    ...context
                },
                context
            );

            return this.buildDuplicateResult(
                context,
                idempotency.record
            );
        }

        /**
         * --------------------------------------------------------------------
         * Phase 2 — Batch Coordination
         * --------------------------------------------------------------------
         */

        const batch =
            await this.coordinateBatchStart(
                context,
                rootSpan
            );

        const batchContext =
            this.mergeContext(
                context,
                {
                    batchId:
                        batch?.batchId ||
                        context.batchId ||
                        null
                }
            );

        /**
         * --------------------------------------------------------------------
         * Phase 3 — Import
         * --------------------------------------------------------------------
         */

        const imported =
            await this.importStatement(
                input,
                batchContext,
                rootSpan
            );

        /**
         * --------------------------------------------------------------------
         * Phase 4 — Normalize
         * --------------------------------------------------------------------
         */

        const normalized =
            await this.normalizeStatement(
                imported,
                batchContext,
                rootSpan
            );

        /**
         * --------------------------------------------------------------------
         * Phase 5 — Validate
         * --------------------------------------------------------------------
         */

        const validation =
            await this.validateStatement(
                normalized,
                batchContext,
                rootSpan
            );

        /**
         * --------------------------------------------------------------------
         * Phase 6 — Persist
         * --------------------------------------------------------------------
         */

        const persisted =
            await this.persistStatement(
                normalized,
                validation,
                batchContext,
                rootSpan
            );

        /**
         * --------------------------------------------------------------------
         * Phase 7 — Batch Completion
         * --------------------------------------------------------------------
         */

        const batchResult =
            await this.coordinateBatchCompletion(
                batchContext,
                persisted,
                rootSpan
            );

        /**
         * --------------------------------------------------------------------
         * Phase 8 — Downstream Events
         * --------------------------------------------------------------------
         */

        await this.publishLifecycleEvent(
            EVENT_NAMES.STATEMENT_IMPORTED,
            {
                statement:
                    persisted,

                status:
                    PROCESSING_STATUS.PERSISTED,

                ...batchContext
            },
            batchContext
        );

        await this.publishLifecycleEvent(
            EVENT_NAMES.STATEMENT_PERSISTED,
            {
                statement:
                    persisted,

                ...batchContext
            },
            batchContext
        );

        await this.publishLifecycleEvent(
            EVENT_NAMES.STATEMENT_BATCHED,
            {
                statement:
                    persisted,

                batch:
                    batchResult,

                ...batchContext
            },
            batchContext
        );

        /**
         * --------------------------------------------------------------------
         * Phase 9 — Idempotency Completion
         * --------------------------------------------------------------------
         */

        await this.completeIdempotency(
            batchContext,
            persisted
        );

        this.statistics.persisted++;

        /**
         * --------------------------------------------------------------------
         * Final Result
         * --------------------------------------------------------------------
         */

        return this.buildSuccessResult(
            {
                context:
                    batchContext,

                imported,

                normalized,

                validation,

                persisted,

                batch:
                    batchResult
            }
        );
    }

    /**
     * ========================================================================
     * Import
     * ========================================================================
     */

    async importStatement(
        input,
        context,
        parentSpan
    ) {

        const callback =
            async (
                span,
                traceContext
            ) => {

                const ctx =
                    this.mergeContext(
                        context,
                        traceContext
                    );

                const execute =
                    () =>
                        this.executeImporter(
                            input,
                            ctx
                        );

                try {

                    const result =
                        await this.executeWithRetry(
                            FAILURE_STAGE.IMPORT,
                            execute,
                            ctx,
                            span
                        );

                    this.statistics.imported++;

                    return result;

                }
                catch (error) {

                    throw this.toStageError(
                        error,
                        FAILURE_STAGE.IMPORT
                    );
                }
            };

        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'importStatement'
            )
        ) {

            return this.statementTracing
                .importStatement(
                    parentSpan,
                    callback,
                    context
                );
        }

        return callback(
            null,
            context
        );
    }

    /**
     * ========================================================================
     * Normalize
     * ========================================================================
     */

    async normalizeStatement(
        statement,
        context,
        parentSpan
    ) {

        const callback =
            async (
                span,
                traceContext
            ) => {

                const ctx =
                    this.mergeContext(
                        context,
                        traceContext
                    );

                try {

                    const normalized =
                        await this.executeNormalizer(
                            statement,
                            ctx
                        );

                    this.statistics.normalized++;

                    return normalized;

                }
                catch (error) {

                    throw this.toStageError(
                        error,
                        FAILURE_STAGE.NORMALIZE
                    );
                }
            };

        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'normalize'
            )
        ) {

            return this.statementTracing.normalize(
                parentSpan,
                callback,
                context
            );
        }

        return callback(
            null,
            context
        );
    }

    /**
     * ========================================================================
     * Validation Orchestration
     * ========================================================================
     */

    async validateStatement(
        statement,
        context,
        parentSpan
    ) {

        const callback =
            async (
                span,
                traceContext
            ) => {

                const ctx =
                    this.mergeContext(
                        context,
                        traceContext
                    );

                try {

                    const validation =
                        await this.executeValidator(
                            statement,
                            ctx
                        );

                    if (
                        validation === false
                    ) {

                        throw new StatementValidationError(
                            'Statement validator returned false'
                        );
                    }

                    if (
                        validation &&
                        validation.valid === false
                    ) {

                        throw new StatementValidationError(
                            'Statement validation failed',
                            {
                                errors:
                                    validation.errors ||
                                    null
                            }
                        );
                    }

                    this.statistics.validated++;

                    return (
                        validation || {
                            valid:
                                true
                        }
                    );

                }
                catch (error) {

                    throw this.toStageError(
                        error,
                        FAILURE_STAGE.VALIDATE
                    );
                }
            };

        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'validate'
            )
        ) {

            return this.statementTracing.validate(
                parentSpan,
                callback,
                context
            );
        }

        return callback(
            null,
            context
        );
    }

    /**
     * ========================================================================
     * Repository Persistence
     * ========================================================================
     */

    async persistStatement(
        statement,
        validation,
        context,
        parentSpan
    ) {

        const callback =
            async (
                span,
                traceContext
            ) => {

                const ctx =
                    this.mergeContext(
                        context,
                        traceContext
                    );

                const payload = {

                    ...statement,

                    tenantId:
                        ctx.tenantId,

                    statementId:
                        ctx.statementId,

                    batchId:
                        ctx.batchId,

                    operationKey:
                        ctx.operationKey,

                    correlationId:
                        ctx.correlationId,

                    requestId:
                        ctx.requestId,

                    provider:
                        ctx.provider,

                    providerStatementId:
                        ctx.providerStatementId,

                    processingStatus:
                        PROCESSING_STATUS.PERSISTED,

                    processingMetadata: {

                        pipelineId:
                            ctx.pipelineId,

                        statementTraceId:
                            ctx.statementTraceId,

                        validation:
                            this.safeValidationMetadata(
                                validation
                            )
                    }
                };

                try {

                    const result =
                        await this.executePersistence(
                            payload,
                            ctx,
                            span
                        );

                    return result;

                }
                catch (error) {

                    throw new StatementPersistenceError(
                        'Failed to persist processed statement',
                        {
                            statementId:
                                ctx.statementId,

                            batchId:
                                ctx.batchId
                        },
                        error
                    );
                }
            };

        const result =
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'persist'
            )
                ? await this.statementTracing.persist(
                    parentSpan,
                    callback,
                    context
                )
                : await callback(
                    null,
                    context
                );

        return result;
    }

    /**
     * ========================================================================
     * Idempotency
     * ========================================================================
     */

    async checkIdempotency(
        context,
        span
    ) {

        if (
            !this.idempotencyStore
        ) {

            if (
                this.config.requireIdempotency
            ) {

                throw new StatementProcessingError(
                    'Idempotency store is required',
                    {
                        code:
                            'IDEMPOTENCY_INFRASTRUCTURE_UNAVAILABLE',

                        stage:
                            FAILURE_STAGE.IDEMPOTENCY,

                        retryable:
                            true
                    }
                );
            }

            return {
                duplicate:
                    false,

                record:
                    null,

                claim:
                    null
            };
        }

        const key =
            context.idempotencyKey ||
            context.operationKey;

        if (!key) {

            if (
                this.config.requireIdempotency
            ) {

                throw new StatementProcessingError(
                    'Idempotency key or operation key is required',
                    {
                        code:
                            'IDEMPOTENCY_KEY_REQUIRED',

                        stage:
                            FAILURE_STAGE.IDEMPOTENCY,

                        retryable:
                            false
                    }
                );
            }

            return {
                duplicate:
                    false,

                record:
                    null,

                claim:
                    null
            };
        }

        this.safeIdempotencyStarted(
            span,
            context
        );

        /**
         * Preferred atomic claim operation.
         */
        if (
            hasMethod(
                this.idempotencyStore,
                'claim'
            )
        ) {

            const claim =
                await this.idempotencyStore.claim(
                    key,
                    {
                        tenantId:
                            context.tenantId,

                        operationKey:
                            context.operationKey,

                        statementId:
                            context.statementId,

                        provider:
                            context.provider,

                        correlationId:
                            context.correlationId
                    }
                );

            if (
                claim?.duplicate ||
                claim?.alreadyProcessed ||
                claim?.claimed === false
            ) {

                this.safeIdempotencyHit(
                    span,
                    context
                );

                return {

                    duplicate:
                        true,

                    record:
                        claim.record ||
                        claim.existing ||
                        claim.value ||
                        null,

                    claim
                };
            }

            this.safeIdempotencyMiss(
                span,
                context
            );

            return {

                duplicate:
                    false,

                record:
                    null,

                claim
            };
        }

        /**
         * Read/check fallback.
         */
        let existing = null;

        if (
            hasMethod(
                this.idempotencyStore,
                'findOne'
            )
        ) {

            existing =
                await this.idempotencyStore.findOne({
                    key
                });

        }
        else if (
            hasMethod(
                this.idempotencyStore,
                'find'
            )
        ) {

            existing =
                await this.idempotencyStore.find(
                    key
                );

        }
        else if (
            hasMethod(
                this.idempotencyStore,
                'get'
            )
        ) {

            existing =
                await this.idempotencyStore.get(
                    key
                );

        }
        else if (
            hasMethod(
                this.idempotencyStore,
                'exists'
            )
        ) {

            const exists =
                await this.idempotencyStore.exists(
                    key
                );

            existing =
                exists
                    ? { key }
                    : null;
        }

        if (existing) {

            this.safeIdempotencyHit(
                span,
                context
            );

            return {

                duplicate:
                    true,

                record:
                    existing,

                claim:
                    null
            };
        }

        this.safeIdempotencyMiss(
            span,
            context
        );

        /**
         * Warning:
         *
         * A read-before-write implementation is not atomically safe under
         * concurrency. Production installations should provide claim().
         */
        return {

            duplicate:
                false,

            record:
                null,

            claim:
                null
        };
    }

    /**
     * ========================================================================
     * Complete Idempotency
     * ========================================================================
     */

    async completeIdempotency(
        context,
        result
    ) {

        if (
            !this.idempotencyStore
        ) {

            return;
        }

        const key =
            context.idempotencyKey ||
            context.operationKey;

        if (!key) {
            return;
        }

        if (
            hasMethod(
                this.idempotencyStore,
                'complete'
            )
        ) {

            await this.idempotencyStore.complete(
                key,
                {
                    status:
                        PROCESSING_STATUS.COMPLETED,

                    statementId:
                        context.statementId,

                    batchId:
                        context.batchId,

                    resultId:
                        result?._id ||
                        result?.id ||
                        null,

                    completedAt:
                        this.now()
                }
            );

            return;
        }

        if (
            hasMethod(
                this.idempotencyStore,
                'update'
            )
        ) {

            await this.idempotencyStore.update(
                {
                    key
                },
                {
                    status:
                        PROCESSING_STATUS.COMPLETED,

                    completedAt:
                        this.now(),

                    statementId:
                        context.statementId,

                    resultId:
                        result?._id ||
                        result?.id ||
                        null
                }
            );
        }
    }

    /**
     * ========================================================================
     * Fail Idempotency
     * ========================================================================
     */

    async failIdempotency(
        context,
        error
    ) {

        if (
            !this.idempotencyStore
        ) {

            return;
        }

        const key =
            context.idempotencyKey ||
            context.operationKey;

        if (!key) {
            return;
        }

        try {

            if (
                hasMethod(
                    this.idempotencyStore,
                    'fail'
                )
            ) {

                await this.idempotencyStore.fail(
                    key,
                    {
                        status:
                            PROCESSING_STATUS.FAILED,

                        errorCode:
                            error?.code ||
                            null,

                        failedAt:
                            this.now()
                    }
                );

                return;
            }

            /**
             * For claim-based implementations, release the claim on a
             * retryable failure. Permanent failures may instead remain
             * recorded depending on the infrastructure's policy.
             */
            if (
                error?.retryable &&
                hasMethod(
                    this.idempotencyStore,
                    'release'
                )
            ) {

                await this.idempotencyStore.release(
                    key
                );
            }

        }
        catch (idempotencyError) {

            this.safeLog(
                'warn',
                '[StatementProcessingService] Failed to finalize idempotency state',
                {
                    key:
                        this.redactIdentifier(
                            key
                        ),

                    error:
                        normalizeError(
                            idempotencyError
                        )
                }
            );
        }
    }

    /**
     * ========================================================================
     * Batch Start
     * ========================================================================
     */

    async coordinateBatchStart(
        context,
        span
    ) {

        if (
            !this.batchManager
        ) {

            if (
                this.config.requireBatch
            ) {

                throw new StatementProcessingError(
                    'Batch manager is required',
                    {
                        code:
                            'BATCH_INFRASTRUCTURE_UNAVAILABLE',

                        stage:
                            FAILURE_STAGE.BATCH,

                        retryable:
                            true
                    }
                );
            }

            return null;
        }

        const callback =
            async (
                batchContext
            ) => {

                if (
                    hasMethod(
                        this.batchManager,
                        'start'
                    )
                ) {

                    return this.batchManager.start(
                        batchContext
                    );
                }

                if (
                    hasMethod(
                        this.batchManager,
                        'createBatch'
                    )
                ) {

                    return this.batchManager.createBatch(
                        batchContext
                    );
                }

                if (
                    hasMethod(
                        this.batchManager,
                        'create'
                    )
                ) {

                    return this.batchManager.create(
                        batchContext
                    );
                }

                throw new StatementProcessingError(
                    'Batch manager does not implement start(), createBatch(), or create()',
                    {
                        code:
                            'INVALID_BATCH_MANAGER',

                        stage:
                            FAILURE_STAGE.BATCH
                    }
                );
            };

        try {

            const result =
                await this.executeBatchTrace(
                    span,
                    callback,
                    context
                );

            this.statistics.batches++;

            return result;

        }
        catch (error) {

            throw this.toStageError(
                error,
                FAILURE_STAGE.BATCH
            );
        }
    }

    /**
     * ========================================================================
     * Batch Completion
     * ========================================================================
     */

    async coordinateBatchCompletion(
        context,
        result,
        span
    ) {

        if (
            !this.batchManager ||
            !context.batchId
        ) {

            return result;
        }

        const metadata = {

            ...context,

            result
        };

        try {

            if (
                hasMethod(
                    this.batchManager,
                    'complete'
                )
            ) {

                const completed =
                    await this.batchManager.complete(
                        context.batchId,
                        metadata
                    );

                return completed || result;
            }

            if (
                hasMethod(
                    this.batchManager,
                    'completeBatch'
                )
            ) {

                const completed =
                    await this.batchManager.completeBatch(
                        context.batchId,
                        metadata
                    );

                return completed || result;
            }

            return result;

        }
        catch (error) {

            throw this.toStageError(
                error,
                FAILURE_STAGE.BATCH
            );
        }
    }

    /**
     * ========================================================================
     * Batch Trace
     * ========================================================================
     */

    async executeBatchTrace(
        parentSpan,
        callback,
        context
    ) {

        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'batch'
            )
        ) {

            return this.statementTracing.batch(
                parentSpan,
                async (
                    batchSpan,
                    batchContext
                ) => {

                    return callback(
                        batchContext
                    );
                },
                context
            );
        }

        return callback(
            context
        );
    }

    /**
     * ========================================================================
     * Importer Adapter
     * ========================================================================
     */

    async executeImporter(
        input,
        context
    ) {

        if (!this.importer) {

            throw new StatementProcessingError(
                'Statement importer is not configured',
                {
                    code:
                        'IMPORTER_UNAVAILABLE',

                    stage:
                        FAILURE_STAGE.IMPORT
                }
            );
        }

        /**
         * importStatement(input, context)
         */
        if (
            hasMethod(
                this.importer,
                'importStatement'
            )
        ) {

            return this.importer.importStatement(
                input,
                context
            );
        }

        /**
         * import(input, context)
         */
        if (
            hasMethod(
                this.importer,
                'import'
            )
        ) {

            return this.importer.import(
                input,
                context
            );
        }

        /**
         * function(input, context)
         */
        if (
            isFunction(
                this.importer
            )
        ) {

            return this.importer(
                input,
                context
            );
        }

        throw new StatementProcessingError(
            'Statement importer does not expose importStatement() or import()',
            {
                code:
                    'INVALID_IMPORTER',

                stage:
                    FAILURE_STAGE.IMPORT
            }
        );
    }

    /**
     * ========================================================================
     * Normalizer Adapter
     * ========================================================================
     */

    async executeNormalizer(
        statement,
        context
    ) {

        if (!this.normalizer) {

            /**
             * A normalizer may legitimately be optional where the importer
             * already produces canonical data.
             */
            return statement;
        }

        if (
            hasMethod(
                this.normalizer,
                'normalize'
            )
        ) {

            return this.normalizer.normalize(
                statement,
                context
            );
        }

        if (
            isFunction(
                this.normalizer
            )
        ) {

            return this.normalizer(
                statement,
                context
            );
        }

        throw new StatementProcessingError(
            'Statement normalizer does not expose normalize()',
            {
                code:
                    'INVALID_NORMALIZER',

                stage:
                    FAILURE_STAGE.NORMALIZE
            }
        );
    }

    /**
     * ========================================================================
     * Validator Adapter
     * ========================================================================
     */

    async executeValidator(
        statement,
        context
    ) {

        if (!this.validator) {

            throw new StatementProcessingError(
                'Statement validator is not configured',
                {
                    code:
                        'VALIDATOR_UNAVAILABLE',

                    stage:
                        FAILURE_STAGE.VALIDATE
                }
            );
        }

        if (
            hasMethod(
                this.validator,
                'validate'
            )
        ) {

            return this.validator.validate(
                statement,
                context
            );
        }

        if (
            isFunction(
                this.validator
            )
        ) {

            return this.validator(
                statement,
                context
            );
        }

        throw new StatementProcessingError(
            'Statement validator does not expose validate()',
            {
                code:
                    'INVALID_VALIDATOR',

                stage:
                    FAILURE_STAGE.VALIDATE
            }
        );
    }

    /**
     * ========================================================================
     * Repository Adapter
     * ========================================================================
     */

    async executePersistence(
        statement,
        context,
        span
    ) {

        if (!this.repository) {

            throw new StatementPersistenceError(
                'Statement repository is not configured'
            );
        }

        const operation =
            context.persistenceOperation ||
            'create';

        const repositoryCallback =
            async () => {

                if (
                    hasMethod(
                        this.repository,
                        'create'
                    )
                ) {

                    return this.repository.create(
                        statement,
                        context
                    );
                }

                if (
                    hasMethod(
                        this.repository,
                        'save'
                    )
                ) {

                    return this.repository.save(
                        statement,
                        context
                    );
                }

                if (
                    hasMethod(
                        this.repository,
                        'insert'
                    )
                ) {

                    return this.repository.insert(
                        statement,
                        context
                    );
                }

                throw new StatementPersistenceError(
                    'Statement repository does not expose create(), save(), or insert()'
                );
            };

        if (
            this.statementTracing &&
            hasMethod(
                this.statementTracing,
                'repository'
            )
        ) {

            return this.statementTracing.repository(
                span,
                operation,
                async () =>
                    repositoryCallback(),
                context
            );
        }

        return repositoryCallback();
    }

    /**
     * ========================================================================
     * Retry Orchestration
     * ========================================================================
     */

    async executeWithRetry(
        stage,
        operation,
        context,
        span
    ) {

        if (
            !this.config.enableRetry
        ) {

            return operation();
        }

        let attempt = 0;

        let lastError = null;

        while (
            attempt <
            this.config.maxAttempts
        ) {

            attempt++;

            try {

                if (
                    attempt > 1
                ) {

                    this.statistics.retries++;

                    this.safeRetryAttempt(
                        span,
                        {
                            attempt,

                            context
                        }
                    );
                }

                return await operation();

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
                    attempt >=
                    this.config.maxAttempts
                ) {

                    if (
                        attempt >=
                        this.config.maxAttempts
                    ) {

                        this.safeRetryExhausted(
                            span,
                            {
                                attempts:
                                    attempt,

                                error,

                                context
                            }
                        );
                    }

                    throw error;
                }

                const delayMs =
                    this.calculateRetryDelay(
                        attempt
                    );

                this.safeRetryScheduled(
                    span,
                    {
                        attempt,

                        delayMs,

                        error,

                        maxAttempts:
                            this.config.maxAttempts,

                        context: {
                            stage
                        }
                    }
                );

                await sleep(
                    delayMs
                );
            }
        }

        throw lastError;
    }

    /**
     * ========================================================================
     * Retry Classification
     * ========================================================================
     */

    isRetryableError(
        error
    ) {

        if (!error) {
            return false;
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

                'NETWORK_ERROR',

                'RATE_LIMITED',

                'TOO_MANY_REQUESTS',

                'SERVICE_UNAVAILABLE',

                'TEMPORARY_FAILURE',

                'DATABASE_TIMEOUT',

                'WRITE_CONFLICT'
            ]);

        return retryableCodes.has(
            code
        );
    }

    /**
     * ========================================================================
     * Retry Delay
     * ========================================================================
     */

    calculateRetryDelay(
        attempt
    ) {

        let delay =
            this.config.retryDelayMs;

        if (
            this.config.exponentialBackoff
        ) {

            delay =
                this.config.retryDelayMs *
                Math.pow(
                    2,
                    Math.max(
                        0,
                        attempt - 1
                    )
                );
        }

        delay =
            Math.min(
                delay,
                this.config.maxRetryDelayMs
            );

        /**
         * Small jitter reduces synchronized retry storms.
         */
        const jitter =
            Math.floor(
                Math.random() *
                Math.max(
                    1,
                    Math.floor(
                        delay * 0.2
                    )
                )
            );

        return Math.min(
            this.config.maxRetryDelayMs,
            delay + jitter
        );
    }

    /**
     * ========================================================================
     * Input Validation
     * ========================================================================
     */

    validateInput(
        input
    ) {

        if (
            input === null ||
            input === undefined
        ) {

            throw new StatementProcessingError(
                'Statement input is required',
                {
                    code:
                        'STATEMENT_INPUT_REQUIRED'
                }
            );
        }

        if (
            !this.config.allowEmptyStatements &&
            Array.isArray(
                input.transactions
            ) &&
            input.transactions.length === 0
        ) {

            throw new StatementProcessingError(
                'Statement contains no transactions',
                {
                    code:
                        'STATEMENT_EMPTY'
                }
            );
        }
    }

    /**
     * ========================================================================
     * Execution Context
     * ========================================================================
     */

    createExecutionContext(
        input,
        context
    ) {

        this.validateInput(
            input
        );

        const tenantId =
            context.tenantId ||
            null;

        if (
            this.config.requireTenantId &&
            !tenantId
        ) {

            throw new StatementProcessingError(
                'tenantId is required',
                {
                    code:
                        'TENANT_ID_REQUIRED'
                }
            );
        }

        if (
            this.config.requireProvider &&
            !context.provider
        ) {

            throw new StatementProcessingError(
                'provider is required',
                {
                    code:
                        'PROVIDER_REQUIRED'
                }
            );
        }

        const correlationId =
            context.correlationId ||
            (
                this.config.generateCorrelationId
                    ? generateId()
                    : null
            );

        const operationId =
            context.operationId ||
            (
                this.config.generateOperationId
                    ? generateId()
                    : null
            );

        const statementId =
            context.statementId ||
            context.reference ||
            input.statementId ||
            input.reference ||
            null;

        const providerReference =
            context.providerReference ||
            input.providerReference ||
            input.externalReference ||
            input.reference ||
            null;

        const operationKey =
            context.operationKey ||
            this.buildOperationKey(
                {
                    tenantId,

                    provider:
                        context.provider ||
                        null,

                    statementId,

                    providerReference,

                    input
                }
            );

        const idempotencyKey =
            context.idempotencyKey ||
            (
                this.config.generateIdempotencyKey
                    ? operationKey
                    : null
            );

        const inputFingerprint =
            context.inputFingerprint ||
            (
                this.config.includeInputFingerprint
                    ? this.buildInputFingerprint(
                        input
                    )
                    : null
            );

        return {

            ...context,

            tenantId,

            statementId,

            provider:
                context.provider ||
                null,

            providerStatementId:
                context.providerStatementId ||
                input.providerStatementId ||
                null,

            providerBatchId:
                context.providerBatchId ||
                input.providerBatchId ||
                null,

            providerReference,

            correlationId,

            requestId:
                context.requestId ||
                null,

            operationId,

            operationKey,

            idempotencyKey,

            inputFingerprint,

            pipelineId:
                context.pipelineId ||
                generateId(),

            statementTraceId:
                context.statementTraceId ||
                generateId(),

            processingStatus:
                PROCESSING_STATUS.RECEIVED,

            startedAt:
                this.now()
        };
    }

    /**
     * ========================================================================
     * Deterministic Operation Key
     * ========================================================================
     */

    buildOperationKey(
        {
            tenantId,
            provider,
            statementId,
            providerReference,
            input
        }
    ) {

        const components = [

            tenantId ||
                'unknown-tenant',

            provider ||
                'unknown-provider',

            statementId ||
                providerReference ||
                'unknown-statement',

            this.extractStableInputIdentifier(
                input
            )
        ];

        return components
            .map(
                value =>
                    safeString(
                        value,
                        512
                    )
            )
            .join(':');
    }

    /**
     * ========================================================================
     * Input Identifier
     * ========================================================================
     */

    extractStableInputIdentifier(
        input
    ) {

        if (!input) {
            return 'none';
        }

        return (
            input.id ||
            input.statementId ||
            input.reference ||
            input.externalReference ||
            input.providerReference ||
            'statement'
        );
    }

    /**
     * ========================================================================
     * Input Fingerprint
     * ========================================================================
     */

    buildInputFingerprint(
        input
    ) {

        try {

            const serialized =
                JSON.stringify(
                    this.buildFingerprintPayload(
                        input
                    )
                );

            return crypto
                .createHash('sha256')
                .update(
                    Buffer.from(
                        serialized
                    ).subarray(
                        0,
                        this.config.maxInputFingerprintBytes
                    )
                )
                .digest('hex');

        }
        catch (error) {

            this.safeLog(
                'warn',
                '[StatementProcessingService] Failed to generate input fingerprint',
                {
                    error:
                        normalizeError(
                            error
                        )
                }
            );

            return null;
        }
    }

    /**
     * ========================================================================
     * Fingerprint Payload
     * ========================================================================
     *
     * Deliberately excludes sensitive/raw fields.
     * ========================================================================
     */

    buildFingerprintPayload(
        input
    ) {

        if (
            !input ||
            typeof input !== 'object'
        ) {

            return input;
        }

        const output = {};

        const allowedKeys = [

            'id',

            'statementId',

            'reference',

            'externalReference',

            'providerReference',

            'providerStatementId',

            'providerBatchId',

            'source',

            'currency',

            'period',

            'statementDate',

            'transactions'
        ];

        for (
            const key
            of allowedKeys
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    input,
                    key
                )
            ) {

                output[key] =
                    this.sanitizeFingerprintValue(
                        input[key]
                    );
            }
        }

        return output;
    }

    sanitizeFingerprintValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;
        }

        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {

            return value;
        }

        if (Array.isArray(value)) {

            return value.map(
                item =>
                    this.sanitizeFingerprintValue(
                        item
                    )
            );
        }

        if (
            typeof value === 'object'
        ) {

            const output = {};

            for (
                const [key, nestedValue]
                of Object.entries(
                    value
                )
            ) {

                const normalizedKey =
                    key.toLowerCase();

                if (
                    normalizedKey.includes(
                        'password'
                    ) ||
                    normalizedKey.includes(
                        'token'
                    ) ||
                    normalizedKey.includes(
                        'secret'
                    ) ||
                    normalizedKey.includes(
                        'pin'
                    ) ||
                    normalizedKey.includes(
                        'otp'
                    ) ||
                    normalizedKey.includes(
                        'cvv'
                    ) ||
                    normalizedKey.includes(
                        'card'
                    ) ||
                    normalizedKey.includes(
                        'phone'
                    ) ||
                    normalizedKey.includes(
                        'email'
                    ) ||
                    normalizedKey.includes(
                        'nationalid'
                    )
                ) {

                    continue;
                }

                output[key] =
                    this.sanitizeFingerprintValue(
                        nestedValue
                    );
            }

            return output;
        }

        return safeString(
            value
        );
    }

    /**
     * ========================================================================
     * Success Result
     * ========================================================================
     */

    buildSuccessResult(
        {
            context,
            imported,
            normalized,
            validation,
            persisted,
            batch
        }
    ) {

        return {

            success:
                true,

            status:
                PROCESSING_STATUS.COMPLETED,

            tenantId:
                context.tenantId,

            statementId:
                context.statementId,

            batchId:
                context.batchId,

            provider:
                context.provider,

            providerStatementId:
                context.providerStatementId,

            providerReference:
                context.providerReference,

            correlationId:
                context.correlationId,

            requestId:
                context.requestId,

            operationId:
                context.operationId,

            operationKey:
                context.operationKey,

            idempotencyKey:
                context.idempotencyKey,

            inputFingerprint:
                context.inputFingerprint,

            pipelineId:
                context.pipelineId,

            statementTraceId:
                context.statementTraceId,

            imported,

            normalized,

            validation,

            persisted,

            batch,

            completedAt:
                this.now()
        };
    }

    /**
     * ========================================================================
     * Duplicate Result
     * ========================================================================
     */

    buildDuplicateResult(
        context,
        existing
    ) {

        return {

            success:
                true,

            duplicate:
                true,

            status:
                PROCESSING_STATUS.DUPLICATE,

            tenantId:
                context.tenantId,

            statementId:
                context.statementId,

            batchId:
                context.batchId,

            provider:
                context.provider,

            correlationId:
                context.correlationId,

            operationKey:
                context.operationKey,

            idempotencyKey:
                context.idempotencyKey,

            existing,

            completedAt:
                this.now()
        };
    }

    /**
     * ========================================================================
     * Validation Metadata
     * ========================================================================
     */

    safeValidationMetadata(
        validation
    ) {

        if (
            validation === null ||
            validation === undefined
        ) {

            return null;
        }

        if (
            typeof validation !== 'object'
        ) {

            return validation;
        }

        return {

            valid:
                validation.valid !== false,

            errorCount:
                Array.isArray(
                    validation.errors
                )
                    ? validation.errors.length
                    : 0,

            warningCount:
                Array.isArray(
                    validation.warnings
                )
                    ? validation.warnings.length
                    : 0
        };
    }

    /**
     * ========================================================================
     * Lifecycle Metadata
     * ========================================================================
     */

    lifecycleMetadata(
        context
    ) {

        return {

            tenantId:
                context.tenantId ||
                null,

            statementId:
                context.statementId ||
                null,

            batchId:
                context.batchId ||
                null,

            provider:
                context.provider ||
                null,

            providerStatementId:
                context.providerStatementId ||
                null,

            correlationId:
                context.correlationId ||
                null,

            operationKey:
                context.operationKey ||
                null,

            stage:
                context.processingStatus ||
                context.stage ||
                null
        };
    }

    /**
     * ========================================================================
     * Event Publication
     * ========================================================================
     */

    async publishLifecycleEvent(
        eventName,
        payload,
        context,
        {
            allowFailure = false
        } = {}
    ) {

        if (
            !this.config.publishEvents ||
            !this.eventPublisher
        ) {

            return null;
        }

        const event = {

            eventId:
                generateId(),

            eventName,

            occurredAt:
                this.now(),

            tenantId:
                context.tenantId ||
                null,

            statementId:
                context.statementId ||
                null,

            batchId:
                context.batchId ||
                null,

            provider:
                context.provider ||
                null,

            correlationId:
                context.correlationId ||
                null,

            requestId:
                context.requestId ||
                null,

            operationId:
                context.operationId ||
                null,

            operationKey:
                context.operationKey ||
                null,

            inputFingerprint:
                context.inputFingerprint ||
                null,

            pipelineId:
                context.pipelineId ||
                null,

            statementTraceId:
                context.statementTraceId ||
                null,

            payload:
                this.sanitizeEventPayload(
                    payload
                )
        };

        try {

            if (
                hasMethod(
                    this.eventPublisher,
                    'publish'
                )
            ) {

                return await this.eventPublisher.publish(
                    eventName,
                    event
                );
            }

            if (
                hasMethod(
                    this.eventPublisher,
                    'emit'
                )
            ) {

                return await this.eventPublisher.emit(
                    eventName,
                    event
                );
            }

            if (
                isFunction(
                    this.eventPublisher
                )
            ) {

                return await this.eventPublisher(
                    eventName,
                    event
                );
            }

            throw new StatementProcessingError(
                'Event publisher does not expose publish() or emit()',
                {
                    code:
                        'INVALID_EVENT_PUBLISHER',

                    stage:
                        FAILURE_STAGE.EVENT
                }
            );

        }
        catch (error) {

            this.statistics.eventFailures++;

            this.safeLog(
                'error',
                '[StatementProcessingService] Statement event publication failed',
                {
                    eventName,

                    error:
                        normalizeError(
                            error
                        )
                }
            );

            this.incrementMetric(
                'statement_event_publish_failures_total',
                {
                    event:
                        eventName
                }
            );

            if (
                allowFailure ||
                !this.config.failOnEventPublishError
            ) {

                return null;
            }

            throw new StatementProcessingError(
                'Statement event publication failed',
                {
                    code:
                        'EVENT_PUBLICATION_FAILED',

                    stage:
                        FAILURE_STAGE.EVENT,

                    retryable:
                        true,

                    details: {
                        eventName
                    },

                    cause:
                        error
                }
            );
        }
    }

    /**
     * ========================================================================
     * Event Payload Sanitization
     * ========================================================================
     */

    sanitizeEventPayload(
        payload
    ) {

        if (
            payload === null ||
            payload === undefined
        ) {

            return null;
        }

        if (
            typeof payload !== 'object'
        ) {

            return safeString(
                payload
            );
        }

        const output = {};

        const denied =
            new Set([

                'rawStatement',

                'statementContent',

                'rawPayload',

                'payload',

                'requestBody',

                'responseBody',

                'password',

                'token',

                'secret',

                'pin',

                'otp',

                'cardNumber',

                'cvv',

                'securityCode'
            ]);

        for (
            const [key, value]
            of Object.entries(
                payload
            )
        ) {

            if (
                denied.has(key)
            ) {

                continue;
            }

            if (
                key === 'statement' ||
                key === 'normalized'
            ) {

                output[key] =
                    this.summarizeStatement(
                        value
                    );

                continue;
            }

            output[key] =
                this.sanitizeEventValue(
                    value
                );
        }

        return output;
    }

    sanitizeEventValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;
        }

        if (
            typeof value === 'string'
        ) {

            return safeString(
                value
            );
        }

        if (
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {

            return value;
        }

        if (Array.isArray(value)) {

            return value
                .slice(0, 25)
                .map(
                    item =>
                        this.sanitizeEventValue(
                            item
                        )
                );
        }

        if (
            typeof value === 'object'
        ) {

            const output = {};

            for (
                const [key, nestedValue]
                of Object.entries(
                    value
                )
            ) {

                if (
                    key.toLowerCase().includes(
                        'password'
                    ) ||
                    key.toLowerCase().includes(
                        'token'
                    ) ||
                    key.toLowerCase().includes(
                        'secret'
                    ) ||
                    key.toLowerCase().includes(
                        'pin'
                    ) ||
                    key.toLowerCase().includes(
                        'otp'
                    ) ||
                    key.toLowerCase().includes(
                        'cvv'
                    )
                ) {

                    continue;
                }

                output[key] =
                    this.sanitizeEventValue(
                        nestedValue
                    );
            }

            return output;
        }

        return safeString(
            value
        );
    }

    /**
     * ========================================================================
     * Statement Summary
     * ========================================================================
     */

    summarizeStatement(
        statement
    ) {

        if (
            !statement ||
            typeof statement !== 'object'
        ) {

            return null;
        }

        const transactions =
            Array.isArray(
                statement.transactions
            )
                ? statement.transactions
                : [];

        return {

            id:
                statement.id ||
                statement._id ||
                null,

            statementId:
                statement.statementId ||
                null,

            reference:
                statement.reference ||
                null,

            provider:
                statement.provider ||
                null,

            currency:
                statement.currency ||
                null,

            transactionCount:
                transactions.length
        };
    }

    /**
     * ========================================================================
     * Audit
     * ========================================================================
     */

    async recordAudit(
        action,
        payload,
        context
    ) {

        if (
            !this.auditService
        ) {

            return;
        }

        const auditPayload = {

            action,

            tenantId:
                context.tenantId ||
                null,

            statementId:
                context.statementId ||
                null,

            batchId:
                context.batchId ||
                null,

            provider:
                context.provider ||
                null,

            correlationId:
                context.correlationId ||
                null,

            operationKey:
                context.operationKey ||
                null,

            occurredAt:
                this.now(),

            metadata:
                this.sanitizeEventPayload(
                    payload
                )
        };

        try {

            if (
                hasMethod(
                    this.auditService,
                    'record'
                )
            ) {

                await this.auditService.record(
                    auditPayload
                );

                return;
            }

            if (
                hasMethod(
                    this.auditService,
                    'log'
                )
            ) {

                await this.auditService.log(
                    auditPayload
                );
            }

        }
        catch (error) {

            this.safeLog(
                'warn',
                '[StatementProcessingService] Audit recording failed',
                {
                    action,

                    error:
                        normalizeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * ========================================================================
     * Tracing Helpers
     * ========================================================================
     */

    safeTraceEvent(
        span,
        eventName,
        metadata = {}
    ) {

        if (
            !span ||
            !this.statementTracing
        ) {

            return;
        }

        try {

            if (
                hasMethod(
                    this.statementTracing,
                    'emitEvent'
                )
            ) {

                this.statementTracing.emitEvent(
                    span,
                    eventName,
                    metadata
                );

                return;
            }

            if (
                hasMethod(
                    this.statementTracing,
                    'addEvent'
                )
            ) {

                this.statementTracing.addEvent(
                    span,
                    eventName,
                    metadata
                );
            }

        }
        catch (error) {

            this.safeLog(
                'debug',
                '[StatementProcessingService] Trace event failed',
                {
                    eventName,

                    error:
                        normalizeError(
                            error
                        )
                }
            );
        }
    }

    safeIdempotencyStarted(
        span,
        context
    ) {

        try {

            this.statementTracing
                ?.idempotencyCheckStarted?.(
                    span,
                    context
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'idempotency.started'
            );
        }
    }

    safeIdempotencyHit(
        span,
        context
    ) {

        try {

            this.statementTracing
                ?.idempotencyHit?.(
                    span,
                    context
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'idempotency.hit'
            );
        }
    }

    safeIdempotencyMiss(
        span,
        context
    ) {

        try {

            this.statementTracing
                ?.idempotencyMiss?.(
                    span,
                    context
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'idempotency.miss'
            );
        }
    }

    safeRetryScheduled(
        span,
        metadata
    ) {

        try {

            this.statementTracing
                ?.retryScheduled?.(
                    span,
                    metadata
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'retry.scheduled'
            );
        }
    }

    safeRetryAttempt(
        span,
        metadata
    ) {

        try {

            this.statementTracing
                ?.retryAttempt?.(
                    span,
                    metadata
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'retry.attempt'
            );
        }
    }

    safeRetryExhausted(
        span,
        metadata
    ) {

        try {

            this.statementTracing
                ?.retryExhausted?.(
                    span,
                    metadata
                );

        }
        catch (error) {

            this.safeTraceFailure(
                error,
                'retry.exhausted'
            );
        }
    }

    safeTraceFailure(
        error,
        operation
    ) {

        this.statistics.tracingFailures++;

        this.safeLog(
            'debug',
            '[StatementProcessingService] Trace operation failed',
            {
                operation,

                error:
                    normalizeError(
                        error
                    )
            }
        );
    }

    /**
     * ========================================================================
     * Stage Error Conversion
     * ========================================================================
     */

    toStageError(
        error,
        stage
    ) {

        if (
            error instanceof
            StatementProcessingError
        ) {

            if (!error.stage) {
                error.stage = stage;
            }

            return error;
        }

        return new StatementProcessingError(
            error?.message ||
            `Statement ${stage} failed`,
            {
                code:
                    error?.code ||
                    `STATEMENT_${stage.toUpperCase()}_FAILED`,

                stage,

                retryable:
                    Boolean(
                        error?.retryable
                    ),

                cause:
                    error
            }
        );
    }

    /**
     * ========================================================================
     * Identifier Redaction
     * ========================================================================
     */

    redactIdentifier(
        value
    ) {

        if (!value) {
            return null;
        }

        const stringValue =
            String(value);

        if (
            stringValue.length <= 8
        ) {

            return '***';
        }

        return (
            `${stringValue.slice(0, 4)}...` +
            `${stringValue.slice(-4)}`
        );
    }

    /**
     * ========================================================================
     * Time
     * ========================================================================
     */

    now() {

        if (
            this.clock &&
            isFunction(
                this.clock.now
            )
        ) {

            return this.clock.now();
        }

        return Date.now();
    }

    /**
     * ========================================================================
     * Dependency Validation
     * ========================================================================
     */

    validateDependencies() {

        const required = {

            importer:
                this.importer,

            validator:
                this.validator,

            repository:
                this.repository
        };

        if (
            !this.config.strictDependencies
        ) {

            return;
        }

        for (
            const [
                name,
                dependency
            ]
            of Object.entries(
                required
            )
        ) {

            if (!dependency) {

                throw new TypeError(
                    `StatementProcessingService requires ${name}`
                );
            }
        }
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    incrementMetric(
        metric,
        labels = {}
    ) {

        try {

            this.metrics
                ?.increment?.(
                    metric,
                    labels
                );

        }
        catch (_) {

            // Metrics must never affect statement processing.
        }
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    safeLog(
        level,
        message,
        metadata = {}
    ) {

        try {

            const method =
                this.logger?.[level];

            if (
                isFunction(method)
            ) {

                method.call(
                    this.logger,
                    message,
                    metadata
                );
            }

        }
        catch (_) {

            // Logging must never affect financial processing.
        }
    }

    /**
     * ========================================================================
     * Factory
     * ========================================================================
     */

    static create(
        options = {}
    ) {

        return new StatementProcessingService(
            options
        );
    }
}

/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

StatementProcessingService.Status =
    PROCESSING_STATUS;

StatementProcessingService.Stage =
    FAILURE_STAGE;

StatementProcessingService.Events =
    EVENT_NAMES;

StatementProcessingService.Errors = {

    StatementProcessingError,

    StatementDuplicateError,

    StatementValidationError,

    StatementPersistenceError
};

/**
 * ============================================================================
 * Module Export
 * ============================================================================
 */

module.exports =
    StatementProcessingService;