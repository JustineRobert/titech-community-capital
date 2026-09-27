'use strict';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/logger.js
 *
 * Purpose:
 *   Enterprise production-grade structured logging foundation.
 *
 * Responsibilities:
 *   - Initialize the application logger before infrastructure startup.
 *   - Provide structured JSON logging in production.
 *   - Provide human-readable development logging when pino-pretty exists.
 *   - Redact sensitive security, authentication and financial credentials.
 *   - Provide AsyncLocalStorage request/correlation context.
 *   - Provide child loggers.
 *   - Provide audit/security/financial/performance helpers.
 *   - Provide a stable logger API.
 *   - Integrate with the canonical bootstrap lifecycle.
 *   - Flush logs during graceful shutdown.
 *   - Prevent duplicate initialization.
 *   - Never expose secrets through diagnostics.
 *
 * Architectural position:
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   resilience
 *       ↓
 *   infrastructure
 *       ↓
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   server
 *       ↓
 *   runtime
 *
 * IMPORTANT:
 *
 *   This module MUST NOT:
 *
 *     - execute business logic;
 *     - write financial records;
 *     - persist audit records;
 *     - connect to MongoDB;
 *     - connect to Redis;
 *     - initialize queues;
 *     - create HTTP servers;
 *     - terminate the process;
 *     - call process.exit();
 *
 *   It provides logging infrastructure only.
 *
 * Dependency policy:
 *
 *   logger.js intentionally does NOT eagerly require hooks.js.
 *
 *   Bootstrap hook dependencies are loaded lazily through
 *   registerBootstrapHooks().
 *
 *   This prevents:
 *
 *       logger → hooks → logger
 *
 *   circular initialization hazards.
 *
 * Recommended packages:
 *
 *   npm install pino
 *
 * Optional:
 *
 *   npm install -D pino-pretty
 *
 * =============================================================================
 */

const {
  AsyncLocalStorage,
} = require('node:async_hooks');

const crypto = require('node:crypto');
const os = require('node:os');

const pino = require('pino');

/* =============================================================================
 * Constants
 * =============================================================================
 */

const LOGGER_NAME =
  'titech-community-capital';

const DEFAULT_LEVEL =
  'info';

const DEFAULT_VERSION =
  '0.0.0';

const DEFAULT_ENVIRONMENT =
  'development';

const LOG_LEVELS =
  Object.freeze([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
  ]);

const DEFAULT_REDACT_PATHS =
  Object.freeze([
    'password',
    'passwd',
    'passcode',
    'pin',
    'otp',
    'token',

    'accessToken',
    'refreshToken',

    'id_token',
    'access_token',
    'refresh_token',

    'authorization',
    'cookie',
    'set-cookie',

    'req.headers.authorization',
    'req.headers.cookie',

    'request.headers.authorization',
    'request.headers.cookie',

    'headers.authorization',
    'headers.cookie',

    'jwt',
    'jwtSecret',

    'secret',
    'apiKey',
    'api_key',

    'clientSecret',
    'client_secret',

    'encryptionKey',
    'encryption_key',

    'privateKey',
    'private_key',

    'cardNumber',
    'card_number',

    'cvv',
    'cvc',

    'accountPassword',
    'account_password',

    'mongoUri',
    'mongoURI',
    'mongodbUri',

    'databaseUrl',
    'databaseURL',

    'redisUrl',
    'redisURL',

    'connectionString',
  ]);

const DEFAULT_CONTEXT_FIELDS =
  Object.freeze([
    'requestId',
    'correlationId',
    'traceId',
    'spanId',

    'userId',
    'actorId',
    'sessionId',

    'tenantId',
    'organizationId',

    'service',
    'component',
    'operation',

    'requestMethod',
    'requestPath',
  ]);

/* =============================================================================
 * Runtime State
 * =============================================================================
 */

let loggerInstance = null;

let rootLogger = null;

let initialized = false;

let initializationPromise = null;

let configurationSnapshot = null;

let initializationError = null;

let shutdownRegistered = false;

/**
 * Async request/application context.
 */
const asyncContext =
  new AsyncLocalStorage();

