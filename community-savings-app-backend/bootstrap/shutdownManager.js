"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/shutdownManager.js
 *
 * Purpose:
 *   Enterprise production-grade graceful shutdown and partial-startup cleanup
 *   coordinator.
 *
 * Responsibilities:
 *   - Coordinate deterministic application shutdown.
 *   - Support normal shutdown.
 *   - Support partial-startup failure cleanup.
 *   - Support SIGTERM/SIGINT/SIGQUIT.
 *   - Support uncaughtException/unhandledRejection escalation.
 *   - Stop HTTP servers gracefully.
 *   - Wait for active HTTP requests where possible.
 *   - Close registered dependencies in reverse registration order.
 *   - Enforce shutdown timeouts.
 *   - Prevent duplicate shutdown execution.
 *   - Delegate canonical lifecycle state to runtime/state.js.
 *
 * Critical Design Rule
 * -----------------------------------------------------------------------------
 *
 * Cleanup must be possible even when startup never reached:
 *
 *   server
 *   ready
 *
 * A startup failure may happen during:
 *
 *   environment
 *   configuration
 *   logger
 *   observability
 *   readiness
 *   resilience
 *   infrastructure
 *   services
 *   middleware
 *   routes
 *   server
 *
 * Therefore this manager explicitly supports:
 *
 *   startup failure → shutting_down → cleanup → stopped
 *
 * without requiring the server or READY phase.
 *
 * =============================================================================
 *
 * This module MUST NOT:
 *   - initialize infrastructure;
 *   - connect to MongoDB;
 *   - connect to Redis;
 *   - initialize queues;
 *   - register application routes;
 *   - own Express lifecycle state;
 *   - maintain a competing readiness state machine;
 *   - silently swallow fatal cleanup failures.
 *
 * =============================================================================
 */

const {
  BOOTSTRAP_PHASES,
  markApplicationShutdown,
  markApplicationShutdownAfterFailure,
  markApplicationStopped,
  markFailed,
  markServiceStopping,
  markServiceStopped,
  getApplicationState,
} = require("../runtime/state");

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const DEFAULTS = Object.freeze({
  shutdownTimeoutMs: 30000,

  requestDrainTimeoutMs: 15000,

  forceExitOnTimeout:
    process.env.NODE_ENV ===
    "production",

  exitOnSignal: true,

  exitOnFatalError: true,

  installSignalHandlers: true,

  installProcessErrorHandlers: true,

  signals: Object.freeze([
    "SIGTERM",
    "SIGINT",
    "SIGQUIT",
  ]),

  /**
   * Fatal process errors receive a non-zero exit status.
   */
  fatalExitCode: 1,

  /**
   * Normal signal shutdown receives zero.
   */
  normalExitCode: 0,
});

/* =============================================================================
 * INTERNAL MANAGER STATE
 * =============================================================================
 */

const managerState = {
  initialized: false,

  shuttingDown: false,

  shutdownPromise: null,

  shutdownReason: null,

  shutdownStartedAt: null,

  shutdownCompletedAt: null,

  shutdownSequence: 0,

  forced: false,

  timedOut: false,

  exitRequested: false,

  signalHandlersInstalled: false,

  processErrorHandlersInstalled: false,

  logger: null,

  events: null,

  options: {
    ...DEFAULTS,
  },

  /**
   * Cleanup functions are stored in registration order and executed in reverse
   * order.
   */
  cleanupHandlers: [],

  /**
   * Optional HTTP server reference.
   */
  httpServer: null,

  /**
   * Optional request counter providers.
   */
  requestCounter: null,

  /**
   * Optional WebSocket shutdown handler.
   */
  websocketShutdownHandler: null,
};

/* =============================================================================
 * UTILITY
 * =============================================================================
 */

function now() {
  return new Date();
}

function timestamp() {
  return now().toISOString();
}

