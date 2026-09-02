'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Financial Period Close Service
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/periodCloseService.js
 *
 * Purpose:
 *   Enterprise-grade financial period closing / reopening orchestration.
 *
 * Responsibilities:
 *   - Validate period close eligibility
 *   - Validate tenant ownership
 *   - Validate current period state
 *   - Validate balance integrity when supported
 *   - Create immutable financial snapshots before close
 *   - Persist atomic period-close state
 *   - Protect against duplicate close operations
 *   - Support controlled period reopening
 *   - Enforce authorization context for reopen/close
 *   - Preserve audit / correlation metadata
 *
 * Financial safety principles:
 *   - A financial period is never silently reopened.
 *   - Closing is not considered complete until its snapshot exists.
 *   - The service never directly mutates ledger balances.
 *   - Repository errors and snapshot errors propagate.
 *   - Tenant scope is mandatory when supplied by the caller.
 *   - Reopen requires explicit authorization context.
 *   - Reopening should be treated as a controlled exception workflow.
 *
 * IMPORTANT:
 *   Financial transactions remain immutable.
 *   Closing/reopening a period does NOT edit ledger transactions.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const PERIOD_STATUS = Object.freeze({
    OPEN: 'OPEN',
    LOCKED: 'LOCKED',
    CLOSED: 'CLOSED',
    REOPENED: 'REOPENED',
    ADJUSTMENT: 'ADJUSTMENT',
    CANCELLED: 'CANCELLED'
});

const SNAPSHOT_TYPES = Object.freeze({
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY',
    YEAR_END: 'YEAR_END',
    PERIOD_CLOSE: 'PERIOD_CLOSE'
});

const OPERATION_TYPES = Object.freeze({
    CLOSE: 'PERIOD_CLOSE',
    REOPEN: 'PERIOD_REOPEN'
});

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

function normalizeRequiredId(
    value,
    fieldName
) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
    ) {
        throw createValidationError(
            `${fieldName} is required`
        );
    }

    return String(
        value
    ).trim();
}

