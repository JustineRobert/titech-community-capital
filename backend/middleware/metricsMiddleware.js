// middlewares/metricsMiddleware.js
'use strict';

const { httpRequestDuration, httpRequestsTotal, httpErrorsTotal } = require("../utils/metrics");

/**
 * Middleware to record Prometheus metrics for each HTTP request.
 */
module.exports = (req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route?.path || req.originalUrl || "unknown_route";
    const labels = {
      method: req.method,
      route,
      status: res.statusCode,
    };

    // ✅ Record duration
    end(labels);

    // ✅ Increment counters
    httpRequestsTotal.inc(labels);
    if (res.statusCode >= 400) {
      httpErrorsTotal.inc(labels);
    }
  });

  next();
};
