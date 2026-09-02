'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Financial Period Reopen Workflow
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/reopenWorkflow.js
 *
 * Purpose:
 *   Controlled approval workflow for reopening a CLOSED financial period.
 *
 * IMPORTANT:
 *
 *   This workflow does NOT itself reopen the period.
 *
 *   It requests/validates approval. The PeriodEngine remains responsible for
 *   coordinating the approved state transition through PeriodCloseService.
 *
 * Lifecycle:
 *
 *   CLOSED
 *      |
 *      v
 *   ReopenWorkflow.request()
 *      |
 *      v
 *   ApprovalService
 *      |
 *      +---- APPROVED
 *      |
 *      +---- REJECTED
 *      |
 *      +---- PENDING
 *      |
 *      v
 *   PeriodEngine
 *      |
 *      v
 *   PeriodCloseService.reopen()
 *
 * Design principles:
 *   - Reopening is an exceptional operation.
 *   - Approval is mandatory.
 *   - Tenant ownership is preserved.
 *   - Approval context is explicit.
 *   - Sensitive request data is not copied into telemetry/audit payloads.
 *   - Existing ApprovalService APIs remain usable.
 *   - Approval failures are never converted into approval success.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const WORKFLOW_TYPE =
    'PERIOD_REOPEN';

const APPROVAL_STATUS = Object.freeze({
    APPROVED:
        'APPROVED',

    REJECTED:
        'REJECTED',

    PENDING:
        'PENDING',

    EXPIRED:
        'EXPIRED',

    CANCELLED:
        'CANCELLED'
});

/* ============================================================================
 * Errors
 * ========================================================================== */

class ReopenWorkflowError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'ReopenWorkflowError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            ReopenWorkflowError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new ReopenWorkflowError(
        'REOPEN_WORKFLOW_VALIDATION_ERROR',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new ReopenWorkflowError(
        'REOPEN_WORKFLOW_AUTHORIZATION_ERROR',
        message,
        metadata
    );
}

