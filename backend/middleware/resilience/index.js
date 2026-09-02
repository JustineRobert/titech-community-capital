'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/middleware/resilience/index.js
 *
 * Purpose:
 *   Canonical enterprise resilience subsystem for the TITech Community
 *   Capital backend.
 *
 * Responsibilities:
 *   - Provide the canonical resilience implementation consumed by
 *     bootstrap/resilience.js.
 *   - Provide deterministic initialize/start/shutdown/stop lifecycle.
 *   - Provide readiness and health reporting.
 *   - Provide circuit breakers using Opossum when available.
 *   - Provide bounded retry with exponential backoff and jitter.
 *   - Provide execution timeouts.
 *   - Provide concurrency/bulkhead protection.
 *   - Provide local rate limiting.
 *   - Provide middleware integration for HTTP services.
 *   - Provide operational diagnostics and snapshots.
 *   - Provide safe configuration normalization.
 *   - Fail closed for financial/ledger operations by default.
 *   - Avoid business-logic ownership.
 *
 * IMPORTANT:
 *
 *   This module is infrastructure.
 *
 *   It MUST NOT:
 *     - mutate financial balances;
 *     - retry non-idempotent financial operations blindly;
 *     - manufacture successful financial responses;
 *     - swallow ledger errors;
 *     - implement payment settlement logic;
 *     - implement loan decisions;
 *     - implement KYC decisions;
 *     - own database transactions.
 *
 * Canonical lifecycle:
 *
 *   bootstrap/resilience.js
 *             ↓
 *   middleware/resilience/index.js
 *             ↓
 *       ResilienceManager
 *             ↓
 *   ┌─────────┼──────────┬────────────┬────────────┐
 *   ↓         ↓          ↓            ↓            ↓
 * Circuit   Retry      Timeout     Bulkhead    Rate Limit
 * Breaker
 *
 * Design principles:
 *   - deterministic;
 *   - observable;
 *   - bounded;
 *   - fail-safe;
 *   - idempotency-aware;
 *   - financial-operation-aware;
 *   - shutdown-safe;
 *   - testable;
 *   - dependency-light;
 *
 * =============================================================================
 */

const COMPONENT = 'resilience';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const VERSION =
  process.env.npm_package_version ||
  '0.0.0';

const DEFAULTS = Object.freeze({
  enabled: true,

  timeoutMs: 30_000,

  retry: Object.freeze({
    enabled: true,
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 5_000,
    jitter: 0.20,
  }),

  circuitBreaker: Object.freeze({
    enabled: true,
    timeoutMs: 30_000,
    errorThresholdPercentage: 50,
    resetTimeoutMs: 30_000,
    rollingCountTimeoutMs: 10_000,
    rollingCountBuckets: 10,
    volumeThreshold: 10,
  }),

  bulkhead: Object.freeze({
    enabled: true,
    maxConcurrent: 50,
    maxQueue: 100,
  }),

  rateLimit: Object.freeze({
    enabled: true,
    points: 100,
    durationSeconds: 60,
    blockDurationSeconds: 60,
  }),

  readiness: Object.freeze({
    required: true,
    timeoutMs: 5_000,
  }),

  shutdown: Object.freeze({
    timeoutMs: 10_000,
  }),
});

const STATE = {
  createdAt: new Date().toISOString(),

  initializedAt: null,

  startedAt: null,

  stoppedAt: null,

  status: 'created',

  enabled: true,

  degraded: false,

  failed: false,

  acceptingWork: false,

  implementationReady: false,

  lastError: null,

  counters: {
    executions: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    timeouts: 0,
    rejected: 0,
    circuitOpen: 0,
    rateLimited: 0,
    bulkheadRejected: 0,
  },
};

const breakerRegistry = new Map();
const limiterRegistry = new Map();

let configuration = deepFreeze({
  ...DEFAULTS,
});

let logger = null;
let metrics = null;
let initialized = false;
let started = false;
let stopped = false;

let initializePromise = null;
let shutdownPromise = null;

let OpossumBreaker = null;
let RateLimiterMemory = null;

loadOptionalDependencies();

/**
 * =============================================================================
 * Optional Dependency Loading
 * =============================================================================
 *
 * The resilience subsystem must be able to boot even when optional providers
 * are unavailable. This is deliberately different from silently disabling
 * resilience itself.
 *
 * The core resilience primitives implemented below do not require external
 * dependencies.
 * =============================================================================
 */

function loadOptionalDependencies() {
  try {
    // eslint-disable-next-line global-require
    const loaded = require('opossum');

    if (typeof loaded === 'function') {
      OpossumBreaker = loaded;
    } else if (typeof loaded?.default === 'function') {
      OpossumBreaker = loaded.default;
    }
  } catch {
    OpossumBreaker = null;
  }

  try {
    // eslint-disable-next-line global-require
    const loaded = require('rate-limiter-flexible');

    if (typeof loaded?.RateLimiterMemory === 'function') {
      RateLimiterMemory = loaded.RateLimiterMemory;
    }
  } catch {
    RateLimiterMemory = null;
  }
}

/**
 * =============================================================================
 * Environment / Configuration
 * =============================================================================
 */

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return [
    '1',
    'true',
    'yes',
    'y',
    'on',
    'enabled',
  ].includes(
    String(value).trim().toLowerCase(),
  );
}

function parseNumber(value, fallback, options = {}) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const minimum =
    Number.isFinite(options.min)
      ? options.min
      : -Infinity;

  const maximum =
    Number.isFinite(options.max)
      ? options.max
      : Infinity;

  return Math.min(
    Math.max(numeric, minimum),
    maximum,
  );
}

