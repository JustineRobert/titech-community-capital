'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Metrics Engine
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionMetrics.js
 *
 * Purpose
 * -------
 * Central observability layer for distributed financial transactions.
 *
 * Responsibilities
 * ----------------
 * • Transaction counters
 * • Transaction gauges
 * • Histogram measurements
 * • State transition metrics
 * • Retry / timeout metrics
 * • Recovery metrics
 * • Lock metrics
 * • Idempotency metrics
 * • Outbox metrics
 * • Failure classification
 * • Tenant/provider/operation dimensions
 * • Prometheus adapter integration
 * • OpenTelemetry adapter hooks
 * • Runtime snapshots
 * • Health diagnostics
 *
 * Design Principles
 * -----------------
 * • Best-effort observability
 * • Metrics failures never break financial workflows
 * • Bounded metric cardinality
 * • Stable metric names
 * • Explicit label allow-list
 * • No secrets in labels
 * • No unbounded dynamic metric names
 * • In-memory statistics remain available for diagnostics/tests
 *
 * IMPORTANT
 * ---------
 * High-cardinality identifiers such as:
 *
 * • transactionId
 * • requestId
 * • correlationId
 * • eventId
 * • idempotencyKey
 *
 * MUST NOT be Prometheus labels.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_SERVICE_NAME =
    'transaction-service';


const DEFAULT_HISTOGRAM_BUCKETS =
    Object.freeze([

        5,
        10,
        25,
        50,
        100,
        250,
        500,
        1000,
        2500,
        5000,
        10000,
        30000,
        60000

    ]);


const DEFAULT_LABELS =
    Object.freeze({

        tenantId:
            'unknown',

        provider:
            'internal',

        operation:
            'unknown',

        status:
            'unknown',

        outcome:
            'unknown',

        errorCode:
            'none',

        errorCategory:
            'none'

    });


/**
 * Only low-cardinality labels should be exposed to Prometheus/OpenTelemetry.
 */
const LABEL_KEYS =
    Object.freeze([

        'tenantId',

        'provider',

        'operation',

        'status',

        'outcome',

        'errorCode',

        'errorCategory'

    ]);


/**
 * ============================================================================
 * Metric Names
 * ============================================================================
 */

const METRICS = Object.freeze({

    TRANSACTIONS_STARTED:
        'transactions_started_total',

    TRANSACTIONS_COMPLETED:
        'transactions_completed_total',

    TRANSACTIONS_FAILED:
        'transactions_failed_total',

    TRANSACTIONS_ROLLED_BACK:
        'transactions_rolled_back_total',

    TRANSACTIONS_TIMEOUT:
        'transactions_timeout_total',

    TRANSACTIONS_RETRY:
        'transactions_retry_total',

    TRANSACTIONS_RECOVERED:
        'transactions_recovered_total',

    TRANSACTIONS_LOCK_WAIT:
        'transactions_lock_wait_total',

    TRANSACTIONS_AUDIT_EVENTS:
        'transactions_audit_events_total',

    TRANSACTIONS_ACTIVE:
        'transactions_active',

    TRANSACTION_DURATION:
        'transaction_duration_ms',

    TRANSACTION_OPERATION_DURATION:
        'transaction_operation_duration_ms',

    TRANSACTION_STATE_TRANSITIONS:
        'transaction_state_transitions_total',

    TRANSACTION_ERRORS:
        'transaction_errors_total',

    TRANSACTION_FAILURES:
        'transaction_failures_total',

    LOCK_ACQUIRED:
        'transaction_lock_acquired_total',

    LOCK_RELEASED:
        'transaction_lock_released_total',

    LOCK_TIMEOUT:
        'transaction_lock_timeout_total',

    LOCK_RENEWED:
        'transaction_lock_renewed_total',

    LOCK_LEASE_LOST:
        'transaction_lock_lease_lost_total',

    IDEMPOTENCY_RESERVED:
        'transaction_idempotency_reserved_total',

    IDEMPOTENCY_DUPLICATE:
        'transaction_idempotency_duplicate_total',

    IDEMPOTENCY_CONFLICT:
        'transaction_idempotency_conflict_total',

    IDEMPOTENCY_COMPLETED:
        'transaction_idempotency_completed_total',

    OUTBOX_CLAIMED:
        'transaction_outbox_claimed_total',

    OUTBOX_PUBLISHED:
        'transaction_outbox_published_total',

    OUTBOX_FAILED:
        'transaction_outbox_publish_failure_total',

    OUTBOX_RETRY:
        'transaction_outbox_retry_total',

    OUTBOX_DEAD_LETTERED:
        'transaction_outbox_dead_lettered_total',

    OUTBOX_HEARTBEAT:
        'transaction_outbox_heartbeat_total',

    OUTBOX_LEASE_LOST:
        'transaction_outbox_lease_lost_total',

    RECOVERY_STARTED:
        'transaction_recovery_started_total',

    RECOVERY_COMPLETED:
        'transaction_recovery_completed_total',

    RECOVERY_FAILED:
        'transaction_recovery_failed_total',

    RECOVERY_DURATION:
        'transaction_recovery_duration_ms'

});


