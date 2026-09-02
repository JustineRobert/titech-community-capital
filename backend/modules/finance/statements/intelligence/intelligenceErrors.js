'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Intelligence Errors
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/intelligenceErrors.js
 *
 * Purpose
 * -------
 * Shared enterprise error hierarchy for the Statement Intelligence subsystem.
 *
 * Used By
 * -------
 * • priorityEngine
 * • severityScorer
 * • anomalyClassifier
 * • repairAnalytics
 * • agingMetrics
 * • slaMonitor
 * • recommendationEngine
 * • riskIndexCalculator
 * • trendDetector
 * • executiveDashboard
 *
 * Design Principles
 * -----------------
 * • Consistent error hierarchy
 * • Serializable
 * • Audit friendly
 * • Observability ready
 * • Cause preservation
 * • Retry awareness
 * • Multi-tenant aware
 * • Correlation aware
 * • Safe serialization
 * • Backward compatible
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const INTELLIGENCE_ERROR_CODE = Object.freeze({

    INTELLIGENCE_ERROR:
        'INTELLIGENCE_ERROR',

    ANALYTICS_ERROR:
        'ANALYTICS_ERROR',

    RECOMMENDATION_ERROR:
        'RECOMMENDATION_ERROR',

    TREND_ANALYSIS_ERROR:
        'TREND_ANALYSIS_ERROR',

    SLA_VIOLATION_ERROR:
        'SLA_VIOLATION_ERROR',

    CLASSIFICATION_ERROR:
        'CLASSIFICATION_ERROR'

});

/**
 * ============================================================================
 * Error Categories
 * ============================================================================
 */

