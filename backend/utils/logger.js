// ============================================================================
// TITech Community Capital
// Enterprise Production Logger & Observability Service
// File: backend/utils/logger.js
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Structured Winston logging
// - Safe startup before request context exists
// - Request/correlation/tenant context enrichment
// - Sensitive-data redaction
// - Console and file logging
// - Optional MongoDB audit transport
// - Child/request loggers
// - Security/audit/performance logging
// - Safe exception handling
// - No circular bootstrap dependency
// - TITech terminology consistency
// ============================================================================

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  createLogger,
  format,
  transports,
} = require('winston');

const {
  combine,
  timestamp,
  printf,
  json,
  errors,
  colorize,
  splat,
  metadata,
} = format;

/* ============================================================================
 * Optional dependencies
 * ========================================================================== */

let MongoDBTransport = null;
let DailyRotateFile = null;

try {
  MongoDBTransport =
    require('winston-mongodb').MongoDB;
} catch {
  MongoDBTransport = null;
}

try {
  DailyRotateFile =
    require('winston-daily-rotate-file');
} catch {
  DailyRotateFile = null;
}

/* ============================================================================
 * Runtime configuration
 * ========================================================================== */

const LOG_LEVEL =
  String(
    process.env.LOG_LEVEL ||
      'info',
  )
    .trim()
    .toLowerCase();

const NODE_ENV =
  String(
    process.env.NODE_ENV ||
      'development',
  )
    .trim()
    .toLowerCase();

const LOG_DIR =
  process.env.LOG_DIR ||
  path.join(
    process.cwd(),
    'logs',
  );

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const SERVICE_VERSION =
  process.env.SERVICE_VERSION ||
  process.env.APP_VERSION ||
  '1.0.0';

const HOSTNAME =
  os.hostname();

const AUDIT_LOG_URI =
  process.env.AUDIT_LOG_URI ||
  process.env.MONGO_AUDIT_URI ||
  null;

const ENABLE_FILE_LOGGING =
  process.env.ENABLE_FILE_LOGGING !==
  'false';

const ENABLE_CONSOLE_LOGGING =
  process.env.ENABLE_CONSOLE_LOGGING !==
  'false';

const ENABLE_MONGODB_AUDIT =
  Boolean(
    AUDIT_LOG_URI &&
      MongoDBTransport,
  );

/* ============================================================================
 * Sensitive data protection
 * ========================================================================== */

const SENSITIVE_KEYS = Object.freeze([
  'authorization',
  'password',
  'passwd',
  'passcode',
  'token',
  'accesstoken',
  'refreshToken',
  'refresh_token',
  'cookie',
  'set-cookie',
  'pin',
  'otp',
  'secret',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'api-key',
  'clientsecret',
  'client_secret',
  'cardnumber',
  'card_number',
  'cvv',
  'nationalid',
  'national_id',
  'nin',
  'ssn',
  'mongouri',
  'mongo_uri',
  'databaseurl',
  'database_url',
  'redisurl',
  'redis_uri',
  'connectionstring',
]);

function isSensitiveKey(
  key,
) {
  const normalized =
    String(key)
      .replace(/[-\s]/g, '')
      .toLowerCase();

  return SENSITIVE_KEYS.some(
    (sensitive) =>
      normalized.includes(
        sensitive
          .replace(
            /[-\s]/g,
            '',
          )
          .toLowerCase(),
      ),
  );
}

/**
 * Deep-redact an object without throwing.
 */
function redactMeta(
  meta = {},
) {
  if (
    !meta ||
    typeof meta !==
      'object'
  ) {
    return {};
  }

  try {
    const clone =
      JSON.parse(
        JSON.stringify(meta),
      );

    const scrub = (
      value,
    ) => {
      if (
        !value ||
        typeof value !==
          'object'
      ) {
        return;
      }

      for (
        const key of Object.keys(
          value,
        )
      ) {
        if (
          isSensitiveKey(key)
        ) {
          value[key] =
            '[REDACTED]';

          continue;
        }

        if (
          value[key] &&
          typeof value[key] ===
            'object'
        ) {
          scrub(
            value[key],
          );
        }
      }
    };

    scrub(clone);

    return clone;
  } catch {
    return {};
  }
}

/* ============================================================================
 * Request context integration
 * ========================================================================== */

/**
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * Do not require requestContext while logger.js itself is initializing.
 *
 * requestContext.js has a lazy dependency back to logger.js. Requiring it
 * here during logger startup creates:
 *
 * logger.js
 *   -> requestContext.js
 *        -> logger.js
 *
 * That produces CommonJS circular-dependency warnings and can expose
 * partially initialized module exports.
 *
 * We therefore inspect require.cache instead.
 *
 * During application startup requestContext normally is not cached yet, so
 * logger initialization proceeds with empty request metadata.
 *
 * Once requestContext has been loaded by the HTTP layer, it is already cached
 * and its context becomes available to subsequent log messages.
 * ============================================================================
 */

let requestContext = null;

