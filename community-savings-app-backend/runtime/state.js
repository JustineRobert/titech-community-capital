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
 * Architectural Role
 * -----------------------------------------------------------------------------
 *
 * This module owns:
 *   - runtime state;
 *   - lifecycle state transitions;
 *   - bootstrap phase bookkeeping;
 *   - service state bookkeeping;
 *   - readiness state;
 *   - health/liveness state;
 *   - process-local operational metrics.
 *
 * This module MUST NOT:
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
 *   - mutate Express application state.
 *
 * Bootstrap components mutate runtime state through the exported transition
 * functions.
 *
 * =============================================================================
 *
 * Canonical TITech Bootstrap Lifecycle
 * =============================================================================
 *
 * Normal startup:
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
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * A failed startup does NOT need to reach `server` or `ready` before cleanup.
 *
 * This is the primary correction for the runtime-state errors:
 *
 *   "Application cannot begin shutdown before the startup pipeline reaches
 *    the server/ready lifecycle."
 *
 * and:
 *
 *   "Application must enter shutting_down before stopped."
 *
 * =============================================================================
 *
 * Design Principles
 * =============================================================================
 *
 * ✓ Process-local state only.
 * ✓ BootstrapContext remains the canonical lifecycle authority.
 * ✓ runtime/state.js is a compatibility/read-model authority for legacy
 *   consumers and operational telemetry.
 * ✓ Explicit lifecycle transitions.
 * ✓ Deterministic bootstrap ordering.
 * ✓ Bootstrap phase is distinct from service state.
 * ✓ Started is distinct from healthy.
 * ✓ Healthy is distinct from ready.
 * ✓ Readiness exposes explicit blockers.
 * ✓ Service state is independently observable.
 * ✓ Runtime state never initializes infrastructure.
 * ✓ Runtime state never owns application dependencies.
 * ✓ Failure information is sanitized.
 * ✓ Secrets and credentials are never retained.
 * ✓ Consumers receive snapshots rather than mutable state where possible.
 * ✓ Metrics never become negative.
 * ✓ Duplicate lifecycle operations are idempotent where safe.
 * ✓ Partial-startup shutdown is explicitly supported.
 * ✓ Failed startup cannot be incorrectly marked ready.
 * ✓ Failed startup cannot be incorrectly marked started.
 * ✓ Successful infrastructure/server phases cannot be completed after an
 *   authoritative application failure.
 * ✓ Phase and service timings are captured.
 * ✓ Runtime generation distinguishes startup attempts.
 * ✓ Reset support exists for deterministic testing.
 *
 * =============================================================================
 */

/* =============================================================================
 * BOOTSTRAP PHASES
 * =============================================================================
 */

const BOOTSTRAP_PHASES = Object.freeze({
  ENVIRONMENT:
    "environment",

  CONFIGURATION:
    "configuration",

  LOGGER:
    "logger",

  OBSERVABILITY:
    "observability",

  READINESS:
    "readiness",

  RESILIENCE:
    "resilience",

  INFRASTRUCTURE:
    "infrastructure",

  SERVICES:
    "services",

  MIDDLEWARE:
    "middleware",

  ROUTES:
    "routes",

  SERVER:
    "server",

  READY:
    "ready",

  SHUTTING_DOWN:
    "shutting_down",

  STOPPED:
    "stopped",
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
  NOT_STARTED:
    "not_started",

  STARTING:
    "starting",

  RUNNING:
    "running",

  COMPLETED:
    "completed",

  FAILED:
    "failed",

  SHUTTING_DOWN:
    "shutting_down",

  STOPPED:
    "stopped",
});

/* =============================================================================
 * LOGICAL SERVICES
 * =============================================================================
 */

