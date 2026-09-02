'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Tracing Adapter
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/observability/FinanceTracingAdapter.js
 *
 * Purpose:
 *   Enterprise Finance-domain abstraction over TransactionTracer.
 *
 * The adapter provides a stable contract for Finance Core services while
 * keeping the underlying tracing implementation replaceable.
 *
 * Supported Finance Domains
 * ----------------------------------------------------------------------------
 *
 *   - Ledger posting
 *   - Journal processing
 *   - Financial reversals
 *   - Balance calculation
 *   - Financial snapshots
 *   - Financial period lifecycle
 *   - Statement import / processing / validation / normalization / persistence
 *   - Statement batch coordination
 *   - Reconciliation
 *   - Settlement
 *   - Payment processing
 *   - Provider calls
 *   - Loan disbursement / repayment / reversal
 *   - Repository / database operations
 *   - Event publishing / consumption
 *
 * Enterprise Guarantees
 * ----------------------------------------------------------------------------
 *
 *   - Tracing NEVER owns financial business state.
 *   - Tracing failures NEVER suppress business errors.
 *   - Optional tracer methods are safely delegated.
 *   - Sensitive context values are filtered by default.
 *   - High-cardinality payloads are bounded / omitted.
 *   - Correlation and tenant identity remain explicit.
 *   - Parent / child context is preserved where supported.
 *   - Async and sync operations are supported.
 *   - No-op mode is supported.
 *   - Deterministic operation IDs are caller-overridable.
 *   - Runtime configuration is supported.
 *   - Metrics/logging failures are isolated.
 *
 * IMPORTANT:
 *   This adapter does NOT initialize OpenTelemetry or any global tracing SDK.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const FINANCE_OPERATIONS = Object.freeze({
    // ------------------------------------------------------------------------
    // Ledger
    // ------------------------------------------------------------------------

    LEDGER_POST: 'ledger.post',
    LEDGER_VALIDATE: 'ledger.validate',
    LEDGER_BALANCE: 'ledger.balance',
    LEDGER_REVERSE: 'ledger.reverse',
    LEDGER_ADJUST: 'ledger.adjust',

    // ------------------------------------------------------------------------
    // Journal
    // ------------------------------------------------------------------------

    JOURNAL_CREATE: 'journal.create',
    JOURNAL_POST: 'journal.post',
    JOURNAL_REVERSE: 'journal.reverse',

    // ------------------------------------------------------------------------
    // Balance
    // ------------------------------------------------------------------------

    BALANCE_CALCULATE: 'balance.calculate',
    BALANCE_RECALCULATE: 'balance.recalculate',
    BALANCE_VERIFY: 'balance.verify',

    // ------------------------------------------------------------------------
    // Snapshots
    // ------------------------------------------------------------------------

    SNAPSHOT_CREATE: 'snapshot.create',
    SNAPSHOT_REBUILD: 'snapshot.rebuild',

    // ------------------------------------------------------------------------
    // Financial Period
    // ------------------------------------------------------------------------

    PERIOD_OPEN: 'period.open',
    PERIOD_LOCK: 'period.lock',
    PERIOD_CLOSE: 'period.close',
    PERIOD_REOPEN: 'period.reopen',
    PERIOD_ADJUST: 'period.adjust',

    // ------------------------------------------------------------------------
    // Statement Processing
    // ------------------------------------------------------------------------

    STATEMENT_PROCESS: 'statement.process',
    STATEMENT_IMPORT: 'statement.import',
    STATEMENT_VALIDATE: 'statement.validate',
    STATEMENT_NORMALIZE: 'statement.normalize',
    STATEMENT_PERSIST: 'statement.persist',
    STATEMENT_BATCH: 'statement.batch',

    // ------------------------------------------------------------------------
    // Reconciliation
    // ------------------------------------------------------------------------

    RECONCILIATION_RUN: 'reconciliation.run',
    RECONCILIATION_MATCH: 'reconciliation.match',
    RECONCILIATION_EXCEPTION: 'reconciliation.exception',

    // ------------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------------

    SETTLEMENT_PROCESS: 'settlement.process',
    SETTLEMENT_VERIFY: 'settlement.verify',
    SETTLEMENT_REVERSE: 'settlement.reverse',

    // ------------------------------------------------------------------------
    // Payments
    // ------------------------------------------------------------------------

    PAYMENT_COLLECT: 'payment.collect',
    PAYMENT_PAYOUT: 'payment.payout',
    PAYMENT_VERIFY: 'payment.verify',
    PAYMENT_WEBHOOK: 'payment.webhook',

    // ------------------------------------------------------------------------
    // Loans
    // ------------------------------------------------------------------------

    LOAN_DISBURSE: 'loan.disburse',
    LOAN_REPAYMENT: 'loan.repayment',
    LOAN_REVERSE: 'loan.reverse',

    // ------------------------------------------------------------------------
    // Repository / Database
    // ------------------------------------------------------------------------

    REPOSITORY_CREATE: 'repository.create',
    REPOSITORY_READ: 'repository.read',
    REPOSITORY_UPDATE: 'repository.update',
    REPOSITORY_DELETE: 'repository.delete',
    REPOSITORY_QUERY: 'repository.query',

    // ------------------------------------------------------------------------
    // Messaging
    // ------------------------------------------------------------------------

    EVENT_PUBLISH: 'event.publish',
    EVENT_CONSUME: 'event.consume'
});

