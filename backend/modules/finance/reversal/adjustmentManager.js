'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Adjustment Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/adjustmentManager.js
 *
 * Purpose:
 *   Controlled orchestration boundary for financial adjustment postings.
 *
 * Responsibilities:
 *   - Validate adjustment requests
 *   - Require explicit adjustment reason
 *   - Require tenant context
 *   - Preserve approval / authorization metadata
 *   - Preserve correlation / operation / request identity
 *   - Establish durable idempotency ownership
 *   - Preserve idempotency claim tokens across the full operation
 *   - Validate adjustment-period controls
 *   - Delegate ALL financial posting to Ledger Engine
 *   - Prevent direct balance manipulation
 *   - Provide tracing / audit / metrics integration
 *   - Prevent accidental duplicate execution
 *   - Fail closed when required controls are unavailable
 *
 * IMPORTANT:
 *
 *   AdjustmentManager DOES NOT:
 *     - update account balances
 *     - create ledger entries directly
 *     - edit existing financial transactions
 *     - bypass LedgerEngine
 *     - reopen financial periods
 *
 *   Every adjustment must pass through the immutable Ledger Engine / posting
 *   pipeline.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const ADJUSTMENT_TYPE =
    'FINANCIAL_ADJUSTMENT';

const OPERATION_NAME =
    'finance.adjustment';

const DEFAULT_MAX_REASON_LENGTH =
    2000;

const DEFAULT_MAX_METADATA_KEYS =
    50;

const DEFAULT_MAX_JOURNAL_ENTRIES =
    10000;

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

class AdjustmentManagerError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'AdjustmentManagerError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            AdjustmentManagerError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new AdjustmentManagerError(
        'ADJUSTMENT_VALIDATION_ERROR',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new AdjustmentManagerError(
        'ADJUSTMENT_AUTHORIZATION_ERROR',
        message,
        metadata
    );
}