/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function stableStringify(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return String(
            value
        );

    }

    if (
        Array.isArray(value)
    ) {

        return `[${value.map(
            stableStringify
        ).join(',')}]`;

    }

    if (
        typeof value !== 'object'
    ) {

        return JSON.stringify(
            value
        );

    }

    return `{${Object.keys(value)
        .sort()
        .map(
            key =>
                `${JSON.stringify(key)}:${stableStringify(
                    value[key]
                )}`
        )
        .join(',')}}`;

}


function normalizeNumber(
    value,
    fallback = 0
) {

    const numeric =
        Number(
            value
        );


    return Number.isFinite(
        numeric
    )
        ? numeric
        : fallback;

}


/**
 * ============================================================================
 * Transaction Metrics
 * ============================================================================
 */

class TransactionMetrics {

    constructor(
        options = {}
    ) {

        this.logger =
            options.logger ||
            console;


        this.prometheus =
            options.prometheus ||
            null;


        this.tracer =
            options.tracer ||
            null;


        this.openTelemetry =
            options.openTelemetry ||
            null;


        this.serviceName =
            options.serviceName ||
            DEFAULT_SERVICE_NAME;


        this.environment =
            options.environment ||
            process.env.NODE_ENV ||
            'development';


        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();


        this.histogramBuckets =
            Object.freeze(
                (
                    options.histogramBuckets ||
                    DEFAULT_HISTOGRAM_BUCKETS
                )
                    .map(
                        value =>
                            Number(
                                value
                            )
                    )
                    .filter(
                        Number.isFinite
                    )
                    .sort(
                        (a, b) =>
                            a - b
                    )
            );


        this.metrics = {

            counters:
                {},

            gauges:
                {},

            histograms:
                {}

        };


        this.activeTransactions =
            new Map();


        this.recoveryTimers =
            new Map();


        this.initialiseDefaults();

    }


    /**
     * =========================================================================
     * Default Metrics
     * =========================================================================
     */

