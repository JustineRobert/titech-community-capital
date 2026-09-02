'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Metrics
 * ============================================================================
 *
 * File:
 *   backend/utils/admin/adminMetrics.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Production-grade observability helper for TITech administrative services,
 * tenant operations and HTTP telemetry.
 *
 * Supported integrations
 * ----------------------------------------------------------------------------
 * - Prometheus via prom-client
 * - StatsD-compatible clients
 * - Pushgateway
 * - Custom metrics backends through adapters
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Initialize metrics safely.
 * - Maintain a dedicated Prometheus registry.
 * - Provide counters, gauges and histograms.
 * - Provide tenant-aware metrics.
 * - Provide request telemetry middleware.
 * - Provide operation instrumentation.
 * - Provide Prometheus scrape handler.
 * - Support Pushgateway publishing.
 * - Support graceful shutdown/reset.
 *
 * Observability principles
 * ----------------------------------------------------------------------------
 * - Metrics must never break business requests.
 * - Metric label cardinality must remain bounded.
 * - Raw URLs and arbitrary request values must not become Prometheus labels.
 * - Tenant IDs should be treated as bounded identifiers.
 * - Metric definitions use stable label schemas.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const os =
    require('node:os');

const tenantConstants =
    require('../../tenancy/tenant.constants');

/**
 * ============================================================================
 * Configuration Helpers
 * ============================================================================
 */

function parseBoolean(
    value,
    fallback
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    if (
        typeof value ===
        'boolean'
    ) {
        return value;
    }

    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        [
            'true',
            '1',
            'yes',
            'on',
        ].includes(
            normalized
        )
    ) {
        return true;
    }

    if (
        [
            'false',
            '0',
            'no',
            'off',
        ].includes(
            normalized
        )
    ) {
        return false;
    }

    return fallback;
}

function parseInteger(
    value,
    fallback,
    min,
    max
) {
    const parsed =
        Number(
            value
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed < min ||
        parsed > max
    ) {
        return fallback;
    }

    return parsed;
}

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS =
    Object.freeze({
        METRICS_PREFIX:
            sanitizeMetricPrefix(
                tenantConstants
                    .ENV
                    .METRICS_PREFIX ||
                'titech.admin'
            ),

        DEFAULT_LABELS:
            Object.freeze({
                service:
                    'TITech.Admin',

                host:
                    sanitizeLabelValue(
                        os.hostname()
                    ),
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
                10,
            ]),

        METRICS_PORT:
            parseInteger(
                process.env.METRICS_PORT,
                9464,
                1024,
                65535
            ),

        PUSHGATEWAY_URL:
            process.env.PUSHGATEWAY_URL ||
            null,

        ENABLE_PROMETHEUS:
            parseBoolean(
                process.env.ENABLE_PROMETHEUS,
                true
            ),

        ENABLE_STATSD:
            parseBoolean(
                process.env.ENABLE_STATSD,
                false
            ),

        ENABLE_HTTP_METRICS:
            parseBoolean(
                process.env.ENABLE_HTTP_METRICS,
                true
            ),

        MAX_LABEL_LENGTH:
            parseInteger(
                process.env.METRICS_MAX_LABEL_LENGTH,
                128,
                16,
                1024
            ),

        TENANT_METRIC_HASHING:
            parseBoolean(
                process.env.METRICS_HASH_TENANT,
                false
            ),
    });

/**
 * ============================================================================
 * Internal State
 * ============================================================================
 */

const state = {
    initialized:
        false,

    initializing:
        null,

    promClient:
        null,

    statsdClient:
        null,

    registry:
        null,

    pushgateway:
        null,

    metricsPrefix:
        DEFAULTS.METRICS_PREFIX,

    defaultLabels:
        {
            ...DEFAULTS.DEFAULT_LABELS,
        },

    defaultLabelNames:
        Object.keys(
            DEFAULTS.DEFAULT_LABELS
        ),

    collectors: {
        counters:
            new Map(),

        gauges:
            new Map(),

        histograms:
            new Map(),
    },

    config: {
        enablePrometheus:
            DEFAULTS.ENABLE_PROMETHEUS,

        enableStatsd:
            DEFAULTS.ENABLE_STATSD,

        enableHttpMetrics:
            DEFAULTS.ENABLE_HTTP_METRICS,

        tenantMetricHashing:
            DEFAULTS.TENANT_METRIC_HASHING,

        maxLabelLength:
            DEFAULTS.MAX_LABEL_LENGTH,

        requestLabelAllowList:
            new Set([
                'tenant',
                'method',
                'route',
                'status',
                'outcome',
                'service',
                'operation',
                'provider',
                'environment',
            ]),
    },
};

