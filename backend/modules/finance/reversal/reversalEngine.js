'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Reversal Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/reversalEngine.js
 *
 * Purpose:
 *   Enterprise orchestration boundary for all controlled financial reversals.
 *
 * Supported reversal types:
 *   - REFUND
 *   - SETTLEMENT
 *   - LOAN_DISBURSEMENT
 *   - ADJUSTMENT
 *
 * Responsibilities:
 *   - Validate reversal requests
 *   - Generate immutable reversal operation identity
 *   - Preserve tenant / user / correlation / request / idempotency context
 *   - Resolve the appropriate reversal strategy
 *   - Delegate financial mutation to the specialized strategy
 *   - Preserve original-ledger lineage
 *   - Publish audit / domain events after successful financial execution
 *   - Isolate audit/event/metrics failures from the financial result
 *   - Normalize and preserve underlying financial errors
 *
 * IMPORTANT:
 *
 *   ReversalEngine does NOT:
 *     - modify ledger records directly
 *     - modify account balances directly
 *     - construct reversal journal entries directly
 *     - bypass specialized reversal strategies
 *
 *   Specialized strategies remain responsible for the actual financial
 *   operation:
 *
 *     RefundProcessor
 *     SettlementReversal
 *     LoanDisbursementReversal
 *     AdjustmentManager
 *
 * The immutable Ledger Engine remains the final financial posting boundary.
 *
 * Financial flow:
 *
 *   ReversalEngine
 *        │
 *        ├── validate
 *        ├── establish operation context
 *        ├── resolve strategy
 *        │
 *        ▼
 *   Specialized Reversal Strategy
 *        │
 *        ▼
 *   Compensation / Journal construction
 *        │
 *        ▼
 *   LedgerEngine.post()
 *        │
 *        ▼
 *   Immutable reversal
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const OPERATION =
    'finance.reversal';

const DEFAULT_MAX_REASON_LENGTH =
    2000;

const DEFAULT_MAX_METADATA_KEYS =
    50;

const SUPPORTED_REVERSAL_TYPES =
    Object.freeze([
        'REFUND',
        'SETTLEMENT',
        'LOAN_DISBURSEMENT',
        'ADJUSTMENT'
    ]);

const EVENTS =
    Object.freeze({
        STARTED:
            'LedgerReversalStarted',

        COMPLETED:
            'LedgerReversed',

        FAILED:
            'LedgerReversalFailed'
    });

const METRICS =
    Object.freeze({
        SUCCESS:
            'finance.reversal.success',

        FAILED:
            'finance.reversal.failed',

        VALIDATION_FAILED:
            'finance.reversal.validation_failed',

        STRATEGY_UNAVAILABLE:
            'finance.reversal.strategy_unavailable',

        AUDIT_FAILURE:
            'finance.reversal.audit_failure',

        EVENT_FAILURE:
            'finance.reversal.event_failure'
    });

const SENSITIVE_PATTERNS =
    Object.freeze([
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
        /response.?body/i,
        /statementContent/i,
        /fileContent/i
    ]);

/* ============================================================================
 * Error
 * ========================================================================== */

class ReversalEngineError extends Error {

    constructor(
        code,
        message,
        metadata = {},
        cause = null
    ) {

        super(message);

        this.name =
            'ReversalEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        /*
         * Preserve the underlying financial error where supported.
         */
        if (
            cause
        ) {

            this.cause =
                cause;
        }

        Error.captureStackTrace?.(
            this,
            ReversalEngineError
        );
    }
}

/* ============================================================================
 * Error factories
 * ========================================================================== */

function validationError(
    message,
    metadata = {}
) {

    return new ReversalEngineError(
        'REVERSAL_VALIDATION_ERROR',
        message,
        metadata
    );
}

function unsupportedTypeError(
    type
) {

    return new ReversalEngineError(
        'UNSUPPORTED_REVERSAL_TYPE',
        `Unsupported reversal type ${type}`,
        {
            type
        }
    );
}

