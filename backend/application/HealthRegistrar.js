"use strict";

/**
 * TITech Community Capital LTD
 * Canonical operational health/readiness endpoint registrar.
 */

function toStatusPayload(context = {}) {
  const runtime = context.runtime || context;
  const dependencies = runtime.dependencies || {};
  const dependencyStates = Object.values(dependencies);
  const unhealthy = dependencyStates.some((value) => {
    if (typeof value === "string") return ["DOWN", "FAILED", "UNHEALTHY"].includes(value.toUpperCase());
    return value?.status && ["DOWN", "FAILED", "UNHEALTHY"].includes(String(value.status).toUpperCase());
  });

  return {
    status: unhealthy ? "DEGRADED" : "READY",
    version: runtime.version || process.env.npm_package_version || "1.0.0",
    environment: runtime.environment || process.env.NODE_ENV || "development",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

function registerHealthEndpoints(app, context = {}) {
  if (!app || typeof app.get !== "function") {
    throw new TypeError("Express application instance is required");
  }

  const handler = (_req, res) => res.status(200).json(toStatusPayload(context));
  const readiness = (_req, res) => {
    const payload = toStatusPayload(context);
    return res.status(payload.status === "READY" ? 200 : 503).json(payload);
  };

  app.get("/healthz", handler);
  app.get("/live", (_req, res) => res.status(200).json({ status: "LIVE", uptime: Math.floor(process.uptime()) }));
  app.get("/ready", readiness);
  app.get("/version", (_req, res) => res.status(200).json({ version: process.env.npm_package_version || "1.0.0" }));
  app.get("/metrics", context.metricsHandler || ((_req, res) => res.type("text/plain").send("# TITech metrics endpoint\n")));

  return app;
}

module.exports = registerHealthEndpoints;
module.exports.registerHealthEndpoints = registerHealthEndpoints;
module.exports.toStatusPayload = toStatusPayload;
module.exports.default = registerHealthEndpoints;
