'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/defaults.js
 *
 * Purpose:
 *   Enterprise production-grade canonical configuration defaults.
 *
 * Responsibilities:
 *   - Define safe baseline configuration values.
 *   - Centralize application/runtime defaults.
 *   - Prevent scattered magic defaults across configuration modules.
 *   - Provide subsystem defaults for bootstrap/configuration consumers.
 *   - Define conservative production-safe financial defaults.
 *   - Define timeout, retry, resilience and infrastructure defaults.
 *   - Define security, audit, cache and observability defaults.
 *   - Provide immutable defaults.
 *   - Provide safe cloning/access helpers.
 *
 * IMPORTANT:
 *
 *   This file contains DEFAULTS only.
 *
 *   It does NOT:
 *     - read process.env directly.
 *     - validate deployment-specific values.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - start Express.
 *     - initialize services.
 *     - start workers.
 *     - perform business logic.
 *
 * Environment-specific configuration belongs to:
 *
 *   backend/config/bootstrapEnvironment.js
 *
 * Canonical application configuration belongs to:
 *
 *   backend/config/index.js
 *
 * Runtime access belongs to:
 *
 *   backend/config/configProvider.js
 *
 * =============================================================================
 *
 * Design rule:
 *
 *   defaults.js
 *       ↓
 *   environment overrides
 *       ↓
 *   validated configuration
 *       ↓
 *   immutable runtime configuration
 *
 * =============================================================================
 */

const os =
  require('node:os');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'config-defaults';

const DEFAULT_SERVICE_NAME =
  'titech-backend';

const DEFAULT_APPLICATION_NAME =
  'titech-community-capital';

const DEFAULT_VERSION =
  '0.0.0';

const DEFAULT_NODE_ENV =
  'development';

const MIN_NODE_MAJOR =
  20;

/**
 * -----------------------------------------------------------------------------
 * Environment names
 * -----------------------------------------------------------------------------
 */

