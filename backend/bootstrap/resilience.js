'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/resilience.js
 *
 * Purpose:
 *   Enterprise production-grade resilience bootstrap adapter.
 *
 * Responsibilities:
 *   - Integrate the canonical TITech resilience subsystem into bootstrap.
 *   - Register deterministic startup/readiness/health/shutdown lifecycle.
 *   - Preserve the existing resilience implementation.
 *   - Support circuit breakers, retries, bulkheads, timeouts and rate limiting
 *     through the existing resilience subsystem.
 *   - Prevent duplicate initialization.
 *   - Prevent duplicate shutdown.
 *   - Expose resilience diagnostics.
 *   - Integrate with observability and readiness state.
 *   - Support graceful degradation without taking ownership of business logic.
 *
 * Canonical architecture:
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   readiness
 *       ↓
 *   resilience
 *       ↓
 *   database / Redis / queue / event-bus
 *       ↓
 *   middleware
 *       ↓
 *   services
 *       ↓
 *   finance / ledger
 *       ↓
 *   HTTP server
 *
 * IMPORTANT:
 *
 *   This file is an ADAPTER.
 *
 *   It does NOT implement:
 *     - retry algorithms
 *     - circuit breaker algorithms
 *     - database fallback logic
 *     - financial recovery logic
 *     - transaction processing
 *     - queue processing
 *
 *   Existing resilience implementation remains authoritative.
 *
 * Supported canonical implementation locations:
 *
 *   backend/middleware/resilience
 *   backend/middleware/resilience/index.js
 *   backend/resilience
 *   backend/infrastructure/resilience
 *
 * =============================================================================
 */

