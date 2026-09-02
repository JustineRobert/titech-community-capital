'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Financial Period Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/periodEngine.js
 *
 * Purpose:
 *   Enterprise financial-period lifecycle orchestrator for the Finance Core.
 *
 * Responsibilities:
 *   - Create financial periods
 *   - Resolve current/open periods
 *   - Validate ledger posting dates
 *   - Enforce tenant isolation
 *   - Coordinate OPEN -> LOCKED -> CLOSED lifecycle
 *   - Coordinate controlled reopen workflow
 *   - Enforce approval requirements
 *   - Preserve correlation / request / operation identity
 *   - Emit audit events
 *   - Publish domain events
 *   - Support idempotent lifecycle operations
 *   - Support observability / tracing
 *   - Protect against concurrent close/reopen requests
 *
 * IMPORTANT:
 *
 *   PeriodEngine does NOT:
 *     - mutate ledger balances
 *     - edit immutable transactions
 *     - directly post journals
 *     - directly create ledger adjustments
 *
 *   All financial corrections remain the responsibility of the immutable
 *   Ledger / Journal Posting Engine.
 *
 * Lifecycle:
 *
 *   OPEN
 *     |
 *     v
 *   LOCKED
 *     |
 *     v
 *   CLOSED
 *     |
 *     v
 *   controlled reopen
 *     |
 *     v
 *   OPEN
 *
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