    initialiseDefaults() {

        [

            METRICS.TRANSACTIONS_STARTED,

            METRICS.TRANSACTIONS_COMPLETED,

            METRICS.TRANSACTIONS_FAILED,

            METRICS.TRANSACTIONS_ROLLED_BACK,

            METRICS.TRANSACTIONS_TIMEOUT,

            METRICS.TRANSACTIONS_RETRY,

            METRICS.TRANSACTIONS_RECOVERED,

            METRICS.TRANSACTIONS_LOCK_WAIT,

            METRICS.TRANSACTIONS_AUDIT_EVENTS,

            METRICS.TRANSACTIONS_ERRORS,

            METRICS.TRANSACTIONS_FAILURES,

            METRICS.LOCK_ACQUIRED,

            METRICS.LOCK_RELEASED,

            METRICS.LOCK_TIMEOUT,

            METRICS.LOCK_RENEWED,

            METRICS.LOCK_LEASE_LOST,

            METRICS.IDEMPOTENCY_RESERVED,

            METRICS.IDEMPOTENCY_DUPLICATE,

            METRICS.IDEMPOTENCY_CONFLICT,

            METRICS.IDEMPOTENCY_COMPLETED,

            METRICS.OUTBOX_CLAIMED,

            METRICS.OUTBOX_PUBLISHED,

            METRICS.OUTBOX_FAILED,

            METRICS.OUTBOX_RETRY,

            METRICS.OUTBOX_DEAD_LETTERED,

            METRICS.OUTBOX_HEARTBEAT,

            METRICS.OUTBOX_LEASE_LOST,

            METRICS.RECOVERY_STARTED,

            METRICS.RECOVERY_COMPLETED,

            METRICS.RECOVERY_FAILED

        ].forEach(
            name =>
                this.createCounter(
                    name
                )
        );


        this.createGauge(
            METRICS.TRANSACTIONS_ACTIVE
        );


        this.createHistogram(
            METRICS.TRANSACTION_DURATION
        );


        this.createHistogram(
            METRICS.TRANSACTION_OPERATION_DURATION
        );


        this.createHistogram(
            METRICS.RECOVERY_DURATION
        );

    }


    /**
     * =========================================================================
     * Counter
     * =========================================================================
     */

    createCounter(
        name
    ) {

        const metricName =
            this.normalizeMetricName(
                name
            );


        if (
            !this.metrics.counters[metricName]
        ) {

            this.metrics.counters[metricName] = {

                value:
                    0,

                series:
                    {}

            };

        }


        return metricName;

    }


    increment(
        name,
        labels = {},
        amount = 1
    ) {

        const metricName =
            this.createCounter(
                name
            );


        const increment =
            normalizeNumber(
                amount,
                1
            );


        const normalizedLabels =
            this.labels(
                labels
            );


        const key =
            this.labelKey(
                normalizedLabels
            );


        const counter =
            this.metrics.counters[
                metricName
            ];


        counter.value +=
            increment;


        counter.series[key] =
            (
                counter.series[key] ||
                0
            ) +
            increment;


        this.exportMetric(
            metricName,
            'counter',
            normalizedLabels,
            increment
        );


        return counter.value;

    }


    /**
     * =========================================================================
     * Gauge
     * =========================================================================
     */

    createGauge(
        name
    ) {

        const metricName =
            this.normalizeMetricName(
                name
            );


        if (
            !this.metrics.gauges[metricName]
        ) {

            this.metrics.gauges[metricName] = {

                value:
                    0

            };

        }


        return metricName;

    }


    setGauge(
        name,
        value,
        labels = {}
    ) {

        const metricName =
            this.createGauge(
                name
            );


        const normalizedValue =
            normalizeNumber(
                value
            );


        const normalizedLabels =
            this.labels(
                labels
            );


        this.metrics.gauges[
            metricName
        ].value =
            normalizedValue;


        this.exportMetric(
            metricName,
            'gauge',
            normalizedLabels,
            normalizedValue
        );


        return normalizedValue;

    }


    incrementGauge(
        name,
        amount = 1,
        labels = {}
    ) {

        const metricName =
            this.createGauge(
                name
            );


        const gauge =
            this.metrics.gauges[
                metricName
            ];


        gauge.value +=
            normalizeNumber(
                amount,
                1
            );


        if (
            gauge.value < 0
        ) {

            gauge.value =
                0;

        }


        this.exportMetric(
            metricName,
            'gauge',
            this.labels(
                labels
            ),
            gauge.value
        );


        return gauge.value;

    }


    decrementGauge(
        name,
        amount = 1,
        labels = {}
    ) {

        return this.incrementGauge(
            name,
            -Math.abs(
                normalizeNumber(
                    amount,
                    1
                )
            ),
            labels
        );

    }


