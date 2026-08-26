"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Bootstrap Hook Registry & Lifecycle Orchestrator
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/hooks.js
 *
 * Purpose:
 *   Canonical lifecycle hook registry and deterministic dependency-aware
 *   orchestration engine for the TITech Community Capital backend bootstrap.
 *
 * Architectural position:
 *
 *   server.js
 *       ↓
 *   bootstrap/app.js
 *       ↓
 *   BootstrapContext
 *       ↓
 *   BootstrapHookRegistry
 *       ↓
 *   phaseRunner
 *       ↓
 *   infrastructure / services / middleware / routes / server
 *
 * Responsibilities:
 *   ✓ Hook registration
 *   ✓ Deterministic dependency resolution
 *   ✓ Topological startup ordering
 *   ✓ Reverse dependency shutdown ordering
 *   ✓ External bootstrap dependency support
 *   ✓ Per-hook timeout protection
 *   ✓ Startup rollback
 *   ✓ Partial-startup cleanup
 *   ✓ Lifecycle diagnostics/history
 *   ✓ Idempotent lifecycle operations
 *   ✓ Safe process signal handling
 *   ✓ Safe uncaughtException/unhandledRejection handling
 *   ✓ Deterministic test reset
 *   ✓ Compatibility with existing TITech registration APIs
 *   ✓ Compatibility with infrastructure.js startup(context)
 *
 * IMPORTANT:
 *
 * This module MUST NOT:
 *
 *   - create Express applications;
 *   - create HTTP servers;
 *   - connect directly to MongoDB;
 *   - connect directly to Redis;
 *   - initialize queues directly;
 *   - initialize Socket.IO directly;
 *   - implement financial business logic;
 *   - own BootstrapContext lifecycle state;
 *   - replace BootstrapContext.state;
 *   - terminate the Node.js process.
 *
 * BootstrapContext remains the canonical application lifecycle authority.
 *
 * =============================================================================
 */

const crypto =
  require("node:crypto");

const {
  runPhase,
} = require("./phaseRunner");

/* =============================================================================
 * Constants
 * =============================================================================
 */

const MODULE_NAME =
  "TITechBootstrapHooks";

const HOOK_PHASES =
  Object.freeze({
    STARTUP:
      "startup",

    SHUTDOWN:
      "shutdown",
  });

const LIFECYCLE_STATES =
  Object.freeze({
    CREATED:
      "created",

    INITIALIZING:
      "initializing",

    READY:
      "ready",

    STARTING:
      "starting",

    RUNNING:
      "running",

    STOPPING:
      "stopping",

    STOPPED:
      "stopped",

    FAILED:
      "failed",
  });

const DEFAULTS =
  Object.freeze({
    timeoutMs:
      30_000,

    shutdownTimeoutMs:
      30_000,

    continueOnError:
      false,

    rollbackOnFailure:
      true,

    critical:
      true,

    fatal:
      true,

    allowExternalDependencies:
      true,

    failOnUnknownExternalDependency:
      false,
  });

const MAX_HOOK_NAME_LENGTH =
  200;

const TERMINAL_STATES =
  new Set([
    LIFECYCLE_STATES.STOPPED,
  ]);

const ACTIVE_STATES =
  new Set([
    LIFECYCLE_STATES.INITIALIZING,
    LIFECYCLE_STATES.STARTING,
    LIFECYCLE_STATES.RUNNING,
    LIFECYCLE_STATES.STOPPING,
  ]);

const EXTERNAL_DEPENDENCY_ALIASES =
  Object.freeze({
    environment:
      Object.freeze([
        "environment",
        "environmentBootstrap",
      ]),

    configuration:
      Object.freeze([
        "configuration",
        "config",
      ]),

    logger:
      Object.freeze([
        "logger",
      ]),

    observability:
      Object.freeze([
        "observability",
        "telemetry",
      ]),

    readiness:
      Object.freeze([
        "readiness",
      ]),

    resilience:
      Object.freeze([
        "resilience",
      ]),

    infrastructure:
      Object.freeze([
        "infrastructure",
      ]),

    database:
      Object.freeze([
        "database",
        "db",
      ]),

    redis:
      Object.freeze([
        "redis",
      ]),

    services:
      Object.freeze([
        "services",
        "serviceRegistry",
      ]),

    middleware:
      Object.freeze([
        "middleware",
      ]),

    routes:
      Object.freeze([
        "routes",
      ]),

    server:
      Object.freeze([
        "server",
        "httpServer",
      ]),

    runtime:
      Object.freeze([
        "runtime",
        "runtimeReady",
      ]),
  });

/* =============================================================================
 * Errors
 * =============================================================================
 */

class BootstrapHookError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      typeof message ===
        "string" &&
      message.trim()
        ? message
        : "TITech bootstrap hook error.",
    );

    this.name =
      "BootstrapHookError";

    this.code =
      options.code ||
      "BOOTSTRAP_HOOK_ERROR";

    this.hookId =
      options.hookId ||
      null;

    this.hookName =
      options.hookName ||
      null;

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

    this.retryable =
      options.retryable ??
      null;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details ||
          {}),
      });

    Error.captureStackTrace?.(
      this,
      BootstrapHookError,
    );
  }
}

class BootstrapHookTimeoutError
  extends BootstrapHookError {
  constructor(
    hook,
    timeoutMs,
    phase = null,
  ) {
    super(
      `TITech bootstrap hook "${hook.name}" timed out after ${timeoutMs}ms.`,
      {
        code:
          "BOOTSTRAP_HOOK_TIMEOUT",

        hookId:
          hook.id,

        hookName:
          hook.name,

        phase:
          phase ||
          hook.phase,

        critical:
          hook.critical,

        fatal:
          hook.fatal,

        retryable:
          true,

        details: {
          timeoutMs,
        },
      },
    );

    this.timeoutMs =
      timeoutMs;
  }
}

class BootstrapDependencyError
  extends BootstrapHookError {
  constructor(
    message,
    details = {},
  ) {
    super(
      message,
      {
        code:
          "BOOTSTRAP_DEPENDENCY_ERROR",

        details,
      },
    );
  }
}

class BootstrapLifecycleStateError
  extends BootstrapHookError {
  constructor(
    message,
    details = {},
  ) {
    super(
      message,
      {
        code:
          "BOOTSTRAP_INVALID_LIFECYCLE_STATE",

        details,
      },
    );
  }
}

/* =============================================================================
 * Helpers
 * =============================================================================
 */

function createId(
  name,
) {
  return crypto
    .createHash("sha256")
    .update(String(name))
    .digest("hex")
    .slice(0, 16);
}

function normalizeName(
  value,
  label = "Hook name",
) {
  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    throw new TypeError(
      `${label} must be a non-empty string.`,
    );
  }

  const normalized =
    value.trim();

  if (
    normalized.length >
    MAX_HOOK_NAME_LENGTH
  ) {
    throw new TypeError(
      `${label} must not exceed ${MAX_HOOK_NAME_LENGTH} characters.`,
    );
  }

  return normalized;
}

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
      "TITech bootstrap hook dependencies must be an array.",
    );
  }

  return [
    ...new Set(
      dependencies.map(
        dependency =>
          normalizeName(
            dependency,
            "TITech bootstrap hook dependency",
          ),
      ),
    ),
  ];
}

function normalizePriority(
  priority,
) {
  if (
    priority ===
      undefined ||
    priority ===
      null
  ) {
    return 0;
  }

  if (
    !Number.isInteger(
      priority,
    )
  ) {
    throw new TypeError(
      "TITech bootstrap hook priority must be an integer.",
    );
  }

  return priority;
}

function normalizeTimeout(
  timeoutMs,
  fallback,
) {
  const value =
    timeoutMs ===
    undefined
      ? fallback
      : timeoutMs;

  if (
    !Number.isInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new TypeError(
      "TITech bootstrap hook timeout must be a positive integer.",
    );
  }

  return value;
}

