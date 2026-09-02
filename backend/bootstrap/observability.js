'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/observability.js
 *
 * Purpose:
 *   Enterprise production-grade observability bootstrap adapter.
 *
 * Responsibilities:
 *   - Adapt backend/observability.js into the canonical TITech lifecycle.
 *   - Preserve the canonical observability singleton.
 *   - Enforce deterministic startup/shutdown ordering.
 *   - Integrate observability with logger/configuration.
 *   - Integrate with readiness and lifecycle management.
 *   - Expose safe HTTP/metrics integration helpers.
 *   - Prevent duplicate/concurrent initialization.
 *   - Prevent duplicate/concurrent shutdown.
 *   - Normalize startup failures.
 *   - Provide safe diagnostics.
 *
 * IMPORTANT:
 *
 *   This file is ONLY an orchestration adapter.
 *
 *   It does NOT:
 *     - define metric primitives
 *     - implement tracing
 *     - implement AsyncLocalStorage
 *     - define Prometheus counters
 *     - implement request instrumentation
 *     - implement dependency monitoring
 *     - own business audit logging
 *
 *   The canonical implementation remains:
 *
 *       backend/observability.js
 *
 * =============================================================================
 */

const {
  hooks,
  lifecycle,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * Canonical implementation
 * -----------------------------------------------------------------------------
 */

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('../observability');
} catch (error) {
  observabilityModule = {
    __loadError:
      error,
  };
}

/**
 * -----------------------------------------------------------------------------
 * Supporting bootstrap modules
 * -----------------------------------------------------------------------------
 */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule =
    require('./logger');
} catch {
  loggerModule = null;
}

let startupErrorsModule = null;