const ENVIRONMENTS =
  Object.freeze([
    'development',
    'test',
    'staging',
    'production',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Log levels
 * -----------------------------------------------------------------------------
 */

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

/**
 * -----------------------------------------------------------------------------
 * Common HTTP methods
 * -----------------------------------------------------------------------------
 */

const HTTP_METHODS =
  Object.freeze([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Runtime defaults
 * -----------------------------------------------------------------------------
 */

const RUNTIME_DEFAULTS =
  Object.freeze({
    nodeEnv:
      DEFAULT_NODE_ENV,

    serviceName:
      DEFAULT_SERVICE_NAME,

    applicationName:
      DEFAULT_APPLICATION_NAME,

    version:
      DEFAULT_VERSION,

    hostname:
      os.hostname(),

    host:
      '0.0.0.0',

    port:
      3000,

    public:
      false,

    gracefulShutdown:
      true,

    allowDebug:
      false,

    instanceId:
      null,

    minNodeMajor:
      MIN_NODE_MAJOR,
  });

/**
 * =============================================================================
 * Server defaults
 * =============================================================================
 */

const SERVER_DEFAULTS =
  Object.freeze({
    host:
      RUNTIME_DEFAULTS.host,

    port:
      RUNTIME_DEFAULTS.port,

    backlog:
      511,

    trustProxy:
      false,

    bodyLimit:
      '1mb',

    jsonLimit:
      '1mb',

    urlEncodedLimit:
      '1mb',

    parameterLimit:
      1_000,

    keepAliveTimeoutMs:
      65_000,

    headersTimeoutMs:
      66_000,

    requestTimeoutMs:
      30_000,

    responseTimeoutMs:
      30_000,

    shutdownTimeoutMs:
      30_000,

    readinessTimeoutMs:
      5_000,

    healthTimeoutMs:
      5_000,

    compression:
      true,

    requestLogging:
      true,
  });

/**
 * =============================================================================
 * Security defaults
 * =============================================================================
 */

const SECURITY_DEFAULTS =
  Object.freeze({
    headersEnabled:
      true,

    corsEnabled:
      true,

    corsCredentials:
      true,

    corsOriginRequired:
      true,

    corsAllowWildcard:
      false,

    corsAllowNull:
      false,

    rateLimitEnabled:
      true,

    hppEnabled:
      true,

    mongoSanitizeEnabled:
      true,

    xssProtectionEnabled:
      true,

    trustProxy:
      false,

    helmetEnabled:
      true,

    allowedMethods:
      HTTP_METHODS,

    allowedHeaders:
      Object.freeze([
        'Accept',
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Tenant-ID',
        'X-Device-ID',
        'X-Client-Version',
        'traceparent',
        'tracestate',
      ]),

    exposedHeaders:
      Object.freeze([
        'X-Request-ID',
        'X-Correlation-ID',
        'Idempotency-Key',
        'ETag',
      ]),

    maxBodyBytes:
      1 * 1024 * 1024,

    maxRequestHeaderBytes:
      16 * 1024,
  });

/**
 * =============================================================================
 * Database defaults
 * =============================================================================
 */

const DATABASE_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    required:
      true,

    gracefulStartup:
      false,

    skipChecks:
      false,

    databaseName:
      'titech',

    connectTimeoutMs:
      30_000,

    serverSelectionTimeoutMS:
      10_000,

    socketTimeoutMS:
      45_000,

    heartbeatFrequencyMS:
      10_000,

    maxPoolSize:
      10,

    minPoolSize:
      2,

    maxConnecting:
      2,

    autoIndex:
      false,

    autoCreate:
      false,

    retryWrites:
      true,

    directConnection:
      false,

    shutdownTimeoutMs:
      30_000,

    healthTimeoutMs:
      5_000,

    retryOnTransientErrors:
      true,

    maxRetries:
      5,

    initialRetryDelayMs:
      2_000,

    maxRetryDelayMs:
      30_000,

    retryJitterRatio:
      0.10,

    fallbackEnabled:
      false,

    fallbackMaxRetries:
      2,
  });

/**
 * =============================================================================
 * Redis defaults
 * =============================================================================
 */

const REDIS_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    required:
      false,

    host:
      '127.0.0.1',

    port:
      6379,

    database:
      0,

    connectTimeoutMs:
      10_000,

    commandTimeoutMs:
      5_000,

    healthTimeoutMs:
      5_000,

    shutdownTimeoutMs:
      10_000,

    retryAttempts:
      5,

    retryDelayMs:
      250,

    maxRetryDelayMs:
      5_000,

    reconnectOnError:
      true,

    enableOfflineQueue:
      false,

    enableReadyCheck:
      true,

    lazyConnect:
      true,

    keepAlive:
      5_000,

    maxRetriesPerRequest:
      3,

    enableAutoPipelining:
      true,
  });

/**
 * =============================================================================
 * Cache defaults
 * =============================================================================
 */

const CACHE_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    provider:
      'redis',

    mode:
      'distributed',

    required:
      false,

    failurePolicy:
      'fail_open',

    financialFailurePolicy:
      'fail_open',

    securityFailurePolicy:
      'fail_closed',

    keyPrefix:
      'titech',

    namespace:
      'app',

    tenantIsolation:
      true,

    includeEnvironment:
      true,

    includeService:
      true,

    includeApplication:
      true,

    hashingEnabled:
      false,

    keyMaxLength:
      512,

    valueMaxBytes:
      1 * 1024 * 1024,

    versionedKeysEnabled:
      true,

    schemaVersion:
      1,

    staleWhileRevalidate:
      false,

    allowStale:
      false,

    negativeCacheEnabled:
      false,

    negativeCacheSeconds:
      30,

    invalidationEnabled:
      true,

    pubSubInvalidationEnabled:
      true,

    metricsEnabled:
      true,

    tracingEnabled:
      true,

    loggingEnabled:
      true,

    auditEnabled:
      true,

    /**
     * Financial cache defaults are deliberately conservative.
     */
    cacheFinancialReads:
      true,

    cacheFinancialWrites:
      false,

    cacheLedgerReads:
      false,

    cacheBalances:
      false,

    cacheAccountState:
      false,

    cacheAuthorization:
      true,

    cacheKyc:
      false,

    cacheAml:
      false,

    cachePaymentState:
      false,

    cacheMobileMoneyState:
      false,

    idempotencyTtlSeconds:
      86_400,

    lockTtlSeconds:
      30,

    memoryMaxItems:
      10_000,

    memoryMaxBytes:
      64 * 1024 * 1024,
  });

