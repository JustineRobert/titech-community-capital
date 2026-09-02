'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/lifecycle.js
 *
 * Purpose:
 *   Enterprise-grade application lifecycle coordinator.
 *
 * Responsibilities:
 *   - Coordinate application lifecycle phases.
 *   - Provide deterministic startup and shutdown orchestration.
 *   - Coordinate environment/configuration/bootstrap/infrastructure/app/server.
 *   - Expose application readiness state.
 *   - Track lifecycle transitions.
 *   - Measure phase durations.
 *   - Enforce lifecycle timeouts.
 *   - Protect against duplicate startup/shutdown execution.
 *   - Support graceful shutdown.
 *   - Handle SIGTERM/SIGINT/SIGQUIT.
 *   - Handle uncaught exceptions/unhandled rejections.
 *   - Provide safe lifecycle diagnostics.
 *   - Preserve existing subsystem implementations.
 *
 * Architectural position:
 *
 *   environment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   bootstrap/lifecycle.js
 *       ↓
 *   bootstrap/index.js
 *       ↓
 *   bootstrap/infrastructure.js
 *       ↓
 *   bootstrap/hooks.js
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
 *
 * IMPORTANT:
 *
 *   This module is the lifecycle STATE MACHINE.
 *
 *   It does NOT implement:
 *     - financial business logic
 *     - database queries
 *     - Redis commands
 *     - queue processors
 *     - ledger operations
 *     - payment operations
 *     - route handlers
 *     - Socket.IO event handlers
 *
 *   It coordinates existing subsystems.
 *
 * =============================================================================
 */

const {
  EventEmitter,
} = require('node:events');

/**
 * -----------------------------------------------------------------------------
 * Hook Registry
 * -----------------------------------------------------------------------------
 */

