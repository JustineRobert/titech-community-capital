'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Settlement Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/mtn/settlement.js
 *
 * Architectural Role
 * ------------------
 * Provider-specific MTN settlement orchestration boundary.
 *
 * This module coordinates:
 *   1. Retrieval of settlement evidence from MTN.
 *   2. Validation and normalization of provider evidence.
 *   3. Retrieval of authoritative internal settlement evidence.
 *   4. Deterministic reconciliation / variance detection.
 *   5. Controlled financial settlement through the canonical financial
 *      transaction / ledger boundary.
 *   6. Settlement state persistence.
 *   7. Reporting, audit and transactional-outbox/event publication.
 *
 * Important Boundaries
 * --------------------
 * This module does NOT:
 *   • Initiate customer payments.
 *   • Own MTN OAuth/token lifecycle.
 *   • Directly mutate wallet balances.
 *   • Directly create arbitrary ledger entries.
 *   • Bypass tenant isolation.
 *   • Treat provider acknowledgement as financial settlement.
 *   • Hide reconciliation differences.
 *   • Silently repair financial data.
 *   • Invent provider API contracts.
 *
 * Financial Safety Principles
 * ---------------------------
 *   • Provider evidence is not authoritative ledger truth by itself.
 *   • Settlement is posted only after reconciliation is complete and
 *     no unresolved financial variance remains.
 *   • Monetary comparisons avoid JavaScript floating-point arithmetic.
 *   • Tenant identity is mandatory for every operation.
 *   • Idempotency is enforced before financial side effects.
 *   • Authoritative financial mutation is delegated to the canonical
 *     financial transaction / ledger service.
 *   • Settlement persistence and financial posting should share the same
 *     MongoDB transaction/session where the underlying infrastructure
 *     supports it.
 *   • Audit/event failures must never be converted into false financial
 *     success.
 *   • Provider-specific endpoint details remain configuration-authoritative.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError,
    SettlementError
} = require('../shared/errors');


const PROVIDER = 'MTN';

const SETTLEMENT_TYPES = Object.freeze({
    COLLECTION: 'COLLECTION',
    DISBURSEMENT: 'DISBURSEMENT',
    ALL: 'ALL'
});

const SETTLEMENT_STATUS = Object.freeze({
    STARTED: 'STARTED',
    FETCHING: 'FETCHING',
    RECONCILING: 'RECONCILING',
    VARIANCE_DETECTED: 'VARIANCE_DETECTED',
    READY_TO_POST: 'READY_TO_POST',
    SETTLED: 'SETTLED',
    REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
    REQUIRES_REVIEW: 'REQUIRES_REVIEW',
    FAILED: 'FAILED'
});

const PROVIDER_STATUS = Object.freeze({
    SUCCESS: 'SUCCESS',
    SETTLED: 'SETTLED',
    COMPLETED: 'COMPLETED',
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    FAILED: 'FAILED',
    REVERSED: 'REVERSED',
    UNKNOWN: 'UNKNOWN'
});


/**
 * Convert a decimal monetary representation into integer minor units.
 *
 * Examples:
 *   "100"     -> 100
 *   "100.00"  -> 100
 *   "100.50"  -> 10050 when scale = 2
 *
 * The function intentionally rejects scientific notation and malformed values
 * so provider data cannot accidentally pass reconciliation through coercion.
 */
function toMinorUnits(value, scale = 2) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    const normalized = String(value).trim();

    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
        return null;
    }

    const negative = normalized.startsWith('-');
    const unsigned = negative
        ? normalized.slice(1)
        : normalized;

    const [whole, fraction = ''] =
        unsigned.split('.');

    const paddedFraction =
        fraction
            .padEnd(scale, '0')
            .slice(0, scale);

    if (
        fraction.length > scale &&
        !/^0+$/.test(fraction.slice(scale))
    ) {
        return null;
    }

    const units =
        BigInt(whole) * (10n ** BigInt(scale))
        +
        BigInt(paddedFraction || '0');

    return negative ? -units : units;
}


function sameAmount(
    left,
    right,
    scale = 2
) {
    const leftMinor =
        toMinorUnits(left, scale);

    const rightMinor =
        toMinorUnits(right, scale);

    if (
        leftMinor === null ||
        rightMinor === null
    ) {
        return false;
    }

    return leftMinor === rightMinor;
}


function normalizeCurrency(value, fallback = 'UGX') {
    return String(
        value || fallback
    )
        .trim()
        .toUpperCase();
}


function safeDate(value) {
    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function pickResponseBody(response) {
    if (!response) {
        return {};
    }

    return (
        response.body ??
        response.data ??
        response.result ??
        response
    );
}


function normalizeProviderStatus(value) {
    const normalized =
        String(value || '')
            .trim()
            .toUpperCase();

    if (
        [
            PROVIDER_STATUS.SUCCESS,
            PROVIDER_STATUS.SETTLED,
            PROVIDER_STATUS.COMPLETED
        ].includes(normalized)
    ) {
        return PROVIDER_STATUS.SUCCESS;
    }

    if (
        [
            PROVIDER_STATUS.PENDING,
            PROVIDER_STATUS.PROCESSING
        ].includes(normalized)
    ) {
        return PROVIDER_STATUS.PENDING;
    }

    if (
        [
            PROVIDER_STATUS.FAILED,
            PROVIDER_STATUS.REVERSED
        ].includes(normalized)
    ) {
        return PROVIDER_STATUS.FAILED;
    }

    return PROVIDER_STATUS.UNKNOWN;
}


function extractCollection(data) {
    if (!data) {
        return [];
    }

    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data.transactions)) {
        return data.transactions;
    }

    if (Array.isArray(data.records)) {
        return data.records;
    }

    if (Array.isArray(data.items)) {
        return data.items;
    }

    if (Array.isArray(data.content)) {
        return data.content;
    }

    if (Array.isArray(data.results)) {
        return data.results;
    }

    if (Array.isArray(data.data)) {
        return data.data;
    }

    return [];
}


