"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/runtime/state.js
 *
 * Purpose:
 *   Enterprise process-local runtime lifecycle state and transition registry.
 *
 * =============================================================================
 * ARCHITECTURAL RESPONSIBILITY
 * =============================================================================
 *
 * This module is the process-local runtime state authority/read model.
 *
 * It owns:
 *
 *   - bootstrap lifecycle state;
 *   - bootstrap phase state;
 *   - application lifecycle state;
 *   - readiness state;
 *   - health/liveness state;
 *   - logical service state;
 *   - phase/service timing;
 *   - request/socket operational counters;
 *   - startup/shutdown timing;
 *   - sanitized failure metadata;
 *   - runtime generation identity;
 *   - immutable state snapshots.
 *
 * This module MUST NOT:
 *
 *   - connect to MongoDB;
 *   - connect to Redis;
 *   - initialize queues;
 *   - initialize WebSocket infrastructure;
 *   - configure middleware;
 *   - register routes;
 *   - create HTTP servers;
 *   - initialize loggers;
 *   - initialize observability providers;
 *   - read secrets;
 *   - perform network I/O;
 *   - mutate Express application state;
 *   - own application dependencies.
 *
 * Bootstrap components mutate runtime state through the exported lifecycle
 * transition functions.
 *
 * =============================================================================
 * CANONICAL TITech BOOTSTRAP LIFECYCLE
 * =============================================================================
 *
 * Startup:
 *
 *   environment
 *        ↓
 *   configuration
 *        ↓
 *   logger
 *        ↓
 *   observability
 *        ↓
 *   readiness
 *        ↓
 *   resilience
 *        ↓
 *   infrastructure
 *        ↓
 *   services
 *        ↓
 *   middleware
 *        ↓
 *   routes
 *        ↓
 *   server
 *        ↓
 *   ready
 *
 * Normal shutdown:
 *
 *   ready
 *      ↓
 *   shutting_down
 *      ↓
 *   stopped
 *
 * Partial-startup failure:
 *
 *   any startup phase
 *      ↓
 *   failed
 *      ↓
 *   shutting_down
 *      ↓
 *   stopped
 *
 * IMPORTANT:
 *
 * Failure cleanup is intentionally outside the normal forward-only bootstrap
 * graph. A startup failure may occur before the server exists and must still
 * be able to enter the shutdown lifecycle.
 *
 * =============================================================================
 * STATE MODEL
 * =============================================================================
 *
 * Bootstrap phase:
 *
 *   "Where is the bootstrap pipeline?"
 *
 * Bootstrap lifecycle:
 *
 *   "What is happening to the bootstrap pipeline?"
 *
 * Application state:
 *
 *   "What is the process currently capable of doing?"
 *
 * Service state:
 *
 *   "What is the operational state of an individual logical service?"
 *
 * Readiness:
 *
 *   "Can this process safely receive production traffic?"
 *
 * Health:
 *
 *   "Is this process operationally healthy?"
 *
 * Liveness:
 *
 *   "Is this process still alive?"
 *
 * These concepts intentionally remain separate.
 *
 * =============================================================================
 * DESIGN PRINCIPLES
 * =============================================================================
 *
 * ✓ Process-local state only.
 * ✓ BootstrapContext remains the canonical orchestration authority.
 * ✓ Explicit lifecycle transitions.
 * ✓ Strict startup ordering.
 * ✓ Explicit partial-startup shutdown.
 * ✓ Failed startup cannot become started.
 * ✓ Failed startup cannot become ready.
 * ✓ Failed startup cannot complete later startup phases.
 * ✓ Shutdown cannot bypass shutting_down before stopped.
 * ✓ Duplicate lifecycle calls are safely idempotent where appropriate.
 * ✓ Service state is independently observable.
 * ✓ Readiness blockers are explicit.
 * ✓ Failure information is sanitized.
 * ✓ Secrets/credentials are never retained.
 * ✓ Metrics never become negative.
 * ✓ Phase timings are captured.
 * ✓ Service timings are captured.
 * ✓ Runtime generation identifies a lifecycle attempt.
 * ✓ Reset support exists for deterministic testing.
 * ✓ Snapshots do not expose mutable internal collections.
 * ✓ Runtime state never performs infrastructure work.
 *
 * =============================================================================
 */

/* =============================================================================
 * BOOTSTRAP PHASES
 * =============================================================================
 */

const BOOTSTRAP_PHASES = Object.freeze({
  ENVIRONMENT: "environment",
  CONFIGURATION: "configuration",
  LOGGER: "logger",
  OBSERVABILITY: "observability",
  READINESS: "readiness",
  RESILIENCE: "resilience",
  INFRASTRUCTURE: "infrastructure",
  SERVICES: "services",
  MIDDLEWARE: "middleware",
  ROUTES: "routes",
  SERVER: "server",
  READY: "ready",
  SHUTTING_DOWN: "shutting_down",
  STOPPED: "stopped",
});

/* =============================================================================
 * CANONICAL STARTUP PHASE ORDER
 * =============================================================================
 */

const BOOTSTRAP_PHASE_ORDER = Object.freeze([
  BOOTSTRAP_PHASES.ENVIRONMENT,
  BOOTSTRAP_PHASES.CONFIGURATION,
  BOOTSTRAP_PHASES.LOGGER,
  BOOTSTRAP_PHASES.OBSERVABILITY,
  BOOTSTRAP_PHASES.READINESS,
  BOOTSTRAP_PHASES.RESILIENCE,
  BOOTSTRAP_PHASES.INFRASTRUCTURE,
  BOOTSTRAP_PHASES.SERVICES,
  BOOTSTRAP_PHASES.MIDDLEWARE,
  BOOTSTRAP_PHASES.ROUTES,
  BOOTSTRAP_PHASES.SERVER,
]);

/* =============================================================================
 * BOOTSTRAP LIFECYCLE STATES
 * =============================================================================
 */

const BOOTSTRAP_LIFECYCLE_STATES = Object.freeze({
  NOT_STARTED: "not_started",
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SHUTTING_DOWN: "shutting_down",
  STOPPED: "stopped",
});

/* =============================================================================
 * LOGICAL SERVICES
 * =============================================================================
 */

const SERVICES = Object.freeze({
  LOGGER: "logger",
  OBSERVABILITY: "observability",
  READINESS: "readiness",
  RESILIENCE: "resilience",
  DATABASE: "database",
  REDIS: "redis",
  QUEUES: "queues",
  WEBSOCKET: "websocket",
  INFRASTRUCTURE: "infrastructure",
  SERVICES: "services",
  MIDDLEWARE: "middleware",
  ROUTES: "routes",
  SERVER: "server",
  METRICS: "metrics",
  DOCUMENTATION: "documentation",
});

/* =============================================================================
 * SERVICE STATES
 * =============================================================================
 */

const SERVICE_STATES = Object.freeze({
  STOPPED: "stopped",
  STARTING: "starting",
  READY: "ready",
  DEGRADED: "degraded",
  STOPPING: "stopping",
  FAILED: "failed",
});

