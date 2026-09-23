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
 * Architecture rule:
 *   This module orchestrates the canonical implementation in
 *   backend/observability.js. It does not implement telemetry primitives.
 *
 * Module-format boundary:
 *   backend/package.json declares "type": "module". This adapter remains ESM.
 *   The canonical backend/observability.js implementation is a legacy CommonJS
 *   module, so it is intentionally loaded through createRequire at this boundary.
 *
 * Responsibilities:
 *   - Adapt backend/observability.js into the canonical TITech lifecycle.
 *   - Preserve the canonical observability singleton.
 *   - Prevent duplicate/concurrent initialization.
 *   - Prevent duplicate/concurrent shutdown.
 *   - Provide deterministic lifecycle state.
 *   - Provide readiness/health/snapshot access.
 *   - Provide safe metrics/HTTP instrumentation delegation.
 *   - Normalize bootstrap failures.
 *   - Provide safe diagnostics.
 *
 * IMPORTANT:
 *   This module is ONLY an orchestration adapter.
 *
 *   It does NOT:
 *     - define metrics primitives
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
 * =============================================================================
 */

import * as hooksModule from './hooks.js';
import * as loggerModule from './logger.js';
const startupErrorsModule =
    require('./startupErrors.js');

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const canonicalObservabilityModule = require('../observability.js');

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT = 'observability';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'TITech Community Capital';

const DEFAULT_PRIORITY = -600;

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_DEPENDENCIES = Object.freeze([
  'logger',
]);

const READY_STATUS = 'ready';

const NOT_READY_STATUS = 'not_ready';

const LIFECYCLE_STATES = Object.freeze({
  IDLE: 'idle',
  REGISTERED: 'registered',
  STARTING: 'starting',
  READY: 'ready',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

/**
 * =============================================================================
 * MODULE NORMALIZATION
 * =============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function unwrapModule(moduleValue) {
  if (!moduleValue) {
    return null;
  }

  if (
    moduleValue.default !== undefined &&
    moduleValue.default !== null
  ) {
    return moduleValue.default;
  }

  return moduleValue;
}

function resolveExport(
  moduleValue,
  preferredNames = [],
) {
  if (!moduleValue) {
    return null;
  }

  for (const name of preferredNames) {
    if (
      moduleValue[name] !== undefined
    ) {
      return moduleValue[name];
    }
  }

  const defaultExport =
    moduleValue.default;

  if (
    defaultExport &&
    typeof defaultExport === 'object'
  ) {
    for (const name of preferredNames) {
      if (
        defaultExport[name] !== undefined
      ) {
        return defaultExport[name];
      }
    }
  }

  return unwrapModule(moduleValue);
}

/**
 * =============================================================================
 * DEPENDENCY RESOLUTION
 * =============================================================================
 */

const hooks =
  resolveExport(
    hooksModule,
    [
      'hooks',
    ],
  );

const lifecycle =
  resolveExport(
    hooksModule,
    [
      'lifecycle',
    ],
  );

const logger =
  resolveExport(
    loggerModule,
    [
      'logger',
      'default',
    ],
  );

const startupErrors =
  resolveExport(
    startupErrorsModule,
    [
      'startupErrors',
      'normalizeStartupError',
    ],
  );

const canonicalObservability =
  resolveExport(
    canonicalObservabilityModule,
    [
      'observability',
    ],
  );

/**
 * =============================================================================
 * ERROR
 * =============================================================================
 */

class ObservabilityBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      message ||
      'TITech observability bootstrap operation failed.',
      {
        cause:
          options.cause ??
          undefined,
      },
    );

    this.name =
      'ObservabilityBootstrapError';

    this.code =
      options.code ||
      'OBSERVABILITY_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ??
      null;

    this.component =
      options.component ??
      COMPONENT;

    this.service =
      options.service ??
      SERVICE_NAME;

    this.cause =
      options.cause ??
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    if (
      Error.captureStackTrace
    ) {
      Error.captureStackTrace(
        this,
        ObservabilityBootstrapError,
      );
    }
  }
}

/**
 * =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

let observability = null;

let registered = false;

let lifecycleState =
  LIFECYCLE_STATES.IDLE;

let started = false;

let stopped = false;

let failed = false;

let degraded = false;

let registrationResult = null;

let startPromise = null;

let stopPromise = null;

let lastError = null;

let initializedAt = null;

let stoppedAt = null;

let lastTransitionAt = null;

let transitionSequence = 0;

/**
 * =============================================================================
 * STATE TRANSITION
 * =============================================================================
 */