const {
  hooks,
  lifecycle,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * Optional readiness integration
 * -----------------------------------------------------------------------------
 */

let readinessModule = null;

try {
  // Optional during migration.
  // eslint-disable-next-line global-require
  readinessModule =
    require('./readinessState');
} catch {
  readinessModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional observability integration
 * -----------------------------------------------------------------------------
 */

let observabilityModule = null;

try {
  // Optional during migration.
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'resilience';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const DEFAULT_PRIORITY =
  -500;

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_DEPENDENCIES =
  Object.freeze([
    'observability',
  ]);

const IMPLEMENTATION_CANDIDATES =
  Object.freeze([
    '../middleware/resilience',
    '../middleware/resilience/index',
    '../resilience',
    '../resilience/index',
    '../infrastructure/resilience',
    '../infrastructure/resilience/index',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Errors
 * -----------------------------------------------------------------------------
 */

class ResilienceBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'ResilienceBootstrapError';

    this.code =
      options.code ||
      'RESILIENCE_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      ResilienceBootstrapError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Internal State
 * -----------------------------------------------------------------------------
 */

let implementation =
  null;

let implementationPath =
  null;

let registered =
  false;

let started =
  false;

let stopped =
  false;

let degraded =
  false;

let failed =
  false;

let registrationResult =
  null;

let startPromise =
  null;

let stopPromise =
  null;

let lastError =
  null;

/**
 * -----------------------------------------------------------------------------
 * Utility
 * -----------------------------------------------------------------------------
 */

function moduleExists(
  modulePath,
) {
  try {
    require.resolve(
      modulePath,
    );

    return true;
  } catch (error) {
    if (
      error?.code ===
      'MODULE_NOT_FOUND'
    ) {
      return false;
    }

    throw error;
  }
}

function unwrapModule(
  value,
) {
  if (
    value &&
    value.default
  ) {
    return value.default;
  }

  return value;
}

function resolveResilienceImplementation() {
  if (
    implementation
  ) {
    return {
      implementation,
      path:
        implementationPath,
    };
  }

  for (
    const candidate of
      IMPLEMENTATION_CANDIDATES
  ) {
    if (
      !moduleExists(
        candidate,
      )
    ) {
      continue;
    }

    try {
      const loaded =
        require(candidate);

      implementation =
        unwrapModule(
          loaded,
        );

      implementationPath =
        candidate;

      break;
    } catch (error) {
      throw new ResilienceBootstrapError(
        'Failed to load the TITech resilience implementation.',
        {
          code:
            'RESILIENCE_IMPLEMENTATION_LOAD_FAILED',

          cause:
            error,

          details: {
            candidate,
          },
        },
      );
    }
  }

  return {
    implementation,
    path:
      implementationPath,
  };
}

/**
 * -----------------------------------------------------------------------------
 * Lifecycle Method Discovery
 * -----------------------------------------------------------------------------
 *
 * Existing resilience implementations may expose different APIs. We support
 * common enterprise conventions without requiring a destructive rewrite.
 */

function findMethod(
  target,
  methodNames,
) {
  if (
    !target
  ) {
    return null;
  }

  for (
    const methodName of
      methodNames
  ) {
    if (
      typeof target[
        methodName
      ] ===
      'function'
    ) {
      return {
        name:
          methodName,

        fn:
          target[
            methodName
          ].bind(target),
      };
    }
  }

  return null;
}

function resolveLifecycleContract(
  value,
) {
  const candidates = [
    value,
    value?.resilience,
    value?.manager,
    value?.service,
    value?.instance,
    value?.default,
  ].filter(Boolean);

  let start =
    null;

  let stop =
    null;

  let ready =
    null;

  let health =
    null;

  let middleware =
    null;

  for (
    const candidate of
      candidates
  ) {
    if (
      !start
    ) {
      start =
        findMethod(
          candidate,
          [
            'initialize',
            'init',
            'bootstrap',
            'start',
            'enable',
          ],
        );
    }

    if (
      !stop
    ) {
      stop =
        findMethod(
          candidate,
          [
            'shutdown',
            'close',
            'stop',
            'disable',
            'destroy',
          ],
        );
    }

    if (
      !ready
    ) {
      ready =
        findMethod(
          candidate,
          [
            'isReady',
            'ready',
            'readiness',
          ],
        );
    }

    if (
      !health
    ) {
      health =
        findMethod(
          candidate,
          [
            'health',
            'getHealth',
            'healthCheck',
            'checkHealth',
          ],
        );
    }

    if (
      !middleware
    ) {
      middleware =
        findMethod(
          candidate,
          [
            'middleware',
            'getMiddleware',
            'createMiddleware',
          ],
        );
    }
  }

  return {
    target:
      candidates[0] || value,

    start,

    stop,

    ready,

    health,

    middleware,
  };
}

/**
 * -----------------------------------------------------------------------------
 * Configuration
 * -----------------------------------------------------------------------------
 */

function resolveEnabled(
  context = {},
  options = {},
) {
  if (
    typeof options.enabled ===
    'boolean'
  ) {
    return options.enabled;
  }

  const config =
    context.config ||
    {};

  const environment =
    context.environment ||
    {};

  const candidates = [
    config?.resilience?.enabled,

    config?.infrastructure
      ?.resilience?.enabled,

    environment?.resilience
      ?.enabled,

    process.env
      .RESILIENCE_ENABLED,
  ];

  for (
    const candidate of
      candidates
  ) {
    if (
      typeof candidate ===
      'boolean'
    ) {
      return candidate;
    }

    if (
      candidate !==
        undefined &&
      candidate !==
        null
    ) {
      return [
        '1',
        'true',
        'yes',
        'on',
        'enabled',
      ].includes(
        String(candidate)
          .trim()
          .toLowerCase(),
      );
    }
  }

  return true;
}

/**
 * -----------------------------------------------------------------------------
 * Validation
 * -----------------------------------------------------------------------------
 */

function assertImplementation(
  contract,
) {
  if (
    !contract?.target
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience implementation could not be resolved.',
      {
        code:
          'RESILIENCE_IMPLEMENTATION_UNAVAILABLE',

        details: {
          candidates:
            IMPLEMENTATION_CANDIDATES,
        },
      },
    );
  }

  if (
    !contract.start &&
    !contract.stop
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience implementation does not expose a supported lifecycle API.',
      {
        code:
          'RESILIENCE_IMPLEMENTATION_INVALID',
      },
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * State
 * -----------------------------------------------------------------------------
 */

function getState() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    started,

    stopped,

    degraded,

    failed,

    ready:
      started &&
      !stopped &&
      !failed,

    implementation:
      implementationPath,

    lastError:
      lastError
        ? {
            name:
              lastError.name,

            code:
              lastError.code,

            message:
              lastError.message,
          }
        : null,
  });
}

/**
 * -----------------------------------------------------------------------------
 * Readiness Registration
 * -----------------------------------------------------------------------------
 */

function registerReadinessDependency(
  context = {},
  options = {},
) {
  if (
    !readinessModule
  ) {
    return null;
  }

  const {
    register,
    has,
  } = readinessModule;

  if (
    typeof register !==
    'function'
  ) {
    return null;
  }

  if (
    typeof has ===
      'function' &&
    has(COMPONENT)
  ) {
    return null;
  }

  try {
    return register({
      name:
        COMPONENT,

      severity:
        options.readinessSeverity ||
        'required',

      enabled:
        options.enabled !== false,

      readiness:
        async () => {
          if (
            typeof implementation?.isReady ===
            'function'
          ) {
            return {
              ready:
                Boolean(
                  implementation.isReady(),
                ),
            };
          }

          if (
            typeof implementation?.ready ===
            'function'
          ) {
            const result =
              await implementation.ready();

            return normalizeReadinessResult(
              result,
            );
          }

          return {
            ready:
              started &&
              !failed &&
              !stopped,
          };
        },

      health:
        async () => {
          if (
            typeof implementation?.health ===
            'function'
          ) {
            return implementation.health();
          }

          return {
            ready:
              started &&
              !failed &&
              !stopped,

            status:
              failed
                ? 'unhealthy'
                : degraded
                  ? 'degraded'
                  : 'healthy',
          };
        },

      timeoutMs:
        options.readinessTimeoutMs ||
        5_000,

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        implementation:
          implementationPath ||
          'unknown',
      },
    });
  } catch (error) {
    lastError =
      error;

    return null;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Result Normalization
 * -----------------------------------------------------------------------------
 */

function normalizeReadinessResult(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      ready:
        result,
    };
  }

  if (
    !result
  ) {
    return {
      ready:
        true,
    };
  }

  if (
    typeof result ===
    'object'
  ) {
    return {
      ...result,

      ready:
        result.ready !==
          false &&
        result.status !==
          'unhealthy' &&
        result.status !==
          'not_ready',
    };
  }

  return {
    ready:
      Boolean(result),
  };
}

/**
 * -----------------------------------------------------------------------------
 * Observability Helpers
 * -----------------------------------------------------------------------------
 */

function emitObservabilityEvent(
  event,
  payload = {},
) {
  try {
    if (
      observabilityModule
        ?.observability
        ?.emitEvent
    ) {
      return observabilityModule
        .observability
        .emitEvent(
          event,
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            ...payload,
          },
        );
    }

    if (
      typeof observabilityModule
        ?.emitEvent ===
      'function'
    ) {
      return observabilityModule.emitEvent(
        event,
        {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          ...payload,
        },
      );
    }
  } catch (error) {
    /**
     * Observability failure must never prevent the resilience subsystem from
     * starting or stopping.
     */
    return null;
  }

  return null;
}

/**
 * -----------------------------------------------------------------------------
 * Registration
 * -----------------------------------------------------------------------------
 */

function registerResilienceHooks(
  context = {},
  options = {},
) {
  /**
   * ---------------------------------------------------------------------------
   * Duplicate Registration
   * ---------------------------------------------------------------------------
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

  const enabled =
    resolveEnabled(
      context,
      options,
    );

  /**
   * Disabled resilience is allowed for development/test configurations, but
   * must be explicit.
   */
  if (
    !enabled
  ) {
    registered =
      true;

    degraded =
      true;

    registrationResult =
      lifecycle(
        COMPONENT,
        {
          priority:
            options.priority ??
            DEFAULT_PRIORITY,

          dependencies:
            options.dependencies ||
            DEFAULT_DEPENDENCIES,

          enabled:
            false,

          critical:
            options.critical === true,

          metadata: {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            disabled:
              true,
          },

          start:
            async () => {
              degraded =
                true;

              emitObservabilityEvent(
                'resilience.disabled',
                {
                  reason:
                    'configuration',
                },
              );

              return {
                enabled:
                  false,
              };
            },

          stop:
            async () => {
              stopped =
                true;
            },
        },
      );

    return registrationResult;
  }

  /**
   * ---------------------------------------------------------------------------
   * Resolve Existing Implementation
   * ---------------------------------------------------------------------------
   */

  const resolved =
    resolveResilienceImplementation();

  const contract =
    resolveLifecycleContract(
      resolved.implementation,
    );

  assertImplementation(
    contract,
  );

  /**
   * ---------------------------------------------------------------------------
   * Readiness Dependency
   * ---------------------------------------------------------------------------
   */

  registerReadinessDependency(
    context,
    options,
  );

  /**
   * ---------------------------------------------------------------------------
   * Register Lifecycle Hook
   * ---------------------------------------------------------------------------
   */

  registrationResult =
    lifecycle(
      COMPONENT,
      {
        priority:
          Number.isInteger(
            options.priority,
          )
            ? options.priority
            : DEFAULT_PRIORITY,

        dependencies:
          Array.isArray(
            options.dependencies,
          )
            ? options.dependencies
            : [
                ...DEFAULT_DEPENDENCIES,
              ],

        timeoutMs:
          Number.isInteger(
            options.timeoutMs,
          ) &&
          options.timeoutMs > 0
            ? options.timeoutMs
            : DEFAULT_TIMEOUT_MS,

        critical:
          options.critical !==
          false,

        enabled:
          true,

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          implementation:
            implementationPath,

          subsystem:
            'resilience',
        },

        /**
         * ---------------------------------------------------------------------
         * START
         * ---------------------------------------------------------------------
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

                  /**
                   * Resolve implementation again in case a lazy-loaded
                   * subsystem became available after initial registration.
                   */
                  const current =
                    resolveResilienceImplementation();

                  const currentContract =
                    resolveLifecycleContract(
                      current.implementation,
                    );

                  assertImplementation(
                    currentContract,
                  );

                  /**
                   * Prefer an explicit bootstrap context when the existing
                   * resilience implementation supports it.
                   */
                  let result;

                  if (
                    currentContract.start
                  ) {
                    result =
                      await currentContract
                        .start
                        .fn(
                          {
                            ...runtimeContext,

                            resilience:
                              current.implementation,

                            component:
                              COMPONENT,

                            service:
                              SERVICE_NAME,
                          },
                        );
                  }

                  implementation =
                    current.implementation;

                  implementationPath =
                    current.path;

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

                  /**
                   * Publish the canonical resilience implementation into the
                   * shared bootstrap context.
                   */
                  if (
                    runtimeContext &&
                    typeof runtimeContext ===
                      'object'
                  ) {
                    runtimeContext.resilience =
                      implementation;
                  }

                  emitObservabilityEvent(
                    'resilience.started',
                    {
                      implementation:
                        implementationPath,
                    },
                  );

                  return (
                    result ??
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

                  emitObservabilityEvent(
                    'resilience.start_failed',
                    {
                      error: {
                        name:
                          error?.name,

                        code:
                          error?.code,

                        message:
                          error?.message,
                      },
                    },
                  );

                  throw wrapError(
                    error,
                    'RESILIENCE_START_FAILED',
                    'startup',
                    'TITech resilience subsystem startup failed.',
                  );
                }
              })();

            try {
              return await startPromise;
            } finally {
              if (
                failed
              ) {
                startPromise =
                  null;
              }
            }
          },

        /**
         * ---------------------------------------------------------------------
         * READY
         * ---------------------------------------------------------------------
         */

        ready:
          async () => {
            try {
              const current =
                resolveLifecycleContract(
                  implementation,
                );

              if (
                current.ready
              ) {
                return normalizeReadinessResult(
                  await current
                    .ready
                    .fn(),
                ).ready;
              }

              return (
                started &&
                !failed &&
                !stopped
              );
            } catch (error) {
              lastError =
                error;

              return false;
            }
          },

        /**
         * ---------------------------------------------------------------------
         * HEALTH
         * ---------------------------------------------------------------------
         */

        health:
          async () => {
            try {
              const current =
                resolveLifecycleContract(
                  implementation,
                );

              if (
                current.health
              ) {
                return current.health.fn();
              }

              return {
                status:
                  failed
                    ? 'unhealthy'
                    : degraded
                      ? 'degraded'
                      : started
                        ? 'healthy'
                        : 'unknown',

                component:
                  COMPONENT,

                service:
                  SERVICE_NAME,

                ready:
                  started &&
                  !failed &&
                  !stopped,
              };
            } catch (error) {
              lastError =
                error;

              return {
                status:
                  'unhealthy',

                component:
                  COMPONENT,

                service:
                  SERVICE_NAME,

                error: {
                  name:
                    error?.name,

                  code:
                    error?.code,

                  message:
                    error?.message,
                },
              };
            }
          },

        /**
         * ---------------------------------------------------------------------
         * STOP
         * ---------------------------------------------------------------------
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
                  const current =
                    resolveLifecycleContract(
                      implementation,
                    );

                  if (
                    current.stop
                  ) {
                    await current.stop.fn(
                      {
                        ...(hookContext ||
                          {}),

                        resilience:
                          implementation,

                        component:
                          COMPONENT,

                        service:
                          SERVICE_NAME,
                      },
                    );
                  }

                  started =
                    false;

                  stopped =
                    true;

                  degraded =
                    false;

                  failed =
                    false;

                  emitObservabilityEvent(
                    'resilience.stopped',
                  );

                  return true;
                } catch (error) {
                  failed =
                    true;

                  stopped =
                    false;

                  lastError =
                    error;

                  emitObservabilityEvent(
                    'resilience.stop_failed',
                    {
                      error: {
                        name:
                          error?.name,

                        code:
                          error?.code,

                        message:
                          error?.message,
                      },
                    },
                  );

                  throw wrapError(
                    error,
                    'RESILIENCE_STOP_FAILED',
                    'shutdown',
                    'TITech resilience subsystem shutdown failed.',
                  );
                }
              })();

            return stopPromise;
          },
      },
    );

  registered =
    true;

  return registrationResult;
}

/**
 * -----------------------------------------------------------------------------
 * Canonical Bootstrap Contract
 * -----------------------------------------------------------------------------
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerResilienceHooks(
    context,
    options,
  );
}

/**
 * -----------------------------------------------------------------------------
 * Explicit Initialization
 * -----------------------------------------------------------------------------
 *
 * Useful for worker/CLI/test entry points.
 *
 * Normal application startup should use lifecycle registration.
 */