/**
 * ============================================================================
 * No-op Metric
 * ============================================================================
 */

const noopTimer =
    () =>
        undefined;

const noopMetric =
    Object.freeze({
        inc:
            () =>
                undefined,

        set:
            () =>
                undefined,

        observe:
            () =>
                undefined,

        startTimer:
            () =>
                noopTimer,
    });

/**
 * ============================================================================
 * Initialization
 * ============================================================================
 */

async function init(
    options = {}
) {
    if (
        state.initialized
    ) {
        return getStateSnapshot();
    }

    if (
        state.initializing
    ) {
        await state.initializing;

        return getStateSnapshot();
    }

    state.initializing =
        initializeMetrics(
            options
        );

    try {
        await state.initializing;

        state.initialized =
            true;

        return getStateSnapshot();
    } finally {
        state.initializing =
            null;
    }
}

async function initializeMetrics(
    options
) {
    state.metricsPrefix =
        sanitizeMetricPrefix(
            options.metricsPrefix ||
            DEFAULTS.METRICS_PREFIX
        );

    state.defaultLabels =
        Object.freeze({
            ...DEFAULTS.DEFAULT_LABELS,
            ...(isPlainObject(
                options.defaultLabels
            )
                ? sanitizeLabels(
                    options.defaultLabels
                )
                : {}),
        });

    state.defaultLabelNames =
        Object.keys(
            state.defaultLabels
        );

    state.config =
        {
            ...state.config,

            enablePrometheus:
                options.enablePrometheus ??
                DEFAULTS.ENABLE_PROMETHEUS,

            enableStatsd:
                options.enableStatsd ??
                DEFAULTS.ENABLE_STATSD,

            enableHttpMetrics:
                options.enableHttpMetrics ??
                DEFAULTS.ENABLE_HTTP_METRICS,

            tenantMetricHashing:
                options.tenantMetricHashing ??
                DEFAULTS.TENANT_METRIC_HASHING,

            maxLabelLength:
                options.maxLabelLength ||
                DEFAULTS.MAX_LABEL_LENGTH,

            requestLabelAllowList:
                new Set(
                    Array.isArray(
                        options.requestLabelAllowList
                    )
                        ? options.requestLabelAllowList.map(
                            String
                        )
                        : Array.from(
                            state.config
                                .requestLabelAllowList
                        )
                ),
        };

    if (
        options.promClient &&
        state.config.enablePrometheus
    ) {
        initializePrometheus(
            options.promClient,
            options
        );
    }

    if (
        options.statsdClient &&
        state.config.enableStatsd
    ) {
        state.statsdClient =
            options.statsdClient;
    }

    if (
        options.pushgateway ||
        DEFAULTS.PUSHGATEWAY_URL
    ) {
        initializePushgateway(
            options
        );
    }
}

/**
 * ============================================================================
 * Prometheus Initialization
 * ============================================================================
 */

function initializePrometheus(
    prom,
    options
) {
    if (
        !prom ||
        typeof prom !==
            'object'
    ) {
        return;
    }

    state.promClient =
        prom;

    /**
     * Always prefer a dedicated registry.
     *
     * This prevents duplicate registration against the global application's
     * registry.
     */
    if (
        typeof prom.Registry ===
        'function'
    ) {
        state.registry =
            new prom.Registry();
    } else if (
        prom.register
    ) {
        state.registry =
            prom.register;
    } else {
        state.registry =
            null;
        return;
    }

    if (
        typeof state.registry
            .setDefaultLabels ===
        'function'
    ) {
        state.registry.setDefaultLabels(
            state.defaultLabels
        );
    }

    /**
     * Optional process/default Node.js collectors.
     */
    if (
        options.collectDefaultMetrics !==
            false &&
        typeof prom.collectDefaultMetrics ===
            'function'
    ) {
        try {
            prom.collectDefaultMetrics({
                register:
                    state.registry,

                prefix:
                    `${state.metricsPrefix}_`,
            });
        } catch (
            error
        ) {
            safeConsoleWarn(
                'TITech default Prometheus metrics initialization failed',
                error
            );
        }
    }
}

/**
 * ============================================================================
 * Pushgateway
 * ============================================================================
 */

