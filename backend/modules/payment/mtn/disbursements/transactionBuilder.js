'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Transaction Builder
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Builds normalized MTN MoMo outbound disbursement payloads.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Generate MTN transfer payloads
 * • Normalize beneficiary information
 * • Generate transaction identifiers
 * • Apply configuration defaults
 * • Enrich transaction metadata
 * • Validate required disbursement fields
 * • Support distributed tracing identifiers
 * • Produce immutable outbound payloads
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Call MTN APIs
 * ✗ Authenticate requests
 * ✗ Validate approval workflows
 * ✗ Perform fraud checks
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
     * Build MTN Disbursement Payload
     * =========================================================================
     */


    build({

        reference,

        beneficiary,

        amount,

        currency = 'UGX',

        metadata = {},

        transactionId,

        correlationId,

        tenantId

    } = {}) {



        this.#validate({

            reference,

            beneficiary,

            amount

        });




        const normalizedAmount =

            this.#normalizeAmount(

                amount

            );



        const normalizedCurrency =

            String(currency)

                .trim()

                .toUpperCase();




        const normalizedBeneficiary =

            this.#normalizeBeneficiary(

                beneficiary

            );




        const payload = {


            reference,


            amount:

                normalizedAmount,



            currency:

                normalizedCurrency,



            payee:

                normalizedBeneficiary,



            payerMessage:

                metadata.message ||

                this.configuration.defaultPayerMessage ||

                'TITech Community Capital payout',



            payeeNote:

                metadata.note ||

                this.configuration.defaultPayeeNote ||

                'Disbursement payment'


        };




        const transaction = {


            transactionId:

                transactionId ||

                crypto.randomUUID(),



            correlationId:

                correlationId ||

                crypto.randomUUID(),



            tenantId:

                tenantId || null,



            provider:

                'MTN',



            operation:

                'DISBURSEMENT',



            createdAt:

                this.clock()

                    .toISOString(),



            payload,



            metadata: {


                ...metadata,



                provider:

                    'MTN',



                reference,


                operation:

                    'DISBURSEMENT',



                transactionId:

                    transactionId || null


            }


        };




        Object.freeze(payload.payee);

        Object.freeze(payload);

        Object.freeze(transaction.metadata);



        this.logger.info?.({

            event:

                'mtn.disbursement.payload.built',



            reference,


            transactionId:

                transaction.transactionId,



            correlationId:

                transaction.correlationId,



            amount:

                normalizedAmount,



            currency:

                normalizedCurrency


        });




        return Object.freeze(transaction);


    }





    /**
     * =========================================================================
     * Validate Required Fields
     * =========================================================================
     */


    #validate({

        reference,

        beneficiary,

        amount

    }) {



        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Disbursement reference is required.',

                400

            );


        }




        if (!beneficiary) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Beneficiary is required.',

                400

            );


        }




        if (!beneficiary.partyId) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Beneficiary partyId is required.',

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


    }





    /**
     * =========================================================================
     * Normalize Beneficiary
     * =========================================================================
     */


    #normalizeBeneficiary(beneficiary) {



        return {


            partyIdType:


                String(

                    beneficiary.partyIdType ||

                    this.configuration.defaultPartyIdType ||

                    'MSISDN'

                )

                .toUpperCase(),




            partyId:

                this.#normalizeMsisdn(

                    beneficiary.partyId

                )


        };


    }





    /**
     * =========================================================================
     * Normalize Mobile Number
     * =========================================================================
     */


    #normalizeMsisdn(value) {



        return String(value)

            .replace(/\s+/g, '')

            .replace(/-/g, '');


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


    #error(

        code,

        message,

        statusCode = 500

    ) {



        const error =

            new Error(message);



        error.name =

            'DisbursementTransactionBuilderError';



        error.code =

            code;



        error.statusCode =

            statusCode;



        return error;


    }


}



module.exports = TransactionBuilder;