class MTNSettlement {

    constructor({
        authService,
        httpClient,
        configuration,

        settlementRepository,
        reconciliationRepository,

        reconciliationService,
        varianceDetector,

        financialTransactionService,
        ledgerBridge,

        transactionRepository,

        idempotencyManager,
        tenantResolver,
        authorizationService,

        reportGenerator,

        auditService,
        eventPublisher,
        outboxService,

        logger,
        metrics,
        tracer
    } = {}) {
        this.authService =
            authService;

        this.httpClient =
            httpClient;

        this.configuration =
            configuration;

        this.settlementRepository =
            settlementRepository;

        this.reconciliationRepository =
            reconciliationRepository;

        this.reconciliationService =
            reconciliationService;

        this.varianceDetector =
            varianceDetector;

        this.financialTransactionService =
            financialTransactionService;

        this.ledgerBridge =
            ledgerBridge;

        this.transactionRepository =
            transactionRepository;

        this.idempotencyManager =
            idempotencyManager;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.reportGenerator =
            reportGenerator;

        this.auditService =
            auditService;

        this.eventPublisher =
            eventPublisher;

        this.outboxService =
            outboxService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.statistics = {
            executions: 0,
            completed: 0,
            failed: 0,
            variances: 0,
            reviews: 0,
            providerFetches: 0,
            providerFetchFailures: 0,
            financialPostings: 0,
            financialPostingFailures: 0
        };
    }


