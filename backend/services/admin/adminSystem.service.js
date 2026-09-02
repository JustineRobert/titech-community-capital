'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin System Service
 * ============================================================================
 *
 * File:
 *   backend/services/admin/adminSystem.service.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical operational system-management and observability service for
 * TITech Community Capital.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Runtime/system health
 * - Liveness and readiness checks
 * - MongoDB/Mongoose dependency health
 * - Redis/cache dependency health
 * - Queue dependency health
 * - Metrics/observability dependency health
 * - Application/runtime information
 * - Process/resource metrics
 * - Configuration diagnostics without exposing secrets
 * - System capability discovery
 * - Dependency diagnostics
 * - Administrative maintenance metadata
 * - Safe operational metrics snapshots
 *
 * Architectural rules
 * ----------------------------------------------------------------------------
 * 1. This service is READ-ONLY by default.
 * 2. It MUST NOT mutate financial data.
 * 3. It MUST NOT mutate tenant data.
 * 4. It MUST NOT expose secrets, tokens, passwords, credentials or connection
 *    strings.
 * 5. It MUST fail closed when a required dependency is unavailable.
 * 6. Liveness and readiness are distinct concepts.
 * 7. Authorization/RBAC remains the responsibility of controller/middleware.
 * 8. Dependency integrations are injected rather than guessed.
 * 9. Cache/queue/metrics systems are operational dependencies, never financial
 *    sources of truth.
 * 10. All branding uses TITech Community Capital.
 *
 * Compatibility
 * ----------------------------------------------------------------------------
 * - CommonJS
 * - Mongoose
 * - Optional Redis/cache adapters
 * - Optional queue services
 * - Optional metrics services
 * - Optional audit services
 * - Optional event/outbox services
 * - Node.js process/runtime APIs
 *
 * ============================================================================
 */

const os = require('node:os');

const mongoose = require('mongoose');

const logger = require('../../utils/logger');

/**
 * ============================================================================
 * SERVICE METADATA
 * ============================================================================
 */

const SERVICE_NAME =
  'AdminSystemService';

const SERVICE_VERSION =
  '2026.1';

const DEFAULT_APP_NAME =
  'TITech Community Capital';

const DEFAULT_ENVIRONMENT =
  process.env.NODE_ENV ||
  'development';

const DEFAULT_HEALTH_TIMEOUT_MS =
  5000;

const DEFAULT_REDIS_TIMEOUT_MS =
  3000;

const DEFAULT_MEMORY_WARNING_PERCENT =
  85;

const DEFAULT_MEMORY_CRITICAL_PERCENT =
  95;

/**
 * ============================================================================
 * REQUIRED DEPENDENCY STATES
 * ============================================================================
 */

const STATUS = Object.freeze({
  HEALTHY:
    'healthy',

  DEGRADED:
    'degraded',

  UNHEALTHY:
    'unhealthy',

  NOT_CONFIGURED:
    'not_configured',

  UNKNOWN:
    'unknown',
});

/**
 * ============================================================================
 * DOMAIN ERROR
 * ============================================================================
 */

class AdminSystemError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_SYSTEM_ERROR',

      statusCode =
        500,

      cause =
        null,

      details =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminSystemError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.cause =
      cause;

    this.details =
      details;
  }
}

/**
 * ============================================================================
 * GENERIC HELPERS
 * ============================================================================
 */

function safeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const result =
    String(value).trim();

  return result ||
    fallback;
}

function safeInteger(
  value,
  fallback = 0,
) {
  const result =
    Number(value);

  return Number.isFinite(
    result,
  )
    ? result
    : fallback;
}

function round(
  value,
  decimals = 2,
) {
  const factor =
    10 ** decimals;

  return (
    Math.round(
      safeInteger(value) *
        factor,
    ) / factor
  );
}

function nowIso() {
  return new Date().toISOString();
}

function durationMs(
  start,
) {
  return round(
    Number(
      process.hrtime.bigint() -
        start,
    ) / 1_000_000,
    3,
  );
}

function hasFunction(
  target,
  method,
) {
  return Boolean(
    target &&
      typeof target[
        method
      ] === 'function',
  );
}

function redactSecretValue(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'boolean' ||
    typeof value ===
    'number'
  ) {
    return value;
  }

  const stringValue =
    String(value);

  if (
    stringValue.length ===
    0
  ) {
    return '';
  }

  if (
    stringValue.length <= 4
  ) {
    return '***';
  }

  return (
    stringValue.slice(0, 2) +
    '***' +
    stringValue.slice(-2)
  );
}

/**
 * ============================================================================
 * ENVIRONMENT SANITIZATION
 * ============================================================================
 */

const SECRET_ENV_PATTERNS =
  Object.freeze([
    /PASSWORD/i,
    /PASSWD/i,
    /SECRET/i,
    /TOKEN/i,
    /API[_-]?KEY/i,
    /PRIVATE[_-]?KEY/i,
    /ACCESS[_-]?KEY/i,
    /AUTH/i,
    /JWT/i,
    /MONGO.*URI/i,
    /DATABASE.*URL/i,
    /REDIS.*URL/i,
    /CONNECTION.*STRING/i,
    /CLIENT.*SECRET/i,
  ]);