function normalizeFunction(
  fn,
  name,
  handlerName,
) {
  if (
    typeof fn !==
    "function"
  ) {
    throw new TypeError(
      `TITech bootstrap hook "${name}" must provide a ${handlerName} function.`,
    );
  }

  return fn;
}

function normalizeLogger(
  logger,
) {
  if (
    logger ===
      null ||
    logger ===
      undefined
  ) {
    return null;
  }

  if (
    typeof logger !==
      "object" &&
    typeof logger !==
      "function"
  ) {
    return null;
  }

  return logger;
}

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
      thrown.stack &&
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
      "Unknown TITech bootstrap lifecycle failure.",
    );
  }

  return Object.assign(
    new Error(
      "Unknown TITech bootstrap lifecycle failure.",
    ),
    {
      details: {
        type:
          typeof thrown,
      },
    },
  );
}

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
      /([?&](?:password|passwd|pwd|secret|token|access_token)=)[^&\s]*/gi,
      "$1***",
    );

  return text;
}

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

    hookId:
      normalized.hookId ||
      null,

    hookName:
      normalized.hookName ||
      null,

    phase:
      normalized.phase ||
      null,

    critical:
      normalized.critical,

    fatal:
      normalized.fatal,

    retryable:
      normalized.retryable ??
      null,
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

function safeLog(
  logger,
  level,
  metadata,
  message,
) {
  const normalizedLogger =
    normalizeLogger(
      logger,
    );

  if (
    !normalizedLogger ||
    typeof normalizedLogger[
      level
    ] !==
      "function"
  ) {
    return;
  }

  try {
    normalizedLogger[level](
      metadata,
      message,
    );
  } catch {
    /*
     * Logging must never replace lifecycle authority.
     */
  }
}

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
     * Diagnostic callbacks are advisory only.
     */
  }
}

/* =============================================================================
 * External Dependency Resolution
 * =============================================================================
 */

function hasNestedProperty(
  object,
  propertyPath,
) {
  if (
    !isObjectLike(
      object,
    )
  ) {
    return false;
  }

  const segments =
    String(
      propertyPath,
    ).split(".");

  let current =
    object;

  for (
    const segment of
      segments
  ) {
    if (
      current ===
        null ||
      current ===
        undefined ||
      !Object.prototype.hasOwnProperty.call(
        Object(
          current,
        ),
        segment,
      )
    ) {
      return false;
    }

    current =
      current[
        segment
      ];
  }

  return (
    current !==
      undefined &&
    current !==
      null
  );
}

function getDependencyAliases(
  dependency,
) {
  return (
    EXTERNAL_DEPENDENCY_ALIASES[
      dependency
    ] || [
      dependency,
    ]
  );
}

function isExternallySatisfiedDependency(
  dependency,
  context,
) {
  if (
    !context
  ) {
    return false;
  }

  const aliases =
    getDependencyAliases(
      dependency,
    );

  const candidates = [
    context,
    context.bootstrapContext,
    context.context,
    context.infrastructure,
    context.services,
    context.serviceRegistry,
  ];

  for (
    const candidate of
      candidates
  ) {
    if (
      !candidate
    ) {
      continue;
    }

    for (
      const alias of
        aliases
    ) {
      if (
        hasNestedProperty(
          candidate,
          alias,
        )
      ) {
        return true;
      }
    }
  }

  const completedPhases =
    context.completedPhases ||
    context.bootstrapContext
      ?.completedPhases;

  if (
    Array.isArray(
      completedPhases,
    )
  ) {
    for (
      const alias of
        aliases
    ) {
      if (
        completedPhases.includes(
          alias,
        )
      ) {
        return true;
      }
    }
  }

  const state =
    context.state ||
    context.bootstrapContext
      ?.state;

  if (
    state &&
    typeof state ===
      "object"
  ) {
    for (
      const alias of
        aliases
    ) {
      const stateEntry =
        state[
          alias
        ];

      if (
        stateEntry ===
        "ready"
      ) {
        return true;
      }

      if (
        stateEntry &&
        typeof stateEntry ===
          "object" &&
        (
          stateEntry.ready ===
            true ||
          stateEntry.state ===
            "ready"
        )
      ) {
        return true;
      }
    }
  }

  const resolver =
    context.isDependencySatisfied ||
    context.bootstrapContext
      ?.isDependencySatisfied;

  if (
    typeof resolver ===
    "function"
  ) {
    try {
      return Boolean(
        resolver.call(
          context.bootstrapContext ||
            context,
          dependency,
        ),
      );
    } catch {
      return false;
    }
  }

  return false;
}

/* =============================================================================
 * Timeout Execution
 * =============================================================================
 *
 * Important:
 *
 * JavaScript promises cannot be forcibly cancelled.
 *
 * The timeout therefore:
 *   1. prevents bootstrap from waiting forever;
 *   2. provides an AbortSignal to cooperative handlers;
 *   3. attaches a rejection observer to late promises;
 *   4. records deterministic timeout diagnostics.
 *
 * =============================================================================
 */