function normalizeString(
  value,
  maxLength = 500,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeError(error) {
  if (!error) {
    return {
      name: "Error",
      code: null,
      message: "Unknown shutdown error",
    };
  }

  let message;

  if (
    typeof error.message ===
    "string"
  ) {
    message =
      error.message;
  } else if (
    typeof error ===
    "string"
  ) {
    message =
      error;
  } else {
    try {
      message =
        JSON.stringify(error);
    } catch {
      message =
        "Unserializable shutdown error";
    }
  }

  return {
    name:
      typeof error.name ===
      "string"
        ? error.name.slice(
            0,
            100,
          )
        : "Error",

    code:
      typeof error.code ===
      "string"
        ? error.code.slice(
            0,
            100,
          )
        : null,

    message:
      String(message).slice(
        0,
        1000,
      ),
  };
}

/* =============================================================================
 * LOGGING
 * =============================================================================
 */

function logInfo(
  logger,
  payload,
) {
  try {
    logger?.info?.(
      payload,
    );
  } catch {
    // Shutdown must continue even if logging fails.
  }
}

function logWarn(
  logger,
  payload,
) {
  try {
    logger?.warn?.(
      payload,
    );
  } catch {
    // Shutdown must continue even if logging fails.
  }
}

function logError(
  logger,
  payload,
) {
  try {
    logger?.error?.(
      payload,
    );
  } catch {
    // Shutdown must continue even if logging fails.
  }
}

/* =============================================================================
 * EVENT EMISSION
 * =============================================================================
 */

function emit(
  events,
  eventName,
  payload,
) {
  try {
    events?.emit?.(
      eventName,
      payload,
    );
  } catch {
    // Observability must never prevent shutdown.
  }
}

/* =============================================================================
 * INITIALIZATION
 * =============================================================================
 */

function initialize(
  options = {},
) {
  if (
    managerState.initialized
  ) {
    return getShutdownState();
  }

  managerState.initialized =
    true;

  managerState.options = {
    ...DEFAULTS,
    ...options,
  };

  managerState.logger =
    options.logger ||
    null;

  managerState.events =
    options.events ||
    null;

  if (
    options.httpServer
  ) {
    managerState.httpServer =
      options.httpServer;
  }

  if (
    typeof options.requestCounter ===
    "function"
  ) {
    managerState.requestCounter =
      options.requestCounter;
  }

  if (
    typeof options.websocketShutdownHandler ===
    "function"
  ) {
    managerState.websocketShutdownHandler =
      options.websocketShutdownHandler;
  }

  if (
    managerState.options
      .installSignalHandlers
  ) {
    installSignalHandlers();
  }

  if (
    managerState.options
      .installProcessErrorHandlers
  ) {
    installProcessErrorHandlers();
  }

  return getShutdownState();
}

/* =============================================================================
 * LOGGER / EVENTS CONFIGURATION
 * =============================================================================
 */

function configure({
  logger = null,
  events = null,
} = {}) {
  if (logger) {
    managerState.logger =
      logger;
  }

  if (events) {
    managerState.events =
      events;
  }

  return getShutdownState();
}

/* =============================================================================
 * HTTP SERVER REGISTRATION
 * =============================================================================
 */

function registerHttpServer(
  server,
) {
  if (
    !server ||
    typeof server.close !==
      "function"
  ) {
    throw new TypeError(
      "A valid HTTP server with a close() method is required.",
    );
  }

  managerState.httpServer =
    server;

  return server;
}

/* =============================================================================
 * REQUEST COUNTER REGISTRATION
 * =============================================================================
 */

function registerRequestCounter(
  provider,
) {
  if (
    provider !== null &&
    typeof provider !==
      "function"
  ) {
    throw new TypeError(
      "requestCounter must be a function or null.",
    );
  }

  managerState.requestCounter =
    provider;

  return true;
}

/* =============================================================================
 * WEBSOCKET REGISTRATION
 * =============================================================================
 */

function registerWebsocketShutdownHandler(
  handler,
) {
  if (
    handler !== null &&
    typeof handler !==
      "function"
  ) {
    throw new TypeError(
      "WebSocket shutdown handler must be a function or null.",
    );
  }

  managerState.websocketShutdownHandler =
    handler;

  return true;
}

/* =============================================================================
 * CLEANUP REGISTRATION
 * =============================================================================
 */

/**
 * Register a cleanup handler.
 *
 * Handlers execute in reverse registration order:
 *
 *   A
 *   B
 *   C
 *
 * becomes:
 *
 *   C
 *   B
 *   A
 *
 * This naturally supports dependency-aware teardown.
 */
function registerCleanup(
  name,
  handler,
  options = {},
) {
  if (
    typeof name ===
    "function"
  ) {
    options =
      handler || {};
    handler = name;
    name =
      `cleanup-${managerState.cleanupHandlers.length + 1}`;
  }

  const normalizedName =
    normalizeString(
      name,
      150,
    );

  if (!normalizedName) {
    throw new TypeError(
      "Cleanup handler name is required.",
    );
  }

  if (
    typeof handler !==
    "function"
  ) {
    throw new TypeError(
      `Cleanup handler "${normalizedName}" must be a function.`,
    );
  }

  /**
   * Prevent accidental duplicate registrations.
   */
  const existingIndex =
    managerState.cleanupHandlers.findIndex(
      (entry) =>
        entry.name ===
        normalizedName,
    );

  const entry = {
    name:
      normalizedName,

    handler,

    critical:
      options.critical !==
      false,

    timeoutMs:
      Number.isFinite(
        options.timeoutMs,
      ) &&
      options.timeoutMs >= 0
        ? options.timeoutMs
        : managerState.options
            .shutdownTimeoutMs,

    service:
      options.service ||
      null,

    registeredAt:
      timestamp(),

    metadata:
      options.metadata &&
      typeof options.metadata ===
        "object"
        ? {
            ...options.metadata,
          }
        : {},
  };

  if (
    existingIndex >= 0
  ) {
    managerState.cleanupHandlers[
      existingIndex
    ] = entry;
  } else {
    managerState.cleanupHandlers.push(
      entry,
    );
  }

  return {
    name:
      entry.name,

    critical:
      entry.critical,

    timeoutMs:
      entry.timeoutMs,

    service:
      entry.service,
  };
}

/* =============================================================================
 * CLEANUP REMOVAL
 * =============================================================================
 */

function unregisterCleanup(
  name,
) {
  const normalizedName =
    normalizeString(
      name,
      150,
    );

  const index =
    managerState.cleanupHandlers.findIndex(
      (entry) =>
        entry.name ===
        normalizedName,
    );

  if (
    index < 0
  ) {
    return false;
  }

  managerState.cleanupHandlers.splice(
    index,
    1,
  );

  return true;
}

function clearCleanupHandlers() {
  managerState.cleanupHandlers.length =
    0;
}

/* =============================================================================
 * PROMISE TIMEOUT
 * =============================================================================
 */

function withTimeout(
  promise,
  timeoutMs,
  label,
) {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return Promise.resolve(
      promise,
    );
  }

  return new Promise(
    (resolve, reject) => {
      let settled = false;

      const timer =
        setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;

          const error =
            new Error(
              `${label} timed out after ${timeoutMs}ms.`,
            );

          error.code =
            "SHUTDOWN_TIMEOUT";

          reject(error);
        }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(timer);

          resolve(value);
        })
        .catch((error) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(timer);

          reject(error);
        });
    },
  );
}

