"use strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**

* =============================================================================
* TITech Community Capital LTD
* TITech Community Capital Operating System
* =============================================================================
*
* File:
* backend/bootstrap/phaseRunner.js
*
* Purpose:
* Enterprise production-grade bootstrap phase execution engine.
*
* Architectural Role:
*
* BootstrapContext
* ```
    ↓
  ```
* phaseRunner
* ```
    ↓
  ```
* BootstrapHookRegistry
* ```
    ↓
  ```
* bootstrap/app.js
*
* Responsibilities:
*
* ✓ Execute one deterministic bootstrap phase.
* ✓ Validate phase execution contracts.
* ✓ Preserve phase metadata.
* ✓ Measure wall-clock and monotonic duration.
* ✓ Support cooperative AbortSignal cancellation.
* ✓ Enforce per-phase timeout protection.
* ✓ Normalize unknown thrown values.
* ✓ Preserve original lifecycle errors.
* ✓ Distinguish critical and non-critical failures.
* ✓ Preserve critical/fatal semantics.
* ✓ Safely report lifecycle events through the logger.
* ✓ Safely execute lifecycle callbacks.
* ✓ Prevent observability failures from replacing lifecycle failures.
* ✓ Produce immutable diagnostic records.
* ✓ Sanitize common credential-bearing diagnostic values.
* ✓ Never terminate the Node.js process.
* ✓ Never own application-wide bootstrap state.
*
* IMPORTANT:
*
* This module does NOT:
*
* ```
  - create Express applications;
  ```
* ```
  - create HTTP servers;
  ```
* ```
  - connect directly to MongoDB;
  ```
* ```
  - connect directly to Redis;
  ```
* ```
  - initialize queues;
  ```
* ```
  - initialize Socket.IO;
  ```
* ```
  - contain financial business logic;
  ```
* ```
  - call process.exit();
  ```
* ```
  - install process signal handlers;
  ```
* ```
  - create BootstrapContext instances;
  ```
* ```
  - maintain global application lifecycle state.
  ```
*
* BootstrapContext remains the canonical application lifecycle authority.
*
* =============================================================================
  */

const MODULE_NAME =
  "TITechBootstrapPhaseRunner";

/* =============================================================================

* Constants
* =============================================================================
  */

const DEFAULT_PHASE_TIMEOUT_MS =
  30_000;

const DEFAULT_CRITICAL =
  true;

const DEFAULT_FATAL =
  true;

const MAX_PHASE_NAME_LENGTH =
  200;

const MAX_METADATA_KEYS =
  100;

/* =============================================================================

* Errors
* =============================================================================
  */

/**

* Base bootstrap phase error.
  */
class BootstrapPhaseError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      typeof message ===
        "string" &&
        message.trim()
        ? message
        : "TITech bootstrap phase error.",
    );

    this.name =
      "BootstrapPhaseError";

    this.code =
      options.code ||
      "BOOTSTRAP_PHASE_ERROR";

    this.phase =
      options.phase ||
      null;

    this.critical =
      options.critical !==
        undefined
        ? Boolean(
          options.critical,
        )
        : null;

    this.fatal =
      options.fatal !==
        undefined
        ? Boolean(
          options.fatal,
        )
        : null;

    this.durationMs =
      Number.isFinite(
        options.durationMs,
      )
        ? options.durationMs
        : null;

    this.retryable =
      options.retryable !==
        undefined
        ? Boolean(
          options.retryable,
        )
        : null;

    this.cause =
      options.cause ||
      null;

    this.metadata =
      Object.freeze({
        ...(options.metadata ||
          {}),
      });

    Error.captureStackTrace?.(
      this,
      BootstrapPhaseError,
    );
  }
}

/**

* Bootstrap phase timeout error.
*
* Timeout is cooperative:
*
* 1. the phase receives an AbortSignal;
* 2. the signal is aborted when the timeout expires;
* 3. the phase runner stops waiting;
* 4. the underlying JavaScript operation may continue if it ignores abort.
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
          options.critical !==
            undefined
            ? options.critical
            : DEFAULT_CRITICAL,

        fatal:
          options.fatal !==
            undefined
            ? options.fatal
            : DEFAULT_FATAL,

        retryable:
          true,

        metadata: {
          ...(options.metadata ||
            {}),
          timeoutMs,
        },
      },
    );


    this.timeoutMs =



      timeoutMs;


  }
}

/**

* Bootstrap phase cancellation error.
  */
