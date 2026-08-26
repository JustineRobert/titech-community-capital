"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
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
 * Canonical lifecycle authority:
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
   ↓
starting
   ↓
environment
   ↓
configuration
   ↓
logger
   ↓
observability
   ↓
readiness
   ↓
resilience
   ↓
infrastructure
   ↓
services
   ↓
middleware
   ↓
routes
   ↓
httpServer
   ↓
runtimeReady
   ↓
ready
 *
 * Failure:
 *
 *   phase
 *      ↓
 *   failed
 *      ↓
 *   shutting_down
 *      ↓
 *   stopped
 *
 * IMPORTANT
 * =============================================================================
 *
 * BootstrapContext is authoritative.
 *
 * runtime/state.js is NEVER assigned to context.state and is NEVER used as
 * the canonical lifecycle authority.
 *
 * All startup phases receive the same BootstrapContext instance.
 *
 * =============================================================================
 */

const app = require("../app");
const configuration = require("../config");
const runtimeState = require("../runtime/state");

/* =============================================================================
 * CANONICAL CONTEXT
 * =============================================================================
 */

const {
  BootstrapContext,
  createBootstrapContext: createCanonicalBootstrapContext,
  BOOTSTRAP_PHASES,
} = require("./context/BootstrapContext");

/* =============================================================================
 * BOOTSTRAP MODULES
 * =============================================================================
 */

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
 * MODULE RUNTIME STATE
 * =============================================================================
 */

let logger = null;

let bootstrapContext = null;

let startupPromise = null;
let shutdownPromise = null;

let startupCompleted = false;
let shutdownCompleted = false;

let shutdownRequested = false;
let startupFailureHandled = false;

let signalHandlersInstalled = false;
let fatalHandlersInstalled = false;

let errorHandlerRegistered = false;
let shutdownManagerInitialized = false;

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

  nodeMajor: Number(
    String(process.versions.node).split(".")[0],
  ),
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
    component: "bootstrap/app",
    service: getServiceName(),
    application: getApplicationName(),
    applicationLegalName: getApplicationLegalName(),
    version: getApplicationVersion(),
    environment: getEnvironmentName(),
    ...extra,
  };
}

/* =============================================================================
 * EMERGENCY LOGGER
 * =============================================================================
 */

function createConsoleLogger() {
  return Object.freeze({
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    debug: (...args) => console.debug(...args),
    trace: (...args) => console.trace(...args),
    fatal: (...args) => console.error(...args),
  });
}

/* =============================================================================
 * LOGGER RESOLUTION
 * =============================================================================
 */

function resolveLogger() {
  const fallback = createConsoleLogger();

  try {
    if (
      loggerBootstrap &&
      typeof loggerBootstrap.getLogger === "function"
    ) {
      const resolved = loggerBootstrap.getLogger();

      if (
        resolved &&
        typeof resolved.info === "function"
      ) {
        return resolved;
      }
    }

    if (
      loggerBootstrap?.logger &&
      typeof loggerBootstrap.logger.info === "function"
    ) {
      return loggerBootstrap.logger;
    }

    if (
      loggerBootstrap &&
      typeof loggerBootstrap.info === "function"
    ) {
      return loggerBootstrap;
    }

    if (
      loggerBootstrap?.default &&
      typeof loggerBootstrap.default.info === "function"
    ) {
      return loggerBootstrap.default;
    }
  } catch {
    // Logger resolution must never break bootstrap.
  }

  return fallback;
}

logger = resolveLogger();

/* =============================================================================
 * SAFE LOGGING
 * =============================================================================
 */

function safeLog(level, metadata = {}, message) {
  const fallback = createConsoleLogger();

  try {
    const activeLogger =
      logger &&
        typeof logger[level] === "function"
        ? logger
        : fallback;

    if (message !== undefined) {
      activeLogger[level](metadata, message);
    } else {
      activeLogger[level](metadata);
    }
  } catch {
    try {
      if (message !== undefined) {
        fallback[level](metadata, message);
      } else {
        fallback[level](metadata);
      }
    } catch {
      // Logging is never allowed to break lifecycle handling.
    }
  }
}

function safeLogInfo(metadata, message) {
  safeLog("info", metadata, message);
}

function safeLogWarn(metadata, message) {
  safeLog("warn", metadata, message);
}

function safeLogError(metadata, message) {
  safeLog("error", metadata, message);
}

function safeLogDebug(metadata, message) {
  safeLog("debug", metadata, message);
}

function safeLogFatal(metadata, message) {
  safeLog("fatal", metadata, message);
}