/* =============================================================================
 * NORMAL BOOTSTRAP TRANSITION GRAPH
 * =============================================================================
 *
 * This graph describes normal forward startup only.
 *
 * Failure cleanup is intentionally handled separately below.
 * =============================================================================
 */

const BOOTSTRAP_TRANSITIONS = Object.freeze({
  [BOOTSTRAP_PHASES.ENVIRONMENT]: Object.freeze([
    BOOTSTRAP_PHASES.CONFIGURATION,
  ]),

  [BOOTSTRAP_PHASES.CONFIGURATION]: Object.freeze([
    BOOTSTRAP_PHASES.LOGGER,
  ]),

  [BOOTSTRAP_PHASES.LOGGER]: Object.freeze([
    BOOTSTRAP_PHASES.OBSERVABILITY,
  ]),

  [BOOTSTRAP_PHASES.OBSERVABILITY]: Object.freeze([
    BOOTSTRAP_PHASES.READINESS,
  ]),

  [BOOTSTRAP_PHASES.READINESS]: Object.freeze([
    BOOTSTRAP_PHASES.RESILIENCE,
  ]),

  [BOOTSTRAP_PHASES.RESILIENCE]: Object.freeze([
    BOOTSTRAP_PHASES.INFRASTRUCTURE,
  ]),

  [BOOTSTRAP_PHASES.INFRASTRUCTURE]: Object.freeze([
    BOOTSTRAP_PHASES.SERVICES,
  ]),

  [BOOTSTRAP_PHASES.SERVICES]: Object.freeze([
    BOOTSTRAP_PHASES.MIDDLEWARE,
  ]),

  [BOOTSTRAP_PHASES.MIDDLEWARE]: Object.freeze([
    BOOTSTRAP_PHASES.ROUTES,
  ]),

  [BOOTSTRAP_PHASES.ROUTES]: Object.freeze([
    BOOTSTRAP_PHASES.SERVER,
  ]),

  [BOOTSTRAP_PHASES.SERVER]: Object.freeze([
    BOOTSTRAP_PHASES.READY,
  ]),

  [BOOTSTRAP_PHASES.READY]: Object.freeze([
    BOOTSTRAP_PHASES.SHUTTING_DOWN,
  ]),

  [BOOTSTRAP_PHASES.SHUTTING_DOWN]: Object.freeze([
    BOOTSTRAP_PHASES.STOPPED,
  ]),

  [BOOTSTRAP_PHASES.STOPPED]: Object.freeze([]),
});

/* =============================================================================
 * SHUTDOWN ELIGIBILITY
 * =============================================================================
 *
 * Any startup phase may legitimately fail.
 *
 * Therefore shutdown cleanup must be legal from every startup phase.
 * =============================================================================
 */

const SHUTDOWN_ELIGIBLE_PHASES = Object.freeze([
  BOOTSTRAP_PHASES.ENVIRONMENT,
  BOOTSTRAP_PHASES.CONFIGURATION,
  BOOTSTRAP_PHASES.LOGGER,
  BOOTSTRAP_PHASES.OBSERVABILITY,
  BOOTSTRAP_PHASES.READINESS,
  BOOTSTRAP_PHASES.RESILIENCE,
  BOOTSTRAP_PHASES.INFRASTRUCTURE,
  BOOTSTRAP_PHASES.SERVICES,
  BOOTSTRAP_PHASES.MIDDLEWARE,
  BOOTSTRAP_PHASES.ROUTES,
  BOOTSTRAP_PHASES.SERVER,
  BOOTSTRAP_PHASES.READY,
]);

/* =============================================================================
 * PHASE → SERVICE MAPPING
 * =============================================================================
 */

const PHASE_SERVICE_MAP = Object.freeze({
  [BOOTSTRAP_PHASES.LOGGER]: SERVICES.LOGGER,
  [BOOTSTRAP_PHASES.OBSERVABILITY]: SERVICES.OBSERVABILITY,
  [BOOTSTRAP_PHASES.READINESS]: SERVICES.READINESS,
  [BOOTSTRAP_PHASES.RESILIENCE]: SERVICES.RESILIENCE,
  [BOOTSTRAP_PHASES.INFRASTRUCTURE]: SERVICES.INFRASTRUCTURE,
  [BOOTSTRAP_PHASES.SERVICES]: SERVICES.SERVICES,
  [BOOTSTRAP_PHASES.MIDDLEWARE]: SERVICES.MIDDLEWARE,
  [BOOTSTRAP_PHASES.ROUTES]: SERVICES.ROUTES,
  [BOOTSTRAP_PHASES.SERVER]: SERVICES.SERVER,
});

/* =============================================================================
 * CONSTANT SETS
 * =============================================================================
 */

const STARTUP_PHASE_SET = new Set(
  BOOTSTRAP_PHASE_ORDER,
);

const VALID_PHASE_SET = new Set(
  Object.values(BOOTSTRAP_PHASES),
);

const VALID_SERVICE_SET = new Set(
  Object.values(SERVICES),
);

const VALID_SERVICE_STATE_SET = new Set(
  Object.values(SERVICE_STATES),
);

/* =============================================================================
 * INITIAL STATE FACTORIES
 * =============================================================================
 */

function createInitialServices() {
  const services = {};

  Object.values(SERVICES).forEach((service) => {
    services[service] = false;
  });

  return services;
}

function createInitialServiceStates() {
  const states = {};

  Object.values(SERVICES).forEach((service) => {
    states[service] = SERVICE_STATES.STOPPED;
  });

  return states;
}

function createInitialPhaseTimings() {
  const timings = {};

  BOOTSTRAP_PHASE_ORDER.forEach((phase) => {
    timings[phase] = {
      startedAt: null,
      completedAt: null,
      durationMs: null,
    };
  });

  return timings;
}

function createInitialServiceTimings() {
  const timings = {};

  Object.values(SERVICES).forEach((service) => {
    timings[service] = {
      startedAt: null,
      readyAt: null,
      stoppedAt: null,
      durationMs: null,
    };
  });

  return timings;
}

function createInitialReadiness() {
  return {
    ready: false,
    blockers: [],
    checks: {},
    lastEvaluation: null,
  };
}

/* =============================================================================
 * RUNTIME GENERATION
 * =============================================================================
 *
 * Every reset/startup generation receives a new process-local identity.
 *
 * This is intentionally NOT a security token.
 * It exists to distinguish lifecycle attempts in logs and telemetry.
 * =============================================================================
 */

function createRuntimeGeneration() {
  return [
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2, 10),
  ].join("-");
}

/* =============================================================================
 * INTERNAL APPLICATION STATE
 * =============================================================================
 */

const applicationState = {
  runtimeGeneration: createRuntimeGeneration(),

  processId: process.pid,

  nodeVersion: process.version,

  initialized: false,

  starting: false,

  started: false,

  healthy: false,

  ready: false,

  shuttingDown: false,

  stopped: false,

  terminated: false,

  failed: false,

  bootstrapLifecycle:
    BOOTSTRAP_LIFECYCLE_STATES.NOT_STARTED,

  bootstrapPhase: null,

  completedPhases: [],

  phaseTimings: createInitialPhaseTimings(),

  startedAt: null,

  readyAt: null,

  shutdownStartedAt: null,

  stoppedAt: null,

  lastHealthCheck: null,

  startupDurationMs: null,

  shutdownDurationMs: null,

  failure: null,

  readiness: createInitialReadiness(),

  requestCount: 0,

  activeRequests: 0,

  websocketConnections: 0,

  services: createInitialServices(),

  serviceStates: createInitialServiceStates(),

  serviceTimings: createInitialServiceTimings(),
};

