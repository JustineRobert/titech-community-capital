/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Timing Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Callback Timing Pattern Analysis
 * • Business Hours Detection
 * • Provider Timing Analysis
 * • Callback Burst Timing Detection
 * • Duplicate Timing Detection
 * • Settlement Timing Analysis
 * • Delay Pattern Detection
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect abnormal callback timing behaviour before it impacts payment
 * processing, fraud detection, settlement, or provider reliability.
 *
 * Detection Rules
 * ---------------
 * • Callbacks outside business patterns
 * • Provider-specific timing anomalies
 * • Duplicate callbacks within milliseconds
 * • Excessive callback delays
 * • Unusual settlement timing
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

const {

    normalizeTimestamp

} = require("./anomalyUtils");

class TimingDetector {

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
     * Execute Timing Detection
     * ----------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const findings =
                await this.#analyzeTiming({

                    callback,

                    context

                });

            const score =
                this.#calculateScore(findings);

            const result =
                Object.freeze({

                    detector:
                        DETECTOR_NAME.TIMING,

                    detected:
                        score > 0,

                    score,

                    category:
                        ANOMALY_CATEGORY.CALLBACK_TIMING,

                    confidence:
                        this.#calculateConfidence(score),

                    metadata:
                        findings,

                    detectedAt:
                        new Date()

                });

            this.metrics?.increment?.(

                "timingDetections"

            );

            this.logger?.debug?.(

                "Timing detector completed",

                {

                    provider:
                        callback.provider,

                    detected:
                        result.detected,

                    score

                }

            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Timing detector execution failed.",

                {

                    detector:
                        DETECTOR_NAME.TIMING,

                    cause:
                        error

                }

            );

        }

    }

    /**
     * ----------------------------------------------------------------------
     * Analyze Timing Behaviour
     * ----------------------------------------------------------------------
     */

    async #analyzeTiming({

        callback,

        context

    }) {

        const timestamp =
            normalizeTimestamp(

                callback.timestamp

            );

        const findings = {

            outsideBusinessHours: false,

            duplicateWithinMilliseconds: false,

            excessiveDelay: false,

            unusualSettlementTiming: false,

            providerTimingAnomaly: false

        };

        if (!timestamp) {

            return findings;

        }

        findings.outsideBusinessHours =
            this.#outsideBusinessHours(timestamp);

        findings.excessiveDelay =
            this.#excessiveDelay(

                callback

            );

        findings.unusualSettlementTiming =
            this.#unusualSettlementTiming(

                callback

            );

        findings.providerTimingAnomaly =
            await this.#providerTimingAnomaly(

                callback

            );

        findings.duplicateWithinMilliseconds =
            await this.#duplicateWithinMilliseconds(

                callback,

                timestamp

            );

        return findings;

    }

    /**
     * ----------------------------------------------------------------------
     * Business Hours Check
     * ----------------------------------------------------------------------
     */

    #outsideBusinessHours(timestamp) {

        const hour =
            timestamp.getUTCHours();

        return (

            hour < 6 ||

            hour > 22

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Delay Detection
     * ----------------------------------------------------------------------
     */

    #excessiveDelay(callback) {

        if (

            !callback.providerResponseAt ||

            !callback.receivedAt

        ) {

            return false;

        }

        const delay =

            new Date(

                callback.receivedAt

            ).getTime()

            -

            new Date(

                callback.providerResponseAt

            ).getTime();

        return (

            delay >

            THRESHOLDS.MAX_CALLBACK_LATENCY_MS

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Settlement Timing
     * ----------------------------------------------------------------------
     */

    #unusualSettlementTiming(callback) {

        if (

            !callback.processedAt ||

            !callback.reconciledAt

        ) {

            return false;

        }

        const settlementDelay =

            new Date(

                callback.reconciledAt

            ).getTime()

            -

            new Date(

                callback.processedAt

            ).getTime();

        return (

            settlementDelay >

            (60 * 60 * 1000)

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Provider Timing Analysis
     * ----------------------------------------------------------------------
     */

    async #providerTimingAnomaly(callback) {

        if (

            !this.callbackRepository

        ) {

            return false;

        }

        if (

            typeof this.callbackRepository.hasTimingAnomaly !==
            "function"

        ) {

            return false;

        }

        return this.callbackRepository.hasTimingAnomaly({

            provider:
                callback.provider,

            tenantId:
                callback.tenantId

        });

    }

    /**
     * ----------------------------------------------------------------------
     * Millisecond Duplicate Detection
     * ----------------------------------------------------------------------
     */

    async #duplicateWithinMilliseconds(

        callback,

        timestamp

    ) {

        if (

            !this.callbackRepository

        ) {

            return false;

        }

        if (

            typeof this.callbackRepository.findNearby !==
            "function"

        ) {

            return false;

        }

        const nearby =

            await this.callbackRepository.findNearby({

                provider:
                    callback.provider,

                transactionReference:
                    callback.transactionReference,

                timestamp,

                toleranceMs: 1000

            });

        return (

            Array.isArray(nearby) &&

            nearby.length > 0

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Detection Score
     * ----------------------------------------------------------------------
     */

    #calculateScore(findings) {

        let score = 0;

        if (

            findings.outsideBusinessHours

        ) {

            score += 5;

        }

        if (

            findings.providerTimingAnomaly

        ) {

            score += 15;

        }

        if (

            findings.duplicateWithinMilliseconds

        ) {

            score += 25;

        }

        if (

            findings.excessiveDelay

        ) {

            score += 20;

        }

        if (

            findings.unusualSettlementTiming

        ) {

            score += 15;

        }

        return Math.min(

            score,

            100

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Confidence Calculation
     * ----------------------------------------------------------------------
     */

    #calculateConfidence(score) {

        if (score >= 70) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (score >= 45) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (score >= 20) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = TimingDetector;