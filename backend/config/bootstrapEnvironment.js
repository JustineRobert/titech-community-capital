'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   backend/config/bootstrapEnvironment.js
 *
 * Purpose:
 *   Enterprise production-grade environment bootstrap configuration.
 *
 * Responsibilities:
 *   - Load and normalize process environment variables.
 *   - Validate mandatory runtime configuration.
 *   - Enforce production safety requirements.
 *   - Normalize booleans, numbers, durations and lists.
 *   - Detect invalid or conflicting configuration.
 *   - Provide immutable environment configuration to bootstrap.
 *   - Expose safe diagnostics without leaking secrets.
 *   - Support development/test/staging/production environments.
 *   - Provide feature/runtime/environment flags.
 *   - Provide canonical service/application identity.
 *   - Provide HTTP/server/process settings.
 *   - Provide database/cache/queue/security configuration references.
 *
 * IMPORTANT:
 *
 *   This module owns ENVIRONMENT CONFIGURATION ONLY.
 *
 *   It does NOT:
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - start HTTP servers.
 *     - initialize Express.
 *     - initialize services.
 *     - initialize observability.
 *     - execute financial operations.
 *
 * Architectural position:
 *
 *   process.env
 *       ↓
 *   bootstrapEnvironment.js
 *       ↓
 *   config/index.js
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
 *
 * Production principles:
 *   - Fail closed on invalid critical configuration.
 *   - Never expose secrets in logs or snapshots.
 *   - Keep configuration immutable.
 *   - Preserve backward-compatible bootstrap methods.
 *   - Avoid configuration namespaces being silently overwritten.
 *   - Keep runtime metadata and runtime behavior flags together.
 *
 * ============================================================================
 */

const os = require('node:os');
const crypto = require('node:crypto');

/* ============================================================================
 * Optional logger
 * ========================================================================== */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule = require('../utils/logger');
} catch {
  loggerModule = null;
}

/* ============================================================================
 * Optional startup error integration
 * ========================================================================== */

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors = require('../bootstrap/startupErrors');
} catch {
  startupErrors = null;
}

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT = 'environment-config';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const NODE_MIN_MAJOR = 20;

const RUNTIME_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'production',
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

const DEFAULTS = Object.freeze({
  nodeEnv: 'development',

  host: '0.0.0.0',

  port: 3000,

  serviceName: SERVICE_NAME,

  applicationName: APPLICATION_NAME,

  appVersion:
    process.env.npm_package_version ||
    '0.0.0',

  logLevel: 'info',

  trustProxy: false,

  bodyLimit: '1mb',

  keepAliveTimeout: 65_000,

  headersTimeout: 70_000,

  requestTimeoutMs: 60_000,

  shutdownTimeoutMs: 30_000,

  readinessTimeoutMs: 5_000,

  healthTimeoutMs: 5_000,

  gracefulShutdown: true,

  metricsEnabled: true,

  tracingEnabled: true,

  auditEnabled: true,

  resilienceEnabled: true,

  databaseEnabled: true,

  redisEnabled: true,

  queueEnabled: true,

  socketEnabled: true,

  serviceWorkerEnabled: false,

  rateLimitEnabled: true,

  corsEnabled: true,

  compressionEnabled: true,

  securityHeadersEnabled: true,

  requestLoggingEnabled: true,

  isPublic: false,

  allowDebug: false,
});

/* ============================================================================
 * Required production configuration
 * ========================================================================== */

const PRODUCTION_REQUIRED = Object.freeze([
  'JWT_SECRET',
]);

const PRODUCTION_RECOMMENDED = Object.freeze([
  'MONGO_URI',
]);

/* ============================================================================
 * Sensitive environment variable names
 * ========================================================================== */

const SENSITIVE_KEYS = Object.freeze([
  'PASSWORD',
  'PASSCODE',
  'PIN',
  'OTP',
  'TOKEN',
  'ACCESS_TOKEN',
  'REFRESH_TOKEN',
  'AUTHORIZATION',
  'COOKIE',
  'SECRET',
  'API_KEY',
  'CLIENT_SECRET',
  'PRIVATE_KEY',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'MONGO_URI',
  'MONGODB_URI',
  'REDIS_URL',
  'REDIS_URI',
  'DATABASE_URL',
  'DATABASE_URI',
  'CONNECTION_STRING',
  'DSN',
]);

/* ============================================================================
 * Errors
 * ========================================================================== */

class EnvironmentConfigError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'EnvironmentConfigError';

    this.code =
      options.code ||
      'ENVIRONMENT_CONFIG_ERROR';

    this.variable =
      options.variable ||
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    this.cause =
      options.cause ||
      null;

    Error.captureStackTrace?.(
      this,
      EnvironmentConfigError,
    );
  }
}

/* ============================================================================
 * Utility
 * ========================================================================== */

function env(name, fallback = undefined) {
  const value = process.env[name];

  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized === ''
    ? fallback
    : normalized;
}

