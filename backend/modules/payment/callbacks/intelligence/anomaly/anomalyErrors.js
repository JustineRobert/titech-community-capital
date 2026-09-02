/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Errors
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Domain-Specific Error Hierarchy
 * • Detector Failure Classification
 * • Infrastructure Error Separation
 * • Scoring Error Classification
 * • Recommendation Error Classification
 * • Context Preservation
 * • Error Codes
 * • Retry Classification
 * • Audit Friendly
 * • Structured Logging Ready
 * • OpenTelemetry Friendly
 *
 * Purpose
 * -------
 * Provides anomaly-specific exceptions for the Enterprise Callback
 * Intelligence Platform.
 *
 * Benefits
 * --------
 * • Eliminates generic Error usage
 * • Enables intelligent error handling
 * • Improves observability
 * • Supports operational troubleshooting
 * • Simplifies alerting and monitoring
 *
 * ============================================================================
 */


/**
 * --------------------------------------------------------------------------
 * Base Anomaly Error
 * --------------------------------------------------------------------------
 */

class AnomalyError extends Error {

    constructor(
        message,
        {
            code = "ANOMALY_ERROR",
            retryable = false,
            context = {}
        } = {}
    ) {

        super(message);

        this.name =
            this.constructor.name;

        this.code =
            code;

        this.retryable =
            retryable;

        this.context =
            context;

        this.timestamp =
            new Date();

        Error.captureStackTrace(
            this,
            this.constructor
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * General Detection Failure
 * --------------------------------------------------------------------------
 */

class AnomalyDetectionError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "ANOMALY_DETECTION_ERROR",

                retryable:
                    false,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Invalid Callback Payload
 * --------------------------------------------------------------------------
 */

class InvalidCallbackPayloadError
extends AnomalyError {

    constructor(
        message =
            "Invalid callback payload.",
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "INVALID_CALLBACK_PAYLOAD",

                retryable:
                    false,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Detector Execution Failure
 * --------------------------------------------------------------------------
 */

class DetectorExecutionError
extends AnomalyError {

    constructor(
        detector,
        cause,
        context = {}
    ) {

        super(
            `Detector execution failed: ${detector}`,
            {
                code:
                    "DETECTOR_EXECUTION_ERROR",

                retryable:
                    true,

                context: {
                    detector,
                    cause:
                        cause?.message,
                    ...context
                }
            }
        );

        this.cause =
            cause;
    }

}


/**
 * --------------------------------------------------------------------------
 * Detector Not Registered
 * --------------------------------------------------------------------------
 */

class DetectorNotRegisteredError
extends AnomalyError {

    constructor(
        detector
    ) {

        super(
            `Detector not registered: ${detector}`,
            {
                code:
                    "DETECTOR_NOT_REGISTERED",

                retryable:
                    false,

                context: {
                    detector
                }
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Detector Timeout
 * --------------------------------------------------------------------------
 */

class DetectorTimeoutError
extends AnomalyError {

    constructor(
        detector,
        timeoutMs
    ) {

        super(
            `Detector timeout: ${detector}`,
            {
                code:
                    "DETECTOR_TIMEOUT",

                retryable:
                    true,

                context: {
                    detector,
                    timeoutMs
                }
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Score Calculation Failure
 * --------------------------------------------------------------------------
 */

class ScoreCalculationError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "SCORE_CALCULATION_ERROR",

                retryable:
                    false,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Recommendation Generation Failure
 * --------------------------------------------------------------------------
 */

class RecommendationGenerationError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "RECOMMENDATION_GENERATION_ERROR",

                retryable:
                    false,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Invalid Detection Result
 * --------------------------------------------------------------------------
 */

class InvalidDetectionResultError
extends AnomalyError {

    constructor(
        detector,
        context = {}
    ) {

        super(
            `Invalid detector result returned by ${detector}`,
            {
                code:
                    "INVALID_DETECTION_RESULT",

                retryable:
                    false,

                context: {
                    detector,
                    ...context
                }
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Configuration Failure
 * --------------------------------------------------------------------------
 */

class AnomalyConfigurationError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "ANOMALY_CONFIGURATION_ERROR",

                retryable:
                    false,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * External Dependency Failure
 * --------------------------------------------------------------------------
 */

class AnomalyDependencyError
extends AnomalyError {

    constructor(
        dependency,
        cause,
        context = {}
    ) {

        super(
            `Dependency failure: ${dependency}`,
            {
                code:
                    "ANOMALY_DEPENDENCY_ERROR",

                retryable:
                    true,

                context: {
                    dependency,
                    cause:
                        cause?.message,
                    ...context
                }
            }
        );

        this.cause =
            cause;
    }

}


/**
 * --------------------------------------------------------------------------
 * Audit Failure
 * --------------------------------------------------------------------------
 */

class AnomalyAuditError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "ANOMALY_AUDIT_ERROR",

                retryable:
                    true,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Event Publishing Failure
 * --------------------------------------------------------------------------
 */

class AnomalyEventPublishError
extends AnomalyError {

    constructor(
        message,
        context = {}
    ) {

        super(
            message,
            {
                code:
                    "ANOMALY_EVENT_PUBLISH_ERROR",

                retryable:
                    true,

                context
            }
        );
    }

}


/**
 * --------------------------------------------------------------------------
 * Export Boundary
 * --------------------------------------------------------------------------
 */

module.exports = Object.freeze({

    AnomalyError,

    AnomalyDetectionError,

    InvalidCallbackPayloadError,

    DetectorExecutionError,

    DetectorNotRegisteredError,

    DetectorTimeoutError,

    ScoreCalculationError,

    RecommendationGenerationError,

    InvalidDetectionResultError,

    AnomalyConfigurationError,

    AnomalyDependencyError,

    AnomalyAuditError,

    AnomalyEventPublishError

});