const SERVICES = Object.freeze({
  LOGGER:
    "logger",

  OBSERVABILITY:
    "observability",

  READINESS:
    "readiness",

  RESILIENCE:
    "resilience",

  DATABASE:
    "database",

  REDIS:
    "redis",

  QUEUES:
    "queues",

  WEBSOCKET:
    "websocket",

  INFRASTRUCTURE:
    "infrastructure",

  SERVICES:
    "services",

  MIDDLEWARE:
    "middleware",

  ROUTES:
    "routes",

  SERVER:
    "server",

  METRICS:
    "metrics",

  DOCUMENTATION:
    "documentation",
});

/* =============================================================================
 * SERVICE STATES
 * =============================================================================
 */

const SERVICE_STATES = Object.freeze({
  STOPPED:
    "stopped",

  STARTING:
    "starting",

  READY:
    "ready",

  DEGRADED:
    "degraded",

  STOPPING:
    "stopping",

  FAILED:
    "failed",
});

/* =============================================================================
 * NORMAL BOOTSTRAP TRANSITIONS
 * =============================================================================
 *
 * Normal startup remains strictly ordered.
 *
 * Shutdown is handled separately because failure cleanup may legitimately
 * originate from any startup phase.
 * =============================================================================
 */

const BOOTSTRAP_TRANSITIONS = Object.freeze({
  [BOOTSTRAP_PHASES.ENVIRONMENT]:
    Object.freeze([
      BOOTSTRAP_PHASES.CONFIGURATION,
    ]),

  [BOOTSTRAP_PHASES.CONFIGURATION]:
    Object.freeze([
      BOOTSTRAP_PHASES.LOGGER,
    ]),

  [BOOTSTRAP_PHASES.LOGGER]:
    Object.freeze([
      BOOTSTRAP_PHASES.OBSERVABILITY,
    ]),

  [BOOTSTRAP_PHASES.OBSERVABILITY]:
    Object.freeze([
      BOOTSTRAP_PHASES.READINESS,
    ]),

  [BOOTSTRAP_PHASES.READINESS]:
    Object.freeze([
      BOOTSTRAP_PHASES.RESILIENCE,
    ]),

  [BOOTSTRAP_PHASES.RESILIENCE]:
    Object.freeze([
      BOOTSTRAP_PHASES.INFRASTRUCTURE,
    ]),

  [BOOTSTRAP_PHASES.INFRASTRUCTURE]:
    Object.freeze([
      BOOTSTRAP_PHASES.SERVICES,
    ]),

  [BOOTSTRAP_PHASES.SERVICES]:
    Object.freeze([
      BOOTSTRAP_PHASES.MIDDLEWARE,
    ]),

  [BOOTSTRAP_PHASES.MIDDLEWARE]:
    Object.freeze([
      BOOTSTRAP_PHASES.ROUTES,
    ]),

  [BOOTSTRAP_PHASES.ROUTES]:
    Object.freeze([
      BOOTSTRAP_PHASES.SERVER,
    ]),

  [BOOTSTRAP_PHASES.SERVER]:
    Object.freeze([
      BOOTSTRAP_PHASES.READY,
    ]),

  [BOOTSTRAP_PHASES.READY]:
    Object.freeze([
      BOOTSTRAP_PHASES.SHUTTING_DOWN,
    ]),

  [BOOTSTRAP_PHASES.SHUTTING_DOWN]:
    Object.freeze([
      BOOTSTRAP_PHASES.STOPPED,
    ]),

  [BOOTSTRAP_PHASES.STOPPED]:
    Object.freeze([]),
});