function dependencyError(
    message,
    metadata = {}
) {

    return new ReversalEngineError(
        'REVERSAL_DEPENDENCY_ERROR',
        message,
        metadata
    );
}

/* ============================================================================
 * Utility helpers
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

function normalizeId(
    value
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return normalized ||
        null;
}

function requireId(
    value,
    fieldName
) {

    const normalized =
        normalizeId(
            value
        );

    if (
        !normalized
    ) {

        throw validationError(
            `${fieldName} is required`,
            {
                fieldName
            }
        );
    }

    return normalized;
}

function normalizeType(
    type
) {

    return String(
        type ||
        ''
    )
        .trim()
        .toUpperCase();
}

function normalizeReason(
    reason
) {

    const normalized =
        normalizeId(
            reason
        );

    if (
        !normalized
    ) {

        throw validationError(
            'reason is required'
        );
    }

    return normalized.slice(
        0,
        DEFAULT_MAX_REASON_LENGTH
    );
}

function normalizeError(
    error
) {

    if (
        !error
    ) {

        return null;
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
                'Unknown error'
            ).slice(
                0,
                DEFAULT_MAX_REASON_LENGTH
            )
    };
}

function isFunction(
    value
) {

    return typeof value ===
        'function';
}

/* ============================================================================
 * Reversal Engine
 * ========================================================================== */

class ReversalEngine {

    constructor({

        ledgerEngine,

        compensationBuilder,

        refundProcessor,

        settlementReversal,

        loanDisbursementReversal,

        adjustmentManager,

        auditService = null,

        eventBus = null,

        logger = null,

        metrics = null,

        tracing = null,

        idempotencyRepository = null,

        clock = null,

        idGenerator = null

    } = {}) {

        this.ledgerEngine =
            ledgerEngine;

        this.compensationBuilder =
            compensationBuilder;

        this.refundProcessor =
            refundProcessor;

        this.settlementReversal =
            settlementReversal;

        this.loanDisbursementReversal =
            loanDisbursementReversal;

        this.adjustmentManager =
            adjustmentManager;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.logger =
            logger ||
            console;

        this.metrics =
            metrics;

        this.tracing =
            tracing;

        this.idempotencyRepository =
            idempotencyRepository;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;

        this.validateDependencies();
    }

    /* ========================================================================
     * REVERSE
     * ====================================================================== */

