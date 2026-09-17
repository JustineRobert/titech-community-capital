'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Reconciliation Service
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/reconciliation/reconciliationService.js
 *
 * Architectural Role
 * ------------------
 * Central orchestration boundary for the Airtel reconciliation subsystem.
 *
 * This service coordinates the reconciliation engine, exception persistence,
 * reporting and explicitly-authorized repair workflows. It does not itself
 * perform matching or financial accounting.
 *
 * Responsibilities
 * ----------------
 * - Coordinate reconciliation lifecycle execution.
 * - Propagate tenant/correlation/execution/idempotency context.
 * - Delegate provider-vs-financial evidence comparison to ReconciliationEngine.
 * - Persist reconciliation exceptions through the exception repository.
 * - Generate reconciliation reports.
 * - Coordinate explicitly authorized repair requests.
 * - Provide manual single-transaction matching.
 * - Maintain operational metrics and health state.
 * - Publish safe lifecycle events.
 * - Record operational audit entries.
 * - Support automatic, manual and scheduled execution modes.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API communication.
 * - Airtel authentication.
 * - Payment execution.
 * - Settlement execution.
 * - Transaction matching rules.
 * - Direct ledger writes.
 * - Wallet/balance mutation.
 * - Double-entry journal creation.
 * - Financial transaction posting.
 * - Reconciliation algorithm implementation.
 * - Regulatory/compliance decisions.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. The service orchestrates; it does not account.
 * 2. ReconciliationEngine owns evidence comparison.
 * 3. ReconciliationMatcher owns pair matching logic.
 * 4. ReconciliationReporter owns reporting projections.
 * 5. Repair is explicit and separately authorized.
 * 6. Exceptions are persisted as evidence, not treated as authorization for
 *    automatic financial mutation.
 * 7. Tenant isolation is mandatory.
 * 8. Idempotency is checked before reconciliation side effects.
 * 9. Raw provider/ledger request/response payloads are never published here.
 * 10. Provider success and reconciliation success are not independently treated
 *     as accounting settlement.
 *
 * Operational Principles
 * ----------------------
 * - Fail closed when required orchestration dependencies are missing.
 * - Prefer canonical idempotency interfaces over ad-hoc cache semantics.
 * - Prefer outbox/event publisher over direct event bus when available.
 * - Do not let event/audit failure rewrite the reconciliation result.
 * - Preserve partial-failure visibility.
 * - Keep lifecycle and operational status distinct from financial state.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'ReconciliationService';
const VERSION = '1.0.0';

const SERVICE_STATUS = Object.freeze({

    INITIALIZING:
        'INITIALIZING',

    READY:
        'READY',

    RUNNING:
        'RUNNING',

    DEGRADED:
        'DEGRADED',

    FAILED:
        'FAILED'

});

const RECONCILIATION_MODE = Object.freeze({

    AUTOMATIC:
        'AUTOMATIC',

    MANUAL:
        'MANUAL',

    SCHEDULED:
        'SCHEDULED'

});

const RECONCILIATION_RESULT_STATUS = Object.freeze({

    MATCHED:
        'MATCHED',

    PARTIAL:
        'PARTIAL',

    REVIEW:
        'REVIEW',

    FAILED:
        'FAILED'

});

const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'clientSecret',
    'secret',
    'api_key',
    'apiKey',
    'signature',
    'x-signature',
    'raw',
    'body',
    'requestBody',
    'responseBody',
    'providerRequest',
    'providerResponse',
    'credentials'
]);

const MAX_STRING_LENGTH = 512;
const MAX_EXCEPTION_RECORDS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

function truncate(
    value,
    maxLength = MAX_STRING_LENGTH
) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const stringValue =
        String(value);

    return stringValue.length <= maxLength
        ? stringValue
        : `${stringValue.slice(0, maxLength)}…`;
}

