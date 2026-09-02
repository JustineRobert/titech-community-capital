"use strict";

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/server.js
 *
 * Purpose:
 *   Enterprise backend process entry point.
 *
 * Architectural Role:
 * -----------------------------------------------------------------------------
 *
 *   server.js
 *       │
 *       ▼
 *   ApplicationBootstrap
 *       │
 *       ├── DependencyRegistry
 *       ├── LifecycleManager
 *       ├── ReadinessState
 *       ├── ShutdownManager
 *       ├── ServicesContext
 *       └── BootstrapContext
 *              │
 *              ▼
 *        TITech Runtime
 *              │
 *              ▼
 *             READY
 *
 * This module is intentionally THIN.
 *
 * It is responsible ONLY for:
 *
 *   1. Loading process environment.
 *   2. Validating the Node.js runtime.
 *   3. Installing process-level fatal-error protection.
 *   4. Loading the canonical TITech bootstrap orchestrator.
 *   5. Supplying optional composition context.
 *   6. Starting the canonical application lifecycle.
 *   7. Providing safe operational diagnostics.
 *
 * IMPORTANT:
 *
 * This file MUST NOT:
 *
 *   - create an Express application;
 *   - register Express middleware directly;
 *   - connect directly to MongoDB;
 *   - connect directly to Redis;
 *   - initialize queues;
 *   - initialize Socket.IO;
 *   - initialize business services;
 *   - execute bootstrap phases itself;
 *   - duplicate lifecycle hooks;
 *   - duplicate shutdown orchestration;
 *   - maintain an independent application state machine.
 *
 * Canonical bootstrap ownership remains inside:
 *
 *   backend/bootstrap/ApplicationBootstrap.js
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module System:
 *   CommonJS
 *
 * =============================================================================
 */

"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const dotenv = require("dotenv");

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const APPLICATION_NAME =
  "TITech Community Capital";

const DEFAULT_SERVICE_NAME =
  "titech-community-capital-backend";

const DEFAULT_NODE_ENV =
  "development";

const MIN_NODE_MAJOR =
  20;

const FATAL_EXIT_CODE =
  1;

const ENV_FILE =
  path.resolve(
    process.cwd(),
    ".env",
  );

/**
 * Canonical bootstrap implementation.
 *
 * Do NOT silently fall back to an alternative application factory.
 */
const BOOTSTRAP_MODULE_PATH =
  "./bootstrap/ApplicationBootstrap";

/**
 * Signals are documented here for observability.
 *
 * Signal registration itself belongs to the canonical bootstrap lifecycle.
 */
const PROCESS_SIGNALS =
  Object.freeze([
    "SIGTERM",
    "SIGINT",
  ]);

/**
 * Environment values that should never be logged directly.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|passcode|pin|otp|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret|jwt|mongo(uri)?|mongodb|redis|database|connection|string/i;

/* =============================================================================
 * ENVIRONMENT LOADING
 * =============================================================================
 */

let dotenvResult;

try {
  dotenvResult =
    dotenv.config({
      path: ENV_FILE,
    });
} catch (error) {
  dotenvResult = {
    error,
  };
}

/**
 * Resolve identity AFTER dotenv has been loaded.
 *
 * This allows SERVICE_NAME / OTEL_SERVICE_NAME / NODE_ENV to be supplied
 * through .env while still supporting externally injected process variables.
 */
const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  DEFAULT_SERVICE_NAME;

const NODE_ENV =
  process.env.NODE_ENV ||
  DEFAULT_NODE_ENV;

/* =============================================================================
 * PROCESS-LOCAL STATE
 * =============================================================================
 *
 * This is NOT an application state machine.
 *
 * Application lifecycle state remains owned by ApplicationBootstrap.
 *
 * These variables only describe this process-entry module's local bookkeeping.
 * =============================================================================
 */

let bootstrapInstance = null;

let bootstrapModule = null;

let logger = console;

let processHandlersInstalled = false;

let fatalHandlingStarted = false;

let startupPromise = null;

