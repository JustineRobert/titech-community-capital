"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/db.js
 *
 * Purpose:
 *   Enterprise production-grade MongoDB/Mongoose connection configuration and
 *   lifecycle adapter.
 *
 * Responsibilities:
 *   - Resolve MongoDB connection configuration from the canonical TITech config.
 *   - Validate MongoDB connection URIs.
 *   - Establish a single MongoDB connection.
 *   - Prevent duplicate/concurrent connection attempts.
 *   - Support controlled retry with exponential backoff and jitter.
 *   - Expose readiness and health state.
 *   - Handle runtime MongoDB connection events.
 *   - Support graceful shutdown.
 *   - Never call process.exit() from the database module.
 *   - Integrate with TITech logging, observability and readiness.
 *   - Preserve compatibility with existing connectDB() consumers.
 *
 * IMPORTANT:
 *
 *   This module owns MongoDB CONNECTION LIFECYCLE.
 *
 *   It does NOT:
 *     - define Mongoose models.
 *     - execute business queries.
 *     - implement repositories.
 *     - implement financial transactions.
 *     - implement ledger operations.
 *     - implement idempotency logic.
 *     - decide application process exit behavior.
 *
 *   Application/bootstrap orchestration owns process termination.
 *
 * =============================================================================
 */

const fs = require("node:fs");
const mongoose = require("mongoose");

/**
 * =============================================================================
 * Logger
 * =============================================================================
 */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule = require("../utils/logger");
} catch {
  loggerModule = null;
}

/**
 * =============================================================================
 * Canonical configuration
 * =============================================================================
 */

let configProvider = null;

try {
  // eslint-disable-next-line global-require
  configProvider = require("./configProvider");
} catch {
  configProvider = null;
}

let baseConfig = null;

try {
  // eslint-disable-next-line global-require
  baseConfig = require("./index");
} catch {
  baseConfig = null;
}

/**
 * =============================================================================
 * Optional readiness integration
 * =============================================================================
 */

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule = require("../bootstrap/readinessState");
} catch {
  readinessModule = null;
}

/**
 * =============================================================================
 * Optional observability integration
 * =============================================================================
 */

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule = require("../bootstrap/observability");
} catch {
  observabilityModule = null;
}

