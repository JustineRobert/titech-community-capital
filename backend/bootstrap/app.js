"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * Enterprise Application Bootstrap / Composition Root
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/app.js
 *
 * Purpose:
 *   Canonical enterprise composition root for the TITech Community Capital
 *   backend runtime.
 *
 * Architectural authority:
 *
 *   BootstrapContext
 *
 * Compatibility/read-model:
 *
 *   runtime/state.js
 *
 * Canonical startup:
 *
 *   created
 *      ↓
 *   starting
 *      ↓
 *   environment
 *      ↓
 *   configuration
 *      ↓
 *   logger
 *      ↓
 *   observability
 *      ↓
 *   readiness
 *      ↓
 *   resilience
 *      ↓
 *   infrastructure
 *      ↓
 *   services
 *      ↓
 *   middleware
 *      ↓
 *   routes
 *      ↓
 *   httpServer
 *      ↓
 *   runtimeReady
 *      ↓
 *   ready
 *
 * Failure:
 *
 *   phase failure
 *      ↓
 *   failed
 *      ↓
 *   cleanup
 *      ↓
 *   stopped
 *
 * Shutdown:
 *
 *   signal/fatal/manual
 *      ↓
 *   shutdown requested
 *      ↓
 *   shutting_down
 *      ↓
 *   reverse infrastructure cleanup
 *      ↓
 *   stopped
 *
 * Design principles:
 *
 *   1. BootstrapContext is the sole lifecycle authority.
 *   2. runtime/state.js is compatibility/read-model only.
 *   3. Every startup phase receives the same BootstrapContext.
 *   4. Startup is single-flight.
 *   5. Shutdown is single-flight.
 *   6. Startup and shutdown cannot perform competing cleanup concurrently.
 *   7. Startup-failure cleanup has a dedicated internal path.
 *   8. Compatibility projection failures never override canonical state.
 *   9. Partially initialized runtimes are never intentionally left alive.
 *  10. Initialization contracts are validated before startup.
 *  11. Signals and fatal process failures converge on one shutdown mechanism.
 *  12. Route ownership remains inside this canonical composition root.
 *  13. server.js remains a thin process-entry wrapper.
 *  14. Every runtime generation receives a fresh BootstrapContext.
 *  15. Shutdown is safe when startup fails at any phase.
 *  16. Operation identifiers are independent from runtime-generation identity.
 *  17. Lifecycle transitions are serialized.
 *  18. Stale runtime generations cannot mutate the active generation.
 *  19. Shutdown cleanup is idempotent.
 *  20. Compatibility state is never treated as authoritative.
 *
 * =============================================================================
 */

const app = require("../app");
const configuration = require("../config");
const runtimeState = require("../runtime/state");

const {
  BootstrapContext,
  createBootstrapContext:
    createCanonicalBootstrapContext,
  BOOTSTRAP_PHASES,
} = require("./context/BootstrapContext");

const environmentBootstrap = require("./environment");
const loggerBootstrap = require("./logger");
const observabilityBootstrap = require("./observability");
const readinessBootstrap = require("./readinessState");
const resilienceBootstrap = require("./resilience");
const infrastructureBootstrap = require("./infrastructure");
const servicesBootstrap = require("./services");
const servicesContextBootstrap = require("./servicesContext");
const middlewareBootstrap = require("./middleware");
const routesBootstrap = require("./routes");
const serverBootstrap = require("./server");
const runtimeBootstrap = require("./runtime");
const shutdownBootstrap = require("./shutdown");
const shutdownManagerBootstrap = require("./shutdownManager");
const errorHandlerModule = require("../middleware/errorHandler");
const startupErrors = require("./startupErrors");

/* =============================================================================
 * PROCESS / MODULE STATE
 * =============================================================================
 */

let logger = null;
let bootstrapContext = null;

let startupPromise = null;
let shutdownPromise = null;

let startupCompleted = false;
let shutdownCompleted = false;

let startupInProgress = false;
let shutdownInProgress = false;

let shutdownRequested = false;
let startupFailureHandled = false;

let signalHandlersInstalled = false;
let fatalHandlersInstalled = false;

let errorHandlerRegistered = false;
let shutdownManagerInitialized = false;

let runtimeGeneration = 0;
let operationSequence = 0;

let activeStartupOperationId = null;
let activeShutdownOperationId = null;

let startupStartedAt = null;
let shutdownStartedAt = null;

let startupAbortController = null;

let activeRouteComposition = null;
let activeRuntimeGeneration = null;

let fatalShutdownPromise = null;

/* =============================================================================
 * SERVICE METADATA
 * =============================================================================
 */

const SERVICE_METADATA = Object.freeze({
  serviceName:
    process.env.SERVICE_NAME ||
    configuration?.serviceName ||
    "titech-community-capital-backend",

  applicationName:
    process.env.APPLICATION_NAME ||
    configuration?.applicationName ||
    configuration?.application ||
    "TITech Community Capital",

  applicationLegalName:
    process.env.APPLICATION_LEGAL_NAME ||
    configuration?.applicationLegalName ||
    "TITech Community Capital LTD",

  version:
    process.env.APP_VERSION ||
    configuration?.appVersion ||
    configuration?.version ||
    "1.0.0",

  nodeMajor:
    Number(
      String(process.versions.node).split(".")[0],
    ),

  nodeVersion:
    process.versions.node,

  platform:
    process.platform,

  architecture:
    process.arch,
});

/* =============================================================================
 * METADATA
 * =============================================================================
 */

function getServiceName() {
  return SERVICE_METADATA.serviceName;
}

function getApplicationName() {
  return SERVICE_METADATA.applicationName;
}

function getApplicationLegalName() {
  return SERVICE_METADATA.applicationLegalName;
}

function getApplicationVersion() {
  return SERVICE_METADATA.version;
}

function getEnvironmentName() {
  return (
    bootstrapContext?.environment ||
    configuration?.environment ||
    process.env.NODE_ENV ||
    "development"
  );
}

function createComponentMetadata(extra = {}) {
  return {
    component:
      "bootstrap/app",

    service:
      getServiceName(),

    application:
      getApplicationName(),

    applicationLegalName:
      getApplicationLegalName(),

    version:
      getApplicationVersion(),

    environment:
      getEnvironmentName(),

    runtimeGeneration:
      activeRuntimeGeneration,

    ...extra,
  };
}

/* =============================================================================
 * OPERATION IDENTIFIERS
 * =============================================================================
 *
 * Operation sequence and runtime generation are deliberately independent.
 *
 * runtimeGeneration:
 *   Identifies one complete application lifecycle.
 *
 * operationSequence:
 *   Identifies an individual startup/shutdown operation.
 *
 * =============================================================================
 */

function createOperationId(
  prefix = "operation",
) {
  operationSequence += 1;

  return [
    prefix,
    process.pid,
    Date.now().toString(36),
    operationSequence.toString(36),
  ].join("-");
}

function getDurationMs(startedAt) {
  if (!startedAt) {
    return null;
  }

  return (
    Number(
      process.hrtime.bigint() -
        startedAt,
    ) / 1_000_000
  );
}

/* =============================================================================
 * EMERGENCY LOGGER
 * =============================================================================
 */

function createConsoleLogger() {
  return Object.freeze({
    info:
      (...args) =>
        console.info(...args),

    warn:
      (...args) =>
        console.warn(...args),

    error:
      (...args) =>
        console.error(...args),

    debug:
      (...args) =>
        console.debug(...args),

    trace:
      (...args) =>
        console.trace(...args),

    fatal:
      (...args) =>
        console.error(...args),
  });
}

function resolveLogger() {
  const fallback =
    createConsoleLogger();

  try {
    if (
      loggerBootstrap &&
      typeof loggerBootstrap.getLogger ===
        "function"
    ) {
      const resolved =
        loggerBootstrap.getLogger();

      if (
        resolved &&
        typeof resolved.info ===
          "function"
      ) {
        return resolved;
      }
    }

    if (
      loggerBootstrap?.logger &&
      typeof loggerBootstrap.logger.info ===
        "function"
    ) {
      return loggerBootstrap.logger;
    }

    if (
      loggerBootstrap &&
      typeof loggerBootstrap.info ===
        "function"
    ) {
      return loggerBootstrap;
    }

    if (
      loggerBootstrap?.default &&
      typeof loggerBootstrap.default.info ===
        "function"
    ) {
      return loggerBootstrap.default;
    }
  } catch {
    // Never allow logger resolution to break lifecycle handling.
  }

  return fallback;
}

logger =
  resolveLogger();

function getLogger() {
  return logger;
}

/* =============================================================================
 * SAFE LOGGING
 * =============================================================================
 */

