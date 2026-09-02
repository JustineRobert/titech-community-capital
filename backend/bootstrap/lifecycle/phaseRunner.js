"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/lifecycle/phaseRunner.js
 *
 * Purpose:
 *   Canonical production-grade bootstrap phase runner.
 *
 * Architectural Role:
 *   This module is the single execution boundary for TITech bootstrap phases.
 *
 *   Instead of allowing individual bootstrap functions to invent their own
 *   lifecycle, timing, logging, and failure-handling behavior, every phase
 *   should execute through runPhase().
 *
 * Canonical lifecycle:
 *
 *   phase declared
 *        ↓
 *   phase started
 *        ↓
 *   executor invoked
 *        ↓
 *   ┌───────────────────────┐
 *   │                       │
 *   ▼                       ▼
 * success                 failure
 *   │                       │
 *   ▼                       ▼
 * completePhase()         failPhase()
 *   │                       │
 *   ▼                       ▼
 * success logging         failure logging
 *   │                       │
 *   ▼                       ▼
 * result returned         fatal/critical policy
 *
 * Responsibilities:
 *
 *   ✓ Validate phase execution contract.
 *   ✓ Begin the phase through BootstrapContext.
 *   ✓ Execute synchronous or asynchronous phase functions.
 *   ✓ Measure phase duration.
 *   ✓ Record successful phase completion.
 *   ✓ Capture phase failures.
 *   ✓ Record failure duration.
 *   ✓ Apply critical/non-critical policy.
 *   ✓ Preserve fatal/non-fatal metadata.
 *   ✓ Emit structured lifecycle logs.
 *   ✓ Protect bootstrap execution from logger failures.
 *   ✓ Preserve the original bootstrap error.
 *
 * This module MUST NOT:
 *
 *   - initialize MongoDB;
 *   - initialize Redis;
 *   - initialize HTTP servers;
 *   - initialize application services;
 *   - configure middleware;
 *   - register routes;
 *   - call process.exit();
 *   - terminate the Node.js process;
 *   - create a BootstrapContext;
 *   - maintain duplicate bootstrap state;
 *   - swallow critical failures;
 *   - hide the original error.
 *
 * Fatal policy:
 *
 *   "fatal" is metadata describing the operational consequence of a critical
 *   phase failure. The phase runner deliberately does NOT terminate the
 *   process. The canonical bootstrap orchestrator remains responsible for
 *   deciding whether a fatal bootstrap failure should terminate startup.
 *
 * Critical policy:
 *
 *   critical = true
 *     → failure is propagated to the bootstrap orchestrator.
 *
 *   critical = false
 *     → failure is recorded and logged, then null is returned.
 *
 * Fatal policy:
 *
 *   fatal = true
 *     → failure metadata indicates that the application cannot safely
 *       continue if the orchestrator chooses to enforce the fatal policy.
 *
 *   fatal = false
 *     → failure metadata indicates that controlled degradation may be
 *       possible.
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module:
 *   CommonJS
 *
 * =============================================================================
 */

/* =============================================================================
 * Constants
 * =============================================================================
 */

const MODULE_NAME = "TITechBootstrapPhaseRunner";

const DEFAULT_PHASE_CRITICAL = true;
const DEFAULT_PHASE_FATAL = true;

/**
 * Maximum length accepted for a phase name.
 *
 * This prevents malformed phase names from becoming an operational logging
 * or diagnostics problem.
 */
const MAX_PHASE_NAME_LENGTH = 200;

/* =============================================================================
 * Validation Helpers
 * =============================================================================
 */

/**
 * Validate the bootstrap context contract required by the phase runner.
 *
 * @param {object} context
 * @throws {TypeError}
 */
function assertValidContext(context) {
  if (!context || typeof context !== "object") {
    throw new TypeError(
      "TITech bootstrap context is required.",
    );
  }

  if (typeof context.beginPhase !== "function") {
    throw new TypeError(
      "TITech bootstrap context must expose beginPhase().",
    );
  }

  if (typeof context.completePhase !== "function") {
    throw new TypeError(
      "TITech bootstrap context must expose completePhase().",
    );
  }

  if (typeof context.failPhase !== "function") {
    throw new TypeError(
      "TITech bootstrap context must expose failPhase().",
    );
  }
}

/**
 * Validate and normalize a phase name.
 *
 * @param {unknown} name
 * @returns {string}
 * @throws {TypeError}
 */
function normalizePhaseName(name) {
  if (typeof name !== "string") {
    throw new TypeError(
      "TITech bootstrap phase name must be a non-empty string.",
    );
  }

  const normalized = name.trim();

  if (!normalized) {
    throw new TypeError(
      "TITech bootstrap phase name must be a non-empty string.",
    );
  }

  if (normalized.length > MAX_PHASE_NAME_LENGTH) {
    throw new TypeError(
      `TITech bootstrap phase name must not exceed ${MAX_PHASE_NAME_LENGTH} characters.`,
    );
  }

  return normalized;
}

