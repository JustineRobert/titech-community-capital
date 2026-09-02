'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Processing Engine
 * =============================================================================
 *
 * Enterprise Callback Orchestration Layer
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Verify callback authenticity
 * • Validate callback payload
 * • Execute payment state transition
 * • Post financial transactions
 * • Trigger reconciliation
 * • Publish audit events
 * • Capture processing metrics
 * • Route failures to Dead Letter Queue
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Perform HTTP handling
 * ✗ Persist callback transport
 * ✗ Contain payment business rules
 * ✗ Implement ledger logic
 * ✗ Implement reconciliation algorithms
 *
 * Processing Pipeline
 * -----------------------------------------------------------------------------
 * Controller
 *      │
 *      ▼
 * Signature Verification
 *      │
 *      ▼
 * Payload Validation
 *      │
 *      ▼
 * Payment State Update
 *      │
 *      ▼
 * Ledger Posting
 *      │
 *      ▼
 * Reconciliation
 *      │
 *      ▼
 * Audit
 *      │
 *      ▼
 * Success Response
 *
 * =============================================================================
 */

const crypto = require('crypto');

class CallbackProcessor {

    constructor({

        signatureVerifier,

        validator,

        stateUpdater,

        ledgerPoster,

        reconciliationMatcher,

        deadLetterQueue,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!signatureVerifier) {
            throw new Error(
                'CallbackProcessor requires signatureVerifier.'
            );
        }

        if (!validator) {
            throw new Error(
                'CallbackProcessor requires validator.'
            );
        }

        if (!stateUpdater) {
            throw new Error(
                'CallbackProcessor requires stateUpdater.'
            );
        }

        this.signatureVerifier = signatureVerifier;
        this.validator = validator;
        this.stateUpdater = stateUpdater;
        this.ledgerPoster = ledgerPoster;
        this.reconciliationMatcher = reconciliationMatcher;
        this.deadLetterQueue = deadLetterQueue;
        this.auditService = auditService;
        this.metrics = metrics;
        this.eventBus = eventBus;
        this.logger = logger || console;
    }

    /**
     * =========================================================================
     * Process MTN Callback
     * =========================================================================
     */

    async process({

        headers = {},

        payload = {},

        correlationId = null,

        provider = 'MTN'

    } = {}) {

        const startedAt = Date.now();

        const callbackId =
            payload.externalId ||
            payload.financialTransactionId ||
            crypto.randomUUID();

        const signature =
            headers['x-mtn-signature'] ||
            headers['x-signature'] ||
            headers['signature'];

        try {

            this.logger.info?.({

                event: 'mtn.callback.received',

                callbackId,

                correlationId,

                provider

            });

            /**
             * --------------------------------------------------------------
             * Signature Verification
             * --------------------------------------------------------------
             */

            const verification =
                this.signatureVerifier.verify({

                    payload,

                    signature

                });

            const verified =
                typeof verification === 'boolean'
                    ? verification
                    : verification.valid;

            if (!verified) {

                throw this.#processingError(

                    'INVALID_SIGNATURE',

                    'MTN callback signature verification failed.',

                    401

                );

            }

            /**
             * --------------------------------------------------------------
             * Payload Validation
             * --------------------------------------------------------------
             */

            const validation =
                this.validator.validate(payload);

            const normalizedPayload =
                validation.payload || payload;

            /**
             * --------------------------------------------------------------
             * Payment State Update
             * --------------------------------------------------------------
             */

            const transaction =
                await this.stateUpdater.update(

                    normalizedPayload

                );

            /**
             * --------------------------------------------------------------
             * Ledger Posting
             * --------------------------------------------------------------
             */

            if (this.#isSuccessful(normalizedPayload.status)) {

                await this.ledgerPoster?.post(

                    transaction

                );

            }

            /**
             * --------------------------------------------------------------
             * Reconciliation
             * --------------------------------------------------------------
             */

            await this.reconciliationMatcher?.match(

                transaction

            );

            /**
             * --------------------------------------------------------------
             * Audit Trail
             * --------------------------------------------------------------
             */

            await this.auditService?.record({

                action: 'MTN_CALLBACK_PROCESSED',

                provider,

                callbackId,

                correlationId,

                transactionId:

                    transaction?.id ||

                    transaction?._id ||

                    normalizedPayload.financialTransactionId,

                externalId:

                    normalizedPayload.externalId,

                status:

                    normalizedPayload.status,

                timestamp:

                    new Date()

            });

            /**
             * --------------------------------------------------------------
             * Metrics
             * --------------------------------------------------------------
             */

            this.metrics?.increment?.(

                'payment.callback.success'

            );

            this.metrics?.observe?.(

                'payment.callback.duration',

                Date.now() - startedAt

            );

            /**
             * --------------------------------------------------------------
             * Domain Event
             * --------------------------------------------------------------
             */

            await this.eventBus?.publish?.({

                type: 'payment.callback.processed',

                provider,

                callbackId,

                correlationId,

                transaction

            });

            this.logger.info?.({

                event: 'mtn.callback.completed',

                callbackId,

                correlationId,

                duration:

                    Date.now() - startedAt

            });

            return {

                id:

                    normalizedPayload.externalId,

                callbackId,

                transaction,

                processed: true

            };

        }

        catch (error) {

            this.metrics?.increment?.(

                'payment.callback.failure'

            );

            this.logger.error?.({

                event: 'mtn.callback.failed',

                callbackId,

                correlationId,

                message:

                    error.message,

                code:

                    error.code,

                stack:

                    error.stack

            });

            try {

                await this.deadLetterQueue?.store({

                    provider,

                    callbackId,

                    correlationId,

                    payload,

                    headers,

                    error: {

                        message:

                            error.message,

                        code:

                            error.code,

                        stack:

                            error.stack

                    },

                    failedAt:

                        new Date()

                });

            }

            catch (dlqError) {

                this.logger.error?.({

                    event: 'mtn.callback.dlq.failure',

                    callbackId,

                    message:

                        dlqError.message

                });

            }

            throw error;

        }

    }

    /**
     * =========================================================================
     * Successful Status Detection
     * =========================================================================
     */

    #isSuccessful(status) {

        if (!status) {
            return false;
        }

        const normalized =
            String(status)
                .trim()
                .toUpperCase();

        return [

            'SUCCESS',

            'SUCCESSFUL',

            'COMPLETED'

        ].includes(normalized);

    }

    /**
     * =========================================================================
     * Processing Error Factory
     * =========================================================================
     */

    #processingError(code, message, statusCode = 500) {

        const error = new Error(message);

        error.name = 'CallbackProcessingError';
        error.code = code;
        error.statusCode = statusCode;

        return error;

    }

}

module.exports = CallbackProcessor;