function resolveEnvironmentConfiguration(context = {}) {
  const config =
    context?.config?.resilience ||
    context?.config?.infrastructure?.resilience ||
    {};

  const env =
    context?.environment?.resilience ||
    {};

  const enabled = parseBoolean(
    config.enabled ??
      env.enabled ??
      process.env.RESILIENCE_ENABLED,
    DEFAULTS.enabled,
  );

  return deepFreeze({
    enabled,

    timeoutMs: parseNumber(
      config.timeoutMs ??
        process.env.RESILIENCE_TIMEOUT_MS,
      DEFAULTS.timeoutMs,
      {
        min: 100,
        max: 120_000,
      },
    ),

    retry: {
      enabled: parseBoolean(
        config.retry?.enabled ??
          process.env.RESILIENCE_RETRY_ENABLED,
        DEFAULTS.retry.enabled,
      ),

      maxAttempts: parseNumber(
        config.retry?.maxAttempts ??
          process.env.RESILIENCE_RETRY_MAX_ATTEMPTS,
        DEFAULTS.retry.maxAttempts,
        {
          min: 1,
          max: 10,
        },
      ),

      baseDelayMs: parseNumber(
        config.retry?.baseDelayMs ??
          process.env.RESILIENCE_RETRY_BASE_DELAY_MS,
        DEFAULTS.retry.baseDelayMs,
        {
          min: 10,
          max: 30_000,
        },
      ),

      maxDelayMs: parseNumber(
        config.retry?.maxDelayMs ??
          process.env.RESILIENCE_RETRY_MAX_DELAY_MS,
        DEFAULTS.retry.maxDelayMs,
        {
          min: 10,
          max: 120_000,
        },
      ),

      jitter: parseNumber(
        config.retry?.jitter ??
          process.env.RESILIENCE_RETRY_JITTER,
        DEFAULTS.retry.jitter,
        {
          min: 0,
          max: 1,
        },
      ),
    },

    circuitBreaker: {
      enabled: parseBoolean(
        config.circuitBreaker?.enabled ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_ENABLED,
        DEFAULTS.circuitBreaker.enabled,
      ),

      timeoutMs: parseNumber(
        config.circuitBreaker?.timeoutMs ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_TIMEOUT_MS,
        DEFAULTS.circuitBreaker.timeoutMs,
        {
          min: 100,
          max: 120_000,
        },
      ),

      errorThresholdPercentage: parseNumber(
        config.circuitBreaker?.errorThresholdPercentage ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_ERROR_THRESHOLD,
        DEFAULTS.circuitBreaker.errorThresholdPercentage,
        {
          min: 1,
          max: 100,
        },
      ),

      resetTimeoutMs: parseNumber(
        config.circuitBreaker?.resetTimeoutMs ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
        DEFAULTS.circuitBreaker.resetTimeoutMs,
        {
          min: 100,
          max: 600_000,
        },
      ),

      rollingCountTimeoutMs: parseNumber(
        config.circuitBreaker?.rollingCountTimeoutMs ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_ROLLING_TIMEOUT_MS,
        DEFAULTS.circuitBreaker.rollingCountTimeoutMs,
        {
          min: 1_000,
          max: 300_000,
        },
      ),

      rollingCountBuckets: parseNumber(
        config.circuitBreaker?.rollingCountBuckets ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_BUCKETS,
        DEFAULTS.circuitBreaker.rollingCountBuckets,
        {
          min: 2,
          max: 60,
        },
      ),

      volumeThreshold: parseNumber(
        config.circuitBreaker?.volumeThreshold ??
          process.env.RESILIENCE_CIRCUIT_BREAKER_VOLUME_THRESHOLD,
        DEFAULTS.circuitBreaker.volumeThreshold,
        {
          min: 1,
          max: 10_000,
        },
      ),
    },

    bulkhead: {
      enabled: parseBoolean(
        config.bulkhead?.enabled ??
          process.env.RESILIENCE_BULKHEAD_ENABLED,
        DEFAULTS.bulkhead.enabled,
      ),

      maxConcurrent: parseNumber(
        config.bulkhead?.maxConcurrent ??
          process.env.RESILIENCE_BULKHEAD_MAX_CONCURRENT,
        DEFAULTS.bulkhead.maxConcurrent,
        {
          min: 1,
          max: 10_000,
        },
      ),

      maxQueue: parseNumber(
        config.bulkhead?.maxQueue ??
          process.env.RESILIENCE_BULKHEAD_MAX_QUEUE,
        DEFAULTS.bulkhead.maxQueue,
        {
          min: 0,
          max: 100_000,
        },
      ),
    },

    rateLimit: {
      enabled: parseBoolean(
        config.rateLimit?.enabled ??
          process.env.RESILIENCE_RATE_LIMIT_ENABLED,
        DEFAULTS.rateLimit.enabled,
      ),

      points: parseNumber(
        config.rateLimit?.points ??
          process.env.RESILIENCE_RATE_LIMIT_POINTS,
        DEFAULTS.rateLimit.points,
        {
          min: 1,
          max: 1_000_000,
        },
      ),

      durationSeconds: parseNumber(
        config.rateLimit?.durationSeconds ??
          process.env.RESILIENCE_RATE_LIMIT_DURATION_SECONDS,
        DEFAULTS.rateLimit.durationSeconds,
        {
          min: 1,
          max: 86_400,
        },
      ),

      blockDurationSeconds: parseNumber(
        config.rateLimit?.blockDurationSeconds ??
          process.env.RESILIENCE_RATE_LIMIT_BLOCK_DURATION_SECONDS,
        DEFAULTS.rateLimit.blockDurationSeconds,
        {
          min: 0,
          max: 86_400,
        },
      ),
    },

    readiness: {
      required: parseBoolean(
        config.readiness?.required,
        DEFAULTS.readiness.required,
      ),

      timeoutMs: parseNumber(
        config.readiness?.timeoutMs ??
          process.env.RESILIENCE_READINESS_TIMEOUT_MS,
        DEFAULTS.readiness.timeoutMs,
        {
          min: 100,
          max: 60_000,
        },
      ),
    },

    shutdown: {
      timeoutMs: parseNumber(
        config.shutdown?.timeoutMs ??
          process.env.RESILIENCE_SHUTDOWN_TIMEOUT_MS,
        DEFAULTS.shutdown.timeoutMs,
        {
          min: 100,
          max: 120_000,
        },
      ),
    },
  });
}

/**
 * =============================================================================
 * Logging
 * =============================================================================
 */

function resolveLogger(context = {}) {
  return (
    context.logger ||
    context.log ||
    context.observability?.logger ||
    null
  );
}

function log(level, message, metadata = {}) {
  const payload = {
    component: COMPONENT,
    service: SERVICE_NAME,
    ...metadata,
  };

  try {
    if (
      logger &&
      typeof logger[level] === 'function'
    ) {
      logger[level](payload, message);
      return;
    }

    if (
      logger &&
      typeof logger.log === 'function'
    ) {
      logger.log(level, message, payload);
      return;
    }
  } catch {
    // Logging must never break resilience.
  }

  if (
    process.env.NODE_ENV === 'test'
  ) {
    return;
  }

  if (level === 'error') {
    console.error(
      `[${COMPONENT}] ${message}`,
      payload,
    );
  } else if (level === 'warn') {
    console.warn(
      `[${COMPONENT}] ${message}`,
      payload,
    );
  } else if (process.env.RESILIENCE_DEBUG === 'true') {
    console.info(
      `[${COMPONENT}] ${message}`,
      payload,
    );
  }
}

/**
 * =============================================================================
 * Observability
 * =============================================================================
 */

function resolveMetrics(context = {}) {
  return (
    context.metrics ||
    context.observability?.metrics ||
    null
  );
}

function incrementMetric(name, value = 1) {
  try {
    if (!metrics) {
      return;
    }

    if (
      typeof metrics.increment === 'function'
    ) {
      metrics.increment(
        `titech_resilience_${name}`,
        value,
      );
      return;
    }

    if (
      typeof metrics.inc === 'function'
    ) {
      metrics.inc(
        `titech_resilience_${name}`,
        value,
      );
    }
  } catch {
    // Metrics must never break resilience.
  }
}

function emitEvent(event, metadata = {}) {
  const payload = {
    component: COMPONENT,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    ...metadata,
  };

  try {
    if (
      logger &&
      typeof logger.info === 'function'
    ) {
      logger.info(
        payload,
        `resilience.${event}`,
      );
    }
  } catch {
    // Ignore observability failures.
  }

  try {
    const telemetry =
      globalThis.__TITECH_OBSERVABILITY__;

    if (
      telemetry &&
      typeof telemetry.emitEvent === 'function'
    ) {
      telemetry.emitEvent(
        `resilience.${event}`,
        payload,
      );
    }
  } catch {
    // Telemetry is non-critical.
  }
}

