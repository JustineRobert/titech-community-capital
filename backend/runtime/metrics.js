"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Metrics
 * =============================================================================
 *
 * File:
 *   backend/runtime/metrics.js
 *
 * Purpose:
 *   Centralized production-grade application metrics subsystem for TITech
 *   Community Capital and its African Community Finance Operating System.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ Prometheus integration using a dedicated registry
 *   ✓ Optional StatsD / DogStatsD integration
 *   ✓ Optional OpenTelemetry metric bridge
 *   ✓ Pushgateway support
 *   ✓ Tenant-aware metrics
 *   ✓ Request metrics for Express and Koa
 *   ✓ Counter / Gauge / Histogram / Summary helpers
 *   ✓ Async and synchronous instrumentation
 *   ✓ Metric cardinality protection
 *   ✓ Stable collector definitions
 *   ✓ Safe no-op behavior when metrics are unavailable
 *   ✓ Runtime diagnostics
 *   ✓ Graceful shutdown
 *   ✓ Test reset support
 *   ✓ Error isolation
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   1. Metrics must never break business requests.
 *   2. Metrics must not contain credentials, tokens, phone numbers or PII.
 *   3. Tenant labels must be sanitized before export.
 *   4. Metric label sets must remain stable for each metric.
 *   5. High-cardinality values such as request IDs must never be labels.
 *   6. Prometheus remains optional.
 *   7. Statistics are process-local unless an external collector is configured.
 *
 * Typical usage:
 *
 *   const metrics = require("./backend/runtime/metrics");
 *
 *   await metrics.init({
 *       promClient: require("prom-client")
 *   });
 *
 *   app.use(
 *       metrics.expressMiddleware()
 *   );
 *
 *   metrics.inc(
 *       "loan_applications_total",
 *       1,
 *       {
 *           tenant: "kampala_sacco",
 *           status: "accepted"
 *       }
 *   );
 *
 * =============================================================================
 */

const os = require("os");
const crypto = require("crypto");
const EventEmitter = require("events");

const tenantConstants = require("../tenancy/tenant.constants");

// =============================================================================
// Environment / Defaults
// =============================================================================

function envBoolean(
    name,
    fallback
) {

    const value =
        process.env[name];

    if (
        value === undefined
    ) {

        return fallback;

    }

    return [
        "1",
        "true",
        "yes",
        "on"
    ].includes(
        String(value)
            .trim()
            .toLowerCase()
    );

}

function envNumber(
    name,
    fallback,
    {
        min = Number.NEGATIVE_INFINITY,
        max = Number.POSITIVE_INFINITY,
        integer = false
    } = {}
) {

    const raw =
        process.env[name];

    const parsed =
        raw === undefined
            ? fallback
            : Number(raw);

    if (
        !Number.isFinite(parsed)
    ) {

        return fallback;

    }

    if (
        parsed < min ||
        parsed > max
    ) {

        return fallback;

    }

    if (
        integer &&
        !Number.isInteger(parsed)
    ) {

        return fallback;

    }

    return parsed;

}

const DEFAULT_METRICS_PREFIX =
    tenantConstants?.ENV?.METRICS_PREFIX ||
    process.env.METRICS_PREFIX ||
    "titech";

const DEFAULTS = Object.freeze({

    METRICS_PREFIX:
        DEFAULT_METRICS_PREFIX,

    SERVICE_NAME:
        process.env.SERVICE_NAME ||
        "TITech.Service",

    DEFAULT_LABELS:
        Object.freeze({

            service:
                process.env.SERVICE_NAME ||
                "TITech.Service",

            host:
                os.hostname()

        }),

    DEFAULT_BUCKETS:
        Object.freeze([
            0.005,
            0.01,
            0.025,
            0.05,
            0.1,
            0.25,
            0.5,
            1,
            2.5,
            5,
            10
        ]),

    ENABLE_PROMETHEUS:
        envBoolean(
            "ENABLE_PROMETHEUS",
            true
        ),

    ENABLE_STATSD:
        envBoolean(
            "ENABLE_STATSD",
            false
        ),

    PUSHGATEWAY_URL:
        process.env.PUSHGATEWAY_URL ||
        null,

    PUSHGATEWAY_JOB:
        process.env.PUSHGATEWAY_JOB ||
        "titech",

    METRICS_PATH:
        process.env.METRICS_PATH ||
        "/metrics",

    TENANT_LABEL:
        "tenant",

    DEFAULT_TENANT:
        tenantConstants?.DEFAULTS?.DEFAULT_TENANT ||
        "public",

    MAX_LABEL_LENGTH:
        envNumber(
            "METRICS_MAX_LABEL_LENGTH",
            128,
            {
                min: 16,
                max: 512,
                integer: true
            }
        ),

    MAX_METRIC_NAME_LENGTH:
        envNumber(
            "METRICS_MAX_NAME_LENGTH",
            200,
            {
                min: 32,
                max: 512,
                integer: true
            }
        ),

    MAX_CACHE_ENTRIES:
        envNumber(
            "METRICS_MAX_COLLECTORS",
            2_000,
            {
                min: 100,
                max: 20_000,
                integer: true
            }
        ),

    REQUEST_ROUTE_FALLBACK:
        "unknown",

    LOG_PREFIX:
        "TITech.Metrics"

});

// =============================================================================
// State
// =============================================================================

const state = {

    initialized:
        false,

    shuttingDown:
        false,

    promClient:
        null,

    registry:
        null,

    statsdClient:
        null,

    otelExporter:
        null,

    pushgateway:
        null,

    metricsPrefix:
        DEFAULTS.METRICS_PREFIX,

    defaultLabels:
        Object.assign(
            {},
            DEFAULTS.DEFAULT_LABELS
        ),

    collectors: {

        counters:
            new Map(),

        gauges:
            new Map(),

        histograms:
            new Map(),

        summaries:
            new Map()

    },

    emitter:
        new EventEmitter(),

    stats: {

        increments:
            0,

        gauges:
            0,

        observations:
            0,

        timers:
            0,

        instrumentationSuccess:
            0,

        instrumentationErrors:
            0,

        metricErrors:
            0,

        middlewareRequests:
            0

    }

};