function asBoolean(value, fallback) {
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

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    [
      '1',
      'true',
      'yes',
      'on',
      'enabled',
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      '0',
      'false',
      'no',
      'off',
      'disabled',
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

function asPositiveInteger(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
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

function asPort(value, fallback) {
  const port = asPositiveInteger(
    value,
    fallback,
  );

  if (
    port < 1 ||
    port > 65_535
  ) {
    return fallback;
  }

  return port;
}

function asNonNegativeInteger(
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

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  return parsed;
}

function asFloat(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function asString(value, fallback) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function asEnum(value, values, fallback) {
  const normalized = asString(
    value,
    fallback,
  );

  return values.includes(normalized)
    ? normalized
    : fallback;
}

function asStringList(value, fallback = []) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return [...fallback];
  }

  const source = Array.isArray(value)
    ? value
    : String(value).split(',');

  return [
    ...new Set(
      source
        .map((item) =>
          String(item).trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function parseJson(
  value,
  fallback = {},
) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);

    if (
      parsed === null ||
      typeof parsed !== 'object'
    ) {
      return fallback;
    }

    return parsed;
  } catch {
    return fallback;
  }
}

function normalizePath(value, fallback) {
  const normalized = asString(
    value,
    fallback,
  );

  if (!normalized) {
    return fallback;
  }

  return normalized.startsWith('/')
    ? normalized
    : `/${normalized}`;
}

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean),
    ),
  ];
}

function safeFreeze(
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
      safeFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort only.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Best effort only.
  }

  return value;
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    code: error.code,
    message: error.message,
  };
}

/* ============================================================================
 * Runtime Detection
 * ========================================================================== */

function detectNodeVersion() {
  const major = Number(
    process.versions.node
      ?.split('.')?.[0],
  );

  return {
    version:
      process.versions.node,

    major,

    minimumMajor:
      NODE_MIN_MAJOR,

    supported:
      Number.isInteger(major) &&
      major >= NODE_MIN_MAJOR,
  };
}

function detectPlatform() {
  return {
    platform:
      process.platform,

    architecture:
      process.arch,

    hostname:
      os.hostname(),

    cpuCount:
      os.cpus()?.length || 1,

    memoryBytes:
      os.totalmem(),
  };
}

/* ============================================================================
 * Environment Classification
 * ========================================================================== */

function resolveNodeEnvironment(
  override,
) {
  return asEnum(
    override ??
      env(
        'NODE_ENV',
        DEFAULTS.nodeEnv,
      ),
    RUNTIME_ENVIRONMENTS,
    DEFAULTS.nodeEnv,
  );
}

function isProductionEnvironment(
  nodeEnv,
) {
  return nodeEnv === 'production';
}

function isTestEnvironment(nodeEnv) {
  return nodeEnv === 'test';
}

function isDevelopmentEnvironment(
  nodeEnv,
) {
  return nodeEnv === 'development';
}

function isStagingEnvironment(nodeEnv) {
  return nodeEnv === 'staging';
}

/* ============================================================================
 * Configuration Builder
 * ========================================================================== */