async function initialize(
  context = {},
  options = {},
) {
  const enabled =
    resolveEnabled(
      context,
      options,
    );

  if (
    !enabled
  ) {
    degraded =
      true;

    registered =
      true;

    return {
      enabled:
        false,

      resilience:
        null,
    };
  }

  if (
    started &&
    !stopped &&
    !failed
  ) {
    return implementation;
  }

  if (
    startPromise
  ) {
    return startPromise;
  }

  const resolved =
    resolveResilienceImplementation();

  const contract =
    resolveLifecycleContract(
      resolved.implementation,
    );

  assertImplementation(
    contract,
  );

  startPromise =
    (async () => {
      try {
        if (
          contract.start
        ) {
          await contract.start.fn(
            context,
          );
        }

        implementation =
          resolved.implementation;

        implementationPath =
          resolved.path;

        registered =
          true;

        started =
          true;

        stopped =
          false;

        degraded =
          false;

        failed =
          false;

        lastError =
          null;

        if (
          context &&
          typeof context ===
            'object'
        ) {
          context.resilience =
            implementation;
        }

        emitObservabilityEvent(
          'resilience.started',
          {
            implementation:
              implementationPath,
          },
        );

        return implementation;
      } catch (error) {
        failed =
          true;

        degraded =
          true;

        started =
          false;

        lastError =
          error;

        startPromise =
          null;

        throw wrapError(
          error,
          'RESILIENCE_INITIALIZATION_FAILED',
          'initialization',
          'TITech resilience initialization failed.',
        );
      }
    })();

  return startPromise;
}