    /**
     * =========================================================================
     * Histogram
     * =========================================================================
     */

    createHistogram(
        name
    ) {

        const metricName =
            this.normalizeMetricName(
                name
            );


        if (
            !this.metrics.histograms[metricName]
        ) {

            this.metrics.histograms[
                metricName
            ] = {

                count:
                    0,

                total:
                    0,

                min:
                    null,

                max:
                    null,

                buckets:
                    this.histogramBuckets.map(
                        upperBound => ({

                            upperBound,

                            count:
                                0

                        })
                    ),

                series:
                    {}

            };

        }


        return metricName;

    }


    observe(
        name,
        value,
        labels = {}
    ) {

        const metricName =
            this.createHistogram(
                name
            );


        const numericValue =
            normalizeNumber(
                value,
                0
            );


        const normalizedLabels =
            this.labels(
                labels
            );


        const key =
            this.labelKey(
                normalizedLabels
            );


        const histogram =
            this.metrics.histograms[
                metricName
            ];


        histogram.count +=
            1;


        histogram.total +=
            numericValue;


        histogram.min =
            histogram.min === null

                ? numericValue

                : Math.min(
                    histogram.min,
                    numericValue
                );


        histogram.max =
            histogram.max === null

                ? numericValue

                : Math.max(
                    histogram.max,
                    numericValue
                );


        let series =
            histogram.series[key];


        if (
            !series
        ) {

            series = {

                count:
                    0,

                total:
                    0,

                min:
                    null,

                max:
                    null,

                buckets:
                    this.histogramBuckets.map(
                        upperBound => ({

                            upperBound,

                            count:
                                0

                        })
                    )

            };


            histogram.series[key] =
                series;

        }


        series.count++;
        series.total +=
            numericValue;

        series.min =
            series.min === null

                ? numericValue

                : Math.min(
                    series.min,
                    numericValue
                );

        series.max =
            series.max === null

                ? numericValue

                : Math.max(
                    series.max,
                    numericValue
                );


        for (
            const bucket
            of histogram.buckets
        ) {

            if (
                numericValue <=
                bucket.upperBound
            ) {

                bucket.count++;

            }

        }


        for (
            const bucket
            of series.buckets
        ) {

            if (
                numericValue <=
                bucket.upperBound
            ) {

                bucket.count++;

            }

        }


        this.exportMetric(
            metricName,
            'histogram',
            normalizedLabels,
            numericValue
        );


        return numericValue;

    }


    /**
     * =========================================================================
     * Alias
     * =========================================================================
     */

    histogram(
        name,
        value,
        labels = {}
    ) {

        return this.observe(
            name,
            value,
            labels
        );

    }


    /**
     * =========================================================================
     * Transaction Lifecycle
     * =========================================================================
     */

    transactionStarted(
        context = {}
    ) {

        const transactionId =
            context.transactionId;


        if (
            transactionId
        ) {

            this.activeTransactions.set(

                this.activityKey(
                    context
                ),

                {

                    transactionId,

                    tenantId:
                        context.tenantId ||
                        'unknown',

                    startedAt:
                        Date.now()

                }

            );

        }


        this.increment(

            METRICS.TRANSACTIONS_STARTED,

            this.labels(
                context
            )

        );


        this.incrementGauge(

            METRICS.TRANSACTIONS_ACTIVE,

            1

        );


        return true;

    }


    transactionCompleted(
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTIONS_COMPLETED,

            this.labels(
                {
                    ...context,
                    outcome:
                        'success',
                    status:
                        'COMPLETED'
                }
            )

        );


        this.finishDuration(
            context
        );


