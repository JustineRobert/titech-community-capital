'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Process Environment Bootstrap
 *
 * File:
 *   backend/bootstrap/environment.js
 *
 * Production Grade
 * -----------------------------------------------------------------------------
 * Responsibilities
 * - Load environment variables exactly once.
 * - Preserve externally supplied environment variables.
 * - Normalize NODE_ENV consistently.
 * - Support .env, .env.<environment>, .env.local and
 *   .env.<environment>.local.
 * - Normalize booleans, numbers, URLs, lists and secrets.
 * - Support backward-compatible environment aliases.
 * - Validate critical application/runtime configuration.
 * - Enforce production safety requirements.
 * - Expose typed immutable configuration.
 * - Keep secrets out of diagnostics and validation messages.
 * - Provide safe runtime metadata.
 * - Expose a callable bootstrap contract for backend/bootstrap/app.js.
 *
 * Architectural boundary
 *
 * process.env
 *      ↓
 * this module
 *      ↓
 * config/index.js
 *      ↓
 * observability / resilience / infrastructure
 *      ↓
 * services / middleware / routes
 *      ↓
 * server
 *
 * IMPORTANT:
 * This module MUST NOT:
 * - connect to MongoDB
 * - connect to Redis
 * - initialize queues
 * - initialize Socket.IO
 * - create an HTTP server
 * - initialize business services
 * - orchestrate application startup
 *
 * =============================================================================
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dotenv = require('dotenv');

/* =============================================================================
 * Constants
 * =============================================================================
 */

const NODE_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'production',
]);

const NODE_ENV_ALIASES = Object.freeze({
  dev: 'development',
  development: 'development',

  test: 'test',

  stage: 'staging',
  staging: 'staging',

  prod: 'production',
  production: 'production',
});

const TRUE_VALUES = new Set([
  '1',
  'true',
  'yes',
  'on',
  'enabled',
]);

const FALSE_VALUES = new Set([
  '0',
  'false',
  'no',
  'off',
  'disabled',
]);

const LOG_LEVELS = Object.freeze([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

const JWT_ALGORITHMS = Object.freeze([
  'HS256',
  'HS384',
  'HS512',
]);

const DEFAULTS = Object.freeze({
  NODE_ENV: 'development',

  APP_NAME: 'TITech Community Capital LTD',
  SERVICE_NAME: 'titech-community-capital-backend',
  APP_VERSION: '1.0.0',

  HOST: '0.0.0.0',
  PORT: 5000,

  LOG_LEVEL: 'info',
  LOG_PRETTY: true,
  LOG_REDACT_SECRETS: true,
  ENABLE_REQUEST_LOGGING: true,

  TRUST_PROXY: 0,

  CORS_ORIGINS: '',
  CORS_CREDENTIALS: true,
  CORS_MAX_AGE_SECONDS: 86_400,

  BODY_LIMIT: '1mb',
  JSON_LIMIT: '1mb',
  URLENCODED_LIMIT: '1mb',

  REQUEST_TIMEOUT_MS: 60_000,
  HEADERS_TIMEOUT_MS: 70_000,
  KEEP_ALIVE_TIMEOUT_MS: 65_000,
  SOCKET_TIMEOUT_MS: 65_000,
  SHUTDOWN_TIMEOUT_MS: 30_000,

  MONGODB_MAX_POOL_SIZE: 20,
  MONGODB_MIN_POOL_SIZE: 5,
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: 10_000,
  MONGODB_SOCKET_TIMEOUT_MS: 45_000,
  MONGODB_CONNECT_TIMEOUT_MS: 10_000,

  REDIS_CONNECT_TIMEOUT_MS: 10_000,

  JWT_ISSUER: 'titech-community-capital',
  JWT_AUDIENCE: 'titech-community-capital-api',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',

  IDEMPOTENCY_TTL_SECONDS: 86_400,

  PASSWORD_MIN_LENGTH: 12,

  ENABLE_SWAGGER: false,
  ENABLE_GRAPHQL: false,
  ENABLE_METRICS: true,
  ENABLE_HEALTH_CHECKS: true,
  ENABLE_TRACING: false,

  ENABLE_CSRF: false,
  ENABLE_RATE_LIMITING: true,

  TLS_ENABLED: false,
  TLS_REJECT_UNAUTHORIZED: true,

  COOKIE_SECURE: false,
  COOKIE_HTTP_ONLY: true,
  COOKIE_SAME_SITE: 'lax',

  COMPRESSION_ENABLED: true,

  GRACEFUL_SHUTDOWN: true,

  MONGODB_ENABLED: true,
  REDIS_ENABLED: true,
  QUEUE_ENABLED: true,

  IDEMPOTENCY_ENABLED: true,
});

/* =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentError extends Error {
  constructor(message, details = {}) {
    super(message);

    this.name = 'EnvironmentError';
    this.code = 'INVALID_ENVIRONMENT';

    this.details = Object.freeze({
      ...details,
    });

    Error.captureStackTrace?.(
      this,
      EnvironmentError,
    );
  }
}

/* =============================================================================
 * General Utilities
 * =============================================================================
 */

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(
    object,
    key,
  );
}

function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  );
}

/**
 * Remove BOM, surrounding whitespace and accidental wrapping quotes.
 */
function cleanString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim();
}

function normalizeString(
  value,
  fallback = undefined,
) {
  const normalized = cleanString(value);

  return normalized || fallback;
}

function normalizeLowerCase(
  value,
  fallback = undefined,
) {
  const normalized = normalizeString(
    value,
    fallback,
  );

  return normalized === undefined
    ? undefined
    : normalized.toLowerCase();
}

function normalizeUpperCase(
  value,
  fallback = undefined,
) {
  const normalized = normalizeString(
    value,
    fallback,
  );

  return normalized === undefined
    ? undefined
    : normalized.toUpperCase();
}