function safeLog(
  level,
  metadata = {},
  message,
) {
  const fallback =
    createConsoleLogger();

  try {
    const activeLogger =
      logger &&
      typeof logger[level] ===
        "function"
        ? logger
        : fallback;

    if (
      message !== undefined
    ) {
      activeLogger[level](
        metadata,
        message,
      );
    } else {
      activeLogger[level](
        metadata,
      );
    }
  } catch {
    try {
      if (
        message !== undefined
      ) {
        fallback[level](
          metadata,
          message,
        );
      } else {
        fallback[level](
          metadata,
        );
      }
    } catch {
      // Logging must never break lifecycle control.
    }
  }
}

function safeLogInfo(
  metadata,
  message,
) {
  safeLog(
    "info",
    metadata,
    message,
  );
}

function safeLogWarn(
  metadata,
  message,
) {
  safeLog(
    "warn",
    metadata,
    message,
  );
}

function safeLogError(
  metadata,
  message,
) {
  safeLog(
    "error",
    metadata,
    message,
  );
}

function safeLogDebug(
  metadata,
  message,
) {
  safeLog(
    "debug",
    metadata,
    message,
  );
}

function safeLogFatal(
  metadata,
  message,
) {
  safeLog(
    "fatal",
    metadata,
    message,
  );
}

/* =============================================================================
 * INITIALIZER RESOLUTION
 * =============================================================================
 */

function resolveBootstrapInitializer(
  moduleValue,
  options = {},
) {
  const {
    includeLoad = false,
    includeMount = false,
    includeRegister = false,
  } = options;

  if (
    typeof moduleValue ===
    "function"
  ) {
    return moduleValue;
  }

  if (
    !moduleValue ||
    typeof moduleValue !==
      "object"
  ) {
    return null;
  }

  const candidates = [
    moduleValue.initialize,
    moduleValue.bootstrap,
    moduleValue.start,
  ];

  if (includeLoad) {
    candidates.push(
      moduleValue.load,
    );
  }

  if (includeMount) {
    candidates.push(
      moduleValue.mount,
    );
  }

  if (includeRegister) {
    candidates.push(
      moduleValue.register,
      moduleValue.registerMiddleware,
      moduleValue.registerRoutes,
    );
  }

  candidates.push(
    moduleValue.default,
  );

  for (
    const candidate of candidates
  ) {
    if (
      typeof candidate ===
      "function"
    ) {
      return candidate;
    }
  }

  if (
    moduleValue.default &&
    typeof moduleValue.default ===
      "object" &&
    moduleValue.default !==
      moduleValue
  ) {
    return resolveBootstrapInitializer(
      moduleValue.default,
      options,
    );
  }

  return null;
}

/* =============================================================================
 * MODULE VALUE RESOLUTION
 * =============================================================================
 */

function resolveModuleValue(
  moduleValue,
  names = [],
) {
  if (!moduleValue) {
    return null;
  }

  for (
    const name of names
  ) {
    try {
      const value =
        moduleValue[name];

      if (
        typeof value ===
        "function"
      ) {
        return value();
      }

      if (
        value !== undefined
      ) {
        return value;
      }
    } catch {
      // Continue.
    }
  }

  return null;
}

/* =============================================================================
 * CONTEXT CONTRACT
 * =============================================================================
 */

function getCanonicalContextState(
  context,
) {
  if (!context) {
    return null;
  }

  if (
    typeof context.state !==
    "string"
  ) {
    throw new TypeError(
      "Invalid TITech BootstrapContext contract: context.state must be a lifecycle-state string.",
    );
  }

  return context.state;
}

function assertCanonicalBootstrapContext(
  context,
) {
  if (
    !context ||
    !(context instanceof BootstrapContext)
  ) {
    throw new TypeError(
      "TITech bootstrap requires the canonical BootstrapContext instance.",
    );
  }

  const requiredMethods = [
    "start",
    "startPhase",
    "completePhase",
    "markFailed",
    "markReady",
    "beginShutdown",
    "markStopped",
  ];

  for (
    const method of requiredMethods
  ) {
    if (
      typeof context[method] !==
      "function"
    ) {
      throw new TypeError(
        `TITech BootstrapContext lifecycle contract is missing "${method}()".`,
      );
    }
  }

  getCanonicalContextState(
    context,
  );

  return true;
}

/* =============================================================================
 * STARTUP INTERRUPTION
 * =============================================================================
 */

function requestStartupInterruption(
  reason,
) {
  shutdownRequested = true;

  try {
    if (
      startupAbortController &&
      !startupAbortController.signal.aborted
    ) {
      startupAbortController.abort(
        new Error(
          `TITech startup interrupted: ${
            reason ||
            "shutdown requested"
          }.`,
        ),
      );
    }
  } catch {
    // Advisory only.
  }
}

function assertStartupMayContinue(
  phase,
) {
  if (!startupInProgress) {
    return;
  }

  if (!shutdownRequested) {
    return;
  }

  const error =
    new Error(
      `TITech application startup was interrupted during "${phase}" because shutdown was requested.`,
    );

  error.name =
    "StartupInterruptedError";

  error.code =
    "STARTUP_INTERRUPTED";

  error.phase =
    phase;

  error.operation =
    "application-startup";

  throw error;
}

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeStartupInput(
  error,
  options = {},
) {
  if (
    error instanceof BootstrapContext
  ) {
    const state =
      getCanonicalContextState(
        error,
      );

    const contextError =
      new Error(
        `TITech BootstrapContext was supplied as an error value while lifecycle state is "${state}".`,
      );

    contextError.name =
      "BootstrapContextStateError";

    contextError.code =
      "STARTUP_INVALID_CONTEXT";

    contextError.phase =
      options.phase ||
      "lifecycle";

    contextError.contextState =
      state;

    return contextError;
  }

  if (
    error instanceof Error
  ) {
    return error;
  }

  if (
    error &&
    typeof error ===
      "object"
  ) {
    const normalized =
      new Error(
        error.message ||
          "TITech bootstrap operation failed.",
      );

    normalized.name =
      error.name ||
      "BootstrapError";

    if (error.code) {
      normalized.code =
        error.code;
    }

    if (error.cause) {
      normalized.cause =
        error.cause;
    }

    if (error.phase) {
      normalized.phase =
        error.phase;
    }

    if (error.operation) {
      normalized.operation =
        error.operation;
    }

    return normalized;
  }

  return new Error(
    typeof error ===
      "string"
      ? error
      : "TITech bootstrap operation failed.",
  );
}

function normalizeStartupError(
  error,
  options = {},
) {
  const safeInput =
    normalizeStartupInput(
      error,
      options,
    );

  if (
    startupErrors?.isStartupError?.(
      safeInput,
    ) &&
    Object.keys(options).length ===
      0
  ) {
    return safeInput;
  }

  return startupErrors.normalizeStartupError(
    safeInput,
    {
      phase:
        options.phase ||
        safeInput?.phase ||
        "bootstrap",

      component:
        options.component ||
        "bootstrap/app",

      service:
        options.service ||
        getServiceName(),

      application:
        options.application ||
        getApplicationName(),

      version:
        options.version ||
        getApplicationVersion(),

      operation:
        options.operation ||
        safeInput?.operation ||
        "bootstrap",

      critical:
        options.critical !== false,

      fatal:
        options.fatal !== false,

      preserveCauseStack:
        options.preserveCauseStack !==
        false,

      ...options,
    },
  );
}

function createPhaseStartupError(
  phase,
  error,
  options = {},
) {
  const safeInput =
    normalizeStartupInput(
      error,
      {
        ...options,
        phase,
      },
    );

  return startupErrors.startupErrorForPhase(
    phase,
    safeInput,
    {
      operation:
        options.operation ||
        `bootstrap-${phase}`,

      component:
        options.component ||
        "bootstrap/app",

      service:
        options.service ||
        getServiceName(),

      application:
        options.application ||
        getApplicationName(),

      version:
        options.version ||
        getApplicationVersion(),

      critical:
        options.critical !== false,

      fatal:
        options.fatal !== false,

      preserveCauseStack:
        options.preserveCauseStack !==
        false,

      durationMs:
        options.durationMs,

      ...options,
    },
  );
}

/* =============================================================================
 * BOOTSTRAP CONTEXT
 * =============================================================================
 */

function createBootstrapContext() {
  runtimeGeneration += 1;

  const generation =
    runtimeGeneration;

  const context =
    createCanonicalBootstrapContext({
      application:
        app,

      configuration,

      logger,

      metadata:
        createComponentMetadata({
          component:
            "bootstrap",

          source:
            "backend/bootstrap/app.js",

          runtimeGeneration:
            generation,
        }),
    });

  assertCanonicalBootstrapContext(
    context,
  );

  if (!context.container) {
    context.container = {};
  }

  context.runtimeGeneration =
    generation;

  context.runtimeGenerationId =
    generation;

  return context;
}