        return true;

    }


    transactionFailed(
        context = {}
    ) {

        const errorLabels =
            this.errorLabels(
                context.error
            );


        this.increment(

            METRICS.TRANSACTIONS_FAILED,

            this.labels({

                ...context,

                ...errorLabels,

                outcome:
                    'failure',

                status:
                    'FAILED'

            })

        );


        this.increment(

            METRICS.TRANSACTIONS_FAILURES,

            this.labels({

                ...context,

                ...errorLabels

            })

        );


        this.finishDuration(
            context
        );


        return true;

    }


    transactionRollback(
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTIONS_ROLLED_BACK,

            this.labels({

                ...context,

                outcome:
                    'rollback',

                status:
                    'ROLLED_BACK'

            })

        );


        this.finishDuration(
            context
        );


        return true;

    }


    transactionTimeout(
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTIONS_TIMEOUT,

            this.labels({

                ...context,

                outcome:
                    'timeout',

                status:
                    'TIMEOUT'

            })

        );


        this.finishDuration(
            context
        );


        return true;

    }


    transactionRetry(
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTIONS_RETRY,

            this.labels({

                ...context,

                outcome:
                    'retry'

            })

        );


        return true;

    }


    transactionRecovered(
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTIONS_RECOVERED,

            this.labels({

                ...context,

                outcome:
                    'recovered',

                status:
                    'RECOVERED'

            })

        );


        return true;

    }


    /**
     * =========================================================================
     * Duration
     * =========================================================================
     */

    finishDuration(
        context = {}
    ) {

        const key =
            this.activityKey(
                context
            );


        const active =
            this.activeTransactions.get(
                key
            );


        if (
            !active
        ) {

            return null;

        }


        const duration =
            Math.max(

                0,

                Date.now() -
                active.startedAt

            );


        this.observe(

            METRICS.TRANSACTION_DURATION,

            duration,

            this.labels(
                context
            )

        );


        this.activeTransactions.delete(
            key
        );


        this.decrementGauge(
            METRICS.TRANSACTIONS_ACTIVE
        );


        return duration;

    }


    /**
     * =========================================================================
     * Explicit Duration API
     * =========================================================================
     */

    transactionDuration(
        duration,
        context = {}
    ) {

        return this.observe(

            METRICS.TRANSACTION_DURATION,

            duration,

            this.labels(
                context
            )

        );

    }


    /**
     * =========================================================================
     * State Transition
     * =========================================================================
     *
     * Do NOT create:
     *
     * transaction_state_CREATED_to_PROCESSING_total
     *
     * as a Prometheus metric name.
     *
     * Use one bounded metric with labels instead.
     */

    stateTransition(
        from,
        to,
        context = {}
    ) {

        this.increment(

            METRICS.TRANSACTION_STATE_TRANSITIONS,

            this.labels({

                ...context,

                status:
                    `${from || 'UNKNOWN'}_TO_${to || 'UNKNOWN'}`

            })

        );


        return true;

    }


    /**
     * =========================================================================
     * Operation Duration
     * =========================================================================
     */

    operationDuration(
        duration,
        context = {}
    ) {

        return this.observe(

            METRICS.TRANSACTION_OPERATION_DURATION,

            duration,

            this.labels(
                context
            )

        );

    }


    /**
     * =========================================================================
     * Error Recording
     * =========================================================================
     */

    recordError(
        error,
        context = {}
    ) {

        const errorLabels =
            this.errorLabels(
                error
            );


        return this.increment(

            METRICS.TRANSACTIONS_ERRORS,

            this.labels({

                ...context,

                ...errorLabels,

                outcome:
                    'error'

            })

        );

    }


    /**
     * =========================================================================
     * Lock Metrics
     * =========================================================================
     */

    lockAcquired(
        context = {}
    ) {

        return this.increment(

            METRICS.LOCK_ACQUIRED,

            this.labels(
                context
            )

        );

    }


    lockReleased(
        context = {}
    ) {

        return this.increment(

            METRICS.LOCK_RELEASED,

            this.labels(
                context
            )

        );

    }


    lockTimeout(
        context = {}
    ) {

        return this.increment(

            METRICS.LOCK_TIMEOUT,

            this.labels({

                ...context,

                outcome:
                    'timeout'

            })

        );

    }


    lockRenewed(
        context = {}
    ) {

        return this.increment(

            METRICS.LOCK_RENEWED,

            this.labels(
                context
            )

        );

    }


    lockLeaseLost(
        context = {}
    ) {

        return this.increment(

            METRICS.LOCK_LEASE_LOST,

            this.labels({

                ...context,

                outcome:
                    'lease_lost'

            })

        );

    }


    lockWait(
        context = {}
    ) {

        return this.increment(

            METRICS.TRANSACTIONS_LOCK_WAIT,

            this.labels(
                context
            )

        );

    }


    /**
     * =========================================================================
     * Idempotency Metrics
     * =========================================================================
     */

    idempotencyReserved(
        context = {}
    ) {

        return this.increment(

            METRICS.IDEMPOTENCY_RESERVED,

            this.labels(
                context
            )

        );

    }


    idempotencyDuplicate(
        context = {}
    ) {

        return this.increment(

            METRICS.IDEMPOTENCY_DUPLICATE,

            this.labels({

                ...context,

                outcome:
                    'duplicate'

            })

        );

    }


    idempotencyConflict(
        context = {}
    ) {

        return this.increment(

            METRICS.IDEMPOTENCY_CONFLICT,

            this.labels({

                ...context,

                outcome:
                    'conflict'

            })

        );

    }


    idempotencyCompleted(
        context = {}
    ) {

        return this.increment(

            METRICS.IDEMPOTENCY_COMPLETED,

            this.labels(
                context
            )

        );

    }


    /**
     * =========================================================================
     * Outbox Metrics
     * =========================================================================
     */

    outboxClaimed(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_CLAIMED,

            this.labels(
                context
            )

        );

    }


    outboxPublished(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_PUBLISHED,

            this.labels({

                ...context,

                outcome:
                    'success'

            })

        );

    }


    outboxFailed(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_FAILED,

            this.labels({

                ...context,

                outcome:
                    'failure'

            })

        );

    }


    outboxRetry(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_RETRY,

            this.labels({

                ...context,

                outcome:
                    'retry'

            })

        );

    }


    outboxDeadLettered(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_DEAD_LETTERED,

            this.labels({

                ...context,

                outcome:
                    'dead_letter'

            })

        );

    }


    outboxHeartbeat(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_HEARTBEAT,

            this.labels(
                context
            )

        );

    }


    outboxLeaseLost(
        context = {}
    ) {

        return this.increment(

            METRICS.OUTBOX_LEASE_LOST,

            this.labels({

                ...context,

                outcome:
                    'lease_lost'

            })

        );

    }


    /**
     * =========================================================================
     * Recovery Metrics
     * =========================================================================
     */

    recoveryStarted(
        context = {}
    ) {

        this.increment(

            METRICS.RECOVERY_STARTED,

            this.labels(
                context
            )

        );


        this.recoveryTimers.set(

            this.activityKey(
                context
            ),

            Date.now()

        );


        return true;

    }


    recoveryCompleted(
        context = {}
    ) {

        this.increment(

            METRICS.RECOVERY_COMPLETED,

            this.labels({

                ...context,

                outcome:
                    'success'

            })

        );


        this.finishRecoveryDuration(
            context
        );


        return true;

    }


    recoveryFailed(
        context = {}
    ) {

        const errorLabels =
            this.errorLabels(
                context.error
            );


        this.increment(

            METRICS.RECOVERY_FAILED,

            this.labels({

                ...context,

                ...errorLabels,

                outcome:
                    'failure'

            })

        );


        this.finishRecoveryDuration(
            context
        );


        return true;

    }


    finishRecoveryDuration(
        context = {}
    ) {

        const key =
            this.activityKey(
                context
            );


        const started =
            this.recoveryTimers.get(
                key
            );


        if (
            !started
        ) {

            return null;

        }


        const duration =
            Math.max(

                0,

                Date.now() -
                started

            );


        this.observe(

            METRICS.RECOVERY_DURATION,

            duration,

            this.labels(
                context
            )

        );


        this.recoveryTimers.delete(
            key
        );


        return duration;

    }


    /**
     * =========================================================================
     * Labels
     * =========================================================================
     */

    labels(
        context = {}
    ) {

        const output = {};


        for (
            const key
            of LABEL_KEYS
        ) {

            let value =
                context[key];


            if (
                value ===
                    undefined ||
                value ===
                    null ||
                value ===
                    ''
            ) {

                value =
                    DEFAULT_LABELS[key];

            }


            output[key] =
                this.normalizeLabel(
                    key,
                    value
                );

        }


        return output;

    }


    /**
     * =========================================================================
     * Error Labels
     * =========================================================================
     */

    errorLabels(
        error
    ) {

        if (
            !error
        ) {

            return {

                errorCode:
                    'none',

                errorCategory:
                    'none'

            };

        }


        return {

            errorCode:
                this.normalizeLabel(

                    'errorCode',

                    error.code ||
                    'unknown'

                ),

            errorCategory:
                this.normalizeLabel(

                    'errorCategory',

                    error.category ||
                    error.name ||
                    'unknown'

                )

        };

    }


    /**
     * =========================================================================
     * Label Sanitization
     * =========================================================================
     */

    normalizeLabel(
        key,
        value
    ) {

        let normalized =
            String(
                value
            )
                .trim();


        /**
         * Protect against accidental high-cardinality identifiers.
         *
         * Do not put UUID-shaped transaction IDs into labels even if a caller
         * accidentally supplies one under an accepted dimension.
         */

        if (
            [
                'tenantId'
            ].includes(
                key
            )
        ) {

            normalized =
                normalized.slice(
                    0,
                    128
                );

        }


        if (
            [
                'provider',
                'operation',
                'status',
                'outcome',
                'errorCode',
                'errorCategory'
            ].includes(
                key
            )
        ) {

            normalized =
                normalized
                    .toLowerCase()
                    .replace(
                        /[^a-z0-9_.:-]/g,
                        '_'
                    )
                    .slice(
                        0,
                        128
                    );

        }


        return normalized ||
            'unknown';

    }


    /**
     * =========================================================================
     * Label Key
     * =========================================================================
     */

    labelKey(
        labels
    ) {

        return stableStringify(
            labels
        );

    }


    /**
     * =========================================================================
     * Activity Key
     * =========================================================================
     */

    activityKey(
        context = {}
    ) {

        /**
         * A transaction ID should be unique inside a tenant.
         * Keep correlation ID as fallback for workflow instances that have not
         * received a transaction ID yet.
         */
        return [

            context.tenantId ||
                'unknown',

            context.transactionId ||
                context.correlationId ||
                context.requestId ||
                crypto.randomUUID()

        ].join(':');

    }


    /**
     * =========================================================================
     * Prometheus / External Export
     * =========================================================================
     */

    exportMetric(
        name,
        type,
        labels = {},
        value = 1
    ) {

        try {

            if (
                this.prometheus?.record
            ) {

                this.prometheus.record({

                    name,

                    type,

                    labels,

                    value

                });

            }
            else if (
                this.prometheus?.increment &&
                type ===
                    'counter'
            ) {

                this.prometheus.increment(

                    name,

                    value,

                    labels

                );

            }
            else if (
                this.prometheus?.set &&
                type ===
                    'gauge'
            ) {

                this.prometheus.set(

                    name,

                    value,

                    labels

                );

            }
            else if (
                this.prometheus?.observe &&
                type ===
                    'histogram'
            ) {

                this.prometheus.observe(

                    name,

                    value,

                    labels

                );

            }


            /**
             * Optional OpenTelemetry bridge.
             */
            this.exportOpenTelemetry(

                name,

                type,

                labels,

                value

            );

        }
        catch (error) {

            this.logger?.warn?.({

                message:
                    'Transaction metrics export failed',

                metric:
                    name,

                type,

                error:
                    error.message

            });

            /**
             * Metrics failure must never impact the transaction.
             */

        }

    }


    /**
     * =========================================================================
     * OpenTelemetry
     * =========================================================================
     */

    exportOpenTelemetry(
        name,
        type,
        labels,
        value
    ) {

        try {

            if (
                !this.openTelemetry
            ) {

                return;

            }


            if (
                typeof this.openTelemetry.record ===
                'function'
            ) {

                this.openTelemetry.record({

                    name,

                    type,

                    labels,

                    value

                });

            }
            else if (
                typeof this.openTelemetry.increment ===
                'function' &&
                type ===
                    'counter'
            ) {

                this.openTelemetry.increment(

                    name,

                    value,

                    labels

                );

            }
            else if (
                typeof this.openTelemetry.observe ===
                'function' &&
                type ===
                    'histogram'
            ) {

                this.openTelemetry.observe(

                    name,

                    value,

                    labels

                );

            }

        }
        catch (_) {

            /**
             * OpenTelemetry must never affect transaction execution.
             */

        }

    }


    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            service:
                this.serviceName,

            environment:
                this.environment,

            instanceId:
                this.instanceId,

            timestamp:
                new Date(),

            activeTransactions:
                this.activeTransactions.size,

            counters:
                this.cloneMetrics(
                    this.metrics.counters
                ),

            gauges:
                this.cloneMetrics(
                    this.metrics.gauges
                ),

            histograms:
                this.cloneMetrics(
                    this.metrics.histograms
                )

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            status:
                'UP',

            component:
                'transaction-metrics',

            service:
                this.serviceName,

            environment:
                this.environment,

            instanceId:
                this.instanceId,

            activeTransactions:
                this.activeTransactions.size,

            activeRecoveryTimers:
                this.recoveryTimers.size,

            metricCounts: {

                counters:
                    Object.keys(
                        this.metrics.counters
                    ).length,

                gauges:
                    Object.keys(
                        this.metrics.gauges
                    ).length,

                histograms:
                    Object.keys(
                        this.metrics.histograms
                    ).length

            }

        };

    }


    /**
     * =========================================================================
     * Runtime Statistics
     * =========================================================================
     */

    getStatistics() {

        return {

            service:
                this.serviceName,

            environment:
                this.environment,

            activeTransactions:
                this.activeTransactions.size,

            activeRecoveryTimers:
                this.recoveryTimers.size,

            counters:
                Object.keys(
                    this.metrics.counters
                ).length,

            gauges:
                Object.keys(
                    this.metrics.gauges
                ).length,

            histograms:
                Object.keys(
                    this.metrics.histograms
                ).length

        };

    }


    /**
     * =========================================================================
     * Clone Metrics
     * =========================================================================
     */

    cloneMetrics(
        value
    ) {

        try {

            return JSON.parse(
                JSON.stringify(
                    value
                )
            );

        }
        catch (_) {

            return {};

        }

    }


    /**
     * =========================================================================
     * Reset
     * =========================================================================
     */

    reset() {

        this.metrics = {

            counters:
                {},

            gauges:
                {},

            histograms:
                {}

        };


        this.activeTransactions.clear();


        this.recoveryTimers.clear();


        this.initialiseDefaults();

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.activeTransactions.clear();

        this.recoveryTimers.clear();

        return true;

    }


    /**
     * =========================================================================
     * Metric Name Normalization
     * =========================================================================
     */

    normalizeMetricName(
        name
    ) {

        return String(
            name
        )
            .trim()
            .replace(
                /[^a-zA-Z0-9_:]/g,
                '_'
            );

    }

}


/**
 * ============================================================================
 * Static API
 * ============================================================================
 */

TransactionMetrics.Metrics =
    METRICS;

TransactionMetrics.LabelKeys =
    LABEL_KEYS;

TransactionMetrics.DefaultLabels =
    DEFAULT_LABELS;


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TransactionMetrics;