    async reverse({

        type,

        originalLedgerId,

        reason,

        tenantId,

        userId,

        metadata = {},

        correlationId = null,

        requestId = null,

        operationId = null,

        idempotencyKey = null,

        approvalId = null

    } = {}) {

        const normalizedType =
            normalizeType(
                type
            );

        const normalizedTenantId =
            requireId(
                tenantId,
                'tenantId'
            );

        const normalizedLedgerId =
            requireId(
                originalLedgerId,
                'originalLedgerId'
            );

        const normalizedReason =
            normalizeReason(
                reason
            );

        this.validateType(
            normalizedType
        );

        const reversalId =
            normalizeId(
                metadata.reversalId
            ) ||
            this.idGenerator();

        const startedAt =
            this.clock();

        const context =
            this.createContext({
                reversalId,

                operationId,

                correlationId,

                requestId,

                idempotencyKey,

                tenantId:
                    normalizedTenantId,

                userId,

                actorId:
                    metadata.actorId ||
                    userId,

                type:
                    normalizedType,

                originalLedgerId:
                    normalizedLedgerId,

                reason:
                    normalizedReason,

                approvalId,

                startedAt,

                metadata
            });

        let strategy;

        try {

            this.safeLog(
                'info',
                'Reversal started',
                {
                    reversalId,
                    operationId:
                        context.operationId,
                    tenantId:
                        normalizedTenantId,
                    type:
                        normalizedType,
                    originalLedgerId:
                        normalizedLedgerId
                }
            );

            this.incrementMetric(
                'finance.reversal.started',
                {
                    type:
                        normalizedType
                }
            );

            this.emitTraceEvent(
                null,
                'finance.reversal.started',
                {
                    reversalId,

                    operationId:
                        context.operationId,

                    tenantId:
                        normalizedTenantId,

                    type:
                        normalizedType
                }
            );

            strategy =
                this.resolveStrategy(
                    normalizedType
                );

        } catch (error) {

            this.incrementMetric(
                METRICS.VALIDATION_FAILED
            );

            throw this.toReversalError(
                error,
                {
                    reversalId,

                    originalLedgerId:
                        normalizedLedgerId,

                    type:
                        normalizedType
                }
            );
        }

        /*
         * The specialized strategy performs the actual financial operation.
         *
         * Metadata is intentionally preserved inside context rather than
         * passed as an arbitrary top-level strategy argument so every strategy
         * receives the same execution identity contract.
         */
        let reversal;

        try {

            reversal =
                await strategy.execute({
                    originalLedgerId:
                        normalizedLedgerId,

                    reason:
                        normalizedReason,

                    context,

                    metadata:
                        this.sanitizeMetadata(
                            metadata
                        )
                });

        } catch (error) {

            this.incrementMetric(
                METRICS.FAILED,
                {
                    type:
                        normalizedType,

                    errorCode:
                        error?.code ||
                        'UNKNOWN'
                }
            );

            /*
             * The financial strategy failure is the authoritative failure.
             */
            await this.safePostFailureTelemetry(
                context,
                error
            );

            throw this.toReversalError(
                error,
                {
                    reversalId,

                    originalLedgerId:
                        normalizedLedgerId,

                    type:
                        normalizedType,

                    operationId:
                        context.operationId
                }
            );
        }

        /*
         * From this point onward, financial execution has succeeded.
         *
         * Audit/event failures MUST NOT convert the successful financial
         * reversal into a failed financial operation.
         */
        this.incrementMetric(
            METRICS.SUCCESS,
            {
                type:
                    normalizedType
            }
        );

        await this.safePostSuccessTelemetry(
            reversal,
            context
        );

        return reversal;
    }

    /* ========================================================================
     * STRATEGY RESOLUTION
     * ====================================================================== */

    resolveStrategy(
        type
    ) {

        const normalizedType =
            normalizeType(
                type
            );

        switch (
            normalizedType
        ) {

            case 'REFUND':

                return this.requireStrategy(
                    normalizedType,
                    this.refundProcessor
                );

            case 'SETTLEMENT':

                return this.requireStrategy(
                    normalizedType,
                    this.settlementReversal
                );

            case 'LOAN_DISBURSEMENT':

                return this.requireStrategy(
                    normalizedType,
                    this.loanDisbursementReversal
                );

            case 'ADJUSTMENT':

                return this.requireStrategy(
                    normalizedType,
                    this.adjustmentManager
                );

            default:

                throw unsupportedTypeError(
                    normalizedType
                );
        }
    }

    requireStrategy(
        type,
        strategy
    ) {

        if (
            !strategy ||
            !isFunction(
                strategy.execute
            )
        ) {

            this.incrementMetric(
                METRICS.STRATEGY_UNAVAILABLE,
                {
                    type
                }
            );

            throw dependencyError(
                `Reversal strategy is unavailable for ${type}`,
                {
                    type
                }
            );
        }

        return strategy;
    }

    validateType(
        type
    ) {

        if (
            !SUPPORTED_REVERSAL_TYPES.includes(
                type
            )
        ) {

            throw unsupportedTypeError(
                type
            );
        }

        return true;
    }

    /* ========================================================================
     * CONTEXT
     * ====================================================================== */