    /**
     * =========================================================================
     * Public Settlement Entry Point
     * =========================================================================
     */
    async settle({
        tenantId,
        settlementDate,
        type = SETTLEMENT_TYPES.COLLECTION,
        idempotencyKey,
        actor,
        session,
        context = {}
    } = {}) {
        const correlationId =
            context.correlationId ||
            crypto.randomUUID();

        const operationId =
            context.operationId ||
            crypto.randomUUID();

        const span =
            this.tracer?.startSpan?.(
                'payment.mtn.settlement',
                {
                    attributes: {
                        provider: PROVIDER,
                        settlementType: type
                    }
                }
            );

        this.statistics.executions++;

        try {
            this.assertDependencies();

            const normalizedTenantId =
                await this.resolveTenant(
                    tenantId,
                    context
                );

            const normalizedDate =
                this.normalizeSettlementDate(
                    settlementDate
                );

            const normalizedType =
                this.normalizeType(type);

            this.assertAuthorization({
                tenantId: normalizedTenantId,
                actor,
                action: 'SETTLE_MTN_PROVIDER'
            });

            const effectiveIdempotencyKey =
                this.buildIdempotencyKey({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    idempotencyKey
                });

            const duplicate =
                await this.checkIdempotency({
                    tenantId:
                        normalizedTenantId,
                    key:
                        effectiveIdempotencyKey,
                    operationId,
                    correlationId,
                    context
                });

            if (duplicate) {
                return duplicate;
            }

            await this.audit({
                action:
                    'MTN_SETTLEMENT_STARTED',
                tenantId:
                    normalizedTenantId,
                settlementDate:
                    normalizedDate,
                type:
                    normalizedType,
                correlationId,
                operationId,
                metadata: {
                    idempotencyKey:
                        effectiveIdempotencyKey
                }
            });

            /**
             * ---------------------------------------------------------------
             * 1. Fetch provider evidence
             * ---------------------------------------------------------------
             */
            const providerSettlement =
                await this.fetchSettlement({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    correlationId,
                    operationId,
                    session,
                    context
                });

            this.assertProviderSettlementComplete(
                providerSettlement
            );

            /**
             * ---------------------------------------------------------------
             * 2. Fetch internal authoritative evidence
             * ---------------------------------------------------------------
             */
            const internalSettlement =
                await this.fetchInternalSettlement({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    session,
                    context
                });

            /**
             * ---------------------------------------------------------------
             * 3. Reconcile
             * ---------------------------------------------------------------
             */
            const reconciliation =
                await this.reconcile({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    providerSettlement,
                    internalSettlement,
                    correlationId,
                    operationId,
                    session,
                    context
                });

            const variance =
                reconciliation.variance;

            if (variance.hasVariance) {
                this.statistics.variances++;

                const record =
                    await this.persistSettlementRecord({
                        tenantId:
                            normalizedTenantId,
                        settlementDate:
                            normalizedDate,
                        type:
                            normalizedType,
                        status:
                            SETTLEMENT_STATUS.VARIANCE_DETECTED,
                        providerSettlement,
                        internalSettlement,
                        variance,
                        reconciliation,
                        correlationId,
                        operationId,
                        session
                    });

                this.statistics.reviews++;

                await this.audit({
                    action:
                        'MTN_SETTLEMENT_VARIANCE_DETECTED',
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    correlationId,
                    operationId,
                    settlementId:
                        record?._id ||
                        record?.settlementId,
                    metadata: {
                        varianceCount:
                            variance.count,
                        varianceTypes:
                            variance.types
                    }
                });

                await this.publishSettlementEvent({
                    eventType:
                        'MTN_SETTLEMENT_VARIANCE_DETECTED',
                    payload: {
                        tenantId:
                            normalizedTenantId,
                        settlementDate:
                            normalizedDate,
                        type:
                            normalizedType,
                        status:
                            SETTLEMENT_STATUS.VARIANCE_DETECTED,
                        correlationId,
                        operationId
                    },
                    tenantId:
                        normalizedTenantId,
                    correlationId,
                    operationId,
                    session
                });

                await this.registerIdempotency({
                    tenantId:
                        normalizedTenantId,
                    key:
                        effectiveIdempotencyKey,
                    response: {
                        success: false,
                        status:
                            SETTLEMENT_STATUS.REQUIRES_REVIEW,
                        settlementId:
                            record?._id ||
                            record?.settlementId,
                        correlationId
                    },
                    operationId,
                    session
                });

                return {
                    success: false,
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    status:
                        SETTLEMENT_STATUS.REQUIRES_REVIEW,
                    variance,
                    reconciliation,
                    correlationId,
                    operationId
                };
            }

            /**
             * ---------------------------------------------------------------
             * 4. Financial settlement
             * ---------------------------------------------------------------
             *
             * Prefer the canonical financial transaction service.
             * ledgerBridge is retained only as a compatibility boundary for
             * existing deployments. This module never mutates balances itself.
             */
            let financialResult = null;

            if (this.requiresFinancialPosting(reconciliation)) {
                this.statistics.financialPostings++;

                try {
                    financialResult =
                        await this.postFinancialSettlement({
                            tenantId:
                                normalizedTenantId,
                            settlementDate:
                                normalizedDate,
                            type:
                                normalizedType,
                            providerSettlement,
                            internalSettlement,
                            reconciliation,
                            correlationId,
                            operationId,
                            session,
                            actor,
                            context
                        });
                } catch (error) {
                    this.statistics.financialPostingFailures++;

                    await this.persistSettlementFailure({
                        tenantId:
                            normalizedTenantId,
                        settlementDate:
                            normalizedDate,
                        type:
                            normalizedType,
                        providerSettlement,
                        internalSettlement,
                        variance,
                        reconciliation,
                        correlationId,
                        operationId,
                        session,
                        reason:
                            'FINANCIAL_POSTING_FAILED',
                        error
                    });

                    throw error;
                }
            }

            /**
             * ---------------------------------------------------------------
             * 5. Persist authoritative settlement result
             * ---------------------------------------------------------------
             */
            const record =
                await this.persistSettlementRecord({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    status:
                        SETTLEMENT_STATUS.SETTLED,
                    providerSettlement,
                    internalSettlement,
                    variance,
                    reconciliation,
                    financialResult,
                    correlationId,
                    operationId,
                    session
                });

            /**
             * ---------------------------------------------------------------
             * 6. Generate report
             * ---------------------------------------------------------------
             */
            const report =
                await this.generateReport({
                    tenantId:
                        normalizedTenantId,
                    settlement:
                        record,
                    reconciliation,
                    providerSettlement,
                    correlationId,
                    operationId,
                    context
                });

            /**
             * ---------------------------------------------------------------
             * 7. Audit
             * ---------------------------------------------------------------
             */
            await this.audit({
                action:
                    'MTN_SETTLEMENT_COMPLETED',
                tenantId:
                    normalizedTenantId,
                settlementDate:
                    normalizedDate,
                type:
                    normalizedType,
                correlationId,
                operationId,
                settlementId:
                    record?._id ||
                    record?.settlementId,
                metadata: {
                    status:
                        SETTLEMENT_STATUS.SETTLED
                }
            });

            /**
             * ---------------------------------------------------------------
             * 8. Publish through outbox where available.
             * ---------------------------------------------------------------
             */
            await this.publishSettlementEvent({
                eventType:
                    'MTN_SETTLEMENT_COMPLETED',
                payload: {
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedDate,
                    type:
                        normalizedType,
                    status:
                        SETTLEMENT_STATUS.SETTLED,
                    settlementId:
                        record?._id ||
                        record?.settlementId,
                    correlationId,
                    operationId
                },
                tenantId:
                    normalizedTenantId,
                correlationId,
                operationId,
                session
            });

            await this.registerIdempotency({
                tenantId:
                    normalizedTenantId,
                key:
                    effectiveIdempotencyKey,
                response: {
                    success: true,
                    status:
                        SETTLEMENT_STATUS.SETTLED,
                    settlementId:
                        record?._id ||
                        record?.settlementId,
                    correlationId,
                    operationId
                },
                operationId,
                session
            });

            this.statistics.completed++;

            this.metrics?.counter?.(
                'payment_mtn_settlement_success_total'
            );

            this.metrics?.increment?.(
                'payment_mtn_settlement_success_total'
            );

            return {
                success: true,
                tenantId:
                    normalizedTenantId,
                settlementDate:
                    normalizedDate,
                type:
                    normalizedType,
                status:
                    SETTLEMENT_STATUS.SETTLED,
                settlement:
                    record,
                variance,
                reconciliation,
                financialResult,
                report,
                correlationId,
                operationId
            };
        } catch (error) {
            this.statistics.failed++;

            this.metrics?.counter?.(
                'payment_mtn_settlement_failure_total'
            );

            this.metrics?.increment?.(
                'payment_mtn_settlement_failure_total'
            );

            const normalized =
                error instanceof SettlementError
                    ? error
                    : normalizeError(
                        error,
                        {
                            provider:
                                PROVIDER,
                            tenantId,
                            settlementDate,
                            type,
                            correlationId,
                            operationId
                        }
                    );

            this.logger?.error?.({
                message:
                    'MTN settlement failed',
                provider:
                    PROVIDER,
                tenantId,
                settlementDate,
                type,
                correlationId,
                operationId,
                error:
                    normalized.toJSON?.()
                    ||
                    normalized
            });

            try {
                await this.audit({
                    action:
                        'MTN_SETTLEMENT_FAILED',
                    tenantId,
                    settlementDate,
                    type,
                    correlationId,
                    operationId,
                    metadata: {
                        errorCode:
                            normalized.code,
                        errorMessage:
                            normalized.message
                    }
                });
            } catch (auditError) {
                this.logger?.error?.({
                    message:
                        'Failed to record MTN settlement failure audit',
                    tenantId,
                    correlationId,
                    operationId,
                    error:
                        auditError?.message ||
                        auditError
                });
            }

            throw normalized;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Fetch Provider Settlement
     * =========================================================================
     */
    async fetchSettlement({
        tenantId,
        settlementDate,
        type,
        correlationId,
        operationId,
        session,
        context = {}
    } = {}) {
        if (
            !this.authService ||
            typeof this.authService.getAccessToken !== 'function'
        ) {
            throw this.createError(
                'MTN_AUTH_SERVICE_UNAVAILABLE',
                'MTN authentication service is unavailable'
            );
        }

        if (
            !this.httpClient ||
            typeof this.httpClient.request !== 'function'
        ) {
            throw this.createError(
                'MTN_HTTP_CLIENT_UNAVAILABLE',
                'MTN HTTP client is unavailable'
            );
        }

        this.statistics.providerFetches++;

        const token =
            await this.authService.getAccessToken({
                tenantId,
                correlationId,
                operationId,
                context
            });

        if (!token) {
            throw this.createError(
                'MTN_ACCESS_TOKEN_UNAVAILABLE',
                'MTN access token unavailable'
            );
        }

        const endpoint =
            this.settlementEndpoint({
                type
            });

        const response =
            await this.httpClient.request({
                method: 'GET',
                url: endpoint,
                headers: {
                    Authorization:
                        `Bearer ${token}`,
                    Accept:
                        'application/json'
                },
                params: {
                    settlementDate,
                    type
                },
                correlationId,
                operationId,
                tenantId,
                session
            });

        const body =
            pickResponseBody(response);

        return this.normalizeSettlement({
            data: body,
            settlementDate,
            type
        });
    }


    /**
     * =========================================================================
     * Internal Settlement Evidence
     * =========================================================================
     */
    async fetchInternalSettlement({
        tenantId,
        settlementDate,
        type,
        session,
        context = {}
    } = {}) {
        const query = {
            tenantId,
            provider: PROVIDER,
            settlementDate,
            type
        };

        /**
         * Prefer a dedicated settlement repository.
         */
        if (
            this.settlementRepository &&
            typeof this.settlementRepository.findForReconciliation === 'function'
        ) {
            return this.settlementRepository.findForReconciliation({
                ...query,
                session,
                context
            });
        }

        if (
            this.settlementRepository &&
            typeof this.settlementRepository.find === 'function'
        ) {
            return this.settlementRepository.find({
                ...query,
                session
            });
        }

        /**
         * Compatibility fallback for installations where the internal
         * evidence lives in the transaction repository.
         */
        if (
            this.transactionRepository &&
            typeof this.transactionRepository.findForReconciliation === 'function'
        ) {
            return this.transactionRepository.findForReconciliation({
                ...query,
                session,
                context
            });
        }

        if (
            this.transactionRepository &&
            typeof this.transactionRepository.findBetween === 'function'
        ) {
            const date =
                safeDate(settlementDate);

            const from =
                new Date(date);

            from.setUTCHours(
                0,
                0,
                0,
                0
            );

            const to =
                new Date(from);

            to.setUTCDate(
                to.getUTCDate() + 1
            );

            return this.transactionRepository.findBetween({
                tenantId,
                provider: PROVIDER,
                from,
                to,
                type,
                session,
                context
            });
        }

        throw this.createError(
            'INTERNAL_SETTLEMENT_REPOSITORY_UNAVAILABLE',
            'No internal settlement evidence repository is configured'
        );
    }


    /**
     * =========================================================================
     * Reconciliation
     * =========================================================================
     */
    async reconcile({
        tenantId,
        settlementDate,
        type,
        providerSettlement,
        internalSettlement,
        correlationId,
        operationId,
        session,
        context = {}
    } = {}) {
        if (
            this.reconciliationService &&
            typeof this.reconciliationService.reconcileSettlement === 'function'
        ) {
            const result =
                await this.reconciliationService.reconcileSettlement({
                    tenantId,
                    settlementDate,
                    type,
                    providerSettlement,
                    internalSettlement,
                    correlationId,
                    operationId,
                    session,
                    context
                });

            return this.normalizeReconciliationResult({
                result,
                providerSettlement,
                internalSettlement
            });
        }

        if (
            this.varianceDetector &&
            typeof this.varianceDetector.detect === 'function'
        ) {
            const variance =
                await this.varianceDetector.detect({
                    tenantId,
                    providerSettlement,
                    internalSettlement,
                    settlementDate,
                    type,
                    correlationId,
                    operationId,
                    session,
                    context
                });

            return {
                status:
                    variance?.hasVariance
                        ? SETTLEMENT_STATUS.VARIANCE_DETECTED
                        : SETTLEMENT_STATUS.READY_TO_POST,
                matched:
                    !variance?.hasVariance,
                variance:
                    variance || {
                        hasVariance: false,
                        count: 0,
                        types: []
                    }
            };
        }

        return this.performDeterministicReconciliation({
            providerSettlement,
            internalSettlement
        });
    }


    normalizeReconciliationResult({
        result,
        providerSettlement,
        internalSettlement
    } = {}) {
        if (!isObject(result)) {
            return this.performDeterministicReconciliation({
                providerSettlement,
                internalSettlement
            });
        }

        const variance =
            result.variance ||
            {
                hasVariance:
                    Boolean(result.hasVariance),
                count:
                    Number(result.varianceCount || 0),
                types:
                    Array.isArray(result.varianceTypes)
                        ? result.varianceTypes
                        : []
            };

        return {
            ...result,
            matched:
                typeof result.matched === 'boolean'
                    ? result.matched
                    : !variance.hasVariance,
            status:
                result.status ||
                (
                    variance.hasVariance
                        ? SETTLEMENT_STATUS.VARIANCE_DETECTED
                        : SETTLEMENT_STATUS.READY_TO_POST
                ),
            variance
        };
    }


    performDeterministicReconciliation({
        providerSettlement = {},
        internalSettlement = []
    } = {}) {
        const providerRecords =
            extractCollection(providerSettlement.transactions);

        const internalRecords =
            Array.isArray(internalSettlement)
                ? internalSettlement
                : extractCollection(
                    internalSettlement
                );

        const variances = [];

        const internalByReference =
            new Map();

        for (const record of internalRecords) {
            const references =
                this.getReferences(record);

            for (const reference of references) {
                if (!reference) {
                    continue;
                }

                const existing =
                    internalByReference.get(reference);

                if (existing) {
                    variances.push({
                        type:
                            'DUPLICATE_INTERNAL',
                        reference
                    });
                } else {
                    internalByReference.set(
                        reference,
                        record
                    );
                }
            }
        }

        const matchedInternal =
            new Set();

        for (const providerRecord of providerRecords) {
            const providerReference =
                this.primaryReference(
                    providerRecord
                );

            if (!providerReference) {
                variances.push({
                    type:
                        'PROVIDER_DATA_INVALID',
                    reason:
                        'Provider settlement record has no usable reference'
                });

                continue;
            }

            const internal =
                internalByReference.get(
                    providerReference
                );

            if (!internal) {
                variances.push({
                    type:
                        'MISSING_INTERNAL',
                    reference:
                        providerReference
                });

                continue;
            }

            matchedInternal.add(
                internal
            );

            const providerAmount =
                providerRecord.amount;

            const internalAmount =
                internal.amount ??
                internal.settlementAmount ??
                internal.value;

            if (
                !sameAmount(
                    providerAmount,
                    internalAmount
                )
            ) {
                variances.push({
                    type:
                        'AMOUNT_MISMATCH',
                    reference:
                        providerReference,
                    providerAmount,
                    internalAmount
                });
            }

            const providerCurrency =
                normalizeCurrency(
                    providerRecord.currency
                );

            const internalCurrency =
                normalizeCurrency(
                    internal.currency
                );

            if (
                providerCurrency !==
                internalCurrency
            ) {
                variances.push({
                    type:
                        'CURRENCY_MISMATCH',
                    reference:
                        providerReference,
                    providerCurrency,
                    internalCurrency
                });
            }

            const providerStatus =
                normalizeProviderStatus(
                    providerRecord.status
                );

            if (
                providerStatus ===
                PROVIDER_STATUS.UNKNOWN
            ) {
                variances.push({
                    type:
                        'UNKNOWN_PROVIDER_STATUS',
                    reference:
                        providerReference,
                    providerStatus:
                        providerRecord.status
                });
            }
        }

        for (const internal of internalRecords) {
            if (!matchedInternal.has(internal)) {
                const reference =
                    this.primaryReference(
                        internal
                    );

                variances.push({
                    type:
                        'MISSING_PROVIDER',
                    reference
                });
            }
        }

        const hasVariance =
            variances.length > 0;

        return {
            matched:
                !hasVariance,
            status:
                hasVariance
                    ? SETTLEMENT_STATUS.VARIANCE_DETECTED
                    : SETTLEMENT_STATUS.READY_TO_POST,
            variance: {
                hasVariance,
                count:
                    variances.length,
                types:
                    [
                        ...new Set(
                            variances.map(
                                item => item.type
                            )
                        )
                    ],
                items:
                    variances
            }
        };
    }


    /**
     * =========================================================================
     * Financial Posting Boundary
     * =========================================================================
     */
    async postFinancialSettlement({
        tenantId,
        settlementDate,
        type,
        providerSettlement,
        internalSettlement,
        reconciliation,
        correlationId,
        operationId,
        session,
        actor,
        context = {}
    } = {}) {
        const payload = {
            tenantId,
            provider: PROVIDER,
            settlementDate,
            type,
            settlement:
                providerSettlement,
            internalSettlement,
            reconciliation,
            correlationId,
            operationId,
            actor,
            context,
            session
        };

        if (
            this.financialTransactionService &&
            typeof this.financialTransactionService.settleProviderSettlement === 'function'
        ) {
            return this.financialTransactionService.settleProviderSettlement(
                payload
            );
        }

        if (
            this.financialTransactionService &&
            typeof this.financialTransactionService.settle === 'function'
        ) {
            return this.financialTransactionService.settle(
                payload
            );
        }

        /**
         * Compatibility path for the existing architecture.
         *
         * ledgerBridge remains an injected boundary. It must itself delegate
         * to the canonical ledger/financial transaction implementation rather
         * than perform ad-hoc balance mutation.
         */
        if (
            this.ledgerBridge &&
            typeof this.ledgerBridge.postSettlement === 'function'
        ) {
            this.logger?.warn?.({
                message:
                    'Using legacy MTN ledgerBridge settlement boundary',
                tenantId,
                correlationId,
                operationId
            });

            return this.ledgerBridge.postSettlement({
                tenantId,
                settlement:
                    providerSettlement,
                reconciliation,
                settlementDate,
                type,
                correlationId,
                operationId,
                session,
                actor,
                context
            });
        }

        throw this.createError(
            'FINANCIAL_SETTLEMENT_SERVICE_UNAVAILABLE',
            'Canonical financial settlement service is unavailable'
        );
    }


    requiresFinancialPosting(reconciliation) {
        if (!reconciliation) {
            return true;
        }

        if (
            reconciliation.financialPostingRequired === false
        ) {
            return false;
        }

        return true;
    }


    /**
     * =========================================================================
     * Settlement Persistence
     * =========================================================================
     */
    async persistSettlementRecord({
        tenantId,
        settlementDate,
        type,
        status,
        providerSettlement,
        internalSettlement,
        variance,
        reconciliation,
        financialResult,
        correlationId,
        operationId,
        session
    } = {}) {
        if (
            !this.settlementRepository
        ) {
            throw this.createError(
                'SETTLEMENT_REPOSITORY_UNAVAILABLE',
                'Settlement repository is unavailable'
            );
        }

        const document = {
            tenantId,
            provider: PROVIDER,
            settlementDate,
            type,
            status,
            providerSettlementId:
                providerSettlement?.settlementId,
            amount:
                providerSettlement?.amount,
            currency:
                providerSettlement?.currency,
            transactionCount:
                Array.isArray(
                    providerSettlement?.transactions
                )
                    ? providerSettlement.transactions.length
                    : 0,
            variance:
                variance || {
                    hasVariance: false,
                    count: 0,
                    types: []
                },
            reconciliation,
            financialResultReference:
                this.extractFinancialReference(
                    financialResult
                ),
            correlationId,
            operationId
        };

        if (
            session
        ) {
            document.sessionId =
                String(
                    session.id ||
                    session
                );
        }

        if (
            typeof this.settlementRepository.createSettlement === 'function'
        ) {
            return this.settlementRepository.createSettlement({
                ...document,
                session
            });
        }

        if (
            typeof this.settlementRepository.create === 'function'
        ) {
            return this.settlementRepository.create({
                ...document,
                session
            });
        }

        if (
            typeof this.settlementRepository.upsert === 'function'
        ) {
            return this.settlementRepository.upsert({
                ...document,
                session
            });
        }

        throw this.createError(
            'SETTLEMENT_PERSISTENCE_UNSUPPORTED',
            'Settlement repository does not support persistence'
        );
    }


    async persistSettlementFailure({
        tenantId,
        settlementDate,
        type,
        providerSettlement,
        internalSettlement,
        variance,
        reconciliation,
        correlationId,
        operationId,
        session,
        reason,
        error
    } = {}) {
        try {
            if (
                !this.settlementRepository
            ) {
                return;
            }

            const document = {
                tenantId,
                provider: PROVIDER,
                settlementDate,
                type,
                status:
                    SETTLEMENT_STATUS.FAILED,
                reason,
                variance,
                reconciliation,
                providerSettlementId:
                    providerSettlement?.settlementId,
                correlationId,
                operationId,
                error: {
                    code:
                        error?.code,
                    message:
                        error?.message
                }
            };

            if (
                typeof this.settlementRepository.createSettlement === 'function'
            ) {
                await this.settlementRepository.createSettlement({
                    ...document,
                    session
                });

                return;
            }

            if (
                typeof this.settlementRepository.create === 'function'
            ) {
                await this.settlementRepository.create({
                    ...document,
                    session
                });
            }
        } catch (persistenceError) {
            this.logger?.error?.({
                message:
                    'Failed to persist MTN settlement failure state',
                tenantId,
                correlationId,
                operationId,
                error:
                    persistenceError?.message ||
                    persistenceError
            });
        }
    }


    /**
     * =========================================================================
     * Provider Response Normalization
     * =========================================================================
     */
    normalizeSettlement({
        data = {},
        settlementDate,
        type
    } = {}) {
        const transactionRecords =
            extractCollection(data);

        const amount =
            data.amount ??
            data.totalAmount ??
            data.settlementAmount ??
            null;

        const currency =
            normalizeCurrency(
                data.currency
            );

        return {
            provider:
                PROVIDER,
            settlementId:
                data.settlementId ??
                data.id ??
                data.reference ??
                null,
            settlementDate:
                data.settlementDate ??
                settlementDate,
            type:
                data.type ??
                type,
            amount:
                amount === null
                    ? null
                    : String(amount),
            currency,
            transactionCount:
                transactionRecords.length,
            transactions:
                transactionRecords.map(
                    item =>
                        this.normalizeTransaction(
                            item
                        )
                ),
            status:
                normalizeProviderStatus(
                    data.status
                ),
            raw: data
        };
    }


    normalizeTransaction(item = {}) {
        const reference =
            this.primaryReference(item);

        return {
            providerTransactionId:
                item.providerTransactionId ??
                item.transactionId ??
                item.financialTransactionId ??
                item.id ??
                null,

            reference,

            externalId:
                item.externalId ??
                item.externalReference ??
                null,

            amount:
                item.amount === undefined ||
                item.amount === null
                    ? null
                    : String(item.amount),

            currency:
                normalizeCurrency(
                    item.currency
                ),

            status:
                item.status ??
                null,

            normalizedStatus:
                normalizeProviderStatus(
                    item.status
                ),

            transactionDate:
                item.transactionDate ??
                item.createdAt ??
                item.updatedAt ??
                null
        };
    }


    /**
     * =========================================================================
     * Endpoint Resolution
     * =========================================================================
     */
    settlementEndpoint({
        type
    } = {}) {
        const endpoints =
            this.configuration?.getEndpoints?.() ||
            {};

        const configured =
            endpoints.settlement ??
            endpoints.settlements ??
            endpoints.reconciliation ??
            endpoints.collection;

        if (!configured) {
            throw this.createError(
                'MTN_SETTLEMENT_ENDPOINT_UNCONFIGURED',
                'MTN settlement endpoint is not configured'
            );
        }

        const normalized =
            String(configured).replace(
                /\/+$/,
                ''
            );

        /**
         * Do not impose an undocumented MTN path when configuration already
         * defines the complete settlement endpoint.
         */
        if (
            /\/settlements$/i.test(normalized)
        ) {
            return normalized;
        }

        if (
            /\/transactions$/i.test(normalized)
        ) {
            return normalized;
        }

        return `${normalized}/settlements`;
    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */
    assertProviderSettlementComplete(
        settlement
    ) {
        if (!settlement) {
            throw this.createError(
                'MTN_SETTLEMENT_EMPTY_RESPONSE',
                'MTN returned no settlement evidence'
            );
        }

        if (!settlement.settlementId) {
            throw this.createError(
                'MTN_SETTLEMENT_ID_MISSING',
                'MTN settlement response has no settlement identifier'
            );
        }

        if (
            !Array.isArray(
                settlement.transactions
            )
        ) {
            throw this.createError(
                'MTN_SETTLEMENT_TRANSACTIONS_INVALID',
                'MTN settlement transaction collection is invalid'
            );
        }

        if (
            settlement.amount === null ||
            settlement.amount === undefined
        ) {
            throw this.createError(
                'MTN_SETTLEMENT_AMOUNT_MISSING',
                'MTN settlement amount is missing'
            );
        }

        if (!settlement.currency) {
            throw this.createError(
                'MTN_SETTLEMENT_CURRENCY_MISSING',
                'MTN settlement currency is missing'
            );
        }

        return true;
    }


    normalizeSettlementDate(
        settlementDate
    ) {
        const date =
            safeDate(settlementDate);

        if (!date) {
            throw this.createError(
                'INVALID_SETTLEMENT_DATE',
                'A valid settlement date is required'
            );
        }

        /**
         * Use an ISO calendar date for provider reconciliation keys.
         */
        return date
            .toISOString()
            .slice(0, 10);
    }


    normalizeType(type) {
        const normalized =
            String(type || '')
                .trim()
                .toUpperCase();

        if (
            !Object.values(
                SETTLEMENT_TYPES
            ).includes(normalized)
        ) {
            throw this.createError(
                'INVALID_SETTLEMENT_TYPE',
                `Unsupported MTN settlement type: ${type}`
            );
        }

        return normalized;
    }


    /**
     * =========================================================================
     * Tenant / Authorization / Idempotency
     * =========================================================================
     */
    async resolveTenant(
        tenantId,
        context = {}
    ) {
        if (
            tenantId
        ) {
            return String(
                tenantId
            );
        }

        if (
            this.tenantResolver &&
            typeof this.tenantResolver.resolve === 'function'
        ) {
            const resolved =
                await this.tenantResolver.resolve(
                    context
                );

            if (resolved) {
                return String(
                    resolved
                );
            }
        }

        throw this.createError(
            'TENANT_CONTEXT_REQUIRED',
            'Tenant context is required for MTN settlement'
        );
    }


    assertAuthorization({
        tenantId,
        actor,
        action
    }) {
        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            typeof this.authorizationService.assertAuthorized === 'function'
        ) {
            const result =
                this.authorizationService.assertAuthorized({
                    tenantId,
                    actor,
                    action
                });

            if (
                result &&
                typeof result.then === 'function'
            ) {
                /**
                 * This function intentionally cannot await because the public
                 * settlement path already remains async. Implementations that
                 * require asynchronous authorization should expose
                 * assertAuthorizedAsync and be handled there.
                 */
                return result;
            }

            return result;
        }

        return true;
    }


    buildIdempotencyKey({
        tenantId,
        settlementDate,
        type,
        idempotencyKey
    }) {
        const supplied =
            String(
                idempotencyKey || ''
            ).trim();

        if (supplied) {
            return supplied;
        }

        return crypto
            .createHash('sha256')
            .update(
                [
                    PROVIDER,
                    tenantId,
                    settlementDate,
                    type
                ].join(':')
            )
            .digest('hex');
    }


    async checkIdempotency({
        tenantId,
        key,
        operationId,
        correlationId,
        context = {}
    } = {}) {
        if (
            !this.idempotencyManager
        ) {
            return null;
        }

        let result = null;

        if (
            typeof this.idempotencyManager.get === 'function'
        ) {
            result =
                await this.idempotencyManager.get({
                    tenantId,
                    key,
                    operationId,
                    correlationId,
                    context
                });
        } else if (
            typeof this.idempotencyManager.find === 'function'
        ) {
            result =
                await this.idempotencyManager.find({
                    tenantId,
                    key
                });
        }

        if (!result) {
            return null;
        }

        return {
            success:
                result.response?.success ??
                result.success ??
                true,
            duplicate: true,
            status:
                result.response?.status ??
                result.status ??
                SETTLEMENT_STATUS.SETTLED,
            settlementId:
                result.response?.settlementId ??
                result.settlementId,
            correlationId:
                result.response?.correlationId ??
                result.correlationId ??
                correlationId,
            operationId:
                result.response?.operationId ??
                result.operationId ??
                operationId
        };
    }


    async registerIdempotency({
        tenantId,
        key,
        response,
        operationId,
        session
    } = {}) {
        if (
            !this.idempotencyManager
        ) {
            return;
        }

        const payload = {
            tenantId,
            key,
            response,
            operationId,
            session
        };

        if (
            typeof this.idempotencyManager.register === 'function'
        ) {
            await this.idempotencyManager.register(
                payload
            );
            return;
        }

        if (
            typeof this.idempotencyManager.set === 'function'
        ) {
            await this.idempotencyManager.set(
                payload
            );
        }
    }


    /**
     * =========================================================================
     * Audit / Events / Reporting
     * =========================================================================
     */
    async audit({
        action,
        tenantId,
        settlementDate,
        type,
        correlationId,
        operationId,
        settlementId,
        metadata = {}
    } = {}) {
        if (
            !this.auditService ||
            typeof this.auditService.record !== 'function'
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,
                tenantId,
                provider: PROVIDER,
                settlementDate,
                type,
                settlementId,
                correlationId,
                operationId,
                metadata
            });
        } catch (error) {
            /**
             * Audit is important observability evidence, but should not turn
             * an already-authoritative financial result into a false state.
             */
            this.logger?.error?.({
                message:
                    'MTN settlement audit recording failed',
                action,
                tenantId,
                correlationId,
                operationId,
                error:
                    error?.message ||
                    error
            });
        }
    }