function sanitizeValue(
    value,
    key = '',
    depth = 0
) {

    if (depth > 5) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const normalizedKey =
        String(key || '')
            .toLowerCase();

    if (
        SENSITIVE_KEYS.has(key) ||
        SENSITIVE_KEYS.has(normalizedKey)
    ) {
        return '[REDACTED]';
    }

    if (
        typeof value === 'string'
    ) {
        return truncate(value);
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Array.isArray(value)
    ) {

        return value
            .slice(
                0,
                MAX_EXCEPTION_RECORDS
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        '',
                        depth + 1
                    )
            );
    }

    if (
        typeof value === 'object'
    ) {

        const output = {};

        for (
            const [
                childKey,
                childValue
            ] of Object.entries(value)
                .slice(0, 100)
        ) {

            if (
                childKey === '__proto__' ||
                childKey === 'prototype' ||
                childKey === 'constructor'
            ) {
                continue;
            }

            output[childKey] =
                sanitizeValue(
                    childValue,
                    childKey,
                    depth + 1
                );
        }

        return output;
    }

    return truncate(value);
}

function safeError(
    error
) {

    return {

        name:
            truncate(
                error?.name ||
                'Error',
                128
            ),

        message:
            truncate(
                error?.message ||
                String(error || 'Unknown error'),
                MAX_ERROR_MESSAGE_LENGTH
            ),

        code:
            truncate(
                error?.code,
                128
            ),

        statusCode:
            Number.isFinite(
                error?.statusCode
            )
                ? error.statusCode
                : undefined

    };
}

function normalizeTenantId(
    tenantId
) {

    if (
        tenantId === null ||
        tenantId === undefined
    ) {
        return null;
    }

    const normalized =
        String(
            typeof tenantId === 'object' &&
            typeof tenantId.toString === 'function'
                ? tenantId.toString()
                : tenantId
        )
            .trim();

    return normalized
        ? truncate(
            normalized,
            128
        )
        : null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (!normalized) {

        throw new Error(
            'tenantId is required for Airtel reconciliation'
        );
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    fieldName
) {

    if (
        value === null ||
        value === undefined
    ) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    const normalized =
        String(value)
            .trim();

    if (!normalized) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    return truncate(
        normalized,
        256
    );
}

function normalizeDate(
    value
) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            'settlementDate must be a valid date'
        );
    }

    return date;
}

function normalizeMode(
    mode
) {

    const normalized =
        String(
            mode ||
            RECONCILIATION_MODE.AUTOMATIC
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            RECONCILIATION_MODE
        ).includes(
            normalized
        )
    ) {

        throw new Error(
            `Unsupported reconciliation mode: ${normalized}`
        );
    }

    return normalized;
}

function normalizeArray(
    value
) {

    return Array.isArray(value)
        ? value
        : [];
}

class ReconciliationService {

    constructor({

        reconciliationEngine,

        reconciliationMatcher,

        reconciliationReporter,

        settlementRepository,

        transactionRepository,

        exceptionRepository,

        repairEngine,

        ledgerBridge,

        providerAdapter,

        financialTransactionService,

        idempotencyEngine,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        tenantResolver,

        authorizationService,

        clock = Date,

        idempotencyTtlSeconds = 86_400

    } = {}) {

        this.reconciliationEngine =
            reconciliationEngine;

        this.reconciliationMatcher =
            reconciliationMatcher;

        this.reconciliationReporter =
            reconciliationReporter;

        this.settlementRepository =
            settlementRepository;

        this.transactionRepository =
            transactionRepository;

        this.exceptionRepository =
            exceptionRepository;

        this.repairEngine =
            repairEngine;

        this.ledgerBridge =
            ledgerBridge;

        this.providerAdapter =
            providerAdapter;

        this.financialTransactionService =
            financialTransactionService;

        this.idempotencyEngine =
            idempotencyEngine;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.metrics =
            metrics;

        this.logger =
            logger;

        this.tracer =
            tracer;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.clock =
            clock;

        this.idempotencyTtlSeconds =
            Number.isFinite(
                Number(
                    idempotencyTtlSeconds
                )
            ) &&
            Number(
                idempotencyTtlSeconds
            ) > 0
                ? Math.floor(
                    Number(
                        idempotencyTtlSeconds
                    )
                )
                : 86_400;

        this.healthState = {

            status:
                SERVICE_STATUS.INITIALIZING,

            startedAt:
                this.now(),

            lastRun:
                null,

            lastFailure:
                null,

            lastError:
                null

        };

        this.statistics = {

            executions:
                0,

            idempotentHits:
                0,

            successful:
                0,

            partial:
                0,

            failed:
                0,

            exceptions:
                0,

            repairs:
                0,

            manualMatches:
                0,

            auditFailures:
                0,

            eventFailures:
                0

        };

        this.initialized =
            false;
    }

