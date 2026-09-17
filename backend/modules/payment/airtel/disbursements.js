'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursements Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements.js
 *
 * Architectural Role
 * ------------------
 * Public orchestration facade for Airtel Money outbound payment operations.
 *
 * Supported business flows may include:
 *   • Loan disbursements
 *   • Savings withdrawals
 *   • Supplier/vendor payments
 *   • Refunds
 *   • Approved outbound transfers
 *   • Bulk payout orchestration
 *
 * This module coordinates the business-operation boundary but does not
 * implement provider transport or financial posting logic itself.
 *
 * Responsibilities
 * ----------------
 * • Disbursement request orchestration.
 * • Tenant-context propagation.
 * • Authorization integration.
 * • Idempotency propagation/enforcement.
 * • Beneficiary/risk/approval boundary integration.
 * • Provider execution delegation.
 * • Callback processing delegation.
 * • Settlement tracking delegation.
 * • Audit integration.
 * • Outbox/event integration.
 * • Metrics and tracing.
 * • Runtime capability discovery.
 * • Dependency health reporting.
 *
 * Does NOT:
 * ----------
 * • Perform Airtel HTTP calls directly.
 * • Manage OAuth credentials/tokens.
 * • Modify wallet balances directly.
 * • Write ledger entries directly.
 * • Implement disbursement business rules duplicated from the canonical
 *   disbursement service.
 * • Treat provider acceptance as financial settlement.
 * • Bypass approval, risk, fraud or idempotency controls.
 *
 * Financial Safety Principles
 * ---------------------------
 * • A provider acknowledgement is not automatically a completed financial
 *   transaction.
 * • The canonical disbursement service owns provider execution semantics.
 * • Final financial posting remains delegated to the canonical financial
 *   transaction / ledger boundary.
 * • Idempotency must be established before an external financial side effect.
 * • Tenant identity must be preserved for every financial operation.
 * • Monetary values are not converted through JavaScript floating-point
 *   arithmetic in this facade.
 * • Audit/event failures must not invent or falsify financial outcomes.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const MODULE_STATUS = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const DISBURSEMENT_STATUS = Object.freeze({
    CREATED: 'CREATED',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    APPROVED: 'APPROVED',
    PROCESSING: 'PROCESSING',
    ACCEPTED: 'ACCEPTED',
    PENDING_CALLBACK: 'PENDING_CALLBACK',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    REVERSED: 'REVERSED',
    UNKNOWN: 'UNKNOWN'
});


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

    /**
     * Never use Number() for financial values in this facade.
     */
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
        'beneficiaryAccount',
        'accountNumber',
        'bankAccount',
        'rawPayload',
        'payload'
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
            result[key] = item;
        }
    }

    return result;
}


class AirtelDisbursements {

