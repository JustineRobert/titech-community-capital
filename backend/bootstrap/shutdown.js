'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/shutdown.js
 *
 * Version:
 *   Enterprise Production Shutdown Coordinator
 *
 * Purpose:
 *   Canonical application shutdown orchestration boundary for the TITech
 *   Community Capital backend runtime.
 *
 * Responsibilities:
 *   - Coordinate deterministic application shutdown.
 *   - Provide one canonical shutdown entry point.
 *   - Prevent duplicate/concurrent shutdown execution.
 *   - Support graceful shutdown on SIGTERM/SIGINT/SIGQUIT.
 *   - Handle fatal process errors through controlled shutdown.
 *   - Mark the application unready before traffic draining.
 *   - Drain HTTP/HTTPS traffic before infrastructure teardown.
 *   - Execute lifecycle-owned resources through the authoritative lifecycle
 *     manager where available.
 *   - Execute explicitly registered shutdown participants in reverse
 *     dependency/priority order.
 *   - Enforce participant and global shutdown deadlines.
 *   - Continue best-effort cleanup according to shutdown policy.
 *   - Preserve the original shutdown failure.
 *   - Flush observability and logging after application resources stop.
 *   - Expose safe operational diagnostics.
 *
 * Architectural position:
 *
 *   bootstrap/runtime
 *          ↓
 *   shutdown coordinator
 *          ↓
 *   readiness
 *          ↓
 *   HTTP/HTTPS server
 *          ↓
 *   lifecycle manager
 *          ↓
 *   registered shutdown participants
 *          ↓
 *   observability / logger
 *
 * IMPORTANT:
 *
 *   This module is an ORCHESTRATOR.
 *
 *   It does NOT:
 *     - implement financial logic
 *     - implement ledger logic
 *     - execute database queries
 *     - own MongoDB
 *     - own Redis
 *     - process queue messages
 *     - implement HTTP routes
 *     - duplicate subsystem cleanup logic
 *
 * Existing subsystems remain authoritative for their own resources.
 *
 * =============================================================================
 */

const {
  EventEmitter,
} = require('node:events');

/**
 * =============================================================================
 * Optional Lifecycle Dependencies
 * =============================================================================
 */

let hooksModule = null;

try {
  // eslint-disable-next-line global-require
  hooksModule = require('./hooks');
} catch {
  hooksModule = null;
}

let lifecycleModule = null;

try {
  // eslint-disable-next-line global-require
  lifecycleModule = require('./lifecycleManager');
} catch {
  lifecycleModule = null;
}

let applicationLifecycleModule = null;

try {
  // eslint-disable-next-line global-require
  applicationLifecycleModule = require('./lifecycle');
} catch {
  applicationLifecycleModule = null;
}

let runtimeModule = null;

try {
  // eslint-disable-next-line global-require
  runtimeModule = require('./runtime');
} catch {
  runtimeModule = null;
}

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule = require('./readinessState');
} catch {
  readinessModule = null;
}

let serverModule = null;

