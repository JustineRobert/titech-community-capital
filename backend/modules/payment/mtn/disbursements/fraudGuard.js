'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Fraud Guard
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Risk evaluation layer for MTN MoMo disbursement transactions.
 *
 * Disbursements require stricter controls than collections because funds leave
 * the financial institution and are transferred to external beneficiaries.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Execute fraud detection rules
 * • Evaluate payout risk signals
 * • Block suspicious disbursements
 * • Support configurable risk thresholds
 * • Generate fraud decisions
 * • Record security events
 * • Support future AI/ML scoring engines
 * • Provide operational observability
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN transfers
 * ✗ Approve payments
 * ✗ Modify ledger records
 * ✗ Perform KYC verification
 * ✗ Perform AML reporting
 *
 * =============================================================================
 */


class FraudGuard {


    constructor({

        rules = [],

        riskEngine,

        auditService,

        eventBus,

        metrics,

        logger,

        configuration = {}

    } = {}) {


        this.rules = rules;

        this.riskEngine = riskEngine;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;

        this.configuration = configuration;


    }







    /**
     * =========================================================================
     * Inspect Disbursement Risk
     * =========================================================================
     */


    async inspect(context = {}) {



        const startedAt = Date.now();




        const evaluationContext = {


            ...context,



            operation:

                'MTN_DISBURSEMENT',



            provider:

                'MTN',



            inspectedAt:

                new Date()


        };






        const decisions = [];





        try {



            /**
             * -----------------------------------------------------------------
             * Rule Evaluation
             * -----------------------------------------------------------------
             */


            for (const rule of this.#orderedRules()) {



                const result =

                    await rule.evaluate(

                        evaluationContext

                    );





                decisions.push({

                    rule:

                        rule.name ||

                        'anonymous_rule',



                    result


                });







                if (

                    result &&

                    result.allowed === false

                ) {



                    await this.#blocked({

                        context:

                            evaluationContext,


                        result,


                        rule


                    });






                    throw this.#fraudError(

                        result.reason ||

                        'Fraud rule rejected disbursement'

                    );


                }


            }







            /**
             * -----------------------------------------------------------------
             * External Risk Engine
             * -----------------------------------------------------------------
             */


            let riskScore = null;





            if (this.riskEngine?.score) {



                riskScore =

                    await this.riskEngine.score(

                        evaluationContext

                    );






                if (

                    riskScore.blocked === true

                ) {



                    await this.#blocked({

                        context:

                            evaluationContext,


                        result:

                            riskScore,


                        rule:

                            {

                                name:

                                    'risk_engine'

                            }


                    });






                    throw this.#fraudError(

                        'Disbursement blocked by risk engine'

                    );


                }


            }







            this.metrics?.increment?.(

                'mtn.disbursement.fraud.allowed'

            );






            this.metrics?.observe?.(

                'mtn.disbursement.fraud.duration',

                Date.now() - startedAt

            );






            return {


                allowed: true,



                riskScore,



                decisions


            };





        }


        catch (error) {



            this.metrics?.increment?.(

                'mtn.disbursement.fraud.failed'

            );



            throw error;


        }


    }







    /**
     * =========================================================================
     * Sort Rules By Priority
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
     * Fraud Block Handler
     * =========================================================================
     */


    async #blocked({

        context,

        result,

        rule

    }) {




        this.metrics?.increment?.(

            'mtn.disbursement.fraud.blocked'

        );






        this.logger.warn?.({

            event:

                'mtn.disbursement.fraud.blocked',



            transactionId:

                context.transactionId,



            reference:

                context.reference,



            beneficiary:

                context.beneficiary,



            rule:

                rule.name || 'unknown',



            reason:

                result.reason


        });







        await this.auditService?.record({

            action:

                'MTN_DISBURSEMENT_FRAUD_BLOCKED',



            transactionId:

                context.transactionId,



            reference:

                context.reference,



            tenantId:

                context.tenantId,



            rule:

                rule.name,



            reason:

                result.reason,



            timestamp:

                new Date()


        });







        await this.eventBus?.publish?.({

            type:

                'MTN_DISBURSEMENT_FRAUD_BLOCKED',



            payload: {


                transactionId:

                    context.transactionId,



                reference:

                    context.reference,



                reason:

                    result.reason,



                rule:

                    rule.name


            }


        });



    }







    /**
     * =========================================================================
     * Fraud Error Factory
     * =========================================================================
     */


    #fraudError(message) {



        const error =

            new Error(message);






        error.name =

            'DisbursementFraudDetectionError';






        error.code =

            'MTN_DISBURSEMENT_FRAUD_BLOCKED';






        error.statusCode =

            403;






        error.retryable =

            false;






        return error;


    }


}





module.exports = FraudGuard;