/* =============================================================================
 * Errors
 * =============================================================================
 */

class LoggerBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'LoggerBootstrapError';

    this.code =
      options.code ||
      'LOGGER_BOOTSTRAP_ERROR';

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      LoggerBootstrapError,
    );
  }
}

/* =============================================================================
 * Safe Utility Functions
 * =============================================================================
 */

function normalizeLevel(
  value,
) {
  const level =
    String(
      value ??
        DEFAULT_LEVEL,
    )
      .trim()
      .toLowerCase();

  if (
    !LOG_LEVELS.includes(level)
  ) {
    throw new LoggerBootstrapError(
      `Unsupported TITech LOG_LEVEL "${level}".`,
      {
        code:
          'LOGGER_INVALID_LEVEL',

        details: {
          allowed:
            LOG_LEVELS,
        },
      },
    );
  }

  return level;
}

function normalizeBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled',
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

function normalizePositiveInteger(
  value,
  fallback,
) {
  const normalized =
    value === undefined ||
    value === null ||
    value === ''
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(
      normalized,
    ) ||
    normalized <= 0
  ) {
    return fallback;
  }

  return normalized;
}

function normalizeList(
  value,
  fallback = [],
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return [
      ...fallback,
    ];
  }

  if (
    Array.isArray(value)
  ) {
    return [
      ...value,
    ]
      .map(
        item =>
          String(item).trim(),
      )
      .filter(Boolean);
  }

  return String(value)
    .split(',')
    .map(
      item =>
        item.trim(),
    )
    .filter(Boolean);
}