/**
 * =============================================================================
 * Error Types
 * =============================================================================
 */

class ResilienceError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      options.name ||
      'ResilienceError';

    this.code =
      options.code ||
      'RESILIENCE_ERROR';

    this.category =
      options.category ||
      'resilience';

    this.retryable =
      options.retryable === true;

    this.financialSafe =
      options.financialSafe !== false;

    this.statusCode =
      options.statusCode ||
      null;

    this.cause =
      options.cause ||
      null;

    this.metadata =
      Object.freeze({
        ...(options.metadata || {}),
      });

    Error.captureStackTrace?.(
      this,
      ResilienceError,
    );
  }
}

class TimeoutError extends ResilienceError {
  constructor(
    message = 'Resilience operation timed out.',
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        name: 'ResilienceTimeoutError',
        code: 'RESILIENCE_TIMEOUT',
        retryable:
          options.retryable !== false,
      },
    );
  }
}

class CircuitOpenError extends ResilienceError {
  constructor(
    message = 'Circuit breaker is open.',
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        name: 'CircuitOpenError',
        code: 'RESILIENCE_CIRCUIT_OPEN',
        retryable: false,
      },
    );
  }
}

class BulkheadRejectedError extends ResilienceError {
  constructor(
    message = 'Resilience bulkhead capacity exceeded.',
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        name: 'BulkheadRejectedError',
        code: 'RESILIENCE_BULKHEAD_REJECTED',
        retryable: false,
      },
    );
  }
}

class RateLimitExceededError extends ResilienceError {
  constructor(
    message = 'Resilience rate limit exceeded.',
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        name: 'RateLimitExceededError',
        code: 'RESILIENCE_RATE_LIMIT_EXCEEDED',
        retryable: false,
        statusCode: 429,
      },
    );
  }
}

/**
 * =============================================================================
 * Utility Helpers
 * =============================================================================
 */

function isPromise(value) {
  return (
    value &&
    typeof value.then === 'function'
  );
}

function sleep(milliseconds) {
  if (
    milliseconds <= 0
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds,
    );
  });
}

function normalizeError(error) {
  if (
    error instanceof Error
  ) {
    return error;
  }

  return new Error(
    typeof error === 'string'
      ? error
      : JSON.stringify(error),
  );
}

function randomBetween(min, max) {
  return (
    min +
    Math.random() *
      (max - min)
  );
}

function calculateBackoff(
  attempt,
  retryConfiguration,
) {
  const exponential =
    Math.min(
      retryConfiguration.maxDelayMs,
      retryConfiguration.baseDelayMs *
        2 ** Math.max(0, attempt - 1),
    );

  const jitterRange =
    exponential *
    retryConfiguration.jitter;

  return Math.max(
    0,
    Math.round(
      randomBetween(
        exponential - jitterRange,
        exponential + jitterRange,
      ),
    ),
  );
}

function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR'
  );
}

function isTimeoutError(error) {
  return (
    error instanceof TimeoutError ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ESOCKETTIMEDOUT'
  );
}

function isCircuitOpenError(error) {
  return (
    error instanceof CircuitOpenError ||
    error?.code === 'EOPENBREAKER' ||
    error?.code === 'RESILIENCE_CIRCUIT_OPEN'
  );
}

function isFinancialOperation(options = {}) {
  return (
    options.financial === true ||
    options.financialOperation === true ||
    options.domain === 'financial' ||
    options.domain === 'finance' ||
    options.category === 'financial' ||
    options.path?.includes('/transactions') ||
    options.path?.includes('/payments') ||
    options.path?.includes('/wallet') ||
    options.path?.includes('/ledger') ||
    options.path?.includes('/loans') ||
    options.path?.includes('/savings') ||
    options.path?.includes('/withdrawals') ||
    options.path?.includes('/contributions') ||
    options.path?.includes('/momo')
  );
}

function isSafeToRetry(
  error,
  options = {},
) {
  if (
    options.retryable === false
  ) {
    return false;
  }

  if (
    isCircuitOpenError(error) ||
    isTimeoutError(error)
  ) {
    return true;
  }

  const status =
    error?.statusCode ||
    error?.status ||
    error?.response?.status;

  if (
    Number.isFinite(Number(status))
  ) {
    const numericStatus =
      Number(status);

    if (
      numericStatus === 408 ||
      numericStatus === 425 ||
      numericStatus === 429 ||
      numericStatus >= 500
    ) {
      return true;
    }

    return false;
  }

  if (
    error?.code
  ) {
    return [
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ].includes(error.code);
  }

  return false;
}

function canRetryOperation(
  error,
  options,
) {
  if (
    !configuration.retry.enabled
  ) {
    return false;
  }

  if (
    isAbortError(error)
  ) {
    return false;
  }

  if (
    options.retryable === false
  ) {
    return false;
  }

  /**
   * Financial operations are retried ONLY when the caller explicitly declares
   * them idempotent. This is critical to prevent duplicate financial effects.
   */
  if (
    isFinancialOperation(options) &&
    options.idempotent !== true
  ) {
    return false;
  }

  return isSafeToRetry(
    error,
    options,
  );
}

function isConfigurationObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function deepClone(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(deepClone);
  }

  if (
    typeof value === 'object'
  ) {
    const result = {};

    for (
      const [key, item] of
      Object.entries(value)
    ) {
      result[key] =
        deepClone(item);
    }

    return result;
  }

  return value;
}

function deepFreeze(value) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return value;
  }

  Object.freeze(value);

  for (
    const nested of
    Object.values(value)
  ) {
    deepFreeze(nested);
  }

  return value;
}

/**
 * =============================================================================
 * Timeout Wrapper
 * =============================================================================
 */

async function withTimeout(
  operation,
  timeoutMs,
  options = {},
) {
  if (
    typeof operation !== 'function'
  ) {
    throw new TypeError(
      'Resilience operation must be a function.',
    );
  }

  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return operation();
  }

  let timer = null;

  try {
    return await Promise.race([
      Promise.resolve().then(
        operation,
      ),

      new Promise(
        (_, reject) => {
          timer = setTimeout(
            () => {
              STATE.counters.timeouts += 1;
              incrementMetric('timeouts');

              reject(
                new TimeoutError(
                  `Operation exceeded ${timeoutMs}ms timeout.`,
                  {
                    metadata: {
                      timeoutMs,
                      operation:
                        options.name ||
                        'anonymous',
                    },
                  },
                ),
              );
            },
            timeoutMs,
          );
        },
      ),
    ]);
  } finally {
    if (
      timer
    ) {
      clearTimeout(timer);
    }
  }
}

/**
 * =============================================================================
 * Bulkhead
 * =============================================================================
 */

class Bulkhead {
  constructor(
    options = {},
  ) {
    this.maxConcurrent =
      Number.isFinite(options.maxConcurrent)
        ? options.maxConcurrent
        : DEFAULTS.bulkhead.maxConcurrent;

    this.maxQueue =
      Number.isFinite(options.maxQueue)
        ? options.maxQueue
        : DEFAULTS.bulkhead.maxQueue;

    this.active = 0;

    this.queue = [];

    this.totalAccepted = 0;

    this.totalRejected = 0;
  }