function initializePushgateway(
    options
) {
    const url =
        options.pushgateway?.url ||
        DEFAULTS.PUSHGATEWAY_URL;

    if (
        !url ||
        !state.promClient ||
        typeof state.promClient
            .Pushgateway !==
            'function' ||
        !state.registry
    ) {
        return;
    }

    try {
        state.pushgateway =
            new state.promClient
                .Pushgateway(
                    url,
                    {},
                    state.registry
                );
    } catch (
        error
    ) {
        state.pushgateway =
            null;

        safeConsoleWarn(
            'TITech Pushgateway initialization failed',
            error
        );
    }
}

/**
 * ============================================================================
 * Metric Naming
 * ============================================================================
 */

function metricName(
    name
) {
    const normalized =
        normalizeMetricName(
            name
        );

    if (
        !normalized
    ) {
        throw new TypeError(
            'Metric name is required.'
        );
    }

    return [
        state.metricsPrefix,
        normalized,
    ].join(
        '_'
    );
}

function normalizeMetricName(
    name
) {
    return String(
        name ??
            ''
    )
        .trim()
        .replace(
            /[^a-zA-Z0-9_:]/g,
            '_'
        )
        .replace(
            /_+/g,
            '_'
        )
        .replace(
            /^_+|_+$/g,
            ''
        );
}

function sanitizeMetricPrefix(
    prefix
) {
    const normalized =
        normalizeMetricName(
            prefix
        );

    return (
        normalized ||
        'titech_admin'
    );
}

/**
 * ============================================================================
 * Label Handling
 * ============================================================================
 */

function sanitizeLabelValue(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return '';
    }

    return String(
        value
    )
        .trim()
        .slice(
            0,
            state.config?.maxLabelLength ||
                DEFAULTS.MAX_LABEL_LENGTH
        );
}

function sanitizeLabels(
    labels = {}
) {
    if (
        !isPlainObject(
            labels
        )
    ) {
        return {};
    }

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            labels
        )
    ) {
        const normalizedKey =
            normalizeLabelName(
                key
            );

        if (
            !normalizedKey
        ) {
            continue;
        }

        result[
            normalizedKey
        ] =
            sanitizeLabelValue(
                value
            );
    }

    return result;
}

function normalizeLabelName(
    name
) {
    return String(
        name ??
            ''
    )
        .trim()
        .replace(
            /[^a-zA-Z0-9_]/g,
            '_'
        )
        .replace(
            /_+/g,
            '_'
        )
        .replace(
            /^_+|_+$/g,
            ''
        );
}

/**
 * Prometheus labels cannot dynamically change between operations for the same
 * metric. Therefore a metric gets one stable label schema.
 */
function resolveLabelNames(
    labels = {}
) {
    return unique([
        ...state.defaultLabelNames,
        ...Object.keys(
            sanitizeLabels(
                labels
            )
        ).sort(),
    ]);
}

function resolveLabelValues(
    labels = {},
    labelNames = []
) {
    const sanitized =
        sanitizeLabels(
            labels
        );

    const merged =
        {
            ...state.defaultLabels,
            ...sanitized,
        };

    const result =
        {};

    for (
        const name of labelNames
    ) {
        result[name] =
            merged[name] ||
            '';
    }

    return result;
}

function unique(
    values
) {
    return Array.from(
        new Set(
            values
        )
    );
}

/**
 * ============================================================================
 * Tenant Label Handling
 * ============================================================================
 */

function tenantMetricValue(
    tenantId
) {
    if (
        !tenantId
    ) {
        return 'unknown';
    }

    const normalized =
        tenantConstants
            .isValidTenantId(
                String(
                    tenantId
                )
            )
            ? String(
                tenantId
            )
                .trim()
                .toLowerCase()
            : 'unknown';

    if (
        !state.config
            .tenantMetricHashing
    ) {
        return normalized;
    }

    return shortHash(
        normalized
    );
}

function extractTenantId(
    req
) {
    const candidate =
        req?.tenantId ||
        req?.tenant?.tenantId ||
        req?.titechTenant?.tenantId ||
        req?.tenantContext?.tenantId ||
        req?.tenant;

    return tenantMetricValue(
        candidate
    );
}

function shortHash(
    value
) {
    let hash = 0;

    for (
        let index = 0;
        index <
        value.length;
        index += 1
    ) {
        hash =
            (
                hash << 5
            ) -
            hash +
            value.charCodeAt(
                index
            );

        hash |= 0;
    }

    return (
        Math.abs(
            hash
        )
            .toString(
                16
            )
    );
}