function normalizeNodeEnvironment(
  value,
  fallback = DEFAULTS.NODE_ENV,
) {
  const normalized = normalizeLowerCase(
    value,
    fallback,
  );

  return (
    NODE_ENV_ALIASES[normalized] ||
    normalized ||
    fallback
  );
}

function parseBoolean(
  value,
  fallback = undefined,
  variableName = 'UNKNOWN',
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = cleanString(value).toLowerCase();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new EnvironmentError(
    `Environment variable "${variableName}" must be a boolean.`,
    {
      variable: variableName,
      expected:
        'true/false, 1/0, yes/no, on/off, enabled/disabled',
    },
  );
}

function parseInteger(
  value,
  fallback = undefined,
  {
    variableName = 'UNKNOWN',
    min = undefined,
    max = undefined,
  } = {},
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const normalized = cleanString(value);

  if (!/^-?\d+$/.test(normalized)) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be an integer.`,
      {
        variable: variableName,
        expected: 'integer',
      },
    );
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed)) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" is outside the safe integer range.`,
      {
        variable: variableName,
      },
    );
  }

  if (
    min !== undefined &&
    parsed < min
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be >= ${min}.`,
      {
        variable: variableName,
        minimum: min,
      },
    );
  }

  if (
    max !== undefined &&
    parsed > max
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be <= ${max}.`,
      {
        variable: variableName,
        maximum: max,
      },
    );
  }

  return parsed;
}

function parseList(
  value,
  fallback = [],
) {
  if (isBlank(value)) {
    return [...fallback];
  }

  const source = Array.isArray(value)
    ? value
    : String(value).split(',');

  return [
    ...new Set(
      source
        .map((item) => cleanString(item))
        .filter(Boolean),
    ),
  ];
}

function parseUrl(
  value,
  fallback = undefined,
  {
    variableName = 'UNKNOWN',
    protocols = [],
    allowCredentials = true,
  } = {},
) {
  if (isBlank(value)) {
    return fallback;
  }

  let parsed;

  try {
    parsed = new URL(
      cleanString(value),
    );
  } catch {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be a valid URL.`,
      {
        variable: variableName,
      },
    );
  }

  if (
    protocols.length > 0 &&
    !protocols.includes(parsed.protocol)
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" uses an unsupported protocol.`,
      {
        variable: variableName,
        allowedProtocols: protocols,
      },
    );
  }

  if (
    !allowCredentials &&
    (parsed.username || parsed.password)
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must not contain URL credentials.`,
      {
        variable: variableName,
      },
    );
  }

  return parsed.toString();
}

function parseSecret(
  value,
  {
    variableName,
    required = false,
    minLength = 32,
  } = {},
) {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    if (required) {
      throw new EnvironmentError(
        `Required environment variable "${variableName}" is missing.`,
        {
          variable: variableName,
        },
      );
    }

    return undefined;
  }

  if (
    normalized.length < minLength
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" does not meet the minimum length requirement.`,
      {
        variable: variableName,
        minimumLength: minLength,
      },
    );
  }

  return normalized;
}

function ensureEnum(
  value,
  allowed,
  variableName,
) {
  if (!allowed.includes(value)) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" contains an unsupported value.`,
      {
        variable: variableName,
        allowed,
      },
    );
  }

  return value;
}

/* =============================================================================
 * Deep Freeze
 * =============================================================================
 */

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value !== 'object' &&
      typeof value !== 'function'
    )
  ) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (
    const key of Reflect.ownKeys(value)
  ) {
    try {
      deepFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Best effort.
  }

  return value;
}

/* =============================================================================
 * Environment Aliases
 * =============================================================================
 */

function firstEnvironmentValue(
  names,
  fallback = undefined,
) {
  for (const name of names) {
    const value = process.env[name];

    if (!isBlank(value)) {
      return value;
    }
  }

  return fallback;
}

/* =============================================================================
 * Environment File Loading
 * =============================================================================
 */

const PROJECT_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
);

function loadEnvFile(
  filePath,
) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const parsed = dotenv.parse(
    fs.readFileSync(
      filePath,
      'utf8',
    ),
  );

  /*
   * Existing process variables always win.
   */
  for (
    const [
      key,
      value,
    ] of Object.entries(parsed)
  ) {
    if (
      process.env[key] === undefined
    ) {
      process.env[key] = value;
    }
  }

  return true;
}

function loadDotEnv() {
  const loadedFiles = [];

  const candidates = [];

  const baseEnvFile =
    path.join(
      PROJECT_ROOT,
      '.env',
    );

  candidates.push(
    baseEnvFile,
  );

  /*
   * Load the base .env first so NODE_ENV can be determined from it.
   */
  loadEnvFile(
    baseEnvFile,
  );

  const nodeEnv =
    normalizeNodeEnvironment(
      process.env.NODE_ENV,
      DEFAULTS.NODE_ENV,
    );

  process.env.NODE_ENV =
    nodeEnv;

  candidates.push(
    path.join(
      PROJECT_ROOT,
      `.env.${nodeEnv}`,
    ),
  );

  candidates.push(
    path.join(
      PROJECT_ROOT,
      '.env.local',
    ),
  );

  candidates.push(
    path.join(
      PROJECT_ROOT,
      `.env.${nodeEnv}.local`,
    ),
  );

  /*
   * Load remaining files in deterministic order.
   */
  for (
    const filePath of candidates
  ) {
    if (
      filePath ===
      baseEnvFile
    ) {
      if (
        fs.existsSync(
          filePath,
        )
      ) {
        loadedFiles.push(
          filePath,
        );
      }

      continue;
    }

    if (
      loadEnvFile(filePath)
    ) {
      loadedFiles.push(
        filePath,
      );
    }
  }

  return Object.freeze(
    loadedFiles,
  );
}