/* =============================================================================
 * FAILURE / SHUTDOWN TRANSITION POLICY
 * =============================================================================
 *
 * These are NOT ordinary startup transitions.
 *
 * A fatal startup failure can happen while the current phase is:
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
 * Cleanup must be legal from any of those states.
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
  [BOOTSTRAP_PHASES.LOGGER]:
    SERVICES.LOGGER,

  [BOOTSTRAP_PHASES.OBSERVABILITY]:
    SERVICES.OBSERVABILITY,

  [BOOTSTRAP_PHASES.READINESS]:
    SERVICES.READINESS,

  [BOOTSTRAP_PHASES.RESILIENCE]:
    SERVICES.RESILIENCE,

  [BOOTSTRAP_PHASES.INFRASTRUCTURE]:
    SERVICES.INFRASTRUCTURE,

  [BOOTSTRAP_PHASES.SERVICES]:
    SERVICES.SERVICES,

  [BOOTSTRAP_PHASES.MIDDLEWARE]:
    SERVICES.MIDDLEWARE,

  [BOOTSTRAP_PHASES.ROUTES]:
    SERVICES.ROUTES,

  [BOOTSTRAP_PHASES.SERVER]:
    SERVICES.SERVER,
});

/* =============================================================================
 * INITIAL STATE FACTORIES
 * =============================================================================
 */

function createInitialServices() {
  const services = {};

  Object.values(SERVICES).forEach(
    (service) => {
      services[service] = false;
    },
  );

  return services;
}

function createInitialServiceStates() {
  const states = {};

  Object.values(SERVICES).forEach(
    (service) => {
      states[service] =
        SERVICE_STATES.STOPPED;
    },
  );

  return states;
}

function createInitialPhaseTimings() {
  const timings = {};

  BOOTSTRAP_PHASE_ORDER.forEach(
    (phase) => {
      timings[phase] = {
        startedAt:
          null,

        completedAt:
          null,

        durationMs:
          null,
      };
    },
  );

  return timings;
}

function createInitialServiceTimings() {
  const timings = {};

  Object.values(SERVICES).forEach(
    (service) => {
      timings[service] = {
        startedAt:
          null,

        readyAt:
          null,

        stoppedAt:
          null,

        durationMs:
          null,
      };
    },
  );

  return timings;
}

function createInitialReadiness() {
  return {
    ready:
      false,

    blockers:
      [],

    checks:
      {},

    lastEvaluation:
      null,
  };
}

/* =============================================================================
 * RUNTIME GENERATION
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
  runtimeGeneration:
    createRuntimeGeneration(),

  processId:
    process.pid,

  nodeVersion:
    process.version,

  initialized:
    false,

  starting:
    false,

  started:
    false,

  healthy:
    false,

  ready:
    false,

  shuttingDown:
    false,

  stopped:
    false,

  terminated:
    false,

  failed:
    false,

  bootstrapLifecycle:
    BOOTSTRAP_LIFECYCLE_STATES.NOT_STARTED,

  bootstrapPhase:
    null,

  completedPhases:
    [],

  phaseTimings:
    createInitialPhaseTimings(),

  startedAt:
    null,

  readyAt:
    null,

  shutdownStartedAt:
    null,

  stoppedAt:
    null,

  lastHealthCheck:
    null,

  startupDurationMs:
    null,

  shutdownDurationMs:
    null,

  failure:
    null,

  readiness:
    createInitialReadiness(),

  requestCount:
    0,

  activeRequests:
    0,

  websocketConnections:
    0,

  services:
    createInitialServices(),

  serviceStates:
    createInitialServiceStates(),

  serviceTimings:
    createInitialServiceTimings(),
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

/* =============================================================================
 * VALIDATION
 * =============================================================================
 */

function assertValidPhase(
  phase,
) {
  if (
    !Object.values(
      BOOTSTRAP_PHASES,
    ).includes(phase)
  ) {
    throw new Error(
      `Unknown bootstrap phase: ${phase}`,
    );
  }
}

function assertValidService(
  service,
) {
  if (
    !Object.values(
      SERVICES,
    ).includes(service)
  ) {
    throw new Error(
      `Unknown service: ${service}`,
    );
  }
}

function assertValidServiceState(
  state,
) {
  if (
    !Object.values(
      SERVICE_STATES,
    ).includes(state)
  ) {
    throw new Error(
      `Unknown service state: ${state}`,
    );
  }
}