/**
 * -----------------------------------------------------------------------------
 * Explicit Shutdown
 * -----------------------------------------------------------------------------
 */

async function shutdown() {
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

  stopPromise =
    (async () => {
      try {
        const contract =
          resolveLifecycleContract(
            implementation,
          );

        if (
          contract.stop
        ) {
          await contract.stop.fn();
        }

        started =
          false;

        stopped =
          true;

        degraded =
          false;

        failed =
          false;

        emitObservabilityEvent(
          'resilience.stopped',
        );

        return true;
      } catch (error) {
        failed =
          true;

        stopped =
          false;

        lastError =
          error;

        throw wrapError(
          error,
          'RESILIENCE_SHUTDOWN_FAILED',
          'shutdown',
          'TITech resilience shutdown failed.',
        );
      }
    })();

  return stopPromise;
}

async function stop() {
  return shutdown();
}

/**
 * -----------------------------------------------------------------------------
 * Runtime Access
 * -----------------------------------------------------------------------------
 */

function getResilience() {
  return implementation;
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
 * -----------------------------------------------------------------------------
 * Health / Readiness
 * -----------------------------------------------------------------------------
 */

async function readiness() {
  const contract =
    resolveLifecycleContract(
      implementation,
    );

  if (
    contract.ready
  ) {
    return normalizeReadinessResult(
      await contract.ready.fn(),
    );
  }

  return {
    ready:
      isReady(),

    status:
      failed
        ? 'not_ready'
        : degraded
          ? 'degraded'
          : isReady()
            ? 'ready'
            : 'not_ready',
  };
}

async function health() {
  const contract =
    resolveLifecycleContract(
      implementation,
    );

  if (
    contract.health
  ) {
    return contract.health.fn();
  }

  return {
    status:
      failed
        ? 'unhealthy'
        : degraded
          ? 'degraded'
          : started
            ? 'healthy'
            : 'unknown',

    ready:
      isReady(),

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    implementation:
      implementationPath,
  };
}

/**
 * -----------------------------------------------------------------------------
 * Middleware
 * -----------------------------------------------------------------------------
 *
 * Resilience middleware remains owned by the existing resilience subsystem.
 */

function middleware(
  ...args
) {
  const contract =
    resolveLifecycleContract(
      implementation,
    );

  if (
    contract.middleware
  ) {
    return contract.middleware.fn(
      ...args,
    );
  }

  if (
    typeof implementation?.middleware ===
    'function'
  ) {
    return implementation.middleware(
      ...args,
    );
  }

  return null;
}

/**
 * -----------------------------------------------------------------------------
 * Snapshot
 * -----------------------------------------------------------------------------
 */

function snapshot() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    started,

    stopped,

    degraded,

    failed,

    ready:
      isReady(),

    implementation:
      implementationPath,

    lastError:
      lastError
        ? {
            name:
              lastError.name,

            code:
              lastError.code,

            message:
              lastError.message,
          }
        : null,

    implementationState:
      safeImplementationSnapshot(),
  });
}

