/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Score Calculator
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Multi Detector Score Aggregation
 * • Weighted Risk Calculation
 * • Unified Anomaly Score Generation
 * • Severity Classification
 * • Primary Category Detection
 * • Confidence Aggregation
 * • Configurable Detector Weights
 * • Provider Independent
 * • Multi-Tenant Aware
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Results
 *
 * Purpose
 * -------
 * Aggregate individual anomaly detector outputs into a single normalized
 * payment reliability intelligence score.
 *
 * Input Signals
 * -------------
 * • Volume Detector
 * • Duplicate Detector
 * • Sequence Detector
 * • Latency Detector
 * • Failure Rate Detector
 * • Payload Detector
 * • Timing Detector
 * • IP Detector
 *
 * Processing Flow
 * ---------------
 *
 * Detector Results
 *
 *       |
 *       ▼
 *
 * Weighted Score Calculation
 *
 *       |
 *       ▼
 *
 * Unified Risk Score
 *
 *       |
 *       ▼
 *
 * Severity Classification
 *
 *       |
 *       ▼
 *
 * Primary Anomaly Category
 *
 *       |
 *       ▼
 *
 * Confidence Calculation
 *
 *
 * Design Principles
 * -----------------
 * • Aggregation Only
 * • No Detection Logic
 * • No Repository Access
 * • No Business Decisions
 * • Fully Extensible
 *
 * ============================================================================
 */


const {

    SEVERITY,

    CONFIDENCE_LEVEL,

    DETECTOR_NAME

} = require("./anomalyConstants");



const {

    ScoreCalculationError

} = require("./anomalyErrors");



class AnomalyScoreCalculator {


    constructor({

        weights = {},

        metrics,

        logger

    } = {}) {


        this.weights = Object.freeze({

            [DETECTOR_NAME.VOLUME]:

                0.10,


            [DETECTOR_NAME.DUPLICATE]:

                0.15,


            [DETECTOR_NAME.SEQUENCE]:

                0.10,


            [DETECTOR_NAME.LATENCY]:

                0.20,


            [DETECTOR_NAME.FAILURE_RATE]:

                0.15,


            [DETECTOR_NAME.PAYLOAD]:

                0.10,


            [DETECTOR_NAME.TIMING]:

                0.05,


            [DETECTOR_NAME.IP]:

                0.15,


            ...weights

        });


        this.metrics =
            metrics;


        this.logger =
            logger;


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Unified Anomaly Score
     * ------------------------------------------------------------------------
     */


    calculate(detectorResults = []) {


        try {


            if (

                !Array.isArray(detectorResults)

            ) {


                throw new TypeError(

                    "Detector results must be an array."

                );


            }



            const weightedResults =

                detectorResults.map(

                    result =>

                        this.#applyWeight(result)

                );



            const score =

                this.#calculateTotalScore(

                    weightedResults

                );



            const primaryCategory =

                this.#findPrimaryCategory(

                    detectorResults

                );



            const confidence =

                this.#calculateConfidence(

                    detectorResults

                );



            const result = Object.freeze({


                score,


                severity:

                    this.#determineSeverity(score),



                primaryCategory,



                confidence,



                detectors:

                    detectorResults.length,



                signals:

                    detectorResults.filter(

                        item => item.detected

                    ).length,



                generatedAt:

                    new Date()


            });



            this.metrics?.increment?.(

                "anomalyScoreCalculations"

            );



            this.logger?.debug?.(

                "Anomaly score calculated",

                result

            );



            return result;


        }

        catch(error) {


            throw new ScoreCalculationError(

                "Unable to calculate anomaly score.",

                {

                    cause:

                        error

                }

            );


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Apply Detector Weight
     * ------------------------------------------------------------------------
     */


    #applyWeight(result) {


        const weight =

            this.weights[result.detector] || 0;



        return {


            ...result,


            weightedScore:

                result.score * weight


        };


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Total Score
     * ------------------------------------------------------------------------
     */


    #calculateTotalScore(results) {


        const score =

            results.reduce(

                (

                    total,

                    result

                ) => {


                    return total +

                        result.weightedScore;


                },

                0

            );



        return Math.min(

            Math.round(score),

            100

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Find Dominant Category
     * ------------------------------------------------------------------------
     */


    #findPrimaryCategory(results) {


        const detected =

            results.filter(

                result =>

                    result.detected

            );



        if (!detected.length) {


            return null;


        }



        return detected.sort(

            (

                a,

                b

            ) =>

                b.score -

                a.score

        )[0].category;


    }





    /**
     * ------------------------------------------------------------------------
     * Severity Mapping
     * ------------------------------------------------------------------------
     */


    #determineSeverity(score) {


        if (

            score >= 80

        ) {


            return SEVERITY.HIGH;


        }



        if (

            score >= 50

        ) {


            return SEVERITY.MEDIUM;


        }



        if (

            score >= 20

        ) {


            return SEVERITY.LOW;


        }



        return SEVERITY.NONE;


    }





    /**
     * ------------------------------------------------------------------------
     * Confidence Aggregation
     * ------------------------------------------------------------------------
     */


    #calculateConfidence(results) {


        const detected =

            results.filter(

                item => item.detected

            );



        if (!detected.length) {


            return CONFIDENCE_LEVEL.LOW;


        }



        const confidence =

            detected.reduce(

                (

                    total,

                    item

                ) => {


                    return total +

                        Number(item.confidence || 0);


                },

                0

            )

            /

            detected.length;



        return Number(

            confidence.toFixed(2)

        );


    }


}



module.exports = AnomalyScoreCalculator;