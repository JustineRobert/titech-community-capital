// middleware/monitoring.js
// ============================================================================
// Monitoring Middleware
// Tracks HTTP requests, performance, errors, and business metrics
// ============================================================================

const { getMonitoring } = require('../services/monitoringService');
const logger = require('../utils/logger');

/**
 * Request metrics middleware
 * Tracks incoming requests
 */
function requestMetricsMiddleware(req, res, next) {
  const { metrics, performance } = getMonitoring();

  const startTime = Date.now();
  const trackingId = `req-${startTime}-${Math.random()}`;

  // Store on request object
  req.trackingId = trackingId;
  req.startTime = startTime;

  // Increment request counter
  metrics.increment('http_requests_total', {
    method: req.method,
    path: req.path,
    initial: true,
  });

  // Override res.json to capture response
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode || 200;

    // Record histogram
    metrics.histogram('http_request_duration_ms', duration, {
      method: req.method,
      path: req.path,
      status: statusCode,
    });

    // Record status
    metrics.increment('http_response_status_total', {
      method: req.method,
      path: req.path,
      status: statusCode,
    });

    // Log request
    if (statusCode >= 400) {
      logger.warn('[HTTP]', {
        trackingId,
        method: req.method,
        path: req.path,
        status: statusCode,
        duration,
        error: data?.message,
      });
    } else {
      logger.debug('[HTTP]', {
        trackingId,
        method: req.method,
        path: req.path,
        status: statusCode,
        duration,
      });
    }

    return originalJson(data);
  };

  next();
}

/**
 * Error tracking middleware
 * Tracks application errors
 */
function errorTrackingMiddleware(err, req, res, next) {
  const { metrics } = getMonitoring();

  // Increment error counter
  metrics.increment('application_errors_total', {
    type: err.name || 'Error',
    code: err.code || 'UNKNOWN',
    message: err.message?.substring(0, 50) || 'Unknown',
  });

  // Log error with full context
  logger.error('[ERROR]', {
    trackingId: req.trackingId,
    error: err.message,
    code: err.code,
    stack: err.stack,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
  });

  next(err);
}

/**
 * Business metrics middleware
 * Tracks business-relevant events
 */
function businessMetricsMiddleware(req, res, next) {
  const { metrics } = getMonitoring();

  // Add method to track business events
  req.trackEvent = (name, labels = {}) => {
    metrics.increment(`business_event_${name}`, {
      path: req.path,
      ...labels,
    });
  };

  next();
}

/**
 * Database operation tracking
 */
function trackDatabaseOperation(operationName, fn) {
  const { performance } = getMonitoring();

  return performance.trackAsync(`db_operation_${operationName}`, fn, {
    operation: operationName,
  });
}

/**
 * External API call tracking
 */
function trackExternalAPI(apiName, fn) {
  const { performance } = getMonitoring();

  return performance.trackAsync(`external_api_${apiName}`, fn, {
    api: apiName,
  });
}

/**
 * Authentication tracking
 */
function trackAuthEvent(event, metadata = {}) {
  const { metrics } = getMonitoring();

  metrics.increment('auth_events_total', {
    event,
    ...metadata,
  });

  logger.info('[AUTH]', { event, metadata });
}

/**
 * Payment tracking
 */
function trackPayment(status, amount, metadata = {}) {
  const { metrics } = getMonitoring();

  metrics.increment('payment_transactions_total', {
    status,
    ...metadata,
  });

  if (status === 'success') {
    metrics.gauge('payment_amount_total', amount, {
      ...metadata,
    });
  }

  logger.info('[PAYMENT]', { status, amount, metadata });
}

/**
 * Loan tracking
 */
function trackLoan(event, metadata = {}) {
  const { metrics } = getMonitoring();

  metrics.increment(`loan_events_${event}`, {
    ...metadata,
  });

  logger.info('[LOAN]', { event, metadata });
}

/**
 * Group tracking
 */
function trackGroup(event, metadata = {}) {
  const { metrics } = getMonitoring();

  metrics.increment(`group_events_${event}`, {
    ...metadata,
  });

  logger.info('[GROUP]', { event, metadata });
}

/**
 * Health check endpoint
 */
function healthCheckEndpoint(req, res) {
  const { metrics, alerts } = getMonitoring();

  const allMetrics = metrics.getMetrics();
  const recentAlerts = alerts.getAlerts(10);

  const health = {
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    metrics: {
      total: allMetrics.length,
      counters: allMetrics.filter((m) => m.type === 'counter').length,
      gauges: allMetrics.filter((m) => m.type === 'gauge').length,
      histograms: allMetrics.filter((m) => m.type === 'histogram').length,
    },
    alerts: {
      recent: recentAlerts.length,
      criticalCount: recentAlerts.filter((a) => a.severity === 'critical').length,
    },
  };

  // Check if any critical alerts
  if (health.alerts.criticalCount > 0) {
    health.status = 'degraded';
  }

  res.json(health);
}

/**
 * Metrics export endpoint (Prometheus format)
 */
function metricsExportEndpoint(req, res) {
  const { metrics } = getMonitoring();

  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.exportPrometheus());
}

module.exports = {
  requestMetricsMiddleware,
  errorTrackingMiddleware,
  businessMetricsMiddleware,
  trackDatabaseOperation,
  trackExternalAPI,
  trackAuthEvent,
  trackPayment,
  trackLoan,
  trackGroup,
  healthCheckEndpoint,
  metricsExportEndpoint,
};