    createContext({
        reversalId,
        operationId,
        correlationId,
        requestId,
        idempotencyKey,
        tenantId,
        userId,
        actorId,
        type,
        originalLedgerId,
        reason,
        approvalId,
        startedAt,
        metadata = {}
    }) {

        return {

            operation:
                OPERATION,

            operationType:
                type,

            reversalId,

            operationId:
                normalizeId(
                    operationId
                ) ||
                `${OPERATION}:${reversalId}`,

            correlationId:
                normalizeId(
                    correlationId
                ) ||
                this.idGenerator(),

            requestId:
                normalizeId(
                    requestId
                ),

            idempotencyKey:
                normalizeId(
                    idempotencyKey
                ) ||
                this.buildDefaultIdempotencyKey({
                    tenantId,
                    type,
                    originalLedgerId
                }),

            tenantId,

            userId:
                normalizeId(
                    userId
                ),

            actorId:
                normalizeId(
                    actorId
                ),

            type,

            originalLedgerId,

            reason,

            approvalId:
                normalizeId(
                    approvalId
                ),

            startedAt,

            /*
             * Explicitly distinguish a reversal from other finance operations.
             */
            reversal:
                true,

            reversalType:
                type,

            metadata:
                this.sanitizeMetadata(
                    metadata
                )
        };
    }

    buildDefaultIdempotencyKey({
        tenantId,
        type,
        originalLedgerId
    }) {

        /*
         * Stable logical identity:
         *
         * tenant + reversal type + original ledger
         *
         * This prevents accidental repeated reversal of the same source
         * transaction when a caller did not provide a key explicitly.
         */
        return crypto
            .createHash('sha256')
            .update(
                [
                    tenantId,
                    type,
                    originalLedgerId
                ].join(':')
            )
            .digest('hex');
    }

    /* ========================================================================
     * POST-SUCCESS TELEMETRY
     * ====================================================================== */

    async safePostSuccessTelemetry(
        reversal,
        context
    ) {

        const resultId =
            this.extractResultId(
                reversal
            );

        /*
         * Audit.
         */
        try {

            await this.recordAudit(
                'REVERSAL_CREATED',
                {
                    reversalId:
                        context.reversalId,

                    operationId:
                        context.operationId,

                    originalLedgerId:
                        context.originalLedgerId,

                    tenantId:
                        context.tenantId,

                    type:
                        context.type,

                    resultId
                },
                context
            );

        } catch (error) {

            this.incrementMetric(
                METRICS.AUDIT_FAILURE
            );

            this.safeLog(
                'error',
                'Reversal audit failed after successful financial posting',
                error
            );
        }

        /*
         * Domain event.
         */
        try {

            await this.publishEvent(
                EVENTS.COMPLETED,
                reversal,
                context
            );

        } catch (error) {

            this.incrementMetric(
                METRICS.EVENT_FAILURE
            );

            this.safeLog(
                'error',
                'Reversal event publication failed after successful financial posting',
                error
            );
        }

        /*
         * Optional tracing event.
         */
        this.emitTraceEvent(
            null,
            'finance.reversal.completed',
            {
                reversalId:
                    context.reversalId,

                operationId:
                    context.operationId,

                originalLedgerId:
                    context.originalLedgerId,

                type:
                    context.type,

                resultId
            }
        );
    }

    /* ========================================================================
     * POST-FAILURE TELEMETRY
     * ====================================================================== */

    async safePostFailureTelemetry(
        context,
        error
    ) {

        try {

            await this.recordAudit(
                'REVERSAL_FAILED',
                {
                    reversalId:
                        context.reversalId,

                    operationId:
                        context.operationId,

                    originalLedgerId:
                        context.originalLedgerId,

                    tenantId:
                        context.tenantId,

                    type:
                        context.type,

                    errorCode:
                        error?.code ||
                        null
                },
                context
            );

        } catch (auditError) {

            this.incrementMetric(
                METRICS.AUDIT_FAILURE
            );

            this.safeLog(
                'error',
                'Reversal failure audit failed',
                auditError
            );
        }

        try {

            await this.publishEvent(
                EVENTS.FAILED,
                {
                    reversalId:
                        context.reversalId,

                    originalLedgerId:
                        context.originalLedgerId,

                    type:
                        context.type,

                    status:
                        'FAILED'
                },
                context
            );

        } catch (eventError) {

            this.incrementMetric(
                METRICS.EVENT_FAILURE
            );

            this.safeLog(
                'error',
                'Reversal failure event publication failed',
                eventError
            );
        }

        this.emitTraceEvent(
            null,
            'finance.reversal.failed',
            {
                reversalId:
                    context.reversalId,

                originalLedgerId:
                    context.originalLedgerId,

                type:
                    context.type,

                errorCode:
                    error?.code ||
                    null
            }
        );
    }

