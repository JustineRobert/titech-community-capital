'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementProcessor.js
 * ============================================================================
 *
 * Enterprise Statement Processing Orchestrator
 *
 * Responsibilities:
 *
 * - Coordinate the complete statement lifecycle.
 * - Manage statement batch execution.
 * - Orchestrate import, normalization, validation, and persistence.
 * - Maintain execution-context propagation.
 * - Enforce tenant isolation at orchestration boundaries.
 * - Track processing stages and execution duration.
 * - Safely transition batches through lifecycle states.
 * - Preserve original processing failures.
 * - Provide audit/observability metadata.
 * - Support distributed/background processing.
 * - Remain provider agnostic.
 *
 *
 * Processing Pipeline:
 *
 * StatementContext
 *       |
 *       v
 * Create Batch
 *       |
 *       v
 * Start Batch
 *       |
 *       v
 * Import Statement
 *       |
 *       v
 * Normalize Statement
 *       |
 *       v
 * Validate Statement
 *       |
 *       v
 * Persist Statement
 *       |
 *       v
 * Complete Batch
 *
 *
 * Failure Path:
 *
 * Any Stage
 *    |
 *    v
 * Record Failed Stage
 *    |
 *    v
 * Fail Batch
 *    |
 *    v
 * Preserve/Wrap Error
 *
 *
 * Architecture:
 *
 * StatementProcessor
 *
 *   +-- StatementImporter
 *   |
 *   +-- StatementNormalizer
 *   |
 *   +-- StatementValidator
 *   |
 *   +-- StatementRepository
 *   |
 *   +-- StatementBatchManager
 *
 *
 * Design Principles:
 *
 * - Orchestration only.
 * - No direct persistence implementation.
 * - No provider coupling.
 * - No business validation rules.
 * - Explicit lifecycle stages.
 * - Tenant-aware.
 * - Failure recoverable.
 * - Observable.
 * - Audit friendly.
 * - Distributed-processing ready.
 * - Backward compatible with existing dependency interfaces.
 *
 * ============================================================================
 */

const {
    StatementProcessingError
} = require('./StatementErrors');

const {
    STATEMENT_STATUS
} = require('./StatementConstants');


/**
 * ============================================================================
 * Processing Stages
 * ============================================================================
 *
 * These values are intentionally local to the orchestrator.
 *
 * They represent execution stages rather than statement lifecycle states.
 */
const PROCESSING_STAGE = Object.freeze({

    INITIALIZING:
        'INITIALIZING',

    BATCH_CREATED:
        'BATCH_CREATED',

    BATCH_STARTED:
        'BATCH_STARTED',

    IMPORTING:
        'IMPORTING',

    IMPORTED:
        'IMPORTED',

    NORMALIZING:
        'NORMALIZING',

    NORMALIZED:
        'NORMALIZED',

    VALIDATING:
        'VALIDATING',

    VALIDATED:
        'VALIDATED',

    PERSISTING:
        'PERSISTING',

    PERSISTED:
        'PERSISTED',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED'

});


/**
 * ============================================================================
 * StatementProcessor
 * ============================================================================
 */