function getBootstrapContext() {
  return bootstrapContext;
}

/* =============================================================================
 * RUNTIME COMPATIBILITY PROJECTION
 * =============================================================================
 */

const RUNTIME_SERVICE_MAP =
  Object.freeze({
    logger:
      "logger",

    observability:
      "observability",

    resilience:
      "resilience",

    infrastructure:
      "database",

    middleware:
      "middleware",

    routes:
      "routes",

    httpServer:
      "server",
  });

function mirrorServiceState(
  canonicalPhase,
  state,
) {
  const runtimeService =
    RUNTIME_SERVICE_MAP[
      canonicalPhase
    ];

  if (
    !runtimeService ||
    typeof runtimeState?.setServiceState !==
      "function"
  ) {
    return;
  }

  try {
    runtimeState.setServiceState(
      runtimeService,
      state,
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_service_update_failed",

        phase:
          canonicalPhase,

        runtimeService,

        state,

        message:
          error?.message,
      }),
      "TITech runtime compatibility service-state update failed.",
    );
  }
}

function mirrorApplicationStarting() {
  try {
    runtimeState?.markStarting?.(
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_starting_update_failed",

        message:
          error?.message,
      }),
      "TITech runtime compatibility starting-state update failed.",
    );
  }
}

function mirrorApplicationStarted() {
  try {
    runtimeState?.markApplicationStarted?.(
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_started_update_failed",

        message:
          error?.message,
      }),
      "TITech runtime compatibility started-state update failed.",
    );
  }
}

function mirrorApplicationReady() {
  try {
    runtimeState?.markApplicationReady?.(
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_ready_update_failed",

        message:
          error?.message,
      }),
      "TITech runtime compatibility ready-state update failed.",
    );
  }
}

function mirrorApplicationFailed(
  error,
) {
  try {
    runtimeState?.markFailed?.(
      error,
      null,
      logger,
    );
  } catch (stateError) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_failure_update_failed",

        message:
          stateError?.message,
      }),
      "TITech runtime compatibility failure-state update failed.",
    );
  }
}

function mirrorApplicationShutdown() {
  try {
    runtimeState?.markApplicationShutdown?.(
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_shutdown_update_failed",

        message:
          error?.message,
      }),
      "TITech runtime compatibility shutdown-state update failed.",
    );
  }
}

function mirrorApplicationStopped() {
  try {
    runtimeState?.markApplicationStopped?.(
      null,
      logger,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "runtime_state_stopped_update_failed",

        message:
          error?.message,
      }),
      "TITech runtime compatibility stopped-state update failed.",
    );
  }
}

/* =============================================================================
 * STARTUP PHASES
 * =============================================================================
 */

async function bootstrapEnvironment() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        environmentBootstrap,
        {
          includeLoad:
            true,
        },
      );

    if (initializer) {
      const result =
        await initializer(
          bootstrapContext,
        );

      if (
        result &&
        typeof result ===
          "object"
      ) {
        return (
          result.environment ||
          result.configuration ||
          result.config ||
          result
        );
      }

      return (
        result ||
        configuration?.environment ||
        getEnvironmentName()
      );
    }

    return (
      environmentBootstrap?.environment ||
      configuration?.environment ||
      getEnvironmentName()
    );
  } catch (error) {
    throw createPhaseStartupError(
      "environment",
      error,
      {
        operation:
          "bootstrap-environment",
      },
    );
  }
}

async function bootstrapConfiguration() {
  try {
    if (!configuration) {
      throw new Error(
        "TITech application configuration is unavailable.",
      );
    }

    if (
      configuration.__requiresImmutable ===
        true &&
      !Object.isFrozen(
        configuration,
      )
    ) {
      throw new Error(
        "TITech application configuration must be immutable.",
      );
    }

    return configuration;
  } catch (error) {
    throw createPhaseStartupError(
      "configuration",
      error,
      {
        operation:
          "validate-configuration",
      },
    );
  }
}

async function bootstrapLogger() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        loggerBootstrap,
        {
          includeLoad:
            true,

          includeRegister:
            true,
        },
      );

    if (initializer) {
      const initialized =
        await initializer({
          context:
            bootstrapContext,

          configuration,

          service:
            getServiceName(),

          application:
            getApplicationName(),

          version:
            getApplicationVersion(),
        });

      if (
        initialized &&
        typeof initialized.info ===
          "function"
      ) {
        logger =
          initialized;
      }
    }

    logger =
      resolveLogger();

    if (
      !logger ||
      typeof logger.info !==
        "function"
    ) {
      throw new Error(
        "TITech application logger is unavailable after initialization.",
      );
    }

    bootstrapContext.setLogger(
      logger,
    );

    safeLogInfo(
      createComponentMetadata({
        phase:
          "logger",

        event:
          "logger.ready",
      }),
      "TITech logger bootstrap completed.",
    );

    return logger;
  } catch (error) {
    throw createPhaseStartupError(
      "logger",
      error,
      {
        operation:
          "initialize-logger",
      },
    );
  }
}

async function bootstrapObservability() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        observabilityBootstrap,
      );

    if (!initializer) {
      throw new Error(
        "TITech observability bootstrap initializer is unavailable.",
      );
    }

    return await initializer({
      context:
        bootstrapContext,

      configuration,

      logger,

      service:
        getServiceName(),

      application:
        getApplicationName(),

      version:
        getApplicationVersion(),
    });
  } catch (error) {
    throw createPhaseStartupError(
      "observability",
      error,
      {
        operation:
          "initialize-observability",
      },
    );
  }
}

async function bootstrapReadiness() {
  try {
    const options = {
      source:
        "bootstrap/app",

      context:
        bootstrapContext,
    };

    if (
      typeof readinessBootstrap?.beginInitialization ===
      "function"
    ) {
      readinessBootstrap.beginInitialization(
        options,
      );
    }

    if (
      typeof readinessBootstrap?.beginWarming ===
      "function"
    ) {
      readinessBootstrap.beginWarming(
        options,
      );
    }

    if (
      typeof readinessBootstrap?.evaluate ===
      "function"
    ) {
      await readinessBootstrap.evaluate({
        allowRecovery:
          true,

        context:
          bootstrapContext,
      });
    }

    return (
      readinessBootstrap?.readinessState ||
      readinessBootstrap
    );
  } catch (error) {
    throw createPhaseStartupError(
      "readiness",
      error,
      {
        operation:
          "initialize-readiness",
      },
    );
  }
}

async function bootstrapResilience() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        resilienceBootstrap,
      );

    if (!initializer) {
      throw new Error(
        "TITech resilience bootstrap initializer is unavailable.",
      );
    }

    return await initializer(
      bootstrapContext,
    );
  } catch (error) {
    throw createPhaseStartupError(
      "resilience",
      error,
      {
        operation:
          "initialize-resilience",
      },
    );
  }
}

async function bootstrapInfrastructure() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        infrastructureBootstrap,
        {
          includeRegister:
            true,
        },
      );

    if (!initializer) {
      throw new Error(
        "TITech infrastructure bootstrap initializer is unavailable.",
      );
    }

    const result =
      await initializer(
        bootstrapContext,
      );

    if (
      result &&
      typeof result ===
        "object" &&
      result.ok === false &&
      result.ready === false
    ) {
      throw new Error(
        "TITech infrastructure initializer reported an unsuccessful result.",
      );
    }

    return (
      result ||
      infrastructureBootstrap?.infrastructure ||
      infrastructureBootstrap
    );
  } catch (error) {
    throw createPhaseStartupError(
      "infrastructure",
      error,
      {
        operation:
          "initialize-infrastructure",
      },
    );
  }
}

