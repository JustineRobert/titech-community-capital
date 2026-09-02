'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Statement Processing Tracing Facade
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/observability/statementTracing.js
 *
 * Purpose:
 *   Enterprise-grade domain observability facade for the financial statement
 *   processing pipeline.
 *
 * This module keeps StatementProcessingService focused on financial workflow
 * orchestration while centralizing:
 *
 *   - tracing
 *   - correlation
 *   - tenant propagation
 *   - lifecycle events
 *   - statement-stage instrumentation
 *   - repository tracing
 *   - idempotency telemetry
 *   - retry telemetry
 *   - provider correlation telemetry
 *   - bounded batch progress telemetry
 *   - observability failure isolation
 *
 * Trace hierarchy:
 *
 *   finance.statement.process
 *        |
 *        +-- finance.statement.import
 *        +-- finance.statement.normalize
 *        +-- finance.statement.validate
 *        +-- finance.statement.persist
 *        +-- finance.statement.batch
 *        +-- finance.statement.repository.*
 *
 * Design guarantees:
 *
 *   - Observability never becomes a financial processing dependency.
 *   - Business exceptions always propagate.
 *   - Tracing failures are isolated.
 *   - Sensitive statement payloads are never traced automatically.
 *   - Idempotency keys may be hashed by default.
 *   - Provider references may be hashed by default.
 *   - Batch progress events are bounded.
 *   - Correlation identifiers remain stable across pipeline stages.
 *   - Parent/child relationships are preserved when supported.
 *   - Supports FinanceTracingAdapter.
 *   - Supports no-op operation.
 *   - Supports runtime configuration.
 *
 * IMPORTANT:
 *
 *   This module does NOT initialize OpenTelemetry or any tracing SDK.
 *   Application-level observability infrastructure owns that lifecycle.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const PIPELINE_STAGES = Object.freeze({
    PROCESS: 'process',
    IMPORT: 'import',
    NORMALIZE: 'normalize',
    VALIDATE: 'validate',
    PERSIST: 'persist',
    BATCH: 'batch'
});

const EVENTS = Object.freeze({
    /* Pipeline lifecycle */
    PIPELINE_STARTED:
        'statement.pipeline.started',

    PIPELINE_COMPLETED:
        'statement.pipeline.completed',

    PIPELINE_FAILED:
        'statement.pipeline.failed',

    /* Import */
    IMPORT_STARTED:
        'statement.import.started',

    IMPORT_COMPLETED:
        'statement.import.completed',

    IMPORT_FAILED:
        'statement.import.failed',

    /* Normalization */
    NORMALIZATION_STARTED:
        'statement.normalization.started',

    NORMALIZATION_COMPLETED:
        'statement.normalization.completed',

    NORMALIZATION_FAILED:
        'statement.normalization.failed',

    /* Validation */
    VALIDATION_STARTED:
        'statement.validation.started',

    VALIDATION_COMPLETED:
        'statement.validation.completed',

    VALIDATION_FAILED:
        'statement.validation.failed',

    /* Persistence */
    PERSISTENCE_STARTED:
        'statement.persistence.started',

    PERSISTENCE_COMPLETED:
        'statement.persistence.completed',

    PERSISTENCE_FAILED:
        'statement.persistence.failed',

    /* Batch */
    BATCH_STARTED:
        'statement.batch.started',

    BATCH_PROGRESS:
        'statement.batch.progress',

    BATCH_COMPLETED:
        'statement.batch.completed',

    BATCH_FAILED:
        'statement.batch.failed',

    /* Idempotency */
    IDEMPOTENCY_CHECK_STARTED:
        'statement.idempotency.check.started',

    IDEMPOTENCY_HIT:
        'statement.idempotency.hit',

    IDEMPOTENCY_MISS:
        'statement.idempotency.miss',

    IDEMPOTENCY_CONFLICT:
        'statement.idempotency.conflict',

    /* Retry */
    RETRY_SCHEDULED:
        'statement.retry.scheduled',

    RETRY_ATTEMPT:
        'statement.retry.attempt',

    RETRY_EXHAUSTED:
        'statement.retry.exhausted',

    /* Provider */
    PROVIDER_CORRELATED:
        'statement.provider.correlated',

    PROVIDER_REFERENCE_MATCHED:
        'statement.provider.reference.matched',

    PROVIDER_REFERENCE_MISSING:
        'statement.provider.reference.missing',

    /* Repository */
    REPOSITORY_OPERATION_STARTED:
        'statement.repository.operation.started',

    REPOSITORY_OPERATION_COMPLETED:
        'statement.repository.operation.completed',

    REPOSITORY_OPERATION_FAILED:
        'statement.repository.operation.failed'
});

const DEFAULTS = Object.freeze({
    enabled: true,

    generatePipelineId: true,

    generateStatementTraceId: true,

    generateCorrelationId: true,

    emitLifecycleEvents: true,

    emitBatchProgressEvents: true,

    maxBatchProgressEvents: 100,

    maxMetadataKeys: 50,

    maxMetadataStringLength: 2048,

    maxArrayItems: 20,

    maxOperationLength: 200,

    /*
     * Security-first defaults.
     *
     * Keys/references are hashed unless explicitly disabled.
     */
    redactIdempotencyKey: true,

    redactProviderReference: true,

    redactOperationKey: true,

    includeCounts: true,

    includeProviderCorrelation: true,

    includeHighCardinalityMetadata: false,

    /*
     * Allows a caller to explicitly disable tracing without replacing the
     * adapter instance.
     */
    failOpen: true
});