    /* ========================================================================
     * AUDIT
     * ====================================================================== */

    async recordAudit(
        action,
        entity,
        context
    ) {

        if (
            !this.auditService
        ) {

            return;
        }

        const payload = {

            action,

            entity:
                this.sanitizeMetadata(
                    entity
                ),

            context:
                this.sanitizeMetadata(
                    context
                ),

            occurredAt:
                this.clock()
        };

        if (
            typeof this.auditService
                .record ===
            'function'
        ) {

            await this.auditService.record(
                payload
            );

            return;
        }

        if (
            typeof this.auditService
                .log ===
            'function'
        ) {

            await this.auditService.log(
                action,
                payload
            );

            return;
        }

        throw dependencyError(
            'auditService does not implement record() or log()'
        );
    }

    /* ========================================================================
     * EVENT BUS
     * ====================================================================== */

    async publishEvent(
        eventType,
        payload,
        context
    ) {

        if (
            !this.eventBus
        ) {

            return;
        }

        if (
            typeof this.eventBus.publish !==
                'function'
        ) {

            throw dependencyError(
                'eventBus does not implement publish()'
            );
        }

        await this.eventBus.publish({
            type:
                eventType,

            payload:
                this.sanitizeMetadata(
                    payload
                ),

            context:
                this.sanitizeMetadata(
                    context
                )
        });
    }

    /* ========================================================================
     * METRICS
     * ====================================================================== */

    incrementMetric(
        name,
        labels = {}
    ) {

        try {

            if (
                typeof this.metrics
                    ?.increment ===
                'function'
            ) {

                this.metrics.increment(
                    name,
                    labels
                );

                return;
            }

            if (
                typeof this.metrics?.inc ===
                'function'
            ) {

                this.metrics.inc(
                    name,
                    labels
                );
            }

        } catch (error) {

            this.safeLog(
                'warn',
                `Reversal metric failed: ${name}`,
                error
            );
        }
    }

    /* ========================================================================
     * TRACING
     * ====================================================================== */

    emitTraceEvent(
        span,
        eventName,
        attributes = {}
    ) {

        if (
            !this.tracing
        ) {

            return;
        }

        try {

            if (
                span &&
                typeof this.tracing
                    .addEvent ===
                    'function'
            ) {

                this.tracing.addEvent(
                    span,
                    eventName,
                    this.sanitizeMetadata(
                        attributes
                    )
                );

                return;
            }

            /*
             * Optional generic trace API.
             */
            if (
                typeof this.tracing.emitEvent ===
                'function'
            ) {

                this.tracing.emitEvent(
                    span,
                    eventName,
                    this.sanitizeMetadata(
                        attributes
                    )
                );
            }

        } catch (error) {

            this.safeLog(
                'warn',
                `Reversal trace event failed: ${eventName}`,
                error
            );
        }
    }

    /* ========================================================================
     * ERROR NORMALIZATION
     * ====================================================================== */

    toReversalError(
        error,
        metadata = {}
    ) {

        if (
            error instanceof
            ReversalEngineError
        ) {

            return error;
        }

        const normalized =
            normalizeError(
                error
            );

        return new ReversalEngineError(
            error?.code ||
                'REVERSAL_FAILED',

            normalized?.message ||
                'Financial reversal failed',

            {
                ...metadata,

                originalError:
                    normalized
            },

            error
        );
    }

