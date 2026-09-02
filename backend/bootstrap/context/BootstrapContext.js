"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Canonical Bootstrap Lifecycle Context
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/context/BootstrapContext.js
 *
 * Purpose:
 *   Canonical lifecycle, dependency, phase, diagnostics and shutdown context
 *   shared by every TITech Community Capital application bootstrap phase.
 *
 * Design authority:
 *   BootstrapContext is the SINGLE authoritative lifecycle state machine.
 *
 * Compatibility/read-model:
 *   runtime/state.js may consume this context, but MUST NOT become the
 *   canonical lifecycle authority.
 *
 * Canonical lifecycle:
 *
 *   created
 *      ↓
 *   starting
 *      ↓
 *   ready
 *      ↓
 *   shutting_down
 *      ↓
 *   stopped
 *
 * Failure lifecycle:
 *
 *   created
 *      ↓
 *   starting
 *      ↓
 *   failed
 *      ↓
 *   shutting_down
 *      ↓
 *   stopped
 *
 * Critical invariant:
 *
 *   context.state === primitive lifecycle string
 *   context.getState() === same primitive lifecycle string
 *
 * Public code MUST NOT be able to replace:
 *
 *   context.state
 *
 * with:
 *
 *   runtime/state.js
 *   {}
 *   another context
 *   another object
 *   another lifecycle model
 *
 * =============================================================================
 *
 * Enterprise guarantees
 * =============================================================================
 *
 * ✓ One canonical lifecycle authority
 * ✓ Primitive lifecycle state
 * ✓ Read-only public lifecycle state
 * ✓ Validated state-machine transitions
 * ✓ Failed startup can safely enter shutdown
 * ✓ FAILED contexts cannot restart
 * ✓ STOPPED contexts cannot restart
 * ✓ Strict canonical bootstrap phase ordering
 * ✓ One context instance shared across phases
 * ✓ Dependency registration
 * ✓ Dependency validation
 * ✓ Container registration
 * ✓ Bounded lifecycle history
 * ✓ Metadata sanitization
 * ✓ Credential/secret redaction
 * ✓ Error normalization
 * ✓ AbortController support
 * ✓ Deterministic shutdown
 * ✓ Priority-ordered shutdown hooks
 * ✓ Timeout-bounded shutdown hooks
 * ✓ Idempotent shutdown execution
 * ✓ Shutdown hook inspection
 * ✓ Runtime readiness validation
 * ✓ Production-safe diagnostics
 * ✓ Defensive serialization
 * ✓ CommonJS compatibility
 * ✓ Node.js 20+ compatible
 *
 * =============================================================================
 */

const BOOTSTRAP_PHASES = Object.freeze([
  "environment",
  "configuration",
  "logger",
  "observability",
  "readiness",
  "resilience",
  "infrastructure",
  "services",
  "middleware",
  "routes",
  "httpServer",
  "runtimeReady",
]);

const PHASE_STATES = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const CONTEXT_STATES = Object.freeze({
  CREATED: "created",
  STARTING: "starting",

  /**
   * Backward-compatible alias.
   *
   * Value intentionally remains "starting".
   */
  BOOTSTRAPPING: "starting",

  READY: "ready",
  FAILED: "failed",
  SHUTTING_DOWN: "shutting_down",
  STOPPED: "stopped",
});

const LIFECYCLE_TRANSITIONS = Object.freeze({
  [CONTEXT_STATES.CREATED]: Object.freeze([
    CONTEXT_STATES.STARTING,
    CONTEXT_STATES.FAILED,
  ]),

  [CONTEXT_STATES.STARTING]: Object.freeze([
    CONTEXT_STATES.READY,
    CONTEXT_STATES.FAILED,
    CONTEXT_STATES.SHUTTING_DOWN,
  ]),

  [CONTEXT_STATES.READY]: Object.freeze([
    CONTEXT_STATES.FAILED,
    CONTEXT_STATES.SHUTTING_DOWN,
  ]),

  [CONTEXT_STATES.FAILED]: Object.freeze([
    CONTEXT_STATES.SHUTTING_DOWN,
  ]),

  [CONTEXT_STATES.SHUTTING_DOWN]: Object.freeze([
    CONTEXT_STATES.STOPPED,
  ]),

  [CONTEXT_STATES.STOPPED]: Object.freeze([]),
});

const DEFAULT_HISTORY_LIMIT = 500;
const DEFAULT_HISTORY_READ_LIMIT = 100;
const DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS = 10_000;

const MAX_ID_LENGTH = 200;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 100;
const MAX_EVENT_TYPE_LENGTH = 200;
const MAX_PHASE_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const MAX_DEPENDENCY_NAME_LENGTH = 200;
const MAX_ERROR_NAME_LENGTH = 100;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ERROR_CODE_LENGTH = 100;
const MAX_HOOK_NAME_LENGTH = 200;

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|credential|private[_-]?key|api[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret|session[_-]?token|jwt|signature|encrypted|encryption[_-]?key|database[_-]?url|connection[_-]?string|mongo[_-]?uri|redis[_-]?url|dsn|passphrase)/i;


/* =============================================================================
 * INTERNAL HELPERS
 * =============================================================================
 */

function now() {
  return new Date();
}

function createContextId() {
  return [
    "titech-bootstrap",
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

function isPlainObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function createPhaseRecord() {
  return {
    state: PHASE_STATES.PENDING,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    error: null,
    metadata: {},
  };
}

function createPhaseRegistry() {
  return BOOTSTRAP_PHASES.reduce(
    (registry, phase) => {
      registry[phase] = createPhaseRecord();
      return registry;
    },
    {},
  );
}

function sanitizeString(value, maxLength = 1_000) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).slice(0, maxLength);
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key));
}