  get queueSize() {
    return this.queue.length;
  }

  get available() {
    return Math.max(
      0,
      this.maxConcurrent -
        this.active,
    );
  }

  async execute(
    operation,
    options = {},
  ) {
    if (
      typeof operation !== 'function'
    ) {
      throw new TypeError(
        'Bulkhead operation must be a function.',
      );
    }

    return new Promise(
      (resolve, reject) => {
        const job = {
          operation,
          options,
          resolve,
          reject,
        };

        if (
          this.active <
          this.maxConcurrent
        ) {
          this._run(job);
          return;
        }

        if (
          this.queue.length >=
          this.maxQueue
        ) {
          this.totalRejected += 1;

          STATE.counters.bulkheadRejected += 1;
          STATE.counters.rejected += 1;

          incrementMetric(
            'bulkhead_rejected',
          );
          incrementMetric(
            'rejected',
          );

          reject(
            new BulkheadRejectedError(
              'Resilience bulkhead capacity exceeded.',
              {
                metadata: {
                  maxConcurrent:
                    this.maxConcurrent,
                  maxQueue:
                    this.maxQueue,
                },
              },
            ),
          );

          return;
        }

        this.queue.push(job);
        this.totalAccepted += 1;
      },
    );
  }

  _run(job) {
    this.active += 1;

    Promise.resolve()
      .then(
        job.operation,
      )
      .then(
        (result) => {
          job.resolve(result);
        },
        (error) => {
          job.reject(error);
        },
      )
      .finally(() => {
        this.active -= 1;
        this._drain();
      });
  }

  _drain() {
    while (
      this.active <
        this.maxConcurrent &&
      this.queue.length > 0
    ) {
      const job =
        this.queue.shift();

      this._run(job);
    }
  }

  snapshot() {
    return {
      maxConcurrent:
        this.maxConcurrent,
      maxQueue:
        this.maxQueue,
      active:
        this.active,
      queued:
        this.queue.length,
      available:
        this.available,
      totalAccepted:
        this.totalAccepted,
      totalRejected:
        this.totalRejected,
    };
  }

  async shutdown() {
    this.queue.splice(
      0,
      this.queue.length,
    );
  }
}

/**
 * =============================================================================
 * Local Rate Limiter
 * =============================================================================
 *
 * Redis-backed rate limiting can be layered around this canonical interface
 * later. A local limiter is intentionally retained as a safe single-instance
 * fallback so this subsystem can operate deterministically during development
 * and controlled degraded infrastructure conditions.
 * =============================================================================
 */

class LocalRateLimiter {
  constructor(
    options = {},
  ) {
    this.points =
      options.points ||
      DEFAULTS.rateLimit.points;

    this.durationMs =
      (options.durationSeconds ||
        DEFAULTS.rateLimit.durationSeconds) *
      1_000;

    this.blockDurationMs =
      (options.blockDurationSeconds ||
        DEFAULTS.rateLimit.blockDurationSeconds) *
      1_000;

    this.buckets = new Map();
  }

  consume(key) {
    const now =
      Date.now();

    const normalizedKey =
      String(
        key ||
          'anonymous',
      );

    let bucket =
      this.buckets.get(
        normalizedKey,
      );

    if (
      !bucket ||
      now >= bucket.resetAt
    ) {
      bucket = {
        consumed: 0,
        resetAt:
          now +
          this.durationMs,
        blockedUntil:
          0,
      };

      this.buckets.set(
        normalizedKey,
        bucket,
      );
    }

    if (
      bucket.blockedUntil >
      now
    ) {
      throw new RateLimitExceededError(
        'Rate limit block is active.',
        {
          metadata: {
            key: normalizedKey,
            retryAfterMs:
              bucket.blockedUntil -
              now,
          },
        },
      );
    }

    if (
      bucket.consumed >=
      this.points
    ) {
      if (
        this.blockDurationMs >
        0
      ) {
        bucket.blockedUntil =
          now +
          this.blockDurationMs;
      }

      throw new RateLimitExceededError(
        'Rate limit exceeded.',
        {
          metadata: {
            key: normalizedKey,
            points:
              this.points,
            durationMs:
              this.durationMs,
            retryAfterMs:
              bucket.resetAt -
              now,
          },
        },
      );
    }

    bucket.consumed += 1;

    return {
      remaining:
        Math.max(
          0,
          this.points -
            bucket.consumed,
        ),

      resetAt:
        bucket.resetAt,
    };
  }

  reset(key) {
    this.buckets.delete(
      String(key),
    );
  }

  clear() {
    this.buckets.clear();
  }

  snapshot() {
    return {
      keys:
        this.buckets.size,
      points:
        this.points,
      durationMs:
        this.durationMs,
    };
  }
}

/**
 * =============================================================================
 * Circuit Breaker
 * =============================================================================
 *
 * Opossum is used when available. A deterministic local fallback is provided
 * so startup never depends on optional third-party implementation details.
 * =============================================================================
 */

class LocalCircuitBreaker {
  constructor(
    action,
    options = {},
  ) {
    this.action = action;

    this.timeoutMs =
      options.timeoutMs ||
      DEFAULTS.circuitBreaker.timeoutMs;

    this.errorThresholdPercentage =
      options.errorThresholdPercentage ||
      DEFAULTS.circuitBreaker
        .errorThresholdPercentage;

    this.resetTimeoutMs =
      options.resetTimeoutMs ||
      DEFAULTS.circuitBreaker
        .resetTimeoutMs;

    this.volumeThreshold =
      options.volumeThreshold ||
      DEFAULTS.circuitBreaker
        .volumeThreshold;

    this.state =
      'CLOSED';

    this.failures = 0;

    this.successes = 0;

    this.lastOpenedAt = null;
  }

  async fire(
    ...args
  ) {
    if (
      this.state === 'OPEN'
    ) {
      if (
        Date.now() -
          this.lastOpenedAt <
        this.resetTimeoutMs
      ) {
        STATE.counters.circuitOpen += 1;
        incrementMetric('circuit_open');

        throw new CircuitOpenError();
      }

      this.state =
        'HALF_OPEN';
    }

    try {
      const result =
        await withTimeout(
          () =>
            this.action(
              ...args,
            ),
          this.timeoutMs,
        );

      this.successes += 1;

      if (
        this.state ===
        'HALF_OPEN'
      ) {
        this.reset();
      }

      return result;
    } catch (error) {
      this.failures += 1;

      const total =
        this.failures +
        this.successes;

      const failurePercentage =
        total > 0
          ? (this.failures / total) *
            100
          : 0;

      if (
        total >=
          this.volumeThreshold &&
        failurePercentage >=
          this.errorThresholdPercentage
      ) {
        this.open();
      }

      throw error;
    }
  }

  open() {
    this.state =
      'OPEN';

    this.lastOpenedAt =
      Date.now();

    emitEvent(
      'circuit.open',
      {
        state:
          this.state,
      },
    );
  }

  reset() {
    this.state =
      'CLOSED';

    this.failures =
      0;

    this.successes =
      0;

    this.lastOpenedAt =
      null;

    emitEvent(
      'circuit.closed',
      {
        state:
          this.state,
      },
    );
  }

  shutdown() {
    this.state =
      'OPEN';
  }

