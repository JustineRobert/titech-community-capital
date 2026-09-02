/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Callback Volume Anomaly Detection
 * • Duplicate Callback Detection
 * • Callback Sequence Validation
 * • Provider Latency Analysis
 * • Provider Failure Pattern Detection
 * • Payload Integrity Analysis
 * • Callback Timing Analysis
 * • Source IP Behaviour Monitoring
 * • Risk Score Aggregation
 * • Severity Classification
 * • Recommendation Engine
 * • Multi-Tenant Aware
 * • OpenTelemetry Ready
 * • Structured Logging
 * • Enterprise Metrics
 * • Audit Ready
 * • Event Driven
 * • Extensible Detection Pipeline
 *
 * Purpose
 * -------
 * Detect unusual callback behaviour before it impacts financial processing.
 *
 * Detection Categories
 * --------------------
 * • Callback volume spikes
 * • Duplicate transaction references
 * • Unexpected callback ordering
 * • Excessive provider latency
 * • High provider failure rates
 * • Malformed payload patterns
 * • Repeated callbacks from identical IP addresses
 * • Abnormal callback timing
 *
 * Detection Pipeline
 * ------------------
 *
 * Callback
 *    │
 *    ▼
 * Context Collection
 *    │
 *    ▼
 * Volume Detector
 *    │
 *    ▼
 * Duplicate Detector
 *    │
 *    ▼
 * Sequence Validator
 *    │
 *    ▼
 * Latency Analyzer
 *    │
 *    ▼
 * Failure Pattern Analyzer
 *    │
 *    ▼
 * Payload Validator
 *    │
 *    ▼
 * Timing Analyzer
 *    │
 *    ▼
 * IP Behaviour Analyzer
 *    │
 *    ▼
 * Score Aggregation
 *    │
 *    ▼
 * Severity Classification
 *    │
 *    ▼
 * Recommendation Engine
 *
 * Design Principles
 * -----------------
 * • Stateless Detection
 * • Dependency Injection
 * • Rule Engine Friendly
 * • Provider Independent
 * • Highly Extensible
 * • Fail Safe
 * • Observable
 *
 * This detector coordinates anomaly analysis only.
 * Individual detection algorithms belong inside dedicated detector modules.
 * ============================================================================
 */

class CallbackAnomalyDetector {

    constructor({

        volumeDetector,

        duplicateDetector,

        sequenceDetector,

        latencyDetector,

        failureRateDetector,

        payloadDetector,

        timingDetector,

        ipDetector,

        scoreCalculator,

        recommendationEngine,

        metrics,

        eventPublisher,

        auditService,

        logger,

        tracer

    }) {

        this.volumeDetector = volumeDetector;

        this.duplicateDetector = duplicateDetector;

        this.sequenceDetector = sequenceDetector;

        this.latencyDetector = latencyDetector;

        this.failureRateDetector = failureRateDetector;

        this.payloadDetector = payloadDetector;

        this.timingDetector = timingDetector;

        this.ipDetector = ipDetector;

        this.scoreCalculator = scoreCalculator;

        this.recommendationEngine = recommendationEngine;

        this.metrics = metrics;

        this.eventPublisher = eventPublisher;

        this.auditService = auditService;

        this.logger = logger;

        this.tracer = tracer;

    }

    /**
     * ------------------------------------------------------------------------
     * Execute Enterprise Anomaly Detection
     * ------------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        const findings = {

            volume:
                await this.volumeDetector.detect({
                    callback,
                    context
                }),

            duplicate:
                await this.duplicateDetector.detect({
                    callback,
                    context
                }),

            sequence:
                await this.sequenceDetector.detect({
                    callback,
                    context
                }),

            latency:
                await this.latencyDetector.detect({
                    callback,
                    context
                }),

            failureRate:
                await this.failureRateDetector.detect({
                    callback,
                    context
                }),

            payload:
                await this.payloadDetector.detect({
                    callback,
                    context
                }),

            timing:
                await this.timingDetector.detect({
                    callback,
                    context
                }),

            ip:
                await this.ipDetector.detect({
                    callback,
                    context
                })

        };

        const score =
            await this.scoreCalculator.calculate(
                findings
            );

        const recommendation =
            await this.recommendationEngine.generate({

                findings,

                score

            });

        const result = {

            anomalyDetected:
                score.score > 0,

            anomalyScore:
                score.score,

            category:
                score.primaryCategory,

            severity:
                score.severity,

            recommendation,

            findings,

            analyzedAt:
                new Date()

        };

        await this.eventPublisher?.publish({

            type:
                "callback.anomaly.detected",

            payload:
                result

        });

        await this.auditService?.record({

            action:
                "CALLBACK_ANOMALY_ANALYZED",

            provider:
                callback.provider,

            transactionId:
                callback.transactionId,

            score:
                score.score

        });

        this.metrics?.increment?.(
            "callbackAnomaliesAnalyzed"
        );

        this.logger?.info(

            "Callback anomaly analysis completed",

            {

                provider:
                    callback.provider,

                transactionId:
                    callback.transactionId,

                anomalyScore:
                    score.score,

                severity:
                    score.severity

            }

        );

        return result;

    }

}

module.exports =
    CallbackAnomalyDetector;