// Prevent metrics emitter leaks in large applications.
state.emitter.setMaxListeners(
    250
);

// =============================================================================
// No-op Implementations
// =============================================================================

const noopTimer =
    () => {};

const noopMetric = Object.freeze({

    inc:
        () => {},

    set:
        () => {},

    dec:
        () => {},

    observe:
        () => {},

    startTimer:
        () => noopTimer,

    labels:
        () => noopMetric

});

// =============================================================================
// Logging Safety
// =============================================================================

function safeLog(
    level,
    message,
    metadata = {}
) {

    try {

        const logger =
            state.defaultLogger ||
            console;

        if (
            logger &&
            typeof logger[level] ===
                "function"
        ) {

            logger[level](
                `${DEFAULTS.LOG_PREFIX} ${message}`,
                metadata
            );

        }

    } catch {
        // Metrics/logging errors must never propagate to application code.
    }

}

// =============================================================================
// String / Name Normalization
// =============================================================================

function normalizeString(
    value,
    fallback = ""
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    return String(
        value
    ).trim();

}

function sanitizeMetricName(
    name
) {

    const value =
        normalizeString(
            name
        );

    if (
        !value
    ) {

        throw new TypeError(
            "Metric name is required."
        );

    }

    const normalized =
        value
            .replace(
                /[^a-zA-Z0-9_:]/g,
                "_"
            )
            .replace(
                /^_+/,
                ""
            )
            .slice(
                0,
                DEFAULTS.MAX_METRIC_NAME_LENGTH
            );

    if (
        !normalized
    ) {

        throw new TypeError(
            "Metric name is invalid."
        );

    }

    return normalized;

}

function sanitizeLabelValue(
    value,
    fallback = "unknown"
) {

    const normalized =
        normalizeString(
            value,
            fallback
        );

    if (
        !normalized
    ) {

        return fallback;

    }

    return normalized.slice(
        0,
        DEFAULTS.MAX_LABEL_LENGTH
    );

}

function sanitizeTenant(
    tenant
) {

    try {

        const candidate =
            normalizeString(
                tenant,
                DEFAULTS.DEFAULT_TENANT
            );

        const sanitized =
            tenantConstants.sanitizeTenantId(
                candidate
            );

        return sanitized ||
            DEFAULTS.DEFAULT_TENANT;

    } catch {

        return DEFAULTS.DEFAULT_TENANT;

    }

}

// =============================================================================
// Metric Name
// =============================================================================

function metricName(
    name
) {

    const normalized =
        sanitizeMetricName(
            name
        );

    const prefix =
        sanitizeMetricName(
            state.metricsPrefix ||
            DEFAULTS.METRICS_PREFIX
        );

    return `${prefix}_${normalized}`;

}

// =============================================================================
// Labels
// =============================================================================
//
// Important Prometheus rule:
// A metric's label names must remain stable after the first definition.
//
// The collector cache below therefore uses the sorted label-name signature.
//

function normalizeLabels(
    labels = {}
) {

    if (
        !labels ||
        typeof labels !==
            "object" ||
        Array.isArray(labels)
    ) {

        return {};

    }

    const normalized =
        {};

    for (
        const [
            key,
            value
        ] of Object.entries(
            labels
        )
    ) {

        const safeKey =
            String(
                key
            )
                .trim()
                .replace(
                    /[^a-zA-Z0-9_]/g,
                    "_"
                );

        if (
            !safeKey
        ) {
            continue;
        }

        normalized[
            safeKey
        ] =
            sanitizeLabelValue(
                value
            );

    }

    return normalized;

}

function mergeLabels(
    labels = {}
) {

    return Object.assign(

        {},

        normalizeLabels(
            state.defaultLabels
        ),

        normalizeLabels(
            labels
        )

    );

}

function labelSignature(
    labels = {}
) {

    return Object.keys(
        labels
    )
        .sort()
        .join(",");

}

// =============================================================================
// Safe Metrics Invocation
// =============================================================================

function runSafely(
    operation,
    fallback
) {

    try {

        return operation();

    } catch (error) {

        state.stats.metricErrors +=
            1;

        state.emitter.emit(
            "error",
            error
        );

        safeLog(
            "warn",
            "metric operation failed",
            {
                error:
                    error?.message ||
                    String(error)
            }
        );

        return fallback;

    }

}

// =============================================================================
// OpenTelemetry Bridge
// =============================================================================
//
// Supports a deliberately small adapter contract:
//
//   exporter.counter(name, value, labels)
//   exporter.gauge(name, value, labels)
//   exporter.histogram(name, value, labels)
//
// This keeps the runtime independent of a particular OpenTelemetry package.
//

function emitOtel(
    type,
    name,
    value,
    labels
) {

    if (
        !state.otelExporter
    ) {

        return;

    }

    try {

        const handler =
            state
                .otelExporter[
                    type
                ];

        if (
            typeof handler ===
                "function"
        ) {

            handler.call(
                state.otelExporter,
                metricName(name),
                value,
                labels
            );

        }

    } catch (error) {

        state.stats.metricErrors +=
            1;

        safeLog(
            "warn",
            "OpenTelemetry metric export failed",
            {
                type,
                metric:
                    name,

                error:
                    error?.message ||
                    String(error)
            }
        );

    }

}

// =============================================================================
// Prometheus Collector Factory
// =============================================================================

