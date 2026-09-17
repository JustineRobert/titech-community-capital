'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Settlement Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/settlement.js
 *
 * Architectural Role
 * ------------------
 * Canonical application-level settlement lifecycle boundary for Airtel Money.
 *
 * This service coordinates settlement registration, reconciliation, controlled
 * financial posting, settlement state changes, reporting evidence and
 * lifecycle observability.
 *
 * Responsibilities
 * ----------------
 * • Settlement registration.
 * • Settlement lookup/query.
 * • Settlement lifecycle orchestration.
 * • Provider settlement refresh delegation.
 * • Reconciliation delegation.
 * • Controlled financial settlement posting.
 * • Idempotency integration.
 * • Tenant-context enforcement.
 * • Audit integration.
 * • Transactional-outbox/event integration.
 * • Metrics and tracing.
 * • Health and capability reporting.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Airtel OAuth/token lifecycle.
 * • Direct provider HTTP implementation.
 * • Callback signature validation.
 * • Wallet balance mutation.
 * • Raw ledger-entry implementation.
 * • Provider-specific reconciliation algorithms.
 * • Arbitrary business-rule evaluation.
 * • Silent financial repair.
 *
 * Financial Safety Principles
 * ---------------------------
 * • Provider success evidence is not automatically financial settlement.
 * • Reconciliation must complete before settlement is marked SETTLED.
 * • Financial mutation is delegated to the canonical financial service or
 *   explicitly injected ledger boundary.
 * • Direct balance mutation is prohibited.
 * • Idempotency is evaluated before financial side effects.
 * • Tenant identity is mandatory for financial settlement operations.
 * • State transitions should use repository compare-and-set semantics where
 *   available to prevent concurrent settlement races.
 * • Settlement persistence and financial posting should share the same MongoDB
 *   session/transaction where infrastructure supports it.
 * • Audit/event failures must not manufacture financial success.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const SETTLEMENT_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RECONCILING: 'RECONCILING',
    READY_TO_SETTLE: 'READY_TO_SETTLE',
    SETTLING: 'SETTLING',
    SETTLED: 'SETTLED',
    VARIANCE: 'VARIANCE',
    REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
    REQUIRES_REVIEW: 'REQUIRES_REVIEW',
    FAILED: 'FAILED',
    REVERSED: 'REVERSED',
    CANCELLED: 'CANCELLED'
});

const TERMINAL_STATUSES = new Set([
    SETTLEMENT_STATUS.SETTLED,
    SETTLEMENT_STATUS.REVERSED,
    SETTLEMENT_STATUS.CANCELLED
]);

const NON_SETTLED_STATUSES = new Set([
    SETTLEMENT_STATUS.VARIANCE,
    SETTLEMENT_STATUS.REQUIRES_RECONCILIATION,
    SETTLEMENT_STATUS.REQUIRES_REVIEW,
    SETTLEMENT_STATUS.FAILED
]);


function isFunction(value) {
    return typeof value === 'function';
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function generateId() {
    return crypto.randomUUID();
}


function safeError(error) {
    if (!error) {
        return null;
    }

    if (
        isFunction(error.toJSON)
    ) {
        try {
            return error.toJSON();
        } catch (_) {
            // Fall through.
        }
    }

    return {
        name:
            error.name,
        code:
            error.code,
        message:
            error.message
    };
}


function safeReference(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(0, 256);
}


function safeAmount(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value).trim();
}


function sanitizeMetadata(value) {
    if (!isObject(value)) {
        return value;
    }

    const sensitiveKeys = new Set([
        'authorization',
        'cookie',
        'password',
        'secret',
        'clientSecret',
        'client_secret',
        'apiKey',
        'api_key',
        'accessToken',
        'refreshToken',
        'token',
        'signature',
        'credentials',
        'raw',
        'payload',
        'rawPayload'
    ]);

    const result = {};

    for (
        const [key, item]
        of Object.entries(value)
    ) {
        if (
            sensitiveKeys.has(
                String(key)
            )
        ) {
            continue;
        }

        if (
            isObject(item) &&
            !Array.isArray(item)
        ) {
            result[key] =
                sanitizeMetadata(item);
        } else {
            result[key] =
                item;
        }
    }

    return result;
}


class AirtelSettlementService {

    constructor({
        settlementRepository,

        settlementProvider,

        reconciliationService,

        financialTransactionService,
        ledgerBridge,

        idempotencyManager,

        tenantResolver,
        authorizationService,

        auditService,

        eventBus,
        eventPublisher,
        outboxService,

        reportGenerator,

        stateMachine,

        logger,
        metrics,
        tracer
    } = {}) {

        if (!settlementRepository) {
            throw new Error(
                'settlementRepository is required'
            );
        }

        this.settlementRepository =
            settlementRepository;

        this.settlementProvider =
            settlementProvider;

        this.reconciliationService =
            reconciliationService;

        this.financialTransactionService =
            financialTransactionService;

        this.ledgerBridge =
            ledgerBridge;

        this.idempotencyManager =
            idempotencyManager;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.eventPublisher =
            eventPublisher;

        this.outboxService =
            outboxService;

        this.reportGenerator =
            reportGenerator;

        this.stateMachine =
            stateMachine;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

        this.initialized =
            false;

        this.initializing =
            false;

        this.status =
            'CREATED';

        this.initializedAt =
            null;

        this.lastFailureAt =
            null;

        this.statistics = {
            initialized:
                0,

            registrations:
                0,

            registrationFailures:
                0,

            completions:
                0,

            completionFailures:
                0,

            failures:
                0,

            reconciliations:
                0,

            reconciliationFailures:
                0,

            refreshes:
                0,

            refreshFailures:
                0,

            variances:
                0,

            duplicateRequests:
                0
        };

        this.initializationPromise =
            null;
    }


    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */
    async initialize(options = {}) {
        if (
            this.initialized
        ) {
            return this.initializationResult();
        }

        if (
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId:
                    options.operationId ||
                    generateId()
            })
                .finally(() => {
                    this.initializationPromise =
                        null;
                });