async function bootstrapServices() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        servicesBootstrap,
      );

    if (!initializer) {
      throw new Error(
        "TITech services bootstrap initializer is unavailable.",
      );
    }

    const services =
      await initializer(
        bootstrapContext,
      );

    const resolvedServices =
      services ||
      resolveModuleValue(
        servicesBootstrap,
        [
          "getServices",
          "services",
          "registry",
        ],
      ) ||
      {};

    bootstrapContext.setServices(
      resolvedServices,
    );

    const serviceRegistry =
      resolveModuleValue(
        servicesBootstrap,
        [
          "getServiceRegistry",
          "serviceRegistry",
        ],
      ) ||
      resolvedServices;

    bootstrapContext.serviceRegistry =
      serviceRegistry;

    if (
      typeof servicesContextBootstrap?.createRootContext ===
      "function"
    ) {
      const rootContext =
        servicesContextBootstrap.createRootContext({
          config:
            configuration,

          configuration,

          environment:
            bootstrapContext.environment,

          logger:
            bootstrapContext.logger,

          observability:
            bootstrapContext.observability,

          readiness:
            bootstrapContext.readiness,

          resilience:
            bootstrapContext.resilience,

          infrastructure:
            bootstrapContext.infrastructure,

          services:
            bootstrapContext.services,

          serviceRegistry,

          container:
            bootstrapContext.container,

          bootstrapContext,

          metadata:
            createComponentMetadata({
              source:
                "bootstrap/app",
            }),
        });

      if (rootContext) {
        bootstrapContext.servicesRootContext =
          rootContext;

        bootstrapContext.servicesContext =
          rootContext;

        bootstrapContext.serviceContext =
          rootContext;
      }
    }

    if (
      typeof servicesContextBootstrap?.createServicesContext ===
        "function" &&
      bootstrapContext.servicesRootContext
    ) {
      const childContext =
        servicesContextBootstrap.createServicesContext({
          parent:
            bootstrapContext.servicesRootContext,

          services:
            bootstrapContext.serviceRegistry,

          bootstrapContext,
        });

      if (childContext) {
        bootstrapContext.servicesContext =
          childContext;

        bootstrapContext.serviceContext =
          childContext;
      }
    }

    return bootstrapContext.services;
  } catch (error) {
    throw createPhaseStartupError(
      "services",
      error,
      {
        operation:
          "initialize-services",
      },
    );
  }
}

async function bootstrapMiddleware() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        middlewareBootstrap,
        {
          includeRegister:
            true,
        },
      );

    if (!initializer) {
      throw new Error(
        "TITech middleware bootstrap initializer is unavailable.",
      );
    }

    const result =
      middlewareBootstrap?.acceptsContextOnly ===
      true
        ? await initializer(
            bootstrapContext,
          )
        : await initializer(
            app,
            bootstrapContext,
          );

    const middleware =
      result ||
      middlewareBootstrap?.middleware ||
      middlewareBootstrap;

    bootstrapContext.setMiddleware(
      middleware,
    );

    return middleware;
  } catch (error) {
    throw createPhaseStartupError(
      "middleware",
      error,
      {
        operation:
          "initialize-middleware",
      },
    );
  }
}

async function bootstrapRoutes() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        routesBootstrap,
        {
          includeMount:
            true,

          includeRegister:
            true,
        },
      );

    if (!initializer) {
      throw new Error(
        "TITech route bootstrap initializer is unavailable.",
      );
    }

    const result =
      await initializer(
        app,
        bootstrapContext,
        {
          requireReadiness:
            false,

          routeComposition:
            activeRouteComposition,
        },
      );

    const router =
      result ||
      routesBootstrap?.router ||
      routesBootstrap;

    bootstrapContext.setRoutes(
      router,
    );

    safeLogInfo(
      createComponentMetadata({
        event:
          "routes.registered",

        routeCompositionProvided:
          Boolean(
            activeRouteComposition,
          ),
      }),
      "TITech API routes registered successfully.",
    );

    return router;
  } catch (error) {
    throw createPhaseStartupError(
      "routes",
      error,
      {
        operation:
          "initialize-routes",
      },
    );
  }
}

/* =============================================================================
 * ERROR HANDLER
 * =============================================================================
 */

async function bootstrapErrorHandler() {
  if (errorHandlerRegistered) {
    return app;
  }

  try {
    const errorHandler =
      typeof errorHandlerModule ===
        "function"
        ? errorHandlerModule
        : errorHandlerModule?.errorHandler ||
          errorHandlerModule?.default;

    if (
      typeof errorHandler !==
      "function"
    ) {
      throw new TypeError(
        "TITech centralized error handler must export a callable middleware function.",
      );
    }

    app.use(
      errorHandler,
    );

    errorHandlerRegistered =
      true;

    safeLogDebug(
      createComponentMetadata({
        event:
          "error_handler.registered",
      }),
      "TITech centralized error handler registered.",
    );

    return app;
  } catch (error) {
    throw createPhaseStartupError(
      "routes",
      error,
      {
        operation:
          "register-error-handler",
      },
    );
  }
}

/* =============================================================================
 * HTTP SERVER
 * =============================================================================
 */

async function bootstrapHttpServer() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        serverBootstrap,
      );

    if (!initializer) {
      throw new Error(
        "TITech HTTP server bootstrap initializer is unavailable.",
      );
    }

    const serverContext = {
      app,

      bootstrapContext,

      context:
        bootstrapContext,

      configuration,

      config:
        configuration,

      environment:
        bootstrapContext.environment,

      logger,

      observability:
        bootstrapContext.observability,

      readiness:
        bootstrapContext.readiness,

      resilience:
        bootstrapContext.resilience,

      infrastructure:
        bootstrapContext.infrastructure,

      services:
        bootstrapContext.services,

      middleware:
        bootstrapContext.middleware,

      routes:
        bootstrapContext.routes,

      routeComposition:
        activeRouteComposition,
    };

    const result =
      await initializer(
        serverContext,
        {
          requireReadiness:
            true,

          requireHttpServer:
            false,
        },
      );

    const server =
      result?.server ||
      resolveModuleValue(
        serverBootstrap,
        [
          "getServer",
          "server",
        ],
      );

    if (!server) {
      throw new Error(
        "TITech HTTP server initializer completed without exposing an HTTP server.",
      );
    }

    bootstrapContext.setHttpServer(
      server,
    );

    bootstrapContext.server =
      server;

    bootstrapContext.serverAddress =
      result?.address ||
      resolveModuleValue(
        serverBootstrap,
        [
          "getAddress",
          "address",
        ],
      ) ||
      null;

    return {
      ...(result || {}),

      server,

      address:
        bootstrapContext.serverAddress,
    };
  } catch (error) {
    throw createPhaseStartupError(
      "httpServer",
      error,
      {
        operation:
          "start-http-server",
      },
    );
  }
}

async function bootstrapRuntimeReady() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        runtimeBootstrap,
      );

    if (initializer) {
      return await initializer(
        bootstrapContext,
      );
    }

    if (
      typeof bootstrapContext.validateRuntimeReady ===
      "function"
    ) {
      return bootstrapContext.validateRuntimeReady();
    }

    return true;
  } catch (error) {
    throw createPhaseStartupError(
      "runtimeReady",
      error,
      {
        operation:
          "initialize-runtime-ready",
      },
    );
  }
}

/* =============================================================================
 * READY TRANSITION
 * =============================================================================
 */

async function markApplicationReady() {
  try {
    if (
      typeof bootstrapContext.validateRuntimeReady ===
      "function"
    ) {
      bootstrapContext.validateRuntimeReady();
    }

    if (
      typeof readinessBootstrap?.evaluate ===
      "function"
    ) {
      await readinessBootstrap.evaluate({
        allowRecovery:
          true,

        context:
          bootstrapContext,
      });
    }

    const readinessReady =
      typeof readinessBootstrap?.isReady ===
        "function"
        ? readinessBootstrap.isReady()
        : true;

    if (!readinessReady) {
      throw new Error(
        "TITech application dependencies are not ready.",
      );
    }

    if (
      typeof readinessBootstrap?.markReady ===
      "function"
    ) {
      readinessBootstrap.markReady({
        source:
          "bootstrap/app",

        context:
          bootstrapContext,
      });
    }

    bootstrapContext.markReady();

    mirrorApplicationReady();

    safeLogInfo(
      createComponentMetadata({
        event:
          "application.ready",

        state:
          bootstrapContext.state,

        startupDurationMs:
          getDurationMs(
            startupStartedAt,
          ),

        startupOperationId:
          activeStartupOperationId,
      }),
      "TITech application is ready.",
    );

    return true;
  } catch (error) {
    throw createPhaseStartupError(
      "runtimeReady",
      error,
      {
        operation:
          "mark-application-ready",
      },
    );
  }
}

/* =============================================================================
 * PHASE NORMALIZATION
 * =============================================================================
 */

function normalizePhaseName(
  phase,
) {
  const normalized =
    String(
      phase || "",
    ).trim();

  if (
    !BOOTSTRAP_PHASES.includes(
      normalized,
    )
  ) {
    const error =
      new Error(
        `Unknown TITech bootstrap phase "${phase}". Expected one of: ${BOOTSTRAP_PHASES.join(
          ", ",
        )}`,
      );

    error.code =
      "BOOTSTRAP_UNKNOWN_PHASE";

    error.phase =
      normalized ||
      "bootstrap";

    throw error;
  }

  return normalized;
}

/* =============================================================================
 * STARTUP PHASE RUNNER
 * =============================================================================
 */

