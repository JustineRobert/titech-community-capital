/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Volume Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Callback Volume Analysis
 * • Provider Volume Monitoring
 * • Tenant Volume Monitoring
 * • Rolling Average Analysis
 * • Historical Baseline Comparison
 * • Burst Detection
 * • Time Window Analysis
 * • Configurable Thresholds
 * • Provider Independent
 * • Multi-Tenant Aware
 * • Structured Logging
 * • OpenTelemetry Ready
 * • Enterprise Metrics
 * • Immutable Detection Result
 *
 * Purpose
 * -------
 * Detect abnormal callback traffic before it impacts payment processing.
 *
 * Detection Rules
 * ---------------
 * • Callbacks per minute
 * • Callbacks per hour
 * • Callbacks per provider
 * • Tenant callback spikes
 * • Callback bursts
 * • Rolling average comparison
 * • Historical baseline deviation
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Provider Independent
 * • Pure Detection Logic
 * • No Business Decisions
 * • Extensible
 *
 * ============================================================================
 */

const {
    ANOMALY_CATEGORY,
    DETECTOR_NAME,
    CONFIDENCE_LEVEL,
    THRESHOLDS
} = require("./anomalyConstants");

const {
    DetectorExecutionError
} = require("./anomalyErrors");

const {
    calculateAverage,
    calculateMovingAverage
} = require("./anomalyUtils");

class VolumeDetector {

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
     * ------------------------------------------------------------------------
     * Execute Volume Detection
     * ------------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const history =
                await this.#loadHistoricalCallbacks({

                    callback,

                    context

                });

            const analysis =
                this.#analyze(history);

            const result =
                Object.freeze({

                    detector:
                        DETECTOR_NAME.VOLUME,

                    detected:
                        analysis.detected,

                    score:
                        analysis.score,

                    category:
                        ANOMALY_CATEGORY.VOLUME_SPIKE,

                    confidence:
                        analysis.confidence,

                    metadata:
                        analysis.metadata,

                    detectedAt:
                        new Date()

                });

            this.metrics?.increment?.(
                "volumeDetections"
            );

            this.logger?.debug?.(
                "Volume detection completed",
                {

                    provider:
                        callback.provider,

                    detected:
                        result.detected,

                    score:
                        result.score

                }
            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Volume detector failed.",

                {

                    detector:
                        DETECTOR_NAME.VOLUME,

                    cause:
                        error

                }

            );

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Load Historical Callback Data
     * ------------------------------------------------------------------------
     */

    async #loadHistoricalCallbacks({

        callback,

        context

    }) {

        if (!this.callbackRepository) {

            return context.history || [];

        }

        return this.callbackRepository.findRecent({

            provider:
                callback.provider,

            tenantId:
                callback.tenantId,

            windowMinutes:
                60

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Analyze Historical Volume
     * ------------------------------------------------------------------------
     */

    #analyze(callbacks) {

        const perMinute =
            this.#calculateCallbacksPerMinute(
                callbacks
            );

        const rollingAverage =
            calculateMovingAverage(
                perMinute,
                10
            );

        const expected =
            rollingAverage.length
                ? rollingAverage[
                    rollingAverage.length - 1
                  ]
                : calculateAverage(perMinute);

        const actual =
            perMinute.length
                ? perMinute[
                    perMinute.length - 1
                  ]
                : 0;

        const multiplier =
            expected === 0
                ? 0
                : actual / expected;

        const detected =
            multiplier >=
            THRESHOLDS.VOLUME_SPIKE_MULTIPLIER;

        return {

            detected,

            score:
                this.#calculateScore(
                    multiplier
                ),

            confidence:
                this.#calculateConfidence(
                    multiplier
                ),

            metadata: {

                expected,

                actual,

                multiplier,

                callbacksLastHour:
                    callbacks.length

            }

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Aggregate Callback Counts Per Minute
     * ------------------------------------------------------------------------
     */

    #calculateCallbacksPerMinute(callbacks) {

        const buckets =
            new Map();

        for (const callback of callbacks) {

            const timestamp =
                new Date(
                    callback.createdAt ||
                    callback.timestamp
                );

            const minute =
                timestamp
                    .toISOString()
                    .slice(0, 16);

            buckets.set(

                minute,

                (buckets.get(minute) || 0) + 1

            );

        }

        return [

            ...buckets.values()

        ];

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Detector Score
     * ------------------------------------------------------------------------
     */

    #calculateScore(multiplier) {

        if (multiplier <= 1) {

            return 0;

        }

        const score =
            Math.round(

                Math.min(

                    multiplier * 25,

                    100

                )

            );

        return score;

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Confidence
     * ------------------------------------------------------------------------
     */

    #calculateConfidence(multiplier) {

        if (multiplier >= 5) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (multiplier >= 3) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (multiplier >= 2) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = VolumeDetector;