<<<<<<< HEAD
=======
"use strict";

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 *   ES Modules (ESM)
=======
 *   CommonJS
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 *
 * =============================================================================
 */

<<<<<<< HEAD
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import dotenv from "dotenv";
=======
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const dotenv = require("dotenv");
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
const STARTUP_STATUS =
  Object.freeze({
    NOT_STARTED:
      "not_started",

    STARTING:
      "starting",

    READY:
      "ready",

    FAILED:
      "failed",

    STOPPING:
      "stopping",

    STOPPED:
      "stopped",
  });

/* =============================================================================
 * MODULE IDENTITY
 * =============================================================================
 */

const CURRENT_FILE =
  fileURLToPath(
    import.meta.url,
  );

const CURRENT_DIRECTORY =
  path.dirname(
    CURRENT_FILE,
  );

/**
 * Resolve .env relative to backend/server.js rather than process.cwd().
 *
 * An explicit TITECH_ENV_FILE takes precedence.
 */
const ENV_FILE =
  path.resolve(
    process.env.TITECH_ENV_FILE ||
      path.join(
        CURRENT_DIRECTORY,
        ".env",
      ),
=======
const ENV_FILE =
  path.resolve(
    process.cwd(),
    ".env",
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  );

/**
 * Canonical bootstrap implementation.
<<<<<<< HEAD
 */
const BOOTSTRAP_MODULE_PATH =
  "./bootstrap/ApplicationBootstrap.js";
=======
 *
 * Do NOT silently fall back to an alternative application factory.
 */
const BOOTSTRAP_MODULE_PATH =
  "./bootstrap/ApplicationBootstrap";
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/**
 * Signals are documented here for observability.
 *
<<<<<<< HEAD
 * Signal registration itself belongs to ApplicationBootstrap.
=======
 * Signal registration itself belongs to the canonical bootstrap lifecycle.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 */
const PROCESS_SIGNALS =
  Object.freeze([
    "SIGTERM",
    "SIGINT",
  ]);

/**
<<<<<<< HEAD
 * Metadata keys that should never be logged directly.
=======
 * Environment values that should never be logged directly.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|passcode|pin|otp|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret|jwt|mongo(uri)?|mongodb|redis|database|connection|string/i;

/* =============================================================================
 * ENVIRONMENT LOADING
 * =============================================================================
 */

<<<<<<< HEAD
let dotenvResult = {
  parsed:
    null,

  error:
    null,
};
=======
let dotenvResult;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

try {
  dotenvResult =
    dotenv.config({
<<<<<<< HEAD
      path:
        ENV_FILE,
    });
} catch (error) {
  dotenvResult = {
    parsed:
      null,

=======
      path: ENV_FILE,
    });
} catch (error) {
  dotenvResult = {
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    error,
  };
}

/**
<<<<<<< HEAD
 * Resolve identity AFTER dotenv.
=======
 * Resolve identity AFTER dotenv has been loaded.
 *
 * This allows SERVICE_NAME / OTEL_SERVICE_NAME / NODE_ENV to be supplied
 * through .env while still supporting externally injected process variables.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 */
const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  DEFAULT_SERVICE_NAME;

const NODE_ENV =
  process.env.NODE_ENV ||
  DEFAULT_NODE_ENV;

<<<<<<< HEAD
const EFFECTIVE_APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  APPLICATION_NAME;

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
/* =============================================================================
 * PROCESS-LOCAL STATE
 * =============================================================================
 *
<<<<<<< HEAD
 * These variables describe only the process entry point.
 *
 * Application lifecycle state remains owned by ApplicationBootstrap.
 * =============================================================================
 */

let bootstrapInstance =
  null;

let bootstrapModule =
  null;

let logger =
  console;

let processHandlersInstalled =
  false;

let fatalHandlingStarted =
  false;

let startupPromise =
  null;

let processStartupStatus =
  STARTUP_STATUS.NOT_STARTED;
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/* =============================================================================
 * SAFE SERIALIZATION
 * =============================================================================
 */