async function runStartupPhase(
  phase,
  execute,
) {
  let canonicalPhase;

  try {
    canonicalPhase =
      normalizePhaseName(
        phase,
      );
  } catch (error) {
    throw normalizeStartupError(
      error,
      {
        phase:
          "bootstrap",

        operation:
          "normalize-startup-phase",
      },
    );
  }

  if (!bootstrapContext) {
    throw normalizeStartupError(
      new Error(
        "TITech BootstrapContext is unavailable before startup phase execution.",
      ),
      {
        phase:
          canonicalPhase,

        operation:
          `bootstrap-${canonicalPhase}`,
      },
    );
  }

  assertCanonicalBootstrapContext(
    bootstrapContext,
  );

  assertStartupMayContinue(
    canonicalPhase,
  );

  if (
    typeof execute !==
    "function"
  ) {
    throw createPhaseStartupError(
      canonicalPhase,
      new TypeError(
        `Startup phase "${canonicalPhase}" does not have a callable executor.`,
      ),
      {
        operation:
          `bootstrap-${canonicalPhase}`,
      },
    );
  }

  const contextAtStart =
    bootstrapContext;

  const generationAtStart =
    activeRuntimeGeneration;

  const startedAt =
    process.hrtime.bigint();

  try {
    contextAtStart.startPhase(
      canonicalPhase,
      {
        phase:
          canonicalPhase,

        operationId:
          activeStartupOperationId,

        runtimeGeneration:
          generationAtStart,
      },
    );
  } catch (error) {
    const normalized =
      createPhaseStartupError(
        canonicalPhase,
        error,
        {
          operation:
            `start-phase-${canonicalPhase}`,
        },
      );

    mirrorServiceState(
      canonicalPhase,
      "failed",
    );

    throw normalized;
  }

  mirrorServiceState(
    canonicalPhase,
    "starting",
  );

  try {
    assertStartupMayContinue(
      canonicalPhase,
    );

    const result =
      await execute(
        contextAtStart,
      );

    /*
     * Prevent an obsolete runtime generation from completing a phase after
     * another generation has become active.
     */
    if (
      bootstrapContext !==
        contextAtStart ||
      activeRuntimeGeneration !==
        generationAtStart
    ) {
      const staleError =
        new Error(
          `TITech startup phase "${canonicalPhase}" completed for a stale runtime generation.`,
        );

      staleError.name =
        "StaleRuntimeGenerationError";

      staleError.code =
        "STALE_RUNTIME_GENERATION";

      staleError.phase =
        canonicalPhase;

      throw staleError;
    }

    assertStartupMayContinue(
      canonicalPhase,
    );

    const durationMs =
      Number(
        process.hrtime.bigint() -
          startedAt,
      ) / 1_000_000;

    contextAtStart.completePhase(
      canonicalPhase,
      {
        durationMs,

        operationId:
          activeStartupOperationId,

        runtimeGeneration:
          generationAtStart,
      },
    );

    mirrorServiceState(
      canonicalPhase,
      "ready",
    );

    safeLogDebug(
      createComponentMetadata({
        event:
          "phase.completed",

        phase:
          canonicalPhase,

        durationMs,

        canonicalState:
          contextAtStart.state,

        operationId:
          activeStartupOperationId,
      }),
      `TITech bootstrap phase "${canonicalPhase}" completed.`,
    );

    return result;
  } catch (error) {
    const durationMs =
      Number(
        process.hrtime.bigint() -
          startedAt,
      ) / 1_000_000;

    const normalized =
      createPhaseStartupError(
        canonicalPhase,
        error,
        {
          operation:
            `bootstrap-${canonicalPhase}`,

          durationMs,

          operationId:
            activeStartupOperationId,

          runtimeGeneration:
            generationAtStart,
        },
      );

    try {
      if (
        bootstrapContext ===
        contextAtStart
      ) {
        contextAtStart.failPhase(
          canonicalPhase,
          normalized,
          {
            durationMs,

            operationId:
              activeStartupOperationId,

            runtimeGeneration:
              generationAtStart,
          },
        );
      }
    } catch (contextError) {
      safeLogWarn(
        createComponentMetadata({
          event:
            "phase.failure_recording_failed",

          phase:
            canonicalPhase,

          message:
            contextError?.message,

          operationId:
            activeStartupOperationId,
        }),
        "TITech BootstrapContext phase failure recording failed.",
      );
    }

    mirrorServiceState(
      canonicalPhase,
      "failed",
    );

    throw normalized;
  }
}

/* =============================================================================
 * SHUTDOWN MANAGER
 * =============================================================================
 */

async function initializeShutdownManager() {
  if (
    shutdownManagerInitialized
  ) {
    return;
  }

  if (
    !shutdownManagerBootstrap
  ) {
    shutdownManagerInitialized =
      true;

    return;
  }

  if (
    typeof shutdownManagerBootstrap.initialize ===
    "function"
  ) {
    await shutdownManagerBootstrap.initialize({
      context:
        bootstrapContext,

      app,

      configuration,

      logger,
    });
  }

  if (
    typeof shutdownManagerBootstrap.registerBootstrapHooks ===
    "function"
  ) {
    await shutdownManagerBootstrap.registerBootstrapHooks(
      bootstrapContext,
    );
  }

  shutdownManagerInitialized =
    true;
}

/* =============================================================================
 * SHUTDOWN HOOK EXECUTION
 * =============================================================================
 */

async function executeShutdownHooks(
  reason,
) {
  if (
    typeof shutdownBootstrap?.shutdown ===
    "function"
  ) {
    await shutdownBootstrap.shutdown(
      reason,
      {
        signal:
          String(
            reason,
          ).startsWith(
            "signal:",
          )
            ? String(
                reason,
              ).slice(
                "signal:".length,
              )
            : undefined,

        context:
          bootstrapContext,

        app,

        operationId:
          activeShutdownOperationId,

        runtimeGeneration:
          activeRuntimeGeneration,
      },
    );

    return;
  }

  if (
    typeof shutdownBootstrap
      ?.shutdownCoordinator
      ?.request ===
    "function"
  ) {
    await shutdownBootstrap.shutdownCoordinator.request(
      reason,
    );

    return;
  }

  if (
    typeof shutdownManagerBootstrap?.shutdown ===
    "function"
  ) {
    await shutdownManagerBootstrap.shutdown(
      reason,
      bootstrapContext,
    );

    return;
  }

  if (
    bootstrapContext &&
    typeof bootstrapContext.executeShutdownHooks ===
      "function"
  ) {
    await bootstrapContext.executeShutdownHooks();
  }
}

/* =============================================================================
 * CANONICAL SHUTDOWN TRANSITION
 * =============================================================================
 */

function transitionContextToShutdown(
  reason,
) {
  if (!bootstrapContext) {
    return;
  }

  const state =
    bootstrapContext.state;

  if (
    state ===
      "stopped" ||
    state ===
      "shutting_down"
  ) {
    return;
  }

  try {
    bootstrapContext.beginShutdown(
      reason,
    );
  } catch (error) {
    /*
     * Some canonical state machines require failed → stopped cleanup rather
     * than failed → shutting_down. We do not mutate canonical state ourselves.
     *
     * The context remains authoritative. The cleanup coordinator is allowed
     * to continue so long as the underlying shutdown implementation supports
     * failed-runtime cleanup.
     */
    safeLogWarn(
      createComponentMetadata({
        event:
          "bootstrap_context_shutdown_transition_failed",

        reason,

        state,

        message:
          error?.message,
      }),
      "TITech BootstrapContext shutdown transition failed; cleanup coordinator will continue.",
    );
  }
}

/* =============================================================================
 * INTERNAL SHUTDOWN
 * =============================================================================
 */