/* =============================================================================
 * INITIALIZER RESOLUTION
 * =============================================================================
 *
 * Supported module contracts:
 *
 *   module.exports = fn
 *
 *   module.exports = {
 *     initialize: fn
 *   }
 *
 *   module.exports = {
 *     bootstrap: fn
 *   }
 *
 *   module.exports = {
 *     start: fn
 *   }
 *
 *   module.exports = {
 *     load: fn
 *   }
 *
 *   module.exports = {
 *     mount: fn
 *   }
 *
 *   module.exports = {
 *     register: fn
 *   }
 *
 *   module.exports = {
 *     registerMiddleware: fn
 *   }
 *
 *   module.exports = {
 *     registerRoutes: fn
 *   }
 *
 *   module.exports = {
 *     default: fn
 *   }
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

  if (typeof moduleValue === "function") {
    return moduleValue;
  }

  if (!moduleValue || typeof moduleValue !== "object") {
    return null;
  }

  const candidates = [
    moduleValue.initialize,
    moduleValue.bootstrap,
    moduleValue.start,
  ];

  if (includeLoad) {
    candidates.push(moduleValue.load);
  }

  if (includeMount) {
    candidates.push(moduleValue.mount);
  }

  if (includeRegister) {
    candidates.push(
      moduleValue.register,
      moduleValue.registerMiddleware,
      moduleValue.registerRoutes,
    );
  }

  candidates.push(moduleValue.default);

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
  }

  /*
   * Handle transpiled/default object exports safely.
   */
  if (
    moduleValue.default &&
    typeof moduleValue.default === "object" &&
    moduleValue.default !== moduleValue
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

function resolveModuleValue(moduleValue, names = []) {
  if (!moduleValue) {
    return null;
  }

  for (const name of names) {
    try {
      const value = moduleValue[name];

      if (typeof value === "function") {
        return value();
      }

      if (value !== undefined) {
        return value;
      }
    } catch {
      // Continue with the next accessor.
    }
  }

  return null;
}

/* =============================================================================
 * CONTEXT VALIDATION
 * =============================================================================
 */

function getCanonicalContextState(context) {
  if (!context) {
    return null;
  }

  if (typeof context.state !== "string") {
    throw new TypeError(
      "Invalid TITech BootstrapContext contract: context.state must be a lifecycle-state string.",
    );
  }

  return context.state;
}

function assertCanonicalBootstrapContext(context) {
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

  for (const method of requiredMethods) {
    if (typeof context[method] !== "function") {
      throw new TypeError(
        `TITech BootstrapContext lifecycle contract is missing "${method}()".`,
      );
    }
  }

  getCanonicalContextState(context);

  return true;
}

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeStartupInput(error, options = {}) {
  if (error instanceof BootstrapContext) {
    const state = getCanonicalContextState(error);

    const contextError = new Error(
      `TITech BootstrapContext was supplied as an error value while lifecycle state is "${state}".`,
    );

    contextError.name = "BootstrapContextStateError";
    contextError.code = "STARTUP_INVALID_CONTEXT";
    contextError.phase = options.phase || "lifecycle";
    contextError.contextState = state;

    return contextError;
  }

  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === "object") {
    const normalized = new Error(
      error.message ||
      "TITech bootstrap operation failed.",
    );

    normalized.name =
      error.name || "BootstrapError";

    if (error.code) {
      normalized.code = error.code;
    }

    if (error.cause) {
      normalized.cause = error.cause;
    }

    if (error.phase) {
      normalized.phase = error.phase;
    }

    if (error.operation) {
      normalized.operation = error.operation;
    }

    return normalized;
  }

  return new Error(
    typeof error === "string"
      ? error
      : "TITech bootstrap operation failed.",
  );
}

function normalizeStartupError(
  error,
  options = {},
) {
  const safeInput =
    normalizeStartupInput(error, options);

  if (
    startupErrors?.isStartupError?.(safeInput) &&
    Object.keys(options).length === 0
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
        options.preserveCauseStack !== false,

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
    normalizeStartupInput(error, {
      ...options,
      phase,
    });

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
        options.preserveCauseStack !== false,

      durationMs:
        options.durationMs,

      ...options,
    },
  );
}

/* =============================================================================
 * CANONICAL BOOTSTRAP CONTEXT
 * =============================================================================
 */

function createBootstrapContext() {
  const context =
    createCanonicalBootstrapContext({
      application: app,
      configuration,
      logger,

      metadata:
        createComponentMetadata({
          component: "bootstrap",
          source: "backend/bootstrap/app.js",
        }),
    });

  assertCanonicalBootstrapContext(context);

  if (!context.container) {
    context.container = {};
  }

  return context;
}

function getBootstrapContext() {
  return bootstrapContext;
}

/* =============================================================================
 * RUNTIME COMPATIBILITY PROJECTION
 * =============================================================================
 *
 * IMPORTANT:
 *
 * This section intentionally does NOT control lifecycle.
 * It only mirrors canonical state for legacy/read-model consumers.
 * =============================================================================
 */

