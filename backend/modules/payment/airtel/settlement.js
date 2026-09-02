'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Settlement Service
 * ============================================================================
 *
 * Purpose
 * -------
 * Coordinates Airtel Money settlement processing between the
 * payment provider and the financial ledger.
 *
 * Responsibilities
 * ----------------
 * • Settlement registration
 * • Settlement reconciliation
 * • Settlement completion
 * • Settlement failure handling
 * • Ledger posting delegation
 * • Event publishing
 * • Audit logging
 * • Metrics
 * • Distributed tracing
 * • Health monitoring
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Provider API communication
 * • OAuth authentication
 * • Callback validation
 * • Ledger implementation
 * • Business rule enforcement
 *
 * ============================================================================
 */

const crypto = require('crypto');

class AirtelSettlementService {

    constructor({

        settlementRepository,

        settlementProvider,

        reconciliationService,

        ledgerBridge,

        auditService,

        eventBus,

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

        this.ledgerBridge =
            ledgerBridge;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

    }

    /**
     * ------------------------------------------------------------------------
     * Register Settlement
     * ------------------------------------------------------------------------
     */

    async register({

        tenantId,

        reference,

        providerReference,

        amount,

        currency,

        metadata = {},

        correlationId = crypto.randomUUID()

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.settlement.register'
            );

        try {

            const settlement =
                await this.settlementRepository.create({

                    tenantId,

                    provider: 'AIRTEL',

                    reference,

                    providerReference,

                    amount,

                    currency,

                    status: 'PENDING',

                    metadata,

                    correlationId,

                    createdAt: new Date(),

                    updatedAt: new Date()

                });

            await this.auditService?.record({

                action:
                    'AIRTEL_SETTLEMENT_REGISTERED',

                tenantId,

                reference,

                correlationId

            });

            await this.eventBus?.publish({

                type:
                    'AirtelSettlementRegistered',

                payload:
                    settlement

            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_registered_total'
            );

            return settlement;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Complete Settlement
     * ------------------------------------------------------------------------
     */

    async complete({

        settlementId,

        ledger = true,

        correlationId = crypto.randomUUID()

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.settlement.complete'
            );

        try {

            const settlement =
                await this.settlementRepository.findById(
                    settlementId
                );

            if (!settlement) {

                throw new Error(
                    'Settlement not found'
                );

            }

            if (ledger) {

                await this.ledgerBridge?.postSettlement?.({

                    tenantId:
                        settlement.tenantId,

                    settlement

                });

            }

            const updated =
                await this.settlementRepository.update(

                    settlementId,

                    {

                        status:
                            'SETTLED',

                        settledAt:
                            new Date(),

                        updatedAt:
                            new Date()

                    }

                );

            await this.auditService?.record({

                action:
                    'AIRTEL_SETTLEMENT_COMPLETED',

                tenantId:
                    settlement.tenantId,

                reference:
                    settlement.reference,

                correlationId

            });

            await this.eventBus?.publish({

                type:
                    'AirtelSettlementCompleted',

                payload:
                    updated

            });

            this.metrics?.counter?.(
                'payment_airtel_settlement_completed_total'
            );

            return updated;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Fail Settlement
     * ------------------------------------------------------------------------
     */

    async fail({

        settlementId,

        reason,

        correlationId = crypto.randomUUID()

    }) {

        const settlement =
            await this.settlementRepository.findById(
                settlementId
            );

        if (!settlement) {

            throw new Error(
                'Settlement not found'
            );

        }

        const updated =
            await this.settlementRepository.update(

                settlementId,

                {

                    status: 'FAILED',

                    failureReason: reason,

                    updatedAt: new Date()

                }

            );

        await this.auditService?.record({

            action:
                'AIRTEL_SETTLEMENT_FAILED',

            tenantId:
                settlement.tenantId,

            reference:
                settlement.reference,

            reason,

            correlationId

        });

        await this.eventBus?.publish({

            type:
                'AirtelSettlementFailed',

            payload:
                updated

        });

        this.metrics?.counter?.(
            'payment_airtel_settlement_failed_total'
        );

        return updated;

    }

    /**
     * ------------------------------------------------------------------------
     * Reconcile Settlement
     * ------------------------------------------------------------------------
     */

    async reconcile({

        reference,

        tenantId,

        correlationId = crypto.randomUUID()

    }) {

        if (!this.reconciliationService) {

            throw new Error(
                'reconciliationService not configured'
            );

        }

        return this.reconciliationService.reconcile({

            provider: 'AIRTEL',

            tenantId,

            reference,

            correlationId

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Query Settlement
     * ------------------------------------------------------------------------
     */

    async query(reference) {

        return this.settlementRepository.findOne({

            reference

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Provider Settlement Refresh
     * ------------------------------------------------------------------------
     */

    async refresh(reference) {

        if (!this.settlementProvider) {

            throw new Error(
                'settlementProvider not configured'
            );

        }

        return this.settlementProvider.querySettlement(
            reference
        );

    }

    /**
     * ------------------------------------------------------------------------
     * Health
     * ------------------------------------------------------------------------
     */

    async health() {

        return {

            provider:
                'AIRTEL',

            module:
                'settlement',

            status:
                'UP',

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {

                repository:
                    !!this.settlementRepository,

                provider:
                    !!this.settlementProvider,

                reconciliation:
                    !!this.reconciliationService,

                ledger:
                    !!this.ledgerBridge,

                audit:
                    !!this.auditService,

                events:
                    !!this.eventBus

            }

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Runtime Capabilities
     * ------------------------------------------------------------------------
     */

    capabilities() {

        return Object.freeze({

            provider: 'AIRTEL',

            settlement: true,

            reconciliation:
                !!this.reconciliationService,

            ledgerIntegration:
                !!this.ledgerBridge,

            eventPublishing:
                !!this.eventBus,

            auditLogging:
                !!this.auditService,

            tracing: true,

            metrics: true

        });

    }

}

module.exports = AirtelSettlementService;