/* =============================================================================
 * SAFE ERROR NORMALIZATION
 * =============================================================================
 */

function normalizeError(
  error,
) {
  if (!error) {
    return {
      message:
        "Unknown runtime error",

      code:
        null,

      name:
        "Error",
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
        "Unserializable runtime error";
    }
  }

  return {
    message:
      String(message).slice(
        0,
        1000,
      ),

    code:
      typeof error.code ===
      "string"
        ? error.code.slice(
            0,
            100,
          )
        : null,

    name:
      typeof error.name ===
      "string"
        ? error.name.slice(
            0,
            100,
          )
        : "Error",
  };
}

/* =============================================================================
 * EVENT HELPER
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
    // Runtime bookkeeping must never fail because an optional emitter failed.
  }
}

/* =============================================================================
 * LOGGING HELPERS
 * ============================================================================= */

function logInfo(
  logger,
  payload,
) {
  try {
    logger?.info?.(
      payload,
    );
  } catch {
    // Logging must never become lifecycle-fatal.
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
    // Logging must never become lifecycle-fatal.
  }
}

/* =============================================================================
 * PHASE TRANSITION
 * =============================================================================
 *
 * Normal phase progression remains strict.
 *
 * Shutdown is intentionally NOT handled through the normal phase transition
 * graph when application startup has failed.
 * =============================================================================
 */