/**
 * -----------------------------------------------------------------------------
 * Cache TTL defaults
 * -----------------------------------------------------------------------------
 */

const CACHE_TTL_DEFAULTS =
  Object.freeze({
    defaultSeconds:
      300,

    sessionSeconds:
      1_800,

    authSeconds:
      300,

    userSeconds:
      300,

    tenantSeconds:
      300,

    configurationSeconds:
      600,

    referenceDataSeconds:
      3_600,

    permissionSeconds:
      300,

    rateLimitSeconds:
      60,

    idempotencySeconds:
      86_400,

    lockSeconds:
      30,

    shortLivedSeconds:
      30,

    longLivedSeconds:
      86_400,
  });

/**
 * =============================================================================
 * Observability defaults
 * =============================================================================
 */

const OBSERVABILITY_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    metricsEnabled:
      true,

    tracingEnabled:
      true,

    requestMetricsEnabled:
      true,

    dependencyMetricsEnabled:
      true,

    metricsPrefix:
      'titech_',

    metricsPort:
      9090,

    slowRequestThresholdMs:
      1_000,

    eventLoopSampleMs:
      1_000,

    maxRecentErrors:
      100,

    maxRecentRequests:
      100,

    healthTimeoutMs:
      5_000,

    readinessTimeoutMs:
      5_000,

    serviceName:
      DEFAULT_SERVICE_NAME,

    applicationName:
      DEFAULT_APPLICATION_NAME,

    serviceVersion:
      DEFAULT_VERSION,

    histogramBuckets:
      Object.freeze([
        0.005,
        0.01,
        0.025,
        0.05,
        0.1,
        0.25,
        0.5,
        1,
        2.5,
        5,
        10,
      ]),
  });

/**
 * =============================================================================
 * Resilience defaults
 * ============================================================================= */

const RESILIENCE_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    retryEnabled:
      true,

    timeoutEnabled:
      true,

    circuitBreakerEnabled:
      true,

    bulkheadEnabled:
      false,

    fallbackEnabled:
      true,

    maxRetries:
      3,

    initialRetryDelayMs:
      250,

    maxRetryDelayMs:
      5_000,

    jitterRatio:
      0.20,

    requestTimeoutMs:
      30_000,

    operationTimeoutMs:
      30_000,

    circuitBreakerFailureThreshold:
      5,

    circuitBreakerSuccessThreshold:
      2,

    circuitBreakerOpenDurationMs:
      30_000,

    circuitBreakerHalfOpenMaxCalls:
      1,

    bulkheadMaxConcurrent:
      50,

    bulkheadMaxQueue:
      100,

    retryableStatusCodes:
      Object.freeze([
        408,
        425,
        429,
        500,
        502,
        503,
        504,
      ]),

    maxRetryAfterMs:
      30_000,
  });

/**
 * =============================================================================
 * Audit defaults
 * =============================================================================
 */

const AUDIT_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    mode:
      'async',

    failClosed:
      true,

    financialFailClosed:
      true,

    securityFailClosed:
      true,

    complianceFailClosed:
      true,

    includeRequestMetadata:
      true,

    includeResponseMetadata:
      false,

    includeTraceContext:
      true,

    includeActor:
      true,

    includeTenant:
      true,

    includeIpAddress:
      true,

    includeUserAgent:
      true,

    includeDeviceMetadata:
      true,

    includeRoute:
      true,

    includeMethod:
      true,

    includeOutcome:
      true,

    includeError:
      true,

    includeTiming:
      true,

    includeChanges:
      true,

    immutable:
      true,

    hashChainEnabled:
      true,

    eventSignatureEnabled:
      false,

    encryptionEnabled:
      false,

    queueEnabled:
      true,

    queueName:
      'audit-events',

    batchEnabled:
      true,

    batchSize:
      100,

    batchFlushIntervalMs:
      1_000,

    maxQueueSize:
      10_000,

    writeTimeoutMs:
      5_000,

    shutdownTimeoutMs:
      15_000,

    healthTimeoutMs:
      5_000,

    retentionDays:
      2_555,

    hotRetentionDays:
      90,

    coldRetentionDays:
      2_555,

    maximumPayloadBytes:
      64 * 1024,

    maximumChanges:
      100,

    maximumMetadataKeys:
      100,

    maximumStringLength:
      4_096,

    requireTenantForTenantScopedEvents:
      true,

    requireActorForSecurityEvents:
      false,

    requireCorrelationId:
      true,

    requireRequestIdForHttpEvents:
      false,

    allowAnonymousSecurityEvents:
      true,

    redactUnknownFields:
      false,

    allowSensitiveMetadata:
      false,

    defaultSeverity:
      'info',

    defaultCategory:
      'system',

    defaultOutcome:
      'success',
  });

