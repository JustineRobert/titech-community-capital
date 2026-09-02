'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Settlement Reconciler
 * =============================================================================
 *
 * Purpose
 * -------
 * Performs authoritative reconciliation between Airtel settlement data and the
 * platform's internal ledger/payment records.
 *
 * Responsibilities
 * ----------------
 * • Settlement reconciliation orchestration
 * • Ledger vs provider comparison
 * • Missing settlement detection
 * • Amount variance detection
 * • Currency validation
 * • Duplicate settlement detection
 * • Automatic reconciliation result persistence
 * • Event publication
 * • Audit logging
 * • Metrics & tracing
 * • Multi-tenant isolation
 *
 * NOT Responsible For
 * -------------------
 * • Calling Airtel settlement APIs
 * • Ledger posting
 * • Callback processing
 * • Payment authorization
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    ReconciliationError,
    normalizeError
} = require('../../shared/errors');

const DEFAULT_TOLERANCE = 0;

const RESULT_STATUS = Object.freeze({

    MATCHED: 'MATCHED',

    VARIANCE: 'VARIANCE',

    MISSING_PROVIDER: 'MISSING_PROVIDER',

    MISSING_LEDGER: 'MISSING_LEDGER',

    DUPLICATE_PROVIDER: 'DUPLICATE_PROVIDER',

    DUPLICATE_LEDGER: 'DUPLICATE_LEDGER'

});

class SettlementReconciler {

    constructor({

        settlementRepository,

        ledgerRepository,

        reconciliationRepository,

        eventBus,

        auditService,

        logger,

        metrics,

        tracer,

        amountTolerance = DEFAULT_TOLERANCE

    } = {}) {

        this.settlementRepository =
            settlementRepository;

        this.ledgerRepository =
            ledgerRepository;

        this.reconciliationRepository =
            reconciliationRepository;

        this.eventBus =
            eventBus;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.amountTolerance =
            amountTolerance;

    }