/* =============================================================================
 * HTTP REQUEST DRAINING
 * =============================================================================
 */

function getActiveRequestCount() {
  try {
    if (
      typeof managerState.requestCounter ===
      "function"
    ) {
      const value =
        managerState.requestCounter();

      if (
        Number.isFinite(value)
      ) {
        return Math.max(
          0,
          value,
        );
      }
    }
  } catch {
    // Fall back to runtime state.
  }

  return Math.max(
    0,
    getApplicationState()
      .activeRequests || 0,
  );
}

async function waitForRequestsToDrain(
  timeoutMs,
) {
  const initialCount =
    getActiveRequestCount();

  if (
    initialCount <= 0
  ) {
    return {
      drained: true,

      initialActiveRequests:
        0,

      remainingActiveRequests:
        0,

      waitedMs: 0,
    };
  }

  const startedAt =
    Date.now();

  return new Promise(
    (resolve) => {
      const intervalMs =
        50;

      let interval;

      const finish = (
        drained,
      ) => {
        if (interval) {
          clearInterval(
            interval,
          );
        }

        resolve({
          drained,

          initialActiveRequests:
            initialCount,

          remainingActiveRequests:
            getActiveRequestCount(),

          waitedMs:
            Math.max(
              0,
              Date.now() -
                startedAt,
            ),
        });
      };

      interval =
        setInterval(() => {
          const active =
            getActiveRequestCount();

          if (
            active <= 0
          ) {
            finish(true);
            return;
          }

          if (
            Date.now() -
              startedAt >=
            timeoutMs
          ) {
            finish(false);
          }
        }, intervalMs);

      /**
       * Avoid keeping the Node.js process alive solely because of the drain
       * monitor.
       */
      interval.unref?.();
    },
  );
}

/* =============================================================================
 * HTTP SERVER CLOSE
 * ============================================================================= */