function safeImplementationSnapshot() {
  if (
    typeof implementation?.snapshot !==
    'function'
  ) {
    return null;
  }

  try {
    return implementation.snapshot();
  } catch (error) {
    return {
      status:
        'unavailable',

      error: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },
    };
  }
}

/**
 * -----------------------------------------------------------------------------
 * Error Wrapper
 * -----------------------------------------------------------------------------
 */

function wrapError(
  error,
  code,
  phase,
  message,
) {
  if (
    error instanceof
    ResilienceBootstrapError
  ) {
    return error;
  }

  return new ResilienceBootstrapError(
    message,
    {
      code,

      phase,

      cause:
        error,
    },
  );
}

/**
 * -----------------------------------------------------------------------------
 * Reset
 * -----------------------------------------------------------------------------
 *
 * Intended for isolated automated tests only.
 */

function reset() {
  if (
    started &&
    !stopped
  ) {
    throw new ResilienceBootstrapError(
      'Cannot reset an active TITech resilience subsystem.',
      {
        code:
          'RESILIENCE_RESET_NOT_ALLOWED',
      },
    );
  }

  implementation =
    null;

  implementationPath =
    null;

  registered =
    false;

  started =
    false;

  stopped =
    false;

  degraded =
    false;

  failed =
    false;

  registrationResult =
    null;

  startPromise =
    null;

  stopPromise =
    null;

  lastError =
    null;

  return true;
}

/**
 * -----------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------
 */

module.exports =
  Object.freeze({
    /**
     * Registration.
     */
    registerResilienceHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Explicit lifecycle.
     */
    initialize,

    start:
      initialize,

    shutdown,

    stop,

    /**
     * Runtime access.
     */
    getResilience,

    /**
     * State.
     */
    getState,

    isRegistered,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    isReady,

    /**
     * Health.
     */
    readiness,

    health,

    /**
     * Middleware bridge.
     */
    middleware,

    /**
     * Diagnostics.
     */
    snapshot,

    /**
     * Test support.
     */
    reset,

    /**
     * Metadata/errors.
     */
    ResilienceBootstrapError,

    COMPONENT,

    SERVICE_NAME,

    IMPLEMENTATION_CANDIDATES,
  });