class BootstrapPhaseAbortError
  extends BootstrapPhaseError {
  constructor(
    phase,
    reason = null,
    options = {},
  ) {
    const normalizedReason =
      normalizeError(
        reason,
      );

    super(
      `TITech bootstrap phase "${phase}" was aborted.`,
      {
        code:
          "BOOTSTRAP_PHASE_ABORTED",


        phase,

        critical:
          options.critical !==
            undefined
            ? options.critical
            : DEFAULT_CRITICAL,

        fatal:
          options.fatal !==
            undefined
            ? options.fatal
            : DEFAULT_FATAL,

        retryable:
          options.retryable ??
          true,

        cause:
          normalizedReason,

        metadata: {
          ...(options.metadata ||
            {}),
        },


      },
    );

    this.reason =
      normalizedReason;
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
function normalizeError(
  thrown,
) {
  if (
    thrown instanceof
    Error
  ) {
    return thrown;
  }

  if (
    thrown &&
    typeof thrown ===
    "object" &&
    typeof thrown.message ===
    "string"
  ) {
    const error =
      new Error(
        thrown.message,
      );


    if (
      typeof thrown.name ===
      "string"
    ) {
      error.name =
        thrown.name;
    }

    if (
      thrown.code !==
      undefined
    ) {
      error.code =
        thrown.code;
    }

    if (
      typeof thrown.stack ===
      "string"
    ) {
      error.stack =
        thrown.stack;
    }

    if (
      thrown.cause !==
      undefined
    ) {
      error.cause =
        thrown.cause;
    }

    if (
      thrown.retryable !==
      undefined
    ) {
      error.retryable =
        Boolean(
          thrown.retryable,
        );
    }

    if (
      thrown.details &&
      typeof thrown.details ===
      "object"
    ) {
      error.details =
        thrown.details;
    }

    if (
      thrown.metadata &&
      typeof thrown.metadata ===
      "object"
    ) {
      error.metadata =
        thrown.metadata;
    }

    return error;


  }

  if (
    typeof thrown ===
    "string"
  ) {
    return new Error(
      thrown,
    );
  }

  if (
    thrown ===
    undefined ||
    thrown ===
    null
  ) {
    return new Error(
      "Unknown TITech bootstrap phase failure.",
    );
  }

  try {
    const serialized =
      JSON.stringify(
        thrown,
      );


    return new Error(
      serialized ||
      "Unknown TITech bootstrap phase failure.",
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
function normalizePhaseName(
  value,
) {
  if (
    typeof value !==
    "string" ||
    !value.trim()
  ) {
    throw new TypeError(
      "TITech bootstrap phase name must be a non-empty string.",
    );
  }

  const normalized =
    value.trim();

  if (
    normalized.length >
    MAX_PHASE_NAME_LENGTH
  ) {
    throw new TypeError(
      `TITech bootstrap phase name must not exceed ${MAX_PHASE_NAME_LENGTH} characters.`,
    );
  }

  return normalized;
}

/**

* Normalize timeout.
*
* @param {*} value
* @returns {number}
  */
function normalizeTimeout(
  value,
) {
  const timeoutMs =
    value ===
      undefined ||
      value === null
      ? DEFAULT_PHASE_TIMEOUT_MS
      : value;

  if (
    !Number.isInteger(
      timeoutMs,
    ) ||
    timeoutMs <= 0
  ) {
    throw new TypeError(
      "TITech bootstrap phase timeout must be a positive integer.",
    );
  }

  return timeoutMs;
}

/**

* Normalize metadata.
*
* Metadata is intentionally shallow-cloned and frozen.
*
* @param {*} metadata
* @returns {object}
  */
function normalizeMetadata(
  metadata,
) {
  if (
    metadata ===
    undefined ||
    metadata ===
    null
  ) {
    return Object.freeze({});
  }

  if (
    typeof metadata !==
    "object" ||
    Array.isArray(
      metadata,
    )
  ) {
    throw new TypeError(
      "TITech bootstrap phase metadata must be an object.",
    );
  }

  const keys =
    Object.keys(
      metadata,
    );

  if (
    keys.length >
    MAX_METADATA_KEYS
  ) {
    throw new TypeError(
      `TITech bootstrap phase metadata must not contain more than ${MAX_METADATA_KEYS} keys.`,
    );
  }

  return Object.freeze({
    ...metadata,
  });
}

/**

* Determine whether a value is object-like.
  */
function isObjectLike(
  value,
) {
  return (
    value !==
    null &&
    typeof value ===
    "object"
  );
}

/* =============================================================================

* Diagnostic Sanitization
* =============================================================================
  */

/**

* Sanitize common credential-bearing strings.
*
* This is intentionally conservative and is used only for diagnostics.
  */
function sanitizeText(
  value,
) {
  if (
    value ===
    undefined ||
    value ===
    null
  ) {
    return value;
  }

  let text;

  try {
    text =
      String(value);
  } catch {
    return "[unserializable]";
  }

  text =
    text.replace(
      /(mongodb(?:\+srv)?:\/\/)([^/\s:@]+)(?::[^@\s]*)?@/gi,
      "$1***:***@",
    );

  text =
    text.replace(
      /([?&](?:password|passwd|pwd|secret|token|access_token|refresh_token|api_key|apikey)=)[^&\s]*/gi,
      "$1***",
    );

  text =
    text.replace(
      /((?:password|passwd|pwd|secret|token|access[*-]?token|refresh[*-]?token|api[_-]?key|apikey)\s*[:=]\s*)["']?[^,\s"']+/gi,
      "$1***",
    );

  return text;
}

/**

* Serialize an error without exposing sensitive information.
*
* @param {*} error
* @param {object} options
* @returns {object}
  */
function serializeError(
  error,
  options = {},
) {
  const normalized =
    normalizeError(
      error,
    );

  const serialized = {
    name:
      normalized.name ||
      "Error",


    message:
      sanitizeText(
        normalized.message ||
        "Unknown error",
      ),

    code:
      normalized.code ||
      null,

    phase:
      normalized.phase ||
      null,

    critical:
      normalized.critical !==
        undefined
        ? normalized.critical
        : null,

    fatal:
      normalized.fatal !==
        undefined
        ? normalized.fatal
        : null,

    retryable:
      normalized.retryable !==
        undefined
        ? normalized.retryable
        : null,

    durationMs:
      Number.isFinite(
        normalized.durationMs,
      )
        ? normalized.durationMs
        : null,


  };

  if (
    options.includeStack !==
    false &&
    normalized.stack
  ) {
    serialized.stack =
      sanitizeText(
        normalized.stack,
      );
  }

  return Object.freeze(
    serialized,
  );
}

/* =============================================================================

* Safe Logger
* =============================================================================
*
* Logger failures MUST NEVER replace the actual bootstrap phase result.
* =============================================================================
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
    * Logging is observability.
    *
    * It must never become authoritative lifecycle state.
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
* Callback failures are deliberately isolated from phase execution.
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
    await callback(
      value,
    );
  } catch {
    /*
    * Lifecycle diagnostics are advisory.
    *
    * A broken observer must never replace the actual phase result.
    */
  }
}

/* =============================================================================

* Abort Helpers
* =============================================================================
  */

/**

* Safely determine whether an AbortSignal-like value is usable.
  */
function isAbortSignalLike(
  signal,
) {
  return Boolean(
    signal &&
    typeof signal ===
    "object" &&
    typeof signal.aborted ===
    "boolean" &&
    typeof signal.addEventListener ===
    "function" &&
    typeof signal.removeEventListener ===
    "function",
  );
}

/**

* Convert an abort reason into a normalized Error.
  */
function normalizeAbortReason(
  reason,
) {
  if (
    reason instanceof
    Error
  ) {
    return reason;
  }

  if (
    reason !==
    undefined &&
    reason !==
    null
  ) {
    return normalizeError(
      reason,
    );
  }

  return new Error(
    "TITech bootstrap operation aborted.",
  );
}

/* =============================================================================

* Timeout Execution
* =============================================================================
*
* JavaScript promises cannot be forcibly cancelled.
*
* The timeout therefore:
*
* 1. creates a child AbortController;
* 2. propagates parent cancellation;
* 3. aborts the child signal on timeout;
* 4. rejects the lifecycle wait with a deterministic timeout error;
* 5. attaches a terminal rejection observer to late promises.
*
* Cooperative handlers should honor:
*
* context.signal
*
* or:
*
* executionOptions.signal
*
* =============================================================================
  */

async function executeWithTimeout(
  execute,
  {
    phase,
    timeoutMs,
    critical =
    DEFAULT_CRITICAL,
    fatal =
    DEFAULT_FATAL,
    metadata = {},
    signal:
    parentSignal = null,
  } = {},
) {
  if (
    typeof execute !==
    "function"
  ) {
    throw new TypeError(
      "TITech bootstrap phase execute must be a function.",
    );
  }

  const normalizedPhase =
    normalizePhaseName(
      phase,
    );

  const boundedTimeout =
    normalizeTimeout(
      timeoutMs,
    );

  const normalizedMetadata =
    normalizeMetadata(
      metadata,
    );

  const controller =
    new AbortController();

  let timer =
    null;

  let parentAbortHandler =
    null;

  let timedOut =
    false;

  let externallyAborted =
    false;

  let timeoutError =
    null;

  if (
    isAbortSignalLike(
      parentSignal,
    )
  ) {
    parentAbortHandler =
      () => {
        if (
          !controller.signal.aborted
        ) {
          externallyAborted =
            true;


          controller.abort(
            normalizeAbortReason(
              parentSignal.reason,
            ),
          );
        }
      };

    if (
      parentSignal.aborted
    ) {
      parentAbortHandler();
    } else {
      parentSignal.addEventListener(
        "abort",
        parentAbortHandler,
        {
          once: true,
        },
      );
    }


  }

  const operation =
    Promise.resolve().then(
      () =>
        execute({
          signal:
            controller.signal,
        }),
    );

  /*
  
  * Promise.race attaches rejection handlers to both promises.
  *
  * We additionally attach a terminal catch after timeout to make the
  * late-settlement intent explicit and defensive.
    */
  operation.catch(
    () => undefined,
  );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              if (
                controller.signal
                  .aborted
              ) {
                return;
              }


              timedOut =
                true;

              timeoutError =
                new BootstrapPhaseTimeoutError(
                  normalizedPhase,
                  boundedTimeout,
                  {
                    critical,
                    fatal,
                    metadata:
                      normalizedMetadata,
                  },
                );

              controller.abort(
                timeoutError,
              );

              reject(
                timeoutError,
              );
            },
            boundedTimeout,
          );

        timer.unref?.();
      },
    );


  try {
    if (
      externallyAborted ||
      (
        isAbortSignalLike(
          parentSignal,
        ) &&
        parentSignal.aborted
      )
    ) {
      throw new BootstrapPhaseAbortError(
        normalizedPhase,
        parentSignal?.reason,
        {
          critical,
          fatal,
          metadata:
            normalizedMetadata,
        },
      );
    }


    return await Promise.race([
      operation,
      timeout,
    ]);

  } catch (error) {
    /*
    * If a parent signal aborts while Promise.race is waiting, the operation
    * itself is responsible for rejecting/returning. We still provide a
    * deterministic lifecycle error when the parent has definitely aborted.
    */
    if (
      externallyAborted &&
      !timedOut
    ) {
      throw new BootstrapPhaseAbortError(
        normalizedPhase,
        parentSignal?.reason,
        {
          critical,
          fatal,
          metadata:
            normalizedMetadata,
        },
      );
    }


    throw error;


  } finally {
    if (
      timer
    ) {
      clearTimeout(
        timer,
      );
    }


    if (
      parentSignal &&
      parentAbortHandler
    ) {
      try {
        parentSignal.removeEventListener(
          "abort",
          parentAbortHandler,
        );
      } catch {
        /*
         * AbortSignal cleanup is advisory.
         */
      }
    }

    /*
     * Explicitly retain a rejection observer for a timed-out operation.
     *
     * The underlying operation cannot be forcefully cancelled by JavaScript.
     */
    if (
      timedOut
    ) {
      void operation.catch(
        () => undefined,
      );
    }

    /*
     * Avoid an unused diagnostic variable in environments that optimize
     * aggressively while keeping the timeout semantics explicit.
     */
    void timeoutError;


  }
}