async function closeHttpServer() {
  const server =
    managerState.httpServer;

  if (
    !server ||
    typeof server.close !==
      "function"
  ) {
    return {
      closed: true,

      skipped: true,
    };
  }

  /**
   * Node HTTP servers throw ERR_SERVER_NOT_RUNNING when close() is called
   * before listen(). Treat that as already closed.
   */
  if (
    server.listening !==
      true
  ) {
    return {
      closed: true,

      skipped: true,

      reason:
        "server_not_listening",
    };
  }

  await new Promise(
    (resolve, reject) => {
      let settled = false;

      const finish = (
        error,
      ) => {
        if (settled) {
          return;
        }

        settled = true;

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      try {
        server.close(
          (error) => {
            if (
              error &&
              error.code ===
                "ERR_SERVER_NOT_RUNNING"
            ) {
              finish();
              return;
            }

            finish(error);
          },
        );
      } catch (error) {
        if (
          error?.code ===
          "ERR_SERVER_NOT_RUNNING"
        ) {
          finish();
          return;
        }

        finish(error);
      }
    },
  );

  return {
    closed: true,

    skipped: false,
  };
}

/* =============================================================================
 * WEBSOCKET SHUTDOWN
 * ============================================================================= */

async function closeWebsocketInfrastructure() {
  const handler =
    managerState.websocketShutdownHandler;

  if (
    typeof handler !==
    "function"
  ) {
    return {
      closed: true,

      skipped: true,
    };
  }

  await withTimeout(
    Promise.resolve(
      handler(),
    ),
    managerState.options
      .shutdownTimeoutMs,
    "WebSocket shutdown",
  );

  return {
    closed: true,

    skipped: false,
  };
}

/* =============================================================================
 * ONE CLEANUP HANDLER
 * =============================================================================
 */

async function executeCleanupHandler(
  entry,
) {
  const startedAt =
    Date.now();

  if (
    entry.service
  ) {
    try {
      markServiceStopping(
        entry.service,
        managerState.events,
        managerState.logger,
      );
    } catch {
      // Service may already be stopped/failed.
    }
  }

  try {
    await withTimeout(
      Promise.resolve(
        entry.handler(),
      ),
      entry.timeoutMs,
      `Cleanup "${entry.name}"`,
    );

    const durationMs =
      Math.max(
        0,
        Date.now() -
          startedAt,
      );

    if (
      entry.service
    ) {
      try {
        markServiceStopped(
          entry.service,
          managerState.events,
          managerState.logger,
        );
      } catch {
        // Cleanup succeeded even if state bookkeeping could not transition.
      }
    }

    emit(
      managerState.events,
      "shutdown.cleanup.completed",
      {
        name:
          entry.name,

        service:
          entry.service,

        durationMs,

        timestamp:
          timestamp(),
      },
    );

    logInfo(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "cleanup_completed",

        name:
          entry.name,

        service:
          entry.service,

        durationMs,
      },
    );

    return {
      name:
        entry.name,

      success: true,

      critical:
        entry.critical,

      service:
        entry.service,

      durationMs,
    };
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    const durationMs =
      Math.max(
        0,
        Date.now() -
          startedAt,
      );

    emit(
      managerState.events,
      "shutdown.cleanup.failed",
      {
        name:
          entry.name,

        service:
          entry.service,

        critical:
          entry.critical,

        durationMs,

        error:
          normalizedError,

        timestamp:
          timestamp(),
      },
    );

    logError(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "cleanup_failed",

        name:
          entry.name,

        service:
          entry.service,

        critical:
          entry.critical,

        durationMs,

        error:
          normalizedError,
      },
    );

    if (
      entry.service
    ) {
      try {
        markServiceStopped(
          entry.service,
          managerState.events,
          managerState.logger,
        );
      } catch {
        // Preserve original cleanup failure.
      }
    }

    return {
      name:
        entry.name,

      success: false,

      critical:
        entry.critical,

      service:
        entry.service,

      durationMs,

      error:
        normalizedError,
    };
  }
}

/* =============================================================================
 * CLEANUP DEPENDENCIES
 * =============================================================================
 */

async function executeRegisteredCleanup() {
  const handlers =
    [
      ...managerState.cleanupHandlers,
    ].reverse();

  const results = [];

  for (
    const entry of handlers
  ) {
    const result =
      await executeCleanupHandler(
        entry,
      );

    results.push(
      result,
    );

    /**
     * A critical cleanup failure is recorded, but shutdown continues.
     *
     * This is essential for enterprise shutdown: failure to close one
     * dependency must not prevent the remaining resources from being released.
     */
  }

  return results;
}

/* =============================================================================
 * SHUTDOWN FINALIZATION
 * =============================================================================
 */

function finalizeStopped(
  reason,
) {
  try {
    markApplicationStopped(
      managerState.events,
      managerState.logger,
    );
  } catch (error) {
    logError(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "runtime_stop_transition_failed",

        reason,

        error:
          normalizeError(error),
      },
    );
  }

  managerState.shutdownCompletedAt =
    now();

  emit(
    managerState.events,
    "shutdown.completed",
    {
      reason,

      timestamp:
        managerState.shutdownCompletedAt.toISOString(),

      sequence:
        managerState.shutdownSequence,

      forced:
        managerState.forced,

      timedOut:
        managerState.timedOut,
    },
  );

  logInfo(
    managerState.logger,
    {
      section:
        "shutdown",

      event:
        "shutdown_completed",

      reason,

      sequence:
        managerState.shutdownSequence,

      forced:
        managerState.forced,

      timedOut:
        managerState.timedOut,
    },
  );
}

/* =============================================================================
 * CORE SHUTDOWN
 * ============================================================================= */

