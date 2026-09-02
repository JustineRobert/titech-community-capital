// services/monitoringService.js
// ============================================================================
// Monitoring & Analytics Service
// Metrics collection, logging, performance tracking, and alerting
// Production-grade observability
// ============================================================================

const logger = require('../utils/logger');

/**
 * Metrics Collector
 * Tracks application metrics (counters, gauges, histograms)
 */
class MetricsCollector {
  constructor(options = {}) {
    this.metrics = new Map();
    this.snapshots = [];
    this.maxSnapshots = options.maxSnapshots || 1440; // 24 hours at 1-minute intervals
    this.flushInterval = options.flushInterval || 60000; // 1 minute
    this.startTime = Date.now();
    this.startFlushInterval();
  }

  /**
   * Increment counter
   */
  increment(name, labels = {}, value = 1) {
    const key = this.getKey(name, labels);
    const metric = this.metrics.get(key) || {
      type: 'counter',
      name,
      labels,
      value: 0,
    };
    metric.value += value;
    this.metrics.set(key, metric);
  }

  /**
   * Gauge (set exact value)
   */
  gauge(name, value, labels = {}) {
    const key = this.getKey(name, labels);
    this.metrics.set(key, {
      type: 'gauge',
      name,
      labels,
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Histogram (measure distribution)
   */
  histogram(name, value, labels = {}) {
    const key = this.getKey(name, labels);
    let metric = this.metrics.get(key);

    if (!metric) {
      metric = {
        type: 'histogram',
        name,
        labels,
        values: [],
        sum: 0,
        count: 0,
      };
    }

    metric.values.push(value);
    metric.sum += value;
    metric.count++;

    // Keep only last 1000 values for memory efficiency
    if (metric.values.length > 1000) {
      metric.values = metric.values.slice(-500);
    }

    this.metrics.set(key, metric);
  }

  /**
   * Get metric key
   */
  getKey(name, labels = {}) {
    const labelStr = Object.entries(labels)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  /**
   * Get all metrics
   */
  getMetrics(name = null) {
    if (name) {
      return Array.from(this.metrics.values()).filter((m) => m.name === name);
    }
    return Array.from(this.metrics.values());
  }

  /**
   * Get metric statistics
   */
  getStats(name, labels = {}) {
    const key = this.getKey(name, labels);
    const metric = this.metrics.get(key);

    if (!metric) return null;

    if (metric.type === 'histogram') {
      const sorted = [...metric.values].sort((a, b) => a - b);
      return {
        name,
        labels,
        type: 'histogram',
        count: metric.count,
        sum: metric.sum,
        average: metric.sum / metric.count,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }

    return {
      name,
      labels,
      type: metric.type,
      value: metric.value,
    };
  }

  /**
   * Flush metrics to snapshots
   */
  flushSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      metrics: Array.from(this.metrics.entries()).map(([key, metric]) => ({
        key,
        ...metric,
      })),
      uptime: Date.now() - this.startTime,
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    return snapshot;
  }

  /**
   * Start periodic flush
   */
  startFlushInterval() {
    this.flushTimer = setInterval(() => {
      this.flushSnapshot();
    }, this.flushInterval);
  }

  /**
   * Stop periodic flush
   */
  stopFlushInterval() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
  }

  /**
   * Export metrics for monitoring systems
   */
  exportPrometheus() {
    let output = '';

    for (const [key, metric] of this.metrics.entries()) {
      if (metric.type === 'histogram') {
        output += `# HELP ${metric.name} ${metric.name} histogram\n`;
        output += `# TYPE ${metric.name} histogram\n`;
        output += `${key}_count ${metric.count}\n`;
        output += `${key}_sum ${metric.sum}\n`;
      } else {
        output += `# HELP ${metric.name} ${metric.name}\n`;
        output += `# TYPE ${metric.name} ${metric.type}\n`;
        output += `${key} ${metric.value}\n`;
      }
    }

    return output;
  }
}

/**
 * Performance Tracker
 * Tracks request/operation performance
 */
class PerformanceTracker {
  constructor(metrics) {
    this.metrics = metrics;
    this.operations = new Map();
  }

  /**
   * Start tracking operation
   */
  start(name, metadata = {}) {
    const id = `${name}-${Date.now()}-${Math.random()}`;
    this.operations.set(id, {
      name,
      metadata,
      startTime: Date.now(),
    });
    return id;
  }

  /**
   * End tracking operation
   */
  end(id, metadata = {}) {
    const op = this.operations.get(id);
    if (!op) return null;

    const duration = Date.now() - op.startTime;
    this.operations.delete(id);

    // Record histogram
    this.metrics.histogram(`${op.name}_duration_ms`, duration, {
      ...op.metadata,
      ...metadata,
    });

    return {
      name: op.name,
      duration,
      metadata: { ...op.metadata, ...metadata },
    };
  }

  /**
   * Track synchronous operation
   */
  track(name, fn, metadata = {}) {
    const startTime = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - startTime;
      this.metrics.histogram(`${name}_duration_ms`, duration, metadata);
      this.metrics.increment(`${name}_success`, metadata);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.histogram(`${name}_duration_ms`, duration, metadata);
      this.metrics.increment(`${name}_error`, metadata);
      throw error;
    }
  }

  /**
   * Track async operation
   */
  async trackAsync(name, fn, metadata = {}) {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.metrics.histogram(`${name}_duration_ms`, duration, metadata);
      this.metrics.increment(`${name}_success`, metadata);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.histogram(`${name}_duration_ms`, duration, metadata);
      this.metrics.increment(`${name}_error`, metadata);
      throw error;
    }
  }
}

/**
 * Alert System
 * Detects anomalies and triggers alerts
 */
class AlertSystem {
  constructor(metrics, options = {}) {
    this.metrics = metrics;
    this.alerts = [];
    this.rules = [];
    this.checkInterval = options.checkInterval || 60000; // 1 minute
    this.onAlert = options.onAlert || ((alert) => logger.warn('[AlertSystem]', alert));
    this.startChecks();
  }

