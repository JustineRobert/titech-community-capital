'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Collection Ledger Bridge
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Enterprise adapter between the MTN Collection subsystem and the Financial
 * Ledger Engine.
 *
 * The Ledger Engine remains the single authoritative System of Record for all
 * financial activity.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Validate posting requests
 * • Prevent duplicate ledger postings
 * • Build normalized financial operations
 * • Delegate posting to Ledger Engine
 * • Record audit events
 * • Publish domain events
 * • Emit operational metrics
 * • Provide structured logging
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Create journal entries
 * ✗ Modify balances
 * ✗ Apply accounting rules
 * ✗ Update payment state
 * ✗ Perform reconciliation
 *
 * =============================================================================
 */

class LedgerBridge {

    constructor({

        ledgerEngine,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!ledgerEngine) {

            throw new Error(
                'LedgerBridge requires ledgerEngine.'
            );

        }

        this.ledgerEngine = ledgerEngine;
        this.auditService = auditService;
        this.metrics = metrics;
        this.eventBus = eventBus;
        this.logger = logger || console;

    }

    /**
     * =========================================================================
     * Post Mobile Money Collection
     * =========================================================================
     */

    async postCollection({

        tenantId,

        transaction,

        correlationId,

        idempotencyKey

    } = {}) {

        const startedAt = Date.now();

        this.#validate({

            tenantId,

            transaction

        });

        /**
         * ---------------------------------------------------------------------
         * Idempotency
         * ---------------------------------------------------------------------
         */

        if (

            transaction.ledgerPosted === true ||

            transaction.isLedgerPosted === true

        ) {

            this.logger.info?.({

                event: 'ledger.bridge.skip',

                reason: 'Already posted',

                paymentId: transaction.id,

                externalId: transaction.externalId

            });

            return {

                posted: false,

                skipped: true,

                reason: 'ALREADY_POSTED',

                transaction

            };

        }

        /**
         * ---------------------------------------------------------------------
         * Build Financial Operation
         * ---------------------------------------------------------------------
         */

        const operation = {

            type: 'MOBILE_MONEY_COLLECTION',

            provider: 'MTN',

            reference:

                transaction.externalId ||

                transaction.id,

            externalId:

                transaction.externalId,

            financialTransactionId:

                transaction.financialTransactionId,

            amount:

                transaction.amount,

            currency:

                transaction.currency,

            occurredAt:

                transaction.completedAt ||

                transaction.updatedAt ||

                new Date(),

            idempotencyKey:

                idempotencyKey ||

                transaction.externalId ||

                transaction.id,

            metadata: {

                tenantId,

                paymentId:
                    transaction.id,

                accountId:
                    transaction.accountId,

                memberId:
                    transaction.memberId,

                customerId:
                    transaction.customerId,

                groupId:
                    transaction.groupId,

                provider:
                    'MTN',

                providerStatus:
                    transaction.status,

                callbackReference:
                    transaction.financialTransactionId,

                correlationId,

                source:
                    'MTN_COLLECTION'

            }

        };

        /**
         * ---------------------------------------------------------------------
         * Ledger Posting
         * ---------------------------------------------------------------------
         */

        const result =
            await this.ledgerEngine.post({

                tenantId,

                operation

            });

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        this.metrics?.increment?.(

            'ledger.collection.post.success'

        );

        this.metrics?.observe?.(

            'ledger.collection.post.duration',

            Date.now() - startedAt

        );

        /**
         * ---------------------------------------------------------------------
         * Audit
         * ---------------------------------------------------------------------
         */

        await this.auditService?.record({

            action:
                'LEDGER_COLLECTION_POSTED',

            provider:
                'MTN',

            tenantId,

            paymentId:
                transaction.id,

            externalId:
                transaction.externalId,

            journalId:

                result?.journalId ||

                result?.id ||

                null,

            amount:
                transaction.amount,

            currency:
                transaction.currency,

            correlationId,

            timestamp:
                new Date()

        });

        /**
         * ---------------------------------------------------------------------
         * Domain Event
         * ---------------------------------------------------------------------
         */

        await this.eventBus?.publish?.({

            type:
                'ledger.collection.posted',

            provider:
                'MTN',

            tenantId,

            correlationId,

            paymentId:
                transaction.id,

            externalId:
                transaction.externalId,

            ledgerResult:
                result

        });

        /**
         * ---------------------------------------------------------------------
         * Logging
         * ---------------------------------------------------------------------
         */

        this.logger.info?.({

            event:
                'ledger.bridge.completed',

            tenantId,

            paymentId:
                transaction.id,

            externalId:
                transaction.externalId,

            journalId:

                result?.journalId ||

                result?.id ||

                null,

            duration:
                Date.now() - startedAt

        });

        return result;

    }

    /**
     * =========================================================================
     * Validate Request
     * =========================================================================
     */

    #validate({

        tenantId,

        transaction

    }) {

        if (!tenantId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId is required.',

                400

            );

        }

        if (!transaction) {

            throw this.#error(

                'VALIDATION_ERROR',

                'transaction is required.',

                400

            );

        }

        const required = [

            'id',

            'amount'

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

                'VALIDATION_ERROR',

                `Missing transaction fields: ${missing.join(', ')}`,

                400

            );

        }

        if (

            typeof transaction.amount !== 'number' ||

            transaction.amount <= 0

        ) {

            throw this.#error(

                'INVALID_AMOUNT',

                'Transaction amount must be greater than zero.',

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

        error.name = 'LedgerBridgeError';
        error.code = code;
        error.statusCode = statusCode;

        return error;

    }

}

module.exports = LedgerBridge;