/**
 * =============================================================================
 * CORS defaults
 * =============================================================================
 */

const CORS_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    mode:
      'development',

    credentials:
      true,

    originRequired:
      true,

    allowNullOrigin:
      false,

    allowWildcard:
      false,

    preflightContinue:
      false,

    optionsSuccessStatus:
      204,

    maxAgeSeconds:
      600,

    allowSubdomains:
      false,

    strictOriginValidation:
      true,

    dynamicOrigin:
      true,

    logRejectedOrigins:
      true,

    auditRejectedOrigins:
      true,

    cachePreflight:
      true,

    developmentOrigins:
      Object.freeze([
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
      ]),

    stagingOrigins:
      Object.freeze([]),

    productionOrigins:
      Object.freeze([]),

    allowedMethods:
      HTTP_METHODS,

    allowedHeaders:
      Object.freeze([
        'Accept',
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Tenant-ID',
        'X-Device-ID',
        'X-Client-Version',
        'traceparent',
        'tracestate',
      ]),

    exposedHeaders:
      Object.freeze([
        'X-Request-ID',
        'X-Correlation-ID',
        'Idempotency-Key',
        'ETag',
      ]),
  });

/**
 * =============================================================================
 * Rate-limit defaults
 * =============================================================================
 */

const RATE_LIMIT_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    windowMs:
      60_000,

    max:
      100,

    standardHeaders:
      true,

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    skipFailedRequests:
      false,

    message:
      'Too many requests. Please try again later.',
  });

const AUTH_RATE_LIMIT_DEFAULTS =
  Object.freeze({
    windowMs:
      15 * 60_000,

    max:
      10,

    standardHeaders:
      true,

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    skipFailedRequests:
      false,
  });

const FINANCIAL_RATE_LIMIT_DEFAULTS =
  Object.freeze({
    windowMs:
      60_000,

    max:
      30,

    standardHeaders:
      true,

    legacyHeaders:
      false,
  });

/**
 * =============================================================================
 * Session defaults
 * =============================================================================
 */

const SESSION_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    ttlSeconds:
      1_800,

    rolling:
      true,

    secure:
      true,

    httpOnly:
      true,

    sameSite:
      'lax',

    cookieName:
      'titech.sid',
  });

/**
 * =============================================================================
 * Authentication / JWT defaults
 * =============================================================================
 */

const AUTH_DEFAULTS =
  Object.freeze({
    accessTokenTtlSeconds:
      900,

    refreshTokenTtlSeconds:
      2_592_000,

    clockToleranceSeconds:
      5,

    issuer:
      DEFAULT_APPLICATION_NAME,

    audience:
      DEFAULT_SERVICE_NAME,

    algorithm:
      'HS256',

    requireExpiration:
      true,

    requireIssuer:
      true,

    requireAudience:
      true,

    refreshRotation:
      true,

    revokeOnRotation:
      true,

    maxRefreshReuse:
      1,
  });

/**
 * =============================================================================
 * API defaults
 * =============================================================================
 */

const API_DEFAULTS =
  Object.freeze({
    prefix:
      '/api',

    version:
      'v1',

    healthPath:
      '/health',

    readinessPath:
      '/ready',

    livenessPath:
      '/live',

    metricsPath:
      '/metrics',

    docsPath:
      '/docs',

    requestIdHeader:
      'X-Request-ID',

    correlationIdHeader:
      'X-Correlation-ID',

    tenantIdHeader:
      'X-Tenant-ID',

    idempotencyKeyHeader:
      'Idempotency-Key',

    maxPageSize:
      100,

    defaultPageSize:
      25,

    defaultSortDirection:
      'desc',
  });

/**
 * =============================================================================
 * Queue defaults
 * =============================================================================
 */

