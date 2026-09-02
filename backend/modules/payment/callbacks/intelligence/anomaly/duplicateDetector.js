/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Duplicate Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Duplicate Transaction Reference Detection
 * • Duplicate Callback ID Detection
 * • Duplicate External ID Detection
 * • Provider Event Replay Detection
 * • Callback Replay Window Analysis
 * • Cross-Provider Duplicate Detection
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect duplicate callback activity before it impacts payment processing,
 * accounting integrity, reconciliation, or fraud detection.
 *
 * Detection Rules
 * ---------------
 * • Duplicate transaction references
 * • Repeated callback IDs
 * • Replay attempts
 * • Duplicate provider events
 * • Duplicate external IDs
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Repository Driven
 * • No Business Decisions
 * • Provider Independent
 * • Extensible
 *
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

class DuplicateDetector {

    constructor({

        callbackRepository,

        idempotencyRepository,

        metrics,

        logger

    } = {}) {

        this.callbackRepository =
            callbackRepository;

        this.idempotencyRepository =
            idempotencyRepository;

        this.metrics =
            metrics;

        this.logger =
            logger;

    }

    /**
     * ------------------------------------------------------------------------
     * Execute Duplicate Detection
     * ------------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const findings =
                await this.#collectDuplicates({

                    callback,

                    context

                });

            const score =
                this.#calculateScore(findings);

            const result =
                Object.freeze({

                    detector:
                        DETECTOR_NAME.DUPLICATE,

                    detected:
                        score > 0,

                    score,

                    category:
                        ANOMALY_CATEGORY.DUPLICATE_REFERENCE,

                    confidence:
                        this.#calculateConfidence(score),

                    references:
                        findings.references,

                    metadata: {

                        duplicateTransaction:
                            findings.transactionReference,

                        duplicateCallbackId:
                            findings.callbackId,

                        duplicateExternalId:
                            findings.externalId,

                        replayAttempt:
                            findings.replayAttempt,

                        duplicateProviderEvent:
                            findings.providerEvent

                    },

                    detectedAt:
                        new Date()

                });

            this.metrics?.increment?.(

                "duplicateDetections"

            );

            this.logger?.debug?.(

                "Duplicate detector completed",

                {

                    provider:
                        callback.provider,

                    transactionId:
                        callback.transactionId,

                    score

                }

            );

            return result;

        }

        catch (error) {

            throw new DetectorExecutionError(

                "Duplicate detector execution failed.",

                {

                    detector:
                        DETECTOR_NAME.DUPLICATE,

                    cause:
                        error

                }

            );

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Collect Duplicate Indicators
     * ------------------------------------------------------------------------
     */

    async #collectDuplicates({

        callback,

        context

    }) {

        const findings = {

            transactionReference: false,

            callbackId: false,

            externalId: false,

            providerEvent: false,

            replayAttempt: false,

            references: []

        };

        if (await this.#isDuplicateTransaction(callback)) {

            findings.transactionReference = true;

            findings.references.push(

                callback.transactionReference

            );

        }

        if (await this.#isDuplicateCallback(callback)) {

            findings.callbackId = true;

            findings.references.push(

                callback.callbackId

            );

        }

        if (await this.#isDuplicateExternalId(callback)) {

            findings.externalId = true;

            findings.references.push(

                callback.externalId

            );

        }

        if (await this.#isReplayAttempt(callback)) {

            findings.replayAttempt = true;

        }

        if (await this.#isDuplicateProviderEvent(callback)) {

            findings.providerEvent = true;

        }

        return findings;

    }

    /**
     * ------------------------------------------------------------------------
     * Duplicate Transaction Reference
     * ------------------------------------------------------------------------
     */

    async #isDuplicateTransaction(callback) {

        if (

            !this.callbackRepository ||

            !callback.transactionReference

        ) {

            return false;

        }

        return this.callbackRepository.exists({

            tenantId:
                callback.tenantId,

            provider:
                callback.provider,

            transactionReference:
                callback.transactionReference

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Duplicate Callback ID
     * ------------------------------------------------------------------------
     */

    async #isDuplicateCallback(callback) {

        if (

            !this.callbackRepository ||

            !callback.callbackId

        ) {

            return false;

        }

        return this.callbackRepository.exists({

            callbackId:
                callback.callbackId

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Duplicate External ID
     * ------------------------------------------------------------------------
     */

    async #isDuplicateExternalId(callback) {

        if (

            !this.callbackRepository ||

            !callback.externalId

        ) {

            return false;

        }

        return this.callbackRepository.exists({

            externalId:
                callback.externalId

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Replay Attempt
     * ------------------------------------------------------------------------
     */

    async #isReplayAttempt(callback) {

        if (

            !this.idempotencyRepository ||

            !callback.idempotencyKey

        ) {

            return false;

        }

        return this.idempotencyRepository.exists({

            key:
                callback.idempotencyKey

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Duplicate Provider Event
     * ------------------------------------------------------------------------
     */

    async #isDuplicateProviderEvent(callback) {

        if (

            !this.callbackRepository ||

            !callback.providerEventId

        ) {

            return false;

        }

        return this.callbackRepository.exists({

            provider:
                callback.provider,

            providerEventId:
                callback.providerEventId

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Detection Score
     * ------------------------------------------------------------------------
     */

    #calculateScore(findings) {

        let score = 0;

        if (findings.transactionReference) {

            score += 30;

        }

        if (findings.callbackId) {

            score += 25;

        }

        if (findings.externalId) {

            score += 20;

        }

        if (findings.providerEvent) {

            score += 15;

        }

        if (findings.replayAttempt) {

            score += 35;

        }

        return Math.min(score, 100);

    }

    /**
     * ------------------------------------------------------------------------
     * Calculate Confidence
     * ------------------------------------------------------------------------
     */

    #calculateConfidence(score) {

        if (score >= 90) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (score >= 60) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (score >= 30) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = DuplicateDetector;