/* =============================================================================
 * SAFE SERIALIZATION
 * =============================================================================
 */

/**
 * Convert diagnostic values into safe, JSON-compatible values.
 *
 * This function intentionally favors observability safety over perfect
 * serialization fidelity.
 *
 * @param {*} value
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {*}
 */
function sanitizeValue(
  value,
  depth = 0,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "bigint"
  ) {
    return value.toString();
  }

  if (
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return `[${typeof value}]`;
  }

  if (
    depth >= 5
  ) {
    return "[max-depth]";
  }

  if (
    value instanceof Error
  ) {
    return {
      name:
        value.name,

      message:
        value.message,

      code:
        value.code,

      ...(NODE_ENV !== "production" &&
      value.stack
        ? {
            stack:
              value.stack,
          }
        : {}),
    };
  }

  if (
    typeof value === "object"
  ) {
    if (
      seen.has(value)
    ) {
      return "[circular]";
    }

    seen.add(value);

    if (
      Array.isArray(value)
    ) {
      return value.map(
        item =>
          sanitizeValue(
            item,
            depth + 1,
            seen,
          ),
      );
    }

    const output = {};

    for (
      const [
        key,
        nestedValue,
      ] of Object.entries(value)
    ) {
      if (
        SENSITIVE_KEY_PATTERN.test(
          String(key),
        )
      ) {
        continue;
      }

      output[key] =
        sanitizeValue(
          nestedValue,
          depth + 1,
          seen,
        );
    }

    return output;
  }

  return "[unserializable]";
}

/**
 * Sanitize an object containing diagnostic metadata.
 *
 * @param {*} metadata
 * @returns {object}
 */
function sanitizeMetadata(
  metadata,
) {
  if (
    !metadata ||
    typeof metadata !== "object"
  ) {
    return {};
  }

  const sanitized =
    sanitizeValue(
      metadata,
    );

  if (
    sanitized &&
    typeof sanitized === "object" &&
    !Array.isArray(sanitized)
  ) {
    return sanitized;
  }

  return {};
}

/* =============================================================================
 * SAFE LOGGING
 * =============================================================================
 */

/**
 * Generic safe logger dispatcher.
 *
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} metadata
 */
function writeLog(
  level,
  message,
  metadata = {},
) {
  const safeMetadata =
    sanitizeMetadata(
      metadata,
    );

  try {
    if (
      logger &&
      typeof logger[level] ===
        "function"
    ) {
      logger[level](
        message,
        safeMetadata,
      );

      return;
    }
  } catch {
    // Fall through to console.
  }

  try {
    if (
      typeof console[level] ===
      "function"
    ) {
      console[level](
        message,
        safeMetadata,
      );
    }
  } catch {
    // Diagnostics must never crash the process.
  }
}

function logInfo(
  message,
  metadata = {},
) {
  writeLog(
    "info",
    message,
    metadata,
  );
}

function logWarn(
  message,
  metadata = {},
) {
  writeLog(
    "warn",
    message,
    metadata,
  );
}

function logError(
  message,
  metadata = {},
) {
  writeLog(
    "error",
    message,
    metadata,
  );
}

/* =============================================================================
 * RUNTIME VALIDATION
 * =============================================================================
 */

/**
 * Validate the minimum Node.js runtime contract required by TITech.
 *
 * @returns {Readonly<object>}
 * @throws {Error}
 */
