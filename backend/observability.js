'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/observability.js
 *
 * Purpose:
 *   Enterprise production-grade application observability subsystem.
 *
 * Responsibilities:
 *   - Centralize application telemetry.
 *   - Expose liveness and readiness state.
 *   - Collect in-process metrics.
 *   - Track HTTP request volume, latency and errors.
 *   - Track instrumented operations.
 *   - Track infrastructure/dependency health.
 *   - Maintain request/correlation/trace context.
 *   - Integrate with backend/bootstrap/logger.js.
 *   - Support W3C trace context propagation.
 *   - Support optional OpenTelemetry integration.
 *   - Expose Prometheus-compatible metrics.
 *   - Provide safe operational diagnostics.
 *   - Redact sensitive data from telemetry.
 *   - Gracefully degrade when optional telemetry dependencies are absent.
 *
 * Architectural position:
 *
 *   environment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   bootstrap/logger.js
 *       ↓
 *   backend/observability.js
 *       ↓
 *   resilience
 *       ↓
 *   infrastructure
 *       ↓
 *   middleware
 *       ↓
 *   routes / services / finance / ledger
 *
 * IMPORTANT:
 *
 *   This module does NOT:
 *     - own database connections
 *     - own Redis connections
 *     - execute financial transactions
 *     - implement ledger operations
 *     - process payments
 *     - implement HTTP routes
 *     - implement authentication
 *     - implement queue workers
 *     - persist business audit records
 *
 *   Existing subsystems remain authoritative.
 *
 * Optional dependency:
 *
 *   npm install @opentelemetry/api
 *
 * Optional development formatter remains owned by bootstrap/logger.js:
 *
 *   npm install -D pino-pretty
 *
 * =============================================================================
 */

const crypto = require('node:crypto');
const os = require('node:os');
const {
  AsyncLocalStorage,
} = require('node:async_hooks');
const {
  EventEmitter,
} = require('node:events');

/**
 * -----------------------------------------------------------------------------
 * Logger
 * -----------------------------------------------------------------------------
 */

const loggerModule =
  require('./bootstrap/logger');

const logger =
  loggerModule.getLogger();

/**
 * -----------------------------------------------------------------------------
 * Optional OpenTelemetry API
 * -----------------------------------------------------------------------------
 */

let otelApi = null;

try {
  // Optional dependency.
  // eslint-disable-next-line global-require
  otelApi =
    require('@opentelemetry/api');
} catch {
  otelApi = null;
}

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const SERVICE_VERSION =
  process.env.APP_VERSION ||
  '0.0.0';

const ENVIRONMENT =
  process.env.NODE_ENV ||
  'development';

const DEFAULT_METRICS_PORT =
  9090;

const DEFAULT_REQUEST_BUCKETS =
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
  ]);

const OBSERVABILITY_STATES =
  Object.freeze({
    CREATED: 'created',
    INITIALIZING: 'initializing',
    READY: 'ready',
    DEGRADED: 'degraded',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    FAILED: 'failed',
  });

const DEFAULTS =
  Object.freeze({
    enabled: true,

    metricsEnabled: true,

    tracingEnabled: true,

    requestMetricsEnabled: true,

    dependencyMetricsEnabled: true,

    metricsPrefix:
      'titech_',

    histogramBuckets:
      DEFAULT_REQUEST_BUCKETS,

    slowRequestThresholdMs:
      1_000,

    maxRecentErrors:
      100,

    maxRecentRequests:
      100,

    healthTimeoutMs:
      5_000,

    readinessTimeoutMs:
      5_000,

    metricsPort:
      DEFAULT_METRICS_PORT,

    eventLoopSampleMs:
      1_000,
  });