    /**
     * =========================================================================
     * Initialize Service
     * =========================================================================
     */

    async initialize() {

        this.validateDependencies();

        if (
            this.reconciliationEngine &&
            typeof this.reconciliationEngine.initialize ===
            'function'
        ) {

            await this.reconciliationEngine.initialize();
        }

        if (
            this.reconciliationReporter &&
            typeof this.reconciliationReporter.initialize ===
            'function'
        ) {

            await this.reconciliationReporter.initialize();
        }

        this.initialized =
            true;

        this.healthState.status =
            SERVICE_STATUS.READY;

        this.logger?.info?.({

            provider:
                PROVIDER,

            component:
                COMPONENT,

            message:
                'Airtel reconciliation service initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_reconciliation_service_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Execute Reconciliation Workflow
     * =========================================================================
     */

    async execute({

        tenantId,

        settlementDate,

        mode =
            RECONCILIATION_MODE.AUTOMATIC,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        idempotencyKey,

        requestedBy = null,

        metadata = {},

        session = null

    } = {}) {

        const span =
            this.startSpan(
                'airtel.reconciliation.service.execute',
                {
                    tenantId,
                    correlationId,
                    executionId,
                    mode
                }
            );

        const startedAt =
            Date.now();

        let runContext = null;

        try {

            const normalizedTenantId =
                requireTenantId(
                    tenantId
                );

            const normalizedSettlementDate =
                normalizeDate(
                    settlementDate
                );

            const normalizedMode =
                normalizeMode(
                    mode
                );

            const normalizedCorrelationId =
                normalizeIdentifier(
                    correlationId,
                    'correlationId'
                );

            const normalizedExecutionId =
                normalizeIdentifier(
                    executionId,
                    'executionId'
                );

            const effectiveIdempotencyKey =
                idempotencyKey ||
                this.buildIdempotencyKey({
                    tenantId:
                        normalizedTenantId,

                    settlementDate:
                        normalizedSettlementDate,

                    mode:
                        normalizedMode
                });

            runContext = {

                tenantId:
                    normalizedTenantId,

                settlementDate:
                    normalizedSettlementDate,

                mode:
                    normalizedMode,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                requestedBy:
                    this.safeActor(
                        requestedBy
                    ),

                metadata:
                    sanitizeValue(
                        metadata
                    ),

                session

            };

            const previous =
                await this.checkIdempotency(
                    runContext
                );

            if (previous) {

                this.statistics.idempotentHits++;

                this.metrics?.counter?.(
                    'payment_airtel_reconciliation_service_idempotent_hit_total',
                    1
                );

                return previous;
            }

            this.healthState.status =
                SERVICE_STATUS.RUNNING;

            this.statistics.executions++;

            const reconciliation =
                await this.reconciliationEngine
                    .reconcile({

                        tenantId:
                            normalizedTenantId,

                        settlementDate:
                            normalizedSettlementDate,

                        correlationId:
                            normalizedCorrelationId,

                        executionId:
                            normalizedExecutionId,

                        idempotencyKey:
                            effectiveIdempotencyKey,

                        session,

                        metadata:
                            runContext.metadata

                    });

            const exceptions =
                normalizeArray(
                    reconciliation?.exceptions
                );

            await this.processExceptions({

                tenantId:
                    normalizedTenantId,

                exceptions,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                reconciliationId:
                    reconciliation?.reconciliationId ??
                    reconciliation?.executionId,

                session

            });

            let report =
                null;

            if (
                this.reconciliationReporter &&
                typeof this.reconciliationReporter.generate ===
                'function'
            ) {

                report =
                    await this.reconciliationReporter
                        .generate({

                            tenantId:
                                normalizedTenantId,

                            type:
                                this.resolveReportType(
                                    normalizedMode
                                ),

                            reconciliationId:
                                reconciliation?.reconciliationId ??
                                reconciliation?.executionId ??
                                normalizedExecutionId,

                            correlationId:
                                normalizedCorrelationId,

                            executionId:
                                normalizedExecutionId,

                            data:
                                reconciliation,

                            metadata:
                                runContext.metadata,

                            generatedBy:
                                requestedBy,

                            session

                        });
            }

            const response = {

                reconciliation:
                    this.safeReconciliationResult(
                        reconciliation
                    ),

                report:
                    report
                        ? this.safeReportProjection(
                            report
                        )
                        : null,

                tenantId:
                    normalizedTenantId,

                provider:
                    PROVIDER,

                mode:
                    normalizedMode,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                completedAt:
                    this.now()

            };

            await this.storeIdempotentResult(
                runContext,
                response
            );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_RECONCILIATION_EXECUTED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                mode:
                    normalizedMode,

                status:
                    reconciliation?.status,

                exceptionCount:
                    exceptions.length

            });

            await this.publishSafeEvent({

                type:
                    'AIRTEL_RECONCILIATION_COMPLETED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                payload: {

                    tenantId:
                        normalizedTenantId,

                    mode:
                        normalizedMode,

                    status:
                        reconciliation?.status,

                    reconciliationId:
                        reconciliation?.reconciliationId ??
                        reconciliation?.executionId,

                    exceptionCount:
                        exceptions.length,

                    reportId:
                        report?.reportId ??
                        report?.id

                }

            });

            this.recordOutcomeStatistics(
                reconciliation
            );

            this.healthState.lastRun =
                this.now();

            this.healthState.lastFailure =
                null;

            this.healthState.lastError =
                null;

            this.healthState.status =
                SERVICE_STATUS.READY;

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_service_completed_total',
                1
            );

            this.metrics?.histogram?.(
                'payment_airtel_reconciliation_service_duration_ms',
                Date.now() - startedAt
            );

            return response;

        } catch (error) {

            this.statistics.failed++;

            this.healthState.lastFailure =
                this.now();

            this.healthState.lastError =
                safeError(error);

            this.healthState.status =
                SERVICE_STATUS.DEGRADED;

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_service_failed_total',
                1
            );

