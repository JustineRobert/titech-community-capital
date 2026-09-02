"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/readinessState.js
 *
 * Purpose:
 *   Enterprise production-grade readiness coordinator.
 *
 * Responsibilities:
 *   - Coordinate application readiness evaluation.
 *   - Maintain readiness blockers and checks.
 *   - Delegate canonical lifecycle state to backend/runtime/state.js.
 *   - Prevent readiness from being asserted during startup failure/shutdown.
 *   - Provide deterministic readiness snapshots.
 *   - Support dependency/service readiness checks.
 *   - Support asynchronous readiness evaluators.
 *   - Never perform infrastructure initialization itself.
 *
 * Architectural Principle
 * -----------------------------------------------------------------------------
 *
 * backend/runtime/state.js is the canonical process-local lifecycle authority.
 *
 * This module is a readiness COORDINATOR, not a second lifecycle state machine.
 *
 * It MUST NOT:
 *   - connect to MongoDB;
 *   - connect to Redis;
 *   - initialize queues;
 *   - create HTTP servers;
 *   - register Express middleware;
 *   - register routes;
 *   - own application dependencies;
 *   - mutate Express application state;
 *   - terminate the process.
 *
 * =============================================================================
 */

const {
  BOOTSTRAP_PHASES,
  SERVICES,
  SERVICE_STATES,
  setReadinessState,
  markApplicationReady,
  getApplicationState,
  getHealthState,
  isReady,
} = require("../runtime/state");

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const DEFAULTS = Object.freeze({
  evaluationTimeoutMs: 5000,

  /**
   * Readiness is intentionally conservative.
   *
   * An application must have completed the server bootstrap phase before this
   * coordinator will allow application readiness to become true.
   */
  requireServerPhase: true,

  /**
   * Runtime startup state must be established before readiness.
   */
  requireStarted: true,

  /**
   * Health must be true before readiness.
   */
  requireHealthy: true,

  /**
   * Failed applications are never ready.
   */
  rejectWhenFailed: true,

  /**
   * Shutdown applications are never ready.
   */
  rejectWhenShuttingDown: true,

  /**
   * Terminated applications are never ready.
   */
  rejectWhenTerminated: true,

  /**
   * Empty readiness checks are allowed only when explicitly requested.
   */
  requireChecks: false,
});

const INTERNAL_BLOCKERS = Object.freeze({
  NOT_STARTED:
    "application_not_started",

  STARTING:
    "application_starting",

  SERVER_NOT_READY:
    "server_not_ready",

  FAILED:
    "application_failed",

  SHUTTING_DOWN:
    "application_shutting_down",

  TERMINATED:
    "application_terminated",

  UNHEALTHY:
    "application_unhealthy",

  CHECK_FAILED:
    "readiness_check_failed",

  CHECK_TIMEOUT:
    "readiness_check_timeout",

  CHECKS_REQUIRED:
    "readiness_checks_required",
});

/* =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

const readinessRuntime = {
  initialized: false,

  evaluating: false,

  evaluationSequence: 0,

  lastEvaluationAt: null,

  lastResult: null,

  checks: new Map(),
};

/* =============================================================================
 * UTILITY
 * =============================================================================
 */

function now() {
  return new Date();
}

function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString();
}

function normalizeString(value, maxLength = 500) {
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

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .filter(Boolean)
        .map((value) =>
          normalizeString(value),
        )
        .filter(Boolean),
    ),
  ];
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
      message: "Unknown readiness error",
    };
  }

  let message;

  if (
    typeof error.message ===
    "string"
  ) {
    message = error.message;
  } else if (
    typeof error ===
    "string"
  ) {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message =
        "Unserializable readiness error";
    }
  }

  return {
    name:
      typeof error.name ===
      "string"
        ? error.name.slice(0, 100)
        : "Error",

    code:
      typeof error.code ===
      "string"
        ? error.code.slice(0, 100)
        : null,

    message:
      String(message).slice(0, 1000),
  };
}