const TELEMETRY_SECRET_KEYS =
  new Set([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'set-cookie',
    'secret',
    'apiKey',
    'api_key',
    'clientSecret',
    'client_secret',
    'privateKey',
    'private_key',
    'encryptionKey',
    'encryption_key',
    'cardNumber',
    'card_number',
    'cvv',
    'cvc',
    'jwt',
    'jwtSecret',
    'access_token',
    'refresh_token',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Errors
 * -----------------------------------------------------------------------------
 */

class ObservabilityError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'ObservabilityError';

    this.code =
      options.code ||
      'OBSERVABILITY_ERROR';

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      ObservabilityError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Utility Functions
 * -----------------------------------------------------------------------------
 */

function asBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled',
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function sanitizeLabelValue(
  value,
  fallback = 'unknown',
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const normalized =
    String(value)
      .trim()
      .replace(
        /[^a-zA-Z0-9._:/-]/g,
        '_',
      )
      .slice(0, 128);

  return normalized ||
    fallback;
}

function normalizeMetricName(
  value,
  fallback = 'metric',
) {
  const normalized =
    String(value || fallback)
      .trim()
      .replace(
        /[^a-zA-Z0-9_:]/g,
        '_',
      );

  return normalized || fallback;
}

function normalizePath(
  value,
) {
  if (!value) {
    return '/';
  }

  let result =
    String(value);

  const queryIndex =
    result.indexOf('?');

  if (queryIndex >= 0) {
    result =
      result.slice(
        0,
        queryIndex,
      );
  }

  /**
   * Reduce obvious high-cardinality identifiers.
   *
   * UUID-like paths and numeric IDs become :id.
   */
  result =
    result
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,
        '/:id',
      )
      .replace(
        /\/\d+/g,
        '/:id',
      )
      .replace(
        /\/[0-9a-f]{16,}/gi,
        '/:id',
      );

  return (
    result.slice(0, 256) ||
    '/'
  );
}

function createId() {
  return crypto.randomUUID();
}

function hrtimeMs(
  start,
) {
  return Number(
    process.hrtime.bigint() -
      start,
  ) / 1_000_000;
}

function escapePrometheusLabel(
  value,
) {
  return String(value)
    .replace(
      /\\/g,
      '\\\\',
    )
    .replace(
      /"/g,
      '\\"',
    )
    .replace(
      /\n/g,
      '\\n',
    );
}

function formatMetricLine(
  name,
  labels,
  value,
) {
  const entries =
    Object.entries(
      labels || {},
    );

  const labelText =
    entries.length > 0
      ? `{${entries
          .map(
            ([key, item]) =>
              `${key}="${escapePrometheusLabel(
                item,
              )}"`,
          )
          .join(',')}}`
      : '';

  return `${name}${labelText} ${value}`;
}

function sanitizeTelemetryPayload(
  payload,
) {
  if (
    payload === null ||
    payload === undefined
  ) {
    return payload;
  }

  if (
    Array.isArray(payload)
  ) {
    return payload.map(
      item =>
        sanitizeTelemetryPayload(
          item,
        ),
    );
  }

  if (
    typeof payload !==
    'object'
  ) {
    return payload;
  }

  const output = {};

  for (
    const [
      key,
      value,
    ] of Object.entries(
      payload,
    )
  ) {
    if (
      TELEMETRY_SECRET_KEYS.has(
        key,
      ) ||
      TELEMETRY_SECRET_KEYS.has(
        key.toLowerCase(),
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    output[key] =
      sanitizeTelemetryPayload(
        value,
      );
  }

  return output;
}

/**
 * -----------------------------------------------------------------------------
 * Async Context
 * -----------------------------------------------------------------------------
 */

const contextStorage =
  new AsyncLocalStorage();

/**
 * -----------------------------------------------------------------------------
 * Counter
 * -----------------------------------------------------------------------------
 */

class Counter {
  constructor(
    name,
    help,
    labelNames = [],
  ) {
    this.name =
      normalizeMetricName(
        name,
      );

    this.help =
      help;

    this.labelNames =
      Object.freeze([
        ...labelNames,
      ]);

    this.values =
      new Map();
  }

  _normalizeLabels(
    labels = {},
  ) {
    const result = {};

    for (
      const label of
        this.labelNames
    ) {
      result[label] =
        sanitizeLabelValue(
          labels[label],
        );
    }

    return result;
  }

  _key(
    labels,
  ) {
    return this.labelNames
      .map(
        label =>
          sanitizeLabelValue(
            labels?.[label],
          ),
      )
      .join('|');
  }

  inc(
    labels = {},
    amount = 1,
  ) {
    if (
      !Number.isFinite(
        amount,
      )
    ) {
      return;
    }

    const key =
      this._key(labels);

    const current =
      this.values.get(key);

    if (current) {
      current.value +=
        amount;

      return;
    }

    this.values.set(
      key,
      {
        labels:
          this._normalizeLabels(
            labels,
          ),

        value:
          amount,
      },
    );
  }

  getValues() {
    return [
      ...this.values.values(),
    ].map(
      item => ({
        labels:
          {
            ...item.labels,
          },

        value:
          item.value,
      }),
    );
  }

  toPrometheus() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];

    for (
      const series of
        this.values.values()
    ) {
      lines.push(
        formatMetricLine(
          this.name,
          series.labels,
          series.value,
        ),
      );
    }

    return lines.join('\n');
  }
}

/**
 * -----------------------------------------------------------------------------
 * Gauge
 * -----------------------------------------------------------------------------
 */

class Gauge {
  constructor(
    name,
    help,
    labelNames = [],
  ) {
    this.name =
      normalizeMetricName(
        name,
      );

    this.help =
      help;

    this.labelNames =
      Object.freeze([
        ...labelNames,
      ]);

    this.values =
      new Map();
  }

  _normalizeLabels(
    labels = {},
  ) {
    const result = {};

    for (
      const label of
        this.labelNames
    ) {
      result[label] =
        sanitizeLabelValue(
          labels[label],
        );
    }

    return result;
  }

  _key(
    labels,
  ) {
    return this.labelNames
      .map(
        label =>
          sanitizeLabelValue(
            labels?.[label],
          ),
      )
      .join('|');
  }

  set(
    labels = {},
    value = 0,
  ) {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return;
    }

    this.values.set(
      this._key(labels),
      {
        labels:
          this._normalizeLabels(
            labels,
          ),

        value,
      },
    );
  }

  inc(
    labels = {},
    amount = 1,
  ) {
    const key =
      this._key(labels);

    const current =
      this.values.get(key);

    this.set(
      labels,
      (
        current?.value ||
        0
      ) + amount,
    );
  }

  dec(
    labels = {},
    amount = 1,
  ) {
    this.inc(
      labels,
      -amount,
    );
  }

  getValues() {
    return [
      ...this.values.values(),
    ].map(
      item => ({
        labels:
          {
            ...item.labels,
          },

        value:
          item.value,
      }),
    );
  }

  toPrometheus() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];

    for (
      const series of
        this.values.values()
    ) {
      lines.push(
        formatMetricLine(
          this.name,
          series.labels,
          series.value,
        ),
      );
    }

    return lines.join('\n');
  }
}

/**
 * -----------------------------------------------------------------------------
 * Histogram
 * -----------------------------------------------------------------------------
 */

class Histogram {
  constructor(
    name,
    help,
    labelNames = [],
    buckets = DEFAULT_REQUEST_BUCKETS,
  ) {
    this.name =
      normalizeMetricName(
        name,
      );

    this.help =
      help;

    this.labelNames =
      Object.freeze([
        ...labelNames,
      ]);

    this.buckets =
      Object.freeze(
        [
          ...new Set(
            buckets
              .filter(
                value =>
                  Number.isFinite(
                    value,
                  ) &&
                  value > 0,
              )
              .map(
                Number,
              )
              .sort(
                (a, b) =>
                  a - b,
              ),
          ),
          Infinity,
        ],
      );

    this.series =
      new Map();
  }

  _normalizeLabels(
    labels = {},
  ) {
    const result = {};

    for (
      const label of
        this.labelNames
    ) {
      result[label] =
        sanitizeLabelValue(
          labels[label],
        );
    }

    return result;
  }

  _key(
    labels,
  ) {
    return this.labelNames
      .map(
        label =>
          sanitizeLabelValue(
            labels?.[label],
          ),
      )
      .join('|');
  }

  observe(
    labels = {},
    value = 0,
  ) {
    if (
      !Number.isFinite(
        value,
      ) ||
      value < 0
    ) {
      return;
    }

    const key =
      this._key(labels);

    let series =
      this.series.get(key);

    if (!series) {
      series = {
        labels:
          this._normalizeLabels(
            labels,
          ),

        count: 0,

        sum: 0,

        buckets:
          this.buckets.map(
            () => 0,
          ),

        samples: [],
      };

      this.series.set(
        key,
        series,
      );
    }

    series.count +=
      1;

    series.sum +=
      value;

    for (
      let index = 0;
      index <
        this.buckets.length;
      index += 1
    ) {
      if (
        value <=
        this.buckets[index]
      ) {
        series.buckets[index] +=
          1;

        break;
      }
    }

    /**
     * Sample values are bounded to avoid unbounded memory growth.
     */
    if (
      series.samples.length <
      2_000
    ) {
      series.samples.push(
        value,
      );
    } else {
      /**
       * Simple reservoir-style replacement.
       */
      const index =
        Math.floor(
          Math.random() *
            series.count,
        );

      if (
        index <
        series.samples.length
      ) {
        series.samples[index] =
          value;
      }
    }
  }

  getValues() {
    return [
      ...this.series.values(),
    ].map(
      series => ({
        labels:
          {
            ...series.labels,
          },

        count:
          series.count,

        sum:
          series.sum,

        buckets:
          [...series.buckets],

        samples:
          [...series.samples],
      }),
    );
  }

  toPrometheus() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    for (
      const series of
        this.series.values()
    ) {
      let cumulative =
        0;

      for (
        let index = 0;
        index <
          this.buckets.length;
        index += 1
      ) {
        cumulative +=
          series.buckets[index];

        const labels =
          {
            ...series.labels,

            le:
              this.buckets[index] ===
              Infinity
                ? '+Inf'
                : String(
                    this.buckets[index],
                  ),
          };

        lines.push(
          formatMetricLine(
            `${this.name}_bucket`,
            labels,
            cumulative,
          ),
        );
      }

      lines.push(
        formatMetricLine(
          `${this.name}_sum`,
          series.labels,
          series.sum,
        ),
      );

      lines.push(
        formatMetricLine(
          `${this.name}_count`,
          series.labels,
          series.count,
        ),
      );
    }

    return lines.join('\n');
  }
}

/**
 * -----------------------------------------------------------------------------
 * Observability Service
 * -----------------------------------------------------------------------------
 */

class Observability extends EventEmitter {
  constructor(
    options = {},
  ) {
    super();

    const environment =
      options.environment ||
      {};

    const config =
      options.config ||
      {};

    const observabilityConfig =
      config.observability ||
      environment.observability ||
      {};

    this.options =
      Object.freeze({
        enabled:
          options.enabled ??
          asBoolean(
            observabilityConfig.enabled ??
              process.env.OBSERVABILITY_ENABLED,
            DEFAULTS.enabled,
          ),

        metricsEnabled:
          options.metricsEnabled ??
          asBoolean(
            observabilityConfig.metricsEnabled ??
              process.env.ENABLE_METRICS,
            DEFAULTS.metricsEnabled,
          ),

        tracingEnabled:
          options.tracingEnabled ??
          asBoolean(
            observabilityConfig.tracingEnabled ??
              process.env.ENABLE_TRACING,
            DEFAULTS.tracingEnabled,
          ),

        requestMetricsEnabled:
          options.requestMetricsEnabled ??
          asBoolean(
            observabilityConfig.requestMetricsEnabled ??
              process.env.ENABLE_REQUEST_METRICS,
            DEFAULTS.requestMetricsEnabled,
          ),

        dependencyMetricsEnabled:
          options.dependencyMetricsEnabled ??
          asBoolean(
            observabilityConfig.dependencyMetricsEnabled ??
              process.env.ENABLE_DEPENDENCY_METRICS,
            DEFAULTS.dependencyMetricsEnabled,
          ),

        metricsPrefix:
          normalizeMetricName(
            options.metricsPrefix ??
              observabilityConfig.metricsPrefix ??
              process.env.METRICS_PREFIX ??
              DEFAULTS.metricsPrefix,
            DEFAULTS.metricsPrefix,
          ),

        slowRequestThresholdMs:
          asPositiveInteger(
            options.slowRequestThresholdMs ??
              observabilityConfig.slowRequestThresholdMs ??
              process.env.SLOW_REQUEST_THRESHOLD_MS,
            DEFAULTS.slowRequestThresholdMs,
          ),

        maxRecentErrors:
          asPositiveInteger(
            options.maxRecentErrors ??
              process.env.OBSERVABILITY_MAX_RECENT_ERRORS,
            DEFAULTS.maxRecentErrors,
          ),

        maxRecentRequests:
          asPositiveInteger(
            options.maxRecentRequests ??
              process.env.OBSERVABILITY_MAX_RECENT_REQUESTS,
            DEFAULTS.maxRecentRequests,
          ),

        metricsPort:
          asPositiveInteger(
            options.metricsPort ??
              observabilityConfig.metricsPort ??
              process.env.METRICS_PORT,
            DEFAULTS.metricsPort,
          ),

        eventLoopSampleMs:
          asPositiveInteger(
            options.eventLoopSampleMs ??
              process.env.EVENT_LOOP_SAMPLE_MS,
            DEFAULTS.eventLoopSampleMs,
          ),

        requestBuckets:
          Object.freeze(
            [
              ...(
                options.requestBuckets ||
                observabilityConfig.histogramBuckets ||
                DEFAULTS.histogramBuckets
              ),
            ]
              .map(
                Number,
              )
              .filter(
                value =>
                  Number.isFinite(
                    value,
                  ) &&
                  value > 0,
              )
              .sort(
                (a, b) =>
                  a - b,
              ),
          ),

        serviceName:
          options.serviceName ??
          observabilityConfig.serviceName ??
          environment?.app?.serviceName ??
          SERVICE_NAME,

        applicationName:
          options.applicationName ??
          environment?.app?.name ??
          APPLICATION_NAME,

        serviceVersion:
          options.serviceVersion ??
          environment?.app?.version ??
          SERVICE_VERSION,

        environment:
          options.environmentName ??
          environment?.runtime?.nodeEnv ??
          environment?.app?.environment ??
          ENVIRONMENT,

        hostname:
          options.hostname ||
          os.hostname(),
      });

    this.state =
      OBSERVABILITY_STATES.CREATED;

    this.initializedAt =
      null;

    this.readyAt =
      null;

    this.stoppedAt =
      null;

    this.failure =
      null;

    this.started =
      false;

    this.ready =
      false;

    this.stopped =
      false;

    this.dependencies =
      new Map();

    this.recentErrors =
      [];

    this.recentRequests =
      [];

    this._systemMetricsTimer =
      null;

    this._eventLoopLagTimer =
      null;

    this._metricsServer =
      null;

    this._initializedPromise =
      null;

    this._metricsEndpointEnabled =
      this.options.metricsEnabled;

    this.counters =
      this._createCounters();

    this.gauges =
      this._createGauges();

    this.histograms =
      this._createHistograms();
  }

  /**
   * ---------------------------------------------------------------------------
   * Metric Registry
   * ---------------------------------------------------------------------------
   */

  _metricName(
    suffix,
  ) {
    return normalizeMetricName(
      `${this.options.metricsPrefix}${suffix}`,
    );
  }

  _createCounters() {
    return {
      requests:
        new Counter(
          this._metricName(
            'http_requests_total',
          ),
          'Total HTTP requests.',
          [
            'method',
            'route',
            'status_class',
          ],
        ),

      requestErrors:
        new Counter(
          this._metricName(
            'http_request_errors_total',
          ),
          'Total HTTP request errors.',
          [
            'method',
            'route',
            'status_class',
          ],
        ),

      slowRequests:
        new Counter(
          this._metricName(
            'http_slow_requests_total',
          ),
          'Total HTTP requests exceeding the configured latency threshold.',
          [
            'method',
            'route',
          ],
        ),

      dependencyChecks:
        new Counter(
          this._metricName(
            'dependency_checks_total',
          ),
          'Total dependency health checks.',
          [
            'dependency',
            'status',
          ],
        ),

      operations:
        new Counter(
          this._metricName(
            'operations_total',
          ),
          'Total instrumented operations.',
          [
            'operation',
            'status',
          ],
        ),

      errors:
        new Counter(
          this._metricName(
            'application_errors_total',
          ),
          'Total application errors observed.',
          [
            'type',
            'code',
          ],
        ),

      bootstrap:
        new Counter(
          this._metricName(
            'bootstrap_events_total',
          ),
          'Total observability/bootstrap lifecycle events.',
          [
            'event',
            'status',
          ],
        ),
    };
  }

  _createGauges() {
    return {
      activeRequests:
        new Gauge(
          this._metricName(
            'http_active_requests',
          ),
          'Current number of active HTTP requests.',
          [
            'service',
          ],
        ),

      healthyDependencies:
        new Gauge(
          this._metricName(
            'healthy_dependencies',
          ),
          'Current number of healthy dependencies.',
          [],
        ),

      uptime:
        new Gauge(
          this._metricName(
            'process_uptime_seconds',
          ),
          'Node.js process uptime in seconds.',
          [],
        ),

      memoryRss:
        new Gauge(
          this._metricName(
            'process_resident_memory_bytes',
          ),
          'Node.js resident memory usage in bytes.',
          [],
        ),

      heapUsed:
        new Gauge(
          this._metricName(
            'process_heap_used_bytes',
          ),
          'Node.js heap used in bytes.',
          [],
        ),

      heapTotal:
        new Gauge(
          this._metricName(
            'process_heap_total_bytes',
          ),
          'Node.js heap total in bytes.',
          [],
        ),

      eventLoopLag:
        new Gauge(
          this._metricName(
            'nodejs_event_loop_lag_seconds',
          ),
          'Estimated Node.js event-loop lag in seconds.',
          [],
        ),
    };
  }

  _createHistograms() {
    return {
      requestDuration:
        new Histogram(
          this._metricName(
            'http_request_duration_seconds',
          ),
          'HTTP request duration in seconds.',
          [
            'method',
            'route',
            'status_class',
          ],
          this.options.requestBuckets,
        ),

      operationDuration:
        new Histogram(
          this._metricName(
            'operation_duration_seconds',
          ),
          'Instrumented operation duration in seconds.',
          [
            'operation',
            'status',
          ],
          this.options.requestBuckets,
        ),

      dependencyDuration:
        new Histogram(
          this._metricName(
            'dependency_duration_seconds',
          ),
          'Dependency check duration in seconds.',
          [
            'dependency',
            'status',
          ],
          this.options.requestBuckets,
        ),
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Initialization
   * ---------------------------------------------------------------------------
   */

  async initialize() {
    if (
      this.started &&
      !this.stopped
    ) {
      return this;
    }

    if (
      this._initializedPromise
    ) {
      return this._initializedPromise;
    }

    this._initializedPromise =
      (async () => {
        this.state =
          OBSERVABILITY_STATES.INITIALIZING;

        this.counters.bootstrap.inc({
          event:
            'initialize',
          status:
            'started',
        });

        try {
          this.initializedAt =
            new Date();

          this.started =
            true;

          this.stopped =
            false;

          this._startSystemMetrics();

          this._startEventLoopLagMonitor();

          if (
            this.options.enabled
          ) {
            this.state =
              OBSERVABILITY_STATES.READY;

            this.ready =
              true;
          } else {
            this.state =
              OBSERVABILITY_STATES.DEGRADED;

            this.ready =
              true;
          }

          this.readyAt =
            new Date();

          this.counters.bootstrap.inc({
            event:
              'initialize',
            status:
              'success',
          });

          logger.info(
            {
              component:
                'observability',

              service:
                this.options.serviceName,

              application:
                this.options.applicationName,

              environment:
                this.options.environment,

              metricsEnabled:
                this.options.metricsEnabled,

              tracingEnabled:
                this.options.tracingEnabled,

              openTelemetry:
                Boolean(
                  otelApi,
                ),

              metricsPrefix:
                this.options.metricsPrefix,
            },
            'TITech observability subsystem initialized.',
          );

          this.emit(
            'ready',
            this.snapshot(),
          );

          return this;
        } catch (error) {
          this.failure =
            error;

          this.state =
            OBSERVABILITY_STATES.FAILED;

          this.ready =
            false;

          this.counters.bootstrap.inc({
            event:
              'initialize',
            status:
              'failed',
          });

          throw (
            error instanceof
            ObservabilityError
              ? error
              : new ObservabilityError(
                  'Observability initialization failed.',
                  {
                    code:
                      'OBSERVABILITY_INITIALIZATION_FAILED',

                    cause:
                      error,
                  },
                )
          );
        }
      })();

    try {
      return await this._initializedPromise;
    } finally {
      if (
        this.state ===
          OBSERVABILITY_STATES.FAILED
      ) {
        this._initializedPromise =
          null;
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * System Metrics
   * ---------------------------------------------------------------------------
   */

  _startSystemMetrics() {
    if (
      !this.options.metricsEnabled ||
      this._systemMetricsTimer
    ) {
      return;
    }

    const update =
      () => {
        const memory =
          process.memoryUsage();

        this.gauges.uptime.set(
          {},
          process.uptime(),
        );

        this.gauges.memoryRss.set(
          {},
          memory.rss,
        );

        this.gauges.heapUsed.set(
          {},
          memory.heapUsed,
        );

        this.gauges.heapTotal.set(
          {},
          memory.heapTotal,
        );
      };

    update();

    this._systemMetricsTimer =
      setInterval(
        update,
        10_000,
      );

    this._systemMetricsTimer.unref?.();
  }

  _startEventLoopLagMonitor() {
    if (
      this._eventLoopLagTimer
    ) {
      return;
    }

    let expected =
      Date.now() +
      this.options
        .eventLoopSampleMs;

    this._eventLoopLagTimer =
      setInterval(
        () => {
          const actual =
            Date.now();

          const lagMs =
            Math.max(
              0,
              actual - expected,
            );

          this.gauges.eventLoopLag.set(
            {},
            lagMs / 1_000,
          );

          expected =
            actual +
            this.options
              .eventLoopSampleMs;
        },
        this.options
          .eventLoopSampleMs,
      );

    this._eventLoopLagTimer.unref?.();
  }

  /**
   * ---------------------------------------------------------------------------
   * Request Instrumentation
   * ---------------------------------------------------------------------------
   */

  startRequest(
    {
      method = 'GET',
      route = '/',
      requestId,
      correlationId,
      traceId,
      spanId,
    } = {},
  ) {
    const highResolutionStart =
      process.hrtime.bigint();

    const normalizedMethod =
      String(method)
        .trim()
        .toUpperCase();

    const normalizedRoute =
      normalizePath(
        route,
      );

    const resolvedRequestId =
      requestId ||
      createId();

    const resolvedCorrelationId =
      correlationId ||
      resolvedRequestId;

    const context = {
      requestId:
        resolvedRequestId,

      correlationId:
        resolvedCorrelationId,

      traceId,
      spanId,

      method:
        normalizedMethod,

      route:
        normalizedRoute,

      startedAt:
        Date.now(),

      _hrtimeStart:
        highResolutionStart,
    };

    this.incrementActiveRequests();

    return Object.freeze({
      ...context,

      end:
        result =>
          this.endRequest(
            context,
            result,
          ),
    });
  }

  endRequest(
    context,
    {
      statusCode = 200,
      route,
      error = null,
    } = {},
  ) {
    const highResolutionDuration =
      context?._hrtimeStart
        ? hrtimeMs(
            context._hrtimeStart,
          )
        : Math.max(
            0,
            Date.now() -
              (
                context?.startedAt ||
                Date.now()
              ),
          );

    const durationMs =
      Math.max(
        0,
        highResolutionDuration,
      );

    const method =
      String(
        context?.method ||
          'GET',
      )
        .trim()
        .toUpperCase();

    const normalizedRoute =
      normalizePath(
        route ||
          context?.route ||
          '/',
      );

    const normalizedStatus =
      Number(statusCode) || 500;

    const statusClass =
      `${Math.floor(
        normalizedStatus /
          100,
      )}xx`;

    if (
      this.options
        .requestMetricsEnabled
    ) {
      this.counters.requests.inc({
        method,
        route:
          normalizedRoute,
        status_class:
          statusClass,
      });

      this.histograms.requestDuration.observe(
        {
          method,
          route:
            normalizedRoute,
          status_class:
            statusClass,
        },
        durationMs / 1_000,
      );

      if (
        normalizedStatus >= 400
      ) {
        this.counters.requestErrors.inc({
          method,
          route:
            normalizedRoute,
          status_class:
            statusClass,
        });
      }

      if (
        durationMs >=
        this.options
          .slowRequestThresholdMs
      ) {
        this.counters.slowRequests.inc({
          method,
          route:
            normalizedRoute,
        });

        logger.warn(
          {
            requestId:
              context?.requestId,

            correlationId:
              context?.correlationId,

            method,

            route:
              normalizedRoute,

            statusCode:
              normalizedStatus,

            durationMs,
          },
          'TITech slow HTTP request detected.',
        );
      }
    }

    if (
      error
    ) {
      this.recordError(
        error,
        {
          requestId:
            context?.requestId,

          correlationId:
            context?.correlationId,

          traceId:
            context?.traceId,

          spanId:
            context?.spanId,

          method,

          route:
            normalizedRoute,
        },
      );
    }

    this._recordRecentRequest({
      requestId:
        context?.requestId,

      correlationId:
        context?.correlationId,

      traceId:
        context?.traceId,

      spanId:
        context?.spanId,

      method,

      route:
        normalizedRoute,

      statusCode:
        normalizedStatus,

      durationMs,

      timestamp:
        new Date().toISOString(),
    });

    this.decrementActiveRequests();

    return {
      requestId:
        context?.requestId,

      correlationId:
        context?.correlationId,

      traceId:
        context?.traceId,

      spanId:
        context?.spanId,

      durationMs,

      statusCode:
        normalizedStatus,

      route:
        normalizedRoute,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Express Middleware
   * ---------------------------------------------------------------------------
   */

  middleware() {
    return (
      req,
      res,
      next,
    ) => {
      const requestId =
        req.id ||
        req.headers?.[
          'x-request-id'
        ] ||
        createId();

      const correlationId =
        req.headers?.[
          'x-correlation-id'
        ] ||
        requestId;

      const traceContext =
        this.extractTraceContext(
          req,
        );

      const route =
        normalizePath(
          req.route?.path ||
            req.path ||
            req.originalUrl ||
            req.url ||
            '/',
        );

      const started =
        process.hrtime.bigint();

      const requestContext =
        {
          requestId,
          correlationId,

          traceId:
            traceContext.traceId,

          spanId:
            traceContext.spanId,

          method:
            String(
              req.method ||
                'GET',
            )
              .trim()
              .toUpperCase(),

          route,

          startedAt:
            Date.now(),
        };

      let completed =
        false;

      this.incrementActiveRequests();

      const finish =
        () => {
          if (
            completed
          ) {
            return;
          }

          completed =
            true;

          const durationMs =
            Number(
              process.hrtime.bigint() -
                started,
            ) / 1_000_000;

          const statusCode =
            Number(
              res.statusCode,
            ) || 500;

          const finalRoute =
            normalizePath(
              req.route?.path ||
                req.path ||
                req.originalUrl ||
                req.url ||
                route,
            );

          const statusClass =
            `${Math.floor(
              statusCode /
                100,
            )}xx`;

          if (
            this.options
              .requestMetricsEnabled
          ) {
            this.counters.requests.inc({
              method:
                requestContext.method,

              route:
                finalRoute,

              status_class:
                statusClass,
            });

            this.histograms.requestDuration.observe(
              {
                method:
                  requestContext.method,

                route:
                  finalRoute,

                status_class:
                  statusClass,
              },
              durationMs / 1_000,
            );

            if (
              statusCode >= 400
            ) {
              this.counters.requestErrors.inc({
                method:
                  requestContext.method,

                route:
                  finalRoute,

                status_class:
                  statusClass,
              });
            }

            if (
              durationMs >=
              this.options
                .slowRequestThresholdMs
            ) {
              this.counters.slowRequests.inc({
                method:
                  requestContext.method,

                route:
                  finalRoute,
              });

              logger.warn(
                {
                  requestId,

                  correlationId,

                  traceId:
                    requestContext.traceId,

                  spanId:
                    requestContext.spanId,

                  method:
                    requestContext.method,

                  route:
                    finalRoute,

                  statusCode,

                  durationMs,
                },
                'TITech slow HTTP request detected.',
              );
            }
          }

          this._recordRecentRequest({
            requestId,

            correlationId,

            traceId:
              requestContext.traceId,

            spanId:
              requestContext.spanId,

            method:
              requestContext.method,

            route:
              finalRoute,

            statusCode,

            durationMs,

            timestamp:
              new Date().toISOString(),
          });

          this.decrementActiveRequests();
        };

      res.setHeader(
        'X-Request-ID',
        requestId,
      );

      res.setHeader(
        'X-Correlation-ID',
        correlationId,
      );

      if (
        traceContext.traceparent
      ) {
        res.setHeader(
          'traceparent',
          traceContext.traceparent,
        );
      }

      res.once(
        'finish',
        finish,
      );

      res.once(
        'close',
        finish,
      );

      return contextStorage.run(
        requestContext,
        () =>
          logger.runWithContext(
            requestContext,
            () =>
              next(),
          ),
      );
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Express Error Middleware
   * ---------------------------------------------------------------------------
   */

  errorMiddleware() {
    return (
      err,
      req,
      res,
      next,
    ) => {
      const context =
        this.getContext();

      this.recordError(
        err,
        {
          requestId:
            context.requestId ||
            req.id,

          correlationId:
            context.correlationId ||
            req.headers?.[
              'x-correlation-id'
            ],

          traceId:
            context.traceId,

          spanId:
            context.spanId,

          route:
            req.route?.path ||
            req.path,

          method:
            req.method,
        },
      );

      return next(
        err,
      );
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Active Request Gauge
   * ---------------------------------------------------------------------------
   */

  _getActiveRequestCount() {
    const values =
      this.gauges.activeRequests
        .getValues();

    const current =
      values.find(
        item =>
          item.labels
            .service ===
          this.options.serviceName,
      );

    return current?.value || 0;
  }

  incrementActiveRequests() {
    this.gauges.activeRequests.set(
      {
        service:
          this.options.serviceName,
      },
      this._getActiveRequestCount() +
        1,
    );
  }

  decrementActiveRequests() {
    this.gauges.activeRequests.set(
      {
        service:
          this.options.serviceName,
      },
      Math.max(
        0,
        this._getActiveRequestCount() -
          1,
      ),
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Async Context
   * ---------------------------------------------------------------------------
   */

  runWithContext(
    context,
    callback,
  ) {
    const current =
      this.getContext();

    const merged =
      Object.freeze({
        ...current,
        ...context,
      });

    return contextStorage.run(
      merged,
      () =>
        logger.runWithContext(
          merged,
          callback,
        ),
    );
  }

  getContext() {
    return (
      contextStorage.getStore() ||
      logger.getContext() ||
      {}
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Request Context
   * ---------------------------------------------------------------------------
   */

  createRequestContext(
    input = {},
  ) {
    const requestId =
      input.requestId ||
      createId();

    return Object.freeze({
      requestId,

      correlationId:
        input.correlationId ||
        requestId,

      traceId:
        input.traceId,

      spanId:
        input.spanId,

      userId:
        input.userId,

      actorId:
        input.actorId,

      tenantId:
        input.tenantId,

      organizationId:
        input.organizationId,

      operation:
        input.operation,

      service:
        input.service ||
        this.options.serviceName,

      component:
        input.component,
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * W3C Trace Context
   * ---------------------------------------------------------------------------
   */

  extractTraceContext(
    request,
  ) {
    const traceparent =
      request?.headers?.[
        'traceparent'
      ] ||
      request?.traceparent;

    if (
      !traceparent
    ) {
      return {
        traceparent:
          null,

        traceId:
          null,

        spanId:
          null,

        traceFlags:
          null,
      };
    }

    const match =
      String(
        traceparent,
      ).match(
        /^(\d{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i,
      );

    if (
      !match
    ) {
      return {
        traceparent:
          null,

        traceId:
          null,

        spanId:
          null,

        traceFlags:
          null,
      };
    }

    return {
      traceparent:
        String(
          traceparent,
        ),

      version:
        match[1],

      traceId:
        match[2],

      spanId:
        match[3],

      traceFlags:
        match[4],
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Span Context
   * ---------------------------------------------------------------------------
   */

  createSpanContext(
    {
      name =
        'titech.operation',
      attributes = {},
    } = {},
  ) {
    const parent =
      this.getContext();

    const localTraceId =
      parent.traceId ||
      crypto
        .randomBytes(16)
        .toString('hex');

    const localSpanId =
      crypto
        .randomBytes(8)
        .toString('hex');

    if (
      this.options.tracingEnabled &&
      otelApi
    ) {
      try {
        const tracer =
          otelApi.trace.getTracer(
            this.options
              .serviceName,
            this.options
              .serviceVersion,
          );

        const span =
          tracer.startSpan(
            name,
            {
              attributes:
                sanitizeTelemetryPayload(
                  attributes,
                ),
            },
          );

        const spanContext =
          span.spanContext();

        return {
          traceId:
            spanContext.traceId,

          spanId:
            spanContext.spanId,

          traceFlags:
            spanContext.traceFlags,

          traceparent:
            `00-${spanContext.traceId}-${spanContext.spanId}-01`,

          span,

          end:
            error => {
              if (
                error
              ) {
                span.recordException(
                  error,
                );

                span.setStatus({
                  code:
                    otelApi
                      .SpanStatusCode
                      .ERROR,

                  message:
                    error.message,
                });
              }

              span.end();
            },
        };
      } catch (error) {
        logger.warn(
          {
            component:
              'observability',

            err:
              error,
          },
          'OpenTelemetry span creation failed; falling back to local trace context.',
        );
      }
    }

    const started =
      process.hrtime.bigint();

    return {
      traceId:
        localTraceId,

      spanId:
        localSpanId,

      traceFlags:
        '01',

      traceparent:
        `00-${localTraceId}-${localSpanId}-01`,

      end:
        error => {
          const durationMs =
            hrtimeMs(
              started,
            );

          if (
            error
          ) {
            this.recordError(
              error,
              {
                traceId:
                  localTraceId,

                spanId:
                  localSpanId,
              },
            );
          }

          return {
            traceId:
              localTraceId,

            spanId:
              localSpanId,

            durationMs,

            error:
              Boolean(error),
          };
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Instrumented Operation
   * ---------------------------------------------------------------------------
   */

  async instrument(
    operation,
    fn,
    options = {},
  ) {
    if (
      typeof fn !==
      'function'
    ) {
      throw new TypeError(
        'observability.instrument() requires a function.',
      );
    }

    const operationName =
      sanitizeLabelValue(
        operation,
        'unknown',
      );

    const started =
      process.hrtime.bigint();

    const span =
      this.createSpanContext({
        name:
          operationName,

        attributes:
          options.attributes ||
          {},
      });

    const currentContext =
      this.getContext();

    try {
      const result =
        await fn({
          ...currentContext,

          traceId:
            span.traceId,

          spanId:
            span.spanId,
        });

      const durationMs =
        hrtimeMs(
          started,
        );

      this.counters.operations.inc({
        operation:
          operationName,

        status:
          'success',
      });

      this.histograms.operationDuration.observe(
        {
          operation:
            operationName,

          status:
            'success',
        },
        durationMs / 1_000,
      );

      span.end();

      return result;
    } catch (error) {
      const durationMs =
        hrtimeMs(
          started,
        );

      this.counters.operations.inc({
        operation:
          operationName,

        status:
          'error',
      });

      this.histograms.operationDuration.observe(
        {
          operation:
            operationName,

          status:
            'error',
        },
        durationMs / 1_000,
      );

      this.recordError(
        error,
        {
          operation:
            operationName,

          traceId:
            span.traceId,

          spanId:
            span.spanId,
        },
      );

      span.end(
        error,
      );

      throw error;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Dependency Health
   * ---------------------------------------------------------------------------
   */

  async checkDependency(
    name,
    check,
    options = {},
  ) {
    if (
      typeof check !==
      'function'
    ) {
      throw new TypeError(
        'Dependency health check must be a function.',
      );
    }

    const dependency =
      sanitizeLabelValue(
        name,
      );

    const timeoutMs =
      asPositiveInteger(
        options.timeoutMs,
        DEFAULTS.healthTimeoutMs,
      );

    const started =
      process.hrtime.bigint();

    let timer =
      null;

    try {
      const result =
        await Promise.race([
          Promise.resolve().then(
            check,
          ),

          new Promise(
            (_, reject) => {
              timer =
                setTimeout(
                  () => {
                    reject(
                      new ObservabilityError(
                        `Dependency "${dependency}" health check timed out.`,
                        {
                          code:
                            'DEPENDENCY_HEALTH_TIMEOUT',
                        },
                      ),
                    );
                  },
                  timeoutMs,
                );

              timer.unref?.();
            },
          ),
        ]);

      const durationMs =
        hrtimeMs(
          started,
        );

      const healthy =
        result !== false;

      const status =
        healthy
          ? 'healthy'
          : 'unhealthy';

      if (
        this.options
          .dependencyMetricsEnabled
      ) {
        this.counters
          .dependencyChecks
          .inc({
            dependency,
            status,
          });

        this.histograms
          .dependencyDuration
          .observe(
            {
              dependency,
              status,
            },
            durationMs / 1_000,
          );
      }

      this.dependencies.set(
        dependency,
        {
          dependency,

          status,

          checkedAt:
            new Date().toISOString(),

          durationMs,

          details:
            result &&
            typeof result ===
              'object'
              ? sanitizeTelemetryPayload(
                  result,
                )
              : undefined,
        },
      );

      this._refreshDependencyGauge();

      return {
        healthy,
        status,
        durationMs,
        result,
      };
    } catch (error) {
      const durationMs =
        hrtimeMs(
          started,
        );

      if (
        this.options
          .dependencyMetricsEnabled
      ) {
        this.counters
          .dependencyChecks
          .inc({
            dependency,
            status:
              'error',
          });

        this.histograms
          .dependencyDuration
          .observe(
            {
              dependency,
              status:
                'error',
            },
            durationMs / 1_000,
          );
      }

      this.dependencies.set(
        dependency,
        {
          dependency,

          status:
            'error',

          checkedAt:
            new Date().toISOString(),

          durationMs,

          error: {
            name:
              error?.name,

            code:
              error?.code,

            message:
              error?.message,
          },
        },
      );

      this._refreshDependencyGauge();

      return {
        healthy:
          false,

        status:
          'error',

        durationMs,

        error,
      };
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  _refreshDependencyGauge() {
    const healthy =
      [
        ...this.dependencies.values(),
      ].filter(
        dependency =>
          dependency.status ===
          'healthy',
      ).length;

    this.gauges
      .healthyDependencies
      .set(
        {},
        healthy,
      );
  }

  /**
   * ---------------------------------------------------------------------------
   * Error Recording
   * ---------------------------------------------------------------------------
   */

  recordError(
    error,
    context = {},
  ) {
    const normalized =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    const type =
      sanitizeLabelValue(
        normalized.name,
        'Error',
      );

    const code =
      sanitizeLabelValue(
        normalized.code ||
          'UNKNOWN',
      );

    this.counters.errors.inc({
      type,
      code,
    });

    const current =
      this.getContext();

    const record = {
      timestamp:
        new Date().toISOString(),

      type,

      code,

      message:
        normalized.message,

      statusCode:
        normalized.statusCode,

      requestId:
        context.requestId ||
        current.requestId,

      correlationId:
        context.correlationId ||
        current.correlationId,

      traceId:
        context.traceId ||
        current.traceId,

      spanId:
        context.spanId ||
        current.spanId,

      operation:
        context.operation,

      route:
        normalizePath(
          context.route,
        ),
    };

    this.recentErrors.unshift(
      record,
    );

    if (
      this.recentErrors.length >
      this.options.maxRecentErrors
    ) {
      this.recentErrors.length =
        this.options.maxRecentErrors;
    }

    return record;
  }

  _recordRecentRequest(
    request,
  ) {
    this.recentRequests.unshift(
      sanitizeTelemetryPayload(
        request,
      ),
    );

    if (
      this.recentRequests.length >
      this.options
        .maxRecentRequests
    ) {
      this.recentRequests.length =
        this.options
          .maxRecentRequests;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Telemetry Events
   * ---------------------------------------------------------------------------
   */

  emitEvent(
    type,
    payload = {},
  ) {
    const context =
      this.getContext();

    const event = {
      type:
        sanitizeLabelValue(
          type,
        ),

      timestamp:
        new Date().toISOString(),

      service:
        this.options.serviceName,

      application:
        this.options.applicationName,

      environment:
        this.options.environment,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      traceId:
        context.traceId,

      spanId:
        context.spanId,

      payload:
        sanitizeTelemetryPayload(
          payload,
        ),
    };

    this.emit(
      'telemetry',
      event,
    );

    return event;
  }

  /**
   * ---------------------------------------------------------------------------
   * Prometheus Metrics
   * ---------------------------------------------------------------------------
   */

  metricsText() {
    if (
      !this.options
        .metricsEnabled
    ) {
      return '';
    }

    const metrics = [
      ...Object.values(
        this.counters,
      ),

      ...Object.values(
        this.gauges,
      ),

      ...Object.values(
        this.histograms,
      ),
    ];

    return (
      metrics
        .map(
          metric =>
            metric.toPrometheus(),
        )
        .filter(Boolean)
        .join('\n\n') +
      '\n'
    );
  }

  metricsContentType() {
    return (
      'text/plain; version=0.0.4; charset=utf-8'
    );
  }

  metricsHandler() {
    return async (
      req,
      res,
      next,
    ) => {
      try {
        if (
          !this.options
            .metricsEnabled
        ) {
          res.status(
            404,
          );

          return res.end();
        }

        res.setHeader(
          'Content-Type',
          this.metricsContentType(),
        );

        res.setHeader(
          'Cache-Control',
          'no-store',
        );

        return res
          .status(200)
          .end(
            this.metricsText(),
          );
      } catch (error) {
        return next(
          error,
        );
      }
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Liveness
   * ---------------------------------------------------------------------------
   */

  liveness() {
    return {
      status:
        'ok',

      service:
        this.options.serviceName,

      application:
        this.options.applicationName,

      version:
        this.options.serviceVersion,

      environment:
        this.options.environment,

      uptimeSeconds:
        process.uptime(),

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness
   * ---------------------------------------------------------------------------
   */

  async readiness() {
    const dependencyResults =
      {};

    let ready =
      (
        this.state ===
          OBSERVABILITY_STATES.READY ||
        this.state ===
          OBSERVABILITY_STATES.DEGRADED
      );

    for (
      const [
        name,
        dependency,
      ] of this.dependencies
    ) {
      dependencyResults[name] =
        {
          ...dependency,
        };

      if (
        dependency.status !==
        'healthy'
      ) {
        ready =
          false;
      }
    }

    return {
      status:
        ready
          ? 'ready'
          : 'not_ready',

      ready,

      service:
        this.options.serviceName,

      application:
        this.options.applicationName,

      state:
        this.state,

      timestamp:
        new Date().toISOString(),

      dependencies:
        dependencyResults,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  async health() {
    const readiness =
      await this.readiness();

    return {
      status:
        readiness.ready
          ? 'healthy'
          : 'degraded',

      observability: {
        state:
          this.state,

        initialized:
          this.started,

        metricsEnabled:
          this.options
            .metricsEnabled,

        tracingEnabled:
          this.options
            .tracingEnabled,

        openTelemetry:
          Boolean(
            otelApi,
          ),
      },

      readiness,

      process: {
        pid:
          process.pid,

        hostname:
          this.options.hostname,

        uptimeSeconds:
          process.uptime(),

        memory:
          process.memoryUsage(),

        cpu:
          process.cpuUsage(),
      },

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async shutdown() {
    if (
      this.stopped
    ) {
      return;
    }

    this.state =
      OBSERVABILITY_STATES.STOPPING;

    this.ready =
      false;

    this.counters.bootstrap.inc({
      event:
        'shutdown',
      status:
        'started',
    });

    if (
      this._systemMetricsTimer
    ) {
      clearInterval(
        this._systemMetricsTimer,
      );

      this._systemMetricsTimer =
        null;
    }

    if (
      this._eventLoopLagTimer
    ) {
      clearInterval(
        this._eventLoopLagTimer,
      );

      this._eventLoopLagTimer =
        null;
    }

    if (
      this._metricsServer
    ) {
      try {
        await new Promise(
          resolve =>
            this._metricsServer.close(
              resolve,
            ),
        );
      } catch {
        /**
         * Best-effort cleanup.
         */
      }

      this._metricsServer =
        null;
    }

    this.started =
      false;

    this.stopped =
      true;

    this.stoppedAt =
      new Date();

    this.state =
      OBSERVABILITY_STATES.STOPPED;

    this.counters.bootstrap.inc({
      event:
        'shutdown',
      status:
        'success',
    });

    logger.info(
      {
        component:
          'observability',

        service:
          this.options.serviceName,
      },
      'TITech observability subsystem stopped.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Snapshot
   * ---------------------------------------------------------------------------
   */

  snapshot() {
    const memory =
      process.memoryUsage();

    return Object.freeze({
      state:
        this.state,

      initialized:
        this.started,

      ready:
        this.ready,

      stopped:
        this.stopped,

      initializedAt:
        this.initializedAt,

      readyAt:
        this.readyAt,

      stoppedAt:
        this.stoppedAt,

      failure:
        this.failure
          ? {
              name:
                this.failure.name,

              code:
                this.failure.code,

              message:
                this.failure.message,
            }
          : null,

      service:
        this.options.serviceName,

      application:
        this.options.applicationName,

      version:
        this.options.serviceVersion,

      environment:
        this.options.environment,

      metricsEnabled:
        this.options
          .metricsEnabled,

      tracingEnabled:
        this.options
          .tracingEnabled,

      openTelemetry:
        Boolean(
          otelApi,
        ),

      metricsPrefix:
        this.options
          .metricsPrefix,

      process: {
        pid:
          process.pid,

        hostname:
          this.options
            .hostname,

        uptimeSeconds:
          process.uptime(),

        memoryRss:
          memory.rss,

        heapUsed:
          memory.heapUsed,

        heapTotal:
          memory.heapTotal,

        external:
          memory.external,
      },

      dependencies:
        Object.freeze(
          Object.fromEntries(
            [...this.dependencies.entries()]
              .map(
                ([
                  name,
                  value,
                ]) => [
                  name,
                  sanitizeTelemetryPayload(
                    value,
                  ),
                ],
              ),
          ),
        ),

      recentErrors:
        Object.freeze(
          this.recentErrors.map(
            item => ({
              ...item,
            }),
          ),
        ),

      recentRequests:
        Object.freeze(
          this.recentRequests.map(
            item => ({
              ...item,
            }),
          ),
        ),

      logger:
        loggerModule.snapshot(),
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   *
   * Testing/process isolation only.
   */

  reset() {
    if (
      this.started &&
      !this.stopped
    ) {
      throw new ObservabilityError(
        'Cannot reset active observability subsystem.',
        {
          code:
            'OBSERVABILITY_RESET_NOT_ALLOWED',
        },
      );
    }

    this.state =
      OBSERVABILITY_STATES.CREATED;

    this.initializedAt =
      null;

    this.readyAt =
      null;

    this.stoppedAt =
      null;

    this.failure =
      null;

    this.started =
      false;

    this.ready =
      false;

    this.stopped =
      false;

    this.dependencies.clear();

    this.recentErrors.length =
      0;

    this.recentRequests.length =
      0;

    return this;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Singleton
 * -----------------------------------------------------------------------------
 */

const observability =
  new Observability({
    serviceName:
      SERVICE_NAME,

    applicationName:
      APPLICATION_NAME,

    serviceVersion:
      SERVICE_VERSION,

    environmentName:
      ENVIRONMENT,
  });

/**
 * -----------------------------------------------------------------------------
 * Bootstrap Lifecycle Registration
 * -----------------------------------------------------------------------------
 */

function registerBootstrapHooks(
  context = {},
) {
  if (
    hooks.has(
      'observability',
    )
  ) {
    return hooks.get(
      'observability',
    );
  }

  return require(
    './bootstrap/hooks',
  ).lifecycle(
    'observability',
    {
      priority:
        -600,

      dependencies: [
        'logger',
      ],

      critical:
        true,

      start:
        async hookContext => {
          await observability.initialize();

          hookContext.observability =
            observability;

          return observability;
        },

      stop:
        async () => {
          await observability.shutdown();
        },

      metadata: {
        component:
          'observability',

        service:
          SERVICE_NAME,

        application:
          APPLICATION_NAME,
      },
    },
  );
}

/**
 * -----------------------------------------------------------------------------
 * Public API
 * -----------------------------------------------------------------------------
 */

module.exports =
  Object.freeze({
    Observability,

    ObservabilityError,

    OBSERVABILITY_STATES,

    observability,

    initialize:
      () =>
        observability.initialize(),

    shutdown:
      () =>
        observability.shutdown(),

    registerBootstrapHooks,

    middleware:
      () =>
        observability.middleware(),

    errorMiddleware:
      () =>
        observability.errorMiddleware(),

    metricsHandler:
      () =>
        observability.metricsHandler(),

    metricsText:
      () =>
        observability.metricsText(),

    metricsContentType:
      () =>
        observability.metricsContentType(),

    liveness:
      () =>
        observability.liveness(),

    readiness:
      () =>
        observability.readiness(),

    health:
      () =>
        observability.health(),

    snapshot:
      () =>
        observability.snapshot(),

    startRequest:
      options =>
        observability.startRequest(
          options,
        ),

    endRequest:
      (
        context,
        result,
      ) =>
        observability.endRequest(
          context,
          result,
        ),

    instrument:
      (
        operation,
        fn,
        options,
      ) =>
        observability.instrument(
          operation,
          fn,
          options,
        ),

    checkDependency:
      (
        name,
        check,
        options,
      ) =>
        observability.checkDependency(
          name,
          check,
          options,
        ),

    runWithContext:
      (
        context,
        callback,
      ) =>
        observability.runWithContext(
          context,
          callback,
        ),

    createRequestContext:
      input =>
        observability.createRequestContext(
          input,
        ),

    getContext:
      () =>
        observability.getContext(),

    extractTraceContext:
      request =>
        observability.extractTraceContext(
          request,
        ),

    createSpanContext:
      options =>
        observability.createSpanContext(
          options,
        ),

    recordError:
      (
        error,
        context,
      ) =>
        observability.recordError(
          error,
          context,
        ),

    emitEvent:
      (
        type,
        payload,
      ) =>
        observability.emitEvent(
          type,
          payload,
        ),
  });