/**
 * Normalize a boolean lifecycle policy.
 *
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  if (typeof value === "undefined") {
    return fallback;
  }

  return Boolean(value);
}

/**
 * Capture a stable structured representation of an error.
 *
 * This deliberately avoids serializing arbitrary error properties because
 * errors may contain circular references or sensitive runtime objects.
 *
 * @param {unknown} error
 * @returns {object}
 */
function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
      code: error.code,
      stack: error.stack,
    };
  }

  if (error && typeof error === "object") {
    return {
      name:
        typeof error.name === "string"
          ? error.name
          : "UnknownError",

      message:
        typeof error.message === "string"
          ? error.message
          : String(error),
      
      code: error.code,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

/**
 * Convert an unknown thrown value into an Error instance.
 *
 * JavaScript permits:
 *
 *   throw "failure";
 *   throw { message: "failure" };
 *
 * The bootstrap lifecycle should always propagate a real Error object.
 *
 * @param {unknown} thrown
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
    const error = new Error(thrown.message);

    if (typeof thrown.name === "string") {
      error.name = thrown.name;
    }

    if (typeof thrown.code !== "undefined") {
      error.code = thrown.code;
    }

    if (typeof thrown.stack === "string") {
      error.stack = thrown.stack;
    }

    return error;
  }

  return new Error(
    typeof thrown === "string"
      ? thrown
      : "Unknown TITech bootstrap phase failure.",
  );
}

/* =============================================================================
 * Error Metadata
 * =============================================================================
 */

/**
 * Attach standardized TITech bootstrap metadata to the original error.
 *
 * This function is intentionally defensive. Some errors may be frozen or
 * otherwise non-extensible. Failure to attach metadata must never replace the
 * original bootstrap error.
 *
 * @param {Error} error
 * @param {object} metadata
 * @returns {Error}
 */
function attachBootstrapMetadata(error, metadata) {
  if (!(error instanceof Error)) {
    return error;
  }

  try {
    error.bootstrap = Object.assign(
      {},
      error.bootstrap && typeof error.bootstrap === "object"
        ? error.bootstrap
        : {},
      metadata,
    );
  } catch {
    /**
     * Metadata attachment is diagnostic convenience only.
     *
     * The original error remains authoritative.
     */
  }

  /**
   * Backward-compatible top-level metadata.
   *
   * Existing bootstrap consumers may already inspect these fields directly.
   */
  const fields = {
    bootstrapPhase: metadata.phase,
    bootstrapCritical: metadata.critical,
    bootstrapFatal: metadata.fatal,
  };

  for (const [key, value] of Object.entries(fields)) {
    try {
      error[key] = value;
    } catch {
      // Preserve original error if the error object is non-extensible.
    }
  }

  return error;
}

/* =============================================================================
 * Logging Helpers
 * =============================================================================
 */

/**
 * Execute a logger operation without allowing logging failures to interfere
 * with bootstrap execution.
 *
 * @param {object|null} logger
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
  if (!logger || typeof logger[level] !== "function") {
    return;
  }

  try {
    logger[level](
      metadata,
      message,
    );
  } catch {
    /**
     * Logging is operationally important but must never replace the actual
     * bootstrap lifecycle error.
     */
  }
}

/* =============================================================================
 * Phase Runner
 * =============================================================================
 */

/**
 * Execute one canonical TITech bootstrap phase.
 *
 * @param {object} context
 * @param {object} options
 * @param {string} options.name
 * @param {Function} options.execute
 * @param {boolean} [options.critical=true]
 * @param {boolean} [options.fatal=true]
 * @param {object|null} [options.logger=null]
 *
 * @returns {Promise<*>}
 *
 * @throws {Error}
 *   Critical phase failures are propagated to the bootstrap orchestrator.
 */