/**
 * Convert diagnostic values into safe, JSON-compatible values.
 *
<<<<<<< HEAD
=======
 * This function intentionally favors observability safety over perfect
 * serialization fidelity.
 *
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    depth >= 6
=======
    depth >= 5
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
      ...(value.code !==
        undefined
        ? {
            code:
              value.code,
          }
        : {}),

      ...(value.phase !==
        undefined
        ? {
            phase:
              value.phase,
          }
        : {}),

      ...(value.component !==
        undefined
        ? {
            component:
              value.component,
          }
        : {}),

      ...(value.cause
        ? {
            cause:
              sanitizeValue(
                value.cause,
                depth + 1,
                seen,
              ),
          }
        : {}),

      ...(value.details
        ? {
            details:
              sanitizeValue(
                value.details,
                depth + 1,
                seen,
              ),
          }
        : {}),

      ...(NODE_ENV !==
        "production" &&
=======
      code:
        value.code,

      ...(NODE_ENV !== "production" &&
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      value.stack
        ? {
            stack:
              value.stack,
          }
        : {}),
    };
  }

  if (
<<<<<<< HEAD
    typeof value ===
    "object"
  ) {
    if (
      seen.has(
        value,
      )
=======
    typeof value === "object"
  ) {
    if (
      seen.has(value)
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    ) {
      return "[circular]";
    }

<<<<<<< HEAD
    seen.add(
      value,
    );

    if (
      Array.isArray(
        value,
      )
=======
    seen.add(value);

    if (
      Array.isArray(value)
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
    const output =
      {};
=======
    const output = {};
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    for (
      const [
        key,
        nestedValue,
<<<<<<< HEAD
      ] of Object.entries(
        value,
      )
=======
      ] of Object.entries(value)
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    ) {
      if (
        SENSITIVE_KEY_PATTERN.test(
          String(key),
        )
      ) {
<<<<<<< HEAD
        output[key] =
          "[redacted]";

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * Sanitize diagnostic metadata.
=======
 * Sanitize an object containing diagnostic metadata.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 *
 * @param {*} metadata
 * @returns {object}
 */
function sanitizeMetadata(
  metadata,
) {
  if (
    !metadata ||
<<<<<<< HEAD
    typeof metadata !==
      "object"
=======
    typeof metadata !== "object"
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  ) {
    return {};
  }

  const sanitized =
    sanitizeValue(
      metadata,
    );

  if (
    sanitized &&
<<<<<<< HEAD
    typeof sanitized ===
      "object" &&
    !Array.isArray(
      sanitized,
    )
=======
    typeof sanitized === "object" &&
    !Array.isArray(sanitized)
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * @param {"debug"|"info"|"warn"|"error"} level
=======
 * Generic safe logger dispatcher.
 *
 * @param {"info"|"warn"|"error"} level
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
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

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      String(
        nodeVersion,
      ).split(".")[0],
    );

  if (
    !Number.isInteger(
      nodeMajor,
    ) ||
=======
      String(nodeVersion)
        .split(".")[0],
    );

  if (
    !Number.isInteger(nodeMajor) ||
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    nodeMajor < MIN_NODE_MAJOR
  ) {
    const error =
      new Error(
<<<<<<< HEAD
        `${EFFECTIVE_APPLICATION_NAME} requires Node.js ${MIN_NODE_MAJOR}+. ` +
=======
        `${APPLICATION_NAME} requires Node.js ${MIN_NODE_MAJOR}+. ` +
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          missingFeatures.join(
            ", ",
          ),
=======
          missingFeatures.join(", "),
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      os.cpus()?.length ||
      1,

    pid:
      process.pid,

    ppid:
      process.ppid,

    execPath:
      process.execPath,
=======
      os.cpus()?.length || 1,

    pid:
      process.pid,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  });
}

/* =============================================================================
 * ENVIRONMENT STATE
 * =============================================================================
 */

/**
<<<<<<< HEAD
=======
 * Return non-secret environment diagnostics.
 *
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 * @returns {Readonly<object>}
 */