const INTELLIGENCE_ERROR_CATEGORY = Object.freeze({

    VALIDATION:
        'VALIDATION',

    ANALYTICS:
        'ANALYTICS',

    RECOMMENDATION:
        'RECOMMENDATION',

    TREND_ANALYSIS:
        'TREND_ANALYSIS',

    SLA:
        'SLA',

    CLASSIFICATION:
        'CLASSIFICATION',

    SYSTEM:
        'SYSTEM',

    DEPENDENCY:
        'DEPENDENCY',

    CONFIGURATION:
        'CONFIGURATION',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Error Severity
 * ============================================================================
 */

const INTELLIGENCE_ERROR_SEVERITY = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Error Retry Policy
 * ============================================================================
 */

const RETRY_POLICY = Object.freeze({

    NOT_RETRYABLE:
        'NOT_RETRYABLE',

    IMMEDIATE:
        'IMMEDIATE',

    BACKOFF:
        'BACKOFF',

    DEPENDENCY_RECOVERY:
        'DEPENDENCY_RECOVERY',

    MANUAL:
        'MANUAL'

});

/**
 * ============================================================================
 * Internal Utility Functions
 * ============================================================================
 */

/**
 * Safely convert arbitrary values into finite numbers.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(
    value,
    fallback = 0
) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Safely clone a value for error context.
 *
 * This intentionally avoids JSON.stringify because context may contain:
 * • circular references
 * • BigInt values
 * • Error instances
 * • Dates
 * • undefined
 *
 * @param {*} value
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {*}
 */
function sanitizeValue(
    value,
    depth = 0,
    seen = new WeakSet()
) {

    const MAX_DEPTH = 10;

    if (
        depth > MAX_DEPTH
    ) {

        return '[MAX_DEPTH_EXCEEDED]';

    }

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {

        return value;

    }

    if (
        typeof value === 'bigint'
    ) {

        return value.toString();

    }

    if (
        typeof value === 'function'
    ) {

        return '[FUNCTION]';

    }

    if (
        value instanceof Date
    ) {

        return Number.isNaN(
            value.getTime()
        )
            ? null
            : value.toISOString();

    }

    if (
        value instanceof Error
    ) {

        return {

            name:
                value.name,

            message:
                value.message,

            code:
                value.code,

            stack:
                value.stack

        };

    }

    if (
        typeof value !== 'object'
    ) {

        return String(value);

    }

    if (
        seen.has(value)
    ) {

        return '[CIRCULAR_REFERENCE]';

    }

    seen.add(value);

    if (
        Array.isArray(value)
    ) {

        const result =
            value.map(
                item =>
                    sanitizeValue(
                        item,
                        depth + 1,
                        seen
                    )
            );

        seen.delete(value);

        return result;

    }

    const result = {};

    for (
        const [
            key,
            child
        ] of Object.entries(value)
    ) {

        result[key] =
            sanitizeValue(
                child,
                depth + 1,
                seen
            );

    }

    seen.delete(value);

    return result;

}

/**
 * Safely normalize an underlying cause.
 *
 * @param {*} cause
 * @returns {object|null}
 */
function normalizeCause(
    cause
) {

    if (
        !cause
    ) {

        return null;

    }

    if (
        cause instanceof Error
    ) {

        return {

            name:
                cause.name,

            message:
                cause.message,

            code:
                cause.code || null,

            stack:
                cause.stack || null

        };

    }

    if (
        typeof cause === 'object'
    ) {

        return sanitizeValue(
            cause
        );

    }

    return {

        name:
            typeof cause,

        message:
            String(cause)

    };

}

/**
 * ============================================================================
 * Base Intelligence Error
 * ============================================================================
 */

class IntelligenceError extends Error {

    /**
     * @param {string} message
     * @param {object} options
     */
    constructor(
        message,
        {
            code =
                INTELLIGENCE_ERROR_CODE.INTELLIGENCE_ERROR,

            category =
                INTELLIGENCE_ERROR_CATEGORY.SYSTEM,

            severity =
                INTELLIGENCE_ERROR_SEVERITY.MEDIUM,

            context = {},

            retryable = false,

            retryPolicy =
                RETRY_POLICY.NOT_RETRYABLE,

            retryAfterMs = null,

            operational = true,

            httpStatus = 500,

            tenantId = null,

            correlationId = null,

            requestId = null,

            operation = null,

            service = 'statement-intelligence',

            metadata = {},

            cause = null

        } = {}

    ) {

        super(
            typeof message === 'string' &&
            message.trim()
                ? message
                : 'Statement intelligence operation failed'
        );

        this.name =
            this.constructor.name;

        this.code =
            code;

        this.category =
            category;

        this.severity =
            severity;

        this.context =
            Object.freeze(
                sanitizeValue(
                    context
                ) || {}
            );

        this.retryable =
            Boolean(
                retryable
            );

        this.retryPolicy =
            retryPolicy;

        this.retryAfterMs =
            retryAfterMs === null
                ? null
                : Math.max(
                    0,
                    toFiniteNumber(
                        retryAfterMs
                    )
                );

        this.operational =
            Boolean(
                operational
            );

        this.httpStatus =
            Math.min(
                599,
                Math.max(
                    400,
                    Math.trunc(
                        toFiniteNumber(
                            httpStatus,
                            500
                        )
                    )
                )
            );

        this.tenantId =
            tenantId ?? null;

        this.correlationId =
            correlationId ?? null;

        this.requestId =
            requestId ?? null;

        this.operation =
            operation ?? null;

        this.service =
            service || 'statement-intelligence';

        this.metadata =
            Object.freeze(
                sanitizeValue(
                    metadata
                ) || {}
            );

        this.timestamp =
            new Date();

        this.cause =
            normalizeCause(
                cause
            );

        /**
         * Maintain Node.js Error cause compatibility where possible.
         */
        if (
            cause
        ) {

            try {

                this.originalCause =
                    cause;

            } catch (_) {

                // Intentionally ignored.

            }

        }

        if (
            typeof Error.captureStackTrace ===
            'function'
        ) {

            Error.captureStackTrace(
                this,
                this.constructor
            );

        }

    }

    /**
     * =========================================================================
     * Error Serialization
     * =========================================================================
     */

    toJSON() {

        return {

            name:
                this.name,

            message:
                this.message,

            code:
                this.code,

            category:
                this.category,

            severity:
                this.severity,

            retryable:
                this.retryable,

            retryPolicy:
                this.retryPolicy,

            retryAfterMs:
                this.retryAfterMs,

            operational:
                this.operational,

            httpStatus:
                this.httpStatus,

            tenantId:
                this.tenantId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            operation:
                this.operation,

            service:
                this.service,

            context:
                this.context,

            metadata:
                this.metadata,

            timestamp:
                this.timestamp instanceof Date
                    ? this.timestamp.toISOString()
                    : this.timestamp,

            cause:
                this.cause

        };

    }

    /**
     * =========================================================================
     * Safe Audit Representation
     * =========================================================================
     *
     * Intentionally excludes stack traces and original error objects.
     */

    toAuditJSON() {

        return {

            name:
                this.name,

            code:
                this.code,

            category:
                this.category,

            severity:
                this.severity,

            retryable:
                this.retryable,

            retryPolicy:
                this.retryPolicy,

            operational:
                this.operational,

            tenantId:
                this.tenantId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            operation:
                this.operation,

            service:
                this.service,

            context:
                this.context,

            metadata:
                this.metadata,

            timestamp:
                this.timestamp instanceof Date
                    ? this.timestamp.toISOString()
                    : this.timestamp

        };

    }

    /**
     * =========================================================================
     * Observability Representation
     * =========================================================================
     */

    toLogJSON() {

        return {

            error: {

                name:
                    this.name,

                message:
                    this.message,

                code:
                    this.code,

                category:
                    this.category,

                severity:
                    this.severity,

                retryable:
                    this.retryable,

                retryPolicy:
                    this.retryPolicy,

                retryAfterMs:
                    this.retryAfterMs,

                operational:
                    this.operational,

                httpStatus:
                    this.httpStatus

            },

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            tenantId:
                this.tenantId,

            operation:
                this.operation,

            service:
                this.service,

            timestamp:
                this.timestamp instanceof Date
                    ? this.timestamp.toISOString()
                    : this.timestamp,

            cause:
                this.cause

        };

    }

}

/**
 * ============================================================================
 * Analytics Error
 * ============================================================================
 */

class AnalyticsError extends IntelligenceError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                category:
                    INTELLIGENCE_ERROR_CATEGORY.ANALYTICS,

                ...options,

                code:
                    INTELLIGENCE_ERROR_CODE.ANALYTICS_ERROR

            }
        );

    }

}