  snapshot() {
    return {
      provider:
        'local',
      state:
        this.state,
      failures:
        this.failures,
      successes:
        this.successes,
      lastOpenedAt:
        this.lastOpenedAt,
    };
  }
}

/**
 * =============================================================================
 * Resilience Manager
 * =============================================================================
 */

class ResilienceManager {
  constructor(
    options = {},
  ) {
    this.options =
      options;

    this.circuitBreakers =
      breakerRegistry;

    this.rateLimiters =
      limiterRegistry;

    this.bulkheads =
      new Map();
  }

  createCircuitBreaker(
    name,
    action,
    options = {},
  ) {
    const normalizedName =
      normalizeName(
        name,
      );

    if (
      typeof action !==
      'function'
    ) {
      throw new TypeError(
        `Circuit breaker "${normalizedName}" requires a function.`,
      );
    }

    const existing =
      this.circuitBreakers.get(
        normalizedName,
      );

    if (
      existing
    ) {
      return existing;
    }

    const circuitOptions = {
      ...configuration.circuitBreaker,
      ...(options || {}),
    };

    let breaker;

    if (
      configuration.circuitBreaker.enabled &&
      OpossumBreaker
    ) {
      breaker =
        new OpossumBreaker(
          action,
          {
            timeout:
              circuitOptions.timeoutMs,

            errorThresholdPercentage:
              circuitOptions.errorThresholdPercentage,

            resetTimeout:
              circuitOptions.resetTimeoutMs,

            rollingCountTimeout:
              circuitOptions.rollingCountTimeoutMs,

            rollingCountBuckets:
              circuitOptions.rollingCountBuckets,

            volumeThreshold:
              circuitOptions.volumeThreshold,
          },
        );

      this._attachCircuitEvents(
        normalizedName,
        breaker,
      );
    } else {
      breaker =
        new LocalCircuitBreaker(
          action,
          circuitOptions,
        );
    }

    this.circuitBreakers.set(
      normalizedName,
      breaker,
    );

    return breaker;
  }

  _attachCircuitEvents(
    name,
    breaker,
  ) {
    if (
      typeof breaker?.on !==
      'function'
    ) {
      return;
    }

    breaker.on(
      'open',
      () => {
        STATE.counters.circuitOpen += 1;
        incrementMetric('circuit_open');

        emitEvent(
          'circuit.open',
          {
            name,
          },
        );
      },
    );

    breaker.on(
      'halfOpen',
      () => {
        emitEvent(
          'circuit.half_open',
          {
            name,
          },
        );
      },
    );

    breaker.on(
      'close',
      () => {
        emitEvent(
          'circuit.closed',
          {
            name,
          },
        );
      },
    );

    breaker.on(
      'timeout',
      () => {
        STATE.counters.timeouts += 1;
        incrementMetric('timeouts');

        emitEvent(
          'circuit.timeout',
          {
            name,
          },
        );
      },
    );

    breaker.on(
      'reject',
      () => {
        STATE.counters.rejected += 1;
        incrementMetric('rejected');

        emitEvent(
          'circuit.reject',
          {
            name,
          },
        );
      },
    );
  }

  getCircuitBreaker(
    name,
  ) {
    return this.circuitBreakers.get(
      normalizeName(name),
    ) || null;
  }

  async execute(
    operation,
    options = {},
  ) {
    if (
      typeof operation !==
      'function'
    ) {
      throw new TypeError(
        'Resilience operation must be a function.',
      );
    }

    if (
      !started ||
      !configuration.enabled ||
      !STATE.acceptingWork
    ) {
      throw new ResilienceError(
        'TITech resilience subsystem is not accepting work.',
        {
          code:
            'RESILIENCE_NOT_READY',
          retryable:
            false,
          metadata: {
            status:
              STATE.status,
          },
        },
      );
    }

    const name =
      normalizeName(
        options.name ||
          'anonymous-operation',
      );

    const financial =
      isFinancialOperation(
        options,
      );

    const retryConfig = {
      ...configuration.retry,
      ...(options.retry || {}),
    };

    STATE.counters.executions += 1;

    incrementMetric(
      'executions',
    );

    const timeoutMs =
      parseNumber(
        options.timeoutMs,
        configuration.timeoutMs,
        {
          min: 1,
          max: 120_000,
        },
      );

    const executeOnce =
      async () => {
        return withTimeout(
          operation,
          timeoutMs,
          {
            name,
          },
        );
      };

    let attempt = 0;

    while (true) {
      attempt += 1;

      try {
        const result =
          await this._executeProtected(
            executeOnce,
            {
              ...options,
              name,
              financial,
            },
          );

        STATE.counters.successes += 1;
        incrementMetric(
          'successes',
        );

        return result;
      } catch (error) {
        const normalized =
          normalizeError(
            error,
          );

        STATE.counters.failures += 1;
        incrementMetric(
          'failures',
        );

        const shouldRetry =
          retryConfig.enabled &&
          attempt <
            retryConfig.maxAttempts &&
          canRetryOperation(
            normalized,
            {
              ...options,
              financial,
            },
          );

        if (!shouldRetry) {
          throw normalized;
        }

        const delay =
          calculateBackoff(
            attempt,
            retryConfig,
          );

        STATE.counters.retries += 1;
        incrementMetric(
          'retries',
        );

        emitEvent(
          'retry',
          {
            operation:
              name,
            attempt,
            maxAttempts:
              retryConfig.maxAttempts,
            delayMs:
              delay,
            financial,
            reason:
              normalized.code ||
              normalized.name,
          },
        );

        await sleep(
          delay,
        );
      }
    }
  }

  async _executeProtected(
    operation,
    options,
  ) {
    const bulkhead =
      this._getBulkhead(
        options.name,
        options,
      );

    const run =
      async () => {
        const breaker =
          options.circuitBreaker === false
            ? null
            : this.createCircuitBreaker(
                options.name,
                operation,
                options.circuitBreakerOptions ||
                  {},
              );

        if (
          breaker
        ) {
          return this._fireCircuit(
            breaker,
            options,
          );
        }

        return operation();
      };

    if (
      bulkhead &&
      configuration.bulkhead.enabled
    ) {
      return bulkhead.execute(
        run,
      );
    }

    return run();
  }

  _fireCircuit(
    breaker,
    options,
  ) {
    if (
      typeof breaker.fire ===
      'function'
    ) {
      return breaker.fire();
    }

    if (
      typeof breaker.execute ===
      'function'
    ) {
      return breaker.execute();
    }

    if (
      typeof breaker.run ===
      'function'
    ) {
      return breaker.run();
    }

    throw new ResilienceError(
      'Configured circuit breaker does not expose a supported execution API.',
      {
        code:
          'RESILIENCE_CIRCUIT_API_INVALID',
        metadata: {
          operation:
            options.name,
        },
      },
    );
  }

  _getBulkhead(
    name,
    options = {},
  ) {
    if (
      !configuration.bulkhead.enabled
    ) {
      return null;
    }

    const normalizedName =
      normalizeName(
        name ||
          'default',
      );

    let bulkhead =
      this.bulkheads.get(
        normalizedName,
      );

    if (
      bulkhead
    ) {
      return bulkhead;
    }

    bulkhead =
      new Bulkhead({
        ...configuration.bulkhead,
        ...(options.bulkheadOptions || {}),
      });

    this.bulkheads.set(
      normalizedName,
      bulkhead,
    );

    return bulkhead;
  }