/**
 * Metadata that must never be automatically propagated into traces/events.
 *
 * Defense in depth:
 *   FinanceTracingAdapter
 *   -> TransactionTracer
 *   -> OpenTelemetry
 * all get another safety barrier here.
 */
const RESERVED_METADATA = new Set([
    'password',
    'passcode',
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'authorization',
    'secret',
    'apiKey',
    'api_key',
    'apiSecret',
    'api_secret',
    'privateKey',
    'private_key',
    'pin',
    'otp',
    'cvv',
    'securityCode',

    'rawStatement',
    'raw_statement',
    'statementContent',
    'statement_content',
    'fileContent',
    'file_content',
    'payload',
    'rawPayload',
    'raw_payload',
    'requestBody',
    'request_body',
    'responseBody',
    'response_body',

    'accountNumber',
    'account_number',
    'walletNumber',
    'wallet_number',
    'phoneNumber',
    'phone_number',
    'email',
    'nationalId',
    'national_id',
    'identityNumber',
    'identity_number',

    'authorizationHeader',
    'cookie',
    'cookies',
    'headers',

    'statementRows',
    'statement_records',
    'records',
    'transactions',
    'entries'
]);

const SENSITIVE_KEY_PATTERNS = Object.freeze([
    /password/i,
    /passcode/i,
    /token/i,
    /secret/i,
    /private.?key/i,
    /authorization/i,
    /cookie/i,
    /credential/i,
    /signature/i,
    /otp/i,
    /pin/i,
    /cvv/i,
    /card.?number/i,
    /national.?id/i,
    /identity.?number/i,
    /account.?number/i,
    /wallet.?number/i,
    /phone/i,
    /email/i
]);

const HIGH_CARDINALITY_PATTERNS = Object.freeze([
    /payload/i,
    /body/i,
    /headers?/i,
    /metadata/i,
    /document/i,
    /records?/i,
    /transactions?/i,
    /entries/i,
    /rows/i,
    /items/i,
    /query/i,
    /stack/i,
    /address/i,
    /phone/i,
    /email/i
]);

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

function isFunction(value) {
    return typeof value === 'function';
}

function isPromise(value) {
    return Boolean(
        value &&
        typeof value.then === 'function'
    );
}

function normalizeError(error) {
    if (!error) {
        return null;
    }

    if (error instanceof Error) {
        return {
            name:
                error.name ||
                'Error',

            message:
                sanitizeString(
                    error.message ||
                    'Unknown error'
                ),

            code:
                error.code ||
                null,

            status:
                error.status ??
                error.statusCode ??
                null
        };
    }

    return {
        name: 'Error',

        message:
            sanitizeString(
                String(error)
            ),

        code: null,

        status: null
    };
}

function sanitizeString(
    value,
    maxLength = DEFAULTS.maxMetadataStringLength
) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const stringValue =
        String(value);

    if (
        stringValue.length <=
        maxLength
    ) {
        return stringValue;
    }

    return `${stringValue.slice(
        0,
        Math.max(0, maxLength - 3)
    )}...`;
}

function isSensitiveKey(key) {
    const normalized =
        String(key || '');

    return SENSITIVE_KEY_PATTERNS.some(
        pattern =>
            pattern.test(
                normalized
            )
    );
}

function isHighCardinalityKey(
    key
) {
    const normalized =
        String(key || '');

    return HIGH_CARDINALITY_PATTERNS.some(
        pattern =>
            pattern.test(
                normalized
            )
    );
}

function normalizeCount(value) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return null;
    }

    return Math.max(
        0,
        number
    );
}

function normalizePercentage(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return null;
    }

    return Math.min(
        100,
        Math.max(
            0,
            number
        )
    );
}

/* ============================================================================
 * Statement Tracing Facade
 * ========================================================================== */

class StatementTracing {

    constructor(options = {}) {

        /**
         * FinanceTracingAdapter instance.
         */
        this.financeTracing =
            options.financeTracing ||
            options.tracing ||
            null;

        /**
         * Structured logger.
         */
        this.logger =
            options.logger ||
            console;

        /**
         * Optional metrics adapter.
         */
        this.metrics =
            options.metrics ||
            null;

        /**
         * Runtime configuration.
         */
        this.config = {
            ...DEFAULTS,
            ...options
        };

        /**
         * Internal statistics.
         */
        this.statistics = {
            pipelinesStarted: 0,
            pipelinesCompleted: 0,
            pipelinesFailed: 0,

            imports: 0,
            normalizations: 0,
            validations: 0,
            persistences: 0,
            batches: 0,

            idempotencyHits: 0,
            idempotencyMisses: 0,
            idempotencyConflicts: 0,

            retries: 0,

            providerCorrelations: 0,
            providerReferenceMatches: 0,
            providerReferenceMisses: 0,

            repositoryOperations: 0,

            batchProgressEvents: 0,
            batchProgressSuppressed: 0,

            tracingFailures: 0,
            noopOperations: 0
        };

        /**
         * Batch progress event counters.
         *
         * WeakMap keeps lifecycle state attached to spans without retaining
         * completed spans indefinitely.
         */
        this.batchProgressCounters =
            new WeakMap();
    }

    /* ========================================================================
     * Configuration
     * ====================================================================== */

    configure(options = {}) {

        if (
            !options ||
            typeof options !== 'object'
        ) {
            return this.getConfig();
        }

        this.config = {
            ...this.config,
            ...options
        };

        return this.getConfig();
    }

    getConfig() {

        return {
            ...this.config
        };
    }

    /* ========================================================================
     * Primary Statement Processing Trace
     * ====================================================================== */

    async process(
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement process callback'
        );

