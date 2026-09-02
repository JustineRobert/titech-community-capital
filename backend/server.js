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
 *            READY
 *
 * This module is intentionally THIN.
 *
 * It is responsible ONLY for:
 *
 *   1. Loading process environment.
 *   2. Validating the Node.js runtime.
 *   3. Installing process-level fatal-error protection.
 *   4. Loading the canonical TITech bootstrap orchestrator.
 *   5. Supplying process/bootstrap metadata.
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
 *   ES Modules (ESM)
 *
 * =============================================================================
 */

import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import dotenv from "dotenv";

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

const MIN_NODE_MAJOR = 20;

const FATAL_EXIT_CODE = 1;

const STARTUP_ID =
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `startup-${Date.now()}-${process.pid}`;

const STARTUP_STATUS = Object.freeze({
  NOT_STARTED: "not_started",
  STARTING: "starting",
  READY: "ready",
  FAILED: "failed",
  STOPPING: "stopping",
  STOPPED: "stopped",
});

/**
 * Canonical bootstrap implementation.
 *
 * DO NOT introduce an alternative application factory here.
 */
const BOOTSTRAP_MODULE_PATH =
  "./bootstrap/ApplicationBootstrap.js";

/* =============================================================================
 * MODULE IDENTITY
 * =============================================================================
 */

const CURRENT_FILE =
  fileURLToPath(import.meta.url);

const CURRENT_DIRECTORY =
  path.dirname(CURRENT_FILE);

/**
 * Resolve the environment file relative to backend/server.js.
 *
 * Explicit TITECH_ENV_FILE takes precedence.
 */
const ENV_FILE = path.resolve(
  process.env.TITECH_ENV_FILE ||
    path.join(
      CURRENT_DIRECTORY,
      ".env",
    ),
);

/* =============================================================================
 * PROCESS CONTRACT
 * =============================================================================
 *
 * ApplicationBootstrap owns SIGTERM/SIGINT lifecycle handling.
 *
 * server.js owns only unrecoverable process-level errors.
 */

const PROCESS_SIGNALS = Object.freeze([
  "SIGTERM",
  "SIGINT",
]);

/* =============================================================================
 * SENSITIVE DATA PROTECTION
 * =============================================================================
 */

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|passcode|pin|otp|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret|jwt|mongodb?|mongo(uri)?|redis|database|connection|string)/i;

/* =============================================================================
 * ENVIRONMENT LOADING
 * =============================================================================
 */

let dotenvResult = {
  parsed: null,
  error: null,
};

try {
  dotenvResult = dotenv.config({
    path: ENV_FILE,
  });
} catch (error) {
  dotenvResult = {
    parsed: null,
    error,
  };
}

/**
 * Identity is resolved after dotenv loading so that .env may provide
 * service/application metadata.
 */
const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  DEFAULT_SERVICE_NAME;

const NODE_ENV =
  process.env.NODE_ENV ||
  DEFAULT_NODE_ENV;

const EFFECTIVE_APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  APPLICATION_NAME;

/* =============================================================================
 * PROCESS-LOCAL STATE
 * =============================================================================
 *
 * These variables describe this process-entry module only.
 *
 * Application lifecycle state remains owned by ApplicationBootstrap.
 */

let bootstrapInstance = null;

let bootstrapModule = null;

let logger = console;

let processHandlersInstalled = false;

let fatalHandlingStarted = false;

let startupPromise = null;

let processStartupStatus =
  STARTUP_STATUS.NOT_STARTED;

/* =============================================================================
 * SAFE SERIALIZATION
 * =============================================================================
 */

/**
 * Convert arbitrary diagnostic data into a safe JSON-compatible structure.
 *
 * Security properties:
 *
 *   - circular references are handled;
 *   - sensitive keys are redacted;
 *   - Error objects are normalized;
 *   - excessive nesting is bounded;
 *   - functions/symbols are never emitted directly.
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

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return `[${typeof value}]`;
  }

  if (depth >= 6) {
    return "[max-depth]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,

      ...(value.code !== undefined
        ? {
            code: value.code,
          }
        : {}),

      ...(value.phase !== undefined
        ? {
            phase: value.phase,
          }
        : {}),

      ...(value.component !== undefined
        ? {
            component: value.component,
          }
        : {}),

      ...(value.cause
        ? {
            cause: sanitizeValue(
              value.cause,
              depth + 1,
              seen,
            ),
          }
        : {}),

      ...(value.details
        ? {
            details: sanitizeValue(
              value.details,
              depth + 1,
              seen,
            ),
          }
        : {}),

      ...(NODE_ENV !== "production" &&
      value.stack
        ? {
            stack: value.stack,
          }
        : {}),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) =>
        sanitizeValue(
          item,
          depth + 1,
          seen,
        ),
      );
    }

    const output = {};

    for (const [
      key,
      nestedValue,
    ] of Object.entries(value)) {
      if (
        SENSITIVE_KEY_PATTERN.test(
          String(key),
        )
      ) {
        output[key] = "[redacted]";
        continue;
      }

      output[key] = sanitizeValue(
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
 * Sanitize structured metadata.
 *
 * @param {*} metadata
 * @returns {object}
 */
function sanitizeMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== "object"
  ) {
    return {};
  }

  const sanitized =
    sanitizeValue(metadata);

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
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} metadata
 */
function writeLog(
  level,
  message,
  metadata = {},
) {
  const safeMetadata =
    sanitizeMetadata(metadata);

  try {
    if (
      logger &&
      typeof logger[level] === "function"
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
      console &&
      typeof console[level] === "function"
    ) {
      console[level](
        message,
        safeMetadata,
      );
    }
  } catch {
    // Logging must never become a process-failure source.
  }
}

function logDebug(
  message,
  metadata = {},
) {
  writeLog(
    "debug",
    message,
    metadata,
  );
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
 * Validate the runtime contract required by TITech.
 *
 * @returns {Readonly<object>}
 * @throws {Error}
 */
function validateRuntime() {
  const nodeVersion =
    process.versions?.node ||
    process.version;

  const nodeMajor = Number(
    String(nodeVersion).split(".")[0],
  );

  if (
    !Number.isInteger(nodeMajor) ||
    nodeMajor < MIN_NODE_MAJOR
  ) {
    const error = new Error(
      `${EFFECTIVE_APPLICATION_NAME} requires Node.js ${MIN_NODE_MAJOR}+. ` +
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
        typeof globalThis.structuredClone ===
        "function",

      fetch:
        typeof globalThis.fetch ===
        "function",

      AbortController:
        typeof globalThis.AbortController ===
        "function",

      URL:
        typeof globalThis.URL ===
        "function",

      setTimeout:
        typeof globalThis.setTimeout ===
        "function",

      queueMicrotask:
        typeof globalThis.queueMicrotask ===
        "function",
    });

  const missingFeatures =
    Object.entries(requiredFeatures)
      .filter(
        ([, available]) => !available,
      )
      .map(([name]) => name);

  if (missingFeatures.length > 0) {
    const error = new Error(
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
    const error = new Error(
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
    const error = new Error(
      `Unsupported architecture: ${process.arch}`,
    );

    error.code =
      "TITECH_UNSUPPORTED_ARCHITECTURE";

    throw error;
  }

  return Object.freeze({
    nodeVersion,
    nodeMajor,
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
    cpuCount:
      os.cpus()?.length || 1,
    pid: process.pid,
    ppid: process.ppid,
    execPath: process.execPath,
  });
}

/* =============================================================================
 * ENVIRONMENT STATE
 * =============================================================================
 */

/**
 * @returns {Readonly<object>}
 */
function getEnvironmentState() {
  const envFileError =
    dotenvResult?.error || null;

  const envFileExists =
    envFileError === null ||
    envFileError.code !== "ENOENT";

  return Object.freeze({
    application:
      EFFECTIVE_APPLICATION_NAME,

    nodeEnv:
      NODE_ENV,

    serviceName:
      SERVICE_NAME,

    envFileExists,

    envFileLoaded:
      Boolean(
        dotenvResult &&
          !dotenvResult.error,
      ),

    envFileError:
      envFileError
        ? {
            name:
              envFileError.name,

            code:
              envFileError.code,

            message:
              envFileError.message,
          }
        : null,
  });
}

/* =============================================================================
 * ROUTE COMPOSITION CONTRACT
 * =============================================================================
 */

/**
 * server.js does not register routes.
 *
 * This object exists only as declarative metadata for the canonical
 * bootstrap layer.
 *
 * @returns {Readonly<object>}
 */
function createRouteComposition() {
  return Object.freeze({
    version: "1.0",

    register: null,

    description:
      "Canonical route composition is owned by ApplicationBootstrap.",
  });
}

/* =============================================================================
 * CANONICAL BOOTSTRAP LOADER
 * =============================================================================
 */

/**
 * Load the single canonical ApplicationBootstrap implementation.
 *
 * Supported exports:
 *
 *   export class ApplicationBootstrap {}
 *
 * or:
 *
 *   export default ApplicationBootstrap;
 *
 * @returns {Promise<object>}
 * @throws {Error}
 */
async function loadBootstrapModule() {
  if (bootstrapModule) {
    return bootstrapModule;
  }

  const bootstrapUrl =
    new URL(
      BOOTSTRAP_MODULE_PATH,
      import.meta.url,
    );

  let loaded;

  try {
    loaded = await import(
      bootstrapUrl.href
    );
  } catch (error) {
    const diagnostic =
      new Error(
        "Unable to load TITech canonical bootstrap module.",
        {
          cause: error,
        },
      );

    diagnostic.code =
      "TITECH_BOOTSTRAP_MODULE_LOAD_FAILED";

    diagnostic.details = {
      module:
        BOOTSTRAP_MODULE_PATH,

      resolvedFrom:
        CURRENT_FILE,

      expectedPath:
        path.resolve(
          CURRENT_DIRECTORY,
          "bootstrap",
          "ApplicationBootstrap.js",
        ),

      originalError:
        sanitizeValue(error),
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
    loaded.ApplicationBootstrap ||
    loaded.default?.ApplicationBootstrap ||
    (
      typeof loaded.default ===
      "function"
        ? loaded.default
        : null
    );

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

    error.details = {
      availableExports:
        Object.keys(loaded),
    };

    throw error;
  }

  bootstrapModule =
    Object.freeze({
      ApplicationBootstrap,
    });

  return bootstrapModule;
}

/* =============================================================================
 * BOOTSTRAP INSTANCE
 * =============================================================================
 */

/**
 * Create the process-local ApplicationBootstrap singleton.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function getBootstrapInstance(
  options = {},
) {
  if (bootstrapInstance) {
    return bootstrapInstance;
  }

  const {
    ApplicationBootstrap,
  } = await loadBootstrapModule();

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
          cause: error,
        },
      );

    diagnostic.code =
      "TITECH_BOOTSTRAP_INSTANCE_CREATE_FAILED";

    diagnostic.details = {
      originalError:
        sanitizeValue(error),
    };

    throw diagnostic;
  }

  return bootstrapInstance;
}

/* =============================================================================
 * LOGGER ADOPTION
 * =============================================================================
 */

/**
 * Adopt a bootstrap-provided logger only when it satisfies the expected
 * logging contract.
 *
 * @param {*} candidate
 */
function adoptLogger(candidate) {
  if (
    !candidate ||
    typeof candidate !== "object"
  ) {
    return;
  }

  const supportedMethods = [
    "debug",
    "info",
    "warn",
    "error",
  ];

  const hasLoggerMethod =
    supportedMethods.some(
      (method) =>
        typeof candidate[method] ===
        "function",
    );

  if (hasLoggerMethod) {
    logger = candidate;
  }
}

/* =============================================================================
 * FATAL PROCESS ERROR HANDLING
 * =============================================================================
 */

/**
 * Handle an unrecoverable process-level error.
 *
 * ApplicationBootstrap owns graceful application shutdown.
 *
 * @param {string} type
 * @param {*} reason
 * @returns {Promise<void>}
 */
async function handleFatalProcessError(
  type,
  reason,
) {
  if (fatalHandlingStarted) {
    return;
  }

  fatalHandlingStarted = true;

  processStartupStatus =
    STARTUP_STATUS.FAILED;

  const error =
    reason instanceof Error
      ? reason
      : new Error(String(reason));

  logError(
    `TITech Community Capital ${type} detected.`,
    {
      application:
        EFFECTIVE_APPLICATION_NAME,

      serviceName:
        SERVICE_NAME,

      environment:
        NODE_ENV,

      startupId:
        STARTUP_ID,

      pid:
        process.pid,

      startupStatus:
        processStartupStatus,

      error:
        sanitizeValue(error),
    },
  );

  try {
    if (
      bootstrapInstance &&
      typeof bootstrapInstance.shutdown ===
        "function"
    ) {
      processStartupStatus =
        STARTUP_STATUS.STOPPING;

      await bootstrapInstance.shutdown(
        type,
      );
    }
  } catch (shutdownError) {
    logError(
      "TITech Community Capital fatal-error shutdown failed.",
      {
        application:
          EFFECTIVE_APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        startupId:
          STARTUP_ID,

        error:
          sanitizeValue(
            shutdownError,
          ),
      },
    );
  }

  processStartupStatus =
    STARTUP_STATUS.STOPPED;

  process.exitCode =
    FATAL_EXIT_CODE;

  /**
   * The process is unrecoverable.
   *
   * Explicit termination prevents continued execution in an undefined
   * state after an uncaught exception or unhandled rejection.
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
 * Install fatal process handlers exactly once.
 *
 * SIGTERM/SIGINT intentionally remain owned by ApplicationBootstrap.
 *
 * @returns {boolean}
 */
function installProcessHandlers() {
  if (processHandlersInstalled) {
    return false;
  }

  processHandlersInstalled = true;

  process.once(
    "uncaughtException",
    (error) => {
      void handleFatalProcessError(
        "uncaught exception",
        error,
      );
    },
  );

  process.once(
    "unhandledRejection",
    (reason) => {
      void handleFatalProcessError(
        "unhandled promise rejection",
        reason,
      );
    },
  );

  return true;
}

/* =============================================================================
 * BOOTSTRAP OPTIONS
 * =============================================================================
 */

/**
 * Construct immutable process/bootstrap metadata.
 *
 * server.js does NOT construct an Express application.
 *
 * @returns {Readonly<object>}
 */
function createBootstrapOptions() {
  return Object.freeze({
    applicationName:
      EFFECTIVE_APPLICATION_NAME,

    service:
      SERVICE_NAME,

    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

    startupId:
      STARTUP_ID,

    processId:
      process.pid,

    entryPoint:
      CURRENT_FILE,

    routeComposition:
      createRouteComposition(),
  });
}

/* =============================================================================
 * START APPLICATION
 * =============================================================================
 */

/**
 * Start TITech through the canonical ApplicationBootstrap.
 *
 * Concurrent calls share the same startup promise.
 *
 * IMPORTANT:
 *
 * ApplicationBootstrap remains the sole owner of application lifecycle state.
 *
 * @returns {Promise<*>}
 */
async function startServer() {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    processStartupStatus =
      STARTUP_STATUS.STARTING;

    const runtime =
      validateRuntime();

    const bootstrapOptions =
      createBootstrapOptions();

    logInfo(
      "Starting TITech Community Capital backend process.",
      {
        application:
          EFFECTIVE_APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        startupId:
          STARTUP_ID,

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

        ppid:
          runtime.ppid,

        entryPoint:
          CURRENT_FILE,

        workingDirectory:
          process.cwd(),

        envFileLoaded:
          Boolean(
            dotenvResult &&
              !dotenvResult.error,
          ),

        supportedSignals:
          PROCESS_SIGNALS,
      },
    );

    if (dotenvResult?.error) {
      const isMissingFile =
        dotenvResult.error.code ===
        "ENOENT";

      logWarn(
        isMissingFile
          ? "TITech .env file was not found. Startup will rely on the process environment and bootstrap configuration."
          : "TITech .env file could not be loaded. Startup will rely on the process environment and bootstrap configuration.",
        {
          startupId:
            STARTUP_ID,

          error:
            sanitizeValue(
              dotenvResult.error,
            ),
        },
      );
    }

    const bootstrap =
      await getBootstrapInstance(
        bootstrapOptions,
      );

    /**
     * Canonical bootstrap contract.
     *
     * IMPORTANT:
     *
     * ApplicationBootstrap MUST define the semantics of initialize() and
     * start(). server.js does not implement or duplicate those phases.
     */
    if (
      typeof bootstrap.initialize !==
      "function"
    ) {
      const error =
        new TypeError(
          "ApplicationBootstrap.initialize() is required by the TITech server entry-point contract.",
        );

      error.code =
        "TITECH_BOOTSTRAP_INITIALIZE_MISSING";

      throw error;
    }

    if (
      typeof bootstrap.start !==
      "function"
    ) {
      const error =
        new TypeError(
          "ApplicationBootstrap.start() is required by the TITech server entry-point contract.",
        );

      error.code =
        "TITECH_BOOTSTRAP_START_MISSING";

      throw error;
    }

    await bootstrap.initialize(
      bootstrapOptions,
    );

    const result =
      await bootstrap.start(
        bootstrapOptions,
      );

    adoptLogger(
      result?.logger,
    );

    adoptLogger(
      bootstrap.context?.logger,
    );

    adoptLogger(
      bootstrap.logger,
    );

    processStartupStatus =
      STARTUP_STATUS.READY;

    logInfo(
      "TITech Community Capital backend startup completed.",
      {
        application:
          EFFECTIVE_APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        startupId:
          STARTUP_ID,

        pid:
          process.pid,

        startupStatus:
          processStartupStatus,

        ready:
          bootstrap.ready ??
          bootstrap.isReady?.() ??
          true,
      },
    );

    return result;
  })();

  try {
    return await startupPromise;
  } catch (error) {
    processStartupStatus =
      STARTUP_STATUS.FAILED;

    logError(
      "TITech Community Capital backend startup failed.",
      {
        application:
          EFFECTIVE_APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        startupId:
          STARTUP_ID,

        startupStatus:
          processStartupStatus,

        error:
          sanitizeValue(error),
      },
    );

    /**
     * Do not silently imply that a partially initialized bootstrap can be
     * safely restarted. The canonical process should normally terminate
     * after startup failure.
     */
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
 * server.js never mutates application lifecycle state through this function.
 *
 * @returns {Readonly<object>}
 */
function getServerState() {
  if (bootstrapInstance) {
    try {
      if (
        typeof bootstrapInstance.snapshot ===
        "function"
      ) {
        return bootstrapInstance.snapshot();
      }

      if (
        typeof bootstrapInstance.getSnapshot ===
        "function"
      ) {
        return bootstrapInstance.getSnapshot();
      }
    } catch (error) {
      logDebug(
        "Unable to obtain canonical ApplicationBootstrap snapshot.",
        {
          startupId:
            STARTUP_ID,

          error:
            sanitizeValue(error),
        },
      );
    }
  }

  return Object.freeze({
    application:
      EFFECTIVE_APPLICATION_NAME,

    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

    startupId:
      STARTUP_ID,

    processStartupStatus,

    running:
      processStartupStatus ===
      STARTUP_STATUS.READY,

    pid:
      process.pid,

    processHandlersInstalled:
      processHandlersInstalled,

    fatalHandlingStarted:
      fatalHandlingStarted,

    bootstrapLoaded:
      Boolean(bootstrapModule),

    bootstrapInstantiated:
      Boolean(bootstrapInstance),
  });
}

/* =============================================================================
 * PROCESS STATE
 * =============================================================================
 */

/**
 * Return process-local diagnostics.
 *
 * Sensitive filesystem/environment information is deliberately excluded
 * from the public state object.
 *
 * @returns {Readonly<object>}
 */
function getProcessState() {
  return Object.freeze({
    application:
      EFFECTIVE_APPLICATION_NAME,

    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

    startupId:
      STARTUP_ID,

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

    nodeMajor:
      Number(
        process.versions.node.split(".")[0],
      ),

    entryPoint:
      CURRENT_FILE,

    processStartupStatus,

    processHandlersInstalled:
      processHandlersInstalled,

    fatalHandlingStarted:
      fatalHandlingStarted,

    bootstrapLoaded:
      Boolean(bootstrapModule),

    bootstrapInstantiated:
      Boolean(bootstrapInstance),

    startupInProgress:
      Boolean(startupPromise),
  });
}

/* =============================================================================
 * DIRECT EXECUTION DETECTION
 * =============================================================================
 */

/**
 * Determine whether backend/server.js is the direct Node.js entry point.
 *
 * ESM-safe equivalent of require.main === module.
 *
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    const entryPath =
      path.resolve(
        process.argv[1],
      );

    return (
      pathToFileURL(entryPath).href ===
      import.meta.url
    );
  } catch {
    return false;
  }
}

/* =============================================================================
 * PROCESS INITIALIZATION
 * =============================================================================
 *
 * Only fatal process protection is installed here.
 *
 * ApplicationBootstrap remains responsible for:
 *
 *   - SIGTERM
 *   - SIGINT
 *   - readiness
 *   - shutdown
 *   - dependency lifecycle
 *   - application state
 * =============================================================================
 */

installProcessHandlers();

/* =============================================================================
 * DIRECT EXECUTION
 * =============================================================================
 */

if (isDirectExecution()) {
  startServer().catch((error) => {
    logError(
      "TITech Community Capital backend process could not start.",
      {
        application:
          EFFECTIVE_APPLICATION_NAME,

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

        startupId:
          STARTUP_ID,

        startupStatus:
          processStartupStatus,

        error:
          sanitizeValue(error),
      },
    );

    processStartupStatus =
      STARTUP_STATUS.FAILED;

    process.exitCode =
      FATAL_EXIT_CODE;

    process.exit(
      FATAL_EXIT_CODE,
    );
  });
}

/* =============================================================================
 * ESM PUBLIC API
 * =============================================================================
 *
 * Keep the public surface deliberately small.
 */

export {
  startServer,
  validateRuntime,
  getEnvironmentState,
  getProcessState,
  getServerState,
  installProcessHandlers,
  createRouteComposition,
  loadBootstrapModule,
  getBootstrapInstance,
  isDirectExecution,
  STARTUP_STATUS,
};