  /**
   * Define alert rule
   */
  addRule(rule) {
    if (!rule.name || !rule.condition) {
      throw new Error('Rule must have name and condition');
    }
    this.rules.push({
      ...rule,
      id: rule.name,
      enabled: rule.enabled !== false,
      lastTriggered: null,
      triggerCount: 0,
    });
  }

  /**
   * Check rules
   */
  checkRules() {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        const triggered = rule.condition(this.metrics);

        if (triggered) {
          this.triggerAlert({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity || 'warning',
            message: rule.message || `Alert: ${rule.name}`,
            timestamp: Date.now(),
          });

          rule.lastTriggered = Date.now();
          rule.triggerCount++;
        }
      } catch (error) {
        logger.error('[AlertSystem] Error checking rule', {
          rule: rule.name,
          error: error.message,
        });
      }
    }
  }

  /**
   * Trigger alert
   */
  triggerAlert(alert) {
    this.alerts.push(alert);

    // Keep only recent alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-500);
    }

    logger.warn(`[AlertSystem] ${alert.severity.toUpperCase()}: ${alert.message}`);
    this.onAlert(alert);
  }

  /**
   * Start periodic checks
   */
  startChecks() {
    this.checkTimer = setInterval(() => {
      this.checkRules();
    }, this.checkInterval);
  }

  /**
   * Stop periodic checks
   */
  stopChecks() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit = 100) {
    return this.alerts.slice(-limit);
  }

  /**
   * Clear alerts
   */
  clearAlerts() {
    this.alerts = [];
  }
}

/**
 * Global monitoring instance
 */
let globalMetrics = null;
let globalPerformanceTracker = null;
let globalAlertSystem = null;

/**
 * Initialize monitoring
 */
function initializeMonitoring(options = {}) {
  globalMetrics = new MetricsCollector(options.metrics);
  globalPerformanceTracker = new PerformanceTracker(globalMetrics);
  globalAlertSystem = new AlertSystem(globalMetrics, options.alerts);

  // Add default alert rules
  setupDefaultAlerts();

  logger.info('[Monitoring] Monitoring system initialized');

  return {
    metrics: globalMetrics,
    performance: globalPerformanceTracker,
    alerts: globalAlertSystem,
  };
}

/**
 * Setup default alert rules
 */
function setupDefaultAlerts() {
  // High error rate
  globalAlertSystem.addRule({
    name: 'high_error_rate',
    severity: 'critical',
    message: 'High application error rate detected',
    condition: (metrics) => {
      const errorMetrics = metrics.getMetrics().filter((m) => m.name && m.name.includes('error'));
      const successMetrics = metrics
        .getMetrics()
        .filter((m) => m.name && m.name.includes('success'));

      if (successMetrics.length === 0) return false;

      const totalErrors = errorMetrics.reduce((sum, m) => sum + (m.value || 0), 0);
      const totalSuccess = successMetrics.reduce((sum, m) => sum + (m.value || 0), 0);

      const errorRate = totalErrors / (totalErrors + totalSuccess);
      return errorRate > 0.1; // >10% error rate
    },
  });

  // Database connection issues
  globalAlertSystem.addRule({
    name: 'db_connection_errors',
    severity: 'critical',
    message: 'Database connection errors detected',
    condition: (metrics) => {
      const dbMetrics = metrics.getMetrics().filter((m) => m.name === 'db_connection_error');
      return dbMetrics.some((m) => m.value > 0);
    },
  });

  // High latency
  globalAlertSystem.addRule({
    name: 'high_latency',
    severity: 'warning',
    message: 'API latency is high',
    condition: (metrics) => {
      const apiLatency = metrics.getStats('api_request_duration_ms');
      return apiLatency && apiLatency.p95 > 1000; // p95 > 1 second
    },
  });
}

/**
 * Get monitoring instance
 */
function getMonitoring() {
  if (!globalMetrics) {
    return initializeMonitoring();
  }

  return {
    metrics: globalMetrics,
    performance: globalPerformanceTracker,
    alerts: globalAlertSystem,
  };
}

module.exports = {
  MetricsCollector,
  PerformanceTracker,
  AlertSystem,
  initializeMonitoring,
  getMonitoring,
};