        return this.initializationPromise;
    }


    async initializeInternal({
        tenantId,
        correlationId,
        operationId,
        context = {}
    } = {}) {
        this.initializing =
            true;

        this.status =
            'INITIALIZING';

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.initialize'
            );

        try {
            this.validateDependencies();

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            if (
                this.settlementProvider &&
                isFunction(
                    this.settlementProvider.initialize
                )
            ) {
                await this.settlementProvider.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            if (
                this.reconciliationService &&
                isFunction(
                    this.reconciliationService.initialize
                )
            ) {
                await this.reconciliationService.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            if (
                this.financialTransactionService &&
                isFunction(
                    this.financialTransactionService.initialize
                )
            ) {
                await this.financialTransactionService.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            this.initialized =
                true;

            this.initializing =
                false;

            this.status =
                'READY';

            this.initializedAt =
                new Date();

            this.statistics.initialized++;

            this.metrics?.increment?.(
                'payment_airtel_settlement_initialized_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_initialized_total'
            );

            await this.audit({
                action:
                    'AIRTEL_SETTLEMENT_SERVICE_INITIALIZED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            this.logger?.info?.({
                message:
                    'Airtel Money Settlement Service initialized',
                provider:
                    PROVIDER,
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            return this.initializationResult();
        } catch (error) {
            this.initializing =
                false;

            this.initialized =
                false;

            this.status =
                'FAILED';

            this.lastFailureAt =
                new Date();

            this.logger?.error?.({
                message:
                    'Airtel settlement service initialization failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Register Settlement
     * =========================================================================
     */
    async register({
        tenantId,
        reference,
        providerReference,
        amount,
        currency,
        metadata = {},
        idempotencyKey,
        actor,
        session,
        context = {},
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        this.statistics.registrations++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.register'
            );

        try {
            const resolvedTenantId =
                await this.requireTenant({
                    tenantId,
                    context
                });

            const normalizedReference =
                safeReference(reference);

            if (
                !normalizedReference
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_REFERENCE_REQUIRED',
                    'Settlement reference is required'
                );
            }

            if (
                amount === undefined ||
                amount === null
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_AMOUNT_REQUIRED',
                    'Settlement amount is required'
                );
            }

            if (
                !currency ||
                !/^[A-Za-z]{3}$/.test(
                    String(currency)
                )
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_CURRENCY_INVALID',
                    'Settlement currency must be a valid 3-letter currency code'
                );
            }

            await this.ensureAuthorized({
                tenantId:
                    resolvedTenantId,
                actor,
                action:
                    'REGISTER_AIRTEL_SETTLEMENT',
                context
            });

            const effectiveIdempotencyKey =
                this.resolveIdempotencyKey({
                    tenantId:
                        resolvedTenantId,
                    reference:
                        normalizedReference,
                    providerReference,
                    idempotencyKey
                });

            const duplicate =
                await this.getIdempotentResult({
                    tenantId:
                        resolvedTenantId,
                    key:
                        effectiveIdempotencyKey
                });

            if (
                duplicate
            ) {
                this.statistics.duplicateRequests++;

                return {
                    ...duplicate,
                    duplicate:
                        true,
                    provider:
                        PROVIDER,
                    correlationId,
                    operationId
                };
            }

            const now =
                new Date();

            const document = {
                tenantId:
                    resolvedTenantId,

                provider:
                    PROVIDER,

                reference:
                    normalizedReference,

                providerReference:
                    safeReference(
                        providerReference
                    ),

                amount:
                    safeAmount(amount),

                currency:
                    String(currency)
                        .trim()
                        .toUpperCase(),

                status:
                    SETTLEMENT_STATUS.PENDING,

                metadata:
                    sanitizeMetadata(
                        metadata
                    ),

                correlationId,

                operationId,

                createdAt:
                    now,

                updatedAt:
                    now
            };

            const settlement =
                await this.createSettlement(
                    document,
                    session
                );

            await this.audit({
                action:
                    'AIRTEL_SETTLEMENT_REGISTERED',
                tenantId:
                    resolvedTenantId,
                reference:
                    normalizedReference,
                correlationId,
                operationId,
                settlementId:
                    settlement?._id ||
                    settlement?.settlementId,
                metadata: {
                    amount:
                        safeAmount(
                            amount
                        ),
                    currency:
                        String(currency)
                            .trim()
                            .toUpperCase()
                }
            });

            await this.publishEvent({
                eventType:
                    'AIRTEL_SETTLEMENT_REGISTERED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId,
                session,
                payload: {
                    settlementId:
                        settlement?._id ||
                        settlement?.settlementId,
                    reference:
                        normalizedReference,
                    providerReference:
                        safeReference(
                            providerReference
                        ),
                    status:
                        SETTLEMENT_STATUS.PENDING
                }
            });

            await this.registerIdempotency({
                tenantId:
                    resolvedTenantId,
                key:
                    effectiveIdempotencyKey,
                response:
                    settlement,
                operationId
            });

            this.metrics?.increment?.(
                'payment_airtel_settlement_registered_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_registered_total'
            );

            return settlement;
        } catch (error) {
            this.statistics.registrationFailures++;

            this.logger?.error?.({
                message:
                    'Airtel settlement registration failed',
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(
                        reference
                    ),
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Complete Settlement
     * =========================================================================
     */
    async complete({
        settlementId,
        ledger = true,
        actor,
        session,
        context = {},
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.complete'
            );

        try {
            if (
                !settlementId
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_ID_REQUIRED',
                    'Settlement ID is required'
                );
            }

            const settlement =
                await this.findSettlementById({
                    settlementId,
                    session
                });

            if (
                !settlement
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_NOT_FOUND',
                    'Settlement not found'
                );
            }

            const tenantId =
                await this.requireTenant({
                    tenantId:
                        settlement.tenantId,
                    context
                });

            await this.ensureAuthorized({
                tenantId,
                actor,
                action:
                    'COMPLETE_AIRTEL_SETTLEMENT',
                context
            });

            /**
             * Terminal/idempotent convergence.
             */
            if (
                settlement.status ===
                SETTLEMENT_STATUS.SETTLED
            ) {
                return settlement;
            }

            if (
                settlement.status ===
                    SETTLEMENT_STATUS.VARIANCE ||
                settlement.status ===
                    SETTLEMENT_STATUS.REQUIRES_REVIEW ||
                settlement.status ===
                    SETTLEMENT_STATUS.REQUIRES_RECONCILIATION
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_NOT_SETTLEABLE',
                    'Settlement has unresolved reconciliation issues',
                    {
                        status:
                            settlement.status
                    }
                );
            }

            /**
             * -----------------------------------------------------------------
             * Reconciliation gate
             * -----------------------------------------------------------------
             */
            const reconciliation =
                await this.reconcile({
                    tenantId,
                    reference:
                        settlement.reference,
                    settlement,
                    actor,
                    session,
                    context,
                    correlationId,
                    operationId
                });

            if (
                reconciliation?.hasVariance ||
                reconciliation?.matched === false ||
                reconciliation?.status ===
                    SETTLEMENT_STATUS.VARIANCE ||
                reconciliation?.status ===
                    SETTLEMENT_STATUS.REQUIRES_REVIEW ||
                reconciliation?.status ===
                    SETTLEMENT_STATUS.REQUIRES_RECONCILIATION
            ) {
                this.statistics.variances++;

                await this.transitionStatus({
                    settlement,
                    nextStatus:
                        reconciliation?.status ===
                            SETTLEMENT_STATUS.REQUIRES_REVIEW
                            ? SETTLEMENT_STATUS.REQUIRES_REVIEW
                            : SETTLEMENT_STATUS.VARIANCE,
                    tenantId,
                    session,
                    correlationId,
                    operationId,
                    metadata: {
                        reconciliation
                    }
                });

                return {
                    ...settlement,
                    status:
                        reconciliation?.status ===
                            SETTLEMENT_STATUS.REQUIRES_REVIEW
                            ? SETTLEMENT_STATUS.REQUIRES_REVIEW
                            : SETTLEMENT_STATUS.VARIANCE,
                    reconciliation
                };
            }

            await this.transitionStatus({
                settlement,
                nextStatus:
                    SETTLEMENT_STATUS.SETTLING,
                tenantId,
                session,
                correlationId,
                operationId
            });

            /**
             * -----------------------------------------------------------------
             * Financial posting
             * -----------------------------------------------------------------
             */
            let financialResult = null;

            if (
                ledger
            ) {
                financialResult =
                    await this.postFinancialSettlement({
                        tenantId,
                        settlement,
                        reconciliation,
                        actor,
                        session,
                        correlationId,
                        operationId,
                        context
                    });
            }

            /**
             * Only after successful authoritative financial processing is the
             * settlement allowed to become SETTLED.
             */
            const updated =
                await this.transitionStatus({
                    settlement,
                    nextStatus:
                        SETTLEMENT_STATUS.SETTLED,
                    tenantId,
                    session,
                    correlationId,
                    operationId,
                    metadata: {
                        financialResultReference:
                            this.extractFinancialReference(
                                financialResult
                            )
                    },
                    extra: {
                        settledAt:
                            new Date(),

                        financialResultReference:
                            this.extractFinancialReference(
                                financialResult
                            )
                    }
                });

            this.statistics.completions++;

            this.metrics?.increment?.(
                'payment_airtel_settlement_completed_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_completed_total'
            );

            await this.audit({
                action:
                    'AIRTEL_SETTLEMENT_COMPLETED',
                tenantId,
                reference:
                    settlement.reference,
                correlationId,
                operationId,
                settlementId:
                    settlement._id ||
                    settlement.settlementId,
                metadata: {
                    status:
                        SETTLEMENT_STATUS.SETTLED,
                    financialResultReference:
                        this.extractFinancialReference(
                            financialResult
                        )
                }
            });

            await this.publishEvent({
                eventType:
                    'AIRTEL_SETTLEMENT_COMPLETED',
                tenantId,
                correlationId,
                operationId,
                session,
                payload: {
                    settlementId:
                        settlement._id ||
                        settlement.settlementId,
                    reference:
                        settlement.reference,
                    status:
                        SETTLEMENT_STATUS.SETTLED,
                    financialResultReference:
                        this.extractFinancialReference(
                            financialResult
                        )
                }
            });

            const report =
                await this.generateReport({
                    tenantId,
                    settlement:
                        updated,
                    reconciliation,
                    financialResult,
                    correlationId,
                    operationId,
                    context
                });

            return {
                ...updated,
                financialResult,
                reconciliation,
                report,
                correlationId,
                operationId
            };
        } catch (error) {
            this.statistics.completionFailures++;

            this.logger?.error?.({
                message:
                    'Airtel settlement completion failed',
                provider:
                    PROVIDER,
                settlementId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Authoritative Financial Settlement Boundary
     * =========================================================================
     */
    async postFinancialSettlement({
        tenantId,
        settlement,
        reconciliation,
        actor,
        session,
        correlationId,
        operationId,
        context
    }) {
        const payload = {
            provider:
                PROVIDER,

            tenantId,

            settlement,

            reconciliation,

            actor,

            correlationId,

            operationId,

            session,

            context
        };

        if (
            this.financialTransactionService &&
            isFunction(
                this.financialTransactionService.settleProviderSettlement
            )
        ) {
            return this.financialTransactionService
                .settleProviderSettlement(
                    payload
                );
        }

        if (
            this.financialTransactionService &&
            isFunction(
                this.financialTransactionService.settle
            )
        ) {
            return this.financialTransactionService
                .settle(
                    payload
                );
        }

        /**
         * Compatibility boundary.
         *
         * The bridge itself must remain responsible for delegating to the
         * canonical ledger/financial transaction architecture. This facade
         * does not mutate balances.
         */
        if (
            this.ledgerBridge &&
            isFunction(
                this.ledgerBridge.postSettlement
            )
        ) {
            this.logger?.warn?.({
                message:
                    'Using compatibility Airtel settlement ledgerBridge',
                provider:
                    PROVIDER,
                tenantId,
                settlementId:
                    settlement?._id ||
                    settlement?.settlementId,
                correlationId,
                operationId
            });

            return this.ledgerBridge.postSettlement({
                provider:
                    PROVIDER,
                tenantId,
                settlement,
                reconciliation,
                actor,
                session,
                correlationId,
                operationId,
                context
            });
        }

        throw this.createError(
            'AIRTEL_FINANCIAL_SETTLEMENT_BOUNDARY_UNAVAILABLE',
            'No canonical financial settlement boundary is configured'
        );
    }


    /**
     * =========================================================================
     * Fail Settlement
     * =========================================================================
     */
    async fail({
        settlementId,
        reason,
        actor,
        session,
        context = {},
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        if (
            !settlementId
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_ID_REQUIRED',
                'Settlement ID is required'
            );
        }

        if (
            !reason ||
            String(reason).trim() === ''
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_FAILURE_REASON_REQUIRED',
                'Settlement failure reason is required'
            );
        }

        const settlement =
            await this.findSettlementById({
                settlementId,
                session
            });

        if (
            !settlement
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_NOT_FOUND',
                'Settlement not found'
            );
        }

        const tenantId =
            await this.requireTenant({
                tenantId:
                    settlement.tenantId,
                context
            });

        await this.ensureAuthorized({
            tenantId,
            actor,
            action:
                'FAIL_AIRTEL_SETTLEMENT',
            context
        });

        if (
            settlement.status ===
            SETTLEMENT_STATUS.SETTLED
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_ALREADY_SETTLED',
                'A settled settlement cannot be failed'
            );
        }

        const updated =
            await this.transitionStatus({
                settlement,
                nextStatus:
                    SETTLEMENT_STATUS.FAILED,
                tenantId,
                session,
                correlationId,
                operationId,
                metadata: {
                    failureReason:
                        String(reason)
                            .trim()
                            .slice(0, 1000)
                },
                extra: {
                    failureReason:
                        String(reason)
                            .trim()
                            .slice(0, 1000),

                    failedAt:
                        new Date()
                }
            });

        this.statistics.failures++;

        this.metrics?.increment?.(
            'payment_airtel_settlement_failed_total'
        );

        this.metrics?.counter?.(
            'payment_airtel_settlement_failed_total'
        );

        await this.audit({
            action:
                'AIRTEL_SETTLEMENT_FAILED',
            tenantId,
            reference:
                settlement.reference,
            correlationId,
            operationId,
            settlementId:
                settlement._id ||
                settlement.settlementId,
            metadata: {
                reason:
                    String(reason)
                        .trim()
                        .slice(0, 1000)
            }
        });

        await this.publishEvent({
            eventType:
                'AIRTEL_SETTLEMENT_FAILED',
            tenantId,
            correlationId,
            operationId,
            session,
            payload: {
                settlementId:
                    settlement._id ||
                    settlement.settlementId,
                reference:
                    settlement.reference,
                status:
                    SETTLEMENT_STATUS.FAILED
            }
        });

        return updated;
    }


    /**
     * =========================================================================
     * Reconcile Settlement
     * =========================================================================
     */
    async reconcile({
        reference,
        tenantId,
        settlement,
        actor,
        session,
        context = {},
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        if (
            !this.reconciliationService
        ) {
            throw this.createError(
                'AIRTEL_RECONCILIATION_SERVICE_UNAVAILABLE',
                'reconciliationService not configured'
            );
        }

        const normalizedReference =
            safeReference(reference);

        if (
            !normalizedReference
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_REFERENCE_REQUIRED',
                'Settlement reference is required for reconciliation'
            );
        }

        const resolvedTenantId =
            await this.requireTenant({
                tenantId:
                    tenantId ||
                    settlement?.tenantId,
                context
            });

        await this.ensureAuthorized({
            tenantId:
                resolvedTenantId,
            actor,
            action:
                'RECONCILE_AIRTEL_SETTLEMENT',
            context
        });

        this.statistics.reconciliations++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.reconcile'
            );

        try {
            const result =
                await this.invokeReconciliation({
                    reference:
                        normalizedReference,
                    tenantId:
                        resolvedTenantId,
                    settlement,
                    session,
                    context,
                    correlationId,
                    operationId
                });

            if (
                result?.hasVariance ||
                result?.matched === false ||
                result?.status ===
                    SETTLEMENT_STATUS.VARIANCE ||
                result?.status ===
                    SETTLEMENT_STATUS.REQUIRES_REVIEW ||
                result?.status ===
                    SETTLEMENT_STATUS.REQUIRES_RECONCILIATION
            ) {
                this.statistics.variances++;

                await this.audit({
                    action:
                        'AIRTEL_SETTLEMENT_RECONCILIATION_VARIANCE',
                    tenantId:
                        resolvedTenantId,
                    reference:
                        normalizedReference,
                    correlationId,
                    operationId,
                    settlementId:
                        settlement?._id ||
                        settlement?.settlementId,
                    metadata: {
                        status:
                            result?.status,
                        variance:
                            result?.variance,
                        varianceCount:
                            result?.varianceCount
                    }
                });
            }

            return result;
        } catch (error) {
            this.statistics.reconciliationFailures++;

            this.logger?.error?.({
                message:
                    'Airtel settlement reconciliation failed',
                provider:
                    PROVIDER,
                tenantId:
                    resolvedTenantId,
                reference:
                    normalizedReference,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    async invokeReconciliation({
        reference,
        tenantId,
        settlement,
        session,
        context,
        correlationId,
        operationId
    }) {
        const payload = {
            provider:
                PROVIDER,

            tenantId,

            reference,

            settlement,

            session,

            context,

            correlationId,

            operationId
        };

        if (
            isFunction(
                this.reconciliationService.reconcileSettlement
            )
        ) {
            return this.reconciliationService
                .reconcileSettlement(
                    payload
                );
        }

        if (
            isFunction(
                this.reconciliationService.reconcile
            )
        ) {
            return this.reconciliationService
                .reconcile(
                    payload
                );
        }

        throw this.createError(
            'AIRTEL_RECONCILIATION_CONTRACT_INVALID',
            'Configured reconciliation service has no supported reconcile method'
        );
    }


    /**
     * =========================================================================
     * Query Settlement
     * =========================================================================
     */
    async query(
        reference,
        {
            tenantId,
            actor,
            session,
            context = {},
            correlationId =
                generateId(),
            operationId =
                generateId()
        } = {}
    ) {
        const normalizedReference =
            safeReference(reference);

        if (
            !normalizedReference
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_REFERENCE_REQUIRED',
                'Settlement reference is required'
            );
        }

        const resolvedTenantId =
            await this.requireTenant({
                tenantId,
                context
            });

        await this.ensureAuthorized({
            tenantId:
                resolvedTenantId,
            actor,
            action:
                'QUERY_AIRTEL_SETTLEMENT',
            context
        });

        if (
            isFunction(
                this.settlementRepository.findOne
            )
        ) {
            return this.settlementRepository.findOne({
                tenantId:
                    resolvedTenantId,

                provider:
                    PROVIDER,

                reference:
                    normalizedReference,

                session,

                correlationId,

                operationId
            });
        }

        if (
            isFunction(
                this.settlementRepository.find
            )
        ) {
            const result =
                await this.settlementRepository.find({
                    tenantId:
                        resolvedTenantId,

                    provider:
                        PROVIDER,

                    reference:
                        normalizedReference,

                    session,

                    correlationId,

                    operationId
                });

            return Array.isArray(result)
                ? result[0] || null
                : result;
        }

        throw this.createError(
            'AIRTEL_SETTLEMENT_QUERY_UNAVAILABLE',
            'Settlement repository does not support lookup'
        );
    }


    /**
     * =========================================================================
     * Provider Settlement Refresh
     * =========================================================================
     */
    async refresh(
        reference,
        {
            tenantId,
            actor,
            context = {},
            correlationId =
                generateId(),
            operationId =
                generateId()
        } = {}
    ) {
        if (
            !this.settlementProvider
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_PROVIDER_UNAVAILABLE',
                'settlementProvider not configured'
            );
        }

        if (
            !isFunction(
                this.settlementProvider.querySettlement
            ) &&
            !isFunction(
                this.settlementProvider.query
            )
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_PROVIDER_CONTRACT_INVALID',
                'Settlement provider does not expose a query method'
            );
        }

        const normalizedReference =
            safeReference(reference);

        if (
            !normalizedReference
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_REFERENCE_REQUIRED',
                'Settlement reference is required'
            );
        }

        const resolvedTenantId =
            await this.requireTenant({
                tenantId,
                context
            });

        await this.ensureAuthorized({
            tenantId:
                resolvedTenantId,
            actor,
            action:
                'REFRESH_AIRTEL_SETTLEMENT',
            context
        });

        this.statistics.refreshes++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.refresh'
            );

        try {
            const payload = {
                provider:
                    PROVIDER,

                tenantId:
                    resolvedTenantId,

                reference:
                    normalizedReference,

                correlationId,

                operationId,

                context
            };

            if (
                isFunction(
                    this.settlementProvider.querySettlement
                )
            ) {
                return this.settlementProvider
                    .querySettlement(
                        payload
                    );
            }

            return this.settlementProvider.query(
                payload
            );
        } catch (error) {
            this.statistics.refreshFailures++;

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Settlement Persistence Helpers
     * =========================================================================
     */
    async createSettlement(
        document,
        session
    ) {
        if (
            isFunction(
                this.settlementRepository.createSettlement
            )
        ) {
            return this.settlementRepository.createSettlement({
                ...document,
                session
            });
        }

        if (
            isFunction(
                this.settlementRepository.create
            )
        ) {
            return this.settlementRepository.create({
                ...document,
                session
            });
        }

        if (
            isFunction(
                this.settlementRepository.insert
            )
        ) {
            return this.settlementRepository.insert({
                ...document,
                session
            });
        }

        throw this.createError(
            'AIRTEL_SETTLEMENT_CREATE_UNAVAILABLE',
            'Settlement repository does not support creation'
        );
    }


    async findSettlementById({
        settlementId,
        session
    }) {
        if (
            isFunction(
                this.settlementRepository.findById
            )
        ) {
            return this.settlementRepository.findById(
                settlementId,
                {
                    session
                }
            );
        }

        if (
            isFunction(
                this.settlementRepository.findOne
            )
        ) {
            return this.settlementRepository.findOne({
                _id:
                    settlementId,
                session
            });
        }

        throw this.createError(
            'AIRTEL_SETTLEMENT_LOOKUP_UNAVAILABLE',
            'Settlement repository does not support ID lookup'
        );
    }


    async transitionStatus({
        settlement,
        nextStatus,
        tenantId,
        session,
        correlationId,
        operationId,
        metadata = {},
        extra = {}
    }) {
        const settlementId =
            settlement?._id ||
            settlement?.settlementId;

        if (
            !settlementId
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_ID_REQUIRED',
                'Settlement identifier is required for state transition'
            );
        }

        const currentStatus =
            settlement.status ||
            SETTLEMENT_STATUS.PENDING;

        if (
            currentStatus ===
            nextStatus
        ) {
            return settlement;
        }

        if (
            TERMINAL_STATUSES.has(
                currentStatus
            )
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_TERMINAL_STATE',
                `Settlement is already terminal: ${currentStatus}`
            );
        }

        if (
            currentStatus ===
                SETTLEMENT_STATUS.SETTLED &&
            nextStatus !==
                SETTLEMENT_STATUS.SETTLED
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_ALREADY_SETTLED',
                'A settled settlement cannot transition backwards'
            );
        }

        if (
            this.stateMachine &&
            isFunction(
                this.stateMachine.canTransition
            ) &&
            !this.stateMachine.canTransition(
                currentStatus,
                nextStatus
            )
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_INVALID_TRANSITION',
                `Invalid settlement transition ${currentStatus} -> ${nextStatus}`
            );
        }

        const update = {
            status:
                nextStatus,

            updatedAt:
                new Date(),

            correlationId,

            operationId,

            ...extra
        };

        /**
         * Preferred atomic compare-and-set repository contract.
         */
        if (
            isFunction(
                this.settlementRepository.transitionStatus
            )
        ) {
            return this.settlementRepository.transitionStatus({
                tenantId,

                settlementId,

                expectedStatus:
                    currentStatus,

                nextStatus,

                update,

                metadata,

                session,

                correlationId,

                operationId
            });
        }

        if (
            isFunction(
                this.settlementRepository.compareAndSetStatus
            )
        ) {
            return this.settlementRepository.compareAndSetStatus({
                tenantId,

                settlementId,

                expectedStatus:
                    currentStatus,

                nextStatus,

                update,

                metadata,

                session,

                correlationId,

                operationId
            });
        }

        /**
         * Legacy repository compatibility.
         *
         * This is less concurrency-safe than compare-and-set and should be
         * replaced by an atomic repository contract in production.
         */
        if (
            isFunction(
                this.settlementRepository.update
            )
        ) {
            this.logger?.warn?.({
                message:
                    'Using non-atomic Airtel settlement status update compatibility path',
                provider:
                    PROVIDER,
                settlementId,
                tenantId,
                currentStatus,
                nextStatus,
                correlationId,
                operationId
            });

            return this.settlementRepository.update(
                settlementId,
                {
                    ...update,
                    tenantId,
                    expectedStatus:
                        currentStatus,
                    metadata,
                    session
                }
            );
        }

        throw this.createError(
            'AIRTEL_SETTLEMENT_TRANSITION_UNAVAILABLE',
            'Settlement repository does not support state transitions'
        );
    }


    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */
    resolveIdempotencyKey({
        tenantId,
        reference,
        providerReference,
        idempotencyKey
    }) {
        if (
            idempotencyKey &&
            String(idempotencyKey).trim()
        ) {
            return String(
                idempotencyKey
            ).trim();
        }

        const basis =
            providerReference ||
            reference;

        if (
            !basis
        ) {
            return undefined;
        }

        return crypto
            .createHash('sha256')
            .update(
                [
                    PROVIDER,
                    tenantId,
                    String(basis)
                ].join(':')
            )
            .digest('hex');
    }


    async getIdempotentResult({
        tenantId,
        key
    }) {
        if (
            !key ||
            !this.idempotencyManager
        ) {
            return null;
        }

        if (
            isFunction(
                this.idempotencyManager.get
            )
        ) {
            return this.idempotencyManager.get({
                tenantId,
                key
            });
        }

        if (
            isFunction(
                this.idempotencyManager.find
            )
        ) {
            return this.idempotencyManager.find({
                tenantId,
                key
            });
        }

        return null;
    }


    async registerIdempotency({
        tenantId,
        key,
        response,
        operationId
    }) {
        if (
            !key ||
            !this.idempotencyManager
        ) {
            return;
        }

        const payload = {
            tenantId,
            key,
            response,
            operationId
        };

        if (
            isFunction(
                this.idempotencyManager.register
            )
        ) {
            await this.idempotencyManager.register(
                payload
            );

            return;
        }

        if (
            isFunction(
                this.idempotencyManager.set
            )
        ) {
            await this.idempotencyManager.set(
                payload
            );
        }
    }


    /**
     * =========================================================================
     * Tenant / Authorization
     * =========================================================================
     */
    async requireTenant({
        tenantId,
        context = {}
    }) {
        const resolved =
            await this.resolveTenant({
                tenantId,
                context
            });

        if (
            !resolved
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_TENANT_REQUIRED',
                'Tenant context is required for Airtel settlement operations'
            );
        }

        return resolved;
    }


    async resolveTenant({
        tenantId,
        context = {}
    }) {
        if (
            tenantId !== undefined &&
            tenantId !== null &&
            String(tenantId).trim() !== ''
        ) {
            return String(
                tenantId
            );
        }

        if (
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            const resolved =
                await this.tenantResolver.resolve(
                    context
                );

            if (
                resolved !== undefined &&
                resolved !== null &&
                String(resolved).trim() !== ''
            ) {
                return String(
                    resolved
                );
            }
        }

        return null;
    }


    async ensureAuthorized({
        tenantId,
        actor,
        action,
        context
    }) {
        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            isFunction(
                this.authorizationService.assertAuthorized
            )
        ) {
            await this.authorizationService.assertAuthorized({
                tenantId,
                actor,
                action,
                context
            });

            return true;
        }

        if (
            isFunction(
                this.authorizationService.authorize
            )
        ) {
            const allowed =
                await this.authorizationService.authorize({
                    tenantId,
                    actor,
                    action,
                    context
                });

            if (
                allowed === false
            ) {
                throw this.createError(
                    'AIRTEL_SETTLEMENT_UNAUTHORIZED',
                    'Airtel settlement operation is not authorized'
                );
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async audit({
        action,
        tenantId,
        reference,
        correlationId,
        operationId,
        settlementId,
        metadata = {}
    } = {}) {
        if (
            !this.auditService ||
            !isFunction(
                this.auditService.record
            )
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(
                        reference
                    ),
                settlementId,
                correlationId,
                operationId,
                metadata:
                    sanitizeMetadata(
                        metadata
                    )
            });
        } catch (error) {
            this.logger?.error?.({
                message:
                    'Airtel settlement audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(
                        reference
                    ),
                correlationId,
                operationId,
                error:
                    safeError(error)
            });
        }
    }


    /**
     * =========================================================================
     * Event / Outbox
     * =========================================================================
     */
    async publishEvent({
        eventType,
        tenantId,
        correlationId,
        operationId,
        session,
        payload = {}
    } = {}) {
        const eventPayload = {
            provider:
                PROVIDER,

            tenantId,

            correlationId,

            operationId,

            ...sanitizeMetadata(
                payload
            )
        };

        if (
            this.outboxService
        ) {
            if (
                isFunction(
                    this.outboxService.enqueue
                )
            ) {
                await this.outboxService.enqueue({
                    tenantId,
                    aggregateType:
                        'AIRTEL_SETTLEMENT',
                    aggregateId:
                        payload.settlementId ||
                        operationId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId}:${payload.settlementId || operationId}`,
                    session
                });

                return;
            }

            if (
                isFunction(
                    this.outboxService.publish
                )
            ) {
                await this.outboxService.publish({
                    tenantId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId}:${payload.settlementId || operationId}`,
                    session
                });

                return;
            }
        }

        const publisher =
            this.eventBus ||
            this.eventPublisher;

        if (
            publisher &&
            isFunction(
                publisher.publish
            )
        ) {
            await publisher.publish({
                type:
                    eventType,

                payload:
                    eventPayload,

                correlationId,

                operationId
            });
        }
    }


    /**
     * =========================================================================
     * Reporting
     * =========================================================================
     */
    async generateReport({
        tenantId,
        settlement,
        reconciliation,
        financialResult,
        correlationId,
        operationId,
        context
    } = {}) {
        if (
            !this.reportGenerator ||
            !isFunction(
                this.reportGenerator.generate
            )
        ) {
            return null;
        }

        return this.reportGenerator.generate({
            tenantId,
            provider:
                PROVIDER,
            settlement,
            reconciliation,
            financialResult,
            correlationId,
            operationId,
            context
        });
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {
        const repositoryHealth =
            await this.safeHealth(
                this.settlementRepository
            );

        const providerHealth =
            await this.safeHealth(
                this.settlementProvider
            );

        const reconciliationHealth =
            await this.safeHealth(
                this.reconciliationService
            );

        const financialHealth =
            await this.safeHealth(
                this.financialTransactionService ||
                this.ledgerBridge
            );

        const repositoryStatus =
            repositoryHealth.status;

        const providerStatus =
            providerHealth.status;

        const reconciliationStatus =
            reconciliationHealth.status;

        const financialStatus =
            financialHealth.status;

        const hasDown =
            [
                repositoryStatus,
                providerStatus,
                reconciliationStatus,
                financialStatus
            ].includes(
                'DOWN'
            );

        const missingFinancialBoundary =
            !this.financialTransactionService &&
            !this.ledgerBridge;

        const overallStatus =
            hasDown
                ? 'DOWN'
                : missingFinancialBoundary
                    ? 'DEGRADED'
                    : !this.initialized
                        ? 'DEGRADED'
                        : 'UP';

        return {
            provider:
                PROVIDER,

            module:
                'settlement',

            status:
                overallStatus,

            initialized:
                this.initialized,

            lifecycle:
                this.status,

            startedAt:
                this.startedAt,

            initializedAt:
                this.initializedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {
                repository:
                    Boolean(
                        this.settlementRepository
                    ),

                provider:
                    Boolean(
                        this.settlementProvider
                    ),

                reconciliation:
                    Boolean(
                        this.reconciliationService
                    ),

                financialTransactionService:
                    Boolean(
                        this.financialTransactionService
                    ),

                ledgerBridge:
                    Boolean(
                        this.ledgerBridge
                    ),

                idempotency:
                    Boolean(
                        this.idempotencyManager
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                authorization:
                    Boolean(
                        this.authorizationService
                    ),

                audit:
                    Boolean(
                        this.auditService
                    ),

                events:
                    Boolean(
                        this.eventBus ||
                        this.eventPublisher
                    ),

                outbox:
                    Boolean(
                        this.outboxService
                    ),

                reporting:
                    Boolean(
                        this.reportGenerator
                    )
            },

            health: {
                repository:
                    repositoryHealth,

                provider:
                    providerHealth,

                reconciliation:
                    reconciliationHealth,

                financial:
                    financialHealth
            },

            financialBoundary:
                this.financialTransactionService
                    ? 'CANONICAL_FINANCIAL_TRANSACTION_SERVICE'
                    : this.ledgerBridge
                        ? 'COMPATIBILITY_LEDGER_BRIDGE'
                        : 'UNAVAILABLE',

            statistics: {
                ...this.statistics
            },

            lastFailureAt:
                this.lastFailureAt
        };
    }


    async safeHealth(
        dependency
    ) {
        if (
            !dependency
        ) {
            return {
                status:
                    'NOT_CONFIGURED'
            };
        }

        try {
            if (
                isFunction(
                    dependency.health
                )
            ) {
                return sanitizeMetadata(
                    await dependency.health()
                );
            }

            return {
                status:
                    'AVAILABLE'
            };
        } catch (error) {
            return {
                status:
                    'DOWN',
                error:
                    safeError(error)
            };
        }
    }


    /**
     * =========================================================================
     * Capabilities
     * =========================================================================
     */
    capabilities() {
        return Object.freeze({
            provider:
                PROVIDER,

            settlement:
                true,

            reconciliation:
                Boolean(
                    this.reconciliationService
                ),

            providerRefresh:
                Boolean(
                    this.settlementProvider
                ),

            ledgerIntegration:
                Boolean(
                    this.financialTransactionService ||
                    this.ledgerBridge
                ),

            canonicalFinancialService:
                Boolean(
                    this.financialTransactionService
                ),

            compatibilityLedgerBridge:
                Boolean(
                    this.ledgerBridge
                ),

            eventPublishing:
                Boolean(
                    this.eventBus ||
                    this.eventPublisher ||
                    this.outboxService
                ),

            transactionalOutbox:
                Boolean(
                    this.outboxService
                ),

            auditLogging:
                Boolean(
                    this.auditService
                ),

            tenantIsolation:
                Boolean(
                    this.tenantResolver
                ),

            authorization:
                Boolean(
                    this.authorizationService
                ),

            idempotency:
                Boolean(
                    this.idempotencyManager
                ),

            reporting:
                Boolean(
                    this.reportGenerator
                ),

            tracing:
                Boolean(
                    this.tracer
                ),

            metrics:
                Boolean(
                    this.metrics
                ),

            directBalanceMutation:
                false,

            directLedgerMutation:
                false,

            providerHttpInService:
                false
        });
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'settlement',

            status:
                this.status,

            initialized:
                this.initialized,

            architecture: {
                providerHttpInService:
                    false,

                repository:
                    Boolean(
                        this.settlementRepository
                    ),

                settlementProvider:
                    Boolean(
                        this.settlementProvider
                    ),

                reconciliationService:
                    Boolean(
                        this.reconciliationService
                    ),

                financialTransactionService:
                    Boolean(
                        this.financialTransactionService
                    ),

                ledgerBridge:
                    Boolean(
                        this.ledgerBridge
                    ),

                idempotency:
                    Boolean(
                        this.idempotencyManager
                    ),

                authorization:
                    Boolean(
                        this.authorizationService
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                outbox:
                    Boolean(
                        this.outboxService
                    ),

                audit:
                    Boolean(
                        this.auditService
                    )
            },

            states:
                Object.values(
                    SETTLEMENT_STATUS
                ),

            terminalStates:
                [...TERMINAL_STATUSES],

            nonSettledReviewStates:
                [...NON_SETTLED_STATUSES],

            statistics: {
                ...this.statistics
            },

            timestamps: {
                startedAt:
                    this.startedAt,

                initializedAt:
                    this.initializedAt,

                lastFailureAt:
                    this.lastFailureAt
            },

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()
        };
    }


    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */
    validateDependencies() {
        if (
            !this.settlementRepository
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_REPOSITORY_REQUIRED',
                'settlementRepository is required'
            );
        }

        if (
            !isFunction(
                this.settlementRepository.create
            ) &&
            !isFunction(
                this.settlementRepository.createSettlement
            ) &&
            !isFunction(
                this.settlementRepository.insert
            )
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_REPOSITORY_INVALID',
                'Settlement repository does not expose a create contract'
            );
        }

        if (
            this.reconciliationService &&
            !isFunction(
                this.reconciliationService.reconcile
            ) &&
            !isFunction(
                this.reconciliationService.reconcileSettlement
            )
        ) {
            throw this.createError(
                'AIRTEL_RECONCILIATION_SERVICE_INVALID',
                'Reconciliation service has no supported reconciliation contract'
            );
        }

        if (
            this.settlementProvider &&
            !isFunction(
                this.settlementProvider.query
            ) &&
            !isFunction(
                this.settlementProvider.querySettlement
            )
        ) {
            throw this.createError(
                'AIRTEL_SETTLEMENT_PROVIDER_INVALID',
                'Settlement provider has no supported query contract'
            );
        }

        if (
            !this.financialTransactionService &&
            !this.ledgerBridge
        ) {
            this.logger?.warn?.({
                message:
                    'Airtel settlement has no financial posting boundary configured',
                provider:
                    PROVIDER
            });
        }

        return true;
    }


    /**
     * =========================================================================
     * Utility
     * =========================================================================
     */
    extractFinancialReference(
        result
    ) {
        if (!result) {
            return null;
        }

        return (
            result.financialTransactionId ||
            result.transactionId ||
            result.ledgerReference ||
            result.reference ||
            result.id ||
            null
        );
    }


    createError(
        code,
        message,
        details = {}
    ) {
        const error =
            new Error(
                message
            );

        error.code =
            code;

        error.provider =
            PROVIDER;

        Object.assign(
            error,
            details
        );

        return error;
    }


    initializationResult() {
        return {
            provider:
                PROVIDER,

            module:
                'settlement',

            initialized:
                this.initialized,

            status:
                this.status,

            initializedAt:
                this.initializedAt
        };
    }
}


module.exports =
    AirtelSettlementService;

module.exports.AirtelSettlementService =
    AirtelSettlementService;

module.exports.PROVIDER =
    PROVIDER;

module.exports.SETTLEMENT_STATUS =
    SETTLEMENT_STATUS;