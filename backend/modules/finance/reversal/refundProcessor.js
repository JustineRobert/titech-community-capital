'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Refund Processor
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/refundProcessor.js
 *
 * Purpose:
 *   Controlled orchestration boundary for refund/reversal postings against
 *   an immutable original financial ledger transaction.
 *
 * Responsibilities:
 *   - Validate refund request
 *   - Enforce tenant ownership
 *   - Load original ledger safely
 *   - Validate refund eligibility
 *   - Prevent duplicate reversal/refund execution
 *   - Build compensating journal
 *   - Preserve financial lineage
 *   - Preserve correlation / request / operation identity
 *   - Preserve durable idempotency claim ownership
 *   - Delegate actual posting to LedgerEngine
 *   - Integrate audit / tracing / metrics
 *
 * IMPORTANT:
 *
 *   RefundProcessor DOES NOT:
 *     - edit the original ledger
 *     - delete the original transaction
 *     - modify balances directly
 *     - construct ledger entries directly
 *     - bypass LedgerEngine
 *
 *   The refund is represented as a NEW immutable financial posting.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const OPERATION =
    'finance.refund';

const REFUND_TYPE =
    'REFUND';

const DEFAULT_MAX_REASON_LENGTH =
    2000;

const SENSITIVE_PATTERNS = Object.freeze([
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
]);

/* ============================================================================
 * Errors
 * ========================================================================== */

class RefundProcessorError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'RefundProcessorError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            RefundProcessorError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new RefundProcessorError(
        'REFUND_VALIDATION_ERROR',
        message,
        metadata
    );
}

