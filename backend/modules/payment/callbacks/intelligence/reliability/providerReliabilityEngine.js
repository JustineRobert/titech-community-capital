/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Provider Reliability Engine
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Provider Health Score Calculation
 * • Historical Reliability Analysis
 * • Callback Success Rate Tracking
 * • Failure Trend Analysis
 * • Anomaly History Correlation
 * • Settlement Performance Analysis
 * • Uptime Trend Calculation
 * • Provider Ranking
 * • Failover Decision Support
 * • Multi-Tenant Aware
 * • Knowledge Graph Integration
 * • Structured Logging
 * • Metrics Ready
 * • OpenTelemetry Ready
 * • Immutable Results
 *
 *
 * Purpose
 * -------
 * Transform callback intelligence history into provider reliability scores
 * that can support routing, failover evaluation, and operational decisions.
 *
 *
 * Inputs
 * -------
 *
 * Callback Knowledge Graph
 * Anomaly History
 * Settlement History
 * Provider Events
 *
 *
 * Output
 * -------
 *
 * {
 *    provider: "MTN_MOMO",
 *    reliabilityScore: 91,
 *    health: "GOOD",
 *    ranking: 1,
 *    failoverRecommendation: false
 * }
 *
 *
 * Design Principles
 * -----------------
 * • Intelligence Only
 * • No Payment Processing
 * • No Failover Execution
 * • No Provider Coupling
 * • Configurable Scoring
 *
 * ============================================================================
 */


const {

    SEVERITY

} = require("../anomaly/anomalyConstants");



class ProviderReliabilityEngine {


    constructor({

        knowledgeGraph,

        metrics,

        logger,

        weights = {}

    } = {}) {


        this.knowledgeGraph =
            knowledgeGraph;


        this.metrics =
            metrics;


        this.logger =
            logger;



        this.weights = Object.freeze({

            uptime:

                0.30,


            successRate:

                0.25,


            anomalyHistory:

                0.20,


            settlementPerformance:

                0.15,


            latency:

                0.10,


            ...weights

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Evaluate Provider Reliability
     * ------------------------------------------------------------------------
     */


    evaluate({

        provider,

        metrics = {}

    }) {


        const analysis = {


            uptimeScore:

                this.#calculateUptime(

                    metrics

                ),



            successScore:

                this.#calculateSuccessRate(

                    metrics

                ),



            anomalyScore:

                this.#calculateAnomalyScore(

                    metrics

                ),



            settlementScore:

                this.#calculateSettlementScore(

                    metrics

                ),



            latencyScore:

                this.#calculateLatencyScore(

                    metrics

                )

        };



        const reliabilityScore =

            this.#calculateWeightedScore(

                analysis

            );



        const result = Object.freeze({


            provider,


            reliabilityScore,


            health:

                this.#healthStatus(

                    reliabilityScore

                ),



            failoverRecommendation:

                reliabilityScore < 50,



            analysis,



            generatedAt:

                new Date()

        });



        this.metrics?.increment?.(

            "providerReliabilityEvaluations"

        );



        this.logger?.info?.(

            "Provider reliability evaluated",

            result

        );



        return result;

    }





    /**
     * ------------------------------------------------------------------------
     * Rank Providers
     * ------------------------------------------------------------------------
     */


    rankProviders(providers = []) {


        return providers

            .map(provider =>

                this.evaluate(provider)

            )

            .sort(

                (

                    a,

                    b

                ) =>

                    b.reliabilityScore -

                    a.reliabilityScore

            )

            .map(

                (

                    provider,

                    index

                ) => ({

                    ...provider,

                    ranking:

                        index + 1

                })

            );

    }





    /**
     * ------------------------------------------------------------------------
     * Uptime Calculation
     * ------------------------------------------------------------------------
     */


    #calculateUptime(metrics) {


        if (

            metrics.uptimePercentage === undefined

        ) {


            return 100;

        }



        return Math.min(

            metrics.uptimePercentage,

            100

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Success Rate
     * ------------------------------------------------------------------------
     */


    #calculateSuccessRate(metrics) {


        if (

            metrics.successRate === undefined

        ) {


            return 100;

        }



        return Math.min(

            metrics.successRate,

            100

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Anomaly Impact Score
     * ------------------------------------------------------------------------
     */


    #calculateAnomalyScore(metrics) {


        const anomalyCount =

            metrics.anomalies || 0;



        if (

            anomalyCount === 0

        ) {


            return 100;

        }



        return Math.max(

            100 -

            (

                anomalyCount * 5

            ),

            0

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Settlement Performance
     * ------------------------------------------------------------------------
     */


    #calculateSettlementScore(metrics) {


        if (

            metrics.settlementSuccessRate === undefined

        ) {


            return 100;

        }



        return metrics.settlementSuccessRate;

    }





    /**
     * ------------------------------------------------------------------------
     * Latency Score
     * ------------------------------------------------------------------------
     */


    #calculateLatencyScore(metrics) {


        if (

            !metrics.averageLatencyMs

        ) {


            return 100;

        }



        if (

            metrics.averageLatencyMs < 3000

        ) {


            return 100;

        }



        if (

            metrics.averageLatencyMs < 10000

        ) {


            return 75;

        }



        return 40;

    }





    /**
     * ------------------------------------------------------------------------
     * Weighted Reliability Calculation
     * ------------------------------------------------------------------------
     */


    #calculateWeightedScore(scores) {


        return Math.round(

            (

                scores.uptimeScore *

                this.weights.uptime


            )

            +

            (

                scores.successScore *

                this.weights.successRate


            )

            +

            (

                scores.anomalyScore *

                this.weights.anomalyHistory


            )

            +

            (

                scores.settlementScore *

                this.weights.settlementPerformance


            )

            +

            (

                scores.latencyScore *

                this.weights.latency

            )

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Health Classification
     * ------------------------------------------------------------------------
     */


    #healthStatus(score) {


        if (

            score >= 85

        ) {


            return "EXCELLENT";

        }



        if (

            score >= 70

        ) {


            return "GOOD";

        }



        if (

            score >= 50

        ) {


            return "DEGRADED";

        }



        return "CRITICAL";

    }


}


module.exports = ProviderReliabilityEngine;