/**
 * ============================================================================
 * Collector Keys
 * ============================================================================
 */

function collectorKey(
    type,
    name,
    labelNames,
    buckets = null
) {
    return [
        type,
        normalizeMetricName(
            name
        ),
        labelNames.join(
            ','
        ),
        buckets
            ? buckets.join(
                ','
            )
            : '',
    ].join(
        '|'
    );
}

/**
 * ============================================================================
 * Get Counter
 * ============================================================================
 */

function getCounter(
    name,
    labelNames = []
) {
    if (
        !state.promClient ||
        !state.registry ||
        typeof state.promClient.Counter !==
            'function'
    ) {
        return noopMetric;
    }

    const normalizedName =
        metricName(
            name
        );

    const labels =
        unique([
            ...state.defaultLabelNames,
            ...labelNames.map(
                normalizeLabelName
            ),
        ]);

    const key =
        collectorKey(
            'counter',
            normalizedName,
            labels
        );

    if (
        state.collectors
            .counters.has(
                key
            )
    ) {
        return state.collectors
            .counters.get(
                key
            );
    }

    const counter =
        new state.promClient
            .Counter({
                name:
                    normalizedName,

                help:
                    `${normalizedName} total counter`,

                labelNames:
                    labels,

                registers:
                    [
                        state.registry,
                    ],
            });

    state.collectors
        .counters
        .set(
            key,
            counter
        );

    return counter;
}

/**
 * ============================================================================
 * Get Gauge
 * ============================================================================
 */

function getGauge(
    name,
    labelNames = []
) {
    if (
        !state.promClient ||
        !state.registry ||
        typeof state.promClient.Gauge !==
            'function'
    ) {
        return noopMetric;
    }

    const normalizedName =
        metricName(
            name
        );

    const labels =
        unique([
            ...state.defaultLabelNames,
            ...labelNames.map(
                normalizeLabelName
            ),
        ]);

    const key =
        collectorKey(
            'gauge',
            normalizedName,
            labels
        );

    if (
        state.collectors
            .gauges.has(
                key
            )
    ) {
        return state.collectors
            .gauges.get(
                key
            );
    }

    const gauge =
        new state.promClient
            .Gauge({
                name:
                    normalizedName,

                help:
                    `${normalizedName} gauge`,

                labelNames:
                    labels,

                registers:
                    [
                        state.registry,
                    ],
            });

    state.collectors
        .gauges
        .set(
            key,
            gauge
        );

    return gauge;
}

/**
 * ============================================================================
 * Get Histogram
 * ============================================================================
 */

function getHistogram(
    name,
    labelNames = [],
    buckets =
        DEFAULTS.DEFAULT_BUCKETS
) {
    if (
        !state.promClient ||
        !state.registry ||
        typeof state.promClient.Histogram !==
            'function'
    ) {
        return noopMetric;
    }

    const normalizedName =
        metricName(
            name
        );

    const labels =
        unique([
            ...state.defaultLabelNames,
            ...labelNames.map(
                normalizeLabelName
            ),
        ]);

    const normalizedBuckets =
        normalizeBuckets(
            buckets
        );

    const key =
        collectorKey(
            'histogram',
            normalizedName,
            labels,
            normalizedBuckets
        );

    if (
        state.collectors
            .histograms.has(
                key
            )
    ) {
        return state.collectors
            .histograms.get(
                key
            );
    }

    /**
     * A metric name must have only one Prometheus definition in a registry.
     * If callers request the same metric name with a different label schema,
     * that is a programming error. We surface it instead of silently creating
     * invalid telemetry.
     */
    const existing =
        findCollectorByMetricName(
            state.collectors
                .histograms,
            normalizedName
        );

    if (
        existing
    ) {
        return existing;
    }

    const histogram =
        new state.promClient
            .Histogram({
                name:
                    normalizedName,

                help:
                    `${normalizedName} duration/value histogram`,

                labelNames:
                    labels,

                buckets:
                    normalizedBuckets,

                registers:
                    [
                        state.registry,
                    ],
            });

    state.collectors
        .histograms
        .set(
            key,
            histogram
        );

    return histogram;
}

function findCollectorByMetricName(
    collection,
    name
) {
    for (
        const [
            key,
            collector,
        ] of collection.entries()
    ) {
        if (
            key.includes(
                `|${name}|`
            ) ||
            key.startsWith(
                `histogram|${name}|`
            )
        ) {
            return collector;
        }
    }

    return null;
}