try {
  // eslint-disable-next-line global-require
  startupErrorsModule =
    require('./startupErrors');
} catch {
  startupErrorsModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'observability';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const DEFAULT_PRIORITY =
  -600;

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_DEPENDENCIES =
  Object.freeze([
    'logger',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Error
 * -----------------------------------------------------------------------------
 */

class ObservabilityBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'ObservabilityBootstrapError';

    this.code =
      options.code ||
      'OBSERVABILITY_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.component =
      options.component ||
      COMPONENT;

    this.service =
      options.service ||
      SERVICE_NAME;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      ObservabilityBootstrapError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Internal state
 * -----------------------------------------------------------------------------
 */

let observability =
  null;

let registered =
  false;

let started =
  false;

let stopped =
  false;

let failed =
  false;

let degraded =
  false;

let registrationResult =
  null;

let startPromise =
  null;

let stopPromise =
  null;

let lastError =
  null;

let initializedAt =
  null;

let stoppedAt =
  null;

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function normalizeDependencies(
  dependencies,
) {
  if (
    !Array.isArray(
      dependencies,
    )
  ) {
    return [
      ...DEFAULT_DEPENDENCIES,
    ];
  }

  return [
    ...new Set(
      dependencies
        .map(
          String,
        )
        .map(
          value =>
            value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function safeError(
  error,
) {
  if (
    !error
  ) {
    return null;
  }

  return {
    name:
      error.name,

    code:
      error.code,

    message:
      error.message,
  };
}

function withTimeout(
  fn,
  timeoutMs,
  label,
) {
  let timer;

  const operation =
    Promise.resolve().then(
      fn,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new ObservabilityBootstrapError(
                  `${label} timed out after ${timeoutMs}ms.`,
                  {
                    code:
                      'OBSERVABILITY_OPERATION_TIMEOUT',

                    phase:
                      'lifecycle',
                  },
                ),
              );
            },
            timeoutMs,
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
 * -----------------------------------------------------------------------------
 * Logger
 * -----------------------------------------------------------------------------
 */

function getLogger() {
  try {
    return (
      loggerModule?.getLogger?.() ||
      loggerModule?.logger ||
      loggerModule
    );
  } catch {
    return null;
  }
}

function log(
  level,
  payload,
  message,
) {
  try {
    const logger =
      getLogger();

    if (
      logger &&
      typeof logger[level] ===
        'function'
    ) {
      logger[level](
        {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          application:
            APPLICATION_NAME,

          ...payload,
        },
        message,
      );

      return;
    }
  } catch {
    // Fall through to console.
  }

  const output =
    `[${COMPONENT}] ${message}`;

  if (
    level === 'error' ||
    level === 'fatal'
  ) {
    process.stderr.write(
      `${output}\n`,
    );
  } else {
    process.stdout.write(
      `${output}\n`,
    );
  }
}

/**
 * =============================================================================
 * Canonical implementation resolution
 * =============================================================================
 */

function resolveCanonicalObservability() {
  if (
    observability
  ) {
    return observability;
  }

  if (
    observabilityModule?.__loadError
  ) {
    throw new ObservabilityBootstrapError(
      'TITech canonical observability implementation could not be loaded.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_LOAD_FAILED',

        cause:
          observabilityModule
            .__loadError,
      },
    );
  }

  observability =
    observabilityModule?.observability ||
    observabilityModule?.default ||
    observabilityModule;

  if (
    !observability
  ) {
    throw new ObservabilityBootstrapError(
      'TITech canonical observability implementation is unavailable.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_UNAVAILABLE',
      },
    );
  }

  return observability;
}

/**
 * =============================================================================
 * Contract validation
 * =============================================================================
 */

function assertObservability(
  options = {},
) {
  const implementation =
    resolveCanonicalObservability();

  const requiredMethods =
    Array.isArray(
      options.requiredMethods,
    )
      ? options.requiredMethods
      : [
          'initialize',
          'shutdown',
          'readiness',
          'health',
          'snapshot',
        ];

  const missingMethods =
    requiredMethods.filter(
      method =>
        typeof implementation[
          method
        ] !== 'function',
    );

  if (
    missingMethods.length >
    0
  ) {
    throw new ObservabilityBootstrapError(
      'TITech observability implementation does not satisfy the bootstrap contract.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_INVALID',

        details: {
          missingMethods,
        },
      },
    );
  }

  return implementation;
}

/**
 * =============================================================================
 * State
 * =============================================================================
 */

function getState() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    registered,

    started,

    stopped,

    failed,

    degraded,

    ready:
      started &&
      !failed &&
      !stopped,

    initializedAt,

    stoppedAt,

    lastError:
      safeError(
        lastError,
      ),
  });
}

/**
 * =============================================================================
 * Readiness normalization
 * =============================================================================
 */

function normalizeReadiness(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      ready:
        result,

      status:
        result
          ? 'ready'
          : 'not_ready',
    };
  }

  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return {
      ready:
        started &&
        !failed &&
        !stopped,

      status:
        started &&
        !failed &&
        !stopped
          ? 'ready'
          : 'not_ready',
    };
  }

  return {
    ready:
      result.ready === true ||
      result.status ===
        'ready',

    status:
      result.status ||
      (
        result.ready
          ? 'ready'
          : 'not_ready'
      ),
  };
}

/**
 * =============================================================================
 * Lifecycle registration
 * =============================================================================
 */