class PeriodEngineError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'PeriodEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        /*
         * Preserve cause when Node/runtime supports Error cause.
         */
        if (
            metadata &&
            metadata.cause
        ) {
            this.cause =
                metadata.cause;
        }

        Error.captureStackTrace?.(
            this,
            PeriodEngineError
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PERIOD_STATUS = Object.freeze({

    OPEN:
        'OPEN',

    LOCKED:
        'LOCKED',

    CLOSED:
        'CLOSED',

    REOPENED:
        'REOPENED',

    ADJUSTMENT:
        'ADJUSTMENT',

    CANCELLED:
        'CANCELLED'
});

const EVENTS = Object.freeze({

    PERIOD_CREATED:
        'PeriodCreated',

    PERIOD_LOCKED:
        'PeriodLocked',

    PERIOD_CLOSED:
        'PeriodClosed',

    PERIOD_REOPEN_REQUESTED:
        'PeriodReopenRequested',

    PERIOD_REOPENED:
        'PeriodReopened'
});

const ACTIONS = Object.freeze({

    PERIOD_CREATED:
        'PERIOD_CREATED',

    PERIOD_LOCKED:
        'PERIOD_LOCKED',

    PERIOD_CLOSED:
        'PERIOD_CLOSED',

    PERIOD_REOPEN_REQUESTED:
        'PERIOD_REOPEN_REQUESTED',

    PERIOD_REOPENED:
        'PERIOD_REOPENED'
});

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

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

function requireValue(
    value,
    fieldName
) {

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
    ) {

        throw new PeriodEngineError(
            'INVALID_INPUT',
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

function optionalValue(
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

        throw new PeriodEngineError(
            'INVALID_INPUT',
            `${fieldName} is required`,
            {
                fieldName
            }
        );
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(
                value
            );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new PeriodEngineError(
            'INVALID_INPUT',
            `${fieldName} must be a valid date`,
            {
                fieldName
            }
        );
    }

    return date;
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

function createNotFoundError(
    periodId
) {

    return new PeriodEngineError(
        'PERIOD_NOT_FOUND',
        `Financial period ${periodId} was not found`,
        {
            periodId
        }
    );
}

function createTenantError(
    periodId,
    tenantId
) {

    return new PeriodEngineError(
        'TENANT_MISMATCH',
        `Financial period ${periodId} does not belong to tenant ${tenantId}`,
        {
            periodId,
            tenantId
        }
    );
}

/* -------------------------------------------------------------------------- */
/* Period Engine                                                              */
/* -------------------------------------------------------------------------- */

class PeriodEngine {

    constructor({
        fiscalCalendar,
        periodLockService,
        periodCloseService,
        adjustmentPeriod,
        reopenWorkflow,
        periodValidator,
        auditService,
        eventBus,
        logger,
        metrics,
        tracing,
        repository,
        clock,
        idGenerator
    } = {}) {

        this.fiscalCalendar =
            fiscalCalendar;

        this.periodLockService =
            periodLockService;

        this.periodCloseService =
            periodCloseService;

        this.adjustmentPeriod =
            adjustmentPeriod;

        this.reopenWorkflow =
            reopenWorkflow;

        this.periodValidator =
            periodValidator;

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

        this.repository =
            repository ||
            null;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;
    }

    /* ========================================================================
     * CREATE PERIOD
     * ====================================================================== */

    async createPeriod({
        tenantId,
        startDate,
        endDate,
        fiscalYear,
        context = {}
    } = {}) {

        const normalizedTenantId =
            requireValue(
                tenantId,
                'tenantId'
            );

        const normalizedStartDate =
            normalizeDate(
                startDate,
                'startDate'
            );

        const normalizedEndDate =
            normalizeDate(
                endDate,
                'endDate'
            );

        if (
            normalizedEndDate <
            normalizedStartDate
        ) {

            throw new PeriodEngineError(
                'INVALID_PERIOD',
                'endDate cannot be before startDate',
                {
                    startDate:
                        normalizedStartDate,
                    endDate:
                        normalizedEndDate
                }
            );
        }

        const normalizedFiscalYear =
            this.normalizeFiscalYear(
                fiscalYear,
                normalizedStartDate
            );

        await this.validatePeriodDates({
            startDate:
                normalizedStartDate,

            endDate:
                normalizedEndDate
        });

        await this.ensureNoOverlappingPeriod({
            tenantId:
                normalizedTenantId,

            startDate:
                normalizedStartDate,

            endDate:
                normalizedEndDate
        });

        const now =
            this.clock();

        const period = {

            id:
                this.idGenerator(),

            tenantId:
                normalizedTenantId,

            startDate:
                normalizedStartDate,

            endDate:
                normalizedEndDate,

            fiscalYear:
                normalizedFiscalYear,

            status:
                PERIOD_STATUS.OPEN,

            createdAt:
                new Date(now),

            updatedAt:
                new Date(now),

            operationId:
                context.operationId ||
                this.idGenerator(),

            correlationId:
                context.correlationId ||
                this.idGenerator(),

            requestId:
                optionalValue(
                    context.requestId
                ),

            createdBy:
                optionalValue(
                    context.actorId ||
                    context.userId
                )
        };

        /*
         * Prefer an existing calendar/repository persistence boundary.
         */
        const persisted =
            await this.persistPeriod(
                period
            );

        await this.recordAudit(
            ACTIONS.PERIOD_CREATED,
            persisted,
            {
                ...context,

                tenantId:
                    normalizedTenantId,

                correlationId:
                    period.correlationId,

                operationId:
                    period.operationId
            }
        );

        await this.publishEvent(
            EVENTS.PERIOD_CREATED,
            persisted,
            context
        );

        this.incrementMetric(
            'finance_periods_created_total',
            {
                tenantId:
                    normalizedTenantId
            }
        );

        return persisted;
    }

    /* ========================================================================
     * GET CURRENT PERIOD
     * ====================================================================== */

    async getCurrentPeriod({
        tenantId
    } = {}) {

        const normalizedTenantId =
            requireValue(
                tenantId,
                'tenantId'
            );

        if (
            !this.fiscalCalendar ||
            typeof this.fiscalCalendar
                .getCurrentPeriod !==
                'function'
        ) {

            throw new PeriodEngineError(
                'FISCAL_CALENDAR_UNAVAILABLE',
                'Fiscal calendar does not support getCurrentPeriod()'
            );
        }

        return this.fiscalCalendar
            .getCurrentPeriod({
                tenantId:
                    normalizedTenantId
            });
    }

    /* ========================================================================
     * VALIDATE POSTING PERIOD
     *
     * Called by Ledger Engine before every posting.
     * ====================================================================== */

    async validatePostingPeriod({
        tenantId,
        transactionDate,
        context = {}
    } = {}) {

        const normalizedTenantId =
            requireValue(
                tenantId,
                'tenantId'
            );

        const normalizedDate =
            normalizeDate(
                transactionDate,
                'transactionDate'
            );

        if (
            !this.fiscalCalendar ||
            typeof this.fiscalCalendar
                .findPeriod !==
                'function'
        ) {

            throw new PeriodEngineError(
                'FISCAL_CALENDAR_UNAVAILABLE',
                'Fiscal calendar does not support findPeriod()'
            );
        }

        const period =
            await this.fiscalCalendar
                .findPeriod({

                    tenantId:
                        normalizedTenantId,

                    date:
                        normalizedDate
                });

        if (!period) {

            throw new PeriodEngineError(
                'NO_ACCOUNTING_PERIOD',
                'Transaction date has no accounting period',
                {
                    tenantId:
                        normalizedTenantId,

                    transactionDate:
                        normalizedDate
                }
            );
        }

        this.assertTenantOwnership(
            period,
            normalizedTenantId
        );

        const status =
            normalizeStatus(
                period.status
            );

        if (
            status !==
            PERIOD_STATUS.OPEN
        ) {

            throw new PeriodEngineError(
                'PERIOD_LOCKED',
                'Posting prohibited because the accounting period is not OPEN',
                {
                    periodId:
                        period.id,

                    tenantId:
                        normalizedTenantId,

                    status,

                    transactionDate:
                        normalizedDate
                }
            );
        }

        /*
         * Optional period-validator hook for additional business controls.
         */
        if (
            this.periodValidator &&
            typeof this.periodValidator
                .validatePosting ===
                'function'
        ) {

            const validation =
                await this.periodValidator
                    .validatePosting({
                        period,
                        tenantId:
                            normalizedTenantId,
                        transactionDate:
                            normalizedDate,
                        context
                    });

            if (
                validation === false ||
                validation?.valid === false
            ) {

                throw new PeriodEngineError(
                    'POSTING_PERIOD_VALIDATION_FAILED',
                    validation?.message ||
                    'Posting period validation failed',
                    {
                        periodId:
                            period.id,

                        tenantId:
                            normalizedTenantId,

                        validation
                    }
                );
            }
        }

        return true;
    }

    /* ========================================================================
     * LOCK PERIOD
     * ====================================================================== */

    async lockPeriod(
        periodId,
        context = {}
    ) {

        const normalizedPeriodId =
            requireValue(
                periodId,
                'periodId'
            );

        const tenantId =
            optionalValue(
                context.tenantId
            );

        const period =
            await this.getPeriod(
                normalizedPeriodId
            );

        if (
            tenantId
        ) {

            this.assertTenantOwnership(
                period,
                tenantId
            );
        }

        const status =
            normalizeStatus(
                period.status
            );

        if (
            status ===
            PERIOD_STATUS.LOCKED
        ) {

            /*
             * Idempotent lock behavior.
             */
            return period;
        }

        if (
            status ===
            PERIOD_STATUS.CLOSED
        ) {

            throw new PeriodEngineError(
                'PERIOD_ALREADY_CLOSED',
                `Period ${normalizedPeriodId} is already closed`,
                {
                    periodId:
                        normalizedPeriodId
                }
            );
        }

        if (
            status !==
            PERIOD_STATUS.OPEN
        ) {

            throw new PeriodEngineError(
                'INVALID_PERIOD_STATE',
                `Period ${normalizedPeriodId} cannot be locked from status ${status}`,
                {
                    periodId:
                        normalizedPeriodId,

                    status
                }
            );
        }

        if (
            !this.periodLockService ||
            typeof this.periodLockService
                .lock !==
                'function'
        ) {

            throw new PeriodEngineError(
                'PERIOD_LOCK_SERVICE_UNAVAILABLE',
                'Period lock service is not configured'
            );
        }

        const result =
            await this.periodLockService
                .lock({
                    periodId:
                        normalizedPeriodId,

                    context: {
                        ...context,

                        tenantId
                    }
                });

        await this.recordAudit(
            ACTIONS.PERIOD_LOCKED,
            result,
            context
        );

        await this.publishEvent(
            EVENTS.PERIOD_LOCKED,
            result,
            context
        );

        this.incrementMetric(
            'finance_periods_locked_total'
        );

        return result;
    }

    /* ========================================================================
     * CLOSE PERIOD
     *
     * OPEN
     *   |
     *   v
     * LOCKED
     *   |
     *   v
     * CLOSED
     * ====================================================================== */

    async closePeriod({
        periodId,
        tenantId = null,
        context = {}
    } = {}) {

        const normalizedPeriodId =
            requireValue(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            optionalValue(
                tenantId ||
                context.tenantId
            );

        const operationContext =
            this.createOperationContext(
                'PERIOD_CLOSE',
                {
                    ...context,

                    tenantId:
                        normalizedTenantId,

                    periodId:
                        normalizedPeriodId
                }
            );

        return this.trace(
            'finance.period.close',
            operationContext,
            async () => {

                /*
                 * Step 1:
                 * Validate the period while OPEN.
                 */
                const period =
                    await this.periodCloseService
                        .validateClose({
                            periodId:
                                normalizedPeriodId,

                            tenantId:
                                normalizedTenantId,

                            context:
                                operationContext
                        });

                this.assertTenantOwnership(
                    period,
                    normalizedTenantId
                );

                /*
                 * Step 2:
                 * Protect against already completed close.
                 */
                if (
                    normalizeStatus(
                        period.status
                    ) ===
                    PERIOD_STATUS.CLOSED
                ) {

                    throw new PeriodEngineError(
                        'PERIOD_ALREADY_CLOSED',
                        `Period ${normalizedPeriodId} is already closed`,
                        {
                            periodId:
                                normalizedPeriodId
                        }
                    );
                }

                /*
                 * Step 3:
                 * Lock before close.
                 *
                 * The close service must support finalization from LOCKED
                 * state. This is the explicit contract between the two
                 * services.
                 */
                const locked =
                    await this.lockPeriod(
                        normalizedPeriodId,
                        operationContext
                    );

                /*
                 * Step 4:
                 * Close the locked period.
                 *
                 * expectedStatus allows an atomic repository implementation
                 * to protect against concurrent workers.
                 */
                if (
                    !this.periodCloseService ||
                    typeof this.periodCloseService
                        .close !==
                        'function'
                ) {

                    throw new PeriodEngineError(
                        'PERIOD_CLOSE_SERVICE_UNAVAILABLE',
                        'Period close service is not configured'
                    );
                }

                const closed =
                    await this.periodCloseService
                        .close({
                            periodId:
                                normalizedPeriodId,

                            tenantId:
                                normalizedTenantId,

                            context: {
                                ...operationContext,

                                expectedStatus:
                                    PERIOD_STATUS.LOCKED,

                                lockedPeriod:
                                    locked
                            }
                        });

                if (
                    !closed
                ) {

                    throw new PeriodEngineError(
                        'PERIOD_CLOSE_FAILED',
                        `Period ${normalizedPeriodId} could not be closed`
                    );
                }

                /*
                 * Step 5:
                 * Audit and event publication happen only after the close
                 * service confirms success.
                 */
                await this.recordAudit(
                    ACTIONS.PERIOD_CLOSED,
                    closed,
                    operationContext
                );

                await this.publishEvent(
                    EVENTS.PERIOD_CLOSED,
                    closed,
                    operationContext
                );

                this.incrementMetric(
                    'finance_periods_closed_total',
                    {
                        tenantId:
                            normalizedTenantId ||
                            'unknown'
                    }
                );

                return closed;
            }
        );
    }

    /* ========================================================================
     * REOPEN PERIOD
     *
     * Controlled exception workflow.
     * ====================================================================== */

    async reopenPeriod({
        periodId,
        approvalRequest,
        context = {}
    } = {}) {

        const normalizedPeriodId =
            requireValue(
                periodId,
                'periodId'
            );

        const tenantId =
            optionalValue(
                context.tenantId
            );

        const operationContext =
            this.createOperationContext(
                'PERIOD_REOPEN',
                {
                    ...context,

                    tenantId,

                    periodId:
                        normalizedPeriodId
                }
            );

        return this.trace(
            'finance.period.reopen',
            operationContext,
            async () => {

                const period =
                    await this.getPeriod(
                        normalizedPeriodId
                    );

                this.assertTenantOwnership(
                    period,
                    tenantId
                );

                if (
                    normalizeStatus(
                        period.status
                    ) !==
                    PERIOD_STATUS.CLOSED
                ) {

                    throw new PeriodEngineError(
                        'INVALID_PERIOD_STATE',
                        `Only CLOSED periods may be reopened; current status is ${period.status}`,
                        {
                            periodId:
                                normalizedPeriodId,

                            status:
                                period.status
                        }
                    );
                }

                if (
                    !this.reopenWorkflow ||
                    typeof this.reopenWorkflow
                        .request !==
                        'function'
                ) {

                    throw new PeriodEngineError(
                        'REOPEN_WORKFLOW_UNAVAILABLE',
                        'Period reopen workflow is not configured'
                    );
                }

                await this.recordAudit(
                    ACTIONS.PERIOD_REOPEN_REQUESTED,
                    {
                        periodId:
                            normalizedPeriodId,

                        tenantId,

                        approvalRequest:
                            this.sanitizeContext(
                                approvalRequest
                            )
                    },
                    operationContext
                );

                await this.publishEvent(
                    EVENTS.PERIOD_REOPEN_REQUESTED,
                    {
                        periodId:
                            normalizedPeriodId,

                        tenantId,

                        approvalRequest:
                            this.sanitizeContext(
                                approvalRequest
                            )
                    },
                    operationContext
                );

                const approvalResult =
                    await this.reopenWorkflow
                        .request({
                            periodId:
                                normalizedPeriodId,

                            approvalRequest,

                            context:
                                operationContext
                        });

                const approved =
                    this.resolveApprovalResult(
                        approvalResult
                    );

                if (!approved) {

                    throw new PeriodEngineError(
                        'REOPEN_NOT_APPROVED',
                        'Period reopening requires approval',
                        {
                            periodId:
                                normalizedPeriodId,

                            approvalResult
                        }
                    );
                }

                /*
                 * Preserve approval information for the downstream close
                 * service. Reopen must never be an unqualified OPEN update.
                 */
                const reopenContext = {
                    ...operationContext,

                    approvalId:
                        approvalResult?.approvalId ||
                        approvalRequest?.approvalId ||
                        operationContext.approvalId,

                    approvedBy:
                        approvalResult?.approvedBy ||
                        operationContext.actorId ||
                        operationContext.userId,

                    reopenReason:
                        approvalRequest?.reason ||
                        approvalRequest?.reopenReason ||
                        operationContext.reason
                };

                const reopened =
                    await this.periodCloseService
                        .reopen({
                            periodId:
                                normalizedPeriodId,

                            tenantId,

                            approvalId:
                                reopenContext.approvalId,

                            reason:
                                reopenContext.reopenReason,

                            context:
                                reopenContext
                        });

                if (
                    !reopened
                ) {

                    throw new PeriodEngineError(
                        'PERIOD_REOPEN_FAILED',
                        `Period ${normalizedPeriodId} could not be reopened`
                    );
                }

                await this.recordAudit(
                    ACTIONS.PERIOD_REOPENED,
                    reopened,
                    reopenContext
                );

                await this.publishEvent(
                    EVENTS.PERIOD_REOPENED,
                    reopened,
                    reopenContext
                );

                this.incrementMetric(
                    'finance_periods_reopened_total',
                    {
                        tenantId:
                            tenantId ||
                            'unknown'
                    }
                );

                return reopened;
            }
        );
    }

    /* ========================================================================
     * GET PERIOD
     * ====================================================================== */

    async getPeriod(
        periodId
    ) {

        const normalizedPeriodId =
            requireValue(
                periodId,
                'periodId'
            );

        /*
         * Repository is optional because FiscalCalendar/PeriodCloseService
         * may own period retrieval in the existing architecture.
         */
        if (
            this.repository &&
            typeof this.repository
                .findById ===
            'function'
        ) {

            const period =
                await this.repository
                    .findById(
                        normalizedPeriodId
                    );

            if (!period) {
                throw createNotFoundError(
                    normalizedPeriodId
                );
            }

            return period;
        }

        if (
            this.periodCloseService &&
            typeof this.periodCloseService
                .findPeriod ===
            'function'
        ) {

            const period =
                await this.periodCloseService
                    .findPeriod(
                        normalizedPeriodId
                    );

            if (!period) {
                throw createNotFoundError(
                    normalizedPeriodId
                );
            }

            return period;
        }

        if (
            this.fiscalCalendar &&
            typeof this.fiscalCalendar
                .findPeriodById ===
            'function'
        ) {

            const period =
                await this.fiscalCalendar
                    .findPeriodById(
                        normalizedPeriodId
                    );

            if (!period) {
                throw createNotFoundError(
                    normalizedPeriodId
                );
            }

            return period;
        }

        throw new PeriodEngineError(
            'PERIOD_REPOSITORY_UNAVAILABLE',
            'No period lookup repository/service is configured',
            {
                periodId:
                    normalizedPeriodId
            }
        );
    }

    /* ========================================================================
     * Tenant Isolation
     * ====================================================================== */

    assertTenantOwnership(
        period,
        tenantId
    ) {

        if (
            !tenantId
        ) {
            return true;
        }

        if (
            !period
        ) {

            throw new PeriodEngineError(
                'PERIOD_NOT_FOUND',
                'Financial period was not found'
            );
        }

        if (
            period.tenantId ===
            undefined ||
            period.tenantId ===
            null
        ) {

            throw new PeriodEngineError(
                'TENANT_DATA_MISSING',
                'Financial period has no tenant ownership information',
                {
                    periodId:
                        period.id
                }
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

            throw createTenantError(
                period.id,
                tenantId
            );
        }

        return true;
    }

    /* ========================================================================
     * Fiscal Year
     * ====================================================================== */

    normalizeFiscalYear(
        fiscalYear,
        startDate
    ) {

        if (
            fiscalYear ===
            undefined ||
            fiscalYear === null
        ) {

            return startDate
                .getFullYear();
        }

        const year =
            Number(
                fiscalYear
            );

        if (
            !Number.isInteger(
                year
            ) ||
            year < 1900 ||
            year > 9999
        ) {

            throw new PeriodEngineError(
                'INVALID_FISCAL_YEAR',
                'fiscalYear must be a valid four-digit year',
                {
                    fiscalYear
                }
            );
        }

        return year;
    }

    /* ========================================================================
     * Date Validation
     * ====================================================================== */

    async validatePeriodDates({
        startDate,
        endDate
    }) {

        if (
            !this.periodValidator
        ) {
            return true;
        }

        if (
            typeof this.periodValidator
                .validateDates !==
            'function'
        ) {
            return true;
        }

        const validation =
            await this.periodValidator
                .validateDates({
                    startDate,
                    endDate
                });

        if (
            validation === false ||
            validation?.valid === false
        ) {

            throw new PeriodEngineError(
                'INVALID_PERIOD',
                'Invalid accounting period',
                validation || {}
            );
        }

        return true;
    }

    /* ========================================================================
     * Overlap Validation
     * ====================================================================== */

    async ensureNoOverlappingPeriod({
        tenantId,
        startDate,
        endDate
    }) {

        /*
         * Prefer repository-native overlap queries.
         */
        if (
            this.repository &&
            typeof this.repository
                .findOverlapping ===
            'function'
        ) {

            const overlap =
                await this.repository
                    .findOverlapping({
                        tenantId,
                        startDate,
                        endDate
                    });

            if (
                overlap
            ) {

                throw new PeriodEngineError(
                    'OVERLAPPING_PERIOD',
                    'Accounting period overlaps an existing period',
                    {
                        tenantId,
                        startDate,
                        endDate,
                        existingPeriodId:
                            overlap.id
                    }
                );
            }
        }

        return true;
    }

    /* ========================================================================
     * Persistence
     * ====================================================================== */

    async persistPeriod(
        period
    ) {

        if (
            this.repository &&
            typeof this.repository
                .create ===
            'function'
        ) {

            return this.repository
                .create(
                    period
                );
        }

        /*
         * Some existing implementations may expose createPeriod() through the
         * fiscal calendar.
         */
        if (
            this.fiscalCalendar &&
            typeof this.fiscalCalendar
                .createPeriod ===
            'function'
        ) {

            return this.fiscalCalendar
                .createPeriod(
                    period
                );
        }

        /*
         * Do not silently pretend persistence occurred.
         *
         * A production financial period must be durable.
         */
        throw new PeriodEngineError(
            'PERIOD_REPOSITORY_UNAVAILABLE',
            'No period persistence repository/service is configured'
        );
    }

    /* ========================================================================
     * Approval Resolution
     * ====================================================================== */

    resolveApprovalResult(
        result
    ) {

        if (
            result === true
        ) {
            return true;
        }

        if (
            !result
        ) {
            return false;
        }

        if (
            result.approved ===
            true
        ) {
            return true;
        }

        if (
            result.status &&
            normalizeStatus(
                result.status
            ) ===
            'APPROVED'
        ) {
            return true;
        }

        return false;
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

            requestId:
                optionalValue(
                    context.requestId
                ),

            tenantId:
                optionalValue(
                    context.tenantId
                ),

            actorId:
                optionalValue(
                    context.actorId ||
                    context.userId
                ),

            reason:
                optionalValue(
                    context.reason
                )
        };
    }

    /* ========================================================================
     * Sanitization
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

        const safe = {};

        const sensitivePatterns = [
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
        ];

        for (
            const [
                key,
                value
            ] of Object.entries(
                context
            )
        ) {

            if (
                sensitivePatterns.some(
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

                safe[key] =
                    typeof value ===
                    'string'
                        ? value.slice(
                            0,
                            2000
                        )
                        : value;
            }
        }

        return safe;
    }

    /* ========================================================================
     * Audit
     * ====================================================================== */

    async recordAudit(
        action,
        entity,
        context = {}
    ) {

        if (
            !this.auditService
        ) {
            return;
        }

        const payload = {
            action,

            entity,

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

                /*
                 * Support existing audit service signatures:
                 *
                 *   record(payload)
                 *   record(event, payload)
                 */
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
             * The audit failure is surfaced operationally but never causes
             * successful financial state transition to be rolled back here.
             *
             * For strict regulatory environments, audit persistence should be
             * transactionally coupled through the application's outbox/audit
             * mechanism.
             */
            this.safeLog(
                'error',
                `Failed to record period audit: ${action}`,
                error
            );
        }
    }

    /* ========================================================================
     * Event Bus
     * ====================================================================== */

    async publishEvent(
        type,
        payload,
        context = {}
    ) {

        if (
            !this.eventBus ||
            typeof this.eventBus
                .publish !==
            'function'
        ) {
            return;
        }

        const event = {

            id:
                this.idGenerator(),

            type,

            payload,

            context:
                this.sanitizeContext(
                    context
                ),

            occurredAt:
                this.clock()
        };

        try {

            /*
             * Do not expose sensitive approval/request payloads through
             * arbitrary context.
             */
            await this.eventBus
                .publish(
                    event
                );

        } catch (error) {

            /*
             * Event publication must be made durable through an outbox in a
             * production deployment if domain-event delivery is mandatory.
             */
            this.safeLog(
                'error',
                `Failed to publish period event: ${type}`,
                error
            );
        }
    }

    /* ========================================================================
     * Tracing
     * ====================================================================== */

    async trace(
        operation,
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
                    operation,

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
             * Do not execute callback a second time after an ambiguous tracer
             * failure. This protects financial operations from duplicate work.
             *
             * The tracer itself should provide fail-open/no-op behavior.
             */
            this.safeLog(
                'warn',
                `Period tracing failed for ${operation}`,
                error
            );

            throw error;
        }
    }

    /* ========================================================================
     * Metrics
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

                return true;
            }

            if (
                typeof this.metrics
                    ?.inc ===
                'function'
            ) {

                this.metrics.inc(
                    name,
                    labels
                );

                return true;
            }

            return false;

        } catch (error) {

            this.safeLog(
                'warn',
                `Period metric failed: ${name}`,
                error
            );

            return false;
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

                return;
            }

            if (
                typeof this.logger?.log ===
                'function'
            ) {

                this.logger.log(
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
             * Logging must remain non-fatal.
             */
        }
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'PeriodEngine',

            repositoryConfigured:
                Boolean(
                    this.repository
                ),

            fiscalCalendarConfigured:
                Boolean(
                    this.fiscalCalendar
                ),

            periodLockServiceConfigured:
                Boolean(
                    this.periodLockService
                ),

            periodCloseServiceConfigured:
                Boolean(
                    this.periodCloseService
                ),

            adjustmentPeriodConfigured:
                Boolean(
                    this.adjustmentPeriod
                ),

            reopenWorkflowConfigured:
                Boolean(
                    this.reopenWorkflow
                ),

            periodValidatorConfigured:
                Boolean(
                    this.periodValidator
                ),

            auditServiceConfigured:
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

            lifecycle:
                {
                    open:
                        PERIOD_STATUS.OPEN,

                    locked:
                        PERIOD_STATUS.LOCKED,

                    closed:
                        PERIOD_STATUS.CLOSED,

                    reopened:
                        PERIOD_STATUS.REOPENED
                },

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

        return new PeriodEngine(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

PeriodEngine.STATUS =
    PERIOD_STATUS;

PeriodEngine.EVENTS =
    EVENTS;

PeriodEngine.ACTIONS =
    ACTIONS;

PeriodEngine.Error =
    PeriodEngineError;

/* ============================================================================
 * Module export
 * ========================================================================== */

module.exports = {
    PeriodEngine,
    PeriodEngineError,
    PERIOD_STATUS,
    EVENTS,
    ACTIONS
};