function normalizeBuckets(
    buckets
) {
    if (
        !Array.isArray(
            buckets
        )
    ) {
        return [
            ...DEFAULTS.DEFAULT_BUCKETS,
        ];
    }

    const normalized =
        buckets
            .map(
                Number
            )
            .filter(
                Number.isFinite
            )
            .filter(
                value =>
                    value > 0
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );

    return unique(
        normalized
    ).length
        ? unique(
            normalized
        )
        : [
            ...DEFAULTS.DEFAULT_BUCKETS,
        ];
}

/**
 * ============================================================================
 * Counter API
 * ============================================================================
 */

function incCounter(
    name,
    value = 1,
    labels = {}
) {
    try {
        const numericValue =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return;
        }

        const safeLabels =
            sanitizeLabels(
                labels
            );

        const labelNames =
            Object.keys(
                safeLabels
            );

        const counter =
            getCounter(
                name,
                labelNames
            );

        if (
            typeof counter.inc ===
            'function'
        ) {
            counter.inc(
                resolveLabelValues(
                    safeLabels,
                    resolveCollectorLabelNames(
                        counter
                    )
                ),
                numericValue
            );
        }

        if (
            state.statsdClient
        ) {
            statsdIncrement(
                name,
                numericValue,
                safeLabels
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'incCounter',
            error
        );
    }
}

/**
 * ============================================================================
 * Gauge API
 * ============================================================================
 */

function setGauge(
    name,
    value,
    labels = {}
) {
    try {
        const numericValue =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return;
        }

        const safeLabels =
            sanitizeLabels(
                labels
            );

        const gauge =
            getGauge(
                name,
                Object.keys(
                    safeLabels
                )
            );

        if (
            typeof gauge.set ===
            'function'
        ) {
            gauge.set(
                resolveLabelValues(
                    safeLabels,
                    resolveCollectorLabelNames(
                        gauge
                    )
                ),
                numericValue
            );
        }

        if (
            state.statsdClient
        ) {
            statsdGauge(
                name,
                numericValue,
                safeLabels
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'setGauge',
            error
        );
    }
}

/**
 * ============================================================================
 * Histogram API
 * ============================================================================
 */

function observeHistogram(
    name,
    value,
    labels = {},
    buckets =
        DEFAULTS.DEFAULT_BUCKETS
) {
    try {
        const numericValue =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return;
        }

        const safeLabels =
            sanitizeLabels(
                labels
            );

        const histogram =
            getHistogram(
                name,
                Object.keys(
                    safeLabels
                ),
                buckets
            );

        if (
            typeof histogram.observe ===
            'function'
        ) {
            histogram.observe(
                resolveLabelValues(
                    safeLabels,
                    resolveCollectorLabelNames(
                        histogram
                    )
                ),
                numericValue
            );
        }

        if (
            state.statsdClient
        ) {
            statsdTiming(
                name,
                numericValue,
                safeLabels
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'observeHistogram',
            error
        );
    }
}

/**
 * ============================================================================
 * Timer API
 * ============================================================================
 */

function startTimer(
    name,
    labels = {},
    buckets =
        DEFAULTS.DEFAULT_BUCKETS
) {
    const safeLabels =
        sanitizeLabels(
            labels
        );

    try {
        const histogram =
            getHistogram(
                name,
                Object.keys(
                    safeLabels
                ),
                buckets
            );

        if (
            histogram &&
            typeof histogram.startTimer ===
                'function'
        ) {
            const fixedLabels =
                resolveLabelValues(
                    safeLabels,
                    resolveCollectorLabelNames(
                        histogram
                    )
                );

            const end =
                histogram.startTimer(
                    fixedLabels
                );

            /**
             * Prom-client's timer closure does not need a second label
             * object. Labels are fixed at start.
             */
            return (
                extraLabels = {}
            ) => {
                try {
                    const result =
                        end();

                    /**
                     * Additional labels passed to the timer are intentionally
                     * ignored because changing label values on the same
                     * metric instance can create inconsistent series.
                     */
                    void extraLabels;

                    return result;
                } catch (
                    error
                ) {
                    safeMetricError(
                        'timerEnd',
                        error
                    );

                    return undefined;
                }
            };
        }
    } catch (
        error
    ) {
        safeMetricError(
            'startTimer',
            error
        );
    }

    const started =
        process.hrtime.bigint();

    return () => {
        const elapsedNs =
            process.hrtime.bigint() -
            started;

        const elapsedSeconds =
            Number(
                elapsedNs
            ) /
            1e9;

        if (
            state.statsdClient
        ) {
            statsdTiming(
                name,
                elapsedSeconds *
                    1000,
                safeLabels
            );
        }

        return elapsedSeconds;
    };
}