/* =============================================================================
 * OPTIONAL LOGGER HELPERS
 * =============================================================================
 */

function logInfo(logger, payload) {
  try {
    logger?.info?.(payload);
  } catch {
    // Readiness bookkeeping must never fail because logging failed.
  }
}

function logWarn(logger, payload) {
  try {
    logger?.warn?.(payload);
  } catch {
    // Readiness bookkeeping must never fail because logging failed.
  }
}

function logError(logger, payload) {
  try {
    logger?.error?.(payload);
  } catch {
    // Readiness bookkeeping must never fail because logging failed.
  }
}

/* =============================================================================
 * OPTIONAL EVENT HELPERS
 * =============================================================================
 */

function emit(events, eventName, payload) {
  try {
    events?.emit?.(
      eventName,
      payload,
    );
  } catch {
    // Event subscribers are observational only.
  }
}

/* =============================================================================
 * INITIALIZATION
 * =============================================================================
 */

function initialize(options = {}) {
  if (
    readinessRuntime.initialized
  ) {
    return getReadinessState();
  }

  readinessRuntime.initialized =
    true;

  if (
    options.resetChecks === true
  ) {
    readinessRuntime.checks.clear();
  }

  return getReadinessState();
}

/* =============================================================================
 * CHECK REGISTRATION
 * =============================================================================
 */

/**
 * Register a named readiness check.
 *
 * A check may be:
 *
 *   () => boolean
 *   () => Promise<boolean>
 *   () => ({ ready, message, metadata })
 *   () => Promise<...>
 *
 * The check itself owns the knowledge of how to inspect its dependency.
 */
function registerCheck(
  name,
  evaluator,
  options = {},
) {
  const normalizedName =
    normalizeString(name, 150);

  if (!normalizedName) {
    throw new TypeError(
      "Readiness check name is required.",
    );
  }

  if (
    typeof evaluator !==
    "function"
  ) {
    throw new TypeError(
      `Readiness evaluator "${normalizedName}" must be a function.`,
    );
  }

  const timeoutMs =
    Number.isFinite(
      options.timeoutMs,
    ) &&
    options.timeoutMs >= 0
      ? options.timeoutMs
      : DEFAULTS.evaluationTimeoutMs;

  readinessRuntime.checks.set(
    normalizedName,
    {
      name: normalizedName,

      evaluator,

      critical:
        options.critical !==
        false,

      timeoutMs,

      description:
        normalizeString(
          options.description,
          500,
        ),

      metadata:
        options.metadata &&
        typeof options.metadata ===
          "object"
          ? {
              ...options.metadata,
            }
          : {},
    },
  );

  return getRegisteredCheck(
    normalizedName,
  );
}

/* =============================================================================
 * CHECK REMOVAL
 * =============================================================================
 */

function unregisterCheck(name) {
  const normalizedName =
    normalizeString(name, 150);

  if (!normalizedName) {
    return false;
  }

  return readinessRuntime.checks.delete(
    normalizedName,
  );
}

function clearChecks() {
  readinessRuntime.checks.clear();
}

/* =============================================================================
 * CHECK INSPECTION
 * =============================================================================
 */

function getRegisteredCheck(name) {
  const check =
    readinessRuntime.checks.get(
      normalizeString(name, 150),
    );

  if (!check) {
    return null;
  }

  return {
    name: check.name,

    critical:
      check.critical,

    timeoutMs:
      check.timeoutMs,

    description:
      check.description,

    metadata: {
      ...check.metadata,
    },
  };
}

function getRegisteredChecks() {
  return [
    ...readinessRuntime.checks.values(),
  ].map((check) => ({
    name: check.name,

    critical:
      check.critical,

    timeoutMs:
      check.timeoutMs,

    description:
      check.description,

    metadata: {
      ...check.metadata,
    },
  }));
}

/* =============================================================================
 * PROMISE TIMEOUT
 * =============================================================================
 */