/**
 * ============================================================================
 * Recommendation Error
 * ============================================================================
 */

class RecommendationError extends IntelligenceError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                category:
                    INTELLIGENCE_ERROR_CATEGORY.RECOMMENDATION,

                ...options,

                code:
                    INTELLIGENCE_ERROR_CODE.RECOMMENDATION_ERROR

            }
        );

    }

}

/**
 * ============================================================================
 * Trend Analysis Error
 * ============================================================================
 */

class TrendAnalysisError extends IntelligenceError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                category:
                    INTELLIGENCE_ERROR_CATEGORY.TREND_ANALYSIS,

                ...options,

                code:
                    INTELLIGENCE_ERROR_CODE.TREND_ANALYSIS_ERROR

            }
        );

    }

}

/**
 * ============================================================================
 * SLA Violation Error
 * ============================================================================
 */

class SLAViolationError extends IntelligenceError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                category:
                    INTELLIGENCE_ERROR_CATEGORY.SLA,

                severity:
                    options.severity ||
                    INTELLIGENCE_ERROR_SEVERITY.HIGH,

                ...options,

                code:
                    INTELLIGENCE_ERROR_CODE.SLA_VIOLATION_ERROR

            }
        );

    }

}

/**
 * ============================================================================
 * Classification Error
 * ============================================================================
 */

class ClassificationError extends IntelligenceError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                category:
                    INTELLIGENCE_ERROR_CATEGORY.CLASSIFICATION,

                ...options,

                code:
                    INTELLIGENCE_ERROR_CODE.CLASSIFICATION_ERROR

            }
        );

    }

}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    IntelligenceError,

    AnalyticsError,

    RecommendationError,

    TrendAnalysisError,

    SLAViolationError,

    ClassificationError,

    INTELLIGENCE_ERROR_CODE,

    INTELLIGENCE_ERROR_CATEGORY,

    INTELLIGENCE_ERROR_SEVERITY,

    RETRY_POLICY

});