function transition(
  nextState,
) {
  lifecycleState =
    nextState;

  lastTransitionAt =
    new Date();

  transitionSequence += 1;
}

/**
 * =============================================================================
 * GENERIC HELPERS
 * =============================================================================
 */

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value == null
      ? fallback
      : Number(value);

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function normalizeDependencies(
  value,
) {
  if (
    !Array.isArray(value)
  ) {
    return [
      ...DEFAULT_DEPENDENCIES,
    ];
  }

  return [
    ...new Set(
      value
        .map(String)
        .map(
          (entry) =>
            entry.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function safeError(
  error,
) {
  if (!error) {
    return null;
  }

  return Object.freeze({
    name:
      error?.name ||
      'Error',

    code:
      error?.code ??
      null,

    message:
      typeof error?.message ===
      'string'
        ? error.message
        : String(error),
  });
}

function safeSerialize(
  value,
) {
  try {
    const seen =
      new WeakSet();

    return JSON.stringify(
      value,
      (_key, nestedValue) => {
        if (
          nestedValue instanceof Error
        ) {
          return safeError(
            nestedValue,
          );
        }

        if (
          nestedValue &&
          typeof nestedValue ===
            'object'
        ) {
          if (
            seen.has(
              nestedValue,
            )
          ) {
            return '[circular]';
          }

          seen.add(
            nestedValue,
          );
        }

        return nestedValue;
      },
    );
  } catch {
    return '[unserializable]';
  }
}

/**
 * =============================================================================
 * TIMEOUT
 * =============================================================================
 */

async function withTimeout(
  operation,
  timeoutMs,
  label,
) {
  const normalizedTimeout =
    asPositiveInteger(
      timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  let timer = null;

  const promise =
    Promise.resolve().then(
      operation,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new ObservabilityBootstrapError(
                `${label} timed out after ${normalizedTimeout}ms.`,
                {
                  code:
                    'OBSERVABILITY_OPERATION_TIMEOUT',

                  phase:
                    'lifecycle',

                  details: {
                    timeoutMs:
                      normalizedTimeout,
                  },
                },
              ),
            );
          },
          normalizedTimeout,
        );

        timer.unref?.();
      },
    );

  try {
    return await Promise.race([
      promise,
      timeout,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

/**
 * =============================================================================
 * LOGGER
 * =============================================================================
 */

function getLogger() {
  try {
    if (
      isFunction(
        logger?.getLogger,
      )
    ) {
      return logger.getLogger();
    }

    if (
      logger?.logger &&
      isObject(logger.logger)
    ) {
      return logger.logger;
    }

    return logger;
  } catch {
    return null;
  }
}

function log(
  level,
  message,
  payload = null,
) {
  try {
    const resolvedLogger =
      getLogger();

    if (
      resolvedLogger &&
      isFunction(
        resolvedLogger[level],
      )
    ) {
      if (
        payload &&
        isObject(payload)
      ) {
        resolvedLogger[level](
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
      } else {
        resolvedLogger[level](
          message,
        );
      }

      return true;
    }
  } catch {
    // Console fallback below.
  }

  const suffix =
    payload &&
    isObject(payload)
      ? ` ${safeSerialize(
          payload,
        )}`
      : '';

  const line =
    `[${COMPONENT}] ${message}${suffix}\n`;

  if (
    level === 'error' ||
    level === 'fatal' ||
    level === 'warn'
  ) {
    process.stderr.write(
      line,
    );
  } else {
    process.stdout.write(
      line,
    );
  }

  return false;
}

/**
 * =============================================================================
 * CANONICAL OBSERVABILITY
 * =============================================================================
 */

function resolveCanonicalObservability() {
  if (observability) {
    return observability;
  }

  if (
    !canonicalObservability
  ) {
    throw new ObservabilityBootstrapError(
      'TITech canonical observability implementation is unavailable.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_UNAVAILABLE',

        phase:
          'resolution',
      },
    );
  }

  observability =
    unwrapModule(
      canonicalObservability,
    );

  return observability;
}

function assertObservability(
  options = {},
) {
  const implementation =
    resolveCanonicalObservability();

  if (
    !implementation
  ) {
    throw new ObservabilityBootstrapError(
      'TITech canonical observability implementation resolved to an empty value.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_EMPTY',

        phase:
          'resolution',
      },
    );
  }

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
      (method) =>
        !isFunction(
          implementation[
            method
          ],
        ),
    );

  if (
    missingMethods.length > 0
  ) {
    throw new ObservabilityBootstrapError(
      'TITech observability implementation does not satisfy the bootstrap contract.',
      {
        code:
          'OBSERVABILITY_IMPLEMENTATION_INVALID',

        phase:
          'resolution',

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
 * READINESS
 * =============================================================================
 */

function normalizeReadiness(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return Object.freeze({
      ready:
        result,

      status:
        result
          ? READY_STATUS
          : NOT_READY_STATUS,
    });
  }

  if (
    !isObject(result)
  ) {
    const ready =
      started &&
      !failed &&
      !stopped;

    return Object.freeze({
      ready,

      status:
        ready
          ? READY_STATUS
          : NOT_READY_STATUS,
    });
  }

  const ready =
    result.ready === true ||
    result.status ===
      READY_STATUS;

  return Object.freeze({
    ...result,

    ready,

    status:
      result.status ||
      (
        ready
          ? READY_STATUS
          : NOT_READY_STATUS
      ),
  });
}

/**
 * =============================================================================
 * STATE
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

    state:
      lifecycleState,

    started,

    stopped,

    failed,

    degraded,

    ready:
      lifecycleState ===
        LIFECYCLE_STATES.READY &&
      started &&
      !failed &&
      !stopped,

    initializedAt,

    stoppedAt,

    lastTransitionAt,

    transitionSequence,

    lastError:
      safeError(
        lastError,
      ),
  });
}

/**
 * =============================================================================
 * ERROR NORMALIZATION
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

  const normalize =
    startupErrors?.normalizeStartupError ||
    (
      isFunction(
        startupErrors,
      )
        ? startupErrors
        : null
    );

  if (
    isFunction(normalize)
  ) {
    try {
      const normalized =
        normalize(
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

      if (
        normalized
      ) {
        return normalized;
      }
    } catch {
      // Local fallback below.
    }
  }

  return new ObservabilityBootstrapError(
    options.message ||
      error?.message ||
      'TITech observability bootstrap operation failed.',

    {
      code:
        options.code ||
        'OBSERVABILITY_BOOTSTRAP_FAILED',

      phase:
        options.phase ||
        'bootstrap',

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      cause:
        error,

      details: {
        cause:
          safeError(error),
      },
    },
  );
}

/**
 * =============================================================================
 * LIFECYCLE REGISTRATION
 * =============================================================================
 */

function registerObservabilityHooks(
  context = {},
  options = {},
) {
  assertObservability();

  if (
    !isFunction(lifecycle)
  ) {
    throw new ObservabilityBootstrapError(
      'TITech lifecycle registration function is unavailable.',
      {
        code:
          'OBSERVABILITY_LIFECYCLE_UNAVAILABLE',

        phase:
          'registration',
      },
    );
  }

  if (
    hooks &&
    isFunction(hooks.has) &&
    hooks.has(COMPONENT)
  ) {
    registered = true;

    if (
      isFunction(hooks.get)
    ) {
      registrationResult =
        hooks.get(
          COMPONENT,
        );
    }

    if (
      lifecycleState ===
      LIFECYCLE_STATES.IDLE
    ) {
      transition(
        LIFECYCLE_STATES.REGISTERED,
      );
    }

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

        start:
          async (
            hookContext = {},
          ) =>
            initialize(
              isObject(
                hookContext,
              )
                ? hookContext
                : context,

              {
                timeoutMs,

                initializeOptions:
                  options.initializeOptions,

                source:
                  'lifecycle',
              },
            ),

        ready:
          async () => {
            const result =
              await readiness({
                timeoutMs,
              });

            return (
              result.ready ===
              true
            );
          },

        health:
          async () =>
            health({
              timeoutMs,
            }),

        stop:
          async (
            hookContext = {},
          ) =>
            shutdown({
              timeoutMs,

              reason:
                hookContext?.reason ??
                'lifecycle',

              shutdownOptions:
                options.shutdownOptions,
            }),
      },
    );

  registered = true;

  if (
    lifecycleState ===
    LIFECYCLE_STATES.IDLE
  ) {
    transition(
      LIFECYCLE_STATES.REGISTERED,
    );
  }

  return registrationResult;
}

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
 * INITIALIZE
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
      isObject(context)
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

  if (
    stopPromise
  ) {
    throw new ObservabilityBootstrapError(
      'TITech observability cannot initialize while shutdown is in progress.',
      {
        code:
          'OBSERVABILITY_START_DURING_SHUTDOWN',

        phase:
          'initialization',
      },
    );
  }

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  transition(
    LIFECYCLE_STATES.STARTING,
  );

  startPromise =
    (async () => {
      try {
        const result =
          await withTimeout(
            () =>
              implementation.initialize(
                options.initializeOptions,
              ),
            timeoutMs,
            'TITech observability initialization',
          );

        if (
          isObject(context)
        ) {
          context.observability =
            implementation;
        }

        registered = true;
        started = true;
        stopped = false;
        failed = false;
        degraded = false;
        lastError = null;
        initializedAt =
          new Date();
        stoppedAt = null;

        transition(
          LIFECYCLE_STATES.READY,
        );

        log(
          'info',
          'TITech observability bootstrap initialized.',
          {
            lifecycle:
              'start',

            state:
              getState(),
          },
        );

        return (
          result ??
          implementation
        );
      } catch (
        error
      ) {
        started = false;
        stopped = false;
        failed = true;
        degraded = true;
        lastError = error;

        transition(
          LIFECYCLE_STATES.FAILED,
        );

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
    startPromise = null;
  }
}

/**
 * =============================================================================
 * SHUTDOWN
 * =============================================================================
 */

async function shutdown(
  options = {},
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'shutdown',
      ],
    });

  if (
    stopPromise
  ) {
    return stopPromise;
  }

  if (
    stopped &&
    !started
  ) {
    return true;
  }

  if (
    startPromise
  ) {
    try {
      await startPromise;
    } catch {
      // Continue into shutdown so cleanup can still be attempted.
    }
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

  transition(
    LIFECYCLE_STATES.STOPPING,
  );

  stopPromise =
    (async () => {
      try {
        const result =
          await withTimeout(
            () =>
              implementation.shutdown(
                options.shutdownOptions,
              ),
            timeoutMs,
            'TITech observability shutdown',
          );

        started = false;
        stopped = true;
        failed = false;
        degraded = false;
        lastError = null;
        stoppedAt =
          new Date();

        transition(
          LIFECYCLE_STATES.STOPPED,
        );

        log(
          'info',
          'TITech observability bootstrap stopped.',
          {
            lifecycle:
              'stop',

            reason:
              options.reason ??
              null,

            state:
              getState(),
          },
        );

        return (
          result ??
          true
        );
      } catch (
        error
      ) {
        failed = true;
        stopped = false;
        lastError = error;

        transition(
          LIFECYCLE_STATES.FAILED,
        );

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
    stopPromise = null;
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
 * CANONICAL ACCESS
 * =============================================================================
 */

function getObservability() {
  return assertObservability();
}

/**
 * =============================================================================
 * READINESS
 * =============================================================================
 */

async function readiness(
  options = {},
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'readiness',
      ],
    });

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  try {
    const result =
      await withTimeout(
        () =>
          implementation.readiness(
            options.readinessOptions,
          ),
        timeoutMs,
        'TITech observability readiness',
      );

    const normalized =
      normalizeReadiness(
        result,
      );

    if (
      normalized.ready
    ) {
      degraded = false;

      if (
        started &&
        !failed &&
        !stopped
      ) {
        transition(
          LIFECYCLE_STATES.READY,
        );
      }
    } else {
      degraded = true;

      if (
        started &&
        !failed &&
        !stopped
      ) {
        transition(
          LIFECYCLE_STATES.DEGRADED,
        );
      }
    }

    return normalized;
  } catch (
    error
  ) {
    degraded = true;
    lastError = error;

    if (
      started &&
      !stopped
    ) {
      transition(
        LIFECYCLE_STATES.DEGRADED,
      );
    }

    return Object.freeze({
      ready: false,

      status:
        NOT_READY_STATUS,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      error:
        safeError(error),
    });
  }
}

/**
 * =============================================================================
 * HEALTH
 * =============================================================================
 */

async function health(
  options = {},
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'health',
      ],
    });

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  try {
    return await withTimeout(
      () =>
        implementation.health(
          options.healthOptions,
        ),
      timeoutMs,
      'TITech observability health',
    );
  } catch (
    error
  ) {
    lastError = error;
    degraded = true;

    return Object.freeze({
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
        safeError(error),
    });
  }
}

/**
 * =============================================================================
 * SNAPSHOT
 * =============================================================================
 */

function snapshot() {
  const implementation =
    assertObservability({
      requiredMethods: [
        'snapshot',
      ],
    });

  return Object.freeze({
    ...getState(),

    implementation:
      implementation.snapshot(),
  });
}

/**
 * =============================================================================
 * LIVENESS
 * =============================================================================
 */

function liveness() {
  const implementation =
    assertObservability({
      requiredMethods: [
        'liveness',
      ],
    });

  return implementation.liveness();
}

/**
 * =============================================================================
 * HTTP / METRICS DELEGATION
 * =============================================================================
 */

function middleware(
  ...args
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'middleware',
      ],
    });

  return implementation.middleware(
    ...args,
  );
}