function registerObservabilityHooks(
  context = {},
  options = {},
) {
  const implementation =
    assertObservability();

  /**
   * Duplicate protection.
   */
  if (
    hooks.has(
      COMPONENT,
    )
  ) {
    registered =
      true;

    registrationResult =
      hooks.get(
        COMPONENT,
      );

    return registrationResult;
  }

  const priority =
    Number.isInteger(
      options.priority,
    )
      ? options.priority
      : DEFAULT_PRIORITY;

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  const dependencies =
    normalizeDependencies(
      options.dependencies,
    );

  registrationResult =
    lifecycle(
      COMPONENT,
      {
        priority,

        dependencies,

        timeoutMs,

        enabled:
          options.enabled !==
          false,

        critical:
          options.critical !==
          false,

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          application:
            APPLICATION_NAME,

          implementation:
            'backend/observability.js',

          bootstrap:
            'backend/bootstrap/observability.js',
        },

        /**
         * -----------------------------------------------------------------------
         * START
         * -----------------------------------------------------------------------
         */

        start:
          async hookContext => {
            if (
              startPromise
            ) {
              return startPromise;
            }

            startPromise =
              (async () => {
                try {
                  const runtimeContext =
                    hookContext ||
                    context ||
                    {};

                  assertObservability();

                  const result =
                    await withTimeout(
                      () =>
                        implementation.initialize(),
                      timeoutMs,
                      'TITech observability startup',
                    );

                  if (
                    runtimeContext &&
                    typeof runtimeContext ===
                      'object'
                  ) {
                    runtimeContext.observability =
                      implementation;
                  }

                  registered =
                    true;

                  started =
                    true;

                  stopped =
                    false;

                  failed =
                    false;

                  degraded =
                    false;

                  lastError =
                    null;

                  initializedAt =
                    new Date();

                  log(
                    'info',
                    {
                      lifecycle:
                        'start',
                    },
                    'TITech observability bootstrap completed.',
                  );

                  return (
                    result ||
                    implementation
                  );
                } catch (error) {
                  started =
                    false;

                  stopped =
                    false;

                  failed =
                    true;

                  degraded =
                    true;

                  lastError =
                    error;

                  throw normalizeBootstrapError(
                    error,
                    {
                      code:
                        'OBSERVABILITY_START_FAILED',

                      phase:
                        'startup',

                      operation:
                        'observability-start',
                    },
                  );
                }
              })();

            try {
              return await startPromise;
            } finally {
              startPromise =
                null;
            }
          },

        /**
         * -----------------------------------------------------------------------
         * READY
         * -----------------------------------------------------------------------
         */

        ready:
          async () => {
            try {
              const result =
                await withTimeout(
                  () =>
                    implementation.readiness(),
                  timeoutMs,
                  'TITech observability readiness',
                );

              const normalized =
                normalizeReadiness(
                  result,
                );

              if (
                !normalized.ready
              ) {
                degraded =
                  true;
              }

              return normalized.ready;
            } catch (error) {
              failed =
                true;

              degraded =
                true;

              lastError =
                error;

              return false;
            }
          },

        /**
         * -----------------------------------------------------------------------
         * HEALTH
         * -----------------------------------------------------------------------
         */

        health:
          async () => {
            try {
              return await withTimeout(
                () =>
                  implementation.health(),
                timeoutMs,
                'TITech observability health',
              );
            } catch (error) {
              lastError =
                error;

              degraded =
                true;

              return {
                status:
                  'unhealthy',

                healthy:
                  false,

                ready:
                  false,

                component:
                  COMPONENT,

                service:
                  SERVICE_NAME,

                error:
                  safeError(
                    error,
                  ),
              };
            }
          },

        /**
         * -----------------------------------------------------------------------
         * STOP
         * -----------------------------------------------------------------------
         */

        stop:
          async hookContext => {
            if (
              stopPromise
            ) {
              return stopPromise;
            }

            stopPromise =
              (async () => {
                try {
                  const result =
                    await withTimeout(
                      () =>
                        implementation.shutdown(),
                      timeoutMs,
                      'TITech observability shutdown',
                    );

                  started =
                    false;

                  stopped =
                    true;

                  failed =
                    false;

                  degraded =
                    false;

                  stoppedAt =
                    new Date();

                  log(
                    'info',
                    {
                      lifecycle:
                        'stop',

                      reason:
                        hookContext?.reason ||
                        null,
                    },
                    'TITech observability bootstrap stopped.',
                  );

                  return (
                    result ??
                    true
                  );
                } catch (error) {
                  failed =
                    true;

                  stopped =
                    false;

                  lastError =
                    error;

                  throw normalizeBootstrapError(
                    error,
                    {
                      code:
                        'OBSERVABILITY_STOP_FAILED',

                      phase:
                        'shutdown',

                      operation:
                        'observability-stop',
                    },
                  );
                }
              })();

            try {
              return await stopPromise;
            } finally {
              stopPromise =
                null;
            }
          },
      },
    );

  registered =
    true;

  return registrationResult;
}

/**
 * =============================================================================
 * Canonical bootstrap contract
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerObservabilityHooks(
    context,
    options,
  );
}

/**
 * =============================================================================
 * Explicit initialization
 * =============================================================================
 */

