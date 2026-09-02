/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Failure Rate Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Provider Failure Rate Analysis
 * • Callback Failure Trend Detection
 * • Retry Ratio Analysis
 * • Timeout Percentage Monitoring
 * • Provider Health Degradation Detection
 * • Rolling Failure Window Analysis
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect abnormal provider failure behaviour before it impacts payment
 * processing, reconciliation, settlement or customer experience.
 *
 * Detection Metrics
 * -----------------
 * • Failures per hour
 * • Failures per day
 * • Retry ratio
 * • Callback timeout percentage
 * • Provider health degradation
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Repository Driven
 * • Provider Independent
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

    calculateFailureRate,

    calculatePercentage

} = require("./anomalyUtils");

class FailureRateDetector {

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
     * Execute Failure Rate Detection
     * ------------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const callbacks =
                await this.#loadHistory({

                    callback,

                    context

                });

            const analysis =
                this.#analyze(callbacks);

            const result = Object.freeze({

                detector:
                    DETECTOR_NAME.FAILURE_RATE,

                detected:
                    analysis.detected,

                score:
                    analysis.score,

                category:
                    ANOMALY_CATEGORY.FAILURE_RATE,

                confidence:
                    analysis.confidence,

                metadata:
                    analysis.metadata,

                detectedAt:
                    new Date()

            });

            this.metrics?.increment?.(

                "failureRateDetections"

            );

            this.logger?.debug?.(

                "Failure rate detector completed",

                {

                    provider:
                        callback.provider,

                    score:
                        result.score,

                    detected:
                        result.detected

                }

            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Failure rate detector execution failed.",

                {

                    detector:
                        DETECTOR_NAME.FAILURE_RATE,

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

    async #loadHistory({

        callback,

        context

    }) {

        if (context.history) {

            return context.history;

        }

        if (!this.callbackRepository) {

            return [];

        }

        return this.callbackRepository.findRecent({

            provider:
                callback.provider,

            tenantId:
                callback.tenantId,

            windowHours:
                24

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Analyze Failure Behaviour
     * ------------------------------------------------------------------------
     */

    #analyze(callbacks) {

        const failuresPerHour =
            this.#failuresPerHour(callbacks);

        const failuresPerDay =
            this.#failuresPerDay(callbacks);

        const retryRatio =
            this.#retryRatio(callbacks);

        const timeoutPercentage =
            this.#timeoutPercentage(callbacks);

        const failureRate =
            calculateFailureRate(callbacks);

        const providerHealth =
            Math.max(

                100 - failureRate,

                0

            );

        const detected =

            failureRate >

            THRESHOLDS.MAX_FAILURE_RATE_PERCENT;

        return {

            detected,

            score:
                this.#calculateScore(

                    failureRate,

                    retryRatio,

                    timeoutPercentage

                ),

            confidence:
                this.#calculateConfidence(

                    failureRate

                ),

            metadata: {

                failuresPerHour,

                failuresPerDay,

                retryRatio,

                timeoutPercentage,

                providerHealth,

                failureRate

            }

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Failures Per Hour
     * ------------------------------------------------------------------------
     */

    #failuresPerHour(callbacks) {

        const lastHour =
            Date.now() - (60 * 60 * 1000);

        return callbacks.filter(

            callback =>

                callback.status === "FAILED" &&

                new Date(

                    callback.createdAt

                ).getTime() >= lastHour

        ).length;

    }

    /**
     * ------------------------------------------------------------------------
     * Failures Per Day
     * ------------------------------------------------------------------------
     */

    #failuresPerDay(callbacks) {

        return callbacks.filter(

            callback =>

                callback.status === "FAILED"

        ).length;

    }

    /**
     * ------------------------------------------------------------------------
     * Retry Ratio
     * ------------------------------------------------------------------------
     */

    #retryRatio(callbacks) {

        if (!callbacks.length) {

            return 0;

        }

        const retries =
            callbacks.filter(

                callback =>

                    Number(

                        callback.retryCount || 0

                    ) > 0

            ).length;

        return calculatePercentage(

            retries,

            callbacks.length

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Timeout Percentage
     * ------------------------------------------------------------------------
     */

    #timeoutPercentage(callbacks) {

        if (!callbacks.length) {

            return 0;

        }

        const timeouts =
            callbacks.filter(

                callback =>

                    callback.status === "TIMEOUT"

            ).length;

        return calculatePercentage(

            timeouts,

            callbacks.length

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Detection Score
     * ------------------------------------------------------------------------
     */

    #calculateScore(

        failureRate,

        retryRatio,

        timeoutPercentage

    ) {

        let score = 0;

        score +=
            Math.min(

                failureRate * 2,

                50

            );

        score +=
            Math.min(

                retryRatio / 4,

                25

            );

        score +=
            Math.min(

                timeoutPercentage / 4,

                25

            );

        return Math.min(

            Math.round(score),

            100

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Confidence
     * ------------------------------------------------------------------------
     */

    #calculateConfidence(failureRate) {

        if (failureRate >= 25) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (failureRate >= 15) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (failureRate >= 8) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = FailureRateDetector;