    async publishSettlementEvent({
        eventType,
        payload,
        tenantId,
        correlationId,
        operationId,
        session
    } = {}) {
        /**
         * Prefer an outbox so financial state and event intent can be
         * committed atomically with the settlement transaction.
         */
        if (
            this.outboxService
        ) {
            if (
                typeof this.outboxService.enqueue === 'function'
            ) {
                await this.outboxService.enqueue({
                    tenantId,
                    aggregateType:
                        'MTN_SETTLEMENT',
                    aggregateId:
                        payload.settlementId ||
                        operationId,
                    eventType,
                    payload,
                    idempotencyKey:
                        `${eventType}:${tenantId}:${operationId}`,
                    session
                });

                return;
            }

            if (
                typeof this.outboxService.publish === 'function'
            ) {
                await this.outboxService.publish({
                    tenantId,
                    eventType,
                    payload,
                    idempotencyKey:
                        `${eventType}:${tenantId}:${operationId}`,
                    session
                });

                return;
            }
        }

        /**
         * Legacy publisher fallback.
         */
        if (
            this.eventPublisher &&
            typeof this.eventPublisher.publish === 'function'
        ) {
            await this.eventPublisher.publish({
                type: eventType,
                payload
            });
        }
    }


    async generateReport({
        tenantId,
        settlement,
        reconciliation,
        providerSettlement,
        correlationId,
        operationId,
        context = {}
    } = {}) {
        if (
            !this.reportGenerator ||
            typeof this.reportGenerator.generate !== 'function'
        ) {
            return null;
        }

        return this.reportGenerator.generate({
            tenantId,
            provider: PROVIDER,
            settlement,
            reconciliation,
            providerSettlement,
            correlationId,
            operationId,
            context
        });
    }