async function initialize(
  context = {},
  options = {},
) {
  const implementation =
    assertObservability(
      options,
    );

  if (
    started &&
    !stopped &&
    !failed
  ) {
    if (
      context &&
      typeof context ===
        'object'
    ) {
      context.observability =
        implementation;
    }

    return implementation;
  }

  if (
    startPromise
  ) {
    return startPromise;
  }

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  startPromise =
    (async () => {
      try {
        const result =
          await withTimeout(
            () =>
              implementation.initialize(),
            timeoutMs,
            'TITech observability initialization',
          );

        if (
          context &&
          typeof context ===
            'object'
        ) {
          context.observability =
            implementation;
        }

        registered =
          true;

        started =
          true;

        stopped =
          false;

        failed =
          false;

        degraded =
          false;

        lastError =
          null;

        initializedAt =
          new Date();

        return (
          result ||
          implementation
        );
      } catch (error) {
        started =
          false;

        failed =
          true;

        degraded =
          true;

        lastError =
          error;

        throw normalizeBootstrapError(
          error,
          {
            code:
              'OBSERVABILITY_INITIALIZATION_FAILED',

            phase:
              'initialization',

            operation:
              'observability-initialize',
          },
        );
      }
    })();

  try {
    return await startPromise;
  } finally {
    startPromise =
      null;
  }
}

/**
 * =============================================================================
 * Explicit shutdown
 * =============================================================================
 */

async function shutdown(
  options = {},
) {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'shutdown',
        ],
      },
    );

  if (
    stopped
  ) {
    return true;
  }

  if (
    stopPromise
  ) {
    return stopPromise;
  }

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  stopPromise =
    (async () => {
      try {
        const result =
          await withTimeout(
            () =>
              implementation.shutdown(),
            timeoutMs,
            'TITech observability shutdown',
          );

        started =
          false;

        stopped =
          true;

        failed =
          false;

        degraded =
          false;

        stoppedAt =
          new Date();

        lastError =
          null;

        return (
          result ??
          true
        );
      } catch (error) {
        failed =
          true;

        stopped =
          false;

        lastError =
          error;

        throw normalizeBootstrapError(
          error,
          {
            code:
              'OBSERVABILITY_SHUTDOWN_FAILED',

            phase:
              'shutdown',

            operation:
              'observability-shutdown',
          },
        );
      }
    })();

  try {
    return await stopPromise;
  } finally {
    stopPromise =
      null;
  }
}

async function stop(
  options = {},
) {
  return shutdown(
    options,
  );
}

/**
 * =============================================================================
 * Canonical implementation access
 * =============================================================================
 */

function getObservability() {
  return assertObservability();
}

/**
 * =============================================================================
 * Operational API
 * =============================================================================
 */

async function readiness() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'readiness',
        ],
      },
    );

  return implementation.readiness();
}

async function health() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'health',
        ],
      },
    );

  return implementation.health();
}

function snapshot() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'snapshot',
        ],
      },
    );

  return Object.freeze({
    ...getState(),

    implementation:
      implementation.snapshot(),
  });
}

function liveness() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'liveness',
        ],
      },
    );

  return implementation.liveness();
}

function isRegistered() {
  return registered;
}

function isStarted() {
  return started;
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return failed;
}

function isDegraded() {
  return degraded;
}

function isReady() {
  return (
    started &&
    !failed &&
    !stopped
  );
}

/**
 * =============================================================================
 * HTTP Integration
 * =============================================================================
 *
 * These helpers expose implementation-owned middleware only.
 * =============================================================================
 */

function middleware() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'middleware',
        ],
      },
    );

  return implementation.middleware();
}

function errorMiddleware() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'errorMiddleware',
        ],
      },
    );

  return implementation.errorMiddleware();
}

function metricsHandler() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'metricsHandler',
        ],
      },
    );

  return implementation.metricsHandler();
}

function metricsText() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'metricsText',
        ],
      },
    );

  return implementation.metricsText();
}

