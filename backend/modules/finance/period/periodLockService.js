'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Financial Period Lock Service
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/periodLockService.js
 *
 * Purpose:
 *   Enterprise control service for locking and unlocking financial periods.
 *
 * Responsibilities:
 *   - Transition OPEN -> LOCKED
 *   - Controlled LOCKED -> OPEN rollback where explicitly authorized
 *   - Enforce tenant isolation
 *   - Prevent locking CLOSED periods
 *   - Prevent unlocking CLOSED periods accidentally
 *   - Support atomic compare-and-set repository operations
 *   - Preserve actor / correlation / operation metadata
 *   - Provide idempotent lock behavior
 *   - Provide operational diagnostics
 *
 * IMPORTANT:
 *
 *   A period lock is a control-plane operation.
 *   It does not modify ledger balances or financial transactions.
 *
 *   Historical financial transactions remain immutable.
 *
 * Recommended lifecycle:
 *
 *   OPEN
 *     |
 *     | lock()
 *     v
 *   LOCKED
 *     |
 *     | close()
 *     v
 *   CLOSED
 *
 * Controlled exception workflow:
 *
 *   LOCKED
 *     |
 *     | unlock()
 *     v
 *   OPEN
 *
 *   CLOSED periods MUST NOT be reopened through this service.
 *   Reopening a CLOSED period belongs to PeriodCloseService / ReopenWorkflow.
 *
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STATUS = Object.freeze({

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

const OPERATIONS = Object.freeze({

    LOCK:
        'PERIOD_LOCK',

    UNLOCK:
        'PERIOD_UNLOCK'
});

/* -------------------------------------------------------------------------- */
/* Error helpers                                                              */
/* -------------------------------------------------------------------------- */

class PeriodLockError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'PeriodLockError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        if (
            metadata &&
            metadata.cause
        ) {
            this.cause =
                metadata.cause;
        }

        Error.captureStackTrace?.(
            this,
            PeriodLockError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new PeriodLockError(
        'PERIOD_LOCK_VALIDATION_ERROR',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new PeriodLockError(
        'PERIOD_LOCK_CONFLICT',
        message,
        metadata
    );
}

function authorizationError(
    message,
    metadata = {}
) {

    return new PeriodLockError(
        'PERIOD_LOCK_AUTHORIZATION_ERROR',
        message,
        metadata
    );
}

function notFoundError(
    periodId
) {

    return new PeriodLockError(
        'PERIOD_NOT_FOUND',
        `Financial period ${periodId} was not found`,
        {
            periodId
        }
    );
}

/* -------------------------------------------------------------------------- */
/* Utility helpers                                                            */
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

    return String(
        status ||
        ''
    )
        .trim()
        .toUpperCase();
}

function nowDate(
    clock
) {

    const current =
        clock();

    return current instanceof Date
        ? new Date(
            current.getTime()
        )
        : new Date(
            current
        );
}

/* -------------------------------------------------------------------------- */
/* Period Lock Service                                                        */
/* -------------------------------------------------------------------------- */

class PeriodLockService {

    constructor({

        repository,

        logger,

        clock,

        idGenerator,

        auditService,

        eventBus,

        tracing,

        metrics

    } = {}) {

        if (
            !repository ||
            typeof repository.findById !==
                'function'
        ) {

            throw new TypeError(
                'PeriodLockService requires a repository with findById()'
            );
        }

        if (
            typeof repository.update !==
                'function' &&
            typeof repository.findOneAndUpdate !==
                'function'
        ) {

            throw new TypeError(
                'PeriodLockService requires repository update() or findOneAndUpdate()'
            );
        }

        this.repository =
            repository;

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

        this.eventBus =
            eventBus ||
            null;

        this.tracing =
            tracing ||
            null;

        this.metrics =
            metrics ||
            null;
    }

    /* ========================================================================
     * LOCK
     * ====================================================================== */

    async lock({

        periodId,

        tenantId = null,

        context = {}

    } = {}) {

        const normalizedPeriodId =
            requireId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            optionalId(
                tenantId ||
                context?.tenantId
            );

        const operationContext =
            this.createContext(
                OPERATIONS.LOCK,
                {
                    ...context,

                    tenantId:
                        normalizedTenantId,

                    periodId:
                        normalizedPeriodId
                }
            );

        return this.trace(
            'finance.period.lock',
            operationContext,
            async () => {

                const period =
                    await this.getPeriod(
                        normalizedPeriodId
                    );

                this.assertTenant(
                    period,
                    normalizedTenantId
                );

                const status =
                    normalizeStatus(
                        period.status
                    );

                /*
                 * Lock operation is intentionally idempotent.
                 */
                if (
                    status ===
                    STATUS.LOCKED
                ) {

                    return period;
                }

                if (
                    status ===
                    STATUS.CLOSED
                ) {

                    throw conflictError(
                        `Period ${normalizedPeriodId} is already CLOSED and cannot be locked`,
                        {
                            periodId:
                                normalizedPeriodId,

                            status
                        }
                    );
                }

                if (
                    status !==
                    STATUS.OPEN
                ) {

                    throw conflictError(
                        `Period ${normalizedPeriodId} cannot be locked from status ${status}`,
                        {
                            periodId:
                                normalizedPeriodId,

                            status
                        }
                    );
                }

                const now =
                    nowDate(
                        this.clock
                    );

                const actorId =
                    optionalId(
                        context?.actorId ||
                        context?.userId ||
                        context?.lockedBy
                    );

                const updatePayload = {

                    status:
                        STATUS.LOCKED,

                    lockedBy:
                        actorId,

                    lockedAt:
                        now,

                    updatedAt:
                        now,

                    lockOperationId:
                        operationContext
                            .operationId,

                    lockCorrelationId:
                        operationContext
                            .correlationId,

                    lockRequestId:
                        operationContext
                            .requestId ||
                        null
                };

                const locked =
                    await this.persistLock(
                        normalizedPeriodId,
                        normalizedTenantId,
                        updatePayload
                    );

                if (
                    !locked
                ) {

                    throw conflictError(
                        `Period ${normalizedPeriodId} could not be locked because its state changed concurrently`,
                        {
                            periodId:
                                normalizedPeriodId
                        }
                    );
                }

                await this.recordAudit(
                    'PERIOD_LOCKED',
                    locked,
                    operationContext
                );

                await this.publishEvent(
                    'PeriodLocked',
                    locked,
                    operationContext
                );

                this.incrementMetric(
                    'finance_periods_locked_total'
                );

                return locked;
            }
        );
    }

    /* ========================================================================
     * UNLOCK
     * ====================================================================== */

    async unlock(
        periodId,
        context = {}
    ) {

        const normalizedPeriodId =
            requireId(
                periodId,
                'periodId'
            );

        const normalizedTenantId =
            optionalId(
                context?.tenantId
            );

        const operationContext =
            this.createContext(
                OPERATIONS.UNLOCK,
                {
                    ...context,

                    periodId:
                        normalizedPeriodId,

                    tenantId:
                        normalizedTenantId
                }
            );

        return this.trace(
            'finance.period.unlock',
            operationContext,
            async () => {

                const period =
                    await this.getPeriod(
                        normalizedPeriodId
                    );

                this.assertTenant(
                    period,
                    normalizedTenantId
                );

                const status =
                    normalizeStatus(
                        period.status
                    );

                /*
                 * Unlock is intentionally idempotent for OPEN periods.
                 */
                if (
                    status ===
                    STATUS.OPEN
                ) {

                    return period;
                }

                /*
                 * CLOSED periods are NEVER reopened here.
                 *
                 * That must go through the controlled reopen workflow.
                 */
                if (
                    status ===
                    STATUS.CLOSED
                ) {

                    throw authorizationError(
                        `Closed period ${normalizedPeriodId} cannot be unlocked; use the controlled reopen workflow`,
                        {
                            periodId:
                                normalizedPeriodId,

                            status
                        }
                    );
                }

                if (
                    status !==
                    STATUS.LOCKED
                ) {

                    throw conflictError(
                        `Period ${normalizedPeriodId} cannot be unlocked from status ${status}`,
                        {
                            periodId:
                                normalizedPeriodId,

                            status
                        }
                    );
                }

                const actorId =
                    optionalId(
                        context?.actorId ||
                        context?.userId ||
                        context?.unlockedBy
                    );

                if (
                    !actorId
                ) {

                    throw authorizationError(
                        'An authorized actor is required to unlock a financial period'
                    );
                }

                const reason =
                    optionalId(
                        context?.reason ||
                        context?.unlockReason
                    );

                if (
                    !reason
                ) {

                    throw validationError(
                        'A reason is required to unlock a financial period'
                    );
                }

                const now =
                    nowDate(
                        this.clock
                    );

                const updatePayload = {

                    status:
                        STATUS.OPEN,

                    unlockedBy:
                        actorId,

                    unlockedAt:
                        now,

                    unlockReason:
                        String(
                            reason
                        )
                            .trim()
                            .slice(
                                0,
                                2000
                            ),

                    unlockOperationId:
                        operationContext
                            .operationId,

                    unlockCorrelationId:
                        operationContext
                            .correlationId,

                    unlockRequestId:
                        operationContext
                            .requestId ||
                        null,

                    updatedAt:
                        now
                };

                const unlocked =
                    await this.persistUnlock(
                        normalizedPeriodId,
                        normalizedTenantId,
                        updatePayload
                    );

                if (
                    !unlocked
                ) {

                    throw conflictError(
                        `Period ${normalizedPeriodId} could not be unlocked because its state changed concurrently`,
                        {
                            periodId:
                                normalizedPeriodId
                        }
                    );
                }

                await this.recordAudit(
                    'PERIOD_UNLOCKED',
                    unlocked,
                    operationContext
                );

                await this.publishEvent(
                    'PeriodUnlocked',
                    unlocked,
                    operationContext
                );

                this.incrementMetric(
                    'finance_periods_unlocked_total'
                );

                return unlocked;
            }
        );
    }

    /* ========================================================================
     * GET PERIOD
     * ====================================================================== */

    async getPeriod(
        periodId
    ) {

        const period =
            await this.repository
                .findById(
                    periodId
                );

        if (
            !period
        ) {

            throw notFoundError(
                periodId
            );
        }

        return period;
    }

    /* ========================================================================
     * TENANT ISOLATION
     * ====================================================================== */

    assertTenant(
        period,
        tenantId
    ) {

        if (
            !tenantId
        ) {

            return true;
        }

        if (
            !period?.tenantId
        ) {

            throw authorizationError(
                'Financial period has no tenant ownership information',
                {
                    periodId:
                        period?.id
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

            throw authorizationError(
                `Financial period ${period.id} does not belong to tenant ${tenantId}`,
                {
                    periodId:
                        period.id,

                    tenantId
                }
            );
        }

        return true;
    }

    /* ========================================================================
     * ATOMIC LOCK PERSISTENCE
     * ====================================================================== */

    async persistLock(
        periodId,
        tenantId,
        payload
    ) {

        /*
         * Best option:
         *
         *   UPDATE ... WHERE id = periodId
         *                   AND tenantId = tenantId
         *                   AND status = OPEN
         *
         * This provides compare-and-set semantics and protects against
         * concurrent workers.
         */
        if (
            typeof this.repository
                .findOneAndUpdate ===
            'function'
        ) {

            const filter = {

                id:
                    periodId,

                status:
                    STATUS.OPEN
            };

            if (
                tenantId
            ) {
                filter.tenantId =
                    tenantId;
            }

            return this.repository
                .findOneAndUpdate(
                    filter,
                    payload,
                    {
                        new:
                            true
                    }
                );
        }

        /*
         * A repository exposing only update() cannot provide reliable
         * compare-and-set semantics unless it accepts a status filter.
         *
         * Support both common repository contracts:
         *
         *   update(filter, payload)
         *   update(id, payload)
         */
        try {

            const result =
                await this.repository
                    .update(
                        {
                            id:
                                periodId,

                            ...(tenantId
                                ? {
                                    tenantId
                                }
                                : {}),

                            status:
                                STATUS.OPEN
                        },
                        payload
                    );

            return result;

        } catch (error) {

            /*
             * Fall back only for repositories whose update contract expects
             * (id, payload).
             */
            if (
                this.repository
                    .update.length >=
                2
            ) {

                return this.repository
                    .update(
                        {
                            id:
                                periodId
                        },
                        payload
                    );
            }

            throw error;
        }
    }

    /* ========================================================================
     * ATOMIC UNLOCK PERSISTENCE
     * ====================================================================== */

    async persistUnlock(
        periodId,
        tenantId,
        payload
    ) {

        if (
            typeof this.repository
                .findOneAndUpdate ===
            'function'
        ) {

            const filter = {

                id:
                    periodId,

                status:
                    STATUS.LOCKED
            };

            if (
                tenantId
            ) {
                filter.tenantId =
                    tenantId;
            }

            return this.repository
                .findOneAndUpdate(
                    filter,
                    payload,
                    {
                        new:
                            true
                    }
                );
        }

        return this.repository
            .update(
                {
                    id:
                        periodId,

                    ...(tenantId
                        ? {
                            tenantId
                        }
                        : {}),

                    status:
                        STATUS.LOCKED
                },
                payload
            );
    }

    /* ========================================================================
     * CONTEXT
     * ====================================================================== */

    createContext(
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
                optionalId(
                    context.requestId
                ),

            tenantId:
                optionalId(
                    context.tenantId
                ),

            actorId:
                optionalId(
                    context.actorId ||
                    context.userId
                ),

            periodId:
                optionalId(
                    context.periodId
                ),

            reason:
                optionalId(
                    context.reason ||
                    context.unlockReason
                )
        };
    }

    sanitizeContext(
        context = {}
    ) {

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
                context || {}
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
     * AUDIT
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
                nowDate(
                    this.clock
                )
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
                `Failed to record period lock audit: ${action}`,
                error
            );
        }
    }

    /* ========================================================================
     * EVENT BUS
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
                nowDate(
                    this.clock
                )
        };

        try {

            await this.eventBus
                .publish(
                    event
                );

        } catch (error) {

            /*
             * Domain-event durability should ideally be guaranteed by the
             * application's transactional outbox.
             */
            this.safeLog(
                'error',
                `Failed to publish event: ${type}`,
                error
            );
        }
    }

    /* ========================================================================
     * TRACING
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
             * Never rerun a lock/unlock operation after an ambiguous tracing
             * exception. Duplicate financial-period transitions are unsafe.
             */
            this.safeLog(
                'warn',
                `Period lock tracing failed for ${operation}`,
                error
            );

            throw error;
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
                typeof this.metrics
                    ?.inc ===
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
                `Period lock metric failed: ${name}`,
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
                'PeriodLockService',

            repositoryConfigured:
                Boolean(
                    this.repository
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

            repositoryCapabilities: {

                findById:
                    typeof this.repository
                        ?.findById ===
                    'function',

                update:
                    typeof this.repository
                        ?.update ===
                    'function',

                atomicTransition:
                    typeof this.repository
                        ?.findOneAndUpdate ===
                    'function'
            },

            lifecycle: {
                lock:
                    `${STATUS.OPEN} -> ${STATUS.LOCKED}`,

                close:
                    `${STATUS.LOCKED} -> ${STATUS.CLOSED}`,

                unlock:
                    `${STATUS.LOCKED} -> ${STATUS.OPEN}`
            },

            timestamp:
                nowDate(
                    this.clock
                ).toISOString()
        };
    }

    /* ========================================================================
     * FACTORY
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new PeriodLockService(
            options
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Static exports                                                             */
/* -------------------------------------------------------------------------- */

PeriodLockService.STATUS =
    STATUS;

PeriodLockService.OPERATIONS =
    OPERATIONS;

PeriodLockService.Error =
    PeriodLockError;

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

module.exports =
    PeriodLockService;