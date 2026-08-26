"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/phaseRunner.js
 *
 * Purpose:
 *   Enterprise production-grade bootstrap phase execution engine.
 *
 * Architectural Role:
 *
 *   BootstrapContext
 *       ↓
 *   phaseRunner
 *       ↓
 *   BootstrapHookRegistry
 *       ↓
 *   bootstrap/app.js
 *
 * Responsibilities:
 *
 *   - Execute one deterministic bootstrap phase.
 *   - Preserve phase metadata.
 *   - Measure phase duration.
 *   - Normalize thrown values.
 *   - Distinguish critical and non-critical failures.
 *   - Preserve the original lifecycle error.
 *   - Safely report lifecycle events through the logger.
 *   - Never terminate the Node.js process.
 *   - Never own application-wide bootstrap state.
 *
 * IMPORTANT:
 *
 *   This module does NOT:
 *
 *     - create Express applications;
 *     - create HTTP servers;
 *     - connect directly to MongoDB;
 *     - connect directly to Redis;
 *     - initialize queues;
 *     - initialize Socket.IO;
 *     - contain financial business logic;
 *     - call process.exit();
 *     - install process signal handlers;
 *     - create BootstrapContext instances.
 *
 * =============================================================================
 */

const MODULE_NAME = "TITechBootstrapPhaseRunner";

/* =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_PHASE_TIMEOUT_MS = 30_000;

const DEFAULT_CRITICAL = true;

const DEFAULT_FATAL = true;

/* =============================================================================
 * Errors
 * =============================================================================
 */

/**
 * Base bootstrap phase error.
 */
class BootstrapPhaseError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = "BootstrapPhaseError";

    this.code =
      options.code ||
      "BOOTSTRAP_PHASE_ERROR";

    this.phase =
      options.phase ||
      null;

    this.critical =
      options.critical !== undefined
        ? Boolean(options.critical)
        : null;

    this.fatal =
      options.fatal !== undefined
        ? Boolean(options.fatal)
        : null;

    this.durationMs =
      Number.isFinite(options.durationMs)
        ? options.durationMs
        : null;

    this.cause =
      options.cause ||
      null;

    this.metadata =
      Object.freeze({
        ...(options.metadata || {}),
      });

    Error.captureStackTrace?.(
      this,
      BootstrapPhaseError,
    );
  }
}

/**
 * Bootstrap phase timeout error.
 */
class BootstrapPhaseTimeoutError
  extends BootstrapPhaseError {
  constructor(
    phase,
    timeoutMs,
    options = {},
  ) {
    super(
      `TITech bootstrap phase "${phase}" timed out after ${timeoutMs}ms.`,
      {
        code:
          "BOOTSTRAP_PHASE_TIMEOUT",

        phase,

        critical:
          options.critical !== undefined
            ? options.critical
            : DEFAULT_CRITICAL,

        fatal:
          options.fatal !== undefined
            ? options.fatal
            : DEFAULT_FATAL,

        metadata: {
          ...(options.metadata || {}),
          timeoutMs,
        },
      },
    );

    this.timeoutMs =
      timeoutMs;
  }
}

/* =============================================================================
 * Normalization Helpers
 * =============================================================================
 */

/**
 * Normalize an unknown thrown value into Error.
 *
 * @param {*} thrown
 * @returns {Error}
 */
function normalizeError(thrown) {
  if (thrown instanceof Error) {
    return thrown;
  }

  if (
    thrown &&
    typeof thrown === "object" &&
    typeof thrown.message === "string"
  ) {
    const error =
      new Error(thrown.message);

    if (
      typeof thrown.name === "string"
    ) {
      error.name =
        thrown.name;
    }

    if (
      typeof thrown.code !==
      "undefined"
    ) {
      error.code =
        thrown.code;
    }

    if (
      typeof thrown.stack === "string"
    ) {
      error.stack =
        thrown.stack;
    }

    return error;
  }

  if (
    typeof thrown === "string"
  ) {
    return new Error(thrown);
  }

  try {
    return new Error(
      JSON.stringify(thrown),
    );
  } catch {
    return new Error(
      "Unknown TITech bootstrap phase failure.",
    );
  }
}

/**
 * Normalize phase name.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizePhaseName(value) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new TypeError(
      "TITech bootstrap phase name must be a non-empty string.",
    );
  }

  return value.trim();
}

/**
 * Normalize timeout.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeTimeout(value) {
  const timeoutMs =
    value === undefined ||
    value === null
      ? DEFAULT_PHASE_TIMEOUT_MS
      : value;

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new TypeError(
      "TITech bootstrap phase timeout must be a positive integer.",
    );
  }

  return timeoutMs;
}

/* =============================================================================
 * Safe Logger
 * =============================================================================
 *
 * Logger failures MUST NEVER replace the actual bootstrap phase result.
 * =============================================================================
 */