function validateRuntime() {
  const nodeVersion =
    process.versions?.node ||
    process.version;

  const nodeMajor =
    Number(
      String(nodeVersion)
        .split(".")[0],
    );

  if (
    !Number.isInteger(nodeMajor) ||
    nodeMajor < MIN_NODE_MAJOR
  ) {
    const error =
      new Error(
        `${APPLICATION_NAME} requires Node.js ${MIN_NODE_MAJOR}+. ` +
          `Current runtime: ${process.version}`,
      );

    error.code =
      "TITECH_UNSUPPORTED_NODE_VERSION";

    throw error;
  }

  const requiredFeatures =
    Object.freeze({
      randomUUID:
        typeof crypto.randomUUID ===
        "function",

      structuredClone:
        typeof global.structuredClone ===
        "function",

      fetch:
        typeof global.fetch ===
        "function",

      AbortController:
        typeof global.AbortController ===
        "function",

      URL:
        typeof global.URL ===
        "function",

      setTimeout:
        typeof global.setTimeout ===
        "function",
    });

  const missingFeatures =
    Object.entries(
      requiredFeatures,
    )
      .filter(
        ([, available]) =>
          !available,
      )
      .map(
        ([name]) =>
          name,
      );

  if (
    missingFeatures.length > 0
  ) {
    const error =
      new Error(
        "Required TITech runtime features are unavailable: " +
          missingFeatures.join(", "),
      );

    error.code =
      "TITECH_RUNTIME_FEATURES_UNAVAILABLE";

    error.details = {
      missingFeatures,
    };

    throw error;
  }

  const supportedPlatforms =
    new Set([
      "win32",
      "linux",
      "darwin",
    ]);

  if (
    !supportedPlatforms.has(
      process.platform,
    )
  ) {
    const error =
      new Error(
        `Unsupported platform: ${process.platform}`,
      );

    error.code =
      "TITECH_UNSUPPORTED_PLATFORM";

    throw error;
  }

  const supportedArchitectures =
    new Set([
      "x64",
      "arm64",
    ]);

  if (
    !supportedArchitectures.has(
      process.arch,
    )
  ) {
    const error =
      new Error(
        `Unsupported architecture: ${process.arch}`,
      );

    error.code =
      "TITECH_UNSUPPORTED_ARCHITECTURE";

    throw error;
  }

  return Object.freeze({
    nodeVersion,

    nodeMajor,

    platform:
      process.platform,

    architecture:
      process.arch,

    hostname:
      os.hostname(),

    cpuCount:
      os.cpus()?.length || 1,

    pid:
      process.pid,
  });
}

/* =============================================================================
 * ENVIRONMENT STATE
 * =============================================================================
 */

/**
 * Return non-secret environment diagnostics.
 *
 * @returns {Readonly<object>}
 */
function getEnvironmentState() {
  return Object.freeze({
    application:
      APPLICATION_NAME,

    nodeEnv:
      NODE_ENV,

    serviceName:
      SERVICE_NAME,

    envFile:
      ENV_FILE,

    envFileLoaded:
      Boolean(
        dotenvResult &&
        !dotenvResult.error,
      ),

    envFileError:
      dotenvResult?.error
        ? {
            name:
              dotenvResult.error.name,

            code:
              dotenvResult.error.code,

            message:
              dotenvResult.error.message,
          }
        : null,
  });
}

/* =============================================================================
 * ROUTE COMPOSITION CONTRACT
 * =============================================================================
 */

/**
 * Route composition remains owned by ApplicationBootstrap.
 *
 * The server entry point exposes only a declarative composition contract.
 * It does not register routes.
 *
 * @returns {Readonly<object>}
 */
function createRouteComposition() {
  return Object.freeze({
    version:
      "1.0",

    register:
      null,

    description:
      "Canonical route composition is owned by the TITech application bootstrap layer.",
  });
}

/* =============================================================================
 * CANONICAL BOOTSTRAP LOADER
 * =============================================================================
 */

/**
 * Load the single canonical application bootstrap implementation.
 *
 * Supported export:
 *
 *   module.exports = {
 *     ApplicationBootstrap,
 *     ApplicationBootstrapError
 *   }
 *
 * @returns {object}
 * @throws {Error}
 */