    /**
     * =========================================================================
     * Reference / Utility Functions
     * =========================================================================
     */
    getReferences(record = {}) {
        return [
            record.providerTransactionId,
            record.transactionId,
            record.financialTransactionId,
            record.externalId,
            record.externalReference,
            record.reference,
            record.paymentReference,
            record.transactionReference,
            record.id
        ]
            .filter(
                value =>
                    value !== null &&
                    value !== undefined &&
                    String(value).trim() !== ''
            )
            .map(
                value =>
                    String(value).trim()
            );
    }


    primaryReference(record = {}) {
        const references =
            this.getReferences(record);

        return references[0] || null;
    }


    extractFinancialReference(
        financialResult
    ) {
        if (!financialResult) {
            return null;
        }

        return (
            financialResult.financialTransactionId ||
            financialResult.transactionId ||
            financialResult.ledgerReference ||
            financialResult.reference ||
            financialResult.id ||
            null
        );
    }


    createError(
        code,
        message,
        details = {}
    ) {
        try {
            return new SettlementError(
                message,
                {
                    code,
                    provider: PROVIDER,
                    ...details
                }
            );
        } catch (_) {
            const error =
                new Error(message);

            error.code = code;
            error.provider = PROVIDER;

            return error;
        }
    }


    assertDependencies() {
        if (
            !this.configuration ||
            typeof this.configuration.getEndpoints !== 'function'
        ) {
            throw this.createError(
                'MTN_CONFIGURATION_UNAVAILABLE',
                'MTN payment configuration is unavailable'
            );
        }

        if (
            !this.settlementRepository &&
            !this.transactionRepository
        ) {
            throw this.createError(
                'SETTLEMENT_STORAGE_UNAVAILABLE',
                'No settlement evidence repository is configured'
            );
        }
    }