        const traceContext =
            this.createContext(
                PIPELINE_STAGES.PROCESS,
                context
            );

        this.statistics
            .pipelinesStarted++;

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            try {
                const result =
                    await callback(
                        null,
                        traceContext
                    );

                this.statistics
                    .pipelinesCompleted++;

                return result;

            } catch (error) {

                this.statistics
                    .pipelinesFailed++;

                throw error;
            }
        }

        try {

            return await this.financeTracing
                .traceStatementProcessing(
                    async (
                        span,
                        parentContext = {}
                    ) => {

                        const operationContext =
                            this.mergeContext(
                                traceContext,
                                parentContext
                            );

                        this.emitEvent(
                            span,
                            EVENTS.PIPELINE_STARTED,
                            this.createLifecycleMetadata(
                                operationContext
                            )
                        );

                        try {

                            const result =
                                await callback(
                                    span,
                                    operationContext
                                );

                            this.statistics
                                .pipelinesCompleted++;

                            this.emitEvent(
                                span,
                                EVENTS.PIPELINE_COMPLETED,
                                this.createLifecycleMetadata(
                                    operationContext
                                )
                            );

                            this.incrementMetric(
                                'statement_processing_completed_total',
                                {
                                    provider:
                                        operationContext.provider ||
                                        'unknown'
                                }
                            );

                            return result;

                        } catch (error) {

                            this.statistics
                                .pipelinesFailed++;

                            this.emitEvent(
                                span,
                                EVENTS.PIPELINE_FAILED,
                                {
                                    ...this.createLifecycleMetadata(
                                        operationContext
                                    ),

                                    errorCode:
                                        error?.code ||
                                        null
                                }
                            );

                            this.incrementMetric(
                                'statement_processing_failed_total',
                                {
                                    provider:
                                        operationContext.provider ||
                                        'unknown',

                                    errorCode:
                                        error?.code ||
                                        'UNKNOWN'
                                }
                            );

                            throw error;
                        }
                    },
                    traceContext
                );

        } catch (error) {

            /*
             * Business errors must always propagate.
             */
            throw error;
        }
    }

    /* ========================================================================
     * Import Statement Trace
     * ====================================================================== */

    async importStatement(
        parentSpan,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement import callback'
        );

        this.statistics.imports++;

        return this.traceStage(
            parentSpan,
            PIPELINE_STAGES.IMPORT,
            EVENTS.IMPORT_STARTED,
            EVENTS.IMPORT_COMPLETED,
            EVENTS.IMPORT_FAILED,
            callback,
            context
        );
    }

    /* ========================================================================
     * Normalize Statement Trace
     * ====================================================================== */

    async normalize(
        parentSpan,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement normalization callback'
        );

        this.statistics
            .normalizations++;

        return this.traceStage(
            parentSpan,
            PIPELINE_STAGES.NORMALIZE,
            EVENTS.NORMALIZATION_STARTED,
            EVENTS.NORMALIZATION_COMPLETED,
            EVENTS.NORMALIZATION_FAILED,
            callback,
            context
        );
    }

    /* ========================================================================
     * Validate Statement Trace
     * ====================================================================== */

    async validate(
        parentSpan,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement validation callback'
        );

        this.statistics.validations++;

        return this.traceStage(
            parentSpan,
            PIPELINE_STAGES.VALIDATE,
            EVENTS.VALIDATION_STARTED,
            EVENTS.VALIDATION_COMPLETED,
            EVENTS.VALIDATION_FAILED,
            callback,
            context
        );
    }

    /* ========================================================================
     * Persist Statement Trace
     * ====================================================================== */

    async persist(
        parentSpan,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement persistence callback'
        );

        this.statistics.persistences++;

        return this.traceStage(
            parentSpan,
            PIPELINE_STAGES.PERSIST,
            EVENTS.PERSISTENCE_STARTED,
            EVENTS.PERSISTENCE_COMPLETED,
            EVENTS.PERSISTENCE_FAILED,
            callback,
            context
        );
    }

    /* ========================================================================
     * Batch Coordination Trace
     * ====================================================================== */

    async batch(
        parentSpan,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Statement batch callback'
        );

        this.statistics.batches++;

        return this.traceStage(
            parentSpan,
            PIPELINE_STAGES.BATCH,
            EVENTS.BATCH_STARTED,
            EVENTS.BATCH_COMPLETED,
            EVENTS.BATCH_FAILED,
            callback,
            context
        );
    }

    /* ========================================================================
     * Generic Pipeline Stage
     * ====================================================================== */

    async traceStage(
        parentSpan,
        stage,
        startedEvent,
        completedEvent,
        failedEvent,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            `${stage} callback`
        );

        const traceContext =
            this.createContext(
                stage,
                context
            );

        const execute =
            async (
                span,
                childContext = {}
            ) => {

                const operationContext =
                    this.mergeContext(
                        traceContext,
                        childContext
                    );

                this.emitEvent(
                    span,
                    startedEvent,
                    this.createLifecycleMetadata(
                        operationContext
                    )
                );

                try {

                    const result =
                        await callback(
                            span,
                            operationContext
                        );

                    this.emitEvent(
                        span,
                        completedEvent,
                        this.createLifecycleMetadata(
                            operationContext
                        )
                    );

                    return result;

                } catch (error) {

                    this.emitEvent(
                        span,
                        failedEvent,
                        {
                            ...this.createLifecycleMetadata(
                                operationContext
                            ),

                            errorCode:
                                error?.code ||
                                null
                        }
                    );

                    throw error;
                }
            };

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return execute(
                null,
                traceContext
            );
        }

        try {

            if (
                parentSpan &&
                isFunction(
                    this.financeTracing
                        .traceChild
                )
            ) {

                return await this.financeTracing
                    .traceChild(
                        parentSpan,
                        `statement.${stage}`,
                        execute,
                        traceContext
                    );
            }

            return await this.traceStandaloneStage(
                stage,
                execute,
                traceContext
            );

        } catch (error) {

            throw error;
        }
    }

    /* ========================================================================
     * Standalone Stage Trace
     * ====================================================================== */

    async traceStandaloneStage(
        stage,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            `Standalone ${stage} callback`
        );

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                context
            );
        }

        switch (stage) {

            case PIPELINE_STAGES.IMPORT:

                return this.financeTracing
                    .traceStatementImport(
                        callback,
                        context
                    );

            case PIPELINE_STAGES.NORMALIZE:

                return this.financeTracing
                    .traceStatementNormalization(
                        callback,
                        context
                    );

            case PIPELINE_STAGES.VALIDATE:

                return this.financeTracing
                    .traceStatementValidation(
                        callback,
                        context
                    );

            case PIPELINE_STAGES.PERSIST:

                return this.financeTracing
                    .traceStatementPersistence(
                        callback,
                        context
                    );

            case PIPELINE_STAGES.BATCH:

                return this.financeTracing
                    .traceStatementBatch(
                        callback,
                        context
                    );

            default:

                return this.financeTracing
                    .traceStatementProcessing(
                        callback,
                        context
                    );
        }
    }

    /* ========================================================================
     * Repository Operation Trace
     * ====================================================================== */

    async repository(
        parentSpan,
        operation,
        callback,
        context = {}
    ) {

        this.assertCallback(
            callback,
            'Repository callback'
        );

        const normalizedOperation =
            this.normalizeOperation(
                operation
            );

        this.statistics
            .repositoryOperations++;

        const traceContext =
            this.createContext(
                PIPELINE_STAGES.PERSIST,
                {
                    ...context,

                    repositoryOperation:
                        normalizedOperation
                }
            );

        const execute =
            async (
                span,
                operationContext = {}
            ) => {

                this.emitEvent(
                    span,
                    EVENTS.REPOSITORY_OPERATION_STARTED,
                    {
                        operation:
                            normalizedOperation
                    }
                );

                try {

                    const result =
                        await callback(
                            span,
                            operationContext
                        );

                    this.emitEvent(
                        span,
                        EVENTS.REPOSITORY_OPERATION_COMPLETED,
                        {
                            operation:
                                normalizedOperation
                        }
                    );

                    return result;

                } catch (error) {

                    this.emitEvent(
                        span,
                        EVENTS.REPOSITORY_OPERATION_FAILED,
                        {
                            operation:
                                normalizedOperation,

                            errorCode:
                                error?.code ||
                                null
                        }
                    );

                    throw error;
                }
            };

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return execute(
                null,
                traceContext
            );
        }

        if (
            parentSpan &&
            isFunction(
                this.financeTracing
                    .traceChild
            )
        ) {

            return this.financeTracing
                .traceChild(
                    parentSpan,
                    `statement.repository.${normalizedOperation}`,
                    execute,
                    traceContext
                );
        }

        if (
            isFunction(
                this.financeTracing
                    .traceRepository
            )
        ) {

            return this.financeTracing
                .traceRepository(
                    normalizedOperation,
                    execute,
                    {
                        ...traceContext,

                        repository:
                            context.repository ||
                            'statement'
                    }
                );
        }

        /*
         * Last-resort fallback to the generic Finance tracing API.
         */
        return this.financeTracing
            .trace(
                `repository.${normalizedOperation}`,
                execute,
                traceContext
            );
    }

    /* ========================================================================
     * Idempotency
     * ====================================================================== */

    idempotencyCheckStarted(
        span,
        context = {}
    ) {

        return this.emitEvent(
            span,
            EVENTS.IDEMPOTENCY_CHECK_STARTED,
            {
                idempotencyKey:
                    this.resolveIdempotencyKey(
                        context.idempotencyKey
                    ),

                operationKey:
                    this.resolveOperationKey(
                        context.operationKey
                    ),

                statementId:
                    context.statementId ||
                    null
            }
        );
    }

    idempotencyHit(
        span,
        context = {}
    ) {

        this.statistics
            .idempotencyHits++;

        const idempotencyKey =
            this.resolveIdempotencyKey(
                context.idempotencyKey
            );

        try {

            if (
                isFunction(
                    this.financeTracing
                        ?.idempotencyHit
                )
            ) {

                this.financeTracing
                    .idempotencyHit(
                        span,
                        idempotencyKey,
                        {
                            operationKey:
                                this.resolveOperationKey(
                                    context.operationKey
                                ),

                            statementId:
                                context.statementId ||
                                null
                        }
                    );
            }

        } catch (error) {

            this.handleTracingFailure(
                error,
                'idempotency.hit'
            );
        }

        this.emitEvent(
            span,
            EVENTS.IDEMPOTENCY_HIT,
            {
                statementId:
                    context.statementId ||
                    null
            }
        );

        this.incrementMetric(
            'statement_idempotency_hits_total'
        );
    }

    idempotencyMiss(
        span,
        context = {}
    ) {

        this.statistics
            .idempotencyMisses++;

        const idempotencyKey =
            this.resolveIdempotencyKey(
                context.idempotencyKey
            );

        try {

            if (
                isFunction(
                    this.financeTracing
                        ?.idempotencyMiss
                )
            ) {

                this.financeTracing
                    .idempotencyMiss(
                        span,
                        idempotencyKey,
                        {
                            operationKey:
                                this.resolveOperationKey(
                                    context.operationKey
                                ),

                            statementId:
                                context.statementId ||
                                null
                        }
                    );
            }

        } catch (error) {

            this.handleTracingFailure(
                error,
                'idempotency.miss'
            );
        }

        this.emitEvent(
            span,
            EVENTS.IDEMPOTENCY_MISS,
            {
                statementId:
                    context.statementId ||
                    null
            }
        );

        this.incrementMetric(
            'statement_idempotency_misses_total'
        );
    }

    idempotencyConflict(
        span,
        context = {}
    ) {

        this.statistics
            .idempotencyConflicts++;

        this.emitEvent(
            span,
            EVENTS.IDEMPOTENCY_CONFLICT,
            {
                operationKey:
                    this.resolveOperationKey(
                        context.operationKey
                    ),

                statementId:
                    context.statementId ||
                    null
            }
        );

        this.incrementMetric(
            'statement_idempotency_conflicts_total'
        );
    }

    /* ========================================================================
     * Retry Handling
     * ====================================================================== */

    retryScheduled(
        span,
        {
            attempt,
            delayMs,
            error,
            maxAttempts,
            context = {}
        } = {}
    ) {

        this.statistics.retries++;

        const normalizedAttempt =
            this.normalizeNonNegativeNumber(
                attempt
            );

        const normalizedDelay =
            this.normalizeNonNegativeNumber(
                delayMs
            );

        const normalizedMaxAttempts =
            this.normalizeNonNegativeNumber(
                maxAttempts
            );

        this.emitEvent(
            span,
            EVENTS.RETRY_SCHEDULED,
            {
                attempt:
                    normalizedAttempt,

                delayMs:
                    normalizedDelay,

                maxAttempts:
                    normalizedMaxAttempts,

                errorCode:
                    error?.code ||
                    null,

                stage:
                    context.stage ||
                    null
            }
        );

        try {

            if (
                isFunction(
                    this.financeTracing
                        ?.retryAttempt
                )
            ) {

                this.financeTracing
                    .retryAttempt(
                        span,
                        normalizedAttempt,
                        normalizedDelay,
                        error
                    );
            }

        } catch (tracingError) {

            this.handleTracingFailure(
                tracingError,
                'retry.scheduled'
            );
        }

        this.incrementMetric(
            'statement_processing_retries_total',
            {
                stage:
                    context.stage ||
                    'unknown'
            }
        );
    }

    retryAttempt(
        span,
        {
            attempt,
            context = {}
        } = {}
    ) {

        this.emitEvent(
            span,
            EVENTS.RETRY_ATTEMPT,
            {
                attempt:
                    this.normalizeNonNegativeNumber(
                        attempt
                    ),

                stage:
                    context.stage ||
                    null
            }
        );
    }

    retryExhausted(
        span,
        {
            attempts,
            error,
            context = {}
        } = {}
    ) {

        this.emitEvent(
            span,
            EVENTS.RETRY_EXHAUSTED,
            {
                attempts:
                    this.normalizeNonNegativeNumber(
                        attempts
                    ),

                errorCode:
                    error?.code ||
                    null,

                stage:
                    context.stage ||
                    null
            }
        );

        this.incrementMetric(
            'statement_processing_retry_exhausted_total',
            {
                stage:
                    context.stage ||
                    'unknown'
            }
        );
    }

    /* ========================================================================
     * Provider Correlation
     * ====================================================================== */

    correlateProviderStatement(
        span,
        context = {}
    ) {

        if (
            !this.config
                .includeProviderCorrelation
        ) {
            return false;
        }

        const metadata = {
            provider:
                context.provider ||
                null,

            providerStatementId:
                this.sanitizeIdentifier(
                    context.providerStatementId
                ),

            providerBatchId:
                this.sanitizeIdentifier(
                    context.providerBatchId
                ),

            providerReference:
                this.resolveProviderReference(
                    context.providerReference
                ),

            externalReference:
                this.resolveProviderReference(
                    context.externalReference
                ),

            statementId:
                context.statementId ||
                null
        };

        this.statistics
            .providerCorrelations++;

        this.emitEvent(
            span,
            EVENTS.PROVIDER_CORRELATED,
            metadata
        );

        this.addAttributes(
            span,
            {
                'statement.provider':
                    metadata.provider,

                'statement.providerStatementId':
                    metadata.providerStatementId,

                'statement.providerBatchId':
                    metadata.providerBatchId,

                'statement.providerReference':
                    metadata.providerReference
            }
        );

        this.incrementMetric(
            'statement_provider_correlations_total',
            {
                provider:
                    metadata.provider ||
                    'unknown'
            }
        );

        return true;
    }

    providerReferenceMatched(
        span,
        context = {}
    ) {

        this.statistics
            .providerReferenceMatches++;

        this.emitEvent(
            span,
            EVENTS.PROVIDER_REFERENCE_MATCHED,
            {
                provider:
                    context.provider ||
                    null,

                providerReference:
                    this.resolveProviderReference(
                        context.providerReference
                    ),

                statementId:
                    context.statementId ||
                    null
            }
        );

        this.incrementMetric(
            'statement_provider_reference_matches_total'
        );

        return true;
    }

    providerReferenceMissing(
        span,
        context = {}
    ) {

        this.statistics
            .providerReferenceMisses++;

        this.emitEvent(
            span,
            EVENTS.PROVIDER_REFERENCE_MISSING,
            {
                provider:
                    context.provider ||
                    null,

                statementId:
                    context.statementId ||
                    null
            }
        );

        this.incrementMetric(
            'statement_provider_reference_missing_total'
        );

        return true;
    }

    /* ========================================================================
     * Batch Progress
     * ====================================================================== */

    batchProgress(
        span,
        {
            processed,
            total,
            succeeded,
            failed,
            skipped,
            context = {}
        } = {}
    ) {

        if (
            !this.config
                .emitBatchProgressEvents
        ) {
            return false;
        }

        if (!span) {
            return false;
        }

        const limit =
            Math.max(
                0,
                Number(
                    this.config
                        .maxBatchProgressEvents
                ) || 0
            );

        let state =
            this.batchProgressCounters
                .get(span);

        if (!state) {
            state = {
                emitted: 0,
                suppressed: 0
            };

            this.batchProgressCounters
                .set(
                    span,
                    state
                );
        }

        if (
            limit > 0 &&
            state.emitted >= limit
        ) {
            state.suppressed++;

            this.statistics
                .batchProgressSuppressed++;

            return false;
        }

        const progress =
            this.normalizeBatchProgress(
                {
                    processed,
                    total,
                    succeeded,
                    failed,
                    skipped
                }
            );

        const percentage =
            this.calculateBatchPercentage(
                progress.processed,
                progress.total
            );

        this.emitEvent(
            span,
            EVENTS.BATCH_PROGRESS,
            {
                ...progress,

                percentage,

                batchId:
                    context.batchId ||
                    null,

                stage:
                    context.stage ||
                    PIPELINE_STAGES.BATCH
            }
        );

        if (
            percentage !== null
        ) {
            this.addAttribute(
                span,
                'statement.batch.progressPercent',
                percentage
            );
        }

        state.emitted++;

        this.statistics
            .batchProgressEvents++;

        return true;
    }

    calculateBatchPercentage(
        processed,
        total
    ) {

        if (
            !Number.isFinite(
                processed
            ) ||
            !Number.isFinite(
                total
            ) ||
            total <= 0
        ) {
            return null;
        }

        return normalizePercentage(
            (
                processed /
                total
            ) * 100
        );
    }

    normalizeBatchProgress(
        {
            processed,
            total,
            succeeded,
            failed,
            skipped
        } = {}
    ) {

        return {
            processed:
                normalizeCount(
                    processed
                ),

            total:
                normalizeCount(
                    total
                ),

            succeeded:
                normalizeCount(
                    succeeded
                ),

            failed:
                normalizeCount(
                    failed
                ),

            skipped:
                normalizeCount(
                    skipped
                )
        };
    }

    /* ========================================================================
     * Context Creation
     * ====================================================================== */

    createContext(
        stage,
        context = {}
    ) {

        const pipelineId =
            context.pipelineId ||
            (
                this.config
                    .generatePipelineId
                    ? generateId()
                    : null
            );

        const statementTraceId =
            context.statementTraceId ||
            (
                this.config
                    .generateStatementTraceId
                    ? generateId()
                    : null
            );

        const correlationId =
            context.correlationId ||
            (
                this.config
                    .generateCorrelationId
                    ? generateId()
                    : null
            );

        return {
            ...this.sanitizeContext(
                context
            ),

            stage,

            pipelineId,

            statementTraceId,

            correlationId,

            tenantId:
                context.tenantId ||
                null,

            statementId:
                context.statementId ||
                null,

            batchId:
                context.batchId ||
                null,

            requestId:
                context.requestId ||
                null,

            transactionId:
                context.transactionId ||
                context.financialTransactionId ||
                null,

            provider:
                context.provider ||
                null,

            providerStatementId:
                this.sanitizeIdentifier(
                    context.providerStatementId
                ),

            providerBatchId:
                this.sanitizeIdentifier(
                    context.providerBatchId
                ),

            operationKey:
                this.resolveOperationKey(
                    context.operationKey
                ),

            idempotencyKey:
                this.resolveIdempotencyKey(
                    context.idempotencyKey
                ),

            traceId:
                context.traceId ||
                null,

            parentSpanId:
                context.parentSpanId ||
                null
        };
    }

    /* ========================================================================
     * Context Merge
     * ====================================================================== */

    mergeContext(
        base = {},
        additional = {}
    ) {

        return {
            ...this.sanitizeContext(
                base
            ),

            ...this.sanitizeContext(
                additional
            ),

            pipelineId:
                additional.pipelineId ||
                base.pipelineId ||
                null,

            statementTraceId:
                additional.statementTraceId ||
                base.statementTraceId ||
                null,

            tenantId:
                additional.tenantId ||
                base.tenantId ||
                null,

            statementId:
                additional.statementId ||
                base.statementId ||
                null,

            batchId:
                additional.batchId ||
                base.batchId ||
                null,

            correlationId:
                additional.correlationId ||
                base.correlationId ||
                null,

            requestId:
                additional.requestId ||
                base.requestId ||
                null,

            traceId:
                additional.traceId ||
                base.traceId ||
                null,

            parentSpanId:
                additional.parentSpanId ||
                base.parentSpanId ||
                null,

            transactionId:
                additional.transactionId ||
                base.transactionId ||
                null,

            provider:
                additional.provider ||
                base.provider ||
                null
        };
    }

    /* ========================================================================
     * Lifecycle Metadata
     * ====================================================================== */

    createLifecycleMetadata(
        context = {}
    ) {

        const metadata = {
            pipelineId:
                context.pipelineId ||
                null,

            statementTraceId:
                context.statementTraceId ||
                null,

            stage:
                context.stage ||
                null,

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

            operationKey:
                this.resolveOperationKey(
                    context.operationKey
                )
        };

        if (
            this.config.includeCounts
        ) {

            const countKeys = [
                'totalRecords',
                'processedRecords',
                'successfulRecords',
                'failedRecords',
                'skippedRecords',
                'validRecords',
                'invalidRecords'
            ];

            for (
                const key of countKeys
            ) {

                const normalized =
                    normalizeCount(
                        context[key]
                    );

                if (
                    normalized !== null
                ) {
                    metadata[key] =
                        normalized;
                }
            }
        }

        return metadata;
    }

    /* ========================================================================
     * Metadata Sanitization
     * ====================================================================== */

    sanitizeMetadata(
        metadata = {}
    ) {

        if (
            !metadata ||
            typeof metadata !==
            'object'
        ) {
            return {};
        }

        const output = {};
        let count = 0;

        const maxKeys =
            Math.max(
                0,
                Number(
                    this.config
                        .maxMetadataKeys
                ) || 0
            );

        for (
            const [key, value]
            of Object.entries(
                metadata
            )
        ) {

            if (
                count >= maxKeys
            ) {
                break;
            }

            if (
                this.isReservedKey(
                    key
                )
            ) {
                continue;
            }

            if (
                !this.config
                    .includeHighCardinalityMetadata &&
                isHighCardinalityKey(
                    key
                )
            ) {
                continue;
            }

            output[key] =
                this.sanitizeValue(
                    value
                );

            count++;
        }

        return output;
    }

    sanitizeContext(
        context = {}
    ) {

        if (
            !context ||
            typeof context !==
            'object'
        ) {
            return {};
        }

        const safe = {};

        for (
            const [key, value]
            of Object.entries(
                context
            )
        ) {

            if (
                this.isReservedKey(
                    key
                )
            ) {
                continue;
            }

            if (
                !this.config
                    .includeHighCardinalityMetadata &&
                isHighCardinalityKey(
                    key
                )
            ) {
                continue;
            }

            safe[key] =
                this.sanitizeValue(
                    value
                );
        }

        return safe;
    }

    sanitizeValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            typeof value ===
            'string'
        ) {
            return sanitizeString(
                value,
                this.config
                    .maxMetadataStringLength
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
            value instanceof Error
        ) {
            return normalizeError(
                value
            );
        }

        if (
            Array.isArray(value)
        ) {

            return value
                .slice(
                    0,
                    this.config
                        .maxArrayItems
                )
                .map(
                    item =>
                        this.sanitizeValue(
                            item
                        )
                );
        }

        if (
            typeof value ===
            'object'
        ) {

            /*
             * Preserve small structured objects while limiting keys.
             * This avoids silently turning every nested object into an
             * unbounded serialized string.
             */
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
                    this.config
                        .maxMetadataKeys
                ) {
                    break;
                }

                if (
                    this.isReservedKey(
                        key
                    )
                ) {
                    continue;
                }

                if (
                    !this.config
                        .includeHighCardinalityMetadata &&
                    isHighCardinalityKey(
                        key
                    )
                ) {
                    continue;
                }

                nested[key] =
                    this.sanitizeValue(
                        nestedValue
                    );

                count++;
            }

            return nested;
        }

        return sanitizeString(
            value,
            this.config
                .maxMetadataStringLength
        );
    }

    isReservedKey(
        key
    ) {

        if (
            RESERVED_METADATA.has(
                key
            )
        ) {
            return true;
        }

        return (
            isSensitiveKey(
                key
            ) &&
            !this.config
                .allowSensitiveMetadata
        );
    }

    /* ========================================================================
     * Safe Attribute Helpers
     * ====================================================================== */

    addAttribute(
        span,
        key,
        value
    ) {

        if (
            !span ||
            !this.financeTracing ||
            !key
        ) {
            return false;
        }

        if (
            this.isReservedKey(
                key
            )
        ) {
            return false;
        }

        try {

            const sanitized =
                this.sanitizeValue(
                    value
                );

            if (
                !isFunction(
                    this.financeTracing
                        .addAttribute
                )
            ) {
                return false;
            }

            return (
                this.financeTracing
                    .addAttribute(
                        span,
                        key,
                        sanitized
                    ) ??
                false
            );

        } catch (error) {

            this.handleTracingFailure(
                error,
                'attribute'
            );

            return false;
        }
    }

    addAttributes(
        span,
        attributes = {}
    ) {

        const safe =
            this.sanitizeMetadata(
                attributes
            );

        for (
            const [key, value]
            of Object.entries(
                safe
            )
        ) {

            this.addAttribute(
                span,
                key,
                value
            );
        }
    }

    /* ========================================================================
     * Safe Event Emission
     * ====================================================================== */

    emitEvent(
        span,
        eventName,
        metadata = {}
    ) {

        if (
            !this.config
                .emitLifecycleEvents ||
            !span ||
            !eventName
        ) {
            return false;
        }

        try {

            if (
                !isFunction(
                    this.financeTracing
                        ?.addEvent
                )
            ) {
                return false;
            }

            return (
                this.financeTracing
                    .addEvent(
                        span,
                        eventName,
                        this.sanitizeMetadata(
                            metadata
                        )
                    ) ??
                false
            );

        } catch (error) {

            this.handleTracingFailure(
                error,
                eventName
            );

            return false;
        }
    }

    /* ========================================================================
     * Identifier Protection
     * ====================================================================== */

    resolveIdempotencyKey(
        idempotencyKey
    ) {

        if (
            !idempotencyKey
        ) {
            return null;
        }

        if (
            !this.config
                .redactIdempotencyKey
        ) {
            return sanitizeString(
                idempotencyKey,
                this.config
                    .maxMetadataStringLength
            );
        }

        return this.hashIdentifier(
            idempotencyKey
        );
    }

    resolveOperationKey(
        operationKey
    ) {

        if (
            !operationKey
        ) {
            return null;
        }

        if (
            !this.config
                .redactOperationKey
        ) {
            return sanitizeString(
                operationKey,
                this.config
                    .maxMetadataStringLength
            );
        }

        return this.hashIdentifier(
            operationKey
        );
    }

    resolveProviderReference(
        reference
    ) {

        if (
            !reference
        ) {
            return null;
        }

        if (
            !this.config
                .redactProviderReference
        ) {
            return sanitizeString(
                reference,
                this.config
                    .maxMetadataStringLength
            );
        }

        return this.hashIdentifier(
            reference
        );
    }

    sanitizeIdentifier(
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return null;
        }

        return sanitizeString(
            value,
            256
        );
    }

    hashIdentifier(
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return null;
        }

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                String(value),
                'utf8'
            )
            .digest(
                'hex'
            );
    }

    /* ========================================================================
     * Tracing Availability
     * ====================================================================== */

    isTracingAvailable() {

        return Boolean(
            this.config.enabled &&
            this.financeTracing
        );
    }

    /* ========================================================================
     * Callback validation
     * ====================================================================== */

    assertCallback(
        callback,
        message
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                `${message} must be a function`
            );
        }
    }

    normalizeOperation(
        operation
    ) {

        const normalized =
            String(
                operation ||
                'operation'
            )
                .trim()
                .replace(
                    /\s+/g,
                    '.'
                )
                .replace(
                    /[^a-zA-Z0-9._:-]/g,
                    ''
                )
                .slice(
                    0,
                    this.config
                        .maxOperationLength
                );

        return (
            normalized ||
            'operation'
        );
    }

    normalizeNonNegativeNumber(
        value
    ) {

        const number =
            Number(value);

        if (
            !Number.isFinite(
                number
            )
        ) {
            return null;
        }

        return Math.max(
            0,
            number
        );
    }

    /* ========================================================================
     * Metrics
     * ====================================================================== */

    incrementMetric(
        metric,
        labels = {}
    ) {

        try {

            if (
                isFunction(
                    this.metrics
                        ?.increment
                )
            ) {

                this.metrics.increment(
                    metric,
                    labels
                );

                return true;
            }

            if (
                isFunction(
                    this.metrics?.inc
                )
            ) {

                this.metrics.inc(
                    metric,
                    labels
                );

                return true;
            }

            return false;

        } catch (error) {

            try {

                this.logger
                    ?.warn?.(
                        '[StatementTracing] Metrics failure isolated',
                        {
                            metric,

                            error:
                                normalizeError(
                                    error
                                )
                        }
                    );

            } catch (_) {
                // Metrics and logging are never allowed to affect processing.
            }

            return false;
        }
    }

    /* ========================================================================
     * Tracing Failure Isolation
     * ====================================================================== */

    handleTracingFailure(
        error,
        operation
    ) {

        this.statistics
            .tracingFailures++;

        try {

            this.logger
                ?.warn?.(
                    '[StatementTracing] Observability failure isolated',
                    {
                        operation,

                        error:
                            normalizeError(
                                error
                            )
                    }
                );

        } catch (_) {
            // Ignore logger failures.
        }

        this.incrementMetric(
            'statement_tracing_failures_total',
            {
                operation:
                    operation ||
                    'unknown'
            }
        );
    }

    /* ========================================================================
     * Statistics
     * ====================================================================== */

    getStatistics() {

        return {
            ...this.statistics,

            tracingEnabled:
                this.isTracingAvailable(),

            financeTracingStatistics:
                this.financeTracing
                    ?.getStatistics?.() ||
                null
        };
    }

    /* ========================================================================
     * Diagnostics / Health
     * ====================================================================== */

    diagnostics() {

        return {
            module:
                'statement-processing-tracing',

            enabled:
                this.config.enabled,

            failOpen:
                this.config.failOpen,

            tracingAvailable:
                this.isTracingAvailable(),

            providerCorrelationEnabled:
                this.config
                    .includeProviderCorrelation,

            batchProgressEventsEnabled:
                this.config
                    .emitBatchProgressEvents,

            maxBatchProgressEvents:
                this.config
                    .maxBatchProgressEvents,

            idempotencyRedaction:
                this.config
                    .redactIdempotencyKey,

            providerReferenceRedaction:
                this.config
                    .redactProviderReference,

            operationKeyRedaction:
                this.config
                    .redactOperationKey,

            highCardinalityMetadata:
                this.config
                    .includeHighCardinalityMetadata,

            statistics:
                this.getStatistics(),

            timestamp:
                new Date().toISOString()
        };
    }

    health() {

        const tracingAvailable =
            this.isTracingAvailable();

        const healthy =
            tracingAvailable ||
            this.config.failOpen;

        return {
            status:
                healthy
                    ? 'healthy'
                    : 'degraded',

            healthy,

            enabled:
                this.config.enabled,

            failOpen:
                this.config.failOpen,

            tracingAvailable,

            timestamp:
                new Date().toISOString()
        };
    }

    /* ========================================================================
     * Factory
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new StatementTracing(
            options
        );
    }
}

/* ============================================================================
 * Static Exports
 * ========================================================================== */

StatementTracing.Stages =
    PIPELINE_STAGES;

StatementTracing.Events =
    EVENTS;

StatementTracing.normalizeError =
    normalizeError;

StatementTracing.generateId =
    generateId;

/* ============================================================================
 * Module Export
 * ========================================================================== */

module.exports =
    StatementTracing;