async function performShutdown({
  reason,
  exit,
  exitCode,
  skipProcessExit,
}) {
  try {
    safeLogInfo(
      createComponentMetadata({
        event:
          "shutdown.requested",

        reason,

        startupCompleted,

        canonicalState:
          bootstrapContext?.state ||
          null,

        operationId:
          activeShutdownOperationId,
      }),
      "TITech Community Capital shutdown requested.",
    );

    transitionContextToShutdown(
      reason,
    );

    try {
      readinessBootstrap?.markNotReady?.(
        "application-shutdown",
        {
          reason,

          context:
            bootstrapContext,
        },
      );
    } catch (error) {
      safeLogWarn(
        createComponentMetadata({
          event:
            "readiness.shutdown_update_failed",

          message:
            error?.message,
        }),
        "TITech readiness shutdown-state update failed.",
      );
    }

    mirrorApplicationShutdown();

    await executeShutdownHooks(
      reason,
    );

    if (
      bootstrapContext &&
      bootstrapContext.state !==
        "stopped"
    ) {
      try {
        bootstrapContext.markStopped();
      } catch (error) {
        safeLogWarn(
          createComponentMetadata({
            event:
              "bootstrap_context_stopped_transition_failed",

            message:
              error?.message,

            state:
              bootstrapContext?.state,
          }),
          "TITech BootstrapContext stopped-state transition failed.",
        );
      }
    }

    mirrorApplicationStopped();

    shutdownCompleted =
      true;

    startupCompleted =
      false;

    startupFailureHandled =
      false;

    shutdownRequested =
      false;

    const durationMs =
      getDurationMs(
        shutdownStartedAt,
      );

    safeLogInfo(
      createComponentMetadata({
        event:
          "shutdown.completed",

        reason,

        durationMs,

        canonicalState:
          bootstrapContext?.state ||
          null,

        operationId:
          activeShutdownOperationId,
      }),
      "TITech Community Capital shutdown completed.",
    );

    if (
      exit &&
      !skipProcessExit
    ) {
      process.exit(
        exitCode,
      );
    }

    return {
      state:
        bootstrapContext?.state ||
        null,

      durationMs,

      operationId:
        activeShutdownOperationId,

      runtimeGeneration:
        activeRuntimeGeneration,
    };
  } catch (error) {
    const normalized =
      normalizeStartupError(
        error,
        {
          phase:
            "lifecycle",

          operation:
            "application-shutdown",

          critical:
            exit,

          fatal:
            exit,

          preserveCauseStack:
            true,

          operationId:
            activeShutdownOperationId,

          runtimeGeneration:
            activeRuntimeGeneration,

          durationMs:
            getDurationMs(
              shutdownStartedAt,
            ),
        },
      );

    safeLogError(
      typeof normalized.toLogObject ===
        "function"
        ? normalized.toLogObject({
            includeStack:
              true,

            includeCauseStack:
              true,
          })
        : normalized,
      "TITech Community Capital shutdown failed.",
    );

    if (
      exit &&
      !skipProcessExit
    ) {
      process.exit(
        exitCode || 1,
      );
    }

    throw normalized;
  }
}

/* =============================================================================
 * STARTUP FAILURE CLEANUP
 * =============================================================================
 */

async function cleanupFailedStartup(
  originalError,
) {
  if (
    startupFailureHandled
  ) {
    return;
  }

  startupFailureHandled =
    true;

  const failedContext =
    bootstrapContext;

  try {
    if (
      failedContext &&
      failedContext.state !==
        "failed" &&
      failedContext.state !==
        "stopped"
    ) {
      failedContext.markFailed(
        originalError,
        originalError?.phase ||
          failedContext.currentPhase ||
          "bootstrap",
      );
    }
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "startup.failure_transition_failed",

        message:
          error?.message,
      }),
      "TITech startup failure transition failed.",
    );
  }

  mirrorApplicationFailed(
    originalError,
  );

  /*
   * Detach startup ownership before cleanup.
   *
   * This prevents the public shutdown guard from deadlocking against the
   * startup promise which is currently executing the cleanup path.
   */
  startupInProgress =
    false;

  shutdownRequested =
    true;

  shutdownInProgress =
    true;

  shutdownStartedAt =
    process.hrtime.bigint();

  activeShutdownOperationId =
    createOperationId(
      "startup-cleanup",
    );

  try {
    await performShutdown({
      reason:
        "startup_failure",

      exit:
        false,

      exitCode:
        1,

      skipProcessExit:
        true,
    });
  } catch (cleanupError) {
    safeLogError(
      createComponentMetadata({
        event:
          "startup.cleanup.failed",

        originalFailure:
          originalError?.message,

        cleanupFailure:
          cleanupError?.message,

        operationId:
          activeShutdownOperationId,
      }),
      "TITech startup cleanup encountered an error.",
    );
  } finally {
    shutdownInProgress =
      false;

    shutdownPromise =
      null;

    activeShutdownOperationId =
      null;

    shutdownStartedAt =
      null;

    shutdownRequested =
      false;
  }
}

/* =============================================================================
 * START APPLICATION
 * =============================================================================
 */

async function startApplication(
  options = {},
) {
  if (startupPromise) {
    return startupPromise;
  }

  if (
    startupCompleted &&
    bootstrapContext?.state ===
      "ready"
  ) {
    return {
      app,

      server:
        bootstrapContext.httpServer ||
        null,

      context:
        bootstrapContext,

      state:
        runtimeState.getApplicationState?.() ||
        null,

      runtimeGeneration:
        activeRuntimeGeneration,
    };
  }

  if (
    shutdownPromise ||
    shutdownInProgress
  ) {
    throw new Error(
      "TITech application shutdown is currently in progress; startup cannot begin concurrently.",
    );
  }

  activeRouteComposition =
    options?.routeComposition ||
    null;

  startupPromise =
    (async () => {
      startupInProgress =
        true;

      startupStartedAt =
        process.hrtime.bigint();

      activeStartupOperationId =
        createOperationId(
          "startup",
        );

      startupAbortController =
        new AbortController();

      bootstrapContext =
        createBootstrapContext();

      activeRuntimeGeneration =
        bootstrapContext.runtimeGeneration;

      startupCompleted =
        false;

      shutdownCompleted =
        false;

      shutdownRequested =
        false;

      startupFailureHandled =
        false;

      errorHandlerRegistered =
        false;

      shutdownManagerInitialized =
        false;

      bootstrapContext.startupOperationId =
        activeStartupOperationId;

      bootstrapContext.startupSignal =
        startupAbortController.signal;

      bootstrapContext.routeComposition =
        activeRouteComposition;

      try {
        validateBootstrapComposition();

        safeLogInfo(
          createComponentMetadata({
            event:
              "application.bootstrap.started",

            state:
              bootstrapContext.state,

            runtimeGeneration:
              activeRuntimeGeneration,

            operationId:
              activeStartupOperationId,

            routeCompositionProvided:
              Boolean(
                activeRouteComposition,
              ),
          }),
          "Starting TITech Community Capital application bootstrap.",
        );

        /*
         * created → starting
         */
        bootstrapContext.start();

        if (
          bootstrapContext.state !==
          "starting"
        ) {
          throw new Error(
            `TITech BootstrapContext lifecycle contract violation: expected "starting" after start(), received "${bootstrapContext.state}".`,
          );
        }

        mirrorApplicationStarting();

        /*
         * ENVIRONMENT
         */
        bootstrapContext.setEnvironment(
          await runStartupPhase(
            "environment",
            bootstrapEnvironment,
          ),
        );

        /*
         * CONFIGURATION
         */
        bootstrapContext.setConfiguration(
          await runStartupPhase(
            "configuration",
            bootstrapConfiguration,
          ),
        );

        /*
         * LOGGER
         */
        bootstrapContext.setLogger(
          await runStartupPhase(
            "logger",
            bootstrapLogger,
          ),
        );

        logger =
          bootstrapContext.logger ||
          logger;

        /*
         * OBSERVABILITY
         */
        bootstrapContext.setObservability(
          await runStartupPhase(
            "observability",
            bootstrapObservability,
          ),
        );

        /*
         * READINESS
         */
        bootstrapContext.setReadiness(
          await runStartupPhase(
            "readiness",
            bootstrapReadiness,
          ),
        );

        /*
         * RESILIENCE
         */
        bootstrapContext.setResilience(
          await runStartupPhase(
            "resilience",
            bootstrapResilience,
          ),
        );

        /*
         * INFRASTRUCTURE
         */
        bootstrapContext.setInfrastructure(
          await runStartupPhase(
            "infrastructure",
            bootstrapInfrastructure,
          ),
        );

        /*
         * SERVICES
         */
        bootstrapContext.setServices(
          await runStartupPhase(
            "services",
            bootstrapServices,
          ),
        );

        /*
         * MIDDLEWARE
         */
        await runStartupPhase(
          "middleware",
          bootstrapMiddleware,
        );

        /*
         * ROUTES
         */
        await runStartupPhase(
          "routes",
          bootstrapRoutes,
        );

        /*
         * ERROR HANDLER
         */
        await bootstrapErrorHandler();

        /*
         * HTTP SERVER
         */
        await runStartupPhase(
          "httpServer",
          bootstrapHttpServer,
        );

        if (
          !bootstrapContext.httpServer
        ) {
          throw createPhaseStartupError(
            "httpServer",
            new Error(
              "TITech HTTP server phase completed without an HTTP server.",
            ),
            {
              operation:
                "validate-http-server",
            },
          );
        }

        /*
         * RUNTIME READY
         */
        await runStartupPhase(
          "runtimeReady",
          bootstrapRuntimeReady,
        );

        if (
          typeof bootstrapContext.validateRuntimeReady ===
          "function"
        ) {
          bootstrapContext.validateRuntimeReady();
        }

        /*
         * SHUTDOWN MANAGER
         */
        await initializeShutdownManager();

        /*
         * STARTED
         */
        mirrorApplicationStarted();

        /*
         * READY
         */
        await markApplicationReady();

        if (
          bootstrapContext.state !==
          "ready"
        ) {
          throw new Error(
            `TITech bootstrap lifecycle contract violation: expected "ready", received "${bootstrapContext.state}".`,
          );
        }

        startupCompleted =
          true;

        shutdownCompleted =
          false;

        safeLogInfo(
          createComponentMetadata({
            event:
              "application.bootstrap.completed",

            state:
              bootstrapContext.state,

            server:
              bootstrapContext.serverAddress,

            runtimeGeneration:
              activeRuntimeGeneration,

            operationId:
              activeStartupOperationId,

            durationMs:
              getDurationMs(
                startupStartedAt,
              ),
          }),
          "TITech Community Capital startup completed successfully.",
        );

        return {
          app,

          server:
            bootstrapContext.httpServer ||
            null,

          context:
            bootstrapContext,

          state:
            runtimeState.getApplicationState?.() ||
            null,

          runtimeGeneration:
            activeRuntimeGeneration,
        };
      } catch (error) {
        const normalized =
          normalizeStartupError(
            error,
            {
              phase:
                error?.phase ||
                bootstrapContext?.currentPhase ||
                "bootstrap",

              operation:
                error?.operation ||
                "application-startup",

              critical:
                true,

              fatal:
                true,

              preserveCauseStack:
                true,

              operationId:
                activeStartupOperationId,

              runtimeGeneration:
                activeRuntimeGeneration,

              durationMs:
                getDurationMs(
                  startupStartedAt,
                ),
            },
          );

        safeLogError(
          typeof normalized.toLogObject ===
            "function"
            ? normalized.toLogObject({
                includeStack:
                  true,

                includeCauseStack:
                  true,
              })
            : normalized,
          "TITech Community Capital startup failed.",
        );

        await cleanupFailedStartup(
          normalized,
        );

        throw normalized;
      } finally {
        startupInProgress =
          false;

        startupAbortController =
          null;
      }
    })();

  try {
    return await startupPromise;
  } finally {
    startupPromise =
      null;

    activeStartupOperationId =
      null;

    startupStartedAt =
      null;
  }
}

