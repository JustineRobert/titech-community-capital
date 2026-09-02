'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Settlement Reversal
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/settlementReversal.js
 *
 * Purpose:
 *   Controlled reversal workflow for an original settlement ledger posting.
 *
 * Responsibilities:
 *   - Validate settlement reversal requests
 *   - Require tenant-scoped source lookup
 *   - Validate provider settlement identity
 *   - Validate provider-reference / reconciliation state
 *   - Prevent duplicate settlement reversals
 *   - Construct compensating journal through CompensationBuilder
 *   - Preserve original financial lineage
 *   - Preserve correlation / request / operation / idempotency context
 *   - Preserve durable claim ownership
 *   - Delegate actual financial mutation to LedgerEngine
 *   - Support audit / tracing / metrics integration
 *
 * IMPORTANT:
 *
 *   This service does NOT:
 *     - edit the original settlement ledger
 *     - update account balances directly
 *     - delete settlement records
 *     - create journal entries directly
 *     - bypass LedgerEngine
 *
 *   Every reversal creates a NEW immutable financial posting.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const OPERATION =
    'finance.settlement.reversal';

const REVERSAL_TYPE =
    'SETTLEMENT_REVERSAL';

const DEFAULT_MAX_REASON_LENGTH =
    2000;

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
        /response.?body/i
    ]);

/* ============================================================================
 * Errors
 * ========================================================================== */

class SettlementReversalError extends Error {

    constructor(
        code,
        message,
        metadata = {},
        cause = null
    ) {

        super(message);

        this.name =
            'SettlementReversalError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        if (
            cause
        ) {

            this.cause =
                cause;
        }