function withTimeout(
  promise,
  timeoutMs,
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
              `Readiness check timed out after ${timeoutMs}ms.`,
            );

          error.code =
            "READINESS_CHECK_TIMEOUT";

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
 * CHECK RESULT NORMALIZATION
 * =============================================================================
 */

function normalizeCheckResult(
  name,
  rawResult,
  durationMs,
) {
  if (
    typeof rawResult ===
    "boolean"
  ) {
    return {
      name,

      ready: rawResult,

      critical: true,

      durationMs,

      message:
        rawResult
          ? null
          : "Readiness check failed.",

      error: null,

      metadata: {},
    };
  }

  if (
    rawResult &&
    typeof rawResult ===
      "object"
  ) {
    return {
      name,

      ready:
        rawResult.ready !==
        false,

      critical:
        rawResult.critical !==
        false,

      durationMs,

      message:
        normalizeString(
          rawResult.message,
          500,
        ),

      error:
        rawResult.error
          ? normalizeError(
              rawResult.error,
            )
          : null,

      metadata:
        rawResult.metadata &&
        typeof rawResult.metadata ===
          "object"
          ? {
              ...rawResult.metadata,
            }
          : {},
    };
  }

  /**
   * Undefined/null is treated conservatively as failure.
   */
  return {
    name,

    ready: false,

    critical: true,

    durationMs,

    message:
      "Readiness check returned no result.",

    error: null,

    metadata: {},
  };
}

/* =============================================================================
 * RUN ONE CHECK
 * =============================================================================
 */

async function evaluateCheck(
  check,
) {
  const startedAt =
    Date.now();

  try {
    const rawResult =
      await withTimeout(
        check.evaluator(),
        check.timeoutMs,
      );

    const durationMs =
      Math.max(
        0,
        Date.now() -
          startedAt,
      );

    const result =
      normalizeCheckResult(
        check.name,
        rawResult,
        durationMs,
      );

    /**
     * Registration-level criticality wins unless the evaluator explicitly
     * provides a more restrictive failure.
     */
    result.critical =
      check.critical &&
      result.critical;

    return result;
  } catch (error) {
    const durationMs =
      Math.max(
        0,
        Date.now() -
          startedAt,
      );

    const normalizedError =
      normalizeError(error);

    const timeout =
      normalizedError.code ===
        "READINESS_CHECK_TIMEOUT" ||
      normalizedError.code ===
        "ETIMEDOUT";

    return {
      name: check.name,

      ready: false,

      critical: check.critical,

      durationMs,

      message:
        timeout
          ? `Readiness check timed out after ${check.timeoutMs}ms.`
          : normalizedError.message,

      error:
        normalizedError,

      metadata: {
        timeout,
      },
    };
  }
}

/* =============================================================================
 * RUNTIME PRECONDITION EVALUATION
 * =============================================================================
 */

function evaluateRuntimePrerequisites(
  options = {},
) {
  const runtime =
    getApplicationState();

  const blockers = [];

  const checks = {};

  if (
    options.requireStarted !==
      false &&
    runtime.started !== true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.NOT_STARTED,
    );

    checks.application = {
      ready: false,

      started:
        runtime.started,

      state:
        runtime.bootstrapLifecycle,

      phase:
        runtime.bootstrapPhase,
    };
  } else {
    checks.application = {
      ready: true,

      started:
        runtime.started,

      state:
        runtime.bootstrapLifecycle,

      phase:
        runtime.bootstrapPhase,
    };
  }

  if (
    runtime.starting === true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.STARTING,
    );
  }

  if (
    options.requireServerPhase !==
      false &&
    !runtime.completedPhases.includes(
      BOOTSTRAP_PHASES.SERVER,
    )
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.SERVER_NOT_READY,
    );
  }

  if (
    options.requireHealthy !==
      false &&
    runtime.healthy !== true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.UNHEALTHY,
    );
  }

  if (
    options.rejectWhenFailed !==
      false &&
    runtime.failed === true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.FAILED,
    );
  }

  if (
    options.rejectWhenShuttingDown !==
      false &&
    runtime.shuttingDown ===
      true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.SHUTTING_DOWN,
    );
  }

  if (
    options.rejectWhenTerminated !==
      false &&
    runtime.terminated ===
      true
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.TERMINATED,
    );
  }

  return {
    blockers:
      uniqueStrings(blockers),

    checks,
  };
}