function assertCollectorCapacity() {

    let total =

        state.collectors.counters.size +
        state.collectors.gauges.size +
        state.collectors.histograms.size +
        state.collectors.summaries.size;

    if (
        total <
        DEFAULTS.MAX_CACHE_ENTRIES
    ) {

        return true;

    }

    safeLog(
        "warn",
        "metric collector cache capacity reached",
        {
            maximum:
                DEFAULTS.MAX_CACHE_ENTRIES
        }
    );

    return false;

}

function collectorKey(
    name,
    labels
) {

    return [
        name,
        labelSignature(
            labels
        )
    ].join(
        "|"
    );

}

function getDefaultLabelNames() {

    return Object.keys(
        normalizeLabels(
            state.defaultLabels
        )
    );

}

// =============================================================================
// Prometheus Counter
// =============================================================================

function _getCounter(
    name,
    labels = {}
) {

    if (
        !state.promClient ||
        !state.registry
    ) {

        return noopMetric;

    }

    const normalizedName =
        sanitizeMetricName(
            name
        );

    const merged =
        mergeLabels(
            labels
        );

    const labelNames =
        Object.keys(
            merged
        )
            .sort();

    const key =
        collectorKey(
            normalizedName,
            merged
        );

    if (
        state.collectors.counters
            .has(key)
    ) {

        return state.collectors.counters
            .get(key);

    }

    if (
        !assertCollectorCapacity()
    ) {

        return noopMetric;

    }

    const Counter =
        state.promClient.Counter;

    if (
        typeof Counter !==
            "function"
    ) {

        return noopMetric;

    }

    const collector =
        new Counter({

            name:
                metricName(
                    normalizedName
                ),

            help:
                `${metricName(
                    normalizedName
                )} counter`,

            labelNames,

            registers: [
                state.registry
            ]

        });

    state.collectors.counters.set(
        key,
        collector
    );

    return collector;

}

// =============================================================================
// Prometheus Gauge
// =============================================================================

function _getGauge(
    name,
    labels = {}
) {

    if (
        !state.promClient ||
        !state.registry
    ) {

        return noopMetric;

    }

    const normalizedName =
        sanitizeMetricName(
            name
        );

    const merged =
        mergeLabels(
            labels
        );

    const key =
        collectorKey(
            normalizedName,
            merged
        );

    if (
        state.collectors.gauges
            .has(key)
    ) {

        return state.collectors.gauges
            .get(key);

    }

    if (
        !assertCollectorCapacity()
    ) {

        return noopMetric;

    }

    const Gauge =
        state.promClient.Gauge;

    if (
        typeof Gauge !==
            "function"
    ) {

        return noopMetric;

    }

    const collector =
        new Gauge({

            name:
                metricName(
                    normalizedName
                ),

            help:
                `${metricName(
                    normalizedName
                )} gauge`,

            labelNames:
                Object.keys(
                    merged
                ).sort(),

            registers: [
                state.registry
            ]

        });

    state.collectors.gauges.set(
        key,
        collector
    );

    return collector;

}

// =============================================================================
// Prometheus Histogram
// =============================================================================

function _getHistogram(
    name,
    labels = {},
    buckets = DEFAULTS.DEFAULT_BUCKETS
) {

    if (
        !state.promClient ||
        !state.registry
    ) {

        return noopMetric;

    }

    const normalizedName =
        sanitizeMetricName(
            name
        );

    const merged =
        mergeLabels(
            labels
        );

    const key =
        [
            collectorKey(
                normalizedName,
                merged
            ),

            Array.isArray(
                buckets
            )
                ? buckets.join(",")
                : "default"

        ].join(
            "|"
        );

    if (
        state.collectors.histograms
            .has(key)
    ) {

        return state.collectors.histograms
            .get(key);

    }

    if (
        !assertCollectorCapacity()
    ) {

        return noopMetric;

    }

    const Histogram =
        state.promClient.Histogram;

    if (
        typeof Histogram !==
            "function"
    ) {

        return noopMetric;

    }

    const collector =
        new Histogram({

            name:
                metricName(
                    normalizedName
                ),

            help:
                `${metricName(
                    normalizedName
                )} histogram`,

            labelNames:
                Object.keys(
                    merged
                ).sort(),

            buckets:
                Array.isArray(
                    buckets
                )
                    ? buckets
                    : DEFAULTS.DEFAULT_BUCKETS,

            registers: [
                state.registry
            ]

        });

    state.collectors.histograms.set(
        key,
        collector
    );

    return collector;

}

// =============================================================================
// Prometheus Summary
// =============================================================================

function _getSummary(
    name,
    labels = {},
    percentiles = [0.5, 0.9, 0.95, 0.99]
) {

    if (
        !state.promClient ||
        !state.registry
    ) {

        return noopMetric;

    }

    const normalizedName =
        sanitizeMetricName(
            name
        );

    const merged =
        mergeLabels(
            labels
        );

    const key =
        [
            collectorKey(
                normalizedName,
                merged
            ),

            percentiles.join(
                ","
            )

        ].join(
            "|"
        );

    if (
        state.collectors.summaries
            .has(key)
    ) {

        return state.collectors.summaries
            .get(key);

    }

    if (
        !assertCollectorCapacity()
    ) {

        return noopMetric;

    }

    const Summary =
        state.promClient.Summary;

    if (
        typeof Summary !==
            "function"
    ) {

        return noopMetric;

    }

    const collector =
        new Summary({

            name:
                metricName(
                    normalizedName
                ),

            help:
                `${metricName(
                    normalizedName
                )} summary`,

            labelNames:
                Object.keys(
                    merged
                ).sort(),

            percentiles,

            registers: [
                state.registry
            ]

        });

    state.collectors.summaries.set(
        key,
        collector
    );

    return collector;

}