function getEnvironmentState() {
  return Object.freeze({
    application:
<<<<<<< HEAD
      EFFECTIVE_APPLICATION_NAME,
=======
      APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    nodeEnv:
      NODE_ENV,

    serviceName:
      SERVICE_NAME,

    envFile:
      ENV_FILE,

<<<<<<< HEAD
    envFileExists:
      !Boolean(
        dotenvResult?.error,
      ) ||
      dotenvResult?.error?.code !==
        "ENOENT",

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    envFileLoaded:
      Boolean(
        dotenvResult &&
        !dotenvResult.error,
      ),

    envFileError:
      dotenvResult?.error
        ? {
            name:
<<<<<<< HEAD
              dotenvResult.error
                .name,

            code:
              dotenvResult.error
                .code,

            message:
              dotenvResult.error
                .message,
=======
              dotenvResult.error.name,

            code:
              dotenvResult.error.code,

            message:
              dotenvResult.error.message,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          }
        : null,
  });
}

/* =============================================================================
 * ROUTE COMPOSITION CONTRACT
 * =============================================================================
 */

<<<<<<< HEAD
=======
/**
 * Route composition remains owned by ApplicationBootstrap.
 *
 * The server entry point exposes only a declarative composition contract.
 * It does not register routes.
 *
 * @returns {Readonly<object>}
 */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * Load the single canonical ApplicationBootstrap implementation.
 *
 * @returns {Promise<object>}
 */