/* =============================================================================
 * BASIC UTILITIES
 * =============================================================================
 */

function now() {
  return new Date();
}

function timestamp() {
  return now().toISOString();
}

/**
 * Safely clone a plain object.
 *
 * This intentionally avoids structuredClone because runtime state contains
 * Date instances internally and this module only requires small plain
 * snapshots.
 */
function cloneObject(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return {
    ...value,
  };
}

/* =============================================================================
 * VALIDATION
 * =============================================================================
 */

function assertValidPhase(phase) {
  if (!VALID_PHASE_SET.has(phase)) {
    throw new Error(
      `Unknown bootstrap phase: ${String(phase)}`,
    );
  }
}

function assertValidStartupPhase(phase) {
  assertValidPhase(phase);

  if (!STARTUP_PHASE_SET.has(phase)) {
    throw new Error(
      `Invalid startup bootstrap phase: ${String(phase)}`,
    );
  }
}

function assertValidService(service) {
  if (!VALID_SERVICE_SET.has(service)) {
    throw new Error(
      `Unknown service: ${String(service)}`,
    );
  }
}

function assertValidServiceState(state) {
  if (!VALID_SERVICE_STATE_SET.has(state)) {
    throw new Error(
      `Unknown service state: ${String(state)}`,
    );
  }
}

/* =============================================================================
 * SAFE ERROR NORMALIZATION
 * =============================================================================
 *
 * Never retain complete Error objects.
 *
 * Error objects may contain:
 *
 *   - stack traces;
 *   - connection strings;
 *   - filesystem paths;
 *   - provider metadata;
 *   - credentials accidentally included in messages.
 *
 * Only a bounded operational representation is retained.
 * =============================================================================
 */

function normalizeError(error) {
  if (!error) {
    return {
      message: "Unknown runtime error",
      code: null,
      name: "Error",
    };
  }

  let message;

  if (typeof error.message === "string") {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = "Unserializable runtime error";
    }
  }

  return {
    message: String(message).slice(0, 1000),

    code:
      typeof error.code === "string"
        ? error.code.slice(0, 100)
        : null,

    name:
      typeof error.name === "string"
        ? error.name.slice(0, 100)
        : "Error",
  };
}

/* =============================================================================
 * EVENT EMISSION
 * =============================================================================
 *
 * Runtime bookkeeping must remain functional even if an optional event
 * emitter throws.
 * =============================================================================
 */

function emit(events, eventName, payload) {
  try {
    events?.emit?.(
      eventName,
      payload,
    );
  } catch {
    // Optional event infrastructure must never become lifecycle-fatal.
  }
}

/* =============================================================================
 * LOGGING
 * =============================================================================
 */

function logInfo(logger, payload) {
  try {
    logger?.info?.(payload);
  } catch {
    // Logging must never become lifecycle-fatal.
  }
}

function logError(logger, payload) {
  try {
    logger?.error?.(payload);
  } catch {
    // Logging must never become lifecycle-fatal.
  }
}

/* =============================================================================
 * INTERNAL TIMING HELPERS
 * =============================================================================
 */

function calculateDurationMs(start, end) {
  if (!(start instanceof Date)) {
    return null;
  }

  if (!(end instanceof Date)) {
    return null;
  }

  return Math.max(
    0,
    end.getTime() - start.getTime(),
  );
}

/* =============================================================================
 * BOOTSTRAP PHASE TRANSITION
 * =============================================================================
 *
 * Normal startup follows BOOTSTRAP_TRANSITIONS.
 *
 * Shutdown is deliberately handled as a special transition because a failure
 * can happen at any point during startup.
 * =============================================================================
 */