const QUEUE_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    required:
      false,

    provider:
      'bullmq',

    prefix:
      'titech',

    concurrency:
      5,

    removeOnComplete:
      1_000,

    removeOnFail:
      5_000,

    attempts:
      3,

    backoffType:
      'exponential',

    backoffDelayMs:
      1_000,

    shutdownTimeoutMs:
      30_000,

    gracefulShutdown:
      true,
  });

/**
 * =============================================================================
 * Socket / realtime defaults
 * =============================================================================
 */

const SOCKET_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    required:
      false,

    path:
      '/socket.io',

    transports:
      Object.freeze([
        'websocket',
        'polling',
      ]),

    pingIntervalMs:
      25_000,

    pingTimeoutMs:
      20_000,

    connectTimeoutMs:
      45_000,

    maxHttpBufferSize:
      1e6,

    gracefulShutdown:
      true,
  });

/**
 * =============================================================================
 * Logging defaults
 * =============================================================================
 */

const LOGGING_DEFAULTS =
  Object.freeze({
    level:
      'info',

    pretty:
      false,

    requestLogging:
      true,

    redactHeaders:
      Object.freeze([
        'authorization',
        'cookie',
        'set-cookie',
      ]),

    redactFields:
      Object.freeze([
        'password',
        'token',
        'secret',
        'pin',
        'otp',
        'accessToken',
        'refreshToken',
      ]),

    timestamp:
      true,
  });

/**
 * =============================================================================
 * Feature flags
 * =============================================================================
 */

const FEATURE_DEFAULTS =
  Object.freeze({
    observability:
      true,

    metrics:
      true,

    tracing:
      true,

    resilience:
      true,

    database:
      true,

    redis:
      true,

    queue:
      true,

    socket:
      true,

    audit:
      true,

    rateLimit:
      true,

    cors:
      true,

    compression:
      true,

    securityHeaders:
      true,

    requestLogging:
      true,

    serviceWorker:
      false,
  });

/**
 * =============================================================================
 * Infrastructure defaults
 * =============================================================================
 */

const INFRASTRUCTURE_DEFAULTS =
  Object.freeze({
    failFast:
      true,

    dependencyHealthTimeoutMs:
      5_000,

    dependencyShutdownTimeoutMs:
      15_000,

    startupTimeoutMs:
      120_000,

    shutdownTimeoutMs:
      30_000,

    continueOnOptionalFailure:
      true,

    continueOnShutdownFailure:
      true,
  });

/**
 * =============================================================================
 * Idempotency defaults
 * =============================================================================
 *
 * This configuration does not implement idempotency. It only provides safe
 * baseline policy consumed by the idempotency subsystem.
 * =============================================================================
 */

const IDEMPOTENCY_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    requiredForFinancialWrites:
      true,

    ttlSeconds:
      86_400,

    lockTtlSeconds:
      30,

    responseCacheEnabled:
      true,

    conflictOnPayloadMismatch:
      true,

    replayCompletedResponses:
      true,

    maxRequestBodyBytes:
      1 * 1024 * 1024,

    storage:
      'redis',

    namespace:
      'idempotency',
  });

/**
 * =============================================================================
 * Financial defaults
 * =============================================================================
 *
 * Conservative defaults for a financial platform:
 *
 *   - authoritative state belongs to the database/ledger.
 *   - cache never becomes a source of truth.
 *   - audit is enabled.
 *   - financial audit fails closed.
 *   - idempotency is required for financial writes.
 * =============================================================================
 */

const FINANCIAL_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    currency:
      'UGX',

    scale:
      2,

    rounding:
      'HALF_UP',

    requireIdempotency:
      true,

    requireAudit:
      true,

    auditFailClosed:
      true,

    cacheAuthoritativeState:
      false,

    allowNegativeBalances:
      false,

    allowFloatingPointMoney:
      false,

    transactionTimeoutMs:
      30_000,

    ledgerWriteTimeoutMs:
      30_000,

    paymentTimeoutMs:
      30_000,

    reconciliationTimeoutMs:
      60_000,

    maxTransactionAmount:
      null,

    minTransactionAmount:
      1,

    maxBatchSize:
      100,

    dualAuthorization:
      false,
  });

/**
 * =============================================================================
 * KYC / AML defaults
 * =============================================================================
 */

