'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Reconciliation Matcher
 * =============================================================================
 *
 * Enterprise Reconciliation Adapter
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Create reconciliation records
 * • Prevent duplicate reconciliation
 * • Record settlement metadata
 * • Publish reconciliation events
 * • Emit audit records
 * • Record reconciliation metrics
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Perform ledger posting
 * ✗ Update payment state
 * ✗ Verify callback signatures
 * ✗ Execute settlement algorithms
 * ✗ Generate accounting entries
 *
 * The Financial Reconciliation Engine remains the authoritative reconciliation
 * service. This component simply records successful callback reconciliation.
 *
 * =============================================================================
 */

class ReconciliationMatcher {

    constructor({

        repository,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!repository) {

            throw new Error(
                'ReconciliationMatcher requires repository.'
            );

        }

        this.repository = repository;
        this.auditService = auditService;
        this.metrics = metrics;
        this.eventBus = eventBus;
        this.logger = logger || console;

    }

    /**
     * =========================================================================
     * Match Transaction
     * =========================================================================
     */

    async match(transaction = {}) {

        const startedAt = Date.now();

        this.#validateTransaction(transaction);

        const reconciliationReference =
            transaction.financialTransactionId ||
            transaction.externalId;

        /**
         * ---------------------------------------------------------------------
         * Duplicate Detection
         * ---------------------------------------------------------------------
         */

        if (this.repository.findByTransactionId) {

            const existing =
                await this.repository.findByTransactionId(
                    reconciliationReference
                );

            if (existing) {

                this.logger.info?.({

                    event: 'reconciliation.duplicate',

                    transactionId:
                        reconciliationReference,

                    reconciliationId:
                        existing.id

                });

                return {

                    matched: true,

                    duplicate: true,

                    reconciliation: existing

                };

            }

        }

        /**
         * ---------------------------------------------------------------------
         * Create Reconciliation Record
         * ---------------------------------------------------------------------
         */

        const reconciliation = {

            provider: 'MTN',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            transactionId:
                reconciliationReference,

            externalId:
                transaction.externalId,

            providerTransactionId:
                transaction.financialTransactionId,

            amount:
                transaction.amount,

            currency:
                transaction.currency,

            matched: true,

            status: 'MATCHED',

            matchedAt: new Date(),

            settlementDate:
                transaction.completedAt ||
                transaction.updatedAt ||
                new Date(),

            metadata: {

                provider: 'MTN',

                callbackReference:
                    transaction.financialTransactionId,

                paymentStatus:
                    transaction.status

            }

        };

        const result =
            await this.repository.create(
                reconciliation
            );

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        this.metrics?.increment?.(
            'reconciliation.match.success'
        );

        this.metrics?.observe?.(
            'reconciliation.match.duration',
            Date.now() - startedAt
        );

        /**
         * ---------------------------------------------------------------------
         * Audit
         * ---------------------------------------------------------------------
         */

        await this.auditService?.record({

            action: 'RECONCILIATION_MATCHED',

            provider: 'MTN',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            transactionId:
                reconciliationReference,

            amount:
                transaction.amount,

            currency:
                transaction.currency,

            reconciliationId:
                result?.id,

            timestamp:
                new Date()

        });

        /**
         * ---------------------------------------------------------------------
         * Domain Event
         * ---------------------------------------------------------------------
         */

        await this.eventBus?.publish?.({

            type: 'payment.reconciliation.completed',

            provider: 'MTN',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            reconciliationId:
                result?.id,

            transactionId:
                reconciliationReference

        });

        this.logger.info?.({

            event: 'reconciliation.completed',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            transactionId:
                reconciliationReference,

            duration:
                Date.now() - startedAt

        });

        return result;

    }

    /**
     * =========================================================================
     * Validate Transaction
     * =========================================================================
     */

    #validateTransaction(transaction) {

        if (!transaction) {

            throw this.#error(

                'INVALID_TRANSACTION',

                'Transaction is required.',

                400

            );

        }

        const required = [

            'externalId',

            'tenantId'

        ];

        const missing = [];

        for (const field of required) {

            if (

                transaction[field] === undefined ||

                transaction[field] === null ||

                transaction[field] === ''

            ) {

                missing.push(field);

            }

        }

        if (missing.length) {

            throw this.#error(

                'INVALID_TRANSACTION',

                `Missing required fields: ${missing.join(', ')}`,

                400

            );

        }

    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    #error(code, message, statusCode = 500) {

        const error = new Error(message);

        error.name = 'ReconciliationError';
        error.code = code;
        error.statusCode = statusCode;

        return error;

    }

}

module.exports = ReconciliationMatcher;