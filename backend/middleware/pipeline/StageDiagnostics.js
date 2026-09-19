"use strict";

/**
 * Static metadata for canonical middleware stages and a small diagnostics
 * collector. It deliberately contains no middleware business logic.
 */
const DEFAULT_STAGES = Object.freeze([
  "trustProxy", "requestId", "correlationId", "requestContext",
  "structuredLogger", "requestLogger", "responseLogger", "performanceLogger",
  "helmet", "csp", "hsts", "frameguard", "referrerPolicy", "xssProtection", "noSniff",
  "compression", "bodyParser", "cookieParser", "cors", "redisAvailability", "rateLimiter", "metrics", "healthContext",
  "tenantResolver", "tenantValidator", "tenantFeatureFlags", "jwt", "session", "apiKey", "refreshToken",
  "roleCheck", "permissionCheck", "featureAuthorization",
  "auditLogger", "piiProtection", "requestRecording", "securityEvents",
]);

function collectStageDiagnostics(stages = DEFAULT_STAGES, runtime = {}) {
  const list = Array.isArray(stages) ? stages : DEFAULT_STAGES;
  return {
    generatedAt: new Date().toISOString(),
    stageCount: list.length,
    stages: list.map((name, order) => ({ name, order: order + 1, enabled: runtime[name] !== false })),
  };
}

module.exports = Object.freeze({
  DEFAULT_STAGES,
  collectStageDiagnostics,
  build: collectStageDiagnostics,
});
module.exports.default = module.exports;