function sanitizeMetadataValue(value, depth = 0) {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : String(value);
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "[InvalidDate]"
      : value.toISOString();
  }

  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "undefined") {
    return "[Undefined]";
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_KEYS)
      .map((item) =>
        sanitizeMetadataValue(
          item,
          depth + 1,
        ),
      );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const result = {};

    let entries;

    try {
      entries = Object.entries(value).slice(
        0,
        MAX_METADATA_KEYS,
      );
    } catch {
      return "[UnserializableObject]";
    }

    for (const [key, childValue] of entries) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]";
        continue;
      }

      result[key] = sanitizeMetadataValue(
        childValue,
        depth + 1,
      );
    }

    return result;
  }

  return sanitizeString(value);
}

function cloneMetadata(metadata = {}) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return {};
  }

  const sanitized = sanitizeMetadataValue(
    metadata,
  );

  if (
    !sanitized ||
    typeof sanitized !== "object" ||
    Array.isArray(sanitized)
  ) {
    return {};
  }

  return sanitized;
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      name: sanitizeString(
        error.name,
        MAX_ERROR_NAME_LENGTH,
      ),

      message: sanitizeString(
        error.message,
        MAX_ERROR_MESSAGE_LENGTH,
      ),

      code: sanitizeString(
        error.code,
        MAX_ERROR_CODE_LENGTH,
      ),
    };
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    return {
      name: sanitizeString(
        error.name || "Error",
        MAX_ERROR_NAME_LENGTH,
      ),

      message: sanitizeString(
        error.message || "[ObjectError]",
        MAX_ERROR_MESSAGE_LENGTH,
      ),

      code: sanitizeString(
        error.code,
        MAX_ERROR_CODE_LENGTH,
      ),
    };
  }

  return {
    name: "Error",
    message: sanitizeString(
      error,
      MAX_ERROR_MESSAGE_LENGTH,
    ),
    code: null,
  };
}

function assertValidPhase(phase) {
  if (!BOOTSTRAP_PHASES.includes(phase)) {
    throw new Error(
      `Unknown TITech bootstrap phase "${phase}". ` +
        `Expected one of: ${BOOTSTRAP_PHASES.join(", ")}`,
    );
  }
}

function assertValidContextState(state) {
  if (
    !Object.values(CONTEXT_STATES).includes(
      state,
    )
  ) {
    throw new Error(
      `Unknown TITech bootstrap context state "${state}".`,
    );
  }
}

function getPhaseIndex(phase) {
  return BOOTSTRAP_PHASES.indexOf(phase);
}

function normalizeContextState(value) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new TypeError(
      "TITech bootstrap context state must be a non-empty lifecycle string.",
    );
  }

  return value.trim();
}

