'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Dead Letter Queue
 * =============================================================================
 *
 * Enterprise Dead Letter Queue (DLQ)
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Persist failed callback processing attempts
 * • Prevent duplicate DLQ records (when supported)
 * • Capture failure diagnostics
 * • Store callback payload for replay
 * • Emit audit events
 * • Publish failure events
 * • Record operational metrics
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Retry processing
 * ✗ Validate callbacks
 * ✗ Verify signatures
 * ✗ Update payment state
 * ✗ Post ledger entries
 * ✗ Perform reconciliation
 *
 * Retry orchestration belongs to the Callback Retry Engine.
 * =============================================================================
 */

const crypto = require('crypto');

class CallbackDeadLetterQueue {

    constructor({

        repository,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!repository) {
            throw new Error(
                'CallbackDeadLetterQueue requires repository.'
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
     * Store Failed Callback
     * =========================================================================
     */

    async store({

        payload = {},

        headers = {},

        error,

        provider = 'MTN',

        callbackId,

        correlationId,

        retryCount = 0

    } = {}) {

        const startedAt = Date.now();

        const externalId =
            payload.externalId || null;

        const financialTransactionId =
            payload.financialTransactionId || null;

        const id =
            callbackId ||
            externalId ||
            financialTransactionId ||
            crypto.randomUUID();

        /**
         * ----------------------------------------------------------------------
         * Duplicate Detection
         * ----------------------------------------------------------------------
         */

        if (this.repository.findByCallbackId) {

            const existing =
                await this.repository.findByCallbackId(id);

            if (existing) {

                this.logger.info?.({

                    event: 'callback.dlq.duplicate',

                    callbackId: id

                });

                return existing;

            }

        }

        /**
         * ----------------------------------------------------------------------
         * Build DLQ Record
         * ----------------------------------------------------------------------
         */

        const record = {

            callbackId: id,

            provider,

            correlationId,

            externalId,

            financialTransactionId,

            payload,

            headers,

            status: 'FAILED_REPROCESSING_REQUIRED',

            retryCount,

            createdAt: new Date(),

            lastFailureAt: new Date(),

            error: {

                name:
                    error?.name || 'Error',

                code:
                    error?.code || null,

                message:
                    error?.message || String(error),

                stack:
                    error?.stack || null

            }

        };

        const result =
            await this.repository.create(record);

        /**
         * ----------------------------------------------------------------------
         * Metrics
         * ----------------------------------------------------------------------
         */

        this.metrics?.increment?.(
            'callback.dlq.created'
        );

        this.metrics?.observe?.(
            'callback.dlq.store.duration',
            Date.now() - startedAt
        );

        /**
         * ----------------------------------------------------------------------
         * Audit
         * ----------------------------------------------------------------------
         */

        await this.auditService?.record({

            action: 'CALLBACK_DLQ_CREATED',

            provider,

            callbackId: id,

            correlationId,

            externalId,

            financialTransactionId,

            reason:
                record.error.message,

            timestamp: new Date()

        });

        /**
         * ----------------------------------------------------------------------
         * Publish Event
         * ----------------------------------------------------------------------
         */

        await this.eventBus?.publish?.({

            type: 'payment.callback.dead_letter.created',

            provider,

            callbackId: id,

            correlationId,

            externalId,

            financialTransactionId,

            retryCount

        });

        /**
         * ----------------------------------------------------------------------
         * Logging
         * ----------------------------------------------------------------------
         */

        this.logger.error?.({

            event: 'callback.dlq.created',

            callbackId: id,

            correlationId,

            externalId,

            provider,

            retryCount,

            error:
                record.error.message,

            duration:
                Date.now() - startedAt

        });

        return result;

    }

}

module.exports = CallbackDeadLetterQueue;