function dependencyError(
    message,
    metadata = {}
) {

    return new AdjustmentManagerError(
        'ADJUSTMENT_DEPENDENCY_ERROR',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new AdjustmentManagerError(
        'ADJUSTMENT_CONFLICT',
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

function sanitizeReason(
    reason,
    maxLength =
        DEFAULT_MAX_REASON_LENGTH
) {

    const normalized =
        normalizeId(
            reason
        );

    if (
        !normalized
    ) {

        return null;
    }

    return normalized.slice(
        0,
        maxLength
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

function isObject(
    value
) {

    return (
        value !== null &&
        typeof value ===
            'object' &&
        !Array.isArray(value)
    );
}

/* ============================================================================
 * Adjustment Manager
 * ========================================================================== */

class AdjustmentManager {

    constructor({

        ledgerEngine,

        adjustmentPeriod = null,

        approvalService = null,

        auditService = null,

        tracing = null,

        metrics = null,

        logger = null,

        idempotencyRepository = null,

        clock = null,

        idGenerator = null,

        requireApproval = true,

        requireAdjustmentPeriod = false

    } = {}) {

        if (
            !ledgerEngine ||
            typeof ledgerEngine.post !==
                'function'
        ) {

            throw new TypeError(
                'AdjustmentManager requires a ledgerEngine with post()'
            );
        }

        this.ledgerEngine =
            ledgerEngine;

        this.adjustmentPeriod =
            adjustmentPeriod;

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

        this.idempotencyRepository =
            idempotencyRepository;

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

        this.requireAdjustmentPeriod =
            Boolean(
                requireAdjustmentPeriod
            );
    }

    /* ========================================================================
     * EXECUTE ADJUSTMENT
     * ====================================================================== */

    async execute({
        journal,
        reason,
        context = {}
    } = {}) {

        this.validateDependency();

        const tenantId =
            requireId(
                context.tenantId,
                'tenantId'
            );

        const normalizedReason =
            sanitizeReason(
                reason
            );

        if (
            !normalizedReason
        ) {

            throw validationError(
                'Adjustment reason is required'
            );
        }

        this.validateJournal(
            journal
        );

        const operationContext =
            this.createOperationContext(
                context,
                {
                    tenantId,
                    reason:
                        normalizedReason
                }
            );

        /*
         * Authorization is deliberately evaluated before acquiring the
         * execution claim. An unauthorized request must not occupy a durable
         * operation slot.
         */
        await this.validateApproval(
            operationContext
        );

        /*
         * Adjustment-period validation is a separate financial control.
         */
        await this.validateAdjustmentPeriod(
            operationContext
        );

        /*
         * Claim durable operation ownership.
         *
         * IMPORTANT:
         * The returned claimToken is copied back into operationContext so the
         * exact owner can later complete/fail/release the operation.
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
                operationContext.claimToken ||
                null;

        } else if (
            claim?.duplicate
        ) {

            this.incrementMetric(
                'finance_adjustment_idempotency_hits_total'
            );

            return this.resolveDuplicateResult(
                claim
            );
        }

        /*
         * No idempotency repository is allowed as a silent authorization
         * bypass. The operation can still execute when idempotency is not
         * configured, but that state is observable.
         */
        if (
            !this.idempotencyRepository
        ) {

            this.incrementMetric(
                'finance_adjustment_idempotency_unavailable_total'
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

                                adjustment:
                                    true,

                                adjustmentType:
                                    ADJUSTMENT_TYPE,

                                adjustmentReason:
                                    normalizedReason
                            };

                        this.emitEvent(
                            span,
                            'finance.adjustment.started',
                            {
                                adjustmentType:
                                    ADJUSTMENT_TYPE,

                                operationId:
                                    operationContext
                                        .operationId,

                                correlationId:
                                    operationContext
                                        .correlationId
                            }
                        );

                        /*
                         * Ledger Engine remains the sole financial posting
                         * boundary.
                         */
                        const postingResult =
                            await this.ledgerEngine
                                .post(
                                    {
                                        journal,

                                        adjustment:
                                            true,

                                        adjustmentType:
                                            ADJUSTMENT_TYPE,

                                        reason:
                                            normalizedReason
                                    },

                                    mergedContext
                                );

                        this.emitEvent(
                            span,
                            'finance.adjustment.completed',
                            {
                                adjustmentType:
                                    ADJUSTMENT_TYPE,

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
             * Complete the idempotency operation BEFORE returning success.
             * A successful financial post without a durable completion marker
             * creates an ambiguity for retries.
             */
            await this.completeIdempotency(
                operationContext,
                result
            );

            await this.recordAudit(
                'FINANCIAL_ADJUSTMENT_EXECUTED',
                {
                    tenantId,

                    operationId:
                        operationContext
                            .operationId,

                    adjustmentType:
                        ADJUSTMENT_TYPE,

                    reason:
                        normalizedReason,

                    approvalId:
                        operationContext
                            .approvalId,

                    adjustmentPeriodId:
                        operationContext
                            .adjustmentPeriodId,

                    resultId:
                        this.extractResultId(
                            result
                        )
                },
                operationContext
            );

            this.incrementMetric(
                'finance_adjustments_completed_total',
                {
                    tenantId
                }
            );

            return result;

        } catch (error) {

            /*
             * Never replace the original financial error with an idempotency
             * or audit failure.
             */
            await this.failIdempotency(
                operationContext,
                error
            );

            this.incrementMetric(
                'finance_adjustments_failed_total',
                {
                    tenantId,
                    errorCode:
                        error?.code ||
                        'UNKNOWN'
                }
            );

            await this.recordAudit(
                'FINANCIAL_ADJUSTMENT_FAILED',
                {
                    tenantId,

                    operationId:
                        operationContext
                            .operationId,

                    adjustmentType:
                        ADJUSTMENT_TYPE,

                    approvalId:
                        operationContext
                            .approvalId,

                    adjustmentPeriodId:
                        operationContext
                            .adjustmentPeriodId,

                    errorCode:
                        error?.code ||
                        null
                },
                operationContext
            );

            throw error;
        }
    }

    /* ========================================================================
     * JOURNAL VALIDATION
     * ====================================================================== */

    validateJournal(
        journal
    ) {

        if (
            !isObject(
                journal
            )
        ) {

            throw validationError(
                'journal is required and must be an object'
            );
        }

        if (
            !Array.isArray(
                journal.entries
            )
        ) {

            /*
             * Some LedgerEngine implementations accept a domain-specific
             * journal object whose internal entries are named differently.
             * Do not reject such an object if it clearly has a posting payload.
             */
            if (
                !Array.isArray(
                    journal.lines
                ) &&
                !Array.isArray(
                    journal.items
                )
            ) {

                throw validationError(
                    'journal.entries, journal.lines, or journal.items is required'
                );
            }
        }

        const entries =
            journal.entries ||
            journal.lines ||
            journal.items ||
            [];

        if (
            entries.length ===
            0
        ) {

            throw validationError(
                'Adjustment journal must contain at least one entry'
            );
        }

        if (
            entries.length >
            DEFAULT_MAX_JOURNAL_ENTRIES
        ) {

            throw validationError(
                `Adjustment journal exceeds maximum supported entry count of ${DEFAULT_MAX_JOURNAL_ENTRIES}`
            );
        }

        return true;
    }

    /* ========================================================================
     * APPROVAL VALIDATION
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
                'approvalId is required for a financial adjustment'
            );
        }

        if (
            !this.approvalService
        ) {

            throw dependencyError(
                'approvalService is required when financial adjustment approval is enabled'
            );
        }

        /*
         * Dedicated verification API.
         */
        if (
            typeof this.approvalService
                .verify ===
            'function'
        ) {

            const verified =
                await this.approvalService
                    .verify({
                        approvalId,

                        type:
                            ADJUSTMENT_TYPE,

                        tenantId:
                            context.tenantId,

                        operationId:
                            context.operationId
                    });

            const approved =
                verified === true ||
                verified?.approved === true ||
                normalizeStatus(
                    verified?.status
                ) ===
                    'APPROVED';

            if (
                !approved
            ) {

                throw authorizationError(
                    'Financial adjustment approval is not valid',
                    {
                        approvalId,

                        status:
                            verified?.status ||
                            null
                    }
                );
            }

            this.validateApprovalTenant(
                verified,
                context
            );

            this.validateApprovalActorSeparation(
                verified,
                context
            );

            return true;
        }

        /*
         * Compatibility with approval services exposing findById().
         */
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
                    'Financial adjustment approval was not found',
                    {
                        approvalId
                    }
                );
            }

            this.validateApprovalTenant(
                approval,
                context
            );

            if (
                normalizeStatus(
                    approval.type
                ) &&
                normalizeStatus(
                    approval.type
                ) !==
                    normalizeStatus(
                        ADJUSTMENT_TYPE
                    )
            ) {

                throw authorizationError(
                    'Approval type does not authorize a financial adjustment',
                    {
                        approvalId,

                        approvalType:
                            approval.type
                    }
                );
            }

            if (
                normalizeStatus(
                    approval.status
                ) !==
                'APPROVED'
            ) {

                throw authorizationError(
                    'Financial adjustment approval is not APPROVED',
                    {
                        approvalId,

                        status:
                            approval.status
                    }
                );
            }

            this.validateApprovalActorSeparation(
                approval,
                context
            );

            return true;
        }

        throw dependencyError(
            'approvalService must implement verify() or findById() for adjustment approval validation'
        );
    }

    /* ========================================================================
     * APPROVAL TENANT VALIDATION
     * ====================================================================== */

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
                'Financial adjustment approval belongs to another tenant'
            );
        }

        return true;
    }

    /* ========================================================================
     * APPROVAL ACTOR SEPARATION
     * ====================================================================== */

    validateApprovalActorSeparation(
        approval,
        context
    ) {

        const requesterId =
            normalizeId(
                context.actorId
            );

        const approverId =
            normalizeId(
                approval?.approvedBy ||
                approval?.approverId ||
                approval?.actorId
            );

        if (
            requesterId &&
            approverId &&
            requesterId ===
                approverId
        ) {

            throw authorizationError(
                'The adjustment requester cannot approve the same adjustment'
            );
        }

        return true;
    }

    /* ========================================================================
     * ADJUSTMENT PERIOD VALIDATION
     * ====================================================================== */

    async validateAdjustmentPeriod(
        context
    ) {

        const periodId =
            normalizeId(
                context.adjustmentPeriodId
            );

        /*
         * A period ID becomes mandatory when strict adjustment-period control
         * is enabled.
         */
        if (
            this.requireAdjustmentPeriod &&
            !periodId
        ) {

            throw validationError(
                'adjustmentPeriodId is required for financial adjustments'
            );
        }

        if (
            !periodId
        ) {

            return true;
        }

        if (
            !this.adjustmentPeriod
        ) {

            throw dependencyError(
                'adjustmentPeriod service is required when adjustmentPeriodId is supplied'
            );
        }

        /*
         * Preferred API.
         */
        if (
            typeof this.adjustmentPeriod
                .findById ===
            'function'
        ) {

            const period =
                await this.adjustmentPeriod
                    .findById(
                        periodId,
                        {
                            tenantId:
                                context.tenantId
                        }
                    );

            if (
                !period
            ) {

                throw validationError(
                    'Adjustment period was not found',
                    {
                        adjustmentPeriodId:
                            periodId
                    }
                );
            }

            this.validateAdjustmentPeriodTenant(
                period,
                context
            );

            if (
                typeof this.adjustmentPeriod
                    .canPostAdjustment ===
                'function'
            ) {

                const allowed =
                    await this.adjustmentPeriod
                        .canPostAdjustment(
                            period,
                            context
                        );

                if (
                    allowed !== true
                ) {

                    throw conflictError(
                        'Adjustment period is not approved for posting',
                        {
                            adjustmentPeriodId:
                                periodId,

                            status:
                                period.status
                        }
                    );
                }

                return true;
            }

            const approved =
                normalizeStatus(
                    period.status
                ) ===
                'APPROVED';

            if (
                !approved
            ) {

                throw conflictError(
                    'Adjustment period is not APPROVED',
                    {
                        adjustmentPeriodId:
                            periodId,

                        status:
                            period.status
                    }
                );
            }

            return true;
        }

        /*
         * Compatibility with findOne().
         */
        if (
            typeof this.adjustmentPeriod
                .findOne ===
            'function'
        ) {

            const period =
                await this.adjustmentPeriod
                    .findOne({
                        id:
                            periodId,

                        tenantId:
                            context.tenantId
                    });

            if (
                !period
            ) {

                throw validationError(
                    'Adjustment period was not found'
                );
            }

            this.validateAdjustmentPeriodTenant(
                period,
                context
            );

            if (
                normalizeStatus(
                    period.status
                ) !==
                'APPROVED'
            ) {

                throw conflictError(
                    'Adjustment period is not APPROVED',
                    {
                        adjustmentPeriodId:
                            periodId,

                        status:
                            period.status
                    }
                );
            }

            return true;
        }

        throw dependencyError(
            'Adjustment period service must implement findById() or findOne()'
        );
    }

    /* ========================================================================
     * ADJUSTMENT PERIOD TENANT
     * ====================================================================== */

    validateAdjustmentPeriodTenant(
        period,
        context
    ) {

        if (
            period?.tenantId &&
            String(
                period.tenantId
            ) !==
            String(
                context.tenantId
            )
        ) {

            throw authorizationError(
                'Adjustment period belongs to another tenant'
            );
        }

        return true;
    }

    /* ========================================================================
     * OPERATION CONTEXT
     * ====================================================================== */

    createOperationContext(
        context,
        overrides = {}
    ) {

        const operationId =
            normalizeId(
                context.operationId
            ) ||
            this.idGenerator();

        const correlationId =
            normalizeId(
                context.correlationId
            ) ||
            this.idGenerator();

        return {

            ...this.sanitizeContext(
                context
            ),

            ...overrides,

            operation:
                OPERATION_NAME,

            operationId,

            correlationId,

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

            actorId:
                normalizeId(
                    context.actorId ||
                    context.userId
                ),

            approvalId:
                normalizeId(
                    context.approvalId
                ),

            adjustmentPeriodId:
                normalizeId(
                    context.adjustmentPeriodId
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
                sanitizeReason(
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

        const key =
            normalizeId(
                context.idempotencyKey
            ) ||
            context.operationId;

        /*
         * Make the derived key visible in the execution context so complete()
         * and fail() reference exactly the same operation.
         */
        context.idempotencyKey =
            key;

        if (
            typeof this.idempotencyRepository
                .claim !==
            'function'
        ) {

            throw dependencyError(
                'Configured idempotencyRepository does not implement claim()'
            );
        }

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

                        approvalId:
                            context.approvalId,

                        metadata: {
                            adjustmentType:
                                ADJUSTMENT_TYPE,

                            adjustmentPeriodId:
                                context.adjustmentPeriodId,

                            actorId:
                                context.actorId
                        }
                    }
                );

        /*
         * CRITICAL:
         * propagate the durable worker ownership token.
         */
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
     * RESOLVE DUPLICATE
     * ====================================================================== */

    resolveDuplicateResult(
        claim
    ) {

        const record =
            claim?.record;

        if (
            !record
        ) {

            throw conflictError(
                'Adjustment operation is already claimed by another execution'
            );
        }

        if (
            record.result
        ) {

            return record.result;
        }

        if (
            record.status &&
            normalizeStatus(
                record.status
            ) ===
            'COMPLETED'
        ) {

            /*
             * Some operation repositories store resultId rather than the
             * complete result. Returning the durable operation record is safer
             * than re-executing the financial posting.
             */
            return record;
        }

        /*
         * Active claim / processing operation.
         */
        throw conflictError(
            'Adjustment operation is already owned by another execution',
            {
                operationKey:
                    record.operationKey ||
                    null,

                status:
                    record.status ||
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

        /*
         * Completion ownership is claim-token based.
         */
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

            this.safeLog(
                'warn',
                'Configured idempotencyRepository does not implement fail()',
                null
            );

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
                            ) ||
                            'Adjustment execution failed',

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
             * The original financial failure remains authoritative.
             */
            this.safeLog(
                'error',
                'Failed to record adjustment idempotency failure',
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

        try {

            return await this.tracing
                .trace(
                    OPERATION_NAME,
                    callback,
                    context
                );

        } catch (error) {

            /*
             * Never rerun an adjustment because of an ambiguous tracing
             * failure.
             */
            this.safeLog(
                'warn',
                'Adjustment tracing operation failed',
                error
            );

            throw error;
        }
    }

    /* ========================================================================
     * TRACE EVENT
     * ====================================================================== */

    emitEvent(
        span,
        eventName,
        metadata = {}
    ) {

        if (
            !span ||
            !this.tracing
        ) {

            return;
        }

        try {

            if (
                typeof this.tracing
                    .addEvent ===
                'function'
            ) {

                this.tracing.addEvent(
                    span,
                    eventName,
                    this.sanitizeContext(
                        metadata
                    )
                );
            }

        } catch (error) {

            this.safeLog(
                'warn',
                `Adjustment tracing event failed: ${eventName}`,
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

            /*
             * Audit failure must not cause a second ledger execution or replace
             * the original financial operation result.
             */
            this.safeLog(
                'error',
                `Failed to record adjustment audit: ${action}`,
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
                `Adjustment metric failed: ${name}`,
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
            result === null ||
            result === undefined
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

        if (
            !context ||
            typeof context !==
                'object'
        ) {

            return {};
        }

        const result = {};
        let count = 0;

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

            result[
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

        return result;
    }

    /* ========================================================================
     * VALUE SANITIZATION
     * ====================================================================== */

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
            isObject(
                value
            )
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

    validateDependency() {

        if (
            !this.ledgerEngine ||
            typeof this.ledgerEngine
                .post !==
                'function'
        ) {

            throw dependencyError(
                'LedgerEngine.post() is unavailable'
            );
        }
    }

    /* ========================================================================
     * LOGGING
     * ====================================================================== */

    safeLog(
        level,
        message,
        error,
        metadata = {}
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
                        ...metadata,

                        error:
                            error instanceof
                            Error
                                ? error.message
                                : error
                    }
                );
            }

        } catch (_) {
            /*
             * Observability must never break financial processing.
             */
        }
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'AdjustmentManager',

            operation:
                OPERATION_NAME,

            adjustmentType:
                ADJUSTMENT_TYPE,

            ledgerEngineConfigured:
                Boolean(
                    this.ledgerEngine
                ),

            approvalServiceConfigured:
                Boolean(
                    this.approvalService
                ),

            adjustmentPeriodConfigured:
                Boolean(
                    this.adjustmentPeriod
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

            idempotencyConfigured:
                Boolean(
                    this.idempotencyRepository
                ),

            approvalRequired:
                this.requireApproval,

            adjustmentPeriodRequired:
                this.requireAdjustmentPeriod,

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

        return new AdjustmentManager(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

AdjustmentManager.TYPE =
    ADJUSTMENT_TYPE;

AdjustmentManager.OPERATION =
    OPERATION_NAME;

AdjustmentManager.Error =
    AdjustmentManagerError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    AdjustmentManager;