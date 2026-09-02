// utils/metrics.js
'use strict';

const client = require("prom-client");

// Default registry
const register = client.register;

// ✅ Histogram for request durations
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5] // latency buckets
});

// ✅ Counter for total requests
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

// ✅ Counter for errors
const httpErrorsTotal = new client.Counter({
  name: "http_errors_total",
  help: "Total number of HTTP errors",
  labelNames: ["method", "route", "status"],
});

// Expose metrics registry
module.exports = {
  httpRequestDuration,
  httpRequestsTotal,
  httpErrorsTotal,
  register,
};