const COMPLIANCE_DEFAULTS =
  Object.freeze({
    kycEnabled:
      true,

    amlEnabled:
      true,

    requireKycForFinancialOperations:
      true,

    auditRequired:
      true,

    redactSensitiveData:
      true,

    decisionCacheEnabled:
      false,

    decisionCacheTtlSeconds:
      300,

    providerTimeoutMs:
      15_000,

    retryAttempts:
      2,
  });

/**
 * =============================================================================
 * Health/readiness defaults
 * =============================================================================
 */

const HEALTH_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    publicLiveness:
      true,

    publicReadiness:
      true,

    dependencyChecks:
      true,

    detailedErrors:
      false,

    includeSystemMetrics:
      true,

    readinessRequiresDatabase:
      true,

    readinessRequiresRedis:
      false,

    readinessRequiresQueue:
      false,

    readinessRequiresObservability:
      false,
  });

/**
 * =============================================================================
 * Shutdown defaults
 * =============================================================================
 */

const SHUTDOWN_DEFAULTS =
  Object.freeze({
    enabled:
      true,

    signalTimeoutMs:
      30_000,

    forceExitTimeoutMs:
      60_000,

    closeServer:
      true,

    closeSockets:
      true,

    closeQueues:
      true,

    closeRedis:
      true,

    closeDatabase:
      true,

    flushLogs:
      true,

    flushTelemetry:
      true,
  });

/**
 * =============================================================================
 * Complete canonical default object
 * =============================================================================
 */

const DEFAULTS =
  Object.freeze({
    component:
      COMPONENT,

    runtime:
      RUNTIME_DEFAULTS,

    server:
      SERVER_DEFAULTS,

    security:
      SECURITY_DEFAULTS,

    database:
      DATABASE_DEFAULTS,

    redis:
      REDIS_DEFAULTS,

    cache:
      Object.freeze({
        ...CACHE_DEFAULTS,

        ttl:
          CACHE_TTL_DEFAULTS,
      }),

    observability:
      OBSERVABILITY_DEFAULTS,

    resilience:
      RESILIENCE_DEFAULTS,

    audit:
      AUDIT_DEFAULTS,

    cors:
      CORS_DEFAULTS,

    rateLimit:
      RATE_LIMIT_DEFAULTS,

    authRateLimit:
      AUTH_RATE_LIMIT_DEFAULTS,

    financialRateLimit:
      FINANCIAL_RATE_LIMIT_DEFAULTS,

    session:
      SESSION_DEFAULTS,

    auth:
      AUTH_DEFAULTS,

    api:
      API_DEFAULTS,

    queue:
      QUEUE_DEFAULTS,

    socket:
      SOCKET_DEFAULTS,

    logging:
      LOGGING_DEFAULTS,

    features:
      FEATURE_DEFAULTS,

    infrastructure:
      INFRASTRUCTURE_DEFAULTS,

    idempotency:
      IDEMPOTENCY_DEFAULTS,

    financial:
      FINANCIAL_DEFAULTS,

    compliance:
      COMPLIANCE_DEFAULTS,

    health:
      HEALTH_DEFAULTS,

    shutdown:
      SHUTDOWN_DEFAULTS,
  });

/**
 * =============================================================================
 * Deep clone
 * =============================================================================
 */

function clone(
  value,
) {
  if (
    value ===
      null ||
    value ===
      undefined
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
    'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch {
      // Fall through.
    }
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      clone,
    );
  }

  if (
    typeof value ===
      'object'
  ) {
    const result =
      {};

    for (
      const [
        key,
        item,
      ] of Object.entries(
        value,
      )
    ) {
      result[key] =
        clone(
          item,
        );
    }

    return result;
  }

  return value;
}

/**
 * =============================================================================
 * Deep freeze
 * =============================================================================
 */

function freeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    (
      typeof value !==
        'object' &&
      typeof value !==
        'function'
    )
  ) {
    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    return value;
  }

  seen.add(
    value,
  );

  for (
    const key of
      Reflect.ownKeys(
        value,
      )
  ) {
    try {
      freeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort.
    }
  }

  try {
    Object.freeze(
      value,
    );
  } catch {
    // Best effort.
  }

  return value;
}

/**
 * =============================================================================
 * Path access
 * =============================================================================
 */

