// ============================================================================
// TITech Community Capital
// File: backend/services/metricsService.js
// Production Grade Metrics & Observability Service
// Multi-Tenant | Prometheus | OpenTelemetry Ready
// ============================================================================

"use strict";

const os = require("os");
const EventEmitter = require("events");

let promClient;

try {
  promClient = require("prom-client");
} catch (err) {
  promClient = null;
}

let loggerInstance = null;

function getLogger() {
  if (loggerInstance) {
    return loggerInstance;
  }

  try {
    loggerInstance = require("../utils/logger");
  } catch (_) {
    loggerInstance = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };
  }

  return loggerInstance;
}

const logger = new Proxy({}, {
  get(_, prop) {
    const target = getLogger();
    return typeof target[prop] === "function"
      ? target[prop].bind(target)
      : target[prop];
  },
});

class MetricsService extends EventEmitter {
  constructor() {
    super();

    this.enabled =
      process.env.METRICS_ENABLED !==
      "false";

    this.defaultLabels = {
      service:
        process.env.SERVICE_NAME ||
        "titech-community-capital",

      environment:
        process.env.NODE_ENV ||
        "development",

      hostname: os.hostname(),
    };

    /**
     * Fallback in-memory metrics store.
     */
    this.counters =
      new Map();

    this.gauges =
      new Map();

    this.histograms =
      new Map();

    this.timers =
      new Map();

    /**
     * Prometheus Registry
     */
    this.registry =
      promClient
        ? new promClient.Registry()
        : null;

    this.promCounters =
      new Map();

    this.promHistograms =
      new Map();

    // Initialize metrics service synchronously to avoid asynchronous callbacks
    // running after Jest teardown and causing require/import errors.
    this.initialize();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  initialize() {
    try {
      if (
        this.registry &&
        promClient
      ) {
        this.registry.setDefaultLabels(
          this.defaultLabels
        );

        promClient.collectDefaultMetrics(
          {
            register:
              this.registry,
            prefix:
              "titech_",
          }
        );
      }

      logger.info(
        "Metrics service initialized",
        {
          enabled:
            this.enabled,
          prometheus:
            !!this.registry,
        }
      );
    } catch (error) {
      logger.error(
        "Metrics initialization failed",
        {
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Counters
  // ===========================================================================

  increment(
    name,
    value = 1,
    labels = {}
  ) {
    if (!this.enabled) {
      return;
    }

    try {
      const current =
        this.counters.get(name) ||
        0;

      this.counters.set(
        name,
        current + value
      );

      if (
        this.registry &&
        promClient
      ) {
        let counter =
          this.promCounters.get(
            name
          );

        if (!counter) {
          counter =
            new promClient.Counter(
              {
                name:
                  this.normalizeMetricName(
                    name
                  ),
                help: `${name} counter`,
                labelNames:
                  Object.keys(
                    labels
                  ),
                registers: [
                  this.registry,
                ],
              }
            );

          this.promCounters.set(
            name,
            counter
          );
        }

        counter.inc(
          labels,
          value
        );
      }

      this.emit(
        "counter.increment",
        {
          name,
          value,
          labels,
        }
      );
    } catch (error) {
      logger.error(
        "Metric increment failed",
        {
          metric: name,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Gauges
  // ===========================================================================

  gauge(
    name,
    value,
    labels = {}
  ) {
    if (!this.enabled) {
      return;
    }

    try {
      this.gauges.set(
        name,
        value
      );

      if (
        this.registry &&
        promClient
      ) {
        let gauge =
          this.promGauges.get(
            name
          );

        if (!gauge) {
          gauge =
            new promClient.Gauge(
              {
                name:
                  this.normalizeMetricName(
                    name
                  ),
                help: `${name} gauge`,
                labelNames:
                  Object.keys(
                    labels
                  ),
                registers: [
                  this.registry,
                ],
              }
            );

          this.promGauges.set(
            name,
            gauge
          );
        }

        gauge.set(
          labels,
          value
        );
      }

      this.emit(
        "gauge.updated",
        {
          name,
          value,
        }
      );
    } catch (error) {
      logger.error(
        "Gauge update failed",
        {
          metric: name,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Histograms
  // ===========================================================================

  histogram(
    name,
    value,
    labels = {}
  ) {
    if (!this.enabled) {
      return;
    }

    try {
      const existing =
        this.histograms.get(
          name
        ) || [];

      existing.push(value);

      this.histograms.set(
        name,
        existing
      );

      if (
        this.registry &&
        promClient
      ) {
        let histogram =
          this.promHistograms.get(
            name
          );

        if (!histogram) {
          histogram =
            new promClient.Histogram(
              {
                name:
                  this.normalizeMetricName(
                    name
                  ),
                help: `${name} histogram`,
                labelNames:
                  Object.keys(
                    labels
                  ),
                buckets: [
                  0.1,
                  1,
                  5,
                  10,
                  50,
                  100,
                  500,
                  1000,
                  5000,
                ],
                registers: [
                  this.registry,
                ],
              }
            );

          this.promHistograms.set(
            name,
            histogram
          );
        }

        histogram.observe(
          labels,
          value
        );
      }
    } catch (error) {
      logger.error(
        "Histogram failed",
        {
          metric: name,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Timing
  // ===========================================================================

  timing(
    name,
    milliseconds,
    labels = {}
  ) {
    this.histogram(
      name,
      milliseconds,
      labels
    );

    this.timers.set(
      name,
      milliseconds
    );
  }

  startTimer(name) {
    const started =
      process.hrtime.bigint();

    return (
      labels = {}
    ) => {
      const ended =
        process.hrtime.bigint();

      const duration =
        Number(
          ended - started
        ) / 1000000;

      this.timing(
        name,
        duration,
        labels
      );

      return duration;
    };
  }

  // ===========================================================================
  // Batch Metrics
  // ===========================================================================

  incrementBatch(
    metrics = []
  ) {
    for (const metric of metrics) {
      this.increment(
        metric.name,
        metric.value,
        metric.labels
      );
    }
  }

  // ===========================================================================
  // Request Metrics Helper
  // ===========================================================================

  trackRequest({
    route,
    method,
    statusCode,
    duration,
    tenantId,
  }) {
    this.increment(
      "http_requests_total",
      1,
      {
        route,
        method,
        statusCode:
          String(statusCode),
        tenantId:
          tenantId ||
          "unknown",
      }
    );

    this.timing(
      "http_request_duration_ms",
      duration,
      {
        route,
        method,
      }
    );
  }

  // ===========================================================================
  // Tenant Metrics
  // ===========================================================================

  incrementTenantMetric(
    tenantId,
    metric,
    value = 1
  ) {
    this.increment(
      metric,
      value,
      {
        tenantId,
      }
    );
  }

  // ===========================================================================
  // Business Metrics
  // ===========================================================================

  incrementLoanCreated(
    tenantId
  ) {
    this.increment(
      "loans_created_total",
      1,
      { tenantId }
    );
  }

  incrementSavingsDeposit(
    tenantId
  ) {
    this.increment(
      "savings_deposit_total",
      1,
      { tenantId }
    );
  }

  incrementUSSDRequest(
    tenantId
  ) {
    this.increment(
      "ussd_request_total",
      1,
      { tenantId }
    );
  }

  incrementMoMoCollection(
    tenantId
  ) {
    this.increment(
      "momo_collection_total",
      1,
      { tenantId }
    );
  }

  // ===========================================================================
  // Metrics Export
  // ===========================================================================

  async getMetrics() {
    if (
      this.registry &&
      promClient
    ) {
      return await this.registry.metrics();
    }

    return {
      counters:
        Object.fromEntries(
          this.counters
        ),

      gauges:
        Object.fromEntries(
          this.gauges
        ),

      histograms:
        Object.fromEntries(
          this.histograms
        ),

      timers:
        Object.fromEntries(
          this.timers
        ),

      uptime:
        process.uptime(),

      memory:
        process.memoryUsage(),

      cpuLoad:
        os.loadavg(),

      timestamp:
        new Date().toISOString(),
    };
  }

  // ===========================================================================
  // Health Snapshot
  // ===========================================================================

  getHealthSnapshot() {
    return {
      uptime:
        process.uptime(),
      memory:
        process.memoryUsage(),
      cpu:
        os.loadavg(),
      platform:
        process.platform,
      hostname:
        os.hostname(),
      nodeVersion:
        process.version,
      timestamp:
        new Date().toISOString(),
    };
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();

    if (
      this.registry &&
      promClient
    ) {
      this.registry.clear();
      this.initialize();
    }
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  normalizeMetricName(
    name
  ) {
    return `titech_${name
      .replace(/[.\s-]/g, "_")
      .replace(
        /[^a-zA-Z0-9_]/g,
        ""
      )}`;
  }

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  async shutdown() {
    try {
      this.removeAllListeners();

      logger.info(
        "Metrics service shutdown complete."
      );
    } catch (error) {
      logger.error(
        "Metrics service shutdown failed",
        {
          error:
            error.message,
        }
      );
    }
  }
}

module.exports =
  new MetricsService();