const FINANCE_EVENTS = Object.freeze({
    STARTED: 'finance.operation.started',
    COMPLETED: 'finance.operation.completed',
    FAILED: 'finance.operation.failed',

    VALIDATION_STARTED: 'finance.validation.started',
    VALIDATION_COMPLETED: 'finance.validation.completed',
    VALIDATION_FAILED: 'finance.validation.failed',

    PERSISTENCE_STARTED: 'finance.persistence.started',
    PERSISTENCE_COMPLETED: 'finance.persistence.completed',
    PERSISTENCE_FAILED: 'finance.persistence.failed',

    BATCH_STARTED: 'finance.batch.started',
    BATCH_COMPLETED: 'finance.batch.completed',
    BATCH_FAILED: 'finance.batch.failed',

    RETRY: 'finance.retry',
    TIMEOUT: 'finance.timeout',
    STATE_CHANGED: 'finance.state.changed',

    IDEMPOTENCY_HIT: 'finance.idempotency.hit',
    IDEMPOTENCY_MISS: 'finance.idempotency.miss',

    CHILD_STARTED: 'finance.child.started',
    CHILD_COMPLETED: 'finance.child.completed',
    CHILD_FAILED: 'finance.child.failed'
});

const DEFAULTS = Object.freeze({
    enabled: true,

    serviceName:
        process.env.FINANCE_SERVICE_NAME ||
        process.env.OTEL_SERVICE_NAME ||
        'finance-core',

    environment:
        process.env.FINANCE_ENVIRONMENT ||
        process.env.NODE_ENV ||
        'development',

    version:
        process.env.APP_VERSION ||
        process.env.npm_package_version ||
        '1.0.0',

    generateCorrelationId: true,
    generateOperationId: true,

    emitLifecycleEvents: true,
    emitIdempotencyEvents: true,

    propagateContext: true,

    includeOperationResultMetadata: false,

    includeHighCardinalityMetadata: false,

    maxAttributeLength: 512,
    maxEventAttributeLength: 512,
    maxArrayItems: 20,

    /*
     * Observability is fail-open by default.
     * Business logic errors still propagate normally.
     */
    failOpen: true,

    /*
     * Prevent accidental logging of sensitive payloads.
     */
    allowSensitiveTracing: false,

    /*
     * Automatically attach core business identifiers when present.
     */
    tenantAware: true,
    correlationAware: true
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
    /password/i,
    /passcode/i,
    /secret/i,
    /private.?key/i,
    /access.?token/i,
    /refresh.?token/i,
    /authorization/i,
    /cookie/i,
    /session/i,
    /credential/i,
    /signature/i,
    /otp/i,
    /pin/i,
    /cvv/i,
    /security.?code/i,
    /card.?number/i,
    /national.?id/i,
    /identity.?number/i
]);