/* =============================================================================
 * SYNCHRONOUS READINESS EVALUATION
 * =============================================================================
 */

function evaluateSync(
  options = {},
) {
  const mergedOptions = {
    ...DEFAULTS,
    ...options,
  };

  const runtimeResult =
    evaluateRuntimePrerequisites(
      mergedOptions,
    );

  const registeredChecks =
    [
      ...readinessRuntime.checks.values(),
    ];

  const checks = {
    ...runtimeResult.checks,
  };

  const blockers = [
    ...runtimeResult.blockers,
  ];

  if (
    mergedOptions.requireChecks &&
    registeredChecks.length === 0
  ) {
    blockers.push(
      INTERNAL_BLOCKERS.CHECKS_REQUIRED,
    );
  }

  /**
   * Sync evaluation cannot safely execute asynchronous checks. Therefore this
   * method evaluates only runtime prerequisites.
   */
  if (
    registeredChecks.length > 0
  ) {
    for (
      const check of registeredChecks
    ) {
      checks[check.name] = {
        ready: false,

        critical:
          check.critical,

        message:
          "Asynchronous readiness checks require evaluate().",

        metadata: {},
      };

      if (
        check.critical
      ) {
        blockers.push(
          `${INTERNAL_BLOCKERS.CHECK_FAILED}:${check.name}`,
        );
      }
    }
  }

  const ready =
    blockers.length === 0;

  return {
    ready,

    blockers:
      uniqueStrings(blockers),

    checks,

    evaluatedAt:
      now().toISOString(),
  };
}

/* =============================================================================
 * ASYNCHRONOUS READINESS EVALUATION
 * =============================================================================
 */

async function evaluate(
  options = {},
) {
  const mergedOptions = {
    ...DEFAULTS,
    ...options,
  };

  if (
    readinessRuntime.evaluating
  ) {
    return {
      ...(
        readinessRuntime.lastResult ||
        {
          ready: false,
          blockers: [
            "readiness_evaluation_in_progress",
          ],
          checks: {},
        }
      ),

      evaluationInProgress:
        true,
    };
  }

  readinessRuntime.evaluating =
    true;

  const sequence =
    ++readinessRuntime.evaluationSequence;

  const evaluatedAt =
    now();

  try {
    const runtimeResult =
      evaluateRuntimePrerequisites(
        mergedOptions,
      );

    const blockers = [
      ...runtimeResult.blockers,
    ];

    const checks = {
      ...runtimeResult.checks,
    };

    const registeredChecks =
      [
        ...readinessRuntime.checks.values(),
      ];

    if (
      mergedOptions.requireChecks &&
      registeredChecks.length === 0
    ) {
      blockers.push(
        INTERNAL_BLOCKERS.CHECKS_REQUIRED,
      );
    }

    /**
     * Run checks concurrently.
     *
     * A slow dependency must not unnecessarily serialize all other checks.
     */
    const results =
      await Promise.all(
        registeredChecks.map(
          (check) =>
            evaluateCheck(check),
        ),
      );

    for (
      const result of results
    ) {
      checks[result.name] = {
        ready:
          result.ready,

        critical:
          result.critical,

        durationMs:
          result.durationMs,

        message:
          result.message,

        error:
          result.error,

        metadata:
          result.metadata,
      };

      if (
        !result.ready &&
        result.critical
      ) {
        const blockerCode =
          result.error?.code ===
          "READINESS_CHECK_TIMEOUT"
            ? INTERNAL_BLOCKERS.CHECK_TIMEOUT
            : INTERNAL_BLOCKERS.CHECK_FAILED;

        blockers.push(
          `${blockerCode}:${result.name}`,
        );
      }
    }

    const normalizedBlockers =
      uniqueStrings(blockers);

    const ready =
      normalizedBlockers.length ===
        0 &&
      runtimeResult.blockers.length ===
        0;

    const result = {
      ready,

      blockers:
        normalizedBlockers,

      checks,

      sequence,

      evaluatedAt:
        evaluatedAt.toISOString(),

      evaluationDurationMs:
        Math.max(
          0,
          Date.now() -
            evaluatedAt.getTime(),
        ),

      registeredCheckCount:
        registeredChecks.length,
    };

    readinessRuntime.lastEvaluationAt =
      evaluatedAt;

    readinessRuntime.lastResult =
      result;

    return result;
  } finally {
    readinessRuntime.evaluating =
      false;
  }
}

