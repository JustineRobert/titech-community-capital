'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementPipeline.js
 * ============================================================================
 *
 * Enterprise Statement Processing Pipeline Orchestrator
 *
 * Responsibilities:
 *
 * - Orchestrate the complete statement ingestion lifecycle.
 * - Maintain strict execution ordering.
 * - Preserve immutable StatementContext semantics.
 * - Create and manage processing batches.
 * - Import raw provider payloads.
 * - Normalize imported statements.
 * - Execute statement validation.
 * - Persist validated statements.
 * - Track batch progress.
 * - Provide structured lifecycle events.
 * - Preserve tenant isolation.
 * - Provide execution metrics and audit metadata.
 * - Provide deterministic failure handling.
 * - Support synchronous and asynchronous dependencies.
 * - Support distributed execution metadata.
 * - Remain provider agnostic.
 * - Remain free of persistence implementation details.
 *
 * Pipeline:
 *
 * StatementContext
 *        |
 *        v
 * StatementBatchManager
 *        |
 *        v
 * StatementImporter
 *        |
 *        v
 * StatementNormalizer
 *        |
 *        v
 * StatementValidator
 *        |
 *        v
 * StatementRepository
 *        |
 *        v
 * Reconciliation / Repair / Reporting
 *
 * Lifecycle:
 *
 * CREATED
 *    |
 *    v
 * PROCESSING
 *    |
 *    +----------------------+
 *    |                      |
 *    v                      v
 * COMPLETED               FAILED
 *
 * Design Principles:
 *
 * - Explicit orchestration.
 * - No provider-specific business logic.
 * - No direct database access.
 * - Tenant isolation enforced.
 * - Immutable execution context.
 * - Idempotency aware.
 * - Audit ready.
 * - Observable.
 * - Retry aware.
 * - Distributed-processing ready.
 * - Backward compatible with existing collaborators.
 *
 * ============================================================================
 */

const {
    StatementProcessingError,
    StatementImportError,
    StatementValidationError,
    StatementPersistenceError
} = require('./StatementErrors');

const StatementContext = require('./StatementContext');

const {
    BATCH_STATUS
} = require('./StatementBatchManager');

/**
 * ============================================================================
 * Pipeline Status
 * ============================================================================
 */