function buildEnvironment(options = {}) {
  const nodeEnv =
    resolveNodeEnvironment(
      options.nodeEnv,
    );

  const production =
    isProductionEnvironment(
      nodeEnv,
    );

  const test =
    isTestEnvironment(
      nodeEnv,
    );

  const development =
    isDevelopmentEnvironment(
      nodeEnv,
    );

  const staging =
    isStagingEnvironment(
      nodeEnv,
    );

  const node =
    detectNodeVersion();

  const platform =
    detectPlatform();

  const featureFlags = {
    observability:
      asBoolean(
        options.enableObservability ??
          env(
            'ENABLE_OBSERVABILITY',
          ),
        true,
      ),

    metrics:
      asBoolean(
        options.enableMetrics ??
          env(
            'ENABLE_METRICS',
          ),
        DEFAULTS.metricsEnabled,
      ),

    tracing:
      asBoolean(
        options.enableTracing ??
          env(
            'ENABLE_TRACING',
          ),
        DEFAULTS.tracingEnabled,
      ),

    resilience:
      asBoolean(
        options.enableResilience ??
          env(
            'ENABLE_RESILIENCE',
          ),
        DEFAULTS.resilienceEnabled,
      ),

    database:
      asBoolean(
        options.enableDatabase ??
          env(
            'ENABLE_DATABASE',
          ),
        DEFAULTS.databaseEnabled,
      ),

    redis:
      asBoolean(
        options.enableRedis ??
          env(
            'ENABLE_REDIS',
          ),
        DEFAULTS.redisEnabled,
      ),

    queue:
      asBoolean(
        options.enableQueue ??
          env(
            'ENABLE_QUEUE',
          ),
        DEFAULTS.queueEnabled,
      ),

    socket:
      asBoolean(
        options.enableSocket ??
          env(
            'ENABLE_SOCKET',
          ),
        DEFAULTS.socketEnabled,
      ),

    serviceWorker:
      asBoolean(
        options.enableServiceWorker ??
          env(
            'ENABLE_SERVICE_WORKER',
          ),
        DEFAULTS.serviceWorkerEnabled,
      ),

    audit:
      asBoolean(
        options.enableAudit ??
          env(
            'AUDIT_ENABLED',
          ),
        DEFAULTS.auditEnabled,
      ),

    rateLimit:
      asBoolean(
        options.enableRateLimit ??
          env(
            'ENABLE_RATE_LIMIT',
          ),
        DEFAULTS.rateLimitEnabled,
      ),

    cors:
      asBoolean(
        options.enableCors ??
          env(
            'ENABLE_CORS',
          ),
        DEFAULTS.corsEnabled,
      ),

    compression:
      asBoolean(
        options.enableCompression ??
          env(
            'ENABLE_COMPRESSION',
          ),
        DEFAULTS.compressionEnabled,
      ),

    securityHeaders:
      asBoolean(
        options.enableSecurityHeaders ??
          env(
            'ENABLE_SECURITY_HEADERS',
          ),
        DEFAULTS.securityHeadersEnabled,
      ),

    requestLogging:
      asBoolean(
        options.enableRequestLogging ??
          env(
            'ENABLE_REQUEST_LOGGING',
          ),
        DEFAULTS.requestLoggingEnabled,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * SECURITY
   * --------------------------------------------------------------------------
   */

  const security = {
    headersEnabled:
      featureFlags.securityHeaders,

    corsEnabled:
      featureFlags.cors,

    rateLimitEnabled:
      featureFlags.rateLimit,

    allowedOrigins:
      asStringList(
        options.corsOrigins ??
          env(
            'CORS_ORIGINS',
          ),
        production
          ? []
          : [
              'http://localhost:3000',
              'http://localhost:5173',
            ],
      ),

    allowedMethods:
      asStringList(
        options.corsMethods ??
          env(
            'CORS_METHODS',
          ),
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
      asStringList(
        options.corsHeaders ??
          env(
            'CORS_HEADERS',
          ),
        [
          'Accept',
          'Content-Type',
          'Authorization',
          'Idempotency-Key',
          'X-Request-ID',
          'X-Correlation-ID',
          'traceparent',
          'X-Tenant-ID',
        ],
      ),

    credentials:
      asBoolean(
        options.corsCredentials ??
          env(
            'CORS_CREDENTIALS',
          ),
        true,
      ),

    trustProxy:
      asBoolean(
        options.trustProxy ??
          env(
            'TRUST_PROXY',
          ),
        DEFAULTS.trustProxy,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * DATABASE
   * --------------------------------------------------------------------------
   */

  const database = {
    enabled:
      featureFlags.database,

    required:
      asBoolean(
        options.databaseRequired ??
          env(
            'DATABASE_REQUIRED',
          ),
        true,
      ),

    uri:
      asString(
        options.mongoUri ??
          env(
            'MONGO_URI',
            env(
              'MONGODB_URI',
            ),
          ),
        undefined,
      ),

    name:
      asString(
        options.databaseName ??
          env(
            'MONGODB_DB_NAME',
          ),
        undefined,
      ),

    connectTimeoutMs:
      asPositiveInteger(
        options.databaseConnectTimeoutMs ??
          env(
            'DATABASE_CONNECT_TIMEOUT_MS',
          ),
        30_000,
      ),

    healthTimeoutMs:
      asPositiveInteger(
        options.databaseHealthTimeoutMs ??
          env(
            'DATABASE_HEALTH_TIMEOUT_MS',
          ),
        DEFAULTS.healthTimeoutMs,
      ),

    shutdownTimeoutMs:
      asPositiveInteger(
        options.databaseShutdownTimeoutMs ??
          env(
            'DATABASE_SHUTDOWN_TIMEOUT_MS',
          ),
        30_000,
      ),

    serverSelectionTimeoutMs:
      asPositiveInteger(
        options.serverSelectionTimeoutMs ??
          env(
            'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
          ),
        10_000,
      ),

    heartbeatFrequencyMS:
      asPositiveInteger(
        options.heartbeatFrequencyMS ??
          env(
            'MONGODB_HEARTBEAT_FREQUENCY_MS',
          ),
        10_000,
      ),

    options:
      parseJson(
        options.databaseOptions ||
          env(
            'DATABASE_OPTIONS_JSON',
          ),
        {},
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * REDIS
   * --------------------------------------------------------------------------
   */

  const redis = {
    enabled:
      featureFlags.redis,

    required:
      asBoolean(
        options.redisRequired ??
          env(
            'REDIS_REQUIRED',
          ),
        false,
      ),

    url:
      asString(
        options.redisUrl ??
          env(
            'REDIS_URL',
            env(
              'REDIS_URI',
            ),
          ),
        undefined,
      ),

    host:
      asString(
        options.redisHost ??
          env(
            'REDIS_HOST',
          ),
        '127.0.0.1',
      ),

    port:
      asPort(
        options.redisPort ??
          env(
            'REDIS_PORT',
          ),
        6379,
      ),

    database:
      asNonNegativeInteger(
        options.redisDatabase ??
          env(
            'REDIS_DB',
          ),
        0,
      ),

    connectTimeoutMs:
      asPositiveInteger(
        options.redisConnectTimeoutMs ??
          env(
            'REDIS_CONNECT_TIMEOUT_MS',
          ),
        10_000,
      ),

    retry:
      asPositiveInteger(
        options.redisRetryAttempts ??
          env(
            'REDIS_RETRY_ATTEMPTS',
          ),
        5,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * QUEUE
   * --------------------------------------------------------------------------
   */

  const queue = {
    enabled:
      featureFlags.queue,

    required:
      asBoolean(
        options.queueRequired ??
          env(
            'QUEUE_REQUIRED',
          ),
        false,
      ),

    provider:
      asString(
        options.queueProvider ??
          env(
            'QUEUE_PROVIDER',
          ),
        'bullmq',
      ),

    prefix:
      asString(
        options.queuePrefix ??
          env(
            'QUEUE_PREFIX',
          ),
        'titech',
      ),

    concurrency:
      asPositiveInteger(
        options.queueConcurrency ??
          env(
            'QUEUE_CONCURRENCY',
          ),
        5,
      ),

    gracefulShutdown:
      asBoolean(
        options.queueGracefulShutdown ??
          env(
            'QUEUE_GRACEFUL_SHUTDOWN',
          ),
        true,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * SOCKET / REALTIME
   * --------------------------------------------------------------------------
   */

  const socket = {
    enabled:
      featureFlags.socket,

    required:
      asBoolean(
        options.socketRequired ??
          env(
            'SOCKET_REQUIRED',
          ),
        false,
      ),

    path:
      normalizePath(
        options.socketPath ??
          env(
            'SOCKET_PATH',
          ),
        '/socket.io',
      ),

    transports:
      asStringList(
        options.socketTransports ??
          env(
            'SOCKET_TRANSPORTS',
          ),
        [
          'websocket',
          'polling',
        ],
      ),

    corsOrigins:
      asStringList(
        options.socketCorsOrigins ??
          env(
            'SOCKET_CORS_ORIGINS',
          ),
        [],
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * OBSERVABILITY
   * --------------------------------------------------------------------------
   */

  const observability = {
    enabled:
      featureFlags.observability,

    metricsEnabled:
      featureFlags.metrics,

    tracingEnabled:
      featureFlags.tracing,

    serviceName:
      asString(
        options.otelServiceName ??
          env(
            'OTEL_SERVICE_NAME',
          ),
        SERVICE_NAME,
      ),

    serviceVersion:
      asString(
        options.otelServiceVersion ??
          env(
            'OTEL_SERVICE_VERSION',
          ),
        asString(
          options.appVersion ??
            env(
              'APP_VERSION',
            ),
          DEFAULTS.appVersion,
        ),
      ),

    metricsPort:
      asPort(
        options.metricsPort ??
          env(
            'METRICS_PORT',
          ),
        9090,
      ),

    metricsPrefix:
      asString(
        options.metricsPrefix ??
          env(
            'METRICS_PREFIX',
          ),
        'titech_',
      ),

    slowRequestThresholdMs:
      asPositiveInteger(
        options.slowRequestThresholdMs ??
          env(
            'SLOW_REQUEST_THRESHOLD_MS',
          ),
        1_000,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * RESILIENCE
   * --------------------------------------------------------------------------
   */

  const resilience = {
    enabled:
      featureFlags.resilience,

    retryEnabled:
      asBoolean(
        options.retryEnabled ??
          env(
            'RESILIENCE_RETRY_ENABLED',
          ),
        true,
      ),

    timeoutEnabled:
      asBoolean(
        options.timeoutEnabled ??
          env(
            'RESILIENCE_TIMEOUT_ENABLED',
          ),
        true,
      ),

    circuitBreakerEnabled:
      asBoolean(
        options.circuitBreakerEnabled ??
          env(
            'RESILIENCE_CIRCUIT_BREAKER_ENABLED',
          ),
        true,
      ),

    maxRetries:
      asNonNegativeInteger(
        options.maxRetries ??
          env(
            'MAX_RETRIES',
          ),
        3,
      ),

    retryDelayMs:
      asPositiveInteger(
        options.retryDelayMs ??
          env(
            'RETRY_DELAY_MS',
          ),
        250,
      ),

    maxRetryDelayMs:
      asPositiveInteger(
        options.maxRetryDelayMs ??
          env(
            'MAX_RETRY_DELAY_MS',
          ),
        5_000,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * AUDIT
   * --------------------------------------------------------------------------
   */

  const audit = {
    enabled:
      featureFlags.audit,

    /*
     * FIX:
     * The original configuration exposed financialFailClosed and
     * securityFailClosed but omitted the general failClosed property.
     */
    failClosed:
      asBoolean(
        options.auditFailClosed ??
          env(
            'AUDIT_FAIL_CLOSED',
          ),
        true,
      ),

    financialFailClosed:
      asBoolean(
        options.auditFinancialFailClosed ??
          env(
            'AUDIT_FINANCIAL_FAIL_CLOSED',
          ),
        true,
      ),

    securityFailClosed:
      asBoolean(
        options.auditSecurityFailClosed ??
          env(
            'AUDIT_SECURITY_FAIL_CLOSED',
          ),
        true,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * SERVER
   * --------------------------------------------------------------------------
   */

  const server = {
    host:
      asString(
        options.host ??
          env(
            'HOST',
          ),
        DEFAULTS.host,
      ),

    port:
      asPort(
        options.port ??
          env(
            'PORT',
          ),
        DEFAULTS.port,
      ),

    trustProxy:
      asBoolean(
        options.trustProxy ??
          env(
            'TRUST_PROXY',
          ),
        DEFAULTS.trustProxy,
      ),

    bodyLimit:
      asString(
        options.bodyLimit ??
          env(
            'BODY_LIMIT',
          ),
        DEFAULTS.bodyLimit,
      ),

    keepAliveTimeout:
      asPositiveInteger(
        options.keepAliveTimeout ??
          env(
            'HTTP_KEEP_ALIVE_TIMEOUT_MS',
          ),
        DEFAULTS.keepAliveTimeout,
      ),

    headersTimeout:
      asPositiveInteger(
        options.headersTimeout ??
          env(
            'HTTP_HEADERS_TIMEOUT_MS',
          ),
        DEFAULTS.headersTimeout,
      ),

    requestTimeoutMs:
      asPositiveInteger(
        options.requestTimeoutMs ??
          env(
            'HTTP_REQUEST_TIMEOUT_MS',
          ),
        DEFAULTS.requestTimeoutMs,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * TIMEOUTS
   * --------------------------------------------------------------------------
   */

  const timeouts = {
    startup:
      asPositiveInteger(
        options.startupTimeoutMs ??
          env(
            'STARTUP_TIMEOUT_MS',
          ),
        120_000,
      ),

    shutdown:
      asPositiveInteger(
        options.shutdownTimeoutMs ??
          env(
            'SHUTDOWN_TIMEOUT_MS',
          ),
        DEFAULTS.shutdownTimeoutMs,
      ),

    readiness:
      asPositiveInteger(
        options.readinessTimeoutMs ??
          env(
            'READINESS_TIMEOUT_MS',
          ),
        DEFAULTS.readinessTimeoutMs,
      ),

    health:
      asPositiveInteger(
        options.healthTimeoutMs ??
          env(
            'HEALTH_TIMEOUT_MS',
          ),
        DEFAULTS.healthTimeoutMs,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * RUNTIME
   *
   * FIX:
   * Keep runtime metadata and runtime behavior flags in ONE object.
   *
   * The previous version declared `runtime` twice. The second declaration
   * replaced the first and removed `runtime.node`, which caused:
   *
   *   Cannot read properties of undefined (reading 'supported')
   *
   * during validateEnvironment().
   * --------------------------------------------------------------------------
   */

  const runtime = {
    /*
     * Runtime metadata.
     */
    node: {
      version:
        node.version,

      major:
        node.major,

      minimumMajor:
        NODE_MIN_MAJOR,

      supported:
        node.supported,
    },

    processId:
      process.pid,

    platform:
      platform.platform,

    architecture:
      platform.architecture,

    hostname:
      platform.hostname,

    cpuCount:
      platform.cpuCount,

    memoryBytes:
      platform.memoryBytes,

    /*
     * Environment classification.
     */
    production,

    staging,

    development,

    test,

    /*
     * Runtime behavior.
     */
    allowDebug:
      options.allowDebug ??
      asBoolean(
        env(
          'ALLOW_DEBUG',
        ),
        production
          ? false
          : DEFAULTS.allowDebug,
      ),

    gracefulShutdown:
      options.gracefulShutdown ??
      asBoolean(
        env(
          'GRACEFUL_SHUTDOWN',
        ),
        DEFAULTS.gracefulShutdown,
      ),

    public:
      options.public ??
      asBoolean(
        env(
          'APP_PUBLIC',
        ),
        DEFAULTS.isPublic,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * APPLICATION
   * --------------------------------------------------------------------------
   */

  const app = {
    name:
      asString(
        options.applicationName ??
          env(
            'APP_NAME',
          ),
        DEFAULTS.applicationName,
      ),

    serviceName:
      asString(
        options.serviceName ??
          env(
            'SERVICE_NAME',
          ),
        DEFAULTS.serviceName,
      ),

    version:
      asString(
        options.appVersion ??
          env(
            'APP_VERSION',
            env(
              'npm_package_version',
              DEFAULTS.appVersion,
            ),
          ),
        DEFAULTS.appVersion,
      ),

    environment:
      nodeEnv,

    nodeEnv,

    instanceId:
      asString(
        options.instanceId ??
          env(
            'INSTANCE_ID',
            env(
              'HOSTNAME',
            ),
          ),
        crypto.randomUUID(),
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * LOGGING
   * --------------------------------------------------------------------------
   */

  const logging = {
    level:
      asEnum(
        options.logLevel ??
          env(
            'LOG_LEVEL',
          ),
        LOG_LEVELS,
        DEFAULTS.logLevel,
      ),

    pretty:
      asBoolean(
        options.logPretty ??
          env(
            'LOG_PRETTY',
          ),
        development,
      ),

    requestLogging:
      featureFlags.requestLogging,

    redact:
      asStringList(
        options.logRedact ??
          env(
            'LOG_REDACT',
          ),
        [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          'token',
          'secret',
          'pin',
          'otp',
        ],
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * DEPLOYMENT
   * --------------------------------------------------------------------------
   */

  const deployment = {
    region:
      asString(
        options.region ??
          env(
            'AWS_REGION',
            env(
              'CLOUD_REGION',
            ),
          ),
        undefined,
      ),

    zone:
      asString(
        options.zone ??
          env(
            'ZONE',
            env(
              'AVAILABILITY_ZONE',
            ),
          ),
        undefined,
      ),

    environment:
      nodeEnv,

    release:
      asString(
        options.release ??
          env(
            'RELEASE',
          ),
        undefined,
      ),

    commitSha:
      asString(
        options.commitSha ??
          env(
            'GIT_COMMIT_SHA',
          ),
        undefined,
      ),
  };

  /*
   * --------------------------------------------------------------------------
   * DIAGNOSTICS
   *
   * Only non-sensitive runtime metadata is exposed.
   * --------------------------------------------------------------------------
   */

  const diagnostics = {
    platform,

    node,

    process: {
      pid:
        process.pid,

      uptimeSeconds:
        process.uptime(),
    },
  };

  /*
   * --------------------------------------------------------------------------
   * Immutable configuration root
   * --------------------------------------------------------------------------
   */

  const configuration = {
    app,

    runtime,

    server,

    timeouts,

    logging,

    security,

    database,

    redis,

    queue,

    socket,

    observability,

    resilience,

    audit,

    flags: featureFlags,

    deployment,

    diagnostics,
  };

  return safeFreeze(
    configuration,
  );
}

/* ============================================================================
 * Validation
 * ========================================================================== */

function validateEnvironment(
  configuration,
  options = {},
) {
  const config =
    configuration ||
    buildEnvironment();

  const errors = [];
  const warnings = [];

  /*
   * --------------------------------------------------------------------------
   * Configuration shape safety
   * --------------------------------------------------------------------------
   */

  if (
    !config ||
    typeof config !== 'object'
  ) {
    throw new EnvironmentConfigError(
      'TITech environment configuration is unavailable.',
      {
        code:
          'ENVIRONMENT_CONFIGURATION_UNAVAILABLE',
      },
    );
  }

  if (!config.runtime?.node) {
    errors.push({
      code:
        'RUNTIME_NODE_CONFIGURATION_MISSING',

      message:
        'TITech runtime node configuration is missing.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Node version
   * --------------------------------------------------------------------------
   */

  if (
    config.runtime?.node &&
    !config.runtime.node.supported
  ) {
    errors.push({
      code:
        'NODE_VERSION_UNSUPPORTED',

      message:
        `TITech requires Node.js ${NODE_MIN_MAJOR}+; detected ${config.runtime.node.version}.`,
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Environment
   * --------------------------------------------------------------------------
   */

  if (
    !RUNTIME_ENVIRONMENTS.includes(
      config.app?.nodeEnv,
    )
  ) {
    errors.push({
      code:
        'NODE_ENV_INVALID',

      message:
        `Unsupported NODE_ENV "${config.app?.nodeEnv}".`,
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Server
   * --------------------------------------------------------------------------
   */

  if (
    !config.server?.host ||
    typeof config.server.host !==
      'string'
  ) {
    errors.push({
      code:
        'HOST_INVALID',

      message:
        'TITech server HOST configuration is invalid.',
    });
  }

  if (
    !Number.isInteger(
      config.server?.port,
    ) ||
    config.server.port < 1 ||
    config.server.port > 65_535
  ) {
    errors.push({
      code:
        'PORT_INVALID',

      message:
        `TITech server PORT configuration is invalid: ${config.server?.port}.`,
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Production security
   * --------------------------------------------------------------------------
   */

  if (
    config.runtime?.production
  ) {
    if (
      !config.security?.headersEnabled
    ) {
      errors.push({
        code:
          'SECURITY_HEADERS_DISABLED_IN_PRODUCTION',

        message:
          'Security headers cannot be disabled in production.',
      });
    }

    if (
      !config.security?.rateLimitEnabled
    ) {
      warnings.push({
        code:
          'RATE_LIMIT_DISABLED_IN_PRODUCTION',

        message:
          'Rate limiting is disabled in production.',
      });
    }

    if (
      config.runtime.allowDebug
    ) {
      warnings.push({
        code:
          'DEBUG_ENABLED_IN_PRODUCTION',

        message:
          'Debug behavior is explicitly enabled in production.',
      });
    }

    if (
      config.logging?.level ===
        'debug' ||
      config.logging?.level ===
        'trace'
    ) {
      warnings.push({
        code:
          'VERBOSE_LOGGING_IN_PRODUCTION',

        message:
          'Verbose logging is enabled in production.',
      });
    }

    /*
     * Required production secrets.
     *
     * Values are never included in error details.
     */
    for (
      const variable of
        PRODUCTION_REQUIRED
    ) {
      if (!env(variable)) {
        errors.push({
          code:
            'PRODUCTION_REQUIRED_CONFIGURATION_MISSING',

          variable,

          message:
            `Required production configuration "${variable}" is missing.`,
        });
      }
    }

    /*
     * Recommended production configuration.
     */
    for (
      const variable of
        PRODUCTION_RECOMMENDED
    ) {
      if (!env(variable)) {
        warnings.push({
          code:
            'PRODUCTION_RECOMMENDED_CONFIGURATION_MISSING',

          variable,

          message:
            `Recommended production configuration "${variable}" is not configured.`,
        });
      }
    }
  }

  /*
   * --------------------------------------------------------------------------
   * Database
   * --------------------------------------------------------------------------
   */

  if (
    config.database?.enabled &&
    config.database?.required &&
    !config.database?.uri
  ) {
    errors.push({
      code:
        'DATABASE_URI_MISSING',

      message:
        'TITech database is required but MONGO_URI/MONGODB_URI is not configured.',
    });
  }

  if (
    config.runtime?.production &&
    config.database?.enabled &&
    !config.database?.uri
  ) {
    errors.push({
      code:
        'PRODUCTION_DATABASE_URI_MISSING',

      message:
        'TITech production database URI is not configured.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Redis
   * --------------------------------------------------------------------------
   */

  if (
    config.redis?.enabled &&
    config.redis?.required &&
    !config.redis?.url &&
    !config.redis?.host
  ) {
    errors.push({
      code:
        'REDIS_CONFIGURATION_MISSING',

      message:
        'TITech Redis is required but no Redis endpoint is configured.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Queue
   * --------------------------------------------------------------------------
   */

  if (
    config.queue?.enabled &&
    config.queue?.required &&
    !config.queue?.provider
  ) {
    errors.push({
      code:
        'QUEUE_PROVIDER_MISSING',

      message:
        'TITech queue is required but no queue provider is configured.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Socket
   * --------------------------------------------------------------------------
   */

  if (
    config.socket?.enabled &&
    config.socket?.required &&
    !config.socket?.path
  ) {
    errors.push({
      code:
        'SOCKET_PATH_MISSING',

      message:
        'TITech realtime socket is required but no socket path is configured.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Audit
   * --------------------------------------------------------------------------
   */

  if (
    config.runtime?.production &&
    config.audit?.enabled &&
    !config.audit?.financialFailClosed
  ) {
    warnings.push({
      code:
        'FINANCIAL_AUDIT_NOT_FAIL_CLOSED',

      message:
        'Financial audit is configured without fail-closed behavior.',
    });
  }

  if (
    config.runtime?.production &&
    config.audit?.enabled &&
    !config.audit?.securityFailClosed
  ) {
    warnings.push({
      code:
        'SECURITY_AUDIT_NOT_FAIL_CLOSED',

      message:
        'Security audit is configured without fail-closed behavior.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * CORS
   * --------------------------------------------------------------------------
   */

  if (
    config.runtime?.production &&
    config.security?.corsEnabled &&
    config.security.allowedOrigins.length ===
      0
  ) {
    warnings.push({
      code:
        'CORS_ORIGINS_EMPTY_IN_PRODUCTION',

      message:
        'CORS is enabled in production without explicit origins.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * HTTP timeout safety
   * --------------------------------------------------------------------------
   */

  if (
    config.server?.headersTimeout <=
    config.server?.keepAliveTimeout
  ) {
    errors.push({
      code:
        'HTTP_TIMEOUT_CONFIGURATION_INVALID',

      message:
        'HTTP headers timeout must exceed keep-alive timeout.',
    });
  }

  if (
    config.server?.requestTimeoutMs <=
      0 ||
    !Number.isFinite(
      config.server?.requestTimeoutMs,
    )
  ) {
    errors.push({
      code:
        'HTTP_REQUEST_TIMEOUT_INVALID',

      message:
        'HTTP request timeout must be a positive finite value.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Resilience coherence
   * --------------------------------------------------------------------------
   */

  if (
    config.resilience?.maxRetryDelayMs <
    config.resilience?.retryDelayMs
  ) {
    errors.push({
      code:
        'RESILIENCE_RETRY_DELAY_INVALID',

      message:
        'Maximum retry delay must be greater than or equal to the base retry delay.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Feature coherence
   * --------------------------------------------------------------------------
   */

  if (
    config.observability?.tracingEnabled &&
    !config.observability?.enabled
  ) {
    warnings.push({
      code:
        'TRACING_ENABLED_WITH_OBSERVABILITY_DISABLED',

      message:
        'Tracing is enabled while the observability subsystem is disabled.',
    });
  }

  if (
    config.observability?.metricsEnabled &&
    !config.observability?.enabled
  ) {
    warnings.push({
      code:
        'METRICS_ENABLED_WITH_OBSERVABILITY_DISABLED',

      message:
        'Metrics are enabled while the observability subsystem is disabled.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Required service coherence
   * --------------------------------------------------------------------------
   */

  if (
    config.applicationName === ''
  ) {
    errors.push({
      code:
        'APPLICATION_NAME_MISSING',

      message:
        'TITech application name is missing.',
    });
  }

  /*
   * --------------------------------------------------------------------------
   * Throw on critical errors
   * --------------------------------------------------------------------------
   */

  if (errors.length > 0) {
    const combinedError = new Error(
      errors
        .map(
          (item) =>
            `${item.code}: ${item.message}`,
        )
        .join('; '),
    );

    const error =
      startupErrors?.environmentError
        ? startupErrors.environmentError(
            'TITech environment configuration validation failed.',
            {
              cause:
                combinedError,

              critical:
                true,

              fatal:
                true,

              details: {
                errors,
                warnings,
              },
            },
          )
        : new EnvironmentConfigError(
            'TITech environment configuration validation failed.',
            {
              code:
                'ENVIRONMENT_CONFIGURATION_INVALID',

              cause:
                combinedError,

              details: {
                errors,
                warnings,
              },
            },
          );

    throw error;
  }

  return safeFreeze({
    valid: true,

    errors,

    warnings,

    environment:
      config.app.nodeEnv,
  });
}

/* ============================================================================
 * Safe Snapshot
 * ========================================================================== */

function getSnapshot(
  configuration = defaultConfiguration,
) {
  const config =
    configuration ||
    defaultConfiguration;

  return safeFreeze({
    component:
      COMPONENT,

    application: {
      name:
        config.app.name,

      serviceName:
        config.app.serviceName,

      version:
        config.app.version,

      environment:
        config.app.environment,

      nodeEnv:
        config.app.nodeEnv,

      instanceId:
        config.app.instanceId,
    },

    runtime: {
      nodeVersion:
        config.runtime.node.version,

      nodeMajor:
        config.runtime.node.major,

      nodeSupported:
        config.runtime.node.supported,

      platform:
        config.runtime.platform,

      architecture:
        config.runtime.architecture,

      hostname:
        config.runtime.hostname,

      cpuCount:
        config.runtime.cpuCount,

      production:
        config.runtime.production,

      staging:
        config.runtime.staging,

      development:
        config.runtime.development,

      test:
        config.runtime.test,

      allowDebug:
        config.runtime.allowDebug,

      gracefulShutdown:
        config.runtime.gracefulShutdown,

      public:
        config.runtime.public,
    },

    server: {
      host:
        config.server.host,

      port:
        config.server.port,

      trustProxy:
        config.server.trustProxy,

      bodyLimit:
        config.server.bodyLimit,

      keepAliveTimeout:
        config.server.keepAliveTimeout,

      headersTimeout:
        config.server.headersTimeout,

      requestTimeoutMs:
        config.server.requestTimeoutMs,
    },

    features: {
      ...config.flags,
    },

    security: {
      headersEnabled:
        config.security.headersEnabled,

      corsEnabled:
        config.security.corsEnabled,

      rateLimitEnabled:
        config.security.rateLimitEnabled,

      originsConfigured:
        config.security.allowedOrigins
          .length >
        0,

      credentials:
        config.security.credentials,
    },

    database: {
      enabled:
        config.database.enabled,

      required:
        config.database.required,

      uriConfigured:
        Boolean(
          config.database.uri,
        ),

      nameConfigured:
        Boolean(
          config.database.name,
        ),
    },

    redis: {
      enabled:
        config.redis.enabled,

      required:
        config.redis.required,

      urlConfigured:
        Boolean(
          config.redis.url,
        ),

      host:
        config.redis.host,

      port:
        config.redis.port,

      database:
        config.redis.database,
    },

    queue: {
      enabled:
        config.queue.enabled,

      required:
        config.queue.required,

      provider:
        config.queue.provider,

      concurrency:
        config.queue.concurrency,
    },

    socket: {
      enabled:
        config.socket.enabled,

      required:
        config.socket.required,

      path:
        config.socket.path,

      transports:
        [...config.socket.transports],
    },

    observability: {
      enabled:
        config.observability.enabled,

      metricsEnabled:
        config.observability
          .metricsEnabled,

      tracingEnabled:
        config.observability
          .tracingEnabled,

      serviceName:
        config.observability
          .serviceName,

      metricsPort:
        config.observability
          .metricsPort,
    },

    resilience: {
      enabled:
        config.resilience.enabled,

      retryEnabled:
        config.resilience
          .retryEnabled,

      timeoutEnabled:
        config.resilience
          .timeoutEnabled,

      circuitBreakerEnabled:
        config.resilience
          .circuitBreakerEnabled,

      maxRetries:
        config.resilience.maxRetries,
    },

    audit: {
      enabled:
        config.audit.enabled,

      failClosed:
        config.audit.failClosed,

      financialFailClosed:
        config.audit
          .financialFailClosed,

      securityFailClosed:
        config.audit
          .securityFailClosed,
    },

    deployment: {
      region:
        config.deployment.region,

      zone:
        config.deployment.zone,

      release:
        config.deployment.release,

      commitSha:
        config.deployment.commitSha,
    },

    timestamp:
      new Date().toISOString(),
  });
}

/* ============================================================================
 * Default Configuration
 * ========================================================================== */

const defaultConfiguration =
  buildEnvironment();

validateEnvironment(
  defaultConfiguration,
);

/* ============================================================================
 * Public API
 * ========================================================================== */

function getConfig(
  override = {},
) {
  if (
    !override ||
    Object.keys(
      override,
    ).length === 0
  ) {
    return defaultConfiguration;
  }

  const configuration =
    buildEnvironment(
      override,
    );

  validateEnvironment(
    configuration,
  );

  return configuration;
}

function getEnvironment() {
  return defaultConfiguration;
}

function isProduction() {
  return Boolean(
    defaultConfiguration.runtime
      .production,
  );
}

function isStaging() {
  return Boolean(
    defaultConfiguration.runtime
      .staging,
  );
}

function isDevelopment() {
  return Boolean(
    defaultConfiguration.runtime
      .development,
  );
}

function isTest() {
  return Boolean(
    defaultConfiguration.runtime
      .test,
  );
}

function getPort() {
  return defaultConfiguration
    .server
    .port;
}

function getHost() {
  return defaultConfiguration
    .server
    .host;
}

function isFeatureEnabled(name) {
  if (
    typeof name !== 'string' ||
    !name.trim()
  ) {
    return false;
  }

  return Boolean(
    defaultConfiguration
      .flags[
        name.trim()
      ],
  );
}

/* ============================================================================
 * Bootstrap Adapter
 * ========================================================================== */

/**
 * Supports environment.js / ApplicationBootstrap without moving environment
 * configuration responsibilities into the lifecycle layer.
 */

async function initialize(
  context = {},
) {
  const configuration =
    getEnvironment();

  validateEnvironment(
    configuration,
  );

  if (
    context &&
    typeof context ===
      'object'
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

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
  Object.freeze({
    /*
     * Core configuration.
     */
    environment:
      defaultConfiguration,

    configuration:
      defaultConfiguration,

    config:
      defaultConfiguration,

    getEnvironment,

    getConfig,

    buildEnvironment,

    /*
     * Validation.
     */
    validateEnvironment,

    /*
     * Bootstrap contract.
     */
    initialize,

    bootstrap,

    start,

    /*
     * Environment helpers.
     */
    isProduction,

    isStaging,

    isDevelopment,

    isTest,

    getPort,

    getHost,

    isFeatureEnabled,

    /*
     * Safe diagnostics.
     */
    getSnapshot,

    /*
     * Constants.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    NODE_MIN_MAJOR,

    RUNTIME_ENVIRONMENTS,

    LOG_LEVELS,

    EnvironmentConfigError,

    /*
     * Safe operational metadata.
     */
    PRODUCTION_REQUIRED:
      [...PRODUCTION_REQUIRED],

    PRODUCTION_RECOMMENDED:
      [...PRODUCTION_RECOMMENDED],

    SENSITIVE_KEYS:
      [...SENSITIVE_KEYS],

    safeError,
  });