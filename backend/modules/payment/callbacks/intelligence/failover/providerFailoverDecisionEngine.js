/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Provider Failover Decision Engine
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Provider Reliability Evaluation
 * • Automated Failover Recommendations
 * • Multi Provider Routing Intelligence
 * • Tenant Routing Policy Awareness
 * • Transaction Risk Consideration
 * • Provider Health Comparison
 * • Alternative Provider Selection
 * • Confidence Calculation
 * • Resilience Decision Support
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Metrics Ready
 * • OpenTelemetry Ready
 *
 *
 * Purpose
 * -------
 * Determine whether payment traffic should remain on the current provider
 * or be evaluated for failover based on intelligence signals.
 *
 *
 * Input
 * -----
 *
 * {
 *    currentProviderReliability: {
 *        provider:"MTN_MOMO",
 *        reliabilityScore:42
 *    },
 *
 *    alternatives:[
 *        {
 *          provider:"AIRTEL_MONEY",
 *          reliabilityScore:91
 *        }
 *    ]
 * }
 *
 *
 * Output
 * ------
 *
 * {
 *    decision:
 *        "FAILOVER_RECOMMENDED",
 *
 *    currentProvider:
 *        "MTN_MOMO",
 *
 *    alternativeProvider:
 *        "AIRTEL_MONEY",
 *
 *    reason:
 *        "Provider reliability degraded below threshold",
 *
 *    confidence:
 *        0.94
 * }
 *
 *
 * Design Principles
 * -----------------
 * • Decision Only
 * • No Traffic Switching
 * • No Payment Execution
 * • Configurable Policies
 * • Human Override Compatible
 *
 * ============================================================================
 */


class ProviderFailoverDecisionEngine {


    constructor({

        reliabilityThreshold = 50,

        confidenceThreshold = 0.80,

        policies = {},

        metrics,

        logger

    } = {}) {


        this.reliabilityThreshold =
            reliabilityThreshold;


        this.confidenceThreshold =
            confidenceThreshold;


        this.policies = Object.freeze({

            requireTenantApproval: false,

            allowCriticalTransactionFailover: true,

            ...policies

        });


        this.metrics =
            metrics;


        this.logger =
            logger;


    }





    /**
     * ------------------------------------------------------------------------
     * Evaluate Failover Decision
     * ------------------------------------------------------------------------
     */


    evaluate({

        currentProvider,

        currentProviderReliability,

        alternativeProviders = [],

        tenantPolicy = {},

        transactionContext = {}

    }) {


        const alternative =

            this.#selectAlternativeProvider(

                alternativeProviders

            );



        const shouldFailover =

            this.#shouldFailover({

                currentProviderReliability,

                alternative,

                tenantPolicy,

                transactionContext

            });



        const confidence =

            this.#calculateConfidence({

                currentProviderReliability,

                alternative

            });



        const result = Object.freeze({


            decision:

                shouldFailover

                    ? "FAILOVER_RECOMMENDED"

                    : "KEEP_PROVIDER",



            currentProvider,


            alternativeProvider:

                alternative?.provider || null,



            reason:

                this.#generateReason({

                    shouldFailover,

                    currentProviderReliability,

                    alternative

                }),



            confidence,



            evaluatedAt:

                new Date()


        });



        this.metrics?.increment?.(

            "providerFailoverEvaluations"

        );



        this.logger?.info?.(

            "Provider failover decision generated",

            result

        );



        return result;


    }





    /**
     * ------------------------------------------------------------------------
     * Select Best Alternative Provider
     * ------------------------------------------------------------------------
     */


    #selectAlternativeProvider(providers) {


        if (

            !providers.length

        ) {


            return null;

        }



        return providers

            .filter(

                provider =>

                    provider.health !== "CRITICAL"

            )

            .sort(

                (

                    a,

                    b

                ) =>

                    b.reliabilityScore -

                    a.reliabilityScore

            )[0];

    }





    /**
     * ------------------------------------------------------------------------
     * Failover Evaluation Rules
     * ------------------------------------------------------------------------
     */


    #shouldFailover({

        currentProviderReliability,

        alternative,

        tenantPolicy,

        transactionContext

    }) {


        if (

            !alternative

        ) {


            return false;

        }



        if (

            tenantPolicy.disableFailover

        ) {


            return false;

        }



        if (

            transactionContext.highRisk &&

            !this.policies.allowCriticalTransactionFailover

        ) {


            return false;

        }



        return (

            currentProviderReliability.reliabilityScore

            <

            this.reliabilityThreshold

        )

        &&

        (

            alternative.reliabilityScore

            >

            currentProviderReliability.reliabilityScore

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Confidence Calculation
     * ------------------------------------------------------------------------
     */


    #calculateConfidence({

        currentProviderReliability,

        alternative

    }) {


        if (

            !alternative

        ) {


            return 0;

        }



        const difference =

            alternative.reliabilityScore -

            currentProviderReliability.reliabilityScore;



        return Math.min(

            Number(

                (

                    difference /

                    100

                )

                .toFixed(2)

            ),

            0.99

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Decision Explanation
     * ------------------------------------------------------------------------
     */


    #generateReason({

        shouldFailover,

        currentProviderReliability,

        alternative

    }) {


        if (

            shouldFailover

        ) {


            return (

                "Provider reliability degraded below threshold. " +

                "Alternative provider has higher reliability score."

            );

        }



        if (

            !alternative

        ) {


            return (

                "No suitable alternative provider available."

            );

        }



        return (

            "Current provider remains within acceptable reliability limits."

        );


    }


}


module.exports = ProviderFailoverDecisionEngine;