async function runPhase(
  context,
  {
    name,
    execute,
    critical = DEFAULT_PHASE_CRITICAL,
    fatal = DEFAULT_PHASE_FATAL,
    logger = null,
  } = {},
) {
  /* ---------------------------------------------------------------------------
   * Contract Validation
   * ------------------------------------------------------------------------- */

  assertValidContext(context);

  const phaseName = normalizePhaseName(name);

  if (typeof execute !== "function") {
    throw new TypeError(
      `TITech bootstrap phase "${phaseName}" requires an execute function.`,
    );
  }

  const phaseCritical = normalizeBoolean(
    critical,
    DEFAULT_PHASE_CRITICAL,
  );

  const phaseFatal = normalizeBoolean(
    fatal,
    DEFAULT_PHASE_FATAL,
  );

  /* ---------------------------------------------------------------------------
   * Phase Start
   * ------------------------------------------------------------------------- */

  const startedAt = Date.now();

  /**
   * beginPhase() remains the authoritative state transition.
   *
   * If beginPhase() fails, that is a bootstrap contract failure rather than
   * an executor failure. Do not attempt to invoke execute().
   */
  context.beginPhase(phaseName);

  safeLog(
    logger,
    "info",
    {
      module: MODULE_NAME,
      phase: phaseName,
      critical: phaseCritical,
      fatal: phaseFatal,
      event: "bootstrap.phase.started",
      startedAt,
    },
    `TITech bootstrap phase started: ${phaseName}`,
  );

  /* ---------------------------------------------------------------------------
   * Phase Execution
   * ------------------------------------------------------------------------- */

  try {
    /**
     * Await handles both:
     *
     *   - synchronous executors;
     *   - asynchronous executors.
     *
     * This also ensures Promise rejections enter the canonical failure path.
     */
    const result = await execute(context);

    const completedAt = Date.now();

    const durationMs = Math.max(
      0,
      completedAt - startedAt,
    );

    /* -------------------------------------------------------------------------
     * Successful Completion
     * ----------------------------------------------------------------------- */

    context.completePhase(
      phaseName,
      {
        critical: phaseCritical,
        fatal: phaseFatal,
        durationMs,
        startedAt,
        completedAt,
      },
    );

    safeLog(
      logger,
      "info",
      {
        module: MODULE_NAME,
        phase: phaseName,
        critical: phaseCritical,
        fatal: phaseFatal,
        durationMs,
        startedAt,
        completedAt,
        event: "bootstrap.phase.completed",
      },
      `TITech bootstrap phase completed: ${phaseName}`,
    );

    return result;
  } catch (thrownError) {
    /* -------------------------------------------------------------------------
     * Failure Normalization
     * ----------------------------------------------------------------------- */

    const error = normalizeError(thrownError);

    const failedAt = Date.now();

    const durationMs = Math.max(
      0,
      failedAt - startedAt,
    );

    /* -------------------------------------------------------------------------
     * Context Failure Recording
     * ----------------------------------------------------------------------- */

    try {
      context.failPhase(
        phaseName,
        error,
        {
          critical: phaseCritical,
          fatal: phaseFatal,
          durationMs,
          startedAt,
          failedAt,
        },
      );
    } catch (contextError) {
      /**
       * The original phase error has priority.
       *
       * If the context itself fails while attempting to record the phase
       * failure, log the context-recording failure but never replace the
       * original executor failure.
       */
      safeLog(
        logger,
        "error",
        {
          module: MODULE_NAME,
          phase: phaseName,
          event: "bootstrap.phase.failure_recording_failed",
          error: serializeError(contextError),
          originalError: serializeError(error),
        },
        `TITech bootstrap phase failure could not be fully recorded: ${phaseName}`,
      );
    }

    /* -------------------------------------------------------------------------
     * Standardized Error Metadata
     * ----------------------------------------------------------------------- */

    attachBootstrapMetadata(
      error,
      {
        module: MODULE_NAME,
        phase: phaseName,
        critical: phaseCritical,
        fatal: phaseFatal,
        durationMs,
        startedAt,
        failedAt,
      },
    );

    /* -------------------------------------------------------------------------
     * Failure Logging
     * ----------------------------------------------------------------------- */

    safeLog(
      logger,
      "error",
      {
        module: MODULE_NAME,
        phase: phaseName,
        critical: phaseCritical,
        fatal: phaseFatal,
        durationMs,
        startedAt,
        failedAt,
        event: "bootstrap.phase.failed",
        error: serializeError(error),
      },
      `TITech bootstrap phase failed: ${phaseName}`,
    );

    /* -------------------------------------------------------------------------
     * Failure Policy
     * ----------------------------------------------------------------------- */

    if (!phaseCritical) {
      /**
       * Non-critical phases are allowed to degrade the application in a
       * controlled manner.
       *
       * The failure has already been:
       *
       *   ✓ recorded in BootstrapContext;
       *   ✓ logged;
       *   ✓ annotated;
       *
       * Returning null gives the orchestrator an explicit degraded result.
       */
      return null;
    }

    /**
     * Critical phase failures must propagate.
     *
     * IMPORTANT:
     *
     * The phase runner intentionally does NOT call process.exit().
     *
     * Fatal/non-fatal is metadata consumed by the higher-level bootstrap
     * orchestrator.
     */
    throw error;
  }
}

/* =============================================================================
 * Public API
 * =============================================================================
 *
 * Export only the canonical phase runner.
 *
 * Internal helpers remain private to this module so consumers cannot become
 * coupled to implementation details.
 * =============================================================================
 */

module.exports = Object.freeze({
  runPhase,
});