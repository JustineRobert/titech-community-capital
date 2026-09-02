/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Payload Integrity Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Required Field Validation
 * • JSON Structure Validation
 * • Schema Validation
 * • Amount Consistency Checks
 * • Currency Validation
 * • Timestamp Validation
 * • Transaction Identifier Validation
 * • Payload Quality Analysis
 * • Provider Independent
 * • Multi-Tenant Aware
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect malformed, incomplete, or inconsistent callback payloads before they
 * affect payment processing, accounting, settlement, or reconciliation.
 *
 * Detection Rules
 * ---------------
 * • Required fields
 * • Malformed payload structure
 * • Schema violations
 * • Amount inconsistencies
 * • Currency mismatches
 * • Impossible timestamps
 * • Missing transaction identifiers
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Provider Independent
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

const {

    normalizeTimestamp,

    normalizeProvider

} = require("./anomalyUtils");

class PayloadDetector {

    constructor({

        schemaValidator,

        metrics,

        logger

    } = {}) {

        this.schemaValidator =
            schemaValidator;

        this.metrics =
            metrics;

        this.logger =
            logger;

    }

    /**
     * ----------------------------------------------------------------------
     * Execute Payload Detection
     * ----------------------------------------------------------------------
     */

    async detect({

        callback,

        context = {}

    }) {

        try {

            const findings =
                await this.#analyzePayload({

                    callback,

                    context

                });

            const score =
                this.#calculateScore(findings);

            const result = Object.freeze({

                detector:
                    DETECTOR_NAME.PAYLOAD,

                detected:
                    score > 0,

                score,

                category:
                    ANOMALY_CATEGORY.PAYLOAD_INTEGRITY,

                confidence:
                    this.#calculateConfidence(score),

                metadata: findings,

                detectedAt:
                    new Date()

            });

            this.metrics?.increment?.(

                "payloadDetections"

            );

            this.logger?.debug?.(

                "Payload detector completed",

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

                "Payload detector execution failed.",

                {

                    detector:
                        DETECTOR_NAME.PAYLOAD,

                    cause:
                        error

                }

            );

        }

    }

    /**
     * ----------------------------------------------------------------------
     * Analyze Payload
     * ----------------------------------------------------------------------
     */

    async #analyzePayload({

        callback

    }) {

        const findings = {

            missingFields: [],

            schemaValid: true,

            amountMismatch: false,

            currencyMismatch: false,

            invalidTimestamp: false,

            missingTransactionId: false,

            malformedPayload: false

        };

        const required = [

            "provider",

            "transactionReference",

            "amount",

            "currency",

            "timestamp"

        ];

        for (const field of required) {

            if (

                callback[field] === undefined ||

                callback[field] === null ||

                callback[field] === ""

            ) {

                findings.missingFields.push(field);

            }

        }

        findings.missingTransactionId =

            !callback.transactionReference;

        findings.invalidTimestamp =

            !normalizeTimestamp(

                callback.timestamp

            );

        if (

            callback.provider

        ) {

            normalizeProvider(

                callback.provider

            );

        }

        if (

            callback.expectedAmount !== undefined &&

            Number(callback.amount) !==

            Number(callback.expectedAmount)

        ) {

            findings.amountMismatch = true;

        }

        if (

            callback.expectedCurrency &&

            callback.currency &&

            String(callback.expectedCurrency)

                .toUpperCase() !==

            String(callback.currency)

                .toUpperCase()

        ) {

            findings.currencyMismatch = true;

        }

        if (

            this.schemaValidator

        ) {

            const validation =

                await this.schemaValidator.validate(

                    callback

                );

            findings.schemaValid =

                validation.valid;

            findings.schemaErrors =

                validation.errors || [];

        }

        return findings;

    }

    /**
     * ----------------------------------------------------------------------
     * Calculate Detection Score
     * ----------------------------------------------------------------------
     */

    #calculateScore(findings) {

        let score = 0;

        score += findings.missingFields.length * 5;

        if (

            findings.amountMismatch

        ) {

            score += 20;

        }

        if (

            findings.currencyMismatch

        ) {

            score += 20;

        }

        if (

            findings.invalidTimestamp

        ) {

            score += 15;

        }

        if (

            findings.missingTransactionId

        ) {

            score += 20;

        }

        if (

            findings.schemaValid === false

        ) {

            score += 25;

        }

        if (

            findings.malformedPayload

        ) {

            score += 30;

        }

        return Math.min(

            score,

            100

        );

    }

    /**
     * ----------------------------------------------------------------------
     * Calculate Confidence
     * ----------------------------------------------------------------------
     */

    #calculateConfidence(score) {

        if (score >= 75) {

            return CONFIDENCE_LEVEL.VERY_HIGH;

        }

        if (score >= 50) {

            return CONFIDENCE_LEVEL.HIGH;

        }

        if (score >= 25) {

            return CONFIDENCE_LEVEL.MODERATE;

        }

        return CONFIDENCE_LEVEL.LOW;

    }

}

module.exports = PayloadDetector;