try {
  // eslint-disable-next-line global-require
  serverModule = require('./server');
} catch {
  serverModule = null;
}

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule = require('./observability');
} catch {
  observabilityModule = null;
}

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule = require('./logger');
} catch {
  loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT = 'shutdown';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const DEFAULTS = Object.freeze({
  timeoutMs: 30_000,

  participantTimeoutMs: 15_000,

  signalGraceMs: 250,

  forceExitOnTimeout: false,

  continueOnError: true,

  installSignalHandlers: false,

  shutdownOnUncaughtException: true,

  shutdownOnUnhandledRejection: true,

  closeServerFirst: true,

  markNotReadyFirst: true,

  flushObservabilityLast: true,

  flushLoggerLast: true,

  processErrorExitCode: 1,
});

const SIGNALS = Object.freeze([
  'SIGTERM',
  'SIGINT',
  'SIGQUIT',
]);

const SHUTDOWN_STATES = Object.freeze({
  CREATED: 'created',
  REQUESTED: 'requested',
  DRAINING: 'draining',
  STOPPING: 'stopping',
  FLUSHING: 'flushing',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

const TERMINAL_STATES = new Set([
  SHUTDOWN_STATES.STOPPED,
  SHUTDOWN_STATES.FAILED,
]);

const STATE_TRANSITIONS = Object.freeze({
  [SHUTDOWN_STATES.CREATED]: new Set([
    SHUTDOWN_STATES.REQUESTED,
  ]),

  [SHUTDOWN_STATES.REQUESTED]: new Set([
    SHUTDOWN_STATES.DRAINING,
    SHUTDOWN_STATES.FAILED,
  ]),

  [SHUTDOWN_STATES.DRAINING]: new Set([
    SHUTDOWN_STATES.STOPPING,
    SHUTDOWN_STATES.FLUSHING,
    SHUTDOWN_STATES.FAILED,
  ]),

  [SHUTDOWN_STATES.STOPPING]: new Set([
    SHUTDOWN_STATES.FLUSHING,
    SHUTDOWN_STATES.FAILED,
  ]),

  [SHUTDOWN_STATES.FLUSHING]: new Set([
    SHUTDOWN_STATES.STOPPED,
    SHUTDOWN_STATES.FAILED,
  ]),

  [SHUTDOWN_STATES.STOPPED]: new Set([
    SHUTDOWN_STATES.REQUESTED,
    SHUTDOWN_STATES.CREATED,
  ]),

  [SHUTDOWN_STATES.FAILED]: new Set([
    SHUTDOWN_STATES.REQUESTED,
    SHUTDOWN_STATES.CREATED,
  ]),
});

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class ShutdownError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'ShutdownError';

    this.code =
      options.code ||
      'SHUTDOWN_ERROR';

    this.phase =
      options.phase ||
      null;

    this.participant =
      options.participant ||
      null;

    this.signal =
      options.signal ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    Error.captureStackTrace?.(
      this,
      ShutdownError,
    );
  }
}

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function asBoolean(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (typeof value === 'boolean') {
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

function asPositiveInteger(value, fallback) {
  const parsed =
    value === undefined ||
    value === null ||
    value === ''
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
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

function safeError(error) {
  if (!error) {
    return null;
  }

  return Object.freeze({
    name:
      error.name ||
      'Error',

    code:
      error.code ||
      undefined,

    message:
      typeof error.message === 'string'
        ? error.message
        : String(error),

    stack:
      process.env.NODE_ENV === 'production'
        ? undefined
        : error.stack,
  });
}

function hrtimeMs(start) {
  return (
    Number(
      process.hrtime.bigint() -
        start,
    ) / 1_000_000
  );
}

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
}

/**
 * =============================================================================
 * Timeout Helper
 * =============================================================================
 *
 * Promise.race alone does not cancel the underlying operation. That is
 * intentional: shutdown participants must still be allowed to clean themselves
 * up if possible, while the coordinator stops waiting after the deadline.
 * =============================================================================
 */

async function withTimeout(
  fn,
  timeoutMs,
  label,
) {
  const timeout =
    asPositiveInteger(
      timeoutMs,
      DEFAULTS.participantTimeoutMs,
    );

  let timer = null;

  const operation = Promise.resolve().then(
    fn,
  );

  const timeoutPromise =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new ShutdownError(
                `${label} timed out after ${timeout}ms.`,
                {
                  code:
                    'SHUTDOWN_TIMEOUT',
                },
              ),
            );
          },
          timeout,
        );

        timer.unref?.();
      },
    );

  try {
    return await Promise.race([
      operation,
      timeoutPromise,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * =============================================================================
 * Shutdown Coordinator
 * =============================================================================
 */

class ShutdownCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = Object.freeze({
      timeoutMs:
        asPositiveInteger(
          options.timeoutMs ??
            process.env.SHUTDOWN_TIMEOUT_MS,
          DEFAULTS.timeoutMs,
        ),

      participantTimeoutMs:
        asPositiveInteger(
          options.participantTimeoutMs ??
            process.env.SHUTDOWN_PARTICIPANT_TIMEOUT_MS,
          DEFAULTS.participantTimeoutMs,
        ),

      signalGraceMs:
        asPositiveInteger(
          options.signalGraceMs ??
            process.env.SHUTDOWN_SIGNAL_GRACE_MS,
          DEFAULTS.signalGraceMs,
        ),

      forceExitOnTimeout:
        options.forceExitOnTimeout ??
        asBoolean(
          process.env.SHUTDOWN_FORCE_EXIT,
          DEFAULTS.forceExitOnTimeout,
        ),

      continueOnError:
        options.continueOnError ??
        asBoolean(
          process.env.SHUTDOWN_CONTINUE_ON_ERROR,
          DEFAULTS.continueOnError,
        ),

      installSignalHandlers:
        options.installSignalHandlers ??
        asBoolean(
          process.env.SHUTDOWN_INSTALL_SIGNALS,
          DEFAULTS.installSignalHandlers,
        ),

      shutdownOnUncaughtException:
        options.shutdownOnUncaughtException ??
        asBoolean(
          process.env.SHUTDOWN_ON_UNCAUGHT_EXCEPTION,
          DEFAULTS.shutdownOnUncaughtException,
        ),

      shutdownOnUnhandledRejection:
        options.shutdownOnUnhandledRejection ??
        asBoolean(
          process.env.SHUTDOWN_ON_UNHANDLED_REJECTION,
          DEFAULTS.shutdownOnUnhandledRejection,
        ),

      closeServerFirst:
        options.closeServerFirst ??
        DEFAULTS.closeServerFirst,

      markNotReadyFirst:
        options.markNotReadyFirst ??
        DEFAULTS.markNotReadyFirst,

      flushObservabilityLast:
        options.flushObservabilityLast ??
        DEFAULTS.flushObservabilityLast,

      flushLoggerLast:
        options.flushLoggerLast ??
        DEFAULTS.flushLoggerLast,

      processErrorExitCode:
        asPositiveInteger(
          options.processErrorExitCode ??
            process.env.SHUTDOWN_PROCESS_ERROR_EXIT_CODE,
          DEFAULTS.processErrorExitCode,
        ),
    });

    this.state =
      SHUTDOWN_STATES.CREATED;

    this.requestedAt = null;
    this.startedAt = null;
    this.completedAt = null;

    this.reason = null;
    this.signal = null;

    this.failure = null;

    this.shutdownPromise = null;

    this.shutdownRequested = false;

    this.forceExitRequested = false;

    this.signalHandlersInstalled = false;

    this.processErrorHandlersInstalled = false;

    this.participants = new Map();

    this.executionHistory = [];

    this.errors = [];

    this._fatalProcessError = false;

    this._forceExitTimer = null;

    this._installSignalHandlersIfConfigured();
  }

  /**
   * ===========================================================================
   * Logging
   * ===========================================================================
   */

  _log(level, payload = {}, message = '') {
    try {
      const logger =
        loggerModule?.getLogger?.();

      if (
        logger &&
        typeof logger[level] === 'function'
      ) {
        logger[level](
          {
            component: COMPONENT,
            service: SERVICE_NAME,
            application: APPLICATION_NAME,
            ...payload,
          },
          message,
        );

        return;
      }
    } catch {
      // Shutdown must never depend on logging.
    }

    const serializedPayload =
      Object.keys(payload).length
        ? ` ${JSON.stringify(
            this._sanitizePayload(payload),
          )}`
        : '';

    const output =
      `[${COMPONENT}] ${message}${serializedPayload}`;

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

  _sanitizePayload(payload) {
    const output = {};

    for (
      const [key, value] of Object.entries(
        payload || {},
      )
    ) {
      if (
        key === 'error' ||
        key === 'err' ||
        key === 'cause'
      ) {
        output[key] =
          safeError(value);

        continue;
      }

      if (
        typeof value === 'bigint'
      ) {
        output[key] =
          value.toString();

        continue;
      }

      output[key] = value;
    }

    return output;
  }

  /**
   * ===========================================================================
   * Observability
   * ===========================================================================
   */

  _emitObservability(
    event,
    payload = {},
  ) {
    try {
      const normalizedPayload = {
        component: COMPONENT,
        service: SERVICE_NAME,
        application: APPLICATION_NAME,
        ...payload,
      };

      if (
        observabilityModule
          ?.observability
          ?.emitEvent
      ) {
        return observabilityModule
          .observability
          .emitEvent(
            event,
            normalizedPayload,
          );
      }

      if (
        typeof observabilityModule?.emitEvent ===
        'function'
      ) {
        return observabilityModule.emitEvent(
          event,
          normalizedPayload,
        );
      }
    } catch {
      // Telemetry must never block shutdown.
    }

    return null;
  }

  /**
   * ===========================================================================
   * Participant Registration
   * ===========================================================================
   */

  register(options = {}) {
    const name =
      normalizeName(
        options.name,
      );

    if (
      this.participants.has(name)
    ) {
      throw new ShutdownError(
        `Shutdown participant "${name}" is already registered.`,
        {
          code:
            'SHUTDOWN_PARTICIPANT_DUPLICATE',
          participant: name,
        },
      );
    }

    const participant = {
      name,

      priority:
        Number.isInteger(
          options.priority,
        )
          ? options.priority
          : 0,

      timeoutMs:
        asPositiveInteger(
          options.timeoutMs,
          this.options
            .participantTimeoutMs,
        ),

      critical:
        options.critical !== false,

      enabled:
        options.enabled !== false,

      stop:
        typeof options.stop ===
        'function'
          ? options.stop
          : null,

      metadata: {
        ...(options.metadata || {}),
      },

      registeredAt:
        new Date(),
    };

    this.participants.set(
      name,
      participant,
    );

    this._emitObservability(
      'shutdown.participant_registered',
      {
        participant: name,
        priority:
          participant.priority,
        critical:
          participant.critical,
      },
    );

    return Object.freeze({
      ...participant,
      metadata: {
        ...participant.metadata,
      },
    });
  }

  unregister(name) {
    const normalized =
      normalizeName(name);

    const removed =
      this.participants.delete(
        normalized,
      );

    if (removed) {
      this._emitObservability(
        'shutdown.participant_unregistered',
        {
          participant: normalized,
        },
      );
    }

    return removed;
  }

  has(name) {
    return this.participants.has(
      normalizeName(name),
    );
  }

  list() {
    return [
      ...this.participants.values(),
    ].map(
      participant =>
        Object.freeze({
          ...participant,
          metadata: {
            ...participant.metadata,
          },
        }),
    );
  }

  /**
   * ===========================================================================
   * Participant Ordering
   * ===========================================================================
   *
   * Higher priority resources are considered later in startup and therefore
   * are stopped first during shutdown.
   * ===========================================================================
   */

  _resolveParticipantOrder() {
    return [
      ...this.participants.values(),
    ]
      .filter(
        participant =>
          participant.enabled &&
          typeof participant.stop ===
            'function',
      )
      .sort(
        (a, b) => {
          if (
            a.priority !==
            b.priority
          ) {
            return (
              b.priority -
              a.priority
            );
          }

          return a.name.localeCompare(
            b.name,
          );
        },
      );
  }

  /**
   * ===========================================================================
   * Signal Handling
   * ===========================================================================
   */

  _createSignalHandler(signal) {
    return () => {
      const request =
        this.request(
          `signal:${signal}`,
          {
            signal,
          },
        );

      request.catch(
        error => {
          this._log(
            'error',
            {
              signal,
              error,
            },
            'TITech shutdown triggered by signal failed.',
          );

          this.forceExit();
        },
      );
    };
  }

  _installSignalHandlersIfConfigured() {
    if (
      !this.options
        .installSignalHandlers ||
      this.signalHandlersInstalled
    ) {
      return;
    }

    this.installSignalHandlers();
  }

  installSignalHandlers() {
    if (
      this.signalHandlersInstalled
    ) {
      return false;
    }

    for (
      const signal of SIGNALS
    ) {
      const handler =
        this._createSignalHandler(
          signal,
        );

      process.once(
        signal,
        handler,
      );

      this[`_${signal}Handler`] =
        handler;
    }

    this.signalHandlersInstalled =
      true;

    this._emitObservability(
      'shutdown.signal_handlers_installed',
    );

    return true;
  }

  removeSignalHandlers() {
    for (
      const signal of SIGNALS
    ) {
      const handler =
        this[`_${signal}Handler`];

      if (handler) {
        process.removeListener(
          signal,
          handler,
        );

        this[`_${signal}Handler`] =
          null;
      }
    }

    this.signalHandlersInstalled =
      false;

    return true;
  }

  /**
   * ===========================================================================
   * Fatal Process Error Handling
   * ===========================================================================
   */

  installProcessErrorHandlers() {
    if (
      this.processErrorHandlersInstalled
    ) {
      return false;
    }

    const uncaughtExceptionHandler =
      error => {
        if (
          !this.options
            .shutdownOnUncaughtException
        ) {
          return;
        }

        this._fatalProcessError =
          true;

        const request =
          this.request(
            'uncaughtException',
            {
              error,
            },
          );

        request.catch(
          shutdownError => {
            this._log(
              'error',
              {
                error:
                  shutdownError,
              },
              'Shutdown after uncaught exception failed.',
            );

            this.forceExit();
          },
        );
      };

    const unhandledRejectionHandler =
      reason => {
        if (
          !this.options
            .shutdownOnUnhandledRejection
        ) {
          return;
        }

        this._fatalProcessError =
          true;

        const error =
          reason instanceof Error
            ? reason
            : new Error(
                String(reason),
              );

        const request =
          this.request(
            'unhandledRejection',
            {
              error,
            },
          );

        request.catch(
          shutdownError => {
            this._log(
              'error',
              {
                error:
                  shutdownError,
              },
              'Shutdown after unhandled rejection failed.',
            );

            this.forceExit();
          },
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

    this._uncaughtExceptionHandler =
      uncaughtExceptionHandler;

    this._unhandledRejectionHandler =
      unhandledRejectionHandler;

    this.processErrorHandlersInstalled =
      true;

    return true;
  }

  removeProcessErrorHandlers() {
    if (
      this._uncaughtExceptionHandler
    ) {
      process.removeListener(
        'uncaughtException',
        this._uncaughtExceptionHandler,
      );
    }

    if (
      this._unhandledRejectionHandler
    ) {
      process.removeListener(
        'unhandledRejection',
        this._unhandledRejectionHandler,
      );
    }

    this._uncaughtExceptionHandler =
      null;

    this._unhandledRejectionHandler =
      null;

    this.processErrorHandlersInstalled =
      false;

    return true;
  }

  /**
   * ===========================================================================
   * Shutdown Request
   * ===========================================================================
   */

  async request(
    reason = 'application-request',
    metadata = {},
  ) {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    if (
      this.state ===
      SHUTDOWN_STATES.STOPPED
    ) {
      return true;
    }

    this.shutdownRequested = true;

    this.reason =
      typeof reason === 'string' &&
      reason.trim()
        ? reason.trim()
        : 'application-request';

    this.signal =
      metadata.signal ||
      null;

    this.requestedAt =
      new Date();

    this.startedAt =
      new Date();

    this.failure =
      null;

    this._transition(
      SHUTDOWN_STATES.REQUESTED,
      {
        reason: this.reason,
        signal: this.signal,
      },
    );

    this._emitObservability(
      'shutdown.requested',
      {
        reason: this.reason,
        signal: this.signal,
        fatalProcessError:
          this._fatalProcessError,
      },
    );

    this._log(
      'info',
      {
        reason: this.reason,
        signal: this.signal,
      },
      'TITech application shutdown requested.',
    );

    const deferred =
      createDeferred();

    this.shutdownPromise =
      deferred.promise;

    void this._performShutdown(
      metadata,
      deferred,
    );

    return deferred.promise;
  }

  /**
   * ===========================================================================
   * Global Deadline
   * ===========================================================================
   */

  async _runWithGlobalDeadline(
    operation,
    label,
  ) {
    return withTimeout(
      operation,
      this.options.timeoutMs,
      label,
    );
  }

  /**
   * ===========================================================================
   * Shutdown Execution
   * ===========================================================================
   */

  async _performShutdown(
    metadata,
    deferred,
  ) {
    const started =
      process.hrtime.bigint();

    let fatalError = null;

    try {
      this._transition(
        SHUTDOWN_STATES.DRAINING,
        {
          reason: this.reason,
          signal: this.signal,
        },
      );

      await this._runWithGlobalDeadline(
        async () => {
          /**
           * -------------------------------------------------------------------
           * Phase 1 — Readiness
           * -------------------------------------------------------------------
           */

          if (
            this.options
              .markNotReadyFirst
          ) {
            await this._markNotReady();
          }

          /**
           * -------------------------------------------------------------------
           * Phase 2 — Network Drain
           * -------------------------------------------------------------------
           */

          if (
            this.options
              .closeServerFirst
          ) {
            await this._closeServer(
              metadata,
            );
          }

          /**
           * -------------------------------------------------------------------
           * Phase 3 — Application Lifecycle
           * -------------------------------------------------------------------
           */

          this._transition(
            SHUTDOWN_STATES.STOPPING,
          );

          await this._stopApplicationLifecycle(
            metadata,
          );

          /**
           * -------------------------------------------------------------------
           * Phase 4 — Explicit Participants
           * -------------------------------------------------------------------
           */

          await this._stopParticipants(
            metadata,
          );
        },
        'TITech global shutdown',
      );

      /**
       * -----------------------------------------------------------------------
       * Phase 5 — Flush telemetry/logging.
       * -----------------------------------------------------------------------
       */

      this._transition(
        SHUTDOWN_STATES.FLUSHING,
      );

      if (
        this.options
          .flushObservabilityLast
      ) {
        await this._flushObservability();
      }

      if (
        this.options
          .flushLoggerLast
      ) {
        await this._flushLogger();
      }

      this.completedAt =
        new Date();

      /**
       * Fatal process errors must always produce a non-zero exit code even if
       * resource cleanup itself succeeded.
       */
      if (
        this._fatalProcessError
      ) {
        process.exitCode =
          this.options
            .processErrorExitCode;
      }

      this._transition(
        SHUTDOWN_STATES.STOPPED,
        {
          reason: this.reason,
          durationMs:
            hrtimeMs(started),
          errorCount:
            this.errors.length,
        },
      );

      const durationMs =
        hrtimeMs(started);

      this._emitObservability(
        'shutdown.completed',
        {
          reason: this.reason,
          signal: this.signal,
          durationMs,
          participantCount:
            this.participants.size,
          errorCount:
            this.errors.length,
          fatalProcessError:
            this._fatalProcessError,
        },
      );

      this._log(
        'info',
        {
          reason: this.reason,
          signal: this.signal,
          durationMs,
          errorCount:
            this.errors.length,
        },
        'TITech application shutdown completed.',
      );

      deferred.resolve(true);
    } catch (error) {
      fatalError =
        error instanceof
        ShutdownError
          ? error
          : new ShutdownError(
              'TITech application shutdown failed.',
              {
                code:
                  'SHUTDOWN_FAILED',
                phase:
                  this.state,
                signal:
                  this.signal,
                cause:
                  error,
              },
            );

      this.failure =
        fatalError;

      this.completedAt =
        new Date();

      process.exitCode =
        process.exitCode ||
        this.options.processErrorExitCode;

      this._transition(
        SHUTDOWN_STATES.FAILED,
        {
          reason: this.reason,
          signal: this.signal,
          error:
            safeError(fatalError),
          durationMs:
            hrtimeMs(started),
        },
      );

      this._emitObservability(
        'shutdown.failed',
        {
          reason: this.reason,
          signal: this.signal,
          error:
            safeError(fatalError),
          durationMs:
            hrtimeMs(started),
          errorCount:
            this.errors.length,
        },
      );

      this._log(
        'error',
        {
          reason: this.reason,
          signal: this.signal,
          error: fatalError,
        },
        'TITech application shutdown failed.',
      );

      if (
        this.options.forceExitOnTimeout &&
        (
          fatalError.code ===
            'SHUTDOWN_TIMEOUT' ||
          fatalError.code ===
            'SHUTDOWN_GLOBAL_TIMEOUT'
        )
      ) {
        this.forceExit();
      }

      deferred.reject(
        fatalError,
      );
    }

    return deferred.promise;
  }

  /**
   * ===========================================================================
   * Readiness
   * ===========================================================================
   */

  async _markNotReady() {
    try {
      if (
        typeof readinessModule
          ?.markNotReady ===
        'function'
      ) {
        await readinessModule.markNotReady(
          'application-shutdown',
          {
            signal: this.signal,
            reason: this.reason,
          },
        );

        this._emitObservability(
          'shutdown.readiness_marked_not_ready',
        );

        return;
      }

      if (
        readinessModule
          ?.readinessState &&
        typeof readinessModule
          .readinessState
          .markNotReady ===
        'function'
      ) {
        await readinessModule
          .readinessState
          .markNotReady(
            'application-shutdown',
            {
              signal: this.signal,
              reason: this.reason,
            },
          );

        this._emitObservability(
          'shutdown.readiness_marked_not_ready',
        );
      }
    } catch (error) {
      this._recordNonFatalError(
        'readiness',
        error,
      );
    }
  }

  /**
   * ===========================================================================
   * Server
   * ===========================================================================
   */

  async _closeServer(metadata) {
    try {
      if (
        typeof serverModule
          ?.shutdown ===
        'function'
      ) {
        await withTimeout(
          () =>
            serverModule.shutdown(
              this.reason ||
                'application-shutdown',
              {
                ...metadata,
                signal:
                  this.signal,
              },
            ),
          this.options
            .participantTimeoutMs,
          'TITech HTTP server shutdown',
        );

        this._recordSuccess(
          'server',
          0,
        );

        return;
      }

      if (
        typeof serverModule?.stop ===
        'function'
      ) {
        await withTimeout(
          () =>
            serverModule.stop(
              this.reason ||
                'application-shutdown',
              {
                ...metadata,
                signal:
                  this.signal,
              },
            ),
          this.options
            .participantTimeoutMs,
          'TITech HTTP server stop',
        );

        this._recordSuccess(
          'server',
          0,
        );
      }
    } catch (error) {
      this._recordNonFatalError(
        'server',
        error,
      );

      if (
        !this.options
          .continueOnError
      ) {
        throw error;
      }
    }
  }

  /**
   * ===========================================================================
   * Application Lifecycle
   * ===========================================================================
   */

  async _stopApplicationLifecycle(
    metadata,
  ) {
    /**
     * lifecycleManager is preferred because it should own dependency-aware
     * lifecycle orchestration.
     */

    if (
      lifecycleModule
        ?.lifecycleManager &&
      typeof lifecycleModule
        .lifecycleManager
        .shutdown ===
      'function'
    ) {
      try {
        await withTimeout(
          () =>
            lifecycleModule
              .lifecycleManager
              .shutdown(
                {
                  ...metadata,
                  signal:
                    this.signal,
                  reason:
                    this.reason,
                },
                this.reason ||
                  'application-shutdown',
              ),
          this.options
            .participantTimeoutMs,
          'TITech lifecycle manager shutdown',
        );

        this._recordSuccess(
          'lifecycleManager',
          0,
        );

        return;
      } catch (error) {
        this._recordNonFatalError(
          'lifecycleManager',
          error,
        );

        if (
          !this.options
            .continueOnError
        ) {
          throw error;
        }
      }
    }

    /**
     * Fallback lifecycle implementation.
     */

    if (
      typeof applicationLifecycleModule
        ?.shutdown ===
      'function'
    ) {
      try {
        await withTimeout(
          () =>
            applicationLifecycleModule.shutdown(
              this.reason ||
                'application-shutdown',
              {
                ...metadata,
                signal:
                  this.signal,
              },
            ),
          this.options
            .participantTimeoutMs,
          'TITech application lifecycle shutdown',
        );

        this._recordSuccess(
          'lifecycle',
          0,
        );

        return;
      } catch (error) {
        this._recordNonFatalError(
          'lifecycle',
          error,
        );

        if (
          !this.options
            .continueOnError
        ) {
          throw error;
        }
      }
    }

    /**
     * Final compatibility fallback.
     */

    if (
      typeof hooksModule?.stop ===
      'function'
    ) {
      try {
        await withTimeout(
          () =>
            hooksModule.stop({
              ...metadata,
              signal:
                this.signal,
              reason:
                this.reason,
            }),
          this.options
            .participantTimeoutMs,
          'TITech bootstrap hooks shutdown',
        );

        this._recordSuccess(
          'hooks',
          0,
        );
      } catch (error) {
        this._recordNonFatalError(
          'hooks',
          error,
        );

        if (
          !this.options
            .continueOnError
        ) {
          throw error;
        }
      }
    }
  }

  /**
   * ===========================================================================
   * Explicit Participants
   * ===========================================================================
   */

  async _stopParticipants(metadata) {
    const participants =
      this._resolveParticipantOrder();

    for (
      const participant of participants
    ) {
      const started =
        process.hrtime.bigint();

      this._emitObservability(
        'shutdown.participant_started',
        {
          participant:
            participant.name,
          priority:
            participant.priority,
          critical:
            participant.critical,
        },
      );

      try {
        await withTimeout(
          () =>
            participant.stop({
              ...metadata,
              reason:
                this.reason,
              signal:
                this.signal,
              shutdown:
                this,
              participant:
                participant.name,
            }),
          participant.timeoutMs,
          `shutdown participant "${participant.name}"`,
        );

        const durationMs =
          hrtimeMs(started);

        this.executionHistory.push({
          name:
            participant.name,

          status:
            'stopped',

          critical:
            participant.critical,

          priority:
            participant.priority,

          durationMs,
        });

        this._emitObservability(
          'shutdown.participant_stopped',
          {
            participant:
              participant.name,
            critical:
              participant.critical,
            durationMs,
          },
        );
      } catch (error) {
        const durationMs =
          hrtimeMs(started);

        const record = {
          name:
            participant.name,

          status:
            'failed',

          critical:
            participant.critical,

          priority:
            participant.priority,

          durationMs,

          error:
            safeError(error),
        };

        this.executionHistory.push(
          record,
        );

        this.errors.push({
          participant:
            participant.name,

          critical:
            participant.critical,

          error:
            safeError(error),
        });

        this._emitObservability(
          'shutdown.participant_failed',
          {
            participant:
              participant.name,
            critical:
              participant.critical,
            durationMs,
            error:
              safeError(error),
          },
        );

        this._log(
          'error',
          {
            participant:
              participant.name,
            critical:
              participant.critical,
            durationMs,
            error,
          },
          `Shutdown participant "${participant.name}" failed.`,
        );

        /**
         * A critical participant failure is fatal when the policy is configured
         * to stop immediately on errors.
         *
         * With continueOnError=true we preserve best-effort shutdown semantics
         * and continue cleaning up remaining resources.
         */
        if (
          participant.critical &&
          !this.options
            .continueOnError
        ) {
          throw new ShutdownError(
            `Critical shutdown participant "${participant.name}" failed.`,
            {
              code:
                'SHUTDOWN_CRITICAL_PARTICIPANT_FAILED',

              participant:
                participant.name,

              cause:
                error,
            },
          );
        }
      }
    }
  }

  /**
   * ===========================================================================
   * Observability Flush
   * ===========================================================================
   */

  async _flushObservability() {
    try {
      if (
        typeof observabilityModule
          ?.shutdown ===
        'function'
      ) {
        await withTimeout(
          () =>
            observabilityModule.shutdown(),
          this.options
            .participantTimeoutMs,
          'TITech observability shutdown',
        );

        return;
      }

      if (
        observabilityModule
          ?.observability &&
        typeof observabilityModule
          .observability
          .shutdown ===
        'function'
      ) {
        await withTimeout(
          () =>
            observabilityModule
              .observability
              .shutdown(),
          this.options
            .participantTimeoutMs,
          'TITech observability shutdown',
        );
      }
    } catch (error) {
      this._recordNonFatalError(
        'observability',
        error,
      );
    }
  }

  /**
   * ===========================================================================
   * Logger Flush
   * ===========================================================================
   */

  async _flushLogger() {
    try {
      const logger =
        loggerModule?.getLogger?.();

      if (
        logger &&
        typeof logger.flush ===
          'function'
      ) {
        await withTimeout(
          () =>
            new Promise(resolve => {
              try {
                const result =
                  logger.flush(
                    () =>
                      resolve(),
                  );

                /**
                 * Support promise-returning logger implementations as well.
                 */
                if (
                  result &&
                  typeof result.then ===
                    'function'
                ) {
                  result.then(
                    resolve,
                    resolve,
                  );
                }
              } catch {
                resolve();
              }
            }),
          this.options
            .participantTimeoutMs,
          'TITech logger flush',
        );
      }
    } catch (error) {
      this._recordNonFatalError(
        'logger',
        error,
      );
    }
  }

  /**
   * ===========================================================================
   * Error Recording
   * ===========================================================================
   */

  _recordNonFatalError(
    participant,
    error,
  ) {
    this.errors.push({
      participant,
      critical: false,
      error:
        safeError(error),
    });

    this._emitObservability(
      'shutdown.non_fatal_error',
      {
        participant,
        error:
          safeError(error),
      },
    );

    this._log(
      'error',
      {
        participant,
        error,
      },
      `Non-fatal shutdown error in "${participant}".`,
    );
  }

  _recordSuccess(
    participant,
    durationMs,
  ) {
    this._emitObservability(
      'shutdown.phase_completed',
      {
        participant,
        durationMs,
      },
    );
  }

  /**
   * ===========================================================================
   * Force Exit
   * ===========================================================================
   */

  forceExit() {
    if (
      this.forceExitRequested
    ) {
      return false;
    }

    this.forceExitRequested =
      true;

    process.exitCode =
      process.exitCode || 1;

    this._emitObservability(
      'shutdown.force_exit_requested',
      {
        reason:
          this.reason,
        signal:
          this.signal,
      },
    );

    this._log(
      'error',
      {
        reason:
          this.reason,
        signal:
          this.signal,
      },
      'TITech forced process termination requested.',
    );

    if (
      this._forceExitTimer
    ) {
      return true;
    }

    this._forceExitTimer =
      setTimeout(
        () => {
          try {
            process.exit(1);
          } catch {
            // Last-resort termination.
          }
        },
        this.options
          .signalGraceMs,
      );

    this._forceExitTimer.unref?.();

    return true;
  }

  /**
   * ===========================================================================
   * State Management
   * ===========================================================================
   */

  _transition(
    state,
    metadata = {},
  ) {
    const previous =
      this.state;

    if (previous === state) {
      return false;
    }

    const allowed =
      STATE_TRANSITIONS[
        previous
      ];

    if (
      allowed &&
      !allowed.has(state)
    ) {
      const transitionError =
        new ShutdownError(
          `Invalid shutdown state transition: "${previous}" → "${state}".`,
          {
            code:
              'SHUTDOWN_INVALID_STATE_TRANSITION',

            phase:
              previous,

            details: {
              previousState:
                previous,
              nextState:
                state,
            },
          },
        );

      /**
       * Do not recursively transition to FAILED from an invalid FAILED
       * transition.
       */
      if (
        previous !==
        SHUTDOWN_STATES.FAILED
      ) {
        this.failure =
          transitionError;

        this.state =
          SHUTDOWN_STATES.FAILED;
      }

      this.emit(
        'stateChanged',
        {
          previousState:
            previous,

          state:
            this.state,

          timestamp:
            new Date().toISOString(),

          metadata: {
            ...metadata,

            transitionError:
              safeError(
                transitionError,
              ),
          },
        },
      );

      return false;
    }

    this.state =
      state;

    this.emit(
      'stateChanged',
      {
        previousState:
          previous,

        state,

        timestamp:
          new Date().toISOString(),

        metadata: {
          ...metadata,
        },
      },
    );

    this._emitObservability(
      'shutdown.state_changed',
      {
        previousState:
          previous,

        state,

        metadata,
      },
    );

    return true;
  }

  /**
   * ===========================================================================
   * Health / State Queries
   * ===========================================================================
   */

  isStopping() {
    return (
      this.state ===
        SHUTDOWN_STATES.DRAINING ||
      this.state ===
        SHUTDOWN_STATES.STOPPING ||
      this.state ===
        SHUTDOWN_STATES.FLUSHING
    );
  }

  isStopped() {
    return (
      this.state ===
      SHUTDOWN_STATES.STOPPED
    );
  }

  isFailed() {
    return (
      this.state ===
      SHUTDOWN_STATES.FAILED
    );
  }

  isRequested() {
    return this.shutdownRequested;
  }

  isTerminal() {
    return TERMINAL_STATES.has(
      this.state,
    );
  }

  /**
   * ===========================================================================
   * Snapshot
   * ===========================================================================
   */

  snapshot() {
    return Object.freeze({
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      application:
        APPLICATION_NAME,

      state:
        this.state,

      requested:
        this.shutdownRequested,

      stopping:
        this.isStopping(),

      stopped:
        this.isStopped(),

      failed:
        this.isFailed(),

      terminal:
        this.isTerminal(),

      forceExitRequested:
        this.forceExitRequested,

      fatalProcessError:
        this._fatalProcessError,

      reason:
        this.reason,

      signal:
        this.signal,

      requestedAt:
        this.requestedAt,

      startedAt:
        this.startedAt,

      completedAt:
        this.completedAt,

      failure:
        safeError(
          this.failure,
        ),

      errors:
        Object.freeze(
          this.errors.map(
            error => ({
              ...error,
              error:
                error.error
                  ? {
                      ...error.error,
                    }
                  : null,
            }),
          ),
        ),

      executionHistory:
        Object.freeze(
          this.executionHistory.map(
            item => ({
              ...item,
              error:
                item.error
                  ? {
                      ...item.error,
                    }
                  : undefined,
            }),
          ),
        ),

      participants:
        Object.freeze(
          this.list(),
        ),
    });
  }

  /**
   * ===========================================================================
   * Reset
   * ===========================================================================
   *
   * Reset is intended for controlled tests/reinitialization only.
   *
   * A production process should normally instantiate the singleton once and
   * terminate after shutdown.
   * ===========================================================================
   */

  reset() {
    if (
      this.shutdownPromise &&
      !this.isTerminal()
    ) {
      throw new ShutdownError(
        'Cannot reset an active TITech shutdown coordinator.',
        {
          code:
            'SHUTDOWN_RESET_NOT_ALLOWED',
        },
      );
    }

    if (
      this._forceExitTimer
    ) {
      clearTimeout(
        this._forceExitTimer,
      );

      this._forceExitTimer =
        null;
    }

    this.state =
      SHUTDOWN_STATES.CREATED;

    this.requestedAt =
      null;

    this.startedAt =
      null;

    this.completedAt =
      null;

    this.reason =
      null;

    this.signal =
      null;

    this.failure =
      null;

    this.shutdownPromise =
      null;

    this.shutdownRequested =
      false;

    this.forceExitRequested =
      false;

    this._fatalProcessError =
      false;

    this.errors =
      [];

    this.executionHistory =
      [];

    return this;
  }
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 */

const shutdownCoordinator =
  new ShutdownCoordinator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function register(options) {
  return shutdownCoordinator.register(
    options,
  );
}

function unregister(name) {
  return shutdownCoordinator.unregister(
    name,
  );
}

function has(name) {
  return shutdownCoordinator.has(
    name,
  );
}

function list() {
  return shutdownCoordinator.list();
}

async function shutdown(
  reason = 'application-request',
  metadata = {},
) {
  return shutdownCoordinator.request(
    reason,
    metadata,
  );
}

async function stop(
  reason = 'application-request',
  metadata = {},
) {
  return shutdown(
    reason,
    metadata,
  );
}

function forceExit() {
  return shutdownCoordinator.forceExit();
}

function snapshot() {
  return shutdownCoordinator.snapshot();
}

/**
 * =============================================================================
 * Bootstrap Lifecycle Registration
 * =============================================================================
 *
 * shutdown.js participates in the existing TITech lifecycle system but does not
 * attempt to become the owner of every infrastructure resource.
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  if (
    hooksModule?.hooks?.has(
      COMPONENT,
    )
  ) {
    return hooksModule.hooks.get(
      COMPONENT,
    );
  }

  if (
    typeof hooksModule?.lifecycle !==
    'function'
  ) {
    throw new ShutdownError(
      'TITech shutdown could not register because the lifecycle hook engine is unavailable.',
      {
        code:
          'SHUTDOWN_HOOK_ENGINE_UNAVAILABLE',
      },
    );
  }

  return hooksModule.lifecycle(
    COMPONENT,
    {
      priority:
        options.priority ??
        50_000,

      dependencies:
        options.dependencies ||
        [],

      critical:
        options.critical === true,

      enabled:
        options.enabled !==
        false,

      timeoutMs:
        options.timeoutMs ||
        DEFAULTS.timeoutMs,

      start: async () =>
        shutdownCoordinator,

      ready: async () =>
        !shutdownCoordinator
          .isFailed(),

      health: async () => ({
        status:
          shutdownCoordinator
            .isFailed()
            ? 'unhealthy'
            : shutdownCoordinator
                  .isStopping()
              ? 'stopping'
              : shutdownCoordinator
                    .isStopped()
                ? 'stopped'
                : 'healthy',

        state:
          shutdownCoordinator.state,

        requested:
          shutdownCoordinator
            .shutdownRequested,

        fatalProcessError:
          shutdownCoordinator
            ._fatalProcessError,
      }),

      stop: async hookContext =>
        shutdown(
          hookContext?.reason ||
            'bootstrap-shutdown',
          hookContext,
        ),

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        application:
          APPLICATION_NAME,
      },
    },
  );
}

/**
 * =============================================================================
 * Public Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core.
     */
    ShutdownCoordinator,

    ShutdownError,

    shutdownCoordinator,

    SHUTDOWN_STATES,

    SIGNALS,

    /**
     * Participant registration.
     */
    register,
    unregister,
    has,
    list,

    /**
     * Lifecycle.
     */
    shutdown,
    stop,

    /**
     * Bootstrap.
     */
    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Operational diagnostics.
     */
    snapshot,

    forceExit,
  });