function approvalError(
    message,
    metadata = {}
) {

    return new ReopenWorkflowError(
        'REOPEN_WORKFLOW_APPROVAL_ERROR',
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

function requireId(
    value,
    fieldName
) {

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
    ) {

        throw validationError(
            `${fieldName} is required`,
            {
                fieldName
            }
        );
    }

    return String(
        value
    ).trim();
}

function optionalId(
    value
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    return String(
        value
    ).trim();
}

function normalizeStatus(
    status
) {

    if (
        status === undefined ||
        status === null
    ) {
        return null;
    }

    return String(
        status
    )
        .trim()
        .toUpperCase();
}

function sanitizeReason(
    reason
) {

    if (
        reason === undefined ||
        reason === null
    ) {

        return null;
    }

    return String(
        reason
    )
        .trim()
        .slice(
            0,
            2000
        );
}

/* ============================================================================
 * Reopen Workflow
 * ========================================================================== */

class ReopenWorkflow {

    constructor({

        approvalService,

        logger,

        clock,

        idGenerator,

        auditService,

        tracing,

        metrics,

        requireReason = true,

        preventSelfApproval = true

    } = {}) {

        if (
            !approvalService ||
            typeof approvalService.approve !==
                'function'
        ) {

            throw new TypeError(
                'ReopenWorkflow requires approvalService.approve()'
            );
        }

        this.approvalService =
            approvalService;

        this.logger =
            logger ||
            console;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;

        this.auditService =
            auditService ||
            null;

        this.tracing =
            tracing ||
            null;

        this.metrics =
            metrics ||
            null;

        this.requireReason =
            Boolean(
                requireReason
            );

        this.preventSelfApproval =
            Boolean(
                preventSelfApproval
            );
    }

    /* ========================================================================
     * REQUEST REOPEN APPROVAL
     * ====================================================================== */

    async request({

        periodId,

        approvalRequest = {},

        context = {}

    } = {}) {

        const normalizedPeriodId =
            requireId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            optionalId(
                context.tenantId ||
                approvalRequest.tenantId
            );

        const requesterId =
            optionalId(
                context.actorId ||
                context.userId ||
                approvalRequest.requestedBy
            );

        const reason =
            sanitizeReason(
                approvalRequest.reason ||
                approvalRequest.reopenReason ||
                context.reason
            );

        if (
            this.requireReason &&
            !reason
        ) {

            throw validationError(
                'A reason is required to request financial period reopening'
            );
        }

        if (
            !requesterId
        ) {

            throw authorizationError(
                'An authenticated requester is required to request financial period reopening'
            );
        }

        const operationContext =
            this.createContext(
                {
                    ...context,

                    tenantId:
                        normalizedTenantId,

                    periodId:
                        normalizedPeriodId,

                    actorId:
                        requesterId,

                    reason
                }
            );

        return this.withTrace(
            operationContext,
            async (
                span,
                traceContext
            ) => {

                const normalizedRequest =
                    this.normalizeApprovalRequest(
                        approvalRequest,
                        {
                            ...operationContext,

                            ...traceContext,

                            periodId:
                                normalizedPeriodId,

                            tenantId:
                                normalizedTenantId,

                            requestedBy:
                                requesterId,

                            reason
                        }
                    );

                await this.recordAudit(
                    'PERIOD_REOPEN_APPROVAL_REQUESTED',
                    {
                        periodId:
                            normalizedPeriodId,

                        tenantId:
                            normalizedTenantId,

                        requestedBy:
                            requesterId,

                        approvalRequest:
                            this.sanitizeForAudit(
                                normalizedRequest
                            )
                    },
                    operationContext
                );

                const approvalResult =
                    await this.approvalService
                        .approve({
                            type:
                                WORKFLOW_TYPE,

                            periodId:
                                normalizedPeriodId,

                            approvalRequest:
                                normalizedRequest,

                            context:
                                operationContext
                        });

                const normalizedResult =
                    this.normalizeApprovalResult(
                        approvalResult
                    );

                this.recordMetricForResult(
                    normalizedResult
                );

                if (
                    normalizedResult.status ===
                    APPROVAL_STATUS.APPROVED
                ) {

                    await this.recordAudit(
                        'PERIOD_REOPEN_APPROVED',
                        {
                            periodId:
                                normalizedPeriodId,

                            tenantId:
                                normalizedTenantId,

                            approvalId:
                                normalizedResult
                                    .approvalId,

                            approvedBy:
                                normalizedResult
                                    .approvedBy
                        },
                        operationContext
                    );
                }

                return normalizedResult;
            }
        );
    }

    /* ========================================================================
     * VALIDATE APPROVAL RESULT
     * ====================================================================== */

    isApproved(
        result
    ) {

        return (
            this.normalizeApprovalResult(
                result
            ).status ===
            APPROVAL_STATUS.APPROVED
        );
    }

    isRejected(
        result
    ) {

        return (
            this.normalizeApprovalResult(
                result
            ).status ===
            APPROVAL_STATUS.REJECTED
        );
    }

    isPending(
        result
    ) {

        return (
            this.normalizeApprovalResult(
                result
            ).status ===
            APPROVAL_STATUS.PENDING
        );
    }

    /* ========================================================================
     * NORMALIZE APPROVAL RESULT
     * ====================================================================== */

    normalizeApprovalResult(
        result
    ) {

        /*
         * Preserve compatibility with ApprovalService implementations that
         * return a boolean.
         */
        if (
            result === true
        ) {

            return {
                approved:
                    true,

                status:
                    APPROVAL_STATUS.APPROVED,

                approvalId:
                    null,

                approvedBy:
                    null,

                rejectedBy:
                    null,

                reason:
                    null,

                raw:
                    result
            };
        }

        if (
            result === false ||
            result === null ||
            result === undefined
        ) {

            return {
                approved:
                    false,

                status:
                    APPROVAL_STATUS.REJECTED,

                approvalId:
                    null,

                approvedBy:
                    null,

                rejectedBy:
                    null,

                reason:
                    null,

                raw:
                    result
            };
        }

        const status =
            normalizeStatus(
                result.status
            );

        const approved =
            result.approved === true ||
            status ===
                APPROVAL_STATUS.APPROVED ||
            status === 'APPROVE';

        if (
            approved
        ) {

            return {
                ...result,

                approved:
                    true,

                status:
                    APPROVAL_STATUS.APPROVED,

                approvalId:
                    result.approvalId ||
                    result.id ||
                    null,

                approvedBy:
                    result.approvedBy ||
                    result.approverId ||
                    result.actorId ||
                    null,

                rejectedBy:
                    null,

                reason:
                    sanitizeReason(
                        result.reason
                    ),

                raw:
                    result
            };
        }

        if (
            status ===
                APPROVAL_STATUS.PENDING ||
            status ===
                'REQUESTED'
        ) {

            return {
                ...result,

                approved:
                    false,

                status:
                    APPROVAL_STATUS.PENDING,

                approvalId:
                    result.approvalId ||
                    result.id ||
                    null,

                approvedBy:
                    null,

                rejectedBy:
                    null,

                reason:
                    sanitizeReason(
                        result.reason
                    ),

                raw:
                    result
            };
        }

        if (
            status ===
                APPROVAL_STATUS.EXPIRED ||
            status ===
                APPROVAL_STATUS.CANCELLED
        ) {

            return {
                ...result,

                approved:
                    false,

                status,

                approvalId:
                    result.approvalId ||
                    result.id ||
                    null,

                approvedBy:
                    null,

                rejectedBy:
                    result.rejectedBy ||
                    result.actorId ||
                    null,

                reason:
                    sanitizeReason(
                        result.reason
                    ),

                raw:
                    result
            };
        }

        return {
            ...result,

            approved:
                false,

            status:
                APPROVAL_STATUS.REJECTED,

            approvalId:
                result.approvalId ||
                result.id ||
                null,

            approvedBy:
                null,

            rejectedBy:
                result.rejectedBy ||
                result.actorId ||
                null,

            reason:
                sanitizeReason(
                    result.reason
                ),

            raw:
                result
        };
    }

    /* ========================================================================
     * NORMALIZE REQUEST
     * ====================================================================== */

    normalizeApprovalRequest(
        approvalRequest = {},
        context = {}
    ) {

        const request = {
            ...approvalRequest
        };

        /*
         * Never pass sensitive payloads through the workflow automatically.
         */
        delete request.password;
        delete request.token;
        delete request.accessToken;
        delete request.refreshToken;
        delete request.authorization;
        delete request.secret;
        delete request.apiKey;
        delete request.apiSecret;
        delete request.privateKey;

        return {
            ...request,

            type:
                WORKFLOW_TYPE,

            periodId:
                requireId(
                    context.periodId,
                    'periodId'
                ),

            tenantId:
                optionalId(
                    context.tenantId
                ),

            requestedBy:
                optionalId(
                    context.actorId ||
                    context.userId ||
                    request.requestedBy
                ),

            reason:
                sanitizeReason(
                    context.reason ||
                    request.reason ||
                    request.reopenReason
                ),

            operationId:
                context.operationId ||
                this.idGenerator(),

            correlationId:
                context.correlationId ||
                this.idGenerator(),

            requestedAt:
                this.clock()
                    .toISOString()
        };
    }

    /* ========================================================================
     * OPTIONAL SELF-APPROVAL GUARD
     * ====================================================================== */

    validateApprovalActors(
        requesterId,
        approverId
    ) {

        if (
            !this.preventSelfApproval
        ) {
            return true;
        }

        if (
            requesterId &&
            approverId &&
            String(
                requesterId
            ) ===
            String(
                approverId
            )
        ) {

            throw authorizationError(
                'The requester cannot approve the same period reopen request'
            );
        }

        return true;
    }

    /* ========================================================================
     * CONTEXT
     * ====================================================================== */

    createContext(
        context = {}
    ) {

        return {
            operation:
                WORKFLOW_TYPE,

            operationId:
                context.operationId ||
                this.idGenerator(),

            correlationId:
                context.correlationId ||
                this.idGenerator(),

            requestId:
                optionalId(
                    context.requestId
                ),

            tenantId:
                optionalId(
                    context.tenantId
                ),

            periodId:
                optionalId(
                    context.periodId
                ),

            actorId:
                optionalId(
                    context.actorId ||
                    context.userId
                ),

            reason:
                sanitizeReason(
                    context.reason
                )
        };
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
                    'finance.period.reopen.approval',
                    async (
                        span,
                        traceContext
                    ) => {

                        return callback(
                            span,

                            {
                                ...context,

                                ...(traceContext ||
                                    {})
                            }
                        );
                    },

                    context
                );

        } catch (error) {

            /*
             * Never execute the approval request twice after an ambiguous
             * tracing failure.
             */
            this.safeLog(
                'warn',
                'Reopen workflow tracing failed',
                error
            );

            throw error;
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
                this.sanitizeForAudit(
                    entity
                ),

            context:
                this.sanitizeForAudit(
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
             * Approval persistence should ideally be transactional in the
             * application's approval/audit store.
             */
            this.safeLog(
                'error',
                `Failed to record reopen workflow audit: ${action}`,
                error
            );
        }
    }

    /* ========================================================================
     * AUDIT SANITIZATION
     * ====================================================================== */

    sanitizeForAudit(
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
                2000
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
                        this.sanitizeForAudit(
                            item
                        )
                );
        }

        if (
            typeof value ===
            'object'
        ) {

            const output = {};
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
                    count >= 50
                ) {
                    break;
                }

                if (
                    this.isSensitiveKey(
                        key
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
                    this.sanitizeForAudit(
                        nestedValue
                    );

                count++;
            }

            return output;
        }

        return String(
            value
        ).slice(
            0,
            2000
        );
    }

    isSensitiveKey(
        key
    ) {

        return [
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
            /identity.?number/i
        ].some(
            pattern =>
                pattern.test(
                    String(
                        key || ''
                    )
                )
        );
    }

    /* ========================================================================
     * METRICS
     * ====================================================================== */

    recordMetricForResult(
        result
    ) {

        const status =
            result?.status ||
            APPROVAL_STATUS.REJECTED;

        try {

            if (
                status ===
                APPROVAL_STATUS.APPROVED
            ) {

                this.metrics
                    ?.increment?.(
                        'finance_period_reopen_approvals_total',
                        {
                            status:
                                'approved'
                        }
                    );

            } else if (
                status ===
                APPROVAL_STATUS.PENDING
            ) {

                this.metrics
                    ?.increment?.(
                        'finance_period_reopen_approvals_total',
                        {
                            status:
                                'pending'
                        }
                    );

            } else {

                this.metrics
                    ?.increment?.(
                        'finance_period_reopen_approvals_total',
                        {
                            status:
                                'rejected'
                        }
                    );
            }

        } catch (error) {

            this.safeLog(
                'warn',
                'Failed to record reopen workflow metric',
                error
            );
        }
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'ReopenWorkflow',

            workflowType:
                WORKFLOW_TYPE,

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

            requireReason:
                this.requireReason,

            preventSelfApproval:
                this.preventSelfApproval,

            timestamp:
                this.clock()
                    .toISOString()
        };
    }

    /* ========================================================================
     * Factory
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new ReopenWorkflow(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

ReopenWorkflow.TYPE =
    WORKFLOW_TYPE;

ReopenWorkflow.STATUS =
    APPROVAL_STATUS;

ReopenWorkflow.Error =
    ReopenWorkflowError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    ReopenWorkflow;