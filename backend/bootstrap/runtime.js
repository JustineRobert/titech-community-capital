'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/runtime.js
 *
 * Purpose:
 *   Enterprise production-grade application runtime coordinator.
 *
 * Responsibilities:
 *   - Own runtime-level process configuration and lifecycle state.
 *   - Expose canonical runtime metadata.
 *   - Track PID, Node.js version, platform, architecture, uptime and signals.
 *   - Coordinate runtime startup/shutdown state with the bootstrap lifecycle.
 *   - Handle process signals safely.
 *   - Provide graceful shutdown coordination.
 *   - Track runtime fatal errors.
 *   - Monitor event-loop and process-level health.
 *   - Prevent duplicate signal/shutdown execution.
 *   - Provide safe runtime diagnostics.
 *   - Support readiness/liveness integration.
 *
 * Architectural position:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   logger.js
 *       ↓
 *   observability.js
 *       ↓
 *   readinessState.js
 *       ↓
 *   runtime.js
 *       ↓
 *   lifecycleManager.js
 *       ↓
 *   infrastructure.js
 *       ↓
 *   routes.js
 *       ↓
 *   HTTP server
 *
 * IMPORTANT:
 *
 *   runtime.js is a PROCESS RUNTIME ADAPTER.
 *
 *   It does NOT:
 *     - implement business logic
 *     - implement database queries
 *     - implement Redis operations
 *     - implement queue processors
 *     - implement financial transactions
 *     - implement ledger operations
 *     - implement HTTP routes
 *     - implement resilience algorithms
 *
 * Existing application subsystems remain authoritative.
 *
 * =============================================================================
 */

const os = require('node:os');
const process = require('node:process');
const {
  EventEmitter,
} = require('node:events');

/**
 * -----------------------------------------------------------------------------
 * Optional Integrations
 * -----------------------------------------------------------------------------
 */

let loggerModule = null;

try {
  // backend/bootstrap/runtime.js -> backend/bootstrap/logger.js
  // eslint-disable-next-line global-require
  loggerModule =
    require('./logger');
} catch {
  loggerModule = null;
}

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule =
    require('./readinessState');
} catch {
  readinessModule = null;
}

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule = null;
}

let lifecycleModule = null;