function errorMiddleware(
  ...args
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'errorMiddleware',
      ],
    });

  return implementation.errorMiddleware(
    ...args,
  );
}

function metricsHandler(
  ...args
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'metricsHandler',
      ],
    });

  return implementation.metricsHandler(
    ...args,
  );
}

function metricsText(
  ...args
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'metricsText',
      ],
    });

  return implementation.metricsText(
    ...args,
  );
}

function metricsContentType(
  ...args
) {
  const implementation =
    assertObservability({
      requiredMethods: [
        'metricsContentType',
      ],
    });

  return implementation.metricsContentType(
    ...args,
  );
}

/**
 * =============================================================================
 * CONTEXT / INSTRUMENTATION
 * =============================================================================
 */

function getContext() {
  const implementation =
    assertObservability();

  if (
    !isFunction(
      implementation.getContext,
    )
  ) {
    return {};
  }

  return implementation.getContext();
}

function runWithContext(
  context,
  callback,
) {
  if (
    !isFunction(callback)
  ) {
    throw new TypeError(
      'TITech observability runWithContext callback must be a function.',
    );
  }

  const implementation =
    assertObservability();

  if (
    !isFunction(
      implementation.runWithContext,
    )
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
  if (
    !isFunction(fn)
  ) {
    throw new TypeError(
      'TITech observability instrument callback must be a function.',
    );
  }

  const implementation =
    assertObservability();

  if (
    !isFunction(
      implementation.instrument,
    )
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
    !isFunction(
      implementation.recordError,
    )
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
 * STATE ACCESSORS
 * =============================================================================
 */

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
  return (
    failed ||
    lifecycleState ===
      LIFECYCLE_STATES.FAILED
  );
}

function isDegraded() {
  return (
    degraded ||
    lifecycleState ===
      LIFECYCLE_STATES.DEGRADED
  );
}

function isReady() {
  return (
    lifecycleState ===
      LIFECYCLE_STATES.READY &&
    started &&
    !failed &&
    !stopped
  );
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 *
 * Test/process isolation only.
 *
 * This resets adapter state.
 * It does NOT reset the canonical observability implementation.
 * =============================================================================
 */

function reset() {
  if (
    started ||
    startPromise ||
    stopPromise ||
    lifecycleState ===
      LIFECYCLE_STATES.STARTING ||
    lifecycleState ===
      LIFECYCLE_STATES.STOPPING
  ) {
    throw new ObservabilityBootstrapError(
      'Cannot reset active TITech observability bootstrap state.',
      {
        code:
          'OBSERVABILITY_RESET_NOT_ALLOWED',

        phase:
          'reset',
      },
    );
  }

  observability = null;

  registered = false;

  lifecycleState =
    LIFECYCLE_STATES.IDLE;

  started = false;

  stopped = false;

  failed = false;

  degraded = false;

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

  lastTransitionAt =
    null;

  transitionSequence =
    0;

  return true;
}

/**
 * =============================================================================
 * PUBLIC BOOTSTRAP OBJECT
 * =============================================================================
 */

const observabilityBootstrap =
  Object.freeze({
    registerObservabilityHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    initialize,

    start:
      initialize,

    shutdown,

    stop,

    getObservability,

    getState,

    snapshot,

    readiness,

    health,

    liveness,

    middleware,

    errorMiddleware,

    metricsHandler,

    metricsText,

    metricsContentType,

    getContext,

    runWithContext,

    instrument,

    recordError,

    isRegistered,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    isReady,

    reset,

    normalizeBootstrapError,

    ObservabilityBootstrapError,

    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    LIFECYCLE_STATES,
  });

/**
 * =============================================================================
 * NAMED EXPORTS
 * =============================================================================
 */

export {
  observabilityBootstrap,

  registerObservabilityHooks,

  registerBootstrapHooks,

  initialize,

  shutdown,

  stop,

  getObservability,

  getState,

  snapshot,

  readiness,

  health,

  liveness,

  middleware,

  errorMiddleware,

  metricsHandler,

  metricsText,

  metricsContentType,

  getContext,

  runWithContext,

  instrument,

  recordError,

  isRegistered,

  isStarted,

  isStopped,

  isFailed,

  isDegraded,

  isReady,

  reset,

  normalizeBootstrapError,

  ObservabilityBootstrapError,

  COMPONENT,

  SERVICE_NAME,

  APPLICATION_NAME,

  LIFECYCLE_STATES,
};

/**
 * =============================================================================
 * DEFAULT EXPORT
 * =============================================================================
 */

export default observabilityBootstrap;