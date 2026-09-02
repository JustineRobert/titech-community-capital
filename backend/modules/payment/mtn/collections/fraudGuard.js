'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Collection Fraud Guard
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Risk control layer for MTN MoMo collection transactions.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Execute fraud detection rules
 * • Evaluate transaction risk signals
 * • Block suspicious payments
 * • Generate fraud decisions
 * • Support rule prioritization
 * • Provide audit context
 * • Emit security metrics
 * • Support future ML risk scoring
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Modify payments
 * ✗ Call MTN APIs
 * ✗ Update ledger
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

        logger,

        metrics,

        configuration = {}

    } = {}) {


        this.rules = rules;

        this.riskEngine = riskEngine;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.logger = logger || console;

        this.metrics = metrics;

        this.configuration = configuration;

    }


    /**
     * =========================================================================
     * Inspect Payment Context
     * =========================================================================
     */

    async inspect(context = {}) {


        const startedAt = Date.now();


        const evaluationContext = {

            ...context,

            inspectedAt:

                new Date()

        };


        const decisions = [];


        try {


            /**
             * -----------------------------------------------------------------
             * Rule Engine Evaluation
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

                        'Payment rejected by fraud rule'

                    );


                }


            }


            /**
             * -----------------------------------------------------------------
             * Optional Risk Engine
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

                        'Payment blocked by risk engine'

                    );

                }


            }


            this.metrics?.increment?.(

                'payment.fraud.allowed'

            );


            this.metrics?.observe?.(

                'payment.fraud.inspection.duration',

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

                'payment.fraud.inspection.failed'

            );


            throw error;

        }


    }


    /**
     * =========================================================================
     * Evaluate Rules Ordered By Priority
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

            'payment.fraud.blocked'

        );


        this.logger.warn?.({

            event:

                'payment.fraud.blocked',

            paymentId:

                context.paymentId,

            externalId:

                context.externalId,

            rule:

                rule.name ||

                'unknown',

            reason:

                result.reason

        });


        await this.auditService?.record({

            action:

                'PAYMENT_FRAUD_BLOCKED',

            paymentId:

                context.paymentId,

            externalId:

                context.externalId,

            rule:

                rule.name,

            reason:

                result.reason,

            timestamp:

                new Date()

        });


        await this.eventBus?.publish?.({

            type:

                'PAYMENT_FRAUD_BLOCKED',

            payload: {

                paymentId:

                    context.paymentId,

                externalId:

                    context.externalId,

                rule:

                    rule.name,

                reason:

                    result.reason

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

            'FraudDetectionError';


        error.code =

            'PAYMENT_FRAUD_BLOCKED';


        error.statusCode =

            403;


        error.retryable =

            false;


        return error;


    }


}


module.exports = FraudGuard;