const PIPELINE_STATUS = Object.freeze({

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
 * Pipeline Stages
 * ============================================================================
 */

const PIPELINE_STAGE = Object.freeze({

    CONTEXT:
        'CONTEXT',

    BATCH:
        'BATCH',

    IMPORT:
        'IMPORT',

    NORMALIZATION:
        'NORMALIZATION',

    VALIDATION:
        'VALIDATION',

    PERSISTENCE:
        'PERSISTENCE',

    COMPLETION:
        'COMPLETION'

});

/**
 * ============================================================================
 * StatementPipeline
 * ============================================================================
 */

class StatementPipeline {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * Existing supported dependency contract:
     *
     * {
     *     importer,
     *     normalizer,
     *     validator,
     *     repository,
     *     batchManager
     * }
     *
     * Optional:
     *
     * {
     *     events,
     *     logger,
     *     clock,
     *     metrics
     * }
     *
     * @param {Object} dependencies
     */

    constructor({

        importer,

        normalizer,

        validator,

        repository,

        batchManager,

        events = null,

        logger = null,

        clock = null,

        metrics = null

    } = {}) {

        this.importer =
            importer;

        this.normalizer =
            normalizer;

        this.validator =
            validator;

        this.repository =
            repository;

        this.batchManager =
            batchManager;

        this.events =
            events;

        this.logger =
            logger;

        this.clock =
            clock || {

                now: () =>
                    new Date()

            };

        this.metrics =
            metrics;

        this.validateDependencies();

        Object.freeze(this);
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     *
     * Complete statement processing workflow.
     *
     * @param {Object} input
     * @param {StatementContext|Object} context
     *
     * @returns {Promise<Object>}
     */

    async process(input, context) {

        let execution = null;

        let batch = null;

        let activeStage =
            PIPELINE_STAGE.CONTEXT;

        let processingContext = null;

        const startedAt =
            this.now();

        try {

            processingContext =
                this.resolveContext(context);

            this.assertTenantBoundary(
                input,
                processingContext
            );

            execution =
                this.createExecutionMetadata(
                    processingContext
                );

            this.emit(
                'STATEMENT_PIPELINE_STARTED',
                {
                    execution,
                    context:
                        this.serializeContext(
                            processingContext
                        )
                }
            );

            /**
             * ================================================================
             * Batch Creation
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.BATCH;

            batch =
                this.batchManager.createBatch(
                    processingContext
                );

            processingContext =
                this.attachBatchContext(
                    processingContext,
                    batch
                );

            batch =
                this.batchManager.start(
                    batch
                );

            this.emit(
                'STATEMENT_BATCH_STARTED',
                {
                    batch,
                    execution,
                    context:
                        this.serializeContext(
                            processingContext
                        )
                }
            );

            /**
             * ================================================================
             * Import
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.IMPORT;

            this.emitStageStarted(
                activeStage,
                execution,
                processingContext,
                batch
            );

            const imported =
                await this.importStatement(
                    input,
                    processingContext
                );

            this.emitStageCompleted(
                activeStage,
                execution,
                processingContext,
                batch,
                imported
            );

            /**
             * ================================================================
             * Normalization
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.NORMALIZATION;

            this.emitStageStarted(
                activeStage,
                execution,
                processingContext,
                batch,
                imported
            );

            const normalized =
                await this.normalizeStatement(
                    imported,
                    processingContext
                );

            this.emitStageCompleted(
                activeStage,
                execution,
                processingContext,
                batch,
                normalized
            );

            /**
             * ================================================================
             * Validation
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.VALIDATION;

            this.emitStageStarted(
                activeStage,
                execution,
                processingContext,
                batch,
                normalized
            );

            const validation =
                await this.validateStatement(
                    normalized,
                    processingContext
                );

            this.assertValidationPassed(
                validation
            );

            this.emitStageCompleted(
                activeStage,
                execution,
                processingContext,
                batch,
                validation
            );

            /**
             * ================================================================
             * Persistence
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.PERSISTENCE;

            this.emitStageStarted(
                activeStage,
                execution,
                processingContext,
                batch,
                normalized
            );

            const persisted =
                await this.persistStatement(
                    normalized,
                    processingContext,
                    batch,
                    validation
                );

            /**
             * ================================================================
             * Progress
             * ================================================================
             */

            batch =
                this.batchManager.updateProgress(

                    batch,

                    {

                        total:
                            this.resolveStatementCount(
                                normalized
                            ),

                        processed:
                            1,

                        failed:
                            0

                    }

                );

            this.emitStageCompleted(
                activeStage,
                execution,
                processingContext,
                batch,
                persisted
            );

            /**
             * ================================================================
             * Completion
             * ================================================================
             */

            activeStage =
                PIPELINE_STAGE.COMPLETION;

            batch =
                this.batchManager.complete(
                    batch
                );

            const completedAt =
                this.now();

            const durationMs =
                Math.max(
                    0,
                    completedAt.getTime() -
                    startedAt.getTime()
                );

            const result = {

                status:
                    PIPELINE_STATUS.COMPLETED,

                stage:
                    PIPELINE_STAGE.COMPLETION,

                executionId:
                    execution.executionId,

                batchId:
                    batch.batchId,

                tenantId:
                    processingContext.tenantId,

                statementId:
                    normalized.statementId ||
                    imported.statementId ||
                    null,

                statement:
                    persisted,

                imported,

                normalized,

                validation,

                batch,

                metrics: {

                    durationMs,

                    durationSeconds:
                        Number(
                            (
                                durationMs /
                                1000
                            ).toFixed(3)
                        ),

                    transactionCount:
                        this.resolveStatementCount(
                            normalized
                        )

                },

                completedAt

            };

            this.recordMetric(
                'statement_pipeline_completed',
                result
            );

            this.emit(
                'STATEMENT_PIPELINE_COMPLETED',
                {
                    result,
                    context:
                        this.serializeContext(
                            processingContext
                        )
                }
            );

            return Object.freeze(result);

        } catch (error) {

            const failedAt =
                this.now();

            const normalizedError =
                this.normalizePipelineError(
                    error,
                    activeStage,
                    execution,
                    processingContext
                );

            /**
             * ================================================================
             * Failure Batch Transition
             * ================================================================
             */

            if (batch) {

                try {

                    batch =
                        this.batchManager.fail(
                            batch,
                            normalizedError
                        );

                } catch (batchError) {

                    this.logError(
                        'Failed to transition statement batch to FAILED',
                        batchError,
                        {
                            executionId:
                                execution?.executionId,

                            batchId:
                                batch?.batchId,

                            tenantId:
                                processingContext?.tenantId
                        }
                    );

                }

            }

            const durationMs =
                execution?.startedAt
                    ? Math.max(
                        0,
                        failedAt.getTime() -
                        new Date(
                            execution.startedAt
                        ).getTime()
                    )
                    : 0;

            this.recordMetric(
                'statement_pipeline_failed',
                {
                    error:
                        normalizedError,

                    stage:
                        activeStage,

                    executionId:
                        execution?.executionId || null,

                    batchId:
                        batch?.batchId || null,

                    durationMs
                }
            );

            this.emit(
                'STATEMENT_PIPELINE_FAILED',
                {
                    error:
                        normalizedError.toJSON
                            ? normalizedError.toJSON()
                            : normalizedError,

                    stage:
                        activeStage,

                    executionId:
                        execution?.executionId || null,

                    batch,

                    context:
                        this.serializeContext(
                            processingContext
                        ),

                    failedAt
                }
            );

            throw normalizedError;
        }
    }

    /**
     * =========================================================================
     * Import Statement
     * =========================================================================
     *
     * Public convenience API retained for compatibility with the existing
     * StatementProcessor-style orchestration.
     */

    async importStatement(input, context) {

        const processingContext =
            this.resolveContext(context);

        try {

            this.assertTenantBoundary(
                input,
                processingContext
            );

            return await this.importer.importStatement(
                input,
                processingContext
            );

        } catch (error) {

            if (
                error instanceof StatementImportError
            ) {

                throw error;
            }

            throw new StatementImportError(

                'Statement import failed',

                {

                    tenantId:
                        processingContext.tenantId,

                    correlationId:
                        processingContext.correlationId,

                    requestId:
                        processingContext.requestId,

                    executionId:
                        processingContext.executionId,

                    reference:
                        input?.reference || null,

                    originalError:
                        error?.message ||
                        String(error)

                },

                {

                    cause:
                        error,

                    retryable:
                        this.isRetryableError(
                            error
                        )

                }

            );
        }
    }

    /**
     * =========================================================================
     * Normalize Statement
     * =========================================================================
     */

    async normalizeStatement(
        statement,
        context
    ) {

        this.assertTenantBoundary(
            statement,
            context
        );

        try {

            return await this.normalizer.normalize(
                statement
            );

        } catch (error) {

            if (
                error instanceof StatementValidationError
            ) {

                throw error;
            }

            throw new StatementValidationError(

                'Statement normalization failed',

                {

                    tenantId:
                        context?.tenantId,

                    statementId:
                        statement?.statementId || null,

                    originalError:
                        error?.message ||
                        String(error)

                },

                {

                    cause:
                        error

                }

            );
        }
    }

    /**
     * =========================================================================
     * Validate Statement
     * =========================================================================
     *
     * Supports validators exposing either:
     *
     * validate(statement, context)
     *
     * or
     *
     * validateStatement(statement, context)
     */

    async validateStatement(
        statement,
        context
    ) {

        this.assertTenantBoundary(
            statement,
            context
        );

        try {

            if (
                typeof this.validator.validate ===
                'function'
            ) {

                return await this.validator.validate(
                    statement,
                    context
                );
            }

            if (
                typeof this.validator.validateStatement ===
                'function'
            ) {

                return await this.validator.validateStatement(
                    statement,
                    context
                );
            }

            throw new Error(
                'Statement validator does not expose validate() or validateStatement()'
            );

        } catch (error) {

            if (
                error instanceof StatementValidationError
            ) {

                throw error;
            }

            throw new StatementValidationError(

                'Statement validation failed',

                {

                    tenantId:
                        context?.tenantId,

                    statementId:
                        statement?.statementId || null,

                    originalError:
                        error?.message ||
                        String(error)

                },

                {

                    cause:
                        error

                }

            );
        }
    }

    /**
     * =========================================================================
     * Persist Statement
     * =========================================================================
     *
     * Repository compatibility:
     *
     * repository.save(statement, context)
     *
     * or
     *
     * repository.save(statement)
     */

    async persistStatement(
        statement,
        context,
        batch,
        validation
    ) {

        this.assertTenantBoundary(
            statement,
            context
        );

        if (
            !this.repository ||
            typeof this.repository.save !==
            'function'
        ) {

            throw new StatementPersistenceError(

                'Statement repository save operation is unavailable',

                {

                    tenantId:
                        context?.tenantId,

                    statementId:
                        statement?.statementId || null,

                    batchId:
                        batch?.batchId || null

                },

                {

                    retryable:
                        false

                }

            );
        }

        const persistencePayload = {

            ...statement,

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            correlationId:
                context.correlationId,

            requestId:
                context.requestId,

            executionId:
                context.executionId,

            traceId:
                context.traceId,

            batchId:
                batch.batchId,

            validationResult:
                validation,

            persistedAt:
                this.now()

        };

        try {

            return await this.repository.save(
                persistencePayload,
                context
            );

        } catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;
            }

            throw new StatementPersistenceError(

                'Failed to persist statement',

                {

                    tenantId:
                        context.tenantId,

                    statementId:
                        statement?.statementId || null,

                    batchId:
                        batch?.batchId || null,

                    originalError:
                        error?.message ||
                        String(error)

                },

                {

                    cause:
                        error,

                    retryable:
                        this.isRetryableError(
                            error
                        )

                }

            );
        }
    }

    /**
     * =========================================================================
     * Context Resolution
     * =========================================================================
     */

    resolveContext(context) {

        if (
            context instanceof StatementContext
        ) {

            return context;
        }

        if (
            !context ||
            typeof context !== 'object'
        ) {

            throw new StatementProcessingError(

                'Statement processing context required',

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

        try {

            return new StatementContext(
                context
            );

        } catch (error) {

            throw new StatementProcessingError(

                'Invalid statement processing context',

                {

                    originalError:
                        error?.message ||
                        String(error)

                },

                {

                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    cause:
                        error

                }

            );
        }
    }

    /**
     * =========================================================================
     * Attach Batch Context
     * =========================================================================
     *
     * StatementContext is immutable. A new derived context is therefore
     * created instead of mutating the original context.
     */

    attachBatchContext(
        context,
        batch
    ) {

        if (
            !batch ||
            !batch.batchId
        ) {

            throw new StatementProcessingError(

                'Unable to attach invalid batch to statement context',

                {

                    tenantId:
                        context.tenantId

                }

            );
        }

        if (
            batch.tenantId !==
            context.tenantId
        ) {

            throw new StatementProcessingError(

                'Batch tenant does not match statement context tenant',

                {

                    contextTenantId:
                        context.tenantId,

                    batchTenantId:
                        batch.tenantId,

                    batchId:
                        batch.batchId

                }

            );
        }

        return context.withBatch(
            batch.batchId
        );
    }

    /**
     * =========================================================================
     * Tenant Boundary
     * =========================================================================
     *
     * Prevents an already-tenant-bound object from crossing into another
     * tenant's processing context.
     */

    assertTenantBoundary(
        payload,
        context
    ) {

        if (
            !context ||
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
            payload &&
            payload.tenantId &&
            payload.tenantId !==
            context.tenantId
        ) {

            throw new StatementProcessingError(

                'Statement tenant boundary violation',

                {

                    contextTenantId:
                        context.tenantId,

                    payloadTenantId:
                        payload.tenantId,

                    statementId:
                        payload.statementId || null

                },

                {

                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    severity:
                        'CRITICAL'

                }

            );
        }
    }

    /**
     * =========================================================================
     * Validation Result Guard
     * =========================================================================
     */

    assertValidationPassed(
        validation
    ) {

        if (
            validation === false
        ) {

            throw new StatementValidationError(

                'Statement validation failed',

                {

                    validationResult:
                        validation

                }

            );
        }

        if (
            validation &&
            typeof validation === 'object'
        ) {

            const status =
                String(
                    validation.status ||
                    validation.result ||
                    ''
                ).toUpperCase();

            if (
                status === 'FAILED' ||
                status === 'INVALID' ||
                status === 'REJECTED'
            ) {

                throw new StatementValidationError(

                    'Statement validation failed',

                    {

                        validationResult:
                            validation

                    }

                );
            }

            if (
                validation.valid === false
            ) {

                throw new StatementValidationError(

                    'Statement validation failed',

                    {

                        validationResult:
                            validation

                    }

                );
            }
        }
    }

    /**
     * =========================================================================
     * Statement Count
     * =========================================================================
     */

    resolveStatementCount(
        statement
    ) {

        if (
            !statement
        ) {

            return 0;
        }

        if (
            Number.isInteger(
                statement.transactionCount
            )
        ) {

            return statement.transactionCount;
        }

        if (
            Array.isArray(
                statement.transactions
            )
        ) {

            return statement.transactions.length;
        }

        return 0;
    }

    /**
     * =========================================================================
     * Execution Metadata
     * =========================================================================
     */

    createExecutionMetadata(
        context
    ) {

        const executionId =
            context.executionId ||
            this.generateExecutionId(
                context
            );

        return Object.freeze({

            executionId,

            tenantId:
                context.tenantId,

            correlationId:
                context.correlationId,

            requestId:
                context.requestId,

            traceId:
                context.traceId,

            startedAt:
                this.now()

        });
    }

    /**
     * =========================================================================
     * Execution Identifier
     * =========================================================================
     */

    generateExecutionId(
        context
    ) {

        const crypto =
            require('crypto');

        return (

            'STMT-EXEC-' +

            crypto
                .createHash('sha256')
                .update(

                    [

                        context.tenantId,

                        context.correlationId || '',

                        context.requestId || '',

                        String(
                            this.now().getTime()
                        ),

                        crypto.randomUUID()

                    ].join('|')

                )
                .digest('hex')
                .substring(0, 32)

        );
    }

    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizePipelineError(
        error,
        stage,
        execution,
        context
    ) {

        if (
            error instanceof StatementProcessingError
        ) {

            return error;
        }

        return new StatementProcessingError(

            'Statement processing pipeline failed',

            {

                stage,

                tenantId:
                    context?.tenantId || null,

                executionId:
                    execution?.executionId || null,

                correlationId:
                    context?.correlationId || null,

                requestId:
                    context?.requestId || null,

                originalError:
                    error?.message ||
                    String(error)

            },

            {

                cause:
                    error,

                retryable:
                    this.isRetryableError(
                        error
                    )

            }

        );
    }

    /**
     * =========================================================================
     * Retryability
     * =========================================================================
     *
     * Conservative classification.
     *
     * Validation/business-rule failures should normally not be retried.
     * Infrastructure failures may be retried by the surrounding workflow
     * engine.
     */

    isRetryableError(
        error
    ) {

        if (
            !error
        ) {

            return false;
        }

        if (
            typeof error.retryable ===
            'boolean'
        ) {

            return error.retryable;
        }

        const code =
            String(
                error.code || ''
            ).toUpperCase();

        const message =
            String(
                error.message || ''
            ).toLowerCase();

        const retryableCodes = [

            'ETIMEDOUT',

            'ECONNRESET',

            'ECONNREFUSED',

            'EAI_AGAIN',

            'NETWORK_ERROR',

            'TIMEOUT',

            'SERVICE_UNAVAILABLE',

            'TEMPORARY_FAILURE',

            'TRANSIENT_ERROR'

        ];

        if (
            retryableCodes.some(
                value =>
                    code.includes(value)
            )
        ) {

            return true;
        }

        return (

            message.includes('timeout') ||

            message.includes('temporarily unavailable') ||

            message.includes('connection reset') ||

            message.includes('connection refused')

        );
    }

    /**
     * =========================================================================
     * Context Serialization
     * =========================================================================
     */

    serializeContext(
        context
    ) {

        if (
            !context
        ) {

            return null;
        }

        if (
            typeof context.toJSON ===
            'function'
        ) {

            return context.toJSON();
        }

        return {

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            source:
                context.source,

            correlationId:
                context.correlationId,

            requestId:
                context.requestId,

            executionId:
                context.executionId,

            traceId:
                context.traceId,

            actor:
                context.actor,

            environment:
                context.environment,

            service:
                context.service,

            batchId:
                context.batchId,

            createdAt:
                context.createdAt,

            metadata:
                context.metadata

        };
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        const required =
            [

                [
                    'importer',
                    this.importer,
                    'importStatement'
                ],

                [
                    'normalizer',
                    this.normalizer,
                    'normalize'
                ],

                [
                    'validator',
                    this.validator,
                    null
                ],

                [
                    'repository',
                    this.repository,
                    'save'
                ],

                [
                    'batchManager',
                    this.batchManager,
                    'createBatch'
                ],

            ];

        const invalid =
            required
                .filter(
                    ([
                        name,
                        dependency,
                        method
                    ]) => {

                        if (
                            !dependency
                        ) {

                            return true;
                        }

                        if (
                            method &&
                            typeof dependency[method] !==
                            'function'
                        ) {

                            return true;
                        }

                        return false;

                    }
                )
                .map(
                    ([
                        name,
                        ,
                        method
                    ]) => (

                        method
                            ? `${name}.${method}`
                            : name

                    )
                );

        /**
         * Validator may expose either validate() or validateStatement().
         */

        if (
            this.validator &&
            typeof this.validator.validate !==
            'function' &&
            typeof this.validator.validateStatement !==
            'function'
        ) {

            invalid.push(
                'validator.validate/validateStatement'
            );
        }

        if (
            invalid.length
        ) {

            throw new StatementProcessingError(

                'Invalid statement pipeline dependencies',

                {

                    dependencies:
                        invalid

                },

                {

                    severity:
                        'CRITICAL'

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
            this.clock.now();

        const date =
            value instanceof Date
                ? value
                : new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new StatementProcessingError(

                'Pipeline clock returned an invalid timestamp'

            );
        }

        return date;
    }

    /**
     * =========================================================================
     * Event Emission
     * =========================================================================
     *
     * Supports:
     *
     * events.emit(eventName, payload)
     *
     * or
     *
     * events[eventName](payload)
     *
     * Event failures never corrupt the financial pipeline.
     */

    emit(
        eventName,
        payload
    ) {

        if (
            !this.events
        ) {

            return;
        }

        try {

            if (
                typeof this.events.emit ===
                'function'
            ) {

                const result =
                    this.events.emit(
                        eventName,
                        payload
                    );

                /**
                 * EventEmitter-style emit() is normally synchronous.
                 * Do not await it here.
                 */

                return result;
            }

            if (
                typeof this.events[eventName] ===
                'function'
            ) {

                return this.events[eventName](
                    payload
                );
            }

        } catch (error) {

            this.logError(
                'Statement pipeline event emission failed',
                error,
                {
                    eventName,

                    tenantId:
                        payload?.context?.tenantId ||
                        payload?.result?.tenantId ||
                        null,

                    executionId:
                        payload?.execution?.executionId ||
                        payload?.result?.executionId ||
                        null,

                    batchId:
                        payload?.batch?.batchId ||
                        payload?.result?.batchId ||
                        null
                }
            );
        }
    }

    /**
     * =========================================================================
     * Stage Started Event
     * =========================================================================
     */

    emitStageStarted(
        stage,
        execution,
        context,
        batch,
        payload = null
    ) {

        this.emit(
            'STATEMENT_PIPELINE_STAGE_STARTED',
            {

                stage,

                execution,

                batchId:
                    batch?.batchId || null,

                tenantId:
                    context?.tenantId || null,

                statementId:
                    payload?.statementId || null,

                startedAt:
                    this.now()

            }
        );
    }

    /**
     * =========================================================================
     * Stage Completed Event
     * =========================================================================
     */

    emitStageCompleted(
        stage,
        execution,
        context,
        batch,
        payload = null
    ) {

        this.emit(
            'STATEMENT_PIPELINE_STAGE_COMPLETED',
            {

                stage,

                execution,

                batchId:
                    batch?.batchId || null,

                tenantId:
                    context?.tenantId || null,

                statementId:
                    payload?.statementId || null,

                completedAt:
                    this.now()

            }
        );
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     *
     * Supported metric adapter forms:
     *
     * metrics.increment(name, value, labels)
     *
     * metrics.observe(name, value, labels)
     */

    recordMetric(
        name,
        payload = {}
    ) {

        if (
            !this.metrics
        ) {

            return;
        }

        try {

            const labels = {

                tenantId:
                    payload.tenantId ||
                    payload.context?.tenantId ||
                    null,

                stage:
                    payload.stage ||
                    null

            };

            if (
                typeof this.metrics.increment ===
                'function'
            ) {

                this.metrics.increment(
                    name,
                    1,
                    labels
                );
            }

            if (
                typeof this.metrics.observe ===
                'function' &&
                Number.isFinite(
                    payload.durationMs
                )
            ) {

                this.metrics.observe(
                    `${name}_duration_ms`,
                    payload.durationMs,
                    labels
                );
            }

        } catch (error) {

            this.logError(
                'Statement pipeline metrics recording failed',
                error,
                {
                    metric:
                        name
                }
            );
        }
    }

    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    logError(
        message,
        error,
        metadata = {}
    ) {

        if (
            !this.logger
        ) {

            return;
        }

        try {

            const payload = {

                message,

                error:
                    error?.message ||
                    String(error),

                code:
                    error?.code || null,

                ...metadata

            };

            if (
                typeof this.logger.error ===
                'function'
            ) {

                this.logger.error(
                    message,
                    payload
                );

                return;
            }

            if (
                typeof this.logger.log ===
                'function'
            ) {

                this.logger.log(
                    'error',
                    payload
                );
            }

        } catch (_) {

            /**
             * Logging must never interfere with financial processing.
             */
        }
    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementPipeline;

module.exports.StatementPipeline =
    StatementPipeline;

module.exports.PIPELINE_STATUS =
    PIPELINE_STATUS;

module.exports.PIPELINE_STAGE =
    PIPELINE_STAGE;