// =============================================================================
// Initialization
// =============================================================================

async function init(
    options = {}
) {

    if (
        state.initialized &&
        !options.force
    ) {

        return getState();

    }

    state.shuttingDown =
        false;

    state.metricsPrefix =
        sanitizeMetricName(
            options.metricsPrefix ||
            DEFAULTS.METRICS_PREFIX
        );

    state.defaultLabels =
        Object.assign(

            {},

            DEFAULTS.DEFAULT_LABELS,

            normalizeLabels(
                options.defaultLabels ||
                {}
            )

        );

    state.defaultLogger =
        options.logger ||
        console;

    /*
     * Prometheus
     */
    if (
        options.promClient &&
        (
            options.enablePrometheus ??
            DEFAULTS.ENABLE_PROMETHEUS
        )
    ) {

        const prom =
            options.promClient;

        const Registry =
            prom.Registry;

        if (
            typeof Registry ===
            "function"
        ) {

            state.registry =
                new Registry();

        } else {

            state.registry =
                prom.register ||
                null;

        }

        if (
            !state.registry
        ) {

            safeLog(
                "warn",
                "Prometheus registry unavailable"
            );

        } else {

            state.promClient =
                prom;

            if (
                typeof state.registry.setDefaultLabels ===
                "function"
            ) {

                try {

                    state.registry.setDefaultLabels(
                        state.defaultLabels
                    );

                } catch (error) {

                    safeLog(
                        "warn",
                        "unable to configure Prometheus default labels",
                        {
                            error:
                                error?.message
                        }
                    );

                }

            }

            /*
             * Optional process/default metrics.
             */
            if (
                options.collectDefaultMetrics !==
                    false &&
                typeof prom.collectDefaultMetrics ===
                    "function"
            ) {

                try {

                    /*
                     * Avoid duplicate registration where possible.
                     */
                    await Promise.resolve(
                        prom.collectDefaultMetrics({
                            register:
                                state.registry,

                            prefix:
                                `${state.metricsPrefix}_`
                        })
                    );

                } catch (error) {

                    safeLog(
                        "debug",
                        "Prometheus default metrics already registered or unavailable",
                        {
                            error:
                                error?.message
                        }
                    );

                }

            }

            /*
             * Pushgateway.
             */
            const pushgatewayOptions =
                options.pushgateway ||
                {};

            const pushgatewayUrl =
                pushgatewayOptions.url ||
                DEFAULTS.PUSHGATEWAY_URL;

            if (
                pushgatewayUrl &&
                typeof prom.Pushgateway ===
                    "function"
            ) {

                try {

                    state.pushgateway =
                        new prom.Pushgateway(

                            pushgatewayUrl,

                            pushgatewayOptions.options ||
                            {},

                            state.registry

                        );

                } catch (error) {

                    state.pushgateway =
                        null;

                    safeLog(
                        "warn",
                        "Pushgateway initialization failed",
                        {
                            error:
                                error?.message
                        }
                    );

                }

            }

        }

    }

    /*
     * StatsD.
     */
    if (
        options.statsdClient &&
        (
            options.enableStatsd ??
            DEFAULTS.ENABLE_STATSD
        )
    ) {

        state.statsdClient =
            options.statsdClient;

    } else {

        state.statsdClient =
            null;

    }

    /*
     * OpenTelemetry adapter.
     */
    state.otelExporter =
        options.otelExporter ||
        null;

    state.initialized =
        true;

    state.emitter.emit(
        "initialized",
        getState()
    );

    safeLog(
        "info",
        "metrics subsystem initialized",
        {
            prefix:
                state.metricsPrefix,

            prometheus:
                Boolean(
                    state.promClient
                ),

            statsd:
                Boolean(
                    state.statsdClient
                ),

            otel:
                Boolean(
                    state.otelExporter
                )
        }
    );

    return getState();

}

// =============================================================================
// Counter
// =============================================================================

function inc(
    name,
    value = 1,
    labels = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                ) ||
                numericValue < 0
            ) {

                throw new TypeError(
                    "Counter increment must be a finite non-negative number."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const safeName =
                sanitizeMetricName(
                    name
                );

            /*
             * StatsD
             */
            if (
                state.statsdClient
            ) {

                try {

                    const statsdName =
                        metricName(
                            safeName
                        ).replace(
                            /_/g,
                            "."
                        );

                    if (
                        typeof state.statsdClient.increment ===
                            "function"
                    ) {

                        state.statsdClient.increment(
                            statsdName,
                            numericValue,
                            normalized
                        );

                    }

                } catch (error) {

                    safeLog(
                        "debug",
                        "StatsD counter failed",
                        {
                            metric:
                                safeName,

                            error:
                                error?.message
                        }
                    );

                }

            }

            /*
             * Prometheus
             */
            const counter =
                _getCounter(
                    safeName,
                    normalized
                );

            if (
                counter &&
                typeof counter.inc ===
                    "function"
            ) {

                const labelNames =
                    Object.keys(
                        normalized
                    );

                const labelsObject =
                    {};

                for (
                    const key of
                    labelNames
                ) {

                    labelsObject[key] =
                        normalized[key];

                }

                if (
                    labelNames.length
                ) {

                    counter.inc(
                        labelsObject,
                        numericValue
                    );

                } else {

                    counter.inc(
                        numericValue
                    );

                }

            }

            emitOtel(
                "counter",
                safeName,
                numericValue,
                normalized
            );

            state.stats.increments +=
                1;

            return true;

        },
        false
    );

}

// =============================================================================
// Gauge
// =============================================================================