/* =============================================================================
 * Validation
 * =============================================================================
 */

function validateEnvironment(
  environment,
) {
  const errors = [];

  const nodeEnv =
    environment?.app?.nodeEnv;

  const isProduction =
    Boolean(
      environment?.runtime
        ?.isProduction,
    );

  /*
   * NODE_ENV
   */
  if (
    !NODE_ENVIRONMENTS.includes(
      nodeEnv,
    )
  ) {
    errors.push(
      `NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(', ')}`,
    );
  }

  /*
   * HTTP timeout relationship.
   */
  if (
    environment.http.headersTimeoutMs <=
    environment.http.keepAliveTimeoutMs
  ) {
    errors.push(
      'HEADERS_TIMEOUT_MS must be greater than KEEP_ALIVE_TIMEOUT_MS.',
    );
  }

  if (
    environment.http.socketTimeoutMs <
    environment.http.requestTimeoutMs
  ) {
    errors.push(
      'SOCKET_TIMEOUT_MS must be greater than or equal to REQUEST_TIMEOUT_MS.',
    );
  }

  /*
   * MongoDB.
   */
  if (
    environment.database.mongodb.enabled &&
    !environment.database.mongodb.uri
  ) {
    errors.push(
      'MONGODB_URI or MONGO_URI is required when MongoDB is enabled.',
    );
  }

  if (
    environment.database.mongodb.maxPoolSize <
    environment.database.mongodb.minPoolSize
  ) {
    errors.push(
      'MONGODB_MAX_POOL_SIZE must be greater than or equal to MONGODB_MIN_POOL_SIZE.',
    );
  }

  /*
   * Redis.
   */
  if (
    environment.redis.enabled &&
    !environment.redis.url
  ) {
    errors.push(
      'REDIS_URL is required when Redis is enabled.',
    );
  }

  /*
   * Idempotency.
   */
  if (
    environment.idempotency.enabled &&
    environment.idempotency.ttlSeconds < 60
  ) {
    errors.push(
      'IDEMPOTENCY_TTL_SECONDS must be at least 60 seconds.',
    );
  }

  /*
   * Rate limiting.
   */
  if (
    environment.rateLimit.enabled &&
    environment.rateLimit.max <= 0
  ) {
    errors.push(
      'RATE_LIMIT_MAX must be greater than zero when rate limiting is enabled.',
    );
  }

  /*
   * CORS.
   */
  for (
    const origin of
      environment.cors.origins
  ) {
    if (origin === '*') {
      if (isProduction) {
        errors.push(
          'Wildcard CORS origin (*) is not permitted in production.',
        );
      }

      continue;
    }

    try {
      const parsedOrigin =
        new URL(origin);

      if (
        ![
          'http:',
          'https:',
        ].includes(
          parsedOrigin.protocol,
        )
      ) {
        throw new Error(
          'Unsupported origin protocol.',
        );
      }
    } catch {
      errors.push(
        `CORS_ORIGINS contains an invalid origin: ${origin}`,
      );
    }
  }

  /*
   * JWT.
   */
  if (isProduction) {
    if (
      !environment.jwt.accessSecret
    ) {
      errors.push(
        'JWT_ACCESS_SECRET or JWT_SECRET is required in production.',
      );
    }

    if (
      !environment.jwt.refreshSecret
    ) {
      errors.push(
        'JWT_REFRESH_SECRET or REFRESH_TOKEN_SECRET is required in production.',
      );
    }

    if (
      environment.jwt.accessSecret &&
      environment.jwt.refreshSecret &&
      environment.jwt.accessSecret ===
        environment.jwt.refreshSecret
    ) {
      errors.push(
        'JWT access and refresh secrets must be different in production.',
      );
    }

    if (
      !environment.security.encryptionKey
    ) {
      errors.push(
        'SECURITY_ENCRYPTION_KEY is required in production.',
      );
    }

    if (
      !environment.cookie.secure
    ) {
      errors.push(
        'COOKIE_SECURE must be enabled in production.',
      );
    }

    if (
      environment.security.requireTls &&
      !environment.tls.enabled
    ) {
      errors.push(
        'TLS is required by configuration but TLS_ENABLED is disabled.',
      );
    }

    if (
      !environment.cors.origins.length
    ) {
      errors.push(
        'CORS_ORIGINS must contain at least one explicitly allowed origin in production.',
      );
    }

    if (
      environment.rateLimit.enabled ===
      false
    ) {
      errors.push(
        'Rate limiting must not be disabled in production.',
      );
    }

    if (
      environment.security.allowInsecureAuth
    ) {
      errors.push(
        'ALLOW_INSECURE_AUTH must be disabled in production.',
      );
    }

    if (
      !environment.logging.redactSecrets
    ) {
      errors.push(
        'LOG_REDACT_SECRETS must remain enabled in production.',
      );
    }
  }

  /*
   * TLS.
   */
  if (
    environment.tls.enabled
  ) {
    if (
      !environment.tls.keyPath
    ) {
      errors.push(
        'TLS_KEY_PATH is required when TLS_ENABLED=true.',
      );
    }

    if (
      !environment.tls.certPath
    ) {
      errors.push(
        'TLS_CERT_PATH is required when TLS_ENABLED=true.',
      );
    }
  }

  if (errors.length > 0) {
    throw new EnvironmentError(
      `Environment validation failed:\n- ${errors.join('\n- ')}`,
      {
        errorCount:
          errors.length,
      },
    );
  }

  return true;
}

/* =============================================================================
 * Build Environment
 * =============================================================================
 */