        Error.captureStackTrace?.(
            this,
            SettlementReversalError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new SettlementReversalError(
        'SETTLEMENT_REVERSAL_VALIDATION_ERROR',
        message,
        metadata
    );
}

function notFoundError(
    message,
    metadata = {}
) {

    return new SettlementReversalError(
        'SETTLEMENT_REVERSAL_NOT_FOUND',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new SettlementReversalError(
        'SETTLEMENT_REVERSAL_CONFLICT',
        message,
        metadata
    );
}

function dependencyError(
    message,
    metadata = {}
) {

    return new SettlementReversalError(
        'SETTLEMENT_REVERSAL_DEPENDENCY_ERROR',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new SettlementReversalError(
        'SETTLEMENT_REVERSAL_AUTHORIZATION_ERROR',
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

    return normalized || null;
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
    value
) {

    return String(
        value || ''
    )
        .trim()
        .toUpperCase();
}

function normalizeProviderReference(
    value
) {

    const normalized =
        normalizeId(
            value
        );

    if (
        !normalized
    ) {

        return null;
    }

    return normalized.slice(
        0,
        512
    );
}

/* ============================================================================
 * Settlement Reversal
 * ========================================================================== */

class SettlementReversal {

    constructor({

        ledgerEngine,

        compensationBuilder,

        reconciliationService,

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
                'SettlementReversal requires ledgerEngine.post()'
            );
        }

        if (
            !compensationBuilder ||
            typeof compensationBuilder.build !==
                'function'
        ) {

            throw new TypeError(
                'SettlementReversal requires compensationBuilder.build()'
            );
        }

        if (
            !reconciliationService
        ) {

            throw new TypeError(
                'SettlementReversal requires reconciliationService'
            );
        }

        this.ledgerEngine =
            ledgerEngine;

        this.compensationBuilder =
            compensationBuilder;

        this.reconciliationService =
            reconciliationService;

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
     * EXECUTE
     * ====================================================================== */

    async execute({

        originalLedgerId,

        reason,

        providerReference,

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

        const normalizedProviderReference =
            normalizeProviderReference(
                providerReference ||
                context.providerReference ||
                context.providerTransactionReference
            );

        const operationContext =
            this.createOperationContext(
                context,
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    reason:
                        normalizedReason,

                    providerReference:
                        normalizedProviderReference
                }
            );

        /*
         * A settlement reversal should carry provider correlation whenever
         * reconciliation depends on provider identity.
         */
        await this.validateSettlementContext(
            operationContext
        );

        await this.validateApproval(
            operationContext
        );

        /*
         * Establish durable ownership before constructing/posting the
         * financial reversal.
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
                'finance_settlement_reversal_idempotency_hits_total'
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

                                settlementReversal:
                                    true,

                                reversal:
                                    true,

                                reversalType:
                                    REVERSAL_TYPE
                            };

                        this.emitEvent(
                            span,
                            'finance.settlement.reversal.started',
                            {
                                originalLedgerId:
                                    normalizedLedgerId,

                                providerReference:
                                    normalizedProviderReference,

                                operationId:
                                    operationContext
                                        .operationId
                            }
                        );

                        /*
                         * Reconciliation is authoritative for the settlement
                         * provider relationship.
                         */
                        await this.validateSettlementReversal(
                            mergedContext
                        );

                        const ledger =
                            await this.findOriginalLedger(
                                normalizedLedgerId,
                                tenantId
                            );

                        this.validateOriginalLedger(
                            ledger,
                            mergedContext
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
                                'CompensationBuilder returned an empty settlement reversal journal'
                            );
                        }

                        this.emitEvent(
                            span,
                            'finance.settlement.reversal.journal_built',
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

                                        settlementReversal:
                                            true,

                                        reversal:
                                            true,

                                        reversalType:
                                            REVERSAL_TYPE,

                                        reversalOf:
                                            normalizedLedgerId,

                                        originalLedgerId:
                                            normalizedLedgerId,

                                        providerReference:
                                            normalizedProviderReference,

                                        reason:
                                            normalizedReason
                                    },

                                    mergedContext
                                );

                        this.emitEvent(
                            span,
                            'finance.settlement.reversal.completed',
                            {
                                originalLedgerId:
                                    normalizedLedgerId,

                                providerReference:
                                    normalizedProviderReference,

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
             * Completion happens before success is returned.
             */
            await this.completeIdempotency(
                operationContext,
                result
            );

            await this.recordAudit(
                'SETTLEMENT_REVERSAL_EXECUTED',
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    providerReference:
                        normalizedProviderReference,

                    operationId:
                        operationContext
                            .operationId,

                    reversalType:
                        REVERSAL_TYPE,

                    resultId:
                        this.extractResultId(
                            result
                        )
                },
                operationContext
            );

            this.incrementMetric(
                'finance_settlement_reversals_completed_total',
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
                'SETTLEMENT_REVERSAL_FAILED',
                {
                    tenantId,

                    originalLedgerId:
                        normalizedLedgerId,

                    providerReference:
                        normalizedProviderReference,

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
                'finance_settlement_reversals_failed_total',
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
     * SETTLEMENT CONTEXT VALIDATION
     * ====================================================================== */

    async validateSettlementContext(
        context
    ) {

        /*
         * Provider reference can be optional only when the surrounding
         * reconciliation implementation can identify the settlement from the
         * original ledger identity.
         */
        if (
            !context.providerReference &&
            !context.providerSettlementId &&
            !context.settlementId &&
            !context.allowLedgerOnlySettlementReversal
        ) {

            throw validationError(
                'providerReference, providerSettlementId, or settlementId is required for settlement reversal'
            );
        }

        return true;
    }

    /* ========================================================================
     * RECONCILIATION VALIDATION
     * ====================================================================== */

    async validateSettlementReversal(
        context
    ) {

        if (
            typeof this.reconciliationService
                .validateSettlementReversal !==
            'function'
        ) {

            throw dependencyError(
                'reconciliationService.validateSettlementReversal() is unavailable'
            );
        }

        const result =
            await this.reconciliationService
                .validateSettlementReversal({
                    tenantId:
                        context.tenantId,

                    provider:
                        context.provider ||
                        null,

                    providerReference:
                        context.providerReference ||
                        null,

                    providerSettlementId:
                        context.providerSettlementId ||
                        null,

                    settlementId:
                        context.settlementId ||
                        null,

                    originalLedgerId:
                        context.originalLedgerId,

                    correlationId:
                        context.correlationId,

                    reversalId:
                        context.reversalId
                });

        /*
         * Accept:
         *   true
         *   { valid: true }
         *   { approved: true }
         *
         * Also accept undefined for backward compatibility with an existing
         * validator that throws on failure but returns nothing on success.
         */
        if (
            result === false ||
            result?.valid === false ||
            result?.approved === false
        ) {

            throw conflictError(
                'Settlement reversal failed reconciliation validation',
                {
                    providerReference:
                        context.providerReference,

                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        return result;
    }

    /* ========================================================================
     * FIND ORIGINAL LEDGER
     * ====================================================================== */

    async findOriginalLedger(
        ledgerId,
        tenantId
    ) {

        const repository =
            this.ledgerEngine
                ?.repositories
                ?.ledger;

        if (
            !repository
        ) {

            throw dependencyError(
                'Ledger repository is unavailable'
            );
        }

        /*
         * Prefer tenant-aware repository APIs.
         */
        if (
            typeof repository.findById ===
            'function'
        ) {

            try {

                const ledger =
                    await repository.findById(
                        ledgerId,
                        {
                            tenantId
                        }
                    );

                if (
                    ledger
                ) {

                    return ledger;
                }

            } catch (error) {

                /*
                 * Compatibility fallback to findOne() for the earlier
                 * repository contract.
                 */
                if (
                    typeof repository.findOne !==
                    'function'
                ) {

                    throw error;
                }
            }
        }

        if (
            typeof repository.findOne ===
            'function'
        ) {

            const ledger =
                await repository.findOne({
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
            'Original settlement ledger was not found',
            {
                tenantId,

                originalLedgerId:
                    ledgerId
            }
        );
    }

    /* ========================================================================
     * ORIGINAL LEDGER VALIDATION
     * ====================================================================== */

    validateOriginalLedger(
        ledger,
        context
    ) {

        if (
            !ledger
        ) {

            throw notFoundError(
                'Original settlement ledger was not found'
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
                'Original settlement ledger belongs to another tenant'
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
                'Original settlement ledger contains no entries'
            );
        }

        /*
         * Reject an already reversed source ledger.
         */
        if (
            ledger.reversed === true ||
            ledger.isReversed === true ||
            ledger.alreadyReversed === true
        ) {

            throw conflictError(
                'Settlement ledger has already been reversed',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        /*
         * Reject a source that already has explicit reversal lineage.
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
                'Settlement ledger already contains reversal lineage',
                {
                    originalLedgerId:
                        context.originalLedgerId
                }
            );
        }

        /*
         * Prevent generic reversal-of-reversal operations.
         */
        const ledgerType =
            normalizeStatus(
                ledger.type ||
                ledger.transactionType ||
                ledger.operationType ||
                ledger.sourceType
            );

        if (
            (
                ledgerType ===
                    'REVERSAL' ||
                ledgerType ===
                    'SETTLEMENT_REVERSAL'
            ) &&
            context.allowReversalOfReversal !==
                true
        ) {

            throw conflictError(
                'A settlement reversal cannot itself be reversed through the standard settlement workflow',
                {
                    ledgerType
                }
            );
        }

        /*
         * Provider consistency.
         */
        const ledgerProviderReference =
            normalizeProviderReference(
                ledger.providerReference ||
                ledger.providerTransactionReference ||
                ledger.externalReference
            );

        if (
            context.providerReference &&
            ledgerProviderReference &&
            context.providerReference !==
                ledgerProviderReference
        ) {

            throw conflictError(
                'Settlement provider reference does not match original ledger',
                {
                    originalLedgerId:
                        context.originalLedgerId
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
                'approvalId is required for settlement reversal'
            );
        }

        if (
            !this.approvalService
        ) {

            throw dependencyError(
                'approvalService is required when settlement reversal approval is enabled'
            );
        }

        if (
            typeof this.approvalService.verify ===
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
                    'Settlement reversal approval is not valid'
                );
            }

            this.validateApprovalTenant(
                result,
                context
            );

            return true;
        }

        if (
            typeof this.approvalService.findById ===
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
                    'Settlement reversal approval was not found'
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
                    'Settlement reversal approval is not APPROVED'
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
                'Settlement reversal approval belongs to another tenant'
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

            reversalId:
                normalizeId(
                    context.reversalId
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

            providerReference:
                normalizeProviderReference(
                    overrides.providerReference ||
                    context.providerReference
                ),

            providerSettlementId:
                normalizeId(
                    context.providerSettlementId
                ),

            settlementId:
                normalizeId(
                    context.settlementId
                ),

            provider:
                normalizeId(
                    context.provider
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

            actorId:
                normalizeId(
                    context.actorId ||
                    context.userId
                ),

            reason:
                normalizeReason(
                    overrides.reason ||
                    context.reason
                ),

            startedAt:
                context.startedAt ||
                this.clock()
        };
    }

    /* ========================================================================
     * IDEMPOTENCY
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
            typeof this.idempotencyRepository.claim !==
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
            await this.idempotencyRepository.claim(
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
                            context.originalLedgerId,

                        providerReference:
                            context.providerReference,

                        settlementId:
                            context.settlementId
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

                    context.providerReference ||
                        '',

                    context.settlementId ||
                        ''
                ].join(':')
            )
            .digest('hex');
    }

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
            'Settlement reversal is already being executed by another operation',
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
            typeof this.idempotencyRepository.complete !==
            'function'
        ) {

            throw dependencyError(
                'Configured idempotencyRepository does not implement complete()'
            );
        }

        await this.idempotencyRepository.complete(
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

    async failIdempotency(
        context,
        error
    ) {

        if (
            !this.idempotencyRepository ||
            !context.idempotencyKey ||
            typeof this.idempotencyRepository.fail !==
                'function'
        ) {

            return;
        }

        try {

            await this.idempotencyRepository.fail(
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
                'Failed to record settlement reversal idempotency failure',
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
            typeof this.tracing.addEvent !==
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
                `Settlement reversal trace event failed: ${eventName}`,
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
                typeof this.auditService.record ===
                'function'
            ) {

                await this.auditService.record(
                    payload
                );

                return;
            }

            if (
                typeof this.auditService.log ===
                'function'
            ) {

                await this.auditService.log(
                    action,
                    payload
                );
            }

        } catch (error) {

            /*
             * Audit failure is intentionally isolated from successful
             * financial posting.
             */
            this.safeLog(
                'error',
                `Settlement reversal audit failed: ${action}`,
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
                typeof this.metrics?.increment ===
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
                `Settlement reversal metric failed: ${name}`,
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
            result.reversalId ||
            result.operationId
        );
    }

    /* ========================================================================
     * ERROR SANITIZATION
     * ====================================================================== */

    sanitizeErrorMessage(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return null;
        }

        return String(
            value
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

        const output = {};
        let count = 0;

        if (
            !context ||
            typeof context !==
                'object'
        ) {

            return output;
        }

        for (
            const [
                key,
                value
            ] of Object.entries(
                context
            )
        ) {

            if (
                count >=
                50
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

                output[
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

                output[
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

        return output;
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
                'SettlementReversal',

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

            reconciliationConfigured:
                Boolean(
                    this.reconciliationService
                ),

            idempotencyConfigured:
                Boolean(
                    this.idempotencyRepository
                ),

            approvalConfigured:
                Boolean(
                    this.approvalService
                ),

            auditConfigured:
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

        return new SettlementReversal(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

SettlementReversal.TYPE =
    REVERSAL_TYPE;

SettlementReversal.OPERATION =
    OPERATION;

SettlementReversal.Error =
    SettlementReversalError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    SettlementReversal;