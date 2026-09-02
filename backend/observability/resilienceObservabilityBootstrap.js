"use strict";

/**
 * ============================================================================
 * Enterprise Observability Bootstrap
 * TITech Community Capital Platform
 * ============================================================================
 *
 * Responsibilities:
 * - Initialize telemetry
 * - Initialize metrics
 * - Initialize tracing
 * - Initialize logging
 * - Initialize event streaming
 * - Initialize health telemetry
 * - Validate dependencies
 * - Fail gracefully
 * - Support future observability extensions
 * ============================================================================
 */

const os = require("os");
const crypto = require("crypto");

const {
  bootstrapResilienceObservability:
    bootstrapInternalObservability,
} = require(
  "../middleware/resilience/observability/resilienceObservabilityBootstrap"
);

/**
 * ============================================================================
 * OBSERVABILITY CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
  serviceName:
    process.env.SERVICE_NAME ||
    "community-savings-backend",

  serviceVersion:
    process.env.APP_VERSION ||
    "1.0.0",

  environment:
    process.env.NODE_ENV ||
    "development",
});

/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

function validateOptions(options = {}) {
  if (
    options &&
    typeof options !== "object"
  ) {
    throw new TypeError(
      "Observability configuration must be an object."
    );
  }

  return options;
}

/**
 * ============================================================================
 * BUILD RUNTIME CONTEXT
 * ============================================================================
 */

function buildRuntimeContext() {
  return {
    instanceId: crypto.randomUUID(),
    hostname: os.hostname(),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    bootTimestamp:
      new Date().toISOString(),
  };
}

/**
 * ============================================================================
 * BOOTSTRAP OBSERVABILITY
 * ============================================================================
 */

function bootstrapResilienceObservability(
  options = {}
) {
  validateOptions(options);

  const runtime =
    buildRuntimeContext();

  const configuration = {
    ...DEFAULT_CONFIG,
    ...options,
  };

  try {
    const observability =
      bootstrapInternalObservability(
        configuration
      );

    if (!observability) {
      throw new Error(
        "Observability initialization returned undefined."
      );
    }

    console.log(
      "[OBSERVABILITY] ✅ Initialized"
    );

    console.log(
      `[OBSERVABILITY] Service=${configuration.serviceName}`
    );

    console.log(
      `[OBSERVABILITY] Environment=${configuration.environment}`
    );

    return {
      ...observability,
      configuration,
      runtime,
      initializedAt:
        new Date().toISOString(),
      healthy: true,
    };
  } catch (error) {
    console.error(
      "[OBSERVABILITY] ❌ Initialization failed"
    );

    console.error(error);

    return {
      telemetry: null,
      metrics: null,
      tracer: null,
      logger: console,
      events: null,
      health: null,

      configuration,
      runtime,

      healthy: false,

      initializationError:
        error.message,
    };
  }
}

/**
 * ============================================================================
 * HEALTH CHECK
 * ============================================================================
 */

function createObservabilityHealthReport(
  observability
) {
  return {
    status:
      observability?.healthy === true
        ? "healthy"
        : "degraded",

    initializedAt:
      observability?.initializedAt,

    environment:
      observability?.configuration
        ?.environment,

    hostname:
      observability?.runtime
        ?.hostname,

    nodeVersion:
      observability?.runtime
        ?.nodeVersion,
  };
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = {
  bootstrapResilienceObservability,
  createObservabilityHealthReport,
};