/* =============================================================================
 * SHUTDOWN APPLICATION
 * =============================================================================
 */

async function shutdownApplication({
  reason =
    "shutdown",

  exit =
    false,

  exitCode =
    0,

  skipProcessExit =
    false,
} = {}) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  if (
    shutdownCompleted &&
    !startupInProgress
  ) {
    if (
      exit &&
      !skipProcessExit
    ) {
      process.exit(
        exitCode,
      );
    }

    return {
      state:
        bootstrapContext?.state ||
        "stopped",

      alreadyStopped:
        true,

      runtimeGeneration:
        activeRuntimeGeneration,
    };
  }

  /*
   * Normal shutdown while startup is active is intentionally deferred.
   *
   * Startup failure cleanup uses cleanupFailedStartup() instead.
   */
  if (
    startupInProgress &&
    startupPromise
  ) {
    requestStartupInterruption(
      reason,
    );

    safeLogWarn(
      createComponentMetadata({
        event:
          "shutdown.deferred_until_startup_exit",

        reason,

        operationId:
          activeStartupOperationId,

        runtimeGeneration:
          activeRuntimeGeneration,
      }),
      "TITech shutdown requested while startup is active; shutdown has been deferred until startup exits.",
    );

    return {
      deferred:
        true,

      reason,

      state:
        bootstrapContext?.state ||
        null,

      operationId:
        activeStartupOperationId,

      runtimeGeneration:
        activeRuntimeGeneration,
    };
  }

  shutdownRequested =
    true;

  shutdownInProgress =
    true;

  shutdownStartedAt =
    process.hrtime.bigint();

  activeShutdownOperationId =
    createOperationId(
      "shutdown",
    );

  shutdownPromise =
    performShutdown({
      reason,

      exit,

      exitCode,

      skipProcessExit,
    });

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise =
      null;

    shutdownInProgress =
      false;

    activeShutdownOperationId =
      null;

    shutdownStartedAt =
      null;

    activeRouteComposition =
      null;
  }
}

/* =============================================================================
 * SIGNAL HANDLERS
 * =============================================================================
 */

function installSignalHandlers() {
  if (
    signalHandlersInstalled
  ) {
    return false;
  }

  signalHandlersInstalled =
    true;

  const handleSignal =
    (signal) =>
    async () => {
      safeLogInfo(
        createComponentMetadata({
          event:
            "signal.received",

          signal,
        }),
        `TITech process received ${signal}.`,
      );

      try {
        const result =
          await shutdownApplication({
            reason:
              `signal:${signal}`,

            exit:
              true,

            exitCode:
              0,
          });

        if (
          result?.deferred
        ) {
          const pendingStartup =
            startupPromise;

          if (
            pendingStartup
          ) {
            try {
              await pendingStartup;
            } catch {
              // Startup failure is already normalized and logged.
            }
          }

          if (
            !shutdownCompleted
          ) {
            await shutdownApplication({
              reason:
                `signal:${signal}:post-startup`,

              exit:
                true,

              exitCode:
                0,
            });
          } else {
            process.exit(0);
          }
        }
      } catch (error) {
        safeLogError(
          createComponentMetadata({
            event:
              "signal.shutdown.failed",

            signal,

            name:
              error?.name,

            code:
              error?.code,

            message:
              error?.message,
          }),
          "TITech signal shutdown failed.",
        );

        process.exitCode =
          1;
      }
    };

  process.once(
    "SIGINT",
    handleSignal(
      "SIGINT",
    ),
  );

  process.once(
    "SIGTERM",
    handleSignal(
      "SIGTERM",
    ),
  );

  if (
    process.platform !==
    "win32"
  ) {
    process.once(
      "SIGQUIT",
      handleSignal(
        "SIGQUIT",
      ),
    );
  }

  return true;
}

/* =============================================================================
 * FATAL PROCESS ERRORS
 * =============================================================================
 */

async function handleFatalProcessError(
  type,
  reason,
) {
  /*
   * Multiple fatal events converge on one shutdown promise.
   */
  if (fatalShutdownPromise) {
    return fatalShutdownPromise;
  }

  fatalShutdownPromise =
    (async () => {
      const error =
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason ===
                "string"
                ? reason
                : `TITech ${type}.`,
            );

      const normalized =
        startupErrors.runtimeError(
          `TITech process encountered ${type}.`,
          {
            cause:
              error,

            critical:
              true,

            fatal:
              true,

            retryable:
              false,
          },
        );

      safeLogFatal(
        typeof normalized.toLogObject ===
          "function"
          ? normalized.toLogObject({
              includeStack:
                true,

              includeCauseStack:
                true,
            })
          : normalized,
        `TITech ${type}.`,
      );

      try {
        const result =
          await shutdownApplication({
            reason:
              type,

            exit:
              true,

            exitCode:
              1,
          });

        if (
          result?.deferred
        ) {
          const pendingStartup =
            startupPromise;

          if (
            pendingStartup
          ) {
            try {
              await pendingStartup;
            } catch {
              // Already logged.
            }
          }

          if (
            !shutdownCompleted
          ) {
            await shutdownApplication({
              reason:
                `${type}:post-startup`,

              exit:
                true,

              exitCode:
                1,
            });
          }
        }
      } catch (shutdownError) {
        safeLogFatal(
          createComponentMetadata({
            event:
              "fatal.shutdown.failed",

            type,

            message:
              shutdownError?.message,
          }),
          "TITech fatal-error shutdown failed.",
        );

        process.exitCode =
          1;
      }
    })();

  return fatalShutdownPromise;
}

function installFatalErrorHandlers() {
  if (
    fatalHandlersInstalled
  ) {
    return false;
  }

  fatalHandlersInstalled =
    true;

  process.once(
    "uncaughtException",
    (error) => {
      void handleFatalProcessError(
        "uncaughtException",
        error,
      );
    },
  );

  process.once(
    "unhandledRejection",
    (reason) => {
      void handleFatalProcessError(
        "unhandledRejection",
        reason,
      );
    },
  );

  return true;
}

/* =============================================================================
 * RUNTIME READINESS
 * =============================================================================
 */

function isRuntimeReady() {
  return (
    bootstrapContext?.state ===
    "ready"
  );
}

/* =============================================================================
 * HEALTH
 * =============================================================================
 */