/**
 * ============================================================================
 * Async Instrumentation
 * ============================================================================
 */

async function instrument(
    name,
    fn,
    labelsFn = () =>
        ({})
) {
    if (
        typeof fn !==
        'function'
    ) {
        throw new TypeError(
            'instrument() requires a function.'
        );
    }

    const labels =
        sanitizeLabels(
            typeof labelsFn ===
                'function'
                ? labelsFn()
                : {}
        );

    const timer =
        startTimer(
            name,
            labels
        );

    try {
        const result =
            await fn();

        timer();

        incCounter(
            `${name}_success_total`,
            1,
            labels
        );

        return result;
    } catch (
        error
    ) {
        timer();

        incCounter(
            `${name}_error_total`,
            1,
            labels
        );

        throw error;
    }
}

/**
 * ============================================================================
 * HTTP Request Metrics
 * ============================================================================
 */

function expressRequestMiddleware(
    options = {}
) {
    if (
        !state.config
            .enableHttpMetrics &&
        options.enabled !==
            true
    ) {
        return (
            req,
            res,
            next
        ) =>
            next();
    }

    const metricBase =
        normalizeMetricName(
            options.metricName ||
            'http_request_duration_seconds'
        );

    const labelExtractor =
        typeof options
            .labelExtractor ===
            'function'
            ? options.labelExtractor
            : defaultHttpLabelExtractor;

    const shouldIgnore =
        typeof options
            .ignoreRequest ===
            'function'
            ? options.ignoreRequest
            : defaultIgnoreRequest;

    return function metricsMiddleware(
        req,
        res,
        next
    ) {
        if (
            shouldIgnore(
                req
            )
        ) {
            return next();
        }

        const started =
            process.hrtime.bigint();

        let labels;

        try {
            labels =
                sanitizeHttpLabels(
                    labelExtractor(
                        req
                    )
                );
        } catch (
            error
        ) {
            safeMetricError(
                'httpLabelExtractor',
                error
            );

            labels =
                defaultHttpLabelExtractor(
                    req
                );
        }

        incCounter(
            'http_requests_total',
            1,
            labels
        );

        let completed =
            false;

        const record =
            () => {
                if (
                    completed
                ) {
                    return;
                }

                completed =
                    true;

                const elapsed =
                    Number(
                        process.hrtime.bigint() -
                            started
                    ) /
                    1e9;

                const status =
                    String(
                        res.statusCode ||
                            0
                    );

                const finalLabels =
                    {
                        ...labels,

                        status,
                    };

                observeHistogram(
                    metricBase,
                    elapsed,
                    finalLabels
                );

                incCounter(
                    'http_responses_total',
                    1,
                    finalLabels
                );
            };

        res.once(
            'finish',
            record
        );

        res.once(
            'close',
            record
        );

        return next();
    };
}

function defaultHttpLabelExtractor(
    req
) {
    return {
        tenant:
            extractTenantId(
                req
            ),

        method:
            String(
                req?.method ||
                'UNKNOWN'
            ).toUpperCase(),

        route:
            getSafeRouteName(
                req
            ),
    };
}

function sanitizeHttpLabels(
    labels
) {
    const safe =
        sanitizeLabels(
            labels
        );

    const allowed =
        state.config
            .requestLabelAllowList;

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            safe
        )
    ) {
        if (
            allowed.has(
                key
            )
        ) {
            result[key] =
                value;
        }
    }

    return result;
}

function getSafeRouteName(
    req
) {
    /**
     * Prefer Express route templates rather than raw URLs.
     *
     * Good:
     *   /api/v1/tenants/:tenantId
     *
     * Avoid:
     *   /api/v1/tenants/9f84f...
     */
    const route =
        req?.route?.path;

    if (
        typeof route ===
            'string'
    ) {
        return sanitizeLabelValue(
            route
        );
    }

    /**
     * Router stack path may also be available through baseUrl.
     */
    const baseUrl =
        typeof req?.baseUrl ===
        'string'
            ? req.baseUrl
            : '';

    if (
        baseUrl
    ) {
        return sanitizeLabelValue(
            baseUrl
        );
    }

    return 'unknown';
}