async function performShutdown(
  reason,
  options = {},
) {
  const mergedOptions = {
    ...managerState.options,
    ...options,
  };

  const shutdownStartedAt =
    now();

  managerState.shutdownStartedAt =
    shutdownStartedAt;

  managerState.shutdownReason =
    reason;

  managerState.shutdownSequence +=
    1;

  const sequence =
    managerState.shutdownSequence;

  const cleanupResults = [];

  let requestDrainResult =
    null;

  let httpResult =
    null;

  let websocketResult =
    null;

  const failures = [];

  try {
    /**
     * -------------------------------------------------------------------------
     * 1. Tell runtime/state.js that shutdown has begun.
     *
     * This works from:
     *
     *   ready
     *   server
     *   routes
     *   middleware
     *   services
     *   infrastructure
     *   resilience
     *   readiness
     *   observability
     *   logger
     *   configuration
     *   environment
     *   failed
     *
     * Therefore partial-startup cleanup is legal.
     * -------------------------------------------------------------------------
     */

    const runtime =
      getApplicationState();

    const failureCleanup =
      options.failureCleanup ===
        true ||
      runtime.failed ===
        true ||
      reason ===
        "startup_failure";

    if (
      failureCleanup
    ) {
      markApplicationShutdownAfterFailure(
        managerState.events,
        managerState.logger,
        {
          reason,
        },
      );
    } else {
      markApplicationShutdown(
        managerState.events,
        managerState.logger,
        {
          reason,
        },
      );
    }

    emit(
      managerState.events,
      "shutdown.started",
      {
        reason,

        sequence,

        timestamp:
          shutdownStartedAt.toISOString(),

        failureCleanup,
      },
    );

    logInfo(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "shutdown_started",

        reason,

        sequence,

        failureCleanup,
      },
    );

    /**
     * -------------------------------------------------------------------------
     * 2. Stop accepting new HTTP connections.
     *
     * Closing the listening server before dependency cleanup prevents new
     * requests from arriving while the application is being torn down.
     * -------------------------------------------------------------------------
     */

    try {
      httpResult =
        await withTimeout(
          closeHttpServer(),
          mergedOptions
            .shutdownTimeoutMs,
          "HTTP server shutdown",
        );
    } catch (error) {
      const normalizedError =
        normalizeError(error);

      failures.push({
        component:
          "http_server",

        critical: true,

        error:
          normalizedError,
      });

      logError(
        managerState.logger,
        {
          section:
            "shutdown",

          event:
            "http_server_shutdown_failed",

          error:
            normalizedError,
        },
      );
    }

    /**
     * -------------------------------------------------------------------------
     * 3. Allow existing requests to drain.
     * -------------------------------------------------------------------------
     */

    try {
      requestDrainResult =
        await waitForRequestsToDrain(
          mergedOptions
            .requestDrainTimeoutMs,
        );

      if (
        !requestDrainResult.drained
      ) {
        logWarn(
          managerState.logger,
          {
            section:
              "shutdown",

            event:
              "request_drain_timeout",

            ...requestDrainResult,
          },
        );
      }
    } catch (error) {
      const normalizedError =
        normalizeError(error);

      failures.push({
        component:
          "request_drain",

        critical: false,

        error:
          normalizedError,
      });
    }

    /**
     * -------------------------------------------------------------------------
     * 4. Close WebSocket infrastructure.
     * -------------------------------------------------------------------------
     */

    try {
      websocketResult =
        await closeWebsocketInfrastructure();
    } catch (error) {
      const normalizedError =
        normalizeError(error);

      failures.push({
        component:
          "websocket",

        critical: false,

        error:
          normalizedError,
      });

      logWarn(
        managerState.logger,
        {
          section:
            "shutdown",

          event:
            "websocket_shutdown_failed",

          error:
            normalizedError,
        },
      );
    }

    /**
     * -------------------------------------------------------------------------
     * 5. Execute dependency cleanup in reverse order.
     *
     * Example:
     *
     *   server
     *   routes
     *   services
     *   queues
     *   redis
     *   mongodb
     *
     * registered in startup order become:
     *
     *   mongodb
     *   redis
     *   queues
     *   services
     *   routes
     *   server
     *
     * depending on what the bootstrap registered.
     * -------------------------------------------------------------------------
     */

    const cleanupPromise =
      executeRegisteredCleanup();

    let cleanupTimedOut =
      false;

    try {
      const cleanupResults =
        await withTimeout(
          cleanupPromise,
          mergedOptions
            .shutdownTimeoutMs,
          "Dependency cleanup",
        );

      cleanupResults.forEach(
        (result) => {
          cleanupResults.push;
        },
      );

      cleanupResults.forEach(
        (result) => {
          cleanupResults;
        },
      );

      /**
       * Keep the result handling explicit rather than hiding failures.
       */
      cleanupResults.forEach(
        (result) => {
          if (
            !result.success
          ) {
            failures.push({
              component:
                result.name,

              critical:
                result.critical,

              error:
                result.error || {
                  message:
                    "Cleanup failed.",
                },
            });
          }
        },
      );

      /**
       * Copy results after inspection.
       */
      Array.prototype.push.apply(
        cleanupResults.length
          ? []
          : [],
        [],
      );

      /**
       * The actual result collection is assigned below.
       */
      cleanupResults.splice(
        0,
        cleanupResults.length,
      );

      const rerunResults =
        await executeRegisteredCleanup();

      Array.prototype.push.apply(
        cleanupResults,
        rerunResults,
      );
    } catch (error) {
      cleanupTimedOut =
        error?.code ===
        "SHUTDOWN_TIMEOUT";

      managerState.timedOut =
        managerState.timedOut ||
        cleanupTimedOut;

      failures.push({
        component:
          "dependencies",

        critical: true,

        error:
          normalizeError(error),
      });

      logError(
        managerState.logger,
        {
          section:
            "shutdown",

          event:
            "dependency_cleanup_failed",

          timedOut:
            cleanupTimedOut,

          error:
            normalizeError(error),
        },
      );
    }

    /**
     * -------------------------------------------------------------------------
     * 6. Mark runtime stopped.
     * -------------------------------------------------------------------------
     */

    finalizeStopped(
      reason,
    );

    return {
      success:
        failures.filter(
          (failure) =>
            failure.critical,
        ).length === 0,

      reason,

      sequence,

      startedAt:
        shutdownStartedAt.toISOString(),

      completedAt:
        timestamp(),

      forced:
        managerState.forced,

      timedOut:
        managerState.timedOut,

      requestDrain:
        requestDrainResult,

      http:
        httpResult,

      websocket:
        websocketResult,

      cleanup:
        cleanupResults,

      failures,
    };
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    failures.push({
      component:
        "shutdown_manager",

      critical: true,

      error:
        normalizedError,
    });

    managerState.forced =
      true;

    logError(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "shutdown_manager_failed",

        reason,

        error:
          normalizedError,
      },
    );

    /**
     * Even if orchestration itself encounters an unexpected error, make one
     * final attempt to establish the canonical stopped state.
     */
    finalizeStopped(
      reason,
    );

    return {
      success: false,

      reason,

      sequence,

      startedAt:
        shutdownStartedAt.toISOString(),

      completedAt:
        timestamp(),

      forced: true,

      timedOut:
        managerState.timedOut,

      requestDrain:
        requestDrainResult,

      http:
        httpResult,

      websocket:
        websocketResult,

      cleanup:
        cleanupResults,

      failures,
    };
  }
}