function updateBootstrapPhase(
  phase,
  events,
  logger,
  options = {},
) {
  assertValidPhase(
    phase,
  );

  const currentPhase =
    applicationState.bootstrapPhase;

  const failureCleanup =
    options.failureCleanup === true;

  /* ---------------------------------------------------------------------------
   * Idempotent transition
   * ------------------------------------------------------------------------- */

  if (
    currentPhase ===
    phase
  ) {
    return false;
  }

  /* ---------------------------------------------------------------------------
   * Special shutdown transition
   *
   * This is the key partial-startup fix.
   * ------------------------------------------------------------------------- */

  if (
    phase ===
    BOOTSTRAP_PHASES.SHUTTING_DOWN
  ) {
    const allowed =
      (
        SHUTDOWN_ELIGIBLE_PHASES.includes(
          currentPhase,
        ) ||
        applicationState.failed ===
          true ||
        failureCleanup
      );

    if (!allowed) {
      throw new Error(
        `Invalid bootstrap shutdown transition from "${currentPhase}".`,
      );
    }
  } else if (
    phase ===
    BOOTSTRAP_PHASES.STOPPED
  ) {
    if (
      currentPhase !==
      BOOTSTRAP_PHASES.SHUTTING_DOWN
    ) {
      throw new Error(
        "Application must enter shutting_down before stopped.",
      );
    }
  } else {
    /* -----------------------------------------------------------------------
     * Normal startup transition.
     * --------------------------------------------------------------------- */

    if (
      currentPhase ===
      null
    ) {
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

  const currentTimestamp =
    now();

  /**
   * Record timing only for actual startup phases.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      applicationState.phaseTimings,
      phase,
    )
  ) {
    applicationState.phaseTimings[
      phase
    ].startedAt =
      currentTimestamp;
  }

  emit(
    events,
    "bootstrap.phase.changed",
    {
      previousPhase:
        currentPhase,

      phase,

      timestamp:
        currentTimestamp.toISOString(),

      failureCleanup,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section:
        "bootstrap",

      event:
        "phase_changed",

      previousPhase:
        currentPhase,

      phase,

      failureCleanup,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * PHASE STARTED
 * =============================================================================
 */

function markPhaseStarted(
  phase,
  events,
  logger,
) {
  assertValidPhase(
    phase,
  );

  if (
    phase ===
      BOOTSTRAP_PHASES.READY ||
    phase ===
      BOOTSTRAP_PHASES.SHUTTING_DOWN ||
    phase ===
      BOOTSTRAP_PHASES.STOPPED
  ) {
    throw new Error(
      `Lifecycle state cannot be started as a bootstrap phase: ${phase}`,
    );
  }

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

  applicationState.starting =
    true;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.RUNNING;

  const service =
    PHASE_SERVICE_MAP[
      phase
    ];

  if (service) {
    markServiceStarting(
      service,
      events,
      logger,
    );
  }
}

/* =============================================================================
 * PHASE COMPLETED
 * =============================================================================
 */

function markPhaseCompleted(
  phase,
  events,
  logger,
) {
  assertValidPhase(
    phase,
  );

  if (
    !BOOTSTRAP_PHASE_ORDER.includes(
      phase,
    )
  ) {
    throw new Error(
      `Invalid bootstrap completion phase: ${phase}`,
    );
  }

  /**
   * CRITICAL:
   *
   * Once application failure is authoritative, a startup phase cannot later be
   * marked successful. This prevents:
   *
   *   database hook failed
   *        ↓
   *   infrastructure phase completed
   *
   * which was visible in the previous log.
   */
  if (
    applicationState.failed
  ) {
    throw new Error(
      `Cannot complete bootstrap phase "${phase}" after application failure.`,
    );
  }

  if (
    applicationState.bootstrapPhase !==
    phase
  ) {
    throw new Error(
      `Cannot complete bootstrap phase "${phase}" because current phase is "${applicationState.bootstrapPhase}".`,
    );
  }

  if (
    !applicationState.completedPhases.includes(
      phase,
    )
  ) {
    applicationState.completedPhases.push(
      phase,
    );
  }

  const completedAt =
    now();

  const timing =
    applicationState.phaseTimings[
      phase
    ];

  if (timing) {
    timing.completedAt =
      completedAt;

    if (
      timing.startedAt
    ) {
      timing.durationMs =
        Math.max(
          0,
          completedAt.getTime() -
            timing.startedAt.getTime(),
        );
    }
  }

  const service =
    PHASE_SERVICE_MAP[
      phase
    ];

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
        timing?.durationMs ??
        null,
    },
  );

  logInfo(
    logger,
    {
      section:
        "bootstrap",

      event:
        "phase_completed",

      phase,

      durationMs:
        timing?.durationMs ??
        null,
    },
  );
}

/* =============================================================================
 * APPLICATION STARTING
 * =============================================================================
 */

function markStarting(
  events,
  logger,
) {
  if (
    applicationState.started &&
    applicationState.ready
  ) {
    return false;
  }

  if (
    applicationState.terminated ||
    applicationState.stopped
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

  if (
    applicationState.starting
  ) {
    return false;
  }

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

  const startedAt =
    now();

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
      section:
        "runtime",

      event:
        "application_starting",

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  return true;
}

/* =============================================================================
 * APPLICATION STARTED
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

  const startedAt =
    now();

  applicationState.initialized =
    true;

  applicationState.starting =
    false;

  applicationState.started =
    true;

  applicationState.ready =
    false;

  applicationState.healthy =
    true;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.COMPLETED;

  if (
    applicationState.startedAt
  ) {
    applicationState.startupDurationMs =
      Math.max(
        0,
        startedAt.getTime() -
          applicationState.startedAt.getTime(),
      );
  }

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
      section:
        "runtime",

      event:
        "application_started",

      startupDurationMs:
        applicationState.startupDurationMs,
    },
  );

  return true;
}

/* =============================================================================
 * READINESS EVALUATION
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
          .filter(Boolean)
          .map(
            (value) =>
              String(value).slice(
                0,
                500,
              ),
          )
      : [];

  const normalizedChecks =
    checks &&
    typeof checks ===
      "object"
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
      true;

  const previousReady =
    applicationState.ready;

  const evaluationTimestamp =
    now();

  applicationState.readiness = {
    ready:
      nextReady,

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
    applicationState.healthy =
      false;
  }

  emit(
    events,
    "application.readiness.changed",
    {
      previousReady,

      ready:
        nextReady,

      blockers:
        [
          ...normalizedBlockers,
        ],

      timestamp:
        evaluationTimestamp.toISOString(),
    },
  );

  if (
    previousReady !==
    nextReady
  ) {
    logInfo(
      logger,
      {
        section:
          "readiness",

        event:
          "readiness_changed",

        ready:
          nextReady,

        blockers:
          [
            ...normalizedBlockers,
          ],
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
    applicationState.terminated ||
    applicationState.shuttingDown ||
    applicationState.failed
  ) {
    throw new Error(
      "Cannot mark a terminated, failed, or shutting-down application as ready.",
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

  const readyAt =
    now();

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
    ready:
      true,

    blockers:
      [],

    checks:
      applicationState.readiness.checks,

    lastEvaluation:
      readyAt,
  };

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
      section:
        "runtime",

      event:
        "application_ready",

      startupDurationMs:
        applicationState.startupDurationMs,
    },
  );

  return true;
}

/* =============================================================================
 * HEALTH CHECK
 * =============================================================================
 */

function markHealthCheck(
  healthy,
  events,
  logger,
) {
  const nextHealthState =
    Boolean(
      healthy,
    );

  const previousHealthState =
    applicationState.healthy;

  applicationState.healthy =
    nextHealthState;

  applicationState.lastHealthCheck =
    now();

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
        applicationState.lastHealthCheck.toISOString(),
    },
  );

  if (
    previousHealthState !==
    nextHealthState
  ) {
    logInfo(
      logger,
      {
        section:
          "health",

        event:
          "health_changed",

        healthy:
          nextHealthState,
      },
    );
  }
}