function defaultIgnoreRequest(
    req
) {
    const path =
        req?.path ||
        req?.originalUrl ||
        '';

    return (
        path ===
            '/metrics' ||
        path.endsWith(
            '/health'
        ) ||
        path.endsWith(
            '/live'
        )
    );
}

/**
 * ============================================================================
 * StatsD Adapter
 * ============================================================================
 */

function statsdIncrement(
    name,
    value,
    labels
) {
    const client =
        state.statsdClient;

    if (
        !client
    ) {
        return;
    }

    const metric =
        normalizeStatsdName(
            name
        );

    try {
        if (
            typeof client.increment ===
            'function'
        ) {
            /**
             * Different StatsD libraries expose different signatures.
             * Prefer the most common forms.
             */
            client.increment(
                metric,
                value
            );

            return;
        }

        if (
            typeof client.incrementBy ===
            'function'
        ) {
            client.incrementBy(
                metric,
                value
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'statsd.increment',
            error
        );
    }
}

function statsdGauge(
    name,
    value
) {
    const client =
        state.statsdClient;

    if (
        !client
    ) {
        return;
    }

    const metric =
        normalizeStatsdName(
            name
        );

    try {
        if (
            typeof client.gauge ===
            'function'
        ) {
            client.gauge(
                metric,
                value
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'statsd.gauge',
            error
        );
    }
}

function statsdTiming(
    name,
    value
) {
    const client =
        state.statsdClient;

    if (
        !client
    ) {
        return;
    }

    const metric =
        normalizeStatsdName(
            name
        );

    try {
        if (
            typeof client.timing ===
            'function'
        ) {
            client.timing(
                metric,
                value
            );
        }
    } catch (
        error
    ) {
        safeMetricError(
            'statsd.timing',
            error
        );
    }
}

function normalizeStatsdName(
    name
) {
    return [
        state.metricsPrefix,
        normalizeMetricName(
            name
        ),
    ]
        .join(
            '.'
        )
        .replace(
            /\./g,
            '.'
        );
}

/**
 * ============================================================================
 * Prometheus Handler
 * ============================================================================
 */

function prometheusMetricsHandler(
    {
        unavailableStatus =
            204,
    } = {}
) {
    return async function metricsHandler(
        req,
        res
    ) {
        if (
            !state.promClient ||
            !state.registry
        ) {
            return res
                .status(
                    unavailableStatus
                )
                .type(
                    'text/plain'
                )
                .send('');
        }

        try {
            const body =
                await state.registry
                    .metrics();

            const contentType =
                typeof state.registry
                    .contentType ===
                    'string'
                    ? state.registry
                        .contentType
                    : state.promClient
                        .register?.contentType ||
                      'text/plain; version=0.0.4; charset=utf-8';

            res.set(
                'Content-Type',
                contentType
            );

            return res
                .status(
                    200
                )
                .send(
                    body
                );
        } catch (
            error
        ) {
            safeConsoleError(
                'TITech Prometheus metrics collection failed',
                error
            );

            return res
                .status(
                    500
                )
                .type(
                    'text/plain'
                )
                .send(
                    'metrics collection failed'
                );
        }
    };
}

/**
 * ============================================================================
 * Pushgateway
 * ============================================================================
 */

async function pushToGateway(
    jobName =
        'titech_admin',
    grouping = {}
) {
    if (
        !state.pushgateway ||
        !state.registry
    ) {
        return false;
    }

    const safeGrouping =
        sanitizeLabels(
            grouping
        );

    return new Promise(
        resolve => {
            try {
                state.pushgateway.pushAdd(
                    {
                        jobName:
                            normalizeStatsdName(
                                jobName
                            ),

                        grouping:
                            safeGrouping,
                    },
                    error => {
                        if (
                            error
                        ) {
                            safeConsoleWarn(
                                'TITech Pushgateway push failed',
                                error
                            );

                            resolve(
                                false
                            );

                            return;
                        }

                        resolve(
                            true
                        );
                    }
                );
            } catch (
                error
            ) {
                safeConsoleWarn(
                    'TITech Pushgateway push failed',
                    error
                );

                resolve(
                    false
                );
            }
        }
    );
}

/**
 * ============================================================================
 * Reset / Shutdown
 * ============================================================================
 */

async function resetMetrics() {
    try {
        if (
            state.registry &&
            typeof state.registry.clear ===
                'function'
        ) {
            state.registry.clear();
        }

        state.collectors
            .counters
            .clear();

        state.collectors
            .gauges
            .clear();

        state.collectors
            .histograms
            .clear();

        return true;
    } catch (
        error
    ) {
        safeConsoleWarn(
            'TITech metrics reset failed',
            error
        );

        return false;
    }
}

async function shutdown(
    {
        push =
            true,

        clear =
            false,

        jobName =
            'titech_admin',

        grouping =
            {},
    } = {}
) {
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
            clear
        ) {
            await resetMetrics();
        }

        state.initialized =
            false;

        return true;
    } catch (
        error
    ) {
        safeConsoleWarn(
            'TITech metrics shutdown failed',
            error
        );

        return false;
    }
}