/**
 * Safely invoke logger.
 *
 * Supports both common logger conventions:
 *
 *   logger.info(metadata, message)
 *
 * and:
 *
 *   logger.info(message, metadata)
 *
 * TITech's bootstrap logger currently uses:
 *
 *   logger.info(metadata, message)
 *
 * @param {*} logger
 * @param {string} level
 * @param {object} metadata
 * @param {string} message
 */
function safeLog(
  logger,
  level,
  metadata,
  message,
) {
  if (
    !logger ||
    typeof logger[level] !==
      "function"
  ) {
    return;
  }

  try {
    logger[level](
      metadata,
      message,
    );
  } catch {
    /*
     * Intentionally ignored.
     *
     * Logging is observability.
     * It must never become the authoritative bootstrap failure.
     */
  }
}

/* =============================================================================
 * Callback Safety
 * =============================================================================
 */

/**
 * Safely invoke optional lifecycle callback.
 *
 * Callback failures are intentionally isolated from the phase operation.
 *
 * @param {*} callback
 * @param {*} value
 */
async function safeCallback(
  callback,
  value,
) {
  if (
    typeof callback !==
    "function"
  ) {
    return;
  }

  try {
    await callback(value);
  } catch {
    /*
     * Observability callbacks must never replace the actual lifecycle result.
     */
  }
}

/* =============================================================================
 * Timeout Execution
 * =============================================================================
 */

/**
 * Execute a phase with timeout protection.
 *
 * IMPORTANT:
 *
 * Timeout does not forcibly terminate the underlying JavaScript operation.
 * It only stops TITech from waiting indefinitely for it.
 *
 * @param {Function} execute
 * @param {object} options
 * @returns {Promise<*>}
 */