    constructor({
        disbursementService,

        callbackProcessor,

        settlementTracker,

        configuration,

        tenantResolver,
        authorizationService,
        idempotencyManager,

        beneficiaryService,
        approvalService,
        fraudGuard,
        riskService,

        auditService,

        outboxService,
        eventPublisher,

        logger,
        metrics,
        tracer
    } = {}) {

        if (!disbursementService) {
            throw new Error(
                'disbursementService is required'
            );
        }

        this.disbursementService =
            disbursementService;

        this.callbackProcessor =
            callbackProcessor;

        this.settlementTracker =
            settlementTracker;

        this.configuration =
            configuration;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.idempotencyManager =
            idempotencyManager;

        this.beneficiaryService =
            beneficiaryService;

        this.approvalService =
            approvalService;

        this.fraudGuard =
            fraudGuard;

        this.riskService =
            riskService;

        this.auditService =
            auditService;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

        this.state = {
            status:
                MODULE_STATUS.CREATED,

            initialized:
                false,

            initializing:
                false,

            initializedAt:
                null,

            lastFailureAt:
                null
        };

        this.statistics = {
            initialized:
                0,

            disbursementAttempts:
                0,

            disbursementSuccesses:
                0,

            disbursementFailures:
                0,

            duplicateRequests:
                0,

            approvalRejects:
                0,

            riskRejects:
                0,

            callbackAttempts:
                0,

            callbackSuccesses:
                0,

            callbackFailures:
                0,

            settlementLookups:
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
            this.state.initialized
        ) {
            return this.initializationResult();
        }

        if (
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        const operationId =
            options.operationId ||
            generateId();

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId
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
        this.state.status =
            MODULE_STATUS.INITIALIZING;

        this.state.initializing =
            true;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.disbursements.initialize'
            );

        try {
            this.validateDependencies();

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            if (
                isFunction(
                    this.disbursementService.initialize
                )
            ) {
                await this.disbursementService.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            this.state.initialized =
                true;

            this.state.initializing =
                false;

            this.state.status =
                MODULE_STATUS.READY;

            this.state.initializedAt =
                new Date();

            this.statistics.initialized++;

            this.metrics?.increment?.(
                'payment_airtel_disbursement_initialize_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_disbursement_initialize_total'
            );

            await this.audit({
                action:
                    'AIRTEL_DISBURSEMENTS_INITIALIZED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            this.logger?.info?.({
                message:
                    'Airtel Money Disbursement module initialized',
                provider:
                    PROVIDER,
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            return this.initializationResult();
        } catch (error) {
            this.state.initialized =
                false;

            this.state.initializing =
                false;

            this.state.status =
                MODULE_STATUS.FAILED;

            this.state.lastFailureAt =
                new Date();

            this.metrics?.increment?.(
                'payment_airtel_disbursement_initialize_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_disbursement_initialize_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel Money Disbursement module initialization failed',
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
     * Initiate Disbursement
     * =========================================================================
     */
    async disburse(request = {}) {
        this.statistics.disbursementAttempts++;

        const correlationId =
            request.correlationId ||
            request.context?.correlationId ||
            generateId();

        const operationId =
            request.operationId ||
            request.context?.operationId ||
            generateId();

        const started =
            Date.now();

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.disbursement.initiate'
            );

        try {
            const context =
                isObject(request.context)
                    ? request.context
                    : {};

            const tenantId =
                await this.resolveTenant({
                    tenantId:
                        request.tenantId,
                    context
                });

            await this.ensureInitialized({
                tenantId,
                correlationId,
                operationId,
                context
            });

            this.validateRequest({
                ...request,
                tenantId
            });

            await this.assertAuthorized({
                tenantId,
                actor:
                    request.actor,
                action:
                    'CREATE_AIRTEL_DISBURSEMENT',
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            await this.validateBeneficiary({
                tenantId,
                request,
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            await this.runApprovalChecks({
                tenantId,
                request,
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            await this.runRiskChecks({
                tenantId,
                request,
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            const idempotencyKey =
                this.resolveIdempotencyKey({
                    request,
                    tenantId
                });

            const duplicate =
                await this.checkIdempotency({
                    tenantId,
                    key:
                        idempotencyKey,
                    correlationId,
                    operationId,
                    context
                });

            if (
                duplicate
            ) {
                this.statistics.duplicateRequests++;

                this.metrics?.increment?.(
                    'payment_airtel_disbursement_duplicate_total'
                );

                return {
                    ...duplicate,
                    provider:
                        PROVIDER,
                    tenantId,
                    duplicate:
                        true,
                    correlationId,
                    operationId
                };
            }

            this.logger?.info?.({
                message:
                    'Initiating Airtel Money disbursement',
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(
                        request.reference ||
                        request.externalId
                    ),
                amount:
                    safeAmount(
                        request.amount
                    ),
                currency:
                    request.currency,
                type:
                    request.type,
                correlationId,
                operationId
            });

            const result =
                await this.invokeDisbursementService({
                    request,
                    tenantId,
                    correlationId,
                    operationId,
                    idempotencyKey,
                    context
                });

            const responseStatus =
                this.normalizeStatus(
                    result?.status
                );

            await this.audit({
                action:
                    'AIRTEL_DISBURSEMENT_CREATED',
                tenantId,
                reference:
                    result?.reference ||
                    result?.externalId ||
                    request.reference,
                correlationId,
                operationId,
                metadata: {
                    status:
                        responseStatus,
                    amount:
                        safeAmount(
                            result?.amount ??
                            request.amount
                        ),
                    currency:
                        result?.currency ??
                        request.currency,
                    type:
                        result?.type ??
                        request.type,
                    idempotencyKey,
                    durationMs:
                        Date.now() - started
                }
            });

            await this.publishEvent({
                eventType:
                    'AIRTEL_DISBURSEMENT_CREATED',
                tenantId,
                correlationId,
                operationId,
                context,
                payload: {
                    status:
                        responseStatus,
                    reference:
                        result?.reference ||
                        result?.externalId ||
                        request.reference,
                    externalId:
                        result?.externalId,
                    type:
                        result?.type ||
                        request.type
                }
            });

            await this.registerIdempotency({
                tenantId,
                key:
                    idempotencyKey,
                response:
                    result,
                operationId,
                context
            });

            this.statistics.disbursementSuccesses++;

            this.metrics?.increment?.(
                'payment_airtel_disbursement_success_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_disbursement_success_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_disbursement_duration_ms',
                Date.now() - started
            );

            /**
             * Provider ACCEPTED/PENDING must remain distinguishable from
             * financial settlement. Do not rewrite service status to SUCCESS.
             */
            return {
                ...result,

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } catch (error) {
            this.statistics.disbursementFailures++;

            this.metrics?.increment?.(
                'payment_airtel_disbursement_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_disbursement_failure_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_disbursement_duration_ms',
                Date.now() - started
            );

            this.logger?.error?.({
                message:
                    'Airtel Money disbursement failed',
                provider:
                    PROVIDER,
                tenantId:
                    request.tenantId,
                reference:
                    safeReference(
                        request.reference ||
                        request.externalId
                    ),
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            await this.audit({
                action:
                    'AIRTEL_DISBURSEMENT_FAILED',
                tenantId:
                    request.tenantId,
                reference:
                    request.reference ||
                    request.externalId,
                correlationId,
                operationId,
                metadata: {
                    error:
                        safeError(error)
                }
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Canonical Disbursement Service Invocation
     * =========================================================================
     *
     * Compatibility is maintained for repositories where the service currently
     * exposes initiate(), create(), or execute(). The preferred contract is
     * initiate().
     */
    async invokeDisbursementService({
        request,
        tenantId,
        correlationId,
        operationId,
        idempotencyKey,
        context
    }) {
        const payload = {
            ...request,

            tenantId,

            correlationId,

            operationId,

            idempotencyKey,

            context: {
                ...context,
                provider:
                    PROVIDER
            }
        };

        if (
            isFunction(
                this.disbursementService.initiate
            )
        ) {
            return this.disbursementService.initiate(
                payload
            );
        }

        if (
            isFunction(
                this.disbursementService.create
            )
        ) {
            return this.disbursementService.create(
                payload
            );
        }

        if (
            isFunction(
                this.disbursementService.execute
            )
        ) {
            return this.disbursementService.execute(
                payload
            );
        }

        throw new Error(
            'Disbursement service does not expose an initiation contract'
        );
    }


    /**
     * =========================================================================
     * Query Disbursement
     * =========================================================================
     */
    async query(
        reference,
        options = {}
    ) {
        const normalizedReference =
            safeReference(
                reference
            );

        if (
            !normalizedReference
        ) {
            const error =
                new Error(
                    'disbursement reference is required'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_REFERENCE_REQUIRED';

            throw error;
        }

        const correlationId =
            options.correlationId ||
            options.context?.correlationId ||
            generateId();

        const operationId =
            options.operationId ||
            options.context?.operationId ||
            generateId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        await this.ensureInitialized({
            tenantId,
            correlationId,
            operationId,
            context
        });

        await this.assertAuthorized({
            tenantId,
            actor:
                options.actor,
            action:
                'QUERY_AIRTEL_DISBURSEMENT',
            context
        });

        if (
            !isFunction(
                this.disbursementService.query
            )
        ) {
            const error =
                new Error(
                    'Disbursement query not implemented'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_QUERY_UNAVAILABLE';

            throw error;
        }

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.disbursement.query'
            );

        try {
            return {
                ...await this.disbursementService.query({
                    ...options,
                    reference:
                        normalizedReference,
                    tenantId,
                    correlationId,
                    operationId,
                    context: {
                        ...context,
                        provider:
                            PROVIDER
                    }
                }),

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Callback Processing
     * =========================================================================
     */
    async processCallback(
        callback = {}
    ) {
        this.statistics.callbackAttempts++;

        if (
            !this.callbackProcessor
        ) {
            this.statistics.callbackFailures++;

            const error =
                new Error(
                    'callbackProcessor not configured'
                );

            error.code =
                'AIRTEL_CALLBACK_PROCESSOR_UNAVAILABLE';

            throw error;
        }

        if (
            !isFunction(
                this.callbackProcessor.process
            )
        ) {
            this.statistics.callbackFailures++;

            const error =
                new Error(
                    'callbackProcessor.process is not implemented'
                );

            error.code =
                'AIRTEL_CALLBACK_PROCESSOR_INVALID';

            throw error;
        }

        const correlationId =
            callback.correlationId ||
            callback.context?.correlationId ||
            generateId();

        const operationId =
            callback.operationId ||
            callback.context?.operationId ||
            generateId();

        const context =
            isObject(callback.context)
                ? callback.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    callback.tenantId,
                context
            });

        await this.ensureInitialized({
            tenantId,
            correlationId,
            operationId,
            context
        });

        try {
            const result =
                await this.callbackProcessor.process({
                    ...callback,

                    tenantId,

                    correlationId,

                    operationId,

                    context: {
                        ...context,
                        provider:
                            PROVIDER
                    }
                });

            this.statistics.callbackSuccesses++;

            this.metrics?.increment?.(
                'payment_airtel_disbursement_callback_delegated_total'
            );

            return {
                ...result,

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } catch (error) {
            this.statistics.callbackFailures++;
            throw error;
        }
    }


    /**
     * =========================================================================
     * Settlement Lookup
     * =========================================================================
     */
    async settlement(
        reference,
        options = {}
    ) {
        this.statistics.settlementLookups++;

        const normalizedReference =
            safeReference(
                reference
            );

        if (
            !normalizedReference
        ) {
            const error =
                new Error(
                    'disbursement settlement reference is required'
                );

            error.code =
                'AIRTEL_SETTLEMENT_REFERENCE_REQUIRED';

            throw error;
        }

        if (
            !this.settlementTracker ||
            !isFunction(
                this.settlementTracker.reconcile
            )
        ) {
            return null;
        }

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        const correlationId =
            options.correlationId ||
            context.correlationId ||
            generateId();

        const operationId =
            options.operationId ||
            context.operationId ||
            generateId();

        await this.assertAuthorized({
            tenantId,
            actor:
                options.actor,
            action:
                'RECONCILE_AIRTEL_DISBURSEMENT',
            context
        });

        return this.settlementTracker.reconcile({
            reference:
                normalizedReference,

            tenantId,

            provider:
                PROVIDER,

            correlationId,

            operationId,

            ...options,

            context
        });
    }


    /**
     * =========================================================================
     * Beneficiary Validation
     * =========================================================================
     */
    async validateBeneficiary({
        tenantId,
        request,
        context
    }) {
        if (
            !this.beneficiaryService
        ) {
            return true;
        }

        if (
            isFunction(
                this.beneficiaryService.validate
            )
        ) {
            const result =
                await this.beneficiaryService.validate({
                    tenantId,
                    beneficiary:
                        request.beneficiary,
                    request,
                    context
                });

            if (
                result === false ||
                result?.valid === false
            ) {
                const error =
                    new Error(
                        'Airtel disbursement beneficiary validation failed'
                    );

                error.code =
                    'AIRTEL_BENEFICIARY_VALIDATION_FAILED';

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Approval Checks
     * =========================================================================
     */
    async runApprovalChecks({
        tenantId,
        request,
        context
    }) {
        if (
            !this.approvalService
        ) {
            return true;
        }

        const input = {
            tenantId,
            request,
            actor:
                request.actor,
            context
        };

        let result = true;

        if (
            isFunction(
                this.approvalService.assertApproved
            )
        ) {
            result =
                await this.approvalService.assertApproved(
                    input
                );
        } else if (
            isFunction(
                this.approvalService.check
            )
        ) {
            result =
                await this.approvalService.check(
                    input
                );
        } else if (
            isFunction(
                this.approvalService.approve
            )
        ) {
            result =
                await this.approvalService.approve(
                    input
                );
        }

        if (
            result === false ||
            result?.approved === false
        ) {
            this.statistics.approvalRejects++;

            const error =
                new Error(
                    'Airtel disbursement approval requirement not satisfied'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_APPROVAL_REQUIRED';

            throw error;
        }

        return true;
    }


    /**
     * =========================================================================
     * Fraud / Risk Checks
     * =========================================================================
     */
    async runRiskChecks({
        tenantId,
        request,
        context
    }) {
        const services = [
            this.fraudGuard,
            this.riskService
        ].filter(Boolean);

        for (
            const service
            of services
        ) {
            const input = {
                tenantId,
                request,
                actor:
                    request.actor,
                context
            };

            let result = true;

            if (
                isFunction(
                    service.assertAllowed
                )
            ) {
                result =
                    await service.assertAllowed(
                        input
                    );
            } else if (
                isFunction(
                    service.check
                )
            ) {
                result =
                    await service.check(
                        input
                    );
            } else if (
                isFunction(
                    service.evaluate
                )
            ) {
                result =
                    await service.evaluate(
                        input
                    );
            }

            if (
                result === false ||
                result?.allowed === false ||
                result?.approved === false
            ) {
                this.statistics.riskRejects++;

                const error =
                    new Error(
                        'Airtel disbursement risk controls rejected the operation'
                    );

                error.code =
                    'AIRTEL_DISBURSEMENT_RISK_REJECTED';

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Tenant Context
     * =========================================================================
     */
    async resolveTenant({
        tenantId,
        context = {}
    } = {}) {
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


    /**
     * =========================================================================
     * Authorization
     * =========================================================================
     */
    async assertAuthorized({
        tenantId,
        actor,
        action,
        context
    } = {}) {
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
            const authorized =
                await this.authorizationService.authorize({
                    tenantId,
                    actor,
                    action,
                    context
                });

            if (
                authorized === false
            ) {
                const error =
                    new Error(
                        'Airtel disbursement operation is not authorized'
                    );

                error.code =
                    'AIRTEL_DISBURSEMENT_UNAUTHORIZED';

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */
    resolveIdempotencyKey({
        request,
        tenantId
    }) {
        const supplied =
            request.idempotencyKey ||
            request.headers?.['idempotency-key'] ||
            request.headers?.['Idempotency-Key'];

        if (
            supplied &&
            String(supplied).trim()
        ) {
            return String(
                supplied
            ).trim();
        }

        const reference =
            request.reference ||
            request.externalId;

        if (
            !reference
        ) {
            return undefined;
        }

        return crypto
            .createHash('sha256')
            .update(
                [
                    PROVIDER,
                    tenantId,
                    String(reference)
                ].join(':')
            )
            .digest('hex');
    }


    async checkIdempotency({
        tenantId,
        key,
        correlationId,
        operationId,
        context
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
                key,
                correlationId,
                operationId,
                context
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
        operationId,
        context
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
            operationId,
            context
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
     * Request Validation
     * =========================================================================
     */
    validateRequest(
        request = {}
    ) {
        if (
            !request.tenantId
        ) {
            const error =
                new Error(
                    'tenantId is required for Airtel disbursements'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_TENANT_REQUIRED';

            throw error;
        }

        if (
            request.amount === undefined ||
            request.amount === null ||
            String(request.amount).trim() === ''
        ) {
            const error =
                new Error(
                    'disbursement amount is required'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_AMOUNT_REQUIRED';

            throw error;
        }

        if (
            !/^\d+(?:\.\d+)?$/.test(
                String(
                    request.amount
                ).trim()
            )
        ) {
            const error =
                new Error(
                    'disbursement amount has an invalid monetary format'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_AMOUNT_INVALID';

            throw error;
        }

        if (
            !request.currency ||
            !/^[A-Za-z]{3}$/.test(
                String(
                    request.currency
                ).trim()
            )
        ) {
            const error =
                new Error(
                    'disbursement currency must be a valid 3-letter currency code'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_CURRENCY_INVALID';

            throw error;
        }

        return true;
    }


    /**
     * =========================================================================
     * Initialization Guard
     * =========================================================================
     */
    async ensureInitialized(
        options = {}
    ) {
        if (
            this.state.initialized
        ) {
            return true;
        }

        await this.initialize(
            options
        );

        return true;
    }


    initializationResult() {
        return {
            provider:
                PROVIDER,

            module:
                'disbursements',

            initialized:
                this.state.initialized,

            status:
                this.state.status,

            initializedAt:
                this.state.initializedAt
        };
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
                correlationId,
                operationId,
                metadata:
                    sanitizeMetadata(
                        metadata
                    )
            });
        } catch (error) {
            /**
             * Audit failure is observable but must not corrupt the operation's
             * financial result.
             */
            this.logger?.error?.({
                message:
                    'Airtel disbursement audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                action,
                error:
                    safeError(error)
            });
        }
    }


    /**
     * =========================================================================
     * Outbox / Event Publishing
     * =========================================================================
     */
    async publishEvent({
        eventType,
        tenantId,
        correlationId,
        operationId,
        payload = {},
        context = {}
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
                        'AIRTEL_DISBURSEMENT',
                    aggregateId:
                        payload.reference ||
                        payload.externalId ||
                        operationId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId || 'unknown'}:${payload.reference || payload.externalId || operationId}`,
                    context
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
                        `${eventType}:${tenantId || 'unknown'}:${payload.reference || payload.externalId || operationId}`,
                    context
                });

                return;
            }
        }

        if (
            this.eventPublisher &&
            isFunction(
                this.eventPublisher.publish
            )
        ) {
            await this.eventPublisher.publish({
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
     * Status / Health
     * =========================================================================
     */
    normalizeStatus(
        status
    ) {
        if (
            status === undefined ||
            status === null
        ) {
            return undefined;
        }

        const normalized =
            String(status)
                .trim()
                .toUpperCase();

        if (
            Object.values(
                DISBURSEMENT_STATUS
            ).includes(normalized)
        ) {
            return normalized;
        }

        return normalized.slice(
            0,
            64
        );
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
     * Provider Health
     * =========================================================================
     */
    async health() {
        const providerHealth =
            await this.safeHealth(
                this.disbursementService
            );

        const callbackHealth =
            await this.safeHealth(
                this.callbackProcessor
            );

        const settlementHealth =
            await this.safeHealth(
                this.settlementTracker
            );

        const configurationHealth =
            await this.safeHealth(
                this.configuration
            );

        const hasDown =
            [
                providerHealth,
                callbackHealth,
                settlementHealth,
                configurationHealth
            ].some(
                item =>
                    item?.status === 'DOWN'
            );

        const status =
            hasDown
                ? 'DOWN'
                : !this.state.initialized
                    ? 'DEGRADED'
                    : (
                        providerHealth?.status ===
                        'DEGRADED'
                            ? 'DEGRADED'
                            : 'UP'
                    );

        return {
            provider:
                PROVIDER,

            module:
                'disbursements',

            status,

            initialized:
                this.state.initialized,

            state:
                this.state.status,

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {
                disbursementService:
                    Boolean(
                        this.disbursementService
                    ),

                callbackProcessor:
                    Boolean(
                        this.callbackProcessor
                    ),

                settlementTracker:
                    Boolean(
                        this.settlementTracker
                    ),

                configuration:
                    Boolean(
                        this.configuration
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                authorizationService:
                    Boolean(
                        this.authorizationService
                    ),

                idempotencyManager:
                    Boolean(
                        this.idempotencyManager
                    ),

                beneficiaryService:
                    Boolean(
                        this.beneficiaryService
                    ),

                approvalService:
                    Boolean(
                        this.approvalService
                    ),

                fraudGuard:
                    Boolean(
                        this.fraudGuard
                    ),

                riskService:
                    Boolean(
                        this.riskService
                    ),

                auditService:
                    Boolean(
                        this.auditService
                    ),

                outboxService:
                    Boolean(
                        this.outboxService
                    )
            },

            providerHealth,

            callbackHealth,

            settlementHealth,

            configurationHealth,

            statistics: {
                ...this.statistics
            }
        };
    }


    /**
     * =========================================================================
     * Runtime Capabilities
     * =========================================================================
     */
    capabilities() {
        return Object.freeze({
            provider:
                PROVIDER,

            supportsDisbursements:
                true,

            supportsCallbacks:
                Boolean(
                    this.callbackProcessor
                ),

            supportsSettlementTracking:
                Boolean(
                    this.settlementTracker
                ),

            supportsStatusQueries:
                isFunction(
                    this.disbursementService.query
                ),

            supportsHealthChecks:
                true,

            supportsTracing:
                Boolean(
                    this.tracer
                ),

            supportsMetrics:
                Boolean(
                    this.metrics
                ),

            supportsAudit:
                Boolean(
                    this.auditService
                ),

            supportsAuthorization:
                Boolean(
                    this.authorizationService
                ),

            supportsIdempotency:
                Boolean(
                    this.idempotencyManager
                ),

            supportsBeneficiaryValidation:
                Boolean(
                    this.beneficiaryService
                ),

            supportsApprovalWorkflow:
                Boolean(
                    this.approvalService
                ),

            supportsFraudScreening:
                Boolean(
                    this.fraudGuard
                ),

            supportsRiskScreening:
                Boolean(
                    this.riskService
                ),

            supportsTransactionalOutbox:
                Boolean(
                    this.outboxService
                ),

            providerHttpInFacade:
                false,

            directLedgerMutation:
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
                'disbursements',

            status:
                this.state.status,

            initialized:
                this.state.initialized,

            architecture: {
                providerHttpInFacade:
                    false,

                disbursementService:
                    Boolean(
                        this.disbursementService
                    ),

                callbackProcessor:
                    Boolean(
                        this.callbackProcessor
                    ),

                settlementTracker:
                    Boolean(
                        this.settlementTracker
                    ),

                tenantResolution:
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

                beneficiaryValidation:
                    Boolean(
                        this.beneficiaryService
                    ),

                approvalWorkflow:
                    Boolean(
                        this.approvalService
                    ),

                fraudScreening:
                    Boolean(
                        this.fraudGuard
                    ),

                riskScreening:
                    Boolean(
                        this.riskService
                    ),

                audit:
                    Boolean(
                        this.auditService
                    ),

                outbox:
                    Boolean(
                        this.outboxService
                    )
            },

            statistics: {
                ...this.statistics
            },

            timestamps: {
                startedAt:
                    this.startedAt,

                initializedAt:
                    this.state.initializedAt,

                lastFailureAt:
                    this.state.lastFailureAt
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
            !this.disbursementService
        ) {
            throw new Error(
                'disbursementService is required'
            );
        }

        const initiationAvailable =
            isFunction(
                this.disbursementService.initiate
            ) ||
            isFunction(
                this.disbursementService.create
            ) ||
            isFunction(
                this.disbursementService.execute
            );

        if (
            !initiationAvailable
        ) {
            const error =
                new Error(
                    'Disbursement service does not expose initiate/create/execute'
                );

            error.code =
                'AIRTEL_DISBURSEMENT_SERVICE_CONTRACT_INVALID';

            throw error;
        }

        if (
            this.callbackProcessor &&
            !isFunction(
                this.callbackProcessor.process
            )
        ) {
            const error =
                new Error(
                    'callbackProcessor.process is not available'
                );

            error.code =
                'AIRTEL_CALLBACK_PROCESSOR_CONTRACT_INVALID';

            throw error;
        }

        if (
            this.configuration &&
            isFunction(
                this.configuration.validate
            )
        ) {
            this.configuration.validate();
        }

        return true;
    }
}


module.exports =
    AirtelDisbursements;

module.exports.AirtelDisbursements =
    AirtelDisbursements;

module.exports.PROVIDER =
    PROVIDER;

module.exports.MODULE_STATUS =
    MODULE_STATUS;

module.exports.DISBURSEMENT_STATUS =
    DISBURSEMENT_STATUS;