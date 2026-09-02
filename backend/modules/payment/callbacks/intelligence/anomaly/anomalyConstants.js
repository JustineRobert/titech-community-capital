/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Constants
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Centralized Anomaly Configuration
 * • Enterprise Detection Categories
 * • Severity Classification
 * • Confidence Levels
 * • Processing States
 * • Detector Registry Constants
 * • Recommendation Types
 * • Enterprise Threshold Defaults
 * • Provider Independent
 * • Immutable Configuration
 * • Extensible Architecture
 *
 * Purpose
 * -------
 * This file serves as the single source of truth for the Enterprise Callback
 * Anomaly Detection subsystem.
 *
 * It centralizes:
 *
 * • Detection categories
 * • Detector identifiers
 * • Processing states
 * • Severity classifications
 * • Recommendation types
 * • Confidence levels
 * • Enterprise thresholds
 *
 * All anomaly detectors MUST import constants from this file rather than
 * hardcoding string literals or numeric thresholds.
 *
 * ============================================================================
 */

/**
 * --------------------------------------------------------------------------
 * Detector Names
 * --------------------------------------------------------------------------
 */

const DETECTOR_NAME = Object.freeze({

    VOLUME:
        "volumeDetector",

    DUPLICATE:
        "duplicateDetector",

    SEQUENCE:
        "sequenceDetector",

    LATENCY:
        "latencyDetector",

    FAILURE_RATE:
        "failureRateDetector",

    PAYLOAD:
        "payloadDetector",

    TIMING:
        "timingDetector",

    IP:
        "ipDetector"

});


/**
 * --------------------------------------------------------------------------
 * Detection Categories
 * --------------------------------------------------------------------------
 */

const ANOMALY_CATEGORY = Object.freeze({

    NONE:
        "none",

    VOLUME_SPIKE:
        "volume_spike",

    DUPLICATE_REFERENCE:
        "duplicate_reference",

    CALLBACK_SEQUENCE:
        "callback_sequence",

    PROVIDER_LATENCY:
        "provider_latency",

    FAILURE_RATE:
        "failure_rate",

    PAYLOAD_INTEGRITY:
        "payload_integrity",

    CALLBACK_TIMING:
        "callback_timing",

    SOURCE_IP:
        "source_ip",

    UNKNOWN:
        "unknown"

});


/**
 * --------------------------------------------------------------------------
 * Severity Levels
 * --------------------------------------------------------------------------
 */

const SEVERITY = Object.freeze({

    NONE:
        "NONE",

    LOW:
        "LOW",

    MEDIUM:
        "MEDIUM",

    HIGH:
        "HIGH",

    CRITICAL:
        "CRITICAL"

});


/**
 * --------------------------------------------------------------------------
 * Recommendation Types
 * --------------------------------------------------------------------------
 */

const RECOMMENDATION = Object.freeze({

    NONE:
        "none",

    CONTINUE_MONITORING:
        "continue_monitoring",

    INCREASE_MONITORING:
        "increase_monitoring",

    INVESTIGATE:
        "investigate",

    MANUAL_REVIEW:
        "manual_review",

    ESCALATE_OPERATIONS:
        "escalate_operations",

    ESCALATE_SECURITY:
        "escalate_security",

    PROVIDER_FAILOVER:
        "provider_failover"

});


/**
 * --------------------------------------------------------------------------
 * Confidence Levels
 * --------------------------------------------------------------------------
 */

const CONFIDENCE_LEVEL = Object.freeze({

    VERY_LOW:
        0.20,

    LOW:
        0.40,

    MODERATE:
        0.60,

    HIGH:
        0.80,

    VERY_HIGH:
        0.95

});


/**
 * --------------------------------------------------------------------------
 * Detection Processing States
 * --------------------------------------------------------------------------
 */

const PROCESSING_STATE = Object.freeze({

    RECEIVED:
        "received",

    COLLECTING_CONTEXT:
        "collecting_context",

    ANALYZING:
        "analyzing",

    SCORING:
        "scoring",

    CLASSIFYING:
        "classifying",

    RECOMMENDING:
        "recommending",

    COMPLETED:
        "completed",

    FAILED:
        "failed"

});


/**
 * --------------------------------------------------------------------------
 * Enterprise Default Thresholds
 * --------------------------------------------------------------------------
 */

const THRESHOLDS = Object.freeze({

    /**
     * Maximum callback latency before
     * latency anomaly detection.
     */
    MAX_CALLBACK_LATENCY_MS:
        10000,

    /**
     * Maximum provider failure rate.
     */
    MAX_FAILURE_RATE_PERCENT:
        5,

    /**
     * Duplicate callback detection window.
     */
    DUPLICATE_WINDOW_SECONDS:
        300,

    /**
     * Callback volume spike multiplier.
     */
    VOLUME_SPIKE_MULTIPLIER:
        3,

    /**
     * Maximum callbacks per source IP
     * within one minute.
     */
    MAX_CALLBACKS_PER_IP_PER_MINUTE:
        120,

    /**
     * Maximum acceptable callback age.
     */
    MAX_CALLBACK_AGE_MINUTES:
        30,

    /**
     * Payload integrity score threshold.
     */
    MIN_PAYLOAD_SCORE:
        90,

    /**
     * Minimum anomaly score requiring
     * operational review.
     */
    REVIEW_SCORE:
        50,

    /**
     * Minimum anomaly score requiring
     * provider escalation.
     */
    ESCALATION_SCORE:
        75,

    /**
     * Minimum anomaly score requiring
     * failover recommendation.
     */
    FAILOVER_SCORE:
        90

});


/**
 * --------------------------------------------------------------------------
 * Event Types
 * --------------------------------------------------------------------------
 */

const ANOMALY_EVENT = Object.freeze({

    DETECTION_STARTED:
        "callback.anomaly.started",

    DETECTION_COMPLETED:
        "callback.anomaly.completed",

    ANOMALY_DETECTED:
        "callback.anomaly.detected",

    HIGH_SEVERITY:
        "callback.anomaly.high",

    CRITICAL_SEVERITY:
        "callback.anomaly.critical"

});


/**
 * --------------------------------------------------------------------------
 * Supported Detector Execution Order
 * --------------------------------------------------------------------------
 */

const DETECTOR_PIPELINE = Object.freeze([

    DETECTOR_NAME.VOLUME,

    DETECTOR_NAME.DUPLICATE,

    DETECTOR_NAME.SEQUENCE,

    DETECTOR_NAME.LATENCY,

    DETECTOR_NAME.FAILURE_RATE,

    DETECTOR_NAME.PAYLOAD,

    DETECTOR_NAME.TIMING,

    DETECTOR_NAME.IP

]);


/**
 * --------------------------------------------------------------------------
 * Module Exports
 * --------------------------------------------------------------------------
 */

module.exports = Object.freeze({

    DETECTOR_NAME,

    ANOMALY_CATEGORY,

    SEVERITY,

    RECOMMENDATION,

    CONFIDENCE_LEVEL,

    PROCESSING_STATE,

    THRESHOLDS,

    ANOMALY_EVENT,

    DETECTOR_PIPELINE

});