class StatementProcessor {


    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} dependencies
     * @param {Object} dependencies.importer
     * @param {Object} dependencies.normalizer
     * @param {Object} dependencies.validator
     * @param {Object} dependencies.repository
     * @param {Object} dependencies.batchManager
     * @param {Object} [options]
     * @param {Function} [options.clock]
     * @param {Object} [options.logger]
     *
     * @throws {StatementProcessingError}
     */
    constructor({

        importer,

        normalizer,

        validator,

        repository,

        batchManager

    } = {}, {

        clock = () => new Date(),

        logger = null

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


        this.clock =
            typeof clock === 'function'
                ? clock
                : () => new Date();


        this.logger =
            logger;


        this.validateDependencies();


    }


    /**
     * =========================================================================
     * Process Statement Lifecycle
     * =========================================================================
     *
     * Main orchestration entry point.
     *
     * @param {Object} input
     * @param {StatementContext} context
     *
     * @returns {Promise<Object>}
     */
    async process(input, context) {


        const startedAt =
            this.now();


        let batch = null;

        let stage =
            PROCESSING_STAGE.INITIALIZING;

        let imported = null;

        let normalized = null;

        let saved = null;


        try {


            /**
             * ---------------------------------------------------------------
             * Validate orchestration context before creating a batch.
             * ---------------------------------------------------------------
             */
            this.validateContext(context);


            this.logDebug(
                'Statement processing started',
                this.buildLogContext(
                    context,
                    {
                        stage
                    }
                )
            );


            /**
             * ---------------------------------------------------------------
             * Create Batch
             * ---------------------------------------------------------------
             */
            stage =
                PROCESSING_STAGE.BATCH_CREATED;


            batch =
                this.batchManager.createBatch(
                    context
                );


            this.assertBatchTenant(
                batch,
                context
            );


            /**
             * ---------------------------------------------------------------
             * Start Batch
             * ---------------------------------------------------------------
             */
            stage =
                PROCESSING_STAGE.BATCH_STARTED;


            batch =
                this.batchManager.start(
                    batch
                );


            this.assertBatchTenant(
                batch,
                context
            );


            /**
             * ---------------------------------------------------------------
             * Import
             * ---------------------------------------------------------------
             */
            stage =
                PROCESSING_STAGE.IMPORTING;


            this.updateBatchProgressSafely(
                batch,
                {
                    total: 0,
                    processed: 0,
                    failed: 0
                }
            );


            imported =
                await this.importStatement(
                    input,
                    context
                );


            this.assertStatementTenant(
                imported,
                context
            );


            stage =
                PROCESSING_STAGE.IMPORTED;


            /**
             * ---------------------------------------------------------------
             * Normalize
             * ---------------------------------------------------------------
             */
            stage =
                PROCESSING_STAGE.NORMALIZING;


            normalized =
                this.normalizer.normalize(
                    imported
                );


            this.assertStatementTenant(
                normalized,
                context
            );


            stage =
                PROCESSING_STAGE.NORMALIZED;


            /**
             * ---------------------------------------------------------------
             * Validation
             * ---------------------------------------------------------------
             *
             * Validator contract remains intentionally flexible:
             *
             * - validate(statement)
             * - validate(statement) returning a result
             *
             * The processor does not impose validation business rules.
             */
            stage =
                PROCESSING_STAGE.VALIDATING;


            const validationResult =
                await this.validator.validate(
                    normalized
                );


            this.assertValidationSuccess(
                validationResult
            );


            stage =
                PROCESSING_STAGE.VALIDATED;


            /**
             * ---------------------------------------------------------------
             * Persist
             * ---------------------------------------------------------------
             *
             * Batch ownership is attached only at the persistence boundary.
             */
            stage =
                PROCESSING_STAGE.PERSISTING;


            const persistencePayload = {

                ...normalized,

                tenantId:
                    context.tenantId,

                batchId:
                    batch.batchId,

                status:
                    STATEMENT_STATUS.PERSISTED

            };


            saved =
                await this.repository.save(
                    persistencePayload
                );


            this.assertStatementTenant(
                saved,
                context
            );


            stage =
                PROCESSING_STAGE.PERSISTED;


            /**
             * ---------------------------------------------------------------
             * Complete Batch
             * ---------------------------------------------------------------
             */
            const transactionCount =
                this.resolveTransactionCount(
                    saved || normalized
                );


            batch =
                this.completeBatch(
                    batch,
                    transactionCount
                );


            stage =
                PROCESSING_STAGE.COMPLETED;


            const completedAt =
                this.now();


            const executionDurationMs =
                Math.max(
                    0,
                    completedAt.getTime() -
                    startedAt.getTime()
                );


            const result = {

                success:
                    true,

                status:
                    STATEMENT_STATUS.PERSISTED,

                stage,

                batch,

                statement:
                    saved,

                validation:
                    validationResult || null,

                execution: {

                    startedAt,

                    completedAt,

                    durationMs:
                        executionDurationMs

                }

            };


            this.logInfo(
                'Statement processing completed',
                this.buildLogContext(
                    context,
                    {
                        stage,
                        batchId:
                            batch?.batchId || null,
                        statementId:
                            saved?.statementId ||
                            normalized?.statementId ||
                            imported?.statementId ||
                            null,
                        durationMs:
                            executionDurationMs
                    }
                )
            );


            return Object.freeze(result);


        } catch (error) {


            /**
             * ---------------------------------------------------------------
             * Failure handling
             * ---------------------------------------------------------------
             *
             * The original error is preserved whenever possible.
             */
            stage =
                PROCESSING_STAGE.FAILED;


            const processingError =
                this.normalizeProcessingError(
                    error,
                    {
                        context,
                        batch,
                        stage
                    }
                );


            /**
             * ---------------------------------------------------------------
             * Fail Batch
             * ---------------------------------------------------------------
             *
             * Failure to update the batch must never hide the original
             * processing error.
             */
            batch =
                this.failBatchSafely(
                    batch,
                    processingError
                );


            this.logError(
                'Statement processing failed',
                this.buildLogContext(
                    context,
                    {
                        stage,
                        batchId:
                            batch?.batchId || null,
                        code:
                            processingError.code,
                        retryable:
                            processingError.retryable,
                        error:
                            processingError.message
                    }
                )
            );


            throw processingError;


        }


    }


    /**
     * =========================================================================
     * Import Statement
     * =========================================================================
     *
     * Kept as a dedicated method to preserve the existing orchestration
     * boundary and provide an extension point for future import policies.
     *
     * @param {Object} input
     * @param {Object} context
     *
     * @returns {Promise<Object>}
     */
    async importStatement(
        input,
        context
    ) {


        return this.importer.importStatement(
            input,
            context
        );


    }


    /**
     * =========================================================================
     * Complete Batch
     * =========================================================================
     *
     * Updates batch progress before marking the batch complete.
     *
     * @param {Object} batch
     * @param {number} transactionCount
     *
     * @returns {Object}
     */
    completeBatch(
        batch,
        transactionCount = 0
    ) {


        let currentBatch =
            batch;


        /**
         * Mark all imported transactions as processed.
         *
         * StatementBatchManager is intentionally treated as the owner of
         * batch state transitions.
         */
        currentBatch =
            this.updateBatchProgressSafely(
                currentBatch,
                {
                    total:
                        transactionCount,

                    processed:
                        transactionCount,

                    failed:
                        0
                }
            );


        return this.batchManager.complete(
            currentBatch
        );


    }


    /**
     * =========================================================================
     * Fail Batch Safely
     * =========================================================================
     *
     * Never throws while handling an existing failure.
     *
     * @param {Object|null} batch
     * @param {Error} error
     *
     * @returns {Object|null}
     */
    failBatchSafely(
        batch,
        error
    ) {


        if (!batch) {

            return null;

        }


        try {


            return this.batchManager.fail(
                batch,
                error
            );


        } catch (batchError) {


            this.logError(
                'Failed to transition statement batch to FAILED',
                {
                    batchId:
                        batch.batchId || null,

                    originalError:
                        error?.message || null,

                    batchFailure:
                        batchError?.message ||
                        String(batchError)
                }
            );


            return batch;


        }


    }


    /**
     * =========================================================================
     * Update Batch Progress Safely
     * =========================================================================
     *
     * StatementBatchManager is expected to provide updateProgress().
     *
     * For backward compatibility, the processor tolerates older managers
     * that do not expose the method.
     *
     * @param {Object} batch
     * @param {Object} progress
     *
     * @returns {Object}
     */
    updateBatchProgressSafely(
        batch,
        progress = {}
    ) {


        if (
            !batch ||
            !this.batchManager ||
            typeof this.batchManager.updateProgress !== 'function'
        ) {

            return batch;

        }


        return this.batchManager.updateProgress(
            batch,
            progress
        );


    }


    /**
     * =========================================================================
     * Validate Dependencies
     * =========================================================================
     *
     * Dependencies are checked by capability rather than only by truthiness.
     */
    validateDependencies() {


        const dependencies = {

            importer:
                this.importer,

            normalizer:
                this.normalizer,

            validator:
                this.validator,

            repository:
                this.repository,

            batchManager:
                this.batchManager

        };


        const missing =
            Object.entries(dependencies)
                .filter(
                    ([name, dependency]) =>
                        !dependency
                )
                .map(
                    ([name]) =>
                        name
                );


        if (missing.length) {

            throw new StatementProcessingError(

                'StatementProcessor dependencies missing',

                {
                    missingDependencies:
                        missing
                },

                {
                    code:
                        'STATEMENT_PROCESSOR_DEPENDENCY_ERROR',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


        const invalid = [];


        if (
            typeof this.importer.importStatement !==
            'function'
        ) {

            invalid.push(
                'importer.importStatement'
            );

        }


        if (
            typeof this.normalizer.normalize !==
            'function'
        ) {

            invalid.push(
                'normalizer.normalize'
            );

        }


        if (
            typeof this.validator.validate !==
            'function'
        ) {

            invalid.push(
                'validator.validate'
            );

        }


        if (
            typeof this.repository.save !==
            'function'
        ) {

            invalid.push(
                'repository.save'
            );

        }


        if (
            typeof this.batchManager.createBatch !==
            'function'
        ) {

            invalid.push(
                'batchManager.createBatch'
            );

        }


        if (
            typeof this.batchManager.start !==
            'function'
        ) {

            invalid.push(
                'batchManager.start'
            );

        }


        if (
            typeof this.batchManager.complete !==
            'function'
        ) {

            invalid.push(
                'batchManager.complete'
            );

        }


        if (
            typeof this.batchManager.fail !==
            'function'
        ) {

            invalid.push(
                'batchManager.fail'
            );

        }


        if (invalid.length) {

            throw new StatementProcessingError(

                'StatementProcessor dependencies do not implement required interfaces',

                {
                    invalidDependencies:
                        invalid
                },

                {
                    code:
                        'STATEMENT_PROCESSOR_INTERFACE_ERROR',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


    }


    /**
     * =========================================================================
     * Validate Context
     * =========================================================================
     *
     * The StatementContext class performs authoritative validation.
     *
     * This method provides a defensive orchestration boundary without creating
     * a dependency on the concrete StatementContext implementation.
     */
    validateContext(context) {


        if (!context) {

            throw new StatementProcessingError(

                'Statement processing context required',

                {
                    reason:
                        'MISSING_CONTEXT'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


        if (!context.tenantId) {

            throw new StatementProcessingError(

                'Tenant context required',

                {
                    reason:
                        'MISSING_TENANT'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


        if (!context.correlationId) {

            throw new StatementProcessingError(

                'Correlation ID required',

                {
                    reason:
                        'MISSING_CORRELATION_ID'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


        if (!context.requestId) {

            throw new StatementProcessingError(

                'Request ID required',

                {
                    reason:
                        'MISSING_REQUEST_ID'
                },

                {
                    code:
                        'STATEMENT_INVALID_CONTEXT',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


    }


    /**
     * =========================================================================
     * Tenant Boundary Validation
     * =========================================================================
     *
     * Prevents an incorrectly configured downstream component from returning
     * a statement belonging to another tenant.
     *
     * @param {Object} statement
     * @param {Object} context
     */
    assertStatementTenant(
        statement,
        context
    ) {


        if (!statement) {

            throw new StatementProcessingError(

                'Statement processing component returned an empty statement',

                {
                    tenantId:
                        context?.tenantId || null
                },

                {
                    code:
                        'STATEMENT_EMPTY_RESULT',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


        /**
         * Some downstream implementations may return undefined from repository
         * operations. Only enforce tenant identity when a result is returned.
         */
        if (
            statement.tenantId !== undefined &&
            statement.tenantId !== null &&
            String(statement.tenantId) !==
                String(context.tenantId)
        ) {

            throw new StatementProcessingError(

                'Statement tenant boundary violation',

                {
                    expectedTenantId:
                        context.tenantId,

                    actualTenantId:
                        statement.tenantId
                },

                {
                    code:
                        'STATEMENT_TENANT_BOUNDARY_VIOLATION',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


    }


    /**
     * =========================================================================
     * Batch Tenant Boundary Validation
     * =========================================================================
     */
    assertBatchTenant(
        batch,
        context
    ) {


        if (!batch) {

            throw new StatementProcessingError(

                'Statement batch manager returned an empty batch',

                {
                    tenantId:
                        context.tenantId
                },

                {
                    code:
                        'STATEMENT_BATCH_INVALID',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


        if (
            batch.tenantId !== undefined &&
            batch.tenantId !== null &&
            String(batch.tenantId) !==
                String(context.tenantId)
        ) {

            throw new StatementProcessingError(

                'Statement batch tenant boundary violation',

                {
                    expectedTenantId:
                        context.tenantId,

                    actualTenantId:
                        batch.tenantId,

                    batchId:
                        batch.batchId || null
                },

                {
                    code:
                        'STATEMENT_TENANT_BOUNDARY_VIOLATION',

                    retryable:
                        false,

                    severity:
                        'CRITICAL'
                }

            );

        }


    }


    /**
     * =========================================================================
     * Validation Result Handling
     * =========================================================================
     *
     * Supports validators that:
     *
     * 1. throw on failure and return undefined on success;
     * 2. return { valid: true/false };
     * 3. return { valid: true/false, status: ... };
     *
     * Business validation remains the responsibility of StatementValidator.
     */
    assertValidationSuccess(
        validationResult
    ) {


        if (
            validationResult === null ||
            validationResult === undefined
        ) {

            return;

        }


        if (
            typeof validationResult !== 'object'
        ) {

            return;

        }


        if (
            validationResult.valid === false ||
            validationResult.isValid === false
        ) {

            throw new StatementProcessingError(

                'Statement validation failed',

                {
                    validation:
                        validationResult
                },

                {
                    code:
                        'STATEMENT_VALIDATION_FAILED',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


        if (
            typeof validationResult.status === 'string' &&
            validationResult.status.toUpperCase() === 'FAILED'
        ) {

            throw new StatementProcessingError(

                'Statement validation failed',

                {
                    validation:
                        validationResult
                },

                {
                    code:
                        'STATEMENT_VALIDATION_FAILED',

                    retryable:
                        false,

                    severity:
                        'ERROR'
                }

            );

        }


    }


    /**
     * =========================================================================
     * Resolve Transaction Count
     * =========================================================================
     */
    resolveTransactionCount(
        statement
    ) {


        if (!statement) {

            return 0;

        }


        if (
            Number.isInteger(
                statement.transactionCount
            ) &&
            statement.transactionCount >= 0
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
     * Normalize Processing Error
     * =========================================================================
     *
     * Preserves domain errors and wraps unknown errors with execution context.
     */
    normalizeProcessingError(
        error,
        {
            context,
            batch,
            stage
        } = {}
    ) {


        if (
            error instanceof StatementProcessingError
        ) {

            return error;

        }


        const message =
            error?.message ||
            'Statement processing failed';


        return new StatementProcessingError(

            message,

            {

                tenantId:
                    context?.tenantId || null,

                correlationId:
                    context?.correlationId || null,

                requestId:
                    context?.requestId || null,

                batchId:
                    batch?.batchId || null,

                stage,

                originalError:
                    message

            },

            {

                cause:
                    error,

                code:
                    'STATEMENT_PROCESSING_FAILED',

                retryable:
                    false,

                severity:
                    'ERROR'

            }

        );


    }


    /**
     * =========================================================================
     * Build Log Context
     * =========================================================================
     *
     * Avoids logging complete statement payloads or financial transaction data.
     */
    buildLogContext(
        context,
        additional = {}
    ) {


        return {

            tenantId:
                context?.tenantId || null,

            userId:
                context?.userId || null,

            correlationId:
                context?.correlationId || null,

            requestId:
                context?.requestId || null,

            batchId:
                context?.batchId || null,

            ...additional

        };


    }


    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */
    now() {


        const value =
            this.clock();


        const date =
            value instanceof Date
                ? value
                : new Date(value);


        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            return new Date();

        }


        return date;

    }


    /**
     * =========================================================================
     * Logging Helpers
     * =========================================================================
     *
     * Logger integration is optional.
     *
     * The processor never fails because observability infrastructure is
     * unavailable.
     */
    logDebug(
        message,
        metadata = {}
    ) {


        this.safeLog(
            'debug',
            message,
            metadata
        );

    }


    logInfo(
        message,
        metadata = {}
    ) {


        this.safeLog(
            'info',
            message,
            metadata
        );

    }


    logError(
        message,
        metadata = {}
    ) {


        this.safeLog(
            'error',
            message,
            metadata
        );

    }


    safeLog(
        level,
        message,
        metadata
    ) {


        if (!this.logger) {

            return;

        }


        try {


            if (
                typeof this.logger[level] ===
                'function'
            ) {

                this.logger[level](
                    message,
                    metadata
                );

                return;

            }


            if (
                typeof this.logger.log ===
                'function'
            ) {

                this.logger.log(
                    level,
                    message,
                    metadata
                );

            }


        } catch (error) {

            /**
             * Logging must never interrupt financial processing.
             */

        }


    }


}


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = StatementProcessor;

module.exports.PROCESSING_STAGE =
    PROCESSING_STAGE;