function normalizePath(
  value,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value
      .map(
        item =>
          String(
            item,
          ).trim(),
      )
      .filter(Boolean);
  }

  return String(
    value ||
      '',
  )
    .split('.')
    .map(
      item =>
        item.trim(),
    )
    .filter(Boolean);
}

function getDefault(
  path,
  fallback =
    undefined,
) {
  const parts =
    normalizePath(
      path,
    );

  let current =
    DEFAULTS;

  for (
    const part of
      parts
  ) {
    if (
      current ===
        null ||
      current ===
        undefined ||
      !Object.prototype.hasOwnProperty.call(
        Object(
          current,
        ),
        part,
      )
    ) {
      return fallback;
    }

    current =
      current[
        part
      ];
  }

  return current;
}

function hasDefault(
  path,
) {
  const marker =
    Symbol(
      'missing',
    );

  return (
    getDefault(
      path,
      marker,
    ) !==
    marker
  );
}

/**
 * =============================================================================
 * Environment profile defaults
 * =============================================================================
 *
 * These profiles are still defaults. Actual environment variables are applied
 * by bootstrapEnvironment.js/config/index.js.
 * =============================================================================
 */

const ENVIRONMENT_DEFAULTS =
  Object.freeze({
    development:
      Object.freeze({
        runtime: {
          allowDebug:
            true,

          gracefulShutdown:
            true,
        },

        database: {
          autoIndex:
            true,

          autoCreate:
            true,

          gracefulStartup:
            true,
        },

        logging: {
          level:
            'debug',

          pretty:
            true,
        },

        cors: {
          mode:
            'development',
        },

        health: {
          detailedErrors:
            true,
        },
      }),

    test:
      Object.freeze({
        runtime: {
          allowDebug:
            true,

          gracefulShutdown:
            false,
        },

        database: {
          autoIndex:
            false,

          autoCreate:
            false,

          gracefulStartup:
            true,
        },

        redis: {
          required:
            false,
        },

        queue: {
          enabled:
            false,
        },

        socket: {
          enabled:
            false,
        },

        logging: {
          level:
            'warn',

          pretty:
            false,

          requestLogging:
            false,
        },

        audit: {
          enabled:
            true,
        },
      }),

    staging:
      Object.freeze({
        runtime: {
          allowDebug:
            false,

          gracefulShutdown:
            true,
        },

        database: {
          autoIndex:
            false,

          autoCreate:
            false,

          gracefulStartup:
            false,
        },

        logging: {
          level:
            'info',

          pretty:
            false,
        },

        cors: {
          mode:
            'staging',
        },
      }),

    production:
      Object.freeze({
        runtime: {
          allowDebug:
            false,

          gracefulShutdown:
            true,
        },

        database: {
          required:
            true,

          autoIndex:
            false,

          autoCreate:
            false,

          gracefulStartup:
            false,

          fallbackEnabled:
            false,
        },

        redis: {
          required:
            false,
        },

        queue: {
          required:
            false,
        },

        socket: {
          required:
            false,
        },

        logging: {
          level:
            'info',

          pretty:
            false,
        },

        cors: {
          mode:
            'production',

          allowWildcard:
            false,

          originRequired:
            true,
        },

        security: {
          headersEnabled:
            true,

          helmetEnabled:
            true,

          rateLimitEnabled:
            true,
        },

        audit: {
          enabled:
            true,

          failClosed:
            true,

          financialFailClosed:
            true,

          securityFailClosed:
            true,

          complianceFailClosed:
            true,
        },

        financial: {
          requireIdempotency:
            true,

          requireAudit:
            true,

          auditFailClosed:
            true,

          cacheAuthoritativeState:
            false,
        },

        health: {
          detailedErrors:
            false,
        },
      }),
  });

/**
 * =============================================================================
 * Get environment defaults
 * ============================================================================= */

function getEnvironmentDefaults(
  environment,
) {
  const profile =
    ENVIRONMENT_DEFAULTS[
      environment
    ];

  if (
    !profile
  ) {
    return {};
  }

  return clone(
    profile,
  );
}

/**
 * =============================================================================
 * Safe snapshot
 * =============================================================================
 */