async function executeWithTimeout(
  fn,
  {
    hook,
    context,
    timeoutMs,
    phase,
    signal: parentSignal = null,
  },
) {
  const boundedTimeout =
    normalizeTimeout(
      timeoutMs,
      DEFAULTS.timeoutMs,
    );

  const controller =
    new AbortController();

  let parentAbortHandler =
    null;

  let timer = null;

  let timedOut =
    false;

  if (
    parentSignal
  ) {
    parentAbortHandler =
      () => {
        if (
          !controller.signal.aborted
        ) {
          controller.abort(
            parentSignal.reason ||
              new Error(
                "Parent bootstrap operation aborted.",
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

  const executionContext =
    Object.freeze({
      ...(
        isObjectLike(
          context,
        )
          ? context
          : {}
      ),

      signal:
        controller.signal,
    });

  const operation =
    Promise.resolve().then(
      () =>
        fn(
          executionContext,
          {
            phase,

            signal:
              controller.signal,

            hook,
          },
        ),
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              timedOut =
                true;

              controller.abort(
                new BootstrapHookTimeoutError(
                  hook,
                  boundedTimeout,
                  phase,
                ),
              );

              reject(
                new BootstrapHookTimeoutError(
                  hook,
                  boundedTimeout,
                  phase,
                ),
              );
            },
            boundedTimeout,
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
      parentSignal.removeEventListener(
        "abort",
        parentAbortHandler,
      );
    }

    /**
     * A timed-out promise may continue executing.
     * Attach a terminal rejection observer so it cannot later become an
     * unhandled rejection.
     */
    if (
      timedOut
    ) {
      void operation.catch(
        () => undefined,
      );
    }
  }
}

/* =============================================================================
 * Bootstrap Hook Registry
 * =============================================================================
 */

class BootstrapHookRegistry {
  constructor(
    options = {},
  ) {
    this.options =
      Object.freeze({
        timeoutMs:
          normalizeTimeout(
            options.timeoutMs,
            DEFAULTS.timeoutMs,
          ),

        shutdownTimeoutMs:
          normalizeTimeout(
            options.shutdownTimeoutMs,
            DEFAULTS.shutdownTimeoutMs,
          ),

        continueOnError:
          options.continueOnError !==
          undefined
            ? Boolean(
                options.continueOnError,
              )
            : DEFAULTS.continueOnError,

        rollbackOnFailure:
          options.rollbackOnFailure !==
          undefined
            ? Boolean(
                options.rollbackOnFailure,
              )
            : DEFAULTS.rollbackOnFailure,

        critical:
          options.critical !==
          undefined
            ? Boolean(
                options.critical,
              )
            : DEFAULTS.critical,

        fatal:
          options.fatal !==
          undefined
            ? Boolean(
                options.fatal,
              )
            : DEFAULTS.fatal,

        allowExternalDependencies:
          options.allowExternalDependencies !==
          undefined
            ? Boolean(
                options.allowExternalDependencies,
              )
            : DEFAULTS.allowExternalDependencies,

        failOnUnknownExternalDependency:
          options.failOnUnknownExternalDependency !==
          undefined
            ? Boolean(
                options.failOnUnknownExternalDependency,
              )
            : DEFAULTS.failOnUnknownExternalDependency,

        logger:
          normalizeLogger(
            options.logger,
          ),

        onHookStart:
          options.onHookStart,

        onHookComplete:
          options.onHookComplete,

        onHookFailure:
          options.onHookFailure,

        onLifecycleChange:
          options.onLifecycleChange,
      });

    this._hooks =
      new Map();

    this._startedHooks =
      [];

    this._history =
      [];

    this._state =
      LIFECYCLE_STATES.CREATED;

    this._initializePromise =
      null;

    this._startPromise =
      null;

    this._shutdownPromise =
      null;

    this._initialized =
      false;

    this._started =
      false;

    this._stopped =
      false;

    this._shutdownStarted =
      false;

    this._initializationError =
      null;

    this._startupError =
      null;

    this._shutdownError =
      null;

    this._createdAt =
      new Date();

    this._initializedAt =
      null;

    this._startedAt =
      null;

    this._stoppedAt =
      null;
  }

  /* ===========================================================================
   * Lifecycle State
   * ========================================================================= */

  _setState(
    state,
    metadata = {},
  ) {
    const previousState =
      this._state;

    this._state =
      state;

    void safeCallback(
      this.options
        .onLifecycleChange,
      {
        previousState,
        state,
        metadata,
        timestamp:
          new Date(),
      },
    );

    return state;
  }

  /* ===========================================================================
   * Registration
   * ========================================================================= */

  register(
    options = {},
  ) {
    const name =
      normalizeName(
        options.name,
        "TITech bootstrap hook name",
      );

    if (
      this._hooks.has(
        name,
      )
    ) {
      const existing =
        this._hooks.get(
          name,
        );

      throw new BootstrapHookError(
        `TITech bootstrap hook "${name}" is already registered.`,
        {
          code:
            "BOOTSTRAP_HOOK_DUPLICATE",

          hookId:
            existing.id,

          hookName:
            name,

          phase:
            existing.phase,

          details: {
            registeredAt:
              existing.registeredAt,
          },
        },
      );
    }

    if (
      ACTIVE_STATES.has(
        this._state,
      )
    ) {
      throw new BootstrapLifecycleStateError(
        `Cannot register TITech bootstrap hook "${name}" while lifecycle state is "${this._state}".`,
        {
          state:
            this._state,
        },
      );
    }

    if (
      this._state ===
      LIFECYCLE_STATES.FAILED
    ) {
      throw new BootstrapLifecycleStateError(
        `Cannot register TITech bootstrap hook "${name}" while lifecycle state is "failed". Reset the registry first.`,
        {
          state:
            this._state,
        },
      );
    }

    if (
      this._state ===
      LIFECYCLE_STATES.STOPPED
    ) {
      throw new BootstrapLifecycleStateError(
        `Cannot register TITech bootstrap hook "${name}" after the registry has stopped.`,
        {
          state:
            this._state,
        },
      );
    }

    const phase =
      options.phase ||
      HOOK_PHASES.STARTUP;

    if (
      phase !==
        HOOK_PHASES.STARTUP &&
      phase !==
        HOOK_PHASES.SHUTDOWN
    ) {
      throw new TypeError(
        `Invalid TITech bootstrap hook phase "${phase}".`,
      );
    }

    const start =
      options.start ===
      undefined
        ? null
        : normalizeFunction(
            options.start,
            name,
            "start",
          );

    const stop =
      options.stop ===
      undefined
        ? null
        : normalizeFunction(
            options.stop,
            name,
            "stop",
          );

    if (
      !start &&
      !stop
    ) {
      throw new TypeError(
        `TITech bootstrap hook "${name}" must provide at least a start or stop function.`,
      );
    }

    const hook =
      Object.freeze({
        id:
          options.id !==
          undefined
            ? normalizeName(
                options.id,
                "TITech bootstrap hook ID",
              )
            : createId(
                name,
              ),

        name,

        phase,

        start,

        stop,

        priority:
          normalizePriority(
            options.priority,
          ),

        timeoutMs:
          normalizeTimeout(
            options.timeoutMs,
            this.options.timeoutMs,
          ),

        shutdownTimeoutMs:
          normalizeTimeout(
            options.shutdownTimeoutMs,
            this.options
              .shutdownTimeoutMs,
          ),

        dependencies:
          Object.freeze(
            normalizeDependencies(
              options.dependencies,
            ),
          ),

        critical:
          options.critical !==
          undefined
            ? Boolean(
                options.critical,
              )
            : this.options
                .critical,

        fatal:
          options.fatal !==
          undefined
            ? Boolean(
                options.fatal,
              )
            : this.options.fatal,

        enabled:
          options.enabled !==
          undefined
            ? Boolean(
                options.enabled,
              )
            : true,

        rollback:
          options.rollback !==
          undefined
            ? Boolean(
                options.rollback,
              )
            : this.options
                .rollbackOnFailure,

        metadata:
          Object.freeze({
            ...(options.metadata ||
              {}),
          }),

        registeredAt:
          new Date(),
      });

    this._hooks.set(
      name,
      hook,
    );

    return hook;
  }

  registerStartupHook(
    name,
    start,
    options = {},
  ) {
    return this.register({
      ...options,

      name,

      start,

      phase:
        HOOK_PHASES.STARTUP,
    });
  }

  startup(
    name,
    start,
    options = {},
  ) {
    return this.registerStartupHook(
      name,
      start,
      options,
    );
  }

  registerShutdownHook(
    name,
    stop,
    options = {},
  ) {
    return this.register({
      ...options,

      name,

      stop,

      phase:
        HOOK_PHASES.SHUTDOWN,
    });
  }

  shutdownHook(
    name,
    stop,
    options = {},
  ) {
    return this.registerShutdownHook(
      name,
      stop,
      options,
    );
  }

  lifecycle(
    name,
    {
      start,
      stop,
      ...options
    } = {},
  ) {
    return this.register({
      ...options,

      name,

      start,

      stop,
    });
  }

  /* ===========================================================================
   * Lookup
   * ========================================================================= */

  get(
    name,
  ) {
    return (
      this._hooks.get(
        name,
      ) ||
      null
    );
  }

  has(
    name,
  ) {
    return this._hooks.has(
      name,
    );
  }

  list({
    phase =
      undefined,

    includeDisabled =
      false,

    includeShutdownOnly =
      true,
  } = {}) {
    return [
      ...this._hooks.values(),
    ]
      .filter(
        hook => {
          if (
            phase !==
              undefined &&
            hook.phase !==
              phase
          ) {
            return false;
          }

          if (
            !includeDisabled &&
            !hook.enabled
          ) {
            return false;
          }

          if (
            !includeShutdownOnly &&
            hook.phase ===
              HOOK_PHASES.SHUTDOWN
          ) {
            return false;
          }

          return true;
        },
      )
      .sort(
        BootstrapHookRegistry
          .compareHooks,
      );
  }

  /* ===========================================================================
   * Dependency Resolution
   * ========================================================================= */

  _resolveStartupOrder(
    context = {},
  ) {
    const startupHooks =
      this.list({
        phase:
          HOOK_PHASES.STARTUP,

        includeDisabled:
          false,
      }).filter(
        hook =>
          typeof hook.start ===
            "function",
      );

    return this._topologicalSort(
      startupHooks,
      HOOK_PHASES.STARTUP,
      context,
    );
  }

  _resolveShutdownOrder(
    candidates = null,
    context = {},
  ) {
    const hooks =
      candidates ||
      this.list({
        includeDisabled:
          false,
      }).filter(
        hook =>
          typeof hook.stop ===
          "function",
      );

    /**
     * Shutdown dependencies must be interpreted using the same dependency
     * relation and then reversed.
     *
     * Example:
     *
     *   database → services
     *
     * startup:
     *   database, services
     *
     * shutdown:
     *   services, database
     */
    return this._topologicalSort(
      hooks,
      HOOK_PHASES.SHUTDOWN,
      context,
    ).reverse();
  }

  _topologicalSort(
    hookList,
    phase,
    context = {},
  ) {
    const hookMap =
      new Map(
        hookList.map(
          hook => [
            hook.name,
            hook,
          ],
        ),
      );

    const incoming =
      new Map();

    const outgoing =
      new Map();

    for (
      const hook of
        hookList
    ) {
      incoming.set(
        hook.name,
        0,
      );

      outgoing.set(
        hook.name,
        new Set(),
      );
    }

    for (
      const hook of
        hookList
    ) {
      for (
        const dependency of
          hook.dependencies
      ) {
        if (
          dependency ===
          hook.name
        ) {
          throw new BootstrapDependencyError(
            `TITech bootstrap hook "${hook.name}" cannot depend on itself.`,
            {
              phase,

              hook:
                hook.name,
            },
          );
        }

        if (
          !hookMap.has(
            dependency,
          )
        ) {
          const externallySatisfied =
            this.options
              .allowExternalDependencies &&
            isExternallySatisfiedDependency(
              dependency,
              context,
            );

          if (
            externallySatisfied
          ) {
            continue;
          }

          const knownExternal =
            Boolean(
              EXTERNAL_DEPENDENCY_ALIASES[
                dependency
              ],
            );

          /**
           * Unknown dependencies are configurable.
           *
           * Default behavior preserves compatibility with the current system:
           * fail when a dependency cannot actually be resolved.
           */
          if (
            !knownExternal ||
            this.options
              .failOnUnknownExternalDependency
          ) {
            throw new BootstrapDependencyError(
              `TITech bootstrap hook "${hook.name}" depends on missing hook "${dependency}".`,
              {
                phase,

                hook:
                  hook.name,

                dependency,

                externalDependency:
                  knownExternal,
              },
            );
          }

          /**
           * Known external dependency, but current context has not explicitly
           * proven it ready. Treat it as externally managed for compatibility.
           */
          continue;
        }

        incoming.set(
          hook.name,
          incoming.get(
            hook.name,
          ) + 1,
        );

        outgoing
          .get(
            dependency,
          )
          .add(
            hook.name,
          );
      }
    }

    const queue =
      hookList
        .filter(
          hook =>
            incoming.get(
              hook.name,
            ) === 0,
        )
        .sort(
          BootstrapHookRegistry
            .compareHooks,
        );

    const ordered =
      [];

    while (
      queue.length >
      0
    ) {
      const current =
        queue.shift();

      ordered.push(
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
          queue.push(
            hookMap.get(
              dependent,
            ),
          );

          queue.sort(
            BootstrapHookRegistry
              .compareHooks,
          );
        }
      }
    }

    if (
      ordered.length !==
      hookList.length
    ) {
      const cyclicHooks =
        hookList
          .filter(
            hook =>
              incoming.get(
                hook.name,
              ) > 0,
          )
          .map(
            hook =>
              hook.name,
          );

      throw new BootstrapDependencyError(
        "A circular TITech bootstrap hook dependency was detected.",
        {
          phase,

          hooks:
            cyclicHooks,
        },
      );
    }

    return ordered;
  }

  static compareHooks(
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

  /* ===========================================================================
   * Hook Context
   * ========================================================================= */

  _createHookContext(
    context,
    {
      hook,
      phase,
      signal =
        null,
    },
  ) {
    const baseContext =
      isObjectLike(
        context,
      )
        ? context
        : {};

    return Object.freeze({
      ...baseContext,

      bootstrapHook:
        hook,

      lifecycle:
        Object.freeze({
          ...(
            baseContext
              .lifecycle ||
            {}
          ),

          hook:
            hook.name,

          hookId:
            hook.id,

          phase,

          state:
            this._state,

          timestamp:
            new Date(),
        }),

      signal,
    });
  }

  /* ===========================================================================
   * Hook Execution
   * ========================================================================= */

  async _executeHook(
    hook,
    {
      phase,
      context,
      signal =
        null,
      logger =
        null,
    },
  ) {
    const fn =
      phase ===
      HOOK_PHASES.STARTUP
        ? hook.start
        : hook.stop;

    if (
      typeof fn !==
      "function"
    ) {
      const record =
        Object.freeze({
          hook:
            hook.name,

          hookId:
            hook.id,

          phase,

          success:
            true,

          skipped:
            true,

          reason:
            "no-handler",

          durationMs:
            0,

          startedAt:
            Date.now(),

          finishedAt:
            Date.now(),
        });

      this._history.push(
        record,
      );

      return record;
    }

    const startedAt =
      Date.now();

    const startedNs =
      process.hrtime.bigint();

    const hookContext =
      this._createHookContext(
        context,
        {
          hook,
          phase,
          signal,
        },
      );

    const timeoutMs =
      phase ===
      HOOK_PHASES.SHUTDOWN
        ? hook.shutdownTimeoutMs
        : hook.timeoutMs;

    safeLog(
      logger,
      "info",
      {
        module:
          MODULE_NAME,

        hook:
          hook.name,

        hookId:
          hook.id,

        phase,

        priority:
          hook.priority,

        dependencies:
          [
            ...hook.dependencies,
          ],

        critical:
          hook.critical,

        fatal:
          hook.fatal,

        timeoutMs,

        event:
          "bootstrap.hook.started",
      },
      `TITech bootstrap hook started: ${hook.name}`,
    );

    void emitHookMetric(
      "started",
      hook,
      phase,
    );

    await safeCallback(
      this.options
        .onHookStart,
      {
        hook,
        phase,
        startedAt,
      },
    );

    try {
      const result =
        await runPhase(
          hookContext,
          {
            name:
              `${phase}:${hook.name}`,

            critical:
              hook.critical,

            fatal:
              hook.fatal,

            logger,

            execute:
              async () =>
                executeWithTimeout(
                  fn,
                  {
                    hook,
                    context:
                      hookContext,
                    timeoutMs,
                    phase,
                    signal,
                  },
                ),
          },
        );

      const finishedAt =
        Date.now();

      const durationMs =
        Math.max(
          0,
          finishedAt -
            startedAt,
        );

      const monotonicDurationMs =
        Number(
          process.hrtime.bigint() -
            startedNs,
        ) /
        1_000_000;

      const record =
        Object.freeze({
          hook:
            hook.name,

          hookId:
            hook.id,

          phase,

          success:
            true,

          skipped:
            false,

          result,

          durationMs,

          monotonicDurationMs,

          startedAt,

          finishedAt,
        });

      this._history.push(
        record,
      );

      safeLog(
        logger,
        "info",
        {
          module:
            MODULE_NAME,

          hook:
            hook.name,

          hookId:
            hook.id,

          phase,

          durationMs,

          event:
            "bootstrap.hook.completed",
        },
        `TITech bootstrap hook completed: ${hook.name}`,
      );

      void emitHookMetric(
        "completed",
        hook,
        phase,
        {
          durationMs,
        },
      );

      await safeCallback(
        this.options
          .onHookComplete,
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

      const durationMs =
        Math.max(
          0,
          finishedAt -
            startedAt,
        );

      let error =
        originalError;

      if (
        !(error instanceof
          BootstrapHookError)
      ) {
        error =
          new BootstrapHookError(
            `TITech bootstrap hook "${hook.name}" failed.`,
            {
              code:
                originalError.code ===
                "BOOTSTRAP_HOOK_TIMEOUT"
                  ? "BOOTSTRAP_HOOK_TIMEOUT"
                  : phase ===
                      HOOK_PHASES.STARTUP
                    ? "BOOTSTRAP_STARTUP_FAILED"
                    : "BOOTSTRAP_SHUTDOWN_FAILED",

              hookId:
                hook.id,

              hookName:
                hook.name,

              phase,

              critical:
                hook.critical,

              fatal:
                hook.fatal,

              retryable:
                originalError.retryable ??
                null,

              cause:
                originalError,

              details: {
                durationMs,
              },
            },
          );
      }

      return this._recordHookFailure(
        hook,
        phase,
        error,
        durationMs,
        startedAt,
        finishedAt,
        logger,
      );
    }
  }

  async _recordHookFailure(
    hook,
    phase,
    error,
    durationMs,
    startedAt,
    finishedAt,
    logger,
  ) {
    const normalizedError =
      normalizeError(
        error,
      );

    if (
      !normalizedError.hookId
    ) {
      normalizedError.hookId =
        hook.id;
    }

    if (
      !normalizedError.hookName
    ) {
      normalizedError.hookName =
        hook.name;
    }

    if (
      !normalizedError.phase
    ) {
      normalizedError.phase =
        phase;
    }

    if (
      normalizedError.critical ===
      undefined
    ) {
      normalizedError.critical =
        hook.critical;
    }

    if (
      normalizedError.fatal ===
      undefined
    ) {
      normalizedError.fatal =
        hook.fatal;
    }

    const record =
      Object.freeze({
        hook:
          hook.name,

        hookId:
          hook.id,

        phase,

        success:
          false,

        skipped:
          false,

        error:
          normalizedError,

        durationMs,

        startedAt,

        finishedAt,
      });

    this._history.push(
      record,
    );

    safeLog(
      logger,
      "error",
      {
        module:
          MODULE_NAME,

        hook:
          hook.name,

        hookId:
          hook.id,

        phase,

        critical:
          hook.critical,

        fatal:
          hook.fatal,

        durationMs,

        event:
          "bootstrap.hook.failed",

        error:
          serializeError(
            normalizedError,
            {
              includeStack:
                true,
            },
          ),
      },
      `TITech bootstrap hook failed: ${hook.name}`,
    );

    void emitHookMetric(
      "failed",
      hook,
      phase,
      {
        durationMs,

        error:
          serializeError(
            normalizedError,
            {
              includeStack:
                false,
            },
          ),
      },
    );

    await safeCallback(
      this.options
        .onHookFailure,
      record,
    );

    throw normalizedError;
  }

  /* ===========================================================================
   * Initialization
   * ========================================================================= */

  async initialize(
    context = {},
  ) {
    if (
      this._initialized
    ) {
      return this;
    }

    if (
      this._initializePromise
    ) {
      return this._initializePromise;
    }

    if (
      TERMINAL_STATES.has(
        this._state,
      )
    ) {
      throw new BootstrapLifecycleStateError(
        "TITech bootstrap registry cannot be initialized after it has stopped.",
        {
          state:
            this._state,
        },
      );
    }

    this._initializePromise =
      this._initializeInternal(
        context,
      );

    try {
      return await this
        ._initializePromise;
    } finally {
      this._initializePromise =
        null;
    }
  }

  async _initializeInternal(
    context,
  ) {
    this._setState(
      LIFECYCLE_STATES.INITIALIZING,
    );

    try {
      const startupOrder =
        this._resolveStartupOrder(
          context,
        );

      const shutdownOrder =
        this._resolveShutdownOrder(
          null,
          context,
        );

      this._initialized =
        true;

      this._initializedAt =
        new Date();

      this._setState(
        LIFECYCLE_STATES.READY,
        {
          startupOrder:
            startupOrder.map(
              hook =>
                hook.name,
            ),

          shutdownOrder:
            shutdownOrder.map(
              hook =>
                hook.name,
            ),
        },
      );

      return this;
    } catch (error) {
      const normalized =
        normalizeError(
          error,
        );

      this._initializationError =
        normalized;

      this._setState(
        LIFECYCLE_STATES.FAILED,
        {
          reason:
            "initialization-failed",
        },
      );

      throw normalized;
    }
  }

  /* ===========================================================================
   * Startup
   * ========================================================================= */

  async start(
    context = {},
  ) {
    if (
      this._started &&
      this._state ===
        LIFECYCLE_STATES.RUNNING
    ) {
      return this;
    }

    if (
      this._startPromise
    ) {
      return this._startPromise;
    }

    if (
      this._shutdownStarted
    ) {
      throw new BootstrapLifecycleStateError(
        "TITech bootstrap cannot start after shutdown has begun.",
        {
          state:
            this._state,
        },
      );
    }

    if (
      this._state ===
      LIFECYCLE_STATES.FAILED
    ) {
      throw new BootstrapLifecycleStateError(
        "TITech bootstrap cannot restart from failed state. Reset the registry first.",
        {
          state:
            this._state,
        },
      );
    }

    this._startPromise =
      this._startInternal(
        context,
      );

    try {
      return await this
        ._startPromise;
    } finally {
      this._startPromise =
        null;
    }
  }

  async _startInternal(
    context,
  ) {
    if (
      !this._initialized
    ) {
      await this.initialize(
        context,
      );
    }

    if (
      this._state !==
      LIFECYCLE_STATES.READY
    ) {
      throw new BootstrapLifecycleStateError(
        `TITech bootstrap cannot start from lifecycle state "${this._state}".`,
        {
          state:
            this._state,
        },
      );
    }

    const logger =
      normalizeLogger(
        context?.logger ||
          this.options.logger,
      );

    const startedAt =
      new Date();

    this._setState(
      LIFECYCLE_STATES.STARTING,
      {
        startedAt,
      },
    );

    const ordered =
      this._resolveStartupOrder(
        context,
      );

    this._startedHooks =
      [];

    safeLog(
      logger,
      "info",
      {
        module:
          MODULE_NAME,

        event:
          "bootstrap.lifecycle.starting",

        hookCount:
          ordered.length,

        order:
          ordered.map(
            hook =>
              hook.name,
          ),
      },
      "TITech bootstrap lifecycle starting.",
    );

    try {
      for (
        const hook of ordered
      ) {
        try {
          const record =
            await this._executeHook(
              hook,
              {
                phase:
                  HOOK_PHASES.STARTUP,

                context,

                signal:
                  context?.signal ||
                  null,

                logger,
              },
            );

          if (
            record.success &&
            !record.skipped
          ) {
            this._startedHooks.push(
              hook,
            );
          }
        } catch (error) {
          const normalized =
            normalizeError(
              error,
            );

          if (
            !hook.critical &&
            this.options
              .continueOnError
          ) {
            safeLog(
              logger,
              "warn",
              {
                module:
                  MODULE_NAME,

                hook:
                  hook.name,

                hookId:
                  hook.id,

                phase:
                  HOOK_PHASES.STARTUP,

                event:
                  "bootstrap.non_critical_hook_continued",

                error:
                  serializeError(
                    normalized,
                    {
                      includeStack:
                        false,
                    },
                  ),
              },
              `TITech non-critical bootstrap hook failed and startup will continue: ${hook.name}`,
            );

            continue;
          }

          throw normalized;
        }
      }

      this._started =
        true;

      this._stopped =
        false;

      this._startedAt =
        new Date();

      this._setState(
        LIFECYCLE_STATES.RUNNING,
        {
          startedAt:
            this._startedAt,

          hookCount:
            this._startedHooks
              .length,
        },
      );

      safeLog(
        logger,
        "info",
        {
          module:
            MODULE_NAME,

          event:
            "bootstrap.lifecycle.running",

          startedAt:
            this._startedAt,

          hookCount:
            this._startedHooks
              .length,
        },
        "TITech bootstrap lifecycle is running.",
      );

      return this;
    } catch (error) {
      const normalized =
        normalizeError(
          error,
        );

      this._startupError =
        normalized;

      this._started =
        false;

      this._stopped =
        false;

      this._setState(
        LIFECYCLE_STATES.FAILED,
        {
          reason:
            "startup-failure",

          error:
            serializeError(
              normalized,
              {
                includeStack:
                  true,
              },
            ),
        },
      );

      let rollbackResult =
        null;

      if (
        this.options
          .rollbackOnFailure
      ) {
        try {
          rollbackResult =
            await this._rollback(
              context,
            );
        } catch (rollbackError) {
          const normalizedRollback =
            normalizeError(
              rollbackError,
            );

          safeLog(
            logger,
            "error",
            {
              module:
                MODULE_NAME,

              event:
                "bootstrap.rollback.engine_failed",

              error:
                serializeError(
                  normalizedRollback,
                  {
                    includeStack:
                      true,
                  },
                ),

              originalError:
                serializeError(
                  normalized,
                  {
                    includeStack:
                      false,
                  },
                ),
            },
            "TITech bootstrap rollback engine failed.",
          );
        }
      }

      if (
        rollbackResult?.failed >
        0
      ) {
        safeLog(
          logger,
          "error",
          {
            module:
              MODULE_NAME,

            event:
              "bootstrap.startup.rollback_partial_failure",

            rollback:
              rollbackResult,

            originalError:
              serializeError(
                normalized,
                {
                  includeStack:
                    false,
                },
              ),
          },
          "TITech bootstrap startup rollback completed with cleanup failures.",
        );
      }

      throw normalized;
    }
  }

  /* ===========================================================================
   * Rollback
   * ========================================================================= */

  async _rollback(
    context = {},
  ) {
    const logger =
      normalizeLogger(
        context?.logger ||
          this.options.logger,
      );

    const started =
      [
        ...this._startedHooks,
      ].reverse();

    const rollbackErrors =
      [];

    for (
      const hook of started
    ) {
      if (
        !hook.rollback ||
        typeof hook.stop !==
          "function"
      ) {
        continue;
      }

      try {
        await this._executeHook(
          hook,
          {
            phase:
              HOOK_PHASES.SHUTDOWN,

            context: {
              ...(
                isObjectLike(
                  context,
                )
                  ? context
                  : {}
              ),

              lifecycle: {
                ...(
                  context
                    ?.lifecycle ||
                  {}
                ),

                rollback:
                  true,
              },
            },

            signal:
              context?.signal ||
              null,

            logger,
          },
        );
      } catch (error) {
        const normalized =
          normalizeError(
            error,
          );

        rollbackErrors.push(
          normalized,
        );

        safeLog(
          logger,
          "error",
          {
            module:
              MODULE_NAME,

            hook:
              hook.name,

            hookId:
              hook.id,

            phase:
              HOOK_PHASES.SHUTDOWN,

            event:
              "bootstrap.rollback.failed",

            error:
              serializeError(
                normalized,
                {
                  includeStack:
                    true,
                },
              ),
          },
          `TITech bootstrap rollback failed: ${hook.name}`,
        );
      }
    }

    this._startedHooks =
      [];

    this._started =
      false;

    return Object.freeze({
      attempted:
        started.length,

      failed:
        rollbackErrors.length,

      errors:
        Object.freeze(
          rollbackErrors,
        ),
    });
  }

  /* ===========================================================================
   * Shutdown
   * ========================================================================= */

  async shutdown(
    context = {},
  ) {
    if (
      this._shutdownPromise
    ) {
      return this._shutdownPromise;
    }

    if (
      this._stopped &&
      this._state ===
        LIFECYCLE_STATES.STOPPED
    ) {
      return this;
    }

    this._shutdownPromise =
      this._shutdownInternal(
        context,
      );

    try {
      return await this
        ._shutdownPromise;
    } finally {
      this._shutdownPromise =
        null;
    }
  }

  async _shutdownInternal(
    context,
  ) {
    if (
      this._shutdownStarted
    ) {
      return this;
    }

    this._shutdownStarted =
      true;

    const logger =
      normalizeLogger(
        context?.logger ||
          this.options.logger,
      );

    this._setState(
      LIFECYCLE_STATES.STOPPING,
      {
        reason:
          context?.reason ||
          null,
      },
    );

    safeLog(
      logger,
      "info",
      {
        module:
          MODULE_NAME,

        event:
          "bootstrap.lifecycle.stopping",

        reason:
          context?.reason ||
          null,
      },
      "TITech bootstrap lifecycle stopping.",
    );

    const errors =
      [];

    const activeNames =
      new Set(
        this._startedHooks.map(
          hook =>
            hook.name,
        ),
      );

    /**
     * Only execute shutdown handlers for:
     *
     *   1. hooks that actually started;
     *   2. explicitly registered shutdown-only hooks.
     *
     * This avoids accidentally stopping services that never started.
     */
    const registered =
      this.list({
        includeDisabled:
          false,
      }).filter(
        hook =>
          typeof hook.stop ===
          "function" &&
          (
            activeNames.has(
              hook.name,
            ) ||
            hook.phase ===
              HOOK_PHASES.SHUTDOWN
          ),
      );

    let ordered;

    try {
      ordered =
        this._resolveShutdownOrder(
          registered,
          context,
        );
    } catch (error) {
      const normalized =
        normalizeError(
          error,
        );

      this._shutdownError =
        normalized;

      this._setState(
        LIFECYCLE_STATES.FAILED,
        {
          reason:
            "shutdown-order-resolution-failed",
        },
      );

      this._shutdownStarted =
        false;

      throw normalized;
    }

    safeLog(
      logger,
      "debug",
      {
        module:
          MODULE_NAME,

        event:
          "bootstrap.shutdown.order_resolved",

        order:
          ordered.map(
            hook =>
              hook.name,
          ),
      },
      "TITech shutdown order resolved.",
    );

    for (
      const hook of ordered
    ) {
      try {
        await this._executeHook(
          hook,
          {
            phase:
              HOOK_PHASES.SHUTDOWN,

            context,

            signal:
              context?.signal ||
              null,

            logger,
          },
        );
      } catch (error) {
        const normalized =
          normalizeError(
            error,
          );

        errors.push(
          normalized,
        );

        safeLog(
          logger,
          "error",
          {
            module:
              MODULE_NAME,

            hook:
              hook.name,

            hookId:
              hook.id,

            phase:
              HOOK_PHASES.SHUTDOWN,

            event:
              "bootstrap.shutdown.hook_failed",

            critical:
              hook.critical,

            fatal:
              hook.fatal,

            error:
              serializeError(
                normalized,
                {
                  includeStack:
                    true,
                },
              ),
          },
          `TITech shutdown hook failed: ${hook.name}`,
        );
      }
    }

    this._startedHooks =
      [];

    this._started =
      false;

    this._stopped =
      true;

    this._stoppedAt =
      new Date();

    if (
      errors.length >
      0
    ) {
      this._shutdownError =
        new BootstrapHookError(
          "One or more TITech shutdown hooks failed.",
          {
            code:
              "BOOTSTRAP_SHUTDOWN_PARTIAL_FAILURE",

            phase:
              HOOK_PHASES.SHUTDOWN,

            details: {
              errorCount:
                errors.length,

              errors:
                errors.map(
                  error =>
                    serializeError(
                      error,
                      {
                        includeStack:
                          false,
                      },
                    ),
                ),
            },
          },
        );

      this._setState(
        LIFECYCLE_STATES.FAILED,
        {
          reason:
            "shutdown-cleanup-errors",
        },
      );

      safeLog(
        logger,
        "error",
        {
          module:
            MODULE_NAME,

          event:
            "bootstrap.lifecycle.shutdown_failed",

          errorCount:
            errors.length,
        },
        "TITech bootstrap lifecycle stopped with cleanup errors.",
      );

      return this;
    }

    this._setState(
      LIFECYCLE_STATES.STOPPED,
      {
        stoppedAt:
          this._stoppedAt,
      },
    );

    safeLog(
      logger,
      "info",
      {
        module:
          MODULE_NAME,

        event:
          "bootstrap.lifecycle.stopped",

        stoppedAt:
          this._stoppedAt,
      },
      "TITech bootstrap lifecycle stopped successfully.",
    );

    return this;
  }

  /* ===========================================================================
   * State
   * ========================================================================= */

  get state() {
    return this._state;
  }

  get initialized() {
    return this._initialized;
  }

  get started() {
    return this._started;
  }

  get stopped() {
    return this._stopped;
  }

  get initializationError() {
    return this._initializationError;
  }

  get startupError() {
    return this._startupError;
  }

  get shutdownError() {
    return this._shutdownError;
  }

  get createdAt() {
    return this._createdAt;
  }

  get initializedAt() {
    return this._initializedAt;
  }

  get startedAt() {
    return this._startedAt;
  }

  get stoppedAt() {
    return this._stoppedAt;
  }

  /* ===========================================================================
   * Diagnostics
   * ========================================================================= */

  snapshot() {
    return Object.freeze({
      module:
        MODULE_NAME,

      state:
        this._state,

      initialized:
        this._initialized,

      started:
        this._started,

      stopped:
        this._stopped,

      shutdownStarted:
        this._shutdownStarted,

      hookCount:
        this._hooks.size,

      startupHookCount:
        this.list({
          phase:
            HOOK_PHASES.STARTUP,

          includeDisabled:
            false,
        }).length,

      shutdownHookCount:
        this.list({
          phase:
            HOOK_PHASES.SHUTDOWN,

          includeDisabled:
            false,
        }).length,

      startedHooks:
        Object.freeze(
          this._startedHooks.map(
            hook =>
              hook.name,
          ),
        ),

      historyCount:
        this._history.length,

      failedHookCount:
        this._history.filter(
          record =>
            record.success ===
            false,
        ).length,

      createdAt:
        this._createdAt,

      initializedAt:
        this._initializedAt,

      startedAt:
        this._startedAt,

      stoppedAt:
        this._stoppedAt,

      initializationFailed:
        Boolean(
          this._initializationError,
        ),

      startupFailed:
        Boolean(
          this._startupError,
        ),

      shutdownFailed:
        Boolean(
          this._shutdownError,
        ),

      lastHistoryEntry:
        this._history.length >
        0
          ? this._history[
              this._history.length -
                1
            ]
          : null,
    });
  }

  history() {
    return Object.freeze([
      ...this._history,
    ]);
  }

  failures() {
    return Object.freeze(
      this._history.filter(
        record =>
          record.success ===
          false,
      ),
    );
  }

  /* ===========================================================================
   * Reset
   * ========================================================================= */

  reset({
    clearHooks =
      true,
  } = {}) {
    if (
      ACTIVE_STATES.has(
        this._state,
      )
    ) {
      throw new BootstrapLifecycleStateError(
        "TITech bootstrap registry cannot be reset while lifecycle execution is active.",
        {
          state:
            this._state,
        },
      );
    }

    if (
      clearHooks
    ) {
      this._hooks.clear();
    }

    this._startedHooks =
      [];

    this._history =
      [];

    this._setState(
      LIFECYCLE_STATES.CREATED,
    );

    this._initialized =
      false;

    this._started =
      false;

    this._stopped =
      false;

    this._shutdownStarted =
      false;

    this._initializePromise =
      null;

    this._startPromise =
      null;

    this._shutdownPromise =
      null;

    this._initializationError =
      null;

    this._startupError =
      null;

    this._shutdownError =
      null;

    this._initializedAt =
      null;

    this._startedAt =
      null;

    this._stoppedAt =
      null;

    return this;
  }
}

/* =============================================================================
 * Optional Metrics Bridge
 * =============================================================================
 *
 * Metrics must remain advisory. This function intentionally supports the
 * observability implementations already used elsewhere in TITech without
 * requiring a specific metrics library here.
 * =============================================================================
 */

function emitHookMetric(
  event,
  hook,
  phase,
  payload = {},
) {
  try {
    const module =
      globalThis.__TITECH_OBSERVABILITY__ ||
      null;

    if (
      module &&
      typeof module.emitEvent ===
        "function"
    ) {
      module.emitEvent(
        `bootstrap.hook.${event}`,
        {
          component:
            "bootstrap/hooks",

          hook:
            hook.name,

          hookId:
            hook.id,

          phase,

          ...payload,
        },
      );
    }
  } catch {
    // Advisory only.
  }
}

/* =============================================================================
 * Default Registry
 * =============================================================================
 */

const hooks =
  new BootstrapHookRegistry();

/* =============================================================================
 * Public Registration API
 * ============================================================================= */

function register(
  options = {},
) {
  return hooks.register(
    options,
  );
}

function registerStartupHook(
  name,
  startHandler,
  options = {},
) {
  return hooks.registerStartupHook(
    name,
    startHandler,
    options,
  );
}

/**
 * Compatibility API.
 *
 * Registration:
 *
 *   startup("database", handler, options)
 *
 * Execution:
 *
 *   await startup(context)
 */
async function startup(
  nameOrContext,
  startHandler,
  options = {},
) {
  const isExecutionCall =
    startHandler ===
      undefined &&
    (
      isObjectLike(
        nameOrContext,
      ) ||
      nameOrContext ===
        undefined ||
      nameOrContext ===
        null
    );

  if (
    isExecutionCall
  ) {
    return hooks.start(
      nameOrContext || {},
    );
  }

  return hooks.startup(
    nameOrContext,
    startHandler,
    options,
  );
}

function registerShutdownHook(
  name,
  stopHandler,
  options = {},
) {
  return hooks.registerShutdownHook(
    name,
    stopHandler,
    options,
  );
}

function shutdownHook(
  name,
  stopHandler,
  options = {},
) {
  return hooks.registerShutdownHook(
    name,
    stopHandler,
    options,
  );
}

function lifecycle(
  name,
  handlers = {},
) {
  return hooks.lifecycle(
    name,
    handlers,
  );
}

/* =============================================================================
 * Explicit Orchestration Aliases
 * ============================================================================= */

async function runStartup(
  context = {},
) {
  return hooks.start(
    context,
  );
}

async function runShutdown(
  context = {},
) {
  return hooks.shutdown(
    context,
  );
}

/* =============================================================================
 * Public Lifecycle API
 * ============================================================================= */

async function initialize(
  context = {},
) {
  return hooks.initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return hooks.start(
    context,
  );
}

async function shutdown(
  context = {},
) {
  return hooks.shutdown(
    context,
  );
}

/* =============================================================================
 * Lookup / Diagnostics
 * ============================================================================= */

function get(
  name,
) {
  return hooks.get(
    name,
  );
}

function has(
  name,
) {
  return hooks.has(
    name,
  );
}

function list(
  options = {},
) {
  return hooks.list(
    options,
  );
}

function snapshot() {
  return hooks.snapshot();
}

function history() {
  return hooks.history();
}

function failures() {
  return hooks.failures();
}

function getState() {
  return hooks.state;
}

function getLifecycleState() {
  return hooks.state;
}

/* =============================================================================
 * Signal Management
 * =============================================================================
 *
 * Importing hooks.js NEVER installs process listeners.
 * =============================================================================
 */

let signalHandlersInstalled =
  false;

let signalHandlerReferences =
  [];

function installSignalHandlers({
  signals = [
    "SIGTERM",
    "SIGINT",
  ],

  context = {},

  exit = false,

  onShutdown = null,

  logger = null,
} = {}) {
  if (
    signalHandlersInstalled
  ) {
    return false;
  }

  if (
    !Array.isArray(
      signals,
    ) ||
    signals.length ===
      0
  ) {
    throw new TypeError(
      "TITech bootstrap signal list must be a non-empty array.",
    );
  }

  const uniqueSignals =
    [
      ...new Set(
        signals
          .map(
            signal =>
              String(
                signal,
              ).trim(),
          )
          .filter(
            Boolean,
          ),
      ),
    ];

  if (
    uniqueSignals.length ===
    0
  ) {
    throw new TypeError(
      "TITech bootstrap signal list must contain at least one valid signal.",
    );
  }

  signalHandlersInstalled =
    true;

  let shuttingDown =
    false;

  const handler =
    async signal => {
      if (
        shuttingDown
      ) {
        return;
      }

      shuttingDown =
        true;

      const shutdownContext =
        {
          ...(
            isObjectLike(
              context,
            )
              ? context
              : {}
          ),

          signal,

          reason:
            "process-signal",

          logger:
            context?.logger ||
            logger ||
            null,
        };

      safeLog(
        logger ||
          context?.logger ||
          null,
        "info",
        {
          module:
            MODULE_NAME,

          event:
            "bootstrap.signal.received",

          signal,
        },
        `TITech bootstrap received ${signal}.`,
      );

      try {
        await safeCallback(
          onShutdown,
          {
            signal,

            context:
              shutdownContext,
          },
        );

        await hooks.shutdown(
          shutdownContext,
        );

        if (
          exit
        ) {
          /**
           * The database/bootstrap modules never terminate the process.
           * The composition root owns process termination.
           */
          process.exitCode =
            0;
        }
      } catch (error) {
        process.exitCode =
          1;

        safeLog(
          logger ||
            context?.logger ||
            null,
          "error",
          {
            module:
              MODULE_NAME,

            event:
              "bootstrap.signal_shutdown_failed",

            signal,

            error:
              serializeError(
                error,
                {
                  includeStack:
                    true,
                },
              ),
          },
          `TITech graceful shutdown failed after ${signal}.`,
        );
      } finally {
        shuttingDown =
          false;
      }
    };

  for (
    const signal of
      uniqueSignals
  ) {
    process.once(
      signal,
      handler,
    );

    signalHandlerReferences.push(
      {
        signal,
        handler,
      },
    );
  }

  return true;
}

function uninstallSignalHandlers() {
  for (
    const {
      signal,
      handler,
    } of signalHandlerReferences
  ) {
    process.removeListener(
      signal,
      handler,
    );
  }

  signalHandlerReferences =
    [];

  signalHandlersInstalled =
    false;

  return true;
}

/* =============================================================================
 * Process Error Management
 * =============================================================================
 */

let processErrorHandlersInstalled =
  false;

let processErrorHandlerReferences =
  [];

function installProcessErrorHandlers({
  onUncaughtException =
    null,

  onUnhandledRejection =
    null,

  shutdownOnError =
    true,

  logger =
    null,
} = {}) {
  if (
    processErrorHandlersInstalled
  ) {
    return false;
  }

  processErrorHandlersInstalled =
    true;

  const handleUncaughtException =
    error => {
      void (async () => {
        const normalized =
          normalizeError(
            error,
          );

        safeLog(
          logger,
          "error",
          {
            module:
              MODULE_NAME,

            event:
              "process.uncaught_exception",

            error:
              serializeError(
                normalized,
                {
                  includeStack:
                    true,
                },
              ),
          },
          "TITech process uncaught exception received.",
        );

        try {
          await safeCallback(
            onUncaughtException,
            normalized,
          );

          if (
            shutdownOnError
          ) {
            await hooks.shutdown({
              reason:
                "uncaughtException",

              error:
                normalized,

              logger:
                logger ||
                null,
            });
          }
        } catch (
          shutdownError
        ) {
          safeLog(
            logger,
            "error",
            {
              module:
                MODULE_NAME,

              event:
                "bootstrap.uncaught_exception_shutdown_failed",

              error:
                serializeError(
                  shutdownError,
                  {
                    includeStack:
                      true,
                  },
                ),

              originalError:
                serializeError(
                  normalized,
                  {
                    includeStack:
                      false,
                  },
                ),
            },
            "TITech shutdown after uncaught exception failed.",
          );
        } finally {
          process.exitCode =
            1;
        }
      })();
    };

  const handleUnhandledRejection =
    reason => {
      void (async () => {
        const error =
          normalizeError(
            reason,
          );

        safeLog(
          logger,
          "error",
          {
            module:
              MODULE_NAME,

            event:
              "process.unhandled_rejection",

            error:
              serializeError(
                error,
                {
                  includeStack:
                    true,
                },
              ),
          },
          "TITech process unhandled rejection received.",
        );

        try {
          await safeCallback(
            onUnhandledRejection,
            error,
          );

          if (
            shutdownOnError
          ) {
            await hooks.shutdown({
              reason:
                "unhandledRejection",

              error,

              logger:
                logger ||
                null,
            });
          }
        } catch (
          shutdownError
        ) {
          safeLog(
            logger,
            "error",
            {
              module:
                MODULE_NAME,

              event:
                "bootstrap.unhandled_rejection_shutdown_failed",

              error:
                serializeError(
                  shutdownError,
                  {
                    includeStack:
                      true,
                  },
                ),

              originalError:
                serializeError(
                  error,
                  {
                    includeStack:
                      false,
                  },
                ),
            },
            "TITech shutdown after unhandled rejection failed.",
          );
        } finally {
          process.exitCode =
            1;
        }
      })();
    };

  process.on(
    "uncaughtException",
    handleUncaughtException,
  );

  process.on(
    "unhandledRejection",
    handleUnhandledRejection,
  );

  processErrorHandlerReferences.push(
    {
      event:
        "uncaughtException",

      handler:
        handleUncaughtException,
    },

    {
      event:
        "unhandledRejection",

      handler:
        handleUnhandledRejection,
    },
  );

  return true;
}

function uninstallProcessErrorHandlers() {
  for (
    const {
      event,
      handler,
    } of processErrorHandlerReferences
  ) {
    process.removeListener(
      event,
      handler,
    );
  }

  processErrorHandlerReferences =
    [];

  processErrorHandlersInstalled =
    false;

  return true;
}

/* =============================================================================
 * Test Utilities
 * ============================================================================= */

function resetForTests(
  options = {},
) {
  uninstallSignalHandlers();

  uninstallProcessErrorHandlers();

  return hooks.reset(
    options,
  );
}

/* =============================================================================
 * Public Export Contract
 * =============================================================================
 */

const publicApi =
  {
    /* Errors */
    BootstrapHookError,

    BootstrapHookTimeoutError,

    BootstrapDependencyError,

    BootstrapLifecycleStateError,

    /* Registry */
    BootstrapHookRegistry,

    hooks,

    /* Constants */
    HOOK_PHASES,

    LIFECYCLE_STATES,

    /* Registration */
    register,

    startup,

    registerStartupHook,

    registerShutdownHook,

    shutdownHook,

    lifecycle,

    /* Explicit lifecycle */
    initialize,

    start,

    runStartup,

    shutdown,

    runShutdown,

    /* Lookup / diagnostics */
    get,

    has,

    list,

    snapshot,

    history,

    failures,

    getState,

    getLifecycleState,

    /* Process lifecycle */
    installSignalHandlers,

    uninstallSignalHandlers,

    installProcessErrorHandlers,

    uninstallProcessErrorHandlers,

    /* Test support */
    resetForTests,
  };

module.exports =
  Object.freeze(
    publicApi,
  );

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
      "register",

      "startup",

      "registerStartupHook",

      "registerShutdownHook",

      "shutdownHook",

      "lifecycle",

      "initialize",

      "start",

      "runStartup",

      "shutdown",

      "runShutdown",

      "BootstrapHookRegistry",
    ];

  for (
    const exportName of
      requiredExports
  ) {
    if (
      typeof module.exports[
        exportName
      ] ===
      "undefined"
    ) {
      throw new Error(
        `TITech bootstrap hook export contract is invalid: "${exportName}" is missing.`,
      );
    }
  }
}