/* =============================================================================

* Phase Validation
* =============================================================================
  */

function validatePhaseOptions(
  options,
) {
  if (
    !options ||
    typeof options !==
    "object"
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
      options.critical !==
        undefined
        ? Boolean(
          options.critical,
        )
        : DEFAULT_CRITICAL,

    fatal:
      options.fatal !==
        undefined
        ? Boolean(
          options.fatal,
        )
        : DEFAULT_FATAL,

    timeoutMs:
      normalizeTimeout(
        options.timeoutMs,
      ),

    logger:
      options.logger ||
      null,

    metadata:
      normalizeMetadata(
        options.metadata,
      ),

    context:
      isObjectLike(
        options.context,
      )
        ? options.context
        : null,

    signal:
      isAbortSignalLike(
        options.signal,
      )
        ? options.signal
        : null,

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

* Execute one deterministic bootstrap phase.
*
* Contract:
*
* const result = await runPhase(
* ```
  context,
  ```
* ```
  {
  ```
* ```
    name: "configuration",
  ```
* ```
    critical: true,
  ```
* ```
    fatal: true,
  ```
* ```
    timeoutMs: 30000,
  ```
* ```
    logger,
  ```
* ```
    metadata: {},
  ```
* ```
    execute: async context => {},
  ```
* ```
  },
  ```
* );
*
* Successful phase:
*
* {
* ```
  success: true,
  ```
* ```
  failed: false,
  ```
* ```
  ...
  ```
* }
*
* Non-critical failed phase:
*
* {
* ```
  success: false,
  ```
* ```
  failed: true,
  ```
* ```
  ...
  ```
* }
*
* Critical failed phase:
*
* throws original normalized error
*
* @param {object} context
* @param {object} options
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
    signal,
  } = normalized;

  const startedAt =
    Date.now();

  const startedTimestamp =
    new Date();

  const startedNs =
    process.hrtime.bigint();

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
    /*
    * Abort before execution.
    *
    * This avoids invoking a phase that has already been cancelled by the
    * composition root.
    */
    if (
      signal?.aborted
    ) {
      throw new BootstrapPhaseAbortError(
        phase,
        signal.reason,
        {
          critical,
          fatal,
          metadata,
        },
      );
    }


    const result =
      await executeWithTimeout(
        async ({
          signal:
          phaseSignal,
        }) => {
          /*
           * Prefer the original context as the execution argument while
           * exposing the cooperative child AbortSignal.
           *
           * We deliberately do not mutate the caller's context.
           */
          const executionContext =
            isObjectLike(
              context,
            )
              ? Object.freeze({
                ...context,

                signal:
                  phaseSignal,
              })
              : Object.freeze({
                signal:
                  phaseSignal,
              });

          return execute(
            executionContext,
          );
        },
        {
          phase,
          timeoutMs,
          critical,
          fatal,
          metadata,
          signal,
        },
      );

    const finishedAt =
      Date.now();

    const finishedTimestamp =
      new Date();

    const monotonicDurationMs =
      Number(
        process.hrtime.bigint() -
        startedNs,
      ) /
      1_000_000;

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

        monotonicDurationMs,

        startedAt:
          startedTimestamp,

        finishedAt:
          finishedTimestamp,

        metadata:
          metadata,
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

        monotonicDurationMs,

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

    const monotonicDurationMs =
      Number(
        process.hrtime.bigint() -
        startedNs,
      ) /
      1_000_000;

    const durationMs =
      Math.max(
        0,
        finishedAt -
        startedAt,
      );

    /*
     * Preserve the original error.
     *
     * Do not replace database, Redis, configuration, provider, or timeout
     * errors with generic phase errors.
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

    if (
      originalError.monotonicDurationMs ===
      undefined
    ) {
      originalError.monotonicDurationMs =
        monotonicDurationMs;
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

        monotonicDurationMs,

        startedAt:
          startedTimestamp,

        finishedAt:
          finishedTimestamp,

        metadata:
          metadata,
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

        monotonicDurationMs,

        event:
          "bootstrap.phase.failed",

        error:
          serializeError(
            originalError,
            {
              includeStack:
                true,
            },
          ),
      },
      `TITech bootstrap phase failed: ${phase}`,
    );

    await safeCallback(
      onFailure,
      record,
    );

    /*
     * Non-critical phase:
     *
     * Return a deterministic failure record so the caller can decide whether
     * bootstrap may continue.
     */
    if (
      !critical
    ) {
      return record;
    }

    /*
     * Critical phase:
     *
     * Preserve the exact normalized original error.
     *
     * The caller remains responsible for deciding application-wide lifecycle
     * consequences.
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
    result.success ===
    true &&
    result.failed !==
    true,
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
    result.failed ===
    true,
  );
}

/**

* Determine whether a phase result is critical.
*
* @param {*} result
* @returns {boolean}
  */
function isPhaseCritical(
  result,
) {
  return Boolean(
    result &&
    result.critical ===
    true,
  );
}

/**

* Determine whether a phase result is fatal.
*
* @param {*} result
* @returns {boolean}
  */
function isPhaseFatal(
  result,
) {
  return Boolean(
    result &&
    result.fatal ===
    true,
  );
}

/**

* Create a normalized diagnostic representation.
*
* Error objects and arbitrary phase results are intentionally excluded from
* this snapshot so the result remains safe for logging/metrics exposure.
*
* @param {*} result
* @returns {object|null}
  */
function snapshotPhase(
  result,
) {
  if (
    !result ||
    typeof result !==
    "object"
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
      result.success ===
      true,

    failed:
      result.failed ===
      true,

    critical:
      result.critical !==
        undefined
        ? Boolean(
          result.critical,
        )
        : null,

    fatal:
      result.fatal !==
        undefined
        ? Boolean(
          result.fatal,
        )
        : null,

    durationMs:
      Number.isFinite(
        result.durationMs,
      )
        ? result.durationMs
        : null,

    monotonicDurationMs:
      Number.isFinite(
        result.monotonicDurationMs,
      )
        ? result.monotonicDurationMs
        : null,

    startedAt:
      result.startedAt ||
      null,

    finishedAt:
      result.finishedAt ||
      null,

    metadata:
      normalizeMetadata(
        result.metadata,
      ),


  });
}