function getSnapshot() {
  return {
    component:
      COMPONENT,

    runtime:
      clone(
        DEFAULTS.runtime,
      ),

    server:
      clone(
        DEFAULTS.server,
      ),

    security:
      clone(
        DEFAULTS.security,
      ),

    database:
      clone(
        {
          ...DEFAULTS.database,

          /**
           * Never expose actual connection strings from defaults.
           */
          uriConfigured:
            false,

          fallbackUriConfigured:
            false,
        },
      ),

    redis:
      clone(
        {
          ...DEFAULTS.redis,

          passwordConfigured:
            false,

          urlConfigured:
            false,
        },
      ),

    cache:
      clone(
        DEFAULTS.cache,
      ),

    observability:
      clone(
        DEFAULTS.observability,
      ),

    resilience:
      clone(
        DEFAULTS.resilience,
      ),

    audit:
      clone(
        DEFAULTS.audit,
      ),

    cors:
      clone(
        DEFAULTS.cors,
      ),

    rateLimit:
      clone(
        DEFAULTS.rateLimit,
      ),

    authRateLimit:
      clone(
        DEFAULTS.authRateLimit,
      ),

    financialRateLimit:
      clone(
        DEFAULTS.financialRateLimit,
      ),

    session:
      clone(
        DEFAULTS.session,
      ),

    auth:
      clone(
        DEFAULTS.auth,
      ),

    api:
      clone(
        DEFAULTS.api,
      ),

    queue:
      clone(
        DEFAULTS.queue,
      ),

    socket:
      clone(
        DEFAULTS.socket,
      ),

    logging:
      clone(
        DEFAULTS.logging,
      ),

    features:
      clone(
        DEFAULTS.features,
      ),

    infrastructure:
      clone(
        DEFAULTS.infrastructure,
      ),

    idempotency:
      clone(
        DEFAULTS.idempotency,
      ),

    financial:
      clone(
        DEFAULTS.financial,
      ),

    compliance:
      clone(
        DEFAULTS.compliance,
      ),

    health:
      clone(
        DEFAULTS.health,
      ),

    shutdown:
      clone(
        DEFAULTS.shutdown,
      ),

    timestamp:
      new Date().toISOString(),
  };
}

/**
 * =============================================================================
 * Public API
 * ============================================================================= */

module.exports =
  Object.freeze({
    /**
     * Canonical defaults object.
     */
    DEFAULTS:

      freeze(
        DEFAULTS,
      ),

    /**
     * Environment profiles.
     */
    ENVIRONMENT_DEFAULTS:

      freeze(
        ENVIRONMENT_DEFAULTS,
      ),

    /**
     * Section exports.
     *
     * These preserve compatibility with existing modules that import specific
     * default sections.
     */
    RUNTIME_DEFAULTS,

    SERVER_DEFAULTS,

    SECURITY_DEFAULTS,

    DATABASE_DEFAULTS,

    REDIS_DEFAULTS,

    CACHE_DEFAULTS,

    CACHE_TTL_DEFAULTS,

    OBSERVABILITY_DEFAULTS,

    RESILIENCE_DEFAULTS,

    AUDIT_DEFAULTS,

    CORS_DEFAULTS,

    RATE_LIMIT_DEFAULTS,

    AUTH_RATE_LIMIT_DEFAULTS,

    FINANCIAL_RATE_LIMIT_DEFAULTS,

    SESSION_DEFAULTS,

    AUTH_DEFAULTS,

    API_DEFAULTS,

    QUEUE_DEFAULTS,

    SOCKET_DEFAULTS,

    LOGGING_DEFAULTS,

    FEATURE_DEFAULTS,

    INFRASTRUCTURE_DEFAULTS,

    IDEMPOTENCY_DEFAULTS,

    FINANCIAL_DEFAULTS,

    COMPLIANCE_DEFAULTS,

    HEALTH_DEFAULTS,

    SHUTDOWN_DEFAULTS,

    /**
     * Helpers.
     */
    getDefault,

    hasDefault,

    getEnvironmentDefaults,

    getSnapshot,

    clone,

    freeze,

    /**
     * Metadata.
     */
    COMPONENT,

    DEFAULT_SERVICE_NAME,

    DEFAULT_APPLICATION_NAME,

    DEFAULT_VERSION,

    DEFAULT_NODE_ENV,

    MIN_NODE_MAJOR,

    ENVIRONMENTS,

    LOG_LEVELS,

    HTTP_METHODS,
  });