function loadBootstrapModule() {
  if (
    bootstrapModule
  ) {
    return bootstrapModule;
  }

  let loaded;

  try {
    loaded =
      require(
        BOOTSTRAP_MODULE_PATH,
      );
  } catch (error) {
    const diagnostic =
      new Error(
        "Unable to load TITech canonical bootstrap module.",
        {
          cause:
            error,
        },
      );

    diagnostic.code =
      "TITECH_BOOTSTRAP_MODULE_LOAD_FAILED";

    diagnostic.details = {
      module:
        BOOTSTRAP_MODULE_PATH,

      originalError: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
    };

    throw diagnostic;
  }

  if (
    !loaded ||
    typeof loaded !== "object"
  ) {
    const error =
      new TypeError(
        "TITech canonical bootstrap module must export an object.",
      );

    error.code =
      "TITECH_BOOTSTRAP_INVALID_EXPORT";

    throw error;
  }

  const ApplicationBootstrap =
    loaded.ApplicationBootstrap;

  if (
    typeof ApplicationBootstrap !==
    "function"
  ) {
    const error =
      new TypeError(
        "TITech canonical bootstrap module must export ApplicationBootstrap.",
      );

    error.code =
      "TITECH_APPLICATION_BOOTSTRAP_EXPORT_MISSING";

    throw error;
  }

  bootstrapModule =
    loaded;

  return bootstrapModule;
}

/* =============================================================================
 * BOOTSTRAP INSTANCE
 * =============================================================================
 */

/**
 * Create the singleton ApplicationBootstrap instance.
 *
 * The singleton belongs to this process entry point only.
 * Application lifecycle state remains owned by ApplicationBootstrap.
 *
 * @param {object} options
 * @returns {object}
 */
function getBootstrapInstance(
  options = {},
) {
  if (
    bootstrapInstance
  ) {
    return bootstrapInstance;
  }

  const {
    ApplicationBootstrap,
  } =
    loadBootstrapModule();

  try {
    bootstrapInstance =
      new ApplicationBootstrap({
        ...options,
      });
  } catch (error) {
    const diagnostic =
      new Error(
        "Unable to instantiate TITech ApplicationBootstrap.",
        {
          cause:
            error,
        },
      );

    diagnostic.code =
      "TITECH_BOOTSTRAP_INSTANCE_CREATE_FAILED";

    diagnostic.details = {
      originalError: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
    };

    throw diagnostic;
  }

  return bootstrapInstance;
}

/* =============================================================================
 * FATAL PROCESS ERROR HANDLING
 * =============================================================================
 */

/**
 * Handle an unrecoverable process-level error.
 *
 * ApplicationBootstrap remains responsible for graceful application shutdown.
 *
 * @param {string} type
 * @param {*} reason
 * @returns {Promise<void>}
 */
async function handleFatalProcessError(
  type,
  reason,
) {
  if (
    fatalHandlingStarted
  ) {
    return;
  }

  fatalHandlingStarted =
    true;

  const error =
    reason instanceof Error
      ? reason
      : new Error(
          String(reason),
        );

  logError(
    `TITech Community Capital ${type} detected.`,
    {
      application:
        APPLICATION_NAME,

      serviceName:
        SERVICE_NAME,

      environment:
        NODE_ENV,

      name:
        error.name,

      message:
        error.message,

      code:
        error.code,

      ...(NODE_ENV !== "production"
        ? {
            stack:
              error.stack,
          }
        : {}),
    },
  );

  try {
    const bootstrap =
      bootstrapInstance;

    if (
      bootstrap &&
      typeof bootstrap.shutdown ===
        "function"
    ) {
      await bootstrap.shutdown(
        type,
      );
    }
  } catch (shutdownError) {
    logError(
      "TITech Community Capital fatal-error shutdown failed.",
      {
        name:
          shutdownError?.name,

        message:
          shutdownError?.message,

        code:
          shutdownError?.code,

        ...(NODE_ENV !== "production"
          ? {
              stack:
                shutdownError?.stack,
            }
          : {}),
      },
    );
  }

  process.exitCode =
    FATAL_EXIT_CODE;

  /**
   * Do not throw here.
   *
   * This handler is invoked because the process is already in an
   * unrecoverable state. Explicit termination prevents the process from
   * continuing in an undefined condition.
   */
  process.exit(
    FATAL_EXIT_CODE,
  );
}