    /* ========================================================================
     * RESULT ID
     * ====================================================================== */

    extractResultId(
        result
    ) {

        if (
            !result
        ) {

            return null;
        }

        return normalizeId(
            result.id ||
            result._id ||
            result.transactionId ||
            result.journalId ||
            result.postingId ||
            result.reversalId ||
            result.operationId
        );
    }

    /* ========================================================================
     * METADATA SANITIZATION
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
                DEFAULT_MAX_METADATA_KEYS
            ) {

                break;
            }

            if (
                SENSITIVE_PATTERNS.some(
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
                this.sanitizeValue(
                    value
                );

            count++;
        }

        return output;
    }

    sanitizeValue(
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
                DEFAULT_MAX_REASON_LENGTH
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
                    20
                )
                .map(
                    item =>
                        this.sanitizeValue(
                            item
                        )
                );
        }

        if (
            value &&
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
                    DEFAULT_MAX_METADATA_KEYS
                ) {

                    break;
                }

                if (
                    SENSITIVE_PATTERNS.some(
                        pattern =>
                            pattern.test(
                                key
                            )
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
                    this.sanitizeValue(
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
            DEFAULT_MAX_REASON_LENGTH
        );
    }

    /* ========================================================================
     * DEPENDENCY VALIDATION
     * ====================================================================== */

    validateDependencies() {

        if (
            this.ledgerEngine &&
            !isFunction(
                this.ledgerEngine.post
            )
        ) {

            this.safeLog(
                'warn',
                'LedgerEngine does not expose post()'
            );
        }

        /*
         * Strategy dependencies are intentionally checked lazily by
         * resolveStrategy(), because applications may enable only a subset of
         * reversal types.
         */
        return true;
    }

    /* ========================================================================
     * LOGGING
     * ====================================================================== */

    safeLog(
        level,
        message,
        metadata = {},
        error = null
    ) {

        try {

            const method =
                this.logger?.[
                    level
                ];

            if (
                typeof method !==
                'function'
            ) {

                return;
            }

            method.call(
                this.logger,
                message,
                {
                    ...this.sanitizeMetadata(
                        metadata
                    ),

                    error:
                        error
                            ? normalizeError(
                                error
                            )
                            : undefined
                }
            );

        } catch (_) {

            /*
             * Logging must never affect financial processing.
             */
        }
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'ReversalEngine',

            operation:
                OPERATION,

            supportedTypes:
                [
                    ...SUPPORTED_REVERSAL_TYPES
                ],

            strategies: {

                REFUND:
                    Boolean(
                        this.refundProcessor
                    ),

                SETTLEMENT:
                    Boolean(
                        this.settlementReversal
                    ),

                LOAN_DISBURSEMENT:
                    Boolean(
                        this.loanDisbursementReversal
                    ),

                ADJUSTMENT:
                    Boolean(
                        this.adjustmentManager
                    )
            },

            ledgerEngineConfigured:
                Boolean(
                    this.ledgerEngine
                ),

            compensationBuilderConfigured:
                Boolean(
                    this.compensationBuilder
                ),

            auditConfigured:
                Boolean(
                    this.auditService
                ),

            eventBusConfigured:
                Boolean(
                    this.eventBus
                ),

            tracingConfigured:
                Boolean(
                    this.tracing
                ),

            metricsConfigured:
                Boolean(
                    this.metrics
                ),

            idempotencyConfigured:
                Boolean(
                    this.idempotencyRepository
                ),

            timestamp:
                this.clock()
                    .toISOString()
        };
    }

    /* ========================================================================
     * FACTORY
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new ReversalEngine(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

ReversalEngine.Types =
    SUPPORTED_REVERSAL_TYPES;

ReversalEngine.Events =
    EVENTS;

ReversalEngine.Metrics =
    METRICS;

ReversalEngine.Error =
    ReversalEngineError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports = {
    ReversalEngine,
    ReversalEngineError
};