/**
 * =============================================================================
 * Optional startup error integration
 * =============================================================================
 */

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors = require("../bootstrap/startupErrors");
} catch {
  startupErrors = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT = "database";

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  "titech-community-capital-backend";

const APPLICATION_NAME =
  process.env.APP_NAME ||
  "TITech Community Capital";

const DATABASE_STATES = Object.freeze({
  CREATED: "created",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  DEGRADED: "degraded",
  STOPPING: "stopping",
  STOPPED: "stopped",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const DEFAULTS = Object.freeze({
  nodeEnv: "development",

  databaseName: "titech",

  gracefulStartup: false,

  skipChecks: false,

  maxRetries: 5,

  initialRetryDelayMs: 2_000,

  maxRetryDelayMs: 30_000,

  retryJitterRatio: 0.10,

  connectTimeoutMs: 30_000,

  serverSelectionTimeoutMS: 10_000,

  socketTimeoutMS: 45_000,

  heartbeatFrequencyMS: 10_000,

  maxPoolSize: 10,

  minPoolSize: 2,

  maxConnecting: 2,

  autoIndex: false,

  autoCreate: false,

  retryWrites: true,

  directConnection: false,

  shutdownTimeoutMs: 30_000,

  healthTimeoutMs: 5_000,

  retryOnTransientErrors: true,

  fallbackEnabled: false,

  fallbackMaxRetries: 2,
});

const DEFAULT_DATABASE_URI = null;
const DEFAULT_FALLBACK_URI = null;

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class DatabaseConfigError extends Error {
  constructor(message, options = {}) {
    super(
      typeof message === "string" && message.trim()
        ? message
        : "TITech database configuration error.",
    );

    this.name = "DatabaseConfigError";

    this.code =
      options.code ||
      "DATABASE_CONFIG_ERROR";

    this.phase =
      options.phase ||
      null;

    this.cause =
      options.cause ||
      null;

    this.retryable =
      options.retryable ??
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    Error.captureStackTrace?.(
      this,
      DatabaseConfigError,
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function getLogger() {
  try {
    return (
      loggerModule?.getLogger?.() ||
      loggerModule?.logger ||
      loggerModule?.default ||
      loggerModule ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Structured logging helper.
 *
 * TITech bootstrap logging uses the Pino-compatible form:
 *
 *   logger.info(metadata, message)
 *
 * Keep this contract here so database logging does not accidentally turn
 * structured metadata into "[object Object]" or character-indexed strings.
 */
function log(
  level,
  payload = {},
  message = undefined,
) {
  const logger = getLogger();

  const metadata = {
    component: COMPONENT,
    service: SERVICE_NAME,
    application: APPLICATION_NAME,
    ...(payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
      ? payload
      : {}),
  };

  try {
    if (
      logger &&
      typeof logger[level] === "function"
    ) {
      if (message !== undefined) {
        logger[level](
          metadata,
          message,
        );
      } else {
        logger[level](metadata);
      }

      return;
    }
  } catch {
    // Logging must never break database lifecycle.
  }

  try {
    const fallbackMessage =
      message !== undefined
        ? message
        : metadata;

    if (
      level === "error" ||
      level === "fatal"
    ) {
      console.error(
        fallbackMessage,
        message !== undefined
          ? metadata
          : "",
      );
    } else if (
      level === "warn"
    ) {
      console.warn(
        fallbackMessage,
        message !== undefined
          ? metadata
          : "",
      );
    } else {
      console.log(
        fallbackMessage,
        message !== undefined
          ? metadata
          : "",
      );
    }
  } catch {
    // Logging remains non-fatal even if console I/O is unavailable.
  }
}

/**
 * =============================================================================
 * Environment helpers
 * =============================================================================
 */

function env(
  name,
  fallback = undefined,
) {
  const value = process.env[name];

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  return String(value).trim();
}

function asBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      "1",
      "true",
      "yes",
      "on",
      "enabled",
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      "0",
      "false",
      "no",
      "off",
      "disabled",
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

function asPositiveInteger(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function asFloat(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function sleep(
  milliseconds,
) {
  return new Promise(
    (resolve) => {
      const timer = setTimeout(
        resolve,
        Math.max(
          0,
          Number.isFinite(milliseconds)
            ? milliseconds
            : 0,
        ),
      );

      timer.unref?.();
    },
  );
}

function elapsedMs(
  startedAt,
) {
  return (
    Number(
      process.hrtime.bigint() -
        startedAt,
    ) / 1_000_000
  );
}

function normalizeError(
  error,
) {
  if (error instanceof Error) {
    return error;
  }

  const normalized = new Error(
    error?.message ||
      String(error),
  );

  if (error?.name) {
    normalized.name =
      String(error.name);
  }

  if (error?.code) {
    normalized.code =
      error.code;
  }

  if (
    error?.statusCode !==
    undefined
  ) {
    normalized.statusCode =
      error.statusCode;
  }

  return normalized;
}

/**
 * =============================================================================
 * Safe error serialization
 * =============================================================================
 *
 * IMPORTANT:
 *
 * This function must NEVER throw.
 *
 * It is used from failure paths, including database connection failures.
 * The previous implementation referenced safeError() without defining it,
 * which masked the real MongoDB error with:
 *
 *   ReferenceError: safeError is not defined
 *
 * This implementation intentionally:
 *
 *   - normalizes unknown values
 *   - strips credentials from MongoDB URIs
 *   - avoids exposing arbitrary error properties
 *   - preserves name/code/message
 *   - reports retryability
 *   - is safe for logging and telemetry
 *
 * =============================================================================
 */

function sanitizeSensitiveText(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  let text;

  try {
    text = String(value);
  } catch {
    return "[unserializable]";
  }

  /**
   * Hide mongodb:// and mongodb+srv:// credentials appearing in messages.
   */
  text = text.replace(
    /(mongodb(?:\+srv)?:\/\/)([^/\s:@]+)(?::[^@\s]*)?@/gi,
    "$1***:***@",
  );

  /**
   * Hide common credential-style query parameters.
   */
  text = text.replace(
    /([?&](?:password|passwd|pwd|secret|token|access_token)=)[^&\s]*/gi,
    "$1***",
  );

  return text;
}

function safeError(
  error,
  options = {},
) {
  try {
    if (
      error === null ||
      error === undefined
    ) {
      return null;
    }

    const normalized =
      normalizeError(error);

    const result = {
      name:
        sanitizeSensitiveText(
          normalized.name ||
            "Error",
        ),

      code:
        normalized.code ??
        null,

      message:
        sanitizeSensitiveText(
          normalized.message ||
            "Unknown database error.",
        ),

      retryable:
        typeof options.retryable ===
        "boolean"
          ? options.retryable
          : null,

      phase:
        options.phase ||
        null,
    };

    if (
      normalized.statusCode !==
      undefined &&
      normalized.statusCode !==
      null
    ) {
      result.statusCode =
        normalized.statusCode;
    }

    /**
     * DatabaseConfigError details are deliberately copied only when they are
     * already structured plain data.
     */
    if (
      normalized.details &&
      typeof normalized.details ===
        "object" &&
      !Array.isArray(
        normalized.details,
      )
    ) {
      result.details = {
        ...normalized.details,
        masked:
          normalized.details.masked
            ? maskCredentials(
                normalized.details.masked,
              )
            : normalized.details.masked,
      };
    }

    /**
     * Development diagnostics may include a stack.
     *
     * Production telemetry receives no raw stack through this helper.
     * StartupErrors retains the actual Error/cause separately when required.
     */
    if (
      !isProduction() &&
      options.includeStack !== false &&
      normalized.stack
    ) {
      result.stack =
        sanitizeSensitiveText(
          normalized.stack,
        );
    }

    return Object.freeze(
      result,
    );
  } catch {
    /**
     * Last-resort guarantee: failure serialization must never become
     * the database failure.
     */
    return Object.freeze({
      name: "Error",
      code:
        "DATABASE_ERROR_SERIALIZATION_FAILED",
      message:
        "An internal database error occurred.",
      retryable: null,
      phase:
        options.phase ||
        null,
    });
  }
}

function withTimeout(
  fn,
  timeoutMs,
  label,
) {
  const boundedTimeout =
    asPositiveInteger(
      timeoutMs,
      30_000,
    );

  let timer = null;

  const operation =
    Promise.resolve().then(
      fn,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new DatabaseConfigError(
                `${label} timed out after ${boundedTimeout}ms.`,
                {
                  code:
                    "DATABASE_OPERATION_TIMEOUT",
                  details: {
                    timeoutMs:
                      boundedTimeout,
                  },
                },
              ),
            );
          },
          boundedTimeout,
        );

        timer.unref?.();
      },
    );

  return Promise.race([
    operation,
    timeout,
  ]).finally(
    () => {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    },
  );
}

/**
 * =============================================================================
 * Docker / container detection
 * =============================================================================
 */

function isDockerEnvironment() {
  const explicit = env(
    "DOCKER",
  );

  if (
    explicit !== undefined &&
    explicit !== null
  ) {
    return asBoolean(
      explicit,
      false,
    );
  }

  try {
    const cgroup =
      fs.readFileSync(
        "/proc/self/cgroup",
        "utf8",
      );

    return /docker|containerd|kubernetes|kubepods/i.test(
      cgroup,
    );
  } catch {
    return false;
  }
}

/**
 * =============================================================================
 * Environment helpers
 * =============================================================================
 */

function getNodeEnvironment() {
  return (
    configProvider?.getEnvironment?.() ||
    baseConfig?.environment ||
    process.env.NODE_ENV ||
    DEFAULTS.nodeEnv
  );
}

function isProduction() {
  return (
    getNodeEnvironment() ===
    "production"
  );
}

function isDevelopment() {
  return (
    getNodeEnvironment() ===
    "development"
  );
}

function isTest() {
  return (
    getNodeEnvironment() ===
    "test"
  );
}

/**
 * =============================================================================
 * Configuration resolution
 * =============================================================================
 */

function getRawDatabaseConfig() {
  try {
    const provider =
      configProvider?.getDatabaseConfig?.();

    if (
      provider &&
      typeof provider ===
        "object"
    ) {
      return provider;
    }
  } catch {
    // Fall through to base configuration.
  }

  try {
    if (
      baseConfig?.database &&
      typeof baseConfig.database ===
        "object"
    ) {
      return baseConfig.database;
    }

    if (
      baseConfig?.db &&
      typeof baseConfig.db ===
        "object"
    ) {
      return baseConfig.db;
    }
  } catch {
    // Return an empty configuration below.
  }

  return {};
}

function createDatabaseConfig(
  options = {},
) {
  const raw =
    getRawDatabaseConfig();

  const nodeEnv =
    options.nodeEnv ||
    raw.environment ||
    getNodeEnvironment();

  const docker =
    options.inDocker ??
    isDockerEnvironment();

  const production =
    nodeEnv ===
    "production";

  const gracefulStartup =
    options.gracefulStartup ??
    asBoolean(
      raw.gracefulStartup ??
        env(
          "GRACEFUL_STARTUP",
        ),
      production
        ? DEFAULTS.gracefulStartup
        : true,
    );

  const skipChecks =
    options.skipChecks ??
    asBoolean(
      raw.skipChecks ??
        env(
          "SKIP_DB_CHECKS",
        ),
      false,
    );

  const primaryUri =
    options.uri ||
    raw.uri ||
    env("MONGO_URI") ||
    env("MONGODB_URI") ||
    DEFAULT_DATABASE_URI;

  const fallbackUri =
    options.fallbackUri ||
    raw.fallbackUri ||
    env("MONGO_URI_FALLBACK") ||
    env("MONGODB_URI_FALLBACK") ||
    DEFAULT_FALLBACK_URI;

  const fallbackEnabled =
    options.fallbackEnabled ??
    asBoolean(
      raw.fallbackEnabled ??
        env(
          "MONGO_FALLBACK_ENABLED",
        ),
      production
        ? false
        : DEFAULTS.fallbackEnabled,
    );

  const config = {
    component:
      COMPONENT,

    serviceName:
      raw.serviceName ||
      SERVICE_NAME,

    applicationName:
      raw.applicationName ||
      APPLICATION_NAME,

    nodeEnv,

    production,

    development:
      nodeEnv === "development",

    staging:
      nodeEnv === "staging",

    test:
      nodeEnv === "test",

    inDocker: docker,

    enabled:
      options.enabled ??
      asBoolean(
        raw.enabled ??
          env(
            "DATABASE_ENABLED",
          ),
        true,
      ),

    required:
      options.required ??
      asBoolean(
        raw.required ??
          env(
            "DATABASE_REQUIRED",
          ),
        true,
      ),

    gracefulStartup,

    skipChecks,

    uri: primaryUri,

    fallbackUri,

    fallbackEnabled,

    databaseName:
      options.databaseName ||
      raw.name ||
      env(
        "MONGODB_DB_NAME",
      ) ||
      env(
        "MONGO_DATABASE",
      ) ||
      DEFAULTS.databaseName,

    maxRetries:
      asPositiveInteger(
        options.maxRetries ??
          raw.maxRetries ??
          env(
            "MONGO_MAX_RETRIES",
          ),
        DEFAULTS.maxRetries,
      ),

    initialRetryDelayMs:
      asPositiveInteger(
        options.initialRetryDelayMs ??
          raw.initialRetryDelayMs ??
          env(
            "MONGO_INITIAL_RETRY_DELAY_MS",
          ),
        DEFAULTS.initialRetryDelayMs,
      ),

    maxRetryDelayMs:
      asPositiveInteger(
        options.maxRetryDelayMs ??
          raw.maxRetryDelayMs ??
          env(
            "MONGO_MAX_RETRY_DELAY_MS",
          ),
        DEFAULTS.maxRetryDelayMs,
      ),

    retryJitterRatio:
      Math.min(
        Math.max(
          asFloat(
            options.retryJitterRatio ??
              raw.retryJitterRatio ??
              env(
                "MONGO_RETRY_JITTER_RATIO",
              ),
            DEFAULTS.retryJitterRatio,
          ),
          0,
        ),
        1,
      ),

    connectTimeoutMs:
      asPositiveInteger(
        options.connectTimeoutMs ??
          raw.connectTimeoutMs ??
          env(
            "MONGO_CONNECT_TIMEOUT_MS",
          ),
        DEFAULTS.connectTimeoutMs,
      ),

    serverSelectionTimeoutMS:
      asPositiveInteger(
        options.serverSelectionTimeoutMS ??
          raw.serverSelectionTimeoutMS ??
          env(
            "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
          ),
        DEFAULTS.serverSelectionTimeoutMS,
      ),

    socketTimeoutMS:
      asPositiveInteger(
        options.socketTimeoutMS ??
          raw.socketTimeoutMS ??
          env(
            "MONGODB_SOCKET_TIMEOUT_MS",
          ),
        DEFAULTS.socketTimeoutMS,
      ),

    heartbeatFrequencyMS:
      asPositiveInteger(
        options.heartbeatFrequencyMS ??
          raw.heartbeatFrequencyMS ??
          env(
            "MONGODB_HEARTBEAT_FREQUENCY_MS",
          ),
        DEFAULTS.heartbeatFrequencyMS,
      ),

    maxPoolSize:
      asPositiveInteger(
        options.maxPoolSize ??
          raw.maxPoolSize ??
          env(
            "MONGODB_MAX_POOL_SIZE",
          ),
        DEFAULTS.maxPoolSize,
      ),

    minPoolSize:
      asPositiveInteger(
        options.minPoolSize ??
          raw.minPoolSize ??
          env(
            "MONGODB_MIN_POOL_SIZE",
          ),
        DEFAULTS.minPoolSize,
      ),

    maxConnecting:
      asPositiveInteger(
        options.maxConnecting ??
          raw.maxConnecting ??
          env(
            "MONGODB_MAX_CONNECTING",
          ),
        DEFAULTS.maxConnecting,
      ),

    autoIndex:
      options.autoIndex ??
      raw.autoIndex ??
      asBoolean(
        env(
          "MONGODB_AUTO_INDEX",
        ),
        nodeEnv !== "production",
      ),

    autoCreate:
      options.autoCreate ??
      raw.autoCreate ??
      asBoolean(
        env(
          "MONGODB_AUTO_CREATE",
        ),
        nodeEnv !== "production",
      ),

    retryWrites:
      options.retryWrites ??
      raw.retryWrites ??
      asBoolean(
        env(
          "MONGODB_RETRY_WRITES",
        ),
        DEFAULTS.retryWrites,
      ),

    directConnection:
      options.directConnection ??
      raw.directConnection ??
      asBoolean(
        env(
          "MONGODB_DIRECT_CONNECTION",
        ),
        DEFAULTS.directConnection,
      ),

    shutdownTimeoutMs:
      asPositiveInteger(
        options.shutdownTimeoutMs ??
          raw.shutdownTimeoutMs ??
          env(
            "DATABASE_SHUTDOWN_TIMEOUT_MS",
          ),
        DEFAULTS.shutdownTimeoutMs,
      ),

    healthTimeoutMs:
      asPositiveInteger(
        options.healthTimeoutMs ??
          raw.healthTimeoutMs ??
          env(
            "DATABASE_HEALTH_TIMEOUT_MS",
          ),
        DEFAULTS.healthTimeoutMs,
      ),

    retryOnTransientErrors:
      options.retryOnTransientErrors ??
      raw.retryOnTransientErrors ??
      asBoolean(
        env(
          "MONGO_RETRY_TRANSIENT_ERRORS",
        ),
        DEFAULTS.retryOnTransientErrors,
      ),

    fallbackMaxRetries:
      asPositiveInteger(
        options.fallbackMaxRetries ??
          raw.fallbackMaxRetries ??
          env(
            "MONGO_FALLBACK_MAX_RETRIES",
          ),
        DEFAULTS.fallbackMaxRetries,
      ),

    options: {
      ...(raw.options || {}),
      ...(options.connectionOptions || {}),
    },
  };

  /**
   * Keep MongoDB pool invariants valid.
   */
  config.minPoolSize = Math.min(
    config.minPoolSize,
    config.maxPoolSize,
  );

  config.maxConnecting = Math.max(
    1,
    config.maxConnecting,
  );

  config.maxRetryDelayMs = Math.max(
    config.maxRetryDelayMs,
    config.initialRetryDelayMs,
  );

  return Object.freeze(
    config,
  );
}

let configuration =
  createDatabaseConfig();

/**
 * =============================================================================
 * URI validation
 * =============================================================================
 */

function validateMongoURI(
  uri,
) {
  if (
    typeof uri !==
      "string" ||
    uri.trim() === ""
  ) {
    return {
      isValid: false,
      error:
        "MongoDB URI is empty or undefined.",
      isSRV: false,
    };
  }

  const value =
    uri.trim();

  const isSRV =
    value.startsWith(
      "mongodb+srv://",
    );

  const isStandard =
    value.startsWith(
      "mongodb://",
    );

  if (!isSRV && !isStandard) {
    return {
      isValid: false,
      error:
        "MongoDB URI must start with mongodb:// or mongodb+srv://.",
      isSRV: false,
    };
  }

  try {
    const parsed =
      new URL(value);

    const hostname =
      parsed.hostname;

    if (!hostname) {
      return {
        isValid: false,
        error:
          "MongoDB URI does not contain a valid hostname.",
        isSRV,
      };
    }

    if (
      isSRV &&
      parsed.port
    ) {
      return {
        isValid: false,
        error:
          "mongodb+srv:// URIs must not specify an explicit port.",
        isSRV: true,
      };
    }

    if (
      isSRV &&
      hostname.includes(":")
    ) {
      return {
        isValid: false,
        error:
          "mongodb+srv:// URI hostname is invalid.",
        isSRV: true,
      };
    }

    return {
      isValid: true,
      error: null,
      isSRV,
      scheme:
        isSRV
          ? "mongodb+srv"
          : "mongodb",
      hostname,
    };
  } catch (error) {
    return {
      isValid: false,
      error:
        `MongoDB URI parsing failed: ${sanitizeSensitiveText(
          error?.message,
        )}`,
      isSRV,
    };
  }
}

/**
 * =============================================================================
 * Safe URI masking
 * =============================================================================
 */

function maskCredentials(
  uri,
) {
  if (
    typeof uri !==
    "string"
  ) {
    return uri;
  }

  try {
    const parsed =
      new URL(uri);

    if (parsed.username) {
      parsed.username =
        "***";
    }

    if (parsed.password) {
      parsed.password =
        "***";
    }

    return parsed.toString();
  } catch {
    return uri.replace(
      /\/\/([^:/@]+)(?::[^@]*)?@/g,
      "//$1:***@",
    );
  }
}

/**
 * =============================================================================
 * URI resolution
 * =============================================================================
 */

function resolveMongoUri(
  options = {},
) {
  const config =
    options.config ||
    configuration;

  const forceFallback =
    options.forceFallback === true;

  const preferFallback =
    options.preferFallback === true;

  const production =
    config.production;

  let uri = null;
  let type = null;
  let source = null;

  if (
    forceFallback ||
    preferFallback
  ) {
    uri =
      config.fallbackUri;

    type =
      config.inDocker
        ? "docker-fallback"
        : "fallback";

    source =
      "MONGO_URI_FALLBACK";
  } else if (
    production
  ) {
    uri =
      config.uri;

    type =
      getUriType(uri);

    source =
      "MONGO_URI";
  } else {
    if (config.uri) {
      uri =
        config.uri;

      type =
        getUriType(uri);

      source =
        "MONGO_URI";
    } else if (
      config.fallbackUri
    ) {
      uri =
        config.fallbackUri;

      type =
        config.inDocker
          ? "docker-fallback"
          : "fallback";

      source =
        "MONGO_URI_FALLBACK";
    }
  }

  return {
    uri,

    type,

    source,

    masked:
      maskCredentials(uri),

    inProduction:
      production,

    inDocker:
      config.inDocker,

    isFallback:
      source ===
      "MONGO_URI_FALLBACK",
  };
}

function getUriType(
  uri,
) {
  if (!uri) {
    return "unknown";
  }

  if (
    uri.startsWith(
      "mongodb+srv://",
    )
  ) {
    return "mongodb-atlas-srv";
  }

  if (
    uri.startsWith(
      "mongodb://",
    )
  ) {
    return "mongodb-standard";
  }

  return "unknown";
}

/**
 * =============================================================================
 * Retry policy
 * =============================================================================
 */

function getRetryDelay(
  attempt,
  config = configuration,
) {
  const exponential =
    Math.min(
      config.initialRetryDelayMs *
        Math.pow(
          2,
          Math.max(
            attempt - 1,
            0,
          ),
        ),
      config.maxRetryDelayMs,
    );

  const jitterRange =
    exponential *
    config.retryJitterRatio;

  const jitter =
    (
      Math.random() *
      2 -
      1
    ) *
    jitterRange;

  return Math.max(
    0,
    Math.floor(
      exponential +
        jitter,
    ),
  );
}

/**
 * =============================================================================
 * Error classification
 * =============================================================================
 */

function getErrorText(
  error,
) {
  const normalized =
    normalizeError(
      error,
    );

  return [
    normalized?.name,
    normalized?.code,
    normalized?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isAuthenticationError(
  error,
) {
  const text =
    getErrorText(error);

  return /authentication failed|auth error|authenticationexception|sasl|bad auth|invalid username|unauthorized/i.test(
    text,
  );
}

function isInvalidUriError(
  error,
) {
  const text =
    getErrorText(error);

  return /invalid connection string|invalid scheme|invalid hostname|invalid uri|uri must/i.test(
    text,
  );
}

function isCertificateError(
  error,
) {
  const text =
    getErrorText(error);

  return /certificate|tls|ssl/i.test(
    text,
  );
}

function isSrvDnsError(
  error,
) {
  const text =
    getErrorText(error);

  return /querysrv|enotfound|eai_again|servfail|dns|srv/i.test(
    text,
  );
}

function isNetworkError(
  error,
) {
  const text =
    getErrorText(error);

  return /econnrefused|econnreset|etimedout|ehostunreach|enetunreach|network|serverselection|mongo.*network|topology/i.test(
    text,
  );
}

function isTransientError(
  error,
) {
  return (
    isNetworkError(error) ||
    isSrvDnsError(error) ||
    /timed out|temporary|unavailable|shutdown in progress|pool cleared/i.test(
      getErrorText(error),
    )
  );
}

function isRetryableConnectionFailure(
  error,
) {
  if (
    isInvalidUriError(error) ||
    isAuthenticationError(error)
  ) {
    return false;
  }

  if (
    isCertificateError(error) &&
    configuration.production
  ) {
    return false;
  }

  if (
    !configuration.retryOnTransientErrors
  ) {
    return false;
  }

  return isTransientError(error);
}

/**
 * =============================================================================
 * Readiness / observability integration
 * =============================================================================
 */

function publishReadiness(
  ready,
  details = {},
) {
  try {
    const target =
      readinessModule?.readinessState ||
      readinessModule;

    if (!target) {
      return;
    }

    if (
      ready &&
      typeof target.markReady ===
        "function"
    ) {
      if (
        typeof target.has ===
          "function" &&
        typeof target.register ===
          "function"
      ) {
        if (
          !target.has(
            COMPONENT,
          )
        ) {
          target.register({
            name:
              COMPONENT,

            severity:
              configuration.required
                ? "critical"
                : "required",

            enabled:
              true,

            readiness:
              async () => ({
                ready:
                  databaseState.ready &&
                  databaseState.connected &&
                  !databaseState.stopping,
              }),

            health:
              async () =>
                health(),

            metadata: {
              component:
                COMPONENT,

              service:
                SERVICE_NAME,
            },
          });
        }

        return;
      }

      try {
        target.markReady(
          COMPONENT,
          details,
        );
      } catch {
        target.markReady(
          details,
        );
      }

      return;
    }

    if (
      !ready &&
      typeof target.markNotReady ===
        "function"
    ) {
      target.markNotReady(
        details.reason ||
          "database-not-ready",
        {
          component:
            COMPONENT,

          ...details,
        },
      );
    }
  } catch {
    /**
     * Readiness integration must never mask a database lifecycle failure.
     */
  }
}

function emitTelemetry(
  event,
  payload = {},
) {
  try {
    if (
      typeof observabilityModule?.emitEvent ===
        "function"
    ) {
      observabilityModule.emitEvent(
        event,
        {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          ...payload,
        },
      );

      return;
    }

    if (
      typeof observabilityModule
        ?.observability
        ?.emitEvent ===
        "function"
    ) {
      observabilityModule
        .observability
        .emitEvent(
          event,
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            ...payload,
          },
        );
    }
  } catch {
    /**
     * Observability must be strictly non-blocking.
     */
  }
}

/**
 * =============================================================================
 * Runtime state
 * =============================================================================
 */

const databaseState = {
  state:
    DATABASE_STATES.CREATED,

  ready: false,

  connected: false,

  connecting: false,

  stopping: false,

  stopped: false,

  failed: false,

  degraded: false,

  initializedAt: null,

  connectedAt: null,

  disconnectedAt: null,

  lastHealthCheckAt: null,

  lastError: null,

  lastAttempt: 0,

  attempts: 0,

  connectionCount: 0,

  currentUriSource: null,

  currentUriType: null,
};

/**
 * =============================================================================
 * Connection promises
 * =============================================================================
 */

let connectPromise = null;
let shutdownPromise = null;

/**
 * =============================================================================
 * URI validation
 * =============================================================================
 */

function assertConfiguredUri(
  uriConfig,
) {
  if (!uriConfig?.uri) {
    throw new DatabaseConfigError(
      configuration.required
        ? "TITech MongoDB URI is not configured."
        : "TITech MongoDB URI is not configured; database connection is optional.",
      {
        code:
          configuration.required
            ? "DATABASE_URI_MISSING"
            : "DATABASE_URI_NOT_CONFIGURED",
      },
    );
  }

  const validation =
    validateMongoURI(
      uriConfig.uri,
    );

  if (!validation.isValid) {
    throw new DatabaseConfigError(
      validation.error,
      {
        code:
          "DATABASE_URI_INVALID",

        details: {
          source:
            uriConfig.source,

          type:
            uriConfig.type,

          masked:
            uriConfig.masked,
        },
      },
    );
  }

  return validation;
}

/**
 * =============================================================================
 * Mongoose connection options
 * =============================================================================
 */

function getConnectionOptions(
  validation,
) {
  const options = {
    ...configuration.options,

    maxPoolSize:
      configuration.maxPoolSize,

    minPoolSize:
      configuration.minPoolSize,

    maxConnecting:
      configuration.maxConnecting,

    serverSelectionTimeoutMS:
      configuration.serverSelectionTimeoutMS,

    socketTimeoutMS:
      configuration.socketTimeoutMS,

    heartbeatFrequencyMS:
      configuration.heartbeatFrequencyMS,

    autoIndex:
      configuration.autoIndex,

    autoCreate:
      configuration.autoCreate,

    retryWrites:
      configuration.retryWrites,

    directConnection:
      configuration.directConnection,

    connectTimeoutMS:
      configuration.connectTimeoutMs,
  };

  if (
    !validation.isSRV &&
    configuration.options?.family
  ) {
    options.family =
      configuration.options.family;
  }

  return options;
}

/**
 * =============================================================================
 * Connect once
 * =============================================================================
 */

async function connectOnce(
  uriConfig,
) {
  const validation =
    assertConfiguredUri(
      uriConfig,
    );

  const options =
    getConnectionOptions(
      validation,
    );

  const startedAt =
    process.hrtime.bigint();

  databaseState.lastAttempt +=
    1;

  databaseState.attempts +=
    1;

  databaseState.lastError =
    null;

  databaseState.state =
    DATABASE_STATES.CONNECTING;

  databaseState.connecting =
    true;

  databaseState.currentUriSource =
    uriConfig.source;

  databaseState.currentUriType =
    uriConfig.type;

  log(
    "info",
    {
      event:
        "database.connection_attempt_started",

      attempt:
        databaseState.lastAttempt,

      source:
        uriConfig.source,

      type:
        uriConfig.type,

      uri:
        uriConfig.masked,
    },
    "TITech MongoDB connection attempt started.",
  );

  try {
    await withTimeout(
      () =>
        mongoose.connect(
          uriConfig.uri,
          options,
        ),
      configuration.connectTimeoutMs,
      "TITech MongoDB connection",
    );

    /**
     * Mongoose can resolve while its underlying connection is still settling
     * in edge cases. Require a connected readyState before declaring readiness.
     */
    if (
      mongoose.connection.readyState !==
      1
    ) {
      throw new DatabaseConfigError(
        "TITech MongoDB connection did not reach the connected state.",
        {
          code:
            "DATABASE_CONNECTION_NOT_READY",
          details: {
            readyState:
              mongoose.connection.readyState,
          },
        },
      );
    }

    databaseState.state =
      DATABASE_STATES.CONNECTED;

    databaseState.connected =
      true;

    databaseState.ready =
      true;

    databaseState.connecting =
      false;

    databaseState.failed =
      false;

    databaseState.degraded =
      false;

    databaseState.stopped =
      false;

    databaseState.connectedAt =
      new Date();

    databaseState.connectionCount +=
      1;

    databaseState.initializedAt =
      databaseState.initializedAt ||
      new Date();

    databaseState.lastError =
      null;

    publishReadiness(
      true,
      {
        reason:
          "database-connected",
      },
    );

    emitTelemetry(
      "database.connected",
      {
        source:
          uriConfig.source,

        type:
          uriConfig.type,

        durationMs:
          elapsedMs(
            startedAt,
          ),
      },
    );

    log(
      "info",
      {
        event:
          "database.connected",

        source:
          uriConfig.source,

        type:
          uriConfig.type,

        durationMs:
          elapsedMs(
            startedAt,
          ),

        connection:
          getConnectionSnapshot(),
      },
      "TITech MongoDB connected successfully.",
    );

    return mongoose.connection;
  } catch (error) {
    const normalized =
      normalizeError(error);

    const retryable =
      isRetryableConnectionFailure(
        normalized,
      );

    databaseState.connecting =
      false;

    databaseState.connected =
      false;

    databaseState.ready =
      false;

    databaseState.degraded =
      true;

    databaseState.lastError =
      normalized;

    databaseState.state =
      DATABASE_STATES.DEGRADED;

    publishReadiness(
      false,
      {
        reason:
          "database-connection-failed",

        error:
          safeError(
            normalized,
            {
              retryable,
              phase: "connection",
            },
          ),
      },
    );

    emitTelemetry(
      "database.connection_failed",
      {
        source:
          uriConfig.source,

        type:
          uriConfig.type,

        durationMs:
          elapsedMs(
            startedAt,
          ),

        retryable,

        error:
          safeError(
            normalized,
            {
              retryable,
              phase: "connection",
            },
          ),
      },
    );

    log(
      "error",
      {
        event:
          "database.connection_failed",

        source:
          uriConfig.source,

        type:
          uriConfig.type,

        durationMs:
          elapsedMs(
            startedAt,
          ),

        retryable,

        error:
          safeError(
            normalized,
            {
              retryable,
              phase: "connection",
              includeStack:
                true,
            },
          ),
      },
      "TITech MongoDB connection attempt failed.",
    );

    throw normalized;
  }
}

/**
 * =============================================================================
 * Fallback decision
 * =============================================================================
 */

function shouldUseFallback(
  error,
  uriConfig,
) {
  if (
    uriConfig.isFallback
  ) {
    return false;
  }

  if (
    !configuration.fallbackEnabled
  ) {
    return false;
  }

  if (
    !configuration.fallbackUri
  ) {
    return false;
  }

  if (
    configuration.production
  ) {
    return (
      process.env
        .MONGO_FORCE_FALLBACK ===
      "true"
    );
  }

  return (
    isSrvDnsError(error) ||
    isNetworkError(error)
  );
}

/**
 * =============================================================================
 * connectDB
 * =============================================================================
 */

async function connectDB(
  options = {},
) {
  if (
    databaseState.connected &&
    mongoose.connection.readyState ===
      1
  ) {
    return mongoose.connection;
  }

  if (
    databaseState.stopping ||
    shutdownPromise
  ) {
    throw new DatabaseConfigError(
      "TITech MongoDB connection cannot start while database shutdown is in progress.",
      {
        code:
          "DATABASE_SHUTDOWN_IN_PROGRESS",
      },
    );
  }

  if (
    configuration.skipChecks ||
    options.skipChecks === true
  ) {
    databaseState.state =
      DATABASE_STATES.SKIPPED;

    databaseState.ready =
      !configuration.required;

    databaseState.connected =
      false;

    databaseState.connecting =
      false;

    databaseState.failed =
      false;

    databaseState.degraded =
      configuration.required;

    databaseState.stopped =
      false;

    publishReadiness(
      false,
      {
        reason:
          "database-checks-skipped",
      },
    );

    log(
      "warn",
      {
        event:
          "database.checks_skipped",

        required:
          configuration.required,
      },
      "TITech MongoDB connection checks are disabled.",
    );

    return null;
  }

  if (
    connectPromise
  ) {
    return connectPromise;
  }

  connectPromise =
    (async () => {
      databaseState.state =
        DATABASE_STATES.CONNECTING;

      databaseState.stopped =
        false;

      databaseState.failed =
        false;

      databaseState.degraded =
        false;

      databaseState.lastError =
        null;

      const forceFallback =
        options.forceFallback ===
          true ||
        process.env
          .MONGO_FORCE_FALLBACK ===
          "true";

      let uriConfig =
        resolveMongoUri({
          forceFallback,
        });

      if (!uriConfig.uri) {
        const error =
          new DatabaseConfigError(
            configuration.required
              ? "TITech MongoDB connection is required but no URI is configured."
              : "TITech MongoDB URI is not configured.",
            {
              code:
                configuration.required
                  ? "DATABASE_URI_MISSING"
                  : "DATABASE_URI_NOT_CONFIGURED",
            },
          );

        databaseState.state =
          configuration.required
            ? DATABASE_STATES.FAILED
            : DATABASE_STATES.DEGRADED;

        databaseState.failed =
          configuration.required;

        databaseState.degraded =
          true;

        databaseState.ready =
          false;

        databaseState.connecting =
          false;

        databaseState.lastError =
          error;

        publishReadiness(
          false,
          {
            reason:
              "database-uri-missing",

            error:
              safeError(error, {
                phase:
                  "configuration",
              }),
          },
        );

        log(
          configuration.required ||
          !configuration.gracefulStartup
            ? "error"
            : "warn",
          {
            event:
              "database.uri_missing",

            required:
              configuration.required,

            gracefulStartup:
              configuration.gracefulStartup,
          },
          error.message,
        );

        if (
          configuration.required ||
          !configuration.gracefulStartup
        ) {
          throw error;
        }

        return null;
      }

      /**
       * Phase 0 = primary URI.
       * Phase 1 = explicitly configured fallback.
       */
      for (
        let phase = 0;
        phase < 2;
        phase += 1
      ) {
        const maxAttempts =
          uriConfig.isFallback
            ? configuration.fallbackMaxRetries
            : configuration.maxRetries;

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt += 1
        ) {
          try {
            databaseState.lastAttempt =
              attempt;

            const connection =
              await connectOnce(
                uriConfig,
              );

            return connection;
          } catch (error) {
            const normalized =
              normalizeError(error);

            databaseState.lastError =
              normalized;

            const retryable =
              isRetryableConnectionFailure(
                normalized,
              );

            log(
              "error",
              {
                event:
                  "database.connection_attempt_failed",

                attempt,

                maxAttempts,

                phase,

                source:
                  uriConfig.source,

                type:
                  uriConfig.type,

                uri:
                  uriConfig.masked,

                retryable,

                error:
                  safeError(
                    normalized,
                    {
                      retryable,
                      phase:
                        "connection",
                      includeStack:
                        true,
                    },
                  ),
              },
              "TITech MongoDB connection attempt failed.",
            );

            /**
             * Configuration/authentication failures should never be hidden
             * behind retry attempts.
             */
            if (
              isInvalidUriError(
                normalized,
              )
            ) {
              throw createDatabaseError(
                normalized,
                "DATABASE_URI_INVALID",
                "TITech MongoDB URI configuration is invalid.",
              );
            }

            if (
              isAuthenticationError(
                normalized,
              )
            ) {
              throw createDatabaseError(
                normalized,
                "DATABASE_AUTHENTICATION_FAILED",
                "TITech MongoDB authentication failed.",
              );
            }

            if (
              isCertificateError(
                normalized,
              ) &&
              configuration.production
            ) {
              throw createDatabaseError(
                normalized,
                "DATABASE_TLS_FAILED",
                "TITech MongoDB TLS/certificate validation failed.",
              );
            }

            /**
             * Fallback is explicit, never automatic in production.
             */
            if (
              shouldUseFallback(
                normalized,
                uriConfig,
              ) &&
              phase === 0
            ) {
              const fallback =
                resolveMongoUri({
                  forceFallback:
                    true,
                });

              if (
                fallback.uri &&
                !fallback.isFallback
              ) {
                throw createDatabaseError(
                  normalized,
                  "DATABASE_FALLBACK_INVALID",
                  "TITech MongoDB fallback configuration is invalid.",
                );
              }

              if (
                fallback.uri
              ) {
                log(
                  "warn",
                  {
                    event:
                      "database.fallback_selected",

                    primarySource:
                      uriConfig.source,

                    fallbackSource:
                      fallback.source,

                    reason:
                      safeError(
                        normalized,
                        {
                          retryable,
                          phase:
                            "fallback",
                        },
                      ),
                  },
                  "TITech MongoDB primary connection failed; switching to explicitly configured fallback.",
                );

                uriConfig =
                  fallback;

                break;
              }
            }

            /**
             * Non-transient failures are terminal.
             */
            if (
              !retryable
            ) {
              throw createDatabaseError(
                normalized,
                "DATABASE_CONNECTION_FAILED",
                "TITech MongoDB connection failed.",
              );
            }

            if (
              attempt <
              maxAttempts
            ) {
              const delay =
                getRetryDelay(
                  attempt,
                );

              log(
                "warn",
                {
                  event:
                    "database.retry_scheduled",

                  delayMs:
                    delay,

                  nextAttempt:
                    attempt + 1,

                  maxAttempts,

                  phase,

                  errorCode:
                    normalized.code ||
                    null,
                },
                "TITech MongoDB will retry the connection.",
              );

              await sleep(
                delay,
              );

              continue;
            }

            /**
             * Exhausted primary retries and fallback is explicitly allowed.
             */
            if (
              phase === 0 &&
              shouldUseFallback(
                normalized,
                uriConfig,
              )
            ) {
              const fallback =
                resolveMongoUri({
                  forceFallback:
                    true,
                });

              if (
                fallback.uri
              ) {
                log(
                  "warn",
                  {
                    event:
                      "database.primary_retries_exhausted",

                    fallbackSource:
                      fallback.source,

                    error:
                      safeError(
                        normalized,
                        {
                          retryable,
                          phase:
                            "fallback",
                        },
                      ),
                  },
                  "TITech MongoDB primary retry policy exhausted; evaluating configured fallback.",
                );

                uriConfig =
                  fallback;

                break;
              }
            }
          }
        }

        /**
         * Only continue to phase two when we have explicitly switched to
         * fallback.
         */
        if (
          uriConfig.isFallback &&
          phase === 0
        ) {
          continue;
        }

        break;
      }

      const finalError =
        normalizeError(
          databaseState.lastError ||
            new DatabaseConfigError(
              "TITech MongoDB failed to connect after the configured retry policy.",
              {
                code:
                  "DATABASE_CONNECTION_EXHAUSTED",
              },
            ),
        );

      databaseState.state =
        configuration.gracefulStartup &&
        !configuration.production
          ? DATABASE_STATES.DEGRADED
          : DATABASE_STATES.FAILED;

      databaseState.failed =
        !configuration.gracefulStartup ||
        configuration.production;

      databaseState.degraded =
        true;

      databaseState.ready =
        false;

      databaseState.connected =
        false;

      databaseState.connecting =
        false;

      publishReadiness(
        false,
        {
          reason:
            "database-retries-exhausted",

          error:
            safeError(
              finalError,
              {
                retryable:
                  isTransientError(
                    finalError,
                  ),
                phase:
                  "retry-exhausted",
              },
            ),
        },
      );

      if (
        configuration.gracefulStartup &&
        !configuration.production
      ) {
        log(
          "error",
          {
            event:
              "database.graceful_startup_degraded",

            error:
              safeError(
                finalError,
                {
                  retryable:
                    isTransientError(
                      finalError,
                    ),
                  phase:
                    "retry-exhausted",
                  includeStack:
                    true,
                },
              ),
          },
          "TITech graceful startup is continuing without MongoDB.",
        );

        return null;
      }

      throw createDatabaseError(
        finalError,
        "DATABASE_CONNECTION_EXHAUSTED",
        "TITech MongoDB failed to connect after the configured retry policy.",
      );
    })();

  try {
    return await connectPromise;
  } finally {
    connectPromise =
      null;
  }
}

/**
 * =============================================================================
 * Health
 * =============================================================================
 */

async function health() {
  databaseState.lastHealthCheckAt =
    new Date();

  try {
    const readyState =
      mongoose.connection
        ?.readyState;

    const connected =
      readyState ===
      1;

    if (
      connected &&
      mongoose.connection.db
    ) {
      await withTimeout(
        () =>
          mongoose.connection.db.command(
            {
              ping: 1,
            },
          ),
        configuration.healthTimeoutMs,
        "TITech MongoDB health check",
      );
    }

    const healthy =
      connected;

    return {
      status:
        healthy
          ? "healthy"
          : "unhealthy",

      healthy,

      ready:
        databaseState.ready &&
        connected &&
        !databaseState.stopping,

      state:
        databaseState.state,

      connected,

      required:
        configuration.required,

      environment:
        configuration.nodeEnv,

      source:
        databaseState
          .currentUriSource,

      type:
        databaseState
          .currentUriType,

      connection:
        getConnectionSnapshot(),

      timestamp:
        databaseState
          .lastHealthCheckAt
          .toISOString(),
    };
  } catch (error) {
    const normalized =
      normalizeError(error);

    databaseState.lastError =
      normalized;

    databaseState.degraded =
      true;

    databaseState.ready =
      false;

    return {
      status: "unhealthy",

      healthy: false,

      ready: false,

      state:
        databaseState.state,

      connected: false,

      required:
        configuration.required,

      error:
        safeError(
          normalized,
          {
            phase:
              "health",
          },
        ),

      timestamp:
        databaseState
          .lastHealthCheckAt
          .toISOString(),
    };
  }
}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

async function readiness() {
  const readyState =
    mongoose.connection
      ?.readyState;

  const connected =
    readyState === 1;

  const ready =
    databaseState.ready &&
    connected &&
    !databaseState.failed &&
    !databaseState.stopping;

  return {
    ready,

    status:
      ready
        ? "ready"
        : "not_ready",

    state:
      databaseState.state,

    required:
      configuration.required,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    timestamp:
      new Date().toISOString(),
  };
}

/**
 * =============================================================================
 * Connection snapshot
 * =============================================================================
 */

function getConnectionSnapshot() {
  const connection =
    mongoose.connection;

  return {
    readyState:
      connection?.readyState ??
      0,

    connected:
      connection?.readyState ===
      1,

    host:
      connection?.host ||
      null,

    port:
      connection?.port ||
      null,

    name:
      connection?.name ||
      configuration.databaseName,

    models:
      connection
        ? Object.keys(
            connection.models ||
              {},
          ).length
        : 0,
  };
}

/**
 * =============================================================================
 * MongoDB lifecycle events
 * =============================================================================
 */

let listenersInstalled =
  false;

function installConnectionListeners() {
  if (
    listenersInstalled
  ) {
    return;
  }

  const connection =
    mongoose.connection;

  connection.on(
    "connected",
    () => {
      databaseState.connected =
        true;

      databaseState.ready =
        true;

      databaseState.failed =
        false;

      databaseState.degraded =
        false;

      databaseState.stopping =
        false;

      databaseState.stopped =
        false;

      databaseState.state =
        DATABASE_STATES.CONNECTED;

      databaseState.connectedAt =
        databaseState.connectedAt ||
        new Date();

      databaseState.lastError =
        null;

      publishReadiness(
        true,
        {
          reason:
            "database-connected-event",
        },
      );

      emitTelemetry(
        "database.connected",
        {
          eventSource:
            "mongoose.connected",
        },
      );

      log(
        "info",
        {
          event:
            "database.connected_event",
        },
        "TITech MongoDB connected event received.",
      );
    },
  );

  connection.on(
    "disconnected",
    () => {
      databaseState.connected =
        false;

      databaseState.ready =
        false;

      databaseState.degraded =
        true;

      if (
        !databaseState.stopping
      ) {
        databaseState.state =
          DATABASE_STATES.DISCONNECTED;
      }

      databaseState.disconnectedAt =
        new Date();

      publishReadiness(
        false,
        {
          reason:
            "database-disconnected",
        },
      );

      emitTelemetry(
        "database.disconnected",
      );

      log(
        "warn",
        {
          event:
            "database.disconnected",
        },
        "TITech MongoDB disconnected.",
      );
    },
  );

  connection.on(
    "reconnected",
    () => {
      databaseState.connected =
        true;

      databaseState.ready =
        true;

      databaseState.failed =
        false;

      databaseState.degraded =
        false;

      databaseState.stopping =
        false;

      databaseState.stopped =
        false;

      databaseState.state =
        DATABASE_STATES.CONNECTED;

      databaseState.connectedAt =
        new Date();

      databaseState.lastError =
        null;

      publishReadiness(
        true,
        {
          reason:
            "database-reconnected",
        },
      );

      emitTelemetry(
        "database.reconnected",
      );

      log(
        "info",
        {
          event:
            "database.reconnected",
        },
        "TITech MongoDB reconnected.",
      );
    },
  );

  connection.on(
    "error",
    (error) => {
      const normalized =
        normalizeError(error);

      databaseState.lastError =
        normalized;

      databaseState.degraded =
        true;

      /**
       * Do not immediately make the service unready for every driver error.
       * Mongoose may recover without losing the actual connection.
       */
      emitTelemetry(
        "database.error",
        {
          error:
            safeError(
              normalized,
              {
                retryable:
                  isTransientError(
                    normalized,
                  ),
                phase:
                  "runtime",
              },
            ),
        },
      );

      log(
        "error",
        {
          event:
            "database.runtime_error",

          retryable:
            isTransientError(
              normalized,
            ),

          error:
            safeError(
              normalized,
              {
                retryable:
                  isTransientError(
                    normalized,
                  ),
                phase:
                  "runtime",
                includeStack:
                  true,
              },
            ),
        },
        "TITech MongoDB runtime error.",
      );
    },
  );

  listenersInstalled =
    true;
}

installConnectionListeners();

/**
 * =============================================================================
 * Shutdown
 * =============================================================================
 */

async function closeDatabase(
  options = {},
) {
  if (
    shutdownPromise
  ) {
    return shutdownPromise;
  }

  if (
    mongoose.connection
      ?.readyState === 0
  ) {
    databaseState.connected =
      false;

    databaseState.ready =
      false;

    databaseState.connecting =
      false;

    databaseState.stopping =
      false;

    databaseState.stopped =
      true;

    databaseState.failed =
      false;

    databaseState.degraded =
      false;

    databaseState.state =
      DATABASE_STATES.STOPPED;

    return true;
  }

  shutdownPromise =
    (async () => {
      databaseState.stopping =
        true;

      databaseState.connecting =
        false;

      databaseState.ready =
        false;

      databaseState.state =
        DATABASE_STATES.STOPPING;

      publishReadiness(
        false,
        {
          reason:
            "database-shutdown",
        },
      );

      try {
        await withTimeout(
          () =>
            mongoose.disconnect(),
          options.timeoutMs ||
            configuration.shutdownTimeoutMs,
          "TITech MongoDB shutdown",
        );

        databaseState.connected =
          false;

        databaseState.ready =
          false;

        databaseState.stopping =
          false;

        databaseState.stopped =
          true;

        databaseState.failed =
          false;

        databaseState.degraded =
          false;

        databaseState.state =
          DATABASE_STATES.STOPPED;

        databaseState.disconnectedAt =
          new Date();

        emitTelemetry(
          "database.stopped",
        );

        log(
          "info",
          {
            event:
              "database.stopped",
          },
          "TITech MongoDB connection closed.",
        );

        return true;
      } catch (error) {
        const normalized =
          normalizeError(error);

        databaseState.stopping =
          false;

        databaseState.failed =
          true;

        databaseState.ready =
          false;

        databaseState.state =
          DATABASE_STATES.FAILED;

        databaseState.lastError =
          normalized;

        emitTelemetry(
          "database.shutdown_failed",
          {
            error:
              safeError(
                normalized,
                {
                  phase:
                    "shutdown",
                },
              ),
          },
        );

        log(
          "error",
          {
            event:
              "database.shutdown_failed",

            error:
              safeError(
                normalized,
                {
                  phase:
                    "shutdown",

                  includeStack:
                    true,
                },
              ),
          },
          "TITech MongoDB shutdown failed.",
        );

        throw createDatabaseError(
          normalized,
          "DATABASE_SHUTDOWN_FAILED",
          "TITech MongoDB shutdown failed.",
        );
      }
    })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise =
      null;
  }
}

async function disconnectDB(
  options,
) {
  return closeDatabase(
    options,
  );
}

async function shutdownDatabase(
  options,
) {
  return closeDatabase(
    options,
  );
}

/**
 * =============================================================================
 * State accessors
 * =============================================================================
 */

function isConnected() {
  return (
    databaseState.connected &&
    mongoose.connection
      ?.readyState ===
      1
  );
}

function isReady() {
  return (
    databaseState.ready &&
    isConnected() &&
    !databaseState.failed &&
    !databaseState.stopping
  );
}

function isHealthy() {
  return isReady();
}

function isDegraded() {
  return databaseState.degraded;
}

function isFailed() {
  return databaseState.failed;
}

function getState() {
  return Object.freeze({
    ...databaseState,

    lastError:
      safeError(
        databaseState.lastError,
        {
          phase:
            "state",
        },
      ),
  });
}

/**
 * =============================================================================
 * Configuration snapshot
 * =============================================================================
 */

function getConfigSnapshot() {
  return Object.freeze({
    component:
      COMPONENT,

    serviceName:
      configuration.serviceName,

    applicationName:
      configuration.applicationName,

    environment:
      configuration.nodeEnv,

    production:
      configuration.production,

    development:
      configuration.development,

    staging:
      configuration.staging,

    test:
      configuration.test,

    docker:
      configuration.inDocker,

    enabled:
      configuration.enabled,

    required:
      configuration.required,

    gracefulStartup:
      configuration.gracefulStartup,

    skipChecks:
      configuration.skipChecks,

    uriConfigured:
      Boolean(
        configuration.uri,
      ),

    fallbackConfigured:
      Boolean(
        configuration.fallbackUri,
      ),

    fallbackEnabled:
      configuration.fallbackEnabled,

    databaseName:
      configuration.databaseName,

    maxRetries:
      configuration.maxRetries,

    initialRetryDelayMs:
      configuration.initialRetryDelayMs,

    maxRetryDelayMs:
      configuration.maxRetryDelayMs,

    retryJitterRatio:
      configuration.retryJitterRatio,

    connectTimeoutMs:
      configuration.connectTimeoutMs,

    serverSelectionTimeoutMS:
      configuration
        .serverSelectionTimeoutMS,

    socketTimeoutMS:
      configuration.socketTimeoutMS,

    heartbeatFrequencyMS:
      configuration.heartbeatFrequencyMS,

    maxPoolSize:
      configuration.maxPoolSize,

    minPoolSize:
      configuration.minPoolSize,

    maxConnecting:
      configuration.maxConnecting,

    autoIndex:
      configuration.autoIndex,

    autoCreate:
      configuration.autoCreate,

    retryWrites:
      configuration.retryWrites,

    directConnection:
      configuration.directConnection,

    shutdownTimeoutMs:
      configuration.shutdownTimeoutMs,

    healthTimeoutMs:
      configuration.healthTimeoutMs,

    retryOnTransientErrors:
      configuration
        .retryOnTransientErrors,
  });
}

/**
 * =============================================================================
 * Runtime initialization
 * =============================================================================
 */

async function initialize(
  context = {},
  options = {},
) {
  if (
    options &&
    options.config
  ) {
    configuration =
      Object.freeze({
        ...configuration,
        ...options.config,
      });
  }

  if (
    context &&
    typeof context === "object"
  ) {
    context.database =
      module.exports;

    context.databaseConfig =
      configuration;
  }

  if (
    configuration.enabled ===
    false
  ) {
    databaseState.state =
      DATABASE_STATES.SKIPPED;

    databaseState.ready =
      !configuration.required;

    databaseState.connected =
      false;

    databaseState.degraded =
      configuration.required;

    log(
      "warn",
      {
        event:
          "database.disabled",
      },
      "TITech MongoDB integration is disabled by configuration.",
    );

    return null;
  }

  return connectDB(
    options,
  );
}

/**
 * =============================================================================
 * Bootstrap lifecycle adapter
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  const {
    hooks,
    lifecycle,
  } = require("../bootstrap/hooks");

  if (
    hooks &&
    typeof hooks.has ===
      "function" &&
    hooks.has(COMPONENT)
  ) {
    return hooks.get(
      COMPONENT,
    );
  }

  return lifecycle(
    COMPONENT,
    {
      priority:
        options.priority ??
        -300,

      dependencies:
        options.dependencies ||
        [
          "resilience",
          "readiness",
        ],

      critical:
        options.critical ??
        configuration.required,

      timeoutMs:
        options.timeoutMs ||
        configuration.connectTimeoutMs,

      start:
        async (
          hookContext,
        ) =>
          initialize(
            hookContext ||
              context,
            options,
          ),

      ready:
        async () =>
          (
            await readiness()
          ).ready,

      health:
        async () =>
          health(),

      stop:
        async (
          hookContext,
        ) =>
          closeDatabase({
            timeoutMs:
              hookContext?.timeoutMs ||
              configuration.shutdownTimeoutMs,
          }),

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        implementation:
          "backend/config/db.js",
      },
    },
  );
}

/**
 * =============================================================================
 * Error construction
 * =============================================================================
 */

function createDatabaseError(
  error,
  code,
  message,
) {
  const normalized =
    normalizeError(error);

  const retryable =
    isTransientError(
      normalized,
    );

  if (
    startupErrors &&
    typeof startupErrors.databaseError ===
      "function"
  ) {
    try {
      const startupError =
        startupErrors.databaseError(
          message,
          {
            code,

            cause:
              normalized,

            dependency:
              "database",

            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            critical:
              configuration.required,

            fatal:
              configuration.required,

            retryable,
          },
        );

      if (
        startupError &&
        typeof startupError ===
          "object"
      ) {
        if (
          !startupError.code
        ) {
          startupError.code =
            code;
        }

        if (
          startupError.retryable ===
          undefined
        ) {
          startupError.retryable =
            retryable;
        }

        if (
          startupError.cause ===
          undefined
        ) {
          startupError.cause =
            normalized;
        }
      }

      return startupError;
    } catch {
      /**
       * Never allow startup error normalization to hide the database error.
       */
    }
  }

  return new DatabaseConfigError(
    message,
    {
      code,

      phase:
        "database",

      cause:
        normalized,

      retryable,
    },
  );
}

/**
 * =============================================================================
 * Compatibility API
 * =============================================================================
 */

module.exports = Object.assign(
  connectDB,
  {
    /**
     * Primary lifecycle.
     */
    connectDB,

    connect:
      connectDB,

    initialize,

    start:
      initialize,

    closeDB:
      closeDatabase,

    closeDatabase,

    disconnectDB,

    disconnect:
      disconnectDB,

    shutdown:
      shutdownDatabase,

    stop:
      shutdownDatabase,

    /**
     * Health/readiness.
     */
    health,

    checkHealth:
      health,

    readiness,

    isReady,

    isConnected,

    isHealthy,

    isDegraded,

    isFailed,

    /**
     * Configuration.
     */
    getConfig:
      () =>
        configuration,

    getConfigSnapshot,

    resolveMongoUri,

    validateMongoURI,

    maskCredentials,

    /**
     * Runtime diagnostics.
     */
    getState,

    getConnection:
      () =>
        mongoose.connection,

    getConnectionSnapshot,

    /**
     * Bootstrap.
     */
    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Constants.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    DATABASE_STATES,

    /**
     * Error class.
     */
    DatabaseConfigError,

    /**
     * Safe diagnostics helpers.
     *
     * Exporting these is useful for tests and infrastructure diagnostics
     * without requiring consumers to duplicate database error sanitization.
     */
    safeError,

    normalizeError,
  },
);