const {
  hooks,
  initialize: initializeHooks,
  start: startHooks,
  stop: stopHooks,
  getState: getHookState,
  snapshot: getHookSnapshot,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * Lifecycle States
 * -----------------------------------------------------------------------------
 */

const STATES = Object.freeze({
  CREATED: 'created',
  REGISTERING: 'registering',
  INITIALIZING: 'initializing',
  READYING: 'readying',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

/**
 * -----------------------------------------------------------------------------
 * Lifecycle Phases
 * -----------------------------------------------------------------------------
 *
 * These phases describe the application lifecycle rather than individual
 * subsystem implementation details.
 */

const PHASES = Object.freeze({
  ENVIRONMENT: 'environment',
  CONFIGURATION: 'configuration',
  REGISTRATION: 'registration',
  INITIALIZATION: 'initialization',
  INFRASTRUCTURE: 'infrastructure',
  APPLICATION: 'application',
  SERVER: 'server',
  READINESS: 'readiness',
  SHUTDOWN: 'shutdown',
});

/**
 * -----------------------------------------------------------------------------
 * Default Configuration
 * -----------------------------------------------------------------------------
 */

const DEFAULTS = Object.freeze({
  startupTimeoutMs: 120_000,

  shutdownTimeoutMs: 30_000,

  phaseTimeoutMs: 60_000,

  signalExitDelayMs: 250,

  forceExitOnShutdownTimeout: false,

  installSignalHandlers: true,

  installProcessErrorHandlers: true,

  handleSigquit: true,

  terminateOnUncaughtException: true,

  terminateOnUnhandledRejection: true,

  requireReadiness: true,
});

/**
 * -----------------------------------------------------------------------------
 * Lifecycle Error
 * -----------------------------------------------------------------------------
 */

class LifecycleError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'LifecycleError';

    this.code =
      options.code ||
      'APPLICATION_LIFECYCLE_ERROR';

    this.phase =
      options.phase ||
      null;

    this.state =
      options.state ||
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
      LifecycleError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Utility Functions
 * -----------------------------------------------------------------------------
 */

function now() {
  return new Date();
}

function hrtimeMs(start) {
  return Number(
    process.hrtime.bigint() -
    start,
  ) / 1_000_000;
}

function normalizePositiveInteger(
  value,
  fallback,
  name,
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
      `${name} must be a positive integer.`,
    );
  }

  return resolved;
}

/**
 * -----------------------------------------------------------------------------
 * Timeout Utility
 * -----------------------------------------------------------------------------
 */

async function withTimeout(
  promiseOrFunction,
  timeoutMs,
  label,
) {
  let timer;

  const operation =
    typeof promiseOrFunction ===
    'function'
      ? Promise.resolve().then(
          promiseOrFunction,
        )
      : Promise.resolve(
          promiseOrFunction,
        );

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new LifecycleError(
                `${label} timed out after ${timeoutMs}ms.`,
                {
                  code:
                    'LIFECYCLE_TIMEOUT',

                  details: {
                    timeoutMs,
                  },
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
 * Lifecycle Coordinator
 * -----------------------------------------------------------------------------
 */

class ApplicationLifecycle extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options =
      Object.freeze({
        startupTimeoutMs:
          normalizePositiveInteger(
            options.startupTimeoutMs,
            DEFAULTS.startupTimeoutMs,
            'startupTimeoutMs',
          ),

        shutdownTimeoutMs:
          normalizePositiveInteger(
            options.shutdownTimeoutMs,
            DEFAULTS.shutdownTimeoutMs,
            'shutdownTimeoutMs',
          ),

        phaseTimeoutMs:
          normalizePositiveInteger(
            options.phaseTimeoutMs,
            DEFAULTS.phaseTimeoutMs,
            'phaseTimeoutMs',
          ),

        signalExitDelayMs:
          normalizePositiveInteger(
            options.signalExitDelayMs,
            DEFAULTS.signalExitDelayMs,
            'signalExitDelayMs',
          ),

        forceExitOnShutdownTimeout:
          options.forceExitOnShutdownTimeout ??
          DEFAULTS.forceExitOnShutdownTimeout,

        installSignalHandlers:
          options.installSignalHandlers ??
          DEFAULTS.installSignalHandlers,

        installProcessErrorHandlers:
          options.installProcessErrorHandlers ??
          DEFAULTS.installProcessErrorHandlers,

        handleSigquit:
          options.handleSigquit ??
          DEFAULTS.handleSigquit,

        terminateOnUncaughtException:
          options.terminateOnUncaughtException ??
          DEFAULTS.terminateOnUncaughtException,

        terminateOnUnhandledRejection:
          options.terminateOnUnhandledRejection ??
          DEFAULTS.terminateOnUnhandledRejection,

        requireReadiness:
          options.requireReadiness ??
          DEFAULTS.requireReadiness,
      });

    this.state =
      STATES.CREATED;

    this.phase =
      null;

    this.context =
      null;

    this.startPromise =
      null;

    this.stopPromise =
      null;

    this.startedAt =
      null;

    this.readyAt =
      null;

    this.stoppedAt =
      null;

    this.failedAt =
      null;

    this.failure =
      null;

    this.shutdownReason =
      null;

    this.signal =
      null;

    this.processHandlersInstalled =
      false;

    this.shuttingDown =
      false;

    this.forceShutdownRequested =
      false;

    this.phaseHistory =
      [];

    this.stateHistory =
      [
        {
          state:
            STATES.CREATED,

          timestamp:
            now(),

          phase:
            null,
        },
      ];
  }

  /**
   * ---------------------------------------------------------------------------
   * State Transition
   * ---------------------------------------------------------------------------
   */

  _transition(
    nextState,
    phase = this.phase,
    metadata = {},
  ) {
    const previousState =
      this.state;

    this.state =
      nextState;

    const entry =
      Object.freeze({
        previousState,

        state:
          nextState,

        phase,

        timestamp:
          now(),

        metadata: {
          ...metadata,
        },
      });

    this.stateHistory.push(
      entry,
    );

    this.emit(
      'stateChanged',
      entry,
    );

    return entry;
  }

  /**
   * ---------------------------------------------------------------------------
   * Phase Execution
   * ---------------------------------------------------------------------------
   */

  async _runPhase(
    phase,
    handler,
    options = {},
  ) {
    const timeoutMs =
      normalizePositiveInteger(
        options.timeoutMs,
        this.options.phaseTimeoutMs,
        'phase timeout',
      );

    const startedAt =
      now();

    const startedHrtime =
      process.hrtime.bigint();

    this.phase =
      phase;

    this.emit(
      'phaseStarted',
      {
        phase,
        timestamp:
          startedAt,
      },
    );

    try {
      const result =
        await withTimeout(
          () =>
            handler(
              this.context,
            ),

          timeoutMs,

          `Lifecycle phase "${phase}"`,
        );

      const finishedAt =
        now();

      const durationMs =
        hrtimeMs(
          startedHrtime,
        );

      const record =
        Object.freeze({
          phase,

          status:
            'success',

          startedAt,

          finishedAt,

          durationMs,
        });

      this.phaseHistory.push(
        record,
      );

      this.emit(
        'phaseCompleted',
        record,
      );

      return result;
    } catch (error) {
      const finishedAt =
        now();

      const durationMs =
        hrtimeMs(
          startedHrtime,
        );

      const lifecycleError =
        error instanceof LifecycleError
          ? error
          : new LifecycleError(
              `Lifecycle phase "${phase}" failed.`,
              {
                code:
                  'LIFECYCLE_PHASE_FAILED',

                phase,

                state:
                  this.state,

                cause:
                  error,

                details: {
                  durationMs,
                },
              },
            );

      const record =
        Object.freeze({
          phase,

          status:
            'failed',

          startedAt,

          finishedAt,

          durationMs,

          error: {
            name:
              lifecycleError.name,

            code:
              lifecycleError.code,

            message:
              lifecycleError.message,
          },
        });

      this.phaseHistory.push(
        record,
      );

      this.emit(
        'phaseFailed',
        record,
      );

      throw lifecycleError;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Context
   * ---------------------------------------------------------------------------
   */

  setContext(
    context,
  ) {
    if (
      this.state !==
        STATES.CREATED &&
      this.state !==
        STATES.REGISTERING
    ) {
      throw new LifecycleError(
        'Lifecycle context cannot be replaced after initialization begins.',
        {
          code:
            'LIFECYCLE_CONTEXT_LOCKED',

          state:
            this.state,
        },
      );
    }

    this.context =
      context;

    return this.context;
  }

  getContext() {
    return this.context;
  }

  /**
   * ---------------------------------------------------------------------------
   * Process Signals
   * ---------------------------------------------------------------------------
   */

  installProcessHandlers() {
    if (
      this.processHandlersInstalled
    ) {
      return false;
    }

    if (
      this.options
        .installSignalHandlers
    ) {
      const signals = [
        'SIGTERM',
        'SIGINT',
      ];

      if (
        this.options.handleSigquit
      ) {
        signals.push(
          'SIGQUIT',
        );
      }

      for (
        const signal of signals
      ) {
        process.once(
          signal,
          () => {
            void this.shutdown(
              `signal:${signal}`,
              {
                signal,
              },
            );
          },
        );
      }
    }

    if (
      this.options
        .installProcessErrorHandlers
    ) {
      process.once(
        'uncaughtException',
        error => {
          void this._handleFatalProcessError(
            error,
            'uncaughtException',
          );
        },
      );

      process.once(
        'unhandledRejection',
        reason => {
          const error =
            reason instanceof Error
              ? reason
              : new Error(
                  String(reason),
                );

          void this._handleFatalProcessError(
            error,
            'unhandledRejection',
          );
        },
      );
    }

    this.processHandlersInstalled =
      true;

    return true;
  }

  /**
   * ---------------------------------------------------------------------------
   * Fatal Process Errors
   * ---------------------------------------------------------------------------
   */

  async _handleFatalProcessError(
    error,
    reason,
  ) {
    this.failure =
      error;

    this.failedAt =
      now();

    this.emit(
      'fatalError',
      {
        reason,
        error,
        timestamp:
          this.failedAt,
      },
    );

    if (
      reason ===
        'uncaughtException' &&
      this.options
        .terminateOnUncaughtException
    ) {
      await this.shutdown(
        reason,
        {
          error,
        },
      );

      process.exitCode =
        1;

      return;
    }

    if (
      reason ===
        'unhandledRejection' &&
      this.options
        .terminateOnUnhandledRejection
    ) {
      await this.shutdown(
        reason,
        {
          error,
        },
      );

      process.exitCode =
        1;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Startup
   * ---------------------------------------------------------------------------
   */

  async start(
    context = undefined,
  ) {
    if (
      this.state ===
      STATES.RUNNING
    ) {
      return this.context;
    }

    if (
      this.startPromise
    ) {
      return this.startPromise;
    }

    if (
      this.state ===
      STATES.STOPPING
    ) {
      throw new LifecycleError(
        'Cannot start application while shutdown is in progress.',
        {
          code:
            'LIFECYCLE_START_DURING_SHUTDOWN',

          state:
            this.state,
        },
      );
    }

    if (
      this.state ===
      STATES.STOPPED
    ) {
      throw new LifecycleError(
        'Application lifecycle has already stopped.',
        {
          code:
            'LIFECYCLE_ALREADY_STOPPED',

          state:
            this.state,
        },
      );
    }

    this.startPromise =
      (async () => {
        try {
          this.startedAt =
            now();

          /**
           * Context can only be assigned before startup.
           */
          if (
            context !==
            undefined
          ) {
            this.setContext(
              context,
            );
          }

          /**
           * Phase 1:
           * Registration
           */
          this._transition(
            STATES.REGISTERING,
            PHASES.REGISTRATION,
          );

          await this._runPhase(
            PHASES.REGISTRATION,
            async () => {
              /**
               * Hook registration is performed by bootstrap/index.js and the
               * infrastructure composition layer.
               *
               * If an external caller already registered hooks, this phase
               * intentionally remains lightweight.
               */
            },
          );

          /**
           * Install process lifecycle handlers before infrastructure starts.
           */
          this.installProcessHandlers();

          /**
           * Phase 2:
           * Hook Initialization
           */
          this._transition(
            STATES.INITIALIZING,
            PHASES.INITIALIZATION,
          );

          await this._runPhase(
            PHASES.INITIALIZATION,
            async () => {
              await initializeHooks(
                this.context || {},
              );
            },
            {
              timeoutMs:
                this.options
                  .startupTimeoutMs,
            },
          );

          /**
           * Phase 3:
           * Hook Startup
           */
          await this._runPhase(
            PHASES.INFRASTRUCTURE,
            async () => {
              await startHooks(
                this.context || {},
              );
            },
            {
              timeoutMs:
                this.options
                  .startupTimeoutMs,
            },
          );

          /**
           * Phase 4:
           * Readiness
           */
          this._transition(
            STATES.READYING,
            PHASES.READINESS,
          );

          await this._runPhase(
            PHASES.READINESS,
            async () => {
              await this._verifyReadiness();
            },
          );

          /**
           * Running.
           */
          this.readyAt =
            now();

          this._transition(
            STATES.RUNNING,
            PHASES.READINESS,
          );

          this.emit(
            'ready',
            this.snapshot(),
          );

          return this.context;
        } catch (error) {
          this.failure =
            error;

          this.failedAt =
            now();

          this._transition(
            STATES.FAILED,
            this.phase,
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

          this.emit(
            'startupFailed',
            {
              error,
              snapshot:
                this.snapshot(),
            },
          );

          throw error instanceof LifecycleError
            ? error
            : new LifecycleError(
                'Application lifecycle startup failed.',
                {
                  code:
                    'LIFECYCLE_START_FAILED',

                  phase:
                    this.phase,

                  cause:
                    error,
                },
              );
        }
      })();

    try {
      return await withTimeout(
        this.startPromise,
        this.options.startupTimeoutMs,
        'Application startup',
      );
    } finally {
      if (
        this.state !==
        STATES.RUNNING
      ) {
        this.startPromise =
          null;
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness
   * ---------------------------------------------------------------------------
   */

  async _verifyReadiness() {
    /**
     * The hook engine must have reached its started state before the
     * application can claim readiness.
     */
    const hookState =
      getHookState();

    if (
      hookState !==
        'running' &&
      hookState !==
        'ready'
    ) {
      if (
        this.options
          .requireReadiness
      ) {
        throw new LifecycleError(
          `Application cannot become ready because bootstrap hooks are in "${hookState}" state.`,
          {
            code:
              'LIFECYCLE_NOT_READY',

            phase:
              PHASES.READINESS,

            state:
              this.state,

            details: {
              hookState,
            },
          },
        );
      }
    }

    /**
     * Optional application-owned readiness function.
     *
     * bootstrap/index.js may expose:
     *
     *   context.checkReadiness()
     */
    if (
      typeof this.context
        ?.checkReadiness ===
      'function'
    ) {
      const result =
        await this.context
          .checkReadiness();

      if (
        result === false
      ) {
        throw new LifecycleError(
          'Application readiness check returned false.',
          {
            code:
              'LIFECYCLE_READINESS_FAILED',

            phase:
              PHASES.READINESS,
          },
        );
      }
    }

    /**
     * Optional readiness service.
     */
    if (
      typeof this.context
        ?.readiness?.check ===
      'function'
    ) {
      const result =
        await this.context
          .readiness
          .check();

      if (
        result === false
      ) {
        throw new LifecycleError(
          'Infrastructure readiness check failed.',
          {
            code:
              'LIFECYCLE_INFRASTRUCTURE_NOT_READY',

            phase:
              PHASES.READINESS,
          },
        );
      }
    }

    return true;
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async shutdown(
    reason = 'application-request',
    metadata = {},
  ) {
    if (
      this.stopPromise
    ) {
      return this.stopPromise;
    }

    if (
      this.state ===
      STATES.STOPPED
    ) {
      return;
    }

    if (
      this.state ===
      STATES.CREATED
    ) {
      this._transition(
        STATES.STOPPED,
        PHASES.SHUTDOWN,
      );

      this.stoppedAt =
        now();

      return;
    }

    this.stopPromise =
      (async () => {
        this.shuttingDown =
          true;

        this.shutdownReason =
          reason;

        this.signal =
          metadata.signal ||
          null;

        this._transition(
          STATES.STOPPING,
          PHASES.SHUTDOWN,
          {
            reason,
            signal:
              this.signal,
          },
        );

        this.emit(
          'shutdownStarted',
          {
            reason,
            signal:
              this.signal,
            timestamp:
              now(),
          },
        );

        try {
          await this._runPhase(
            PHASES.SHUTDOWN,
            async () => {
              await stopHooks(
                {
                  ...(this.context ||
                    {}),
                  reason,

                  signal:
                    this.signal,

                  shutdownReason:
                    reason,
                },
              );
            },
            {
              timeoutMs:
                this.options
                  .shutdownTimeoutMs,
            },
          );

          this.stoppedAt =
            now();

          this._transition(
            STATES.STOPPED,
            PHASES.SHUTDOWN,
          );

          this.emit(
            'shutdownCompleted',
            {
              reason,

              signal:
                this.signal,

              timestamp:
                this.stoppedAt,
            },
          );
        } catch (error) {
          this.failure =
            error;

          this.failedAt =
            now();

          this._transition(
            STATES.FAILED,
            PHASES.SHUTDOWN,
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

          this.emit(
            'shutdownFailed',
            {
              reason,

              signal:
                this.signal,

              error,
            },
          );

          if (
            this.options
              .forceExitOnShutdownTimeout
          ) {
            this.forceShutdownRequested =
              true;

            process.exitCode =
              1;
          }

          throw error instanceof LifecycleError
            ? error
            : new LifecycleError(
                'Application lifecycle shutdown failed.',
                {
                  code:
                    'LIFECYCLE_SHUTDOWN_FAILED',

                  phase:
                    PHASES.SHUTDOWN,

                  cause:
                    error,
                },
              );
        }
      })();

    try {
      return await this.stopPromise;
    } finally {
      /**
       * Keep the resolved shutdown promise to make repeated shutdown calls
       * idempotent.
       */
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Force Shutdown
   * ---------------------------------------------------------------------------
   *
   * Does not immediately call process.exit().
   *
   * It marks the lifecycle as requiring termination and allows the entry point
   * or supervisor to decide how to terminate the process.
   */

  requestForceShutdown(
    reason =
      'force-shutdown-requested',
  ) {
    this.forceShutdownRequested =
      true;

    this.emit(
      'forceShutdownRequested',
      {
        reason,
        timestamp:
          now(),
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Health State
   * ---------------------------------------------------------------------------
   */

  isReady() {
    return (
      this.state ===
      STATES.RUNNING
    );
  }

  isRunning() {
    return (
      this.state ===
      STATES.RUNNING
    );
  }

  isStopping() {
    return (
      this.state ===
      STATES.STOPPING
    );
  }

  isStopped() {
    return (
      this.state ===
      STATES.STOPPED
    );
  }

  isFailed() {
    return (
      this.state ===
      STATES.FAILED
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Diagnostics
   * ---------------------------------------------------------------------------
   */

  snapshot() {
    const hookSnapshot =
      getHookSnapshot();

    return Object.freeze({
      state:
        this.state,

      phase:
        this.phase,

      ready:
        this.isReady(),

      running:
        this.isRunning(),

      stopping:
        this.isStopping(),

      stopped:
        this.isStopped(),

      failed:
        this.isFailed(),

      shuttingDown:
        this.shuttingDown,

      forceShutdownRequested:
        this.forceShutdownRequested,

      shutdownReason:
        this.shutdownReason,

      signal:
        this.signal,

      startedAt:
        this.startedAt,

      readyAt:
        this.readyAt,

      stoppedAt:
        this.stoppedAt,

      failedAt:
        this.failedAt,

      failure:
        this.failure
          ? Object.freeze({
              name:
                this.failure.name,

              code:
                this.failure.code,

              message:
                this.failure.message,
            })
          : null,

      process:
        Object.freeze({
          pid:
            process.pid,

          nodeVersion:
            process.version,

          platform:
            process.platform,

          architecture:
            process.arch,

          uptime:
            process.uptime(),
        }),

      hooks:
        hookSnapshot,

      phaseHistory:
        Object.freeze([
          ...this.phaseHistory,
        ]),

      stateHistory:
        Object.freeze([
          ...this.stateHistory,
        ]),
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   *
   * Intended for isolated test processes.
   */

  reset() {
    if (
      this.state ===
        STATES.RUNNING ||
      this.state ===
        STATES.STOPPING
    ) {
      throw new LifecycleError(
        'Cannot reset a running lifecycle.',
        {
          code:
            'LIFECYCLE_RESET_RUNNING',

          state:
            this.state,
        },
      );
    }

    this.state =
      STATES.CREATED;

    this.phase =
      null;

    this.context =
      null;

    this.startPromise =
      null;

    this.stopPromise =
      null;

    this.startedAt =
      null;

    this.readyAt =
      null;

    this.stoppedAt =
      null;

    this.failedAt =
      null;

    this.failure =
      null;

    this.shutdownReason =
      null;

    this.signal =
      null;

    this.shuttingDown =
      false;

    this.forceShutdownRequested =
      false;

    this.phaseHistory =
      [];

    this.stateHistory =
      [
        {
          state:
            STATES.CREATED,

          timestamp:
            now(),

          phase:
            null,
        },
      ];

    return this;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Default Application Lifecycle
 * -----------------------------------------------------------------------------
 */

const lifecycle =
  new ApplicationLifecycle();

/**
 * -----------------------------------------------------------------------------
 * Convenience API
 * -----------------------------------------------------------------------------
 */

async function start(
  context = {},
) {
  return lifecycle.start(
    context,
  );
}

async function shutdown(
  reason =
    'application-request',
  metadata = {},
) {
  return lifecycle.shutdown(
    reason,
    metadata,
  );
}

async function stop(
  reason =
    'application-request',
  metadata = {},
) {
  return shutdown(
    reason,
    metadata,
  );
}

function isReady() {
  return lifecycle.isReady();
}

function isRunning() {
  return lifecycle.isRunning();
}

function isStopping() {
  return lifecycle.isStopping();
}

function isStopped() {
  return lifecycle.isStopped();
}

function isFailed() {
  return lifecycle.isFailed();
}

function snapshot() {
  return lifecycle.snapshot();
}

function getState() {
  return lifecycle.state;
}

function getPhase() {
  return lifecycle.phase;
}

function getContext() {
  return lifecycle.getContext();
}

/**
 * -----------------------------------------------------------------------------
 * Default Export
 * -----------------------------------------------------------------------------
 */

module.exports = Object.freeze({
  /**
   * Coordinator.
   */
  ApplicationLifecycle,

  lifecycle,

  /**
   * Lifecycle constants.
   */
  STATES,
  PHASES,

  /**
   * Error type.
   */
  LifecycleError,

  /**
   * Lifecycle operations.
   */
  start,
  shutdown,
  stop,

  /**
   * State.
   */
  getState,
  getPhase,
  getContext,

  isReady,
  isRunning,
  isStopping,
  isStopped,
  isFailed,

  /**
   * Diagnostics.
   */
  snapshot,
});