/* =============================================================================
 * PUBLIC SHUTDOWN ENTRY POINT
 * =============================================================================
 */

function shutdown(
  reason = "shutdown",
  options = {},
) {
  /**
   * Idempotency is critical.
   *
   * Multiple signals can arrive nearly simultaneously.
   *
   * SIGTERM + SIGINT
   * uncaughtException + SIGTERM
   * etc.
   *
   * All callers receive the same shutdown promise.
   */
  if (
    managerState.shutdownPromise
  ) {
    return managerState.shutdownPromise;
  }

  managerState.shuttingDown =
    true;

  managerState.shutdownReason =
    reason;

  managerState.shutdownPromise =
    performShutdown(
      reason,
      options,
    ).finally(() => {
      managerState.shuttingDown =
        true;
    });

  return managerState.shutdownPromise;
}

/* =============================================================================
 * STARTUP FAILURE SHUTDOWN
 * =============================================================================
 */

function shutdownAfterStartupFailure(
  error,
  options = {},
) {
  const normalizedError =
    normalizeError(error);

  /**
   * Establish authoritative failure state before cleanup.
   *
   * This is intentionally tolerant because startup may fail before any
   * bootstrap phase has been recorded.
   */
  try {
    const runtime =
      getApplicationState();

    if (
      !runtime.failed
    ) {
      markFailed(
        error,
        managerState.events,
        managerState.logger,
        {
          phase:
            options.phase ??
            runtime.bootstrapPhase,

          reason:
            options.reason ??
            "startup_failure",
        },
      );
    }
  } catch (stateError) {
    logError(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "startup_failure_state_transition_failed",

        error:
          normalizeError(
            stateError,
          ),

        originalError:
          normalizedError,
      },
    );
  }

  return shutdown(
    options.reason ||
      "startup_failure",
    {
      ...options,

      failureCleanup:
        true,

      exitCode:
        Number.isInteger(
          options.exitCode,
        )
          ? options.exitCode
          : managerState.options
              .fatalExitCode,
    },
  );
}

/* =============================================================================
 * FORCE SHUTDOWN
 * ============================================================================= */

function forceShutdown(
  reason = "forced_shutdown",
  options = {},
) {
  managerState.forced =
    true;

  managerState.timedOut =
    true;

  return shutdown(
    reason,
    {
      ...options,

      force:
        true,
    },
  );
}

/* =============================================================================
 * SIGNAL HANDLERS
 * ============================================================================= */

