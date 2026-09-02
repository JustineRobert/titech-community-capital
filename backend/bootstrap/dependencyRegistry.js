'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/dependencyRegistry.js
 *
 * Purpose:
 *   Enterprise production-grade dependency lifecycle registry.
 *
 * Responsibilities:
 *   - Register application/infrastructure dependencies.
 *   - Resolve dependency ordering.
 *   - Initialize dependencies deterministically.
 *   - Support required and optional dependencies.
 *   - Support dependency-on-dependency relationships.
 *   - Prevent duplicate/concurrent initialization.
 *   - Enforce initialization timeouts.
 *   - Track dependency lifecycle state.
 *   - Support readiness and health diagnostics.
 *   - Support graceful reverse-order shutdown.
 *   - Preserve initialized values in a controlled registry.
 *   - Support dependency overrides for tests/runtime composition.
 *   - Integrate cleanly with ApplicationBootstrap.
 *   - Normalize dependency startup failures.
 *
 * Architectural position:
 *
 *   backend/bootstrap/dependencies.js
 *                  │
 *                  ▼
 *   backend/bootstrap/dependencyRegistry.js
 *                  │
 *                  ├── environment
 *                  ├── configuration
 *                  ├── logger
 *                  ├── observability
 *                  ├── readiness
 *                  ├── resilience
 *                  ├── infrastructure
 *                  └── services
 *
 * IMPORTANT:
 *
 *   dependencies.js answers:
 *
 *       "Is the software package available?"
 *
 *   dependencyRegistry.js answers:
 *
 *       "In what order should registered runtime dependencies initialize,
 *        what is their current lifecycle state, and how are they shut down?"
 *
 *   Infrastructure implementations remain authoritative.
 *
 * =============================================================================
 */

const {
  EventEmitter,
} = require('node:events');

/**
 * -----------------------------------------------------------------------------
 * Optional startup error integration
 * -----------------------------------------------------------------------------
 */

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors =
    require('./startupErrors');
} catch {
  startupErrors =
    null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional observability integration
 * -----------------------------------------------------------------------------
 */

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule =
    null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional logger integration
 * -----------------------------------------------------------------------------
 */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule =
    require('./logger');
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
  'dependency-registry';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-backend';

const REGISTRY_STATES =
  Object.freeze({
    CREATED:
      'created',

    INITIALIZING:
      'initializing',

    READY:
      'ready',

    DEGRADED:
      'degraded',

    STOPPING:
      'stopping',

    STOPPED:
      'stopped',

    FAILED:
      'failed',
  });

const DEPENDENCY_TYPES =
  Object.freeze({
    REQUIRED:
      'required',

    OPTIONAL:
      'optional',
  });

const DEPENDENCY_STATES =
  Object.freeze({
    REGISTERED:
      'registered',

    DISABLED:
      'disabled',

    INITIALIZING:
      'initializing',

    READY:
      'ready',

    DEGRADED:
      'degraded',

    FAILED:
      'failed',

    STOPPING:
      'stopping',

    STOPPED:
      'stopped',
  });

const DEFAULTS =
  Object.freeze({
    timeoutMs:
      30_000,

    shutdownTimeoutMs:
      15_000,

    continueOnOptionalFailure:
      true,

    continueOnShutdownFailure:
      true,

    failOnUnknownDependency:
      true,
  });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class DependencyRegistryError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'DependencyRegistryError';

    this.code =
      options.code ||
      'DEPENDENCY_REGISTRY_ERROR';

    this.dependency =
      options.dependency ||
      null;

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
      DependencyRegistryError,
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function normalizeName(
  value,
  field = 'dependency name',
) {
  if (
    typeof value !==
      'string' ||
    value.trim() ===
      ''
  ) {
    throw new TypeError(
      `${field} must be a non-empty string.`,
    );
  }

  return value.trim();
}

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

function hrtimeMs(
  started,
) {
  return (
    Number(
      process.hrtime.bigint() -
        started,
    ) / 1_000_000
  );
}

function sleep(
  milliseconds,
) {
  return new Promise(
    resolve => {
      const timer =
        setTimeout(
          resolve,
          milliseconds,
        );

      timer.unref?.();
    },
  );
}

/**
 * -----------------------------------------------------------------------------
 * Timeout
 * -----------------------------------------------------------------------------
 */

async function withTimeout(
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
                new DependencyRegistryError(
                  `${label} timed out after ${timeoutMs}ms.`,
                  {
                    code:
                      'DEPENDENCY_TIMEOUT',
                  },
                ),
              );
            },
            timeoutMs,
          );

        timer.unref?.();
      },
    );

  try {
    return await Promise.race([
      operation,
      timeout,
    ]);
  } finally {
    clearTimeout(
      timer,
    );
  }
}

/**
 * =============================================================================
 * DependencyRegistry
 * =============================================================================
 */