  createRateLimiter(
    name,
    options = {},
  ) {
    const normalizedName =
      normalizeName(
        name ||
          'default',
      );

    const existing =
      this.rateLimiters.get(
        normalizedName,
      );

    if (
      existing
    ) {
      return existing;
    }

    let limiter = null;

    const limiterOptions = {
      ...configuration.rateLimit,
      ...(options || {}),
    };

    if (
      configuration.rateLimit.enabled &&
      RateLimiterMemory
    ) {
      try {
        limiter =
          new RateLimiterMemory({
            points:
              limiterOptions.points,

            duration:
              limiterOptions.durationSeconds,

            blockDuration:
              limiterOptions.blockDurationSeconds,
          });
      } catch {
        limiter = null;
      }
    }

    if (
      !limiter
    ) {
      limiter =
        new LocalRateLimiter(
          limiterOptions,
        );
    }

    this.rateLimiters.set(
      normalizedName,
      limiter,
    );

    return limiter;
  }

  async consumeRateLimit(
    name,
    key,
    options = {},
  ) {
    if (
      !configuration.rateLimit.enabled
    ) {
      return {
        allowed: true,
      };
    }

    const limiter =
      this.createRateLimiter(
        name,
        options,
      );

    try {
      if (
        typeof limiter.consume ===
        'function'
      ) {
        await limiter.consume(
          String(key || 'anonymous'),
          1,
        );
      }

      return {
        allowed: true,
      };
    } catch (error) {
      STATE.counters.rateLimited += 1;
      STATE.counters.rejected += 1;

      incrementMetric(
        'rate_limited',
      );
      incrementMetric(
        'rejected',
      );

      if (
        error instanceof RateLimitExceededError
      ) {
        throw error;
      }

      throw new RateLimitExceededError(
        'Rate limit exceeded.',
        {
          cause:
            error,
          metadata: {
            key:
              String(
                key ||
                  'anonymous',
              ),
            limiter:
              name,
          },
        },
      );
    }
  }

  middleware(
    options = {},
  ) {
    const limiterName =
      options.rateLimiter ||
      options.name ||
      'http';

    return async (
      req,
      res,
      next,
    ) => {
      if (
        !configuration.enabled ||
        !STATE.acceptingWork
      ) {
        res.setHeader(
          'X-TITech-Resilience',
          'not-ready',
        );

        return next(
          new ResilienceError(
            'TITech resilience subsystem is not ready.',
            {
              code:
                'RESILIENCE_NOT_READY',
              statusCode:
                503,
              retryable:
                true,
            },
          ),
        );
      }

      try {
        const key =
          resolveRequestIdentity(
            req,
          );

        if (
          options.rateLimit !== false &&
          configuration.rateLimit.enabled
        ) {
          await this.consumeRateLimit(
            limiterName,
            key,
            options.rateLimitOptions ||
              {},
          );
        }

        req.titechResilience = {
          component:
            COMPONENT,

          requestId:
            req.id ||
            req.requestId ||
            null,

          startedAt:
            Date.now(),

          service:
            SERVICE_NAME,
        };

        res.setHeader(
          'X-TITech-Resilience',
          'active',
        );

        return next();
      } catch (error) {
        if (
          error instanceof RateLimitExceededError
        ) {
          res.setHeader(
            'Retry-After',
            String(
              Math.ceil(
                (error.metadata?.retryAfterMs ||
                  1_000) /
                  1_000,
              ),
            ),
          );

          return next(
            error,
          );
        }

        return next(
          error,
        );
      }
    };
  }

  snapshot() {
    const circuits = {};

    for (
      const [name, breaker] of
      this.circuitBreakers.entries()
    ) {
      circuits[name] =
        getCircuitSnapshot(
          breaker,
        );
    }

    const bulkheads = {};

    for (
      const [name, bulkhead] of
      this.bulkheads.entries()
    ) {
      bulkheads[name] =
        bulkhead.snapshot();
    }

    const rateLimiters = {};

    for (
      const [name, limiter] of
      this.rateLimiters.entries()
    ) {
      rateLimiters[name] =
        getLimiterSnapshot(
          limiter,
        );
    }

    return {
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      version:
        VERSION,

      status:
        STATE.status,

      enabled:
        STATE.enabled,

      degraded:
        STATE.degraded,

      failed:
        STATE.failed,

      acceptingWork:
        STATE.acceptingWork,

      implementationReady:
        STATE.implementationReady,

      lifecycle: {
        initialized,
        started,
        stopped,
      },

      timestamps: {
        createdAt:
          STATE.createdAt,
        initializedAt:
          STATE.initializedAt,
        startedAt:
          STATE.startedAt,
        stoppedAt:
          STATE.stoppedAt,
      },

      counters: {
        ...STATE.counters,
      },

      providers: {
        circuitBreaker:
          OpossumBreaker
            ? 'opossum'
            : 'local',
        rateLimiter:
          RateLimiterMemory
            ? 'rate-limiter-flexible'
            : 'local',
      },

      configuration:
        sanitizeConfiguration(
          configuration,
        ),

      circuits,

      bulkheads,

      rateLimiters,

      lastError:
        STATE.lastError,
    };
  }

  async shutdown() {
    const operations = [];

    for (
      const breaker of
      this.circuitBreakers.values()
    ) {
      operations.push(
        closeCircuitBreaker(
          breaker,
        ),
      );
    }

    for (
      const bulkhead of
      this.bulkheads.values()
    ) {
      operations.push(
        bulkhead.shutdown(),
      );
    }

    await Promise.allSettled(
      operations,
    );
  }
}

/**
 * =============================================================================
 * Lifecycle
 * =============================================================================
 */

let manager =
  new ResilienceManager();

async function initialize(
  context = {},
) {
  if (
    initialized &&
    started &&
    !stopped
  ) {
    return manager;
  }

  if (
    initializePromise
  ) {
    return initializePromise;
  }

  initializePromise =
    (async () => {
      try {
        logger =
          resolveLogger(
            context,
          );

        metrics =
          resolveMetrics(
            context,
          );

        configuration =
          resolveEnvironmentConfiguration(
            context,
          );

        STATE.enabled =
          configuration.enabled;

        STATE.degraded =
          false;

        STATE.failed =
          false;

        STATE.status =
          configuration.enabled
            ? 'initializing'
            : 'disabled';

        STATE.acceptingWork =
          false;

        manager =
          new ResilienceManager();

        initialized =
          true;

        STATE.initializedAt =
          new Date().toISOString();

        emitEvent(
          'initialized',
          {
            enabled:
              configuration.enabled,
            provider:
              OpossumBreaker
                ? 'opossum'
                : 'local',
          },
        );

        if (
          !configuration.enabled
        ) {
          STATE.status =
            'disabled';

          STATE.degraded =
            true;

          STATE.implementationReady =
            true;

          emitEvent(
            'disabled',
            {
              reason:
                'configuration',
            },
          );

          return manager;
        }

        STATE.status =
          'initialized';

        STATE.implementationReady =
          true;

        return manager;
      } catch (error) {
        const normalized =
          normalizeError(
            error,
          );

        STATE.failed =
          true;

        STATE.degraded =
          true;

        STATE.status =
          'failed';

        STATE.acceptingWork =
          false;

        STATE.lastError =
          serializeError(
            normalized,
          );

        emitEvent(
          'initialization_failed',
          {
            error:
              STATE.lastError,
          },
        );

        throw normalized;
      } finally {
        initializePromise =
          null;
      }
    })();

  return initializePromise;
}