function loadRequestContext() {
  if (requestContext) {
    return requestContext;
  }

  try {
    const requestContextPath =
      require.resolve(
        '../middleware/requestContext',
      );

    const cachedModule =
      require.cache[
        requestContextPath
      ];

    if (!cachedModule) {
      return null;
    }

    requestContext =
      cachedModule.exports ||
      null;

    return requestContext;
  } catch {
    return null;
  }
}

function getRequestMeta() {
  try {
    const contextModule =
      loadRequestContext();

    if (
      !contextModule ||
      typeof contextModule.getContext !==
        'function'
    ) {
      return {};
    }

    const context =
      contextModule.getContext() ||
      {};

    return {
      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      traceId:
        context.traceId,

      spanId:
        context.spanId,

      tenantId:
        context.tenantId,

      organizationId:
        context.organizationId,

      userId:
        context.userId,
    };
  } catch {
    return {};
  }
}

/* ============================================================================
 * Log directory
 * ========================================================================== */

if (
  ENABLE_FILE_LOGGING &&
  !fs.existsSync(LOG_DIR)
) {
  try {
    fs.mkdirSync(
      LOG_DIR,
      {
        recursive:
          true,
      },
    );
  } catch {
    /*
     * File logging is optional. Console logging remains available.
     */
  }
}

/* ============================================================================
 * Formatters
 * ========================================================================== */

const devConsoleFormat =
  printf(
    ({
      level,
      message,
      timestamp:
        logTimestamp,
      stack,
      ...meta
    }) => {
      const safeMeta =
        redactMeta(
          meta,
        );

      const metadataString =
        Object.keys(
          safeMeta,
        ).length
          ? `\n${JSON.stringify(
              safeMeta,
              null,
              2,
            )}`
          : '';

      return (
        `${logTimestamp} ` +
        `[${SERVICE_NAME}] ` +
        `${level}: ${message}` +
        (
          stack
            ? `\n${stack}`
            : ''
        ) +
        metadataString
      );
    },
  );

const productionFormat =
  combine(
    timestamp(),
    errors({
      stack: true,
    }),
    splat(),
    metadata(),
    json(),
  );

/* ============================================================================
 * Transport configuration
 * ========================================================================== */

const transportList = [];

/* ----------------------------------------------------------------------------
 * Console transport
 * -------------------------------------------------------------------------- */

if (
  ENABLE_CONSOLE_LOGGING
) {
  transportList.push(
    new transports.Console({
      level:
        LOG_LEVEL,

      handleExceptions:
        true,

      format:
        NODE_ENV ===
        'production'
          ? productionFormat
          : combine(
              colorize(),
              timestamp(),
              errors({
                stack:
                  true,
              }),
              splat(),
              devConsoleFormat,
            ),
    }),
  );
}

/* ----------------------------------------------------------------------------
 * File transports
 * -------------------------------------------------------------------------- */

if (
  ENABLE_FILE_LOGGING
) {
  if (
    DailyRotateFile
  ) {
    transportList.push(
      new DailyRotateFile({
        level:
          LOG_LEVEL,

        filename:
          path.join(
            LOG_DIR,
            '%DATE%-application.log',
          ),

        datePattern:
          'YYYY-MM-DD',

        zippedArchive:
          true,

        maxSize:
          '20m',

        maxFiles:
          '30d',

        handleExceptions:
          true,

        format:
          productionFormat,
      }),
    );

    transportList.push(
      new DailyRotateFile({
        level:
          'error',

        filename:
          path.join(
            LOG_DIR,
            '%DATE%-error.log',
          ),

        datePattern:
          'YYYY-MM-DD',

        zippedArchive:
          true,

        maxSize:
          '20m',

        maxFiles:
          '60d',

        handleExceptions:
          true,

        format:
          productionFormat,
      }),
    );
  } else {
    transportList.push(
      new transports.File({
        level:
          LOG_LEVEL,

        filename:
          path.join(
            LOG_DIR,
            'application.log',
          ),

        maxsize:
          20 *
          1024 *
          1024,

        maxFiles:
          10,

        handleExceptions:
          true,

        format:
          productionFormat,
      }),
    );
  }
}

/* ----------------------------------------------------------------------------
 * Optional MongoDB audit transport
 * -------------------------------------------------------------------------- */

if (
  ENABLE_MONGODB_AUDIT
) {
  try {
    transportList.push(
      new MongoDBTransport({
        db:
          AUDIT_LOG_URI,

        collection:
          'auditlogs',

        level:
          'info',

        tryReconnect:
          true,

        options: {
          useUnifiedTopology:
            true,
        },

        format:
          productionFormat,
      }),
    );
  } catch {
    /*
     * Never allow an optional audit transport to prevent application startup.
     */
  }
}

/* ============================================================================
 * Winston logger
 * ========================================================================== */

const logger =
  createLogger({
    level:
      LOG_LEVEL,

    defaultMeta: {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      environment:
        NODE_ENV,

      hostname:
        HOSTNAME,
    },

    transports:
      transportList,

    exitOnError:
      false,
  });