    /**
     * =========================================================================
     * Reconcile Batch
     * =========================================================================
     */
    async reconcile({

        tenantId,

        settlementDate,

        settlements = null,

        ledgerEntries = null,

        correlationId = crypto.randomUUID()

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.settlement.reconcile'
            );

        const started = Date.now();

        try {

            settlements =
                settlements ||
                await this.loadSettlements({

                    tenantId,

                    settlementDate

                });

            ledgerEntries =
                ledgerEntries ||
                await this.loadLedgerEntries({

                    tenantId,

                    settlementDate

                });

            const result =
                await this.performReconciliation({

                    tenantId,

                    settlementDate,

                    settlements,

                    ledgerEntries,

                    correlationId

                });

            await this.persist(result);

            await this.publish(result);

            await this.auditService?.record({

                action:
                    'AIRTEL_SETTLEMENT_RECONCILED',

                tenantId,

                settlementDate,

                correlationId,

                summary:
                    result.summary

            });

            this.metrics?.counter?.(

                'payment_airtel_settlement_reconciliation_total'

            );

            this.metrics?.histogram?.(

                'payment_airtel_settlement_reconciliation_duration_ms',

                Date.now() - started

            );

            return result;

        }

        catch (error) {

            this.metrics?.counter?.(

                'payment_airtel_settlement_reconciliation_failure_total'

            );

            throw normalizeError(error, {

                message:
                    'Settlement reconciliation failed'

            });

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Core Reconciliation
     * =========================================================================
     */
    async performReconciliation({

        tenantId,

        settlementDate,

        settlements,

        ledgerEntries,

        correlationId

    }) {

        const providerIndex =
            this.buildIndex(
                settlements,
                'reference'
            );

        const ledgerIndex =
            this.buildIndex(
                ledgerEntries,
                'reference'
            );

        const matches = [];

        const exceptions = [];

        const processed =
            new Set();

        for (const settlement of settlements) {

            const reference =
                settlement.reference;

            processed.add(reference);

            const ledger =
                ledgerIndex.get(reference);

            if (!ledger) {

                exceptions.push(
                    this.createException({

                        status:
                            RESULT_STATUS.MISSING_LEDGER,

                        provider:
                            settlement

                    })
                );

                continue;

            }

            const comparison =
                this.compare(
                    settlement,
                    ledger
                );

            if (comparison.matched) {

                matches.push({

                    reference,

                    settlement,

                    ledger

                });

            } else {

                exceptions.push(
                    comparison.exception
                );

            }

        }

        for (const ledger of ledgerEntries) {

            if (
                processed.has(
                    ledger.reference
                )
            ) {
                continue;
            }

            exceptions.push(

                this.createException({

                    status:
                        RESULT_STATUS.MISSING_PROVIDER,

                    ledger

                })

            );

        }

        return {

            provider:
                'AIRTEL',

            tenantId,

            settlementDate,

            correlationId,

            completedAt:
                new Date(),

            matches,

            exceptions,

            summary: {

                matched:
                    matches.length,

                exceptions:
                    exceptions.length,

                settlements:
                    settlements.length,

                ledgerEntries:
                    ledgerEntries.length

            }

        };

    }

    /**
     * =========================================================================
     * Compare Records
     * =========================================================================
     */
    compare(provider, ledger) {

        if (
            provider.currency !==
            ledger.currency
        ) {

            return {

                matched: false,

                exception:

                    this.createException({

                        status:
                            RESULT_STATUS.VARIANCE,

                        provider,

                        ledger,

                        reason:
                            'Currency mismatch'

                    })

            };

        }

        const difference =
            Math.abs(

                Number(provider.amount) -

                Number(ledger.amount)

            );

        if (
            difference >
            this.amountTolerance
        ) {

            return {

                matched: false,

                exception:

                    this.createException({

                        status:
                            RESULT_STATUS.VARIANCE,

                        provider,

                        ledger,

                        reason:
                            'Amount mismatch',

                        difference

                    })

            };

        }

        return {

            matched: true

        };

    }

    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */
    detectDuplicates(records = []) {

        const duplicates = [];

        const seen = new Set();

        for (const record of records) {

            if (
                seen.has(record.reference)
            ) {

                duplicates.push(record);

            }

            seen.add(record.reference);

        }

        return duplicates;

    }

    /**
     * =========================================================================
     * Persist Results
     * =========================================================================
     */
    async persist(result) {

        if (
            !this.reconciliationRepository?.save
        ) {

            return;

        }

        await this.reconciliationRepository.save(
            result
        );

    }

    /**
     * =========================================================================
     * Publish Events
     * =========================================================================
     */
    async publish(result) {

        await this.eventBus?.publish({

            type:
                'AIRTEL_SETTLEMENT_RECONCILED',

            payload:
                result

        });

    }

    /**
     * =========================================================================
     * Repository Loaders
     * =========================================================================
     */
    async loadSettlements(query) {

        return this.settlementRepository?.find(

            query

        ) || [];

    }

    async loadLedgerEntries(query) {

        return this.ledgerRepository?.find(

            query

        ) || [];

    }

    /**
     * =========================================================================
     * Helpers
     * =========================================================================
     */
    buildIndex(records, field) {

        const index =
            new Map();

        for (const item of records) {

            index.set(
                item[field],
                item
            );

        }

        return index;

    }

    createException({

        status,

        provider = null,

        ledger = null,

        reason = null,

        difference = null

    }) {

        return {

            id:
                crypto.randomUUID(),

            status,

            reason,

            difference,

            provider,

            ledger,

            createdAt:
                new Date()

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {

        try {

            return {

                provider:
                    'AIRTEL',

                component:
                    'SettlementReconciler',

                status:
                    'UP',

                tolerance:
                    this.amountTolerance

            };

        }

        catch (error) {

            return {

                provider:
                    'AIRTEL',

                component:
                    'SettlementReconciler',

                status:
                    'DOWN',

                error:
                    error.message

            };

        }

    }

}

SettlementReconciler.RESULT_STATUS =
    RESULT_STATUS;

SettlementReconciler.DEFAULT_TOLERANCE =
    DEFAULT_TOLERANCE;

module.exports = SettlementReconciler;