function createSignalHandler(
  signal,
) {
  return () => {
    if (
      managerState.shuttingDown
    ) {
      logWarn(
        managerState.logger,
        {
          section:
            "shutdown",

          event:
            "duplicate_shutdown_signal",

          signal,
        },
      );

      return;
    }

    logInfo(
      managerState.logger,
      {
        section:
          "shutdown",

        event:
          "shutdown_signal_received",

        signal,
      },
    );

    const shutdownPromise =
      shutdown(
        `signal:${signal}`,
      );

    if (
      managerState.options
        .exitOnSignal
    ) {
      shutdownPromise.then(
        () => {
          safeExit(
            managerState.options
              .normalExitCode,
          );
        },
        () => {
          safeExit(
            managerState.options
              .fatalExitCode,
          );
        },
      );
    }
  };
}

function installSignalHandlers() {
  if (
    managerState.signalHandlersInstalled
  ) {
    return false;
  }

  const signals =
    Array.isArray(
      managerState.options
        .signals,
    )
      ? managerState.options
          .signals
      : DEFAULTS.signals;

  signals.forEach(
    (signal) => {
      process.once(
        signal,
        createSignalHandler(
          signal,
        ),
      );
    },
  );

  managerState.signalHandlersInstalled =
    true;

  return true;
}

/* =============================================================================
 * PROCESS ERROR HANDLERS
 * ============================================================================= */

function installProcessErrorHandlers() {
  if (
    managerState.processErrorHandlersInstalled
  ) {
    return false;
  }

  process.on(
    "uncaughtException",
    (error) => {
      handleFatalProcessError(
        "uncaughtException",
        error,
      );
    },
  );

  process.on(
    "unhandledRejection",
    (reason) => {
      const error =
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason ===
              "string"
                ? reason
                : "Unhandled promise rejection.",
            );

      handleFatalProcessError(
        "unhandledRejection",
        error,
      );
    },
  );

  managerState.processErrorHandlersInstalled =
    true;

  return true;
}

function handleFatalProcessError(
  source,
  error,
) {
  const normalizedError =
    normalizeError(error);

  logError(
    managerState.logger,
    {
      section:
        "process",

      event:
        "fatal_process_error",

      source,

      error:
        normalizedError,
    },
  );

  emit(
    managerState.events,
    "process.fatal_error",
    {
      source,

      error:
        normalizedError,

      timestamp:
        timestamp(),
    },
  );

  const shutdownPromise =
    shutdownAfterStartupFailure(
      error,
      {
        reason:
          `fatal:${source}`,

        exitCode:
          managerState.options
            .fatalExitCode,
      },
    );

  if (
    managerState.options
      .exitOnFatalError
  ) {
    shutdownPromise.then(
      () => {
        safeExit(
          managerState.options
            .fatalExitCode,
        );
      },
      () => {
        safeExit(
          managerState.options
            .fatalExitCode,
        );
      },
    );
  }

  return shutdownPromise;
}

/* =============================================================================
 * PROCESS EXIT
 * ============================================================================= */

function safeExit(
  exitCode,
) {
  if (
    managerState.exitRequested
  ) {
    return;
  }

  managerState.exitRequested =
    true;

  const normalizedCode =
    Number.isInteger(
      exitCode,
    )
      ? exitCode
      : 0;

  /**
   * process.exit() is intentionally isolated here.
   *
   * No cleanup logic should occur after this call.
   */
  process.exit(
    normalizedCode,
  );
}

/* =============================================================================
 * SHUTDOWN TIMEOUT MONITOR
 * ============================================================================= */

function startShutdownTimeoutMonitor() {
  const timeoutMs =
    managerState.options
      .shutdownTimeoutMs;

  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }

  const timer =
    setTimeout(() => {
      if (
        !managerState.shuttingDown ||
        managerState.shutdownCompletedAt
      ) {
        return;
      }

      managerState.timedOut =
        true;

      managerState.forced =
        true;

      logError(
        managerState.logger,
        {
          section:
            "shutdown",

          event:
            "shutdown_timeout",

          timeoutMs,

          reason:
            managerState.shutdownReason,
        },
      );

      emit(
        managerState.events,
        "shutdown.timeout",
        {
          timeoutMs,

          reason:
            managerState.shutdownReason,

          timestamp:
            timestamp(),
        },
      );

      if (
        managerState.options
          .forceExitOnTimeout
      ) {
        safeExit(
          managerState.options
            .fatalExitCode,
        );
      }
    }, timeoutMs);

  timer.unref?.();

  return timer;
}

/* =============================================================================
 * SHUTDOWN WITH GLOBAL TIMEOUT
 * ============================================================================= */