/* =============================================================================
 * APPLY READINESS
 * =============================================================================
 */

function applyResult(
  result,
  events,
  logger,
  options = {},
) {
  if (
    !result ||
    typeof result !==
      "object"
  ) {
    throw new TypeError(
      "A readiness evaluation result is required.",
    );
  }

  const ready =
    result.ready === true;

  setReadinessState(
    ready,
    result.blockers || [],
    result.checks || {},
    events,
    logger,
  );

  /**
   * Only the canonical runtime state may transition the application to READY.
   */
  if (
    ready &&
    options.markApplicationReady !==
      false
  ) {
    const runtime =
      getApplicationState();

    if (
      runtime.started &&
      runtime.healthy &&
      !runtime.failed &&
      !runtime.shuttingDown &&
      !runtime.terminated
    ) {
      try {
        return markApplicationReady(
          events,
          logger,
        );
      } catch (error) {
        /**
         * A race with shutdown/failure is expected to be safely rejected.
         */
        const normalizedError =
          normalizeError(error);

        logWarn(
          logger,
          {
            section:
              "readiness",

            event:
              "application_ready_transition_rejected",

            error:
              normalizedError,
          },
        );

        setReadinessState(
          false,
          [
            ...(result.blockers || []),
            "application_ready_transition_rejected",
          ],
          result.checks || {},
          events,
          logger,
        );

        return false;
      }
    }
  }

  return ready;
}

/* =============================================================================
 * EVALUATE + APPLY
 * =============================================================================
 */

async function evaluateAndApply(
  options = {},
  events,
  logger,
) {
  const result =
    await evaluate(
      options,
    );

  applyResult(
    result,
    events,
    logger,
    options,
  );

  return result;
}

/* =============================================================================
 * FORCE NOT READY
 * =============================================================================
 *
 * Used when a dependency becomes unavailable after startup.
 *
 * This function deliberately does NOT stop the application.
 *
 * A dependency outage may represent degraded availability rather than process
 * failure. The owning health/readiness subsystem decides whether termination
 * is appropriate.
 * =============================================================================
 */

function markNotReady(
  blockers = [],
  checks = {},
  events,
  logger,
) {
  const normalizedBlockers =
    uniqueStrings(
      Array.isArray(blockers)
        ? blockers
        : [blockers],
    );

  return setReadinessState(
    false,
    normalizedBlockers,
    checks,
    events,
    logger,
  );
}

/* =============================================================================
 * SERVICE READINESS HELPERS
 * =============================================================================
 */

function checkServiceReady(
  service,
) {
  if (
    !Object.values(
      SERVICES,
    ).includes(service)
  ) {
    return {
      ready: false,

      critical: true,

      message:
        `Unknown TITech service: ${service}.`,
    };
  }

  const runtime =
    getApplicationState();

  const state =
    runtime.serviceStates[
      service
    ];

  const ready =
    state ===
    SERVICE_STATES.READY;

  return {
    ready,

    critical: true,

    message:
      ready
        ? null
        : `Service "${service}" is not ready.`,

    metadata: {
      service,

      state,

      enabled:
        runtime.services[
          service
        ] === true,
    },
  };
}