    /**
     * =========================================================================
     * Health / Diagnostics
     * =========================================================================
     */
    health() {
        const endpointConfigured =
            Boolean(
                this.configuration?.getEndpoints?.()
                    ?.settlement ||
                this.configuration?.getEndpoints?.()
                    ?.settlements ||
                this.configuration?.getEndpoints?.()
                    ?.reconciliation ||
                this.configuration?.getEndpoints?.()
                    ?.collection
            );

        const dependencies = {
            authService:
                Boolean(
                    this.authService
                ),
            httpClient:
                Boolean(
                    this.httpClient
                ),
            configuration:
                Boolean(
                    this.configuration
                ),
            settlementRepository:
                Boolean(
                    this.settlementRepository
                ),
            reconciliationService:
                Boolean(
                    this.reconciliationService
                ),
            varianceDetector:
                Boolean(
                    this.varianceDetector
                ),
            financialTransactionService:
                Boolean(
                    this.financialTransactionService
                ),
            ledgerBridge:
                Boolean(
                    this.ledgerBridge
                ),
            idempotencyManager:
                Boolean(
                    this.idempotencyManager
                ),
            outboxService:
                Boolean(
                    this.outboxService
                )
        };

        const financialBoundaryConfigured =
            Boolean(
                this.financialTransactionService ||
                this.ledgerBridge
            );

        const healthy =
            endpointConfigured &&
            dependencies.authService &&
            dependencies.httpClient &&
            dependencies.configuration &&
            dependencies.settlementRepository &&
            financialBoundaryConfigured;

        return {
            provider:
                PROVIDER,
            module:
                'settlement',
            status:
                healthy
                    ? 'UP'
                    : 'DEGRADED',
            financialSettlementBoundary:
                this.financialTransactionService
                    ? 'CANONICAL_FINANCIAL_SERVICE'
                    : this.ledgerBridge
                        ? 'COMPATIBILITY_LEDGER_BRIDGE'
                        : 'UNAVAILABLE',
            endpointConfigured,
            dependencies,
            statistics: {
                ...this.statistics
            }
        };
    }


    diagnostics() {
        return {
            ...this.health(),
            settlementTypes:
                Object.values(
                    SETTLEMENT_TYPES
                ),
            statuses:
                Object.values(
                    SETTLEMENT_STATUS
                ),
            provider:
                PROVIDER
        };
    }
}


module.exports =
    MTNSettlement;

module.exports.MTNSettlement =
    MTNSettlement;

module.exports.SETTLEMENT_TYPES =
    SETTLEMENT_TYPES;

module.exports.SETTLEMENT_STATUS =
    SETTLEMENT_STATUS;