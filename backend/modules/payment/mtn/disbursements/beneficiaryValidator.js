'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Beneficiary Validation Engine
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Validates MTN MoMo disbursement beneficiaries before any outbound payment
 * request is submitted.
 *
 * Beneficiary validation is a critical financial control preventing:
 *
 * • Payments to invalid accounts
 * • Payments to blacklisted recipients
 * • Fraudulent beneficiary changes
 * • Incorrect mobile money routing
 * • Unauthorized payout destinations
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Validate beneficiary identity information
 * • Validate mobile money identifiers
 * • Validate party type
 * • Check blacklist records
 * • Execute configurable validation rules
 * • Produce audit evidence
 * • Support KYC/AML integration
 * • Support risk scoring engines
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN transactions
 * ✗ Approve payments
 * ✗ Perform ledger operations
 * ✗ Modify beneficiary records
 *
 * =============================================================================
 */



class BeneficiaryValidator {



    constructor({

        blacklist,

        kycService,

        amlService,

        rules = [],

        auditService,

        eventBus,

        metrics,

        logger,

        configuration = {}

    } = {}) {



        this.blacklist = blacklist;

        this.kycService = kycService;

        this.amlService = amlService;

        this.rules = rules;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;

        this.configuration = configuration;


    }








    /**
     * =========================================================================
     * Validate Beneficiary
     * =========================================================================
     */


    async validate({

        tenantId,

        beneficiary,

        context = {}

    } = {}) {



        const startedAt = Date.now();




        try {



            this.#validateStructure(

                beneficiary

            );







            /**
             * -----------------------------------------------------------------
             * 1. Validate mobile money identifier
             * -----------------------------------------------------------------
             */


            this.#validatePartyIdentifier(

                beneficiary

            );








            /**
             * -----------------------------------------------------------------
             * 2. Blacklist verification
             * -----------------------------------------------------------------
             */


            const blocked =

                await this.blacklist?.contains?.(

                    beneficiary.partyId

                );






            if (blocked) {



                await this.#blocked({

                    tenantId,

                    beneficiary,

                    reason:

                        'BENEFICIARY_BLACKLISTED'


                });





                throw this.#validationError(

                    'Beneficiary blocked'

                );


            }








            /**
             * -----------------------------------------------------------------
             * 3. KYC verification
             * -----------------------------------------------------------------
             */


            if (this.kycService?.verify) {



                const verified =

                    await this.kycService.verify({

                        beneficiary,

                        tenantId

                    });





                if (!verified.allowed) {



                    throw this.#validationError(

                        verified.reason ||

                        'Beneficiary KYC validation failed'

                    );


                }


            }








            /**
             * -----------------------------------------------------------------
             * 4. AML screening
             * -----------------------------------------------------------------
             */


            if (this.amlService?.screen) {



                const result =

                    await this.amlService.screen({

                        beneficiary,

                        tenantId

                    });





                if (result.blocked) {



                    throw this.#validationError(

                        'Beneficiary AML screening failed'

                    );


                }


            }








            /**
             * -----------------------------------------------------------------
             * 5. Custom validation rules
             * -----------------------------------------------------------------
             */


            for (const rule of this.#orderedRules()) {



                const result =

                    await rule.evaluate({

                        tenantId,

                        beneficiary,

                        ...context

                    });





                if (

                    result &&

                    result.allowed === false

                ) {



                    throw this.#validationError(

                        result.reason ||

                        'Beneficiary rejected by validation rule'

                    );


                }


            }








            this.metrics?.increment?.(

                'mtn.disbursement.beneficiary.validation.success'

            );





            this.metrics?.observe?.(

                'mtn.disbursement.beneficiary.validation.duration',

                Date.now() - startedAt

            );







            return {


                valid: true,


                beneficiaryId:

                    beneficiary.partyId



            };





        }


        catch(error) {



            this.metrics?.increment?.(

                'mtn.disbursement.beneficiary.validation.failed'

            );




            this.logger.warn?.({

                event:

                    'mtn.beneficiary.validation.failed',



                tenantId,


                beneficiary:

                    beneficiary?.partyId,


                error:

                    error.message



            });





            throw error;


        }


    }








    /**
     * =========================================================================
     * Structure Validation
     * =========================================================================
     */


    #validateStructure(beneficiary) {



        if (!beneficiary) {



            throw this.#validationError(

                'Beneficiary object required'

            );


        }






        if (!beneficiary.partyId) {



            throw this.#validationError(

                'Beneficiary identifier required'

            );


        }


    }








    /**
     * =========================================================================
     * Party Identifier Validation
     * =========================================================================
     */


    #validatePartyIdentifier(beneficiary) {



        const type =

            beneficiary.partyIdType ||

            'MSISDN';






        if (

            type === 'MSISDN' &&

            !/^[0-9]{8,15}$/

                .test(

                    String(

                        beneficiary.partyId

                    )

                )

        ) {



            throw this.#validationError(

                'Invalid MSISDN format'

            );


        }


    }








    /**
     * =========================================================================
     * Ordered Rules
     * =========================================================================
     */


    #orderedRules() {



        return [

            ...this.rules

        ].sort(

            (a, b) =>

                (b.priority || 0) -

                (a.priority || 0)

        );


    }








    /**
     * =========================================================================
     * Block Event Handler
     * =========================================================================
     */


    async #blocked({

        tenantId,

        beneficiary,

        reason

    }) {



        await this.auditService?.record({

            action:

                'MTN_BENEFICIARY_BLOCKED',



            tenantId,


            beneficiaryId:

                beneficiary.partyId,


            reason,


            timestamp:

                new Date()


        });





        await this.eventBus?.publish?.({

            type:

                'MTN_BENEFICIARY_BLOCKED',



            payload: {


                tenantId,


                beneficiaryId:

                    beneficiary.partyId,


                reason



            }


        });



    }








    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */


    #validationError(message) {



        const error =

            new Error(message);





        error.name =

            'BeneficiaryValidationError';





        error.code =

            'MTN_BENEFICIARY_VALIDATION_FAILED';





        error.statusCode =

            400;





        error.retryable =

            false;





        return error;


    }


}





module.exports = BeneficiaryValidator;