/* =============================================================================
 * APPLICATION SHUTDOWN
 * =============================================================================
 *
 * Supports BOTH:
 *
 *   1. normal shutdown:
 *        ready/server → shutting_down
 *
 *   2. partial-startup failure:
 *        any startup phase / failed → shutting_down
 *
 * This is the primary fix for the reported runtime/state.js errors.
 * =============================================================================
 */

function markApplicationShutdown(
  events,
  logger,
  options = {},
) {
  if (
    applicationState.terminated ||
    applicationState.stopped
  ) {
    return false;
  }

  if (
    applicationState.shuttingDown
  ) {
    return false;
  }

  const failureCleanup =
    options.failureCleanup ===
    true ||
    applicationState.failed ===
    true ||
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

  applicationState.ready =
    false;

  applicationState.healthy =
    false;

  applicationState.starting =
    false;

  applicationState.shutdownStartedAt =
    shutdownStartedAt;

  applicationState.bootstrapLifecycle =
    BOOTSTRAP_LIFECYCLE_STATES.SHUTTING_DOWN;

  applicationState.readiness.ready =
    false;

  if (
    failureCleanup &&
    !applicationState.failed
  ) {
    applicationState.failed =
      true;
  }

  updateBootstrapPhase(
    BOOTSTRAP_PHASES.SHUTTING_DOWN,
    events,
    logger,
    {
      failureCleanup,
    },
  );

  emit(
    events,
    "application.shutdown",
    {
      timestamp:
        shutdownStartedAt.toISOString(),

      reason:
        options.reason ??
        (
          failureCleanup
            ? "startup_failure"
            : "shutdown"
        ),

      failureCleanup,

      runtimeGeneration:
        applicationState.runtimeGeneration,
    },
  );

  logInfo(
    logger,
    {
      section:
        "runtime",

      event:
        "application_shutting_down",

      reason:
        options.reason ??
        (
          failureCleanup
            ? "startup_failure"
            : "shutdown"
        ),

      failureCleanup,

      phaseBeforeShutdown:
        currentPhase,
    },
  );

  return true;
}

