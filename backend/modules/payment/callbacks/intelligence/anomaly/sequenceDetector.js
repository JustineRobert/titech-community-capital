/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Sequence Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Callback Lifecycle Validation
 * • Payment State Transition Verification
 * • Provider Workflow Validation
 * • Invalid Sequence Detection
 * • Missing Transition Detection
 * • State Regression Detection
 * • Duplicate State Detection
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Validates callback ordering to ensure payment lifecycle events follow
 * expected state transitions before affecting financial processing.
 *
 * Example Valid Flow
 * ------------------
 * PENDING
 *      ↓
 * PROCESSING
 *      ↓
 * SUCCESS
 *
 * Example Invalid Flows
 * ---------------------
 * SUCCESS
 *      ↓
 * PENDING
 *
 * FAILED
 *      ↓
 * PROCESSING
 *
 * SUCCESS
 *      ↓
 * FAILED
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Provider Independent
 * • Repository Driven
 * • No Business Decisions
 * • Extensible
 * ============================================================================
 */

const {

    DETECTOR_NAME,

    ANOMALY_CATEGORY,

    CONFIDENCE_LEVEL

} = require("./anomalyConstants");

const {

    DetectorExecutionError

} = require("./anomalyErrors");

const VALID_TRANSITIONS = Object.freeze({

    CREATED: [

        "PENDING"

    ],

    PENDING: [

        "PROCESSING",

        "FAILED",

        "CANCELLED"

    ],

    PROCESSING: [

        "SUCCESS",

        "FAILED",

        "CANCELLED"

    ],

    SUCCESS: [

    ],

    FAILED: [

    ],

    CANCELLED: [

    ]

});

class SequenceDetector {

    constructor({

        callbackRepository,

        metrics,

        logger

    } = {}) {

        this.callbackRepository =
            callbackRepository;

        this.metrics =
            metrics;

        this.logger =
            logger;

    }

    /**
     * ----------------------------------------------------------------------
     * Execute Sequence Detection
     * ----------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const previousState =

                await this.#loadPreviousState({

                    callback,

                    context

                });

            const currentState =

                String(

                    callback.status || ""

                ).toUpperCase();

            const analysis =

                this.#analyzeTransition(

                    previousState,

                    currentState

                );

            const result = Object.freeze({

                detector:

                    DETECTOR_NAME.SEQUENCE,

                detected:

                    analysis.detected,

                score:

                    analysis.score,

                category:

                    ANOMALY_CATEGORY.CALLBACK_SEQUENCE,

                confidence:

                    analysis.confidence,

                metadata: {

                    previousState,

                    currentState,

                    validTransition:

                        analysis.validTransition,

                    expectedTransitions:

                        analysis.expectedTransitions

                },

                detectedAt:

                    new Date()

            });

            this.metrics?.increment?.(

                "sequenceDetections"

            );

            this.logger?.debug?.(

                "Sequence detector completed",

                {

                    provider:

                        callback.provider,

                    previousState,

                    currentState,

                    detected:

                        result.detected

                }

            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Sequence detector execution failed.",

                {

                    detector:

                        DETECTOR_NAME.SEQUENCE,

                    cause:

                        error

                }

            );

        }

    }

    /**
     * ----------------------------------------------------------------------
     * Load Previous State
     * ----------------------------------------------------------------------
     */

    async #loadPreviousState({

        callback,

        context

    }) {

        if (context.previousState) {

            return String(

                context.previousState

            ).toUpperCase();

        }

        if (!this.callbackRepository) {

            return "CREATED";

        }

        const previous =

            await this.callbackRepository.findLatest({

                tenantId:

                    callback.tenantId,

                provider:

                    callback.provider,

                transactionReference:

                    callback.transactionReference

            });

        if (!previous) {

            return "CREATED";

        }

        return String(

            previous.status

        ).toUpperCase();

    }

    /**
     * ----------------------------------------------------------------------
     * Analyze Transition
     * ----------------------------------------------------------------------
     */

    #analyzeTransition(

        previousState,

        currentState

    ) {

        const expectedTransitions =

            VALID_TRANSITIONS[previousState] || [];

        const validTransition =

            expectedTransitions.includes(

                currentState

            );

        if (validTransition) {

            return {

                detected: false,

                score: 0,

                confidence:

                    CONFIDENCE_LEVEL.VERY_HIGH,

                validTransition: true,

                expectedTransitions

            };

        }

        return {

            detected: true,

            score:

                this.#calculateScore(

                    previousState,

                    currentState

                ),

            confidence:

                CONFIDENCE_LEVEL.HIGH,

            validTransition: false,

            expectedTransitions

        };

    }

    /**
     * ----------------------------------------------------------------------
     * Calculate Score
     * ----------------------------------------------------------------------
     */

    #calculateScore(

        previousState,

        currentState

    ) {

        if (

            previousState === "SUCCESS" ||

            previousState === "FAILED" ||

            previousState === "CANCELLED"

        ) {

            return 40;

        }

        if (

            previousState === "PENDING" &&

            currentState === "SUCCESS"

        ) {

            return 12;

        }

        if (

            previousState === "PROCESSING" &&

            currentState === "PENDING"

        ) {

            return 18;

        }

        return 18;

    }

}

module.exports = SequenceDetector;