function metricsContentType() {
  const implementation =
    assertObservability(
      {
        requiredMethods: [
          'metricsContentType',
        ],
      },
    );

  return implementation.metricsContentType();
}

/**
 * =============================================================================
 * Generic delegated API
 * =============================================================================
 *
 * Keeps the bootstrap adapter useful to workers/services without reproducing
 * the implementation.
 * =============================================================================
 */

function getContext() {
  const implementation =
    assertObservability();

  return implementation.getContext?.() || {};
}

function runWithContext(
  context,
  callback,
) {
  const implementation =
    assertObservability();

  if (
    typeof implementation.runWithContext !==
      'function'
  ) {
    return callback();
  }

  return implementation.runWithContext(
    context,
    callback,
  );
}

function instrument(
  operation,
  fn,
  options,
) {
  const implementation =
    assertObservability();

  if (
    typeof implementation.instrument !==
      'function'
  ) {
    return fn({});
  }

  return implementation.instrument(
    operation,
    fn,
    options,
  );
}

function recordError(
  error,
  context,
) {
  const implementation =
    assertObservability();

  if (
    typeof implementation.recordError !==
      'function'
  ) {
    return null;
  }

  return implementation.recordError(
    error,
    context,
  );
}

/**
 * =============================================================================
 * Error normalization
 * =============================================================================
 */

function normalizeBootstrapError(
  error,
  options = {},
) {
  if (
    error instanceof
    ObservabilityBootstrapError
  ) {
    return error;
  }

  if (
    startupErrorsModule
      ?.normalizeStartupError
  ) {
    return startupErrorsModule.normalizeStartupError(
      error,
      {
        phase:
          options.phase ||
          'bootstrap',

        operation:
          options.operation ||
          'observability-lifecycle',

        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        critical:
          options.critical ??
          true,

        fatal:
          options.fatal ??
          true,

        preserveCauseStack:
          true,
      },
    );
  }

  return wrapError(
    error,
    options.code ||
      'OBSERVABILITY_BOOTSTRAP_FAILED',
    options.phase ||
      'bootstrap',
    error?.message ||
      'TITech observability bootstrap operation failed.',
  );
}

function wrapError(
  error,
  code,
  phase,
  message,
) {
  if (
    error instanceof
    ObservabilityBootstrapError
  ) {
    return error;
  }

  return new ObservabilityBootstrapError(
    message,
    {
      code,

      phase,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      cause:
        error,
    },
  );
}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Test/process isolation only.
 *
 * IMPORTANT:
 * This resets the ADAPTER state only.
 * It does not reset the canonical observability implementation.
 * =============================================================================
 */

function reset() {
  if (
    started &&
    !stopped
  ) {
    throw new ObservabilityBootstrapError(
      'Cannot reset active TITech observability bootstrap state.',
      {
        code:
          'OBSERVABILITY_RESET_NOT_ALLOWED',
      },
    );
  }

  registered =
    false;

  started =
    false;

  stopped =
    false;

  failed =
    false;

  degraded =
    false;

  registrationResult =
    null;

  startPromise =
    null;

  stopPromise =
    null;

  lastError =
    null;

  initializedAt =
    null;

  stoppedAt =
    null;

  return true;
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 *
 * NOTE:
 *
 * Do NOT eagerly execute getObservability() while constructing module.exports.
 * The canonical implementation should resolve only when consumed.
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Canonical implementation.
     */
    getObservability,

    /**
     * Lifecycle.
     */
    registerObservabilityHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    initialize,

    start:
      initialize,

    shutdown,

    stop,

    /**
     * State.
     */
    getState,

    snapshot,

    isRegistered,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    isReady,

    /**
     * Health/readiness.
     */
    readiness,

    health,

    liveness,

    /**
     * HTTP integration.
     */
    middleware,

    errorMiddleware,

    metricsHandler,

    metricsText,

    metricsContentType,

    /**
     * Context/instrumentation delegation.
     */
    getContext,

    runWithContext,

    instrument,

    recordError,

    /**
     * Test support.
     */
    reset,

    /**
     * Error.
     */
    ObservabilityBootstrapError,

    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,
  });