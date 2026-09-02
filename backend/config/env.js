'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/env.js
 *
 * Purpose:
 *   Enterprise production-grade environment variable access, normalization and
 *   validation boundary.
 *
 * Responsibilities:
 *   - Centralize process.env access.
 *   - Normalize common environment variable types.
 *   - Validate required environment variables.
 *   - Prevent accidental secret exposure.
 *   - Support environment-aware configuration.
 *   - Provide immutable normalized environment snapshots.
 *   - Detect unsafe production configuration.
 *   - Support typed access for downstream configuration modules.
 *   - Provide compatibility with bootstrapEnvironment.js and configProvider.js.
 *
 * IMPORTANT:
 *
 *   This module owns ENVIRONMENT VARIABLE ACCESS.
 *
 *   It does NOT:
 *     - connect MongoDB.
 *     - connect Redis.
 *     - start Express.
 *     - implement authentication.
 *     - implement audit persistence.
 *     - implement cache infrastructure.
 *     - implement business logic.
 *     - mutate process.env.
 *
 * Architectural position:
 *
 *   OS / container environment
 *           ↓
 *       process.env
 *           ↓
 *     backend/config/env.js
 *           ↓
 *     bootstrapEnvironment.js
 *           ↓
 *      config/index.js
 *           ↓
 *     configProvider.js
 *           ↓
 *       application
 *
 * =============================================================================
 */

const fs =
  require('node:fs');

const path =
  require('node:path');

/**
 * -----------------------------------------------------------------------------
 * Optional dotenv
 * -----------------------------------------------------------------------------
 *
 * Environment loading is best-effort. Deployment platforms should normally
 * provide environment variables directly. .env files remain useful for local
 * development and testing.
 * -----------------------------------------------------------------------------
 */

let dotenvLoaded =
  false;

try {
  // eslint-disable-next-line global-require
  const dotenv =
    require('dotenv');

  const envFile =
    process.env.DOTENV_CONFIG_PATH ||
    path.resolve(
      process.cwd(),
      '.env',
    );

  if (
    fs.existsSync(
      envFile,
    )
  ) {
    dotenv.config({
      path:
        envFile,
      override:
        process.env
          .DOTENV_OVERRIDE ===
        'true',
    });

    dotenvLoaded =
      true;
  }
} catch {
  /**
   * dotenv is optional. Production environments commonly inject values
   * directly into the process environment.
   */
}

/**
 * -----------------------------------------------------------------------------
 * Optional startup error integration
 * -----------------------------------------------------------------------------
 */

let startupErrors =
  null;