/**
 * Explicit alias for partial-startup cleanup.
 *
 * Useful for bootstrap/app.js and future lifecycle coordinators.
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

      failureCleanup:
        true,

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

  const stoppedAt =
    now();

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

  if (
    applicationState.shutdownStartedAt
  ) {
    applicationState.shutdownDurationMs =
      Math.max(
        0,
        stoppedAt.getTime() -
          applicationState.shutdownStartedAt.getTime(),
      );
  }

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
      section:
        "runtime",

      event:
        "application_stopped",

      shutdownDurationMs:
        applicationState.shutdownDurationMs,
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
  assertValidService(
    service,
  );

  assertValidServiceState(
    state,
  );

  const previousState =
    applicationState.serviceStates[
      service
    ];

  if (
    previousState ===
    state
  ) {
    return false;
  }

  applicationState.serviceStates[
    service
  ] = state;

  applicationState.services[
    service
  ] =
    state ===
    SERVICE_STATES.READY;

  const serviceTimestamp =
    now();

  const timing =
    applicationState.serviceTimings[
      service
    ];

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

  if (
    state ===
    SERVICE_STATES.READY
  ) {
    timing.readyAt =
      serviceTimestamp;

    if (
      timing.startedAt
    ) {
      timing.durationMs =
        Math.max(
          0,
          serviceTimestamp.getTime() -
            timing.startedAt.getTime(),
        );
    }
  }

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
        timing?.durationMs ??
        null,
    },
  );

  logInfo(
    logger,
    {
      section:
        "service",

      event:
        "service_state_changed",

      service,

      previousState,

      state,

      durationMs:
        timing?.durationMs ??
        null,
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
  assertValidService(
    service,
  );

  const normalizedError =
    normalizeError(error);

  setServiceState(
    service,
    SERVICE_STATES.FAILED,
    events,
    logger,
  );

  emit(
    events,
    "service.failed",
    {
      service,

      error:
        normalizedError,

      timestamp:
        timestamp(),
    },
  );

  logError(
    logger,
    {
      section:
        "service",

      event:
        "service_failed",

      service,

      error:
        normalizedError,
    },
  );
}

/* =============================================================================
 * REQUEST METRICS
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
}

function decrementActiveRequests() {
  applicationState.activeRequests =
    Math.max(
      0,
      applicationState.activeRequests -
        1,
    );
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
}

function decrementSocketConnections() {
  applicationState.websocketConnections =
    Math.max(
      0,
      applicationState.websocketConnections -
        1,
    );
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
    applicationState.terminated ===
      false
  );
}

/* =============================================================================
 * LIVENESS
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
    live:
      isLive(),

    ready:
      isReady(),

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
        applicationState.readiness.ready,

      blockers:
        [
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
          ?.toISOString() ||
        null,
    },

    lastHealthCheck:
      applicationState
        .lastHealthCheck
        ?.toISOString() ||
      null,
  };
}

/* =============================================================================
 * FAILURE HANDLING
 * ============================================================================= */