            this.metrics?.histogram?.(
                'payment_airtel_reconciliation_service_duration_ms',
                Date.now() - startedAt
            );

            if (
                runContext
            ) {

                await this.recordAuditSafe({

                    action:
                        'AIRTEL_RECONCILIATION_EXECUTION_FAILED',

                    tenantId:
                        runContext.tenantId,

                    correlationId:
                        runContext.correlationId,

                    executionId:
                        runContext.executionId,

                    mode:
                        runContext.mode,

                    error:
                        safeError(error)

                });

                await this.publishSafeEvent({

                    type:
                        'AIRTEL_RECONCILIATION_FAILED',

                    tenantId:
                        runContext.tenantId,

                    correlationId:
                        runContext.correlationId,

                    executionId:
                        runContext.executionId,

                    payload: {

                        tenantId:
                            runContext.tenantId,

                        mode:
                            runContext.mode,

                        error: {

                            name:
                                truncate(
                                    error?.name,
                                    128
                                ),

                            code:
                                truncate(
                                    error?.code,
                                    128
                                )

                        }

                    }

                });
            }

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel reconciliation service execution failed',

                tenantId:
                    runContext?.tenantId,

                correlationId:
                    runContext?.correlationId,

                executionId:
                    runContext?.executionId,

                mode:
                    runContext?.mode,