const SAFE_ENV_KEYS =
  Object.freeze([
    'NODE_ENV',
    'PORT',
    'APP_NAME',
    'APP_VERSION',
    'API_VERSION',
    'HOST',
    'TZ',
    'LOG_LEVEL',
    'ENABLE_METRICS',
    'ENABLE_HEALTH_CHECKS',
    'ENABLE_TRACING',
    'ENABLE_REDIS',
    'ENABLE_QUEUE',
    'ENABLE_AUDIT',
    'ENABLE_OUTBOX',
    'REDIS_HOST',
    'REDIS_PORT',
    'QUEUE_NAME',
    'QUEUE_PREFIX',
  ]);

function isSecretEnvironmentKey(
  key,
) {
  return SECRET_ENV_PATTERNS.some(
    (pattern) =>
      pattern.test(
        String(key),
      ),
  );
}

/**
 * Returns operational configuration only.
 *
 * It intentionally does not serialize process.env wholesale.
 */
function getSafeEnvironment() {
  const output = {};

  for (
    const key of SAFE_ENV_KEYS
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        process.env,
        key,
      )
    ) {
      output[key] =
        isSecretEnvironmentKey(
          key,
        )
          ? redactSecretValue(
              process.env[key],
            )
          : process.env[key];
    }
  }

  return output;
}

/**
 * ============================================================================
 * DEPENDENCY HEALTH RESULT
 * ============================================================================
 */

function createCheck(
  name,
  status,
  {
    required = false,
    latencyMs = null,
    message = null,
    details = null,
  } = {},
) {
  return {
    name,

    status,

    required,

    healthy:
      status ===
      STATUS.HEALTHY,

    latencyMs,

    message,

    details,

    checkedAt:
      nowIso(),
  };
}

/**
 * ============================================================================
 * ADMIN SYSTEM SERVICE
 * ============================================================================
 */

class AdminSystemService {
  constructor({
    db =
      null,

    cache =
      null,

    redis =
      null,

    queueService =
      null,

    metricsService =
      null,

    auditService =
      null,

    eventBus =
      null,

    outboxService =
      null,

    featureFlagService =
      null,

    notificationService =
      null,

    loggerInstance =
      logger,

    config =
      {},
  } = {}) {
    this.db =
      db;

    this.cache =
      cache;

    this.redis =
      redis;

    this.queueService =
      queueService;

    this.metricsService =
      metricsService;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.outboxService =
      outboxService;

    this.featureFlagService =
      featureFlagService;

    this.notificationService =
      notificationService;

    this.logger =
      loggerInstance;

    this.config = {
      appName:
        config.appName ||
        process.env.APP_NAME ||
        DEFAULT_APP_NAME,

      environment:
        config.environment ||
        process.env.NODE_ENV ||
        DEFAULT_ENVIRONMENT,

      version:
        config.version ||
        process.env.APP_VERSION ||
        null,

      healthTimeoutMs:
        safeInteger(
          config.healthTimeoutMs,
          DEFAULT_HEALTH_TIMEOUT_MS,
        ),

      redisTimeoutMs:
        safeInteger(
          config.redisTimeoutMs,
          DEFAULT_REDIS_TIMEOUT_MS,
        ),

      memoryWarningPercent:
        safeInteger(
          config.memoryWarningPercent,
          DEFAULT_MEMORY_WARNING_PERCENT,
        ),

      memoryCriticalPercent:
        safeInteger(
          config.memoryCriticalPercent,
          DEFAULT_MEMORY_CRITICAL_PERCENT,
        ),

      requireDatabase:
        config.requireDatabase !==
        false,

      requireRedis:
        config.requireRedis === true,

      requireQueue:
        config.requireQueue === true,

      requireMetrics:
        config.requireMetrics === true,

      requireAudit:
        config.requireAudit === true,

      ...config,
    };
  }

  /**
   * ==========================================================================
   * SYSTEM INFO
   * ==========================================================================
   */