function set(
    name,
    value,
    labels = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                )
            ) {

                throw new TypeError(
                    "Gauge value must be finite."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const safeName =
                sanitizeMetricName(
                    name
                );

            if (
                state.statsdClient &&
                typeof state.statsdClient.gauge ===
                    "function"
            ) {

                try {

                    state.statsdClient.gauge(
                        metricName(
                            safeName
                        ),
                        numericValue,
                        normalized
                    );

                } catch (error) {

                    safeLog(
                        "debug",
                        "StatsD gauge failed",
                        {
                            metric:
                                safeName,

                            error:
                                error?.message
                        }
                    );

                }

            }

            const gauge =
                _getGauge(
                    safeName,
                    normalized
                );

            if (
                gauge &&
                typeof gauge.set ===
                    "function"
            ) {

                const labelNames =
                    Object.keys(
                        normalized
                    );

                if (
                    labelNames.length
                ) {

                    gauge.set(
                        normalized,
                        numericValue
                    );

                } else {

                    gauge.set(
                        numericValue
                    );

                }

            }

            emitOtel(
                "gauge",
                safeName,
                numericValue,
                normalized
            );

            state.stats.gauges +=
                1;

            return true;

        },
        false
    );

}

// =============================================================================
// Gauge Increment / Decrement
// =============================================================================

function incGauge(
    name,
    value = 1,
    labels = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                )
            ) {

                throw new TypeError(
                    "Gauge increment must be finite."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const gauge =
                _getGauge(
                    sanitizeMetricName(
                        name
                    ),
                    normalized
                );

            if (
                gauge &&
                typeof gauge.inc ===
                    "function"
            ) {

                if (
                    Object.keys(
                        normalized
                    ).length
                ) {

                    gauge.inc(
                        normalized,
                        numericValue
                    );

                } else {

                    gauge.inc(
                        numericValue
                    );

                }

            } else {

                set(
                    name,
                    numericValue,
                    labels
                );

            }

            return true;

        },
        false
    );

}

function decGauge(
    name,
    value = 1,
    labels = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                )
            ) {

                throw new TypeError(
                    "Gauge decrement must be finite."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const gauge =
                _getGauge(
                    sanitizeMetricName(
                        name
                    ),
                    normalized
                );

            if (
                gauge &&
                typeof gauge.dec ===
                    "function"
            ) {

                if (
                    Object.keys(
                        normalized
                    ).length
                ) {

                    gauge.dec(
                        normalized,
                        numericValue
                    );

                } else {

                    gauge.dec(
                        numericValue
                    );

                }

            }

            return true;

        },
        false
    );

}

// =============================================================================
// Histogram / Observation
// =============================================================================
//
// Contract:
// - Prometheus histogram value is assumed to be in seconds unless explicitly
//   documented otherwise.
// - StatsD timing is emitted in milliseconds.
//

function observe(
    name,
    value,
    labels = {},
    options = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                )
            ) {

                throw new TypeError(
                    "Histogram observation must be finite."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const safeName =
                sanitizeMetricName(
                    name
                );

            const histogram =
                _getHistogram(
                    safeName,
                    normalized,
                    options.buckets ||
                    DEFAULTS.DEFAULT_BUCKETS
                );

            if (
                histogram &&
                typeof histogram.observe ===
                    "function"
            ) {

                const labelNames =
                    Object.keys(
                        normalized
                    );

                if (
                    labelNames.length
                ) {

                    histogram.observe(
                        normalized,
                        numericValue
                    );

                } else {

                    histogram.observe(
                        numericValue
                    );

                }

            }

            if (
                state.statsdClient &&
                typeof state.statsdClient.timing ===
                    "function"
            ) {

                try {

                    const statsdValue =
                        options.unit ===
                            "milliseconds"
                            ? numericValue
                            : numericValue *
                              1000;

                    state.statsdClient.timing(
                        metricName(
                            safeName
                        ),
                        statsdValue,
                        normalized
                    );

                } catch (error) {

                    safeLog(
                        "debug",
                        "StatsD histogram timing failed",
                        {
                            metric:
                                safeName,

                            error:
                                error?.message
                        }
                    );

                }

            }

            emitOtel(
                "histogram",
                safeName,
                numericValue,
                normalized
            );

            state.stats.observations +=
                1;

            return true;

        },
        false
    );

}

// =============================================================================
// Summary
// =============================================================================

function observeSummary(
    name,
    value,
    labels = {},
    options = {}
) {

    return runSafely(
        () => {

            const numericValue =
                Number(
                    value
                );

            if (
                !Number.isFinite(
                    numericValue
                )
            ) {

                throw new TypeError(
                    "Summary observation must be finite."
                );

            }

            const normalized =
                mergeLabels(
                    labels
                );

            const summary =
                _getSummary(
                    name,
                    normalized,
                    options.percentiles ||
                    [0.5, 0.9, 0.95, 0.99]
                );

            if (
                summary &&
                typeof summary.observe ===
                    "function"
            ) {

                if (
                    Object.keys(
                        normalized
                    ).length
                ) {

                    summary.observe(
                        normalized,
                        numericValue
                    );

                } else {

                    summary.observe(
                        numericValue
                    );

                }

            }

            state.stats.observations +=
                1;

            return true;

        },
        false
    );

}

// =============================================================================
// Timer
// =============================================================================