                error:
                    safeError(error)

            });

            throw normalizeError(
                error,
                {
                    metadata: {

                        operation:
                            'airtel_reconciliation_service'

                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    buildIdempotencyKey({

        tenantId,

        settlementDate,

        mode

    }) {

        const dateKey =
            settlementDate
                .toISOString()
                .slice(0, 10);

        return (
            `airtel-reconciliation:${tenantId}:${dateKey}:${mode}`
        );
    }

    async checkIdempotency(
        context
    ) {

        if (
            !this.idempotencyEngine
        ) {
            return null;
        }

        const key =
            this.scopedIdempotencyKey(
                context
            );

        if (
            typeof this.idempotencyEngine.check ===
            'function'
        ) {

            return this.idempotencyEngine.check(
                key
            );
        }

        if (
            typeof this.idempotencyEngine.get ===
            'function'
        ) {

            return this.idempotencyEngine.get(
                key
            );
        }

        return null;
    }

    async storeIdempotentResult(
        context,
        response
    ) {

        if (
            !this.idempotencyEngine
        ) {
            return false;
        }

        const key =
            this.scopedIdempotencyKey(
                context
            );

        if (
            typeof this.idempotencyEngine.store ===
            'function'
        ) {

            await this.idempotencyEngine.store(
                key,
                sanitizeValue(
                    response
                ),
                this.idempotencyTtlSeconds
            );

            return true;
        }

        if (
            typeof this.idempotencyEngine.set ===
            'function'
        ) {

            await this.idempotencyEngine.set(
                key,
                sanitizeValue(
                    response
                ),
                this.idempotencyTtlSeconds
            );

            return true;
        }

        return false;
    }

    scopedIdempotencyKey(
        context
    ) {

        const material =
            [
                context.tenantId,
                context.idempotencyKey,
                context.mode
            ].join(':');

        const digest =
            crypto
                .createHash('sha256')
                .update(material)
                .digest('hex');

        return (
            `airtel:reconciliation:service:${digest}`
        );
    }

    /**
     * =========================================================================
     * Exception Processing
     * =========================================================================
     */

    async processExceptions({

        tenantId,

        exceptions = [],

        correlationId,

        executionId = null,

        reconciliationId = null,

        session = null

    } = {}) {

        if (
            !exceptions.length
        ) {
            return {

                processed:
                    0,

                failed:
                    0

            };
        }

        this.statistics.exceptions +=
            exceptions.length;

        if (
            !this.exceptionRepository
        ) {

            /*
             * Exception persistence is an important operational boundary.
             * Do not silently discard reconciliation exceptions.
             */
            throw new Error(
                'Exception repository required when reconciliation produces exceptions'
            );
        }

        let processed = 0;
        let failed = 0;

        for (
            const exception of
            exceptions
        ) {

            try {

                const record = {

                    tenantId,

                    provider:
                        PROVIDER,

                    reconciliationId,

                    correlationId,

                    executionId,

                    exception:
                        this.safeException(
                            exception
                        ),

                    createdAt:
                        this.now()

                };

                if (
                    typeof this.exceptionRepository
                        .createForTenant ===
                    'function'
                ) {

                    await this.exceptionRepository
                        .createForTenant(
                            tenantId,
                            record,
                            {
                                session
                            }
                        );

                } else if (
                    typeof this.exceptionRepository
                        .create ===
                    'function'
                ) {

                    await this.exceptionRepository
                        .create(
                            record,
                            {
                                session
                            }
                        );

                } else {

                    throw new Error(
                        'Exception repository does not expose create()'
                    );
                }

                processed++;

            } catch (error) {

                failed++;

                this.logger?.error?.({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    message:
                        'Failed to persist Airtel reconciliation exception',

                    tenantId,

                    reconciliationId,

                    correlationId,

                    executionId,

                    error:
                        safeError(error)

                });

                /*
                 * Exception persistence is evidence retention. A failure to
                 * persist one must not cause the service to pretend the
                 * exception did not exist.
                 */
            }
        }

        if (
            failed === exceptions.length
        ) {

            throw new Error(
                'Failed to persist all Airtel reconciliation exceptions'
            );
        }

        await this.publishSafeEvent({

            type:
                'AIRTEL_RECONCILIATION_EXCEPTION_CREATED',

            tenantId,

            correlationId,

            executionId,

            payload: {

                tenantId,

                reconciliationId,

                count:
                    processed,

                persistenceFailures:
                    failed

            }

        });

        return {

            processed,

            failed

        };
    }

    safeException(
        exception
    ) {

        if (
            !exception ||
            typeof exception !== 'object'
        ) {

            return {

                status:
                    'UNKNOWN',

                reason:
                    truncate(
                        String(
                            exception
                        ),
                        1_000
                    )

            };
        }

        return sanitizeValue({

            exceptionId:
                exception.exceptionId ??
                exception.id,

            status:
                exception.status,

            type:
                exception.type,

            reference:
                exception.reference,

            side:
                exception.side,

            reason:
                exception.reason,

            providerAmount:
                exception.providerAmount,

            ledgerAmount:
                exception.ledgerAmount,

            amountDifferenceMinor:
                exception.amountDifferenceMinor,

            providerCurrency:
                exception.providerCurrency,

            ledgerCurrency:
                exception.ledgerCurrency,

            providerCount:
                exception.providerCount,

            ledgerCount:
                exception.ledgerCount,

            createdAt:
                exception.createdAt

        });
    }

    /**
     * =========================================================================
     * Explicit Repair Workflow
     * =========================================================================
     */

    async repair({

        tenantId,

        exceptionId,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        actorId = null,

        authorizationContext = {},

        session = null

    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedExceptionId =
            normalizeIdentifier(
                exceptionId,
                'exceptionId'
            );

        if (
            !this.repairEngine
        ) {

            const error =
                new Error(
                    'Reconciliation repair engine unavailable'
                );

            error.code =
                'AIRTEL_RECONCILIATION_REPAIR_UNAVAILABLE';

            throw error;
        }

        await this.authorizeRepair({

            tenantId:
                normalizedTenantId,

            exceptionId:
                normalizedExceptionId,

            correlationId,

            executionId,

            actorId,

            authorizationContext

        });

        const exception =
            await this.findException({

                tenantId:
                    normalizedTenantId,

                exceptionId:
                    normalizedExceptionId,

                session

            });

        /*
         * The service sends a safe exception projection to the repair engine.
         * It does not forward the complete stored document blindly.
         */
        const result =
            await this.repairEngine.execute({

                tenantId:
                    normalizedTenantId,

                provider:
                    PROVIDER,

                exceptionId:
                    normalizedExceptionId,

                exception:
                    this.safeException(
                        exception
                    ),

                correlationId,

                executionId,

                actorId,

                authorizationContext:
                    sanitizeValue(
                        authorizationContext
                    ),

                session

            });

        this.statistics.repairs++;

        await this.recordAuditSafe({

            action:
                'AIRTEL_RECONCILIATION_REPAIR_EXECUTED',

            tenantId:
                normalizedTenantId,

            exceptionId:
                normalizedExceptionId,

            correlationId,

            executionId,

            actorId

        });

        await this.publishSafeEvent({

            type:
                'AIRTEL_RECONCILIATION_REPAIR_EXECUTED',

            tenantId:
                normalizedTenantId,

            correlationId,

            executionId,

            payload: {

                tenantId:
                    normalizedTenantId,

                exceptionId:
                    normalizedExceptionId,

                status:
                    result?.status,

                success:
                    result?.success

            }

        });

        return result;
    }

    async authorizeRepair(
        context
    ) {

        if (
            !this.authorizationService ||
            typeof this.authorizationService.authorize !==
            'function'
        ) {
            return true;
        }

        const authorized =
            await this.authorizationService.authorize({

                action:
                    'AIRTEL_RECONCILIATION_REPAIR',

                ...context

            });

        if (
            authorized === false
        ) {

            const error =
                new Error(
                    'Airtel reconciliation repair is not authorized'
                );

            error.code =
                'AIRTEL_RECONCILIATION_REPAIR_NOT_AUTHORIZED';

            throw error;
        }

        return true;
    }

    async findException({

        tenantId,

        exceptionId,

        session = null

    }) {

        if (
            !this.exceptionRepository
        ) {
            return null;
        }

        if (
            typeof this.exceptionRepository
                .findByIdForTenant ===
            'function'
        ) {

            return this.exceptionRepository
                .findByIdForTenant(
                    tenantId,
                    exceptionId,
                    {
                        session
                    }
                );
        }

        if (
            typeof this.exceptionRepository
                .findOne ===
            'function'
        ) {

            return this.exceptionRepository.findOne(

                {
                    tenantId,
                    $or: [
                        {
                            exceptionId
                        },
                        {
                            id:
                                exceptionId
                        },
                        {
                            _id:
                                exceptionId
                        }
                    ]
                },

                {
                    session
                }

            );
        }

        if (
            typeof this.exceptionRepository
                .findById ===
            'function'
        ) {

            return this.exceptionRepository.findById(
                exceptionId,
                {
                    tenantId,
                    session
                }
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Manual Transaction Match
     * =========================================================================
     */

    async manualMatch({

        tenantId = null,

        providerTransaction,

        ledgerTransaction,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.reconciliationMatcher ||
            typeof this.reconciliationMatcher.match !==
            'function'
        ) {

            throw new Error(
                'Reconciliation matcher unavailable'
            );
        }

        if (
            tenantId !== null &&
            tenantId !== undefined
        ) {

            tenantId =
                requireTenantId(
                    tenantId
                );
        }

        const result =
            this.reconciliationMatcher.match({

                providerTransaction,

                ledgerTransaction,

                correlationId

            });

        this.statistics.manualMatches++;

        this.metrics?.counter?.(
            'payment_airtel_reconciliation_manual_match_total',
            1
        );

        return result;
    }

    /**
     * =========================================================================
     * Report Type Mapping
     * =========================================================================
     */

    resolveReportType(
        mode
    ) {

        switch (mode) {

            case RECONCILIATION_MODE.SCHEDULED:

                return 'DAILY';

            case RECONCILIATION_MODE.MANUAL:

                return 'SETTLEMENT';

            case RECONCILIATION_MODE.AUTOMATIC:

            default:

                return 'SETTLEMENT';

        }
    }

    /**
     * =========================================================================
     * Safe Reconciliation Projection
     * =========================================================================
     */

    safeReconciliationResult(
        result
    ) {

        if (
            !result ||
            typeof result !== 'object'
        ) {
            return null;
        }

        return sanitizeValue({

            reconciliationId:
                result.reconciliationId ??
                result.executionId,

            executionId:
                result.executionId,

            tenantId:
                result.tenantId,

            provider:
                PROVIDER,

            settlementDate:
                result.settlementDate,

            correlationId:
                result.correlationId,

            status:
                result.status,

            summary:
                result.summary,

            matchedRecords:
                result.matchedRecords,

            exceptions:
                normalizeArray(
                    result.exceptions
                )
                    .slice(
                        0,
                        MAX_EXCEPTION_RECORDS
                    )
                    .map(
                        exception =>
                            this.safeException(
                                exception
                            )
                    ),

            startedAt:
                result.startedAt,

            completedAt:
                result.completedAt,

            durationMs:
                result.durationMs

        });
    }

    safeReportProjection(
        report
    ) {

        if (
            !report ||
            typeof report !== 'object'
        ) {
            return null;
        }

        return sanitizeValue({

            reportId:
                report.reportId ??
                report.id,

            tenantId:
                report.tenantId,

            provider:
                PROVIDER,

            type:
                report.type,

            reconciliationId:
                report.reconciliationId,

            correlationId:
                report.correlationId,

            executionId:
                report.executionId,

            status:
                report.status,

            generatedAt:
                report.generatedAt,

            summary:
                report.summary

        });
    }

    safeActor(
        actor
    ) {

        if (
            actor === null ||
            actor === undefined
        ) {
            return null;
        }

        if (
            typeof actor !== 'object'
        ) {

            return truncate(
                actor,
                128
            );
        }

        return sanitizeValue({

            id:
                actor.id ??
                actor.userId ??
                actor.actorId,

            type:
                actor.type,

            role:
                actor.role

        });
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    recordOutcomeStatistics(
        reconciliation
    ) {

        const status =
            reconciliation?.status;

        switch (status) {

            case RECONCILIATION_RESULT_STATUS.MATCHED:

                this.statistics.successful++;

                break;

            case RECONCILIATION_RESULT_STATUS.PARTIAL:

                this.statistics.partial++;

                break;

            case RECONCILIATION_RESULT_STATUS.REVIEW:

                this.statistics.partial++;

                break;

            case RECONCILIATION_RESULT_STATUS.FAILED:

            default:

                /*
                 * The engine may use FAILED as a reconciliation result while
                 * the service execution itself succeeded operationally. That
                 * is represented as partial/review-like business outcome
                 * rather than incrementing service transport failure again.
                 */
                this.statistics.partial++;

                break;
        }
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAuditSafe(
        record
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        try {

            await this.auditService.record(
                sanitizeValue({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    occurredAt:
                        this.now(),

                    ...record

                })
            );

            return true;

        } catch (error) {

            this.statistics.auditFailures++;

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel reconciliation service audit',

                tenantId:
                    record?.tenantId,

                correlationId:
                    record?.correlationId,

                executionId:
                    record?.executionId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Safe Event Publication
     * =========================================================================
     */

    async publishSafeEvent({

        type,

        tenantId,

        correlationId,

        executionId = null,

        payload = {}

    }) {

        const event = {

            type,

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId,

            correlationId,

            executionId,

            payload:
                sanitizeValue(
                    payload
                )

        };

        try {

            if (
                this.outboxService &&
                typeof this.outboxService.publish ===
                'function'
            ) {

                await this.outboxService.publish(
                    event
                );

            } else if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {

                await this.eventPublisher.publish(
                    event
                );

            } else if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                'function'
            ) {

                await this.eventBus.publish(
                    event
                );

            } else {

                return false;
            }

            return true;

        } catch (error) {

            this.statistics.eventFailures++;

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to publish Airtel reconciliation service event',

                tenantId,

                correlationId,

                executionId,

                type,

                error:
                    safeError(error)

            });

            /*
             * Event publication is not allowed to rewrite a persisted
             * reconciliation outcome.
             */
            return false;
        }
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const dependencies = {

            reconciliationEngine:
                Boolean(
                    this.reconciliationEngine &&
                    typeof this.reconciliationEngine.reconcile ===
                    'function'
                ),

            reconciliationMatcher:
                Boolean(
                    this.reconciliationMatcher &&
                    typeof this.reconciliationMatcher.match ===
                    'function'
                ),

            reconciliationReporter:
                Boolean(
                    this.reconciliationReporter &&
                    typeof this.reconciliationReporter.generate ===
                    'function'
                ),

            exceptionRepository:
                Boolean(
                    this.exceptionRepository
                ),

            providerAdapter:
                Boolean(
                    this.providerAdapter
                ),

            ledgerEvidence:
                Boolean(
                    (
                        this.financialTransactionService &&
                        typeof this.financialTransactionService
                            .getSettlementTransactions ===
                        'function'
                    ) ||
                    (
                        this.ledgerBridge &&
                        typeof this.ledgerBridge
                            .getSettlementTransactions ===
                        'function'
                    )
                ),

            idempotency:
                Boolean(
                    this.idempotencyEngine &&
                    (
                        typeof this.idempotencyEngine.check ===
                            'function' ||
                        typeof this.idempotencyEngine.get ===
                            'function'
                    )
                )

        };

        const essentialDependenciesAvailable =
            dependencies.reconciliationEngine &&
            dependencies.exceptionRepository &&
            dependencies.providerAdapter &&
            dependencies.ledgerEvidence;

        let status =
            this.healthState.status;

        if (
            !essentialDependenciesAvailable
        ) {

            status =
                SERVICE_STATUS.FAILED;

        } else if (
            !dependencies.idempotency
        ) {

            status =
                SERVICE_STATUS.DEGRADED;

        } else if (
            status === SERVICE_STATUS.INITIALIZING
        ) {

            status =
                SERVICE_STATUS.DEGRADED;

        }

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status,

            initialized:
                this.initialized,

            dependencies,

            lastRun:
                this.healthState.lastRun,

            lastFailure:
                this.healthState.lastFailure,

            lastError:
                this.healthState.lastError,

            statistics:
                this.stats()

        };
    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            health:
                {
                    ...this.healthState
                },

            statistics:
                this.stats()

        };
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            initialized:
                this.initialized,

            idempotencyTtlSeconds:
                this.idempotencyTtlSeconds

        };
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        if (
            !this.tracer ||
            typeof this.tracer.startSpan !==
            'function'
        ) {
            return null;
        }

        try {

            const span =
                this.tracer.startSpan(
                    name
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'component',
                COMPONENT
            );

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    attributes
                )
            ) {

                if (
                    value !== null &&
                    value !== undefined
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch (error) {

            this.logger?.debug?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Unable to start Airtel reconciliation service trace',

                error:
                    safeError(error)

            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        return new this.clock();
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.reconciliationEngine
        ) {

            throw new Error(
                'reconciliationEngine dependency missing'
            );
        }

        if (
            typeof this.reconciliationEngine.reconcile !==
            'function'
        ) {

            throw new Error(
                'reconciliationEngine.reconcile operation missing'
            );
        }

        if (
            !this.transactionRepository &&
            !this.ledgerBridge &&
            !this.financialTransactionService
        ) {

            throw new Error(
                'Authoritative transaction evidence dependency missing'
            );
        }

        if (
            !this.providerAdapter
        ) {

            throw new Error(
                'providerAdapter dependency missing'
            );
        }

        /*
         * Reporter is useful but the core reconciliation service can still
         * operate without report generation. Its absence is therefore not a
         * hard construction failure.
         */
        if (
            !this.exceptionRepository
        ) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Exception repository is not configured; initialization will remain degraded'

            });
        }

        return true;
    }
}

module.exports = {

    ReconciliationService,

    SERVICE_STATUS,

    RECONCILIATION_MODE,

    RECONCILIATION_RESULT_STATUS,

    PROVIDER,

    COMPONENT,

    VERSION
};