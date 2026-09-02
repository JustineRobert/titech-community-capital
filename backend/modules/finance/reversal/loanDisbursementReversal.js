'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Loan Disbursement Reversal
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/loanDisbursementReversal.js
 *
 * Purpose:
 *   Controlled reversal workflow for an original loan-disbursement ledger
 *   posting.
 *
 * Responsibilities:
 *   - Locate the original ledger entry safely
 *   - Enforce tenant ownership
 *   - Validate loan-disbursement identity
 *   - Prevent reversal of an already reversed posting
 *   - Construct a compensating journal
 *   - Preserve financial lineage
 *   - Preserve approval / correlation / request / idempotency context
 *   - Delegate the actual reversal posting to LedgerEngine
 *
 * IMPORTANT:
 *
 *   This service does NOT:
 *     - modify the original ledger
 *     - delete the original disbursement
 *     - directly modify account balances
 *     - construct ledger entries itself
 *     - bypass the immutable Ledger Engine
 *
 * The workflow is:
 *
 *   Original Loan Disbursement
 *             │
 *             ▼
 *   Load + validate source ledger
 *             │
 *             ▼
 *   CompensationBuilder
 *             │
 *             ▼
 *   Immutable reversal journal
 *             │
 *             ▼
 *   LedgerEngine.post()
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const OPERATION =
    'finance.loan.disbursement.reversal';

const REVERSAL_TYPE =
    'LOAN_DISBURSEMENT_REVERSAL';

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

class LoanDisbursementReversalError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'LoanDisbursementReversalError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            LoanDisbursementReversalError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new LoanDisbursementReversalError(
        'LOAN_REVERSAL_VALIDATION_ERROR',
        message,
        metadata
    );
}