function startTimer(
    name,
    labels = {},
    options = {}
) {

    return runSafely(
        () => {

            const safeName =
                sanitizeMetricName(
                    name
                );

            const normalized =
                mergeLabels(
                    labels
                );

            const histogram =
                _getHistogram(
                    safeName,
                    normalized,
                    options.buckets ||
                    DEFAULTS.DEFAULT_BUCKETS
                );

            state.stats.timers +=
                1;

            const startedAt =
                process.hrtime.bigint();

            /*
             * Prevent accidental double-stop.
             */
            let stopped =
                false;

            return (
                extraLabels = {}
            ) => {

                if (
                    stopped
                ) {

                    return 0;

                }

                stopped =
                    true;

                const elapsedMs =
                    Number(
                        process.hrtime.bigint() -
                        startedAt
                    ) /
                    1_000_000;

                const elapsedSeconds =
                    elapsedMs /
                    1000;

                const finalLabels =
                    mergeLabels(
                        Object.assign(
                            {},
                            normalized,
                            extraLabels
                        )
                    );

                try {

                    if (
                        histogram &&
                        typeof histogram.observe ===
                            "function"
                    ) {

                        if (
                            Object.keys(
                                finalLabels
                            ).length
                        ) {

                            histogram.observe(
                                finalLabels,
                                elapsedSeconds
                            );

                        } else {

                            histogram.observe(
                                elapsedSeconds
                            );

                        }

                    }

                    if (
                        state.statsdClient &&
                        typeof state.statsdClient.timing ===
                            "function"
                    ) {

                        state.statsdClient.timing(
                            metricName(
                                safeName
                            ),
                            elapsedMs,
                            finalLabels
                        );

                    }

                    emitOtel(
                        "histogram",
                        safeName,
                        elapsedSeconds,
                        finalLabels
                    );

                } catch (error) {

                    state.stats.metricErrors +=
                        1;

                    safeLog(
                        "debug",
                        "metric timer completion failed",
                        {
                            metric:
                                safeName,

                            error:
                                error?.message
                        }
                    );

                }

                return elapsedSeconds;

            };

        },
        noopTimer
    );

}

// =============================================================================
// Async Instrumentation
// =============================================================================

async function instrument(
    name,
    fn,
    labelsFn = () => ({}),
    options = {}
) {

    if (
        typeof fn !==
            "function"
    ) {

        throw new TypeError(
            "instrument() requires a function."
        );

    }

    const resolvedLabels =
        runSafely(
            () =>
                labelsFn() ||
                {},
            {}
        );

    const endTimer =
        startTimer(
            name,
            resolvedLabels,
            options
        );

    try {

        const result =
            await fn();

        if (
            typeof endTimer ===
                "function"
        ) {

            endTimer({
                outcome:
                    "success"
            });

        }

        inc(
            `${name}_success_total`,
            1,
            resolvedLabels
        );

        state.stats.instrumentationSuccess +=
            1;

        return result;

    } catch (error) {

        if (
            typeof endTimer ===
                "function"
        ) {

            endTimer({
                outcome:
                    "error"
            });

        }

        inc(
            `${name}_error_total`,
            1,
            resolvedLabels
        );

        state.stats.instrumentationErrors +=
            1;

        throw error;

    }

}

// =============================================================================
// Synchronous Instrumentation
// =============================================================================

function instrumentSync(
    name,
    fn,
    labelsFn = () => ({}),
    options = {}
) {

    if (
        typeof fn !==
            "function"
    ) {

        throw new TypeError(
            "instrumentSync() requires a function."
        );

    }

    const labels =
        runSafely(
            () =>
                labelsFn() ||
                {},
            {}
        );

    const endTimer =
        startTimer(
            name,
            labels,
            options
        );

    try {

        const result =
            fn();

        endTimer({
            outcome:
                "success"
        });

        inc(
            `${name}_success_total`,
            1,
            labels
        );

        state.stats.instrumentationSuccess +=
            1;

        return result;

    } catch (error) {

        endTimer({
            outcome:
                "error"
        });

        inc(
            `${name}_error_total`,
            1,
            labels
        );

        state.stats.instrumentationErrors +=
            1;

        throw error;

    }

}

// =============================================================================
// Request Label Extraction
// =============================================================================
//
// IMPORTANT:
// Never use request IDs, user IDs, phone numbers or raw URLs as labels.
// Raw URLs can create very high cardinality and can leak sensitive identifiers.
//

function getExpressRoute(
    req,
    options = {}
) {

    if (
        typeof options.routeExtractor ===
            "function"
    ) {

        try {

            return sanitizeLabelValue(
                options.routeExtractor(
                    req
                ),
                DEFAULTS.REQUEST_ROUTE_FALLBACK
            );

        } catch {
            return DEFAULTS.REQUEST_ROUTE_FALLBACK;
        }

    }

    return sanitizeLabelValue(

        req?.route?.path ||
        req?.baseUrl ||
        req?.path ||
        DEFAULTS.REQUEST_ROUTE_FALLBACK,

        DEFAULTS.REQUEST_ROUTE_FALLBACK

    );

}

function getKoaRoute(
    ctx,
    options = {}
) {

    if (
        typeof options.routeExtractor ===
            "function"
    ) {

        try {

            return sanitizeLabelValue(
                options.routeExtractor(
                    ctx
                ),
                DEFAULTS.REQUEST_ROUTE_FALLBACK
            );

        } catch {
            return DEFAULTS.REQUEST_ROUTE_FALLBACK;
        }

    }

    return sanitizeLabelValue(

        ctx?._matchedRoute ||
        ctx?.routerPath ||
        ctx?.path ||
        DEFAULTS.REQUEST_ROUTE_FALLBACK,

        DEFAULTS.REQUEST_ROUTE_FALLBACK

    );

}

function getTenantFromRequest(
    req,
    fallback
) {

    const tenant =
        req?.tenant ||
        req?.titechTenant?.tenantId ||
        req?.tenantId ||
        fallback ||
        DEFAULTS.DEFAULT_TENANT;

    return sanitizeTenant(
        tenant
    );

}

function getTenantFromKoa(
    ctx,
    fallback
) {

    const tenant =
        ctx?.state?.tenant ||
        ctx?.state?.titechTenant?.tenantId ||
        ctx?.state?.tenantId ||
        fallback ||
        DEFAULTS.DEFAULT_TENANT;

    return sanitizeTenant(
        tenant
    );

}

