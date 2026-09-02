'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Publisher Metrics
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionPublisherMetrics.js
 *
 * Purpose:
 *   Enterprise observability abstraction for the transaction publishing
 *   reliability subsystem.
 *
 * Responsibilities:
 *
 *   • Transaction publisher metrics
 *   • Publish success/failure metrics
 *   • Retry metrics
 *   • Dead-letter metrics
 *   • Circuit-breaker metrics
 *   • Backpressure metrics
 *   • Idempotency/replay metrics
 *   • Publishing latency measurements
 *   • Queue depth / inflight measurements
 *   • Safe Prometheus integration
 *   • Label normalization
 *   • Cardinality protection
 *   • Metrics backend failure isolation
 *   • Runtime health snapshots
 *
 * Design Principles:
 *
 *   1. Metrics MUST NEVER break financial transaction execution.
 *   2. Metrics backend availability is non-critical to transaction correctness.
 *   3. High-cardinality values such as transaction IDs MUST NOT become labels.
 *   4. The service remains compatible with simple metric adapters exposing:
 *
 *        increment(name, value)
 *        observe(name, value)
 *
 *   5. Supports richer adapters exposing:
 *
 *        increment(name, value, labels)
 *        observe(name, value, labels)
 *        gauge(name, value, labels)
 *        set(name, value, labels)
 *
 * =============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,

    strict: false,

    namespace: 'titech_transaction',

    serviceName:
        process.env.SERVICE_NAME ||
        'transaction-service',

    environment:
        process.env.NODE_ENV ||
        'development',

    maxMetricNameLength: 120,

    maxLabelKeyLength: 50,

    maxLabelValueLength: 100,

    maxLabels: 12,

    maxMetricOperationsPerSecond: 10000,

    emitInternalMetrics: true,

    timingUnit: 'milliseconds'
});

const METRIC_TYPES = Object.freeze({
    COUNTER: 'counter',
    GAUGE: 'gauge',
    HISTOGRAM: 'histogram'
});

const DEFAULT_LABELS = Object.freeze([
    'service',
    'environment'
]);

const RESERVED_HIGH_CARDINALITY_KEYS = new Set([
    'transactionId',
    'transactionID',
    'correlationId',
    'correlationID',
    'requestId',
    'requestID',
    'executionId',
    'executionID',
    'traceId',
    'traceID',
    'spanId',
    'spanID',
    'eventId',
    'eventID',
    'messageId',
    'messageID',
    'userId',
    'userID',
    'memberId',
    'memberID',
    'accountId',
    'accountID',
    'customerId',
    'customerID',
    'sessionId',
    'sessionID'
]);

const STANDARD_METRICS = Object.freeze({
    PUBLISH_ATTEMPTS:
        'publisher_publish_attempts_total',

    PUBLISH_SUCCESS:
        'publisher_publish_success_total',

    PUBLISH_FAILURE:
        'publisher_publish_failure_total',

    PUBLISH_RETRIES:
        'publisher_publish_retries_total',

    PUBLISH_LATENCY:
        'publisher_publish_latency_ms',

    PUBLISH_TIMEOUTS:
        'publisher_publish_timeouts_total',

    PUBLISH_REJECTED:
        'publisher_publish_rejected_total',

    PUBLISH_DUPLICATES:
        'publisher_duplicate_total',

    PUBLISH_REPLAYS:
        'publisher_replay_total',

    PUBLISH_IN_FLIGHT:
        'publisher_in_flight',

    QUEUE_DEPTH:
        'publisher_queue_depth',

    QUEUE_WAIT:
        'publisher_queue_wait_ms',

    DEAD_LETTERED:
        'publisher_dead_letter_total',

    DEAD_LETTER_RESTORED:
        'publisher_dead_letter_restored_total',

    DEAD_LETTER_FAILED:
        'publisher_dead_letter_restore_failed_total',

    CIRCUIT_OPEN:
        'publisher_circuit_open_total',

    CIRCUIT_HALF_OPEN:
        'publisher_circuit_half_open_total',

    CIRCUIT_CLOSED:
        'publisher_circuit_closed_total',

    CIRCUIT_REJECTED:
        'publisher_circuit_rejected_total',

    BACKPRESSURE_REJECTED:
        'publisher_backpressure_rejected_total',

    BACKPRESSURE_WAIT:
        'publisher_backpressure_wait_ms',

    BACKPRESSURE_QUEUE:
        'publisher_backpressure_queue_depth',

    IDEMPOTENCY_HIT:
        'publisher_idempotency_hit_total',

    IDEMPOTENCY_MISS:
        'publisher_idempotency_miss_total',

    IDEMPOTENCY_CONFLICT:
        'publisher_idempotency_conflict_total',

    VALIDATION_FAILURE:
        'publisher_validation_failure_total',

    SERIALIZATION_FAILURE:
        'publisher_serialization_failure_total',

    UNKNOWN_FAILURE:
        'publisher_unknown_failure_total',

    METRIC_ERRORS:
        'metrics_internal_error_total',

    METRIC_DROPPED:
        'metrics_dropped_total'
});

