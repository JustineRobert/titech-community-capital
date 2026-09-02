/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Recommendation Engine
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Risk Score Interpretation
 * • Operational Recommendation Generation
 * • Severity-Based Actions
 * • Provider Escalation Guidance
 * • Failover Recommendations
 * • Retry Protection Guidance
 * • Monitoring Recommendations
 * • Configurable Response Policies
 * • Machine-Readable Actions
 * • Multi-Tenant Aware
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Results
 *
 * Purpose
 * -------
 * Convert anomaly intelligence scores into operational guidance and automated
 * response recommendations.
 *
 * Input
 * -----
 * anomalyScoreCalculator output:
 *
 * {
 *    score: 87,
 *    severity: "HIGH",
 *    primaryCategory: "provider_latency",
 *    confidence: 0.96
 * }
 *
 *
 * Output
 * ------
 *
 * {
 *    recommendation:
 *        "Escalate to provider operations",
 *
 *    priority:
 *        "HIGH",
 *
 *    actions:[
 *
 *        "Notify operations",
 *
 *        "Increase monitoring",
 *
 *        "Evaluate provider reliability"
 *
 *    ]
 * }
 *
 *
 * Design Principles
 * -----------------
 * • Recommendation Only
 * • No Detection Logic
 * • No Score Calculation
 * • Configurable Policies
 * • Provider Independent
 * • Extensible
 *
 * ============================================================================
 */


const {

    SEVERITY

} = require("./anomalyConstants");


const {

    RecommendationGenerationError

} = require("./anomalyErrors");



class AnomalyRecommendationEngine {


    constructor({

        policies = {},

        metrics,

        logger

    } = {}) {


        this.policies = Object.freeze({

            ...this.#defaultPolicies(),

            ...policies

        });


        this.metrics =
            metrics;


        this.logger =
            logger;


    }





    /**
     * ------------------------------------------------------------------------
     * Generate Recommendation
     * ------------------------------------------------------------------------
     */


    generate({

        score,

        severity,

        primaryCategory,

        confidence,

        provider

    }) {


        try {


            const policy =

                this.#resolvePolicy(

                    severity

                );



            const categoryAction =

                this.#resolveCategoryAction(

                    primaryCategory

                );



            const result = Object.freeze({


                recommendation:

                    policy.recommendation,



                priority:

                    severity,



                actions:

                    [

                        ...policy.actions,

                        ...categoryAction.actions

                    ],



                automatedAction:

                    policy.automatedAction,



                provider:

                    provider || null,



                category:

                    primaryCategory,



                confidence,


                score,



                generatedAt:

                    new Date()


            });



            this.metrics?.increment?.(

                "recommendationsGenerated"

            );



            this.logger?.info?.(

                "Anomaly recommendation generated",

                result

            );



            return result;


        }

        catch(error) {


            throw new RecommendationGenerationError(

                "Unable to generate anomaly recommendation.",

                {

                    cause:

                        error

                }

            );


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Resolve Severity Policy
     * ------------------------------------------------------------------------
     */


    #resolvePolicy(severity) {


        return (

            this.policies[severity]

            ||

            this.policies.DEFAULT

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Resolve Category Guidance
     * ------------------------------------------------------------------------
     */


    #resolveCategoryAction(category) {


        return (

            this.policies.categories?.[category]

            ||

            {

                actions: []

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Default Recommendation Policies
     * ------------------------------------------------------------------------
     */


    #defaultPolicies() {


        return {


            LOW: {


                recommendation:

                    "Continue monitoring anomaly signals.",


                actions:

                    [

                        "Continue observation",

                        "Record intelligence event"

                    ],


                automatedAction:

                    "NONE"


            },



            MEDIUM: {


                recommendation:

                    "Increase payment callback observation.",


                actions:

                    [

                        "Increase monitoring",

                        "Review provider behaviour",

                        "Track anomaly trend"

                    ],


                automatedAction:

                    "ENABLE_ENHANCED_MONITORING"


            },



            HIGH: {


                recommendation:

                    "Escalate anomaly to payment operations.",


                actions:

                    [

                        "Notify operations",

                        "Increase monitoring",

                        "Evaluate provider reliability"

                    ],


                automatedAction:

                    "ENABLE_TRAFFIC_PROTECTION"


            },



            CRITICAL: {


                recommendation:

                    "Recommend provider failover evaluation.",


                actions:

                    [

                        "Notify incident response",

                        "Evaluate provider failover",

                        "Protect payment processing"

                    ],


                automatedAction:

                    "INITIATE_FAILOVER_REVIEW"


            },



            DEFAULT: {


                recommendation:

                    "Review anomaly intelligence.",


                actions:

                    [

                        "Monitor event"

                    ],


                automatedAction:

                    "NONE"


            },



            categories: {


                provider_latency: {


                    actions:

                        [

                            "Review provider response times",

                            "Inspect callback SLA"

                        ]

                },



                failure_rate: {


                    actions:

                        [

                            "Review provider availability",

                            "Analyze failed transactions"

                        ]

                },



                duplicate_reference: {


                    actions:

                        [

                            "Review replay activity",

                            "Inspect idempotency controls"

                        ]

                },



                payload_integrity: {


                    actions:

                        [

                            "Review provider payload contract",

                            "Validate callback schema"

                        ]

                },


                callback_timing: {


                    actions:

                        [

                            "Review callback delivery patterns"

                        ]

                },


                source_ip: {


                    actions:

                        [

                            "Review callback source reputation",

                            "Inspect traffic origin"

                        ]

                }

            }


        };


    }


}



module.exports = AnomalyRecommendationEngine;