/* =============================================================================
 * PROCESS HANDLERS
 * =============================================================================
 */

/**
 * Install process-level protection exactly once.
 *
 * Signal handlers are intentionally NOT installed here.
 * SIGTERM/SIGINT lifecycle ownership remains inside ApplicationBootstrap.
 *
 * @returns {boolean}
 */
function installProcessHandlers() {
  if (
    processHandlersInstalled
  ) {
    return false;
  }

  processHandlersInstalled =
    true;

  process.on(
    "uncaughtException",
    error => {
      void handleFatalProcessError(
        "uncaught exception",
        error,
      );
    },
  );

  process.on(
    "unhandledRejection",
    reason => {
      void handleFatalProcessError(
        "unhandled promise rejection",
        reason,
      );
    },
  );

  return true;
}

/* =============================================================================
 * START APPLICATION
 * =============================================================================
 */

/**
 * Start the TITech application through the canonical bootstrap orchestrator.
 *
 * Multiple concurrent calls return the same startup promise.
 *
 * @returns {Promise<*>}
 */
async function startServer() {
  if (
    startupPromise
  ) {
    return startupPromise;
  }

  startupPromise =
    (async () => {
      const runtime =
        validateRuntime();

      const routeComposition =
        createRouteComposition();

      logInfo(
        "Starting TITech Community Capital backend process.",
        {
          application:
            APPLICATION_NAME,

          serviceName:
            SERVICE_NAME,

          environment:
            NODE_ENV,

          nodeVersion:
            runtime.nodeVersion,

          nodeMajor:
            runtime.nodeMajor,

          platform:
            runtime.platform,

          architecture:
            runtime.architecture,

          hostname:
            runtime.hostname,

          cpuCount:
            runtime.cpuCount,

          pid:
            runtime.pid,

          envFileLoaded:
            Boolean(
              dotenvResult &&
              !dotenvResult.error,
            ),

          supportedSignals:
            PROCESS_SIGNALS,
        },
      );

      /**
       * A missing .env file is not automatically fatal.
       *
       * Environment variables may have been injected by:
       *
       *   - Docker;
       *   - Kubernetes;
       *   - systemd;
       *   - CI/CD;
       *   - cloud runtime;
       *   - process manager;
       *   - hosting platform.
       */
      if (
        dotenvResult?.error
      ) {
        logWarn(
          "TITech .env file was not loaded. " +
            "Startup will rely on the process environment and bootstrap configuration.",
          {
            envFile:
              ENV_FILE,

            error:
              dotenvResult.error,
          },
        );
      }

      const bootstrap =
        getBootstrapInstance();

      /**
       * Establish the canonical bootstrap context BEFORE dependency
       * initialization begins.
       *
       * Awaiting the result is safe whether initialize() is synchronous
       * or asynchronous.
       */
      await bootstrap.initialize({
        application:
          APPLICATION_NAME,

        service:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        routeComposition,
      });

      /**
       * Canonical application lifecycle.
       *
       * ApplicationBootstrap owns:
       *
       *   - dependency initialization;
       *   - lifecycle hooks;
       *   - readiness;
       *   - shutdown registration;
       *   - startup failure cleanup;
       *   - application state transitions.
       */
      const result =
        await bootstrap.start({
          application:
            APPLICATION_NAME,

          service:
            SERVICE_NAME,

          environment:
            NODE_ENV,

          routeComposition,
        });

      /**
       * Adopt the canonical application logger only after bootstrap has
       * successfully initialized.
       */
      logger =
        result?.logger ||
        bootstrap.context?.logger ||
        logger;

      logInfo(
        "TITech Community Capital backend startup completed.",
        {
          application:
            APPLICATION_NAME,

          serviceName:
            SERVICE_NAME,

          environment:
            NODE_ENV,

          pid:
            process.pid,

          state:
            bootstrap.state,

          ready:
            bootstrap.ready,
        },
      );

      return result;
    })();

  try {
    return await startupPromise;
  } catch (error) {
    /**
     * Permit a future explicit retry in environments where the process
     * remains alive after a startup failure.
     *
     * ApplicationBootstrap remains responsible for cleaning up anything
     * it initialized before the failure.
     */
    startupPromise =
      null;

    logError(
      "TITech Community Capital backend startup failed.",
      {
        application:
          APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        name:
          error?.name,

        message:
          error?.message,

        code:
          error?.code,

        phase:
          error?.phase,

        component:
          error?.component,

        ...(NODE_ENV !== "production"
          ? {
              stack:
                error?.stack,
            }
          : {}),
      },
    );

    throw error;
  }
}