// =============================================================================
// Express Metrics Middleware
// =============================================================================

function expressMiddleware(
    options = {}
) {

    const metricBase =
        sanitizeMetricName(
            options.metricBase ||
            "requests_duration_seconds"
        );

    const labelExtractor =
        typeof options.labelExtractor ===
            "function"
            ? options.labelExtractor
            : req => ({

                tenant:
                    getTenantFromRequest(
                        req,
                        options.defaultTenant
                    ),

                route:
                    getExpressRoute(
                        req,
                        options
                    ),

                method:
                    sanitizeLabelValue(
                        req?.method,
                        "GET"
                    )

            });

    return function metricsMiddleware(
        req,
        res,
        next
    ) {

        const labels =
            mergeLabels(
                runSafely(
                    () =>
                        labelExtractor(
                            req
                        ) ||
                        {},
                    {
                        tenant:
                            DEFAULTS.DEFAULT_TENANT,

                        route:
                            DEFAULTS.REQUEST_ROUTE_FALLBACK,

                        method:
                            req?.method ||
                            "GET"
                    }
                )
            );

        const endTimer =
            startTimer(
                metricBase,
                labels,
                options
            );

        inc(
            "requests_total",
            1,
            labels
        );

        state.stats.middlewareRequests +=
            1;

        let finalized =
            false;

        const finalize =
            () => {

                if (
                    finalized
                ) {
                    return;

                }

                finalized =
                    true;

                const finalLabels =
                    Object.assign(
                        {},
                        labels,
                        {
                            status:
                                String(
                                    res?.statusCode ||
                                    0
                                )
                        }
                    );

                endTimer(
                    finalLabels
                );

                inc(
                    "responses_total",
                    1,
                    finalLabels
                );

            };

        if (
            res &&
            typeof res.once ===
                "function"
        ) {

            res.once(
                "finish",
                finalize
            );

            res.once(
                "close",
                finalize
            );

        }

        return next();

    };

}

// =============================================================================
// Koa Metrics Middleware
// =============================================================================

function koaMiddleware(
    options = {}
) {

    const metricBase =
        sanitizeMetricName(
            options.metricBase ||
            "requests_duration_seconds"
        );

    const labelExtractor =
        typeof options.labelExtractor ===
            "function"
            ? options.labelExtractor
            : ctx => ({

                tenant:
                    getTenantFromKoa(
                        ctx,
                        options.defaultTenant
                    ),

                route:
                    getKoaRoute(
                        ctx,
                        options
                    ),

                method:
                    sanitizeLabelValue(
                        ctx?.method,
                        "GET"
                    )

            });

    return async function koaMetrics(
        ctx,
        next
    ) {

        const labels =
            mergeLabels(
                runSafely(
                    () =>
                        labelExtractor(
                            ctx
                        ) ||
                        {},
                    {
                        tenant:
                            DEFAULTS.DEFAULT_TENANT,

                        route:
                            DEFAULTS.REQUEST_ROUTE_FALLBACK,

                        method:
                            ctx?.method ||
                            "GET"
                    }
                )
            );

        const endTimer =
            startTimer(
                metricBase,
                labels,
                options
            );

        inc(
            "requests_total",
            1,
            labels
        );

        state.stats.middlewareRequests +=
            1;

        try {

            await next();

        } finally {

            const finalLabels =
                Object.assign(
                    {},
                    labels,
                    {
                        status:
                            String(
                                ctx?.status ||
                                0
                            )
                    }
                );

            endTimer(
                finalLabels
            );

            inc(
                "responses_total",
                1,
                finalLabels
            );

        }

    };

}

// =============================================================================
// Prometheus Handler
// =============================================================================

function prometheusHandler(
    options = {}
) {

    return async (
        req,
        res
    ) => {

        if (
            !state.promClient ||
            !state.registry
        ) {

            if (
                options.statusCode
            ) {

                return res
                    .status(
                        options.statusCode
                    )
                    .end();

            }

            return res
                .status(
                    204
                )
                .end();

        }

        try {

            const output =
                await state.registry.metrics();

            res.setHeader(
                "Content-Type",
                state.registry.contentType ||
                state.promClient.register?.contentType ||
                "text/plain; version=0.0.4; charset=utf-8"
            );

            return res.send(
                output
            );

        } catch (error) {

            state.stats.metricErrors +=
                1;

            safeLog(
                "error",
                "Prometheus metrics collection failed",
                {
                    error:
                        error?.message
                }
            );

            return res
                .status(
                    500
                )
                .send(
                    "Unable to collect metrics."
                );

        }

    };

}

// =============================================================================
// Pushgateway
// =============================================================================

async function pushToGateway(
    jobName = DEFAULTS.PUSHGATEWAY_JOB,
    grouping = {}
) {

    if (
        !state.pushgateway ||
        !state.registry
    ) {

        return false;

    }

    const safeJob =
        sanitizeMetricName(
            jobName ||
            DEFAULTS.PUSHGATEWAY_JOB
        );

    const safeGrouping =
        normalizeLabels(
            grouping
        );

    try {

        /*
         * prom-client has had multiple callback/promise interfaces across
         * versions. Prefer promise style when supported and fall back to
         * callback style.
         */
        if (
            typeof state.pushgateway.pushAdd !==
                "function"
        ) {

            return false;

        }

        const result =
            state.pushgateway.pushAdd({

                jobName:
                    safeJob,

                grouping:
                    safeGrouping

            });

        if (
            result &&
            typeof result.then ===
                "function"
        ) {

            await result;

        } else {

            /*
             * Older prom-client:
             */
            await new Promise(
                (
                    resolve,
                    reject
                ) => {

                    state.pushgateway.pushAdd(
                        {
                            jobName:
                                safeJob,

                            grouping:
                                safeGrouping
                        },
                        error => {

                            if (
                                error
                            ) {

                                reject(
                                    error
                                );

                                return;

                            }

                            resolve();

                        }
                    );

                }
            );

        }

        state.emitter.emit(
            "push",
            {
                jobName:
                    safeJob,

                grouping:
                    safeGrouping
            }
        );

        return true;

    } catch (error) {

        state.stats.metricErrors +=
            1;

        safeLog(
            "warn",
            "Pushgateway push failed",
            {
                error:
                    error?.message,

                jobName:
                    safeJob
            }
        );

        return false;

    }

}