function updateBootstrapPhase(
  phase,
  events,
  logger,
  options = {},
) {
  assertValidPhase(phase);

  const currentPhase =
    applicationState.bootstrapPhase;

  const failureCleanup =
    options.failureCleanup === true;

  /* ---------------------------------------------------------------------------
   * Idempotency
   * ------------------------------------------------------------------------- */

  if (currentPhase === phase) {
    return false;
  }

  /* ---------------------------------------------------------------------------
   * STOPPED
   * ------------------------------------------------------------------------- */

  if (
    phase === BOOTSTRAP_PHASES.STOPPED
  ) {
    if (
      currentPhase !==
      BOOTSTRAP_PHASES.SHUTTING_DOWN
    ) {
      throw new Error(
        "Application must enter shutting_down before stopped.",
      );
    }
  }

  /* ---------------------------------------------------------------------------
   * SHUTTING DOWN
   * ------------------------------------------------------------------------- */

  else if (
    phase === BOOTSTRAP_PHASES.SHUTTING_DOWN
  ) {
    const shutdownAllowed =
      failureCleanup ||
      applicationState.failed === true ||
      SHUTDOWN_ELIGIBLE_PHASES.includes(
        currentPhase,
      );

    if (!shutdownAllowed) {
      throw new Error(
        "Invalid bootstrap shutdown transition from " +
          `"${String(currentPhase)}".`,
      );
    }
  }

  /* ---------------------------------------------------------------------------
   * NORMAL STARTUP
   * ------------------------------------------------------------------------- */

  else {
    if (
      applicationState.failed === true
    ) {
      throw new Error(
        `Cannot transition to bootstrap phase "${phase}" after application failure.`,
      );
    }

    if (
      applicationState.shuttingDown ===
        true ||
      applicationState.stopped === true ||
      applicationState.terminated ===
        true
    ) {
      throw new Error(
        `Cannot transition to bootstrap phase "${phase}" after shutdown has begun.`,
      );
    }

    if (currentPhase === null) {
      if (
        phase !==
        BOOTSTRAP_PHASES.ENVIRONMENT
      ) {
        throw new Error(
          "Bootstrap must begin with the environment phase.",
        );
      }
    } else {
      const allowedTransitions =
        BOOTSTRAP_TRANSITIONS[
          currentPhase
        ] || [];

      if (
        !allowedTransitions.includes(
          phase,
        )
      ) {
        throw new Error(
          "Invalid bootstrap transition: " +
            `${currentPhase} -> ${phase}`,
        );
      }
    }
  }

  applicationState.bootstrapPhase =
    phase;

  const transitionTimestamp = now();

  /*
   * Only startup phases have normal phase timing records.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      applicationState.phaseTimings,
      phase,
    )
  ) {
    const timing =
      applicationState.phaseTimings[
        phase
      ];

    /*
     * Do not overwrite an existing phase start time.
     *
     * This protects timing integrity if a consumer calls transition helpers
     * more than once.
     */
    if (!timing.startedAt) {
      timing.startedAt =
        transitionTimestamp;
    }
  }

  emit(
    events,
    "bootstrap.phase.changed",
    {
      previousPhase: currentPhase,

      phase,

      timestamp:
        transitionTimestamp.toISOString(),

      failureCleanup,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "bootstrap",

      event: "phase_changed",

      previousPhase: currentPhase,

      phase,

      failureCleanup,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * PHASE START
 * =============================================================================
 */

function markPhaseStarted(
  phase,
  events,
  logger,
) {
  assertValidStartupPhase(phase);

  if (
    applicationState.shuttingDown ||
    applicationState.stopped ||
    applicationState.terminated
  ) {
    throw new Error(
      `Cannot start bootstrap phase "${phase}" after shutdown has begun.`,
    );
  }

  if (
    applicationState.failed
  ) {
    throw new Error(
      `Cannot start bootstrap phase "${phase}" after application failure.`,
    );
  }

  updateBootstrapPhase(
    phase,
    events,
    logger,
  );

  applicationState.initialized =
    true;

  applicationState.starting =
    true;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.RUNNING;

  const service =
    PHASE_SERVICE_MAP[phase];

  if (service) {
    markServiceStarting(
      service,
      events,
      logger,
    );
  }

  return true;
}

/* =============================================================================
 * PHASE COMPLETION
 * =============================================================================
 */

function markPhaseCompleted(
  phase,
  events,
  logger,
) {
  assertValidStartupPhase(phase);

  /*
   * Authoritative failure barrier.
   *
   * This prevents:
   *
   *   database initialization fails
   *       ↓
   *   application.failed
   *       ↓
   *   infrastructure marked completed
   *
   * which would corrupt the lifecycle read model.
   */
  if (
    applicationState.failed
  ) {
    throw new Error(
      `Cannot complete bootstrap phase "${phase}" after application failure.`,
    );
  }

  if (
    applicationState.shuttingDown ||
    applicationState.stopped ||
    applicationState.terminated
  ) {
    throw new Error(
      `Cannot complete bootstrap phase "${phase}" after shutdown has begun.`,
    );
  }

  if (
    applicationState.bootstrapPhase !==
    phase
  ) {
    throw new Error(
      `Cannot complete bootstrap phase "${phase}" because current phase is "${String(
        applicationState.bootstrapPhase,
      )}".`,
    );
  }

  /*
   * Idempotent completion.
   */
  if (
    applicationState.completedPhases.includes(
      phase,
    )
  ) {
    return false;
  }

  applicationState.completedPhases.push(
    phase,
  );

  const completedAt = now();

  const timing =
    applicationState.phaseTimings[
      phase
    ];

  if (timing) {
    timing.completedAt =
      completedAt;

    timing.durationMs =
      calculateDurationMs(
        timing.startedAt,
        completedAt,
      );
  }

  const service =
    PHASE_SERVICE_MAP[phase];

  if (service) {
    setServiceState(
      service,
      SERVICE_STATES.READY,
      events,
      logger,
    );
  }

  emit(
    events,
    "bootstrap.phase.completed",
    {
      phase,

      timestamp:
        completedAt.toISOString(),

      durationMs:
        timing?.durationMs ?? null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "bootstrap",

      event: "phase_completed",

      phase,

      durationMs:
        timing?.durationMs ?? null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * APPLICATION STARTING
 * =============================================================================
 */

function markStarting(
  events,
  logger,
) {
  /*
   * Idempotent when startup is already underway.
   */
  if (
    applicationState.starting
  ) {
    return false;
  }

  /*
   * A fully started application does not need another start transition.
   */
  if (
    applicationState.started &&
    applicationState.ready
  ) {
    return false;
  }

  if (
    applicationState.stopped ||
    applicationState.terminated
  ) {
    throw new Error(
      "A stopped application cannot be started without resetting runtime state.",
    );
  }

  if (
    applicationState.failed
  ) {
    throw new Error(
      "A failed application cannot be restarted without resetting runtime state.",
    );
  }

  const startedAt = now();

  applicationState.initialized =
    true;

  applicationState.starting =
    true;

  applicationState.started =
    false;

  applicationState.ready =
    false;

  applicationState.healthy =
    false;

  applicationState.shuttingDown =
    false;

  applicationState.stopped =
    false;

  applicationState.terminated =
    false;

  applicationState.failed =
    false;

  applicationState.failure =
    null;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.STARTING;

  applicationState.startedAt =
    startedAt;

  applicationState.readyAt =
    null;

  applicationState.shutdownStartedAt =
    null;

  applicationState.stoppedAt =
    null;

  applicationState.startupDurationMs =
    null;

  applicationState.shutdownDurationMs =
    null;

  applicationState.lastHealthCheck =
    null;

  applicationState.readiness =
    createInitialReadiness();

  emit(
    events,
    "application.starting",
    {
      timestamp:
        startedAt.toISOString(),

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "runtime",

      event: "application_starting",

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * APPLICATION STARTED
 * =============================================================================
 *
 * "Started" means the HTTP server bootstrap phase has completed.
 *
 * "Ready" remains a separate state.
 * =============================================================================
 */

function markApplicationStarted(
  events,
  logger,
) {
  if (
    applicationState.started
  ) {
    return false;
  }

  if (
    applicationState.failed
  ) {
    throw new Error(
      "A failed application cannot be marked started.",
    );
  }

  if (
    applicationState.shuttingDown ||
    applicationState.stopped ||
    applicationState.terminated
  ) {
    throw new Error(
      "Cannot mark an inactive application as started.",
    );
  }

  if (
    applicationState.bootstrapPhase !==
    BOOTSTRAP_PHASES.SERVER
  ) {
    throw new Error(
      "Application cannot be marked started before the server bootstrap phase.",
    );
  }

  if (
    !applicationState.completedPhases.includes(
      BOOTSTRAP_PHASES.SERVER,
    )
  ) {
    throw new Error(
      "Application cannot be marked started before the server phase is completed.",
    );
  }

  const startedAt = now();

  applicationState.initialized =
    true;

  applicationState.starting =
    false;

  applicationState.started =
    true;

  /*
   * Started does not automatically mean ready.
   */
  applicationState.ready =
    false;

  /*
   * The process can be healthy while waiting for explicit readiness.
   */
  applicationState.healthy =
    true;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.COMPLETED;

  applicationState.startupDurationMs =
    calculateDurationMs(
      applicationState.startedAt,
      startedAt,
    );

  emit(
    events,
    "application.started",
    {
      timestamp:
        startedAt.toISOString(),

      startupDurationMs:
        applicationState.startupDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "runtime",

      event: "application_started",

      startupDurationMs:
        applicationState.startupDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * READINESS STATE
 * =============================================================================
 */

function setReadinessState(
  ready,
  blockers = [],
  checks = {},
  events,
  logger,
) {
  const normalizedBlockers =
    Array.isArray(blockers)
      ? blockers
          .filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value).trim()
                .length > 0,
          )
          .map((value) =>
            String(value).slice(
              0,
              500,
            ),
          )
      : [];

  const normalizedChecks =
    checks &&
    typeof checks === "object" &&
    !Array.isArray(checks)
      ? {
          ...checks,
        }
      : {};

  const nextReady =
    Boolean(ready) &&
    normalizedBlockers.length ===
      0 &&
    applicationState.failed !==
      true &&
    applicationState.shuttingDown !==
      true &&
    applicationState.terminated !==
      true &&
    applicationState.stopped !==
      true;

  const previousReady =
    applicationState.ready;

  const evaluationTimestamp =
    now();

  applicationState.readiness = {
    ready: nextReady,

    blockers:
      normalizedBlockers,

    checks:
      normalizedChecks,

    lastEvaluation:
      evaluationTimestamp,
  };

  applicationState.ready =
    nextReady;

  if (!nextReady) {
    applicationState.ready =
      false;
  }

  emit(
    events,
    "application.readiness.changed",
    {
      previousReady,

      ready: nextReady,

      blockers: [
        ...normalizedBlockers,
      ],

      timestamp:
        evaluationTimestamp.toISOString(),

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  if (
    previousReady !==
    nextReady
  ) {
    logInfo(
      logger,
      {
        section: "readiness",

        event:
          "readiness_changed",

        ready: nextReady,

        blockers: [
          ...normalizedBlockers,
        ],

        runtimeGeneration:
          applicationState.runtimeGeneration,
      },
    );
  }

  return nextReady;
}

/* =============================================================================
 * APPLICATION READY
 * =============================================================================
 */

function markApplicationReady(
  events,
  logger,
) {
  if (
    applicationState.ready
  ) {
    return false;
  }

  if (
    applicationState.failed ||
    applicationState.shuttingDown ||
    applicationState.stopped ||
    applicationState.terminated
  ) {
    throw new Error(
      "Cannot mark a terminated, stopped, failed, or shutting-down application as ready.",
    );
  }

  if (
    applicationState.bootstrapPhase !==
    BOOTSTRAP_PHASES.SERVER
  ) {
    throw new Error(
      "Application cannot become ready before the server bootstrap phase is complete.",
    );
  }

  if (
    !applicationState.completedPhases.includes(
      BOOTSTRAP_PHASES.SERVER,
    )
  ) {
    throw new Error(
      "Application cannot become ready before the server phase is completed.",
    );
  }

  const incompletePhases =
    BOOTSTRAP_PHASE_ORDER.filter(
      (phase) =>
        !applicationState.completedPhases.includes(
          phase,
        ),
    );

  if (
    incompletePhases.length >
    0
  ) {
    throw new Error(
      "Application cannot become ready because the following " +
        "bootstrap phases are incomplete: " +
        incompletePhases.join(
          ", ",
        ),
    );
  }

  const readyAt = now();

  applicationState.initialized =
    true;

  applicationState.starting =
    false;

  applicationState.started =
    true;

  applicationState.ready =
    true;

  applicationState.healthy =
    true;

  applicationState.readyAt =
    readyAt;

  applicationState.lastHealthCheck =
    readyAt;

  applicationState.readiness = {
    ready: true,

    blockers: [],

    checks:
      cloneObject(
        applicationState.readiness
          .checks,
      ),

    lastEvaluation:
      readyAt,
  };

  /*
   * READY is the logical lifecycle marker after SERVER.
   */
  updateBootstrapPhase(
    BOOTSTRAP_PHASES.READY,
    events,
    logger,
  );

  emit(
    events,
    "application.ready",
    {
      timestamp:
        readyAt.toISOString(),

      startupDurationMs:
        applicationState.startupDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "runtime",

      event: "application_ready",

      startupDurationMs:
        applicationState.startupDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * HEALTH CHECK
 * =============================================================================
 *
 * Health and readiness are intentionally separate.
 *
 * A health failure forces readiness false because an unhealthy process must
 * not continue advertising production readiness.
 * =============================================================================
 */

function markHealthCheck(
  healthy,
  events,
  logger,
) {
  const nextHealthState =
    Boolean(healthy);

  const previousHealthState =
    applicationState.healthy;

  const healthTimestamp =
    now();

  applicationState.healthy =
    nextHealthState;

  applicationState.lastHealthCheck =
    healthTimestamp;

  if (!nextHealthState) {
    applicationState.ready =
      false;

    applicationState.readiness.ready =
      false;
  }

  emit(
    events,
    "application.health.changed",
    {
      previousHealthy:
        previousHealthState,

      healthy:
        nextHealthState,

      timestamp:
        healthTimestamp.toISOString(),

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  if (
    previousHealthState !==
    nextHealthState
  ) {
    logInfo(
      logger,
      {
        section: "health",

        event:
          "health_changed",

        healthy:
          nextHealthState,

        runtimeGeneration:
          applicationState.runtimeGeneration,
      },
    );
  }

  return nextHealthState;
}

/* =============================================================================
 * APPLICATION SHUTDOWN
 * =============================================================================
 *
 * Supports:
 *
 *   1. Normal shutdown:
 *
 *        ready → shutting_down → stopped
 *
 *   2. Partial startup failure:
 *
 *        any startup phase
 *            ↓
 *        failed
 *            ↓
 *        shutting_down
 *            ↓
 *        stopped
 *
 * The failure path intentionally does not require SERVER or READY.
 * =============================================================================
 */

function markApplicationShutdown(
  events,
  logger,
  options = {},
) {
  /*
   * Idempotent terminal behavior.
   */
  if (
    applicationState.terminated ||
    applicationState.stopped
  ) {
    return false;
  }

  /*
   * Idempotent repeated shutdown signal.
   */
  if (
    applicationState.shuttingDown
  ) {
    return false;
  }

  const failureCleanup =
    options.failureCleanup === true ||
    applicationState.failed === true ||
    options.reason ===
      "startup_failure";

  const currentPhase =
    applicationState.bootstrapPhase;

  const startupLifecycleState =
    applicationState.bootstrapLifecycle;

  const shutdownAllowed =
    failureCleanup ||
    SHUTDOWN_ELIGIBLE_PHASES.includes(
      currentPhase,
    );

  if (!shutdownAllowed) {
    throw new Error(
      "Application cannot begin shutdown from the current lifecycle state. " +
        `phase="${String(
          currentPhase,
        )}", ` +
        `lifecycle="${String(
          startupLifecycleState,
        )}".`,
    );
  }

  const shutdownStartedAt =
    now();

  applicationState.shuttingDown =
    true;

  applicationState.starting =
    false;

  applicationState.started =
    false;

  applicationState.ready =
    false;

  applicationState.healthy =
    false;

  applicationState.shutdownStartedAt =
    shutdownStartedAt;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.SHUTTING_DOWN;

  applicationState.readiness.ready =
    false;

  /*
   * If the caller explicitly requested failure cleanup, make the failure
   * authoritative even if markFailed() was not called separately.
   */
  if (
    failureCleanup &&
    !applicationState.failed
  ) {
    applicationState.failed =
      true;

    applicationState.bootstrapLifecycle =
      BOOTSTRAP_LIFECYCLE_STATES.FAILED;
  }

  updateBootstrapPhase(
    BOOTSTRAP_PHASES.SHUTTING_DOWN,
    events,
    logger,
    {
      failureCleanup,
    },
  );

  const reason =
    options.reason ??
    (
      failureCleanup
        ? "startup_failure"
        : "shutdown"
    );

  emit(
    events,
    "application.shutdown",
    {
      timestamp:
        shutdownStartedAt.toISOString(),

      reason,

      failureCleanup,

      phaseBeforeShutdown:
        currentPhase,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "runtime",

      event:
        "application_shutting_down",

      reason,

      failureCleanup,

      phaseBeforeShutdown:
        currentPhase,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * PARTIAL-STARTUP FAILURE SHUTDOWN ALIAS
 * =============================================================================
 */

function markApplicationShutdownAfterFailure(
  events,
  logger,
  options = {},
) {
  return markApplicationShutdown(
    events,
    logger,
    {
      ...options,

      failureCleanup: true,

      reason:
        options.reason ??
        "startup_failure",
    },
  );
}

/* =============================================================================
 * APPLICATION STOPPED
 * =============================================================================
 */

function markApplicationStopped(
  events,
  logger,
) {
  /*
   * Terminal idempotency.
   */
  if (
    applicationState.stopped ||
    applicationState.terminated
  ) {
    return false;
  }

  if (
    applicationState.shuttingDown !==
    true
  ) {
    throw new Error(
      "Application must enter shutting_down before stopped.",
    );
  }

  const stoppedAt = now();

  applicationState.started =
    false;

  applicationState.starting =
    false;

  applicationState.ready =
    false;

  applicationState.healthy =
    false;

  applicationState.shuttingDown =
    false;

  applicationState.stopped =
    true;

  applicationState.terminated =
    true;

  applicationState.stoppedAt =
    stoppedAt;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.STOPPED;

  applicationState.readiness.ready =
    false;

  applicationState.shutdownDurationMs =
    calculateDurationMs(
      applicationState.shutdownStartedAt,
      stoppedAt,
    );

  /*
   * STOPPED is only legal after SHUTTING_DOWN.
   */
  updateBootstrapPhase(
    BOOTSTRAP_PHASES.STOPPED,
    events,
    logger,
  );

  emit(
    events,
    "application.stopped",
    {
      timestamp:
        stoppedAt.toISOString(),

      shutdownDurationMs:
        applicationState.shutdownDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "runtime",

      event:
        "application_stopped",

      shutdownDurationMs:
        applicationState.shutdownDurationMs,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * SERVICE STATE
 * =============================================================================
 */

function setServiceState(
  service,
  state,
  events,
  logger,
) {
  assertValidService(service);

  assertValidServiceState(state);

  const previousState =
    applicationState.serviceStates[
      service
    ];

  /*
   * Idempotent service state assignment.
   */
  if (
    previousState === state
  ) {
    return false;
  }

  const serviceTimestamp =
    now();

  const timing =
    applicationState.serviceTimings[
      service
    ];

  applicationState.serviceStates[
    service
  ] = state;

  /*
   * "services" remains a compatibility/read-model boolean.
   *
   * READY is the only state represented as operationally ready.
   */
  applicationState.services[
    service
  ] =
    state ===
    SERVICE_STATES.READY;

  /* ---------------------------------------------------------------------------
   * STARTING
   * ------------------------------------------------------------------------- */

  if (
    state ===
    SERVICE_STATES.STARTING
  ) {
    timing.startedAt =
      serviceTimestamp;

    timing.readyAt =
      null;

    timing.stoppedAt =
      null;

    timing.durationMs =
      null;
  }

  /* ---------------------------------------------------------------------------
   * READY
   * ------------------------------------------------------------------------- */

  if (
    state ===
    SERVICE_STATES.READY
  ) {
    timing.readyAt =
      serviceTimestamp;

    timing.durationMs =
      calculateDurationMs(
        timing.startedAt,
        serviceTimestamp,
      );
  }

  /* ---------------------------------------------------------------------------
   * STOPPING / STOPPED
   * ------------------------------------------------------------------------- */

  if (
    state ===
      SERVICE_STATES.STOPPING ||
    state ===
      SERVICE_STATES.STOPPED
  ) {
    timing.stoppedAt =
      serviceTimestamp;
  }

  emit(
    events,
    "service.state.changed",
    {
      service,

      previousState,

      state,

      timestamp:
        serviceTimestamp.toISOString(),

      durationMs:
        timing?.durationMs ?? null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section: "service",

      event:
        "service_state_changed",

      service,

      previousState,

      state,

      durationMs:
        timing?.durationMs ?? null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * SERVICE LIFECYCLE HELPERS
 * =============================================================================
 */

function markServiceStarting(
  service,
  events,
  logger,
) {
  return setServiceState(
    service,
    SERVICE_STATES.STARTING,
    events,
    logger,
  );
}

function markServiceReady(
  service,
  events,
  logger,
) {
  return setServiceState(
    service,
    SERVICE_STATES.READY,
    events,
    logger,
  );
}

function markServiceDegraded(
  service,
  events,
  logger,
) {
  return setServiceState(
    service,
    SERVICE_STATES.DEGRADED,
    events,
    logger,
  );
}

function markServiceStopping(
  service,
  events,
  logger,
) {
  return setServiceState(
    service,
    SERVICE_STATES.STOPPING,
    events,
    logger,
  );
}

function markServiceStopped(
  service,
  events,
  logger,
) {
  return setServiceState(
    service,
    SERVICE_STATES.STOPPED,
    events,
    logger,
  );
}

function markServiceFailed(
  service,
  error,
  events,
  logger,
) {
  assertValidService(service);

  const normalizedError =
    normalizeError(error);

  setServiceState(
    service,
    SERVICE_STATES.FAILED,
    events,
    logger,
  );

  const failureTimestamp =
    now();

  emit(
    events,
    "service.failed",
    {
      service,

      error:
        normalizedError,

      timestamp:
        failureTimestamp.toISOString(),

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logError(
    logger,
    {
      section: "service",

      event:
        "service_failed",

      service,

      error:
        normalizedError,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * REQUEST METRICS
 * =============================================================================
 *
 * requestCount = total requests observed.
 * activeRequests = requests currently in flight.
 *
 * Neither counter may become negative.
 * =============================================================================
 */

function incrementActiveRequests() {
  applicationState.requestCount =
    Math.max(
      0,
      applicationState.requestCount +
        1,
    );

  applicationState.activeRequests =
    Math.max(
      0,
      applicationState.activeRequests +
        1,
    );

  return applicationState.activeRequests;
}

function decrementActiveRequests() {
  applicationState.activeRequests =
    Math.max(
      0,
      applicationState.activeRequests -
        1,
    );

  return applicationState.activeRequests;
}

/* =============================================================================
 * WEBSOCKET METRICS
 * =============================================================================
 */

function incrementSocketConnections() {
  applicationState.websocketConnections =
    Math.max(
      0,
      applicationState.websocketConnections +
        1,
    );

  return applicationState.websocketConnections;
}

function decrementSocketConnections() {
  applicationState.websocketConnections =
    Math.max(
      0,
      applicationState.websocketConnections -
        1,
    );

  return applicationState.websocketConnections;
}

/* =============================================================================
 * UPTIME
 * =============================================================================
 */

function getUptime() {
  return process.uptime();
}

/* =============================================================================
 * READINESS
 * =============================================================================
 */

function isReady() {
  return (
    applicationState.started ===
      true &&
    applicationState.ready ===
      true &&
    applicationState.healthy ===
      true &&
    applicationState.shuttingDown ===
      false &&
    applicationState.failed ===
      false &&
    applicationState.stopped ===
      false &&
    applicationState.terminated ===
      false
  );
}

/* =============================================================================
 * LIVENESS
 * =============================================================================
 *
 * A process remains live until it has reached its terminal stopped state.
 *
 * This is intentionally independent of readiness.
 * =============================================================================
 */

function isLive() {
  return (
    applicationState.terminated !==
    true
  );
}

/* =============================================================================
 * HEALTH STATE
 * =============================================================================
 */

function getHealthState() {
  return {
    live: isLive(),

    ready: isReady(),

    healthy:
      applicationState.healthy,

    started:
      applicationState.started,

    starting:
      applicationState.starting,

    failed:
      applicationState.failed,

    shuttingDown:
      applicationState.shuttingDown,

    stopped:
      applicationState.stopped,

    terminated:
      applicationState.terminated,

    phase:
      applicationState.bootstrapPhase,

    bootstrapLifecycle:
      applicationState.bootstrapLifecycle,

    readiness: {
      ready:
        applicationState
          .readiness.ready,

      blockers: [
        ...applicationState
          .readiness
          .blockers,
      ],

      checks: {
        ...applicationState
          .readiness
          .checks,
      },

      lastEvaluation:
        applicationState
          .readiness
          .lastEvaluation
          ?.toISOString() ??
        null,
    },

    lastHealthCheck:
      applicationState
        .lastHealthCheck
        ?.toISOString() ??
      null,
  };
}

/* =============================================================================
 * APPLICATION FAILURE
 * =============================================================================
 *
 * markFailed() establishes an authoritative failure barrier.
 *
 * It does NOT automatically perform infrastructure cleanup.
 *
 * The bootstrap/shutdown coordinator remains responsible for invoking:
 *
 *   markApplicationShutdownAfterFailure()
 *
 * and eventually:
 *
 *   markApplicationStopped()
 *
 * This separation keeps state.js free from orchestration concerns.
 * =============================================================================
 */

function markFailed(
  error,
  events,
  logger,
  options = {},
) {
  /*
   * If the application is already terminal, do not rewrite the terminal
   * failure record.
   */
  if (
    applicationState.terminated
  ) {
    return false;
  }

  const normalizedError =
    normalizeError(error);

  const failedAt =
    now();

  applicationState.failed =
    true;

  applicationState.starting =
    false;

  applicationState.started =
    false;

  applicationState.ready =
    false;

  applicationState.healthy =
    false;

  applicationState.readiness.ready =
    false;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.FAILED;

  applicationState.failure = {
    message:
      normalizedError.message,

    code:
      normalizedError.code,

    name:
      normalizedError.name,

    phase:
      options.phase ??
      applicationState.bootstrapPhase,

    at:
      failedAt.toISOString(),
  };

  /*
   * Fail the logical service associated with the active bootstrap phase.
   */
  const currentService =
    PHASE_SERVICE_MAP[
      applicationState.bootstrapPhase
    ];

  if (
    currentService &&
    applicationState.serviceStates[
      currentService
    ] !==
      SERVICE_STATES.FAILED
  ) {
    setServiceState(
      currentService,
      SERVICE_STATES.FAILED,
      events,
      logger,
    );
  }

  emit(
    events,
    "application.failed",
    {
      message:
        applicationState.failure
          .message,

      code:
        applicationState.failure
          .code,

      name:
        applicationState.failure
          .name,

      phase:
        applicationState.failure
          .phase,

      timestamp:
        applicationState.failure
          .at,

      reason:
        options.reason ??
        null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logError(
    logger,
    {
      section: "runtime",

      event: "application_failed",

      message:
        applicationState.failure
          .message,

      code:
        applicationState.failure
          .code,

      name:
        applicationState.failure
          .name,

      phase:
        applicationState.failure
          .phase,

      reason:
        options.reason ??
        null,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * PHASE TIMING SNAPSHOT
 * =============================================================================
 */

function getPhaseTimingsSnapshot() {
  const result = {};

  Object.entries(
    applicationState.phaseTimings,
  ).forEach(
    ([phase, timing]) => {
      result[phase] = {
        startedAt:
          timing.startedAt
            ?.toISOString() ??
          null,

        completedAt:
          timing.completedAt
            ?.toISOString() ??
          null,

        durationMs:
          timing.durationMs,
      };
    },
  );

  return result;
}

/* =============================================================================
 * SERVICE TIMING SNAPSHOT
 * =============================================================================
 */

function getServiceTimingsSnapshot() {
  const result = {};

  Object.entries(
    applicationState.serviceTimings,
  ).forEach(
    ([service, timing]) => {
      result[service] = {
        startedAt:
          timing.startedAt
            ?.toISOString() ??
          null,

        readyAt:
          timing.readyAt
            ?.toISOString() ??
          null,

        stoppedAt:
          timing.stoppedAt
            ?.toISOString() ??
          null,

        durationMs:
          timing.durationMs,
      };
    },
  );

  return result;
}

/* =============================================================================
 * SAFE FAILURE SNAPSHOT
 * =============================================================================
 */

function getFailureSnapshot() {
  if (!applicationState.failure) {
    return null;
  }

  return {
    message:
      applicationState.failure.message,

    code:
      applicationState.failure.code,

    name:
      applicationState.failure.name,

    phase:
      applicationState.failure.phase,

    at:
      applicationState.failure.at,
  };
}

/* =============================================================================
 * SAFE APPLICATION STATE SNAPSHOT
 * =============================================================================
 *
 * Consumers receive a read model rather than the internal state object.
 *
 * applicationState itself remains exported for backward compatibility with
 * legacy code, but new consumers should prefer getApplicationState().
 * =============================================================================
 */

function getApplicationState() {
  const snapshot = {
    runtimeGeneration:
      applicationState.runtimeGeneration,

    processId:
      applicationState.processId,

    nodeVersion:
      applicationState.nodeVersion,

    initialized:
      applicationState.initialized,

    starting:
      applicationState.starting,

    started:
      applicationState.started,

    healthy:
      applicationState.healthy,

    ready:
      applicationState.ready,

    shuttingDown:
      applicationState.shuttingDown,

    stopped:
      applicationState.stopped,

    terminated:
      applicationState.terminated,

    failed:
      applicationState.failed,

    bootstrapLifecycle:
      applicationState.bootstrapLifecycle,

    bootstrapPhase:
      applicationState.bootstrapPhase,

    completedPhases: [
      ...applicationState.completedPhases,
    ],

    phaseTimings:
      getPhaseTimingsSnapshot(),

    startedAt:
      applicationState.startedAt
        ?.toISOString() ??
      null,

    readyAt:
      applicationState.readyAt
        ?.toISOString() ??
      null,

    shutdownStartedAt:
      applicationState.shutdownStartedAt
        ?.toISOString() ??
      null,

    stoppedAt:
      applicationState.stoppedAt
        ?.toISOString() ??
      null,

    lastHealthCheck:
      applicationState.lastHealthCheck
        ?.toISOString() ??
      null,

    startupDurationMs:
      applicationState.startupDurationMs,

    shutdownDurationMs:
      applicationState.shutdownDurationMs,

    uptime:
      getUptime(),

    totalRequests:
      applicationState.requestCount,

    activeRequests:
      applicationState.activeRequests,

    websocketConnections:
      applicationState.websocketConnections,

    services: {
      ...applicationState.services,
    },

    serviceStates: {
      ...applicationState.serviceStates,
    },

    serviceTimings:
      getServiceTimingsSnapshot(),

    readiness: {
      ready:
        applicationState
          .readiness.ready,

      blockers: [
        ...applicationState
          .readiness
          .blockers,
      ],

      checks: {
        ...applicationState
          .readiness
          .checks,
      },

      lastEvaluation:
        applicationState
          .readiness
          .lastEvaluation
          ?.toISOString() ??
        null,
    },

    health:
      getHealthState(),

    failure:
      getFailureSnapshot(),
  };

  /*
   * Freeze top-level collections to prevent accidental mutation by consumers.
   */
  Object.freeze(
    snapshot.completedPhases,
  );

  Object.freeze(
    snapshot.services,
  );

  Object.freeze(
    snapshot.serviceStates,
  );

  Object.freeze(
    snapshot.readiness.blockers,
  );

  Object.freeze(
    snapshot.readiness.checks,
  );

  Object.freeze(
    snapshot.readiness,
  );

  Object.freeze(
    snapshot.health.readiness
      .blockers,
  );

  Object.freeze(
    snapshot.health.readiness
      .checks,
  );

  Object.freeze(
    snapshot.health.readiness,
  );

  Object.freeze(
    snapshot.health,
  );

  if (snapshot.failure) {
    Object.freeze(
      snapshot.failure,
    );
  }

  Object.freeze(
    snapshot,
  );

  return snapshot;
}

/* =============================================================================
 * RUNTIME SUMMARY
 * =============================================================================
 *
 * Lightweight operational representation for logs, health endpoints and
 * metrics adapters.
 * =============================================================================
 */

function getRuntimeSummary() {
  return {
    runtimeGeneration:
      applicationState.runtimeGeneration,

    lifecycle:
      applicationState
        .bootstrapLifecycle,

    phase:
      applicationState
        .bootstrapPhase,

    live:
      isLive(),

    initialized:
      applicationState.initialized,

    starting:
      applicationState.starting,

    started:
      applicationState.started,

    healthy:
      applicationState.healthy,

    ready:
      isReady(),

    failed:
      applicationState.failed,

    shuttingDown:
      applicationState.shuttingDown,

    stopped:
      applicationState.stopped,

    terminated:
      applicationState.terminated,

    uptime:
      getUptime(),

    startupDurationMs:
      applicationState
        .startupDurationMs,

    shutdownDurationMs:
      applicationState
        .shutdownDurationMs,

    activeRequests:
      applicationState
        .activeRequests,

    totalRequests:
      applicationState
        .requestCount,

    websocketConnections:
      applicationState
        .websocketConnections,
  };
}

/* =============================================================================
 * RESET APPLICATION STATE
 * =============================================================================
 *
 * Intended primarily for:
 *
 *   - automated tests;
 *   - controlled application reinitialization;
 *   - isolated development lifecycle tests.
 *
 * A reset creates a NEW runtime generation.
 * =============================================================================
 */

function resetApplicationState() {
  applicationState.runtimeGeneration =
    createRuntimeGeneration();

  applicationState.processId =
    process.pid;

  applicationState.nodeVersion =
    process.version;

  applicationState.initialized =
    false;

  applicationState.starting =
    false;

  applicationState.started =
    false;

  applicationState.healthy =
    false;

  applicationState.ready =
    false;

  applicationState.shuttingDown =
    false;

  applicationState.stopped =
    false;

  applicationState.terminated =
    false;

  applicationState.failed =
    false;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.NOT_STARTED;

  applicationState.bootstrapPhase =
    null;

  applicationState.completedPhases =
    [];

  applicationState.phaseTimings =
    createInitialPhaseTimings();

  applicationState.startedAt =
    null;

  applicationState.readyAt =
    null;

  applicationState.shutdownStartedAt =
    null;

  applicationState.stoppedAt =
    null;

  applicationState.lastHealthCheck =
    null;

  applicationState.startupDurationMs =
    null;

  applicationState.shutdownDurationMs =
    null;

  applicationState.failure =
    null;

  applicationState.readiness =
    createInitialReadiness();

  applicationState.requestCount =
    0;

  applicationState.activeRequests =
    0;

  applicationState.websocketConnections =
    0;

  applicationState.services =
    createInitialServices();

  applicationState.serviceStates =
    createInitialServiceStates();

  applicationState.serviceTimings =
    createInitialServiceTimings();

  return getApplicationState();
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports = {
  /* ---------------------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------------------- */

  BOOTSTRAP_PHASES,

  BOOTSTRAP_PHASE_ORDER,

  BOOTSTRAP_TRANSITIONS,

  SHUTDOWN_ELIGIBLE_PHASES,

  BOOTSTRAP_LIFECYCLE_STATES,

  SERVICES,

  SERVICE_STATES,

  PHASE_SERVICE_MAP,

  /* ---------------------------------------------------------------------------
   * Backward-compatible internal state export
   *
   * IMPORTANT:
   *
   * Existing legacy consumers may depend on this object.
   * New code should prefer getApplicationState().
   * ------------------------------------------------------------------------- */

  applicationState,

  /* ---------------------------------------------------------------------------
   * Bootstrap lifecycle
   * ------------------------------------------------------------------------- */

  updateBootstrapPhase,

  markPhaseStarted,

  markPhaseCompleted,

  /* ---------------------------------------------------------------------------
   * Application lifecycle
   * ------------------------------------------------------------------------- */

  markStarting,

  markApplicationStarted,

  markApplicationReady,

  markApplicationShutdown,

  markApplicationShutdownAfterFailure,

  markApplicationStopped,

  markFailed,

  /* ---------------------------------------------------------------------------
   * Readiness / health / liveness
   * ------------------------------------------------------------------------- */

  setReadinessState,

  markHealthCheck,

  isReady,

  isLive,

  getHealthState,

  /* ---------------------------------------------------------------------------
   * Services
   * ------------------------------------------------------------------------- */

  setServiceState,

  markServiceStarting,

  markServiceReady,

  markServiceDegraded,

  markServiceStopping,

  markServiceStopped,

  markServiceFailed,

  /* ---------------------------------------------------------------------------
   * Operational metrics
   * ------------------------------------------------------------------------- */

  incrementActiveRequests,

  decrementActiveRequests,

  incrementSocketConnections,

  decrementSocketConnections,

  getUptime,

  /* ---------------------------------------------------------------------------
   * State inspection
   * ------------------------------------------------------------------------- */

  getApplicationState,

  getRuntimeSummary,

  /* ---------------------------------------------------------------------------
   * Testing / controlled reset
   * ------------------------------------------------------------------------- */

  resetApplicationState,
};