function markFailed(
  error,
  events,
  logger,
  options = {},
) {
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

  /**
   * Failure should make the associated logical service failed where one is
   * mapped to the current phase.
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
        applicationState.failure.message,

      code:
        applicationState.failure.code,

      name:
        applicationState.failure.name,

      phase:
        applicationState.failure.phase,

      timestamp:
        applicationState.failure.at,

      reason:
        options.reason ??
        null,
    },
  );

  logError(
    logger,
    {
      section:
        "runtime",

      event:
        "application_failed",

      message:
        applicationState.failure.message,

      code:
        applicationState.failure.code,

      name:
        applicationState.failure.name,

      phase:
        applicationState.failure.phase,

      reason:
        options.reason ??
        null,
    },
  );

  return true;
}

/* =============================================================================
 * PHASE SNAPSHOT
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
            ?.toISOString() ||
          null,

        completedAt:
          timing.completedAt
            ?.toISOString() ||
          null,

        durationMs:
          timing.durationMs,
      };
    },
  );

  return result;
}

/* =============================================================================
 * SERVICE SNAPSHOT
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
            ?.toISOString() ||
          null,

        readyAt:
          timing.readyAt
            ?.toISOString() ||
          null,

        stoppedAt:
          timing.stoppedAt
            ?.toISOString() ||
          null,

        durationMs:
          timing.durationMs,
      };
    },
  );

  return result;
}

/* =============================================================================
 * SAFE APPLICATION STATE SNAPSHOT
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

    completedPhases:
      [
        ...applicationState.completedPhases,
      ],

    phaseTimings:
      getPhaseTimingsSnapshot(),

    startedAt:
      applicationState
        .startedAt
        ?.toISOString() ||
      null,

    readyAt:
      applicationState
        .readyAt
        ?.toISOString() ||
      null,

    shutdownStartedAt:
      applicationState
        .shutdownStartedAt
        ?.toISOString() ||
      null,

    stoppedAt:
      applicationState
        .stoppedAt
        ?.toISOString() ||
      null,

    lastHealthCheck:
      applicationState
        .lastHealthCheck
        ?.toISOString() ||
      null,

    startupDurationMs:
      applicationState
        .startupDurationMs,

    shutdownDurationMs:
      applicationState
        .shutdownDurationMs,

    uptime:
      getUptime(),

    totalRequests:
      applicationState
        .requestCount,

    activeRequests:
      applicationState
        .activeRequests,

    websocketConnections:
      applicationState
        .websocketConnections,

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
          .readiness
          .ready,

      blockers:
        [
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
          ?.toISOString() ||
        null,
    },

    health:
      getHealthState(),

    failure:
      applicationState.failure
        ? {
            ...applicationState.failure,
          }
        : null,
  };

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
    snapshot.health,
  );

  Object.freeze(
    snapshot,
  );

  return snapshot;
}

/* =============================================================================
 * RUNTIME SUMMARY
 * =============================================================================
 */

function getRuntimeSummary() {
  return {
    runtimeGeneration:
      applicationState.runtimeGeneration,

    lifecycle:
      applicationState.bootstrapLifecycle,

    phase:
      applicationState.bootstrapPhase,

    live:
      isLive(),

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
      applicationState.startupDurationMs,

    shutdownDurationMs:
      applicationState.shutdownDurationMs,

    activeRequests:
      applicationState.activeRequests,

    websocketConnections:
      applicationState.websocketConnections,
  };
}

/* =============================================================================
 * RESET RUNTIME STATE
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
  /* Constants */
  BOOTSTRAP_PHASES,

  BOOTSTRAP_PHASE_ORDER,

  BOOTSTRAP_TRANSITIONS,

  SHUTDOWN_ELIGIBLE_PHASES,

  BOOTSTRAP_LIFECYCLE_STATES,

  SERVICES,

  SERVICE_STATES,

  PHASE_SERVICE_MAP,

  /* Backward-compatible state export */
  applicationState,

  /* Bootstrap lifecycle */
  updateBootstrapPhase,

  markPhaseStarted,

  markPhaseCompleted,

  /* Application lifecycle */
  markStarting,

  markApplicationStarted,

  markApplicationReady,

  markApplicationShutdown,

  markApplicationShutdownAfterFailure,

  markApplicationStopped,

  markFailed,

  /* Readiness / health / liveness */
  setReadinessState,

  markHealthCheck,

  isReady,

  isLive,

  getHealthState,

  /* Services */
  setServiceState,

  markServiceStarting,

  markServiceReady,

  markServiceDegraded,

  markServiceStopping,

  markServiceStopped,

  markServiceFailed,

  /* Metrics */
  incrementActiveRequests,

  decrementActiveRequests,

  incrementSocketConnections,

  decrementSocketConnections,

  getUptime,

  /* State inspection */
  getApplicationState,

  getRuntimeSummary,

  /* Testing */
  resetApplicationState,
};