function shutdownWithTimeout(
  reason = "shutdown",
  options = {},
) {
  const timeoutMs =
    Number.isFinite(
      options.timeoutMs,
    ) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : managerState.options
          .shutdownTimeoutMs;

  const timeoutPromise =
    new Promise(
      (resolve) => {
        const timer =
          setTimeout(() => {
            managerState.timedOut =
              true;

            managerState.forced =
              true;

            resolve({
              success: false,

              timedOut: true,

              reason,

              timestamp:
                timestamp(),
            });

            if (
              managerState.options
                .forceExitOnTimeout
            ) {
              safeExit(
                managerState.options
                  .fatalExitCode,
              );
            }
          }, timeoutMs);

        timer.unref?.();
      },
    );

  return Promise.race([
    shutdown(
      reason,
      options,
    ),
    timeoutPromise,
  ]);
}

/* =============================================================================
 * STATE INSPECTION
 * =============================================================================
 */

function getCleanupHandlers() {
  return managerState.cleanupHandlers.map(
    (entry) => ({
      name:
        entry.name,

      critical:
        entry.critical,

      timeoutMs:
        entry.timeoutMs,

      service:
        entry.service,

      registeredAt:
        entry.registeredAt,

      metadata: {
        ...entry.metadata,
      },
    }),
  );
}

function getShutdownState() {
  const startedAt =
    managerState.shutdownStartedAt;

  const completedAt =
    managerState.shutdownCompletedAt;

  return Object.freeze({
    initialized:
      managerState.initialized,

    shuttingDown:
      managerState.shuttingDown,

    shutdownStarted:
      Boolean(
        managerState.shutdownStartedAt,
      ),

    completed:
      Boolean(
        managerState.shutdownCompletedAt,
      ),

    shutdownReason:
      managerState.shutdownReason,

    shutdownSequence:
      managerState.shutdownSequence,

    forced:
      managerState.forced,

    timedOut:
      managerState.timedOut,

    exitRequested:
      managerState.exitRequested,

    signalHandlersInstalled:
      managerState
        .signalHandlersInstalled,

    processErrorHandlersInstalled:
      managerState
        .processErrorHandlersInstalled,

    shutdownDurationMs:
      startedAt &&
      completedAt
        ? Math.max(
            0,
            completedAt.getTime() -
              startedAt.getTime(),
          )
        : null,

    cleanupHandlerCount:
      managerState
        .cleanupHandlers.length,

    cleanupHandlers:
      getCleanupHandlers(),

    httpServerRegistered:
      Boolean(
        managerState.httpServer,
      ),

    runtime:
      getApplicationState(),
  });
}

/* =============================================================================
 * DISPOSE PROCESS HANDLERS
 * =============================================================================
 *
 * Useful for automated tests.
 *
 * Production code normally does not call this.
 * =============================================================================
 */

function removeProcessHandlers() {
  const signals =
    Array.isArray(
      managerState.options
        .signals,
    )
      ? managerState.options
          .signals
      : DEFAULTS.signals;

  signals.forEach(
    (signal) => {
      process.removeAllListeners(
        signal,
      );
    },
  );

  process.removeAllListeners(
    "uncaughtException",
  );

  process.removeAllListeners(
    "unhandledRejection",
  );

  managerState
    .signalHandlersInstalled =
    false;

  managerState
    .processErrorHandlersInstalled =
    false;

  return true;
}

/* =============================================================================
 * RESET
 * =============================================================================
 *
 * Intended for tests only.
 * =============================================================================
 */

function reset() {
  removeProcessHandlers();

  managerState.initialized =
    false;

  managerState.shuttingDown =
    false;

  managerState.shutdownPromise =
    null;

  managerState.shutdownReason =
    null;

  managerState.shutdownStartedAt =
    null;

  managerState.shutdownCompletedAt =
    null;

  managerState.shutdownSequence =
    0;

  managerState.forced =
    false;

  managerState.timedOut =
    false;

  managerState.exitRequested =
    false;

  managerState.logger =
    null;

  managerState.events =
    null;

  managerState.options = {
    ...DEFAULTS,
  };

  managerState.cleanupHandlers =
    [];

  managerState.httpServer =
    null;

  managerState.requestCounter =
    null;

  managerState.websocketShutdownHandler =
    null;

  return getShutdownState();
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports = {
  DEFAULTS,

  initialize,

  configure,

  registerHttpServer,

  registerRequestCounter,

  registerWebsocketShutdownHandler,

  registerCleanup,

  unregisterCleanup,

  clearCleanupHandlers,

  shutdown,

  shutdownAfterStartupFailure,

  forceShutdown,

  shutdownWithTimeout,

  installSignalHandlers,

  installProcessErrorHandlers,

  handleFatalProcessError,

  getActiveRequestCount,

  waitForRequestsToDrain,

  closeHttpServer,

  executeCleanupHandler,

  executeRegisteredCleanup,

  getCleanupHandlers,

  getShutdownState,

  removeProcessHandlers,

  reset,
};