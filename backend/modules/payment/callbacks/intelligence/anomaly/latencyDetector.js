/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Latency Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Provider Response Latency Analysis
 * • Callback Delivery Latency Detection
 * • Internal Processing Latency Analysis
 * • Callback Acknowledgement Delay Detection
 * • Reconciliation Latency Analysis
 * • End-to-End Callback Timeline Analysis
 * • Configurable Thresholds
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect excessive latency throughout the payment callback lifecycle before
 * delays impact settlement, reconciliation, or customer experience.
 *
 * Detection Categories
 * --------------------
 * • Provider response latency
 * • Callback delivery latency
 * • Internal processing latency
 * • Callback acknowledgement delay
 * • Reconciliation latency
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
    CONFIDENCE_LEVEL,
    THRESHOLDS
} = require("./anomalyConstants");

const {
    DetectorExecutionError
} = require("./anomalyErrors");

class LatencyDetector {

    constructor({

        metrics,

        logger

    } = {}) {

        this.metrics = metrics;

        this.logger = logger;

    }

    /**
     * ------------------------------------------------------------------------
     * Execute Latency Detection
     * ------------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const analysis =
                this.#analyzeLatency({

                    callback,

                    context

                });

            const result = Object.freeze({

                detector:
                    DETECTOR_NAME.LATENCY,

                detected:
                    analysis.detected,

                score:
                    analysis.score,

                category:
                    ANOMALY_CATEGORY.PROVIDER_LATENCY,

                confidence:
                    analysis.confidence,

                latencyMs:
                    analysis.maximumLatency,

                metadata:
                    analysis.metadata,

                detectedAt:
                    new Date()

            });

            this.metrics?.increment?.(
                "latencyDetections"
            );

            this.logger?.debug?.(

                "Latency detector completed",

                {

                    provider:
                        callback.provider,

                    latencyMs:
                        analysis.maximumLatency,

                    detected:
                        result.detected

                }

            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Latency detector execution failed.",

                {

                    detector:
                        DETECTOR_NAME.LATENCY,

                    cause:
                        error

                }

            );

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Analyze Callback Timeline
     * ------------------------------------------------------------------------
     */

    #analyzeLatency({

        callback,

        context

    }) {

        const providerLatency =
            this.#calculateLatency(

                callback.providerRequestAt,

                callback.providerResponseAt

            );

        const deliveryLatency =
            this.#calculateLatency(

                callback.providerResponseAt,

                callback.receivedAt

            );

        const processingLatency =
            this.#calculateLatency(

                callback.receivedAt,

                callback.processedAt

            );

        const acknowledgementLatency =
            this.#calculateLatency(

                callback.receivedAt,

                callback.acknowledgedAt

            );

        const reconciliationLatency =
            this.#calculateLatency(

                callback.processedAt,

                callback.reconciledAt

            );

        const maximumLatency = Math.max(

            providerLatency,

            deliveryLatency,

            processingLatency,

            acknowledgementLatency,

            reconciliationLatency

        );

        return {

            detected:

                maximumLatency >

                THRESHOLDS.MAX_CALLBACK_LATENCY_MS,

            score:

                this.#calculateScore(

                    maximumLatency

                ),

            confidence:

                this.#calculateConfidence(

                    maximumLatency

                ),

            maximumLatency,

            metadata: {

                providerLatency,

                deliveryLatency,

                processingLatency,

                acknowledgementLatency,

                reconciliationLatency

            }

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Latency
     * ------------------------------------------------------------------------
     */

    #calculateLatency(

        start,

        end

    ) {

        if (!start || !end) {

            return 0;

        }

        const startTime =
            new Date(start).getTime();

        const endTime =
            new Date(end).getTime();

        if (

            Number.isNaN(startTime) ||

            Number.isNaN(endTime)

        ) {

            return 0;

        }

        return Math.max(

            endTime - startTime,

            0

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Detection Score
     * ------------------------------------------------------------------------
     */

    #calculateScore(latencyMs) {

        const threshold =
            THRESHOLDS.MAX_CALLBACK_LATENCY_MS;

        if (

            latencyMs <= threshold

        ) {

            return 0;

        }

        const multiplier =
            latencyMs / threshold;

        return Math.min(

            Math.round(multiplier * 20),

            100

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Confidence
     * ------------------------------------------------------------------------
     */

    #calculateConfidence(latencyMs) {

        const threshold =
            THRESHOLDS.MAX_CALLBACK_LATENCY_MS;

        const multiplier =
            latencyMs / threshold;

        if (

            multiplier >= 5

        ) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (

            multiplier >= 3

        ) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (

            multiplier >= 2

        ) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = LatencyDetector;