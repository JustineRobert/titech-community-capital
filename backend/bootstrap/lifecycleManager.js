'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/lifecycleManager.js
 *
 * Purpose:
 *   Enterprise-grade application lifecycle manager.
 *
 * Architecture:
 *
 *   environment.js
 *        ↓
 *   config/index.js
 *        ↓
 *   lifecycleManager.js
 *        ↓
 *   lifecycle.js
 *        ↓
 *   bootstrap/index.js
 *        ↓
 *   infrastructure.js
 *        ↓
 *   hooks.js
 *
 * Responsibilities:
 *   - Own the authoritative application lifecycle state.
 *   - Manage lifecycle participants/managers.
 *   - Execute ordered startup phases.
 *   - Execute reverse-order shutdown phases.
 *   - Enforce startup/shutdown timeouts.
 *   - Prevent duplicate lifecycle execution.
 *   - Support dependencies between lifecycle managers.
 *   - Support startup rollback.
 *   - Support graceful shutdown.
 *   - Support readiness/liveness state.
 *   - Track lifecycle metrics and timings.
 *   - Provide safe operational diagnostics.
 *   - Support fatal process error handling.
 *   - Avoid embedding infrastructure/business logic.
 *
 * IMPORTANT:
 *   This module is an ORCHESTRATOR.
 *
 *   It must NOT:
 *     - contain financial business logic
 *     - perform database queries
 *     - process ledger entries
 *     - process payments
 *     - implement Redis commands
 *     - implement queue processors
 *     - implement Socket.IO handlers
 *     - implement API routes
 *
 * Existing subsystems remain authoritative.
 *
 * =============================================================================
 */

const {
  EventEmitter,
} = require('node:events');
const crypto = require('node:crypto');

/**
 * -----------------------------------------------------------------------------
 * Optional lower-level lifecycle engine
 * -----------------------------------------------------------------------------
 *
 * lifecycleManager.js sits above hooks.js.
 *
 * hooks.js:
 *   register/resolve/execute individual bootstrap hooks.
 *
 * lifecycleManager.js:
 *   coordinates higher-level lifecycle managers and application phases.
 */