function notFoundError(
    message,
    metadata = {}
) {

    return new RefundProcessorError(
        'REFUND_NOT_FOUND',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new RefundProcessorError(
        'REFUND_CONFLICT',
        message,
        metadata
    );
}

function dependencyError(
    message,
    metadata = {}
) {

    return new RefundProcessorError(
        'REFUND_DEPENDENCY_ERROR',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new RefundProcessorError(
        'REFUND_AUTHORIZATION_ERROR',
        message,
        metadata
    );
}

/* ============================================================================
 * Utilities
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
        String(value).trim();

    return normalized || null;
}

function requireId(
    value,
    fieldName
) {

    const normalized =
        normalizeId(value);

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

function normalizeReason(
    reason
) {

    const normalized =
        normalizeId(reason);

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

function normalizeStatus(
    value
) {

    return String(
        value || ''
    )
        .trim()
        .toUpperCase();
}

/* ============================================================================
 * Refund Processor
 * ========================================================================== */

class RefundProcessor {

    constructor({
        ledgerEngine,

        compensationBuilder,

        ledgerRepository,

        idempotencyRepository = null,

        approvalService = null,

        auditService = null,

        tracing = null,

        metrics = null,

        logger = null,

        clock = null,

        idGenerator = null,

        requireApproval = false

    } = {}) {

        if (
            !ledgerEngine ||
            typeof ledgerEngine.post !==
                'function'
        ) {

            throw new TypeError(
                'RefundProcessor requires ledgerEngine.post()'
            );
        }

        if (
            !compensationBuilder ||
            typeof compensationBuilder.build !==
                'function'
        ) {

            throw new TypeError(
                'RefundProcessor requires compensationBuilder.build()'
            );
        }

        if (
            !ledgerRepository
        ) {

            throw new TypeError(
                'RefundProcessor requires ledgerRepository'
            );
        }

        this.ledgerEngine =
            ledgerEngine;

        this.compensationBuilder =
            compensationBuilder;

        this.ledgerRepository =
            ledgerRepository;

        this.idempotencyRepository =
            idempotencyRepository;

        this.approvalService =
            approvalService;

        this.auditService =
            auditService;

        this.tracing =
            tracing;

        this.metrics =
            metrics;

        this.logger =
            logger ||
            console;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;

        this.requireApproval =
            Boolean(
                requireApproval
            );
    }

    /* ========================================================================
     * EXECUTE REFUND
     * ====================================================================== */

    async execute({
        originalLedgerId,
        reason,
        context = {}
    } = {}) {

        const normalizedLedgerId =
            requireId(
                originalLedgerId,
                'originalLedgerId'
            );

        const tenantId =
            requireId(
                context.tenantId,
                'tenantId'
            );

        const normalizedReason =
            normalizeReason(
                reason
            );

        const operationContext =
            this.createOperationContext(
                context,
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    reason:
                        normalizedReason
                }
            );

        /*
         * Authorization is checked before a durable execution claim.
         */
        await this.validateApproval(
            operationContext
        );

        /*
         * Claim the refund operation before constructing/posting the new
         * financial transaction.
         */
        const claim =
            await this.claimIdempotency(
                operationContext
            );

        if (
            claim?.claimed
        ) {

            operationContext.claimToken =
                claim.claimToken ||
                claim.record?.claimToken ||
                null;

        } else if (
            claim?.duplicate
        ) {

            this.incrementMetric(
                'finance_refund_idempotency_hits_total'
            );

            return this.resolveDuplicateResult(
                claim
            );
        }

        try {

            const result =
                await this.withTrace(
                    operationContext,
                    async (
                        span,
                        traceContext
                    ) => {

                        const mergedContext =
                            {
                                ...operationContext,

                                ...(traceContext ||
                                    {}),

                                refund:
                                    true,

                                refundType:
                                    REFUND_TYPE,

                                reversal:
                                    true,

                                reversalType:
                                    REFUND_TYPE
                            };

                        this.emitEvent(
                            span,
                            'finance.refund.started',
                            {
                                originalLedgerId:
                                    normalizedLedgerId,

                                operationId:
                                    operationContext
                                        .operationId,

                                correlationId:
                                    operationContext
                                        .correlationId
                            }
                        );

                        const original =
                            await this.findOriginalLedger(
                                normalizedLedgerId,
                                tenantId
                            );

                        this.validateRefundEligibility(
                            original,
                            mergedContext
                        );

                        const journal =
                            await this.compensationBuilder
                                .build({
                                    originalLedger:
                                        original,

                                    reason:
                                        normalizedReason,

                                    context:
                                        mergedContext
                                });

                        if (
                            !journal
                        ) {

                            throw dependencyError(
                                'CompensationBuilder returned an empty refund journal'
                            );
                        }

                        this.emitEvent(
                            span,
                            'finance.refund.journal_built',
                            {
                                originalLedgerId:
                                    normalizedLedgerId,

                                operationId:
                                    operationContext
                                        .operationId
                            }
                        );

                        /*
                         * LedgerEngine is the sole financial mutation boundary.
                         */
                        const postingResult =
                            await this.ledgerEngine
                                .post(
                                    {
                                        journal,

                                        reversalOf:
                                            normalizedLedgerId,

                                        refund:
                                            true,

                                        refundType:
                                            REFUND_TYPE,

                                        reversal:
                                            true,

                                        reversalType:
                                            REFUND_TYPE,

                                        reason:
                                            normalizedReason
                                    },

                                    mergedContext
                                );

                        this.emitEvent(
                            span,
                            'finance.refund.completed',
                            {
                                originalLedgerId:
                                    normalizedLedgerId,

                                operationId:
                                    operationContext
                                        .operationId,

                                resultId:
                                    this.extractResultId(
                                        postingResult
                                    )
                            }
                        );

                        return postingResult;
                    }
                );

            /*
             * Make successful posting durable in the operation/idempotency
             * repository before returning to the caller.
             */
            await this.completeIdempotency(
                operationContext,
                result
            );

            await this.recordAudit(
                'REFUND_EXECUTED',
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    operationId:
                        operationContext
                            .operationId,

                    refundType:
                        REFUND_TYPE,

                    approvalId:
                        operationContext
                            .approvalId,

                    resultId:
                        this.extractResultId(
                            result
                        )
                },
                operationContext
            );

            this.incrementMetric(
                'finance_refunds_completed_total',
                {
                    tenantId
                }
            );

            return result;

        } catch (error) {

            await this.failIdempotency(
                operationContext,
                error
            );

            await this.recordAudit(
                'REFUND_FAILED',
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    operationId:
                        operationContext
                            .operationId,

                    refundType:
                        REFUND_TYPE,

                    errorCode:
                        error?.code ||
                        null
                },
                operationContext
            );

            this.incrementMetric(
                'finance_refunds_failed_total',
                {
                    tenantId,

                    errorCode:
                        error?.code ||
                        'UNKNOWN'
                }
            );

            throw error;
        }
    }

    /* ========================================================================
     * ORIGINAL LEDGER LOOKUP
     * ====================================================================== */

    async findOriginalLedger(
        ledgerId,
        tenantId
    ) {

        if (
            !this.ledgerRepository
        ) {

            throw dependencyError(
                'Ledger repository is unavailable'
            );
        }

        /*
         * Prefer an explicitly tenant-scoped lookup.
         */
        if (
            typeof this.ledgerRepository
                .findById ===
            'function'
        ) {

            try {

                const original =
                    await this.ledgerRepository
                        .findById(
                            ledgerId,
                            {
                                tenantId
                            }
                        );

                if (
                    original
                ) {

                    return original;
                }

            } catch (error) {

                /*
                 * Compatibility fallback for repositories whose historical
                 * findById() accepts only the ID.
                 */
                if (
                    typeof this.ledgerRepository
                        .findOne !==
                    'function'
                ) {

                    throw error;
                }
            }
        }

        /*
         * Tenant-scoped fallback.
         */
        if (
            typeof this.ledgerRepository
                .findOne ===
            'function'
        ) {

            const original =
                await this.ledgerRepository
                    .findOne({
                        _id:
                            ledgerId,

                        tenantId
                    });

            if (
                original
            ) {

                return original;
            }
        }

        throw notFoundError(
            'Original ledger transaction was not found',
            {
                tenantId,

                originalLedgerId:
                    ledgerId
            }
        );
    }

    /* ========================================================================
     * REFUND ELIGIBILITY
     * ====================================================================== */

    validateRefundEligibility(
        original,
        context
    ) {

        if (
            !original
        ) {

            throw notFoundError(
                'Original ledger transaction was not found'
            );
        }

        const originalTenantId =
            normalizeId(
                original.tenantId
            );

        if (
            originalTenantId &&
            originalTenantId !==
                context.tenantId
        ) {

            throw authorizationError(
                'Original ledger belongs to another tenant'
            );
        }

        if (
            original.reversed === true ||
            original.isReversed === true ||
            original.alreadyReversed === true
        ) {

            throw conflictError(
                'Original ledger transaction has already been reversed'
            );
        }

        if (
            normalizeId(
                original.reversalId
            ) ||
            normalizeId(
                original.reversedByLedgerId
            )
        ) {

            throw conflictError(
                'Original ledger transaction already has reversal lineage'
            );
        }

        /*
         * Reject a reversal/refund ledger itself unless an explicit corrective
         * workflow says otherwise.
         */
        const transactionType =
            normalizeStatus(
                original.type ||
                original.transactionType ||
                original.operationType
            );

        if (
            (
                transactionType ===
                    'REVERSAL' ||
                transactionType ===
                    'REFUND'
            ) &&
            context.allowRefundOfReversal !==
                true
        ) {

            throw conflictError(
                'A reversal/refund transaction cannot be refunded through the standard refund workflow',
                {
                    transactionType
                }
            );
        }

        return true;
    }

    /* ========================================================================
     * APPROVAL
     * ====================================================================== */

    async validateApproval(
        context
    ) {

        if (
            !this.requireApproval
        ) {

            return true;
        }

        const approvalId =
            normalizeId(
                context.approvalId
            );

        if (
            !approvalId
        ) {

            throw authorizationError(
                'approvalId is required for refund processing'
            );
        }

        if (
            !this.approvalService
        ) {

            throw dependencyError(
                'approvalService is required when refund approval is enabled'
            );
        }

        if (
            typeof this.approvalService
                .verify ===
            'function'
        ) {

            const result =
                await this.approvalService
                    .verify({
                        approvalId,

                        type:
                            REFUND_TYPE,

                        tenantId:
                            context.tenantId,

                        operationId:
                            context.operationId
                    });

            const approved =
                result === true ||
                result?.approved === true ||
                normalizeStatus(
                    result?.status
                ) ===
                    'APPROVED';

            if (
                !approved
            ) {

                throw authorizationError(
                    'Refund approval is not valid',
                    {
                        approvalId
                    }
                );
            }

            this.validateApprovalTenant(
                result,
                context
            );

            return true;
        }

        if (
            typeof this.approvalService
                .findById ===
            'function'
        ) {

            const approval =
                await this.approvalService
                    .findById(
                        approvalId
                    );

            if (
                !approval
            ) {

                throw authorizationError(
                    'Refund approval was not found'
                );
            }

            this.validateApprovalTenant(
                approval,
                context
            );

            if (
                normalizeStatus(
                    approval.status
                ) !==
                'APPROVED'
            ) {

                throw authorizationError(
                    'Refund approval is not APPROVED',
                    {
                        approvalId,

                        status:
                            approval.status
                    }
                );
            }

            return true;
        }

        throw dependencyError(
            'approvalService must implement verify() or findById()'
        );
    }

    validateApprovalTenant(
        approval,
        context
    ) {

        if (
            approval?.tenantId &&
            String(
                approval.tenantId
            ) !==
            String(
                context.tenantId
            )
        ) {

            throw authorizationError(
                'Refund approval belongs to another tenant'
            );
        }
    }

    /* ========================================================================
     * OPERATION CONTEXT
     * ====================================================================== */

    createOperationContext(
        context,
        overrides
    ) {

        return {

            ...this.sanitizeContext(
                context
            ),

            ...overrides,

            operation:
                OPERATION,

            operationId:
                normalizeId(
                    context.operationId
                ) ||
                this.idGenerator(),

            correlationId:
                normalizeId(
                    context.correlationId
                ) ||
                this.idGenerator(),

            requestId:
                normalizeId(
                    context.requestId
                ),

            tenantId:
                requireId(
                    overrides.tenantId ||
                    context.tenantId,
                    'tenantId'
                ),

            originalLedgerId:
                requireId(
                    overrides.originalLedgerId ||
                    context.originalLedgerId,
                    'originalLedgerId'
                ),

            actorId:
                normalizeId(
                    context.actorId ||
                    context.userId
                ),

            approvalId:
                normalizeId(
                    context.approvalId
                ),

            idempotencyKey:
                normalizeId(
                    context.idempotencyKey ||
                    context.operationKey
                ),

            claimToken:
                normalizeId(
                    context.claimToken
                ),

            reason:
                normalizeReason(
                    overrides.reason ||
                    context.reason
                )
        };
    }

    /* ========================================================================
     * IDEMPOTENCY CLAIM
     * ====================================================================== */

    async claimIdempotency(
        context
    ) {

        if (
            !this.idempotencyRepository
        ) {

            return null;
        }

        if (
            typeof this.idempotencyRepository
                .claim !==
            'function'
        ) {

            throw dependencyError(
                'Configured idempotencyRepository does not implement claim()'
            );
        }

        const key =
            normalizeId(
                context.idempotencyKey
            ) ||
            this.buildDefaultIdempotencyKey(
                context
            );

        context.idempotencyKey =
            key;

        const result =
            await this.idempotencyRepository
                .claim(
                    key,
                    {
                        tenantId:
                            context.tenantId,

                        operationId:
                            context.operationId,

                        correlationId:
                            context.correlationId,

                        requestId:
                            context.requestId,

                        statementId:
                            context.originalLedgerId,

                        metadata: {

                            refundType:
                                REFUND_TYPE,

                            originalLedgerId:
                                context
                                    .originalLedgerId
                        }
                    }
                );

        if (
            result?.claimToken
        ) {

            context.claimToken =
                result.claimToken;

        } else if (
            result?.record?.claimToken
        ) {

            context.claimToken =
                result.record.claimToken;
        }

        return result;
    }

    /* ========================================================================
     * DEFAULT IDEMPOTENCY KEY
     * ====================================================================== */

    buildDefaultIdempotencyKey(
        context
    ) {

        return crypto
            .createHash('sha256')
            .update(
                [
                    REFUND_TYPE,

                    context.tenantId,

                    context.originalLedgerId,

                    context.approvalId ||
                        ''
                ].join(':')
            )
            .digest('hex');
    }

    /* ========================================================================
     * DUPLICATE RESULT
     * ====================================================================== */

    resolveDuplicateResult(
        claim
    ) {

        const record =
            claim?.record;

        if (
            record?.result
        ) {

            return record.result;
        }

        if (
            normalizeStatus(
                record?.status
            ) ===
            'COMPLETED'
        ) {

            return record;
        }

        throw conflictError(
            'Refund operation is already being executed by another operation',
            {
                operationKey:
                    record?.operationKey ||
                    null,

                status:
                    record?.status ||
                    null
            }
        );
    }

    /* ========================================================================
     * COMPLETE IDEMPOTENCY
     * ====================================================================== */

    async completeIdempotency(
        context,
        result
    ) {

        if (
            !this.idempotencyRepository ||
            !context.idempotencyKey
        ) {

            return;
        }

        if (
            typeof this.idempotencyRepository
                .complete !==
            'function'
        ) {

            throw dependencyError(
                'Configured idempotencyRepository does not implement complete()'
            );
        }

        await this.idempotencyRepository
            .complete(
                context.idempotencyKey,
                {
                    tenantId:
                        context.tenantId,

                    claimToken:
                        context.claimToken ||
                        null,

                    resultId:
                        this.extractResultId(
                            result
                        )
                }
            );
    }

    /* ========================================================================
     * FAIL IDEMPOTENCY
     * ====================================================================== */

    async failIdempotency(
        context,
        error
    ) {

        if (
            !this.idempotencyRepository ||
            !context.idempotencyKey ||
            typeof this.idempotencyRepository
                .fail !==
                'function'
        ) {

            return;
        }

        try {

            await this.idempotencyRepository
                .fail(
                    context.idempotencyKey,
                    {
                        tenantId:
                            context.tenantId,

                        claimToken:
                            context.claimToken ||
                            null,

                        errorCode:
                            error?.code ||
                            null,

                        errorMessage:
                            this.sanitizeErrorMessage(
                                error?.message
                            ),

                        stage:
                            'ledger.post',

                        retryable:
                            Boolean(
                                error?.retryable
                            )
                    }
                );

        } catch (idempotencyError) {

            /*
             * The underlying refund/posting failure remains authoritative.
             */
            this.safeLog(
                'error',
                'Failed to record refund idempotency failure',
                idempotencyError
            );
        }
    }

    /* ========================================================================
     * TRACE
     * ====================================================================== */

    async withTrace(
        context,
        callback
    ) {

        if (
            !this.tracing ||
            typeof this.tracing.trace !==
                'function'
        ) {

            return callback(
                null,
                context
            );
        }

        return this.tracing.trace(
            OPERATION,
            callback,
            context
        );
    }

    emitEvent(
        span,
        eventName,
        metadata = {}
    ) {

        if (
            !span ||
            !this.tracing ||
            typeof this.tracing
                .addEvent !==
                'function'
        ) {

            return;
        }

        try {

            this.tracing.addEvent(
                span,
                eventName,
                this.sanitizeContext(
                    metadata
                )
            );

        } catch (error) {

            this.safeLog(
                'warn',
                `Refund tracing failed: ${eventName}`,
                error
            );
        }
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
                this.sanitizeContext(
                    entity
                ),

            context:
                this.sanitizeContext(
                    context
                ),

            occurredAt:
                this.clock()
        };

        try {

            if (
                typeof this.auditService
                    .record ===
                'function'
            ) {

                if (
                    this.auditService
                        .record.length <=
                    1
                ) {

                    await this.auditService
                        .record(
                            payload
                        );

                } else {

                    await this.auditService
                        .record(
                            action,
                            payload
                        );
                }

                return;
            }

            if (
                typeof this.auditService
                    .log ===
                'function'
            ) {

                await this.auditService
                    .log(
                        action,
                        payload
                    );
            }

        } catch (error) {

            this.safeLog(
                'error',
                `Failed to record refund audit: ${action}`,
                error
            );
        }
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
                `Refund metric failed: ${name}`,
                error
            );
        }
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
            result.operationId
        );
    }

    /* ========================================================================
     * ERROR SANITIZATION
     * ====================================================================== */

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
            DEFAULT_MAX_REASON_LENGTH
        );
    }

    /* ========================================================================
     * CONTEXT SANITIZATION
     * ====================================================================== */

    sanitizeContext(
        context = {}
    ) {

        const result = {};
        let count = 0;

        if (
            !context ||
            typeof context !==
                'object'
        ) {

            return result;
        }

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                context
            )
        ) {

            if (
                count >= 50
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

            if (
                typeof value ===
                    'string' ||
                typeof value ===
                    'number' ||
                typeof value ===
                    'boolean'
            ) {

                result[
                    String(
                        key
                    ).slice(
                        0,
                        128
                    )
                ] =
                    typeof value ===
                        'string'
                        ? value.slice(
                            0,
                            DEFAULT_MAX_REASON_LENGTH
                        )
                        : value;

            } else if (
                value instanceof Date
            ) {

                result[
                    String(
                        key
                    ).slice(
                        0,
                        128
                    )
                ] =
                    value.toISOString();
            }

            count++;
        }

        return result;
    }

    /* ========================================================================
     * LOGGING
     * ====================================================================== */

    safeLog(
        level,
        message,
        error
    ) {

        try {

            const method =
                this.logger?.[
                    level
                ];

            if (
                typeof method ===
                'function'
            ) {

                method.call(
                    this.logger,
                    message,
                    {
                        error:
                            error instanceof
                            Error
                                ? error.message
                                : error
                    }
                );
            }

        } catch (_) {
            // Logging must never affect financial processing.
        }
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'RefundProcessor',

            operation:
                OPERATION,

            refundType:
                REFUND_TYPE,

            ledgerEngineConfigured:
                Boolean(
                    this.ledgerEngine
                ),

            ledgerRepositoryConfigured:
                Boolean(
                    this.ledgerRepository
                ),

            compensationBuilderConfigured:
                Boolean(
                    this.compensationBuilder
                ),

            idempotencyRepositoryConfigured:
                Boolean(
                    this.idempotencyRepository
                ),

            approvalServiceConfigured:
                Boolean(
                    this.approvalService
                ),

            auditServiceConfigured:
                Boolean(
                    this.auditService
                ),

            tracingConfigured:
                Boolean(
                    this.tracing
                ),

            metricsConfigured:
                Boolean(
                    this.metrics
                ),

            approvalRequired:
                this.requireApproval,

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

        return new RefundProcessor(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

RefundProcessor.TYPE =
    REFUND_TYPE;

RefundProcessor.OPERATION =
    OPERATION;

RefundProcessor.Error =
    RefundProcessorError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    RefundProcessor;