  getSystemInfo() {
    const memory =
      process.memoryUsage();

    const cpu =
      process.cpuUsage();

    return {
      service:
        SERVICE_NAME,

      serviceVersion:
        SERVICE_VERSION,

      application:
        this.config.appName,

      applicationVersion:
        this.config.version,

      environment:
        this.config.environment,

      node: {
        version:
          process.version,

        versions:
          {
            node:
              process.versions.node,

            v8:
              process.versions.v8,

            openssl:
              process.versions.openssl,
          },

        platform:
          process.platform,

        architecture:
          process.arch,
      },

      process: {
        pid:
          process.pid,

        ppid:
          process.ppid,

        uptimeSeconds:
          round(
            process.uptime(),
          ),

        argvCount:
          Array.isArray(
            process.argv,
          )
            ? process.argv.length
            : 0,
      },

      host: {
        hostname:
          os.hostname(),

        platform:
          os.platform(),

        release:
          os.release(),

        architecture:
          os.arch(),

        cpuCount:
          os.cpus().length,

        loadAverage:
          os
            .loadavg()
            .map(
              (value) =>
                round(
                  value,
                  3,
                ),
            ),
      },

      memory: {
        rssBytes:
          memory.rss,

        heapTotalBytes:
          memory.heapTotal,

        heapUsedBytes:
          memory.heapUsed,

        externalBytes:
          memory.external,

        arrayBuffersBytes:
          memory.arrayBuffers ||
          0,

        heapUsedPercent:
          memory.heapTotal
            ? round(
                (
                  memory.heapUsed /
                  memory.heapTotal
                ) *
                  100,
              )
            : 0,
      },

      cpu: {
        userMicros:
          cpu.user,

        systemMicros:
          cpu.system,
      },

      environment:
        getSafeEnvironment(),

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * LIVENESS
   * ==========================================================================
   *
   * Liveness intentionally does not fail because an external dependency is
   * unavailable. A liveness failure generally means the process itself cannot
   * serve correctly.
   * ==========================================================================
   */

  async liveness() {
    const started =
      process.hrtime.bigint();

    const memory =
      process.memoryUsage();

    const heapPercent =
      memory.heapTotal
        ? (
            memory.heapUsed /
            memory.heapTotal
          ) *
          100
        : 0;

    let status =
      STATUS.HEALTHY;

    let reason =
      'Process is alive.';

    if (
      heapPercent >=
      this.config
        .memoryCriticalPercent
    ) {
      status =
        STATUS.DEGRADED;

      reason =
        'Process heap utilization is critically high.';
    }

    return {
      status,

      healthy:
        status !==
        STATUS.UNHEALTHY,

      live:
        true,

      reason,

      latencyMs:
        durationMs(
          started,
        ),

      process: {
        uptimeSeconds:
          round(
            process.uptime(),
          ),

        pid:
          process.pid,
      },

      memory: {
        heapUsedPercent:
          round(
            heapPercent,
          ),

        warningThreshold:
          this.config
            .memoryWarningPercent,

        criticalThreshold:
          this.config
            .memoryCriticalPercent,
      },

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * READINESS
   * ==========================================================================
   *
   * Readiness answers:
   *
   *   "Can this instance safely accept normal application traffic?"
   *
   * Unlike liveness, readiness considers required dependencies.
   * ==========================================================================
   */

  async readiness() {
    const started =
      process.hrtime.bigint();

    const checks =
      await this.runDependencyChecks();

    const requiredFailures =
      checks.filter(
        (check) =>
          check.required &&
          !check.healthy,
      );

    const optionalFailures =
      checks.filter(
        (check) =>
          !check.required &&
          !check.healthy,
      );

    let status =
      STATUS.HEALTHY;

    if (
      requiredFailures.length
    ) {
      status =
        STATUS.UNHEALTHY;
    } else if (
      optionalFailures.length
    ) {
      status =
        STATUS.DEGRADED;
    }

    return {
      status,

      ready:
        status ===
        STATUS.HEALTHY,

      degraded:
        status ===
        STATUS.DEGRADED,

      healthy:
        status ===
        STATUS.HEALTHY,

      checks: {
        total:
          checks.length,

        healthy:
          checks.filter(
            (check) =>
              check.healthy,
          ).length,

        failed:
          checks.filter(
            (check) =>
              !check.healthy,
          ).length,

        requiredFailures:
          requiredFailures.length,

        optionalFailures:
          optionalFailures.length,
      },

      dependencies:
        checks,

      latencyMs:
        durationMs(
          started,
        ),

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * COMPLETE HEALTH
   * ==========================================================================
   */

  async health() {
    const started =
      process.hrtime.bigint();

    const [
      livenessResult,
      readinessResult,
    ] =
      await Promise.all([
        this.liveness(),

        this.readiness(),
      ]);

    let status =
      readinessResult.status;

    if (
      livenessResult.status ===
      STATUS.UNHEALTHY
    ) {
      status =
        STATUS.UNHEALTHY;
    }

    return {
      status,

      healthy:
        status ===
        STATUS.HEALTHY,

      live:
        livenessResult.live,

      ready:
        readinessResult.ready,

      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      environment:
        this.config.environment,

      liveness:
        livenessResult,

      readiness:
        readinessResult,

      latencyMs:
        durationMs(
          started,
        ),

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * DEPENDENCY CHECKS
   * ==========================================================================
   */

  async runDependencyChecks() {
    const checks = [];

    checks.push(
      await this.checkDatabase(),
    );

    checks.push(
      await this.checkCache(),
    );

    checks.push(
      await this.checkRedis(),
    );

    checks.push(
      await this.checkQueue(),
    );

    checks.push(
      await this.checkMetrics(),
    );

    checks.push(
      await this.checkAudit(),
    );

    checks.push(
      await this.checkEventBus(),
    );

    checks.push(
      await this.checkOutbox(),
    );

    return checks;
  }

  /**
   * ==========================================================================
   * MONGODB / MONGOOSE
   * ==========================================================================
   */

  async checkDatabase() {
    const started =
      process.hrtime.bigint();

    try {
      const connection =
        this.resolveMongooseConnection();

      if (!connection) {
        return createCheck(
          'mongodb',
          STATUS.NOT_CONFIGURED,
          {
            required:
              this.config
                .requireDatabase,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'No Mongoose database connection is available to the service.',
          },
        );
      }

      const readyState =
        connection.readyState;

      /**
       * Mongoose states:
       *   0 disconnected
       *   1 connected
       *   2 connecting
       *   3 disconnecting
       */

      if (
        readyState === 1
      ) {
        return createCheck(
          'mongodb',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireDatabase,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'MongoDB connection is ready.',

            details: {
              readyState,
              host:
                connection.host ||
                null,

              port:
                connection.port ||
                null,

              name:
                connection.name ||
                null,
            },
          },
        );
      }

      if (
        readyState === 2
      ) {
        return createCheck(
          'mongodb',
          STATUS.DEGRADED,
          {
            required:
              this.config
                .requireDatabase,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'MongoDB connection is still establishing.',

            details: {
              readyState,
            },
          },
        );
      }

      return createCheck(
        'mongodb',
        STATUS.UNHEALTHY,
        {
          required:
            this.config
              .requireDatabase,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'MongoDB is not connected.',

          details: {
            readyState,
          },
        },
      );
    } catch (error) {
      this.logError(
        'MongoDB health check failed.',
        error,
      );

      return createCheck(
        'mongodb',
        STATUS.UNHEALTHY,
        {
          required:
            this.config
              .requireDatabase,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'MongoDB health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  resolveMongooseConnection() {
    if (
      this.db &&
      this.db.connection
    ) {
      return this.db.connection;
    }

    if (
      this.db &&
      typeof
        this.db.readyState ===
        'number'
    ) {
      return this.db;
    }

    if (
      mongoose.connection
    ) {
      return mongoose.connection;
    }

    return null;
  }

  /**
   * ==========================================================================
   * CACHE
   * ==========================================================================
   */

  async checkCache() {
    const started =
      process.hrtime.bigint();

    if (!this.cache) {
      return createCheck(
        'cache',
        STATUS.NOT_CONFIGURED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'No cache service is configured.',
        },
      );
    }

    try {
      /**
       * Preferred contract:
       *   health()
       */
      if (
        hasFunction(
          this.cache,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.cache.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'cache',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Cache is healthy.'
                : 'Cache health is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      /**
       * Redis-like contract.
       */
      if (
        hasFunction(
          this.cache,
          'ping',
        )
      ) {
        const result =
          await this.withTimeout(
            this.cache.ping(),
            this.config
              .healthTimeoutMs,
          );

        return createCheck(
          'cache',
          STATUS.HEALTHY,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Cache responded successfully.',

            details: {
              response:
                typeof result ===
                'string'
                  ? result
                  : 'ok',
            },
          },
        );
      }

      return createCheck(
        'cache',
        STATUS.UNKNOWN,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Cache is configured but exposes no recognized health contract.',
        },
      );
    } catch (error) {
      this.logWarn(
        'Cache health check failed.',
        {
          error:
            error?.message,
        },
      );

      return createCheck(
        'cache',
        STATUS.DEGRADED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Cache is unavailable or degraded.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * REDIS
   * ==========================================================================
   */

  async checkRedis() {
    const started =
      process.hrtime.bigint();

    const dependency =
      this.redis ||
      this.cache;

    if (!dependency) {
      return createCheck(
        'redis',
        STATUS.NOT_CONFIGURED,
        {
          required:
            this.config
              .requireRedis,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Redis client is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          dependency,
          'ping',
        )
      ) {
        const response =
          await this.withTimeout(
            dependency.ping(),
            this.config
              .redisTimeoutMs,
          );

        const healthy =
          response ===
          'PONG' ||
          response ===
          'pong' ||
          response ===
          true ||
          response ===
          undefined;

        return createCheck(
          'redis',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              this.config
                .requireRedis,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Redis is responding.'
                : 'Redis returned an unexpected health response.',

            details: {
              response:
                typeof response ===
                'string'
                  ? response
                  : typeof response,
            },
          },
        );
      }

      if (
        dependency.isReady ===
        true
      ) {
        return createCheck(
          'redis',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireRedis,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Redis client reports ready state.',
          },
        );
      }

      if (
        dependency.status ===
        'ready' ||
        dependency.status ===
        'connected'
      ) {
        return createCheck(
          'redis',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireRedis,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Redis client reports connected state.',

            details: {
              status:
                dependency.status,
            },
          },
        );
      }

      return createCheck(
        'redis',
        STATUS.UNKNOWN,
        {
          required:
            this.config
              .requireRedis,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Redis is configured but no supported health contract was found.',
        },
      );
    } catch (error) {
      return createCheck(
        'redis',
        this.config
          .requireRedis
          ? STATUS.UNHEALTHY
          : STATUS.DEGRADED,
        {
          required:
            this.config
              .requireRedis,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Redis health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * QUEUE
   * ==========================================================================
   */

  async checkQueue() {
    const started =
      process.hrtime.bigint();

    if (!this.queueService) {
      return createCheck(
        'queue',
        STATUS.NOT_CONFIGURED,
        {
          required:
            this.config
              .requireQueue,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Queue service is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          this.queueService,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.queueService.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'queue',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              this.config
                .requireQueue,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Queue service is healthy.'
                : 'Queue service is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      if (
        hasFunction(
          this.queueService,
          'ping',
        )
      ) {
        await this.withTimeout(
          this.queueService.ping(),
          this.config
            .healthTimeoutMs,
        );

        return createCheck(
          'queue',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireQueue,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Queue service responded successfully.',
          },
        );
      }

      if (
        this.queueService
          .isReady ===
          true
      ) {
        return createCheck(
          'queue',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireQueue,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Queue service reports ready state.',
          },
        );
      }

      return createCheck(
        'queue',
        STATUS.UNKNOWN,
        {
          required:
            this.config
              .requireQueue,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Queue service does not expose a recognized health contract.',
        },
      );
    } catch (error) {
      return createCheck(
        'queue',
        this.config
          .requireQueue
          ? STATUS.UNHEALTHY
          : STATUS.DEGRADED,
        {
          required:
            this.config
              .requireQueue,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Queue service health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * METRICS SERVICE
   * ==========================================================================
   */

  async checkMetrics() {
    const started =
      process.hrtime.bigint();

    if (!this.metricsService) {
      return createCheck(
        'metrics',
        STATUS.NOT_CONFIGURED,
        {
          required:
            this.config
              .requireMetrics,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Metrics service is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          this.metricsService,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.metricsService.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'metrics',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              this.config
                .requireMetrics,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Metrics service is healthy.'
                : 'Metrics service is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      if (
        hasFunction(
          this.metricsService,
          'getMetrics',
        )
      ) {
        await this.withTimeout(
          this.metricsService.getMetrics(),
          this.config
            .healthTimeoutMs,
        );

        return createCheck(
          'metrics',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireMetrics,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Metrics service responded successfully.',
          },
        );
      }

      return createCheck(
        'metrics',
        STATUS.UNKNOWN,
        {
          required:
            this.config
              .requireMetrics,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Metrics service does not expose a supported health contract.',
        },
      );
    } catch (error) {
      return createCheck(
        'metrics',
        this.config
          .requireMetrics
          ? STATUS.UNHEALTHY
          : STATUS.DEGRADED,
        {
          required:
            this.config
              .requireMetrics,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Metrics service health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async checkAudit() {
    const started =
      process.hrtime.bigint();

    if (!this.auditService) {
      return createCheck(
        'audit',
        STATUS.NOT_CONFIGURED,
        {
          required:
            this.config
              .requireAudit,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Audit service is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          this.auditService,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.auditService.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'audit',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              this.config
                .requireAudit,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Audit service is healthy.'
                : 'Audit service is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      if (
        hasFunction(
          this.auditService,
          'log',
        )
      ) {
        return createCheck(
          'audit',
          STATUS.HEALTHY,
          {
            required:
              this.config
                .requireAudit,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Audit service is configured.',
          },
        );
      }

      return createCheck(
        'audit',
        STATUS.UNKNOWN,
        {
          required:
            this.config
              .requireAudit,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Audit service lacks a recognized health contract.',
        },
      );
    } catch (error) {
      return createCheck(
        'audit',
        this.config
          .requireAudit
          ? STATUS.UNHEALTHY
          : STATUS.DEGRADED,
        {
          required:
            this.config
              .requireAudit,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Audit service health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * EVENT BUS
   * ==========================================================================
   */

  async checkEventBus() {
    const started =
      process.hrtime.bigint();

    if (!this.eventBus) {
      return createCheck(
        'eventBus',
        STATUS.NOT_CONFIGURED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Event bus is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          this.eventBus,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.eventBus.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'eventBus',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Event bus is healthy.'
                : 'Event bus is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      if (
        hasFunction(
          this.eventBus,
          'publish',
        ) ||
        hasFunction(
          this.eventBus,
          'emit',
        )
      ) {
        return createCheck(
          'eventBus',
          STATUS.HEALTHY,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Event bus is configured.',
          },
        );
      }

      return createCheck(
        'eventBus',
        STATUS.UNKNOWN,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Event bus has no recognized health contract.',
        },
      );
    } catch (error) {
      return createCheck(
        'eventBus',
        STATUS.DEGRADED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Event bus health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * OUTBOX
   * ==========================================================================
   */

  async checkOutbox() {
    const started =
      process.hrtime.bigint();

    if (!this.outboxService) {
      return createCheck(
        'outbox',
        STATUS.NOT_CONFIGURED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Outbox service is not configured.',
        },
      );
    }

    try {
      if (
        hasFunction(
          this.outboxService,
          'health',
        )
      ) {
        const result =
          await this.withTimeout(
            this.outboxService.health(),
            this.config
              .healthTimeoutMs,
          );

        const healthy =
          result === true ||
          result?.healthy === true ||
          result?.status ===
            'healthy';

        return createCheck(
          'outbox',
          healthy
            ? STATUS.HEALTHY
            : STATUS.DEGRADED,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              healthy
                ? 'Outbox service is healthy.'
                : 'Outbox service is degraded.',

            details:
              this.sanitizeOperationalObject(
                result,
              ),
          },
        );
      }

      if (
        hasFunction(
          this.outboxService,
          'enqueue',
        ) ||
        hasFunction(
          this.outboxService,
          'publish',
        )
      ) {
        return createCheck(
          'outbox',
          STATUS.HEALTHY,
          {
            required:
              false,

            latencyMs:
              durationMs(
                started,
              ),

            message:
              'Outbox service is configured.',
          },
        );
      }

      return createCheck(
        'outbox',
        STATUS.UNKNOWN,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Outbox service has no recognized health contract.',
        },
      );
    } catch (error) {
      return createCheck(
        'outbox',
        STATUS.DEGRADED,
        {
          required:
            false,

          latencyMs:
            durationMs(
              started,
            ),

          message:
            'Outbox service health check failed.',

          details:
            this.serializeError(
              error,
            ),
        },
      );
    }
  }

  /**
   * ==========================================================================
   * DEPENDENCY MATRIX
   * ==========================================================================
   */

  async dependencyMatrix() {
    const checks =
      await this.runDependencyChecks();

    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      generatedAt:
        nowIso(),

      dependencies:
        checks.map(
          (check) => ({
            name:
              check.name,

            status:
              check.status,

            required:
              check.required,

            healthy:
              check.healthy,

            latencyMs:
              check.latencyMs,

            message:
              check.message,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * RUNTIME METRICS
   * ==========================================================================
   */

  getRuntimeMetrics() {
    const memory =
      process.memoryUsage();

    const cpu =
      process.cpuUsage();

    const load =
      os.loadavg();

    const totalMemory =
      os.totalmem();

    const freeMemory =
      os.freemem();

    const usedMemory =
      Math.max(
        0,
        totalMemory -
          freeMemory,
      );

    const systemMemoryPercent =
      totalMemory
        ? (
            usedMemory /
            totalMemory
          ) *
          100
        : 0;

    const heapPercent =
      memory.heapTotal
        ? (
            memory.heapUsed /
            memory.heapTotal
          ) *
          100
        : 0;

    let resourceStatus =
      STATUS.HEALTHY;

    if (
      heapPercent >=
        this.config
          .memoryCriticalPercent ||
      systemMemoryPercent >=
        this.config
          .memoryCriticalPercent
    ) {
      resourceStatus =
        STATUS.UNHEALTHY;
    } else if (
      heapPercent >=
        this.config
          .memoryWarningPercent ||
      systemMemoryPercent >=
        this.config
          .memoryWarningPercent
    ) {
      resourceStatus =
        STATUS.DEGRADED;
    }

    return {
      status:
        resourceStatus,

      process: {
        uptimeSeconds:
          round(
            process.uptime(),
          ),

        pid:
          process.pid,

        ppid:
          process.ppid,
      },

      memory: {
        process: {
          rssBytes:
            memory.rss,

          heapTotalBytes:
            memory.heapTotal,

          heapUsedBytes:
            memory.heapUsed,

          externalBytes:
            memory.external,

          arrayBuffersBytes:
            memory.arrayBuffers ||
            0,

          heapUsedPercent:
            round(
              heapPercent,
            ),
        },

        system: {
          totalBytes:
            totalMemory,

          freeBytes:
            freeMemory,

          usedBytes:
            usedMemory,

          usedPercent:
            round(
              systemMemoryPercent,
            ),
        },

        thresholds: {
          warningPercent:
            this.config
              .memoryWarningPercent,

          criticalPercent:
            this.config
              .memoryCriticalPercent,
        },
      },

      cpu: {
        processUserMicros:
          cpu.user,

        processSystemMicros:
          cpu.system,

        loadAverage:
          {
            oneMinute:
              round(
                load[0],
                3,
              ),

            fiveMinutes:
              round(
                load[1],
                3,
              ),

            fifteenMinutes:
              round(
                load[2],
                3,
              ),
          },
      },

      os: {
        cpuCount:
          os.cpus().length,

        platform:
          os.platform(),

        release:
          os.release(),

        architecture:
          os.arch(),
      },

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * CONNECTION INFORMATION
   * ==========================================================================
   *
   * Only operational metadata is exposed. Passwords/credentials/connection
   * strings are never returned.
   * ==========================================================================
   */

  getDatabaseInfo() {
    const connection =
      this.resolveMongooseConnection();

    if (!connection) {
      return {
        configured:
          false,

        status:
          STATUS.NOT_CONFIGURED,
      };
    }

    return {
      configured:
        true,

      status:
        this.mapMongooseReadyState(
          connection.readyState,
        ),

      readyState:
        connection.readyState,

      host:
        connection.host ||
        null,

      port:
        connection.port ||
        null,

      database:
        connection.name ||
        null,

      driver:
        connection.client
          ?.s?.options
          ?.driverInfo
          ?.name ||
        'mongoose',
    };
  }

  mapMongooseReadyState(
    readyState,
  ) {
    switch (
      readyState
    ) {
      case 1:
        return STATUS.HEALTHY;

      case 2:
        return STATUS.DEGRADED;

      case 0:
      case 3:
        return STATUS.UNHEALTHY;

      default:
        return STATUS.UNKNOWN;
    }
  }

  /**
   * ==========================================================================
   * CAPABILITIES
   * ==========================================================================
   */

  getCapabilities() {
    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      capabilities: {
        databaseHealth:
          Boolean(
            this.resolveMongooseConnection(),
          ),

        cacheHealth:
          Boolean(
            this.cache,
          ),

        redisHealth:
          Boolean(
            this.redis ||
              this.cache,
          ),

        queueHealth:
          Boolean(
            this.queueService,
          ),

        metricsHealth:
          Boolean(
            this.metricsService,
          ),

        auditIntegration:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),

        durableOutbox:
          Boolean(
            this.outboxService,
          ),

        featureFlags:
          Boolean(
            this.featureFlagService,
          ),

        notifications:
          Boolean(
            this.notificationService,
          ),
      },

      report:
        {
          service:
            'adminReports.service.js',

          supported:
            true,
        },

      audit:
        {
          service:
            'adminAudit.service.js',

          supported:
            true,
        },

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * OPERATIONAL SNAPSHOT
   * ==========================================================================
   */

  async getOperationalSnapshot() {
    const started =
      process.hrtime.bigint();

    const [
      health,
      runtime,
      dependencies,
    ] =
      await Promise.all([
        this.health(),

        Promise.resolve(
          this.getRuntimeMetrics(),
        ),

        this.dependencyMatrix(),
      ]);

    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      application:
        this.config.appName,

      environment:
        this.config.environment,

      health,

      runtime,

      dependencies,

      database:
        this.getDatabaseInfo(),

      capabilities:
        this.getCapabilities(),

      generatedAt:
        nowIso(),

      latencyMs:
        durationMs(
          started,
        ),
    };
  }

  /**
   * ==========================================================================
   * SYSTEM CONFIGURATION DIAGNOSTICS
   * ==========================================================================
   */

  getConfigurationDiagnostics() {
    const warnings = [];

    const recommendations = [];

    const environment =
      this.config.environment;

    if (
      environment ===
      'production'
    ) {
      if (
        !process.env
          .APP_VERSION
      ) {
        warnings.push(
          'APP_VERSION is not explicitly configured.',
        );
      }

      if (
        !process.env
          .LOG_LEVEL
      ) {
        warnings.push(
          'LOG_LEVEL is not explicitly configured for production.',
        );
      }

      if (
        !this.metricsService
      ) {
        warnings.push(
          'Metrics service is not configured.',
        );
      }

      if (
        !this.auditService
      ) {
        warnings.push(
          'Audit service is not configured.',
        );
      }

      if (
        !this.outboxService
      ) {
        recommendations.push(
          'Configure a durable outbox for transactional domain-event delivery.',
        );
      }

      if (
        !this.redis &&
        !this.cache
      ) {
        recommendations.push(
          'Configure Redis/cache infrastructure before production horizontal scaling.',
        );
      }
    }

    if (
      this.config
        .requireQueue &&
      !this.queueService
    ) {
      warnings.push(
        'Queue service is required by configuration but is not configured.',
      );
    }

    if (
      this.config
        .requireDatabase &&
      !this.resolveMongooseConnection()
    ) {
      warnings.push(
        'Database is required by configuration but no database connection is available.',
      );
    }

    return {
      valid:
        warnings.length ===
        0,

      warnings,

      recommendations,

      configuration: {
        application:
          this.config.appName,

        environment:
          this.config.environment,

        version:
          this.config.version,

        requireDatabase:
          this.config
            .requireDatabase,

        requireRedis:
          this.config
            .requireRedis,

        requireQueue:
          this.config
            .requireQueue,

        requireMetrics:
          this.config
            .requireMetrics,

        requireAudit:
          this.config
            .requireAudit,
      },

      checkedAt:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * MAINTENANCE MODE STATE
   * ==========================================================================
   *
   * Read-only inspection of environment-controlled maintenance mode.
   *
   * The service intentionally does not mutate process.env or application
   * configuration at runtime.
   * ==========================================================================
   */

  getMaintenanceState() {
    const enabledRaw =
      process.env
        .MAINTENANCE_MODE;

    const enabled =
      String(
        enabledRaw ||
          '',
      )
        .trim()
        .toLowerCase();

    const isEnabled =
      [
        '1',
        'true',
        'yes',
        'on',
      ].includes(
        enabled,
      );

    return {
      enabled:
        isEnabled,

      reason:
        process.env
          .MAINTENANCE_REASON ||
        null,

      scheduledAt:
        process.env
          .MAINTENANCE_SCHEDULED_AT ||
        null,

      timestamp:
        nowIso(),
    };
  }

  /**
   * ==========================================================================
   * ADMIN SYSTEM DASHBOARD
   * ==========================================================================
   */

  async getDashboard() {
    return this.getOperationalSnapshot();
  }

  /**
   * ==========================================================================
   * TIMEOUT
   * ==========================================================================
   */

  async withTimeout(
    promise,
    timeoutMs,
  ) {
    const timeout =
      Math.max(
        1,
        safeInteger(
          timeoutMs,
          DEFAULT_HEALTH_TIMEOUT_MS,
        ),
      );

    let timer;

    const timeoutPromise =
      new Promise(
        (
          _resolve,
          reject,
        ) => {
          timer =
            setTimeout(
              () => {
                reject(
                  new AdminSystemError(
                    'System dependency health check timed out.',
                    {
                      code:
                        'DEPENDENCY_TIMEOUT',

                      statusCode:
                        504,
                    },
                  ),
                );
              },
              timeout,
            );
        },
      );

    try {
      return await Promise.race(
        [
          Promise.resolve(
            promise,
          ),
          timeoutPromise,
        ],
      );
    } finally {
      clearTimeout(
        timer,
      );
    }
  }

  /**
   * ==========================================================================
   * OPERATIONAL OBJECT SANITIZER
   * ==========================================================================
   */

  sanitizeOperationalObject(
    value,
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof value ===
      'string'
    ) {
      return value;
    }

    if (
      Array.isArray(value)
    ) {
      return value.map(
        (item) =>
          this.sanitizeOperationalObject(
            item,
          ),
      );
    }

    if (
      typeof value !==
      'object'
    ) {
      return value;
    }

    const result =
      {};

    for (
      const [
        key,
        child,
      ] of Object.entries(
        value,
      )
    ) {
      const normalizedKey =
        String(key)
          .replace(
            /[-_\s]/g,
            '',
          )
          .toLowerCase();

      if (
        [
          'password',
          'secret',
          'token',
          'authorization',
          'cookie',
          'apikey',
          'privatekey',
          'connectionstring',
          'databaseurl',
          'mongouri',
          'redisurl',
          'clientsecret',
        ].includes(
          normalizedKey,
        )
      ) {
        result[key] =
          '[REDACTED]';

        continue;
      }

      result[key] =
        this.sanitizeOperationalObject(
          child,
        );
    }

    return result;
  }

  /**
   * ==========================================================================
   * ERROR SERIALIZATION
   * ==========================================================================
   */

  serializeError(
    error,
  ) {
    if (!error) {
      return null;
    }

    return {
      name:
        error.name ||
        'Error',

      message:
        error.message ||
        'Unknown error',

      code:
        error.code ||
        null,

      statusCode:
        error.statusCode ||
        null,
    };
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  logInfo(
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof
          this.logger.info ===
          'function'
      ) {
        this.logger.info(
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            ...metadata,
          },
        );
      }
    } catch {
      // Never fail system management because logging failed.
    }
  }

  logWarn(
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof
          this.logger.warn ===
          'function'
      ) {
        this.logger.warn(
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            ...metadata,
          },
        );
      }
    } catch {
      // Never fail system management because logging failed.
    }
  }

  logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof
          this.logger.error ===
          'function'
      ) {
        this.logger.error(
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            ...metadata,

            error:
              this.serializeError(
                error,
              ),
          },
        );
      }
    } catch {
      // Never fail system management because logging failed.
    }
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 *
 * The default instance remains dependency-light and safe to import.
 *
 * Production bootstrap code can instantiate AdminSystemService with the actual
 * db/cache/queue/metrics dependencies:
 *
 *   new AdminSystemService({
 *     db,
 *     cache,
 *     redis,
 *     queueService,
 *     metricsService,
 *     auditService,
 *     eventBus,
 *     outboxService,
 *   });
 *
 * ============================================================================
 */

const adminSystemService =
  new AdminSystemService();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminSystemService;

module.exports.AdminSystemService =
  AdminSystemService;

module.exports.AdminSystemError =
  AdminSystemError;

module.exports.STATUS =
  STATUS;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SERVICE_VERSION =
  SERVICE_VERSION;