async function start(
  context = {},
) {
  if (
    started &&
    !stopped
  ) {
    return manager;
  }

  await initialize(
    context,
  );

  if (
    !configuration.enabled
  ) {
    stopped =
      false;

    started =
      true;

    STATE.status =
      'disabled';

    STATE.acceptingWork =
      false;

    return manager;
  }

  stopped =
    false;

  started =
    true;

  STATE.status =
    'ready';

  STATE.degraded =
    false;

  STATE.failed =
    false;

  STATE.acceptingWork =
    true;

  STATE.implementationReady =
    true;

  STATE.startedAt =
    new Date().toISOString();

  emitEvent(
    'started',
    {
      provider: {
        circuitBreaker:
          OpossumBreaker
            ? 'opossum'
            : 'local',

        rateLimiter:
          RateLimiterMemory
            ? 'rate-limiter-flexible'
            : 'local',
      },
    },
  );

  return manager;
}

async function shutdown(
  options = {},
) {
  if (
    stopped
  ) {
    return true;
  }

  if (
    shutdownPromise
  ) {
    return shutdownPromise;
  }

  shutdownPromise =
    (async () => {
      STATE.status =
        'stopping';

      STATE.acceptingWork =
        false;

      const timeoutMs =
        parseNumber(
          options.timeoutMs,
          configuration.shutdown.timeoutMs,
          {
            min: 100,
            max: 120_000,
          },
        );

      try {
        await withTimeout(
          () => manager.shutdown(),
          timeoutMs,
          {
            name:
              'resilience-shutdown',
          },
        );
      } catch (error) {
        STATE.degraded =
          true;

        STATE.lastError =
          serializeError(
            error,
          );

        log(
          'warn',
          'Resilience shutdown completed with recoverable errors.',
          {
            error:
              STATE.lastError,
          },
        );
      } finally {
        started =
          false;

        stopped =
          true;

        STATE.status =
          'stopped';

        STATE.acceptingWork =
          false;

        STATE.stoppedAt =
          new Date().toISOString();

        emitEvent(
          'stopped',
        );
      }

      return true;
    })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise =
      null;
  }
}

function isReady() {
  if (
    !configuration.enabled
  ) {
    /**
     * Disabled resilience is intentionally treated as degraded rather than
     * "healthy". This prevents callers from confusing disabled protection
     * with fully operational protection.
     */
    return true;
  }

  return (
    started &&
    !stopped &&
    !STATE.failed &&
    STATE.implementationReady
  );
}

function readiness() {
  return {
    ready:
      isReady(),

    status:
      !configuration.enabled
        ? 'disabled'
        : isReady()
          ? 'ready'
          : STATE.failed
            ? 'unhealthy'
            : 'not_ready',

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    acceptingWork:
      STATE.acceptingWork,

    degraded:
      STATE.degraded,

    implementationReady:
      STATE.implementationReady,
  };
}

async function health() {
  return {
    ...readiness(),

    healthy:
      STATE.failed === false &&
      STATE.status !== 'unhealthy',

    status:
      !configuration.enabled
        ? 'degraded'
        : STATE.failed
          ? 'unhealthy'
          : isReady()
            ? 'healthy'
            : 'starting',

    provider: {
      circuitBreaker:
        OpossumBreaker
          ? 'opossum'
          : 'local',

      rateLimiter:
        RateLimiterMemory
          ? 'rate-limiter-flexible'
          : 'local',
    },

    counters: {
      ...STATE.counters,
    },
  };
}

/**
 * =============================================================================
 * Runtime Access
 * =============================================================================
 */

function getManager() {
  return manager;
}

function getResilience() {
  return manager;
}

function getState() {
  return {
    ...STATE,

    counters: {
      ...STATE.counters,
    },
  };
}

function isStarted() {
  return (
    started &&
    !stopped
  );
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return STATE.failed;
}

function isDegraded() {
  return STATE.degraded;
}

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function execute(
  operation,
  options = {},
) {
  return manager.execute(
    operation,
    options,
  );
}

function createCircuitBreaker(
  name,
  action,
  options = {},
) {
  return manager.createCircuitBreaker(
    name,
    action,
    options,
  );
}

function getCircuitBreaker(
  name,
) {
  return manager.getCircuitBreaker(
    name,
  );
}

function createRateLimiter(
  name,
  options = {},
) {
  return manager.createRateLimiter(
    name,
    options,
  );
}

function consumeRateLimit(
  name,
  key,
  options = {},
) {
  return manager.consumeRateLimit(
    name,
    key,
    options,
  );
}

function createBulkhead(
  name,
  options = {},
) {
  return manager._getBulkhead(
    name,
    {
      bulkheadOptions:
        options,
    },
  );
}

function middleware(
  options = {},
) {
  return manager.middleware(
    options,
  );
}

function configure(
  options = {},
) {
  if (
    started &&
    !stopped
  ) {
    throw new ResilienceError(
      'TITech resilience configuration cannot be changed while active.',
      {
        code:
          'RESILIENCE_CONFIGURATION_LOCKED',
      },
    );
  }

  const current =
    deepClone(
      configuration,
    );

  const incoming =
    isConfigurationObject(options)
      ? deepClone(options)
      : {};

  configuration =
    deepFreeze(
      mergeDeep(
        current,
        incoming,
      ),
    );

  STATE.enabled =
    configuration.enabled;

  return sanitizeConfiguration(
    configuration,
  );
}

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

function snapshot() {
  return manager.snapshot();
}

function diagnostics() {
  return {
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    version:
      VERSION,

    runtime: {
      node:
        process.version,

      platform:
        process.platform,

      architecture:
        process.arch,

      pid:
        process.pid,

      uptimeSeconds:
        Math.floor(
          process.uptime(),
        ),
    },

    state:
      getState(),

    readiness:
      readiness(),

    health:
      null,

    resilience:
      snapshot(),
  };
}

/**
 * =============================================================================
 * Middleware Helpers
 * =============================================================================
 */

function resolveRequestIdentity(
  request,
) {
  return (
    request?.user?.id ||
    request?.user?._id ||
    request?.auth?.sub ||
    request?.tenant?.id ||
    request?.headers?.['x-forwarded-for'] ||
    request?.ip ||
    request?.socket?.remoteAddress ||
    'anonymous'
  );
}

/**
 * =============================================================================
 * Internal Helpers
 * =============================================================================
 */

function normalizeName(
  name,
) {
  return String(
    name ||
      'default',
  )
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9:_-]+/gi,
      '_',
    )
    .slice(
      0,
      200,
    );
}