async function executeWithTimeout(
  execute,
  {
    phase,
    timeoutMs,
    critical,
    fatal,
    metadata,
  },
) {
  let timer = null;

  const operation =
    Promise.resolve().then(
      execute,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new BootstrapPhaseTimeoutError(
                  phase,
                  timeoutMs,
                  {
                    critical,
                    fatal,
                    metadata,
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
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/* =============================================================================
 * Phase Validation
 * =============================================================================
 */

/**
 * Validate phase execution options.
 *
 * @param {object} options
 */
function validatePhaseOptions(
  options,
) {
  if (
    !options ||
    typeof options !== "object"
  ) {
    throw new TypeError(
      "TITech bootstrap phase options must be an object.",
    );
  }

  const phase =
    normalizePhaseName(
      options.name ||
        options.phase,
    );

  const execute =
    options.execute;

  if (
    typeof execute !==
    "function"
  ) {
    throw new TypeError(
      `TITech bootstrap phase "${phase}" must provide an execute function.`,
    );
  }

  return {
    phase,

    execute,

    critical:
      options.critical !== undefined
        ? Boolean(options.critical)
        : DEFAULT_CRITICAL,

    fatal:
      options.fatal !== undefined
        ? Boolean(options.fatal)
        : DEFAULT_FATAL,

    timeoutMs:
      normalizeTimeout(
        options.timeoutMs,
      ),

    logger:
      options.logger ||
      null,

    metadata:
      Object.freeze({
        ...(options.metadata || {}),
      }),

    context:
      options.context ||
      null,

    onStart:
      options.onStart,

    onComplete:
      options.onComplete,

    onFailure:
      options.onFailure,
  };
}

/* =============================================================================
 * Phase Execution
 * =============================================================================
 */

/**
 * Execute one bootstrap phase.
 *
 * Supported contract:
 *
 *   const result = await runPhase(
 *     context,
 *     {
 *       name: "configuration",
 *       critical: true,
 *       fatal: true,
 *       logger,
 *       execute: async () => {},
 *     },
 *   );
 *
 * @param {object} context
 * @param {object} options
 *
 * @returns {Promise<object>}
 */
async function runPhase(
  context = {},
  options = {},
) {
  const normalized =
    validatePhaseOptions(
      options,
    );

  const {
    phase,
    execute,
    critical,
    fatal,
    timeoutMs,
    logger,
    metadata,
    onStart,
    onComplete,
    onFailure,
  } = normalized;

  const startedAt =
    Date.now();

  const startedTimestamp =
    new Date();

  const phaseMetadata =
    Object.freeze({
      module:
        MODULE_NAME,

      phase,

      critical,

      fatal,

      timeoutMs,

      startedAt:
        startedTimestamp,

      ...metadata,
    });

  safeLog(
    logger,
    "debug",
    {
      ...phaseMetadata,

      event:
        "bootstrap.phase.started",
    },
    `TITech bootstrap phase started: ${phase}`,
  );

  await safeCallback(
    onStart,
    phaseMetadata,
  );

  try {
    const result =
      await executeWithTimeout(
        async () =>
          execute(
            context,
          ),
        {
          phase,
          timeoutMs,
          critical,
          fatal,
          metadata,
        },
      );

    const finishedAt =
      Date.now();

    const finishedTimestamp =
      new Date();

    const durationMs =
      Math.max(
        0,
        finishedAt -
          startedAt,
      );

    const record =
      Object.freeze({
        module:
          MODULE_NAME,

        phase,

        success:
          true,

        failed:
          false,

        critical,

        fatal,

        result,

        durationMs,

        startedAt:
          startedTimestamp,

        finishedAt:
          finishedTimestamp,

        metadata:
          Object.freeze({
            ...metadata,
          }),
      });

    safeLog(
      logger,
      "debug",
      {
        module:
          MODULE_NAME,

        phase,

        critical,

        fatal,

        durationMs,

        event:
          "bootstrap.phase.completed",
      },
      `TITech bootstrap phase completed: ${phase}`,
    );

    await safeCallback(
      onComplete,
      record,
    );

    return record;
  } catch (thrown) {
    const originalError =
      normalizeError(
        thrown,
      );

    const finishedAt =
      Date.now();

    const finishedTimestamp =
      new Date();

    const durationMs =
      Math.max(
        0,
        finishedAt -
          startedAt,
      );

    /*
     * Preserve the original error.
     *
     * This is especially important for:
     *
     *   - database connection errors;
     *   - configuration validation errors;
     *   - provider errors;
     *   - logger failures;
     *   - timeout errors.
     *
     * We add metadata to the original error where possible instead of
     * replacing it with an unrelated logger/callback error.
     */
    if (
      originalError.phase ===
      undefined
    ) {
      originalError.phase =
        phase;
    }

    if (
      originalError.critical ===
      undefined
    ) {
      originalError.critical =
        critical;
    }

    if (
      originalError.fatal ===
      undefined
    ) {
      originalError.fatal =
        fatal;
    }

    if (
      originalError.durationMs ===
      undefined
    ) {
      originalError.durationMs =
        durationMs;
    }

    const record =
      Object.freeze({
        module:
          MODULE_NAME,

        phase,

        success:
          false,

        failed:
          true,

        critical,

        fatal,

        error:
          originalError,

        durationMs,

        startedAt:
          startedTimestamp,

        finishedAt:
          finishedTimestamp,

        metadata:
          Object.freeze({
            ...metadata,
          }),
      });

    safeLog(
      logger,
      "error",
      {
        module:
          MODULE_NAME,

        phase,

        critical,

        fatal,

        durationMs,

        event:
          "bootstrap.phase.failed",

        error: {
          name:
            originalError.name,

          message:
            originalError.message,

          code:
            originalError.code,
        },
      },
      `TITech bootstrap phase failed: ${phase}`,
    );

    await safeCallback(
      onFailure,
      record,
    );

    /*
     * Non-critical phases are represented as failed records rather than
     * crashing the bootstrap caller.
     *
     * Critical phases remain authoritative failures and are thrown.
     */
    if (!critical) {
      return record;
    }

    /*
     * Critical phase:
     *
     * Preserve the exact original error so callers can inspect the real
     * failure cause.
     */
    throw originalError;
  }
}

/* =============================================================================
 * Convenience Helpers
 * =============================================================================
 */

/**
 * Determine whether a phase result is successful.
 *
 * @param {*} result
 * @returns {boolean}
 */
function isPhaseSuccessful(
  result,
) {
  return Boolean(
    result &&
      result.success === true &&
      result.failed !== true,
  );
}

/**
 * Determine whether a phase result is failed.
 *
 * @param {*} result
 * @returns {boolean}
 */
function isPhaseFailed(
  result,
) {
  return Boolean(
    result &&
      result.failed === true,
  );
}

/**
 * Create a normalized diagnostic representation.
 *
 * @param {*} result
 * @returns {object|null}
 */
function snapshotPhase(
  result,
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return null;
  }

  return Object.freeze({
    module:
      result.module ||
      MODULE_NAME,

    phase:
      result.phase ||
      null,

    success:
      result.success === true,

    failed:
      result.failed === true,

    critical:
      result.critical,

    fatal:
      result.fatal,

    durationMs:
      Number.isFinite(
        result.durationMs,
      )
        ? result.durationMs
        : null,

    startedAt:
      result.startedAt ||
      null,

    finishedAt:
      result.finishedAt ||
      null,

    metadata:
      Object.freeze({
        ...(result.metadata || {}),
      }),
  });
}

/* =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
  Object.freeze({
    MODULE_NAME,

    DEFAULT_PHASE_TIMEOUT_MS,

    DEFAULT_CRITICAL,

    DEFAULT_FATAL,

    BootstrapPhaseError,

    BootstrapPhaseTimeoutError,

    runPhase,

    executeWithTimeout,

    normalizeError,

    isPhaseSuccessful,

    isPhaseFailed,

    snapshotPhase,
  });