/* =============================================================================

* Public API
* =============================================================================
  */

const phaseRunnerModule =
  Object.freeze({
    MODULE_NAME,


    DEFAULT_PHASE_TIMEOUT_MS,

    DEFAULT_CRITICAL,

    DEFAULT_FATAL,

    BootstrapPhaseError,

    BootstrapPhaseTimeoutError,

    BootstrapPhaseAbortError,

    runPhase,

    executeWithTimeout,

    normalizeError,

    normalizePhaseName,

    normalizeTimeout,

    normalizeMetadata,

    serializeError,

    isPhaseSuccessful,

    isPhaseFailed,

    isPhaseCritical,

    isPhaseFatal,

    snapshotPhase,


  });

/* =============================================================================

* Development Contract Self-Check
* =============================================================================
  */

if (
  process.env.NODE_ENV !==
  "production"
) {
  const requiredExports =
    [
      "MODULE_NAME",


      "BootstrapPhaseError",

      "BootstrapPhaseTimeoutError",

      "BootstrapPhaseAbortError",

      "runPhase",

      "executeWithTimeout",

      "normalizeError",

      "isPhaseSuccessful",

      "isPhaseFailed",

      "snapshotPhase",
    ];


  for (
    const exportName of
    requiredExports
  ) {
    if (
      typeof phaseRunnerModule[
      exportName
      ] ===
      "undefined"
    ) {
      throw new Error(
        `TITech bootstrap phase runner export contract is invalid: "${exportName}" is missing.`,
      );
    }
  }
}

export default phaseRunnerModule;