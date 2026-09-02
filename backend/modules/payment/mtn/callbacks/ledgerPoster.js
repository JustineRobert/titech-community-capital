'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Ledger Poster
 * =============================================================================
 *
 * Enterprise Financial Posting Adapter
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Prepare ledger posting requests
 * • Enforce posting prerequisites
 * • Prevent duplicate financial postings
 * • Delegate posting to Ledger Engine
 * • Emit audit events
 * • Publish financial events
 * • Record metrics
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Calculate journal entries
 * ✗ Execute accounting rules
 * ✗ Update payment state
 * ✗ Perform reconciliation
 * ✗ Verify callback signatures
 *
 * The Ledger Engine remains the authoritative System of Record.
 * =============================================================================
 */

class LedgerPoster {

    constructor({

        ledgerEngine,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!ledgerEngine) {
            throw new Error(
                'LedgerPoster requires ledgerEngine.'
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
     * Post Settlement
     * =========================================================================
     */

    async post(transaction = {}) {

        const startedAt = Date.now();

        this.#validateTransaction(transaction);

        /**
         * ----------------------------------------------------------------------
         * Idempotency
         * ----------------------------------------------------------------------
         * If the repository marks a transaction as already posted,
         * skip duplicate financial posting.
         */

        if (
            transaction.ledgerPosted === true ||
            transaction.isLedgerPosted === true
        ) {

            this.logger.info?.({

                event: 'ledger.post.skipped',

                paymentId: transaction.id,

                reference: transaction.externalId,

                reason: 'Already posted'

            });

            return {

                posted: false,

                skipped: true,

                reason: 'ALREADY_POSTED',

                transaction

            };

        }

        /**
         * ----------------------------------------------------------------------
         * Build Ledger Operation
         * ----------------------------------------------------------------------
         */

        const operation = {

            type: 'MTN_PAYMENT_SETTLEMENT',

            provider: 'MTN',

            reference:
                transaction.externalId,

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

            metadata: {

                paymentId:
                    transaction.id,

                tenantId:
                    transaction.tenantId,

                accountId:
                    transaction.accountId,

                customerId:
                    transaction.customerId,

                provider:
                    'MTN',

                callbackReference:
                    transaction.financialTransactionId

            }

        };

        /**
         * ----------------------------------------------------------------------
         * Financial Posting
         * ----------------------------------------------------------------------
         */

        const result =
            await this.ledgerEngine.post({

                tenantId:
                    transaction.tenantId,

                operation

            });

        /**
         * ----------------------------------------------------------------------
         * Metrics
         * ----------------------------------------------------------------------
         */

        this.metrics?.increment?.(

            'ledger.post.success'

        );

        this.metrics?.observe?.(

            'ledger.post.duration',

            Date.now() - startedAt

        );

        /**
         * ----------------------------------------------------------------------
         * Audit
         * ----------------------------------------------------------------------
         */

        await this.auditService?.record({

            action: 'LEDGER_POSTED',

            provider: 'MTN',

            tenantId:
                transaction.tenantId,

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

            timestamp:
                new Date()

        });

        /**
         * ----------------------------------------------------------------------
         * Domain Event
         * ----------------------------------------------------------------------
         */

        await this.eventBus?.publish?.({

            type: 'ledger.post.completed',

            provider: 'MTN',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            externalId:
                transaction.externalId,

            result

        });

        this.logger.info?.({

            event: 'ledger.post.completed',

            tenantId:
                transaction.tenantId,

            paymentId:
                transaction.id,

            externalId:
                transaction.externalId,

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

            'tenantId',

            'externalId',

            'amount'

        ];

        const missing = [];

        for (const field of required) {

            const value = transaction[field];

            if (
                value === undefined ||
                value === null ||
                value === ''
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

        error.name = 'LedgerPostingError';
        error.code = code;
        error.statusCode = statusCode;

        return error;

    }

}

module.exports = LedgerPoster;