class DependencyRegistry extends EventEmitter {
  constructor(
    options = {},
  ) {
    super();

    this.options =
      Object.freeze({
        timeoutMs:
          asPositiveInteger(
            options.timeoutMs ??
              process.env.DEPENDENCY_TIMEOUT_MS,
            DEFAULTS.timeoutMs,
          ),

        shutdownTimeoutMs:
          asPositiveInteger(
            options.shutdownTimeoutMs ??
              process.env.DEPENDENCY_SHUTDOWN_TIMEOUT_MS,
            DEFAULTS.shutdownTimeoutMs,
          ),

        continueOnOptionalFailure:
          options.continueOnOptionalFailure ??
          DEFAULTS.continueOnOptionalFailure,

        continueOnShutdownFailure:
          options.continueOnShutdownFailure ??
          DEFAULTS.continueOnShutdownFailure,

        failOnUnknownDependency:
          options.failOnUnknownDependency ??
          DEFAULTS.failOnUnknownDependency,
      });

    this.state =
      REGISTRY_STATES.CREATED;

    this.dependencies =
      new Map();

    this.initializationOrder =
      [];

    this.shutdownOrder =
      [];

    this.initializePromise =
      null;

    this.shutdownPromise =
      null;

    this.initialized =
      false;

    this.ready =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.degraded =
      false;

    this.initializedAt =
      null;

    this.stoppedAt =
      null;

    this.failure =
      null;

    this.errors =
      [];

    this._registered =
      false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Logging
   * ---------------------------------------------------------------------------
   */

  _log(
    level,
    payload,
    message,
  ) {
    try {
      const logger =
        loggerModule?.getLogger?.();

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

            ...payload,
          },
          message,
        );

        return;
      }
    } catch {
      // Best effort only.
    }

    const line =
      `[${COMPONENT}] ${message}`;

    if (
      level === 'error' ||
      level === 'fatal'
    ) {
      process.stderr.write(
        `${line}\n`,
      );
    } else {
      process.stdout.write(
        `${line}\n`,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Observability
   * ---------------------------------------------------------------------------
   */

  _emit(
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
        typeof observabilityModule?.emitEvent ===
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
    } catch {
      // Observability must never block lifecycle management.
    }

    return null;
  }

  /**
   * ===========================================================================
   * Registration
   * ===========================================================================
   */

  register(
    name,
    initializer,
    options = {},
  ) {
    const dependencyName =
      normalizeName(
        name,
      );

    if (
      typeof initializer !==
        'function'
    ) {
      throw new TypeError(
        `Initializer for dependency "${dependencyName}" must be a function.`,
      );
    }

    if (
      this.dependencies.has(
        dependencyName,
      )
    ) {
      throw new DependencyRegistryError(
        `Dependency "${dependencyName}" is already registered.`,
        {
          code:
            'DEPENDENCY_DUPLICATE',

          dependency:
            dependencyName,
        },
      );
    }

    const definition = {
      name:
        dependencyName,

      type:
        options.type ||
        (
          options.required ===
          false
            ? DEPENDENCY_TYPES
                .OPTIONAL
            : DEPENDENCY_TYPES
                .REQUIRED
        ),

      required:
        options.required !==
        false,

      critical:
        options.critical !==
        false,

      enabled:
        options.enabled !==
        false,

      priority:
        Number.isInteger(
          options.priority,
        )
          ? options.priority
          : 0,

      dependencies:
        normalizeDependencies(
          options.dependencies,
        ),

      timeoutMs:
        asPositiveInteger(
          options.timeoutMs,
          this.options
            .timeoutMs,
        ),

      shutdownTimeoutMs:
        asPositiveInteger(
          options.shutdownTimeoutMs,
          this.options
            .shutdownTimeoutMs,
        ),

      initializer,

      shutdown:
        typeof options.shutdown ===
        'function'
          ? options.shutdown
          : typeof options.stop ===
              'function'
            ? options.stop
            : typeof options.close ===
                'function'
              ? options.close
              : null,

      health:
        typeof options.health ===
        'function'
          ? options.health
          : null,

      readiness:
        typeof options.readiness ===
        'function'
          ? options.readiness
          : typeof options.isReady ===
              'function'
            ? options.isReady
            : null,

      value:
        options.value ??
        undefined,

      state:
        options.enabled ===
        false
          ? DEPENDENCY_STATES
              .DISABLED
          : DEPENDENCY_STATES
              .REGISTERED,

      ready:
        false,

      initialized:
        false,

      initializing:
        false,

      stopping:
        false,

      stopped:
        false,

      failed:
        false,

      degraded:
        false,

      initializedAt:
        null,

      stoppedAt:
        null,

      durationMs:
        null,

      shutdownDurationMs:
        null,

      error:
        null,

      healthResult:
        null,

      metadata:
        {
          ...(options.metadata ||
            {}),
        },

      initializePromise:
        null,

      shutdownPromise:
        null,

      registeredAt:
        new Date(),
    };

    this.dependencies.set(
      dependencyName,
      definition,
    );

    this._registered =
      true;

    this.emit(
      'registered',
      this._safeRecord(
        definition,
      ),
    );

    return this;
  }

  /**
   * ---------------------------------------------------------------------------
   * Registration aliases
   * ---------------------------------------------------------------------------
   */

  add(
    name,
    initializer,
    options,
  ) {
    return this.register(
      name,
      initializer,
      options,
    );
  }

  define(
    name,
    initializer,
    options,
  ) {
    return this.register(
      name,
      initializer,
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Unregister
   * ---------------------------------------------------------------------------
   */

  unregister(
    name,
  ) {
    const dependencyName =
      normalizeName(
        name,
      );

    const definition =
      this.dependencies.get(
        dependencyName,
      );

    if (
      definition?.initialized &&
      !definition.stopped
    ) {
      throw new DependencyRegistryError(
        `Cannot unregister active dependency "${dependencyName}".`,
        {
          code:
            'DEPENDENCY_ACTIVE_CANNOT_UNREGISTER',

          dependency:
            dependencyName,
        },
      );
    }

    return this.dependencies.delete(
      dependencyName,
    );
  }

  /**
   * ===========================================================================
   * Lookup
   * ===========================================================================
   */

  has(
    name,
  ) {
    return this.dependencies.has(
      normalizeName(
        name,
      ),
    );
  }

  get(
    name,
  ) {
    const definition =
      this.dependencies.get(
        normalizeName(
          name,
        ),
      );

    return definition?.value;
  }

  require(
    name,
  ) {
    const dependencyName =
      normalizeName(
        name,
      );

    const definition =
      this.dependencies.get(
        dependencyName,
      );

    if (
      !definition
    ) {
      throw new DependencyRegistryError(
        `TITech dependency "${dependencyName}" is not registered.`,
        {
          code:
            'DEPENDENCY_NOT_REGISTERED',

          dependency:
            dependencyName,
        },
      );
    }

    if (
      !definition.initialized ||
      definition.failed ||
      definition.stopped
    ) {
      throw new DependencyRegistryError(
        `TITech dependency "${dependencyName}" is not ready.`,
        {
          code:
            'DEPENDENCY_NOT_READY',

          dependency:
            dependencyName,

          details: {
            state:
              definition.state,
          },
        },
      );
    }

    return definition.value;
  }

  getDefinition(
    name,
  ) {
    const definition =
      this.dependencies.get(
        normalizeName(
          name,
        ),
      );

    return definition
      ? this._safeRecord(
          definition,
        )
      : undefined;
  }

  /**
   * ===========================================================================
   * Dependency Resolution
   * ===========================================================================
   */

  resolveOrder() {
    const active =
      [
        ...this.dependencies.values(),
      ].filter(
        definition =>
          definition.enabled,
      );

    const map =
      new Map(
        active.map(
          definition => [
            definition.name,
            definition,
          ],
        ),
      );

    const incoming =
      new Map();

    const outgoing =
      new Map();

    for (
      const definition of
        active
    ) {
      incoming.set(
        definition.name,
        0,
      );

      outgoing.set(
        definition.name,
        new Set(),
      );
    }

    for (
      const definition of
        active
    ) {
      for (
        const dependency of
          definition.dependencies
      ) {
        if (
          !map.has(
            dependency,
          )
        ) {
          if (
            this.options
              .failOnUnknownDependency
          ) {
            throw new DependencyRegistryError(
              `Dependency "${definition.name}" references unknown dependency "${dependency}".`,
              {
                code:
                  'DEPENDENCY_UNKNOWN_DEPENDENCY',

                dependency:
                  definition.name,

                details: {
                  dependency,
                },
              },
            );
          }

          continue;
        }

        if (
          dependency ===
          definition.name
        ) {
          throw new DependencyRegistryError(
            `Dependency "${definition.name}" cannot depend on itself.`,
            {
              code:
                'DEPENDENCY_SELF_REFERENCE',

              dependency:
                definition.name,
            },
          );
        }

        incoming.set(
          definition.name,
          incoming.get(
            definition.name,
          ) + 1,
        );

        outgoing
          .get(
            dependency,
          )
          .add(
            definition.name,
          );
      }
    }

    const ready =
      active
        .filter(
          definition =>
            incoming.get(
              definition.name,
            ) === 0,
        )
        .sort(
          compareDefinitions,
        );

    const order = [];

    while (
      ready.length >
      0
    ) {
      const current =
        ready.shift();

      order.push(
        current,
      );

      for (
        const dependent of
          outgoing.get(
            current.name,
          )
      ) {
        const remaining =
          incoming.get(
            dependent,
          ) - 1;

        incoming.set(
          dependent,
          remaining,
        );

        if (
          remaining ===
          0
        ) {
          ready.push(
            map.get(
              dependent,
            ),
          );

          ready.sort(
            compareDefinitions,
          );
        }
      }
    }

    if (
      order.length !==
      active.length
    ) {
      const cyclic =
        active
          .filter(
            definition =>
              incoming.get(
                definition.name,
              ) > 0,
          )
          .map(
            definition =>
              definition.name,
          );

      throw new DependencyRegistryError(
        'Circular TITech dependency graph detected.',
        {
          code:
            'DEPENDENCY_CYCLE',

          details: {
            dependencies:
              cyclic,
          },
        },
      );
    }

    this.initializationOrder =
      order.map(
        definition =>
          definition.name,
      );

    this.shutdownOrder =
      [...order]
        .reverse()
        .map(
          definition =>
            definition.name,
        );

    return [
      ...order,
    ];
  }

  /**
   * ===========================================================================
   * Initialization
   * ===========================================================================
   */

  async initialize(
    context = {},
  ) {
    if (
      this.initialized &&
      this.ready &&
      !this.stopping
    ) {
      return this.getValues();
    }

    if (
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    this.initializePromise =
      (async () => {
        this.state =
          REGISTRY_STATES
            .INITIALIZING;

        this.failed =
          false;

        this.failure =
          null;

        this.stopping =
          false;

        try {
          const order =
            this.resolveOrder();

          for (
            const definition of
              order
          ) {
            await this._initializeDefinition(
              definition,
              context,
            );
          }

          const requiredFailures =
            this._getRequiredFailures();

          const optionalFailures =
            this._getOptionalFailures();

          if (
            requiredFailures.length >
            0
          ) {
            throw new DependencyRegistryError(
              'One or more required TITech dependencies failed during initialization.',
              {
                code:
                  'DEPENDENCY_REQUIRED_INITIALIZATION_FAILED',

                details: {
                  dependencies:
                    requiredFailures,
                },
              },
            );
          }

          this.initialized =
            true;

          this.ready =
            true;

          this.stopping =
            false;

          this.stopped =
            false;

          this.failed =
            false;

          this.degraded =
            optionalFailures.length >
            0;

          this.state =
            this.degraded
              ? REGISTRY_STATES
                  .DEGRADED
              : REGISTRY_STATES
                  .READY;

          this.initializedAt =
            new Date();

          this._emit(
            'dependencies.ready',
            {
              total:
                order.length,

              degraded:
                this.degraded,

              optionalFailures,
            },
          );

          return this.getValues();
        } catch (error) {
          this.failed =
            true;

          this.ready =
            false;

          this.initialized =
            false;

          this.state =
            REGISTRY_STATES
              .FAILED;

          this.failure =
            this._normalizeError(
              error,
            );

          throw this.failure;
        }
      })();

    try {
      return await this.initializePromise;
    } finally {
      this.initializePromise =
        null;
    }
  }

  async _initializeDefinition(
    definition,
    context,
  ) {
    if (
      definition.enabled ===
      false
    ) {
      definition.state =
        DEPENDENCY_STATES
          .DISABLED;

      definition.ready =
        !definition.required;

      return;
    }

    if (
      definition.initialized &&
      definition.ready
    ) {
      return definition.value;
    }

    if (
      definition.initializePromise
    ) {
      return definition.initializePromise;
    }

    definition.initializing =
      true;

    definition.state =
      DEPENDENCY_STATES
        .INITIALIZING;

    definition.failed =
      false;

    definition.error =
      null;

    const startedAt =
      process.hrtime.bigint();

    definition.initializePromise =
      (async () => {
        try {
          /**
           * Dependencies have already been topologically sorted, therefore
           * required parents should already be initialized.
           */
          this._assertDependenciesReady(
            definition,
          );

          const dependencyContext =
            this._createDependencyContext(
              definition,
              context,
            );

          const result =
            await withTimeout(
              () =>
                definition.initializer(
                  dependencyContext,
                ),
              definition.timeoutMs,
              `TITech dependency "${definition.name}" initialization`,
            );

          definition.value =
            result;

          definition.initialized =
            true;

          definition.initializing =
            false;

          definition.failed =
            false;

          definition.stopped =
            false;

          definition.ready =
            await this._evaluateReady(
              definition,
              dependencyContext,
              result,
            );

          definition.state =
            definition.ready
              ? DEPENDENCY_STATES
                  .READY
              : DEPENDENCY_STATES
                  .DEGRADED;

          definition.degraded =
            !definition.ready;

          definition.initializedAt =
            new Date();

          definition.durationMs =
            hrtimeMs(
              startedAt,
            );

          this._emit(
            'dependency.ready',
            {
              dependency:
                definition.name,

              durationMs:
                definition.durationMs,
            },
          );

          this._log(
            'info',
            {
              dependency:
                definition.name,

              durationMs:
                definition.durationMs,
            },
            `TITech dependency "${definition.name}" initialized.`,
          );

          return result;
        } catch (error) {
          definition.initializing =
            false;

          definition.initialized =
            false;

          definition.ready =
            false;

          definition.failed =
            true;

          definition.degraded =
            true;

          definition.state =
            DEPENDENCY_STATES
              .FAILED;

          definition.error =
            safeError(
              error,
            );

          definition.durationMs =
            hrtimeMs(
              startedAt,
            );

          this._emit(
            'dependency.failed',
            {
              dependency:
                definition.name,

              error:
                safeError(
                  error,
                ),

              durationMs:
                definition.durationMs,
            },
          );

          if (
            definition.required ||
            definition.critical
          ) {
            throw this._normalizeError(
              error,
              definition,
            );
          }

          if (
            !this.options
              .continueOnOptionalFailure
          ) {
            throw this._normalizeError(
              error,
              definition,
            );
          }

          this.degraded =
            true;

          return null;
        }
      })();

    try {
      return await definition.initializePromise;
    } finally {
      definition.initializePromise =
        null;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Dependency readiness
   * ---------------------------------------------------------------------------
   */

  _assertDependenciesReady(
    definition,
  ) {
    for (
      const dependencyName of
        definition.dependencies
    ) {
      const dependency =
        this.dependencies.get(
          dependencyName,
        );

      if (
        !dependency
      ) {
        if (
          this.options
            .failOnUnknownDependency
        ) {
          throw new DependencyRegistryError(
            `Dependency "${definition.name}" requires unknown dependency "${dependencyName}".`,
            {
              code:
                'DEPENDENCY_REQUIRED_NOT_REGISTERED',

              dependency:
                definition.name,

              details: {
                dependency:
                  dependencyName,
              },
            },
          );
        }

        continue;
      }

      if (
        !dependency.ready &&
        (
          dependency.required ||
          dependency.critical
        )
      ) {
        throw new DependencyRegistryError(
          `Dependency "${definition.name}" cannot initialize because "${dependencyName}" is not ready.`,
          {
            code:
              'DEPENDENCY_PREREQUISITE_NOT_READY',

            dependency:
              definition.name,

            details: {
              prerequisite:
                dependencyName,

              prerequisiteState:
                dependency.state,
            },
          },
        );
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness callback
   * ---------------------------------------------------------------------------
   */

  async _evaluateReady(
    definition,
    context,
    value,
  ) {
    if (
      !definition.readiness
    ) {
      return true;
    }

    const result =
      await withTimeout(
        () =>
          definition.readiness({
            ...context,

            dependency:
              definition,

            value,
          }),
        definition.timeoutMs,
        `TITech dependency "${definition.name}" readiness`,
      );

    if (
      typeof result ===
      'boolean'
    ) {
      return result;
    }

    if (
      result &&
      typeof result ===
        'object'
    ) {
      return (
        result.ready !==
          false &&
        result.status !==
          'unhealthy' &&
        result.status !==
          'not_ready'
      );
    }

    return Boolean(
      result,
    );
  }

  /**
   * ===========================================================================
   * Shutdown
   * ===========================================================================
   */

  async shutdown(
    context = {},
  ) {
    if (
      this.shutdownPromise
    ) {
      return this.shutdownPromise;
    }

    if (
      this.stopped
    ) {
      return true;
    }

    this.shutdownPromise =
      (async () => {
        this.state =
          REGISTRY_STATES
            .STOPPING;

        this.stopping =
          true;

        this.ready =
          false;

        const failures = [];

        try {
          /**
           * Ensure shutdown order reflects the final dependency graph.
           */
          const order =
            this.shutdownOrder.length
              ? [
                  ...this.shutdownOrder,
                ]
              : this.resolveOrder()
                  .map(
                    definition =>
                      definition.name,
                  )
                  .reverse();

          for (
            const dependencyName of
              order
          ) {
            const definition =
              this.dependencies.get(
                dependencyName,
              );

            if (
              !definition
            ) {
              continue;
            }

            try {
              await this._shutdownDefinition(
                definition,
                context,
              );
            } catch (error) {
              failures.push({
                dependency:
                  definition.name,

                critical:
                  definition.critical,

                error:
                  safeError(
                    error,
                  ),
              });

              if (
                definition.critical &&
                !this.options
                  .continueOnShutdownFailure
              ) {
                throw error;
              }
            }
          }

          this.stopping =
            false;

          this.stopped =
            true;

          this.initialized =
            false;

          this.ready =
            false;

          this.failed =
            failures.length >
            0;

          this.degraded =
            false;

          this.state =
            failures.length >
            0
              ? REGISTRY_STATES
                  .FAILED
              : REGISTRY_STATES
                  .STOPPED;

          this.stoppedAt =
            new Date();

          if (
            failures.length >
            0
          ) {
            this.errors.push(
              ...failures,
            );

            this.failure =
              new DependencyRegistryError(
                'One or more TITech dependencies failed during shutdown.',
                {
                  code:
                    'DEPENDENCY_SHUTDOWN_PARTIAL_FAILURE',

                  details: {
                    failures,
                  },
                },
              );
          }

          this._emit(
            'dependencies.stopped',
            {
              failures:
                failures.length,
            },
          );

          return failures.length ===
            0;
        } catch (error) {
          this.stopping =
            false;

          this.failed =
            true;

          this.ready =
            false;

          this.state =
            REGISTRY_STATES
              .FAILED;

          this.failure =
            this._normalizeError(
              error,
            );

          throw this.failure;
        }
      })();

    try {
      return await this.shutdownPromise;
    } finally {
      this.shutdownPromise =
        null;
    }
  }

  async stop(
    context = {},
  ) {
    return this.shutdown(
      context,
    );
  }

  async _shutdownDefinition(
    definition,
    context,
  ) {
    if (
      !definition.initialized ||
      definition.stopped
    ) {
      return;
    }

    definition.stopping =
      true;

    definition.state =
      DEPENDENCY_STATES
        .STOPPING;

    const startedAt =
      process.hrtime.bigint();

    try {
      if (
        definition.shutdown
      ) {
        await withTimeout(
          () =>
            definition.shutdown({
              ...context,

              dependency:
                definition,

              value:
                definition.value,

              registry:
                this,
            }),
          definition.shutdownTimeoutMs,
          `TITech dependency "${definition.name}" shutdown`,
        );
      }

      definition.initialized =
        false;

      definition.ready =
        false;

      definition.stopping =
        false;

      definition.stopped =
        true;

      definition.state =
        DEPENDENCY_STATES
          .STOPPED;

      definition.stoppedAt =
        new Date();

      definition.shutdownDurationMs =
        hrtimeMs(
          startedAt,
        );

      this._emit(
        'dependency.stopped',
        {
          dependency:
            definition.name,

          durationMs:
            definition.shutdownDurationMs,
        },
      );
    } catch (error) {
      definition.stopping =
        false;

      definition.failed =
        true;

      definition.state =
        DEPENDENCY_STATES
          .FAILED;

      definition.error =
        safeError(
          error,
        );

      definition.shutdownDurationMs =
        hrtimeMs(
          startedAt,
        );

      throw new DependencyRegistryError(
        `TITech dependency "${definition.name}" failed during shutdown.`,
        {
          code:
            'DEPENDENCY_SHUTDOWN_FAILED',

          dependency:
            definition.name,

          cause:
            error,
        },
      );
    } finally {
      /**
       * Retain the value for diagnostics and possible test inspection, but do
       * not consider it active after shutdown.
       */
    }
  }

  /**
   * ===========================================================================
   * Health
   * ===========================================================================
   */

  async health(
    options = {},
  ) {
    const results = {};

    for (
      const definition of
        this.dependencies.values()
    ) {
      if (
        !definition.enabled
      ) {
        results[
          definition.name
        ] = {
          status:
            'disabled',

          healthy:
            !definition.required,

          ready:
            !definition.required,
        };

        continue;
      }

      if (
        typeof definition.health !==
        'function'
      ) {
        results[
          definition.name
        ] = {
          status:
            definition.failed
              ? 'unhealthy'
              : definition.ready
                ? 'healthy'
                : 'not_ready',

          healthy:
            definition.ready &&
            !definition.failed,

          ready:
            definition.ready,

          state:
            definition.state,
        };

        continue;
      }

      try {
        const value =
          await withTimeout(
            () =>
              definition.health({
                dependency:
                  definition,

                value:
                  definition.value,
              }),
            options.timeoutMs ||
              definition.timeoutMs,
            `TITech dependency "${definition.name}" health`,
          );

        results[
          definition.name
        ] =
          normalizeHealthResult(
            value,
            definition,
          );
      } catch (error) {
        results[
          definition.name
        ] = {
          status:
            'unhealthy',

          healthy:
            false,

          ready:
            false,

          error:
            safeError(
              error,
            ),
        };
      }
    }

    const required =
      [
        ...this.dependencies.values(),
      ].filter(
        definition =>
          definition.required &&
          definition.enabled,
      );

    const requiredFailures =
      required
        .filter(
          definition =>
            !results[
              definition.name
            ]?.ready,
        )
        .map(
          definition =>
            definition.name,
        );

    const optionalFailures =
      [
        ...this.dependencies.values(),
      ]
        .filter(
          definition =>
            definition.optional &&
            definition.enabled,
        )
        .filter(
          definition =>
            !results[
              definition.name
            ]?.ready,
        )
        .map(
          definition =>
            definition.name,
        );

    return {
      status:
        requiredFailures.length >
        0
          ? 'unhealthy'
          : optionalFailures.length >
              0
            ? 'degraded'
            : 'healthy',

      healthy:
        requiredFailures.length ===
        0,

      ready:
        requiredFailures.length ===
        0,

      degraded:
        optionalFailures.length >
        0,

      requiredFailures,

      optionalFailures,

      dependencies:
        results,

      timestamp:
        new Date().toISOString(),
    };
  }

  async readiness() {
    const status =
      await this.health();

    return {
      ready:
        status.ready,

      status:
        status.status,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      registryState:
        this.state,

      requiredFailures:
        status.requiredFailures,

      optionalFailures:
        status.optionalFailures,

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ===========================================================================
   * Runtime Values
   * ===========================================================================
   */

  getValues() {
    const result = {};

    for (
      const [
        name,
        definition,
      ] of this.dependencies
    ) {
      result[name] =
        definition.value;
    }

    return Object.freeze(
      result,
    );
  }

  getAll() {
    return this.getValues();
  }

  /**
   * ===========================================================================
   * Status Helpers
   * ===========================================================================
   */

  isReady() {
    return (
      this.ready &&
      !this.failed &&
      !this.stopping &&
      !this.stopped
    );
  }

  isStarted() {
    return this.initialized;
  }

  isStopped() {
    return this.stopped;
  }

  isFailed() {
    return this.failed;
  }

  isDegraded() {
    return this.degraded;
  }

  /**
   * ===========================================================================
   * Failure Queries
   * ===========================================================================
   */

  _getRequiredFailures() {
    return [
      ...this.dependencies.values(),
    ]
      .filter(
        definition =>
          definition.required &&
          definition.enabled &&
          (
            definition.failed ||
            !definition.ready
          ),
      )
      .map(
        definition =>
          definition.name,
      );
  }

  _getOptionalFailures() {
    return [
      ...this.dependencies.values(),
    ]
      .filter(
        definition =>
          definition.optional &&
          definition.enabled &&
          (
            definition.failed ||
            !definition.ready
          ),
      )
      .map(
        definition =>
          definition.name,
      );
  }

  /**
   * ===========================================================================
   * State Snapshot
   * ===========================================================================
   */

  snapshot() {
    return Object.freeze({
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      state:
        this.state,

      initialized:
        this.initialized,

      ready:
        this.ready,

      stopping:
        this.stopping,

      stopped:
        this.stopped,

      failed:
        this.failed,

      degraded:
        this.degraded,

      initializedAt:
        this.initializedAt,

      stoppedAt:
        this.stoppedAt,

      failure:
        safeError(
          this.failure,
        ),

      initializationOrder:
        Object.freeze([
          ...this.initializationOrder,
        ]),

      shutdownOrder:
        Object.freeze([
          ...this.shutdownOrder,
        ]),

      dependencies:
        Object.freeze(
          Array.from(
            this.dependencies.values(),
          ).map(
            definition =>
              this._safeRecord(
                definition,
              ),
          ),
        ),
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Safe Record
   * ---------------------------------------------------------------------------
   */

  _safeRecord(
    definition,
  ) {
    return {
      name:
        definition.name,

      type:
        definition.type,

      required:
        definition.required,

      critical:
        definition.critical,

      enabled:
        definition.enabled,

      priority:
        definition.priority,

      dependencies:
        [
          ...definition.dependencies,
        ],

      state:
        definition.state,

      ready:
        definition.ready,

      initialized:
        definition.initialized,

      failed:
        definition.failed,

      degraded:
        definition.degraded,

      initializedAt:
        definition.initializedAt,

      stoppedAt:
        definition.stoppedAt,

      durationMs:
        definition.durationMs,

      shutdownDurationMs:
        definition.shutdownDurationMs,

      error:
        definition.error,

      metadata:
        {
          ...definition.metadata,
        },
    };
  }

  /**
   * ===========================================================================
   * Context Construction
   * ===========================================================================
   */

  _createDependencyContext(
    definition,
    context,
  ) {
    const values =
      this.getValues();

    return {
      ...(context || {}),

      dependency:
        definition.name,

      dependencyDefinition:
        this._safeRecord(
          definition,
        ),

      dependencyRegistry:
        this,

      dependencies:
        values,

      requireDependency:
        name =>
          this.require(
            name,
          ),

      getDependency:
        name =>
          this.get(
            name,
          ),
    };
  }

  /**
   * ===========================================================================
   * Error Normalization
   * ===========================================================================
   */

  _normalizeError(
    error,
    definition = null,
  ) {
    if (
      error instanceof
      DependencyRegistryError
    ) {
      return error;
    }

    if (
      startupErrors?.normalizeStartupError
    ) {
      return startupErrors.normalizeStartupError(
        error,
        {
          phase:
            definition?.name ||
            'bootstrap',

          operation:
            `dependency:${definition?.name || 'initialization'}`,

          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          dependency:
            definition?.name,

          critical:
            definition?.critical !==
            false,

          fatal:
            definition?.critical !==
            false,

          preserveCauseStack:
            true,
        },
      );
    }

    return new DependencyRegistryError(
      error?.message ||
        'TITech dependency lifecycle failed.',
      {
        code:
          error?.code ||
          'DEPENDENCY_LIFECYCLE_FAILED',

        dependency:
          definition?.name,

        cause:
          error,
      },
    );
  }

  /**
   * ===========================================================================
   * Reset
   * ===========================================================================
   *
   * Testing/process isolation only.
   */

  reset() {
    if (
      this.initialized ||
      this.stopping
    ) {
      throw new DependencyRegistryError(
        'Cannot reset an active TITech dependency registry.',
        {
          code:
            'DEPENDENCY_REGISTRY_RESET_NOT_ALLOWED',
        },
      );
    }

    this.dependencies.clear();

    this.initializationOrder =
      [];

    this.shutdownOrder =
      [];

    this.initializePromise =
      null;

    this.shutdownPromise =
      null;

    this.initialized =
      false;

    this.ready =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.degraded =
      false;

    this.initializedAt =
      null;

    this.stoppedAt =
      null;

    this.failure =
      null;

    this.errors =
      [];

    this.state =
      REGISTRY_STATES.CREATED;

    this._registered =
      false;

    return this;
  }
}

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

function normalizeDependencies(
  dependencies,
) {
  if (
    dependencies ===
      undefined ||
    dependencies ===
      null
  ) {
    return [];
  }

  if (
    !Array.isArray(
      dependencies,
    )
  ) {
    throw new TypeError(
      'Dependency dependencies must be an array.',
    );
  }

  return [
    ...new Set(
      dependencies.map(
        dependency =>
          normalizeName(
            dependency,
            'dependency reference',
          ),
      ),
    ),
  ];
}

function compareDefinitions(
  a,
  b,
) {
  if (
    a.priority !==
    b.priority
  ) {
    return (
      a.priority -
      b.priority
    );
  }

  return a.name.localeCompare(
    b.name,
  );
}

function normalizeHealthResult(
  result,
  definition,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      status:
        result
          ? 'healthy'
          : 'unhealthy',

      healthy:
        result,

      ready:
        result,

      state:
        definition.state,
    };
  }

  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return {
      status:
        definition.ready
          ? 'healthy'
          : 'unhealthy',

      healthy:
        definition.ready,

      ready:
        definition.ready,

      state:
        definition.state,
    };
  }

  const healthy =
    result.healthy !==
      false &&
    result.status !==
      'unhealthy';

  const ready =
    result.ready !==
      false &&
    result.status !==
      'not_ready';

  return {
    ...result,

    status:
      result.status ||
      (
        healthy
          ? 'healthy'
          : 'unhealthy'
      ),

    healthy,

    ready,
  };
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 */

const dependencyRegistry =
  new DependencyRegistry();

/**
 * =============================================================================
 * Module-Level Convenience API
 * =============================================================================
 */

function register(
  name,
  initializer,
  options,
) {
  dependencyRegistry.register(
    name,
    initializer,
    options,
  );

  return dependencyRegistry;
}

async function initialize(
  context,
) {
  return dependencyRegistry.initialize(
    context,
  );
}

async function shutdown(
  context,
) {
  return dependencyRegistry.shutdown(
    context,
  );
}

async function stop(
  context,
) {
  return dependencyRegistry.shutdown(
    context,
  );
}

function get(
  name,
) {
  return dependencyRegistry.get(
    name,
  );
}

function requireDependency(
  name,
) {
  return dependencyRegistry.require(
    name,
  );
}

function has(
  name,
) {
  return dependencyRegistry.has(
    name,
  );
}

function resolveOrder() {
  return dependencyRegistry
    .resolveOrder()
    .map(
      dependency =>
        dependency.name,
    );
}

async function readiness() {
  return dependencyRegistry.readiness();
}

async function health() {
  return dependencyRegistry.health();
}

function snapshot() {
  return dependencyRegistry.snapshot();
}

/**
 * =============================================================================
 * Bootstrap Lifecycle Registration
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  const {
    hooks,
    lifecycle,
  } =
    require('./hooks');

  if (
    hooks.has(
      COMPONENT,
    )
  ) {
    return hooks.get(
      COMPONENT,
    );
  }

  return lifecycle(
    COMPONENT,
    {
      priority:
        options.priority ??
        -850,

      dependencies:
        options.dependencies ||
        [
          'configuration',
        ],

      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs ||
        DEFAULTS.timeoutMs,

      start:
        async hookContext =>
          dependencyRegistry.initialize(
            hookContext ||
              context,
          ),

      ready:
        async () =>
          dependencyRegistry.isReady(),

      health:
        async () =>
          dependencyRegistry.health(),

      stop:
        async hookContext =>
          dependencyRegistry.shutdown(
            hookContext ||
              context,
          ),

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        implementation:
          'backend/bootstrap/dependencyRegistry.js',
      },
    },
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
     * Classes.
     */
    DependencyRegistry,

    DependencyRegistryError,

    /**
     * Singleton.
     */
    dependencyRegistry,

    registry:
      dependencyRegistry,

    /**
     * Constants.
     */
    REGISTRY_STATES,

    DEPENDENCY_TYPES,

    DEPENDENCY_STATES,

    /**
     * Registration.
     */
    register,

    add:
      register,

    define:
      register,

    unregister:
      name =>
        dependencyRegistry.unregister(
          name,
        ),

    /**
     * Lifecycle.
     */
    initialize,

    start:
      initialize,

    shutdown,

    stop,

    /**
     * Lookup.
     */
    get,

    require:
      requireDependency,

    has,

    getDefinition:
      name =>
        dependencyRegistry.getDefinition(
          name,
        ),

    /**
     * Ordering.
     */
    resolveOrder,

    /**
     * Health/readiness.
     */
    readiness,

    health,

    /**
     * Diagnostics.
     */
    snapshot,

    /**
     * Bootstrap integration.
     */
    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Test support.
     */
    reset:
      () =>
        dependencyRegistry.reset(),
  });