function isPlainObject(
  value,
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function mergeContext(
  ...sources
) {
  const result = {};

  for (
    const source of sources
  ) {
    if (
      source &&
      typeof source === 'object'
    ) {
      Object.assign(
        result,
        source,
      );
    }
  }

  return result;
}

function sanitizeContext(
  context,
) {
  const output = {};

  if (
    !context ||
    typeof context !== 'object'
  ) {
    return output;
  }

  for (
    const field of
      DEFAULT_CONTEXT_FIELDS
  ) {
    if (
      context[field] !== undefined &&
      context[field] !== null
    ) {
      output[field] =
        context[field];
    }
  }

  return output;
}

function getCurrentContext() {
  return (
    asyncContext.getStore() ||
    {}
  );
}

function createRequestId() {
  return crypto.randomUUID();
}

/* =============================================================================
 * Error Serialization
 * =============================================================================
 */

function serializeError(
  error,
) {
  if (!error) {
    return null;
  }

  if (
    error instanceof Error
  ) {
    return {
      type:
        error.constructor?.name ||
        'Error',

      name:
        error.name,

      message:
        error.message,

      code:
        error.code,

      statusCode:
        error.statusCode,

      stack:
        error.stack,

      cause:
        error.cause
          ? serializeError(
              error.cause,
            )
          : undefined,
    };
  }

  if (
    typeof error === 'object'
  ) {
    return redactObject(
      error,
    );
  }

  return {
    message:
      String(error),
  };
}

/* =============================================================================
 * Sensitive Data Redaction
 * =============================================================================
 */

function redactObject(
  value,
  sensitiveKeys = DEFAULT_REDACT_PATHS,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  const sensitive =
    new Set(
      sensitiveKeys
        .map(
          key =>
            String(key)
              .split('.')
              .pop()
              .toLowerCase(),
        ),
    );

  const redact =
    current => {
      if (
        current === null ||
        current === undefined
      ) {
        return current;
      }

      if (
        Array.isArray(current)
      ) {
        return current.map(
          item =>
            redact(item),
        );
      }

      if (
        current instanceof Error
      ) {
        return serializeError(
          current,
        );
      }

      if (
        typeof current !== 'object'
      ) {
        return current;
      }

      const result = {};

      for (
        const [
          key,
          child,
        ] of Object.entries(
          current,
        )
      ) {
        if (
          sensitive.has(
            key.toLowerCase(),
          )
        ) {
          result[key] =
            '[REDACTED]';

          continue;
        }

        result[key] =
          redact(child);
      }

      return result;
    };

  return redact(value);
}

/* =============================================================================
 * Configuration
 * =============================================================================
 */

function resolveConfiguration(
  environment,
  config,
) {
  const environmentLogging =
    environment?.logging ||
    {};

  const configLogging =
    config?.logging ||
    config?.logger ||
    {};

  const nodeEnvironment =
    environment?.runtime?.nodeEnv ||
    environment?.app?.nodeEnv ||
    environment?.app?.environment ||
    process.env.NODE_ENV ||
    DEFAULT_ENVIRONMENT;

  const level =
    normalizeLevel(
      configLogging.level ??
        environmentLogging.level ??
        process.env.LOG_LEVEL ??
        DEFAULT_LEVEL,
    );

  const pretty =
    normalizeBoolean(
      configLogging.pretty ??
        environmentLogging.pretty ??
        process.env.LOG_PRETTY,
      nodeEnvironment ===
        'development',
    );

  const enabled =
    normalizeBoolean(
      configLogging.enabled ??
        environmentLogging.enabled ??
        process.env.LOGGING_ENABLED,
      true,
    );

  const redactSecrets =
    normalizeBoolean(
      configLogging.redactSecrets ??
        environmentLogging.redactSecrets ??
        process.env.LOG_REDACT_SECRETS,
      true,
    );

  const redactPaths =
    normalizeList(
      configLogging.redactPaths ??
        process.env.LOG_REDACT_PATHS,
      DEFAULT_REDACT_PATHS,
    );

  const serviceName =
    config?.app?.serviceName ||
    config?.service?.name ||
    environment?.app?.serviceName ||
    process.env.SERVICE_NAME ||
    LOGGER_NAME;

  const applicationName =
    config?.app?.name ||
    environment?.app?.name ||
    process.env.APP_NAME ||
    'TITech Community Capital';

  const version =
    config?.app?.version ||
    environment?.app?.version ||
    process.env.APP_VERSION ||
    DEFAULT_VERSION;

  const deployment =
    config?.deployment ||
    environment?.deployment ||
    {};

  const metadata =
    Object.freeze({
      service:
        serviceName,

      application:
        applicationName,

      version,

      environment:
        nodeEnvironment,

      hostname:
        os.hostname(),

      pid:
        process.pid,

      nodeVersion:
        process.version,

      platform:
        process.platform,

      architecture:
        process.arch,

      region:
        deployment.region,

      zone:
        deployment.zone,

      instanceId:
        deployment.instanceId,

      releaseId:
        deployment.releaseId,

      commitSha:
        deployment.commitSha,

      containerId:
        deployment.containerId,
    });

  return Object.freeze({
    enabled,

    level:
      enabled
        ? level
        : 'silent',

    pretty,

    redactSecrets,

    redactPaths:
      Object.freeze([
        ...redactPaths,
      ]),

    serviceName,

    applicationName,

    version,

    environment:
      nodeEnvironment,

    metadata,

    timestamp:
      process.env.LOG_TIMESTAMP !==
      'false',

    messageKey:
      process.env.LOG_MESSAGE_KEY ||
      'msg',

    levelKey:
      process.env.LOG_LEVEL_KEY ||
      'level',

    nameKey:
      process.env.LOG_NAME_KEY ||
      'logger',

    maxStackDepth:
      normalizePositiveInteger(
        process.env.LOG_STACK_DEPTH,
        20,
      ),
  });
}

/* =============================================================================
 * Pino Serializers
 * =============================================================================
 */

function serializeRequest(
  request,
) {
  if (!request) {
    return request;
  }

  return {
    id:
      request.id ||
      request.idempotencyKey,

    method:
      request.method,

    url:
      request.originalUrl ||
      request.url,

    userAgent:
      request.headers?.[
        'user-agent'
      ],

    remoteAddress:
      request.ip ||
      request.socket
        ?.remoteAddress,

    headers:
      request.headers
        ? redactObject(
            request.headers,
          )
        : undefined,
  };
}

function serializeResponse(
  response,
) {
  if (!response) {
    return response;
  }

  return {
    statusCode:
      response.statusCode,

    headers:
      typeof response.getHeaders ===
      'function'
        ? redactObject(
            response.getHeaders(),
          )
        : undefined,
  };
}

/* =============================================================================
 * Destination
 * =============================================================================
 */

function createDestination(
  options,
) {
  if (
    options.pretty !== true
  ) {
    return undefined;
  }

  let prettyModule;

  try {
    prettyModule =
      require.resolve(
        'pino-pretty',
      );
  } catch {
    return undefined;
  }

  return pino.transport({
    target:
      prettyModule,

    options: {
      colorize:
        process.env.LOG_COLOR !==
        'false',

      translateTime:
        'SYS:standard',

      ignore:
        'pid,hostname',

      singleLine:
        normalizeBoolean(
          process.env.LOG_SINGLE_LINE,
          true,
        ),
    },
  });
}

/* =============================================================================
 * Logger Factory
 * =============================================================================
 */

function createLogger(
  options = {},
) {
  const resolved =
    resolveConfiguration(
      options.environment,
      options.config,
    );

  const redaction =
    resolved.redactSecrets
      ? {
          paths:
            resolved.redactPaths,

          censor:
            '[REDACTED]',

          remove:
            false,
        }
      : undefined;

  const destination =
    createDestination(
      resolved,
    );

  const logger =
    pino(
      {
        name:
          resolved.serviceName,

        level:
          resolved.level,

        base:
          resolved.metadata,

        timestamp:
          resolved.timestamp
            ? pino.stdTimeFunctions
                .isoTime
            : false,

        messageKey:
          resolved.messageKey,

        levelKey:
          resolved.levelKey,

        serializers: {
          err:
            serializeError,

          error:
            serializeError,

          req:
            serializeRequest,

          request:
            serializeRequest,

          res:
            serializeResponse,

          response:
            serializeResponse,
        },

        redact:
          redaction,
      },

      destination,
    );

  return logger;
}

/* =============================================================================
 * Context-Aware Logger
 * =============================================================================
 */

function createContextAwareLogger(
  logger,
) {
  const facade = {
    get level() {
      return logger.level;
    },

    set level(value) {
      logger.level =
        value;
    },

    get bindings() {
      return logger.bindings();
    },

    get levelVal() {
      return logger.levelVal;
    },

    isLevelEnabled(
      level,
    ) {
      return logger.isLevelEnabled(
        level,
      );
    },

    child(
      bindings = {},
      options = {},
    ) {
      return createContextAwareLogger(
        logger.child(
          mergeContext(
            sanitizeContext(
              getCurrentContext(),
            ),
            sanitizeContext(
              bindings,
            ),
          ),
          options,
        ),
      );
    },

    withContext(
      bindings = {},
    ) {
      return createContextAwareLogger(
        logger.child(
          mergeContext(
            sanitizeContext(
              getCurrentContext(),
            ),
            sanitizeContext(
              bindings,
            ),
          ),
        ),
      );
    },

    runWithContext(
      bindings = {},
      callback,
    ) {
      if (
        typeof callback !==
        'function'
      ) {
        throw new TypeError(
          'TITech logger.runWithContext callback must be a function.',
        );
      }

      const merged =
        mergeContext(
          sanitizeContext(
            getCurrentContext(),
          ),
          sanitizeContext(
            bindings,
          ),
        );

      return asyncContext.run(
        merged,
        callback,
      );
    },

    getContext() {
      return sanitizeContext(
        getCurrentContext(),
      );
    },

    requestContext(
      bindings = {},
    ) {
      return mergeContext(
        sanitizeContext(
          getCurrentContext(),
        ),
        sanitizeContext(
          bindings,
        ),
      );
    },

    redactObject,

    fatal(
      ...args
    ) {
      return logger.fatal(
        createContextBindings(),
        ...args,
      );
    },

    error(
      ...args
    ) {
      return logger.error(
        createContextBindings(),
        ...args,
      );
    },

    warn(
      ...args
    ) {
      return logger.warn(
        createContextBindings(),
        ...args,
      );
    },

    info(
      ...args
    ) {
      return logger.info(
        createContextBindings(),
        ...args,
      );
    },

    debug(
      ...args
    ) {
      return logger.debug(
        createContextBindings(),
        ...args,
      );
    },

    trace(
      ...args
    ) {
      return logger.trace(
        createContextBindings(),
        ...args,
      );
    },

    silent(
      ...args
    ) {
      return logger.silent(
        ...args,
      );
    },

    flush(
      callback,
    ) {
      return logger.flush(
        callback,
      );
    },

    audit(
      payload = {},
      message = 'Audit event',
    ) {
      return logger.info(
        {
          eventType:
            'audit',

          ...createContextBindings(),

          ...redactObject(
            payload,
          ),
        },
        message,
      );
    },

    security(
      payload = {},
      message = 'Security event',
    ) {
      return logger.warn(
        {
          eventType:
            'security',

          ...createContextBindings(),

          ...redactObject(
            payload,
          ),
        },
        message,
      );
    },

    financial(
      payload = {},
      message = 'Financial event',
    ) {
      return logger.info(
        {
          eventType:
            'financial',

          ...createContextBindings(),

          ...redactObject(
            payload,
          ),
        },
        message,
      );
    },

    performance(
      payload = {},
      message =
        'Performance event',
    ) {
      return logger.info(
        {
          eventType:
            'performance',

          ...createContextBindings(),

          ...redactObject(
            payload,
          ),
        },
        message,
      );
    },

    raw:
      logger,

    log(
      ...args
    ) {
      return logger.info(
        createContextBindings(),
        ...args,
      );
    },
  };

  return Object.freeze(
    facade,
  );
}

function createContextBindings() {
  return sanitizeContext(
    getCurrentContext(),
  );
}

/* =============================================================================
 * Initialization
 * =============================================================================
 */

async function initializeLogger(
  options = {},
) {
  if (
    initialized &&
    loggerInstance
  ) {
    return loggerInstance;
  }

  if (
    initializationPromise
  ) {
    return initializationPromise;
  }

  initializationPromise =
    (async () => {
      try {
        const resolved =
          resolveConfiguration(
            options.environment,
            options.config,
          );

        const logger =
          createLogger(
            options,
          );

        rootLogger =
          logger;

        loggerInstance =
          createContextAwareLogger(
            logger,
          );

        configurationSnapshot =
          resolved;

        initialized =
          true;

        initializationError =
          null;

        return loggerInstance;
      } catch (error) {
        initializationError =
          error;

        throw (
          error instanceof
          LoggerBootstrapError
            ? error
            : new LoggerBootstrapError(
                'TITech logger initialization failed.',
                {
                  code:
                    'LOGGER_INITIALIZATION_FAILED',

                  cause:
                    error,
                },
              )
        );
      }
    })();

  try {
    return await initializationPromise;
  } finally {
    if (!initialized) {
      initializationPromise =
        null;
    }
  }
}

/* =============================================================================
 * Bootstrap Hook Registration
 * =============================================================================
 *
 * IMPORTANT:
 *
 * hooks.js is intentionally required lazily.
 *
 * This prevents logger.js from participating in the initial module dependency
 * cycle.
 * =============================================================================
 */

function getHooksModule() {
  try {
    return require('./hooks');
  } catch (error) {
    throw new LoggerBootstrapError(
      'Unable to load TITech bootstrap lifecycle hooks.',
      {
        code:
          'LOGGER_HOOKS_LOAD_FAILED',

        cause:
          error,
      },
    );
  }
}

function registerBootstrapHooks(
  context = {},
) {
  const {
    startup,
    registerShutdownHook,
    hooks,
  } =
    getHooksModule();

  if (
    hooks.has('logger')
  ) {
    return hooks.get(
      'logger',
    );
  }

  const registered =
    startup(
      'logger',
      async hookContext => {
        const logger =
          await initializeLogger({
            environment:
              hookContext?.environment,

            config:
              hookContext?.config,
          });

        /**
         * DO NOT mutate hookContext here.
         *
         * BootstrapHookRegistry intentionally provides immutable hook context.
         *
         * The returned logger is consumed by the canonical bootstrap
         * composition root.
         */
        return logger;
      },
      {
        priority:
          -700,

        dependencies: [
          'configuration',
        ],

        critical:
          true,

        fatal:
          true,

        metadata: {
          component:
            'logger',

          service:
            LOGGER_NAME,
        },
      },
    );

  if (
    !shutdownRegistered
  ) {
    registerShutdownHook(
      'logger-shutdown',
      async () => {
        await flush();
      },
      {
        priority:
          10_000,

        dependencies: [
          'logger',
        ],

        critical:
          false,

        fatal:
          false,
      },
    );

    shutdownRegistered =
      true;
  }

  return registered;
}

/* =============================================================================
 * Logger Access
 * =============================================================================
 */

function createFallbackLogger() {
  try {
    return pino({
      name:
        LOGGER_NAME,

      level:
        process.env.LOG_LEVEL ||
        DEFAULT_LEVEL,

      base: {
        service:
          LOGGER_NAME,

        application:
          'TITech Community Capital',

        environment:
          process.env.NODE_ENV ||
          DEFAULT_ENVIRONMENT,
      },

      timestamp:
        pino.stdTimeFunctions
          .isoTime,
    });
  } catch {
    /**
     * This path should only be reached if Pino itself is unavailable or
     * catastrophically misconfigured.
     *
     * The returned object keeps the application from failing merely because
     * diagnostics are unavailable.
     */
    return {
      fatal:
        console.error.bind(
          console,
        ),

      error:
        console.error.bind(
          console,
        ),

      warn:
        console.warn.bind(
          console,
        ),

      info:
        console.info.bind(
          console,
        ),

      debug:
        console.debug.bind(
          console,
        ),

      trace:
        console.debug.bind(
          console,
        ),

      silent() {},

      flush(callback) {
        callback?.();
      },

      child() {
        return this;
      },

      bindings() {
        return {};
      },

      isLevelEnabled() {
        return true;
      },

      level:
        DEFAULT_LEVEL,

      levelVal:
        30,
    };
  }
}

function getLogger() {
  if (
    loggerInstance
  ) {
    return loggerInstance;
  }

  if (
    !rootLogger
  ) {
    rootLogger =
      createFallbackLogger();
  }

  loggerInstance =
    createContextAwareLogger(
      rootLogger,
    );

  return loggerInstance;
}

function getRootLogger() {
  return rootLogger;
}

/* =============================================================================
 * Convenience Logging API
 * =============================================================================
 */

function fatal(
  ...args
) {
  return getLogger().fatal(
    ...args,
  );
}

function error(
  ...args
) {
  return getLogger().error(
    ...args,
  );
}

function warn(
  ...args
) {
  return getLogger().warn(
    ...args,
  );
}

function info(
  ...args
) {
  return getLogger().info(
    ...args,
  );
}

function debug(
  ...args
) {
  return getLogger().debug(
    ...args,
  );
}

function trace(
  ...args
) {
  return getLogger().trace(
    ...args,
  );
}

/* =============================================================================
 * Context API
 * =============================================================================
 */

function runWithContext(
  bindings,
  callback,
) {
  return getLogger().runWithContext(
    bindings,
    callback,
  );
}

function withContext(
  bindings,
) {
  return getLogger().withContext(
    bindings,
  );
}

function getContext() {
  return getLogger().getContext();
}

/* =============================================================================
 * Request Context
 * =============================================================================
 */

function createRequestContext(
  input = {},
) {
  const requestId =
    input.requestId ||
    createRequestId();

  return Object.freeze({
    requestId,

    correlationId:
      input.correlationId ||
      requestId,

    traceId:
      input.traceId,

    spanId:
      input.spanId,

    userId:
      input.userId,

    actorId:
      input.actorId,

    sessionId:
      input.sessionId,

    tenantId:
      input.tenantId,

    organizationId:
      input.organizationId,

    operation:
      input.operation,

    service:
      input.service ||
      configurationSnapshot
        ?.serviceName ||
      LOGGER_NAME,

    component:
      input.component,
  });
}

/* =============================================================================
 * Semantic Logging
 * =============================================================================
 */

function audit(
  payload,
  message,
) {
  return getLogger().audit(
    payload,
    message,
  );
}

function security(
  payload,
  message,
) {
  return getLogger().security(
    payload,
    message,
  );
}

function financial(
  payload,
  message,
) {
  return getLogger().financial(
    payload,
    message,
  );
}

function performance(
  payload,
  message,
) {
  return getLogger().performance(
    payload,
    message,
  );
}

/* =============================================================================
 * Flush
 * =============================================================================
 */

async function flush() {
  const logger =
    rootLogger;

  if (!logger) {
    return;
  }

  await new Promise(
    resolve => {
      let settled = false;

      const complete =
        () => {
          if (settled) {
            return;
          }

          settled = true;
          resolve();
        };

      try {
        if (
          typeof logger.flush !==
          'function'
        ) {
          complete();
          return;
        }

        logger.flush(
          complete,
        );
      } catch {
        complete();
      }
    },
  );
}

/* =============================================================================
 * Shutdown
 * =============================================================================
 */

async function shutdown() {
  await flush();

  loggerInstance =
    null;

  rootLogger =
    null;

  initialized =
    false;

  initializationPromise =
    null;

  configurationSnapshot =
    null;

  initializationError =
    null;

  /**
   * This flag deliberately remains true.
   *
   * Bootstrap hook registration is process-scoped and should not repeatedly
   * register the same shutdown hook.
   */
}

/* =============================================================================
 * Diagnostics
 * =============================================================================
 */

function snapshot() {
  const configuration =
    configurationSnapshot;

  return Object.freeze({
    initialized,

    available:
      Boolean(
        loggerInstance,
      ),

    level:
      configuration?.level ||
      DEFAULT_LEVEL,

    enabled:
      configuration?.enabled ??
      true,

    pretty:
      configuration?.pretty ??
      false,

    redactSecrets:
      configuration?.redactSecrets ??
      true,

    serviceName:
      configuration?.serviceName ||
      LOGGER_NAME,

    applicationName:
      configuration?.applicationName ||
      'TITech Community Capital',

    environment:
      configuration?.environment ||
      'unknown',

    version:
      configuration?.version ||
      DEFAULT_VERSION,

    pid:
      process.pid,

    hostname:
      os.hostname(),

    initializationFailed:
      Boolean(
        initializationError,
      ),

    initializationError:
      initializationError
        ? {
            name:
              initializationError.name,

            code:
              initializationError.code,

            message:
              initializationError.message,
          }
        : null,
  });
}

/* =============================================================================
 * Public API
 * =============================================================================
 */

const loggerModule =
  Object.freeze({
    /* -------------------------------------------------------------------------
     * Core logger
     * ----------------------------------------------------------------------- */

    logger:
      getLogger(),

    getLogger,

    getRootLogger,

    /* -------------------------------------------------------------------------
     * Initialization / Lifecycle
     * ----------------------------------------------------------------------- */

    initialize:
      initializeLogger,

    initializeLogger,

    registerBootstrapHooks,

    shutdown,

    flush,

    /* -------------------------------------------------------------------------
     * Context
     * ----------------------------------------------------------------------- */

    runWithContext,

    withContext,

    getContext,

    createRequestContext,

    /* -------------------------------------------------------------------------
     * Semantic logging
     * ----------------------------------------------------------------------- */

    audit,

    security,

    financial,

    performance,

    /* -------------------------------------------------------------------------
     * Standard levels
     * ----------------------------------------------------------------------- */

    fatal,

    error,

    warn,

    info,

    debug,

    trace,

    /* -------------------------------------------------------------------------
     * Security
     * ----------------------------------------------------------------------- */

    redactObject,

    /* -------------------------------------------------------------------------
     * Diagnostics
     * ----------------------------------------------------------------------- */

    snapshot,

    /* -------------------------------------------------------------------------
     * Constants / errors
     * ----------------------------------------------------------------------- */

    LoggerBootstrapError,

    LOGGER_NAME,

    DEFAULT_REDACT_PATHS,

    LOG_LEVELS,
  });

export default loggerModule;