// =============================================================================
// Reset
// =============================================================================

async function reset(
    options = {}
) {

    try {

        if (
            state.registry &&
            typeof state.registry.clear ===
                "function"
        ) {

            state.registry.clear();

        }

    } catch (error) {

        safeLog(
            "debug",
            "Prometheus registry clear failed",
            {
                error:
                    error?.message
            }
        );

    }

    state.collectors.counters.clear();

    state.collectors.gauges.clear();

    state.collectors.histograms.clear();

    state.collectors.summaries.clear();

    state.stats.increments =
        0;

    state.stats.gauges =
        0;

    state.stats.observations =
        0;

    state.stats.timers =
        0;

    state.stats.instrumentationSuccess =
        0;

    state.stats.instrumentationErrors =
        0;

    state.stats.metricErrors =
        0;

    state.stats.middlewareRequests =
        0;

    /*
     * Tests may explicitly ask to fully deinitialize the subsystem.
     */
    if (
        options.deinitialize
    ) {

        state.initialized =
            false;

        state.promClient =
            null;

        state.registry =
            null;

        state.statsdClient =
            null;

        state.otelExporter =
            null;

        state.pushgateway =
            null;

    }

    state.emitter.emit(
        "reset"
    );

    return true;

}

// =============================================================================
// Shutdown
// =============================================================================

async function shutdown(
    {
        push = true,
        clear = false,
        deinitialize = true,
        jobName =
            DEFAULTS.PUSHGATEWAY_JOB,
        grouping = {}
    } = {}
) {

    if (
        state.shuttingDown
    ) {

        return true;

    }

    state.shuttingDown =
        true;

    try {

        if (
            push &&
            state.pushgateway
        ) {

            await pushToGateway(
                jobName,
                grouping
            );

        }

        if (
            clear ||
            deinitialize
        ) {

            await reset({
                deinitialize
            });

        }

        state.emitter.emit(
            "shutdown"
        );

        safeLog(
            "info",
            "metrics subsystem shutdown complete"
        );

        return true;

    } catch (error) {

        state.stats.metricErrors +=
            1;

        safeLog(
            "warn",
            "metrics shutdown encountered an error",
            {
                error:
                    error?.message
            }
        );

        return false;

    } finally {

        state.shuttingDown =
            false;

    }

}

// =============================================================================
// Diagnostics
// =============================================================================

function getState() {

    return {

        initialized:
            state.initialized,

        shuttingDown:
            state.shuttingDown,

        metricsPrefix:
            state.metricsPrefix,

        defaultLabels:
            Object.assign(
                {},
                state.defaultLabels
            ),

        hasPrometheus:
            Boolean(
                state.promClient
            ),

        hasStatsd:
            Boolean(
                state.statsdClient
            ),

        hasOtel:
            Boolean(
                state.otelExporter
            ),

        hasPushgateway:
            Boolean(
                state.pushgateway
            ),

        collectors: {

            counters:
                state.collectors.counters.size,

            gauges:
                state.collectors.gauges.size,

            histograms:
                state.collectors.histograms.size,

            summaries:
                state.collectors.summaries.size

        },

        stats:
            Object.assign(
                {},
                state.stats
            )

    };

}

function getMetricNames() {

    return {

        counters:
            Array.from(
                state.collectors.counters.keys()
            ),

        gauges:
            Array.from(
                state.collectors.gauges.keys()
            ),

        histograms:
            Array.from(
                state.collectors.histograms.keys()
            ),

        summaries:
            Array.from(
                state.collectors.summaries.keys()
            )

    };

}

// =============================================================================
// Event Subscription
// =============================================================================

function on(
    eventName,
    listener
) {

    if (
        typeof eventName !==
            "string" ||
        !eventName.trim()
    ) {

        throw new TypeError(
            "Metrics event name is required."
        );

    }

    if (
        typeof listener !==
            "function"
    ) {

        throw new TypeError(
            "Metrics event listener must be a function."
        );

    }

    state.emitter.on(
        eventName,
        listener
    );

    return () => {

        state.emitter.off(
            eventName,
            listener
        );

    };

}

// =============================================================================
// Public API
// =============================================================================

module.exports = Object.freeze({

    /*
     * Configuration
     */
    DEFAULTS,

    /*
     * Lifecycle
     */
    init,
    shutdown,
    reset,

    /*
     * Counters
     */
    inc,

    /*
     * Gauges
     */
    set,
    incGauge,
    decGauge,

    /*
     * Histograms / summaries
     */
    observe,
    observeSummary,
    startTimer,

    /*
     * Instrumentation
     */
    instrument,
    instrumentSync,

    /*
     * Middleware
     */
    expressMiddleware,
    koaMiddleware,

    /*
     * HTTP handlers
     */
    prometheusHandler,

    /*
     * Pushgateway
     */
    pushToGateway,

    /*
     * Diagnostics
     */
    getState,
    getMetricNames,

    /*
     * Events
     */
    on,

    /*
     * Backward-compatible state access.
     *
     * Consumers should prefer getState() because this is mutable runtime state.
     */
    _state:
        state,

    /*
     * Backward-compatible internal collector access.
     */
    _getCounter,
    _getGauge,
    _getHistogram,
    _getSummary

});