const {
  hooks,
  HOOK_PHASES,
  LIFECYCLE_STATES: HOOK_STATES,
  initialize: initializeHooks,
  start: startHooks,
  stop: stopHooks,
  getState: getHookState,
  snapshot: getHookSnapshot,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * States
 * -----------------------------------------------------------------------------
 */

const STATES = Object.freeze({
  CREATED: 'created',
  REGISTERING: 'registering',
  INITIALIZING: 'initializing',
  STARTING: 'starting',
  READY: 'ready',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

/**
 * -----------------------------------------------------------------------------
 * Phases
 * -----------------------------------------------------------------------------
 */

const PHASES = Object.freeze({
  ENVIRONMENT: 'environment',
  CONFIGURATION: 'configuration',
  OBSERVABILITY: 'observability',
  RESILIENCE: 'resilience',
  INFRASTRUCTURE: 'infrastructure',
  APPLICATION: 'application',
  SERVER: 'server',
  READINESS: 'readiness',
  SHUTDOWN: 'shutdown',
});

/**
 * -----------------------------------------------------------------------------
 * Manager Types
 * -----------------------------------------------------------------------------
 */

const MANAGER_TYPES = Object.freeze({
  FOUNDATIONAL: 'foundational',
  INFRASTRUCTURE: 'infrastructure',
  APPLICATION: 'application',
  TRANSPORT: 'transport',
  OBSERVABILITY: 'observability',
  OTHER: 'other',
});

/**
 * -----------------------------------------------------------------------------
 * Defaults
 * -----------------------------------------------------------------------------
 */

const DEFAULTS = Object.freeze({
  startupTimeoutMs: 120_000,
  shutdownTimeoutMs: 30_000,
  managerTimeoutMs: 60_000,
  readinessTimeoutMs: 15_000,

  continueOnShutdownError: true,
  rollbackOnStartupFailure: true,

  installSignalHandlers: false,
  installProcessErrorHandlers: false,

  requireReadyStateForServing: true,
});

/**
 * -----------------------------------------------------------------------------
 * Errors
 * -----------------------------------------------------------------------------
 */

class LifecycleManagerError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'LifecycleManagerError';

    this.code =
      options.code ||
      'LIFECYCLE_MANAGER_ERROR';

    this.manager =
      options.manager ||
      null;

    this.phase =
      options.phase ||
      null;

    this.state =
      options.state ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    Error.captureStackTrace?.(
      this,
      LifecycleManagerError,
    );
  }
}

class LifecycleManagerTimeoutError extends LifecycleManagerError {
  constructor(
    name,
    timeoutMs,
    options = {},
  ) {
    super(
      `Lifecycle manager "${name}" timed out after ${timeoutMs}ms.`,
      {
        code:
          'LIFECYCLE_MANAGER_TIMEOUT',

        manager: name,

        phase:
          options.phase ||
          null,

        details: {
          timeoutMs,
        },
      },
    );

    this.timeoutMs = timeoutMs;
  }
}

class LifecycleDependencyError extends LifecycleManagerError {
  constructor(message, details = {}) {
    super(message, {
      code:
        'LIFECYCLE_DEPENDENCY_ERROR',

      details,
    });
  }
}

/**
 * -----------------------------------------------------------------------------
 * Utility Helpers
 * -----------------------------------------------------------------------------
 */

function createManagerId(name) {
  return crypto
    .createHash('sha256')
    .update(String(name))
    .digest('hex')
    .slice(0, 16);
}

function normalizeName(value, field = 'name') {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${field} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function normalizeDependencies(
  dependencies,
) {
  if (
    dependencies === undefined ||
    dependencies === null
  ) {
    return [];
  }

  if (!Array.isArray(dependencies)) {
    throw new TypeError(
      'dependencies must be an array.',
    );
  }

  return [
    ...new Set(
      dependencies.map(
        (dependency) =>
          normalizeName(
            dependency,
            'dependency',
          ),
      ),
    ),
  ];
}

function normalizeTimeout(
  value,
  fallback,
  field,
) {
  const resolved =
    value === undefined
      ? fallback
      : value;

  if (
    !Number.isInteger(resolved) ||
    resolved <= 0
  ) {
    throw new TypeError(
      `${field} must be a positive integer.`,
    );
  }

  return resolved;
}

function normalizePriority(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return 0;
  }

  if (!Number.isInteger(value)) {
    throw new TypeError(
      'priority must be an integer.',
    );
  }

  return value;
}

function isFunction(value) {
  return (
    typeof value === 'function'
  );
}

function hrtimeMs(start) {
  return Number(
    process.hrtime.bigint() -
      start,
  ) / 1_000_000;
}

async function executeWithTimeout(
  fn,
  {
    timeoutMs,
    managerName,
    phase,
  },
) {
  let timer;

  const operation =
    Promise.resolve().then(fn);

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new LifecycleManagerTimeoutError(
                managerName,
                timeoutMs,
                {
                  phase,
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
    clearTimeout(timer);
  }
}

/**
 * -----------------------------------------------------------------------------
 * Lifecycle Manager Registry
 * -----------------------------------------------------------------------------
 */

class LifecycleManagerRegistry {
  constructor(options = {}) {
    this.options = Object.freeze({
      startupTimeoutMs:
        normalizeTimeout(
          options.startupTimeoutMs,
          DEFAULTS.startupTimeoutMs,
          'startupTimeoutMs',
        ),

      shutdownTimeoutMs:
        normalizeTimeout(
          options.shutdownTimeoutMs,
          DEFAULTS.shutdownTimeoutMs,
          'shutdownTimeoutMs',
        ),

      managerTimeoutMs:
        normalizeTimeout(
          options.managerTimeoutMs,
          DEFAULTS.managerTimeoutMs,
          'managerTimeoutMs',
        ),

      readinessTimeoutMs:
        normalizeTimeout(
          options.readinessTimeoutMs,
          DEFAULTS.readinessTimeoutMs,
          'readinessTimeoutMs',
        ),

      continueOnShutdownError:
        options.continueOnShutdownError ??
        DEFAULTS.continueOnShutdownError,

      rollbackOnStartupFailure:
        options.rollbackOnStartupFailure ??
        DEFAULTS.rollbackOnStartupFailure,

      requireReadyStateForServing:
        options.requireReadyStateForServing ??
        DEFAULTS.requireReadyStateForServing,
    });

    this._managers = new Map();
    this._managerState = new Map();

    this._startupOrder = [];
    this._startedManagers = [];

    this._state = STATES.CREATED;
    this._phase = null;

    this._startPromise = null;
    this._shutdownPromise = null;

    this._startedAt = null;
    this._readyAt = null;
    this._stoppedAt = null;
    this._failedAt = null;

    this._failure = null;
    this._shutdownReason = null;

    this._phaseHistory = [];
    this._transitionHistory = [];

    this._shuttingDown = false;
    this._ready = false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Registration
   * ---------------------------------------------------------------------------
   */

  register(options = {}) {
    const name = normalizeName(
      options.name,
    );

    if (this._managers.has(name)) {
      throw new LifecycleManagerError(
        `Lifecycle manager "${name}" is already registered.`,
        {
          code:
            'LIFECYCLE_MANAGER_DUPLICATE',

          manager: name,
        },
      );
    }

    const manager = Object.freeze({
      id:
        options.id
          ? normalizeName(
              options.id,
              'id',
            )
          : createManagerId(name),

      name,

      type:
        options.type ||
        MANAGER_TYPES.OTHER,

      priority:
        normalizePriority(
          options.priority,
        ),

      dependencies:
        Object.freeze(
          normalizeDependencies(
            options.dependencies,
          ),
        ),

      timeoutMs:
        normalizeTimeout(
          options.timeoutMs,
          this.options.managerTimeoutMs,
          'manager timeout',
        ),

      critical:
        options.critical !== false,

      enabled:
        options.enabled !== false,

      start:
        isFunction(options.start)
          ? options.start
          : null,

      stop:
        isFunction(options.stop)
          ? options.stop
          : null,

      ready:
        isFunction(options.ready)
          ? options.ready
          : null,

      health:
        isFunction(options.health)
          ? options.health
          : null,

      metadata: Object.freeze({
        ...(options.metadata || {}),
      }),

      registeredAt:
        new Date(),
    });

    this._managers.set(
      name,
      manager,
    );

    this._managerState.set(
      name,
      {
        state:
          'registered',

        startedAt:
          null,

        readyAt:
          null,

        stoppedAt:
          null,

        failedAt:
          null,

        failure:
          null,

        durationMs:
          null,
      },
    );

    return manager;
  }

  unregister(name) {
    const normalized =
      normalizeName(name);

    if (
      this._managers.has(
        normalized,
      ) &&
      (
        this._state ===
          STATES.RUNNING ||
        this._state ===
          STATES.STARTING
      )
    ) {
      throw new LifecycleManagerError(
        `Cannot unregister lifecycle manager "${normalized}" while application is running.`,
        {
          code:
            'LIFECYCLE_MANAGER_UNREGISTER_RUNNING',

          manager:
            normalized,
        },
      );
    }

    this._managers.delete(
      normalized,
    );

    this._managerState.delete(
      normalized,
    );

    return this;
  }

  has(name) {
    return this._managers.has(
      name,
    );
  }

  get(name) {
    return (
      this._managers.get(name) ||
      null
    );
  }

  list({
    enabledOnly = true,
  } = {}) {
    return [
      ...this._managers.values(),
    ].filter(
      manager =>
        !enabledOnly ||
        manager.enabled,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Dependency Resolution
   * ---------------------------------------------------------------------------
   */

  resolveOrder(
    direction = 'startup',
  ) {
    const managers =
      this.list({
        enabledOnly: true,
      });

    const managerMap =
      new Map(
        managers.map(
          manager => [
            manager.name,
            manager,
          ],
        ),
      );

    const incoming =
      new Map();

    const outgoing =
      new Map();

    for (const manager of managers) {
      incoming.set(
        manager.name,
        0,
      );

      outgoing.set(
        manager.name,
        new Set(),
      );
    }

    for (const manager of managers) {
      for (
        const dependency of
          manager.dependencies
      ) {
        if (
          !managerMap.has(
            dependency,
          )
        ) {
          throw new LifecycleDependencyError(
            `Lifecycle manager "${manager.name}" depends on missing manager "${dependency}".`,
            {
              manager:
                manager.name,

              dependency,

              direction,
            },
          );
        }

        if (
          dependency ===
          manager.name
        ) {
          throw new LifecycleDependencyError(
            `Lifecycle manager "${manager.name}" cannot depend on itself.`,
            {
              manager:
                manager.name,

              direction,
            },
          );
        }

        incoming.set(
          manager.name,
          incoming.get(
            manager.name,
          ) + 1,
        );

        outgoing
          .get(dependency)
          .add(manager.name);
      }
    }

    const queue =
      managers
        .filter(
          manager =>
            incoming.get(
              manager.name,
            ) === 0,
        )
        .sort(
          LifecycleManagerRegistry.compare,
        );

    const order = [];

    while (queue.length > 0) {
      const current =
        queue.shift();

      order.push(
        current,
      );

      for (
        const dependent of
          outgoing.get(
            current.name,
          )
      ) {
        const count =
          incoming.get(
            dependent,
          ) - 1;

        incoming.set(
          dependent,
          count,
        );

        if (count === 0) {
          queue.push(
            managerMap.get(
              dependent,
            ),
          );

          queue.sort(
            LifecycleManagerRegistry.compare,
          );
        }
      }
    }

    if (
      order.length !==
      managers.length
    ) {
      const cyclic =
        managers
          .filter(
            manager =>
              incoming.get(
                manager.name,
              ) > 0,
          )
          .map(
            manager =>
              manager.name,
          );

      throw new LifecycleDependencyError(
        'Circular lifecycle manager dependency detected.',
        {
          direction,
          managers:
            cyclic,
        },
      );
    }

    return direction ===
      'shutdown'
      ? order.reverse()
      : order;
  }

  static compare(a, b) {
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

  /**
   * ---------------------------------------------------------------------------
   * State
   * ---------------------------------------------------------------------------
   */

  transition(
    state,
    phase = null,
    metadata = {},
  ) {
    const previous =
      this._state;

    this._state =
      state;

    if (phase !== null) {
      this._phase =
        phase;
    }

    this._transitionHistory.push(
      Object.freeze({
        previousState:
          previous,

        state,

        phase:
          this._phase,

        timestamp:
          new Date(),

        metadata: {
          ...metadata,
        },
      }),
    );

    return this._state;
  }

  /**
   * ---------------------------------------------------------------------------
   * Manager Execution
   * ---------------------------------------------------------------------------
   */

  async executeStart(
    manager,
    context,
  ) {
    if (!manager.start) {
      return;
    }

    const state =
      this._managerState.get(
        manager.name,
      );

    state.state =
      'starting';

    state.startedAt =
      new Date();

    const timer =
      process.hrtime.bigint();

    try {
      const result =
        await executeWithTimeout(
          () =>
            manager.start(
              context,
            ),

          {
            timeoutMs:
              manager.timeoutMs,

            managerName:
              manager.name,

            phase:
              PHASES.INITIALIZATION,
          },
        );

      state.state =
        'started';

      state.durationMs =
        Number(
          process.hrtime.bigint() -
            timer,
        ) / 1_000_000;

      this._startedManagers.push(
        manager,
      );

      return result;
    } catch (error) {
      state.state =
        'failed';

      state.failedAt =
        new Date();

      state.failure =
        error;

      state.durationMs =
        Number(
          process.hrtime.bigint() -
            timer,
        ) / 1_000_000;

      throw new LifecycleManagerError(
        `Lifecycle manager "${manager.name}" failed during startup.`,
        {
          code:
            'LIFECYCLE_MANAGER_START_FAILED',

          manager:
            manager.name,

          phase:
            PHASES.INITIALIZATION,

          cause:
            error,

          details: {
            durationMs:
              state.durationMs,
          },
        },
      );
    }
  }

  async executeStop(
    manager,
    context,
  ) {
    if (!manager.stop) {
      return;
    }

    const state =
      this._managerState.get(
        manager.name,
      );

    state.state =
      'stopping';

    const timer =
      process.hrtime.bigint();

    try {
      const result =
        await executeWithTimeout(
          () =>
            manager.stop(
              context,
            ),

          {
            timeoutMs:
              Math.min(
                manager.timeoutMs,
                this.options
                  .shutdownTimeoutMs,
              ),

            managerName:
              manager.name,

            phase:
              PHASES.SHUTDOWN,
          },
        );

      state.state =
        'stopped';

      state.stoppedAt =
        new Date();

      state.durationMs =
        Number(
          process.hrtime.bigint() -
            timer,
        ) / 1_000_000;

      return result;
    } catch (error) {
      state.state =
        'failed';

      state.failure =
        error;

      state.durationMs =
        Number(
          process.hrtime.bigint() -
            timer,
        ) / 1_000_000;

      throw new LifecycleManagerError(
        `Lifecycle manager "${manager.name}" failed during shutdown.`,
        {
          code:
            'LIFECYCLE_MANAGER_STOP_FAILED',

          manager:
            manager.name,

          phase:
            PHASES.SHUTDOWN,

          cause:
            error,

          details: {
            durationMs:
              state.durationMs,
          },
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Startup
   * ---------------------------------------------------------------------------
   */

  async start(
    context = {},
  ) {
    if (
      this._state ===
      STATES.RUNNING
    ) {
      return context;
    }

    if (
      this._startPromise
    ) {
      return this._startPromise;
    }

    if (
      this._state ===
        STATES.STOPPING ||
      this._state ===
        STATES.STOPPED
    ) {
      throw new LifecycleManagerError(
        'Lifecycle manager cannot start while stopping or after shutdown.',
        {
          code:
            'LIFECYCLE_START_NOT_ALLOWED',

          state:
            this._state,
        },
      );
    }

    this._startPromise =
      this._performStart(
        context,
      );

    try {
      return await this._startPromise;
    } finally {
      if (
        this._state !==
        STATES.RUNNING
      ) {
        this._startPromise =
          null;
      }
    }
  }

  async _performStart(
    context,
  ) {
    this._startedAt =
      new Date();

    this.transition(
      STATES.REGISTERING,
      PHASES.ENVIRONMENT,
    );

    try {
      /**
       * Validate registered manager dependency graph before touching
       * infrastructure.
       */
      const startupOrder =
        this.resolveOrder(
          'startup',
        );

      this._startupOrder =
        startupOrder.map(
          manager =>
            manager.name,
        );

      this.transition(
        STATES.INITIALIZING,
        PHASES.INITIALIZATION,
      );

      /**
       * First allow hook-layer initialization.
       *
       * This preserves the existing hooks.js contract.
       */
      await initializeHooks(
        context,
      );

      for (
        const manager of
          startupOrder
      ) {
        await this.executeStart(
          manager,
          context,
        );
      }

      /**
       * Then start hook-managed infrastructure.
       */
      this.transition(
        STATES.STARTING,
        PHASES.INFRASTRUCTURE,
      );

      await startHooks(
        context,
      );

      /**
       * Readiness.
       */
      this.transition(
        STATES.READY,
        PHASES.READINESS,
      );

      await this.checkReadiness(
        context,
      );

      this._ready =
        true;

      this._readyAt =
        new Date();

      this.transition(
        STATES.RUNNING,
        PHASES.READINESS,
      );

      return context;
    } catch (error) {
      this._failure =
        error;

      this._failedAt =
        new Date();

      this.transition(
        STATES.FAILED,
        this._phase,
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

      if (
        this.options
          .rollbackOnStartupFailure
      ) {
        await this.rollback(
          context,
        );
      }

      throw error instanceof
        LifecycleManagerError
        ? error
        : new LifecycleManagerError(
            'Lifecycle manager startup failed.',
            {
              code:
                'LIFECYCLE_START_FAILED',

              phase:
                this._phase,

              cause:
                error,
            },
          );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness
   * ---------------------------------------------------------------------------
   */

  async checkReadiness(
    context = {},
  ) {
    const order =
      this.resolveOrder(
        'startup',
      );

    for (
      const manager of order
    ) {
      if (!manager.ready) {
        continue;
      }

      const result =
        await executeWithTimeout(
          () =>
            manager.ready(
              context,
            ),

          {
            timeoutMs:
              this.options
                .readinessTimeoutMs,

            managerName:
              manager.name,

            phase:
              PHASES.READINESS,
          },
        );

      const state =
        this._managerState.get(
          manager.name,
        );

      if (
        result === false
      ) {
        state.state =
          'not-ready';

        throw new LifecycleManagerError(
          `Lifecycle manager "${manager.name}" reported not ready.`,
          {
            code:
              'LIFECYCLE_MANAGER_NOT_READY',

            manager:
              manager.name,

            phase:
              PHASES.READINESS,
          },
        );
      }

      state.readyAt =
        new Date();

      state.state =
        'ready';
    }

    /**
     * hooks.js must also have reached a valid started/ready state.
     */
    const hookState =
      getHookState();

    if (
      this.options
        .requireReadyStateForServing &&
      hookState !==
        HOOK_STATES.RUNNING &&
      hookState !==
        HOOK_STATES.READY
    ) {
      throw new LifecycleManagerError(
        `Bootstrap hooks are not ready. Current state: ${hookState}.`,
        {
          code:
            'BOOTSTRAP_HOOKS_NOT_READY',

          phase:
            PHASES.READINESS,
        },
      );
    }

    return true;
  }

  /**
   * ---------------------------------------------------------------------------
   * Rollback
   * ---------------------------------------------------------------------------
   */

  async rollback(
    context = {},
  ) {
    const started =
      [...this._startedManagers]
        .reverse();

    for (
      const manager of started
    ) {
      if (!manager.stop) {
        continue;
      }

      try {
        await this.executeStop(
          manager,
          {
            ...context,
            rollback:
              true,
          },
        );
      } catch {
        /**
         * Rollback never replaces the original startup error.
         */
      }
    }

    this._startedManagers =
      [];

    try {
      await stopHooks(
        {
          ...context,
          rollback:
            true,
        },
      );
    } catch {
      /**
       * Best-effort rollback.
       */
    }

    this._ready =
      false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async shutdown(
    context = {},
    reason =
      'application-request',
  ) {
    if (
      this._shutdownPromise
    ) {
      return this._shutdownPromise;
    }

    if (
      this._state ===
      STATES.STOPPED
    ) {
      return;
    }

    this._shutdownReason =
      reason;

    this._shutdownPromise =
      this._performShutdown(
        context,
        reason,
      );

    return this._shutdownPromise;
  }

  async _performShutdown(
    context,
    reason,
  ) {
    this._shuttingDown =
      true;

    this._ready =
      false;

    this.transition(
      STATES.STOPPING,
      PHASES.SHUTDOWN,
      {
        reason,
      },
    );

    const errors = [];

    try {
      /**
       * Shutdown hook graph first.
       *
       * hooks.js resolves lifecycle dependencies and executes them in reverse.
       */
      try {
        await stopHooks(
          {
            ...context,
            reason,
            lifecycleManager:
              this,
          },
        );
      } catch (error) {
        errors.push(error);
      }

      /**
       * Manager shutdown follows reverse dependency order.
       */
      const shutdownOrder =
        this.resolveOrder(
          'shutdown',
        );

      for (
        const manager of
          shutdownOrder
      ) {
        try {
          await this.executeStop(
            manager,
            {
              ...context,
              reason,
              lifecycleManager:
                this,
            },
          );
        } catch (error) {
          errors.push(error);

          if (
            manager.critical &&
            !this.options
              .continueOnShutdownError
          ) {
            break;
          }
        }
      }

      this._startedManagers =
        [];

      if (errors.length > 0) {
        this._failure =
          errors[0];

        this._failedAt =
          new Date();

        this.transition(
          STATES.FAILED,
          PHASES.SHUTDOWN,
          {
            errorCount:
              errors.length,
          },
        );

        throw new LifecycleManagerError(
          'One or more lifecycle shutdown operations failed.',
          {
            code:
              'LIFECYCLE_SHUTDOWN_PARTIAL_FAILURE',

            phase:
              PHASES.SHUTDOWN,

            cause:
              errors[0],

            details: {
              errorCount:
                errors.length,
            },
          },
        );
      }

      this._stoppedAt =
        new Date();

      this.transition(
        STATES.STOPPED,
        PHASES.SHUTDOWN,
        {
          reason,
        },
      );
    } catch (error) {
      if (
        this._state !==
        STATES.FAILED
      ) {
        this.transition(
          STATES.FAILED,
          PHASES.SHUTDOWN,
        );
      }

      throw error;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  isReady() {
    return (
      this._state ===
      STATES.RUNNING &&
      this._ready === true
    );
  }

  isRunning() {
    return (
      this._state ===
      STATES.RUNNING
    );
  }

  isStopping() {
    return (
      this._state ===
      STATES.STOPPING
    );
  }

  isStopped() {
    return (
      this._state ===
      STATES.STOPPED
    );
  }

  isFailed() {
    return (
      this._state ===
      STATES.FAILED
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Manager Health
   * ---------------------------------------------------------------------------
   */

  async health(
    context = {},
  ) {
    const managers =
      this.list({
        enabledOnly: true,
      });

    const results = {};

    for (const manager of managers) {
      const state =
        this._managerState.get(
          manager.name,
        );

      if (!manager.health) {
        results[manager.name] =
          {
            status:
              state.state ===
                'ready' ||
              state.state ===
                'started'
                ? 'healthy'
                : state.state,
          };

        continue;
      }

      try {
        const result =
          await executeWithTimeout(
            () =>
              manager.health(
                context,
              ),

            {
              timeoutMs:
                this.options
                  .readinessTimeoutMs,

              managerName:
                manager.name,

              phase:
                PHASES.READINESS,
            },
          );

        results[manager.name] =
          {
            status:
              result === false
                ? 'unhealthy'
                : 'healthy',

            result:
              result === true
                ? undefined
                : result,
          };
      } catch (error) {
        results[manager.name] =
          {
            status:
              'unhealthy',

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

    return Object.freeze({
      status:
        Object.values(
          results,
        ).every(
          result =>
            result.status ===
            'healthy',
        )
          ? 'healthy'
          : 'unhealthy',

      managers:
        Object.freeze(
          results,
        ),
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Diagnostics
   * ---------------------------------------------------------------------------
   */

  snapshot() {
    const managers = {};

    for (
      const [
        name,
        manager,
      ] of this._managers
    ) {
      const state =
        this._managerState.get(
          name,
        );

      managers[name] =
        Object.freeze({
          id:
            manager.id,

          type:
            manager.type,

          priority:
            manager.priority,

          dependencies:
            [...manager.dependencies],

          enabled:
            manager.enabled,

          critical:
            manager.critical,

          state:
            state?.state ||
            'unknown',

          startedAt:
            state?.startedAt ||
            null,

          readyAt:
            state?.readyAt ||
            null,

          stoppedAt:
            state?.stoppedAt ||
            null,

          failedAt:
            state?.failedAt ||
            null,

          durationMs:
            state?.durationMs ||
            null,

          failure:
            state?.failure
              ? {
                  name:
                    state.failure
                      ?.name,

                  code:
                    state.failure
                      ?.code,

                  message:
                    state.failure
                      ?.message,
                }
              : null,

          metadata:
            manager.metadata,
        });
    }

    return Object.freeze({
      state:
        this._state,

      phase:
        this._phase,

      ready:
        this._ready,

      shuttingDown:
        this._shuttingDown,

      shutdownReason:
        this._shutdownReason,

      startedAt:
        this._startedAt,

      readyAt:
        this._readyAt,

      stoppedAt:
        this._stoppedAt,

      failedAt:
        this._failedAt,

      failure:
        this._failure
          ? {
              name:
                this._failure.name,

              code:
                this._failure.code,

              message:
                this._failure.message,
            }
          : null,

      startupOrder:
        [...this._startupOrder],

      startedManagers:
        this._startedManagers.map(
          manager =>
            manager.name,
        ),

      managers:
        Object.freeze(
          managers,
        ),

      hooks:
        getHookSnapshot(),

      phaseHistory:
        Object.freeze([
          ...this._phaseHistory,
        ]),

      transitionHistory:
        Object.freeze([
          ...this._transitionHistory,
        ]),
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   *
   * Testing/process-isolation only.
   */

  reset() {
    if (
      this._state ===
        STATES.RUNNING ||
      this._state ===
        STATES.STARTING ||
      this._state ===
        STATES.STOPPING
    ) {
      throw new LifecycleManagerError(
        'Cannot reset lifecycle manager while application is active.',
        {
          code:
            'LIFECYCLE_RESET_NOT_ALLOWED',

          state:
            this._state,
        },
      );
    }

    this._state =
      STATES.CREATED;

    this._phase =
      null;

    this._startPromise =
      null;

    this._shutdownPromise =
      null;

    this._startedAt =
      null;

    this._readyAt =
      null;

    this._stoppedAt =
      null;

    this._failedAt =
      null;

    this._failure =
      null;

    this._shutdownReason =
      null;

    this._startupOrder =
      [];

    this._startedManagers =
      [];

    this._phaseHistory =
      [];

    this._transitionHistory =
      [];

    this._shuttingDown =
      false;

    this._ready =
      false;

    for (
      const state of
        this._managerState.values()
    ) {
      state.state =
        'registered';

      state.startedAt =
        null;

      state.readyAt =
        null;

      state.stoppedAt =
        null;

      state.failedAt =
        null;

      state.failure =
        null;

      state.durationMs =
        null;
    }

    return this;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Default Singleton Manager
 * -----------------------------------------------------------------------------
 */

const lifecycleManager =
  new LifecycleManagerRegistry();

/**
 * -----------------------------------------------------------------------------
 * Convenience Registration API
 * -----------------------------------------------------------------------------
 */

function registerManager(
  options,
) {
  return lifecycleManager.register(
    options,
  );
}

function hasManager(name) {
  return lifecycleManager.has(
    name,
  );
}

function getManager(name) {
  return lifecycleManager.get(
    name,
  );
}

function listManagers(options) {
  return lifecycleManager.list(
    options,
  );
}

/**
 * -----------------------------------------------------------------------------
 * Standard ACFOS Manager Registration
 * -----------------------------------------------------------------------------
 *
 * This creates stable lifecycle names for major architectural boundaries.
 *
 * Actual subsystem implementations are injected by bootstrap/infrastructure.js
 * and application bootstrap modules.
 */

function registerStandardManagers(
  context = {},
) {
  const registrations = {};

  if (
    !hasManager('environment')
  ) {
    registrations.environment =
      registerManager({
        name:
          'environment',

        type:
          MANAGER_TYPES.FOUNDATIONAL,

        priority:
          -1_000,

        start:
          async () => {
            if (
              !context.environment
            ) {
              throw new LifecycleManagerError(
                'Environment context is unavailable.',
                {
                  code:
                    'ENVIRONMENT_CONTEXT_UNAVAILABLE',

                  manager:
                    'environment',
                },
              );
            }
          },

        ready:
          async () =>
            Boolean(
              context.environment,
            ),

        critical:
          true,
      });
  }

  if (
    !hasManager('configuration')
  ) {
    registrations.configuration =
      registerManager({
        name:
          'configuration',

        type:
          MANAGER_TYPES.FOUNDATIONAL,

        priority:
          -900,

        dependencies: [
          'environment',
        ],

        start:
          async () => {
            if (
              !context.config
            ) {
              throw new LifecycleManagerError(
                'Application configuration is unavailable.',
                {
                  code:
                    'CONFIGURATION_CONTEXT_UNAVAILABLE',

                  manager:
                    'configuration',
                },
              );
            }
          },

        ready:
          async () =>
            Boolean(
              context.config,
            ),

        critical:
          true,
      });
  }

  return Object.freeze({
    ...registrations,
  });
}

/**
 * -----------------------------------------------------------------------------
 * Register Bootstrap/Infrastructure Managers
 * -----------------------------------------------------------------------------
 *
 * These managers are integration points, not infrastructure implementations.
 */

function registerInfrastructureManager(
  name,
  options = {},
) {
  return registerManager({
    name,

    type:
      options.type ||
      MANAGER_TYPES.INFRASTRUCTURE,

    priority:
      options.priority ??
      0,

    dependencies:
      options.dependencies ||
      ['configuration'],

    start:
      options.start,

    stop:
      options.stop,

    ready:
      options.ready,

    health:
      options.health,

    timeoutMs:
      options.timeoutMs,

    critical:
      options.critical !== false,

    metadata:
      options.metadata,
  });
}

function registerApplicationManager(
  name,
  options = {},
) {
  return registerManager({
    name,

    type:
      options.type ||
      MANAGER_TYPES.APPLICATION,

    priority:
      options.priority ??
      0,

    dependencies:
      options.dependencies ||
      ['configuration'],

    start:
      options.start,

    stop:
      options.stop,

    ready:
      options.ready,

    health:
      options.health,

    timeoutMs:
      options.timeoutMs,

    critical:
      options.critical !== false,

    metadata:
      options.metadata,
  });
}

/**
 * -----------------------------------------------------------------------------
 * Application Start/Stop API
 * -----------------------------------------------------------------------------
 */

async function start(context = {}) {
  registerStandardManagers(
    context,
  );

  return lifecycleManager.start(
    context,
  );
}

async function shutdown(
  context = {},
  reason = 'application-request',
) {
  return lifecycleManager.shutdown(
    context,
    reason,
  );
}

async function stop(
  context = {},
  reason = 'application-request',
) {
  return shutdown(
    context,
    reason,
  );
}

/**
 * -----------------------------------------------------------------------------
 * Readiness / Health
 * -----------------------------------------------------------------------------
 */

function isReady() {
  return lifecycleManager.isReady();
}

function isRunning() {
  return lifecycleManager.isRunning();
}

function isStopping() {
  return lifecycleManager.isStopping();
}

function isStopped() {
  return lifecycleManager.isStopped();
}

function isFailed() {
  return lifecycleManager.isFailed();
}

async function checkReadiness(
  context = {},
) {
  return lifecycleManager.checkReadiness(
    context,
  );
}

async function health(
  context = {},
) {
  return lifecycleManager.health(
    context,
  );
}

/**
 * -----------------------------------------------------------------------------
 * Diagnostics
 * -----------------------------------------------------------------------------
 */

function snapshot() {
  return lifecycleManager.snapshot();
}

function getState() {
  return lifecycleManager._state;
}

function getPhase() {
  return lifecycleManager._phase;
}

/**
 * -----------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------
 */

module.exports = Object.freeze({
  /**
   * Classes.
   */
  LifecycleManagerRegistry,

  LifecycleManagerError,

  LifecycleManagerTimeoutError,

  LifecycleDependencyError,

  /**
   * Constants.
   */
  STATES,

  PHASES,

  MANAGER_TYPES,

  /**
   * Singleton.
   */
  lifecycleManager,

  /**
   * Registration.
   */
  registerManager,
  registerStandardManagers,

  registerInfrastructureManager,
  registerApplicationManager,

  hasManager,
  getManager,
  listManagers,

  /**
   * Lifecycle.
   */
  start,
  shutdown,
  stop,

  /**
   * Health/readiness.
   */
  isReady,
  isRunning,
  isStopping,
  isStopped,
  isFailed,

  checkReadiness,
  health,

  /**
   * Diagnostics.
   */
  snapshot,
  getState,
  getPhase,
});