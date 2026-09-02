'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Payment State Updater
 * =============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Locate payment transaction
 * • Validate callback state transition
 * • Execute state machine transition
 * • Persist updated payment state
 * • Maintain audit metadata
 * • Support idempotent callback processing
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Verify callback signatures
 * ✗ Validate callback schema
 * ✗ Post ledger entries
 * ✗ Perform reconciliation
 * ✗ Execute business rules outside payment state management
 *
 * =============================================================================
 */

class PaymentStateUpdater {

    constructor({

        repository,

        stateMachine,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!repository) {
            throw new Error(
                'PaymentStateUpdater requires repository.'
            );
        }

        if (!stateMachine) {
            throw new Error(
                'PaymentStateUpdater requires stateMachine.'
            );
        }

        this.repository = repository;
        this.stateMachine = stateMachine;
        this.auditService = auditService;
        this.metrics = metrics;
        this.eventBus = eventBus;
        this.logger = logger || console;
    }

    /**
     * =========================================================================
     * Update Payment State
     * =========================================================================
     */

    async update(callback = {}) {

        const startedAt = Date.now();

        const externalId = callback.externalId;
        const nextStatus = this.#normalizeStatus(callback.status);

        if (!externalId) {
            throw this.#error(
                'INVALID_CALLBACK',
                'Callback externalId is required.',
                400
            );
        }

        if (!nextStatus) {
            throw this.#error(
                'INVALID_STATUS',
                'Callback status is required.',
                400
            );
        }

        this.logger.info?.({

            event: 'payment.state.lookup',

            externalId,

            nextStatus

        });

        /**
         * ----------------------------------------------------------------------
         * Lookup Transaction
         * ----------------------------------------------------------------------
         */

        const transaction =
            await this.repository.findByExternalId(
                externalId
            );

        if (!transaction) {

            throw this.#error(

                'PAYMENT_NOT_FOUND',

                `Payment transaction '${externalId}' was not found.`,

                404

            );

        }

        /**
         * ----------------------------------------------------------------------
         * Idempotency
         * ----------------------------------------------------------------------
         */

        const currentStatus =
            this.#normalizeStatus(
                transaction.status
            );

        if (currentStatus === nextStatus) {

            this.logger.info?.({

                event: 'payment.state.idempotent',

                transactionId: transaction.id,

                externalId,

                status: currentStatus

            });

            return transaction;

        }

        /**
         * ----------------------------------------------------------------------
         * State Machine Transition
         * ----------------------------------------------------------------------
         */

        const updatedTransaction =
            await this.stateMachine.transition({

                transaction,

                id: transaction.id,

                currentStatus,

                nextStatus,

                callback

            });

        /**
         * ----------------------------------------------------------------------
         * Persist Updated State
         * ----------------------------------------------------------------------
         */

        let persisted = updatedTransaction;

        if (this.repository.updateStatus) {

            persisted =
                await this.repository.updateStatus({

                    id: transaction.id,

                    status: nextStatus,

                    callbackReference:
                        callback.financialTransactionId,

                    providerReference:
                        callback.financialTransactionId,

                    providerStatus:
                        callback.status,

                    updatedAt: new Date()

                });

        }

        /**
         * ----------------------------------------------------------------------
         * Audit
         * ----------------------------------------------------------------------
         */

        await this.auditService?.record({

            action: 'PAYMENT_STATE_UPDATED',

            paymentId: transaction.id,

            externalId,

            previousStatus: currentStatus,

            newStatus: nextStatus,

            provider: 'MTN',

            timestamp: new Date()

        });

        /**
         * ----------------------------------------------------------------------
         * Metrics
         * ----------------------------------------------------------------------
         */

        this.metrics?.increment?.(
            'payment.state.updated'
        );

        this.metrics?.observe?.(
            'payment.state.update.duration',
            Date.now() - startedAt
        );

        /**
         * ----------------------------------------------------------------------
         * Domain Event
         * ----------------------------------------------------------------------
         */

        await this.eventBus?.publish?.({

            type: 'payment.state.updated',

            paymentId: transaction.id,

            externalId,

            previousStatus: currentStatus,

            newStatus: nextStatus,

            provider: 'MTN'

        });

        this.logger.info?.({

            event: 'payment.state.updated',

            paymentId: transaction.id,

            externalId,

            previousStatus: currentStatus,

            newStatus: nextStatus,

            duration:
                Date.now() - startedAt

        });

        return persisted;

    }

    /**
     * =========================================================================
     * Normalize Status
     * =========================================================================
     */

    #normalizeStatus(status) {

        if (
            status === undefined ||
            status === null
        ) {
            return null;
        }

        return String(status)
            .trim()
            .toUpperCase();

    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    #error(code, message, statusCode = 500) {

        const error = new Error(message);

        error.name = 'PaymentStateUpdateError';
        error.code = code;
        error.statusCode = statusCode;

        return error;

    }

}

module.exports = PaymentStateUpdater;