/* ============================================================================
 * Safe metadata enrichment
 * ========================================================================== */

function enrich(
  meta = {},
) {
  return redactMeta({
    ...getRequestMeta(),
    ...meta,
  });
}

/* ============================================================================
 * Morgan compatibility
 * ========================================================================== */

logger.stream = {
  write(
    message,
  ) {
    logger.info(
      String(
        message,
      ).trim(),
    );
  },
};

/* ============================================================================
 * Child logger
 * ========================================================================== */

logger.child =
  function child(
    baseMeta = {},
  ) {
    const base =
      enrich(
        baseMeta,
      );

    return {
      info(
        message,
        extra = {},
      ) {
        logger.info(
          message,
          {
            ...base,
            ...enrich(
              extra,
            ),
          },
        );
      },

      warn(
        message,
        extra = {},
      ) {
        logger.warn(
          message,
          {
            ...base,
            ...enrich(
              extra,
            ),
          },
        );
      },

      error(
        message,
        extra = {},
      ) {
        logger.error(
          message,
          {
            ...base,
            ...enrich(
              extra,
            ),
          },
        );
      },

      debug(
        message,
        extra = {},
      ) {
        logger.debug(
          message,
          {
            ...base,
            ...enrich(
              extra,
            ),
          },
        );
      },
    };
  };

/* ============================================================================
 * Request-scoped logger
 * ========================================================================== */

logger.withRequest =
  function withRequest(
    requestId,
    extra = {},
  ) {
    return logger.child({
      requestId,
      ...extra,
    });
  };

logger.infoWith =
  function infoWith(
    requestId,
    message,
    meta = {},
  ) {
    return logger
      .withRequest(
        requestId,
      )
      .info(
        message,
        meta,
      );
  };

logger.warnWith =
  function warnWith(
    requestId,
    message,
    meta = {},
  ) {
    return logger
      .withRequest(
        requestId,
      )
      .warn(
        message,
        meta,
      );
  };

logger.errorWith =
  function errorWith(
    requestId,
    message,
    meta = {},
  ) {
    return logger
      .withRequest(
        requestId,
      )
      .error(
        message,
        meta,
      );
  };

/* ============================================================================
 * Audit logging
 * ========================================================================== */

logger.audit =
  function audit(
    action,
    metadata = {},
  ) {
    logger.info(
      `AUDIT:${action}`,
      enrich({
        audit:
          true,

        action,

        ...metadata,
      }),
    );
  };

/* ============================================================================
 * Performance logging
 * ========================================================================== */

logger.performance =
  function performance(
    operation,
    duration,
    metadata = {},
  ) {
    logger.info(
      `PERFORMANCE:${operation}`,
      enrich({
        operation,
        duration,
        ...metadata,
      }),
    );
  };

/* ============================================================================
 * Security logging
 * ========================================================================== */

logger.security =
  function security(
    event,
    metadata = {},
  ) {
    logger.warn(
      `SECURITY:${event}`,
      enrich(
        metadata,
      ),
    );
  };

/* ============================================================================
 * Startup logging
 * ========================================================================== */

logger.startup =
  function startup(
    message,
    metadata = {},
  ) {
    /*
     * Startup logs intentionally use enrich(), but enrich() no longer
     * initializes requestContext and therefore cannot create a logger cycle.
     */
    logger.info(
      `STARTUP:${message}`,
      enrich(
        metadata,
      ),
    );
  };

/* ============================================================================
 * Shutdown logging
 * ========================================================================== */

logger.shutdown =
  function shutdown(
    message,
    metadata = {},
  ) {
    logger.info(
      `SHUTDOWN:${message}`,
      enrich(
        metadata,
      ),
    );
  };

/* ============================================================================
 * Degraded mode logging
 * ========================================================================== */

let degradedLogged =
  false;

logger.logDegradedOnce =
  function logDegradedOnce(
    message,
    metadata = {},
  ) {
    if (
      degradedLogged
    ) {
      return;
    }

    degradedLogged =
      true;

    logger.warn(
      message,
      enrich(
        metadata,
      ),
    );
  };

/* ============================================================================
 * Process exception handling
 * ========================================================================== */

logger.handleUncaught =
  function handleUncaught() {
    process.on(
      'unhandledRejection',
      (reason) => {
        logger.error(
          'Unhandled promise rejection.',
          {
            reason:
              reason?.stack ||
              reason,
          },
        );
      },
    );

    process.on(
      'uncaughtException',
      (error) => {
        logger.error(
          'Uncaught exception.',
          {
            error:
              error?.stack ||
              error,
          },
        );

        setTimeout(
          () => {
            process.exit(
              1,
            );
          },
          1_000,
        ).unref?.();
      },
    );
  };

/* ============================================================================
 * Startup banner
 * ========================================================================== */

logger.startup(
  'Logger initialized',
  {
    service:
      SERVICE_NAME,

    version:
      SERVICE_VERSION,

    environment:
      NODE_ENV,

    hostname:
      HOSTNAME,

    level:
      LOG_LEVEL,
  },
);

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
  logger;