/* =============================================================================
 * OPERATIONAL STATE
 * =============================================================================
 */

/**
 * Return canonical bootstrap state where available.
 *
 * This function never creates or mutates application state.
 *
 * @returns {Readonly<object>}
 */
function getServerState() {
  if (
    bootstrapInstance
  ) {
    try {
      if (
        typeof bootstrapInstance.snapshot ===
        "function"
      ) {
        return bootstrapInstance.snapshot();
      }
    } catch {
      // Fall through to process-entry state.
    }
  }

  return Object.freeze({
    application:
      APPLICATION_NAME,

    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

    running:
      false,

    pid:
      process.pid,

    processHandlersInstalled:
      processHandlersInstalled,

    fatalHandlingStarted:
      fatalHandlingStarted,

    bootstrapLoaded:
      Boolean(
        bootstrapModule,
      ),

    bootstrapInstantiated:
      Boolean(
        bootstrapInstance,
      ),
  });
}

/* =============================================================================
 * PROCESS STATE
 * =============================================================================
 */

/**
 * Return process-local diagnostics.
 *
 * This is intentionally separate from application lifecycle state.
 *
 * @returns {Readonly<object>}
 */
function getProcessState() {
  return Object.freeze({
    application:
      APPLICATION_NAME,

    pid:
      process.pid,

    ppid:
      process.ppid,

    uptimeSeconds:
      process.uptime(),

    platform:
      process.platform,

    architecture:
      process.arch,

    nodeVersion:
      process.version,

    nodeEnv:
      NODE_ENV,

    serviceName:
      SERVICE_NAME,

    processHandlersInstalled:
      processHandlersInstalled,

    fatalHandlingStarted:
      fatalHandlingStarted,

    bootstrapLoaded:
      Boolean(
        bootstrapModule,
      ),

    bootstrapInstantiated:
      Boolean(
        bootstrapInstance,
      ),

    startupInProgress:
      Boolean(
        startupPromise,
      ),
  });
}

/* =============================================================================
 * PROCESS INITIALIZATION
 * =============================================================================
 *
 * Install only fatal-error protection here.
 *
 * SIGTERM/SIGINT ownership remains inside the canonical bootstrap lifecycle.
 * =============================================================================
 */

installProcessHandlers();

/* =============================================================================
 * DIRECT EXECUTION
 * =============================================================================
 */

if (
  require.main === module
) {
  startServer().catch(
    error => {
      /**
       * startServer() already performs structured logging.
       *
       * This final boundary exists only for direct process execution so
       * Node does not silently leave the process alive after a fatal
       * startup failure.
       */
      logError(
        "TITech Community Capital backend process could not start.",
        {
          application:
            APPLICATION_NAME,

          serviceName:
            SERVICE_NAME,

          environment:
            NODE_ENV,

          name:
            error?.name,

          message:
            error?.message,

          code:
            error?.code,

          ...(NODE_ENV !== "production"
            ? {
                stack:
                  error?.stack,
              }
            : {}),
        },
      );

      process.exitCode =
        FATAL_EXIT_CODE;

      process.exit(
        FATAL_EXIT_CODE,
      );
    },
  );
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports =
  Object.freeze({
    startServer,

    validateRuntime,

    getEnvironmentState,

    getProcessState,

    getServerState,

    installProcessHandlers,

    createRouteComposition,

    loadBootstrapModule,

    getBootstrapInstance,
  });