function normalizePositiveInteger(
  value,
  fallback,
) {
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function createAbortController() {
  if (
    typeof AbortController === "function"
  ) {
    return new AbortController();
  }

  return {
    signal: {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {},
    },

    abort(reason) {
      this.signal.aborted = true;
      this.signal.reason = reason;
    },
  };
}

function freezeShallow(value) {
  if (
    value &&
    typeof value === "object"
  ) {
    return Object.freeze(value);
  }

  return value;
}


/* =============================================================================
 * BOOTSTRAP CONTEXT
 * =============================================================================
 */

class BootstrapContext {
  constructor(options = {}) {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new TypeError(
        "TITech BootstrapContext constructor expects an options object.",
      );
    }

    /* -------------------------------------------------------------------------
     * Identity
     * ----------------------------------------------------------------------- */

    this.id =
      sanitizeString(
        options.id,
        MAX_ID_LENGTH,
      ) || createContextId();

    this.createdAt = now();

    this.historyLimit =
      normalizePositiveInteger(
        options.historyLimit,
        DEFAULT_HISTORY_LIMIT,
      );

    /* -------------------------------------------------------------------------
     * Canonical lifecycle state
     * ----------------------------------------------------------------------- */

    this._state =
      CONTEXT_STATES.CREATED;

    Object.defineProperty(
      this,
      "state",
      {
        enumerable: true,
        configurable: false,

        get: () => this._state,

        set: (nextState) => {
          const state =
            normalizeContextState(
              nextState,
            );

          throw new TypeError(
            `TITech BootstrapContext.state is read-only. ` +
              `Use an approved lifecycle transition instead; attempted value "${state}".`,
          );
        },
      },
    );

    /* -------------------------------------------------------------------------
     * Lifecycle timestamps
     * ----------------------------------------------------------------------- */

    this.startedAt = null;
    this.readyAt = null;
    this.failedAt = null;
    this.shutdownAt = null;
    this.stoppedAt = null;

    /* -------------------------------------------------------------------------
     * Runtime metadata
     * ----------------------------------------------------------------------- */

    const suppliedMetadata =
      cloneMetadata(
        options.metadata,
      );

    this.metadata = {
      application:
        suppliedMetadata.application ||
        "TITech Community Capital",

      component:
        suppliedMetadata.component ||
        "bootstrap",

      version:
        suppliedMetadata.version || null,

      nodeVersion:
        process.version,

      nodeMajor:
        Number(
          process.versions.node.split(".")[0],
        ),

      platform:
        process.platform,

      architecture:
        process.arch,

      pid:
        process.pid,

      environment:
        suppliedMetadata.environment ||
        process.env.NODE_ENV ||
        "development",

      ...suppliedMetadata,
    };

    /* -------------------------------------------------------------------------
     * Canonical dependencies
     * ----------------------------------------------------------------------- */

    this.environment =
      options.environment || null;

    this.configuration =
      options.configuration || null;

    this.logger =
      options.logger || null;

    this.observability =
      options.observability || null;

    this.readiness =
      options.readiness || null;

    this.resilience =
      options.resilience || null;

    this.infrastructure =
      options.infrastructure || null;

    this.services =
      options.services || null;

    this.middleware =
      options.middleware || null;

    this.routes =
      options.routes || null;

    this.httpServer =
      options.httpServer ||
      options.server ||
      null;

    this.server =
      this.httpServer;

    this.application =
      options.application || null;

    /* -------------------------------------------------------------------------
     * Dependency container
     * ----------------------------------------------------------------------- */

    this.container =
      isPlainObject(options.container)
        ? options.container
        : {};

    /* -------------------------------------------------------------------------
     * Runtime state
     * ----------------------------------------------------------------------- */

    this.runtime = {
      ready: false,
      acceptingTraffic: false,
      shuttingDown: false,
      shutdownComplete: false,
      degraded: false,
      startupDurationMs: null,
      shutdownDurationMs: null,
    };

    if (isPlainObject(options.runtime)) {
      for (const [
        key,
        value,
      ] of Object.entries(options.runtime)) {
        if (key === "state") {
          continue;
        }

        this.runtime[key] =
          sanitizeMetadataValue(value);
      }
    }

    /* -------------------------------------------------------------------------
     * Error state
     * ----------------------------------------------------------------------- */

    this.error = null;

    /* -------------------------------------------------------------------------
     * Phase registry
     * ----------------------------------------------------------------------- */

    this.phases =
      createPhaseRegistry();

    /* -------------------------------------------------------------------------
     * Diagnostics history
     * ----------------------------------------------------------------------- */

    this.history = [];

    /* -------------------------------------------------------------------------
     * Shutdown orchestration
     * ----------------------------------------------------------------------- */

    this.shutdownHooks = [];

    this.shutdownExecutionPromise = null;

    /* -------------------------------------------------------------------------
     * Abort controller
     * ----------------------------------------------------------------------- */

    this.abortController =
      createAbortController();

    this.signal =
      this.abortController.signal;

    /* -------------------------------------------------------------------------
     * Defensive identity marker
     * ----------------------------------------------------------------------- */

    Object.defineProperty(
      this,
      "isTITechBootstrapContext",
      {
        enumerable: false,
        configurable: false,
        writable: false,
        value: true,
      },
    );
  }

  /* ===========================================================================
   * CANONICAL STATE API
   * ===========================================================================
   */

  getState() {
    return this._state;
  }

  isValidTransition(
    nextState,
  ) {
    const normalized =
      normalizeContextState(
        nextState,
      );

    assertValidContextState(
      normalized,
    );

    return (
      this.getAllowedNextStates().includes(
        normalized,
      )
    );
  }

  _setState(
    state,
    options = {},
  ) {
    const normalizedState =
      normalizeContextState(
        state,
      );

    assertValidContextState(
      normalizedState,
    );

    const currentState =
      this.getState();

    if (
      currentState ===
      normalizedState
    ) {
      return this;
    }

    const allowedTransitions =
      LIFECYCLE_TRANSITIONS[
        currentState
      ] || [];

    if (
      !allowedTransitions.includes(
        normalizedState,
      )
    ) {
      throw new Error(
        `Invalid TITech bootstrap lifecycle transition: "${currentState}" → "${normalizedState}".`,
      );
    }

    this._state =
      normalizedState;

    if (options.record !== false) {
      this.recordEvent(
        "lifecycle_state_changed",
        {
          previousState:
            currentState,

          state:
            normalizedState,
        },
      );
    }

    return this;
  }

  isStarting() {
    return (
      this.getState() ===
      CONTEXT_STATES.STARTING
    );
  }

  isReady() {
    return (
      this.getState() ===
        CONTEXT_STATES.READY &&
      this.runtime.ready === true &&
      this.runtime.acceptingTraffic ===
        true &&
      this.runtime.shuttingDown ===
        false
    );
  }

  isShuttingDown() {
    return (
      this.getState() ===
        CONTEXT_STATES.SHUTTING_DOWN ||
      this.runtime.shuttingDown === true
    );
  }

  isFailed() {
    return (
      this.getState() ===
      CONTEXT_STATES.FAILED
    );
  }

  isStopped() {
    return (
      this.getState() ===
      CONTEXT_STATES.STOPPED
    );
  }

  isTerminal() {
    return (
      this.isFailed() ||
      this.isStopped()
    );
  }

  getAllowedNextStates() {
    return [
      ...(
        LIFECYCLE_TRANSITIONS[
          this.getState()
        ] || []
      ),
    ];
  }

  /* ===========================================================================
   * LIFECYCLE
   * ===========================================================================
   */

  start() {
    if (
      this.getState() !==
      CONTEXT_STATES.CREATED
    ) {
      throw new Error(
        `Cannot start TITech bootstrap context from state "${this.getState()}". ` +
          "Create a new BootstrapContext for another bootstrap attempt.",
      );
    }

    this._setState(
      CONTEXT_STATES.STARTING,
    );

    this.startedAt = now();

    this.readyAt = null;
    this.failedAt = null;
    this.shutdownAt = null;
    this.stoppedAt = null;

    this.error = null;

    this.runtime.ready = false;
    this.runtime.acceptingTraffic = false;
    this.runtime.shuttingDown = false;
    this.runtime.shutdownComplete = false;
    this.runtime.degraded = false;
    this.runtime.startupDurationMs = null;
    this.runtime.shutdownDurationMs = null;

    if (this.signal.aborted) {
      this.abortController =
        createAbortController();

      this.signal =
        this.abortController.signal;
    }

    this.recordEvent(
      "bootstrap_started",
      {
        state:
          this.getState(),
      },
    );

    return this;
  }

  markReady() {
    if (
      this.getState() !==
      CONTEXT_STATES.STARTING
    ) {
      throw new Error(
        `Cannot mark TITech runtime ready from state "${this.getState()}".`,
      );
    }

    /**
     * runtimeReady is a bootstrap phase, not a dependency.
     *
     * It must already have been completed by the composition root before the
     * context can become READY.
     */
    this.validateRuntimeReady();

    this._setState(
      CONTEXT_STATES.READY,
    );

    this.readyAt = now();

    this.runtime.ready = true;
    this.runtime.acceptingTraffic = true;
    this.runtime.shuttingDown = false;
    this.runtime.shutdownComplete = false;
    this.runtime.degraded = false;

    this.runtime.startupDurationMs =
      this.startedAt
        ? Math.max(
            0,
            this.readyAt.getTime() -
              this.startedAt.getTime(),
          )
        : null;

    this.recordEvent(
      "runtime_ready",
      {
        startupDurationMs:
          this.runtime.startupDurationMs,

        state:
          this.getState(),
      },
    );

    return this;
  }

  markFailed(
    error,
    phase = null,
  ) {
    const currentState =
      this.getState();

    if (
      currentState ===
      CONTEXT_STATES.STOPPED
    ) {
      throw new Error(
        "Cannot fail a stopped TITech bootstrap context.",
      );
    }

    if (
      currentState ===
      CONTEXT_STATES.SHUTTING_DOWN
    ) {
      throw new Error(
        "Cannot transition a TITech bootstrap context to failed after shutdown has begun.",
      );
    }

    if (
      currentState ===
      CONTEXT_STATES.FAILED
    ) {
      return this;
    }

    const normalizedError =
      normalizeError(error);

    this._setState(
      CONTEXT_STATES.FAILED,
    );

    this.failedAt = now();

    this.error =
      normalizedError;

    this.runtime.ready = false;
    this.runtime.acceptingTraffic = false;
    this.runtime.shuttingDown = false;
    this.runtime.degraded = true;

    this.recordEvent(
      "bootstrap_failed",
      {
        phase:
          phase
            ? sanitizeString(
                phase,
                MAX_PHASE_NAME_LENGTH,
              )
            : null,

        error:
          normalizedError,

        state:
          this.getState(),
      },
    );

    return this;
  }

  /**
   * Compatibility alias.
   */
  fail(error, phase = null) {
    return this.markFailed(
      error,
      phase,
    );
  }

  beginShutdown(
    reason = "shutdown_requested",
  ) {
    const currentState =
      this.getState();

    if (
      currentState ===
      CONTEXT_STATES.STOPPED
    ) {
      return this;
    }

    if (
      currentState ===
      CONTEXT_STATES.SHUTTING_DOWN
    ) {
      return this;
    }

    if (
      currentState !==
        CONTEXT_STATES.STARTING &&
      currentState !==
        CONTEXT_STATES.READY &&
      currentState !==
        CONTEXT_STATES.FAILED
    ) {
      throw new Error(
        `Cannot begin TITech shutdown from state "${currentState}".`,
      );
    }

    this._setState(
      CONTEXT_STATES.SHUTTING_DOWN,
    );

    this.shutdownAt = now();

    this.runtime.ready = false;
    this.runtime.acceptingTraffic = false;
    this.runtime.shuttingDown = true;
    this.runtime.shutdownComplete = false;

    this.recordEvent(
      "shutdown_started",
      {
        reason:
          sanitizeString(
            reason,
            MAX_REASON_LENGTH,
          ),

        previousFailure:
          currentState ===
          CONTEXT_STATES.FAILED,

        state:
          this.getState(),
      },
    );

    return this;
  }

  /**
   * Compatibility alias.
   */
  shutdown(reason = "shutdown_requested") {
    return this.beginShutdown(reason);
  }

  beginShutdownAfterFailure(
    reason = "startup_failure",
  ) {
    return this.beginShutdown(
      reason,
    );
  }

  markStopped() {
    if (
      this.getState() ===
      CONTEXT_STATES.STOPPED
    ) {
      return this;
    }

    if (
      this.getState() !==
      CONTEXT_STATES.SHUTTING_DOWN
    ) {
      throw new Error(
        `Cannot mark TITech context stopped from state "${this.getState()}".`,
      );
    }

    this._setState(
      CONTEXT_STATES.STOPPED,
    );

    this.stoppedAt = now();

    this.runtime.ready = false;
    this.runtime.acceptingTraffic = false;
    this.runtime.shuttingDown = false;
    this.runtime.shutdownComplete = true;

    this.runtime.shutdownDurationMs =
      this.shutdownAt
        ? Math.max(
            0,
            this.stoppedAt.getTime() -
              this.shutdownAt.getTime(),
          )
        : null;

    this.runtime.degraded =
      this.shutdownHooks.some(
        (hook) =>
          hook.status === "failed",
      );

    this.recordEvent(
      "shutdown_completed",
      {
        shutdownDurationMs:
          this.runtime.shutdownDurationMs,

        degraded:
          this.runtime.degraded,

        state:
          this.getState(),
      },
    );

    return this;
  }

  /* ===========================================================================
   * PHASE MANAGEMENT
   * ===========================================================================
   */

  getNextPhase() {
    for (const phase of BOOTSTRAP_PHASES) {
      const state =
        this.phases[phase].state;

      if (
        state ===
        PHASE_STATES.PENDING
      ) {
        return phase;
      }

      if (
        state ===
        PHASE_STATES.RUNNING
      ) {
        return phase;
      }
    }

    return null;
  }

  assertNextPhase(phase) {
    assertValidPhase(phase);

    const nextPhase =
      this.getNextPhase();

    if (nextPhase !== phase) {
      throw new Error(
        `TITech bootstrap phase "${phase}" is not the next canonical phase. ` +
          `Expected "${nextPhase}".`,
      );
    }

    return true;
  }

  startPhase(
    phase,
    metadata = {},
  ) {
    assertValidPhase(phase);

    if (
      this.getState() !==
      CONTEXT_STATES.STARTING
    ) {
      throw new Error(
        `Cannot start TITech bootstrap phase "${phase}" while context is "${this.getState()}".`,
      );
    }

    this.assertNextPhase(phase);

    const record =
      this.phases[phase];

    if (
      record.state ===
      PHASE_STATES.RUNNING
    ) {
      throw new Error(
        `TITech bootstrap phase "${phase}" is already running.`,
      );
    }

    if (
      record.state ===
        PHASE_STATES.COMPLETED ||
      record.state ===
        PHASE_STATES.FAILED ||
      record.state ===
        PHASE_STATES.SKIPPED
    ) {
      throw new Error(
        `TITech bootstrap phase "${phase}" has already reached state "${record.state}".`,
      );
    }

    const timestamp = now();

    record.state =
      PHASE_STATES.RUNNING;

    record.startedAt =
      timestamp;

    record.completedAt =
      null;

    record.durationMs =
      null;

    record.error =
      null;

    record.metadata =
      cloneMetadata(metadata);

    this.recordEvent(
      "phase_started",
      {
        phase,

        metadata:
          cloneMetadata(metadata),
      },
    );

    return record;
  }

  completePhase(
    phase,
    metadata = {},
  ) {
    assertValidPhase(phase);

    const record =
      this.phases[phase];

    if (
      record.state !==
      PHASE_STATES.RUNNING
    ) {
      throw new Error(
        `Cannot complete TITech bootstrap phase "${phase}" because its current state is "${record.state}".`,
      );
    }

    const timestamp = now();

    record.state =
      PHASE_STATES.COMPLETED;

    record.completedAt =
      timestamp;

    record.durationMs =
      record.startedAt
        ? Math.max(
            0,
            timestamp.getTime() -
              record.startedAt.getTime(),
          )
        : null;

    record.metadata = {
      ...record.metadata,
      ...cloneMetadata(metadata),
    };

    this.recordEvent(
      "phase_completed",
      {
        phase,

        durationMs:
          record.durationMs,

        metadata:
          cloneMetadata(metadata),
      },
    );

    return record;
  }

  failPhase(
    phase,
    error,
    metadata = {},
  ) {
    assertValidPhase(phase);

    const record =
      this.phases[phase];

    if (
      record.state !==
        PHASE_STATES.RUNNING &&
      record.state !==
        PHASE_STATES.PENDING
    ) {
      throw new Error(
        `Cannot fail TITech bootstrap phase "${phase}" from state "${record.state}".`,
      );
    }

    const timestamp = now();

    record.state =
      PHASE_STATES.FAILED;

    record.completedAt =
      timestamp;

    record.durationMs =
      record.startedAt
        ? Math.max(
            0,
            timestamp.getTime() -
              record.startedAt.getTime(),
          )
        : null;

    record.error =
      normalizeError(error);

    record.metadata = {
      ...record.metadata,
      ...cloneMetadata(metadata),
    };

    this.recordEvent(
      "phase_failed",
      {
        phase,

        durationMs:
          record.durationMs,

        error:
          record.error,

        metadata:
          cloneMetadata(metadata),
      },
    );

    this.markFailed(
      error,
      phase,
    );

    return record;
  }

  skipPhase(
    phase,
    reason = "not_required",
    metadata = {},
  ) {
    assertValidPhase(phase);

    if (
      this.getState() !==
      CONTEXT_STATES.STARTING
    ) {
      throw new Error(
        `Cannot skip TITech bootstrap phase "${phase}" while context is "${this.getState()}".`,
      );
    }

    if (phase === "runtimeReady") {
      throw new Error(
        "The TITech runtimeReady phase cannot be skipped.",
      );
    }

    this.assertNextPhase(phase);

    const record =
      this.phases[phase];

    if (
      record.state !==
      PHASE_STATES.PENDING
    ) {
      throw new Error(
        `Cannot skip TITech bootstrap phase "${phase}" from state "${record.state}".`,
      );
    }

    record.state =
      PHASE_STATES.SKIPPED;

    record.completedAt =
      now();

    record.metadata = {
      ...record.metadata,

      reason:
        sanitizeString(
          reason,
          MAX_REASON_LENGTH,
        ),

      ...cloneMetadata(metadata),
    };

    this.recordEvent(
      "phase_skipped",
      {
        phase,

        reason:
          sanitizeString(
            reason,
            MAX_REASON_LENGTH,
          ),

        metadata:
          cloneMetadata(metadata),
      },
    );

    return record;
  }

  getPhaseState(phase) {
    assertValidPhase(phase);

    return this.phases[phase].state;
  }

  getPhaseRecord(phase) {
    assertValidPhase(phase);

    const record =
      this.phases[phase];

    return {
      state:
        record.state,

      startedAt:
        record.startedAt,

      completedAt:
        record.completedAt,

      durationMs:
        record.durationMs,

      error:
        record.error
          ? {
              ...record.error,
            }
          : null,

      metadata:
        cloneMetadata(
          record.metadata,
        ),
    };
  }

  isPhaseComplete(phase) {
    return (
      this.getPhaseState(phase) ===
      PHASE_STATES.COMPLETED
    );
  }

  isPhaseFailed(phase) {
    return (
      this.getPhaseState(phase) ===
      PHASE_STATES.FAILED
    );
  }

  /* ===========================================================================
   * DEPENDENCY REGISTRATION
   * ===========================================================================
   */

  _setDependency(
    name,
    value,
  ) {
    this[name] =
      value;

    return this;
  }

  setEnvironment(environment) {
    return this._setDependency(
      "environment",
      environment,
    );
  }

  setConfiguration(configuration) {
    return this._setDependency(
      "configuration",
      configuration,
    );
  }

  setLogger(logger) {
    return this._setDependency(
      "logger",
      logger,
    );
  }

  setObservability(observability) {
    return this._setDependency(
      "observability",
      observability,
    );
  }

  setReadiness(readiness) {
    return this._setDependency(
      "readiness",
      readiness,
    );
  }

  setResilience(resilience) {
    return this._setDependency(
      "resilience",
      resilience,
    );
  }

  setInfrastructure(infrastructure) {
    return this._setDependency(
      "infrastructure",
      infrastructure,
    );
  }

  setServices(services) {
    return this._setDependency(
      "services",
      services,
    );
  }

  setMiddleware(middleware) {
    return this._setDependency(
      "middleware",
      middleware,
    );
  }

  setRoutes(routes) {
    return this._setDependency(
      "routes",
      routes,
    );
  }

  setHttpServer(httpServer) {
    this.httpServer =
      httpServer || null;

    this.server =
      this.httpServer;

    return this;
  }

  setServer(server) {
    return this.setHttpServer(
      server,
    );
  }

  setApplication(application) {
    return this._setDependency(
      "application",
      application,
    );
  }

  setContainer(container) {
    if (
      container === null ||
      container === undefined
    ) {
      this.container = {};
      return this;
    }

    if (
      !isPlainObject(container)
    ) {
      throw new TypeError(
        "TITech bootstrap dependency container must be a plain object.",
      );
    }

    this.container =
      container;

    return this;
  }

  registerDependency(
    name,
    value,
    options = {},
  ) {
    if (
      typeof name !== "string" ||
      name.trim() === ""
    ) {
      throw new TypeError(
        "TITech dependency name must be a non-empty string.",
      );
    }

    const normalizedName =
      name
        .trim()
        .slice(
          0,
          MAX_DEPENDENCY_NAME_LENGTH,
        );

    if (
      !normalizedName
    ) {
      throw new TypeError(
        "TITech dependency name cannot be empty.",
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        this.container,
        normalizedName,
      ) &&
      options.overwrite !== true
    ) {
      throw new Error(
        `TITech dependency "${normalizedName}" is already registered.`,
      );
    }

    this.container[
      normalizedName
    ] = value;

    this.recordEvent(
      "dependency_registered",
      {
        name:
          normalizedName,

        available:
          value !== null &&
          value !== undefined,
      },
    );

    return this;
  }

  resolveDependency(name) {
    if (
      typeof name !== "string" ||
      name.trim() === ""
    ) {
      return undefined;
    }

    return this.container[
      name.trim()
    ];
  }

  hasDependency(name) {
    if (
      typeof name !== "string" ||
      name.trim() === ""
    ) {
      return false;
    }

    const normalizedName =
      name
        .trim()
        .slice(
          0,
          MAX_DEPENDENCY_NAME_LENGTH,
        );

    if (
      Object.prototype.hasOwnProperty.call(
        this,
        normalizedName,
      )
    ) {
      return (
        this[normalizedName] !== null &&
        this[normalizedName] !== undefined
      );
    }

    return (
      Object.prototype.hasOwnProperty.call(
        this.container,
        normalizedName,
      ) &&
      this.container[
        normalizedName
      ] !== null &&
      this.container[
        normalizedName
      ] !== undefined
    );
  }

  requireDependency(name) {
    if (
      !this.hasDependency(name)
    ) {
      throw new Error(
        `Required TITech bootstrap dependency "${sanitizeString(
          name,
          MAX_DEPENDENCY_NAME_LENGTH,
        )}" is not available.`,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        this,
        name,
      )
    ) {
      return this[name];
    }

    return this.container[name];
  }

  requireAnyDependency(names = []) {
    if (
      !Array.isArray(names) ||
      names.length === 0
    ) {
      throw new TypeError(
        "requireAnyDependency expects a non-empty array.",
      );
    }

    for (const name of names) {
      if (
        this.hasDependency(name)
      ) {
        return this.requireDependency(
          name,
        );
      }
    }

    throw new Error(
      "None of the required TITech bootstrap dependencies are available: " +
        names
          .map((name) =>
            sanitizeString(
              name,
              MAX_DEPENDENCY_NAME_LENGTH,
            ),
          )
          .join(", "),
    );
  }

  /* ===========================================================================
   * SHUTDOWN HOOKS
   * ===========================================================================
   */

  registerShutdownHook(
    name,
    handler,
    options = {},
  ) {
    if (
      typeof handler !== "function"
    ) {
      throw new TypeError(
        `Shutdown hook "${sanitizeString(
          name,
          MAX_HOOK_NAME_LENGTH,
        )}" must provide a function handler.`,
      );
    }

    if (this.isStopped()) {
      throw new Error(
        "Cannot register a shutdown hook on a stopped TITech bootstrap context.",
      );
    }

    const normalizedName =
      sanitizeString(
        name,
        MAX_HOOK_NAME_LENGTH,
      ) ||
      `shutdown-hook-${
        this.shutdownHooks.length + 1
      }`;

    if (
      this.shutdownHooks.some(
        (hook) =>
          hook.name ===
          normalizedName,
      )
    ) {
      throw new Error(
        `TITech shutdown hook "${normalizedName}" is already registered.`,
      );
    }

    const hook = {
      name:
        normalizedName,

      handler,

      priority:
        Number.isFinite(
          options.priority,
        )
          ? Number(options.priority)
          : 0,

      timeoutMs:
        normalizePositiveInteger(
          options.timeoutMs,
          DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
        ),

      registeredAt:
        now(),

      executedAt:
        null,

      status:
        "registered",

      error:
        null,
    };

    this.shutdownHooks.push(
      hook,
    );

    this._sortShutdownHooks();

    this.recordEvent(
      "shutdown_hook_registered",
      {
        name:
          hook.name,

        priority:
          hook.priority,

        timeoutMs:
          hook.timeoutMs,
      },
    );

    return this._serializeShutdownHook(
      hook,
    );
  }

  _sortShutdownHooks() {
    this.shutdownHooks.sort(
      (a, b) => {
        if (
          b.priority !==
          a.priority
        ) {
          return (
            b.priority -
            a.priority
          );
        }

        return (
          a.registeredAt.getTime() -
          b.registeredAt.getTime()
        );
      },
    );
  }

  unregisterShutdownHook(name) {
    const normalizedName =
      sanitizeString(
        name,
        MAX_HOOK_NAME_LENGTH,
      );

    const index =
      this.shutdownHooks.findIndex(
        (hook) =>
          hook.name ===
          normalizedName,
      );

    if (index === -1) {
      return false;
    }

    const hook =
      this.shutdownHooks[index];

    if (
      hook.status ===
        "running" ||
      hook.status ===
        "completed"
    ) {
      throw new Error(
        `Cannot unregister TITech shutdown hook "${normalizedName}" after execution has begun.`,
      );
    }

    this.shutdownHooks.splice(
      index,
      1,
    );

    this.recordEvent(
      "shutdown_hook_unregistered",
      {
        name:
          normalizedName,
      },
    );

    return true;
  }

  getShutdownHooks() {
    return this.shutdownHooks.map(
      (hook) =>
        this._serializeShutdownHook(
          hook,
        ),
    );
  }

  async executeShutdownHooks() {
    if (
      this.getState() ===
      CONTEXT_STATES.STOPPED
    ) {
      return this.getShutdownHooks();
    }

    if (
      this.shutdownExecutionPromise
    ) {
      return this.shutdownExecutionPromise;
    }

    if (
      this.getState() !==
      CONTEXT_STATES.SHUTTING_DOWN
    ) {
      this.beginShutdown(
        "shutdown_hooks_execution",
      );
    }

    this.shutdownExecutionPromise =
      this._executeShutdownHooksInternal();

    try {
      return await this
        .shutdownExecutionPromise;
    } finally {
      this.shutdownExecutionPromise =
        null;
    }
  }

  async _executeShutdownHooksInternal() {
    for (const hook of this.shutdownHooks) {
      if (
        hook.status ===
          "completed" ||
        hook.status ===
          "failed"
      ) {
        continue;
      }

      hook.status =
        "running";

      try {
        await this.executeWithTimeout(
          hook.handler,
          hook.timeoutMs,
          `TITech shutdown hook "${hook.name}" timed out after ${hook.timeoutMs}ms.`,
        );

        hook.status =
          "completed";

        hook.executedAt =
          now();

        this.recordEvent(
          "shutdown_hook_completed",
          {
            name:
              hook.name,

            priority:
              hook.priority,
          },
        );
      } catch (error) {
        hook.status =
          "failed";

        hook.executedAt =
          now();

        hook.error =
          normalizeError(error);

        this.runtime.degraded =
          true;

        this.recordEvent(
          "shutdown_hook_failed",
          {
            name:
              hook.name,

            error:
              hook.error,
          },
        );
      }
    }

    this.markStopped();

    return this.getShutdownHooks();
  }

  async executeWithTimeout(
    handler,
    timeoutMs,
    timeoutMessage,
  ) {
    if (
      typeof handler !==
      "function"
    ) {
      throw new TypeError(
        "TITech timeout execution requires a function handler.",
      );
    }

    const normalizedTimeout =
      normalizePositiveInteger(
        timeoutMs,
        DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
      );

    return new Promise(
      (resolve, reject) => {
        let settled = false;

        const timer =
          setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;

            reject(
              new Error(
                timeoutMessage ||
                  "TITech shutdown hook timed out.",
              ),
            );
          }, normalizedTimeout);

        Promise.resolve()
          .then(() =>
            handler(this),
          )
          .then(
            (result) => {
              if (settled) {
                return;
              }

              settled = true;

              clearTimeout(timer);

              resolve(result);
            },
          )
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

  abort(
    reason = "bootstrap_aborted",
  ) {
    if (!this.signal.aborted) {
      const safeReason =
        sanitizeString(
          reason,
          MAX_REASON_LENGTH,
        ) ||
        "bootstrap_aborted";

      this.abortController.abort(
        safeReason,
      );

      this.recordEvent(
        "bootstrap_aborted",
        {
          reason:
            safeReason,
        },
      );
    }

    return this;
  }

  /* ===========================================================================
   * BOOTSTRAP STATUS
   * ===========================================================================
   */

  getCompletedPhases() {
    return BOOTSTRAP_PHASES.filter(
      (phase) =>
        this.phases[phase].state ===
        PHASE_STATES.COMPLETED,
    );
  }

  getPendingPhases() {
    return BOOTSTRAP_PHASES.filter(
      (phase) =>
        this.phases[phase].state ===
        PHASE_STATES.PENDING,
    );
  }

  getFailedPhases() {
    return BOOTSTRAP_PHASES.filter(
      (phase) =>
        this.phases[phase].state ===
        PHASE_STATES.FAILED,
    );
  }

  getSkippedPhases() {
    return BOOTSTRAP_PHASES.filter(
      (phase) =>
        this.phases[phase].state ===
        PHASE_STATES.SKIPPED,
    );
  }

  getRunningPhases() {
    return BOOTSTRAP_PHASES.filter(
      (phase) =>
        this.phases[phase].state ===
        PHASE_STATES.RUNNING,
    );
  }

  isBootstrapComplete() {
    return BOOTSTRAP_PHASES.every(
      (phase) => {
        const state =
          this.phases[phase].state;

        return (
          state ===
            PHASE_STATES.COMPLETED ||
          state ===
            PHASE_STATES.SKIPPED
        );
      },
    );
  }

  validateBootstrapOrder() {
    let encounteredPending =
      false;

    for (
      const phase of BOOTSTRAP_PHASES
    ) {
      const state =
        this.phases[phase].state;

      if (
        state ===
        PHASE_STATES.PENDING
      ) {
        encounteredPending = true;
        continue;
      }

      if (
        encounteredPending &&
        (
          state ===
            PHASE_STATES.COMPLETED ||
          state ===
            PHASE_STATES.SKIPPED
        )
      ) {
        throw new Error(
          `TITech bootstrap phase "${phase}" completed after a later pending phase, violating canonical order.`,
        );
      }
    }

    return true;
  }

  validateRuntimeReady() {
    const missingDependencies =
      [];

    const mandatoryDependencies = [
      "application",
      "configuration",
      "logger",
      "observability",
      "readiness",
      "resilience",
      "infrastructure",
      "services",
      "middleware",
      "routes",
      "httpServer",
    ];

    for (
      const dependency of
        mandatoryDependencies
    ) {
      if (
        !this.hasDependency(
          dependency,
        )
      ) {
        missingDependencies.push(
          dependency,
        );
      }
    }

    if (
      missingDependencies.length > 0
    ) {
      const error =
        new Error(
          "TITech runtime readiness validation failed.",
        );

      error.code =
        "BOOTSTRAP_CONTEXT_NOT_READY";

      error.missingDependencies =
        missingDependencies;

      throw error;
    }

    this.validateBootstrapOrder();

    const incompletePhases =
      BOOTSTRAP_PHASES.filter(
        (phase) => {
          const state =
            this.phases[phase].state;

          return (
            state !==
              PHASE_STATES.COMPLETED &&
            state !==
              PHASE_STATES.SKIPPED
          );
        },
      );

    if (
      incompletePhases.length > 0
    ) {
      const error =
        new Error(
          "TITech runtime readiness validation failed because bootstrap phases are incomplete.",
        );

      error.code =
        "BOOTSTRAP_PHASES_INCOMPLETE";

      error.incompletePhases =
        incompletePhases;

      throw error;
    }

    if (
      this.phases.runtimeReady.state !==
      PHASE_STATES.COMPLETED
    ) {
      const error =
        new Error(
          "TITech runtimeReady phase is not complete.",
        );

      error.code =
        "RUNTIME_READY_PHASE_INCOMPLETE";

      throw error;
    }

    return true;
  }

  /* ===========================================================================
   * DIAGNOSTICS
   * ===========================================================================
   */

  recordEvent(
    type,
    metadata = {},
  ) {
    this.history.push({
      type:
        sanitizeString(
          type,
          MAX_EVENT_TYPE_LENGTH,
        ),

      timestamp:
        now(),

      metadata:
        cloneMetadata(metadata),
    });

    if (
      this.history.length >
      this.historyLimit
    ) {
      this.history.splice(
        0,
        this.history.length -
          this.historyLimit,
      );
    }

    return this;
  }

  getHistory(
    limit = DEFAULT_HISTORY_READ_LIMIT,
  ) {
    const normalizedLimit =
      normalizePositiveInteger(
        limit,
        DEFAULT_HISTORY_READ_LIMIT,
      );

    return this.history
      .slice(-normalizedLimit)
      .map((event) => ({
        type:
          event.type,

        timestamp:
          event.timestamp,

        metadata:
          cloneMetadata(
            event.metadata,
          ),
      }));
  }

  _serializeShutdownHook(
    hook,
  ) {
    return {
      name:
        hook.name,

      priority:
        hook.priority,

      timeoutMs:
        hook.timeoutMs,

      registeredAt:
        hook.registeredAt,

      executedAt:
        hook.executedAt,

      status:
        hook.status,

      error:
        hook.error
          ? {
              ...hook.error,
            }
          : null,
    };
  }

  getDiagnostics() {
    const diagnostics = {
      id:
        this.id,

      state:
        this.getState(),

      createdAt:
        this.createdAt,

      startedAt:
        this.startedAt,

      readyAt:
        this.readyAt,

      failedAt:
        this.failedAt,

      shutdownAt:
        this.shutdownAt,

      stoppedAt:
        this.stoppedAt,

      runtime:
        {
          ...this.runtime,
        },

      application:
        {
          available:
            Boolean(
              this.application,
            ),
        },

      phases:
        Object.entries(
          this.phases,
        ).reduce(
          (
            result,
            [phase, record],
          ) => {
            result[phase] = {
              state:
                record.state,

              startedAt:
                record.startedAt,

              completedAt:
                record.completedAt,

              durationMs:
                record.durationMs,

              error:
                record.error
                  ? {
                      ...record.error,
                    }
                  : null,

              metadata:
                cloneMetadata(
                  record.metadata,
                ),
            };

            return result;
          },
          {},
        ),

      completedPhases:
        this.getCompletedPhases(),

      pendingPhases:
        this.getPendingPhases(),

      runningPhases:
        this.getRunningPhases(),

      failedPhases:
        this.getFailedPhases(),

      skippedPhases:
        this.getSkippedPhases(),

      nextPhase:
        this.getNextPhase(),

      bootstrapComplete:
        this.isBootstrapComplete(),

      dependencies:
        {
          environment:
            this.hasDependency(
              "environment",
            ),

          configuration:
            this.hasDependency(
              "configuration",
            ),

          logger:
            this.hasDependency(
              "logger",
            ),

          observability:
            this.hasDependency(
              "observability",
            ),

          readiness:
            this.hasDependency(
              "readiness",
            ),

          resilience:
            this.hasDependency(
              "resilience",
            ),

          infrastructure:
            this.hasDependency(
              "infrastructure",
            ),

          services:
            this.hasDependency(
              "services",
            ),

          middleware:
            this.hasDependency(
              "middleware",
            ),

          routes:
            this.hasDependency(
              "routes",
            ),

          httpServer:
            this.hasDependency(
              "httpServer",
            ),
        },

      containerDependencies:
        Object.keys(
          this.container,
        ),

      shutdownHooks:
        this.getShutdownHooks(),

      historySize:
        this.history.length,

      historyLimit:
        this.historyLimit,

      signal:
        {
          aborted:
            this.signal.aborted,

          reason:
            this.signal.aborted
              ? sanitizeString(
                  this.signal.reason,
                  MAX_REASON_LENGTH,
                )
              : null,
        },

      error:
        this.error
          ? {
              ...this.error,
            }
          : null,

      metadata:
        cloneMetadata(
          this.metadata,
        ),
    };

    return diagnostics;
  }

  toJSON() {
    return this.getDiagnostics();
  }
}


/* =============================================================================
 * FACTORY
 * =============================================================================
 */

function createBootstrapContext(
  options = {},
) {
  return new BootstrapContext(
    options,
  );
}


/* =============================================================================
 * MODULE EXPORTS
 * =============================================================================
 */

module.exports = {
  BootstrapContext,

  createBootstrapContext,

  BOOTSTRAP_PHASES,

  PHASE_STATES,

  CONTEXT_STATES,

  LIFECYCLE_TRANSITIONS,

  DEFAULT_HISTORY_LIMIT,

  DEFAULT_HISTORY_READ_LIMIT,

  DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
};