try {
  // eslint-disable-next-line global-require
  lifecycleModule =
    require('./lifecycleManager');
} catch {
  lifecycleModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'runtime';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const DEFAULT_SHUTDOWN_TIMEOUT_MS =
  30_000;

const DEFAULT_SIGNAL_GRACE_MS =
  250;

const DEFAULT_EVENT_LOOP_SAMPLE_MS =
  1_000;

const DEFAULT_MAX_FATAL_ERRORS =
  20;

const RUNTIME_STATES =
  Object.freeze({
    CREATED: 'created',
    INITIALIZING: 'initializing',
    RUNNING: 'running',
    DEGRADED: 'degraded',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    FAILED: 'failed',
  });

const SIGNALS =
  Object.freeze([
    'SIGTERM',
    'SIGINT',
    'SIGQUIT',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Errors
 * -----------------------------------------------------------------------------
 */

class RuntimeBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'RuntimeBootstrapError';

    this.code =
      options.code ||
      'RUNTIME_BOOTSTRAP_ERROR';

    this.signal =
      options.signal ||
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
      RuntimeBootstrapError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Utility Functions
 * -----------------------------------------------------------------------------
 */

function asBoolean(
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

  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled',
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
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

    signal:
      error.signal,
  };
}

function hrtimeMs(
  start,
) {
  return Number(
    process.hrtime.bigint() -
      start,
  ) / 1_000_000;
}

/**
 * -----------------------------------------------------------------------------
 * Runtime RuntimeSnapshot
 * -----------------------------------------------------------------------------
 */

function buildRuntimeMetadata() {
  return Object.freeze({
    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    pid:
      process.pid,

    ppid:
      process.ppid,

    nodeVersion:
      process.version,

    nodeMajor:
      Number(
        process.versions.node
          ?.split('.')[0] ||
          0,
      ),

    platform:
      process.platform,

    architecture:
      process.arch,

    hostname:
      os.hostname(),

    cpuCount:
      os.cpus().length,

    cpuModel:
      os.cpus()[0]?.model ||
      'unknown',

    totalMemoryBytes:
      os.totalmem(),

    environment:
      process.env.NODE_ENV ||
      'development',

    execPath:
      process.execPath,

    cwd:
      process.cwd(),

    argv:
      Object.freeze([
        ...process.argv,
      ]),
  });
}

/**
 * =============================================================================
 * Runtime Manager
 * =============================================================================
 */

class RuntimeManager extends EventEmitter {
  constructor(
    options = {},
  ) {
    super();

    this.options =
      Object.freeze({
        shutdownTimeoutMs:
          asPositiveInteger(
            options.shutdownTimeoutMs ??
              process.env.SHUTDOWN_TIMEOUT_MS,
            DEFAULT_SHUTDOWN_TIMEOUT_MS,
          ),

        signalGraceMs:
          asPositiveInteger(
            options.signalGraceMs ??
              process.env.RUNTIME_SIGNAL_GRACE_MS,
            DEFAULT_SIGNAL_GRACE_MS,
          ),

        eventLoopSampleMs:
          asPositiveInteger(
            options.eventLoopSampleMs ??
              process.env.RUNTIME_EVENT_LOOP_SAMPLE_MS,
            DEFAULT_EVENT_LOOP_SAMPLE_MS,
          ),

        maxFatalErrors:
          asPositiveInteger(
            options.maxFatalErrors ??
              process.env.RUNTIME_MAX_FATAL_ERRORS,
            DEFAULT_MAX_FATAL_ERRORS,
          ),

        installSignals:
          options.installSignals ??
          asBoolean(
            process.env.RUNTIME_INSTALL_SIGNALS,
            true,
          ),

        installFatalHandlers:
          options.installFatalHandlers ??
          asBoolean(
            process.env.RUNTIME_INSTALL_FATAL_HANDLERS,
            true,
          ),

        exitOnSignal:
          options.exitOnSignal ??
          asBoolean(
            process.env.RUNTIME_EXIT_ON_SIGNAL,
            true,
          ),

        exitOnFatalError:
          options.exitOnFatalError ??
          asBoolean(
            process.env.RUNTIME_EXIT_ON_FATAL_ERROR,
            true,
          ),

        forceExitOnShutdownTimeout:
          options.forceExitOnShutdownTimeout ??
          asBoolean(
            process.env.RUNTIME_FORCE_EXIT_ON_SHUTDOWN_TIMEOUT,
            false,
          ),
      });

    this.state =
      RUNTIME_STATES.CREATED;

    this.started =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.shutdownRequested =
      false;

    this.fatalErrorDetected =
      false;

    this.initializedAt =
      null;

    this.startedAt =
      null;

    this.stoppingAt =
      null;

    this.stoppedAt =
      null;

    this.failedAt =
      null;

    this.lastSignal =
      null;

    this.shutdownReason =
      null;

    this.failure =
      null;

    this.context =
      null;

    this.startPromise =
      null;

    this.shutdownPromise =
      null;

    this.signalHandlersInstalled =
      false;

    this.fatalHandlersInstalled =
      false;

    this.signalHandlers =
      new Map();

    this.fatalErrors =
      [];

    this.stateHistory =
      [];

    this._eventLoopLagTimer =
      null;

    this._runtimeReady =
      false;

    this._eventLoopLagMs =
      0;

    this._registeredLifecycle =
      false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Logger
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
      /**
       * Runtime handling must not depend on logger availability.
       */
    }

    const text =
      `[${COMPONENT}] ${message}`;

    if (
      level === 'error' ||
      level === 'fatal'
    ) {
      process.stderr.write(
        `${text}\n`,
      );
    } else {
      process.stdout.write(
        `${text}\n`,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * State Transition
   * ---------------------------------------------------------------------------
   */

  _transition(
    nextState,
    metadata = {},
  ) {
    const previousState =
      this.state;

    if (
      previousState ===
      nextState
    ) {
      return;
    }

    this.state =
      nextState;

    const entry =
      Object.freeze({
        previousState,

        state:
          nextState,

        timestamp:
          new Date().toISOString(),

        metadata: {
          ...metadata,
        },
      });

    this.stateHistory.push(
      entry,
    );

    if (
      this.stateHistory.length >
      200
    ) {
      this.stateHistory.shift();
    }

    this.emit(
      'stateChanged',
      entry,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Initialize
   * ---------------------------------------------------------------------------
   */

  async initialize(
    context = {},
  ) {
    if (
      this.started &&
      !this.stopping
    ) {
      return this;
    }

    if (
      this.startPromise
    ) {
      return this.startPromise;
    }

    if (
      this.state ===
      RUNTIME_STATES.STOPPED
    ) {
      throw new RuntimeBootstrapError(
        'TITech runtime cannot be reinitialized after shutdown.',
        {
          code:
            'RUNTIME_ALREADY_STOPPED',
        },
      );
    }

    this.startPromise =
      (async () => {
        this._transition(
          RUNTIME_STATES.INITIALIZING,
        );

        this.initializedAt =
          new Date();

        this.context =
          context;

        try {
          this._installProcessHandlers();

          this._startEventLoopMonitor();

          this.started =
            true;

          this.stopping =
            false;

          this.stopped =
            false;

          this.failed =
            false;

          this._runtimeReady =
            true;

          this.startedAt =
            new Date();

          this._transition(
            RUNTIME_STATES.RUNNING,
          );

          this._emitObservability(
            'runtime.started',
            {
              pid:
                process.pid,

              nodeVersion:
                process.version,
            },
          );

          this._log(
            'info',
            {
              pid:
                process.pid,

              nodeVersion:
                process.version,

              environment:
                process.env.NODE_ENV ||
                'development',
            },
            'TITech application runtime started.',
          );

          return this;
        } catch (error) {
          this.failure =
            error;

          this.failed =
            true;

          this.started =
            false;

          this._runtimeReady =
            false;

          this.failedAt =
            new Date();

          this._transition(
            RUNTIME_STATES.FAILED,
            {
              error:
                safeError(
                  error,
                ),
            },
          );

          throw (
            error instanceof
            RuntimeBootstrapError
              ? error
              : new RuntimeBootstrapError(
                  'TITech runtime initialization failed.',
                  {
                    code:
                      'RUNTIME_INITIALIZATION_FAILED',

                    cause:
                      error,
                  },
                )
          );
        }
      })();

    try {
      return await this.startPromise;
    } finally {
      if (
        this.failed
      ) {
        this.startPromise =
          null;
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Process Signals
   * ---------------------------------------------------------------------------
   */

  _installProcessHandlers() {
    if (
      this.options
        .installSignals &&
      !this.signalHandlersInstalled
    ) {
      this._installSignalHandlers();
    }

    if (
      this.options
        .installFatalHandlers &&
      !this.fatalHandlersInstalled
    ) {
      this._installFatalHandlers();
    }
  }

  _installSignalHandlers() {
    for (
      const signal of
        SIGNALS
    ) {
      const handler =
        () => {
          void this.handleSignal(
            signal,
          );
        };

      process.once(
        signal,
        handler,
      );

      this.signalHandlers.set(
        signal,
        handler,
      );
    }

    this.signalHandlersInstalled =
      true;
  }

  _installFatalHandlers() {
    const uncaughtExceptionHandler =
      error => {
        void this.handleFatalError(
          error,
          'uncaughtException',
        );
      };

    const unhandledRejectionHandler =
      reason => {
        const error =
          reason instanceof
          Error
            ? reason
            : new Error(
                String(reason),
              );

        void this.handleFatalError(
          error,
          'unhandledRejection',
        );
      };

    process.once(
      'uncaughtException',
      uncaughtExceptionHandler,
    );

    process.once(
      'unhandledRejection',
      unhandledRejectionHandler,
    );

    this.fatalHandlersInstalled =
      true;

    this._uncaughtExceptionHandler =
      uncaughtExceptionHandler;

    this._unhandledRejectionHandler =
      unhandledRejectionHandler;
  }

  /**
   * ---------------------------------------------------------------------------
   * Signal Handling
   * ---------------------------------------------------------------------------
   */

  async handleSignal(
    signal,
  ) {
    if (
      !SIGNALS.includes(
        signal,
      )
    ) {
      throw new RuntimeBootstrapError(
        `Unsupported runtime signal "${signal}".`,
        {
          code:
            'RUNTIME_UNSUPPORTED_SIGNAL',

          signal,
        },
      );
    }

    if (
      this.shutdownRequested
    ) {
      this._log(
        'warn',
        {
          signal,
        },
        'TITech runtime received an additional shutdown signal while shutdown was already in progress.',
      );

      return;
    }

    this.shutdownRequested =
      true;

    this.lastSignal =
      signal;

    this.shutdownReason =
      `signal:${signal}`;

    this._emitObservability(
      'runtime.signal',
      {
        signal,
      },
    );

    this.emit(
      'signal',
      {
        signal,

        timestamp:
          new Date().toISOString(),
      },
    );

    this._log(
      'info',
      {
        signal,
      },
      `TITech runtime received ${signal}; beginning graceful shutdown.`,
    );

    try {
      await this.shutdown(
        `signal:${signal}`,
        {
          signal,
        },
      );

      if (
        this.options
          .exitOnSignal
      ) {
        process.exitCode =
          0;
      }
    } catch (error) {
      process.exitCode =
        1;

      this._log(
        'error',
        {
          signal,

          err:
            error,
        },
        'TITech graceful shutdown failed.',
      );

      if (
        this.options
          .forceExitOnShutdownTimeout
      ) {
        this._scheduleForcedExit();
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Fatal Errors
   * ---------------------------------------------------------------------------
   */

  async handleFatalError(
    error,
    reason =
      'fatal-runtime-error',
  ) {
    this.fatalErrorDetected =
      true;

    this.failure =
      error;

    this.failed =
      true;

    this.failedAt =
      new Date();

    this.fatalErrors.unshift(
      {
        reason,

        timestamp:
          new Date().toISOString(),

        error:
          safeError(
            error,
          ),
      },
    );

    if (
      this.fatalErrors.length >
      this.options
        .maxFatalErrors
    ) {
      this.fatalErrors.length =
        this.options
          .maxFatalErrors;
    }

    this._runtimeReady =
      false;

    this._transition(
      RUNTIME_STATES.FAILED,
      {
        reason,

        error:
          safeError(
            error,
          ),
      },
    );

    this._emitObservability(
      'runtime.fatal_error',
      {
        reason,

        error:
          safeError(
            error,
          ),
      },
    );

    this.emit(
      'fatalError',
      {
        reason,

        error,

        timestamp:
          new Date().toISOString(),
      },
    );

    this._log(
      'fatal',
      {
        reason,

        err:
          error,
      },
      'TITech runtime encountered a fatal process error.',
    );

    if (
      this.options
        .exitOnFatalError
    ) {
      try {
        await this.shutdown(
          reason,
          {
            error,
          },
        );
      } catch {
        /**
         * Preserve the terminating exit code.
         */
      }

      process.exitCode =
        1;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Event Loop Monitoring
   * ---------------------------------------------------------------------------
   */

  _startEventLoopMonitor() {
    if (
      this._eventLoopLagTimer
    ) {
      return;
    }

    let expected =
      Date.now() +
      this.options
        .eventLoopSampleMs;

    this._eventLoopLagTimer =
      setInterval(
        () => {
          const actual =
            Date.now();

          this._eventLoopLagMs =
            Math.max(
              0,
              actual -
                expected,
            );

          expected =
            actual +
            this.options
              .eventLoopSampleMs;

          if (
            this._eventLoopLagMs >
            this.options
              .eventLoopSampleMs *
              5
          ) {
            this._emitObservability(
              'runtime.event_loop_lag',
              {
                lagMs:
                  this._eventLoopLagMs,
              },
            );
          }
        },
        this.options
          .eventLoopSampleMs,
      );

    this._eventLoopLagTimer.unref?.();
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness
   * ---------------------------------------------------------------------------
   */

  isReady() {
    if (
      this.stopping ||
      this.stopped ||
      this.failed ||
      this.fatalErrorDetected
    ) {
      return false;
    }

    return (
      this.started &&
      this._runtimeReady
    );
  }

  async readiness() {
    const lifecycleReady =
      this._getLifecycleReadiness();

    const readinessState =
      await this._getReadinessState();

    const ready =
      this.isReady() &&
      lifecycleReady &&
      readinessState;

    if (
      !ready &&
      this.state ===
        RUNTIME_STATES.RUNNING
    ) {
      this._transition(
        RUNTIME_STATES.DEGRADED,
        {
          reason:
            'runtime-readiness-check-failed',
        },
      );
    } else if (
      ready &&
      this.state ===
        RUNTIME_STATES.DEGRADED
    ) {
      this._transition(
        RUNTIME_STATES.RUNNING,
        {
          reason:
            'runtime-readiness-recovered',
        },
      );
    }

    return {
      status:
        ready
          ? 'ready'
          : 'not_ready',

      ready,

      state:
        this.state,

      service:
        SERVICE_NAME,

      application:
        APPLICATION_NAME,

      pid:
        process.pid,

      uptimeSeconds:
        process.uptime(),

      lifecycleReady,

      readinessState,

      timestamp:
        new Date().toISOString(),
    };
  }

  _getLifecycleReadiness() {
    try {
      const lifecycle =
        lifecycleModule
          ?.lifecycleManager;

      if (
        lifecycle &&
        typeof lifecycle.isReady ===
          'function'
      ) {
        return Boolean(
          lifecycle.isReady(),
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  async _getReadinessState() {
    try {
      if (
        typeof readinessModule
          ?.isReady ===
        'function'
      ) {
        return Boolean(
          readinessModule.isReady(),
        );
      }

      if (
        readinessModule
          ?.readinessState &&
        typeof readinessModule
          .readinessState
          .isReady ===
          'function'
      ) {
        return Boolean(
          readinessModule
            .readinessState
            .isReady(),
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  async health() {
    const readiness =
      await this.readiness();

    const memory =
      process.memoryUsage();

    const cpu =
      process.cpuUsage();

    const observabilityHealth =
      await this._getObservabilityHealth();

    return {
      status:
        readiness.ready
          ? 'healthy'
          : this.failed ||
              this.stopped
            ? 'unhealthy'
            : 'degraded',

      ready:
        readiness.ready,

      runtime: {
        state:
          this.state,

        pid:
          process.pid,

        ppid:
          process.ppid,

        uptimeSeconds:
          process.uptime(),

        eventLoopLagMs:
          this._eventLoopLagMs,

        nodeVersion:
          process.version,

        platform:
          process.platform,

        architecture:
          process.arch,
      },

      resources: {
        memory,
        cpu,
      },

      observability:
        observabilityHealth,

      readiness,

      timestamp:
        new Date().toISOString(),
    };
  }

  async _getObservabilityHealth() {
    try {
      if (
        typeof observabilityModule
          ?.health ===
        'function'
      ) {
        return await observabilityModule.health();
      }

      if (
        observabilityModule
          ?.observability &&
        typeof observabilityModule
          .observability
          .health ===
          'function'
      ) {
        return await observabilityModule
          .observability
          .health();
      }

      return null;
    } catch (error) {
      return {
        status:
          'unhealthy',

        error:
          safeError(
            error,
          ),
      };
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async shutdown(
    reason =
      'application-request',
    metadata = {},
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
        this.shutdownRequested =
          true;

        this.shutdownReason =
          reason;

        this.lastSignal =
          metadata.signal ||
          this.lastSignal;

        this.stopping =
          true;

        this.started =
          false;

        this._runtimeReady =
          false;

        this.stoppingAt =
          new Date();

        this._transition(
          RUNTIME_STATES.STOPPING,
          {
            reason,

            signal:
              this.lastSignal,
          },
        );

        this._emitObservability(
          'runtime.shutdown_started',
          {
            reason,

            signal:
              this.lastSignal,
          },
        );

        this.emit(
          'shutdownStarted',
          {
            reason,

            signal:
              this.lastSignal,

            timestamp:
              new Date().toISOString(),
          },
        );

        const started =
          process.hrtime.bigint();

        try {
          /**
           * The actual application teardown belongs to lifecycleManager /
           * lifecycle / hooks.
           *
           * runtime.js requests it rather than duplicating subsystem cleanup.
           */
          await this._shutdownLifecycle(
            {
              reason,

              signal:
                this.lastSignal,

              ...metadata,
            },
          );

          this._stopEventLoopMonitor();

          this.stopped =
            true;

          this.stopping =
            false;

          this.failed =
            false;

          this.stoppedAt =
            new Date();

          this._transition(
            RUNTIME_STATES.STOPPED,
            {
              reason,

              durationMs:
                hrtimeMs(
                  started,
                ),
            },
          );

          this._emitObservability(
            'runtime.shutdown_completed',
            {
              reason,

              durationMs:
                hrtimeMs(
                  started,
                ),
            },
          );

          this.emit(
            'shutdownCompleted',
            {
              reason,

              signal:
                this.lastSignal,

              durationMs:
                hrtimeMs(
                  started,
                ),

              timestamp:
                new Date().toISOString(),
            },
          );

          /**
           * Flush the logger last.
           */
          await this._flushLogger();

          return true;
        } catch (error) {
          this.failure =
            error;

          this.failed =
            true;

          this.stopping =
            false;

          this._runtimeReady =
            false;

          this.failedAt =
            new Date();

          this._transition(
            RUNTIME_STATES.FAILED,
            {
              reason,

              error:
                safeError(
                  error,
                ),
            },
          );

          this._emitObservability(
            'runtime.shutdown_failed',
            {
              reason,

              error:
                safeError(
                  error,
                ),
            },
          );

          this.emit(
            'shutdownFailed',
            {
              reason,

              signal:
                this.lastSignal,

              error,

              timestamp:
                new Date().toISOString(),
            },
          );

          if (
            this.options
              .forceExitOnShutdownTimeout
          ) {
            this._scheduleForcedExit();
          }

          throw (
            error instanceof
            RuntimeBootstrapError
              ? error
              : new RuntimeBootstrapError(
                  'TITech runtime shutdown failed.',
                  {
                    code:
                      'RUNTIME_SHUTDOWN_FAILED',

                    signal:
                      this.lastSignal,

                    cause:
                      error,
                  },
                )
          );
        }
      })();

    return this.shutdownPromise;
  }

  async _shutdownLifecycle(
    context,
  ) {
    /**
     * Prefer lifecycleManager because it owns manager dependency ordering.
     */
    if (
      lifecycleModule
        ?.lifecycleManager &&
      typeof lifecycleModule
        .lifecycleManager
        .shutdown ===
        'function'
    ) {
      return Promise.race([
        lifecycleModule
          .lifecycleManager
          .shutdown(
            context,
            context.reason ||
              'runtime-shutdown',
          ),

        this._timeout(
          this.options
            .shutdownTimeoutMs,
          'lifecycle manager shutdown',
        ),
      ]);
    }

    /**
     * Fallback to lifecycle.js.
     */
    if (
      typeof lifecycleModule
        ?.shutdown ===
      'function'
    ) {
      return Promise.race([
        lifecycleModule.shutdown(
          context.reason ||
            'runtime-shutdown',
          context,
        ),

        this._timeout(
          this.options
            .shutdownTimeoutMs,
          'application lifecycle shutdown',
        ),
      ]);
    }

    /**
     * Final fallback to hooks.js, though a fully bootstrapped TITech production
     * process should normally have lifecycleManager available.
     */
    try {
      const hooksModule =
        require('./hooks');

      if (
        typeof hooksModule.stop ===
        'function'
      ) {
        return Promise.race([
          hooksModule.stop(
            context,
          ),

          this._timeout(
            this.options
              .shutdownTimeoutMs,
            'bootstrap hook shutdown',
          ),
        ]);
      }
    } catch {
      // Best-effort fallback.
    }

    return true;
  }

  _timeout(
    timeoutMs,
    operation,
  ) {
    return new Promise(
      (_, reject) => {
        const timer =
          setTimeout(
            () => {
              reject(
                new RuntimeBootstrapError(
                  `TITech ${operation} timed out after ${timeoutMs}ms.`,
                  {
                    code:
                      'RUNTIME_SHUTDOWN_TIMEOUT',

                    phase:
                      'shutdown',
                  },
                ),
              );
            },
            timeoutMs,
          );

        timer.unref?.();
      },
    );
  }

  _stopEventLoopMonitor() {
    if (
      this._eventLoopLagTimer
    ) {
      clearInterval(
        this._eventLoopLagTimer,
      );

      this._eventLoopLagTimer =
        null;
    }
  }

  _scheduleForcedExit() {
    setTimeout(
      () => {
        process.exitCode =
          1;
      },
      this.options
        .signalGraceMs,
    ).unref?.();
  }

  async _flushLogger() {
    try {
      if (
        typeof loggerModule
          ?.getLogger ===
        'function'
      ) {
        const logger =
          loggerModule.getLogger();

        if (
          typeof logger.flush ===
          'function'
        ) {
          await new Promise(
            resolve => {
              try {
                logger.flush(
                  () =>
                    resolve(),
                );
              } catch {
                resolve();
              }
            },
          );
        }
      }
    } catch {
      /**
       * Never replace the shutdown result with a logging flush failure.
       */
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Observability
   * ---------------------------------------------------------------------------
   */

  _emitObservability(
    event,
    payload = {},
  ) {
    try {
      const observability =
        observabilityModule
          ?.observability;

      if (
        observability &&
        typeof observability.emitEvent ===
          'function'
      ) {
        return observability.emitEvent(
          event,
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            application:
              APPLICATION_NAME,

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

            application:
              APPLICATION_NAME,

            ...payload,
          },
        );
      }
    } catch {
      /**
       * Runtime must remain operational if observability becomes unavailable.
       */
    }

    return null;
  }

  /**
   * ---------------------------------------------------------------------------
   * Bootstrap Registration
   * ---------------------------------------------------------------------------
   */

  registerBootstrapHooks(
    context = {},
    options = {},
  ) {
    if (
      this._registeredLifecycle
    ) {
      return null;
    }

    let hooksModule;

    try {
      hooksModule =
        require('./hooks');
    } catch (error) {
      throw new RuntimeBootstrapError(
        'TITech runtime could not load the lifecycle hook engine.',
        {
          code:
            'RUNTIME_HOOK_ENGINE_UNAVAILABLE',

          cause:
            error,
        },
      );
    }

    if (
      hooksModule.hooks.has(
        COMPONENT,
      )
    ) {
      this._registeredLifecycle =
        true;

      return hooksModule.hooks.get(
        COMPONENT,
      );
    }

    const result =
      hooksModule.hooks.register({
        name:
          COMPONENT,

        phase:
          hooksModule.HOOK_PHASES.STARTUP,

        priority:
          options.priority ??
          -800,

        dependencies:
          options.dependencies ||
          [
            'readiness',
            'resilience',
          ],

        timeoutMs:
          options.timeoutMs ||
          30_000,

        critical:
          options.critical !==
          false,

        start:
          async hookContext => {
            return this.initialize(
              hookContext ||
                context,
            );
          },

        stop:
          async hookContext => {
            return this.shutdown(
              hookContext?.reason ||
                'bootstrap-shutdown',
              hookContext,
            );
          },

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          application:
            APPLICATION_NAME,
        },
      });

    this._registeredLifecycle =
      true;

    return result;
  }

  /**
   * ---------------------------------------------------------------------------
   * Process Metadata
   * ---------------------------------------------------------------------------
   */

  metadata() {
    return Object.freeze({
      ...buildRuntimeMetadata(),

      state:
        this.state,

      started:
        this.started,

      stopping:
        this.stopping,

      stopped:
        this.stopped,

      failed:
        this.failed,

      ready:
        this.isReady(),

      uptimeSeconds:
        process.uptime(),

      eventLoopLagMs:
        this._eventLoopLagMs,

      initializedAt:
        this.initializedAt,

      startedAt:
        this.startedAt,

      stoppingAt:
        this.stoppingAt,

      stoppedAt:
        this.stoppedAt,

      failedAt:
        this.failedAt,

      lastSignal:
        this.lastSignal,

      shutdownReason:
        this.shutdownReason,
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Snapshot
   * ---------------------------------------------------------------------------
   */

  snapshot() {
    const memory =
      process.memoryUsage();

    return Object.freeze({
      ...this.metadata(),

      resources: {
        memory: {
          rss:
            memory.rss,

          heapUsed:
            memory.heapUsed,

          heapTotal:
            memory.heapTotal,

          external:
            memory.external,

          arrayBuffers:
            memory.arrayBuffers,
        },

        cpu:
          process.cpuUsage(),
      },

      failure:
        safeError(
          this.failure,
        ),

      fatalErrors:
        Object.freeze([
          ...this.fatalErrors,
        ]),

      stateHistory:
        Object.freeze([
          ...this.stateHistory,
        ]),

      signalHandlersInstalled:
        this.signalHandlersInstalled,

      fatalHandlersInstalled:
        this.fatalHandlersInstalled,

      lifecycleRegistered:
        this._registeredLifecycle,
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown Signal Cleanup
   * ---------------------------------------------------------------------------
   */

  removeSignalHandlers() {
    for (
      const [
        signal,
        handler,
      ] of this.signalHandlers
    ) {
      process.removeListener(
        signal,
        handler,
      );
    }

    this.signalHandlers.clear();

    this.signalHandlersInstalled =
      false;

    return true;
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   *
   * Testing/process isolation only.
   */

  reset() {
    if (
      this.started ||
      this.stopping
    ) {
      throw new RuntimeBootstrapError(
        'Cannot reset an active TITech runtime.',
        {
          code:
            'RUNTIME_RESET_NOT_ALLOWED',
        },
      );
    }

    this.removeSignalHandlers();

    this._stopEventLoopMonitor();

    this.state =
      RUNTIME_STATES.CREATED;

    this.started =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.shutdownRequested =
      false;

    this.fatalErrorDetected =
      false;

    this.initializedAt =
      null;

    this.startedAt =
      null;

    this.stoppingAt =
      null;

    this.stoppedAt =
      null;

    this.failedAt =
      null;

    this.lastSignal =
      null;

    this.shutdownReason =
      null;

    this.failure =
      null;

    this.context =
      null;

    this.startPromise =
      null;

    this.shutdownPromise =
      null;

    this.fatalErrors =
      [];

    this.stateHistory =
      [];

    this._runtimeReady =
      false;

    this._eventLoopLagMs =
      0;

    this._registeredLifecycle =
      false;

    return this;
  }
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 */

const runtime =
  new RuntimeManager();

/**
 * -----------------------------------------------------------------------------
 * Convenience Functions
 * -----------------------------------------------------------------------------
 */

async function initialize(
  context = {},
) {
  return runtime.initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return runtime.initialize(
    context,
  );
}

async function shutdown(
  reason =
    'application-request',
  metadata = {},
) {
  return runtime.shutdown(
    reason,
    metadata,
  );
}

async function stop(
  reason =
    'application-request',
  metadata = {},
) {
  return runtime.shutdown(
    reason,
    metadata,
  );
}

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return runtime.registerBootstrapHooks(
    context,
    options,
  );
}

function isReady() {
  return runtime.isReady();
}

function isRunning() {
  return (
    runtime.started &&
    !runtime.stopping
  );
}

function isStopping() {
  return runtime.stopping;
}

function isStopped() {
  return runtime.stopped;
}

function isFailed() {
  return runtime.failed;
}

function metadata() {
  return runtime.metadata();
}

function snapshot() {
  return runtime.snapshot();
}

function health() {
  return runtime.health();
}

function readiness() {
  return runtime.readiness();
}

/**
 * -----------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------
 */

module.exports =
  Object.freeze({
    /**
     * Core class and singleton.
     */
    RuntimeManager,

    RuntimeBootstrapError,

    runtime,

    RUNTIME_STATES,

    SIGNALS,

    /**
     * Lifecycle.
     */
    initialize,
    start,

    shutdown,
    stop,

    registerBootstrapHooks,

    /**
     * Runtime state.
     */
    isReady,
    isRunning,
    isStopping,
    isStopped,
    isFailed,

    /**
     * Operational APIs.
     */
    metadata,
    snapshot,
    health,
    readiness,

    /**
     * Direct handlers.
     */
    handleSignal:
      signal =>
        runtime.handleSignal(
          signal,
        ),

    handleFatalError:
      (
        error,
        reason,
      ) =>
        runtime.handleFatalError(
          error,
          reason,
        ),

    removeSignalHandlers:
      () =>
        runtime.removeSignalHandlers(),

    /**
     * Testing.
     */
    reset:
      () =>
        runtime.reset(),
  });