async function getHealthState() {
  try {
    if (
      typeof readinessBootstrap?.health ===
      "function"
    ) {
      return await readinessBootstrap.health();
    }

    if (
      typeof observabilityBootstrap?.health ===
      "function"
    ) {
      return await observabilityBootstrap.health();
    }

    return {
      status:
        isRuntimeReady()
          ? "healthy"
          : "not_ready",

      ready:
        isRuntimeReady(),

      application:
        getApplicationName(),

      service:
        getServiceName(),

      version:
        getApplicationVersion(),

      runtimeGeneration:
        activeRuntimeGeneration,

      bootstrapState:
        bootstrapContext?.state ||
        null,

      currentPhase:
        bootstrapContext?.currentPhase ||
        null,

      startupInProgress,

      shutdownInProgress,
    };
  } catch (error) {
    return {
      status:
        "unhealthy",

      ready:
        false,

      application:
        getApplicationName(),

      service:
        getServiceName(),

      version:
        getApplicationVersion(),

      runtimeGeneration:
        activeRuntimeGeneration,

      bootstrapState:
        bootstrapContext?.state ||
        null,

      currentPhase:
        bootstrapContext?.currentPhase ||
        null,

      startupInProgress,

      shutdownInProgress,

      error: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
    };
  }
}

/* =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

function getBootstrapState() {
  return {
    startupCompleted,

    shutdownCompleted,

    startupInProgress,

    shutdownInProgress,

    shutdownRequested,

    startupFailureHandled,

    ready:
      isRuntimeReady(),

    runtimeGeneration:
      activeRuntimeGeneration,

    operationSequence,

    activeStartupOperationId,

    activeShutdownOperationId,

    canonical: {
      state:
        bootstrapContext?.state ||
        null,

      currentPhase:
        bootstrapContext?.currentPhase ||
        null,

      context:
        bootstrapContext ||
        null,

      diagnostics:
        typeof bootstrapContext?.getDiagnostics ===
          "function"
          ? bootstrapContext.getDiagnostics()
          : null,
    },

    runtime:
      runtimeState.getApplicationState?.() ||
      null,

    health:
      runtimeState.getHealthState?.() ||
      null,
  };
}

function getLifecycleSnapshot() {
  return Object.freeze({
    service:
      getServiceName(),

    application:
      getApplicationName(),

    version:
      getApplicationVersion(),

    environment:
      getEnvironmentName(),

    state:
      bootstrapContext?.state ||
      null,

    currentPhase:
      bootstrapContext?.currentPhase ||
      null,

    ready:
      isRuntimeReady(),

    startupCompleted,

    shutdownCompleted,

    startupInProgress,

    shutdownInProgress,

    shutdownRequested,

    startupFailureHandled,

    runtimeGeneration:
      activeRuntimeGeneration,

    startupOperationId:
      activeStartupOperationId,

    shutdownOperationId:
      activeShutdownOperationId,

    serverAddress:
      bootstrapContext?.serverAddress ||
      null,

    routeCompositionProvided:
      Boolean(
        activeRouteComposition,
      ),

    uptimeSeconds:
      process.uptime(),
  });
}

/* =============================================================================
 * PROMISE ACCESSORS
 * =============================================================================
 */

function getStartupPromise() {
  return startupPromise;
}

function getShutdownPromise() {
  return shutdownPromise;
}

/* =============================================================================
 * COMPOSITION VALIDATION
 * =============================================================================
 */

function validateBootstrapComposition() {
  if (!BootstrapContext) {
    throw new Error(
      "TITech BootstrapContext implementation is unavailable.",
    );
  }

  if (
    !Array.isArray(
      BOOTSTRAP_PHASES,
    ) ||
    BOOTSTRAP_PHASES.length ===
      0
  ) {
    throw new Error(
      "TITech BootstrapContext phase registry is invalid.",
    );
  }

  if (
    SERVICE_METADATA.nodeMajor <
    20
  ) {
    throw new Error(
      `TITech Community Capital requires Node.js 20+; detected Node.js ${process.versions.node}.`,
    );
  }

  const requiredPhases = [
    "environment",
    "configuration",
    "logger",
    "observability",
    "readiness",
    "resilience",
    "infrastructure",
    "services",
    "middleware",
    "routes",
    "httpServer",
    "runtimeReady",
  ];

  for (
    const phase of requiredPhases
  ) {
    if (
      !BOOTSTRAP_PHASES.includes(
        phase,
      )
    ) {
      throw new Error(
        `TITech BootstrapContext is missing canonical phase "${phase}".`,
      );
    }
  }

  const requiredModules = [
    {
      name:
        "observability",

      value:
        observabilityBootstrap,

      options:
        {},

      required:
        true,
    },

    {
      name:
        "resilience",

      value:
        resilienceBootstrap,

      options:
        {},

      required:
        true,
    },

    {
      name:
        "infrastructure",

      value:
        infrastructureBootstrap,

      options: {
        includeRegister:
          true,
      },

      required:
        true,
    },

    {
      name:
        "services",

      value:
        servicesBootstrap,

      options:
        {},

      required:
        true,
    },

    {
      name:
        "middleware",

      value:
        middlewareBootstrap,

      options: {
        includeRegister:
          true,
      },

      required:
        true,
    },

    {
      name:
        "routes",

      value:
        routesBootstrap,

      options: {
        includeMount:
          true,

        includeRegister:
          true,
      },

      required:
        true,
    },

    {
      name:
        "httpServer",

      value:
        serverBootstrap,

      options:
        {},

      required:
        true,
    },
  ];

  for (
    const moduleDefinition of
      requiredModules
  ) {
    const initializer =
      resolveBootstrapInitializer(
        moduleDefinition.value,
        moduleDefinition.options,
      );

    if (
      moduleDefinition.required &&
      typeof initializer !==
        "function"
    ) {
      throw new Error(
        `TITech ${moduleDefinition.name} bootstrap initializer is unavailable.`,
      );
    }
  }

  if (
    typeof app?.use !==
    "function"
  ) {
    throw new Error(
      "TITech application composition root requires an Express-compatible app.use() implementation.",
    );
  }

  const errorHandler =
    typeof errorHandlerModule ===
      "function"
      ? errorHandlerModule
      : errorHandlerModule?.errorHandler ||
        errorHandlerModule?.default;

  if (
    typeof errorHandler !==
    "function"
  ) {
    throw new Error(
      "TITech centralized error handler must export a callable middleware function.",
    );
  }

  if (
    configuration &&
    configuration.__requiresImmutable ===
      true &&
    !Object.isFrozen(
      configuration,
    )
  ) {
    throw new Error(
      "TITech application configuration is required to be immutable but is not frozen.",
    );
  }

  return true;
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

const publicApi = {
  app,

  configuration,

  metadata:
    SERVICE_METADATA,

  getLogger,

  getServiceName,

  getApplicationName,

  getApplicationLegalName,

  getApplicationVersion,

  getEnvironmentName,

  getBootstrapContext,

  startApplication,

  shutdownApplication,

  installSignalHandlers,

  installFatalErrorHandlers,

  bootstrapEnvironment,

  bootstrapConfiguration,

  bootstrapLogger,

  bootstrapObservability,

  bootstrapReadiness,

  bootstrapResilience,

  bootstrapInfrastructure,

  bootstrapServices,

  bootstrapMiddleware,

  bootstrapRoutes,

  bootstrapErrorHandler,

  bootstrapHttpServer,

  bootstrapRuntimeReady,

  markApplicationReady,

  createBootstrapContext,

  runStartupPhase,

  normalizeStartupError,

  normalizeStartupInput,

  createPhaseStartupError,

  resolveBootstrapInitializer,

  validateBootstrapComposition,

  getBootstrapState,

  getLifecycleSnapshot,

  getStartupPromise,

  getShutdownPromise,

  getRuntimeState:
    runtimeState.getApplicationState,

  getHealthState,

  isRuntimeReady,

  BOOTSTRAP_PHASES,

  BootstrapContext,
};

module.exports =
  Object.freeze(
    publicApi,
  );

/* =============================================================================
 * DIRECT EXECUTION
 * =============================================================================
 */

if (
  require.main === module
) {
  try {
    validateBootstrapComposition();
  } catch (
    compositionError
  ) {
    safeLogFatal(
      createComponentMetadata({
        event:
          "bootstrap.composition.invalid",

        name:
          compositionError?.name,

        code:
          compositionError?.code,

        message:
          compositionError?.message,

        stack:
          compositionError?.stack,
      }),
      "TITech bootstrap composition validation failed.",
    );

    process.exitCode =
      1;
  }

  if (
    process.exitCode !==
    1
  ) {
    installSignalHandlers();

    installFatalErrorHandlers();

    startApplication().catch(
      (error) => {
        const normalized =
          normalizeStartupError(
            error,
            {
              phase:
                error?.phase ||
                "bootstrap",

              fatal:
                true,

              preserveCauseStack:
                true,
            },
          );

        safeLogFatal(
          typeof normalized.toLogObject ===
            "function"
            ? normalized.toLogObject({
                includeStack:
                  true,

                includeCauseStack:
                  true,
              })
            : normalized,
          "TITech application failed to start.",
        );

        process.exitCode =
          1;
      },
    );
  }
}