function buildEnvironment() {
  const nodeEnv =
    normalizeNodeEnvironment(
      process.env.NODE_ENV,
      DEFAULTS.NODE_ENV,
    );

  ensureEnum(
    nodeEnv,
    NODE_ENVIRONMENTS,
    'NODE_ENV',
  );

  process.env.NODE_ENV =
    nodeEnv;

  const isDevelopment =
    nodeEnv ===
    'development';

  const isTest =
    nodeEnv === 'test';

  const isStaging =
    nodeEnv === 'staging';

  const isProduction =
    nodeEnv === 'production';

  const mongoUriRaw =
    firstEnvironmentValue([
      'MONGODB_URI',
      'MONGO_URI',
      'MONGO_URL',
    ]);

  const jwtAccessSecretRaw =
    firstEnvironmentValue([
      'JWT_ACCESS_SECRET',
      'JWT_SECRET',
    ]);

  const jwtRefreshSecretRaw =
    firstEnvironmentValue([
      'JWT_REFRESH_SECRET',
      'REFRESH_TOKEN_SECRET',
    ]);

  const securityEncryptionKeyRaw =
    firstEnvironmentValue([
      'SECURITY_ENCRYPTION_KEY',
      'ENCRYPTION_KEY',
    ]);

  const environment = {
    /* =========================================================================
     * Application
     * =========================================================================
     */

    app: {
      name:
        normalizeString(
          process.env.APP_NAME,
          DEFAULTS.APP_NAME,
        ),

      serviceName:
        normalizeString(
          process.env.SERVICE_NAME,
          DEFAULTS.SERVICE_NAME,
        ),

      version:
        normalizeString(
          process.env.APP_VERSION ||
            process.env.npm_package_version,
          DEFAULTS.APP_VERSION,
        ),

      environment:
        nodeEnv,

      nodeEnv,
    },

    /* =========================================================================
     * Runtime
     * =========================================================================
     */

    runtime: {
      nodeVersion:
        process.version,

      platform:
        process.platform,

      architecture:
        process.arch,

      pid:
        process.pid,

      cpuCount:
        os.cpus?.().length || 1,

      memoryBytes:
        os.totalmem?.(),

      isDevelopment,

      isTest,

      isStaging,

      isProduction,
    },

    /* =========================================================================
     * HTTP
     * =========================================================================
     */

    http: {
      host:
        normalizeString(
          process.env.HOST,
          DEFAULTS.HOST,
        ),

      port:
        parseInteger(
          process.env.PORT,
          DEFAULTS.PORT,
          {
            variableName:
              'PORT',
            min: 1,
            max: 65_535,
          },
        ),

      trustProxy:
        parseInteger(
          process.env.TRUST_PROXY,
          DEFAULTS.TRUST_PROXY,
          {
            variableName:
              'TRUST_PROXY',
            min: 0,
            max: 100,
          },
        ),

      bodyLimit:
        normalizeString(
          process.env.BODY_LIMIT,
          DEFAULTS.BODY_LIMIT,
        ),

      jsonLimit:
        normalizeString(
          process.env.JSON_LIMIT,
          DEFAULTS.JSON_LIMIT,
        ),

      urlencodedLimit:
        normalizeString(
          process.env.URLENCODED_LIMIT,
          DEFAULTS.URLENCODED_LIMIT,
        ),

      requestTimeoutMs:
        parseInteger(
          process.env.REQUEST_TIMEOUT_MS ||
            process.env.HTTP_REQUEST_TIMEOUT_MS,
          DEFAULTS.REQUEST_TIMEOUT_MS,
          {
            variableName:
              'REQUEST_TIMEOUT_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),

      headersTimeoutMs:
        parseInteger(
          process.env.HEADERS_TIMEOUT_MS ||
            process.env.HTTP_HEADERS_TIMEOUT_MS,
          DEFAULTS.HEADERS_TIMEOUT_MS,
          {
            variableName:
              'HEADERS_TIMEOUT_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),

      keepAliveTimeoutMs:
        parseInteger(
          process.env.KEEP_ALIVE_TIMEOUT_MS ||
            process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
          DEFAULTS.KEEP_ALIVE_TIMEOUT_MS,
          {
            variableName:
              'KEEP_ALIVE_TIMEOUT_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),

      socketTimeoutMs:
        parseInteger(
          process.env.SOCKET_TIMEOUT_MS,
          DEFAULTS.SOCKET_TIMEOUT_MS,
          {
            variableName:
              'SOCKET_TIMEOUT_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),

      shutdownTimeoutMs:
        parseInteger(
          process.env.SHUTDOWN_TIMEOUT_MS ||
            process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
          DEFAULTS.SHUTDOWN_TIMEOUT_MS,
          {
            variableName:
              'SHUTDOWN_TIMEOUT_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),
    },

    /* =========================================================================
     * Logging
     * =========================================================================
     */

    logging: {
      level:
        ensureEnum(
          normalizeLowerCase(
            process.env.LOG_LEVEL,
            DEFAULTS.LOG_LEVEL,
          ),
          LOG_LEVELS,
          'LOG_LEVEL',
        ),

      enabled:
        parseBoolean(
          process.env.ENABLE_REQUEST_LOGGING,
          DEFAULTS.ENABLE_REQUEST_LOGGING,
          'ENABLE_REQUEST_LOGGING',
        ),

      pretty:
        parseBoolean(
          process.env.LOG_PRETTY,
          isDevelopment,
          'LOG_PRETTY',
        ),

      redactSecrets:
        parseBoolean(
          process.env.LOG_REDACT_SECRETS,
          DEFAULTS.LOG_REDACT_SECRETS,
          'LOG_REDACT_SECRETS',
        ),
    },

    /* =========================================================================
     * Observability
     * =========================================================================
     */

    observability: {
      metricsEnabled:
        parseBoolean(
          process.env.ENABLE_METRICS,
          DEFAULTS.ENABLE_METRICS,
          'ENABLE_METRICS',
        ),

      tracingEnabled:
        parseBoolean(
          process.env.ENABLE_TRACING,
          DEFAULTS.ENABLE_TRACING,
          'ENABLE_TRACING',
        ),

      metricsPort:
        parseInteger(
          process.env.METRICS_PORT,
          9090,
          {
            variableName:
              'METRICS_PORT',
            min: 1,
            max: 65_535,
          },
        ),

      otelEndpoint:
        parseUrl(
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
          undefined,
          {
            variableName:
              'OTEL_EXPORTER_OTLP_ENDPOINT',
            protocols: [
              'http:',
              'https:',
            ],
          },
        ),

      serviceName:
        normalizeString(
          process.env.OTEL_SERVICE_NAME ||
            process.env.SERVICE_NAME,
          DEFAULTS.SERVICE_NAME,
        ),
    },

    /* =========================================================================
     * Database
     * =========================================================================
     */

    database: {
      mongodb: {
        enabled:
          parseBoolean(
            process.env.MONGODB_ENABLED,
            DEFAULTS.MONGODB_ENABLED,
            'MONGODB_ENABLED',
          ),

        uri:
          parseUrl(
            mongoUriRaw,
            undefined,
            {
              variableName:
                'MONGODB_URI',
              protocols: [
                'mongodb:',
                'mongodb+srv:',
              ],
              allowCredentials:
                true,
            },
          ),

        databaseName:
          normalizeString(
            process.env.MONGODB_DATABASE ||
              process.env.MONGODB_DB_NAME ||
              process.env.MONGO_DB_NAME,
            undefined,
          ),

        maxPoolSize:
          parseInteger(
            process.env.MONGODB_MAX_POOL_SIZE,
            DEFAULTS.MONGODB_MAX_POOL_SIZE,
            {
              variableName:
                'MONGODB_MAX_POOL_SIZE',
              min: 1,
              max: 1_000,
            },
          ),

        minPoolSize:
          parseInteger(
            process.env.MONGODB_MIN_POOL_SIZE,
            DEFAULTS.MONGODB_MIN_POOL_SIZE,
            {
              variableName:
                'MONGODB_MIN_POOL_SIZE',
              min: 0,
              max: 1_000,
            },
          ),

        serverSelectionTimeoutMs:
          parseInteger(
            process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
            DEFAULTS.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
            {
              variableName:
                'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
              min: 100,
              max: 300_000,
            },
          ),

        socketTimeoutMs:
          parseInteger(
            process.env.MONGODB_SOCKET_TIMEOUT_MS,
            DEFAULTS.MONGODB_SOCKET_TIMEOUT_MS,
            {
              variableName:
                'MONGODB_SOCKET_TIMEOUT_MS',
              min: 1_000,
              max: 600_000,
            },
          ),

        connectTimeoutMs:
          parseInteger(
            process.env.MONGODB_CONNECT_TIMEOUT_MS,
            DEFAULTS.MONGODB_CONNECT_TIMEOUT_MS,
            {
              variableName:
                'MONGODB_CONNECT_TIMEOUT_MS',
              min: 100,
              max: 300_000,
            },
          ),
      },
    },

    /* =========================================================================
     * Redis
     * =========================================================================
     */

    redis: {
      enabled:
        parseBoolean(
          process.env.REDIS_ENABLED,
          DEFAULTS.REDIS_ENABLED,
          'REDIS_ENABLED',
        ),

      url:
        parseUrl(
          firstEnvironmentValue([
            'REDIS_URL',
            'REDIS_URI',
          ]),
          undefined,
          {
            variableName:
              'REDIS_URL',
            protocols: [
              'redis:',
              'rediss:',
            ],
            allowCredentials:
              true,
          },
        ),

      keyPrefix:
        normalizeString(
          process.env.REDIS_KEY_PREFIX,
          'titech:',
        ),

      connectTimeoutMs:
        parseInteger(
          process.env.REDIS_CONNECT_TIMEOUT_MS,
          DEFAULTS.REDIS_CONNECT_TIMEOUT_MS,
          {
            variableName:
              'REDIS_CONNECT_TIMEOUT_MS',
            min: 100,
            max: 300_000,
          },
        ),

      maxRetries:
        parseInteger(
          process.env.REDIS_MAX_RETRIES,
          3,
          {
            variableName:
              'REDIS_MAX_RETRIES',
            min: 0,
            max: 100,
          },
        ),
    },

    /* =========================================================================
     * Security
     * =========================================================================
     */

    security: {
      encryptionKey:
        parseSecret(
          securityEncryptionKeyRaw,
          {
            variableName:
              'SECURITY_ENCRYPTION_KEY',
            required:
              isProduction,
            minLength: 32,
          },
        ),

      passwordMinLength:
        parseInteger(
          process.env.PASSWORD_MIN_LENGTH,
          DEFAULTS.PASSWORD_MIN_LENGTH,
          {
            variableName:
              'PASSWORD_MIN_LENGTH',
            min: 8,
            max: 128,
          },
        ),

      requireTls:
        parseBoolean(
          process.env.REQUIRE_TLS,
          isProduction,
          'REQUIRE_TLS',
        ),

      allowInsecureAuth:
        parseBoolean(
          process.env.ALLOW_INSECURE_AUTH,
          isDevelopment || isTest,
          'ALLOW_INSECURE_AUTH',
        ),

      enableCsrf:
        parseBoolean(
          process.env.ENABLE_CSRF,
          DEFAULTS.ENABLE_CSRF,
          'ENABLE_CSRF',
        ),
    },

    /* =========================================================================
     * JWT
     * =========================================================================
     */

    jwt: {
      accessSecret:
        parseSecret(
          jwtAccessSecretRaw,
          {
            variableName:
              'JWT_ACCESS_SECRET',
            required:
              isProduction,
            minLength: 32,
          },
        ),

      refreshSecret:
        parseSecret(
          jwtRefreshSecretRaw,
          {
            variableName:
              'JWT_REFRESH_SECRET',
            required:
              isProduction,
            minLength: 32,
          },
        ),

      issuer:
        normalizeString(
          process.env.JWT_ISSUER,
          DEFAULTS.JWT_ISSUER,
        ),

      audience:
        normalizeString(
          process.env.JWT_AUDIENCE,
          DEFAULTS.JWT_AUDIENCE,
        ),

      accessExpiresIn:
        normalizeString(
          process.env.JWT_ACCESS_EXPIRES_IN,
          DEFAULTS.JWT_ACCESS_EXPIRES_IN,
        ),

      refreshExpiresIn:
        normalizeString(
          process.env.JWT_REFRESH_EXPIRES_IN,
          DEFAULTS.JWT_REFRESH_EXPIRES_IN,
        ),

      algorithm:
        ensureEnum(
          normalizeUpperCase(
            process.env.JWT_ALGORITHM,
            'HS256',
          ),
          JWT_ALGORITHMS,
          'JWT_ALGORITHM',
        ),
    },

    /* =========================================================================
     * CORS
     * =========================================================================
     */

    cors: {
      origins:
        parseList(
          firstEnvironmentValue([
            'CORS_ORIGINS',
            'CLIENT_ORIGIN',
          ]),
          isDevelopment
            ? [
                'http://localhost:3000',
              ]
            : [],
        ),

      methods:
        parseList(
          process.env.CORS_METHODS,
          [
            'GET',
            'HEAD',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'OPTIONS',
          ],
        ),

      allowedHeaders:
        parseList(
          process.env.CORS_ALLOWED_HEADERS ||
            process.env.CORS_HEADERS,
          [
            'Accept',
            'Authorization',
            'Content-Type',
            'Idempotency-Key',
            'X-Request-ID',
            'X-Correlation-ID',
          ],
        ),

      credentials:
        parseBoolean(
          process.env.CORS_CREDENTIALS,
          DEFAULTS.CORS_CREDENTIALS,
          'CORS_CREDENTIALS',
        ),

      maxAgeSeconds:
        parseInteger(
          process.env.CORS_MAX_AGE_SECONDS,
          DEFAULTS.CORS_MAX_AGE_SECONDS,
          {
            variableName:
              'CORS_MAX_AGE_SECONDS',
            min: 0,
            max: 86_400,
          },
        ),
    },

    /* =========================================================================
     * Rate Limiting
     * =========================================================================
     */

    rateLimit: {
      enabled:
        parseBoolean(
          process.env.ENABLE_RATE_LIMITING,
          DEFAULTS.ENABLE_RATE_LIMITING,
          'ENABLE_RATE_LIMITING',
        ),

      windowMs:
        parseInteger(
          process.env.RATE_LIMIT_WINDOW_MS,
          60_000,
          {
            variableName:
              'RATE_LIMIT_WINDOW_MS',
            min: 1_000,
            max: 86_400_000,
          },
        ),

      max:
        parseInteger(
          process.env.RATE_LIMIT_MAX,
          100,
          {
            variableName:
              'RATE_LIMIT_MAX',
            min: 1,
            max: 1_000_000,
          },
        ),
    },

    /* =========================================================================
     * Idempotency
     * =========================================================================
     */

    idempotency: {
      enabled:
        parseBoolean(
          process.env.IDEMPOTENCY_ENABLED,
          DEFAULTS.IDEMPOTENCY_ENABLED,
          'IDEMPOTENCY_ENABLED',
        ),

      ttlSeconds:
        parseInteger(
          process.env.IDEMPOTENCY_TTL_SECONDS ||
            process.env.IDEMPOTENCY_TTL,
          DEFAULTS.IDEMPOTENCY_TTL_SECONDS,
          {
            variableName:
              'IDEMPOTENCY_TTL_SECONDS',
            min: 60,
            max:
              7 * 86_400,
          },
        ),

      headerName:
        normalizeString(
          process.env.IDEMPOTENCY_HEADER_NAME,
          'Idempotency-Key',
        ),

      lockTimeoutMs:
        parseInteger(
          process.env.IDEMPOTENCY_LOCK_TIMEOUT_MS,
          30_000,
          {
            variableName:
              'IDEMPOTENCY_LOCK_TIMEOUT_MS',
            min: 1_000,
            max: 300_000,
          },
        ),
    },

    /* =========================================================================
     * Cookie
     * =========================================================================
     */

    cookie: {
      secure:
        parseBoolean(
          process.env.COOKIE_SECURE,
          isProduction ||
            DEFAULTS.COOKIE_SECURE,
          'COOKIE_SECURE',
        ),

      httpOnly:
        parseBoolean(
          process.env.COOKIE_HTTP_ONLY,
          DEFAULTS.COOKIE_HTTP_ONLY,
          'COOKIE_HTTP_ONLY',
        ),

      sameSite:
        ensureEnum(
          normalizeLowerCase(
            process.env.COOKIE_SAME_SITE,
            DEFAULTS.COOKIE_SAME_SITE,
          ),
          [
            'strict',
            'lax',
            'none',
          ],
          'COOKIE_SAME_SITE',
        ),

      domain:
        normalizeString(
          process.env.COOKIE_DOMAIN,
          undefined,
        ),

      path:
        normalizeString(
          process.env.COOKIE_PATH,
          '/',
        ),
    },

    /* =========================================================================
     * TLS
     * =========================================================================
     */

    tls: {
      enabled:
        parseBoolean(
          process.env.TLS_ENABLED,
          DEFAULTS.TLS_ENABLED,
          'TLS_ENABLED',
        ),

      keyPath:
        normalizeString(
          process.env.TLS_KEY_PATH,
          undefined,
        ),

      certPath:
        normalizeString(
          process.env.TLS_CERT_PATH,
          undefined,
        ),

      caPath:
        normalizeString(
          process.env.TLS_CA_PATH,
          undefined,
        ),

      rejectUnauthorized:
        parseBoolean(
          process.env.TLS_REJECT_UNAUTHORIZED,
          DEFAULTS.TLS_REJECT_UNAUTHORIZED,
          'TLS_REJECT_UNAUTHORIZED',
        ),
    },

    /* =========================================================================
     * Features
     * =========================================================================
     */

    features: {
      swaggerEnabled:
        parseBoolean(
          process.env.ENABLE_SWAGGER,
          DEFAULTS.ENABLE_SWAGGER,
          'ENABLE_SWAGGER',
        ),

      graphqlEnabled:
        parseBoolean(
          process.env.ENABLE_GRAPHQL,
          DEFAULTS.ENABLE_GRAPHQL,
          'ENABLE_GRAPHQL',
        ),

      healthChecksEnabled:
        parseBoolean(
          process.env.ENABLE_HEALTH_CHECKS,
          DEFAULTS.ENABLE_HEALTH_CHECKS,
          'ENABLE_HEALTH_CHECKS',
        ),

      gracefulShutdown:
        parseBoolean(
          process.env.GRACEFUL_SHUTDOWN,
          DEFAULTS.GRACEFUL_SHUTDOWN,
          'GRACEFUL_SHUTDOWN',
        ),

      compressionEnabled:
        parseBoolean(
          process.env.COMPRESSION_ENABLED,
          DEFAULTS.COMPRESSION_ENABLED,
          'COMPRESSION_ENABLED',
        ),
    },

    /* =========================================================================
     * Queue
     * =========================================================================
     */

    queue: {
      enabled:
        parseBoolean(
          process.env.QUEUE_ENABLED,
          DEFAULTS.QUEUE_ENABLED,
          'QUEUE_ENABLED',
        ),

      prefix:
        normalizeString(
          process.env.QUEUE_PREFIX,
          'titech',
        ),

      defaultAttempts:
        parseInteger(
          process.env.QUEUE_DEFAULT_ATTEMPTS,
          3,
          {
            variableName:
              'QUEUE_DEFAULT_ATTEMPTS',
            min: 1,
            max: 100,
          },
        ),

      backoffDelayMs:
        parseInteger(
          process.env.QUEUE_BACKOFF_DELAY_MS,
          1_000,
          {
            variableName:
              'QUEUE_BACKOFF_DELAY_MS',
            min: 0,
            max: 86_400_000,
          },
        ),
    },

    /* =========================================================================
     * URLs
     * =========================================================================
     */

    urls: {
      app:
        parseUrl(
          firstEnvironmentValue([
            'APP_URL',
            'FRONTEND_URL',
          ]),
          undefined,
          {
            variableName:
              'APP_URL',
            protocols: [
              'http:',
              'https:',
            ],
            allowCredentials:
              false,
          },
        ),

      api:
        parseUrl(
          process.env.API_URL,
          undefined,
          {
            variableName:
              'API_URL',
            protocols: [
              'http:',
              'https:',
            ],
            allowCredentials:
              false,
          },
        ),

      frontend:
        parseUrl(
          firstEnvironmentValue([
            'FRONTEND_URL',
            'CLIENT_ORIGIN',
          ]),
          undefined,
          {
            variableName:
              'FRONTEND_URL',
            protocols: [
              'http:',
              'https:',
            ],
            allowCredentials:
              false,
          },
        ),
    },

    /* =========================================================================
     * Deployment
     * =========================================================================
     */

    deployment: {
      region:
        normalizeString(
          firstEnvironmentValue([
            'DEPLOYMENT_REGION',
            'AWS_REGION',
            'CLOUD_REGION',
          ]),
          undefined,
        ),

      zone:
        normalizeString(
          firstEnvironmentValue([
            'DEPLOYMENT_ZONE',
            'AVAILABILITY_ZONE',
          ]),
          undefined,
        ),

      instanceId:
        normalizeString(
          firstEnvironmentValue([
            'INSTANCE_ID',
            'HOSTNAME',
          ]),
          undefined,
        ),

      releaseId:
        normalizeString(
          firstEnvironmentValue([
            'RELEASE_ID',
            'RELEASE',
          ]),
          undefined,
        ),

      commitSha:
        normalizeString(
          firstEnvironmentValue([
            'COMMIT_SHA',
            'GIT_COMMIT_SHA',
          ]),
          undefined,
        ),

      containerId:
        normalizeString(
          process.env.CONTAINER_ID,
          undefined,
        ),
    },

    /* =========================================================================
     * Flags
     * =========================================================================
     */

    flags: {
      isProduction,
      isStaging,
      isDevelopment,
      isTest,
    },
  };

  validateEnvironment(
    environment,
  );

  return deepFreeze(
    environment,
  );
}

/* =============================================================================
 * Safe Metadata
 * =============================================================================
 */

function buildSafeMetadata(
  environment,
) {
  return Object.freeze({
    appName:
      environment.app.name,

    serviceName:
      environment.app.serviceName,

    version:
      environment.app.version,

    environment:
      environment.app.environment,

    nodeVersion:
      environment.runtime.nodeVersion,

    platform:
      environment.runtime.platform,

    architecture:
      environment.runtime.architecture,

    host:
      environment.http.host,

    port:
      environment.http.port,

    mongodbEnabled:
      environment.database.mongodb.enabled,

    mongodbConfigured:
      Boolean(
        environment.database.mongodb.uri,
      ),

    redisEnabled:
      environment.redis.enabled,

    redisConfigured:
      Boolean(
        environment.redis.url,
      ),

    metricsEnabled:
      environment.observability.metricsEnabled,

    tracingEnabled:
      environment.observability.tracingEnabled,

    rateLimitingEnabled:
      environment.rateLimit.enabled,

    idempotencyEnabled:
      environment.idempotency.enabled,

    tlsEnabled:
      environment.tls.enabled,

    csrfEnabled:
      environment.security.enableCsrf,

    jwtAccessConfigured:
      Boolean(
        environment.jwt.accessSecret,
      ),

    jwtRefreshConfigured:
      Boolean(
        environment.jwt.refreshSecret,
      ),

    loadedAt:
      new Date().toISOString(),
  });
}

/* =============================================================================
 * Canonical Bootstrap Initialization
 * =============================================================================
 */

const loadedEnvFiles =
  loadDotEnv();

const environment =
  buildEnvironment();

const safeMetadata =
  buildSafeMetadata(
    environment,
  );

const publicEnvironment =
  deepFreeze({
    ...environment,

    meta:
      safeMetadata,

    loadedEnvFiles:
      Object.freeze(
        loadedEnvFiles.map(
          (filePath) =>
            path.relative(
              process.cwd(),
              filePath,
            ),
        ),
      ),
  });

/* =============================================================================
 * Helper API
 * =============================================================================
 */

function get(
  name,
  fallback = undefined,
) {
  if (
    hasOwn(
      publicEnvironment,
      name,
    )
  ) {
    return publicEnvironment[
      name
    ];
  }

  return fallback;
}

function has(name) {
  return hasOwn(
    publicEnvironment,
    name,
  );
}

function getEnvironment() {
  return publicEnvironment;
}

function isProduction() {
  return Boolean(
    publicEnvironment.runtime
      .isProduction,
  );
}

function isDevelopment() {
  return Boolean(
    publicEnvironment.runtime
      .isDevelopment,
  );
}

function isTest() {
  return Boolean(
    publicEnvironment.runtime
      .isTest,
  );
}

function isStaging() {
  return Boolean(
    publicEnvironment.runtime
      .isStaging,
  );
}

function getSafeMetadata() {
  return publicEnvironment.meta;
}

/* =============================================================================
 * Bootstrap Contract
 * =============================================================================
 *
 * IMPORTANT:
 *
 * backend/bootstrap/app.js expects the environment bootstrap dependency to be
 * callable. Other parts of TITech also consume this module as a configuration
 * object.
 *
 * We therefore expose a callable function object:
 *
 *   const environment = require('./environment');
 *   await environment();
 *
 * while preserving:
 *
 *   environment.environment
 *   environment.configuration
 *   environment.config
 *   environment.getEnvironment()
 *   environment.getConfig()
 *   environment.validateEnvironment()
 * =============================================================================
 */

async function initialize(
  context = {},
) {
  const configuration =
    publicEnvironment;

  /*
   * Validate the canonical immutable configuration again at the bootstrap
   * boundary. This is intentionally cheap and prevents consumers from
   * starting with an invalid object.
   */
  validateEnvironment(
    configuration,
  );

  if (
    context &&
    typeof context === 'object'
  ) {
    context.environment =
      configuration;

    context.configuration =
      context.configuration ||
      configuration;
  }

  return configuration;
}

async function bootstrap(
  context = {},
) {
  return initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return initialize(
    context,
  );
}

async function environmentBootstrap(
  context = {},
) {
  return initialize(
    context,
  );
}

function getConfig(
  override = {},
) {
  if (
    !override ||
    Object.keys(
      override,
    ).length === 0
  ) {
    return publicEnvironment;
  }

  /*
   * buildEnvironment() intentionally reads process.env so that configuration
   * remains centralized. We support only environment-level test overrides that
   * are explicitly supplied to the builder.
   */
  if (
    override &&
    typeof override === 'object'
  ) {
    const originalValues = {};

    for (
      const [key, value]
        of Object.entries(override)
    ) {
      originalValues[key] =
        process.env[key];

      if (
        value === undefined ||
        value === null
      ) {
        delete process.env[key];
      } else {
        process.env[key] =
          String(value);
      }
    }

    try {
      return buildEnvironment();
    } finally {
      for (
        const key of
          Object.keys(override)
      ) {
        if (
          originalValues[key] ===
          undefined
        ) {
          delete process.env[key];
        } else {
          process.env[key] =
            originalValues[key];
        }
      }
    }
  }

  return publicEnvironment;
}

/* =============================================================================
 * Callable Export Surface
 * =============================================================================
 */

Object.assign(
  environmentBootstrap,
  {
    /*
     * Canonical configuration.
     */
    environment:
      publicEnvironment,

    configuration:
      publicEnvironment,

    config:
      publicEnvironment,

    /*
     * Bootstrap lifecycle contract.
     */
    initialize,
    bootstrap,
    start,

    /*
     * Configuration access.
     */
    getEnvironment,
    getConfig,
    get,

    has,

    /*
     * Environment helpers.
     */
    isProduction,
    isDevelopment,
    isTest,
    isStaging,

    /*
     * Configuration builder / validation.
     */
    buildEnvironment,
    validateEnvironment,

    /*
     * Safe diagnostics.
     */
    getSafeMetadata,

    /*
     * Environment file helpers.
     */
    normalizeNodeEnvironment,
    loadDotEnv,

    /*
     * Error class.
     */
    EnvironmentError,

    /*
     * Safe metadata is also available directly for existing consumers.
     */
    meta:
      safeMetadata,

    loadedEnvFiles:
      publicEnvironment.loadedEnvFiles,
  },
);

/*
 * Freeze the callable API itself.
 *
 * The function remains callable after freezing.
 */
module.exports =
  Object.freeze(
    environmentBootstrap,
  );