async function loadBootstrapModule() {
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  if (
    bootstrapModule
  ) {
    return bootstrapModule;
  }

  let loaded;

  try {
    loaded =
<<<<<<< HEAD
      await import(
        BOOTSTRAP_MODULE_PATH
=======
      require(
        BOOTSTRAP_MODULE_PATH,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
      resolvedFrom:
        CURRENT_FILE,

      expectedPath:
        path.resolve(
          CURRENT_DIRECTORY,
          "bootstrap",
          "ApplicationBootstrap.js",
        ),

      originalError:
        sanitizeValue(
          error,
        ),
=======
      originalError: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    };

    throw diagnostic;
  }

  if (
    !loaded ||
<<<<<<< HEAD
    typeof loaded !==
      "object"
=======
    typeof loaded !== "object"
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    loaded.ApplicationBootstrap ||
    loaded.default
      ?.ApplicationBootstrap ||
    (
      typeof loaded.default ===
      "function"
        ? loaded.default
        : null
    );
=======
    loaded.ApplicationBootstrap;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
    error.details = {
      availableExports:
        Object.keys(
          loaded,
        ),
    };

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    throw error;
  }

  bootstrapModule =
<<<<<<< HEAD
    Object.freeze({
      ...loaded,

      ApplicationBootstrap,
    });
=======
    loaded;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  return bootstrapModule;
}

/* =============================================================================
 * BOOTSTRAP INSTANCE
 * =============================================================================
 */

/**
<<<<<<< HEAD
 * @param {object} options
 * @returns {Promise<object>}
 */
async function getBootstrapInstance(
=======
 * Create the singleton ApplicationBootstrap instance.
 *
 * The singleton belongs to this process entry point only.
 * Application lifecycle state remains owned by ApplicationBootstrap.
 *
 * @param {object} options
 * @returns {object}
 */
function getBootstrapInstance(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    await loadBootstrapModule();
=======
    loadBootstrapModule();
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
      originalError:
        sanitizeValue(
          error,
        ),
=======
      originalError: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
=======
 * Handle an unrecoverable process-level error.
 *
 * ApplicationBootstrap remains responsible for graceful application shutdown.
 *
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
  processStartupStatus =
    STARTUP_STATUS.FAILED;

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  const error =
    reason instanceof Error
      ? reason
      : new Error(
<<<<<<< HEAD
          String(
            reason,
          ),
=======
          String(reason),
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        );

  logError(
    `TITech Community Capital ${type} detected.`,
    {
      application:
<<<<<<< HEAD
        EFFECTIVE_APPLICATION_NAME,
=======
        APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

      serviceName:
        SERVICE_NAME,

      environment:
        NODE_ENV,

<<<<<<< HEAD
      pid:
        process.pid,

      startupStatus:
        processStartupStatus,

      error:
        sanitizeValue(
          error,
        ),
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      processStartupStatus =
        STARTUP_STATUS.STOPPING;

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      await bootstrap.shutdown(
        type,
      );
    }
  } catch (shutdownError) {
    logError(
      "TITech Community Capital fatal-error shutdown failed.",
      {
<<<<<<< HEAD
        error:
          sanitizeValue(
            shutdownError,
          ),
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      },
    );
  }

<<<<<<< HEAD
  processStartupStatus =
    STARTUP_STATUS.STOPPED;

  process.exitCode =
    FATAL_EXIT_CODE;

=======
  process.exitCode =
    FATAL_EXIT_CODE;

  /**
   * Do not throw here.
   *
   * This handler is invoked because the process is already in an
   * unrecoverable state. Explicit termination prevents the process from
   * continuing in an undefined condition.
   */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * SIGTERM/SIGINT are deliberately not handled here because canonical
 * lifecycle ownership belongs to ApplicationBootstrap.
=======
 * Signal handlers are intentionally NOT installed here.
 * SIGTERM/SIGINT lifecycle ownership remains inside ApplicationBootstrap.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
  process.once(
=======
  process.on(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    "uncaughtException",
    error => {
      void handleFatalProcessError(
        "uncaught exception",
        error,
      );
    },
  );

<<<<<<< HEAD
  process.once(
=======
  process.on(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * BOOTSTRAP OPTIONS
 * =============================================================================
 */

/**
 * IMPORTANT CONTRACT:
 *
 *   applicationName
 *       = metadata string
 *
 *   application
 *       = actual Express application
 *
 * server.js deliberately does NOT create an Express application.
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

    routeComposition:
      createRouteComposition(),
  });
}

/* =============================================================================
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 * START APPLICATION
 * =============================================================================
 */

/**
 * Start the TITech application through the canonical bootstrap orchestrator.
 *
<<<<<<< HEAD
 * Multiple concurrent calls share the same startup promise.
=======
 * Multiple concurrent calls return the same startup promise.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      processStartupStatus =
        STARTUP_STATUS.STARTING;

      const runtime =
        validateRuntime();

      const bootstrapOptions =
        createBootstrapOptions();
=======
      const runtime =
        validateRuntime();

      const routeComposition =
        createRouteComposition();
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

      logInfo(
        "Starting TITech Community Capital backend process.",
        {
          application:
<<<<<<< HEAD
            EFFECTIVE_APPLICATION_NAME,
=======
            APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
          ppid:
            runtime.ppid,

          entryFile:
            CURRENT_FILE,

          workingDirectory:
            process.cwd(),

          envFile:
            ENV_FILE,

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          envFileLoaded:
            Boolean(
              dotenvResult &&
              !dotenvResult.error,
            ),

          supportedSignals:
            PROCESS_SIGNALS,
        },
      );

<<<<<<< HEAD
      if (
        dotenvResult?.error
      ) {
        const isMissingFile =
          dotenvResult.error
            ?.code ===
          "ENOENT";

        logWarn(
          isMissingFile
            ? "TITech .env file was not found. Startup will rely on the process environment and bootstrap configuration."
            : "TITech .env file could not be loaded. Startup will rely on the process environment and bootstrap configuration.",
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          {
            envFile:
              ENV_FILE,

            error:
<<<<<<< HEAD
              {
                name:
                  dotenvResult.error
                    ?.name,

                code:
                  dotenvResult.error
                    ?.code,

                message:
                  dotenvResult.error
                    ?.message,
              },
=======
              dotenvResult.error,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          },
        );
      }

      const bootstrap =
<<<<<<< HEAD
        await getBootstrapInstance(
          bootstrapOptions,
        );

      await bootstrap.initialize(
        bootstrapOptions,
      );

      const result =
        await bootstrap.start(
          bootstrapOptions,
        );

      logger =
        result?.logger ||
        bootstrap.context?.logger ||
        bootstrap.logger ||
        logger;

      processStartupStatus =
        STARTUP_STATUS.READY;

=======
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

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      logInfo(
        "TITech Community Capital backend startup completed.",
        {
          application:
<<<<<<< HEAD
            EFFECTIVE_APPLICATION_NAME,
=======
            APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

          serviceName:
            SERVICE_NAME,

          environment:
            NODE_ENV,

          pid:
            process.pid,

          state:
<<<<<<< HEAD
            bootstrap.state ||
            bootstrap.context?.state ||
            bootstrap.getState?.()?.started
              ? "started"
              : "ready",

          ready:
            bootstrap.ready ??
            bootstrap.isReady?.() ??
            true,

          startupStatus:
            processStartupStatus,
=======
            bootstrap.state,

          ready:
            bootstrap.ready,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );

      return result;
    })();

  try {
    return await startupPromise;
  } catch (error) {
<<<<<<< HEAD
    startupPromise =
      null;

    processStartupStatus =
      STARTUP_STATUS.FAILED;

=======
    /**
     * Permit a future explicit retry in environments where the process
     * remains alive after a startup failure.
     *
     * ApplicationBootstrap remains responsible for cleaning up anything
     * it initialized before the failure.
     */
    startupPromise =
      null;

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    logError(
      "TITech Community Capital backend startup failed.",
      {
        application:
<<<<<<< HEAD
          EFFECTIVE_APPLICATION_NAME,
=======
          APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

        serviceName:
          SERVICE_NAME,

        environment:
          NODE_ENV,

<<<<<<< HEAD
        startupStatus:
          processStartupStatus,

        error:
          sanitizeValue(
            error,
          ),
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      },
    );

    throw error;
  }
}

/* =============================================================================
 * OPERATIONAL STATE
 * =============================================================================
 */

<<<<<<< HEAD
=======
/**
 * Return canonical bootstrap state where available.
 *
 * This function never creates or mutates application state.
 *
 * @returns {Readonly<object>}
 */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD

      if (
        typeof bootstrapInstance.getSnapshot ===
        "function"
      ) {
        return bootstrapInstance.getSnapshot();
      }
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    } catch {
      // Fall through to process-entry state.
    }
  }

  return Object.freeze({
    application:
<<<<<<< HEAD
      EFFECTIVE_APPLICATION_NAME,
=======
      APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

<<<<<<< HEAD
    processStartupStatus,

    running:
      processStartupStatus ===
      STARTUP_STATUS.READY,
=======
    running:
      false,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
function getProcessState() {
  return Object.freeze({
    application:
      EFFECTIVE_APPLICATION_NAME,
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
    nodeMajor:
      Number(
        process.versions.node
          .split(".")[0],
      ),

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    nodeEnv:
      NODE_ENV,

    serviceName:
      SERVICE_NAME,

<<<<<<< HEAD
    entryFile:
      CURRENT_FILE,

    currentDirectory:
      CURRENT_DIRECTORY,

    workingDirectory:
      process.cwd(),

    execPath:
      process.execPath,

    processStartupStatus,

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * DIRECT EXECUTION DETECTION
 * =============================================================================
 */

function isDirectExecution() {
  if (
    !process.argv[1]
  ) {
    return false;
  }

  try {
    const entryPath =
      path.resolve(
        process.argv[1],
      );

    return (
      pathToFileURL(
        entryPath,
      ).href ===
      import.meta.url
    );
  } catch {
    return false;
  }
}

/* =============================================================================
 * PROCESS INITIALIZATION
 * =============================================================================
=======
 * PROCESS INITIALIZATION
 * =============================================================================
 *
 * Install only fatal-error protection here.
 *
 * SIGTERM/SIGINT ownership remains inside the canonical bootstrap lifecycle.
 * =============================================================================
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 */

installProcessHandlers();

/* =============================================================================
 * DIRECT EXECUTION
 * =============================================================================
 */

if (
<<<<<<< HEAD
  isDirectExecution()
) {
  startServer().catch(
    error => {
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      logError(
        "TITech Community Capital backend process could not start.",
        {
          application:
<<<<<<< HEAD
            EFFECTIVE_APPLICATION_NAME,
=======
            APPLICATION_NAME,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

          serviceName:
            SERVICE_NAME,

          environment:
            NODE_ENV,

<<<<<<< HEAD
          startupStatus:
            processStartupStatus,

          error:
            sanitizeValue(
              error,
            ),
        },
      );

      processStartupStatus =
        STARTUP_STATUS.FAILED;

=======
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

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      process.exitCode =
        FATAL_EXIT_CODE;

      process.exit(
        FATAL_EXIT_CODE,
      );
    },
  );
}

/* =============================================================================
<<<<<<< HEAD
 * ESM EXPORTS
 * =============================================================================
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
=======
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