try {
  // eslint-disable-next-line global-require
  startupErrors =
    require('../bootstrap/startupErrors');
} catch {
  startupErrors =
    null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional logger integration
 * -----------------------------------------------------------------------------
 */

let loggerModule =
  null;

try {
  // eslint-disable-next-line global-require
  loggerModule =
    require('../utils/logger');
} catch {
  loggerModule =
    null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'environment';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const DEFAULT_NODE_ENV =
  'development';

const ENVIRONMENTS =
  Object.freeze([
    'development',
    'test',
    'staging',
    'production',
  ]);

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

const TRUE_VALUES =
  Object.freeze([
    '1',
    'true',
    'yes',
    'y',
    'on',
    'enabled',
  ]);

const FALSE_VALUES =
  Object.freeze([
    '0',
    'false',
    'no',
    'n',
    'off',
    'disabled',
  ]);

/**
 * =============================================================================
 * Sensitive Environment Variables
 * =============================================================================
 */

const SENSITIVE_ENV_KEYS =
  Object.freeze([
    'PASSWORD',
    'PASSCODE',
    'PIN',
    'OTP',
    'TOKEN',
    'ACCESS_TOKEN',
    'REFRESH_TOKEN',
    'AUTHORIZATION',
    'COOKIE',
    'SET_COOKIE',
    'SECRET',
    'API_KEY',
    'APIKEY',
    'CLIENT_SECRET',
    'PRIVATE_KEY',
    'ENCRYPTION_KEY',
    'JWT_SECRET',
    'SESSION_SECRET',
    'MONGO_URI',
    'MONGODB_URI',
    'MONGO_URI_FALLBACK',
    'MONGODB_URI_FALLBACK',
    'DATABASE_URL',
    'DATABASE_URI',
    'REDIS_URL',
    'REDIS_URI',
    'REDIS_PASSWORD',
    'SMTP_PASSWORD',
    'SMTP_PASS',
    'AWS_SECRET_ACCESS_KEY',
    'GCP_PRIVATE_KEY',
    'STRIPE_SECRET_KEY',
    'SENTRY_DSN',
  ]);

const SENSITIVE_ENV_PATTERN =
  /(password|passcode|pin|otp|token|secret|authorization|cookie|api[_-]?key|private[_-]?key|encryption[_-]?key|credential|dsn|connection|string|uri|url)/i;

/**
 * =============================================================================
 * Default Groups
 * =============================================================================
 */

const DEFAULTS =
  Object.freeze({
    nodeEnv:
      DEFAULT_NODE_ENV,

    serviceName:
      SERVICE_NAME,

    applicationName:
      APPLICATION_NAME,

    version:
      process.env.npm_package_version ||
      '0.0.0',

    host:
      '0.0.0.0',

    port:
      3000,

    logLevel:
      'info',

    trustProxy:
      false,

    gracefulShutdown:
      true,

    startupTimeoutMs:
      120_000,

    shutdownTimeoutMs:
      30_000,

    healthTimeoutMs:
      5_000,

    readinessTimeoutMs:
      5_000,
  });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class EnvConfigError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'EnvConfigError';

    this.code =
      options.code ||
      'ENV_CONFIG_ERROR';

    this.variable =
      options.variable ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    this.cause =
      options.cause ||
      null;

    Error.captureStackTrace?.(
      this,
      EnvConfigError,
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function normalizeKey(
  key,
) {
  if (
    typeof key !==
      'string' ||
    key.trim() ===
      ''
  ) {
    throw new TypeError(
      'Environment variable name must be a non-empty string.',
    );
  }

  return key.trim();
}

function raw(
  key,
  fallback =
    undefined,
) {
  const name =
    normalizeKey(
      key,
    );

  const value =
    process.env[name];

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return fallback;
  }

  return value;
}

function string(
  key,
  fallback =
    undefined,
  options = {},
) {
  const value =
    raw(
      key,
      fallback,
    );

  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  if (
    normalized === ''
  ) {
    if (
      options.allowEmpty ===
      true
    ) {
      return '';
    }

    return fallback;
  }

  return normalized;
}

function boolean(
  key,
  fallback =
    false,
  options = {},
) {
  const value =
    raw(
      key,
      undefined,
    );

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return fallback;
  }

  if (
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  const normalized =
    String(
      value,
    )
      .trim()
      .toLowerCase();

  if (
    TRUE_VALUES.includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    FALSE_VALUES.includes(
      normalized,
    )
  ) {
    return false;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must be a boolean.`,
      {
        code:
          'ENV_BOOLEAN_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function number(
  key,
  fallback =
    undefined,
  options = {},
) {
  const value =
    raw(
      key,
      undefined,
    );

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return fallback;
  }

  const parsed =
    Number(
      value,
    );

  if (
    Number.isFinite(
      parsed,
    )
  ) {
    return parsed;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must be numeric.`,
      {
        code:
          'ENV_NUMBER_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function integer(
  key,
  fallback =
    undefined,
  options = {},
) {
  const parsed =
    number(
      key,
      fallback,
      options,
    );

  if (
    parsed ===
      undefined ||
    parsed ===
      null
  ) {
    return fallback;
  }

  if (
    Number.isInteger(
      parsed,
    )
  ) {
    return parsed;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must be an integer.`,
      {
        code:
          'ENV_INTEGER_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function positiveInteger(
  key,
  fallback =
    undefined,
  options = {},
) {
  const parsed =
    integer(
      key,
      fallback,
      options,
    );

  if (
    parsed ===
      undefined ||
    parsed ===
      null
  ) {
    return fallback;
  }

  if (
    parsed >
    0
  ) {
    return parsed;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must be a positive integer.`,
      {
        code:
          'ENV_POSITIVE_INTEGER_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function nonNegativeInteger(
  key,
  fallback =
    undefined,
  options = {},
) {
  const parsed =
    integer(
      key,
      fallback,
      options,
    );

  if (
    parsed ===
      undefined ||
    parsed ===
      null
  ) {
    return fallback;
  }

  if (
    parsed >=
    0
  ) {
    return parsed;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must be a non-negative integer.`,
      {
        code:
          'ENV_NON_NEGATIVE_INTEGER_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function port(
  key,
  fallback =
    3000,
  options = {},
) {
  const parsed =
    integer(
      key,
      fallback,
      options,
    );

  if (
    parsed >=
      1 &&
    parsed <=
      65_535
  ) {
    return parsed;
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" must contain a valid TCP port.`,
      {
        code:
          'ENV_PORT_INVALID',

        variable:
          key,
      },
    );
  }

  return fallback;
}

function list(
  key,
  fallback = [],
  options = {},
) {
  const value =
    raw(
      key,
      undefined,
    );

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return [
      ...fallback,
    ];
  }

  const items =
    Array.isArray(
      value,
    )
      ? value
      : String(
          value,
        ).split(',');

  const normalized =
    items
      .map(
        item =>
          String(
            item,
          ).trim(),
      )
      .filter(Boolean);

  if (
    options.unique !==
      false
  ) {
    return [
      ...new Set(
        normalized,
      ),
    ];
  }

  return normalized;
}

function json(
  key,
  fallback = {},
  options = {},
) {
  const value =
    raw(
      key,
      undefined,
    );

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return fallback;
  }

  try {
    return JSON.parse(
      value,
    );
  } catch (error) {
    if (
      options.strict ===
      true
    ) {
      throw new EnvConfigError(
        `Environment variable "${key}" contains invalid JSON.`,
        {
          code:
            'ENV_JSON_INVALID',

          variable:
            key,

          cause:
            error,
        },
      );
    }

    return fallback;
  }
}

function enumValue(
  key,
  values,
  fallback,
  options = {},
) {
  const value =
    string(
      key,
      undefined,
    );

  if (
    value ===
      undefined
  ) {
    return fallback;
  }

  if (
    values.includes(
      value,
    )
  ) {
    return value;
  }

  if (
    options.caseInsensitive
  ) {
    const normalized =
      value.toLowerCase();

    const match =
      values.find(
        item =>
          String(
            item,
          ).toLowerCase() ===
          normalized,
      );

    if (
      match
    ) {
      return match;
    }
  }

  if (
    options.strict ===
    true
  ) {
    throw new EnvConfigError(
      `Environment variable "${key}" contains unsupported value "${value}".`,
      {
        code:
          'ENV_ENUM_INVALID',

        variable:
          key,

        details: {
          allowed:
            values,
        },
      },
    );
  }

  return fallback;
}

function durationMs(
  key,
  fallback,
  options = {},
) {
  const value =
    string(
      key,
      undefined,
    );

  if (
    value ===
      undefined
  ) {
    return fallback;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  /**
   * Plain numbers are interpreted as milliseconds.
   */
  if (
    /^-?\d+(\.\d+)?$/.test(
      normalized,
    )
  ) {
    const parsed =
      Number(
        normalized,
      );

    if (
      Number.isFinite(
        parsed,
      ) &&
      parsed >=
        0
    ) {
      return parsed;
    }
  }

  const match =
    normalized.match(
      /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/,
    );

  if (
    !match
  ) {
    if (
      options.strict ===
      true
    ) {
      throw new EnvConfigError(
        `Environment variable "${key}" contains an invalid duration "${value}".`,
        {
          code:
            'ENV_DURATION_INVALID',

          variable:
            key,
        },
      );
    }

    return fallback;
  }

  const amount =
    Number(
      match[1],
    );

  const multipliers = {
    ms:
      1,

    s:
      1_000,

    m:
      60_000,

    h:
      3_600_000,

    d:
      86_400_000,
  };

  return amount *
    multipliers[
      match[2]
    ];
}

function url(
  key,
  fallback =
    undefined,
  options = {},
) {
  const value =
    string(
      key,
      fallback,
    );

  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return fallback;
  }

  try {
    return new URL(
      value,
    ).toString();
  } catch (error) {
    if (
      options.strict ===
      true
    ) {
      throw new EnvConfigError(
        `Environment variable "${key}" contains an invalid URL.`,
        {
          code:
            'ENV_URL_INVALID',

          variable:
            key,

          cause:
            error,
        },
      );
    }

    return fallback;
  }
}

/**
 * =============================================================================
 * Environment classification
 * =============================================================================
 */

function getNodeEnv() {
  return enumValue(
    'NODE_ENV',
    ENVIRONMENTS,
    DEFAULTS.nodeEnv,
    {
      caseInsensitive:
        true,

      strict:
        true,
    },
  );
}

function isProduction() {
  return (
    getNodeEnv() ===
    'production'
  );
}

function isStaging() {
  return (
    getNodeEnv() ===
    'staging'
  );
}

function isDevelopment() {
  return (
    getNodeEnv() ===
    'development'
  );
}

function isTest() {
  return (
    getNodeEnv() ===
    'test'
  );
}

/**
 * =============================================================================
 * Required variable validation
 * =============================================================================
 */

function required(
  key,
  options = {},
) {
  const value =
    string(
      key,
      undefined,
      {
        allowEmpty:
          false,
      },
    );

  if (
    value !==
      undefined
  ) {
    return value;
  }

  throw new EnvConfigError(
    `Required TITech environment variable "${key}" is missing.`,
    {
      code:
        'ENV_REQUIRED_MISSING',

      variable:
        key,

      details:
        options.details ||
        {},
    },
  );
}

function requireAny(
  keys,
  options = {},
) {
  if (
    !Array.isArray(
      keys,
    ) ||
    keys.length ===
      0
  ) {
    throw new TypeError(
      'requireAny() requires at least one environment variable name.',
    );
  }

  for (
    const key of
      keys
  ) {
    const value =
      string(
        key,
        undefined,
      );

    if (
      value !==
        undefined
    ) {
      return value;
    }
  }

  throw new EnvConfigError(
    `At least one of the following TITech environment variables is required: ${keys.join(
      ', ',
    )}.`,
    {
      code:
        'ENV_REQUIRED_ANY_MISSING',

      details:
        options.details ||
        {
          keys,
        },
    },
  );
}

function validateRequired(
  keys = [],
) {
  const missing =
    [];

  for (
    const key of
      keys
  ) {
    if (
      string(
        key,
        undefined,
      ) ===
        undefined
    ) {
      missing.push(
        key,
      );
    }
  }

  if (
    missing.length >
    0
  ) {
    throw new EnvConfigError(
      'Required TITech environment variables are missing.',
      {
        code:
          'ENV_REQUIRED_VARIABLES_MISSING',

        details: {
          missing,
        },
      },
    );
  }

  return true;
}

/**
 * =============================================================================
 * Production validation
 * =============================================================================
 */

function validateProductionEnvironment(
  options = {},
) {
  const production =
    isProduction();

  if (
    !production
  ) {
    return {
      valid:
        true,

      warnings: [],
    };
  }

  const errors =
    [];

  const warnings =
    [];

  /**
   * ---------------------------------------------------------------------------
   * Secrets
   * ---------------------------------------------------------------------------
   */

  const requiredProductionSecrets =
    options.requiredSecrets ||
    [
      'JWT_SECRET',
    ];

  for (
    const key of
      requiredProductionSecrets
  ) {
    if (
      string(
        key,
        undefined,
      ) ===
      undefined
    ) {
      errors.push({
        code:
          'PRODUCTION_SECRET_MISSING',

        variable:
          key,
      });
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Database
   * ---------------------------------------------------------------------------
   */

  if (
    boolean(
      'DATABASE_ENABLED',
      true,
    ) &&
    boolean(
      'DATABASE_REQUIRED',
      true,
    )
  ) {
    if (
      string(
        'MONGO_URI',
        string(
          'MONGODB_URI',
          undefined,
        ),
      ) ===
        undefined
    ) {
      errors.push({
        code:
          'PRODUCTION_DATABASE_URI_MISSING',

        variable:
          'MONGO_URI',
      });
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * CORS
   * ---------------------------------------------------------------------------
   */

  if (
    boolean(
      'CORS_ENABLED',
      true,
    ) &&
    boolean(
      'CORS_CREDENTIALS',
      true,
    )
  ) {
    if (
      boolean(
        'CORS_ALLOW_WILDCARD',
        false,
      )
    ) {
      errors.push({
        code:
          'PRODUCTION_CORS_WILDCARD_WITH_CREDENTIALS',

        variable:
          'CORS_ALLOW_WILDCARD',
      });
    }

    if (
      list(
        'CORS_PRODUCTION_ORIGINS',
        [],
      ).length ===
        0 &&
      list(
        'CORS_ORIGINS',
        [],
      ).length ===
        0
    ) {
      errors.push({
        code:
          'PRODUCTION_CORS_ORIGINS_MISSING',

        variable:
          'CORS_PRODUCTION_ORIGINS',
      });
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Security
   * ---------------------------------------------------------------------------
   */

  if (
    !boolean(
      'ENABLE_SECURITY_HEADERS',
      true,
    )
  ) {
    errors.push({
      code:
        'PRODUCTION_SECURITY_HEADERS_DISABLED',

      variable:
        'ENABLE_SECURITY_HEADERS',
    });
  }

  if (
    !boolean(
      'ENABLE_RATE_LIMIT',
      true,
    )
  ) {
    warnings.push({
      code:
        'PRODUCTION_RATE_LIMIT_DISABLED',

      variable:
        'ENABLE_RATE_LIMIT',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Financial safety
   * ---------------------------------------------------------------------------
   */

  if (
    boolean(
      'AUDIT_ENABLED',
      true,
    ) &&
    !boolean(
      'AUDIT_FINANCIAL_FAIL_CLOSED',
      true,
    )
  ) {
    warnings.push({
      code:
        'FINANCIAL_AUDIT_NOT_FAIL_CLOSED',

      variable:
        'AUDIT_FINANCIAL_FAIL_CLOSED',
    });
  }

  if (
    boolean(
      'FINANCIAL_REQUIRE_IDEMPOTENCY',
      true,
    ) ===
      false
  ) {
    errors.push({
      code:
        'FINANCIAL_IDEMPOTENCY_DISABLED',

      variable:
        'FINANCIAL_REQUIRE_IDEMPOTENCY',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Debug settings
   * ---------------------------------------------------------------------------
   */

  if (
    boolean(
      'ALLOW_DEBUG',
      false,
    )
  ) {
    warnings.push({
      code:
        'PRODUCTION_DEBUG_ENABLED',

      variable:
        'ALLOW_DEBUG',
    });
  }

  if (
    [
      'debug',
      'trace',
    ].includes(
      enumValue(
        'LOG_LEVEL',
        LOG_LEVELS,
        'info',
      ),
    )
  ) {
    warnings.push({
      code:
        'PRODUCTION_VERBOSE_LOGGING',

      variable:
        'LOG_LEVEL',
    });
  }

  if (
    errors.length >
    0
  ) {
    const cause =
      new EnvConfigError(
        'TITech production environment validation failed.',
        {
          code:
            'PRODUCTION_ENVIRONMENT_INVALID',

          details: {
            errors,
            warnings,
          },
        },
      );

    if (
      startupErrors
        ?.environmentError
    ) {
      try {
        throw startupErrors.environmentError(
          cause.message,
          {
            cause,

            critical:
              true,

            fatal:
              true,

            details: {
              errors,
              warnings,
            },
          },
        );
      } catch (error) {
        throw error;
      }
    }

    throw cause;
  }

  return {
    valid:
      true,

    warnings,
  };
}

/**
 * =============================================================================
 * Safe masking
 * =============================================================================
 */

function isSensitiveKey(
  key,
) {
  const normalized =
    String(
      key ||
        '',
    ).toUpperCase();

  if (
    SENSITIVE_ENV_KEYS.includes(
      normalized,
    )
  ) {
    return true;
  }

  return SENSITIVE_ENV_PATTERN.test(
    normalized,
  );
}

function maskValue(
  key,
  value,
) {
  if (
    isSensitiveKey(
      key,
    )
  ) {
    if (
      value ===
        undefined ||
      value ===
        null ||
      value ===
        ''
    ) {
      return value;
    }

    return '[REDACTED]';
  }

  return value;
}

/**
 * =============================================================================
 * Safe snapshot
 * =============================================================================
 */

function getSnapshot(
  options = {},
) {
  const includeValues =
    options.includeValues ===
    true;

  const keys =
    options.keys ||
    Object.keys(
      process.env,
    );

  const environment =
    {};

  for (
    const key of
      keys
  ) {
    const value =
      process.env[
        key
      ];

    if (
      !includeValues
    ) {
      environment[
        key
      ] =
        isSensitiveKey(
          key,
        )
          ? '[REDACTED]'
          : value;
    } else {
      environment[
        key
      ] =
        maskValue(
          key,
          value,
        );
    }
  }

  return Object.freeze({
    component:
      COMPONENT,

    dotenvLoaded,

    nodeEnv:
      getNodeEnv(),

    serviceName:
      string(
        'SERVICE_NAME',
        DEFAULTS.serviceName,
      ),

    applicationName:
      string(
        'APP_NAME',
        DEFAULTS.applicationName,
      ),

    environment,

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * =============================================================================
 * Normalized Runtime Environment
 * =============================================================================
 *
 * This is intentionally a configuration-oriented representation rather than a
 * full config object. More detailed subsystem configuration remains owned by
 * bootstrapEnvironment.js and specialized config modules.
 * =============================================================================
 */

function getNormalized() {
  return Object.freeze({
    app: Object.freeze({
      name:
        string(
          'APP_NAME',
          DEFAULTS.applicationName,
        ),

      serviceName:
        string(
          'SERVICE_NAME',
          DEFAULTS.serviceName,
        ),

      version:
        string(
          'APP_VERSION',
          DEFAULTS.version,
        ),

      environment:
        getNodeEnv(),
    }),

    runtime: Object.freeze({
      nodeEnv:
        getNodeEnv(),

      production:
        isProduction(),

      staging:
        isStaging(),

      development:
        isDevelopment(),

      test:
        isTest(),

      gracefulShutdown:
        boolean(
          'GRACEFUL_SHUTDOWN',
          DEFAULTS.gracefulShutdown,
        ),

      allowDebug:
        boolean(
          'ALLOW_DEBUG',
          isDevelopment() ||
            isTest(),
        ),
    }),

    server: Object.freeze({
      host:
        string(
          'HOST',
          DEFAULTS.host,
        ),

      port:
        port(
          'PORT',
          DEFAULTS.port,
        ),

      trustProxy:
        boolean(
          'TRUST_PROXY',
          DEFAULTS.trustProxy,
        ),
    }),

    logging: Object.freeze({
      level:
        enumValue(
          'LOG_LEVEL',
          LOG_LEVELS,
          DEFAULTS.logLevel,
          {
            caseInsensitive:
              true,
          },
        ),

      pretty:
        boolean(
          'LOG_PRETTY',
          isDevelopment(),
        ),
    }),

    timeouts: Object.freeze({
      startup:
        durationMs(
          'STARTUP_TIMEOUT_MS',
          DEFAULTS.startupTimeoutMs,
        ),

      shutdown:
        durationMs(
          'SHUTDOWN_TIMEOUT_MS',
          DEFAULTS.shutdownTimeoutMs,
        ),

      readiness:
        durationMs(
          'READINESS_TIMEOUT_MS',
          DEFAULTS.readinessTimeoutMs,
        ),

      health:
        durationMs(
          'HEALTH_TIMEOUT_MS',
          DEFAULTS.healthTimeoutMs,
        ),
    }),

    features: Object.freeze({
      observability:
        boolean(
          'ENABLE_OBSERVABILITY',
          true,
        ),

      metrics:
        boolean(
          'ENABLE_METRICS',
          true,
        ),

      tracing:
        boolean(
          'ENABLE_TRACING',
          true,
        ),

      resilience:
        boolean(
          'ENABLE_RESILIENCE',
          true,
        ),

      database:
        boolean(
          'ENABLE_DATABASE',
          true,
        ),

      redis:
        boolean(
          'ENABLE_REDIS',
          true,
        ),

      queue:
        boolean(
          'ENABLE_QUEUE',
          true,
        ),

      socket:
        boolean(
          'ENABLE_SOCKET',
          true,
        ),

      audit:
        boolean(
          'AUDIT_ENABLED',
          true,
        ),

      cors:
        boolean(
          'CORS_ENABLED',
          true,
        ),

      rateLimit:
        boolean(
          'ENABLE_RATE_LIMIT',
          true,
        ),

      securityHeaders:
        boolean(
          'ENABLE_SECURITY_HEADERS',
          true,
        ),
    }),
  });
}

/**
 * =============================================================================
 * Common environment accessors
 * =============================================================================
 */

function getServiceName() {
  return string(
    'SERVICE_NAME',
    DEFAULTS.serviceName,
  );
}

function getApplicationName() {
  return string(
    'APP_NAME',
    DEFAULTS.applicationName,
  );
}

function getVersion() {
  return string(
    'APP_VERSION',
    DEFAULTS.version,
  );
}

function getHost() {
  return string(
    'HOST',
    DEFAULTS.host,
  );
}

function getPort() {
  return port(
    'PORT',
    DEFAULTS.port,
  );
}

function getLogLevel() {
  return enumValue(
    'LOG_LEVEL',
    LOG_LEVELS,
    DEFAULTS.logLevel,
    {
      caseInsensitive:
        true,
    },
  );
}

function isFeatureEnabled(
  name,
  fallback = false,
) {
  const mapping = {
    observability:
      'ENABLE_OBSERVABILITY',

    metrics:
      'ENABLE_METRICS',

    tracing:
      'ENABLE_TRACING',

    resilience:
      'ENABLE_RESILIENCE',

    database:
      'ENABLE_DATABASE',

    redis:
      'ENABLE_REDIS',

    queue:
      'ENABLE_QUEUE',

    socket:
      'ENABLE_SOCKET',

    audit:
      'AUDIT_ENABLED',

    cors:
      'CORS_ENABLED',

    rateLimit:
      'ENABLE_RATE_LIMIT',

    securityHeaders:
      'ENABLE_SECURITY_HEADERS',
  };

  const key =
    mapping[
      name
    ];

  if (
    !key
  ) {
    return fallback;
  }

  return boolean(
    key,
    fallback,
  );
}

/**
 * =============================================================================
 * Environment mutation protection
 * =============================================================================
 *
 * This module deliberately does not expose setters for process.env.
 * Configuration modules should consume normalized values rather than changing
 * the process environment at runtime.
 * =============================================================================
 */

function has(
  key,
) {
  return (
    raw(
      key,
      undefined,
    ) !==
    undefined
  );
}

function all(
  keys = Object.keys(
    process.env,
  ),
) {
  const result =
    {};

  for (
    const key of
      keys
  ) {
    result[
      key
    ] =
      process.env[
        key
      ];
  }

  return Object.freeze(
    result,
  );
}

/**
 * =============================================================================
 * Bootstrap adapter
 * =============================================================================
 */

async function initialize(
  context = {},
  options = {},
) {
  if (
    options.validateProduction !==
      false &&
    isProduction()
  ) {
    validateProductionEnvironment(
      options,
    );
  }

  const normalized =
    getNormalized();

  if (
    context &&
    typeof context ===
      'object'
  ) {
    context.environment =
      normalized;

    context.env =
      normalized;
  }

  return normalized;
}

async function bootstrap(
  context = {},
  options = {},
) {
  return initialize(
    context,
    options,
  );
}

async function start(
  context = {},
  options = {},
) {
  return initialize(
    context,
    options,
  );
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core access.
     */
    raw,

    get:
      raw,

    string,

    boolean,

    number,

    integer,

    positiveInteger,

    nonNegativeInteger,

    port,

    list,

    json,

    enum:
      enumValue,

    durationMs,

    url,

    required,

    requireAny,

    validateRequired,

    /**
     * Environment.
     */
    getNodeEnv,

    getServiceName,

    getApplicationName,

    getVersion,

    getHost,

    getPort,

    getLogLevel,

    isProduction,

    isStaging,

    isDevelopment,

    isTest,

    isFeatureEnabled,

    /**
     * Validation.
     */
    validateProductionEnvironment,

    /**
     * Normalized configuration.
     */
    getNormalized,

    environment:
      getNormalized,

    /**
     * Diagnostics.
     */
    getSnapshot,

    has,

    all,

    /**
     * Bootstrap compatibility.
     */
    initialize,

    bootstrap,

    start,

    /**
     * Metadata/constants.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    DEFAULTS,

    ENVIRONMENTS,

    LOG_LEVELS,

    dotenvLoaded,

    /**
     * Error.
     */
    EnvConfigError,
  });