const HIGH_CARDINALITY_KEY_PATTERNS = Object.freeze([
    /raw.?payload/i,
    /request.?body/i,
    /response.?body/i,
    /headers?/i,
    /metadata/i,
    /document/i,
    /documents/i,
    /records/i,
    /entries/i,
    /transactions/i,
    /items/i,
    /stack/i,
    /query/i,
    /email/i,
    /phone/i,
    /address/i
]);

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function generateId() {
    if (
        typeof crypto.randomUUID === 'function'
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
                truncate(
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
            truncate(
                String(error)
            ),

        code: null,
        status: null
    };
}

function isFunction(value) {
    return typeof value === 'function';
}

function isPromise(value) {
    return (
        value !== null &&
        value !== undefined &&
        typeof value.then === 'function'
    );
}

function truncate(
    value,
    maxLength = DEFAULTS.maxAttributeLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    const normalized = String(value);

    if (
        normalized.length <= maxLength
    ) {
        return normalized;
    }

    return `${normalized.slice(
        0,
        Math.max(0, maxLength - 3)
    )}...`;
}

function normalizeOperation(operation) {
    const value =
        operation === undefined ||
        operation === null
            ? 'unknown'
            : String(operation);

    return value
        .trim()
        .replace(/\s+/g, '.')
        .replace(
            /[^a-zA-Z0-9._:-]/g,
            ''
        )
        .slice(0, 200) ||
        'unknown';
}

function isSensitiveKey(key) {
    if (!key) {
        return false;
    }

    return SENSITIVE_KEY_PATTERNS.some(
        pattern =>
            pattern.test(
                String(key)
            )
    );
}

function isHighCardinalityKey(key) {
    if (!key) {
        return false;
    }

    return HIGH_CARDINALITY_KEY_PATTERNS.some(
        pattern =>
            pattern.test(
                String(key)
            )
    );
}

function serializeTraceValue(
    value,
    config
) {
    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (
        typeof value === 'string'
    ) {
        return truncate(
            value,
            config.maxAttributeLength
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof Error) {
        return truncate(
            value.message,
            config.maxAttributeLength
        );
    }

    if (Array.isArray(value)) {
        return value
            .slice(
                0,
                config.maxArrayItems
            )
            .map(item =>
                serializeTraceValue(
                    item,
                    config
                )
            );
    }

    try {
        return truncate(
            JSON.stringify(value),
            config.maxAttributeLength
        );
    }
    catch (_error) {
        return '[unserializable]';
    }
}

function sanitizeMetadata(
    metadata = {},
    config = DEFAULTS,
    options = {}
) {
    if (
        metadata === null ||
        typeof metadata !== 'object'
    ) {
        return {};
    }

    const output = {};

    for (
        const [key, value] of
        Object.entries(metadata)
    ) {
        if (!key) {
            continue;
        }

        const sensitive =
            isSensitiveKey(key);

        if (
            sensitive &&
            !(
                config.allowSensitiveTracing &&
                options.allowSensitive === true
            )
        ) {
            continue;
        }

        if (
            !config.includeHighCardinalityMetadata &&
            isHighCardinalityKey(key)
        ) {
            continue;
        }

        const serialized =
            serializeTraceValue(
                value,
                {
                    maxAttributeLength:
                        options.event
                            ? config.maxEventAttributeLength
                            : config.maxAttributeLength,

                    maxArrayItems:
                        config.maxArrayItems
                }
            );

        if (
            serialized !== undefined
        ) {
            output[
                truncate(
                    key,
                    128
                )
            ] = serialized;
        }
    }

    return output;
}

function sanitizeContext(
    context = {},
    config = DEFAULTS
) {
    return sanitizeMetadata(
        context,
        config,
        {
            allowSensitive: false,
            event: false
        }
    );
}

function createNoopSpan(
    operation
) {
    return {
        name:
            normalizeOperation(
                operation
            ),

        setAttribute() {
            return this;
        },

        setAttributes() {
            return this;
        },

        addEvent() {
            return this;
        },

        setStatus() {
            return this;
        },

        recordException() {
            return this;
        },

        updateName(
            name
        ) {
            this.name =
                normalizeOperation(
                    name
                );

            return this;
        },

        end() {},

        isRecording() {
            return false;
        },

        spanContext() {
            return {
                traceId: '',
                spanId: '',
                traceFlags: 0,
                isRemote: false
            };
        }
    };
}

/* ============================================================================
 * Finance Tracing Adapter
 * ========================================================================== */

class FinanceTracingAdapter {

    constructor(options = {}) {

        this.tracer =
            options.tracer ||
            options.transactionTracer ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.config = {
            ...DEFAULTS,
            ...options
        };

        this.serviceName =
            this.config.serviceName;

        this.environment =
            this.config.environment;

        this.version =
            this.config.version;

        this.statistics = {
            operationsStarted: 0,
            operationsCompleted: 0,
            operationsFailed: 0,
            tracingFailures: 0,
            noopOperations: 0,
            childOperationsStarted: 0,
            childOperationsCompleted: 0,
            childOperationsFailed: 0
        };
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

        this.serviceName =
            this.config.serviceName;

        this.environment =
            this.config.environment;

        this.version =
            this.config.version;

        return this.getConfig();
    }

    getConfig() {

        return {
            ...this.config,

            serviceName:
                this.serviceName,

            environment:
                this.environment,

            version:
                this.version
        };
    }

    /* ========================================================================
     * Primary Async Finance Operation Trace
     * ====================================================================== */

    async trace(
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Finance trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                context
            );

        if (
            !this.isTracingAvailable()
        ) {
            this.statistics
                .noopOperations++;

            return callback(
                null,
                traceContext
            );
        }

        /*
         * Prefer the high-level transaction tracer API because it allows the
         * underlying implementation to own span lifecycle/context propagation.
         */
        if (
            isFunction(
                this.tracer.traceOperation
            )
        ) {

            try {

                return await this.tracer
                    .traceOperation(
                        normalizedOperation,
                        async (
                            span,
                            tracerContext = {}
                        ) => {

                            const mergedContext =
                                this.mergeContexts(
                                    traceContext,
                                    tracerContext
                                );

                            this.statistics
                                .operationsStarted++;

                            this.emitLifecycleEvent(
                                span,
                                FINANCE_EVENTS.STARTED,
                                {
                                    operation:
                                        normalizedOperation
                                }
                            );

                            try {

                                const result =
                                    await callback(
                                        span,
                                        mergedContext
                                    );

                                this.statistics
                                    .operationsCompleted++;

                                this.emitLifecycleEvent(
                                    span,
                                    FINANCE_EVENTS.COMPLETED,
                                    {
                                        operation:
                                            normalizedOperation,

                                        ...(this.config
                                            .includeOperationResultMetadata
                                            ? {
                                                resultType:
                                                    typeof result
                                            }
                                            : {})
                                    }
                                );

                                return result;
                            }
                            catch (error) {

                                this.statistics
                                    .operationsFailed++;

                                this.emitLifecycleEvent(
                                    span,
                                    FINANCE_EVENTS.FAILED,
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
                        },
                        traceContext
                    );

            }
            catch (error) {

                /*
                 * Never translate/suppress the business error.
                 *
                 * If the tracer itself failed before entering the callback,
                 * fail-open can execute the callback once in no-op mode.
                 *
                 * If the callback already ran and produced a business error,
                 * the original error is propagated.
                 */
                if (
                    !this.config.failOpen
                ) {
                    throw error;
                }

                /*
                 * We cannot safely distinguish a tracer-created exception from
                 * a callback exception in every possible TransactionTracer
                 * implementation. Therefore only fall back when explicitly
                 * requested by the tracer contract via the marker below.
                 */
                if (
                    error &&
                    error.__financeTracingFailure ===
                        true
                ) {
                    this.handleTracingFailure(
                        error,
                        normalizedOperation
                    );

                    this.statistics
                        .noopOperations++;

                    return callback(
                        null,
                        traceContext
                    );
                }

                throw error;
            }
        }

        /*
         * Fallback to startSpan/endSpan when only the primitive API exists.
         */
        return this.tracePrimitive(
            normalizedOperation,
            callback,
            traceContext
        );
    }

    /* ========================================================================
     * Primitive Async Operation Trace
     * ====================================================================== */

    async tracePrimitive(
        operation,
        callback,
        context = {}
    ) {

        const span =
            this.startOperation(
                operation,
                context
            );

        if (!span) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                context
            );
        }

        try {

            const result =
                await callback(
                    span,
                    this.getContext(
                        span,
                        context
                    )
                );

            this.completeOperation(
                span,
                operation
            );

            return result;
        }
        catch (error) {

            this.failOperation(
                span,
                operation,
                error
            );

            throw error;
        }
    }

    /* ========================================================================
     * Synchronous Operation Trace
     * ====================================================================== */

    traceSync(
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Finance trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                context
            );

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                traceContext
            );
        }

        const span =
            this.startOperation(
                normalizedOperation,
                traceContext,
                {
                    countStarted: false,
                    emitStarted: false
                }
            );

        try {

            const result =
                callback(
                    span,
                    this.getContext(
                        span,
                        traceContext
                    )
                );

            if (
                isPromise(result)
            ) {
                return result
                    .then(value => {

                        this.completeOperation(
                            span,
                            normalizedOperation
                        );

                        return value;
                    })
                    .catch(error => {

                        this.failOperation(
                            span,
                            normalizedOperation,
                            error
                        );

                        throw error;
                    });
            }

            this.completeOperation(
                span,
                normalizedOperation
            );

            return result;
        }
        catch (error) {

            this.failOperation(
                span,
                normalizedOperation,
                error
            );

            throw error;
        }
    }

    /* ========================================================================
     * Start Finance Operation
     * ====================================================================== */

    startOperation(
        operation,
        context = {},
        options = {}
    ) {

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                context
            );

        if (
            !this.isTracingAvailable()
        ) {
            return null;
        }

        if (
            !isFunction(
                this.tracer.startSpan
            )
        ) {
            this.handleTracingFailure(
                new Error(
                    'Transaction tracer does not implement startSpan'
                ),
                normalizedOperation
            );

            return null;
        }

        try {

            const span =
                this.tracer.startSpan(
                    `finance.${normalizedOperation}`,
                    traceContext,
                    {
                        parentContext:
                            traceContext.parentContext ||
                            traceContext.otelContext ||
                            null
                    }
                );

            if (
                options.countStarted !== false
            ) {
                this.statistics
                    .operationsStarted++;
            }

            if (
                options.emitStarted !== false
            ) {
                this.emitLifecycleEvent(
                    span,
                    FINANCE_EVENTS.STARTED,
                    {
                        operation:
                            normalizedOperation
                    }
                );
            }

            return span;
        }
        catch (error) {

            this.handleTracingFailure(
                this.markTracingFailure(
                    error
                ),
                normalizedOperation
            );

            return null;
        }
    }

    /* ========================================================================
     * Complete Finance Operation
     * ====================================================================== */

    completeOperation(
        span,
        operation,
        metadata = {}
    ) {

        if (!span) {
            return null;
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const safeMetadata =
            sanitizeMetadata(
                metadata,
                this.config
            );

        try {

            this.emitLifecycleEvent(
                span,
                FINANCE_EVENTS.COMPLETED,
                {
                    operation:
                        normalizedOperation,
                    ...safeMetadata
                }
            );

            this.statistics
                .operationsCompleted++;

            this.incrementMetric(
                'finance_operations_completed_total',
                {
                    operation:
                        normalizedOperation
                }
            );

            if (
                isFunction(
                    this.tracer.endSpan
                )
            ) {

                return this.tracer.endSpan(
                    span,
                    {
                        attributes:
                            safeMetadata,

                        status:
                            'ok'
                    }
                );
            }

            if (
                isFunction(
                    span.end
                )
            ) {
                span.end();
            }

            return span;
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                normalizedOperation
            );

            return span;
        }
    }

    /* ========================================================================
     * Fail Finance Operation
     * ====================================================================== */

    failOperation(
        span,
        operation,
        error,
        metadata = {}
    ) {

        if (!span) {
            return null;
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const safeMetadata =
            sanitizeMetadata(
                metadata,
                this.config
            );

        try {

            const errorMetadata =
                sanitizeMetadata(
                    {
                        errorCode:
                            error?.code ||
                            null,

                        errorType:
                            error?.name ||
                            'Error',

                        ...safeMetadata
                    },
                    this.config
                );

            this.emitLifecycleEvent(
                span,
                FINANCE_EVENTS.FAILED,
                {
                    operation:
                        normalizedOperation,
                    ...errorMetadata
                }
            );

            this.recordException(
                span,
                error,
                errorMetadata
            );

            this.statistics
                .operationsFailed++;

            this.incrementMetric(
                'finance_operations_failed_total',
                {
                    operation:
                        normalizedOperation,

                    errorCode:
                        error?.code ||
                        'unknown'
                }
            );

            if (
                isFunction(
                    this.tracer.endSpan
                )
            ) {

                return this.tracer.endSpan(
                    span,
                    {
                        error,

                        attributes:
                            errorMetadata,

                        status:
                            'error'
                    }
                );
            }

            if (
                isFunction(
                    span.setStatus
                )
            ) {
                span.setStatus({
                    code: 2,
                    message:
                        error?.message ||
                        'Finance operation failed'
                });
            }

            if (
                isFunction(
                    span.end
                )
            ) {
                span.end();
            }

            return span;
        }
        catch (tracingError) {

            this.handleTracingFailure(
                tracingError,
                normalizedOperation
            );

            return span;
        }
    }

    /* ========================================================================
     * Statement Processing
     * ====================================================================== */

    async traceStatementProcessing(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_PROCESS,
            callback,
            context
        );
    }

    async traceStatementImport(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_IMPORT,
            callback,
            context
        );
    }

    async traceStatementValidation(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_VALIDATE,
            callback,
            context
        );
    }

    async traceStatementNormalization(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_NORMALIZE,
            callback,
            context
        );
    }

    async traceStatementPersistence(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_PERSIST,
            callback,
            context
        );
    }

    async traceStatementBatch(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.STATEMENT_BATCH,
            callback,
            context
        );
    }

    /* ========================================================================
     * Ledger
     * ====================================================================== */

    async traceLedgerPosting(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.LEDGER_POST,
            callback,
            context
        );
    }

    async traceLedgerValidation(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.LEDGER_VALIDATE,
            callback,
            context
        );
    }

    async traceLedgerBalance(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.LEDGER_BALANCE,
            callback,
            context
        );
    }

    async traceLedgerReversal(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.LEDGER_REVERSE,
            callback,
            context
        );
    }

    /* ========================================================================
     * Journal
     * ====================================================================== */

    async traceJournalCreate(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.JOURNAL_CREATE,
            callback,
            context
        );
    }

    async traceJournalPosting(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.JOURNAL_POST,
            callback,
            context
        );
    }

    async traceJournalReversal(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.JOURNAL_REVERSE,
            callback,
            context
        );
    }

    /* ========================================================================
     * Reconciliation
     * ====================================================================== */

    async traceReconciliation(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.RECONCILIATION_RUN,
            callback,
            context
        );
    }

    async traceReconciliationMatch(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.RECONCILIATION_MATCH,
            callback,
            context
        );
    }

    async traceReconciliationException(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.RECONCILIATION_EXCEPTION,
            callback,
            context
        );
    }

    /* ========================================================================
     * Settlement
     * ====================================================================== */

    async traceSettlement(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.SETTLEMENT_PROCESS,
            callback,
            context
        );
    }

    async traceSettlementVerification(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.SETTLEMENT_VERIFY,
            callback,
            context
        );
    }

    async traceSettlementReversal(
        callback,
        context = {}
    ) {
        return this.trace(
            FINANCE_OPERATIONS.SETTLEMENT_REVERSE,
            callback,
            context
        );
    }

    /* ========================================================================
     * Provider Call
     * ====================================================================== */

    async traceProviderCall(
        provider,
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Provider trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                {
                    ...context,

                    provider:
                        provider ||
                        context.provider ||
                        null
                }
            );

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                traceContext
            );
        }

        if (
            isFunction(
                this.tracer.traceProviderCall
            )
        ) {

            return this.tracer
                .traceProviderCall(
                    provider,
                    normalizedOperation,
                    callback,
                    traceContext
                );
        }

        return this.trace(
            normalizedOperation,
            callback,
            traceContext
        );
    }

    /* ========================================================================
     * Repository / Database
     * ====================================================================== */

    async traceRepository(
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Repository trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                {
                    ...context,

                    database:
                        context.database ||
                        'finance',

                    collection:
                        context.collection ||
                        context.repository ||
                        null
                }
            );

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                traceContext
            );
        }

        if (
            isFunction(
                this.tracer
                    .traceDatabaseOperation
            )
        ) {

            return this.tracer
                .traceDatabaseOperation(
                    normalizedOperation,
                    callback,
                    traceContext
                );
        }

        return this.trace(
            normalizedOperation,
            callback,
            traceContext
        );
    }

    /* ========================================================================
     * Messaging
     * ====================================================================== */

    async traceEventPublish(
        callback,
        context = {}
    ) {
        return this.traceMessaging(
            'publish',
            callback,
            context
        );
    }

    async traceEventConsume(
        callback,
        context = {}
    ) {
        return this.traceMessaging(
            'consume',
            callback,
            context
        );
    }

    async traceMessaging(
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Messaging trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const traceContext =
            this.createContext(
                normalizedOperation,
                context
            );

        if (
            !this.isTracingAvailable()
        ) {

            this.statistics
                .noopOperations++;

            return callback(
                null,
                traceContext
            );
        }

        if (
            isFunction(
                this.tracer
                    .traceMessagingOperation
            )
        ) {

            return this.tracer
                .traceMessagingOperation(
                    normalizedOperation,
                    callback,
                    traceContext
                );
        }

        return this.trace(
            `${FINANCE_OPERATIONS.EVENT_PUBLISH}`,
            callback,
            {
                ...traceContext,
                messagingOperation:
                    normalizedOperation
            }
        );
    }

    /* ========================================================================
     * Explicit Child Span
     * ====================================================================== */

    async traceChild(
        parentSpan,
        operation,
        callback,
        context = {}
    ) {

        if (
            !isFunction(callback)
        ) {
            throw new TypeError(
                'Child trace callback must be a function'
            );
        }

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        let parentContext = {};

        if (
            parentSpan &&
            this.tracer &&
            isFunction(
                this.tracer.getContext
            )
        ) {
            try {
                parentContext =
                    this.tracer.getContext(
                        parentSpan
                    ) || {};
            }
            catch (error) {
                this.handleTracingFailure(
                    error,
                    'child.context'
                );
            }
        }

        const childContext =
            this.mergeContexts(
                context,
                parentContext
            );

        childContext.parentSpanId =
            parentContext.spanId ||
            context.parentSpanId ||
            null;

        this.statistics
            .childOperationsStarted++;

        this.emitLifecycleEvent(
            parentSpan,
            FINANCE_EVENTS.CHILD_STARTED,
            {
                operation:
                    normalizedOperation
            }
        );

        try {

            const result =
                await this.trace(
                    normalizedOperation,
                    callback,
                    childContext
                );

            this.statistics
                .childOperationsCompleted++;

            this.emitLifecycleEvent(
                parentSpan,
                FINANCE_EVENTS.CHILD_COMPLETED,
                {
                    operation:
                        normalizedOperation
                }
            );

            return result;
        }
        catch (error) {

            this.statistics
                .childOperationsFailed++;

            this.emitLifecycleEvent(
                parentSpan,
                FINANCE_EVENTS.CHILD_FAILED,
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
    }

    /* ========================================================================
     * Validation Lifecycle
     * ====================================================================== */

    validationStarted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.VALIDATION_STARTED,
            metadata
        );
    }

    validationCompleted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.VALIDATION_COMPLETED,
            metadata
        );
    }

    validationFailed(
        span,
        error,
        metadata = {}
    ) {

        return this.addEvent(
            span,
            FINANCE_EVENTS.VALIDATION_FAILED,
            {
                errorCode:
                    error?.code ||
                    null,

                ...metadata
            }
        );
    }

    /* ========================================================================
     * Persistence Lifecycle
     * ====================================================================== */

    persistenceStarted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.PERSISTENCE_STARTED,
            metadata
        );
    }

    persistenceCompleted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.PERSISTENCE_COMPLETED,
            metadata
        );
    }

    persistenceFailed(
        span,
        error,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.PERSISTENCE_FAILED,
            {
                errorCode:
                    error?.code ||
                    null,

                ...metadata
            }
        );
    }

    /* ========================================================================
     * Batch Lifecycle
     * ====================================================================== */

    batchStarted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.BATCH_STARTED,
            metadata
        );
    }

    batchCompleted(
        span,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.BATCH_COMPLETED,
            metadata
        );
    }

    batchFailed(
        span,
        error,
        metadata = {}
    ) {
        return this.addEvent(
            span,
            FINANCE_EVENTS.BATCH_FAILED,
            {
                errorCode:
                    error?.code ||
                    null,

                ...metadata
            }
        );
    }

    /* ========================================================================
     * Retry
     * ====================================================================== */

    retryAttempt(
        span,
        attempt,
        delayMs,
        error = null
    ) {

        if (!span) {
            return false;
        }

        const metadata = {
            attempt:
                Number.isFinite(
                    Number(attempt)
                )
                    ? Number(attempt)
                    : 0,

            delayMs:
                Number.isFinite(
                    Number(delayMs)
                )
                    ? Number(delayMs)
                    : 0,

            errorCode:
                error?.code ||
                null
        };

        try {

            if (
                isFunction(
                    this.tracer?.retryAttempt
                )
            ) {
                this.tracer.retryAttempt(
                    span,
                    attempt,
                    delayMs,
                    error
                );
            }

            this.addEvent(
                span,
                FINANCE_EVENTS.RETRY,
                metadata
            );

            this.incrementMetric(
                'finance_operation_retries_total',
                {
                    operation:
                        span.name ||
                        'unknown'
                }
            );

            return true;
        }
        catch (tracingError) {

            this.handleTracingFailure(
                tracingError,
                'retry'
            );

            return false;
        }
    }

    /* ========================================================================
     * Timeout
     * ====================================================================== */

    timeout(
        span,
        timeoutMs
    ) {

        if (!span) {
            return false;
        }

        const normalizedTimeout =
            Number(timeoutMs);

        try {

            if (
                isFunction(
                    this.tracer?.timeout
                )
            ) {
                this.tracer.timeout(
                    span,
                    normalizedTimeout
                );
            }

            this.addEvent(
                span,
                FINANCE_EVENTS.TIMEOUT,
                {
                    timeoutMs:
                        Number.isFinite(
                            normalizedTimeout
                        )
                            ? normalizedTimeout
                            : null
                }
            );

            this.incrementMetric(
                'finance_operation_timeouts_total',
                {
                    operation:
                        span.name ||
                        'unknown'
                }
            );

            return true;
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'timeout'
            );

            return false;
        }
    }

    /* ========================================================================
     * State Transition
     * ====================================================================== */

    stateTransition(
        span,
        from,
        to,
        metadata = {}
    ) {

        if (!span) {
            return false;
        }

        try {

            if (
                isFunction(
                    this.tracer?.stateTransition
                )
            ) {
                this.tracer.stateTransition(
                    span,
                    from,
                    to,
                    metadata
                );
            }

            return this.addEvent(
                span,
                FINANCE_EVENTS.STATE_CHANGED,
                {
                    from:
                        truncate(
                            from
                        ),

                    to:
                        truncate(
                            to
                        ),

                    ...metadata
                }
            );
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'state-transition'
            );

            return false;
        }
    }

    /* ========================================================================
     * Idempotency
     * ====================================================================== */

    idempotencyHit(
        span,
        idempotencyKey,
        metadata = {}
    ) {

        if (
            !this.config
                .emitIdempotencyEvents
        ) {
            return false;
        }

        /*
         * Never emit the full idempotency key as an arbitrary event attribute
         * unless the configured tracer is explicitly responsible for hashing.
         *
         * Prefer an operation-level identifier or deterministic digest.
         */
        return this.addEvent(
            span,
            FINANCE_EVENTS.IDEMPOTENCY_HIT,
            {
                idempotencyKey:
                    this.hashIdentifier(
                        idempotencyKey
                    ),

                ...metadata
            }
        );
    }

    idempotencyMiss(
        span,
        idempotencyKey,
        metadata = {}
    ) {

        if (
            !this.config
                .emitIdempotencyEvents
        ) {
            return false;
        }

        return this.addEvent(
            span,
            FINANCE_EVENTS.IDEMPOTENCY_MISS,
            {
                idempotencyKey:
                    this.hashIdentifier(
                        idempotencyKey
                    ),

                ...metadata
            }
        );
    }

    hashIdentifier(value) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return null;
        }

        return crypto
            .createHash('sha256')
            .update(
                String(value),
                'utf8'
            )
            .digest('hex');
    }

    /* ========================================================================
     * Span Attributes
     * ====================================================================== */

    addAttribute(
        span,
        key,
        value
    ) {

        if (
            !span ||
            !key
        ) {
            return false;
        }

        if (
            isSensitiveKey(key) &&
            !this.config.allowSensitiveTracing
        ) {
            return false;
        }

        if (
            !this.config
                .includeHighCardinalityMetadata &&
            isHighCardinalityKey(key)
        ) {
            return false;
        }

        const sanitized =
            serializeTraceValue(
                value,
                this.config
            );

        try {

            if (
                isFunction(
                    this.tracer?.addAttribute
                )
            ) {
                return this.tracer.addAttribute(
                    span,
                    key,
                    sanitized
                );
            }

            if (
                isFunction(
                    span.setAttribute
                )
            ) {
                span.setAttribute(
                    key,
                    sanitized
                );

                return true;
            }

            return false;
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'attribute'
            );

            return false;
        }
    }

    /* ========================================================================
     * Add Event
     * ====================================================================== */

    addEvent(
        span,
        name,
        metadata = {}
    ) {

        if (
            !span ||
            !this.config
                .emitLifecycleEvents
        ) {
            return false;
        }

        const sanitized =
            sanitizeMetadata(
                metadata,
                this.config,
                {
                    event: true
                }
            );

        try {

            if (
                isFunction(
                    this.tracer?.addEvent
                )
            ) {

                this.tracer.addEvent(
                    span,
                    name,
                    sanitized
                );

                return true;
            }

            if (
                isFunction(
                    span.addEvent
                )
            ) {

                span.addEvent(
                    name,
                    sanitized
                );

                return true;
            }

            return false;
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                name
            );

            return false;
        }
    }

    /* ========================================================================
     * Record Exception
     * ====================================================================== */

    recordException(
        span,
        error,
        metadata = {}
    ) {

        if (
            !span ||
            !error
        ) {
            return false;
        }

        const normalized =
            normalizeError(
                error
            );

        try {

            if (
                isFunction(
                    this.tracer
                        ?.recordException
                )
            ) {

                this.tracer.recordException(
                    span,
                    error,
                    metadata
                );
            }
            else if (
                isFunction(
                    span.recordException
                )
            ) {

                span.recordException(
                    error
                );
            }

            this.addAttribute(
                span,
                'error.type',
                normalized?.name
            );

            this.addAttribute(
                span,
                'error.message',
                normalized?.message
            );

            if (
                normalized?.code
            ) {
                this.addAttribute(
                    span,
                    'error.code',
                    normalized.code
                );
            }

            return true;
        }
        catch (tracingError) {

            this.handleTracingFailure(
                tracingError,
                'exception'
            );

            return false;
        }
    }

    /* ========================================================================
     * Create Finance Context
     * ====================================================================== */

    createContext(
        operation,
        context = {}
    ) {

        const normalizedOperation =
            normalizeOperation(
                operation
            );

        const correlationId =
            context.correlationId ||
            (
                this.config
                    .generateCorrelationId
                    ? generateId()
                    : null
            );

        const operationId =
            context.operationId ||
            (
                this.config
                    .generateOperationId
                    ? generateId()
                    : null
            );

        const baseContext = {
            operation:
                normalizedOperation,

            operationId,

            correlationId,

            service:
                this.serviceName,

            serviceName:
                this.serviceName,

            environment:
                this.environment,

            version:
                this.version,

            transactionId:
                context.transactionId ||
                context.financialTransactionId ||
                null,

            tenantId:
                context.tenantId ||
                null,

            requestId:
                context.requestId ||
                null,

            provider:
                context.provider ||
                null,

            batchId:
                context.batchId ||
                null,

            statementId:
                context.statementId ||
                null,

            journalId:
                context.journalId ||
                null,

            accountId:
                context.accountId ||
                null,

            settlementId:
                context.settlementId ||
                null,

            loanId:
                context.loanId ||
                null,

            paymentId:
                context.paymentId ||
                null,

            reconciliationId:
                context.reconciliationId ||
                null,

            periodId:
                context.periodId ||
                null,

            snapshotId:
                context.snapshotId ||
                null,

            idempotencyKey:
                context.idempotencyKey ||
                null,

            operationKey:
                context.operationKey ||
                null,

            traceId:
                context.traceId ||
                null,

            parentSpanId:
                context.parentSpanId ||
                null,

            parentContext:
                context.parentContext ||
                context.otelContext ||
                null
        };

        /*
         * Preserve only sanitized additional context.
         */
        const additional =
            sanitizeContext(
                context,
                this.config
            );

        /*
         * Explicit business identifiers above always win over arbitrary
         * user-provided metadata.
         */
        return {
            ...additional,

            ...baseContext
        };
    }

    /* ========================================================================
     * Merge Contexts
     * ====================================================================== */

    mergeContexts(
        base = {},
        additional = {}
    ) {

        const merged = {
            ...sanitizeContext(
                base,
                this.config
            ),

            ...sanitizeContext(
                additional,
                this.config
            )
        };

        const preferred =
            additional || {};

        const fallback =
            base || {};

        return {
            ...merged,

            traceId:
                preferred.traceId ||
                fallback.traceId ||
                null,

            spanId:
                preferred.spanId ||
                fallback.spanId ||
                null,

            tenantId:
                preferred.tenantId ||
                fallback.tenantId ||
                null,

            transactionId:
                preferred.transactionId ||
                fallback.transactionId ||
                null,

            correlationId:
                preferred.correlationId ||
                fallback.correlationId ||
                null,

            requestId:
                preferred.requestId ||
                fallback.requestId ||
                null,

            parentSpanId:
                preferred.parentSpanId ||
                fallback.parentSpanId ||
                null
        };
    }

    /* ========================================================================
     * Resolve Context From Span
     * ====================================================================== */

    getContext(
        span,
        fallback = {}
    ) {

        if (
            !span ||
            !this.tracer ||
            !isFunction(
                this.tracer.getContext
            )
        ) {
            return fallback;
        }

        try {

            return this.mergeContexts(
                fallback,
                this.tracer.getContext(
                    span
                ) || {}
            );

        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'context'
            );

            return fallback;
        }
    }

    /* ========================================================================
     * Context Injection
     * ====================================================================== */

    injectContext(
        span,
        carrier = {}
    ) {

        if (
            !this.config
                .propagateContext
        ) {
            return carrier;
        }

        const target =
            carrier || {};

        try {

            if (
                isFunction(
                    this.tracer
                        ?.injectContext
                )
            ) {

                return (
                    this.tracer
                        .injectContext(
                            span,
                            target
                        ) ||
                    target
                );
            }

            if (
                isFunction(
                    this.tracer
                        ?.injectTraceContext
                )
            ) {

                return (
                    this.tracer
                        .injectTraceContext(
                            span,
                            target
                        ) ||
                    target
                );
            }

            return target;
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'context.inject'
            );

            return target;
        }
    }

    /* ========================================================================
     * Context Extraction
     * ====================================================================== */

    extractContext(
        carrier = {}
    ) {

        if (
            !this.config
                .propagateContext
        ) {
            return {};
        }

        try {

            if (
                isFunction(
                    this.tracer
                        ?.extractContext
                )
            ) {

                return (
                    this.tracer
                        .extractContext(
                            carrier
                        ) ||
                    {}
                );
            }

            if (
                isFunction(
                    this.tracer
                        ?.extractTraceContext
                )
            ) {

                return (
                    this.tracer
                        .extractTraceContext(
                            carrier
                        ) ||
                    {}
                );
            }

            return {};
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'context.extract'
            );

            return {};
        }
    }

    /* ========================================================================
     * Lifecycle Event
     * ====================================================================== */

    emitLifecycleEvent(
        span,
        eventName,
        metadata = {}
    ) {

        if (
            !span ||
            !this.config
                .emitLifecycleEvents
        ) {
            return false;
        }

        return this.addEvent(
            span,
            eventName,
            metadata
        );
    }

    /* ========================================================================
     * Tracing Availability
     * ====================================================================== */

    isTracingAvailable() {

        return Boolean(
            this.config.enabled &&
            this.tracer &&
            (
                isFunction(
                    this.tracer.traceOperation
                ) ||
                isFunction(
                    this.tracer.startSpan
                )
            )
        );
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

            if (
                isFunction(
                    this.logger?.warn
                )
            ) {

                this.logger.warn(
                    '[FinanceTracingAdapter] Observability failure isolated',
                    {
                        operation:
                            normalizeOperation(
                                operation
                            ),

                        error:
                            normalizeError(
                                error
                            )
                    }
                );
            }
        }
        catch (_) {
            /*
             * Logging must never break finance operations.
             */
        }

        this.incrementMetric(
            'finance_tracing_failures_total',
            {
                operation:
                    normalizeOperation(
                        operation
                    )
            }
        );
    }

    /*
     * Internal marker used only when an underlying tracer explicitly reports
     * that its failure happened before the user callback ran.
     */
    markTracingFailure(
        error
    ) {

        if (
            error &&
            typeof error === 'object'
        ) {
            try {
                Object.defineProperty(
                    error,
                    '__financeTracingFailure',
                    {
                        configurable: true,
                        enumerable: false,
                        value: true,
                        writable: false
                    }
                );
            }
            catch (_) {
                // Best effort only.
            }
        }

        return error;
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
                    this.metrics?.increment
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
        }
        catch (error) {

            try {

                this.logger?.warn?.(
                    '[FinanceTracingAdapter] Metrics failure isolated',
                    {
                        metric,
                        error:
                            normalizeError(
                                error
                            )
                    }
                );
            }
            catch (_) {
                // Ignore logger failure.
            }

            return false;
        }
    }

    /* ========================================================================
     * Statistics
     * ====================================================================== */

    getStatistics() {

        let tracerStatistics = null;

        try {

            if (
                isFunction(
                    this.tracer
                        ?.getStatistics
                )
            ) {

                tracerStatistics =
                    this.tracer
                        .getStatistics();
            }
        }
        catch (error) {

            this.handleTracingFailure(
                error,
                'statistics'
            );
        }

        return {
            ...this.statistics,

            tracingEnabled:
                this.isTracingAvailable(),

            service:
                this.serviceName,

            environment:
                this.environment,

            version:
                this.version,

            tracerStatistics
        };
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {
            module:
                'finance-tracing-adapter',

            serviceName:
                this.serviceName,

            environment:
                this.environment,

            version:
                this.version,

            enabled:
                this.config.enabled,

            tracingAvailable:
                this.isTracingAvailable(),

            failOpen:
                this.config.failOpen,

            propagationEnabled:
                this.config.propagateContext,

            tenantAware:
                this.config.tenantAware,

            correlationAware:
                this.config.correlationAware,

            tracerPresent:
                Boolean(
                    this.tracer
                ),

            tracerCapabilities: {
                traceOperation:
                    isFunction(
                        this.tracer
                            ?.traceOperation
                    ),

                startSpan:
                    isFunction(
                        this.tracer
                            ?.startSpan
                    ),

                endSpan:
                    isFunction(
                        this.tracer
                            ?.endSpan
                    ),

                getContext:
                    isFunction(
                        this.tracer
                            ?.getContext
                    ),

                injectContext:
                    isFunction(
                        this.tracer
                            ?.injectContext
                    ),

                extractContext:
                    isFunction(
                        this.tracer
                            ?.extractContext
                    ),

                traceProviderCall:
                    isFunction(
                        this.tracer
                            ?.traceProviderCall
                    ),

                traceDatabaseOperation:
                    isFunction(
                        this.tracer
                            ?.traceDatabaseOperation
                    ),

                traceMessagingOperation:
                    isFunction(
                        this.tracer
                            ?.traceMessagingOperation
                    )
            },

            statistics:
                this.getStatistics(),

            timestamp:
                new Date().toISOString()
        };
    }

    /* ========================================================================
     * Health
     * ====================================================================== */

    health() {

        const available =
            this.isTracingAvailable();

        return {
            status:
                available ||
                this.config.failOpen
                    ? 'healthy'
                    : 'degraded',

            healthy:
                available ||
                this.config.failOpen,

            enabled:
                this.config.enabled,

            failOpen:
                this.config.failOpen,

            tracingAvailable:
                available,

            serviceName:
                this.serviceName,

            environment:
                this.environment,

            version:
                this.version,

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
        return new FinanceTracingAdapter(
            options
        );
    }
}

/* ============================================================================
 * Static Exports
 * ========================================================================== */

FinanceTracingAdapter.Operations =
    FINANCE_OPERATIONS;

FinanceTracingAdapter.Events =
    FINANCE_EVENTS;

FinanceTracingAdapter.normalizeError =
    normalizeError;

FinanceTracingAdapter.sanitizeMetadata =
    sanitizeMetadata;

FinanceTracingAdapter.generateId =
    generateId;

/* ============================================================================
 * Module Export
 * ========================================================================== */

module.exports =
    FinanceTracingAdapter;