const RUNTIME_SERVICE_MAP = Object.freeze({
  logger: "logger",
  observability: "observability",
  resilience: "resilience",
  infrastructure: "database",
  middleware: "middleware",
  routes: "routes",
  httpServer: "server",
});

function mirrorServiceState(
  canonicalPhase,
  state,
) {
  const runtimeService =
    RUNTIME_SERVICE_MAP[canonicalPhase];

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
        phase: canonicalPhase,
        runtimeService,
        state,
        message: error?.message,
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
        message: error?.message,
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
        message: error?.message,
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
        message: error?.message,
      }),
      "TITech runtime compatibility ready-state update failed.",
    );
  }
}

function mirrorApplicationFailed(error) {
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
        message: stateError?.message,
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
        message: error?.message,
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
        message: error?.message,
      }),
      "TITech runtime compatibility stopped-state update failed.",
    );
  }
}

/* =============================================================================
 * ENVIRONMENT
 * =============================================================================
 */

async function bootstrapEnvironment() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        environmentBootstrap,
        {
          includeLoad: true,
        },
      );

    if (initializer) {
      const result =
        await initializer(
          bootstrapContext,
        );

      if (
        result &&
        typeof result === "object"
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

/* =============================================================================
 * CONFIGURATION
 * =============================================================================
 */

async function bootstrapConfiguration() {
  try {
    if (!configuration) {
      throw new Error(
        "TITech application configuration is unavailable.",
      );
    }

    if (
      configuration.__requiresImmutable === true &&
      !Object.isFrozen(configuration)
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

/* =============================================================================
 * LOGGER
 * =============================================================================
 */

async function bootstrapLogger() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        loggerBootstrap,
        {
          includeLoad: true,
          includeRegister: true,
        },
      );

    if (initializer) {
      const initialized =
        await initializer({
          context: bootstrapContext,
          configuration,
          service: getServiceName(),
          application: getApplicationName(),
          version: getApplicationVersion(),
        });

      if (
        initialized &&
        typeof initialized.info ===
        "function"
      ) {
        logger = initialized;
      }
    }

    const refreshed = resolveLogger();

    if (
      refreshed &&
      typeof refreshed.info ===
      "function"
    ) {
      logger = refreshed;
    }

    if (
      !logger ||
      typeof logger.info !== "function"
    ) {
      throw new Error(
        "TITech application logger is unavailable after initialization.",
      );
    }

    bootstrapContext.setLogger(logger);

    safeLogInfo(
      createComponentMetadata({
        phase: "logger",
        event: "logger.ready",
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

/* =============================================================================
 * OBSERVABILITY
 * =============================================================================
 */

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
      context: bootstrapContext,
      configuration,
      logger,
      service: getServiceName(),
      application: getApplicationName(),
      version: getApplicationVersion(),
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

/* =============================================================================
 * READINESS
 * =============================================================================
 */

async function bootstrapReadiness() {
  try {
    const options = {
      source: "bootstrap/app",
      context: bootstrapContext,
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
        allowRecovery: true,
        context: bootstrapContext,
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

/* =============================================================================
 * RESILIENCE
 * =============================================================================
 */

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

/* =============================================================================
 * INFRASTRUCTURE
 * =============================================================================
 */

async function bootstrapInfrastructure() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        infrastructureBootstrap,
        {
          includeRegister: true,
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
      typeof result === "object" &&
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

/* =============================================================================
 * SERVICES
 * =============================================================================
 */

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
      ) || resolvedServices;

    bootstrapContext.serviceRegistry =
      serviceRegistry;

    /*
     * Construct exactly one root services context.
     *
     * Do not blindly construct a second context and replace the first one.
     * A child context is created only when the module explicitly exposes
     * createServicesContext().
     */
    if (
      typeof servicesContextBootstrap?.createRootContext ===
      "function"
    ) {
      const rootContext =
        servicesContextBootstrap.createRootContext({
          config: configuration,
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
        bootstrapContext.servicesContext =
          rootContext;

        bootstrapContext.serviceContext =
          rootContext;
      }
    }

    if (
      typeof servicesContextBootstrap?.createServicesContext ===
      "function" &&
      bootstrapContext.servicesContext
    ) {
      const childContext =
        servicesContextBootstrap.createServicesContext({
          parent:
            bootstrapContext.servicesContext,
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

/* =============================================================================
 * MIDDLEWARE
 * =============================================================================
 */

async function bootstrapMiddleware() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        middlewareBootstrap,
        {
          includeRegister: true,
        },
      );

    if (!initializer) {
      throw new Error(
        "TITech middleware bootstrap initializer is unavailable.",
      );
    }

    /*
     * Canonical middleware contract:
     *
     *   middleware(app, context)
     *
     * Context-only compatibility is supported explicitly rather than guessed.
     */
    let result;

    if (
      middlewareBootstrap?.acceptsContextOnly ===
      true
    ) {
      result =
        await initializer(
          bootstrapContext,
        );
    } else {
      result =
        await initializer(
          app,
          bootstrapContext,
        );
    }

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

/* =============================================================================
 * ROUTES
 * =============================================================================
 */

async function bootstrapRoutes() {
  try {
    const initializer =
      resolveBootstrapInitializer(
        routesBootstrap,
        {
          includeMount: true,
          includeRegister: true,
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
          requireReadiness: false,
        },
      );

    const router =
      result ||
      routesBootstrap?.router ||
      routesBootstrap;

    bootstrapContext.setRoutes(router);

    safeLogInfo(
      createComponentMetadata({
        event: "routes.registered",
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
 * CENTRALIZED ERROR HANDLER
 * =============================================================================
 *
 * Ordering:
 *
 *   middleware
 *      ↓
 *   routes
 *      ↓
 *   centralized error handler
 *      ↓
 *   HTTP server
 *
 * This is intentionally NOT a BootstrapContext phase.
 * =============================================================================
 */

async function bootstrapErrorHandler() {
  if (errorHandlerRegistered) {
    return app;
  }

  try {
    const errorHandler =
      typeof errorHandlerModule === "function"
        ? errorHandlerModule
        : errorHandlerModule?.errorHandler ||
        errorHandlerModule?.default;

    if (typeof errorHandler !== "function") {
      throw new TypeError(
        "TITech centralized error handler must export a callable middleware function.",
      );
    }

    app.use(errorHandler);

    errorHandlerRegistered = true;

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
      context: bootstrapContext,

      configuration,
      config: configuration,

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
    };

    const result =
      await initializer(
        serverContext,
        {
          requireReadiness: true,
          requireHttpServer: false,
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

/* =============================================================================
 * RUNTIME READY
 * =============================================================================
 */

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
        allowRecovery: true,
        context: bootstrapContext,
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
        source: "bootstrap/app",
        context: bootstrapContext,
      });
    }

    bootstrapContext.markReady();

    mirrorApplicationReady();

    safeLogInfo(
      createComponentMetadata({
        event: "application.ready",
        state: bootstrapContext.state,
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

function normalizePhaseName(phase) {
  const normalized = String(phase || "").trim();

  if (
    !BOOTSTRAP_PHASES.includes(normalized)
  ) {
    const error = new Error(
      `Unknown TITech bootstrap phase "${phase}". Expected one of: ${BOOTSTRAP_PHASES.join(
        ", ",
      )}`,
    );

    error.code = "BOOTSTRAP_UNKNOWN_PHASE";
    error.phase = normalized || "bootstrap";

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
      normalizePhaseName(phase);
  } catch (error) {
    throw normalizeStartupError(
      error,
      {
        phase: "bootstrap",
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
        phase: canonicalPhase,
        operation:
          `bootstrap-${canonicalPhase}`,
      },
    );
  }

  assertCanonicalBootstrapContext(
    bootstrapContext,
  );

  const startedAt =
    process.hrtime.bigint();

  try {
    bootstrapContext.startPhase(
      canonicalPhase,
      {
        phase: canonicalPhase,
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
    const result =
      await execute(
        bootstrapContext,
      );

    const durationMs =
      Number(
        process.hrtime.bigint() -
        startedAt,
      ) / 1_000_000;

    /*
     * Canonical lifecycle transition occurs BEFORE compatibility projection.
     */
    bootstrapContext.completePhase(
      canonicalPhase,
      {
        durationMs,
      },
    );

    mirrorServiceState(
      canonicalPhase,
      "ready",
    );

    safeLogDebug(
      createComponentMetadata({
        event: "phase.completed",
        phase: canonicalPhase,
        durationMs,
        canonicalState:
          bootstrapContext.state,
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
        },
      );

    try {
      bootstrapContext.failPhase(
        canonicalPhase,
        normalized,
        {
          durationMs,
        },
      );
    } catch (contextError) {
      safeLogWarn(
        createComponentMetadata({
          event:
            "phase.failure_recording_failed",
          phase: canonicalPhase,
          message:
            contextError?.message,
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
  if (shutdownManagerInitialized) {
    return;
  }

  if (!shutdownManagerBootstrap) {
    shutdownManagerInitialized = true;
    return;
  }

  if (
    typeof shutdownManagerBootstrap.initialize ===
    "function"
  ) {
    await shutdownManagerBootstrap.initialize({
      context: bootstrapContext,
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

  shutdownManagerInitialized = true;
}

/* =============================================================================
 * SHUTDOWN HOOK EXECUTION
 * =============================================================================
 */

async function executeShutdownHooks(reason) {
  if (
    typeof shutdownBootstrap?.shutdown ===
    "function"
  ) {
    await shutdownBootstrap.shutdown(
      reason,
      {
        signal: String(reason).startsWith(
          "signal:",
        )
          ? String(reason).slice(
            "signal:".length,
          )
          : undefined,

        context: bootstrapContext,
        app,
      },
    );

    return;
  }

  if (
    typeof shutdownBootstrap
      ?.shutdownCoordinator
      ?.request === "function"
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

function transitionContextToShutdown(reason) {
  if (!bootstrapContext) {
    return;
  }

  try {
    const state =
      bootstrapContext.state;

    if (
      state === "stopped" ||
      state === "shutting_down"
    ) {
      return;
    }

    bootstrapContext.beginShutdown(
      reason,
    );
  } catch (error) {
    safeLogWarn(
      createComponentMetadata({
        event:
          "bootstrap_context_shutdown_transition_failed",
        reason,
        state:
          bootstrapContext?.state,
        message:
          error?.message,
      }),
      "TITech BootstrapContext shutdown transition failed.",
    );
  }
}

/* =============================================================================
 * START APPLICATION
 * =============================================================================
 */

async function startApplication() {
  /*
   * Startup is single-flight.
   */
  if (startupPromise) {
    return startupPromise;
  }

  /*
   * Already ready.
   */
  if (
    startupCompleted &&
    bootstrapContext?.state === "ready"
  ) {
    return {
      app,
      server:
        bootstrapContext.httpServer ||
        null,
      context: bootstrapContext,
      state:
        runtimeState.getApplicationState?.(),
    };
  }

  /*
   * A runtime must not silently restart while a shutdown is in progress.
   */
  if (shutdownPromise) {
    throw new Error(
      "TITech application shutdown is currently in progress; startup cannot begin concurrently.",
    );
  }

  startupPromise = (async () => {
    bootstrapContext =
      createBootstrapContext();

    startupCompleted = false;
    shutdownCompleted = false;
    shutdownRequested = false;
    startupFailureHandled = false;
    errorHandlerRegistered = false;
    shutdownManagerInitialized = false;

    try {
      safeLogInfo(
        createComponentMetadata({
          event:
            "application.bootstrap.started",
          state:
            bootstrapContext.state,
          runtimeGeneration:
            bootstrapContext.runtimeGeneration ||
            undefined,
        }),
        "Starting TITech Community Capital application bootstrap.",
      );

      /**
 * created → starting
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * `starting` is the canonical BootstrapContext lifecycle state.
 *
 * Do NOT use `bootstrapping` here. That was an obsolete lifecycle name and
 * conflicts with the canonical BootstrapContext implementation.
 */
      bootstrapContext.start();

      const startupLifecycleState =
        typeof bootstrapContext.getState === "function"
          ? bootstrapContext.getState()
          : bootstrapContext.state;

      if (
        startupLifecycleState !==
        "starting"
      ) {
        throw new Error(
          `TITech BootstrapContext lifecycle contract violation: ` +
          `expected "starting" state after start(), ` +
          `received "${startupLifecycleState}".`,
        );
      }
      mirrorApplicationStarting();

      /* ---------------------------------------------------------------------
       * ENVIRONMENT
       * ------------------------------------------------------------------- */

      bootstrapContext.setEnvironment(
        await runStartupPhase(
          "environment",
          bootstrapEnvironment,
        ),
      );

      /* ---------------------------------------------------------------------
       * CONFIGURATION
       * ------------------------------------------------------------------- */

      bootstrapContext.setConfiguration(
        await runStartupPhase(
          "configuration",
          bootstrapConfiguration,
        ),
      );

      /* ---------------------------------------------------------------------
       * LOGGER
       * ------------------------------------------------------------------- */

      bootstrapContext.setLogger(
        await runStartupPhase(
          "logger",
          bootstrapLogger,
        ),
      );

      logger =
        bootstrapContext.logger ||
        logger;

      /* ---------------------------------------------------------------------
       * OBSERVABILITY
       * ------------------------------------------------------------------- */

      bootstrapContext.setObservability(
        await runStartupPhase(
          "observability",
          bootstrapObservability,
        ),
      );

      /* ---------------------------------------------------------------------
       * READINESS
       * ------------------------------------------------------------------- */

      bootstrapContext.setReadiness(
        await runStartupPhase(
          "readiness",
          bootstrapReadiness,
        ),
      );

      /* ---------------------------------------------------------------------
       * RESILIENCE
       * ------------------------------------------------------------------- */

      bootstrapContext.setResilience(
        await runStartupPhase(
          "resilience",
          bootstrapResilience,
        ),
      );

      /* ---------------------------------------------------------------------
       * INFRASTRUCTURE
       * ------------------------------------------------------------------- */

      bootstrapContext.setInfrastructure(
        await runStartupPhase(
          "infrastructure",
          bootstrapInfrastructure,
        ),
      );

      /* ---------------------------------------------------------------------
       * SERVICES
       * ------------------------------------------------------------------- */

      bootstrapContext.setServices(
        await runStartupPhase(
          "services",
          bootstrapServices,
        ),
      );

      /* ---------------------------------------------------------------------
       * MIDDLEWARE
       * ------------------------------------------------------------------- */

      await runStartupPhase(
        "middleware",
        bootstrapMiddleware,
      );

      /* ---------------------------------------------------------------------
       * ROUTES
       * ------------------------------------------------------------------- */

      await runStartupPhase(
        "routes",
        bootstrapRoutes,
      );

      /*
       * Error handler MUST be after routes and before the server begins
       * accepting requests.
       */
      await bootstrapErrorHandler();

      /* ---------------------------------------------------------------------
       * HTTP SERVER
       * ------------------------------------------------------------------- */

      await runStartupPhase(
        "httpServer",
        bootstrapHttpServer,
      );

      if (!bootstrapContext.httpServer) {
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

      /* ---------------------------------------------------------------------
       * RUNTIME READY
       * ------------------------------------------------------------------- */

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

      /* ---------------------------------------------------------------------
       * SHUTDOWN MANAGER
       * ------------------------------------------------------------------- */

      await initializeShutdownManager();

      /* ---------------------------------------------------------------------
       * APPLICATION STARTED
       * ------------------------------------------------------------------- */

      mirrorApplicationStarted();

      /* ---------------------------------------------------------------------
       * APPLICATION READY
       * ------------------------------------------------------------------- */

      await markApplicationReady();

      if (
        bootstrapContext.state !== "ready"
      ) {
        throw new Error(
          `TITech bootstrap lifecycle contract violation: expected "ready", received "${bootstrapContext.state}".`,
        );
      }

      startupCompleted = true;
      shutdownCompleted = false;
      shutdownRequested = false;

      safeLogInfo(
        createComponentMetadata({
          event:
            "application.bootstrap.completed",
          state:
            bootstrapContext.state,
          server:
            bootstrapContext.serverAddress,
          runtimeGeneration:
            bootstrapContext.runtimeGeneration ||
            undefined,
        }),
        "TITech Community Capital startup completed successfully.",
      );

      return {
        app,
        server:
          bootstrapContext.httpServer ||
          null,
        context: bootstrapContext,
        state:
          runtimeState.getApplicationState?.(),
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

            critical: true,
            fatal: true,
            preserveCauseStack: true,
          },
        );

      startupFailureHandled = true;

      /*
       * Canonical failure transition.
       */
      try {
        if (
          bootstrapContext &&
          bootstrapContext.state !==
          "failed" &&
          bootstrapContext.state !==
          "stopped"
        ) {
          bootstrapContext.markFailed(
            normalized,
            normalized.phase,
          );
        }
      } catch (contextError) {
        safeLogWarn(
          createComponentMetadata({
            event:
              "bootstrap_context_failure_transition_failed",
            message:
              contextError?.message,
          }),
          "TITech BootstrapContext failure transition failed.",
        );
      }

      mirrorApplicationFailed(
        normalized,
      );

      safeLogError(
        typeof normalized.toLogObject ===
          "function"
          ? normalized.toLogObject({
            includeStack: true,
            includeCauseStack: true,
          })
          : {
            ...createComponentMetadata({
              event:
                "application.startup.failed",
            }),
            name: normalized.name,
            code: normalized.code,
            phase: normalized.phase,
            message: normalized.message,
            stack: normalized.stack,
          },
        "TITech Community Capital startup failed.",
      );

      /*
       * Never leave a partially initialized runtime alive.
       *
       * skipProcessExit=true is mandatory here because this function is being
       * called from inside the startup lifecycle.
       */
      try {
        await shutdownApplication({
          reason: "startup_failure",
          exit: false,
          skipProcessExit: true,
        });
      } catch (cleanupError) {
        safeLogError(
          createComponentMetadata({
            event:
              "startup.cleanup.failed",
            message:
              cleanupError?.message,
            originalFailure:
              normalized.message,
          }),
          "TITech startup cleanup encountered an error.",
        );
      }

      throw normalized;
    }
  })();

  try {
    return await startupPromise;
  } finally {
    startupPromise = null;
  }
}

/* =============================================================================
 * SHUTDOWN APPLICATION
 * =============================================================================
 */

async function shutdownApplication({
  reason = "shutdown",
  exit = false,
  exitCode = 0,
  skipProcessExit = false,
} = {}) {
  /*
   * Shutdown is single-flight.
   */
  if (shutdownPromise) {
    return shutdownPromise;
  }

  if (shutdownCompleted) {
    if (
      exit &&
      !skipProcessExit
    ) {
      process.exit(exitCode);
    }

    return;
  }

  /*
   * If startup is still actively executing, mark shutdown as requested.
   * The startup failure path will perform the actual cleanup if startup fails.
   */
  shutdownRequested = true;

  shutdownPromise = (async () => {
    const startedAt =
      process.hrtime.bigint();

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

      /*
       * Shutdown subsystem may already have transitioned the context.
       */
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
            }),
            "TITech BootstrapContext stopped-state transition failed.",
          );
        }
      }

      mirrorApplicationStopped();

      shutdownCompleted = true;
      startupCompleted = false;
      startupFailureHandled = false;
      shutdownRequested = false;

      const durationMs =
        Number(
          process.hrtime.bigint() -
          startedAt,
        ) / 1_000_000;

      safeLogInfo(
        createComponentMetadata({
          event:
            "shutdown.completed",
          reason,
          durationMs,
          canonicalState:
            bootstrapContext?.state ||
            null,
        }),
        "TITech Community Capital shutdown completed.",
      );

      if (
        exit &&
        !skipProcessExit
      ) {
        process.exit(exitCode);
      }
    } catch (error) {
      const normalized =
        normalizeStartupError(
          error,
          {
            phase: "lifecycle",
            operation:
              "application-shutdown",
            critical: exit,
            fatal: exit,
            preserveCauseStack: true,
          },
        );

      safeLogError(
        typeof normalized.toLogObject ===
          "function"
          ? normalized.toLogObject({
            includeStack: true,
            includeCauseStack: true,
          })
          : {
            ...createComponentMetadata({
              event: "shutdown.failed",
            }),
            name: normalized.name,
            code: normalized.code,
            message: normalized.message,
            stack: normalized.stack,
          },
        "TITech Community Capital shutdown failed.",
      );

      shutdownRequested = false;

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
  })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise = null;
  }
}

/* =============================================================================
 * SIGNAL HANDLERS
 * =============================================================================
 */

function installSignalHandlers() {
  if (signalHandlersInstalled) {
    return;
  }

  signalHandlersInstalled = true;

  const handleSignal =
    (signal) =>
      async () => {
        safeLogInfo(
          createComponentMetadata({
            event: "signal.received",
            signal,
          }),
          `TITech process received ${signal}.`,
        );

        try {
          await shutdownApplication({
            reason: `signal:${signal}`,
            exit: true,
            exitCode: 0,
          });
        } catch (error) {
          safeLogError(
            createComponentMetadata({
              event:
                "signal.shutdown.failed",
              signal,
              message:
                error?.message,
            }),
            "TITech signal shutdown failed.",
          );

          process.exitCode = 1;
        }
      };

  process.once(
    "SIGINT",
    handleSignal("SIGINT"),
  );

  process.once(
    "SIGTERM",
    handleSignal("SIGTERM"),
  );

  if (process.platform !== "win32") {
    process.once(
      "SIGQUIT",
      handleSignal("SIGQUIT"),
    );
  }
}

/* =============================================================================
 * FATAL PROCESS ERROR HANDLERS
 * =============================================================================
 */

function installFatalErrorHandlers() {
  if (fatalHandlersInstalled) {
    return;
  }

  fatalHandlersInstalled = true;

  process.once(
    "uncaughtException",
    async (error) => {
      const normalized =
        startupErrors.runtimeError(
          "TITech process encountered an uncaught exception.",
          {
            cause: error,
            critical: true,
            fatal: true,
            retryable: false,
          },
        );

      safeLogFatal(
        typeof normalized.toLogObject ===
          "function"
          ? normalized.toLogObject({
            includeStack: true,
            includeCauseStack: true,
          })
          : normalized,
        "TITech uncaught exception.",
      );

      try {
        await shutdownApplication({
          reason: "uncaughtException",
          exit: true,
          exitCode: 1,
        });
      } catch {
        process.exitCode = 1;
      }
    },
  );

  process.once(
    "unhandledRejection",
    async (reason) => {
      const error =
        reason instanceof Error
          ? reason
          : new Error(
            typeof reason === "string"
              ? reason
              : "TITech unhandled promise rejection.",
          );

      const normalized =
        startupErrors.runtimeError(
          "TITech process encountered an unhandled promise rejection.",
          {
            cause: error,
            critical: true,
            fatal: true,
            retryable: false,
          },
        );

      safeLogFatal(
        typeof normalized.toLogObject ===
          "function"
          ? normalized.toLogObject({
            includeStack: true,
            includeCauseStack: true,
          })
          : normalized,
        "TITech unhandled promise rejection.",
      );

      try {
        await shutdownApplication({
          reason: "unhandledRejection",
          exit: true,
          exitCode: 1,
        });
      } catch {
        process.exitCode = 1;
      }
    },
  );
}

/* =============================================================================
 * RUNTIME READINESS
 * =============================================================================
 */

function isRuntimeReady() {
  return (
    bootstrapContext?.state === "ready"
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
      status: isRuntimeReady()
        ? "healthy"
        : "not_ready",

      ready: isRuntimeReady(),

      application:
        getApplicationName(),

      service: getServiceName(),

      version:
        getApplicationVersion(),

      bootstrapState:
        bootstrapContext?.state ||
        null,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      ready: false,

      application:
        getApplicationName(),

      service: getServiceName(),

      version:
        getApplicationVersion(),

      bootstrapState:
        bootstrapContext?.state ||
        null,

      error: {
        name: error?.name,
        code: error?.code,
        message: error?.message,
      },
    };
  }
}

/* =============================================================================
 * BOOTSTRAP DIAGNOSTICS
 * =============================================================================
 */

function getBootstrapState() {
  return {
    startupCompleted,
    shutdownCompleted,
    shutdownRequested,
    startupFailureHandled,

    ready: isRuntimeReady(),

    canonical: {
      state:
        bootstrapContext?.state ||
        null,

      currentPhase:
        bootstrapContext?.currentPhase ||
        null,

      /*
       * Return the actual context for internal callers.
       * Consumers needing serialization should use diagnostics instead.
       */
      context:
        bootstrapContext || null,

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
    !Array.isArray(BOOTSTRAP_PHASES) ||
    BOOTSTRAP_PHASES.length === 0
  ) {
    throw new Error(
      "TITech BootstrapContext phase registry is invalid.",
    );
  }

  if (SERVICE_METADATA.nodeMajor < 20) {
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

  for (const phase of requiredPhases) {
    if (
      !BOOTSTRAP_PHASES.includes(phase)
    ) {
      throw new Error(
        `TITech BootstrapContext is missing canonical phase "${phase}".`,
      );
    }
  }

  const infrastructureInitializer =
    resolveBootstrapInitializer(
      infrastructureBootstrap,
      {
        includeRegister: true,
      },
    );

  if (
    typeof infrastructureInitializer !==
    "function"
  ) {
    throw new Error(
      "TITech infrastructure bootstrap initializer is unavailable.",
    );
  }

  const servicesInitializer =
    resolveBootstrapInitializer(
      servicesBootstrap,
    );

  if (
    typeof servicesInitializer !==
    "function"
  ) {
    throw new Error(
      "TITech services bootstrap initializer is unavailable.",
    );
  }

  const middlewareInitializer =
    resolveBootstrapInitializer(
      middlewareBootstrap,
      {
        includeRegister: true,
      },
    );

  if (
    typeof middlewareInitializer !==
    "function"
  ) {
    throw new Error(
      "TITech middleware bootstrap initializer is unavailable.",
    );
  }

  const routesInitializer =
    resolveBootstrapInitializer(
      routesBootstrap,
      {
        includeMount: true,
        includeRegister: true,
      },
    );

  if (
    typeof routesInitializer !==
    "function"
  ) {
    throw new Error(
      "TITech route bootstrap initializer is unavailable.",
    );
  }

  const serverInitializer =
    resolveBootstrapInitializer(
      serverBootstrap,
    );

  if (
    typeof serverInitializer !==
    "function"
  ) {
    throw new Error(
      "TITech HTTP server bootstrap initializer is unavailable.",
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

  metadata: SERVICE_METADATA,

  getLogger() {
    return logger;
  },

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

  getRuntimeState:
    runtimeState.getApplicationState,

  getHealthState,

  isRuntimeReady,

  BOOTSTRAP_PHASES,

  BootstrapContext,
};

module.exports = Object.freeze(
  publicApi,
);

/* =============================================================================
 * DIRECT EXECUTION
 * =============================================================================
 */

if (require.main === module) {
  try {
    validateBootstrapComposition();
  } catch (compositionError) {
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

    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
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

              fatal: true,

              preserveCauseStack: true,
            },
          );

        safeLogFatal(
          typeof normalized.toLogObject ===
            "function"
            ? normalized.toLogObject({
              includeStack: true,
              includeCauseStack: true,
            })
            : normalized,
          "TITech application failed to start.",
        );

        process.exitCode = 1;
      },
    );
  }
}