function registerServiceCheck(
  service,
  options = {},
) {
  if (
    !Object.values(
      SERVICES,
    ).includes(service)
  ) {
    throw new Error(
      `Unknown TITech service: ${service}.`,
    );
  }

  return registerCheck(
    `service:${service}`,
    () =>
      checkServiceReady(
        service,
      ),
    {
      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs,

      description:
        options.description ??
        `Readiness of TITech ${service} service.`,

      metadata: {
        service,

        ...(options.metadata || {}),
      },
    },
  );
}

/* =============================================================================
 * DATABASE READINESS
 * =============================================================================
 */

function registerDatabaseCheck(
  evaluator,
  options = {},
) {
  if (
    typeof evaluator !==
    "function"
  ) {
    throw new TypeError(
      "A database readiness evaluator function is required.",
    );
  }

  return registerCheck(
    "database",
    evaluator,
    {
      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs ??
        DEFAULTS.evaluationTimeoutMs,

      description:
        options.description ??
        "TITech database readiness check.",

      metadata: {
        dependency:
          "mongodb",

        ...(options.metadata || {}),
      },
    },
  );
}

/* =============================================================================
 * REDIS READINESS
 * =============================================================================
 */

function registerRedisCheck(
  evaluator,
  options = {},
) {
  if (
    typeof evaluator !==
    "function"
  ) {
    throw new TypeError(
      "A Redis readiness evaluator function is required.",
    );
  }

  return registerCheck(
    "redis",
    evaluator,
    {
      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs ??
        DEFAULTS.evaluationTimeoutMs,

      description:
        options.description ??
        "TITech Redis readiness check.",

      metadata: {
        dependency:
          "redis",

        ...(options.metadata || {}),
      },
    },
  );
}

/* =============================================================================
 * READINESS SNAPSHOT
 * =============================================================================
 */

function getReadinessState() {
  const runtime =
    getApplicationState();

  return Object.freeze({
    initialized:
      readinessRuntime.initialized,

    evaluating:
      readinessRuntime.evaluating,

    evaluationSequence:
      readinessRuntime.evaluationSequence,

    ready:
      isReady(),

    blockers:
      [
        ...(runtime.readiness?.blockers ||
          []),
      ],

    checks: {
      ...(runtime.readiness?.checks ||
        {}),
    },

    lastEvaluation:
      toIso(
        runtime.readiness
          ?.lastEvaluation,
      ),

    lastEvaluationAt:
      toIso(
        readinessRuntime.lastEvaluationAt,
      ),

    lastResult:
      readinessRuntime.lastResult
        ? {
            ...readinessRuntime.lastResult,

            blockers: [
              ...readinessRuntime
                .lastResult
                .blockers,
            ],

            checks: {
              ...readinessRuntime
                .lastResult
                .checks,
            },
          }
        : null,

    registeredChecks:
      getRegisteredChecks(),
  });
}

/* =============================================================================
 * HEALTH SNAPSHOT
 * =============================================================================
 */

function getHealthSnapshot() {
  return {
    readiness:
      getReadinessState(),

    runtime:
      getHealthState(),
  };
}

/* =============================================================================
 * RESET
 * =============================================================================
 *
 * Intended for deterministic automated testing and controlled process
 * reinitialization.
 * =============================================================================
 */

function reset() {
  readinessRuntime.initialized =
    false;

  readinessRuntime.evaluating =
    false;

  readinessRuntime.evaluationSequence =
    0;

  readinessRuntime.lastEvaluationAt =
    null;

  readinessRuntime.lastResult =
    null;

  readinessRuntime.checks.clear();

  return getReadinessState();
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports = {
  DEFAULTS,

  INTERNAL_BLOCKERS,

  initialize,

  registerCheck,

  unregisterCheck,

  clearChecks,

  getRegisteredCheck,

  getRegisteredChecks,

  evaluateCheck,

  evaluateSync,

  evaluate,

  applyResult,

  evaluateAndApply,

  markNotReady,

  registerServiceCheck,

  registerDatabaseCheck,

  registerRedisCheck,

  getReadinessState,

  getHealthSnapshot,

  reset,
};