class TransactionPublisherMetrics {
    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {
        this.prometheus =
            options.prometheus ||
            options.metrics ||
            null;

        this.logger =
            options.logger ||
            console;

        this.config = Object.freeze({
            ...DEFAULT_CONFIG,
            ...(options.config || {})
        });

        this.metricPrefix =
            this.buildMetricPrefix(
                this.config.namespace
            );

        this.startedAt = new Date();

        this.internal = {
            operations: 0,
            dropped: 0,
            errors: 0,
            lastError: null,
            lastOperationAt: null
        };

        this.runtime = {
            inFlight: 0,
            queueDepth: 0,
            lastPublishStartedAt: null,
            lastPublishCompletedAt: null,
            lastPublishLatencyMs: null,
            lastPublishError: null
        };

        this.rateWindow = {
            startedAt: Date.now(),
            operations: 0
        };

        this.validateConfiguration();
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {
        if (!this.config.enabled) {
            return true;
        }

        if (
            !Number.isFinite(
                this.config.maxLabels
            ) ||
            this.config.maxLabels < 1
        ) {
            throw new Error(
                'TransactionPublisherMetrics.maxLabels must be a positive number'
            );
        }

        if (
            !Number.isFinite(
                this.config.maxMetricOperationsPerSecond
            ) ||
            this.config.maxMetricOperationsPerSecond < 1
        ) {
            throw new Error(
                'TransactionPublisherMetrics.maxMetricOperationsPerSecond must be positive'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Metric Name Builder
     * =========================================================================
     */

    buildMetricPrefix(namespace) {
        const normalized =
            this.normalizeMetricName(namespace);

        return normalized
            ? `${normalized}_`
            : '';
    }

    buildMetricName(name) {
        const normalized =
            this.normalizeMetricName(name);

        if (!normalized) {
            throw new Error(
                'Metric name is required'
            );
        }

        const fullName =
            `${this.metricPrefix}${normalized}`;

        return fullName.substring(
            0,
            this.config.maxMetricNameLength
        );
    }

    normalizeMetricName(name) {
        if (
            name === undefined ||
            name === null
        ) {
            return '';
        }

        return String(name)
            .trim()
            .replace(/[^a-zA-Z0-9_:]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase();
    }

    /**
     * =========================================================================
     * Label Normalization
     * =========================================================================
     *
     * High-cardinality identifiers are deliberately discarded.
     */

    normalizeLabels(labels = {}) {
        if (
            !labels ||
            typeof labels !== 'object' ||
            Array.isArray(labels)
        ) {
            return {};
        }

        const normalized = {};

        const entries =
            Object.entries(labels);

        for (const [key, value] of entries) {
            if (
                RESERVED_HIGH_CARDINALITY_KEYS.has(
                    key
                )
            ) {
                continue;
            }

            if (
                value === undefined ||
                value === null
            ) {
                continue;
            }

            const normalizedKey =
                this.normalizeLabelKey(key);

            if (!normalizedKey) {
                continue;
            }

            if (
                Object.keys(normalized).length >=
                this.config.maxLabels
            ) {
                break;
            }

            normalized[normalizedKey] =
                this.normalizeLabelValue(value);
        }

        return normalized;
    }

    normalizeLabelKey(key) {
        return String(key)
            .trim()
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(
                0,
                this.config.maxLabelKeyLength
            )
            .toLowerCase();
    }

    normalizeLabelValue(value) {
        let normalized;

        if (
            typeof value === 'object'
        ) {
            try {
                normalized =
                    JSON.stringify(value);
            } catch {
                normalized =
                    '[object]';
            }
        } else {
            normalized =
                String(value);
        }

        return normalized
            .replace(/\s+/g, '_')
            .substring(
                0,
                this.config.maxLabelValueLength
            );
    }

    buildLabels(labels = {}) {
        return this.normalizeLabels({
            service:
                this.config.serviceName,

            environment:
                this.config.environment,

            ...labels
        });
    }

    /**
     * =========================================================================
     * Internal Rate Protection
     * =========================================================================
     */

    allowMetricOperation() {
        const now = Date.now();

        if (
            now -
            this.rateWindow.startedAt >=
            1000
        ) {
            this.rateWindow.startedAt =
                now;

            this.rateWindow.operations =
                0;
        }

        if (
            this.rateWindow.operations >=
            this.config.maxMetricOperationsPerSecond
        ) {
            this.internal.dropped++;

            return false;
        }

        this.rateWindow.operations++;

        return true;
    }

    /**
     * =========================================================================
     * Safe Metric Invocation
     * =========================================================================
     */

    safeInvoke(operation, name, value, labels = {}) {
        if (!this.config.enabled) {
            return false;
        }

        if (!this.prometheus) {
            return false;
        }

        if (!this.allowMetricOperation()) {
            this.safeInternalMetric(
                STANDARD_METRICS.METRIC_DROPPED
            );

            return false;
        }

        const metricName =
            this.buildMetricName(name);

        const normalizedLabels =
            this.buildLabels(labels);

        try {
            this.internal.operations++;

            this.internal.lastOperationAt =
                new Date();

            const method =
                this.prometheus[operation];

            if (
                typeof method !== 'function'
            ) {
                if (
                    this.config.strict
                ) {
                    throw new Error(
                        `Metrics adapter does not implement ${operation}()`
                    );
                }

                return false;
            }

            if (
                operation === 'increment'
            ) {
                method.call(
                    this.prometheus,
                    metricName,
                    value,
                    normalizedLabels
                );
            } else {
                method.call(
                    this.prometheus,
                    metricName,
                    value,
                    normalizedLabels
                );
            }

            return true;
        } catch (error) {
            this.internal.errors++;

            this.internal.lastError = {
                message:
                    error.message,

                operation,

                metricName,

                timestamp:
                    new Date()
            };

            this.logMetricError(
                error
            );

            return false;
        }
    }

    safeInternalMetric(name, value = 1) {
        if (
            !this.prometheus ||
            !this.config.emitInternalMetrics
        ) {
            return false;
        }

        try {
            const metricName =
                this.buildMetricName(name);

            if (
                typeof this.prometheus.increment ===
                'function'
            ) {
                this.prometheus.increment(
                    metricName,
                    value,
                    this.buildLabels()
                );

                return true;
            }
        } catch {
            // Metrics must never affect transaction execution.
        }

        return false;
    }

    logMetricError(error) {
        try {
            this.logger.warn?.(
                {
                    component:
                        'TransactionPublisherMetrics',

                    error:
                        error.message
                },
                'Transaction publisher metric emission failed'
            );
        } catch {
            // Deliberately ignored.
        }
    }

    /**
     * =========================================================================
     * Generic Counter
     * =========================================================================
     */

    increment(
        name,
        value = 1,
        labels = {}
    ) {
        const numericValue =
            Number(value);

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return false;
        }

        return this.safeInvoke(
            'increment',
            name,
            numericValue,
            labels
        );
    }

    /**
     * =========================================================================
     * Generic Observation
     * =========================================================================
     */

    observe(
        name,
        value,
        labels = {}
    ) {
        const numericValue =
            Number(value);

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return false;
        }

        return this.safeInvoke(
            'observe',
            name,
            numericValue,
            labels
        );
    }

    /**
     * =========================================================================
     * Gauge
     * =========================================================================
     */

    gauge(
        name,
        value,
        labels = {}
    ) {
        const numericValue =
            Number(value);

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return false;
        }

        if (
            typeof this.prometheus?.gauge ===
            'function'
        ) {
            return this.safeInvoke(
                'gauge',
                name,
                numericValue,
                labels
            );
        }

        if (
            typeof this.prometheus?.set ===
            'function'
        ) {
            return this.safeInvoke(
                'set',
                name,
                numericValue,
                labels
            );
        }

        return false;
    }

    /**
     * =========================================================================
     * Publisher Attempt
     * =========================================================================
     */

    recordPublishAttempt(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_ATTEMPTS,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Publisher Success
     * =========================================================================
     */

    recordPublishSuccess(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_SUCCESS,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Publisher Failure
     * =========================================================================
     */

    recordPublishFailure(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_FAILURE,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Retry
     * =========================================================================
     */

    recordRetry(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_RETRIES,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Publish Latency
     * =========================================================================
     */

    recordPublishLatency(
        milliseconds,
        labels = {}
    ) {
        const value =
            Number(milliseconds);

        if (
            !Number.isFinite(value) ||
            value < 0
        ) {
            return false;
        }

        this.runtime.lastPublishLatencyMs =
            value;

        return this.observe(
            STANDARD_METRICS.PUBLISH_LATENCY,
            value,
            labels
        );
    }

    /**
     * =========================================================================
     * Publish Timing Helper
     * =========================================================================
     *
     * Usage:
     *
     * const timer =
     *     metrics.startPublishTimer(labels);
     *
     * ...
     *
     * timer.end();
     */

    startPublishTimer(
        labels = {}
    ) {
        const startedAt =
            process.hrtime.bigint();

        this.runtime.lastPublishStartedAt =
            new Date();

        let completed = false;

        return {
            end: () => {
                if (completed) {
                    return null;
                }

                completed = true;

                const endedAt =
                    process.hrtime.bigint();

                const milliseconds =
                    Number(
                        endedAt -
                        startedAt
                    ) / 1e6;

                this.recordPublishLatency(
                    milliseconds,
                    labels
                );

                this.runtime.lastPublishCompletedAt =
                    new Date();

                return milliseconds;
            }
        };
    }

    /**
     * =========================================================================
     * Timeout
     * =========================================================================
     */

    recordTimeout(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_TIMEOUTS,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Rejection
     * =========================================================================
     */

    recordRejected(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_REJECTED,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Duplicate
     * =========================================================================
     */

    recordDuplicate(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_DUPLICATES,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Replay
     * =========================================================================
     */

    recordReplay(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.PUBLISH_REPLAYS,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * In-Flight Transactions
     * =========================================================================
     */

    setInFlight(
        value,
        labels = {}
    ) {
        const numericValue =
            Math.max(
                0,
                Number(value) || 0
            );

        this.runtime.inFlight =
            numericValue;

        return this.gauge(
            STANDARD_METRICS.PUBLISH_IN_FLIGHT,
            numericValue,
            labels
        );
    }

    incrementInFlight(
        labels = {}
    ) {
        this.runtime.inFlight++;

        return this.setInFlight(
            this.runtime.inFlight,
            labels
        );
    }

    decrementInFlight(
        labels = {}
    ) {
        this.runtime.inFlight =
            Math.max(
                0,
                this.runtime.inFlight - 1
            );

        return this.setInFlight(
            this.runtime.inFlight,
            labels
        );
    }

    /**
     * =========================================================================
     * Queue Depth
     * =========================================================================
     */

    setQueueDepth(
        value,
        labels = {}
    ) {
        const depth =
            Math.max(
                0,
                Number(value) || 0
            );

        this.runtime.queueDepth =
            depth;

        return this.gauge(
            STANDARD_METRICS.QUEUE_DEPTH,
            depth,
            labels
        );
    }

    /**
     * =========================================================================
     * Queue Wait
     * =========================================================================
     */

    recordQueueWait(
        milliseconds,
        labels = {}
    ) {
        return this.observe(
            STANDARD_METRICS.QUEUE_WAIT,
            milliseconds,
            labels
        );
    }

    /**
     * =========================================================================
     * Dead Letter Metrics
     * =========================================================================
     */

    recordDeadLetter(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.DEAD_LETTERED,
            1,
            labels
        );
    }

    recordDeadLetterRestored(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.DEAD_LETTER_RESTORED,
            1,
            labels
        );
    }

    recordDeadLetterRestoreFailure(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.DEAD_LETTER_FAILED,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Circuit Breaker Metrics
     * =========================================================================
     */

    recordCircuitOpen(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.CIRCUIT_OPEN,
            1,
            labels
        );
    }

    recordCircuitHalfOpen(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.CIRCUIT_HALF_OPEN,
            1,
            labels
        );
    }

    recordCircuitClosed(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.CIRCUIT_CLOSED,
            1,
            labels
        );
    }

    recordCircuitRejected(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.CIRCUIT_REJECTED,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Backpressure Metrics
     * =========================================================================
     */

    recordBackpressureRejected(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.BACKPRESSURE_REJECTED,
            1,
            labels
        );
    }

    recordBackpressureWait(
        milliseconds,
        labels = {}
    ) {
        return this.observe(
            STANDARD_METRICS.BACKPRESSURE_WAIT,
            milliseconds,
            labels
        );
    }

    setBackpressureQueueDepth(
        value,
        labels = {}
    ) {
        return this.gauge(
            STANDARD_METRICS.BACKPRESSURE_QUEUE,
            value,
            labels
        );
    }

    /**
     * =========================================================================
     * Idempotency Metrics
     * =========================================================================
     */

    recordIdempotencyHit(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.IDEMPOTENCY_HIT,
            1,
            labels
        );
    }

    recordIdempotencyMiss(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.IDEMPOTENCY_MISS,
            1,
            labels
        );
    }

    recordIdempotencyConflict(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.IDEMPOTENCY_CONFLICT,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Validation / Serialization / Failure Metrics
     * =========================================================================
     */

    recordValidationFailure(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.VALIDATION_FAILURE,
            1,
            labels
        );
    }

    recordSerializationFailure(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.SERIALIZATION_FAILURE,
            1,
            labels
        );
    }

    recordUnknownFailure(
        labels = {}
    ) {
        return this.increment(
            STANDARD_METRICS.UNKNOWN_FAILURE,
            1,
            labels
        );
    }

    /**
     * =========================================================================
     * Generic Event Recorder
     * =========================================================================
     *
     * Allows reliability components to record custom events without bypassing
     * the metric safety layer.
     */

    recordEvent(
        eventName,
        labels = {},
        value = 1
    ) {
        const metric =
            `${STANDARD_METRICS_PREFIX_SAFE()}_${eventName}`;

        return this.increment(
            metric,
            value,
            labels
        );
    }

    /**
     * =========================================================================
     * Aggregate Publish Recording
     * =========================================================================
     *
     * Convenience method for publisher implementations.
     */

    recordPublishResult({
        success = false,
        latencyMs = null,
        retry = false,
        timeout = false,
        duplicate = false,
        rejected = false,
        labels = {}
    } = {}) {
        this.recordPublishAttempt(
            labels
        );

        if (success) {
            this.recordPublishSuccess(
                labels
            );
        } else {
            this.recordPublishFailure(
                labels
            );
        }

        if (retry) {
            this.recordRetry(
                labels
            );
        }

        if (timeout) {
            this.recordTimeout(
                labels
            );
        }

        if (duplicate) {
            this.recordDuplicate(
                labels
            );
        }

        if (rejected) {
            this.recordRejected(
                labels
            );
        }

        if (
            latencyMs !== null &&
            latencyMs !== undefined
        ) {
            this.recordPublishLatency(
                latencyMs,
                labels
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Runtime Snapshot
     * =========================================================================
     */

    getSnapshot() {
        return {
            enabled:
                this.config.enabled,

            metricsBackendAvailable:
                Boolean(
                    this.prometheus
                ),

            namespace:
                this.config.namespace,

            service:
                this.config.serviceName,

            environment:
                this.config.environment,

            startedAt:
                this.startedAt,

            runtime: {
                ...this.runtime
            },

            internal: {
                operations:
                    this.internal.operations,

                dropped:
                    this.internal.dropped,

                errors:
                    this.internal.errors,

                lastError:
                    this.internal.lastError,

                lastOperationAt:
                    this.internal.lastOperationAt
            }
        };
    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */

    isHealthy() {
        if (!this.config.enabled) {
            return true;
        }

        if (!this.prometheus) {
            return !this.config.strict;
        }

        return true;
    }

    async isReady() {
        return this.isHealthy();
    }

    /**
     * =========================================================================
     * Reset Runtime State
     * =========================================================================
     *
     * Intended primarily for tests and controlled runtime resets.
     */

    resetRuntimeState() {
        this.internal.operations = 0;
        this.internal.dropped = 0;
        this.internal.errors = 0;
        this.internal.lastError = null;
        this.internal.lastOperationAt = null;

        this.runtime.inFlight = 0;
        this.runtime.queueDepth = 0;
        this.runtime.lastPublishStartedAt = null;
        this.runtime.lastPublishCompletedAt = null;
        this.runtime.lastPublishLatencyMs = null;
        this.runtime.lastPublishError = null;

        this.rateWindow.startedAt =
            Date.now();

        this.rateWindow.operations = 0;

        return true;
    }
}

/**
 * =============================================================================
 * Safe Internal Metric Name Helper
 * =============================================================================
 *
 * Kept outside the class so custom event recording cannot accidentally expose
 * unsafe metric names.
 */

function STANDARD_METRICS_PREFIX_SAFE() {
    return 'publisher_event';
}

/**
 * =============================================================================
 * Static Metric Constants
 * =============================================================================
 */

TransactionPublisherMetrics.METRICS =
    STANDARD_METRICS;

TransactionPublisherMetrics.METRIC_TYPES =
    METRIC_TYPES;

/**
 * =============================================================================
 * Factory
 * =============================================================================
 *
 * Allows dependency injection without forcing consumers to instantiate the
 * class directly.
 */

TransactionPublisherMetrics.create =
    function create(options = {}) {
        return new TransactionPublisherMetrics(
            options
        );
    };

/**
 * =============================================================================
 * Module Export
 * =============================================================================
 */

module.exports =
    TransactionPublisherMetrics;