function getCircuitSnapshot(
  breaker,
) {
  if (
    breaker &&
    typeof breaker.toJSON ===
      'function'
  ) {
    try {
      return breaker.toJSON();
    } catch {
      // Fall through.
    }
  }

  if (
    typeof breaker.snapshot ===
    'function'
  ) {
    try {
      return breaker.snapshot();
    } catch {
      // Fall through.
    }
  }

  return {
    state:
      breaker?.opened
        ? 'OPEN'
        : 'UNKNOWN',

    closed:
      breaker?.closed === true,

    open:
      breaker?.opened === true,

    halfOpen:
      breaker?.halfOpen === true,
  };
}

function getLimiterSnapshot(
  limiter,
) {
  if (
    typeof limiter.snapshot ===
    'function'
  ) {
    try {
      return limiter.snapshot();
    } catch {
      // Fall through.
    }
  }

  return {
    provider:
      RateLimiterMemory
        ? 'rate-limiter-flexible'
        : 'local',
  };
}

async function closeCircuitBreaker(
  breaker,
) {
  if (
    !breaker
  ) {
    return;
  }

  try {
    if (
      typeof breaker.shutdown ===
      'function'
    ) {
      await breaker.shutdown();
      return;
    }

    if (
      typeof breaker.close ===
      'function'
    ) {
      await breaker.close();
      return;
    }

    if (
      typeof breaker.disable ===
      'function'
    ) {
      await breaker.disable();
    }
  } catch (error) {
    log(
      'warn',
      'Circuit breaker shutdown encountered an error.',
      {
        error:
          serializeError(
            error,
          ),
      },
    );
  }
}

function serializeError(
  error,
) {
  if (
    !error
  ) {
    return null;
  }

  return {
    name:
      error.name ||
      'Error',

    code:
      error.code ||
      null,

    message:
      error.message ||
      String(error),

    category:
      error.category ||
      null,

    retryable:
      error.retryable === true,

    financialSafe:
      error.financialSafe !== false,

    statusCode:
      error.statusCode ||
      null,
  };
}

function sanitizeConfiguration(
  config,
) {
  return {
    enabled:
      config.enabled,

    timeoutMs:
      config.timeoutMs,

    retry: {
      enabled:
        config.retry.enabled,

      maxAttempts:
        config.retry.maxAttempts,

      baseDelayMs:
        config.retry.baseDelayMs,

      maxDelayMs:
        config.retry.maxDelayMs,

      jitter:
        config.retry.jitter,
    },

    circuitBreaker: {
      enabled:
        config.circuitBreaker.enabled,

      timeoutMs:
        config.circuitBreaker.timeoutMs,

      errorThresholdPercentage:
        config.circuitBreaker
          .errorThresholdPercentage,

      resetTimeoutMs:
        config.circuitBreaker
          .resetTimeoutMs,

      rollingCountTimeoutMs:
        config.circuitBreaker
          .rollingCountTimeoutMs,

      rollingCountBuckets:
        config.circuitBreaker
          .rollingCountBuckets,

      volumeThreshold:
        config.circuitBreaker
          .volumeThreshold,
    },

    bulkhead: {
      enabled:
        config.bulkhead.enabled,

      maxConcurrent:
        config.bulkhead.maxConcurrent,

      maxQueue:
        config.bulkhead.maxQueue,
    },

    rateLimit: {
      enabled:
        config.rateLimit.enabled,

      points:
        config.rateLimit.points,

      durationSeconds:
        config.rateLimit.durationSeconds,

      blockDurationSeconds:
        config.rateLimit
          .blockDurationSeconds,
    },

    readiness: {
      required:
        config.readiness.required,

      timeoutMs:
        config.readiness.timeoutMs,
    },

    shutdown: {
      timeoutMs:
        config.shutdown.timeoutMs,
    },
  };
}

function mergeDeep(
  base,
  override,
) {
  const result =
    deepClone(base);

  for (
    const [key, value] of
    Object.entries(
      override || {},
    )
  ) {
    if (
      isConfigurationObject(
        value,
      ) &&
      isConfigurationObject(
        result[key],
      )
    ) {
      result[key] =
        mergeDeep(
          result[key],
          value,
        );
    } else {
      result[key] =
        deepClone(value);
    }
  }

  return result;
}

/**
 * =============================================================================
 * Test Support
 * =============================================================================
 *
 * Reset is intended for isolated unit/integration tests only.
 * It must never be used against an active production instance.
 * =============================================================================
 */

async function reset() {
  if (
    started &&
    !stopped
  ) {
    throw new ResilienceError(
      'Cannot reset an active TITech resilience subsystem.',
      {
        code:
          'RESILIENCE_RESET_NOT_ALLOWED',
      },
    );
  }

  breakerRegistry.clear();
  limiterRegistry.clear();

  manager =
    new ResilienceManager();

  configuration =
    deepFreeze({
      ...DEFAULTS,
      retry: {
        ...DEFAULTS.retry,
      },
      circuitBreaker: {
        ...DEFAULTS.circuitBreaker,
      },
      bulkhead: {
        ...DEFAULTS.bulkhead,
      },
      rateLimit: {
        ...DEFAULTS.rateLimit,
      },
      readiness: {
        ...DEFAULTS.readiness,
      },
      shutdown: {
        ...DEFAULTS.shutdown,
      },
    });

  logger =
    null;

  metrics =
    null;

  initialized =
    false;

  started =
    false;

  stopped =
    false;

  initializePromise =
    null;

  shutdownPromise =
    null;

  STATE.createdAt =
    new Date().toISOString();

  STATE.initializedAt =
    null;

  STATE.startedAt =
    null;

  STATE.stoppedAt =
    null;

  STATE.status =
    'created';

  STATE.enabled =
    true;

  STATE.degraded =
    false;

  STATE.failed =
    false;

  STATE.acceptingWork =
    false;

  STATE.implementationReady =
    false;

  STATE.lastError =
    null;

  Object.keys(
    STATE.counters,
  ).forEach(
    (key) => {
      STATE.counters[key] =
        0;
    },
  );

  return true;
}

/**
 * =============================================================================
 * Module Exports
 * =============================================================================
 */

module.exports = Object.freeze({
  /**
   * Metadata.
   */
  COMPONENT,
  SERVICE_NAME,
  VERSION,

  /**
   * Lifecycle.
   */
  initialize,
  start,
  bootstrap:
    initialize,

  shutdown,
  stop:
    shutdown,

  /**
   * Readiness / health.
   */
  isReady,
  readiness,
  health,

  isStarted,
  isStopped,
  isFailed,
  isDegraded,

  /**
   * Runtime access.
   */
  getManager,
  getResilience,
  getState,

  /**
   * Core execution.
   */
  execute,

  /**
   * Circuit breakers.
   */
  createCircuitBreaker,
  getCircuitBreaker,

  /**
   * Rate limiting.
   */
  createRateLimiter,
  consumeRateLimit,

  /**
   * Bulkheads.
   */
  createBulkhead,

  /**
   * HTTP middleware.
   */
  middleware,

  /**
   * Configuration.
   */
  configure,

  /**
   * Diagnostics.
   */
  snapshot,
  diagnostics,

  /**
   * Test support.
   */
  reset,

  /**
   * Error types.
   */
  ResilienceError,
  TimeoutError,
  CircuitOpenError,
  BulkheadRejectedError,
  RateLimitExceededError,
});