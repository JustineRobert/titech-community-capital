'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Collection Transaction Builder
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Build MTN Request-To-Pay payloads
 * • Normalize provider payloads
 * • Generate request identifiers
 * • Generate provider references
 * • Validate required fields
 * • Normalize MSISDN numbers
 * • Apply configuration defaults
 * • Enrich metadata
 * • Prepare idempotent payloads
 * • Produce immutable transaction payloads
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Call MTN APIs
 * ✗ Authenticate requests
 * ✗ Validate business rules
 * ✗ Perform fraud detection
 * ✗ Update payment state
 * ✗ Post ledger entries
 *
 * =============================================================================
 */

const crypto = require('crypto');

class TransactionBuilder {

    constructor({

        configuration = {},

        logger,

        clock = () => new Date()

    } = {}) {

        this.configuration = configuration;

        this.logger = logger || console;

        this.clock = clock;

    }

    /**
     * =========================================================================
     * Build Request-To-Pay Payload
     * =========================================================================
     */

    build({

        externalId,

        payer,

        amount,

        currency,

        callbackUrl,

        metadata = {},

        requestId,

        correlationId,

        tenantId

    } = {}) {

        this.#validate({

            externalId,

            payer,

            amount,

            currency

        });

        const providerCallbackUrl =
            callbackUrl ||
            this.configuration.callbackUrl ||
            this.configuration.providerCallbackUrl;

        const normalizedAmount =
            this.#normalizeAmount(amount);

        const normalizedCurrency =
            String(currency).trim().toUpperCase();

        const normalizedPayer =
            this.#normalizePayer(payer);

        const payload = {

            amount: normalizedAmount,

            currency: normalizedCurrency,

            externalId,

            payer: normalizedPayer,

            payerMessage:
                metadata.message ||
                this.configuration.defaultPayerMessage ||
                'TITech payment request',

            payeeNote:
                metadata.note ||
                this.configuration.defaultPayeeNote ||
                'Community savings contribution'

        };

        if (providerCallbackUrl) {
            payload.callbackUrl = providerCallbackUrl;
        }

        const transaction = {

            requestId:
                requestId || crypto.randomUUID(),

            correlationId:
                correlationId || crypto.randomUUID(),

            createdAt:
                this.clock().toISOString(),

            tenantId:
                tenantId || null,

            provider:
                'MTN',

            providerOperation:
                'REQUEST_TO_PAY',

            payload,

            metadata: {

                ...metadata,

                provider: 'MTN',

                externalId,

                requestId:
                    requestId || null

            }

        };

        Object.freeze(payload.payer);
        Object.freeze(payload);
        Object.freeze(transaction.metadata);

        this.logger.info?.({

            event: 'mtn.collection.payload.built',

            externalId,

            requestId: transaction.requestId,

            correlationId: transaction.correlationId,

            currency: normalizedCurrency,

            amount: normalizedAmount

        });

        return Object.freeze(transaction);

    }

    /**
     * =========================================================================
     * Validate Input
     * =========================================================================
     */

    #validate({

        externalId,

        payer,

        amount,

        currency

    }) {

        if (!externalId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'externalId is required.',

                400

            );

        }

        if (!payer || typeof payer !== 'object') {

            throw this.#error(

                'VALIDATION_ERROR',

                'payer is required.',

                400

            );

        }

        if (!payer.partyId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'payer.partyId is required.',

                400

            );

        }

        if (

            amount === undefined ||

            amount === null ||

            Number(amount) <= 0 ||

            Number.isNaN(Number(amount))

        ) {

            throw this.#error(

                'VALIDATION_ERROR',

                'Amount must be greater than zero.',

                400

            );

        }

        if (!currency) {

            throw this.#error(

                'VALIDATION_ERROR',

                'Currency is required.',

                400

            );

        }

    }

    /**
     * =========================================================================
     * Normalize Payer
     * =========================================================================
     */

    #normalizePayer(payer) {

        return {

            partyIdType:

                String(

                    payer.partyIdType ||

                    this.configuration.defaultPartyIdType ||

                    'MSISDN'

                ).toUpperCase(),

            partyId:

                this.#normalizeMsisdn(

                    payer.partyId

                )

        };

    }

    /**
     * =========================================================================
     * Normalize MSISDN
     * =========================================================================
     */

    #normalizeMsisdn(msisdn) {

        const value =

            String(msisdn)

                .replace(/\s+/g, '')

                .replace(/-/g, '');

        return value;

    }

    /**
     * =========================================================================
     * Normalize Amount
     * =========================================================================
     */

    #normalizeAmount(amount) {

        return Number(amount)

            .toFixed(2);

    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    #error(code, message, statusCode = 500) {

        const error = new Error(message);

        error.name =
            'TransactionBuilderError';

        error.code =
            code;

        error.statusCode =
            statusCode;

        return error;

    }

}

module.exports = TransactionBuilder;