/**
 * ============================================================================
 * Admin/Tenant-Specific Helpers
 * ============================================================================
 */

function incTenantCounter(
    name,
    tenantId,
    value = 1,
    labels = {}
) {
    incCounter(
        name,
        value,
        {
            ...labels,

            tenant:
                tenantMetricValue(
                    tenantId
                ),
        }
    );
}

function setTenantGauge(
    name,
    tenantId,
    value,
    labels = {}
) {
    setGauge(
        name,
        value,
        {
            ...labels,

            tenant:
                tenantMetricValue(
                    tenantId
                ),
        }
    );
}

function observeTenantHistogram(
    name,
    tenantId,
    value,
    labels = {},
    buckets =
        DEFAULTS.DEFAULT_BUCKETS
) {
    observeHistogram(
        name,
        value,
        {
            ...labels,

            tenant:
                tenantMetricValue(
                    tenantId
                ),
        },
        buckets
    );
}

/**
 * ============================================================================
 * State Snapshot
 * ============================================================================
 */

function getStateSnapshot() {
    return {
        initialized:
            state.initialized,

        prometheusEnabled:
            Boolean(
                state.promClient &&
                state.registry
            ),

        statsdEnabled:
            Boolean(
                state.statsdClient
            ),

        pushgatewayEnabled:
            Boolean(
                state.pushgateway
            ),

        metricsPrefix:
            state.metricsPrefix,

        defaultLabels:
            {
                ...state.defaultLabels,
            },

        collectors:
            {
                counters:
                    state.collectors
                        .counters
                        .size,

                gauges:
                    state.collectors
                        .gauges
                        .size,

                histograms:
                    state.collectors
                        .histograms
                        .size,
            },
    };
}

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

function safeMetricError(
    operation,
    error
) {
    safeConsoleWarn(
        `TITech metrics ${operation} error`,
        error
    );
}

function safeConsoleWarn(
    message,
    error
) {
    try {
        console.warn(
            message,
            error?.message ||
                error
        );
    } catch {
        // Never allow observability failure to propagate.
    }
}

function safeConsoleError(
    message,
    error
) {
    try {
        console.error(
            message,
            error?.message ||
                error
        );
    } catch {
        // Never allow observability failure to propagate.
    }
}

/**
 * ============================================================================
 * Utilities
 * ============================================================================
 */

function isPlainObject(
    value
) {
    return (
        value !==
            null &&
        typeof value ===
            'object' &&
        !Array.isArray(
            value
        )
    );
}

function resolveCollectorLabelNames(
    collector
) {
    /**
     * prom-client collectors expose labelNames in different ways depending on
     * version. The safest approach is to return the declared global/default
     * labels plus the metric-specific labels tracked by the registry helper.
     */
    if (
        Array.isArray(
            collector?.labelNames
        )
    ) {
        return collector.labelNames;
    }

    if (
        isPlainObject(
            collector?.labelNames
        )
    ) {
        return Object.keys(
            collector.labelNames
        );
    }

    /**
     * Fallback.
     */
    return state.defaultLabelNames;
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Defaults / state
         */
        DEFAULTS,

        getState:
            getStateSnapshot,

        _state:
            state,

        /**
         * Initialization
         */
        init,

        /**
         * Generic metrics
         */
        incCounter,

        setGauge,

        observeHistogram,

        startTimer,

        instrument,

        /**
         * Tenant-aware metrics
         */
        incTenantCounter,

        setTenantGauge,

        observeTenantHistogram,

        tenantMetricValue,

        /**
         * HTTP
         */
        expressRequestMiddleware,

        prometheusMetricsHandler,

        /**
         * Pushgateway / lifecycle
         */
        pushToGateway,

        resetMetrics,

        shutdown,

        /**
         * Advanced access
         */
        getCounter,

        getGauge,

        getHistogram,

        metricName,
    });