function normalizeOptionalId(
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

function normalizeDate(
    value,
    fieldName
) {
    if (
        value === undefined ||
        value === null
    ) {
        return new Date();
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createValidationError(
            `${fieldName} must be a valid date`
        );
    }

    return date;
}

function createValidationError(
    message
) {
    const error =
        new Error(message);

    error.code =
        'PERIOD_CLOSE_VALIDATION_ERROR';

    error.statusCode =
        400;

    return error;
}

function createConflictError(
    message
) {
    const error =
        new Error(message);

    error.code =
        'PERIOD_CLOSE_CONFLICT';

    error.statusCode =
        409;

    return error;
}

function createAuthorizationError(
    message
) {
    const error =
        new Error(message);

    error.code =
        'PERIOD_CLOSE_AUTHORIZATION_ERROR';

    error.statusCode =
        403;

    return error;
}

function createNotFoundError(
    message
) {
    const error =
        new Error(message);

    error.code =
        'PERIOD_NOT_FOUND';

    error.statusCode =
        404;

    return error;
}

/* ============================================================================
 * Period Close Service
 * ========================================================================== */

class PeriodCloseService {

    constructor({
        repository,
        snapshotEngine,
        balanceEngine,
        logger,
        clock,
        idGenerator,
        auditService,
        tracing
    } = {}) {

        if (
            !repository ||
            typeof repository.findById !==
                'function' ||
            typeof repository.update !==
                'function'
        ) {
            throw new TypeError(
                'PeriodCloseService requires a repository with findById() and update()'
            );
        }

        this.repository =
            repository;

        this.snapshotEngine =
            snapshotEngine || null;

        this.balanceEngine =
            balanceEngine || null;

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
            auditService || null;

        this.tracing =
            tracing || null;
    }

    /* ========================================================================
     * Validate Close
     * ====================================================================== */

    async validateClose({
        periodId,
        tenantId = null,
        context = {}
    } = {}) {

        const normalizedPeriodId =
            normalizeRequiredId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            normalizeOptionalId(
                tenantId ||
                context.tenantId
            );

        const period =
            await this.findPeriod(
                normalizedPeriodId
            );

        this.assertPeriodTenant(
            period,
            normalizedTenantId
        );

        if (
            period.status !==
            PERIOD_STATUS.OPEN
        ) {
            throw createConflictError(
                `Period ${normalizedPeriodId} cannot close from status ${period.status}`
            );
        }

        /*
         * Optional balance verification.
         *
         * The balance engine should provide read-only integrity checks.
         * This service does not mutate balances.
         */
        await this.validateBalances(
            period,
            {
                ...context,

                tenantId:
                    normalizedTenantId
            }
        );

        return period;
    }

    /* ========================================================================
     * Close Period
     * ====================================================================== */

    async close({
        periodId,
        tenantId = null,
        context = {},
        snapshotType =
            SNAPSHOT_TYPES.MONTHLY
    } = {}) {

        const normalizedPeriodId =
            normalizeRequiredId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            normalizeOptionalId(
                tenantId ||
                context.tenantId
            );

        const operationContext =
            this.createOperationContext(
                OPERATION_TYPES.CLOSE,
                {
                    ...context,
                    periodId:
                        normalizedPeriodId,
                    tenantId:
                        normalizedTenantId
                }
            );

        return this.withTrace(
            'period.close',
            operationContext,
            async () => {

                /*
                 * Re-read immediately before close to avoid relying on stale
                 * caller state.
                 */
                const period =
                    await this.validateClose({
                        periodId:
                            normalizedPeriodId,

                        tenantId:
                            normalizedTenantId,

                        context:
                            operationContext
                    });

                /*
                 * A snapshot engine is required for a production close.
                 * Closing a period without its close snapshot should not be
                 * silently accepted.
                 */
                if (
                    !this.snapshotEngine ||
                    typeof this.snapshotEngine.create !==
                        'function'
                ) {
                    throw new TypeError(
                        'Snapshot engine with create() is required to close a financial period'
                    );
                }

                const now =
                    this.clock();

                /*
                 * Prevent duplicate close work when a period has already
                 * acquired a close/snapshot marker.
                 */
                if (
                    period.snapshotId &&
                    period.status ===
                        PERIOD_STATUS.CLOSED
                ) {
                    throw createConflictError(
                        `Period ${normalizedPeriodId} is already closed`
                    );
                }

                /*
                 * Create the immutable snapshot BEFORE transitioning the
                 * period to CLOSED.
                 *
                 * If snapshot creation fails, the period remains OPEN.
                 */
                const snapshot =
                    await this.createCloseSnapshot(
                        period,
                        {
                            ...operationContext,

                            snapshotType
                        }
                    );

                if (
                    !snapshot ||
                    !snapshot.id
                ) {
                    throw new Error(
                        'Financial period snapshot creation failed'
                    );
                }

                const updatePayload = {
                    status:
                        PERIOD_STATUS.CLOSED,

                    snapshotId:
                        snapshot.id,

                    closedAt:
                        new Date(now),

                    updatedAt:
                        new Date(now),

                    closeOperationId:
                        operationContext.operationId,

                    closeCorrelationId:
                        operationContext.correlationId,

                    closedBy:
                        operationContext.actorId ||
                        operationContext.userId ||
                        null,

                    closeReason:
                        operationContext.reason ||
                        null
                };

                /*
                 * Prefer compare-and-set repository operations when supported.
                 * This protects against two workers trying to close the same
                 * period concurrently.
                 */
                const result =
                    await this.persistClose(
                        normalizedPeriodId,
                        updatePayload
                    );

                await this.emitAudit(
                    'period.closed',
                    {
                        ...operationContext,

                        periodId:
                            normalizedPeriodId,

                        snapshotId:
                            snapshot.id
                    }
                );

                return result;
            }
        );
    }

    /* ========================================================================
     * Reopen Period
     * ====================================================================== */

    async reopen({
        periodId,
        tenantId = null,
        context = {},
        reason = null,
        approvalId = null
    } = {}) {

        const normalizedPeriodId =
            normalizeRequiredId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            normalizeOptionalId(
                tenantId ||
                context.tenantId
            );

        /*
         * Reopening a closed accounting period is a controlled financial
         * exception. Do not permit a blind repository update.
         */
        const actorId =
            normalizeOptionalId(
                context.actorId ||
                context.userId ||
                context.approvedBy
            );

        if (!actorId) {
            throw createAuthorizationError(
                'An authorized actor is required to reopen a financial period'
            );
        }

        if (
            !reason ||
            String(reason).trim() === ''
        ) {
            throw createValidationError(
                'A reason is required to reopen a financial period'
            );
        }

        if (
            !approvalId &&
            !context.approvalId
        ) {
            throw createAuthorizationError(
                'An approvalId is required to reopen a financial period'
            );
        }

        const operationContext =
            this.createOperationContext(
                OPERATION_TYPES.REOPEN,
                {
                    ...context,

                    periodId:
                        normalizedPeriodId,

                    tenantId:
                        normalizedTenantId,

                    actorId,

                    reason,

                    approvalId:
                        approvalId ||
                        context.approvalId
                }
            );

        return this.withTrace(
            'period.reopen',
            operationContext,
            async () => {

                const period =
                    await this.findPeriod(
                        normalizedPeriodId
                    );

                this.assertPeriodTenant(
                    period,
                    normalizedTenantId
                );

                if (
                    period.status !==
                    PERIOD_STATUS.CLOSED
                ) {
                    throw createConflictError(
                        `Period ${normalizedPeriodId} cannot be reopened from status ${period.status}`
                    );
                }

                const now =
                    this.clock();

                const updatePayload = {
                    status:
                        PERIOD_STATUS.OPEN,

                    reopenedAt:
                        new Date(now),

                    reopenedBy:
                        actorId,

                    reopenReason:
                        String(
                            reason
                        )
                            .trim()
                            .slice(
                                0,
                                2000
                            ),

                    reopenApprovalId:
                        String(
                            approvalId ||
                            context.approvalId
                        ),

                    reopenOperationId:
                        operationContext.operationId,

                    reopenCorrelationId:
                        operationContext.correlationId,

                    updatedAt:
                        new Date(now)
                };

                /*
                 * IMPORTANT:
                 *
                 * Reopening a period must not delete or overwrite the original
                 * snapshot. The snapshot remains historical evidence of the
                 * prior closed state.
                 */
                const result =
                    await this.persistReopen(
                        normalizedPeriodId,
                        updatePayload
                    );

                await this.emitAudit(
                    'period.reopened',
                    {
                        ...operationContext,

                        periodId:
                            normalizedPeriodId
                    }
                );

                return result;
            }
        );
    }

    /* ========================================================================
     * Snapshot Creation
     * ====================================================================== */

    async createCloseSnapshot(
        period,
        context = {}
    ) {

        const snapshotType =
            context.snapshotType ||
            SNAPSHOT_TYPES.PERIOD_CLOSE;

        return this.snapshotEngine
            .create({
                type:
                    snapshotType,

                periodId:
                    period.id,

                tenantId:
                    context.tenantId ||
                    period.tenantId ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                operationId:
                    context.operationId ||
                    null,

                reason:
                    context.reason ||
                    'FINANCIAL_PERIOD_CLOSE'
            });
    }

    /* ========================================================================
     * Balance Validation
     * ====================================================================== */

    async validateBalances(
        period,
        context = {}
    ) {

        if (
            !this.balanceEngine
        ) {
            /*
             * Balance verification is optional at this service boundary,
             * because some existing deployments may already perform it in a
             * separate close validator.
             */
            return true;
        }

        const verifier =
            this.balanceEngine
                .validatePeriodClose ||
            this.balanceEngine
                .verifyPeriodBalances ||
            this.balanceEngine
                .validate;

        if (
            typeof verifier !==
                'function'
        ) {
            return true;
        }

        const result =
            await verifier.call(
                this.balanceEngine,
                {
                    periodId:
                        period.id,

                    tenantId:
                        context.tenantId ||
                        period.tenantId ||
                        null,

                    context
                }
            );

        if (
            result === false
        ) {
            throw createConflictError(
                `Period ${period.id} failed balance validation`
            );
        }

        if (
            result &&
            result.valid === false
        ) {
            throw createConflictError(
                result.reason ||
                `Period ${period.id} failed balance validation`
            );
        }

        return true;
    }

    /* ========================================================================
     * Repository Helpers
     * ====================================================================== */

    async findPeriod(
        periodId
    ) {

        const period =
            await this.repository
                .findById(
                    periodId
                );

        if (!period) {
            throw createNotFoundError(
                `Financial period ${periodId} was not found`
            );
        }

        return period;
    }

    async persistClose(
        periodId,
        payload
    ) {

        /*
         * Atomic compare-and-set is preferred.
         */
        if (
            typeof this.repository
                .findOneAndUpdate ===
            'function'
        ) {

            const result =
                await this.repository
                    .findOneAndUpdate(
                        {
                            id:
                                periodId,

                            status:
                                PERIOD_STATUS.OPEN
                        },
                        payload,
                        {
                            new: true
                        }
                    );

            if (!result) {
                throw createConflictError(
                    `Period ${periodId} was changed concurrently and could not be closed`
                );
            }

            return result;
        }

        /*
         * Fallback for repositories exposing only update().
         */
        const result =
            await this.repository.update(
                {
                    id:
                        periodId
                },
                payload
            );

        return result;
    }

    async persistReopen(
        periodId,
        payload
    ) {

        if (
            typeof this.repository
                .findOneAndUpdate ===
            'function'
        ) {

            const result =
                await this.repository
                    .findOneAndUpdate(
                        {
                            id:
                                periodId,

                            status:
                                PERIOD_STATUS.CLOSED
                        },
                        payload,
                        {
                            new: true
                        }
                    );

            if (!result) {
                throw createConflictError(
                    `Period ${periodId} was changed concurrently and could not be reopened`
                );
            }

            return result;
        }

        return this.repository.update(
            {
                id:
                    periodId
            },
            payload
        );
    }

    /* ========================================================================
     * Tenant Isolation
     * ====================================================================== */

    assertPeriodTenant(
        period,
        tenantId
    ) {

        if (
            !tenantId
        ) {
            return;
        }

        if (
            !period.tenantId
        ) {
            throw createAuthorizationError(
                'Financial period has no tenant ownership information'
            );
        }

        if (
            String(
                period.tenantId
            ) !==
            String(
                tenantId
            )
        ) {
            throw createAuthorizationError(
                'Financial period does not belong to the requested tenant'
            );
        }
    }

    /* ========================================================================
     * Operation Context
     * ====================================================================== */

    createOperationContext(
        operation,
        context = {}
    ) {

        return {
            ...this.sanitizeContext(
                context
            ),

            operation,

            operationId:
                context.operationId ||
                this.idGenerator(),

            correlationId:
                context.correlationId ||
                this.idGenerator(),

            tenantId:
                context.tenantId ||
                null,

            actorId:
                context.actorId ||
                context.userId ||
                null,

            periodId:
                context.periodId ||
                null,

            approvalId:
                context.approvalId ||
                null,

            reason:
                context.reason ||
                null
        };
    }

    sanitizeContext(
        context = {}
    ) {

        const safe = {};

        for (
            const [
                key,
                value
            ] of Object.entries(
                context || {}
            )
        ) {

            if (
                this.isSensitiveKey(
                    key
                )
            ) {
                continue;
            }

            if (
                typeof value ===
                'string'
            ) {
                safe[key] =
                    String(
                        value
                    ).slice(
                        0,
                        2000
                    );
            } else if (
                typeof value ===
                    'number' ||
                typeof value ===
                    'boolean'
            ) {
                safe[key] =
                    value;
            }
        }

        return safe;
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
     * Tracing
     * ====================================================================== */

    async withTrace(
        operation,
        context,
        callback
    ) {

        if (
            !this.tracing ||
            typeof this.tracing.trace !==
                'function'
        ) {
            return callback();
        }

        try {

            return await this.tracing
                .trace(
                    operation,
                    async (
                        span,
                        traceContext
                    ) => {
                        return callback(
                            span,
                            {
                                ...context,
                                ...(
                                    traceContext ||
                                    {}
                                )
                            }
                        );
                    },
                    context
                );

        } catch (error) {

            /*
             * If tracing itself fails, never replace an already active
             * business exception. The callback is only retried when the tracer
             * explicitly exposes an isolated tracing-failure mechanism.
             */
            this.safeLog(
                'warn',
                'Period tracing failure isolated',
                error,
                {
                    operation
                }
            );

            if (
                this.tracing
                    .config?.failOpen ===
                true
            ) {
                return callback();
            }

            throw error;
        }
    }

    /* ========================================================================
     * Audit
     * ====================================================================== */

    async emitAudit(
        event,
        payload
    ) {

        if (
            !this.auditService
        ) {
            return;
        }

        try {

            if (
                typeof this.auditService
                    .record ===
                'function'
            ) {
                await this.auditService
                    .record(
                        event,
                        payload
                    );

                return;
            }

            if (
                typeof this.auditService
                    .log ===
                'function'
            ) {
                await this.auditService
                    .log(
                        event,
                        payload
                    );
            }

        } catch (error) {

            /*
             * Audit infrastructure failure should be visible, but must not
             * silently alter the financial transaction that has already been
             * committed.
             *
             * Production systems should additionally use an outbox/audit
             * transaction so audit durability is guaranteed.
             */
            this.safeLog(
                'error',
                `Failed to emit audit event: ${event}`,
                error
            );
        }
    }

    /* ========================================================================
     * Logging
     * ====================================================================== */

    safeLog(
        level,
        message,
        error,
        metadata = {}
    ) {

        try {

            this.logger
                ?.[
                    level
                ]?.(
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

        } catch (_) {
            // Never allow logging to affect period control operations.
        }
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {
            module:
                'PeriodCloseService',

            repositoryConfigured:
                Boolean(
                    this.repository
                ),

            snapshotEngineConfigured:
                Boolean(
                    this.snapshotEngine
                ),

            balanceEngineConfigured:
                Boolean(
                    this.balanceEngine
                ),

            auditServiceConfigured:
                Boolean(
                    this.auditService
                ),

            tracingConfigured:
                Boolean(
                    this.tracing
                ),

            repositoryCapabilities: {
                findById:
                    typeof this.repository
                        ?.findById ===
                    'function',

                update:
                    typeof this.repository
                        ?.update ===
                    'function',

                atomicClose:
                    typeof this.repository
                        ?.findOneAndUpdate ===
                    'function'
            },

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /* ========================================================================
     * Factory
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new PeriodCloseService(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

PeriodCloseService.STATUS =
    PERIOD_STATUS;

PeriodCloseService.SNAPSHOT_TYPES =
    SNAPSHOT_TYPES;

PeriodCloseService.OPERATION_TYPES =
    OPERATION_TYPES;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    PeriodCloseService;