function notFoundError(
    message,
    metadata = {}
) {

    return new LoanDisbursementReversalError(
        'LOAN_REVERSAL_NOT_FOUND',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new LoanDisbursementReversalError(
        'LOAN_REVERSAL_AUTHORIZATION_ERROR',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new LoanDisbursementReversalError(
        'LOAN_REVERSAL_CONFLICT',
        message,
        metadata
    );
}

function dependencyError(
    message,
    metadata = {}
) {

    return new LoanDisbursementReversalError(
        'LOAN_REVERSAL_DEPENDENCY_ERROR',
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

function normalizeStatus(
    status
) {

    return String(
        status || ''
    )
        .trim()
        .toUpperCase();
}

/* ============================================================================
 * Loan Disbursement Reversal
 * ========================================================================== */

class LoanDisbursementReversal {

    constructor({

        ledgerEngine,

        compensationBuilder,

        auditService = null,

        tracing = null,

        metrics = null,

        logger = null,

        idempotencyRepository = null,

        approvalService = null,

        clock = null,

        idGenerator = null

    } = {}) {

        if (
            !ledgerEngine
        ) {

            throw new TypeError(
                'LoanDisbursementReversal requires ledgerEngine'
            );
        }

        if (
            typeof ledgerEngine.post !==
                'function'
        ) {

            throw new TypeError(
                'LoanDisbursementReversal requires ledgerEngine.post()'
            );
        }

        if (
            !compensationBuilder ||
            typeof compensationBuilder.build !==
                'function'
        ) {

            throw new TypeError(
                'LoanDisbursementReversal requires compensationBuilder.build()'
            );
        }

        this.ledgerEngine =
            ledgerEngine;

        this.compensationBuilder =
            compensationBuilder;

        this.auditService =
            auditService;

        this.tracing =
            tracing;

        this.metrics =
            metrics;

        this.logger =
            logger ||
            console;

        this.idempotencyRepository =
            idempotencyRepository;

        this.approvalService =
            approvalService;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;
    }

    /* ========================================================================
     * EXECUTE
     * ====================================================================== */

    async execute({

        originalLedgerId,

        reason,

        context = {}

    } = {}) {

        const normalizedOriginalLedgerId =
            requireId(
                originalLedgerId,
                'originalLedgerId'
            );

        const normalizedTenantId =
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
                    tenantId:
                        normalizedTenantId,

                    originalLedgerId:
                        normalizedOriginalLedgerId,

                    reason:
                        normalizedReason
                }
            );

        /*
         * Approval remains an explicit control if an approval identifier was
         * supplied or an approval service is configured as mandatory.
         */
        await this.validateApproval(
            operationContext
        );

        /*
         * Establish durable idempotency ownership before constructing or
         * posting the reversal.
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
                'finance_loan_disbursement_reversal_idempotency_hits_total'
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

                                loanReversal:
                                    true,

                                reversal:
                                    true,

                                reversalType:
                                    REVERSAL_TYPE
                            };

                        this.emitEvent(
                            span,
                            'finance.loan.disbursement.reversal.started',
                            {
                                originalLedgerId:
                                    normalizedOriginalLedgerId,

                                operationId:
                                    operationContext
                                        .operationId
                            }
                        );

                        const ledger =
                            await this.findOriginalLedger(
                                normalizedOriginalLedgerId,
                                normalizedTenantId
                            );

                        this.validateOriginalLedger(
                            ledger,
                            operationContext
                        );

                        const journal =
                            await this.compensationBuilder
                                .build({
                                    originalLedger:
                                        ledger,

                                    reason:
                                        normalizedReason,

                                    context:
                                        mergedContext
                                });

                        if (
                            !journal
                        ) {

                            throw dependencyError(
                                'CompensationBuilder returned an empty reversal journal'
                            );
                        }

                        this.emitEvent(
                            span,
                            'finance.loan.disbursement.reversal.journal_built',
                            {
                                originalLedgerId:
                                    normalizedOriginalLedgerId,

                                operationId:
                                    operationContext
                                        .operationId
                            }
                        );

                        /*
                         * LedgerEngine is the only financial mutation boundary.
                         */
                        const postingResult =
                            await this.ledgerEngine
                                .post(
                                    {
                                        journal,

                                        loanReversal:
                                            true,

                                        reversal:
                                            true,

                                        reversalType:
                                            REVERSAL_TYPE,

                                        originalLedgerId:
                                            normalizedOriginalLedgerId,

                                        reason:
                                            normalizedReason
                                    },

                                    mergedContext
                                );

                        this.emitEvent(
                            span,
                            'finance.loan.disbursement.reversal.completed',
                            {
                                originalLedgerId:
                                    normalizedOriginalLedgerId,

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

            await this.completeIdempotency(
                operationContext,
                result
            );

            await this.recordAudit(
                'LOAN_DISBURSEMENT_REVERSAL_EXECUTED',
                {
                    tenantId:
                        normalizedTenantId,

                    originalLedgerId:
                        normalizedOriginalLedgerId,

                    operationId:
                        operationContext
                            .operationId,

                    reversalType:
                        REVERSAL_TYPE,

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
                'finance_loan_disbursement_reversals_completed_total',
                {
                    tenantId:
                        normalizedTenantId
                }
            );

            return result;

        } catch (error) {

            await this.failIdempotency(
                operationContext,
                error
            );

            await this.recordAudit(
                'LOAN_DISBURSEMENT_REVERSAL_FAILED',
                {
                    tenantId:
                        normalizedTenantId,

                    originalLedgerId:
                        normalizedOriginalLedgerId,

                    operationId:
                        operationContext
                            .operationId,

                    reversalType:
                        REVERSAL_TYPE,

                    errorCode:
                        error?.code ||
                        null
                },
                operationContext
            );

            this.incrementMetric(
                'finance_loan_disbursement_reversals_failed_total',
                {
                    tenantId:
                        normalizedTenantId,

                    errorCode:
                        error?.code ||
                        'UNKNOWN'
                }
            );

            throw error;
        }
    }

    /* ========================================================================
     * FIND ORIGINAL LEDGER
     * ====================================================================== */

    async findOriginalLedger(
        ledgerId,
        tenantId
    ) {

        const repositories =
            this.ledgerEngine
                ?.repositories;

        const ledgerRepository =
            repositories?.ledger;

        if (
            !ledgerRepository
        ) {

            throw dependencyError(
                'Ledger repository is unavailable'
            );
        }

        /*
         * Prefer tenant-scoped findById().
         */
        if (
            typeof ledgerRepository.findById ===
            'function'
        ) {

            let ledger;

            try {

                ledger =
                    await ledgerRepository
                        .findById(
                            ledgerId,
                            {
                                tenantId
                            }
                        );

            } catch (error) {

                /*
                 * Compatibility with older repositories whose findById only
                 * accepts the identifier.
                 */
                if (
                    typeof ledgerRepository
                        .findOne ===
                    'function'
                ) {

                    ledger =
                        await ledgerRepository
                            .findOne({
                                _id:
                                    ledgerId,

                                tenantId
                            });
                } else {

                    throw error;
                }
            }

            if (
                ledger
            ) {

                return ledger;
            }
        }

        /*
         * Strong tenant-scoped fallback.
         */
        if (
            typeof ledgerRepository.findOne ===
            'function'
        ) {

            const ledger =
                await ledgerRepository
                    .findOne({
                        _id:
                            ledgerId,

                        tenantId
                    });

            if (
                ledger
            ) {

                return ledger;
            }
        }

        throw notFoundError(
            'Original loan disbursement ledger was not found',
            {
                tenantId,
                originalLedgerId:
                    ledgerId
            }
        );
    }

    /* ========================================================================
     * VALIDATE ORIGINAL LEDGER
     * ====================================================================== */

    validateOriginalLedger(
        ledger,
        context
    ) {

        if (
            !ledger
        ) {

            throw notFoundError(
                'Original ledger was not found',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        const ledgerTenantId =
            normalizeId(
                ledger.tenantId
            );

        if (
            ledgerTenantId &&
            ledgerTenantId !==
                context.tenantId
        ) {

            throw authorizationError(
                'Original ledger belongs to another tenant',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        if (
            !Array.isArray(
                ledger.entries
            ) ||
            ledger.entries.length ===
                0
        ) {

            throw validationError(
                'Original ledger has no entries',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        /*
         * Validate that this is actually a loan disbursement.
         *
         * Different ledger implementations may expose the type through
         * different fields, so accept several explicit domain markers.
         */
        const domainType =
            normalizeStatus(
                ledger.type ||
                ledger.transactionType ||
                ledger.operationType ||
                ledger.sourceType
            );

        const loanDisbursementId =
            normalizeId(
                ledger.loanDisbursementId
            );

        const loanId =
            normalizeId(
                ledger.loanId
            );

        const isLoanDisbursement =
            (
                domainType ===
                    'LOAN_DISBURSEMENT' ||
                domainType ===
                    'LOAN.DISBURSE' ||
                domainType ===
                    'DISBURSEMENT'
            ) ||
            Boolean(
                loanDisbursementId
            );

        if (
            !isLoanDisbursement &&
            !context.allowGenericLoanLedgerReversal
        ) {

            throw conflictError(
                'Original ledger is not identified as a loan disbursement',
                {
                    originalLedgerId:
                        context.originalLedgerId,

                    ledgerType:
                        domainType || null,

                    loanId
                }
            );
        }

        /*
         * Prevent a second reversal of the same source ledger when the source
         * exposes explicit reversal state.
         */
        if (
            ledger.reversed === true ||
            ledger.isReversed === true ||
            ledger.alreadyReversed === true
        ) {

            throw conflictError(
                'Loan disbursement has already been reversed',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        /*
         * A reversal reference on the source is another strong indicator that
         * the original transaction has already been compensated.
         */
        if (
            normalizeId(
                ledger.reversalId
            ) ||
            normalizeId(
                ledger.reversedByLedgerId
            )
        ) {

            throw conflictError(
                'Original loan disbursement already has a reversal lineage',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        /*
         * Preserve lineage identity in the execution context.
         */
        context.loanId =
            loanId;

        context.loanDisbursementId =
            loanDisbursementId;

        return true;
    }

    /* ========================================================================
     * APPROVAL
     * ====================================================================== */

    async validateApproval(
        context
    ) {

        const approvalId =
            normalizeId(
                context.approvalId
            );

        if (
            !approvalId
        ) {

            /*
             * Approval service is optional for compatibility. When supplied,
             * however, an approval ID becomes mandatory.
             */
            if (
                this.approvalService
            ) {

                throw authorizationError(
                    'approvalId is required for loan disbursement reversal'
                );
            }

            return true;
        }

        if (
            !this.approvalService
        ) {

            throw dependencyError(
                'approvalService is required when approvalId is supplied'
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
                            REVERSAL_TYPE,

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
                    'Loan disbursement reversal approval is not valid',
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
                    'Loan disbursement reversal approval was not found'
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
                    'Loan disbursement reversal approval is not APPROVED',
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
                'Loan disbursement reversal approval belongs to another tenant'
            );
        }

        return true;
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

                            reversalType:
                                REVERSAL_TYPE,

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
                    REVERSAL_TYPE,

                    context.tenantId,

                    context.originalLedgerId,

                    context.approvalId ||
                        '',

                    context.operationId ||
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
            'Loan disbursement reversal is already being executed by another operation',
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
     * IDEMPOTENCY COMPLETE
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
     * IDEMPOTENCY FAILURE
     * ====================================================================== */

    async failIdempotency(
        context,
        error
    ) {

        if (
            !this.idempotencyRepository ||
            !context.idempotencyKey
        ) {

            return;
        }

        if (
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

            this.safeLog(
                'error',
                'Failed to record loan reversal idempotency failure',
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
                `Loan reversal tracing failed: ${eventName}`,
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
                `Failed to record loan reversal audit: ${action}`,
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
                `Loan reversal metric failed: ${name}`,
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
                'LoanDisbursementReversal',

            operation:
                OPERATION,

            reversalType:
                REVERSAL_TYPE,

            ledgerEngineConfigured:
                Boolean(
                    this.ledgerEngine
                ),

            ledgerRepositoryConfigured:
                Boolean(
                    this.ledgerEngine
                        ?.repositories
                        ?.ledger
                ),

            compensationBuilderConfigured:
                Boolean(
                    this.compensationBuilder
                ),

            approvalServiceConfigured:
                Boolean(
                    this.approvalService
                ),

            idempotencyRepositoryConfigured:
                Boolean(
                    this.idempotencyRepository
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

        return new LoanDisbursementReversal(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

LoanDisbursementReversal.TYPE =
    REVERSAL_TYPE;

LoanDisbursementReversal.OPERATION =
    OPERATION;

LoanDisbursementReversal.Error =
    LoanDisbursementReversalError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    LoanDisbursementReversal;